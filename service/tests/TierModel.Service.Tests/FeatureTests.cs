using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using TierModel.Service.Auth;
using TierModel.Service.Data;
using TierModel.Service.Notifications;

namespace TierModel.Service.Tests;

public class WindowsAuthTests
{
    private static WindowsAuthConfig Config() => new(true, new Dictionary<Role, List<GroupRef>>
    {
        [Role.Viewer] = [new("CONTOSO\\All-IT", "S-1-5-21-1-2-3-1000")],
        [Role.Editor] = [],
        [Role.Operator] = [new("CONTOSO\\T0-Operators", "S-1-5-21-1-2-3-1100")],
        [Role.Admin] = [new("CONTOSO\\Domain Admins", "S-1-5-21-1-2-3-512")],
    });

    [Fact]
    public void Highest_matching_role_wins() =>
        Assert.Equal(Role.Operator, WindowsAuth.ResolveRole(Config(), ["S-1-5-21-1-2-3-1000", "s-1-5-21-1-2-3-1100"]));

    [Fact]
    public void No_matching_group_means_no_access() =>
        Assert.Null(WindowsAuth.ResolveRole(Config(), ["S-1-5-21-1-2-3-9999"]));

    [Theory]
    [InlineData("/laeufe/5", "/laeufe/5")]
    [InlineData("https://evil.example/", "/")]
    [InlineData("//evil.example/", "/")]
    [InlineData("/\\evil.example", "/")]
    [InlineData(null, "/")]
    public void Return_url_stays_on_this_site(string? input, string expected) =>
        Assert.Equal(expected, WindowsAuth.SafeReturnUrl(input));

    [Fact]
    public void Sids_are_accepted_without_lookup()
    {
        var (group, error) = WindowsAuth.Resolve(" s-1-5-21-1-2-3-512 ");
        Assert.Null(error);
        Assert.Equal("S-1-5-21-1-2-3-512", group!.Sid);
    }
}

public class NotificationTests
{
    private static Run Run(RunKind kind, RunStatus status, RunMode? mode = null, int? drift = null) => new()
    {
        Id = 7, Kind = kind, Status = status, Mode = mode, DriftCount = drift, Scope = DeployScope.FullDeployment,
        PreferredDc = "dc01", AdmlLanguage = "en-US", RequestedBy = "alice",
    };

    [Fact]
    public void Events_for_finished_runs()
    {
        Assert.Equal([NotificationEvent.Drift], NotificationService.EventsFor(Run(RunKind.Audit, RunStatus.Succeeded, drift: 3)));
        Assert.Empty(NotificationService.EventsFor(Run(RunKind.Audit, RunStatus.Succeeded, drift: 0)));
        Assert.Equal([NotificationEvent.Failure], NotificationService.EventsFor(Run(RunKind.Audit, RunStatus.Failed)));
        Assert.Equal([NotificationEvent.Apply], NotificationService.EventsFor(Run(RunKind.Deploy, RunStatus.Succeeded, RunMode.Apply)));
        Assert.Empty(NotificationService.EventsFor(Run(RunKind.Deploy, RunStatus.Succeeded, RunMode.Plan)));
    }

    [Fact]
    public void Message_links_to_the_run_when_a_public_url_is_set()
    {
        var m = NotificationService.BuildMessage(NotificationEvent.Drift, Run(RunKind.Audit, RunStatus.Succeeded, drift: 3), "https://tm.contoso.com:8443/");
        Assert.Equal("https://tm.contoso.com:8443/laeufe/7", m.Url);
        Assert.Contains("3", m.Title);
        Assert.Null(NotificationService.BuildMessage(NotificationEvent.Drift, Run(RunKind.Audit, RunStatus.Succeeded, drift: 3), "").Url);
    }

    [Fact]
    public void Teams_payload_is_an_adaptive_card()
    {
        var json = JsonSerializer.SerializeToNode(NotificationService.TeamsPayload(
            NotificationService.BuildMessage(NotificationEvent.Apply, Run(RunKind.Deploy, RunStatus.Succeeded, RunMode.Apply), "https://tm")))!;
        Assert.Equal("message", json["type"]!.GetValue<string>());
        var card = json["attachments"]![0]!;
        Assert.Equal("application/vnd.microsoft.card.adaptive", card["contentType"]!.GetValue<string>());
        Assert.Equal("AdaptiveCard", card["content"]!["type"]!.GetValue<string>());
        Assert.Equal("https://tm/laeufe/7", card["content"]!["actions"]![0]!["url"]!.GetValue<string>());
    }

    [Theory]
    [InlineData(ChannelType.Webhook, "https://hooks.example.com/abc?token=secret", "https://hooks.example.com/…")]
    [InlineData(ChannelType.Email, "a@contoso.com, b@contoso.com", "a@contoso.com, b@contoso.com")]
    public void Secrets_in_urls_are_masked(ChannelType type, string target, string shown) =>
        Assert.Equal(shown, NotificationEndpoints.Mask(type, target));
}

[Collection("api")]
public class ApprovalApiTests(ApiFixture fixture)
{
    private async Task<HttpClient> LoginAsync(string user, string password)
    {
        var client = fixture.Factory!.CreateClient();
        SetXsrf(client, await client.GetAsync("/api/auth/me"));
        var response = await client.PostAsJsonAsync("/api/auth/login", new { username = user, password });
        response.EnsureSuccessStatusCode();
        SetXsrf(client, response);
        return client;
    }

    private static void SetXsrf(HttpClient client, HttpResponseMessage response)
    {
        var cookie = response.Headers.GetValues("Set-Cookie").First(c => c.StartsWith("XSRF-TOKEN="));
        client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        client.DefaultRequestHeaders.Add("X-XSRF-TOKEN", Uri.UnescapeDataString(cookie.Split(';')[0]["XSRF-TOKEN=".Length..]));
    }

    [DbFact]
    public async Task Apply_needs_a_second_operator_and_runs_the_pinned_configuration()
    {
        var admin = await LoginAsync(ApiFixture.AdminUser, ApiFixture.AdminPassword);
        (await admin.PutAsJsonAsync("/api/settings", new
        {
            defaultPreferredDc = "dc01.contoso.local", admlLanguage = "en-US", runRetentionDays = 90,
            requireApproval = true, approvalTimeoutHours = 24, publicBaseUrl = "",
        })).EnsureSuccessStatusCode();
        (await admin.PostAsJsonAsync("/api/users", new { username = "op2", displayName = "Op 2", role = "Operator", password = "Operator-Pass-1" })).EnsureSuccessStatusCode();

        var submitted = await admin.PostAsJsonAsync("/api/runs/deploy", new
        {
            preferredDc = "dc01.contoso.local", scope = "OuOnly", includeMsa = false, includeGmsa = false,
            includeDmsa = false, includeWinLaps = false, confirmApply = true,
        });
        var run = (await submitted.Content.ReadFromJsonAsync<JsonObject>())!;
        Assert.Equal("AwaitingApproval", run["status"]!.GetValue<string>());
        var id = run["id"]!.GetValue<long>();
        var pinnedOus = (await admin.GetFromJsonAsync<JsonObject>($"/api/runs/{id}"))!["configVersions"]!["ous"]!.GetValue<int>();

        // The configuration changes after submission; the approved run must still use the pinned version.
        var ous = (await admin.GetFromJsonAsync<JsonObject>("/api/config/sections/ous"))!;
        var content = ous["content"]!.AsObject();
        content["organizationUnits"]!.AsArray()[0]!["comment"] = "changed after submit";
        (await admin.PutAsJsonAsync("/api/config/sections/ous", new { content, comment = "x", baseVersion = ous["version"]!.GetValue<int>() })).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostAsJsonAsync($"/api/runs/{id}/approve", new { comment = "self" })).StatusCode);

        var op2 = await LoginAsync("op2", "Operator-Pass-1");
        var changed = await op2.PostAsJsonAsync("/api/auth/change-password", new { currentPassword = "Operator-Pass-1", newPassword = "Operator-Pass-2" });
        SetXsrf(op2, changed);
        Assert.Equal(HttpStatusCode.BadRequest, (await op2.PostAsJsonAsync($"/api/runs/{id}/reject", new { comment = "" })).StatusCode);
        var approved = await op2.PostAsJsonAsync($"/api/runs/{id}/approve", new { comment = "geprüft" });
        var approvedRun = (await approved.Content.ReadFromJsonAsync<JsonObject>())!;
        Assert.Equal("Queued", approvedRun["status"]!.GetValue<string>());
        Assert.Equal("op2", approvedRun["approvedBy"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.Conflict, (await op2.PostAsJsonAsync($"/api/runs/{id}/approve", new { })).StatusCode);

        JsonObject? detail = null;
        for (var i = 0; i < 60; i++)
        {
            detail = await admin.GetFromJsonAsync<JsonObject>($"/api/runs/{id}");
            if (detail!["status"]!.GetValue<string>() is "Succeeded" or "Failed") break;
            await Task.Delay(500);
        }
        Assert.Equal("Succeeded", detail!["status"]!.GetValue<string>());
        Assert.Equal(pinnedOus, detail["configVersions"]!["ous"]!.GetValue<int>());

        // Reset for other tests in this fixture.
        (await admin.PutAsJsonAsync("/api/settings", new
        {
            defaultPreferredDc = "dc01.contoso.local", admlLanguage = "en-US", runRetentionDays = 90,
            requireApproval = false, approvalTimeoutHours = 24, publicBaseUrl = "",
        })).EnsureSuccessStatusCode();
    }
}
