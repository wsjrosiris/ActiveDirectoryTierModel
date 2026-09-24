using System.Text.Json.Nodes;
using TierModel.Service.Config;
using TierModel.Service.Localization;

namespace TierModel.Service.Monitoring;

/// <summary>Points subtracted from 100 per finding. Exposed by the API so the UI can explain the score.</summary>
public record ComplianceWeights(
    IReadOnlyDictionary<string, int> AuditDrift,
    int UnexpectedMember,
    IReadOnlyDictionary<string, int> Hygiene,
    int AttackPath);

public record ComplianceDeduction(string Category, string? Severity, string Label, int Count, int PointsEach, int Points);

public record TierCompliance(int Tier, int Score, List<ComplianceDeduction> Deductions);

/// <summary>An audit finding as far as the score needs it.</summary>
public record ScoredAuditFinding(string? Identifier, string? Severity);

/// <summary>
/// Compliance score 0–100 per tier (roadmap 24). Every tier starts at 100; findings subtract points and the result is
/// clamped to 0..100. Weights:
/// <list type="bullet">
/// <item>Drift findings of the latest audit: High 10, Medium 5, Low 2 points. The tier comes from the finding's identifier
/// (name or DN containing "Tier 0/1/2", <see cref="TierRules.TierOf"/>); findings without a recognizable tier are not scored.
/// A missing or unknown severity counts as Medium.</item>
/// <item>Unexpected members of protected/Tier 0 groups (latest monitor run): 15 points each, Tier 0.</item>
/// <item>Hygiene findings: High 8, Medium 4, Low 1 point; tier of the account (accounts without tier are not scored).</item>
/// <item>Attack paths to Tier 0: 20 points each, Tier 0.</item>
/// </list>
/// </summary>
public static class ComplianceCalculator
{
    public static readonly ComplianceWeights Weights = new(
        new Dictionary<string, int> { ["High"] = 10, ["Medium"] = 5, ["Low"] = 2 },
        15,
        new Dictionary<string, int> { ["High"] = 8, ["Medium"] = 4, ["Low"] = 1 },
        20);

    public static readonly int[] Tiers = [0, 1, 2];

    private static string SeverityText(string severity) => severity switch
    {
        "High" => L.T("hoch"), "Low" => L.T("niedrig"), _ => L.T("mittel"),
    };

    public static string NormalizeSeverity(string? severity) => severity?.Trim().ToLowerInvariant() switch
    {
        "high" or "hoch" or "critical" => "High",
        "low" or "niedrig" or "info" or "informational" => "Low",
        _ => "Medium",
    };

    public static List<TierCompliance> Calculate(IEnumerable<ScoredAuditFinding>? auditFindings, PrivilegedEvaluation? monitor)
    {
        var deductions = Tiers.ToDictionary(t => t, _ => new List<ComplianceDeduction>());

        if (auditFindings is not null)
            foreach (var g in auditFindings
                         .Select(f => (Tier: TierRules.TierOf(f.Identifier), Severity: NormalizeSeverity(f.Severity)))
                         .Where(x => x.Tier is not null)
                         .GroupBy(x => (x.Tier!.Value, x.Severity)))
            {
                var each = Weights.AuditDrift[g.Key.Severity];
                deductions[g.Key.Value].Add(new("audit", g.Key.Severity,
                    L.F("{0} im Audit (Schweregrad {1})", Count(g.Count(), L.TC("count", "Abweichung"), L.TC("count", "Abweichungen")), SeverityText(g.Key.Severity)), g.Count(), each, each * g.Count()));
            }

        if (monitor is not null)
        {
            if (monitor.Unexpected.Count > 0)
                deductions[0].Add(new("unexpected", null,
                    L.F("{0} in geschützten Gruppen", Count(monitor.Unexpected.Count, L.T("nicht erwartetes Mitglied"), L.T("nicht erwartete Mitglieder"))),
                    monitor.Unexpected.Count, Weights.UnexpectedMember, Weights.UnexpectedMember * monitor.Unexpected.Count));
            foreach (var g in monitor.Hygiene.Where(h => h.Tier is 0 or 1 or 2).GroupBy(h => (h.Tier!.Value, Severity: NormalizeSeverity(h.Severity))))
            {
                var each = Weights.Hygiene[g.Key.Severity];
                deductions[g.Key.Value].Add(new("hygiene", g.Key.Severity,
                    L.F("{0} (Schweregrad {1})", Count(g.Count(), L.TC("count", "Hygiene-Befund"), L.TC("count", "Hygiene-Befunde")), SeverityText(g.Key.Severity)), g.Count(), each, each * g.Count()));
            }
            if (monitor.AttackPaths.Count > 0)
                deductions[0].Add(new("attackPath", "High", L.F("{0} zu Tier 0", Count(monitor.AttackPaths.Count, L.TC("count", "Angriffspfad"), L.TC("count", "Angriffspfade"))),
                    monitor.AttackPaths.Count, Weights.AttackPath, Weights.AttackPath * monitor.AttackPaths.Count));
        }

        return Tiers.Select(t =>
        {
            var list = deductions[t].OrderByDescending(d => d.Points).ToList();
            return new TierCompliance(t, Math.Clamp(100 - list.Sum(d => d.Points), 0, 100), list);
        }).ToList();
    }

    private static string Count(int n, string singular, string plural) => $"{n} {(n == 1 ? singular : plural)}";

    /// <summary>Reads identifier and severity from a run's stored driftFindings (camelCase).</summary>
    public static List<ScoredAuditFinding> AuditFindings(string? findingsJson)
    {
        if (string.IsNullOrEmpty(findingsJson)) return [];
        try
        {
            return JsonNode.Parse(findingsJson) is JsonArray a
                ? a.OfType<JsonObject>().Select(f => new ScoredAuditFinding(Str(f, "identifier"), Str(f, "severity"))).ToList()
                : [];
        }
        catch (System.Text.Json.JsonException)
        {
            return [];
        }
    }

    private static string? Str(JsonObject o, string prop) => o[prop] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
}
