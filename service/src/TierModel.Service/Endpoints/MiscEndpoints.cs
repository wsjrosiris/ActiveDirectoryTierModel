using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using TierModel.Service.Auth;
using TierModel.Service.Config;
using TierModel.Service.Data;
using TierModel.Service.Runs;

namespace TierModel.Service.Endpoints;

public static class JsonDefaults
{
    public static readonly JsonSerializerOptions Options = Create();

    public static JsonSerializerOptions Create()
    {
        var o = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        Configure(o);
        return o;
    }

    public static void Configure(JsonSerializerOptions o)
    {
        o.Converters.Add(new JsonStringEnumConverter());
        o.Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping;
    }
}

public record ChangeEntryDto(long Id, DateTimeOffset At, string Username, string Action, string EntityType, string? EntityId, string Summary, JsonNode? Details)
{
    public static ChangeEntryDto From(ChangeEntry e) =>
        new(e.Id, e.At, e.Username, e.Action, e.EntityType, e.EntityId, e.Summary, e.Details is null ? null : JsonNode.Parse(e.Details));
}

public static class MiscEndpoints
{
    public static void MapMiscEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/healthz", async (AppDbContext db, CancellationToken ct) =>
            await db.Database.CanConnectAsync(ct) ? Results.Ok(new { status = "ok" }) : Results.StatusCode(503));

        var api = app.MapGroup("/api").RequireAuthorization(nameof(Role.Viewer));

        api.MapGet("/health/details", (HealthService health, CancellationToken ct) => health.GetAsync(ct))
            .RequireAuthorization(nameof(Role.Admin));

        api.MapGet("/changelog", async (AppDbContext db, string? entityType, int? page, int? pageSize) =>
        {
            var size = Math.Clamp(pageSize ?? 50, 1, 200);
            var p = Math.Max(page ?? 1, 1);
            var q = db.ChangeLog.AsNoTracking();
            if (!string.IsNullOrWhiteSpace(entityType)) q = q.Where(e => e.EntityType == entityType);
            var total = await q.CountAsync();
            var items = await q.OrderByDescending(e => e.Id).Skip((p - 1) * size).Take(size).ToListAsync();
            return new { items = items.Select(ChangeEntryDto.From), total };
        });

        api.MapGet("/settings", (SettingsService s, CancellationToken ct) => s.GetAsync(ct));

        api.MapPut("/settings", async (UpdateSettingsRequest r, HttpContext ctx, SettingsService s, ChangeLogService log, AppDbContext db) =>
        {
            var errors = new Dictionary<string, string[]>();
            r = r with { DefaultPreferredDc = r.DefaultPreferredDc?.Trim() ?? "", AdmlLanguage = r.AdmlLanguage?.Trim() ?? "" };
            if (!string.IsNullOrWhiteSpace(r.DefaultPreferredDc)
                && RunValidation.Validate(new RunRequest(r.DefaultPreferredDc.Trim(), DeployScope.FullDeployment, false, false, false, false, null)).ContainsKey("preferredDc"))
                errors["defaultPreferredDc"] = ["Ungültiger Hostname."];
            // An empty language would be passed as -AdmlLanguage "" and fail every run at parameter binding.
            if (r.AdmlLanguage.Length == 0 || RunValidation.Validate(new RunRequest("dc", DeployScope.FullDeployment, false, false, false, false, r.AdmlLanguage)).ContainsKey("admlLanguage"))
                errors["admlLanguage"] = ["Sprache im Format xx-XX angeben."];
            if (r.RunRetentionDays is < 0 or > 3650) errors["runRetentionDays"] = ["0 bis 3650 Tage (0 = unbegrenzt)."];
            if (r.ApprovalTimeoutHours is < 1 or > 720) errors["approvalTimeoutHours"] = ["1 bis 720 Stunden."];
            if (r.PlanMaxAgeHours is < 1 or > 720) errors["planMaxAgeHours"] = ["1 bis 720 Stunden."];
            if (!string.IsNullOrWhiteSpace(r.PublicBaseUrl)
                && !(Uri.TryCreate(r.PublicBaseUrl.Trim(), UriKind.Absolute, out var url) && url.Scheme is "https" or "http"))
                errors["publicBaseUrl"] = ["Vollständige Adresse angeben, z. B. https://tiermodel01.contoso.com:8443"];
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var before = await s.GetAsync();
            await s.UpdateAsync(r);
            var approvalText = r.RequireApproval is { } ra && ra != before.RequireApproval
                ? ra ? ", Vier-Augen-Prinzip EIN" : ", Vier-Augen-Prinzip AUS" : "";
            if (r.RequirePlanBeforeApply is { } rp && rp != before.RequirePlanBeforeApply)
                approvalText += rp ? ", Anwenden nur nach Planung EIN" : ", Anwenden nur nach Planung AUS";
            if (r.PlanMaxAgeHours is { } ph && ph != before.PlanMaxAgeHours) approvalText += $", Planung gültig {ph} Stunden";
            log.Add(ctx.User.UserName(), "settings.update", "settings", null,
                $"Einstellungen geändert: DC '{r.DefaultPreferredDc}', ADML {r.AdmlLanguage}, Aufbewahrung {r.RunRetentionDays} Tage{approvalText}");
            await db.SaveChangesAsync();
            return Results.Ok(await s.GetAsync());
        }).RequireAuthorization(nameof(Role.Admin));

        api.MapGet("/dashboard", async (AppDbContext db, ConfigService config, CancellationToken ct) =>
        {
            var content = await config.CurrentContentAsync(ct);
            int Count(string key, string prop) => content.GetValueOrDefault(key)?[prop] is JsonArray a ? a.Count : 0;

            var gpoNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var gpoLinks = 0;
            if (content.GetValueOrDefault("gpos")?["gpos"] is JsonObject gpos)
                foreach (var (target, node) in gpos)
                    if (node is JsonObject t)
                        foreach (var list in t.Select(kv => kv.Value).OfType<JsonArray>())
                            foreach (var gpo in list.OfType<JsonObject>())
                            {
                                if (gpo["name"] is JsonValue n && n.TryGetValue<string>(out var name)) gpoNames.Add(name);
                                if (target != "TemplateGpos") gpoLinks++;
                            }

            var issues = ConfigValidator.Validate(content);
            var lastAudit = await db.Runs.AsNoTracking().Where(r => r.Kind == RunKind.Audit && r.FinishedAt != null && r.Status != RunStatus.Cancelled).OrderByDescending(r => r.Id).FirstOrDefaultAsync(ct);
            var lastDeploy = await db.Runs.AsNoTracking().Where(r => r.Kind == RunKind.Deploy && r.FinishedAt != null && r.Status != RunStatus.Cancelled).OrderByDescending(r => r.Id).FirstOrDefaultAsync(ct);
            var trend = await db.Runs.AsNoTracking()
                .Where(r => r.Kind == RunKind.Audit && r.Status == RunStatus.Succeeded && r.DriftCount != null)
                .OrderByDescending(r => r.Id).Take(30)
                .Select(r => new { runId = r.Id, at = r.FinishedAt, driftCount = r.DriftCount })
                .ToListAsync(ct);
            var recentRuns = await db.Runs.AsNoTracking().OrderByDescending(r => r.Id).Take(8).ToListAsync(ct);
            var recentChanges = await db.ChangeLog.AsNoTracking().Where(e => e.EntityType != "auth").OrderByDescending(e => e.Id).Take(8).ToListAsync(ct);

            return new
            {
                counts = new
                {
                    ous = Count("ous", "organizationUnits"),
                    groups = Count("groups", "groups"),
                    users = Count("users", "users"),
                    acls = Count("acls", "aclDelegations"),
                    gpos = gpoNames.Count,
                    gpoLinks,
                },
                lastAudit = lastAudit is null ? null : RunSummaryDto.From(lastAudit),
                lastDeploy = lastDeploy is null ? null : RunSummaryDto.From(lastDeploy),
                driftTrend = trend.AsEnumerable().Reverse(),
                recentRuns = recentRuns.Select(RunSummaryDto.From),
                recentChanges = recentChanges.Select(ChangeEntryDto.From),
                pendingApprovals = (await db.Runs.AsNoTracking().Where(r => r.Status == RunStatus.AwaitingApproval).OrderBy(r => r.Id).ToListAsync(ct))
                    .Select(RunSummaryDto.From),
                queue = new
                {
                    running = await db.Runs.CountAsync(r => r.Status == RunStatus.Running, ct),
                    queued = await db.Runs.CountAsync(r => r.Status == RunStatus.Queued, ct),
                },
                validation = new
                {
                    errors = issues.Count(i => i.Severity == "Error"),
                    warnings = issues.Count(i => i.Severity == "Warning"),
                },
            };
        });
    }
}
