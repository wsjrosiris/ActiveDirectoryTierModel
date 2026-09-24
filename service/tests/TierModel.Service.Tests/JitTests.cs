using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TierModel.Service.Data;
using TierModel.Service.Jit;
using TierModel.Service.Monitoring;
using TierModel.Service.Notifications;
using TierModel.Service.Notifications.Siem;
using TierModel.Service.Runs;

namespace TierModel.Service.Tests;

public class JitUnitTests
{
    [Theory]
    [InlineData("t0-alice", "t0-alice")]
    [InlineData("CONTOSO\\t0-alice", "t0-alice")]
    [InlineData(" Tier0Admins ", "Tier0Admins")]
    [InlineData("Domain Admins", "Domain Admins")]
    [InlineData("s-1-5-21-1-2-3-512", "S-1-5-21-1-2-3-512")]
    [InlineData("DC01$", "DC01$")]
    public void Identities_are_normalised(string input, string expected) => Assert.Equal(expected, JitService.NormalizeIdentity(input));

    [Theory]
    [InlineData("x' -or '1")]
    [InlineData("a@b")]
    [InlineData("a;b")]
    [InlineData("")]
    [InlineData("a\"b")]
    [InlineData("S-1-5-21-1-2-3-512 ; whoami")]
    public void Unsafe_identities_are_rejected(string input) => Assert.Null(JitService.NormalizeIdentity(input));

    [Fact]
    public void Default_member_account_follows_the_sign_in_type()
    {
        Assert.Equal("t0-alice", JitService.DefaultMemberAccount("CONTOSO\\t0-alice", AuthType.Windows));
        Assert.Equal("alice", JitService.DefaultMemberAccount("alice@contoso.com", AuthType.Entra));
        Assert.Equal("operator1", JitService.DefaultMemberAccount("operator1", AuthType.Local));
    }

    [Fact]
    public void Eligibility_uses_minimum_role_and_optional_user_list()
    {
        var g = new JitGroup { Group = "G", DisplayName = "G", CreatedBy = "x", MinimumRole = Role.Operator };
        Assert.True(JitService.IsEligible(g, "op", Role.Operator));
        Assert.True(JitService.IsEligible(g, "adm", Role.Admin));
        Assert.False(JitService.IsEligible(g, "ed", Role.Editor));
        g.EligibleUsers = ["Alice"];
        Assert.True(JitService.IsEligible(g, "alice", Role.Operator));
        Assert.False(JitService.IsEligible(g, "op", Role.Admin));
        g.EligibleUsers = [];
        g.Enabled = false;
        Assert.False(JitService.IsEligible(g, "op", Role.Admin));
    }

    [Fact]
    public void Result_file_is_parsed_in_camel_and_pascal_case()
    {
        var r = JitRunResult.Parse("""
            { "Mode": "grant", "Success": true, "Group": "Tier0Admins", "Member": "t0-alice", "Sids": { "Group": "S-1-5-21-1-2-3-1105", "Member": "S-1-5-21-1-2-3-1201" },
              "TtlSeconds": 3597, "ExpiresAt": "2026-09-24T11:00:00Z", "Dc": "dc01" }
            """);
        Assert.True(r.Success);
        Assert.Equal("S-1-5-21-1-2-3-1105", r.GroupSid);
        Assert.Equal("S-1-5-21-1-2-3-1201", r.MemberSid);
        Assert.Equal(new DateTimeOffset(2026, 9, 24, 11, 0, 0, TimeSpan.Zero), r.ExpiresAt);
        Assert.Equal(3597, r.TtlSeconds);

        var failed = JitRunResult.Parse("""{ "mode": "grant", "success": false, "error": "not enabled" }""");
        Assert.False(failed.Success);
        Assert.Equal("not enabled", failed.Error);
        Assert.Throws<FormatException>(() => JitRunResult.Parse("[1]"));
    }

    [Fact]
    public void Jit_runs_call_the_jit_script_with_quoted_arguments()
    {
        var run = new Run { Kind = RunKind.Jit, JitAction = JitAction.Grant, PreferredDc = "dc01.contoso.local", AdmlLanguage = "en-US", RequestedBy = "op" };
        var p = RunWorker.ScriptParameters(run, "/w", new RunWorker.JitArguments(JitAction.Grant, "Domain Admins", "t0-alice", 60));
        Assert.Equal("Grant-TierModelJitAccess.ps1", RunWorker.ScriptName(RunKind.Jit));
        Assert.Equal(["-PreferredDc", "'dc01.contoso.local'", "-Mode", "Grant", "-Group", "'Domain Admins'", "-Member", "'t0-alice'", "-Minutes", "60",
            "-OutputPath", $"'{Path.Combine("/w", "out", "jit-result.json")}'"], p);
        var check = RunWorker.ScriptParameters(run, "/w", new RunWorker.JitArguments(JitAction.Check, null, null, null));
        Assert.DoesNotContain("-Group", check);
        Assert.Contains("Check", check);
    }

    [Fact]
    public void Active_jit_members_are_expected_by_the_privileged_monitoring()
    {
        var alice = Snap.M("-1201", "t0-bert", dn: "CN=t0-bert,OU=Users,DC=contoso,DC=local");
        var nested = Snap.M("-1201", "t0-bert", direct: false, via: ["Tier0-JIT-DA"]);
        var mallory = Snap.M("-1666", "mallory");
        var data = Snap.Data([
            Snap.G("-2000", "Tier0-JIT-DA", null, alice, mallory),
            Snap.G("-512", "Domänen-Admins", "Domain Admins", Snap.M("-2000", "Tier0-JIT-DA", "group"), nested),
        ]);
        var config = Snap.Config();
        Assert.Contains(PrivilegedEvaluator.Unexpected(data, config), u => u.MemberSid.EndsWith("-1201"));

        config.Jit.Add(new JitExpectation(Snap.D + "-2000", ["Tier0-JIT-DA"], Snap.D + "-1201", "t0-bert", Snap.Now.AddMinutes(30)));
        var unexpected = PrivilegedEvaluator.Unexpected(data, config);
        Assert.DoesNotContain(unexpected, u => u.MemberSid.EndsWith("-1201"));
        Assert.Contains(unexpected, u => u.MemberSid.EndsWith("-1666"));   // other members are still flagged
        Assert.StartsWith("Erwartet (JIT bis ", PrivilegedEvaluator.IsExpected(data.Groups[0], alice, config));
        // Nested through the JIT group into Domain Admins: matched by the "via" path.
        Assert.StartsWith("Erwartet (JIT bis ", PrivilegedEvaluator.IsExpected(data.Groups[1], nested, config));
        // Same member in another group without a grant is not covered.
        var other = Snap.G("-519", "Organisations-Admins", "Enterprise Admins", alice);
        Assert.Null(PrivilegedEvaluator.IsExpected(other, alice, config));
    }

    [Fact]
    public void Jit_events_have_channel_flags_and_siem_ids()
    {
        var c = new NotificationChannel { Name = "x", TargetProtected = "", TargetDisplay = "", OnJitRequested = true };
        Assert.True(NotificationService.Wants(c, NotificationEvent.JitRequested));
        Assert.False(NotificationService.Wants(c, NotificationEvent.JitGranted));
        var r = new JitRequest
        {
            Id = 7, RequestedBy = "op1", MemberAccount = "op1", Group = "G", GroupDisplayName = "Gruppe", Justification = "Change 1", Minutes = 60,
            ApprovalRequired = true, ExpiresAt = DateTimeOffset.UtcNow.AddHours(1),
        };
        var requested = JitService.RequestedMessage(r, "https://tm.contoso.com");
        Assert.Equal(NotificationEvent.JitRequested, requested.Event);
        Assert.Equal("https://tm.contoso.com/zugriff", requested.Url);
        Assert.Equal(SiemEvents.JitRequested, SiemEvents.FromMessage(requested).EventId);
        Assert.Equal(SiemEvents.JitGranted, SiemEvents.FromMessage(JitService.GrantedMessage(r, "")).EventId);
    }
}

[Collection("api")]
public class JitApiTests(ApiFixture fixture)
{
    private const string Dc = "dc01.contoso.local";

    private async Task<HttpClient> LoginAsync(string user = ApiFixture.AdminUser, string password = ApiFixture.AdminPassword)
    {
        var client = fixture.Factory!.CreateClient();
        client.DefaultRequestHeaders.Add(TestClientAddressFilter.Header, $"10.6.{Random.Shared.Next(0, 255)}.{Random.Shared.Next(2, 250)}");
        PlanApiTests.SetXsrf(client, await client.GetAsync("/api/auth/me"));
        var response = await client.PostAsJsonAsync("/api/auth/login", new { username = user, password });
        response.EnsureSuccessStatusCode();
        PlanApiTests.SetXsrf(client, response);
        return client;
    }

    private async Task<(HttpClient Client, string Name)> UserAsync(string role)
    {
        var admin = await LoginAsync();
        var name = $"{role.ToLowerInvariant()}-{Guid.NewGuid().ToString("N")[..6]}";
        (await admin.PostAsJsonAsync("/api/users", new { username = name, displayName = name, role, password = "Initial-Password-1" })).EnsureSuccessStatusCode();
        var client = await LoginAsync(name, "Initial-Password-1");
        var changed = await client.PostAsJsonAsync("/api/auth/change-password", new { currentPassword = "Initial-Password-1", newPassword = "Changed-Password-2" });
        Assert.Equal(HttpStatusCode.NoContent, changed.StatusCode);
        PlanApiTests.SetXsrf(client, changed);
        return (client, name);
    }

    private static async Task<long> CreateGroupAsync(HttpClient admin, int maxMinutes = 60, bool approval = true, string minimumRole = "Operator", string[]? users = null)
    {
        var name = "JitTest-" + Guid.NewGuid().ToString("N")[..8];
        var r = await admin.PostAsJsonAsync("/api/jit/groups", new
        {
            group = name, displayName = name + " (Tier 0)", tier = 0, maxMinutes, requiresApproval = approval, minimumRole, eligibleUsers = users ?? [],
        });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return (await r.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<long>();
    }

    private async Task EnsurePrerequisiteAsync(HttpClient admin, string dc = Dc)
    {
        var r = await admin.PostAsJsonAsync("/api/jit/prerequisite/check", new { preferredDc = dc });
        Assert.Equal(HttpStatusCode.Accepted, r.StatusCode);
        var runId = (await r.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<long>();
        for (var i = 0; i < 80; i++)
        {
            var run = await admin.GetFromJsonAsync<JsonObject>($"/api/runs/{runId}");
            if (run!["status"]!.GetValue<string>() is "Succeeded" or "Failed") return;
            await Task.Delay(250);
        }
        Assert.Fail("Prerequisite check did not finish");
    }

    private static async Task<JsonObject> RequestAsync(HttpClient client, long id)
    {
        var all = await client.GetFromJsonAsync<JsonArray>("/api/jit/requests");
        return all!.OfType<JsonObject>().Single(r => r["id"]!.GetValue<long>() == id);
    }

    private static async Task<JsonObject> WaitForStatusAsync(HttpClient client, long id, params string[] statuses)
    {
        JsonObject r = null!;
        for (var i = 0; i < 80; i++)
        {
            r = await RequestAsync(client, id);
            if (statuses.Contains(r["status"]!.GetValue<string>()) && r["revokeRunId"] is null) return r;
            await Task.Delay(250);
        }
        return r;
    }

    [DbFact]
    public async Task Anonymous_and_low_roles_are_rejected()
    {
        var anonymous = fixture.Factory!.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/jit/overview")).StatusCode);
        var (editor, _) = await UserAsync("Editor");
        Assert.Equal(HttpStatusCode.OK, (await editor.GetAsync("/api/jit/overview")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await editor.GetAsync("/api/jit/groups")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await editor.GetAsync("/api/jit/lookup/accounts?q=a")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await editor.PostAsJsonAsync("/api/jit/prerequisite/check", new { preferredDc = Dc })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await editor.PostAsJsonAsync("/api/jit/requests/1/approve", new { })).StatusCode);
        var (op, _) = await UserAsync("Operator");
        Assert.Equal(HttpStatusCode.Forbidden, (await op.PostAsJsonAsync("/api/jit/groups", new { group = "x", maxMinutes = 60 })).StatusCode);
    }

    [DbFact]
    public async Task Requests_are_validated()
    {
        var admin = await LoginAsync();
        await EnsurePrerequisiteAsync(admin);
        var groupId = await CreateGroupAsync(admin, maxMinutes: 60);
        var (op, opName) = await UserAsync("Operator");
        var (editor, _) = await UserAsync("Editor");

        var tooLong = await op.PostAsJsonAsync("/api/jit/requests", new { groupId, minutes = 120, justification = "Change 4711" });
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
        Assert.Contains("minutes", (await tooLong.Content.ReadAsStringAsync()));
        var noReason = await op.PostAsJsonAsync("/api/jit/requests", new { groupId, minutes = 30, justification = " " });
        Assert.Equal(HttpStatusCode.BadRequest, noReason.StatusCode);
        Assert.Contains("justification", (await noReason.Content.ReadAsStringAsync()));
        // Editors are below the minimum role of the group.
        Assert.Equal(HttpStatusCode.Forbidden, (await editor.PostAsJsonAsync("/api/jit/requests", new { groupId, minutes = 30, justification = "Change 4711" })).StatusCode);
        // Only administrators may request access for another account.
        Assert.Equal(HttpStatusCode.Forbidden, (await op.PostAsJsonAsync("/api/jit/requests", new { groupId, minutes = 30, justification = "Change 4711", memberAccount = "t0-alice" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/jit/requests", new { groupId, minutes = 30, justification = "Change 4711", memberAccount = "x' -or 1" })).StatusCode);
        // Group restricted to other users.
        var restricted = await CreateGroupAsync(admin, users: ["someone-else"]);
        Assert.Equal(HttpStatusCode.Forbidden, (await op.PostAsJsonAsync("/api/jit/requests", new { groupId = restricted, minutes = 30, justification = "Change 4711" })).StatusCode);
        var overview = await op.GetFromJsonAsync<JsonObject>("/api/jit/overview");
        Assert.DoesNotContain(overview!["groups"]!.AsArray(), g => g!["id"]!.GetValue<long>() == restricted);
        Assert.Equal(opName, overview["defaultMemberAccount"]!.GetValue<string>());
        Assert.False(overview["canChooseMember"]!.GetValue<bool>());

        // Valid request; a second open request for the same account and group is refused.
        var ok = await op.PostAsJsonAsync("/api/jit/requests", new { groupId, minutes = 30, justification = "Change 4711" });
        Assert.Equal(HttpStatusCode.Created, ok.StatusCode);
        var created = (await ok.Content.ReadFromJsonAsync<JsonObject>())!;
        Assert.Equal("Pending", created["status"]!.GetValue<string>());
        Assert.Equal(opName, created["memberAccount"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.Conflict, (await op.PostAsJsonAsync("/api/jit/requests", new { groupId, minutes = 15, justification = "Change 4712" })).StatusCode);
        // Withdraw: only the requester, only while pending.
        var id = created["id"]!.GetValue<long>();
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostAsync($"/api/jit/requests/{id}/withdraw", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await op.PostAsync($"/api/jit/requests/{id}/withdraw", null)).StatusCode);
        Assert.Equal("Cancelled", (await RequestAsync(op, id))["status"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.Conflict, (await op.PostAsync($"/api/jit/requests/{id}/withdraw", null)).StatusCode);
    }

    [DbFact]
    public async Task Four_eyes_grant_and_early_revoke_run_through_jit_runs_and_ignore_freezes()
    {
        var admin = await LoginAsync();
        await EnsurePrerequisiteAsync(admin);
        var groupId = await CreateGroupAsync(admin, maxMinutes: 120);
        var (op1, op1Name) = await UserAsync("Operator");
        var (op2, op2Name) = await UserAsync("Operator");
        var (viewer, _) = await UserAsync("Viewer");

        var created = await op1.PostAsJsonAsync("/api/jit/requests", new { groupId, minutes = 60, justification = "CHG-1: Zertifikatsvorlage" });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var id = (await created.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<long>();

        // The requester cannot approve; others see the request, viewers do not.
        Assert.Equal(HttpStatusCode.Forbidden, (await op1.PostAsJsonAsync($"/api/jit/requests/{id}/approve", new { })).StatusCode);
        Assert.True((await RequestAsync(op2, id))["canDecide"]!.GetValue<bool>());
        Assert.False((await RequestAsync(op1, id))["canDecide"]!.GetValue<bool>());
        Assert.DoesNotContain((await viewer.GetFromJsonAsync<JsonArray>("/api/jit/requests"))!, r => r!["id"]!.GetValue<long>() == id);

        // A change freeze stops applies but never JIT (maintenance windows do not restrict JIT).
        long freezeId;
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var freeze = new FreezePeriod { From = DateTimeOffset.UtcNow.AddMinutes(-5), To = DateTimeOffset.UtcNow.AddHours(1), Reason = "JIT-Test", CreatedBy = "test", CreatedAt = DateTimeOffset.UtcNow };
            db.FreezePeriods.Add(freeze);
            await db.SaveChangesAsync();
            freezeId = freeze.Id;
        }
        try
        {
            var approved = await op2.PostAsJsonAsync($"/api/jit/requests/{id}/approve", new { comment = "CHG-1 geprüft" });
            Assert.Equal(HttpStatusCode.OK, approved.StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsJsonAsync($"/api/jit/requests/{id}/approve", new { })).StatusCode);

            var active = await WaitForStatusAsync(op1, id, "Active", "Failed");
            Assert.Equal("Active", active["status"]!.GetValue<string>());
            Assert.Equal(op2Name, active["decidedBy"]!.GetValue<string>());
            var expires = DateTimeOffset.Parse(active["expiresAt"]!.GetValue<string>());
            Assert.InRange(expires, DateTimeOffset.UtcNow.AddMinutes(55), DateTimeOffset.UtcNow.AddMinutes(61));
            Assert.True(active["canRevoke"]!.GetValue<bool>());

            var runId = active["runId"]!.GetValue<long>();
            var run = await admin.GetFromJsonAsync<JsonObject>($"/api/runs/{runId}");
            Assert.Equal("Jit", run!["kind"]!.GetValue<string>());
            Assert.Equal("Grant", run["jitAction"]!.GetValue<string>());
            Assert.Equal("Succeeded", run["status"]!.GetValue<string>());
            Assert.Equal(op2Name, run["approvedBy"]!.GetValue<string>());

            await using var scope = fixture.Factory!.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var stored = await db.JitRequests.AsNoTracking().SingleAsync(r => r.Id == id);
            Assert.StartsWith("S-1-5-21-", stored.MemberSid);
            Assert.StartsWith("S-1-5-21-", stored.GroupSid);
            // The group now knows its SID for the monitoring match, and the grant is expected right now.
            Assert.Equal(stored.GroupSid, (await db.JitGroups.AsNoTracking().SingleAsync(g => g.Id == groupId)).GroupSid);
            Assert.Contains(await JitService.ExpectationsAsync(db, DateTimeOffset.UtcNow), e => e.MemberSid == stored.MemberSid && e.GroupSid == stored.GroupSid);
        }
        finally
        {
            await using var scope = fixture.Factory!.Services.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<AppDbContext>().FreezePeriods.Where(f => f.Id == freezeId).ExecuteDeleteAsync();
        }

        // Viewers cannot revoke other people's access; the requester can.
        Assert.Equal(HttpStatusCode.Forbidden, (await viewer.PostAsync($"/api/jit/requests/{id}/revoke", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await op1.PostAsync($"/api/jit/requests/{id}/revoke", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await op2.PostAsync($"/api/jit/requests/{id}/revoke", null)).StatusCode);
        var revoked = await WaitForStatusAsync(op1, id, "Revoked");
        Assert.Equal("Revoked", revoked["status"]!.GetValue<string>());
        Assert.Equal(op1Name, revoked["revokedBy"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.Conflict, (await op1.PostAsync($"/api/jit/requests/{id}/revoke", null)).StatusCode);

        // Every step is in the change log.
        var log = await admin.GetFromJsonAsync<JsonObject>("/api/changelog?entityType=jit&pageSize=200");
        var actions = log!["items"]!.AsArray().Where(e => e!["entityId"]?.GetValue<string>() == id.ToString()).Select(e => e!["action"]!.GetValue<string>()).ToList();
        Assert.Contains("jit.request", actions);
        Assert.Contains("jit.approve", actions);
        Assert.Contains("jit.grant", actions);
        Assert.Contains("jit.revoke-request", actions);
        Assert.Contains("jit.revoke", actions);
    }

    [DbFact]
    public async Task Rejection_needs_a_reason_and_groups_without_approval_are_granted_directly()
    {
        var admin = await LoginAsync();
        await EnsurePrerequisiteAsync(admin);
        var (op1, _) = await UserAsync("Operator");
        var withApproval = await CreateGroupAsync(admin);
        var id = (await (await op1.PostAsJsonAsync("/api/jit/requests", new { groupId = withApproval, minutes = 30, justification = "Change 1" }))
            .Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<long>();
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"/api/jit/requests/{id}/reject", new { comment = "" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/jit/requests/{id}/reject", new { comment = "Kein Change" })).StatusCode);
        var rejected = await RequestAsync(op1, id);
        Assert.Equal("Rejected", rejected["status"]!.GetValue<string>());
        Assert.Equal("Kein Change", rejected["decisionComment"]!.GetValue<string>());
        Assert.Null(rejected["runId"]);

        var direct = await CreateGroupAsync(admin, approval: false);
        var created = await op1.PostAsJsonAsync("/api/jit/requests", new { groupId = direct, minutes = 15, justification = "Notfall" });
        var directId = (await created.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<long>();
        var active = await WaitForStatusAsync(op1, directId, "Active", "Failed");
        Assert.Equal("Active", active["status"]!.GetValue<string>());
        Assert.Null(active["decidedBy"]);
    }

    [DbFact]
    public async Task Missing_prerequisite_blocks_requests_and_is_explained()
    {
        var admin = await LoginAsync();
        var groupId = await CreateGroupAsync(admin);
        try
        {
            await EnsurePrerequisiteAsync(admin, "dc-nopam.contoso.local");
            var overview = await admin.GetFromJsonAsync<JsonObject>("/api/jit/overview");
            var p = overview!["prerequisite"]!;
            Assert.Equal("NotReady", p["status"]!.GetValue<string>());
            Assert.False(p["pamEnabled"]!.GetValue<bool>());
            Assert.Contains(p["messages"]!.AsArray(), m => m!.GetValue<string>().Contains("irreversible"));
            var r = await admin.PostAsJsonAsync("/api/jit/requests", new { groupId, minutes = 30, justification = "Change 1", memberAccount = "t0-alice" });
            Assert.Equal(HttpStatusCode.Conflict, r.StatusCode);
            Assert.Contains("Privileged Access Management", await r.Content.ReadAsStringAsync());
        }
        finally
        {
            await EnsurePrerequisiteAsync(admin);
        }
        Assert.Equal("Ready", (await admin.GetFromJsonAsync<JsonObject>("/api/jit/overview"))!["prerequisite"]!["status"]!.GetValue<string>());
    }

    [DbFact]
    public async Task State_machine_expiry_and_notifications()
    {
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var db = sp.GetRequiredService<AppDbContext>();
        var queue = new NotificationQueue();
        var jit = ActivatorUtilities.CreateInstance<JitService>(sp, queue);
        var admin = await LoginAsync();
        await EnsurePrerequisiteAsync(admin);
        var groupId = await CreateGroupAsync(admin);
        var user = await db.Users.AsNoTracking().SingleAsync(u => u.Username == ApiFixture.AdminUser);

        // Request → JitRequested notification.
        var (request, errors, problem) = await jit.CreateAsync(user, Role.Admin, new JitRequestInput(groupId, 30, "Change 99", "t0-carol"));
        Assert.Null(errors);
        Assert.Null(problem);
        Assert.True(queue.Reader.TryRead(out var n1));
        Assert.Equal(NotificationEvent.JitRequested, n1!.Message!.Event);

        // Own approval is refused; a decision by someone else starts the grant run.
        Assert.Equal(JitOutcome.OwnRequest, (await jit.DecideAsync(request!.Id, true, ApiFixture.AdminUser, Role.Admin, null)).Item1);
        Assert.Equal(JitOutcome.Forbidden, (await jit.DecideAsync(request.Id, true, "editor-x", Role.Editor, null)).Item1);
        var (outcome, approved) = await jit.DecideAsync(request.Id, true, "second-op", Role.Operator, "ok");
        Assert.Equal(JitOutcome.Done, outcome);
        Assert.Equal(JitStatus.Approved, approved!.Status);
        Assert.NotNull(approved.RunId);

        // The worker's result → Active + JitGranted notification (the real run may already have done it: then the state is the same).
        var run = await db.Runs.AsNoTracking().SingleAsync(r => r.Id == approved.RunId);
        for (var i = 0; i < 80 && (await db.JitRequests.AsNoTracking().SingleAsync(r => r.Id == request.Id)).Status == JitStatus.Approved; i++) await Task.Delay(250);
        var afterRun = await db.JitRequests.AsNoTracking().SingleAsync(r => r.Id == request.Id);
        Assert.Equal(JitStatus.Active, afterRun.Status);
        // Processing the same run again changes nothing (idempotent).
        run.Status = RunStatus.Succeeded;
        await jit.CompleteRunAsync(run, JitRunResult.Parse("""{ "success": true, "expiresAt": "2030-01-01T00:00:00Z" }"""));
        Assert.Equal(afterRun.ExpiresAt, (await db.JitRequests.AsNoTracking().SingleAsync(r => r.Id == request.Id)).ExpiresAt);

        // A grant result processed by this service instance enqueues JitGranted.
        var manual = new JitRequest
        {
            RequestedBy = "op", MemberAccount = "t0-dora", JitGroupId = groupId, Group = "G", GroupDisplayName = "G", Minutes = 15, Justification = "x",
            Status = JitStatus.Approved, RequestedAt = DateTimeOffset.UtcNow,
        };
        db.JitRequests.Add(manual);
        await db.SaveChangesAsync();
        static Run FakeRun(long requestId, RunStatus status) => new()
        {
            Kind = RunKind.Jit, JitAction = JitAction.Grant, JitRequestId = requestId, Status = status, PreferredDc = Dc,
            AdmlLanguage = "en-US", RequestedBy = "op", FinishedAt = DateTimeOffset.UtcNow,
        };
        var fakeRun = FakeRun(manual.Id, RunStatus.Succeeded);
        await jit.CompleteRunAsync(fakeRun, JitRunResult.Parse("""{ "success": true, "sids": { "group": "S-1-5-21-9-9-9-1", "member": "S-1-5-21-9-9-9-2" }, "expiresAt": "2030-01-01T00:00:00Z" }"""));
        Assert.True(queue.Reader.TryRead(out var n2));
        Assert.Equal(NotificationEvent.JitGranted, n2!.Message!.Event);
        await db.Entry(manual).ReloadAsync();
        Assert.Equal(JitStatus.Active, manual.Status);
        Assert.Equal("S-1-5-21-9-9-9-2", manual.MemberSid);

        // A failed grant run → Failed with the script's error.
        var failing = new JitRequest
        {
            RequestedBy = "op", MemberAccount = "t0-erik", JitGroupId = groupId, Group = "G", GroupDisplayName = "G", Minutes = 15, Justification = "x",
            Status = JitStatus.Approved, RequestedAt = DateTimeOffset.UtcNow,
        };
        db.JitRequests.Add(failing);
        await db.SaveChangesAsync();
        await jit.CompleteRunAsync(FakeRun(failing.Id, RunStatus.Failed),
            JitRunResult.Parse("""{ "success": false, "error": "Insufficient access rights" }"""));
        await db.Entry(failing).ReloadAsync();
        Assert.Equal(JitStatus.Failed, failing.Status);
        Assert.Equal("Insufficient access rights", failing.Message);

        // Expiry: elapsed memberships → Expired, overdue approvals → Rejected.
        var elapsed = new JitRequest
        {
            RequestedBy = "op", MemberAccount = "t0-fritz", JitGroupId = groupId, Group = "G", GroupDisplayName = "G", Minutes = 15, Justification = "x",
            Status = JitStatus.Active, RequestedAt = DateTimeOffset.UtcNow.AddHours(-1), GrantedAt = DateTimeOffset.UtcNow.AddMinutes(-20),
            ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-5),
        };
        var overdue = new JitRequest
        {
            RequestedBy = "op", MemberAccount = "t0-gert", JitGroupId = groupId, Group = "G", GroupDisplayName = "G", Minutes = 15, Justification = "x",
            Status = JitStatus.Pending, ApprovalRequired = true, RequestedAt = DateTimeOffset.UtcNow.AddDays(-2), ApprovalExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1),
        };
        db.JitRequests.AddRange(elapsed, overdue);
        await db.SaveChangesAsync();
        await jit.MaintainAsync(DateTimeOffset.UtcNow);
        await db.Entry(elapsed).ReloadAsync();
        await db.Entry(overdue).ReloadAsync();
        Assert.Equal(JitStatus.Expired, elapsed.Status);
        Assert.Equal(JitStatus.Rejected, overdue.Status);
        Assert.True(await db.ChangeLog.AnyAsync(c => c.Action == "jit.expire" && c.EntityId == elapsed.Id.ToString()));
        // An expired grant is still expected for snapshots taken while it was active, but not afterwards.
        Assert.Contains(await JitService.ExpectationsAsync(db, DateTimeOffset.UtcNow.AddMinutes(-10)), e => e.MemberAccount == "t0-fritz");
        Assert.DoesNotContain(await JitService.ExpectationsAsync(db, DateTimeOffset.UtcNow), e => e.MemberAccount == "t0-fritz");

        // Approved request whose run was cancelled before it started → Failed.
        var cancelledRun = new Run { Kind = RunKind.Jit, JitAction = JitAction.Grant, Status = RunStatus.Cancelled, PreferredDc = Dc, AdmlLanguage = "en-US",
            RequestedBy = "op", CreatedAt = DateTimeOffset.UtcNow, Message = "Vor dem Start abgebrochen" };
        db.Runs.Add(cancelledRun);
        await db.SaveChangesAsync();
        var stuck = new JitRequest
        {
            RequestedBy = "op", MemberAccount = "t0-hans", JitGroupId = groupId, Group = "G", GroupDisplayName = "G", Minutes = 15, Justification = "x",
            Status = JitStatus.Approved, RequestedAt = DateTimeOffset.UtcNow, RunId = cancelledRun.Id,
        };
        db.JitRequests.Add(stuck);
        await db.SaveChangesAsync();
        await jit.MaintainAsync(DateTimeOffset.UtcNow);
        await db.Entry(stuck).ReloadAsync();
        Assert.Equal(JitStatus.Failed, stuck.Status);
    }

    [DbFact]
    public async Task Jit_groups_can_be_managed_by_admins()
    {
        var admin = await LoginAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/jit/groups", new { group = "bad;name", maxMinutes = 60, requiresApproval = true })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/jit/groups", new { group = "Tier0Admins-x", maxMinutes = 5000, requiresApproval = true })).StatusCode);
        var id = await CreateGroupAsync(admin);
        var list = await admin.GetFromJsonAsync<JsonArray>("/api/jit/groups");
        var g = list!.OfType<JsonObject>().Single(x => x["id"]!.GetValue<long>() == id);
        Assert.Equal("Operator", g["minimumRole"]!.GetValue<string>());
        Assert.Equal(0, g["tier"]!.GetValue<int>());
        var name = g["group"]!.GetValue<string>();
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/jit/groups", new { group = name, maxMinutes = 60, requiresApproval = true })).StatusCode);
        var updated = await admin.PutAsJsonAsync($"/api/jit/groups/{id}", new { group = name, displayName = "Neu", tier = 1, maxMinutes = 240, requiresApproval = false, minimumRole = "Editor", eligibleUsers = new[] { "a", "A" }, enabled = false });
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        var u = (await updated.Content.ReadFromJsonAsync<JsonObject>())!;
        Assert.Equal(240, u["maxMinutes"]!.GetValue<int>());
        Assert.Single(u["eligibleUsers"]!.AsArray());
        Assert.False(u["enabled"]!.GetValue<bool>());
        var candidates = await admin.GetFromJsonAsync<JsonArray>("/api/jit/lookup/groups?q=tier0");
        Assert.Contains(candidates!, c => c!["group"]!.GetValue<string>() == "Tier0Admins");
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/jit/groups/{id}")).StatusCode);
    }
}
