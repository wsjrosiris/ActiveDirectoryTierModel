using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using TierModel.Service.Data;
using TierModel.Service.Domains;

namespace TierModel.Service.Tests;

/// <summary>Several managed domains (roadmap 17): header, fallback, isolation of every domain-bound feature.</summary>
[Collection("api")]
public class MultiDomainApiTests(ApiFixture fixture)
{
    private static Task<HttpClient>? _admin;
    private Task<HttpClient> AdminAsync() => _admin ??= PlanApiTests.LoginAsync(fixture, ApiFixture.AdminUser, ApiFixture.AdminPassword);

    private static HttpRequestMessage Req(HttpMethod method, string path, string? domain, object? body = null)
    {
        var r = new HttpRequestMessage(method, path);
        if (domain is not null) r.Headers.Add(DomainRules.Header, domain);
        if (body is not null) r.Content = JsonContent.Create(body);
        return r;
    }

    private static async Task<HttpResponseMessage> SendAsync(HttpClient c, HttpMethod m, string path, string? domain, object? body = null) =>
        await c.SendAsync(Req(m, path, domain, body));

    private static async Task<T> GetAsync<T>(HttpClient c, string path, string? domain)
    {
        var r = await SendAsync(c, HttpMethod.Get, path, domain);
        Assert.True(r.IsSuccessStatusCode, $"GET {path} ({domain}) → {(int)r.StatusCode}: {await r.Content.ReadAsStringAsync()}");
        return (await r.Content.ReadFromJsonAsync<T>())!;
    }

    private static string NewKey() => "md" + Guid.NewGuid().ToString("N")[..6];

    /// <summary>Creates a domain "Fabrikam &lt;key&gt;" with DNS &lt;key&gt;.test and DC dc01.&lt;key&gt;.test.</summary>
    private static async Task<JsonObject> CreateDomainAsync(HttpClient admin, string key, bool isDefault = false)
    {
        var r = await SendAsync(admin, HttpMethod.Post, "/api/domains", null, new
        {
            key, displayName = $"Fabrikam {key}", dnsName = $"{key}.test", preferredDc = $"dc01.{key}.test", admlLanguage = "de-DE", enabled = true, isDefault,
        });
        Assert.Equal(HttpStatusCode.Created, r.StatusCode);
        return (await r.Content.ReadFromJsonAsync<JsonObject>())!;
    }

    private static async Task<JsonObject> WaitAsync(HttpClient c, long id)
    {
        JsonObject? run = null;
        for (var i = 0; i < 80; i++)
        {
            run = await GetAsync<JsonObject>(c, $"/api/runs/{id}", null);
            if (run["status"]!.GetValue<string>() is "Succeeded" or "Failed" or "Cancelled") break;
            await Task.Delay(500);
        }
        return run!;
    }

    private static object RunBody(string dc, string scope = "OuOnly", bool apply = false, long? planRunId = null) => new
    {
        preferredDc = dc, scope, includeMsa = false, includeGmsa = false, includeDmsa = false, includeWinLaps = false, confirmApply = apply, planRunId,
    };

    [DbFact]
    public async Task Requests_without_header_use_the_default_domain_and_unknown_keys_are_rejected()
    {
        var admin = await AdminAsync();
        var domains = await GetAsync<JsonArray>(admin, "/api/domains", null);
        var def = domains.OfType<JsonObject>().Single(d => d["isDefault"]!.GetValue<bool>());
        Assert.Equal(1, domains.OfType<JsonObject>().Count(d => d["isDefault"]!.GetValue<bool>()));

        var plain = await SendAsync(admin, HttpMethod.Get, "/api/config/sections", null);
        Assert.Equal(def["key"]!.GetValue<string>(), plain.Headers.GetValues(DomainRules.Header).Single());
        var explicitDefault = await SendAsync(admin, HttpMethod.Get, "/api/config/sections", def["key"]!.GetValue<string>().ToUpperInvariant());
        Assert.Equal(HttpStatusCode.OK, explicitDefault.StatusCode);
        Assert.Equal(await plain.Content.ReadAsStringAsync(), await explicitDefault.Content.ReadAsStringAsync());

        var unknown = await SendAsync(admin, HttpMethod.Get, "/api/config/sections", "gibt-es-nicht");
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        Assert.Contains("Unbekannte Domäne", await unknown.Content.ReadAsStringAsync());

        // Downloads opened by the browser name the domain in the query string.
        var viaQuery = await admin.GetAsync($"/api/config/sections?domain={def["key"]!.GetValue<string>()}");
        Assert.Equal(HttpStatusCode.OK, viaQuery.StatusCode);
    }

    [DbFact]
    public async Task Domain_administration_validates_and_seeds_the_sample_configuration()
    {
        var admin = await AdminAsync();
        var key = NewKey();
        var bad = await SendAsync(admin, HttpMethod.Post, "/api/domains", null, new { key = "Nicht gültig", displayName = "", preferredDc = "dc 01", admlLanguage = "deutsch" });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        var errors = (await bad.Content.ReadFromJsonAsync<JsonObject>())!["errors"]!.AsObject();
        Assert.True(errors.ContainsKey("key") && errors.ContainsKey("displayName") && errors.ContainsKey("preferredDc") && errors.ContainsKey("admlLanguage"));
        var reserved = await SendAsync(admin, HttpMethod.Post, "/api/domains", null, new { key = "config", displayName = "X", preferredDc = "dc01.x.test" });
        Assert.Equal(HttpStatusCode.BadRequest, reserved.StatusCode);

        var created = await CreateDomainAsync(admin, key);
        Assert.Equal($"{key}.test", created["dnsName"]!.GetValue<string>());
        var duplicate = await SendAsync(admin, HttpMethod.Post, "/api/domains", null, new { key, displayName = "Andere", preferredDc = "dc01.x.test" });
        Assert.Equal(HttpStatusCode.BadRequest, duplicate.StatusCode);

        var sectionsDefault = await GetAsync<JsonArray>(admin, "/api/config/sections", null);
        var sectionsNew = await GetAsync<JsonArray>(admin, "/api/config/sections", key);
        Assert.Equal(sectionsDefault.Count, sectionsNew.Count);
        Assert.All(sectionsNew, s => Assert.Equal(1, s!["version"]!.GetValue<int>()));
        Assert.All(sectionsNew, s => Assert.Equal("system", s!["updatedBy"]!.GetValue<string>()));

        // Settings of a domain: its DC and language.
        var settings = await GetAsync<JsonObject>(admin, "/api/settings", key);
        Assert.Equal($"dc01.{key}.test", settings["defaultPreferredDc"]!.GetValue<string>());
        Assert.Equal("de-DE", settings["admlLanguage"]!.GetValue<string>());
        var dcs = await GetAsync<JsonObject>(admin, "/api/lookup/domain-controllers", key);
        Assert.True(dcs["available"]!.GetValue<bool>());
        Assert.Contains(dcs["items"]!.AsArray(), d => d!["name"]!.GetValue<string>() == $"dc02.{key}.test");
        Assert.Equal($"dc01.{key}.test", dcs["recent"]![0]!.GetValue<string>());

        // A domain without history can be deleted; the default domain never.
        var check = await GetAsync<JsonObject>(admin, $"/api/domains/{created["id"]}/deletion", null);
        Assert.True(check["canDelete"]!.GetValue<bool>());
        var def = (await GetAsync<JsonArray>(admin, "/api/domains", null)).OfType<JsonObject>().Single(d => d["isDefault"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.Conflict, (await SendAsync(admin, HttpMethod.Delete, $"/api/domains/{def["id"]}", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await SendAsync(admin, HttpMethod.Delete, $"/api/domains/{created["id"]}", null)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(admin, HttpMethod.Get, "/api/config/sections", key)).StatusCode);
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await db.ConfigSections.AnyAsync(s => s.DomainId == created["id"]!.GetValue<int>()));
    }

    [DbFact]
    public async Task Configuration_is_versioned_per_domain_and_changes_are_logged_with_the_domain()
    {
        var admin = await AdminAsync();
        var key = NewKey();
        await CreateDomainAsync(admin, key);
        var before = await GetAsync<JsonObject>(admin, "/api/config/sections/dependencies", null);
        var mine = await GetAsync<JsonObject>(admin, "/api/config/sections/dependencies", key);
        var content = mine["content"]!.AsObject();
        content["multiDomainTest"] = key;
        var saved = await SendAsync(admin, HttpMethod.Put, "/api/config/sections/dependencies", key, new { content, comment = "nur Domäne " + key, baseVersion = 1 });
        saved.EnsureSuccessStatusCode();
        Assert.Equal(2, (await saved.Content.ReadFromJsonAsync<JsonObject>())!["version"]!.GetValue<int>());

        var after = await GetAsync<JsonObject>(admin, "/api/config/sections/dependencies", null);
        Assert.Equal(before["version"]!.GetValue<int>(), after["version"]!.GetValue<int>());
        Assert.Null(after["content"]!["multiDomainTest"]);
        Assert.Equal(2, (await GetAsync<JsonArray>(admin, "/api/config/sections/dependencies/versions", key)).Count);
        // A stale base version only conflicts within the same domain.
        Assert.Equal(HttpStatusCode.Conflict,
            (await SendAsync(admin, HttpMethod.Put, "/api/config/sections/dependencies", key, new { content, comment = "alt", baseVersion = 1 })).StatusCode);

        var log = await GetAsync<JsonObject>(admin, "/api/changelog?entityType=config&pageSize=20", null);
        var entry = log["items"]!.AsArray().OfType<JsonObject>().First(e => e["action"]!.GetValue<string>() == "config.update");
        Assert.Equal(key, entry["details"]!["domain"]!.GetValue<string>());
        Assert.StartsWith($"[{key}] ", entry["summary"]!.GetValue<string>());
        var filtered = await GetAsync<JsonObject>(admin, "/api/changelog?entityType=config&pageSize=200&currentDomain=true", null);
        Assert.DoesNotContain(filtered["items"]!.AsArray(), e => e!["details"]?["domain"]?.GetValue<string>() == key);

        // Setup wizard per domain: the new domain still has the (edited) sample only in one section.
        var setup = await GetAsync<JsonObject>(admin, "/api/setup/state", key);
        Assert.Equal(1, setup["userVersions"]!.GetValue<int>());
        Assert.Equal(HttpStatusCode.NoContent, (await SendAsync(admin, HttpMethod.Post, "/api/setup/complete", key, new { skipped = true })).StatusCode);
        Assert.True((await GetAsync<JsonObject>(admin, "/api/setup/state", key))["completed"]!.GetValue<bool>());
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var settings = scope.ServiceProvider.GetRequiredService<SettingsService>();
        var id = scope.ServiceProvider.GetRequiredService<DomainRegistry>().Find(key)!.Id;
        Assert.NotNull(await settings.GetValueAsync(Setup.SetupEndpoints.CompletedKeyFor(id)));
    }

    [DbFact]
    public async Task Runs_schedules_and_plans_stay_in_their_domain()
    {
        var admin = await AdminAsync();
        var key = NewKey();
        var created = await CreateDomainAsync(admin, key);
        var dc = $"dc01.{key}.test";

        var start = await SendAsync(admin, HttpMethod.Post, "/api/runs/deploy", key, RunBody(dc));
        Assert.Equal(HttpStatusCode.Accepted, start.StatusCode);
        var planId = (await start.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<long>();
        var plan = await WaitAsync(admin, planId);
        Assert.Equal("Succeeded", plan["status"]!.GetValue<string>());
        Assert.Equal(created["id"]!.GetValue<int>(), plan["domainId"]!.GetValue<int>());
        Assert.Equal(key, plan["domain"]!["key"]!.GetValue<string>());

        // The framework gets the domain's DC; the log names the domain.
        var log = await GetAsync<JsonObject>(admin, $"/api/runs/{planId}/log?after=0", null);
        var lines = log["lines"]!.AsArray().Select(l => l!["text"]!.GetValue<string>()).ToList();
        Assert.Contains(lines, l => l.Contains($"-PreferredDc '{dc}'"));
        Assert.Contains(lines, l => l.StartsWith("Domäne: Fabrikam " + key));

        var listMine = await GetAsync<JsonObject>(admin, "/api/runs?pageSize=200", key);
        Assert.Contains(listMine["items"]!.AsArray(), r => r!["id"]!.GetValue<long>() == planId);
        Assert.All(listMine["items"]!.AsArray(), r => Assert.Equal(created["id"]!.GetValue<int>(), r!["domainId"]!.GetValue<int>()));
        var listDefault = await GetAsync<JsonObject>(admin, "/api/runs?pageSize=200", null);
        Assert.DoesNotContain(listDefault["items"]!.AsArray(), r => r!["id"]!.GetValue<long>() == planId);
        var dashboard = await GetAsync<JsonObject>(admin, "/api/dashboard", null);
        Assert.DoesNotContain(dashboard["recentRuns"]!.AsArray(), r => r!["id"]!.GetValue<long>() == planId);
        Assert.Equal(key, (await GetAsync<JsonObject>(admin, "/api/dashboard", key))["domain"]!["key"]!.GetValue<string>());

        // Plan gating: a plan of another domain is never applied.
        var foreign = await SendAsync(admin, HttpMethod.Post, "/api/runs/deploy", null, RunBody(dc, apply: true, planRunId: planId));
        Assert.Equal(HttpStatusCode.BadRequest, foreign.StatusCode);
        var problem = (await foreign.Content.ReadFromJsonAsync<JsonObject>())!;
        Assert.Contains("gehört zur Domäne", problem["errors"]!["planRunId"]![0]!.GetValue<string>());
        var candidates = await GetAsync<JsonObject>(admin, $"/api/runs/plan-candidates?preferredDc={dc}&scope=OuOnly", null);
        Assert.NotEqual(planId, candidates["candidate"]?["id"]?.GetValue<long>());
        var own = await GetAsync<JsonObject>(admin, $"/api/runs/plan-candidates?preferredDc={dc}&scope=OuOnly", key);
        Assert.Equal(planId, own["candidate"]!["id"]!.GetValue<long>());
        var apply = await SendAsync(admin, HttpMethod.Post, "/api/runs/deploy", key, RunBody(dc, apply: true, planRunId: planId));
        var applyBody = await apply.Content.ReadAsStringAsync();
        if (apply.StatusCode == HttpStatusCode.BadRequest) Assert.Null(JsonNode.Parse(applyBody)!["errors"]?["planRunId"]); // e.g. a freeze of another test
        if (apply.StatusCode == HttpStatusCode.Accepted)
        {
            var applyRun = JsonNode.Parse(applyBody)!;
            Assert.Equal(created["id"]!.GetValue<int>(), applyRun["domainId"]!.GetValue<int>());
            if (applyRun["status"]!.GetValue<string>() is "AwaitingApproval" or "Scheduled" or "Queued")
                await SendAsync(admin, HttpMethod.Post, $"/api/runs/{applyRun["id"]}/cancel", null);
        }

        // Schedules.
        var schedule = await SendAsync(admin, HttpMethod.Post, "/api/schedules", key, new
        {
            name = "Audit " + key, cron = "0 3 * * *", timeZone = "Europe/Berlin", enabled = false, preferredDc = dc, scope = "FullDeployment",
            includeMsa = false, includeGmsa = false, includeDmsa = false, includeWinLaps = false,
        });
        schedule.EnsureSuccessStatusCode();
        var scheduleId = (await schedule.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<long>();
        Assert.Contains(await GetAsync<JsonArray>(admin, "/api/schedules", key), s => s!["id"]!.GetValue<long>() == scheduleId);
        Assert.DoesNotContain(await GetAsync<JsonArray>(admin, "/api/schedules", null), s => s!["id"]!.GetValue<long>() == scheduleId);
        // "Jetzt ausführen" without header still runs in the schedule's domain.
        var now = await SendAsync(admin, HttpMethod.Post, $"/api/schedules/{scheduleId}/run", null);
        Assert.Equal(HttpStatusCode.Accepted, now.StatusCode);
        var audit = await WaitAsync(admin, (await now.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<long>());
        Assert.Equal(created["id"]!.GetValue<int>(), audit["domainId"]!.GetValue<int>());
        Assert.Equal("de-DE", audit["admlLanguage"]!.GetValue<string>());

        // A domain with runs cannot be deleted, only disabled; a disabled domain is read-only.
        Assert.Equal(HttpStatusCode.Conflict, (await SendAsync(admin, HttpMethod.Delete, $"/api/domains/{created["id"]}", null)).StatusCode);
        var disable = await SendAsync(admin, HttpMethod.Put, $"/api/domains/{created["id"]}", null, new
        {
            key, displayName = $"Fabrikam {key}", dnsName = $"{key}.test", preferredDc = dc, admlLanguage = "de-DE", enabled = false, isDefault = false,
        });
        disable.EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(admin, HttpMethod.Get, "/api/runs", key)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await SendAsync(admin, HttpMethod.Post, "/api/runs/audit", key, RunBody(dc, "FullDeployment"))).StatusCode);
        Assert.DoesNotContain(await GetAsync<JsonArray>(admin, "/api/domains/overview", null), d => d!["key"]!.GetValue<string>() == key);
    }

    [DbFact]
    public async Task Approvals_are_listed_in_the_domain_of_the_run()
    {
        var admin = await AdminAsync();
        var key = NewKey();
        await CreateDomainAsync(admin, key);
        var dc = $"dc01.{key}.test";
        var original = await GetAsync<JsonObject>(admin, "/api/settings", null);
        async Task PutSettings(bool approval) => (await SendAsync(admin, HttpMethod.Put, "/api/settings", null, new
        {
            defaultPreferredDc = original["defaultPreferredDc"]!.GetValue<string>(), admlLanguage = original["admlLanguage"]!.GetValue<string>(),
            runRetentionDays = original["runRetentionDays"]!.GetValue<int>(), requireApproval = approval,
            approvalTimeoutHours = original["approvalTimeoutHours"]!.GetValue<int>(), publicBaseUrl = original["publicBaseUrl"]!.GetValue<string>(),
            requirePlanBeforeApply = false, planMaxAgeHours = original["planMaxAgeHours"]!.GetValue<int>(),
        })).EnsureSuccessStatusCode();
        await PutSettings(true);
        try
        {
            var r = await SendAsync(admin, HttpMethod.Post, "/api/runs/deploy", key, RunBody(dc, apply: true));
            var run = (await r.Content.ReadFromJsonAsync<JsonObject>())!;
            Assert.Equal(HttpStatusCode.Accepted, r.StatusCode);
            Assert.Equal("AwaitingApproval", run["status"]!.GetValue<string>());
            var id = run["id"]!.GetValue<long>();
            Assert.Contains((await GetAsync<JsonObject>(admin, "/api/dashboard", key))["pendingApprovals"]!.AsArray(), x => x!["id"]!.GetValue<long>() == id);
            Assert.DoesNotContain((await GetAsync<JsonObject>(admin, "/api/dashboard", null))["pendingApprovals"]!.AsArray(), x => x!["id"]!.GetValue<long>() == id);
            // The instance-wide settings did not overwrite the other domain's DC.
            Assert.Equal(dc, (await GetAsync<JsonObject>(admin, "/api/settings", key))["defaultPreferredDc"]!.GetValue<string>());
            Assert.Equal(HttpStatusCode.NoContent, (await SendAsync(admin, HttpMethod.Post, $"/api/runs/{id}/cancel", null)).StatusCode);
        }
        finally
        {
            (await SendAsync(admin, HttpMethod.Put, "/api/settings", null, new
            {
                defaultPreferredDc = original["defaultPreferredDc"]!.GetValue<string>(), admlLanguage = original["admlLanguage"]!.GetValue<string>(),
                runRetentionDays = original["runRetentionDays"]!.GetValue<int>(), requireApproval = original["requireApproval"]!.GetValue<bool>(),
                approvalTimeoutHours = original["approvalTimeoutHours"]!.GetValue<int>(), publicBaseUrl = original["publicBaseUrl"]!.GetValue<string>(),
                requirePlanBeforeApply = original["requirePlanBeforeApply"]!.GetValue<bool>(), planMaxAgeHours = original["planMaxAgeHours"]!.GetValue<int>(),
            })).EnsureSuccessStatusCode();
        }
    }

    [DbFact]
    public async Task Monitoring_compliance_ad_view_and_jit_are_per_domain()
    {
        var admin = await AdminAsync();
        var key = NewKey();
        var created = await CreateDomainAsync(admin, key);
        var domainId = created["id"]!.GetValue<int>();
        var dc = $"dc01.{key}.test";

        var start = await SendAsync(admin, HttpMethod.Post, "/api/runs/monitor", key, new { preferredDc = dc });
        Assert.Equal(HttpStatusCode.Accepted, start.StatusCode);
        var id = (await start.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<long>();
        Assert.Equal("Succeeded", (await WaitAsync(admin, id))["status"]!.GetValue<string>());
        var mine = await GetAsync<JsonObject>(admin, "/api/privileged", key);
        Assert.Equal(id, mine["snapshot"]!["runId"]!.GetValue<long>());
        Assert.Equal(1, mine["snapshotCount"]!.GetValue<int>());
        Assert.True(mine["snapshot"]!["baseline"]!.GetValue<bool>()); // first snapshot of this domain, whatever other domains have
        var other = await GetAsync<JsonObject>(admin, "/api/privileged", null);
        Assert.NotEqual(id, other["snapshot"]?["runId"]?.GetValue<long>());
        Assert.Equal(id, (await GetAsync<JsonObject>(admin, "/api/compliance", key))["monitor"]!["runId"]!.GetValue<long>());
        Assert.NotEqual(id, (await GetAsync<JsonObject>(admin, "/api/compliance", null))["monitor"]?["runId"]?.GetValue<long>());
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.Equal(domainId, (await db.PrivilegedSnapshots.SingleAsync(s => s.RunId == id)).DomainId);
        }
        var overview = await GetAsync<JsonArray>(admin, "/api/domains/overview", null);
        Assert.Equal(id, overview.OfType<JsonObject>().Single(d => d["key"]!.GetValue<string>() == key)["lastMonitor"]!["id"]!.GetValue<long>());

        // Live AD view: the fake reader simulates the domain's DNS name.
        var tree = await GetAsync<JsonObject>(admin, "/api/ad/tree", key);
        Assert.Equal($"{key}.test", tree["domain"]!["dnsName"]!.GetValue<string>());
        Assert.Contains(tree["nodes"]!.AsArray(), n => n!["dn"]!.GetValue<string>() == $"OU=Legacy Servers,DC={key},DC=test");
        Assert.Equal("contoso.local", (await GetAsync<JsonObject>(admin, "/api/ad/tree", null))["domain"]!["dnsName"]!.GetValue<string>());
        var check = await SendAsync(admin, HttpMethod.Post, "/api/domains/check", null, new { dnsName = $"{key}.test", preferredDc = dc });
        Assert.True((await check.Content.ReadFromJsonAsync<JsonObject>())!["ok"]!.GetValue<bool>());
        var failing = await SendAsync(admin, HttpMethod.Post, "/api/domains/check", null, new { dnsName = "weg.invalid", preferredDc = "" });
        Assert.False((await failing.Content.ReadFromJsonAsync<JsonObject>())!["ok"]!.GetValue<bool>());

        // JIT groups: the same group may be set up in two domains; lists and requests stay in their domain.
        var group = new { group = "Tier0Admins", displayName = "Tier 0 Admins " + key, tier = 0, maxMinutes = 60, requiresApproval = true, minimumRole = "Operator", eligibleUsers = Array.Empty<string>(), enabled = true };
        var g1 = await SendAsync(admin, HttpMethod.Post, "/api/jit/groups", key, group);
        g1.EnsureSuccessStatusCode();
        var g1Id = (await g1.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<long>();
        Assert.Contains(await GetAsync<JsonArray>(admin, "/api/jit/groups", key), g => g!["id"]!.GetValue<long>() == g1Id);
        Assert.DoesNotContain(await GetAsync<JsonArray>(admin, "/api/jit/groups", null), g => g!["id"]!.GetValue<long>() == g1Id);
        var request = await SendAsync(admin, HttpMethod.Post, "/api/jit/requests", null, new { groupId = g1Id, minutes = 30, justification = "Falsche Domäne" });
        Assert.Equal(HttpStatusCode.BadRequest, request.StatusCode); // group of another domain
        Assert.Equal(HttpStatusCode.NoContent, (await SendAsync(admin, HttpMethod.Delete, $"/api/jit/groups/{g1Id}", null)).StatusCode);

        // Maintenance window limited to this domain.
        var window = await SendAsync(admin, HttpMethod.Post, "/api/maintenance/windows", null, new
        {
            name = "Nur " + key, days = new[] { 0, 1, 2, 3, 4, 5, 6 }, from = "02:00", to = "02:01", timeZone = "Europe/Berlin", enabled = true, domainIds = new[] { domainId },
        });
        window.EnsureSuccessStatusCode();
        var windowId = (await window.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<long>();
        try
        {
            var status = await GetAsync<JsonObject>(admin, "/api/maintenance/status", key);
            Assert.True(status["restricted"]!.GetValue<bool>());
            Assert.Contains(status["upcoming"]!.AsArray(), w => w!["windowId"]!.GetValue<long>() == windowId);
            Assert.DoesNotContain((await GetAsync<JsonObject>(admin, "/api/maintenance/status", null))["upcoming"]!.AsArray(), w => w!["windowId"]!.GetValue<long>() == windowId);
            var all = await GetAsync<JsonObject>(admin, "/api/maintenance", null);
            Assert.Equal(domainId, all["windows"]!.AsArray().OfType<JsonObject>().Single(w => w["id"]!.GetValue<long>() == windowId)["domainIds"]![0]!.GetValue<int>());
        }
        finally
        {
            await SendAsync(admin, HttpMethod.Delete, $"/api/maintenance/windows/{windowId}", null);
        }
    }

    [DbFact]
    public async Task Import_previews_and_reports_belong_to_their_domain()
    {
        var admin = await AdminAsync();
        var key = NewKey();
        await CreateDomainAsync(admin, key);
        var zip = await admin.GetByteArrayAsync("/api/config/export");
        var content = new ByteArrayContent(zip);
        content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/zip");
        var upload = new HttpRequestMessage(HttpMethod.Post, "/api/config/import/file?fileName=default.zip") { Content = content };
        upload.Headers.Add(DomainRules.Header, key);
        var preview = (await (await admin.SendAsync(upload)).Content.ReadFromJsonAsync<JsonObject>())!;
        var id = preview["id"]!.GetValue<string>();
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(admin, HttpMethod.Get, $"/api/config/import/{id}", key)).StatusCode);
        var wrong = await SendAsync(admin, HttpMethod.Get, $"/api/config/import/{id}", null);
        Assert.Equal(HttpStatusCode.NotFound, wrong.StatusCode);
        Assert.Contains("Fabrikam " + key, await wrong.Content.ReadAsStringAsync());

        var report = await admin.GetAsync($"/api/reports/aenderungen?format=html&domain={key}");
        report.EnsureSuccessStatusCode();
        Assert.Contains($"Fabrikam {key} ({key}.test)", await report.Content.ReadAsStringAsync());
    }

    [DbFact]
    public async Task Default_domain_can_be_moved_and_notifications_name_the_domain()
    {
        var admin = await AdminAsync();
        var original = (await GetAsync<JsonArray>(admin, "/api/domains", null)).OfType<JsonObject>().Single(d => d["isDefault"]!.GetValue<bool>());
        var key = NewKey();
        var created = await CreateDomainAsync(admin, key, isDefault: true);
        try
        {
            var plain = await SendAsync(admin, HttpMethod.Get, "/api/settings", null);
            Assert.Equal(key, plain.Headers.GetValues(DomainRules.Header).Single());
            var domains = await GetAsync<JsonArray>(admin, "/api/domains", null);
            Assert.Single(domains, d => d!["isDefault"]!.GetValue<bool>());
        }
        finally
        {
            (await SendAsync(admin, HttpMethod.Put, $"/api/domains/{original["id"]}", null, new
            {
                key = original["key"]!.GetValue<string>(), displayName = original["displayName"]!.GetValue<string>(), dnsName = original["dnsName"]!.GetValue<string>(),
                preferredDc = original["preferredDc"]!.GetValue<string>(), admlLanguage = original["admlLanguage"]!.GetValue<string>(), enabled = true, isDefault = true,
            })).EnsureSuccessStatusCode();
        }
        Assert.Equal(original["key"]!.GetValue<string>(), (await SendAsync(admin, HttpMethod.Get, "/api/settings", null)).Headers.GetValues(DomainRules.Header).Single());

        var run = new Run { Id = 7, DomainId = created["id"]!.GetValue<int>(), Kind = RunKind.Audit, Status = RunStatus.Succeeded, DriftCount = 2, PreferredDc = "dc01", AdmlLanguage = "en-US", RequestedBy = "x" };
        var domain = new Domain { Id = run.DomainId, Key = key, DisplayName = "Fabrikam " + key, DnsName = $"{key}.test" };
        var message = Notifications.NotificationService.BuildMessage(Notifications.NotificationEvent.Drift, run, "", domain: domain, multipleDomains: true);
        Assert.StartsWith($"[Fabrikam {key}] ", message.Title);
        Assert.Contains(message.Facts, f => f.Label == "Domäne" && f.Value == $"Fabrikam {key} ({key}.test)");
        var siem = Notifications.Siem.SiemEvents.ForRun(Notifications.NotificationEvent.Drift, run, "", domain);
        Assert.Equal($"{key}.test", siem.Field("domain"));
        Assert.Contains($"dntdom={key}.test", Notifications.Siem.CefFormatter.Format(siem, "1.0"));
    }
}

/// <summary>Git mirror with several domains: the first domain keeps its paths, further ones get a folder named after their key.</summary>
[Collection("api")]
public class MultiDomainGitTests(ApiFixture fixture)
{
    [DbFact]
    public async Task Sections_of_further_domains_are_committed_below_their_key()
    {
        var admin = await PlanApiTests.LoginAsync(fixture, ApiFixture.AdminUser, ApiFixture.AdminPassword);
        var key = "git" + Guid.NewGuid().ToString("N")[..6];
        var create = await admin.PostAsJsonAsync("/api/domains", new { key, displayName = "Git " + key, dnsName = $"{key}.test", preferredDc = $"dc01.{key}.test" });
        create.EnsureSuccessStatusCode();
        var root = Path.Combine(Path.GetTempPath(), "tm-gitmd-" + Guid.NewGuid().ToString("N")[..8]);
        var bare = Path.Combine(root, "remote.git");
        LibGit2Sharp.Repository.Init(bare, isBare: true);
        File.WriteAllText(Path.Combine(bare, "HEAD"), "ref: refs/heads/main\n");
        try
        {
            (await admin.PutAsJsonAsync("/api/settings/git", new
            {
                enabled = true, repositoryUrl = new Uri(bare).AbsoluteUri, branch = "main", username = "", authorName = "TierModel Test",
                authorEmail = "tm@contoso.com", pathInRepo = "config", pushOnSave = true,
            })).EnsureSuccessStatusCode();
            var initial = await WaitForAsync(bare, c => c.MessageShort.StartsWith("Synchronisierung aller Bereiche") && c[$"{key}/versions.json"] is not null);
            Assert.NotNull(initial["config/tiermodel-ous.json"]);   // first domain: unchanged layout
            Assert.NotNull(initial["versions.json"]);
            Assert.NotNull(initial[$"{key}/config/tiermodel-ous.json"]);

            var request = new HttpRequestMessage(HttpMethod.Get, "/api/config/sections/dependencies");
            request.Headers.Add(DomainRules.Header, key);
            var section = (await (await admin.SendAsync(request)).Content.ReadFromJsonAsync<JsonObject>())!;
            var content = section["content"]!.AsObject();
            content["gitDomain"] = key;
            var put = new HttpRequestMessage(HttpMethod.Put, "/api/config/sections/dependencies")
            {
                Content = JsonContent.Create(new { content, comment = "Git je Domäne", baseVersion = section["version"]!.GetValue<int>() }),
            };
            put.Headers.Add(DomainRules.Header, key);
            (await admin.SendAsync(put)).EnsureSuccessStatusCode();
            var commit = await WaitForAsync(bare, c => c.Message.Contains($"TierModel-Domain: {key}"));
            Assert.Contains(key, ((LibGit2Sharp.Blob)commit[$"{key}/config/dependencies.json"].Target).GetContentText());
            Assert.DoesNotContain(key, ((LibGit2Sharp.Blob)commit["config/dependencies.json"].Target).GetContentText());
            Assert.Contains("\"dependencies\": 2", ((LibGit2Sharp.Blob)commit[$"{key}/versions.json"].Target).GetContentText());
        }
        finally
        {
            await admin.PutAsJsonAsync("/api/settings/git", new { enabled = false, repositoryUrl = "", branch = "main", pathInRepo = "config", pushOnSave = true, clearPassword = true });
            try { TierModel.Service.GitSync.GitRepositorySync.DeleteDirectory(root); } catch (IOException) { }
        }
    }

    private static async Task<LibGit2Sharp.Commit> WaitForAsync(string bare, Func<LibGit2Sharp.Commit, bool> match)
    {
        for (var i = 0; i < 100; i++)
        {
            var repo = new LibGit2Sharp.Repository(bare);
            var hit = repo.Branches["main"]?.Commits.Take(20).FirstOrDefault(match);
            if (hit is not null) return hit;
            repo.Dispose();
            await Task.Delay(200);
        }
        throw new TimeoutException("Kein passender Commit im Repository.");
    }
}

/// <summary>The MultiDomain migration on a database with data from before (own database, migrated step by step).</summary>
public class MultiDomainMigrationTests
{
    [DbFact]
    public async Task Existing_data_is_assigned_to_the_first_domain_built_from_the_former_settings()
    {
        var admin = Environment.GetEnvironmentVariable(ApiFixture.AdminConnectionVariable)!;
        var name = "tiermodel_mig_" + Guid.NewGuid().ToString("N")[..8];
        await using (var conn = new Npgsql.NpgsqlConnection(admin))
        {
            await conn.OpenAsync();
            await new Npgsql.NpgsqlCommand($"CREATE DATABASE {name}", conn).ExecuteNonQueryAsync();
        }
        var cs = new Npgsql.NpgsqlConnectionStringBuilder(admin) { Database = name }.ConnectionString;
        try
        {
            var options = new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(cs).Options;
            await using (var db = new AppDbContext(options))
            {
                var migrator = db.GetInfrastructure().GetRequiredService<Microsoft.EntityFrameworkCore.Migrations.IMigrator>();
                await migrator.MigrateAsync("20260924133912_JitAccess");
                await using var cmd = new Npgsql.NpgsqlCommand("""
                    INSERT INTO settings ("Key", "Value") VALUES ('defaultPreferredDc', 'DC01.Contoso.Com'), ('admlLanguage', 'de-DE');
                    INSERT INTO config_sections ("Key", "FileName", "CurrentVersion", "UpdatedAt", "UpdatedBy") VALUES ('ous', 'tiermodel-ous.json', 2, now(), 'anna');
                    INSERT INTO config_versions ("SectionKey", "Version", "Content", "Sha256", "CreatedBy", "CreatedAt") VALUES
                        ('ous', 1, '{}', 'a', 'system', now()), ('ous', 2, '{"organizationUnits":[]}', 'b', 'anna', now());
                    INSERT INTO runs ("Kind", "Status", "Trigger", "IncludeMsa", "IncludeGmsa", "IncludeDmsa", "IncludeWinLaps", "PreferredDc", "AdmlLanguage",
                        "RequestedBy", "CreatedAt", "ApprovalRequired") VALUES ('Monitor', 'Succeeded', 'Manual', false, false, false, false, 'dc01', 'de-DE', 'anna', now(), false);
                    INSERT INTO privileged_snapshots ("RunId", "TakenAt", "Data", "Evaluation", "GroupCount", "MemberCount", "ChangeCount", "UnexpectedCount", "HygieneCount", "AttackPathCount")
                        SELECT "Id", now(), '{}', '{}', 0, 0, 0, 0, 0, 0 FROM runs;
                    INSERT INTO schedules ("Name", "Kind", "Cron", "TimeZone", "Enabled", "PreferredDc", "IncludeMsa", "IncludeGmsa", "IncludeDmsa", "IncludeWinLaps", "CreatedBy", "CreatedAt")
                        VALUES ('Nacht', 'Audit', '0 2 * * *', 'Europe/Berlin', true, 'dc01', false, false, false, false, 'anna', now());
                    INSERT INTO jit_groups ("Group", "DisplayName", "MaxMinutes", "RequiresApproval", "MinimumRole", "EligibleUsers", "Enabled", "CreatedBy", "CreatedAt")
                        VALUES ('Tier0Admins', 'Tier 0', 60, true, 'Operator', '{}', true, 'anna', now());
                    INSERT INTO maintenance_windows ("Name", "Days", "From", "To", "TimeZone", "Enabled", "CreatedBy", "CreatedAt")
                        VALUES ('Nachts', '{1,2}', '22:00', '04:00', 'Europe/Berlin', true, 'anna', now());
                    """, new Npgsql.NpgsqlConnection(cs));
                await cmd.Connection!.OpenAsync();
                await cmd.ExecuteNonQueryAsync();
                await cmd.Connection.CloseAsync();
                await migrator.MigrateAsync();
            }
            await using (var db = new AppDbContext(options))
            {
                var domain = await db.Domains.SingleAsync();
                Assert.Equal(1, domain.Id);
                Assert.Equal("contoso", domain.Key);
                Assert.Equal("contoso.com", domain.DisplayName);
                Assert.Equal("contoso.com", domain.DnsName);
                Assert.Equal("DC01.Contoso.Com", domain.PreferredDc);
                Assert.Equal("de-DE", domain.AdmlLanguage);
                Assert.True(domain.IsDefault && domain.Enabled);
                Assert.All(await db.ConfigSections.ToListAsync(), s => Assert.Equal(1, s.DomainId));
                Assert.All(await db.ConfigVersions.ToListAsync(), v => Assert.Equal(1, v.DomainId));
                Assert.Equal(1, (await db.Runs.SingleAsync()).DomainId);
                Assert.Equal(1, (await db.PrivilegedSnapshots.SingleAsync()).DomainId);
                Assert.Equal(1, (await db.Schedules.SingleAsync()).DomainId);
                Assert.Equal(1, (await db.JitGroups.SingleAsync()).DomainId);
                Assert.Empty((await db.MaintenanceWindows.SingleAsync()).DomainIds);

                // The identity continues after the first domain.
                var second = new Domain { Key = "fabrikam", DisplayName = "Fabrikam", CreatedAt = DateTimeOffset.UtcNow };
                db.Domains.Add(second);
                await db.SaveChangesAsync();
                Assert.Equal(2, second.Id);
                // The same section key is allowed per domain.
                db.ConfigSections.Add(new ConfigSection { DomainId = 2, Key = "ous", FileName = "tiermodel-ous.json", CurrentVersion = 1, UpdatedAt = DateTimeOffset.UtcNow, UpdatedBy = "system" });
                await db.SaveChangesAsync();
                // Domain-bound rows need a domain: without a request context nothing is guessed.
                db.Schedules.Add(new Schedule { Name = "x", Cron = "0 1 * * *", TimeZone = "UTC", PreferredDc = "dc", CreatedBy = "t", CreatedAt = DateTimeOffset.UtcNow });
                await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
            }
        }
        finally
        {
            Npgsql.NpgsqlConnection.ClearAllPools();
            await using var conn = new Npgsql.NpgsqlConnection(admin);
            await conn.OpenAsync();
            await new Npgsql.NpgsqlCommand($"DROP DATABASE IF EXISTS {name} WITH (FORCE)", conn).ExecuteNonQueryAsync();
        }
    }

    [DbFact]
    public async Task A_database_without_former_settings_gets_a_neutral_first_domain()
    {
        var admin = Environment.GetEnvironmentVariable(ApiFixture.AdminConnectionVariable)!;
        var name = "tiermodel_mig_" + Guid.NewGuid().ToString("N")[..8];
        await using (var conn = new Npgsql.NpgsqlConnection(admin))
        {
            await conn.OpenAsync();
            await new Npgsql.NpgsqlCommand($"CREATE DATABASE {name}", conn).ExecuteNonQueryAsync();
        }
        try
        {
            var options = new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(new Npgsql.NpgsqlConnectionStringBuilder(admin) { Database = name }.ConnectionString).Options;
            await using var db = new AppDbContext(options);
            await db.Database.MigrateAsync();
            var domain = await db.Domains.SingleAsync();
            Assert.Equal("standard", domain.Key);
            Assert.Equal("Standard-Domäne", domain.DisplayName);
            Assert.Equal("", domain.PreferredDc);
            Assert.Equal("en-US", domain.AdmlLanguage);
            // Startup fills the DC from appsettings.json (former fallback of the settings).
            var registry = new DomainRegistry();
            await registry.InitializeAsync(db, new TierModelOptions { DefaultPreferredDc = "dc07.corp.example", AdmlLanguage = "fr-FR" });
            Assert.Equal("dc07.corp.example", registry.Default.PreferredDc);
            Assert.Equal("corp.example", registry.Default.DnsName);
        }
        finally
        {
            Npgsql.NpgsqlConnection.ClearAllPools();
            await using var conn = new Npgsql.NpgsqlConnection(admin);
            await conn.OpenAsync();
            await new Npgsql.NpgsqlCommand($"DROP DATABASE IF EXISTS {name} WITH (FORCE)", conn).ExecuteNonQueryAsync();
        }
    }
}
