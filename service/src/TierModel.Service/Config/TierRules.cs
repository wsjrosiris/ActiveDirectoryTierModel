using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace TierModel.Service.Config;

/// <summary>
/// Tier-model rules: control must never flow from a less privileged tier to a more privileged one.
/// Tiers are derived from names and DNs ("Tier 0", "Tier0Admins"); objects without a recognizable tier are skipped.
/// </summary>
public static partial class TierRules
{
    /// <summary>Principals that are Tier 0 by definition.</summary>
    private static readonly HashSet<string> Tier0Principals = new(StringComparer.OrdinalIgnoreCase)
    {
        "Domain Admins", "Enterprise Admins", "Schema Admins", "Administrators", "Administrator", "Account Operators",
        "Server Operators", "Backup Operators", "Print Operators", "Domain Controllers", "Read-only Domain Controllers",
        "Enterprise Domain Controllers", "Enterprise Read-only Domain Controllers", "Group Policy Creator Owners",
        "Key Admins", "Enterprise Key Admins", "Cert Publishers", "DnsAdmins", "SYSTEM",
    };

    /// <summary>Principals that contain (nearly) every account: less trusted than any tier.</summary>
    private static readonly HashSet<string> BroadPrincipals = new(StringComparer.OrdinalIgnoreCase)
    {
        "Everyone", "Authenticated Users", "Domain Users", "Domain Computers", "Users", "Guests", "Domain Guests",
        "ANONYMOUS LOGON", "Interactive", "Network",
    };

    /// <summary>Rights that allow changing objects; read-only delegations never violate the model.</summary>
    private static readonly HashSet<string> WriteRights = new(StringComparer.OrdinalIgnoreCase)
    {
        "GenericAll", "GenericWrite", "WriteProperty", "WriteDacl", "WriteOwner", "CreateChild", "DeleteChild",
        "Delete", "DeleteTree", "ExtendedRight", "Self",
    };

    /// <summary>Tier 3 stands for broad groups such as "Authenticated Users" – below every tier.</summary>
    public const int Broad = 3;

    [GeneratedRegex(@"tier\s*([012])(?![0-9])", RegexOptions.IgnoreCase)]
    private static partial Regex TierPattern();

    /// <summary>Tier found in a name or DN ("Tier 1 Servers", "Tier0Admins"); null if none.</summary>
    public static int? TierOf(string? text) =>
        text is not null && TierPattern().Match(text) is { Success: true } m ? m.Groups[1].Value[0] - '0' : null;

    /// <summary>Tier of a link or delegation target; the domain root and the DC OU are Tier 0.</summary>
    public static int? TargetTier(string? dn)
    {
        if (dn is null) return null;
        if (dn.Equals(ConfigValidator.DomainDn, StringComparison.OrdinalIgnoreCase)
            || dn.StartsWith("OU=Domain Controllers,", StringComparison.OrdinalIgnoreCase))
            return 0;
        return TierOf(dn);
    }

    private static string Bare(string principal)
    {
        var i = principal.LastIndexOf('\\');
        return i >= 0 ? principal[(i + 1)..] : principal;
    }

    private static string TierLabel(int tier) => tier == Broad ? "eine breite Gruppe" : $"Tier {tier}";

    public static List<ValidationIssue> Check(IReadOnlyDictionary<string, JsonNode?> sections)
    {
        var issues = new List<ValidationIssue>();

        // Tier of each configured group, addressable by samAccountName and name.
        var groupTiers = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var g in Items(sections, "groups", "groups"))
        {
            var tier = TierOf(Str(g, "name")) ?? TierOf(Str(g, "samaccountname")) ?? TierOf(Str(g, "path"));
            if (tier is null) continue;
            if (Str(g, "samaccountname") is { } sam) groupTiers[sam] = tier.Value;
            if (Str(g, "name") is { } name) groupTiers[name] = tier.Value;
        }

        int? PrincipalTier(string? principal)
        {
            if (string.IsNullOrWhiteSpace(principal)) return null;
            var bare = Bare(principal);
            if (Tier0Principals.Contains(bare)) return 0;
            if (BroadPrincipals.Contains(bare)) return Broad;
            return groupTiers.TryGetValue(bare, out var t) ? t : TierOf(bare);
        }

        // Delegations: a principal may only hold write rights on OUs of its own or a less privileged tier.
        foreach (var key in new[] { "acls", "msa", "gmsa", "dmsa" })
        {
            var i = 0;
            foreach (var a in Items(sections, key, "aclDelegations"))
            {
                i++;
                if (string.Equals(Str(a, "accesscontroltype"), "Deny", StringComparison.OrdinalIgnoreCase)) continue;
                var rights = a["activedirectoryrights"] is JsonArray r ? r.Select(x => x?.ToString() ?? "").ToList() : [];
                if (!rights.Any(WriteRights.Contains)) continue;
                var target = Str(a, "targetOUPath");
                var principal = Str(a, "identityreference");
                if (TargetTier(target) is not { } targetTier || PrincipalTier(principal) is not { } principalTier) continue;
                if (principalTier > targetTier)
                    issues.Add(new("Error", key,
                        $"Tier-Verstoß: '{principal}' ({TierLabel(principalTier)}) erhält Schreibrechte auf eine Tier-{targetTier}-OU",
                        $"#{i} {principal} → {target}"));
            }
        }

        // Accounts: never in a group of a more privileged tier, and preferably only in their own tier.
        foreach (var u in Items(sections, "users", "users"))
        {
            var sam = Str(u, "samAccountName");
            if (TierOf(Str(u, "ouPath")) is not { } userTier || u["memberOf"] is not JsonArray memberOf) continue;
            foreach (var m in memberOf)
            {
                var group = m?.ToString();
                if (PrincipalTier(group) is not { } groupTier || groupTier == Broad || groupTier == userTier) continue;
                issues.Add(groupTier < userTier
                    ? new("Error", "users", $"Tier-Verstoß: Konto aus Tier {userTier} wird Mitglied der Tier-{groupTier}-Gruppe '{group}'", sam)
                    : new("Warning", "users", $"Konto aus Tier {userTier} ist Mitglied der Tier-{groupTier}-Gruppe '{group}' – Konten sollten nur in ihrem eigenen Tier verwendet werden", sam));
            }
        }

        // Windows LAPS: reading or resetting passwords of a tier is administration of that tier.
        foreach (var w in Items(sections, "winlaps", "winLapsDelegations"))
        {
            var dn = Str(w, "ouDn");
            if (TargetTier(dn) is not { } ouTier) continue;
            foreach (var field in new[] { "readGroup", "resetGroup", "decryptorGroup" })
                if (PrincipalTier(Str(w, field)) is { } groupTier && groupTier > ouTier)
                    issues.Add(new("Error", "winlaps",
                        $"Tier-Verstoß: {FieldLabel(field)} '{Str(w, field)}' ({TierLabel(groupTier)}) für eine Tier-{ouTier}-OU", dn));
        }

        // GPOs of one tier linked to an OU of another tier are almost always a mistake.
        if (sections.GetValueOrDefault("gpos")?["gpos"] is JsonObject gpos)
            foreach (var (target, lists) in gpos)
            {
                if (target == "TemplateGpos" || TargetTier(target) is not { } targetTier || lists is not JsonObject byKind) continue;
                // The domain root and the DC OU carry domain-wide GPOs; only tier OUs are compared.
                if (TierOf(target) is null) continue;
                foreach (var (_, list) in byKind)
                    foreach (var gpo in (list as JsonArray ?? []).OfType<JsonObject>())
                        if (TierOf(Str(gpo, "name")) is { } gpoTier && gpoTier != targetTier)
                            issues.Add(new("Warning", "gpos",
                                $"GPO '{Str(gpo, "name")}' (Tier {gpoTier}) ist mit einer Tier-{targetTier}-OU verknüpft", target));
            }

        return issues;
    }

    private static string FieldLabel(string field) => field switch
    {
        "readGroup" => "Lesegruppe",
        "resetGroup" => "Zurücksetzen-Gruppe",
        _ => "Entschlüsselungsgruppe",
    };

    private static List<JsonObject> Items(IReadOnlyDictionary<string, JsonNode?> sections, string key, string prop) =>
        sections.GetValueOrDefault(key)?[prop] is JsonArray a ? a.OfType<JsonObject>().ToList() : [];

    private static string? Str(JsonObject o, string prop) =>
        o[prop] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
}
