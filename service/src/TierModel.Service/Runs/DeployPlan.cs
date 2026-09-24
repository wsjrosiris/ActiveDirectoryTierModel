using System.Text.Json;
using System.Text.Json.Nodes;
using TierModel.Service.Data;
using TierModel.Service.Localization;

namespace TierModel.Service.Runs;

public record PlanMetadataDto(string? Version, string? Scope, string? PreferredDc, string? Timestamp, List<string> Includes);

public record PlanSummaryDto(int TotalActions, int Create, int Update, int Link, int Configure, int Existing);

public record PlanPhaseDto(int Phase, string Name, string Area, int ActionCount, int ExistingCount);

/// <summary>One planned change. Detail values are strings, numbers, booleans or string lists.</summary>
public record PlanActionDto(int Phase, string Area, string Action, string ResourceType, string Name, string? Path, Dictionary<string, object>? Details);

/// <summary>Normalised form of the framework's deploy-plan.json, stored in <see cref="Run.Plan"/>.</summary>
public record DeployPlan(
    PlanMetadataDto Metadata,
    PlanSummaryDto Summary,
    List<PlanPhaseDto> Phases,
    List<PlanActionDto> Actions,
    /// <summary>Number of planned actions per action type, counted before truncation.</summary>
    Dictionary<string, int> ActionCounts,
    List<string> Warnings,
    List<string> Errors,
    bool Truncated);

public static class DeployPlanReader
{
    public const string FileName = "deploy-plan.json";
    public const int MaxActions = 5000;
    private const int MaxMessages = 500;
    private const int MaxText = 2000;

    /// <summary>
    /// Parses deploy-plan.json. Tolerates PascalCase keys, missing sections, single objects instead of arrays and
    /// unknown actions. Throws <see cref="JsonException"/> when the text is not a JSON object.
    /// </summary>
    public static DeployPlan Parse(string json, int maxActions = MaxActions)
    {
        var root = JsonCase.CamelCaseKeys(JsonNode.Parse(json, documentOptions: new JsonDocumentOptions { AllowTrailingCommas = true, CommentHandling = JsonCommentHandling.Skip }))
            as JsonObject ?? throw new JsonException(L.P("Die Plandatei enthält kein JSON-Objekt."));

        var meta = root["metadata"] as JsonObject;
        var metadata = new PlanMetadataDto(Str(meta?["version"]), Str(meta?["scope"]), Str(meta?["preferredDc"]), Str(meta?["timestamp"]), Strings(meta?["includes"]));

        var allActions = Array(root["actions"]).OfType<JsonObject>().Select(ToAction).ToList();
        var counts = allActions.GroupBy(a => a.Action).OrderBy(g => g.Key).ToDictionary(g => g.Key, g => g.Count());
        var truncated = allActions.Count > maxActions;
        var actions = truncated ? allActions.Take(maxActions).ToList() : allActions;

        var s = root["summary"] as JsonObject;
        var summary = s is null
            ? new PlanSummaryDto(allActions.Count,
                allActions.Count(a => a.Action.StartsWith("Create", StringComparison.OrdinalIgnoreCase) || a.Action.StartsWith("Import", StringComparison.OrdinalIgnoreCase)),
                allActions.Count(a => a.Action.StartsWith("Update", StringComparison.OrdinalIgnoreCase)),
                allActions.Count(a => a.Action.StartsWith("Link", StringComparison.OrdinalIgnoreCase)),
                allActions.Count(a => a.Action.StartsWith("Configure", StringComparison.OrdinalIgnoreCase)),
                0)
            : new PlanSummaryDto(Int(s["totalActions"]) ?? allActions.Count, Int(s["create"]) ?? 0, Int(s["update"]) ?? 0,
                Int(s["link"]) ?? 0, Int(s["configure"]) ?? 0, Int(s["existing"]) ?? 0);

        var phases = Array(root["phases"]).OfType<JsonObject>()
            .Select(p => new PlanPhaseDto(Int(p["phase"]) ?? 0, Str(p["name"]) ?? "", Str(p["area"]) ?? "", Int(p["actionCount"]) ?? 0, Int(p["existingCount"]) ?? 0))
            .OrderBy(p => p.Phase).ToList();

        return new DeployPlan(metadata, summary, phases, actions, counts,
            Strings(root["warnings"]).Take(MaxMessages).ToList(), Strings(root["errors"]).Take(MaxMessages).ToList(), truncated);
    }

    /// <summary>Total number of changes: the summary's figure, falling back to the action count.</summary>
    public static int TotalChanges(DeployPlan plan) => Math.Max(plan.Summary.TotalActions, plan.ActionCounts.Values.Sum());

    public static string Serialize(DeployPlan plan) => JsonSerializer.Serialize(plan, JsonSerializerOptions.Web);

    public static DeployPlan? Deserialize(string? json)
    {
        if (string.IsNullOrEmpty(json)) return null;
        try
        {
            return JsonSerializer.Deserialize<DeployPlan>(json, JsonSerializerOptions.Web);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static PlanActionDto ToAction(JsonObject a)
    {
        Dictionary<string, object>? details = null;
        if (a["details"] is JsonObject d)
        {
            details = [];
            foreach (var (k, v) in d)
                if (DetailValue(v) is { } value) details[k] = value;
        }
        return new PlanActionDto(Int(a["phase"]) ?? 0, (Str(a["area"]) ?? "").ToLowerInvariant(), Str(a["action"]) ?? "Unknown",
            Str(a["resourceType"]) ?? "", Str(a["name"]) ?? "", Str(a["path"]), details);
    }

    /// <summary>Only plain values survive; nested objects are flattened to text so the UI never has to show JSON.</summary>
    private static object? DetailValue(JsonNode? v) => v switch
    {
        null => null,
        JsonArray arr => arr.Select(x => x is JsonValue ? Str(x) : Flatten(x)).Where(x => !string.IsNullOrEmpty(x)).Select(x => x!).ToArray(),
        JsonObject o => Flatten(o),
        JsonValue val when val.TryGetValue<bool>(out var b) => b,
        JsonValue val when val.GetValueKind() == JsonValueKind.Number => val.TryGetValue<long>(out var l) ? l : val.GetValue<double>(),
        JsonValue val => Clip(val.ToString()),
        _ => Flatten(v),
    };

    private static string Flatten(JsonNode? node) => node switch
    {
        JsonObject o => string.Join(", ", o.Select(kv => $"{kv.Key}: {Flatten(kv.Value)}")),
        JsonArray a => string.Join(", ", a.Select(Flatten)),
        null => "",
        _ => Clip(node.ToString()),
    };

    private static IEnumerable<JsonNode?> Array(JsonNode? node) => node switch
    {
        JsonArray a => a,
        JsonObject o => new JsonNode?[] { o },
        _ => System.Array.Empty<JsonNode?>(),
    };

    private static List<string> Strings(JsonNode? node) => node switch
    {
        JsonArray a => a.Select(x => x is JsonValue ? Str(x) : Flatten(x)).Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x!).ToList(),
        JsonValue v when Str(v) is { Length: > 0 } s => [s],
        _ => [],
    };

    private static string? Str(JsonNode? node) => node is JsonValue v ? Clip(v.GetValueKind() == JsonValueKind.String ? v.GetValue<string>() : v.ToString()) : null;

    private static int? Int(JsonNode? node) => node is JsonValue v
        ? v.TryGetValue<int>(out var i) ? i
        : v.TryGetValue<double>(out var d) ? (int)d
        : v.TryGetValue<string>(out var s) && int.TryParse(s, out var p) ? p : null
        : null;

    private static string Clip(string s) => s.Length > MaxText ? s[..MaxText] + "…" : s;
}

/// <summary>Rules for applying only what a reviewed planning run showed (roadmap item 3).</summary>
public static class PlanGate
{
    /// <summary>Parameters of the intended apply run, with the ADML language already resolved.</summary>
    public record Target(DeployScope? Scope, bool IncludeMsa, bool IncludeGmsa, bool IncludeDmsa, bool IncludeWinLaps, string PreferredDc, string AdmlLanguage);

    public static Target From(RunRequest r, string defaultAdmlLanguage) => new(r.Scope, r.IncludeMsa, r.IncludeGmsa, r.IncludeDmsa, r.IncludeWinLaps,
        r.PreferredDc.Trim(), string.IsNullOrWhiteSpace(r.AdmlLanguage) ? defaultAdmlLanguage : r.AdmlLanguage.Trim());

    public static DateTimeOffset? ExpiresAt(Run plan, int maxAgeHours) => (plan.FinishedAt ?? plan.CreatedAt).AddHours(maxAgeHours);

    /// <summary>Whether the planning run has the same parameters (scope, add-ons, DC, language) as the apply run.</summary>
    public static string? ParameterMismatch(Run plan, Target t)
    {
        if (plan.Scope != t.Scope) return L.F("Planung #{0} wurde für einen anderen Bereich erstellt.", plan.Id);
        if (plan.IncludeMsa != t.IncludeMsa || plan.IncludeGmsa != t.IncludeGmsa || plan.IncludeDmsa != t.IncludeDmsa || plan.IncludeWinLaps != t.IncludeWinLaps)
            return L.F("Planung #{0} wurde mit anderen Add-ons (MSA, gMSA, dMSA, Windows LAPS) erstellt.", plan.Id);
        if (!string.Equals(plan.PreferredDc.Trim(), t.PreferredDc, StringComparison.OrdinalIgnoreCase))
            return L.F("Planung #{0} wurde gegen einen anderen Domain Controller ({1}) erstellt.", plan.Id, plan.PreferredDc);
        if (!string.Equals(plan.AdmlLanguage, t.AdmlLanguage, StringComparison.OrdinalIgnoreCase))
            return L.F("Planung #{0} wurde mit einer anderen ADML-Sprache ({1}) erstellt.", plan.Id, plan.AdmlLanguage);
        return null;
    }

    /// <summary>Returns a German reason why <paramref name="plan"/> cannot be applied, or null if it can.</summary>
    public static string? Check(Run? plan, Target t, IReadOnlyDictionary<string, int> currentVersions, DateTimeOffset now, int maxAgeHours)
    {
        if (plan is null) return L.T("Der angegebene Planungslauf existiert nicht.");
        if (plan.Kind != RunKind.Deploy || plan.Mode != RunMode.Plan) return L.F("Lauf #{0} ist kein Planungslauf.", plan.Id);
        if (plan.Status != RunStatus.Succeeded) return L.F("Planung #{0} ist nicht erfolgreich abgeschlossen.", plan.Id);
        if (ParameterMismatch(plan, t) is { } mismatch) return mismatch;
        if (ExpiresAt(plan, maxAgeHours) <= now)
            return L.F("Planung #{0} ist älter als {1}. Bitte eine neue Planung starten.", plan.Id, (maxAgeHours == 1 ? L.T("eine Stunde") : L.F("{0} Stunden", maxAgeHours)));
        var planned = ParseVersions(plan.ConfigVersions);
        if (planned is null) return L.F("Für Planung #{0} sind keine Konfigurationsversionen gespeichert.", plan.Id);
        var changed = currentVersions.Where(kv => !planned.TryGetValue(kv.Key, out var v) || v != kv.Value).Select(kv => kv.Key)
            .Concat(planned.Keys.Where(k => !currentVersions.ContainsKey(k))).Distinct().OrderBy(k => k).ToList();
        if (changed.Count > 0)
            return L.F("Die Konfiguration wurde seit Planung #{0} geändert ({1}). Bitte neu planen.", plan.Id, string.Join(", ", changed.Select(SectionTitle)));
        return null;
    }

    public static Dictionary<string, int>? ParseVersions(string? json)
    {
        if (string.IsNullOrEmpty(json)) return null;
        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, int>>(json);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string SectionTitle(string key) => Config.ConfigCatalog.Find(key)?.Title ?? key;
}
