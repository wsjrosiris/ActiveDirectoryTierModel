using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;

namespace TierModel.Service.Tests;

[Collection("api")]
public class MonitoringApiTests(ApiFixture fixture)
{
    private async Task<HttpClient> LoginAsync(string user = ApiFixture.AdminUser, string password = ApiFixture.AdminPassword)
    {
        var client = fixture.Factory!.CreateClient();
        // Logins are rate limited per address: every client gets its own.
        client.DefaultRequestHeaders.Add(TestClientAddressFilter.Header, $"10.1.{Random.Shared.Next(0, 255)}.{Random.Shared.Next(2, 250)}");
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

    /// <summary>A ready-to-use account with the given role (the initial password change is done here).</summary>
    private async Task<HttpClient> UserAsync(string role)
    {
        var admin = await LoginAsync();
        var name = $"{role.ToLowerInvariant()}-{Guid.NewGuid().ToString("N")[..6]}";
        (await admin.PostAsJsonAsync("/api/users", new { username = name, displayName = name, role, password = "Initial-Password-1" })).EnsureSuccessStatusCode();
        var client = await LoginAsync(name, "Initial-Password-1");
        var changed = await client.PostAsJsonAsync("/api/auth/change-password", new { currentPassword = "Initial-Password-1", newPassword = "Changed-Password-2" });
        Assert.Equal(HttpStatusCode.NoContent, changed.StatusCode);
        SetXsrf(client, changed);
        return client;
    }

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

    private static async Task<long> StartMonitorAsync(HttpClient client)
    {
        var start = await client.PostAsJsonAsync("/api/runs/monitor", new { preferredDc = "dc01.contoso.local" });
        Assert.Equal(HttpStatusCode.Accepted, start.StatusCode);
        return (await start.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<long>();
    }

    [DbFact]
    public async Task Monitor_runs_require_operator_and_produce_snapshots_changes_and_compliance()
    {
        var editor = await UserAsync("Editor");
        Assert.Equal(HttpStatusCode.Forbidden, (await editor.PostAsJsonAsync("/api/runs/monitor", new { preferredDc = "dc01.contoso.local" })).StatusCode);

        var op = await UserAsync("Operator");
        var invalid = await op.PostAsJsonAsync("/api/runs/monitor", new { preferredDc = "dc01 & calc" });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);

        var first = await WaitAsync(op, await StartMonitorAsync(op));
        Assert.Equal("Succeeded", first["status"]!.GetValue<string>());
        Assert.Equal("Monitor", first["kind"]!.GetValue<string>());
        Assert.True(first["driftCount"]!.GetValue<int>() > 0);   // the fake snapshot contains unexpected members
        Assert.True(first["summary"]!["groupCount"]!.GetValue<int>() > 0);

        var second = await WaitAsync(op, await StartMonitorAsync(op));
        Assert.Equal("Succeeded", second["status"]!.GetValue<string>());

        // Viewers may read the results.
        var viewer = await UserAsync("Viewer");
        var overview = await viewer.GetFromJsonAsync<JsonObject>("/api/privileged");
        Assert.Equal(second["id"]!.GetValue<long>(), overview!["snapshot"]!["runId"]!.GetValue<long>());
        Assert.Contains(overview["groups"]!.AsArray(), g => g!["wellKnownName"]?.GetValue<string>() == "Domain Admins");
        Assert.NotEmpty(overview["hygiene"]!.AsArray());
        Assert.NotEmpty(overview["attackPaths"]!.AsArray());
        Assert.Contains(overview["groups"]!.AsArray().SelectMany(g => g!["members"]!.AsArray()), m => m!["unexpected"]!.GetValue<bool>());

        // The fake rotates its content, so the second snapshot differs from the first.
        var changes = await viewer.GetFromJsonAsync<JsonObject>("/api/privileged/changes");
        Assert.NotEmpty(changes!["items"]!.AsArray());
        Assert.True(changes["snapshotCount"]!.GetValue<int>() >= 2);

        var compliance = await viewer.GetFromJsonAsync<JsonObject>("/api/compliance");
        Assert.Equal(3, compliance!["current"]!.AsArray().Count);
        Assert.True(compliance["current"]![0]!["score"]!.GetValue<int>() < 100);
        Assert.Equal(30, compliance["history"]!.AsArray().Count);
        Assert.Equal(15, compliance["weights"]!["unexpectedMember"]!.GetValue<int>());
    }

    [DbFact]
    public async Task Schedules_have_a_kind_defaulting_to_audit()
    {
        var op = await UserAsync("Operator");
        var audit = await op.PostAsJsonAsync("/api/schedules", new
        {
            name = "Nachts", cron = "0 2 * * *", timeZone = "Europe/Berlin", enabled = true, preferredDc = "dc01.contoso.local",
            scope = "FullDeployment", includeMsa = false, includeGmsa = false, includeDmsa = false, includeWinLaps = false,
        });
        audit.EnsureSuccessStatusCode();
        Assert.Equal("Audit", (await audit.Content.ReadFromJsonAsync<JsonObject>())!["kind"]!.GetValue<string>());

        var monitor = await op.PostAsJsonAsync("/api/schedules", new
        {
            name = "Überwachung", kind = "Monitor", cron = "*/15 * * * *", timeZone = "Europe/Berlin", enabled = false, preferredDc = "dc01.contoso.local",
            scope = "OuOnly", includeMsa = true, includeGmsa = false, includeDmsa = false, includeWinLaps = false,
        });
        monitor.EnsureSuccessStatusCode();
        var created = (await monitor.Content.ReadFromJsonAsync<JsonObject>())!;
        Assert.Equal("Monitor", created["kind"]!.GetValue<string>());
        Assert.Null(created["scope"]);                         // scope and extensions do not apply to monitor runs
        Assert.False(created["includeMsa"]!.GetValue<bool>());

        // A client that does not send the kind keeps it.
        var id = created["id"]!.GetValue<long>();
        var updated = await op.PutAsJsonAsync($"/api/schedules/{id}", new
        {
            name = "Überwachung", cron = "*/30 * * * *", timeZone = "Europe/Berlin", enabled = false, preferredDc = "dc01.contoso.local",
            scope = (string?)null, includeMsa = false, includeGmsa = false, includeDmsa = false, includeWinLaps = false,
        });
        updated.EnsureSuccessStatusCode();
        Assert.Equal("Monitor", (await updated.Content.ReadFromJsonAsync<JsonObject>())!["kind"]!.GetValue<string>());

        var deploy = await op.PostAsJsonAsync("/api/schedules", new
        {
            name = "Nein", kind = "Deploy", cron = "0 2 * * *", timeZone = "Europe/Berlin", enabled = true, preferredDc = "dc01.contoso.local",
            scope = "FullDeployment", includeMsa = false, includeGmsa = false, includeDmsa = false, includeWinLaps = false,
        });
        Assert.Equal(HttpStatusCode.BadRequest, deploy.StatusCode);

        var run = await op.PostAsync($"/api/schedules/{id}/run", null);
        Assert.Equal(HttpStatusCode.Accepted, run.StatusCode);
        Assert.Equal("Monitor", (await run.Content.ReadFromJsonAsync<JsonObject>())!["kind"]!.GetValue<string>());
    }

    [DbFact]
    public async Task Remediation_starts_a_planning_run_for_the_area_of_an_audit()
    {
        var admin = await LoginAsync();
        var start = await admin.PostAsJsonAsync("/api/runs/audit", new
        {
            preferredDc = "dc02.contoso.local", scope = "FullDeployment", admlLanguage = "de-DE",
            includeMsa = false, includeGmsa = false, includeDmsa = false, includeWinLaps = false,
        });
        var auditId = (await start.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<long>();
        var audit = await WaitAsync(admin, auditId);
        Assert.Equal("groups", audit["findings"]![1]!["area"]!.GetValue<string>());

        var editor = await UserAsync("Editor");
        Assert.Equal(HttpStatusCode.Forbidden, (await editor.PostAsJsonAsync($"/api/runs/{auditId}/remediate", new { area = "groups" })).StatusCode);

        var op = await UserAsync("Operator");
        var plan = await op.PostAsJsonAsync($"/api/runs/{auditId}/remediate", new { area = "groups" });
        Assert.Equal(HttpStatusCode.Accepted, plan.StatusCode);
        var run = (await plan.Content.ReadFromJsonAsync<JsonObject>())!;
        Assert.Equal("Deploy", run["kind"]!.GetValue<string>());
        Assert.Equal("Plan", run["mode"]!.GetValue<string>());
        Assert.Equal("GroupOnly", run["scope"]!.GetValue<string>());
        Assert.Equal("dc02.contoso.local", run["preferredDc"]!.GetValue<string>());
        Assert.Equal("de-DE", run["admlLanguage"]!.GetValue<string>());

        var laps = (await (await op.PostAsJsonAsync($"/api/runs/{auditId}/remediate", new { area = "winlaps" })).Content.ReadFromJsonAsync<JsonObject>())!;
        Assert.Null(laps["scope"]);
        Assert.Equal("WinLaps", laps["includes"]![0]!.GetValue<string>());

        Assert.Equal(HttpStatusCode.BadRequest, (await op.PostAsJsonAsync($"/api/runs/{auditId}/remediate", new { area = "schema" })).StatusCode);
        var planId = run["id"]!.GetValue<long>();
        Assert.Equal(HttpStatusCode.Conflict, (await op.PostAsJsonAsync($"/api/runs/{planId}/remediate", new { area = "groups" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await op.PostAsJsonAsync("/api/runs/999999/remediate", new { area = "groups" })).StatusCode);
    }
}
