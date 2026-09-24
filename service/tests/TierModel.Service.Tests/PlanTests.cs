using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using TierModel.Service.Data;
using TierModel.Service.Notifications;
using TierModel.Service.Runs;

namespace TierModel.Service.Tests;

public class DeployPlanReaderTests
{
    private const string WellFormed = """
        {
          "Metadata": { "Version": "1", "Scope": "FullDeployment", "PreferredDc": "dc01.contoso.local", "Timestamp": "2026-09-24T10:00:00Z", "Includes": ["Msa"] },
          "Summary": { "TotalActions": 4, "Create": 2, "Update": 0, "Link": 1, "Configure": 1, "Existing": 30 },
          "Phases": [ { "Phase": 5, "Name": "Group Policy Objects", "Area": "gpos", "ActionCount": 1, "ExistingCount": 3 },
                      { "Phase": 1, "Name": "Organizational Units", "Area": "ous", "ActionCount": 1, "ExistingCount": 12 } ],
          "Actions": [
            { "Phase": 1, "Area": "OUs", "Action": "CreateOU", "ResourceType": "OrganizationalUnit", "Name": "Tier 1 Servers", "Path": "OU=Tier 1,DC=contoso,DC=local",
              "Details": { "protectFromAccidentalDeletion": true, "linkOrder": 2, "ratio": 1.5, "rights": ["CreateChild", "DeleteChild"], "nested": { "a": 1 }, "nothing": null } },
            { "Phase": 2, "Area": "groups", "Action": "CreateGroup", "ResourceType": "Group", "Name": "Tier1Admins" },
            { "Phase": 5, "Area": "gpos", "Action": "LinkGPO", "ResourceType": "GPLink", "Name": "Baseline", "Path": "DC=contoso,DC=local" },
            { "Phase": 7, "Area": "winlaps", "Action": "ConfigureLapsDecryptor", "ResourceType": "GroupPolicy", "Name": "LAPS" }
          ],
          "Warnings": ["Unerwarteter ACE"],
          "Errors": []
        }
        """;

    [Fact]
    public void Well_formed_plan_is_normalised()
    {
        var plan = DeployPlanReader.Parse(WellFormed);
        Assert.Equal("FullDeployment", plan.Metadata.Scope);
        Assert.Equal(["Msa"], plan.Metadata.Includes);
        Assert.Equal(4, plan.Summary.TotalActions);
        Assert.Equal(2, plan.Summary.Create);
        Assert.Equal([1, 5], plan.Phases.Select(p => p.Phase));
        Assert.Equal(4, plan.Actions.Count);
        Assert.False(plan.Truncated);

        var ou = plan.Actions[0];
        Assert.Equal("ous", ou.Area);
        Assert.Equal("CreateOU", ou.Action);
        Assert.Equal("OU=Tier 1,DC=contoso,DC=local", ou.Path);
        Assert.Equal(true, ou.Details!["protectFromAccidentalDeletion"]);
        Assert.Equal(2L, Convert.ToInt64(ou.Details["linkOrder"]));
        Assert.Equal(1.5, ou.Details["ratio"]);
        Assert.Equal(new[] { "CreateChild", "DeleteChild" }, ou.Details["rights"]);
        Assert.Equal("a: 1", ou.Details["nested"]);             // nested objects become readable text
        Assert.False(ou.Details.ContainsKey("nothing"));

        Assert.Equal(1, plan.ActionCounts["LinkGPO"]);
        Assert.Equal(["Unerwarteter ACE"], plan.Warnings);
        Assert.Equal(4, DeployPlanReader.TotalChanges(plan));
        Assert.Equal("Planung abgeschlossen: 4 Änderungen", RunWorker.PlanMessage(plan));

        // Round trip through the stored form.
        var stored = DeployPlanReader.Deserialize(DeployPlanReader.Serialize(plan))!;
        Assert.Equal(4, stored.Actions.Count);
        Assert.Equal("Tier 1 Servers", stored.Actions[0].Name);
    }

    [Fact]
    public void Minimal_plan_without_summary_counts_actions()
    {
        var plan = DeployPlanReader.Parse("""{ "actions": { "action": "CreateGroup", "area": "groups", "name": "G1" }, "errors": "kaputt" }""");
        Assert.Single(plan.Actions);
        Assert.Equal(1, plan.Summary.TotalActions);
        Assert.Equal(1, plan.Summary.Create);
        Assert.Empty(plan.Phases);
        Assert.Equal(["kaputt"], plan.Errors);
        Assert.Equal("", plan.Actions[0].ResourceType);
    }

    [Fact]
    public void Empty_plan_means_nothing_to_do() =>
        Assert.Equal("Planung abgeschlossen: keine Änderungen nötig",
            RunWorker.PlanMessage(DeployPlanReader.Parse("""{ "summary": { "totalActions": 0 }, "actions": [] }""")));

    [Fact]
    public void Large_plans_are_truncated_but_counted()
    {
        var actions = new JsonArray(Enumerable.Range(0, 12).Select(i => (JsonNode)new JsonObject { ["action"] = i % 2 == 0 ? "CreateOU" : "LinkGPO", ["name"] = $"x{i}" }).ToArray());
        var plan = DeployPlanReader.Parse(new JsonObject { ["actions"] = actions }.ToJsonString(), maxActions: 5);
        Assert.True(plan.Truncated);
        Assert.Equal(5, plan.Actions.Count);
        Assert.Equal(12, plan.Summary.TotalActions);
        Assert.Equal(6, plan.ActionCounts["CreateOU"]);
        Assert.Equal(6, plan.ActionCounts["LinkGPO"]);
    }

    [Theory]
    [InlineData("{ \"metadata\": { \"version\": \"1\", ")]
    [InlineData("[1, 2, 3]")]
    [InlineData("\"text\"")]
    public void Malformed_plan_throws_json_exception(string json) =>
        Assert.ThrowsAny<JsonException>(() => DeployPlanReader.Parse(json));

    [Fact]
    public void Worker_tolerates_missing_and_malformed_plan_files()
    {
        var dir = Directory.CreateTempSubdirectory("tm-plan-").FullName;
        try
        {
            Directory.CreateDirectory(Path.Combine(dir, "out"));
            var run = new Run { Kind = RunKind.Deploy, Mode = RunMode.Plan, PreferredDc = "dc01", AdmlLanguage = "en-US", RequestedBy = "t" };
            var log = new List<(string Text, string Level)>();

            Assert.Null(RunWorker.ReadDeployPlan(run, dir, (t, l) => log.Add((t, l))));
            Assert.Contains(log, l => l.Level == "warn" && l.Text.Contains("Keine Plandatei"));
            Assert.Null(run.Plan);

            File.WriteAllText(Path.Combine(dir, "out", DeployPlanReader.FileName), "{ kaputt");
            Assert.Null(RunWorker.ReadDeployPlan(run, dir, (t, l) => log.Add((t, l))));
            Assert.Contains(log, l => l.Level == "warn" && l.Text.Contains("nicht gelesen"));
            Assert.Null(run.Plan);

            File.WriteAllText(Path.Combine(dir, "out", DeployPlanReader.FileName), WellFormed);
            Assert.NotNull(RunWorker.ReadDeployPlan(run, dir, (t, l) => log.Add((t, l))));
            Assert.NotNull(DeployPlanReader.Deserialize(run.Plan));
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void Approval_notification_contains_the_plan_counts()
    {
        var run = new Run
        {
            Id = 9, Kind = RunKind.Deploy, Mode = RunMode.Apply, Status = RunStatus.AwaitingApproval, Scope = DeployScope.FullDeployment,
            PreferredDc = "dc01", AdmlLanguage = "en-US", RequestedBy = "alice", PlanRunId = 8,
        };
        var m = NotificationService.BuildMessage(NotificationEvent.ApprovalRequested, run, "", DeployPlanReader.Parse(WellFormed));
        var fact = m.Facts.Single(f => f.Label == "Geplante Änderungen").Value;
        Assert.Equal("2 anlegen, 1 verknüpfen, 1 konfigurieren (Planung #8)", fact);
    }
}

public class PlanGateTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 24, 12, 0, 0, TimeSpan.Zero);
    private static readonly Dictionary<string, int> Current = new() { ["ous"] = 3, ["groups"] = 5 };

    private static Run Plan(Action<Run>? change = null)
    {
        var r = new Run
        {
            Id = 42, Kind = RunKind.Deploy, Mode = RunMode.Plan, Status = RunStatus.Succeeded, Scope = DeployScope.OuOnly,
            PreferredDc = "DC01.contoso.local", AdmlLanguage = "en-US", RequestedBy = "alice",
            CreatedAt = Now.AddHours(-2), FinishedAt = Now.AddHours(-1), ConfigVersions = """{"ous":3,"groups":5}""",
        };
        change?.Invoke(r);
        return r;
    }

    private static PlanGate.Target Target(DeployScope? scope = DeployScope.OuOnly, string dc = "dc01.contoso.local", string lang = "en-US", bool msa = false) =>
        new(scope, msa, false, false, false, dc, lang);

    [Fact]
    public void Matching_plan_is_accepted_and_dc_is_case_insensitive() =>
        Assert.Null(PlanGate.Check(Plan(), Target(), Current, Now, 24));

    [Fact]
    public void Target_resolves_the_default_language() =>
        Assert.Null(PlanGate.Check(Plan(), PlanGate.From(new RunRequest(" dc01.contoso.local ", DeployScope.OuOnly, false, false, false, false, null), "en-US"), Current, Now, 24));

    [Fact]
    public void Missing_plan_is_rejected() => Assert.Contains("existiert nicht", PlanGate.Check(null, Target(), Current, Now, 24));

    [Fact]
    public void Other_scope_is_rejected() => Assert.Contains("anderen Bereich", PlanGate.Check(Plan(), Target(DeployScope.GroupOnly), Current, Now, 24));

    [Fact]
    public void Other_addons_are_rejected() => Assert.Contains("Add-ons", PlanGate.Check(Plan(), Target(msa: true), Current, Now, 24));

    [Fact]
    public void Other_dc_is_rejected() => Assert.Contains("Domain Controller", PlanGate.Check(Plan(), Target(dc: "dc02.contoso.local"), Current, Now, 24));

    [Fact]
    public void Other_language_is_rejected() => Assert.Contains("ADML", PlanGate.Check(Plan(), Target(lang: "de-DE"), Current, Now, 24));

    [Fact]
    public void Changed_configuration_is_rejected()
    {
        var error = PlanGate.Check(Plan(), Target(), new Dictionary<string, int> { ["ous"] = 4, ["groups"] = 5 }, Now, 24);
        Assert.Contains("Organisationseinheiten", error);
        Assert.Contains("neu planen", error);
    }

    [Fact]
    public void New_section_counts_as_a_change() =>
        Assert.NotNull(PlanGate.Check(Plan(), Target(), new Dictionary<string, int> { ["ous"] = 3, ["groups"] = 5, ["acls"] = 1 }, Now, 24));

    [Fact]
    public void Expired_plan_is_rejected()
    {
        Assert.Contains("älter als 24 Stunden", PlanGate.Check(Plan(r => r.FinishedAt = Now.AddHours(-25)), Target(), Current, Now, 24));
        Assert.Null(PlanGate.Check(Plan(r => r.FinishedAt = Now.AddHours(-25)), Target(), Current, Now, 48));
    }

    [Theory]
    [InlineData(RunStatus.Failed)]
    [InlineData(RunStatus.Running)]
    [InlineData(RunStatus.Cancelled)]
    public void Unsuccessful_plan_is_rejected(RunStatus status) =>
        Assert.Contains("nicht erfolgreich", PlanGate.Check(Plan(r => r.Status = status), Target(), Current, Now, 24));

    [Fact]
    public void Apply_or_audit_runs_are_no_plans()
    {
        Assert.Contains("kein Planungslauf", PlanGate.Check(Plan(r => r.Mode = RunMode.Apply), Target(), Current, Now, 24));
        Assert.Contains("kein Planungslauf", PlanGate.Check(Plan(r => { r.Kind = RunKind.Audit; r.Mode = null; }), Target(), Current, Now, 24));
    }
}

[Collection("api")]
public class PlanApiTests(ApiFixture fixture)
{
    // Logins are rate limited (10 per minute and address); all tests of this class share one admin session.
    private static Task<HttpClient>? _admin;
    private Task<HttpClient> AdminAsync() => _admin ??= LoginAsync(fixture, ApiFixture.AdminUser, ApiFixture.AdminPassword);

    internal static async Task<HttpClient> LoginAsync(ApiFixture fixture, string user, string password)
    {
        var client = fixture.Factory!.CreateClient();
        client.DefaultRequestHeaders.Add(TestClientAddressFilter.Header, "10.0.0." + Random.Shared.Next(2, 250));
        SetXsrf(client, await client.GetAsync("/api/auth/me"));
        var response = await client.PostAsJsonAsync("/api/auth/login", new { username = user, password });
        response.EnsureSuccessStatusCode();
        SetXsrf(client, response);
        return client;
    }

    internal static void SetXsrf(HttpClient client, HttpResponseMessage response)
    {
        var cookie = response.Headers.GetValues("Set-Cookie").First(c => c.StartsWith("XSRF-TOKEN="));
        client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        client.DefaultRequestHeaders.Add("X-XSRF-TOKEN", Uri.UnescapeDataString(cookie.Split(';')[0]["XSRF-TOKEN=".Length..]));
    }

    private static object Deploy(string scope, bool apply, long? planRunId = null, string dc = "dc01.contoso.local") => new
    {
        preferredDc = dc, scope, includeMsa = false, includeGmsa = false, includeDmsa = false, includeWinLaps = false, confirmApply = apply, planRunId,
    };

    private static async Task<JsonObject> WaitAsync(HttpClient client, long id)
    {
        JsonObject? run = null;
        for (var i = 0; i < 80; i++)
        {
            run = await client.GetFromJsonAsync<JsonObject>($"/api/runs/{id}");
            if (run!["status"]!.GetValue<string>() is "Succeeded" or "Failed" or "Cancelled") break;
            await Task.Delay(500);
        }
        return run!;
    }

    private static async Task<string> PlanRunIdError(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = (await response.Content.ReadFromJsonAsync<JsonObject>())!;
        return problem["errors"]!["planRunId"]![0]!.GetValue<string>();
    }

    [DbFact]
    public async Task Plan_run_stores_the_plan_and_gates_apply()
    {
        var admin = await AdminAsync();

        var planId = await PlanTests.RunPlanAsync(admin, "GposOnly");
        var plan = await admin.GetFromJsonAsync<JsonObject>($"/api/runs/{planId}");
        Assert.Equal("Planung abgeschlossen: 4 Änderungen", plan!["message"]!.GetValue<string>());
        Assert.Equal(4, plan["plan"]!["actions"]!.AsArray().Count);
        Assert.Equal("LinkGPO", plan["plan"]!["actions"]![2]!["action"]!.GetValue<string>());
        Assert.Equal(2, plan["plan"]!["actionCounts"]!["LinkGPO"]!.GetValue<int>());
        Assert.True(plan["planApplicability"]!["applicable"]!.GetValue<bool>());
        Assert.Equal(4, (await admin.GetFromJsonAsync<JsonObject>($"/api/runs/{planId}/plan"))!["actions"]!.AsArray().Count);

        // Without a plan run id apply is refused.
        Assert.Contains("nur nach einer geprüften Planung", await PlanRunIdError(await admin.PostAsJsonAsync("/api/runs/deploy", Deploy("GposOnly", true))));
        // Different scope or DC.
        Assert.Contains("anderen Bereich", await PlanRunIdError(await admin.PostAsJsonAsync("/api/runs/deploy", Deploy("OuOnly", true, planId))));
        Assert.Contains("Domain Controller", await PlanRunIdError(await admin.PostAsJsonAsync("/api/runs/deploy", Deploy("GposOnly", true, planId, "dc02.contoso.local"))));

        // The UI finds the plan as a candidate for the same parameters (DC in other case).
        var candidates = await admin.GetFromJsonAsync<JsonObject>("/api/runs/plan-candidates?preferredDc=DC01.contoso.local&scope=GposOnly");
        Assert.True(candidates!["requirePlan"]!.GetValue<bool>());
        Assert.Equal(planId, candidates["candidate"]!["id"]!.GetValue<long>());
        Assert.Equal(4, candidates["candidate"]!["changes"]!.GetValue<int>());
        var none = await admin.GetFromJsonAsync<JsonObject>("/api/runs/plan-candidates?preferredDc=dc09.contoso.local&scope=AdmxOnly");
        Assert.Null(none!["candidate"]);
        Assert.Contains("noch keinen Planungslauf", none["reason"]!.GetValue<string>());

        // Matching plan: the apply run refers to it and runs its configuration versions.
        var accepted = await admin.PostAsJsonAsync("/api/runs/deploy", Deploy("GposOnly", true, planId));
        Assert.Equal(HttpStatusCode.Accepted, accepted.StatusCode);
        var applyId = (await accepted.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<long>();
        var apply = await WaitAsync(admin, applyId);
        Assert.Equal("Succeeded", apply["status"]!.GetValue<string>());
        Assert.Equal(planId, apply["planRunId"]!.GetValue<long>());
        Assert.Equal(plan["configVersions"]!.ToJsonString(), apply["configVersions"]!.ToJsonString());
        Assert.Null(apply["plan"]);

        // An apply run is not a plan.
        Assert.Contains("kein Planungslauf", await PlanRunIdError(await admin.PostAsJsonAsync("/api/runs/deploy", Deploy("GposOnly", true, applyId))));

        // After a configuration change the plan no longer matches.
        var section = (await admin.GetFromJsonAsync<JsonObject>("/api/config/sections/acls"))!;
        var content = section["content"]!.AsObject();
        content["comment"] = "geändert nach der Planung " + Guid.NewGuid();
        (await admin.PutAsJsonAsync("/api/config/sections/acls", new { content, comment = "x", baseVersion = section["version"]!.GetValue<int>() })).EnsureSuccessStatusCode();
        Assert.Contains("seit Planung", await PlanRunIdError(await admin.PostAsJsonAsync("/api/runs/deploy", Deploy("GposOnly", true, planId))));
        var stale = await admin.GetFromJsonAsync<JsonObject>($"/api/runs/{planId}");
        Assert.False(stale!["planApplicability"]!["applicable"]!.GetValue<bool>());
        Assert.Contains("ACL-Delegationen", stale["planApplicability"]!["reason"]!.GetValue<string>());
    }

    [DbFact]
    public async Task Failed_expired_or_switched_off_plans()
    {
        var admin = await AdminAsync();

        // A plan run without a plan file still succeeds, but has no plan.
        var noPlan = await PlanTests.RunPlanAsync(admin, "UserOnly", "noplan.contoso.local");
        var detail = await admin.GetFromJsonAsync<JsonObject>($"/api/runs/{noPlan}");
        Assert.Null(detail!["plan"]);
        Assert.Equal("Planung abgeschlossen", detail["message"]!.GetValue<string>());
        var log = await admin.GetFromJsonAsync<JsonObject>($"/api/runs/{noPlan}/log?after=0");
        Assert.Contains(log!["lines"]!.AsArray(), l => l!["text"]!.GetValue<string>().Contains("Keine Plandatei"));

        var badPlan = await PlanTests.RunPlanAsync(admin, "UserOnly", "badplan.contoso.local");
        Assert.Null((await admin.GetFromJsonAsync<JsonObject>($"/api/runs/{badPlan}"))!["plan"]);

        // Expiry: a max age of 1 hour and a plan that finished 2 hours ago.
        var old = await PlanTests.RunPlanAsync(admin, "UserOnly");
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var run = await db.Runs.FindAsync(old);
            run!.FinishedAt = DateTimeOffset.UtcNow.AddHours(-2);
            await db.SaveChangesAsync();
        }
        await PutSettingsAsync(admin, requireApproval: false, requirePlan: true, maxAge: 1);
        Assert.Contains("älter als eine Stunde", await PlanRunIdError(await admin.PostAsJsonAsync("/api/runs/deploy", Deploy("UserOnly", true, old))));

        // Failed plan run.
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var run = await db.Runs.FindAsync(old);
            run!.FinishedAt = DateTimeOffset.UtcNow;
            run.Status = RunStatus.Failed;
            await db.SaveChangesAsync();
        }
        Assert.Contains("nicht erfolgreich", await PlanRunIdError(await admin.PostAsJsonAsync("/api/runs/deploy", Deploy("UserOnly", true, old))));

        // Switched off: apply without a plan is allowed again.
        await PutSettingsAsync(admin, requireApproval: false, requirePlan: false, maxAge: 24);
        var settings = await admin.GetFromJsonAsync<JsonObject>("/api/settings");
        Assert.False(settings!["requirePlanBeforeApply"]!.GetValue<bool>());
        var direct = await admin.PostAsJsonAsync("/api/runs/deploy", Deploy("UserOnly", true));
        Assert.Equal(HttpStatusCode.Accepted, direct.StatusCode);
        await WaitAsync(admin, (await direct.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<long>());

        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/settings", new
        {
            defaultPreferredDc = "dc01.contoso.local", admlLanguage = "en-US", runRetentionDays = 90, planMaxAgeHours = 0,
        })).StatusCode);
        await PutSettingsAsync(admin, requireApproval: false, requirePlan: true, maxAge: 24);
    }

    [DbFact]
    public async Task Approval_pins_the_versions_of_the_plan()
    {
        var admin = await AdminAsync();
        var planId = await PlanTests.RunPlanAsync(admin, "GroupOnly");
        var planVersions = (await admin.GetFromJsonAsync<JsonObject>($"/api/runs/{planId}"))!["configVersions"]!.ToJsonString();
        await PutSettingsAsync(admin, requireApproval: true, requirePlan: true, maxAge: 24);
        try
        {
            var submitted = await admin.PostAsJsonAsync("/api/runs/deploy", Deploy("GroupOnly", true, planId));
            Assert.Equal(HttpStatusCode.Accepted, submitted.StatusCode);
            var run = (await submitted.Content.ReadFromJsonAsync<JsonObject>())!;
            Assert.Equal("AwaitingApproval", run["status"]!.GetValue<string>());
            var detail = await admin.GetFromJsonAsync<JsonObject>($"/api/runs/{run["id"]!.GetValue<long>()}");
            Assert.Equal(planId, detail!["planRunId"]!.GetValue<long>());
            Assert.Equal(planVersions, detail["configVersions"]!.ToJsonString());
            (await admin.PostAsync($"/api/runs/{run["id"]!.GetValue<long>()}/cancel", null)).EnsureSuccessStatusCode();
        }
        finally
        {
            await PutSettingsAsync(admin, requireApproval: false, requirePlan: true, maxAge: 24);
        }
    }

    private static async Task PutSettingsAsync(HttpClient admin, bool requireApproval, bool requirePlan, int maxAge) =>
        (await admin.PutAsJsonAsync("/api/settings", new
        {
            defaultPreferredDc = "dc01.contoso.local", admlLanguage = "en-US", runRetentionDays = 90,
            requireApproval, approvalTimeoutHours = 24, publicBaseUrl = "", requirePlanBeforeApply = requirePlan, planMaxAgeHours = maxAge,
        })).EnsureSuccessStatusCode();

    [DbFact]
    public async Task Health_details_are_for_admins_only()
    {
        var anonymous = fixture.Factory!.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/health/details")).StatusCode);

        var admin = await AdminAsync();
        var health = await admin.GetFromJsonAsync<JsonObject>("/api/health/details");
        Assert.Contains(health!["status"]!.GetValue<string>(), new[] { "ok", "warn", "error" });
        Assert.False(string.IsNullOrEmpty(health["version"]!.GetValue<string>()));
        var items = health["items"]!.AsArray().Select(i => i!.AsObject()).ToList();
        var keys = items.Select(i => i["key"]!.GetValue<string>()).ToList();
        foreach (var key in new[] { "app", "certificate", "database", "queue", "lastRuns", "workPath", "pwsh", "framework", "workers", "dataProtection" })
            Assert.Contains(key, keys);
        foreach (var item in items)
        {
            Assert.Contains(item["status"]!.GetValue<string>(), new[] { "ok", "warn", "error" });
            Assert.False(string.IsNullOrWhiteSpace(item["message"]!.GetValue<string>()));
            Assert.All(item["facts"]!.AsArray(), f => Assert.NotNull(f!["label"]));
        }
        var db = items.Single(i => i["key"]!.GetValue<string>() == "database");
        Assert.Equal("ok", db["status"]!.GetValue<string>());
        Assert.Contains(db["facts"]!.AsArray(), f => f!["label"]!.GetValue<string>() == "Ausstehende Migrationen" && f["value"]!.GetValue<string>() == "0");
        var pwsh = items.Single(i => i["key"]!.GetValue<string>() == "pwsh");
        Assert.Equal("ok", pwsh["status"]!.GetValue<string>());   // fake-pwsh answers 7.4.6
        Assert.Equal("ok", items.Single(i => i["key"]!.GetValue<string>() == "framework")["status"]!.GetValue<string>());

        (await admin.PostAsJsonAsync("/api/users", new { username = "viewer-h", displayName = "V", role = "Viewer", password = "Viewer-Password-1" })).EnsureSuccessStatusCode();
        var viewer = await LoginAsync(fixture, "viewer-h", "Viewer-Password-1");
        Assert.Equal(HttpStatusCode.Forbidden, (await viewer.GetAsync("/api/health/details")).StatusCode);
    }
}

public static class PlanTests
{
    /// <summary>Starts a planning run and waits until it succeeded; returns its id.</summary>
    public static async Task<long> RunPlanAsync(HttpClient client, string scope, string dc = "dc01.contoso.local")
    {
        var start = await client.PostAsJsonAsync("/api/runs/deploy", new
        {
            preferredDc = dc, scope, includeMsa = false, includeGmsa = false, includeDmsa = false, includeWinLaps = false, confirmApply = false,
        });
        Assert.Equal(HttpStatusCode.Accepted, start.StatusCode);
        var id = (await start.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<long>();
        for (var i = 0; i < 80; i++)
        {
            var run = await client.GetFromJsonAsync<JsonObject>($"/api/runs/{id}");
            var status = run!["status"]!.GetValue<string>();
            if (status == "Succeeded") return id;
            Assert.NotEqual("Failed", status);
            await Task.Delay(500);
        }
        throw new TimeoutException($"Planungslauf #{id} wurde nicht fertig.");
    }
}
