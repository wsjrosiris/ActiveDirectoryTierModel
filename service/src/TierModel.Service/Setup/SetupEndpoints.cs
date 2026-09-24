using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using TierModel.Service.Auth;
using TierModel.Service.Config;
using TierModel.Service.Data;
using TierModel.Service.AdView;
using TierModel.Service;
using TierModel.Service.Localization;

namespace TierModel.Service.Setup;

public record GpoRename(string Section, string Target, string Field, string From, string To);

/// <summary>Name prefix of the GPOs ("*- Tier 0 DCs SOE - Computer"): preview of a replacement across the configuration.</summary>
public static class GpoPrefix
{
    public const string Template = "*-";
    private static readonly char[] Forbidden = ['\\', '/', ':', '*', '?', '"', '<', '>', '|', '\0'];

    public static string? ValidatePrefix(string? prefix)
    {
        if (string.IsNullOrWhiteSpace(prefix)) return L.T("Bitte ein Präfix angeben.");
        var p = prefix.Trim();
        if (p.Length > 20) return L.T("Höchstens 20 Zeichen.");
        if (p.IndexOfAny(Forbidden) >= 0 || p.Any(char.IsControl)) return L.T("Nicht erlaubt sind \\ / : * ? \" < > |.");
        return null;
    }

    private static IEnumerable<(string Target, string Field, JsonObject Gpo)> GpoFields(JsonNode? gpos)
    {
        if (gpos?["gpos"] is not JsonObject map) yield break;
        foreach (var (target, byKind) in map)
            if (byKind is JsonObject kinds)
                foreach (var (_, list) in kinds)
                    foreach (var gpo in (list as JsonArray ?? []).OfType<JsonObject>())
                        foreach (var field in new[] { "name", "rename" })
                            if (gpo[field] is JsonValue v && v.TryGetValue<string>(out _))
                                yield return (target, field, gpo);
    }

    /// <summary>The prefix the GPO names use now: "*-" in the shipped configuration, otherwise the most common text before " Tier".</summary>
    public static string Detect(JsonNode? gpos)
    {
        var names = GpoFields(gpos).Select(f => f.Gpo[f.Field]!.GetValue<string>()).ToList();
        if (names.Any(n => n.StartsWith(Template, StringComparison.Ordinal))) return Template;
        return names.Select(n => n.IndexOf(" Tier", StringComparison.OrdinalIgnoreCase) is var i and > 0 ? n[..i] : null)
            .OfType<string>().GroupBy(p => p).OrderByDescending(g => g.Count()).Select(g => g.Key).FirstOrDefault() ?? Template;
    }

    /// <summary>Every GPO name (gpos: name/rename, winlaps: decryptorGpoName) that starts with <paramref name="from"/>, with its new name.</summary>
    public static List<GpoRename> Preview(JsonNode? gpos, JsonNode? winlaps, string from, string to)
    {
        var result = new List<GpoRename>();
        if (string.IsNullOrEmpty(from) || from == to) return result;
        string Replace(string name) => to + name[from.Length..];
        foreach (var (target, field, gpo) in GpoFields(gpos))
        {
            var name = gpo[field]!.GetValue<string>();
            if (name.StartsWith(from, StringComparison.Ordinal))
                result.Add(new("gpos", target, field, name, Replace(name)));
        }
        foreach (var w in (winlaps?["winLapsDelegations"] as JsonArray ?? []).OfType<JsonObject>())
            if (w["decryptorGpoName"] is JsonValue v && v.TryGetValue<string>(out var name) && name.StartsWith(from, StringComparison.Ordinal))
                result.Add(new("winlaps", w["ouDn"]?.ToString() ?? "", "decryptorGpoName", name, Replace(name)));
        return result;
    }
}

/// <summary>Setup wizard (roadmap 12): shown to administrators while the configuration is still the shipped sample.</summary>
public static class SetupEndpoints
{
    public const string CompletedKey = "setupCompleted";

    public record SetupStateDto(bool Needed, bool Completed, bool SampleConfiguration, int UserVersions, bool DirectoryAvailable, string DirectorySource, string? CompletedBy, DateTimeOffset? CompletedAt);

    public record PrefixPreviewRequest(string? Prefix, string? From);

    public record PrefixPreviewDto(string Current, string Prefix, List<GpoRename> Renames, int GpoCount);

    public record CompleteRequest(bool Skipped);

    private record CompletedValue(bool Completed, string By, DateTimeOffset At, bool Skipped);

    /// <summary>Settings key of the completion flag; the first domain keeps the key from before roadmap 17.</summary>
    public static string CompletedKeyFor(int domainId) => domainId == 1 ? CompletedKey : $"{CompletedKey}:{domainId}";

    /// <summary>Setup state of the current domain: every domain runs through the wizard once (roadmap 17).</summary>
    public static async Task<SetupStateDto> StateAsync(AppDbContext db, SettingsService settings, DirectoryService directories, Domains.DomainContext domain, CancellationToken ct)
    {
        var directory = directories.For(domain.Current);
        var domainId = domain.Id;
        // The sample configuration is untouched while every version was written by the import ("system").
        var userVersions = await db.ConfigVersions.CountAsync(v => v.DomainId == domainId && v.CreatedBy != "system", ct);
        var raw = await settings.GetValueAsync(CompletedKeyFor(domainId), ct);
        CompletedValue? completed = null;
        if (raw is not null)
            try { completed = System.Text.Json.JsonSerializer.Deserialize<CompletedValue>(raw, System.Text.Json.JsonSerializerOptions.Web); }
            catch (System.Text.Json.JsonException) { completed = new CompletedValue(raw == "true", "", DateTimeOffset.MinValue, false); }
        var isCompleted = completed?.Completed == true;
        return new SetupStateDto(!isCompleted && userVersions == 0, isCompleted, userVersions == 0, userVersions,
            directory.Available, directory.Source, completed?.By, completed?.Completed == true ? completed.At : null);
    }

    public static void MapSetupEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/setup").RequireAuthorization(nameof(Role.Admin));

        g.MapGet("/state", (AppDbContext db, SettingsService settings, DirectoryService directories, Domains.DomainContext domain, CancellationToken ct) =>
            StateAsync(db, settings, directories, domain, ct));

        g.MapPost("/gpo-prefix/preview", async (PrefixPreviewRequest r, ConfigService config, CancellationToken ct) =>
        {
            if (GpoPrefix.ValidatePrefix(r.Prefix) is { } error)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["prefix"] = [error] });
            var gpos = (await config.GetAsync("gpos", ct: ct))?.Content;
            var winlaps = (await config.GetAsync("winlaps", ct: ct))?.Content;
            var current = string.IsNullOrEmpty(r.From) ? GpoPrefix.Detect(gpos) : r.From;
            var prefix = r.Prefix!.Trim();
            var renames = GpoPrefix.Preview(gpos, winlaps, current, prefix);
            return Results.Ok(new PrefixPreviewDto(current, prefix, renames, renames.Count(x => x.Section == "gpos" && x.Field == "name")));
        });

        g.MapPost("/complete", async (CompleteRequest? r, HttpContext ctx, SettingsService settings, ChangeLogService log, AppDbContext db, Domains.DomainContext domain) =>
        {
            var value = new CompletedValue(true, ctx.User.UserName(), DateTimeOffset.UtcNow, r?.Skipped == true);
            await settings.SetValueAsync(CompletedKeyFor(domain.Id), System.Text.Json.JsonSerializer.Serialize(value, System.Text.Json.JsonSerializerOptions.Web));
            log.Add(ctx.User.UserName(), "setup.complete", "settings", null, r?.Skipped == true ? L.P("Einrichtungsassistent übersprungen") : L.P("Einrichtung abgeschlossen"));
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }
}
