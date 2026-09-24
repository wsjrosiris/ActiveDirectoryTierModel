using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace TierModel.Service.Tests;

/// <summary>Runs only when TIERMODEL_TEST_ADMIN_CONNECTION points at a PostgreSQL server (a throwaway database is created).</summary>
public sealed class DbFactAttribute : FactAttribute
{
    public DbFactAttribute()
    {
        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable(ApiFixture.AdminConnectionVariable)))
            Skip = $"{ApiFixture.AdminConnectionVariable} ist nicht gesetzt.";
    }
}

public sealed class ApiFixture : IAsyncLifetime
{
    public const string AdminConnectionVariable = "TIERMODEL_TEST_ADMIN_CONNECTION";
    public const string AdminUser = "admin";
    public const string AdminPassword = "Test-Admin-Password-1";

    private readonly string _database = "tiermodel_test_" + Guid.NewGuid().ToString("N")[..8];
    private string? _adminConnection;
    public WebApplicationFactory<Program>? Factory { get; private set; }

    public async Task InitializeAsync()
    {
        _adminConnection = Environment.GetEnvironmentVariable(AdminConnectionVariable);
        if (string.IsNullOrEmpty(_adminConnection)) return;

        await using (var conn = new NpgsqlConnection(_adminConnection))
        {
            await conn.OpenAsync();
            await new NpgsqlCommand($"CREATE DATABASE {_database}", conn).ExecuteNonQueryAsync();
        }
        var csb = new NpgsqlConnectionStringBuilder(_adminConnection) { Database = _database };

        // Program reads its configuration while the builder is created, so use environment variables.
        Environment.SetEnvironmentVariable("ConnectionStrings__TierModel", csb.ConnectionString);
        Environment.SetEnvironmentVariable("TierModel__FrameworkPath", TestPaths.RepoRoot);
        Environment.SetEnvironmentVariable("TierModel__WorkPath", Path.Combine(Path.GetTempPath(), _database));
        Environment.SetEnvironmentVariable("TierModel__PwshPath", Path.Combine(TestPaths.RepoRoot, "service", "dev", "fake-pwsh.sh"));
        Environment.SetEnvironmentVariable("TierModel__RequireHttps", "false");

        Factory = new WebApplicationFactory<Program>().WithWebHostBuilder(b => b.UseEnvironment("Testing"));
        _ = Factory.Server; // start the host: migrates and imports the framework config

        await using var scope = Factory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<Auth.UserService>();
        users.Create(AdminUser, "Admin", Data.Role.Admin, AdminPassword, mustChange: false);
        await scope.ServiceProvider.GetRequiredService<Data.AppDbContext>().SaveChangesAsync();
    }

    public async Task DisposeAsync()
    {
        if (Factory is not null) await Factory.DisposeAsync();
        if (string.IsNullOrEmpty(_adminConnection)) return;
        NpgsqlConnection.ClearAllPools();
        await using var conn = new NpgsqlConnection(_adminConnection);
        await conn.OpenAsync();
        await new NpgsqlCommand($"DROP DATABASE IF EXISTS {_database} WITH (FORCE)", conn).ExecuteNonQueryAsync();
    }
}

public class ApiTests(ApiFixture fixture) : IClassFixture<ApiFixture>
{
    private async Task<HttpClient> LoginAsync(string user = ApiFixture.AdminUser, string password = ApiFixture.AdminPassword)
    {
        var client = fixture.Factory!.CreateClient();
        await RefreshXsrfAsync(client);
        var response = await client.PostAsJsonAsync("/api/auth/login", new { username = user, password });
        response.EnsureSuccessStatusCode();
        SetXsrf(client, response);
        return client;
    }

    private static async Task RefreshXsrfAsync(HttpClient client) => SetXsrf(client, await client.GetAsync("/api/auth/me"));

    private static void SetXsrf(HttpClient client, HttpResponseMessage response)
    {
        var cookie = response.Headers.GetValues("Set-Cookie").First(c => c.StartsWith("XSRF-TOKEN="));
        client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        client.DefaultRequestHeaders.Add("X-XSRF-TOKEN", Uri.UnescapeDataString(cookie.Split(';')[0]["XSRF-TOKEN=".Length..]));
    }

    [DbFact]
    public async Task State_changing_requests_require_the_csrf_header()
    {
        var client = fixture.Factory!.CreateClient();
        await client.GetAsync("/api/auth/me");
        var response = await client.PostAsJsonAsync("/api/auth/login", new { username = ApiFixture.AdminUser, password = ApiFixture.AdminPassword });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [DbFact]
    public async Task Anonymous_requests_are_rejected()
    {
        var client = fixture.Factory!.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/config/sections")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/runs")).StatusCode);
    }

    [DbFact]
    public async Task Framework_config_is_imported_and_versioned_with_conflict_detection()
    {
        var client = await LoginAsync();
        var section = await client.GetFromJsonAsync<JsonObject>("/api/config/sections/groups");
        var version = section!["version"]!.GetValue<int>();
        var content = section["content"]!.AsObject();
        Assert.True(content["groups"]!.AsArray().Count > 0);

        content["groups"]!.AsArray()[0]!["description"] = "geändert im Test";
        var saved = await client.PutAsJsonAsync("/api/config/sections/groups", new { content, comment = "Test", baseVersion = version });
        saved.EnsureSuccessStatusCode();
        Assert.Equal(version + 1, (await saved.Content.ReadFromJsonAsync<JsonObject>())!["version"]!.GetValue<int>());

        var stale = await client.PutAsJsonAsync("/api/config/sections/groups", new { content, comment = "alt", baseVersion = version });
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);

        var versions = await client.GetFromJsonAsync<JsonArray>("/api/config/sections/groups/versions");
        Assert.Equal(version + 1, versions![0]!["version"]!.GetValue<int>());
    }

    [DbFact]
    public async Task Audit_run_executes_and_reports_drift()
    {
        var client = await LoginAsync();
        var start = await client.PostAsJsonAsync("/api/runs/audit", new
        {
            preferredDc = "dc01.contoso.local", scope = "FullDeployment",
            includeMsa = false, includeGmsa = false, includeDmsa = false, includeWinLaps = false,
        });
        Assert.Equal(HttpStatusCode.Accepted, start.StatusCode);
        var id = (await start.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<long>();

        JsonObject? run = null;
        for (var i = 0; i < 60; i++)
        {
            run = await client.GetFromJsonAsync<JsonObject>($"/api/runs/{id}");
            if (run!["status"]!.GetValue<string>() is "Succeeded" or "Failed") break;
            await Task.Delay(500);
        }
        Assert.Equal("Succeeded", run!["status"]!.GetValue<string>());
        Assert.Equal(2, run["driftCount"]!.GetValue<int>());
        Assert.Equal(2, run["findings"]!.AsArray().Count);
        Assert.Equal("Missing", run["findings"]![0]!["type"]!.GetValue<string>());

        var log = await client.GetFromJsonAsync<JsonObject>($"/api/runs/{id}/log?after=0");
        Assert.Contains(log!["lines"]!.AsArray(), l => l!["text"]!.GetValue<string>().Contains("completed successfully"));
    }

    [DbFact]
    public async Task Editors_cannot_apply_or_manage_users()
    {
        var admin = await LoginAsync();
        var created = await admin.PostAsJsonAsync("/api/users", new { username = "editor", displayName = "Editor", role = "Editor", password = "Editor-Password-1" });
        created.EnsureSuccessStatusCode();

        var editor = await LoginAsync("editor", "Editor-Password-1");
        // A new account must change its password before anything else.
        Assert.Equal(HttpStatusCode.Forbidden, (await editor.GetAsync("/api/config/sections")).StatusCode);
        var changed = await editor.PostAsJsonAsync("/api/auth/change-password", new { currentPassword = "Editor-Password-1", newPassword = "Editor-Password-2" });
        Assert.Equal(HttpStatusCode.NoContent, changed.StatusCode);
        SetXsrf(editor, changed);

        Assert.Equal(HttpStatusCode.OK, (await editor.GetAsync("/api/config/sections")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await editor.GetAsync("/api/users")).StatusCode);
        var apply = await editor.PostAsJsonAsync("/api/runs/deploy", new
        {
            preferredDc = "dc01", scope = "OuOnly", includeMsa = false, includeGmsa = false, includeDmsa = false, includeWinLaps = false, confirmApply = true,
        });
        Assert.Equal(HttpStatusCode.Forbidden, apply.StatusCode);
    }

    [DbFact]
    public async Task Unknown_api_routes_return_404_not_the_spa()
    {
        var client = await LoginAsync();
        var response = await client.GetAsync("/api/does-not-exist");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
