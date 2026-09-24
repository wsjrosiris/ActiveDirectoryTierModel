using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TierModel.Service.Data;
using TierModel.Service.Maintenance;

namespace TierModel.Service.Tests;

public class MaintenanceCalendarTests
{
    private static MaintenanceWindow Window(string from, string to, params DayOfWeek[] days) => new()
    {
        Id = Random.Shared.Next(1, 100000), Name = $"{from}-{to}", Days = days.Select(d => (int)d).ToArray(),
        From = TimeOnly.Parse(from), To = TimeOnly.Parse(to), TimeZone = "Europe/Berlin", CreatedBy = "t",
    };

    private static FreezePeriod Freeze(DateTimeOffset from, DateTimeOffset to, string reason = "Jahresabschluss") =>
        new() { From = from, To = to, Reason = reason, CreatedBy = "t" };

    private static DateTimeOffset Utc(string s) => DateTimeOffset.Parse(s + "Z").ToUniversalTime();

    [Fact]
    public void No_windows_means_always_allowed()
    {
        var cal = new MaintenanceCalendar([], []);
        Assert.False(cal.Restricted);
        Assert.True(cal.Allows(Utc("2026-09-24T12:00:00")));
        Assert.Equal(Utc("2026-09-24T12:00:00"), cal.NextAllowedStart(Utc("2026-09-24T12:00:00")));
    }

    [Fact]
    public void Disabled_windows_are_ignored()
    {
        var w = Window("22:00", "23:00", DayOfWeek.Monday);
        w.Enabled = false;
        Assert.False(new MaintenanceCalendar([w], []).Restricted);
    }

    [Fact]
    public void Overnight_window_spans_midnight()
    {
        // Monday 22:00 – Tuesday 04:00 Berlin (CEST, UTC+2 in September 2026). 2026-09-21 is a Monday.
        var cal = new MaintenanceCalendar([Window("22:00", "04:00", DayOfWeek.Monday)], []);
        Assert.False(cal.Allows(Utc("2026-09-21T19:59:00")));   // Mon 21:59
        Assert.True(cal.Allows(Utc("2026-09-21T20:00:00")));    // Mon 22:00
        Assert.True(cal.Allows(Utc("2026-09-22T01:59:00")));    // Tue 03:59
        Assert.False(cal.Allows(Utc("2026-09-22T02:00:00")));   // Tue 04:00
        Assert.False(cal.Allows(Utc("2026-09-22T21:00:00")));   // Tue 23:00: only Mondays open
        // From Tuesday noon the next start is next Monday 22:00.
        Assert.Equal(Utc("2026-09-28T20:00:00"), cal.NextAllowedStart(Utc("2026-09-22T10:00:00")));
        var next = cal.NextWindow(Utc("2026-09-22T10:00:00"))!;
        Assert.Equal(Utc("2026-09-29T02:00:00"), next.End);
    }

    [Fact]
    public void Window_follows_daylight_saving_time()
    {
        var cal = new MaintenanceCalendar([Window("22:00", "23:00", DayOfWeek.Saturday, DayOfWeek.Sunday)], []);
        // Saturday 28.03.2026 is still CET (UTC+1), Sunday 29.03.2026 is CEST (UTC+2).
        Assert.True(cal.Allows(Utc("2026-03-28T21:30:00")));
        Assert.True(cal.Allows(Utc("2026-03-29T20:30:00")));
        Assert.False(cal.Allows(Utc("2026-03-29T21:30:00")));
        Assert.Equal(Utc("2026-03-29T20:00:00"), cal.NextAllowedStart(Utc("2026-03-29T08:00:00")));
    }

    [Fact]
    public void Skipped_and_repeated_hours_are_resolved()
    {
        // Spring: 02:00–04:00 on 29.03.2026 – 02:00 does not exist, the window opens at 03:00 CEST (01:00 UTC) and lasts one hour.
        var spring = MaintenanceCalendar.Instance(Window("02:00", "04:00", DayOfWeek.Sunday), MaintenanceCalendar.TryZone("Europe/Berlin")!, new DateOnly(2026, 3, 29))!;
        Assert.Equal(Utc("2026-03-29T01:00:00"), spring.Start);
        Assert.Equal(Utc("2026-03-29T02:00:00"), spring.End);
        // Autumn: 02:00–04:00 on 25.10.2026 – 02:00 happens twice, the window opens at the first (00:00 UTC) and lasts three hours.
        var autumn = MaintenanceCalendar.Instance(Window("02:00", "04:00", DayOfWeek.Sunday), MaintenanceCalendar.TryZone("Europe/Berlin")!, new DateOnly(2026, 10, 25))!;
        Assert.Equal(Utc("2026-10-25T00:00:00"), autumn.Start);
        Assert.Equal(Utc("2026-10-25T03:00:00"), autumn.End);
    }

    [Fact]
    public void Earliest_of_several_windows_wins()
    {
        var cal = new MaintenanceCalendar(
        [
            Window("22:00", "23:00", DayOfWeek.Wednesday),
            Window("06:00", "07:00", DayOfWeek.Wednesday),
            Window("12:00", "13:00", DayOfWeek.Thursday),
        ], []);
        // Wednesday 23.09.2026 01:00 local → 06:00 local the same day.
        Assert.Equal(Utc("2026-09-23T04:00:00"), cal.NextAllowedStart(Utc("2026-09-22T23:00:00")));
        // After the evening window → Thursday noon.
        Assert.Equal(Utc("2026-09-24T10:00:00"), cal.NextAllowedStart(Utc("2026-09-23T21:30:00")));
    }

    [Fact]
    public void Freeze_blocks_and_moves_the_start_behind_it()
    {
        var window = Window("22:00", "04:00", DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday);
        // Freeze from Monday 21.09. 12:00 UTC to Wednesday 23.09. 12:00 UTC.
        var freeze = Freeze(Utc("2026-09-21T12:00:00"), Utc("2026-09-23T12:00:00"));
        var cal = new MaintenanceCalendar([window], [freeze]);
        Assert.False(cal.Allows(Utc("2026-09-21T21:00:00")));             // window open, but frozen
        Assert.Same(freeze, cal.FreezeAt(Utc("2026-09-21T21:00:00")));
        // First window after the freeze: Wednesday 22:00 CEST.
        Assert.Equal(Utc("2026-09-23T20:00:00"), cal.NextAllowedStart(Utc("2026-09-21T13:00:00")));

        // A freeze ending inside an open window: the start is the end of the freeze.
        var cal2 = new MaintenanceCalendar([window], [Freeze(Utc("2026-09-21T12:00:00"), Utc("2026-09-21T22:00:00"))]);
        Assert.Equal(Utc("2026-09-21T22:00:00"), cal2.NextAllowedStart(Utc("2026-09-21T13:00:00")));

        // Without windows a freeze alone delays to its end; disabled freezes do not count.
        var cal3 = new MaintenanceCalendar([], [freeze]);
        Assert.Equal(freeze.To, cal3.NextAllowedStart(Utc("2026-09-22T00:00:00")));
        freeze.Enabled = false;
        Assert.True(new MaintenanceCalendar([], [freeze]).Allows(Utc("2026-09-22T00:00:00")));
    }

    [Fact]
    public void Overlapping_freezes_are_chained()
    {
        var cal = new MaintenanceCalendar([], [Freeze(Utc("2026-12-20T00:00:00"), Utc("2026-12-27T00:00:00")), Freeze(Utc("2026-12-26T00:00:00"), Utc("2027-01-04T00:00:00"))]);
        Assert.Equal(Utc("2027-01-04T00:00:00"), cal.NextAllowedStart(Utc("2026-12-21T00:00:00")));
    }
}

public class ChangeLogChainUnitTests
{
    [Fact]
    public void Canonical_json_survives_jsonb_normalisation()
    {
        Assert.Equal("""{"a":1,"b":[true,null,"x\"y"],"bb":{"c":1.50}}""", ChangeLogChain.CanonicalJson("""{ "bb": {"c": 1.50}, "a": 1e0, "b": [true, null, "x\"y"] }"""));
        Assert.Equal(ChangeLogChain.CanonicalJson("""{"b": 2, "a": "ä"}"""), ChangeLogChain.CanonicalJson("""{"a": "ä", "b": 2}"""));
        Assert.Null(ChangeLogChain.CanonicalJson(null));
    }

    [Fact]
    public void Hash_depends_on_every_field_and_the_previous_hash()
    {
        var e = new ChangeEntry { At = DateTimeOffset.Parse("2026-09-24T10:00:00.1234567Z"), Username = "u", Action = "a", EntityType = "t", EntityId = "1", Summary = "s" };
        var h = ChangeLogChain.Compute("", e);
        Assert.Equal(64, h.Length);
        Assert.Equal(h, ChangeLogChain.Compute("", new ChangeEntry { At = DateTimeOffset.Parse("2026-09-24T12:00:00.123456+02:00"), Username = "u", Action = "a", EntityType = "t", EntityId = "1", Summary = "s" }));
        Assert.NotEqual(h, ChangeLogChain.Compute("x", e));
        e.Summary = "s2";
        Assert.NotEqual(h, ChangeLogChain.Compute("", e));
        // Field boundaries cannot be shifted.
        var a = new ChangeEntry { At = e.At, Username = "ab", Action = "c", EntityType = "t", Summary = "s" };
        var b = new ChangeEntry { At = e.At, Username = "a", Action = "bc", EntityType = "t", Summary = "s" };
        Assert.NotEqual(ChangeLogChain.Compute("", a), ChangeLogChain.Compute("", b));
    }
}

[Collection("api")]
public class Phase4ApiTests(ApiFixture fixture)
{
    private static Task<HttpClient>? _admin;
    private Task<HttpClient> AdminAsync() => _admin ??= PlanApiTests.LoginAsync(fixture, ApiFixture.AdminUser, ApiFixture.AdminPassword);

    private static object Apply(string scope, long planRunId) => new
    {
        preferredDc = "dc01.contoso.local", scope, includeMsa = false, includeGmsa = false, includeDmsa = false, includeWinLaps = false, confirmApply = true, planRunId,
    };

    private async Task<T> WithScopeAsync<T>(Func<IServiceProvider, Task<T>> action)
    {
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        return await action(scope.ServiceProvider);
    }

    private async Task ClearMaintenanceAsync() => await WithScopeAsync(async sp =>
    {
        var db = sp.GetRequiredService<AppDbContext>();
        await db.MaintenanceWindows.ExecuteDeleteAsync();
        await db.FreezePeriods.ExecuteDeleteAsync();
        return 0;
    });

    private static async Task<JsonObject> WaitAsync(HttpClient client, long id, params string[] until)
    {
        JsonObject? run = null;
        for (var i = 0; i < 80; i++)
        {
            run = await client.GetFromJsonAsync<JsonObject>($"/api/runs/{id}");
            if (until.Contains(run!["status"]!.GetValue<string>())) break;
            await Task.Delay(500);
        }
        return run!;
    }

    // ---------- maintenance windows ----------

    [DbFact]
    public async Task Freeze_rejects_apply_but_not_plans()
    {
        var admin = await AdminAsync();
        try
        {
            var now = DateTimeOffset.UtcNow;
            var created = await admin.PostAsJsonAsync("/api/maintenance/freezes", new { from = now.AddHours(-1), to = now.AddHours(3), reason = "Quartalsabschluss", enabled = true });
            created.EnsureSuccessStatusCode();
            Assert.True((await created.Content.ReadFromJsonAsync<JsonObject>())!["active"]!.GetValue<bool>());

            // Plans still run during a freeze.
            var planId = await PlanTests.RunPlanAsync(admin, "OuOnly");
            var apply = await admin.PostAsJsonAsync("/api/runs/deploy", Apply("OuOnly", planId));
            Assert.Equal(HttpStatusCode.BadRequest, apply.StatusCode);
            var error = (await apply.Content.ReadFromJsonAsync<JsonObject>())!["errors"]!["maintenance"]![0]!.GetValue<string>();
            Assert.Contains("Quartalsabschluss", error);
            Assert.Contains("gesperrt", error);

            var status = await admin.GetFromJsonAsync<JsonObject>("/api/maintenance/status");
            Assert.False(status!["allowedNow"]!.GetValue<bool>());
            Assert.Equal("Quartalsabschluss", status["activeFreeze"]!["reason"]!.GetValue<string>());

            // Validation: end before start.
            var bad = await admin.PostAsJsonAsync("/api/maintenance/freezes", new { from = now, to = now.AddHours(-1), reason = "x", enabled = true });
            Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        }
        finally
        {
            await ClearMaintenanceAsync();
        }
    }

    [DbFact]
    public async Task Apply_outside_a_window_is_scheduled_and_starts_when_the_window_opens()
    {
        var admin = await AdminAsync();
        try
        {
            // A window on another weekday than today (Berlin), so "now" is outside.
            var berlin = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, MaintenanceCalendar.TryZone("Europe/Berlin")!);
            var otherDay = (int)berlin.AddDays(3).DayOfWeek;
            var window = await admin.PostAsJsonAsync("/api/maintenance/windows",
                new { name = "Nachtfenster", days = new[] { otherDay }, from = "01:00", to = "02:00", timeZone = "Europe/Berlin", enabled = true });
            window.EnsureSuccessStatusCode();
            var windowId = (await window.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<long>();

            var planId = await PlanTests.RunPlanAsync(admin, "GroupOnly");
            var apply = await admin.PostAsJsonAsync("/api/runs/deploy", Apply("GroupOnly", planId));
            Assert.Equal(HttpStatusCode.Accepted, apply.StatusCode);
            var run = (await apply.Content.ReadFromJsonAsync<JsonObject>())!;
            Assert.Equal("Scheduled", run["status"]!.GetValue<string>());
            var scheduledFor = run["scheduledFor"]!.GetValue<DateTimeOffset>();
            Assert.True(scheduledFor > DateTimeOffset.UtcNow);
            Assert.Equal(1, TimeZoneInfo.ConvertTime(scheduledFor, MaintenanceCalendar.TryZone("Europe/Berlin")!).Hour);
            var id = run["id"]!.GetValue<long>();

            // Still scheduled a moment later (the worker does not start it).
            await Task.Delay(1500);
            Assert.Equal("Scheduled", (await admin.GetFromJsonAsync<JsonObject>($"/api/runs/{id}"))!["status"]!.GetValue<string>());
            Assert.Contains((await admin.GetFromJsonAsync<JsonObject>("/api/runs?status=Scheduled"))!["items"]!.AsArray(), r => r!["id"]!.GetValue<long>() == id);

            // The window is widened to all day, every day: the run is queued at once and runs.
            (await admin.PutAsJsonAsync($"/api/maintenance/windows/{windowId}",
                new { name = "Immer", days = new[] { 0, 1, 2, 3, 4, 5, 6 }, from = "00:00", to = "00:00", timeZone = "Europe/Berlin", enabled = true })).EnsureSuccessStatusCode();
            var done = await WaitAsync(admin, id, "Succeeded", "Failed");
            Assert.Equal("Succeeded", done["status"]!.GetValue<string>());
            Assert.Null(done["scheduledFor"]);
        }
        finally
        {
            await ClearMaintenanceAsync();
        }
    }

    [DbFact]
    public async Task Scheduled_run_can_be_cancelled_and_worker_promotes_due_runs()
    {
        var admin = await AdminAsync();
        try
        {
            var berlin = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, MaintenanceCalendar.TryZone("Europe/Berlin")!);
            (await admin.PostAsJsonAsync("/api/maintenance/windows",
                new { name = "Später", days = new[] { (int)berlin.AddDays(2).DayOfWeek }, from = "03:00", to = "04:00", timeZone = "Europe/Berlin", enabled = true })).EnsureSuccessStatusCode();
            var planId = await PlanTests.RunPlanAsync(admin, "UserOnly");
            var first = (await (await admin.PostAsJsonAsync("/api/runs/deploy", Apply("UserOnly", planId))).Content.ReadFromJsonAsync<JsonObject>())!;
            Assert.Equal("Scheduled", first["status"]!.GetValue<string>());
            var id = first["id"]!.GetValue<long>();
            Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync($"/api/runs/{id}/cancel", null)).StatusCode);
            Assert.Equal("Cancelled", (await admin.GetFromJsonAsync<JsonObject>($"/api/runs/{id}"))!["status"]!.GetValue<string>());

            // Worker promotion: a due scheduled run is queued once windows allow it, and moved when they do not.
            var second = (await (await admin.PostAsJsonAsync("/api/runs/deploy", Apply("UserOnly", planId))).Content.ReadFromJsonAsync<JsonObject>())!;
            var id2 = second["id"]!.GetValue<long>();
            var moved = await WithScopeAsync(async sp =>
            {
                var db = sp.GetRequiredService<AppDbContext>();
                await db.Runs.Where(r => r.Id == id2).ExecuteUpdateAsync(u => u.SetProperty(r => r.ScheduledFor, DateTimeOffset.UtcNow.AddMinutes(-1)));
                await sp.GetRequiredService<MaintenanceService>().PromoteDueAsync(DateTimeOffset.UtcNow);
                return await db.Runs.AsNoTracking().FirstAsync(r => r.Id == id2);
            });
            Assert.Equal(RunStatus.Scheduled, moved.Status);   // still outside the window: moved to the next start
            Assert.True(moved.ScheduledFor > DateTimeOffset.UtcNow);

            await ClearMaintenanceAsync();
            var promoted = await WithScopeAsync(async sp =>
            {
                var db = sp.GetRequiredService<AppDbContext>();
                await db.Runs.Where(r => r.Id == id2).ExecuteUpdateAsync(u => u.SetProperty(r => r.ScheduledFor, DateTimeOffset.UtcNow.AddMinutes(-1)));
                return await sp.GetRequiredService<MaintenanceService>().PromoteDueAsync(DateTimeOffset.UtcNow);
            });
            Assert.InRange(promoted, 0, 1);   // 0 when the schedule worker was faster
            Assert.Equal("Succeeded", (await WaitAsync(admin, id2, "Succeeded", "Failed"))["status"]!.GetValue<string>());
        }
        finally
        {
            await ClearMaintenanceAsync();
        }
    }

    [DbFact]
    public async Task Window_validation_and_admin_only()
    {
        var admin = await AdminAsync();
        var bad = await admin.PostAsJsonAsync("/api/maintenance/windows", new { name = "", days = Array.Empty<int>(), from = "25:00", to = "x", timeZone = "Mars/Base", enabled = true });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        var errors = (await bad.Content.ReadFromJsonAsync<JsonObject>())!["errors"]!.AsObject();
        foreach (var key in new[] { "name", "days", "from", "to", "timeZone" }) Assert.True(errors.ContainsKey(key), key);

        var token = await CreateTokenAsync(admin, "Viewer");
        var viewer = BearerClient(token);
        Assert.Equal(HttpStatusCode.OK, (await viewer.GetAsync("/api/maintenance")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await viewer.PostAsJsonAsync("/api/maintenance/freezes",
            new { from = DateTimeOffset.UtcNow, to = DateTimeOffset.UtcNow.AddHours(1), reason = "x", enabled = true })).StatusCode);
    }

    // ---------- API tokens ----------

    private static async Task<string> CreateTokenAsync(HttpClient client, string role, int days = 30, string name = "Test")
    {
        var response = await client.PostAsJsonAsync("/api/tokens", new { name, role, expiresInDays = days });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<JsonObject>())!["token"]!.GetValue<string>();
    }

    private HttpClient BearerClient(string token)
    {
        var client = fixture.Factory!.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    [DbFact]
    public async Task Token_authenticates_without_csrf_and_is_listed_once()
    {
        var admin = await AdminAsync();
        var token = await CreateTokenAsync(admin, "Operator", 90, "CI-Pipeline");
        Assert.Matches("^tmk_[a-z0-9]{8}_[A-Za-z0-9_-]{43}$", token);

        var bearer = BearerClient(token);
        Assert.Equal(HttpStatusCode.OK, (await bearer.GetAsync("/api/runs")).StatusCode);
        var me = await bearer.GetFromJsonAsync<JsonObject>("/api/auth/me");
        Assert.Equal("admin", me!["user"]!["username"]!.GetValue<string>());
        // State-changing request without any CSRF header or cookie.
        var audit = await bearer.PostAsJsonAsync("/api/runs/audit", new
        {
            preferredDc = "dc01.contoso.local", scope = "OuOnly", includeMsa = false, includeGmsa = false, includeDmsa = false, includeWinLaps = false,
        });
        Assert.Equal(HttpStatusCode.Accepted, audit.StatusCode);
        Assert.Equal("admin", (await audit.Content.ReadFromJsonAsync<JsonObject>())!["requestedBy"]!.GetValue<string>());
        // Operator token: admin endpoints are closed although the owner is an admin.
        Assert.Equal(HttpStatusCode.Forbidden, (await bearer.GetAsync("/api/users")).StatusCode);
        // Tokens cannot manage tokens or sign in.
        Assert.Equal(HttpStatusCode.Forbidden, (await bearer.PostAsJsonAsync("/api/tokens", new { name = "x", role = "Viewer", expiresInDays = 30 })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await bearer.PostAsync("/api/auth/logout", null)).StatusCode);

        var list = await admin.GetFromJsonAsync<JsonArray>("/api/tokens");
        var entry = list!.First(t => t!["name"]!.GetValue<string>() == "CI-Pipeline")!;
        Assert.Equal(token.Substring(4, 8), entry["prefix"]!.GetValue<string>());
        Assert.Equal("Operator", entry["role"]!.GetValue<string>());
        Assert.NotNull(entry["lastUsedAt"]);
        Assert.DoesNotContain(token, list.ToJsonString());
        Assert.True(entry["expiresAt"]!.GetValue<DateTimeOffset>() > DateTimeOffset.UtcNow.AddDays(89));
    }

    [DbFact]
    public async Task Invalid_expired_revoked_and_query_string_tokens_are_rejected()
    {
        var admin = await AdminAsync();
        var token = await CreateTokenAsync(admin, "Viewer");

        // Not accepted from the query string.
        var anonymous = fixture.Factory!.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync($"/api/runs?access_token={token}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync($"/api/runs?token={token}")).StatusCode);

        // Tampered secret, wrong format.
        Assert.Equal(HttpStatusCode.Unauthorized, (await BearerClient(token[..^2] + "xx").GetAsync("/api/runs")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await BearerClient("tmk_abc").GetAsync("/api/runs")).StatusCode);
        // A failing bearer never falls back to the cookie session.
        var withCookie = await PlanApiTests.LoginAsync(fixture, ApiFixture.AdminUser, ApiFixture.AdminPassword);
        withCookie.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "tmk_abc");
        Assert.Equal(HttpStatusCode.Unauthorized, (await withCookie.GetAsync("/api/runs")).StatusCode);

        // Expired.
        await WithScopeAsync(async sp =>
            await sp.GetRequiredService<AppDbContext>().ApiTokens.Where(t => t.Prefix == token.Substring(4, 8))
                .ExecuteUpdateAsync(u => u.SetProperty(t => t.ExpiresAt, DateTimeOffset.UtcNow.AddMinutes(-1))));
        var expired = await BearerClient(token).GetAsync("/api/runs");
        Assert.Equal(HttpStatusCode.Unauthorized, expired.StatusCode);
        Assert.Contains("abgelaufen", await expired.Content.ReadAsStringAsync());

        // Revoked.
        var token2 = await CreateTokenAsync(admin, "Viewer", name: "Zum Widerrufen");
        Assert.Equal(HttpStatusCode.OK, (await BearerClient(token2).GetAsync("/api/runs")).StatusCode);
        var id = (await admin.GetFromJsonAsync<JsonArray>("/api/tokens"))!.First(t => t!["name"]!.GetValue<string>() == "Zum Widerrufen")!["id"]!.GetValue<Guid>();
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsync($"/api/tokens/{id}/revoke", null)).StatusCode);
        var revoked = await BearerClient(token2).GetAsync("/api/runs");
        Assert.Equal(HttpStatusCode.Unauthorized, revoked.StatusCode);
        Assert.Contains("widerrufen", await revoked.Content.ReadAsStringAsync());
        var log = await admin.GetFromJsonAsync<JsonObject>("/api/changelog?entityType=token");
        Assert.Contains(log!["items"]!.AsArray(), e => e!["action"]!.GetValue<string>() == "token.revoke");
        Assert.Contains(log["items"]!.AsArray(), e => e!["action"]!.GetValue<string>() == "token.create");
    }

    [DbFact]
    public async Task Token_role_is_capped_and_inactive_users_lose_access()
    {
        var admin = await AdminAsync();
        var name = "op-" + Guid.NewGuid().ToString("N")[..6];
        var created = await admin.PostAsJsonAsync("/api/users", new { username = name, displayName = name, role = "Operator", password = "Initial-Password-1" });
        created.EnsureSuccessStatusCode();
        var userId = (await created.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<Guid>();
        var op = await PlanApiTests.LoginAsync(fixture, name, "Initial-Password-1");
        var changed = await op.PostAsJsonAsync("/api/auth/change-password", new { currentPassword = "Initial-Password-1", newPassword = "Changed-Password-2" });
        PlanApiTests.SetXsrf(op, changed);

        // Not above the own role.
        var tooHigh = await op.PostAsJsonAsync("/api/tokens", new { name = "x", role = "Admin", expiresInDays = 30 });
        Assert.Equal(HttpStatusCode.BadRequest, tooHigh.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await op.PostAsJsonAsync("/api/tokens", new { name = "x", role = "Viewer", expiresInDays = 400 })).StatusCode);
        var token = await CreateTokenAsync(op, "Operator");
        var bearer = BearerClient(token);
        Assert.Equal(HttpStatusCode.Accepted, (await bearer.PostAsJsonAsync("/api/runs/monitor", new { preferredDc = "dc01.contoso.local" })).StatusCode);

        // Downgrade of the user: the token acts as Viewer from now on.
        (await admin.PutAsJsonAsync($"/api/users/{userId}", new { displayName = name, role = "Viewer", isActive = true })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await bearer.PostAsJsonAsync("/api/runs/monitor", new { preferredDc = "dc01.contoso.local" })).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await bearer.GetAsync("/api/runs")).StatusCode);
        var listed = (await admin.GetFromJsonAsync<JsonArray>("/api/tokens?all=true"))!.First(t => t!["username"]!.GetValue<string>() == name)!;
        Assert.Equal("Viewer", listed["effectiveRole"]!.GetValue<string>());

        // Deactivated user: token stops working.
        (await admin.PutAsJsonAsync($"/api/users/{userId}", new { displayName = name, role = "Viewer", isActive = false })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Unauthorized, (await bearer.GetAsync("/api/runs")).StatusCode);
        // Other users cannot see or revoke foreign tokens (admins can list all).
        Assert.DoesNotContain((await admin.GetFromJsonAsync<JsonArray>("/api/tokens"))!, t => t!["username"]!.GetValue<string>() == name);
    }

    [DbFact]
    public async Task Cookie_requests_still_need_csrf()
    {
        var admin = await PlanApiTests.LoginAsync(fixture, ApiFixture.AdminUser, ApiFixture.AdminPassword);
        admin.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        var response = await admin.PostAsJsonAsync("/api/tokens", new { name = "x", role = "Viewer", expiresInDays = 30 });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("CSRF", await response.Content.ReadAsStringAsync());
    }

    // ---------- change-log hash chain ----------

    private Task<JsonObject> VerifyAsync(HttpClient admin) => admin.GetFromJsonAsync<JsonObject>("/api/changelog/verify")!;

    [DbFact]
    public async Task Change_log_is_hash_chained_and_tampering_is_detected()
    {
        var admin = await AdminAsync();
        (await admin.PutAsJsonAsync("/api/settings", new
        {
            defaultPreferredDc = "dc01.contoso.local", admlLanguage = "en-US", runRetentionDays = 90,
            requireApproval = false, approvalTimeoutHours = 24, publicBaseUrl = "", requirePlanBeforeApply = true, planMaxAgeHours = 24,
        })).EnsureSuccessStatusCode();
        var ok = await VerifyAsync(admin);
        Assert.True(ok["ok"]!.GetValue<bool>(), ok.ToJsonString());
        Assert.True(ok["count"]!.GetValue<long>() > 0);
        var lastId = ok["lastId"]!.GetValue<long>();
        Assert.Equal(64, ok["lastHash"]!.GetValue<string>().Length);

        // Edit a row directly in the database.
        var original = await WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<AppDbContext>();
            var s = await db.ChangeLog.Where(e => e.Id == lastId).Select(e => e.Summary).FirstAsync();
            await db.Database.ExecuteSqlRawAsync("UPDATE change_log SET \"Summary\" = 'manipuliert' WHERE \"Id\" = {0}", lastId);
            return s;
        });
        try
        {
            var broken = await VerifyAsync(admin);
            Assert.False(broken["ok"]!.GetValue<bool>());
            Assert.Equal(lastId, broken["brokenAtId"]!.GetValue<long>());
            Assert.Contains("verändert", broken["problem"]!.GetValue<string>());
            var chain = await admin.GetFromJsonAsync<JsonObject>("/api/changelog/chain");
            Assert.False(chain!["ok"]!.GetValue<bool>());
            var health = await admin.GetFromJsonAsync<JsonObject>("/api/health/details");
            var item = health!["items"]!.AsArray().Single(i => i!["key"]!.GetValue<string>() == "changelog")!;
            Assert.Equal("error", item["status"]!.GetValue<string>());
        }
        finally
        {
            await WithScopeAsync(sp => sp.GetRequiredService<AppDbContext>().Database
                .ExecuteSqlRawAsync("UPDATE change_log SET \"Summary\" = {0} WHERE \"Id\" = {1}", original, lastId));
        }
        Assert.True((await VerifyAsync(admin))["ok"]!.GetValue<bool>());

        // A deleted row breaks the link of its successor.
        var victim = await WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<AppDbContext>();
            sp.GetRequiredService<ChangeLogService>().Add("test", "test.a", "test", null, "A");
            await db.SaveChangesAsync();
            sp.GetRequiredService<ChangeLogService>().Add("test", "test.b", "test", null, "B", new { z = 1, a = new[] { "x" } });
            await db.SaveChangesAsync();
            return await db.ChangeLog.AsNoTracking().Where(e => e.Action == "test.a").OrderByDescending(e => e.Id).FirstAsync();
        });
        await WithScopeAsync(sp => sp.GetRequiredService<AppDbContext>().Database.ExecuteSqlRawAsync("DELETE FROM change_log WHERE \"Id\" = {0}", victim.Id));
        try
        {
            var broken = await VerifyAsync(admin);
            Assert.False(broken["ok"]!.GetValue<bool>());
            Assert.True(broken["brokenAtId"]!.GetValue<long>() > victim.Id);
            Assert.Contains("vorherigen", broken["problem"]!.GetValue<string>());
        }
        finally
        {
            await WithScopeAsync(sp => sp.GetRequiredService<AppDbContext>().Database.ExecuteSqlRawAsync(
                "INSERT INTO change_log (\"Id\", \"At\", \"Username\", \"Action\", \"EntityType\", \"EntityId\", \"Summary\", \"Details\", \"Hash\", \"PrevHash\") VALUES ({0}, {1}, {2}, {3}, {4}, NULL, {5}, NULL, {6}, {7})",
                victim.Id, victim.At, victim.Username, victim.Action, victim.EntityType, victim.Summary, victim.Hash!, victim.PrevHash!));
        }
        Assert.True((await VerifyAsync(admin))["ok"]!.GetValue<bool>());
    }

    [DbFact]
    public async Task Concurrent_appends_keep_the_chain_intact()
    {
        var admin = await AdminAsync();
        await Task.WhenAll(Enumerable.Range(0, 24).Select(i => Task.Run(async () =>
        {
            await using var scope = fixture.Factory!.Services.CreateAsyncScope();
            var log = scope.ServiceProvider.GetRequiredService<ChangeLogService>();
            log.Add($"parallel-{i}", "test.parallel", "test", i.ToString(), $"Eintrag {i}a", new { i });
            log.Add($"parallel-{i}", "test.parallel", "test", i.ToString(), $"Eintrag {i}b");
            await scope.ServiceProvider.GetRequiredService<AppDbContext>().SaveChangesAsync();
        })));
        var result = await VerifyAsync(admin);
        Assert.True(result["ok"]!.GetValue<bool>(), result.ToJsonString());
    }

    [DbFact]
    public async Task Backfill_hashes_old_entries_in_id_order()
    {
        var admin = await AdminAsync();
        // Simulate entries from before the migration: a clean copy of the chain without hashes, then backfill.
        var (before, filled) = await WithScopeAsync(async sp =>
        {
            var db = sp.GetRequiredService<AppDbContext>();
            var ids = await db.ChangeLog.OrderByDescending(e => e.Id).Take(5).Select(e => e.Id).ToListAsync();
            var min = ids.Min();
            var before = await db.ChangeLog.AsNoTracking().Where(e => e.Id >= min).OrderBy(e => e.Id).Select(e => e.Hash).ToListAsync();
            await db.Database.ExecuteSqlRawAsync("UPDATE change_log SET \"Hash\" = NULL, \"PrevHash\" = NULL WHERE \"Id\" >= {0}", min);
            ChangeLogChain.ResetBackfillFlag();
            var n = await ChangeLogChain.BackfillAsync(db);
            Assert.Equal(0, await ChangeLogChain.BackfillAsync(db));   // idempotent
            var after = await db.ChangeLog.AsNoTracking().Where(e => e.Id >= min).OrderBy(e => e.Id).Select(e => e.Hash).ToListAsync();
            Assert.Equal(before, after);                                 // same hashes as when written
            return (before.Count, n);
        });
        Assert.Equal(before, filled);
        Assert.True((await VerifyAsync(admin))["ok"]!.GetValue<bool>());
    }
}
