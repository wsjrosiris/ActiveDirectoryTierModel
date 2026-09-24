using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using TierModel.Service.Localization;

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

    /// <summary>Whether a principal ("CONTOSO\\Domain Admins" or "Domain Admins") is Tier 0 by definition (built-in English names).</summary>
    public static bool IsBuiltinTier0Principal(string? principal) =>
        !string.IsNullOrWhiteSpace(principal) && Tier0Principals.Contains(Bare(principal));

    public static string Bare(string principal)
    {
        var i = principal.LastIndexOf('\\');
        return i >= 0 ? principal[(i + 1)..] : principal;
    }

    private static string TierLabel(int tier) => tier == Broad ? L.T("eine breite Gruppe") : $"Tier {tier}";

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
                        L.F("Tier-Verstoß: '{0}' ({1}) erhält Schreibrechte auf eine Tier-{2}-OU", principal, TierLabel(principalTier), targetTier),
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
                    ? new("Error", "users", L.F("Tier-Verstoß: Konto aus Tier {0} wird Mitglied der Tier-{1}-Gruppe '{2}'", userTier, groupTier, group), sam)
                    : new("Warning", "users", L.F("Konto aus Tier {0} ist Mitglied der Tier-{1}-Gruppe '{2}' – Konten sollten nur in ihrem eigenen Tier verwendet werden", userTier, groupTier, group), sam));
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
                        L.F("Tier-Verstoß: {0} '{1}' ({2}) für eine Tier-{3}-OU", FieldLabel(field), Str(w, field), TierLabel(groupTier), ouTier), dn));
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
                                L.F("GPO '{0}' (Tier {1}) ist mit einer Tier-{2}-OU verknüpft", Str(gpo, "name"), gpoTier, targetTier), target));
            }

        CheckAuthSilos(sections, issues, PrincipalTier);
        return issues;
    }

    private static int? ExplicitTier(JsonObject o) =>
        o["tier"] is JsonValue v && v.TryGetValue<int>(out var t) && t is >= 0 and <= 2 ? t : null;

    /// <summary>
    /// Authentication silos: the devices a tier's accounts may sign in from must belong to the same tier.
    /// A Tier 0 policy that allows sign-in from Tier 1/2 devices exposes Tier 0 credentials there.
    /// </summary>
    private static void CheckAuthSilos(IReadOnlyDictionary<string, JsonNode?> sections, List<ValidationIssue> issues, Func<string?, int?> principalTier)
    {
        const string key = "authsilos";
        var policyGroups = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in Items(sections, key, "authenticationPolicies"))
        {
            var name = Str(p, "name");
            if (string.IsNullOrWhiteSpace(name)) continue;
            var groups = StrList(p["allowedToAuthenticateFrom"] as JsonObject, "deviceGroups");
            policyGroups[name] = groups;
            if ((ExplicitTier(p) ?? TierOf(name)) is not { } tier) continue;
            foreach (var g in groups)
                if (principalTier(g) is { } groupTier && groupTier != Broad && groupTier != tier)
                    issues.Add(groupTier > tier
                        ? new("Error", key, L.F("Tier-Verstoß: Tier-{0}-Richtlinie erlaubt die Anmeldung von Tier-{1}-Geräten ('{2}')", tier, groupTier, g), name)
                        : new("Warning", key, L.F("Tier-{0}-Richtlinie erlaubt die Anmeldung von Tier-{1}-Geräten ('{2}') – Geräte sollten zum eigenen Tier gehören", tier, groupTier, g), name));
                else if (principalTier(g) == Broad)
                    issues.Add(new("Error", key, L.F("Tier-Verstoß: Richtlinie erlaubt die Anmeldung von allen Geräten der breiten Gruppe '{0}'", g), name));
        }

        foreach (var s in Items(sections, key, "authenticationPolicySilos"))
        {
            var name = Str(s, "name");
            if (string.IsNullOrWhiteSpace(name) || (ExplicitTier(s) ?? TierOf(name)) is not { } tier) continue;
            foreach (var field in new[] { "userAuthenticationPolicy", "computerAuthenticationPolicy", "serviceAuthenticationPolicy" })
            {
                if (Str(s, field) is not { Length: > 0 } policy || !policyGroups.TryGetValue(policy, out var groups)) continue;
                foreach (var g in groups)
                    if (principalTier(g) is { } groupTier && groupTier > tier)
                        issues.Add(new("Error", key, L.F("Tier-Verstoß: Tier-{0}-Silo erlaubt über '{1}' die Anmeldung von Tier-{2}-Geräten ('{3}')", tier, policy, groupTier, g), name));
            }
            var members = s["members"] as JsonObject;
            foreach (var g in StrList(members, "computerGroups"))
                if (principalTier(g) is { } groupTier && groupTier > tier)
                    issues.Add(new("Error", key, L.F("Tier-Verstoß: Computer der Tier-{0}-Gruppe '{1}' werden in ein Tier-{2}-Silo aufgenommen", groupTier, g, tier), name));
            foreach (var ou in StrList(members, "userOUs").Concat(StrList(members, "computerOUs")))
                if (TargetTier(ou) is { } ouTier && ouTier > tier)
                    issues.Add(new("Error", key, L.F("Tier-Verstoß: Konten aus einer Tier-{0}-OU werden in ein Tier-{1}-Silo aufgenommen", ouTier, tier), name));
        }

        foreach (var d in Items(sections, key, "deviceGroupSync"))
        {
            var group = Str(d, "group");
            if (string.IsNullOrWhiteSpace(group) || (ExplicitTier(d) ?? principalTier(group)) is not { } groupTier || groupTier == Broad) continue;
            foreach (var ou in StrList(d, "sourceOUs"))
                if (TargetTier(ou) is { } ouTier && ouTier > groupTier)
                    issues.Add(new("Error", key, L.F("Tier-Verstoß: Computer aus einer Tier-{0}-OU werden in die Tier-{1}-Gerätegruppe '{2}' aufgenommen", ouTier, groupTier, group), group));
        }
    }

    private static List<string> StrList(JsonObject? o, string prop) =>
        o?[prop] is JsonArray a ? a.OfType<JsonValue>().Select(v => v.TryGetValue<string>(out var s) ? s : null).OfType<string>().Where(s => s.Length > 0).ToList() : [];

    private static string FieldLabel(string field) => field switch
    {
        "readGroup" => L.T("Lesegruppe"),
        "resetGroup" => L.T("Zurücksetzen-Gruppe"),
        _ => L.T("Entschlüsselungsgruppe"),
    };

    private static List<JsonObject> Items(IReadOnlyDictionary<string, JsonNode?> sections, string key, string prop) =>
        sections.GetValueOrDefault(key)?[prop] is JsonArray a ? a.OfType<JsonObject>().ToList() : [];

    private static string? Str(JsonObject o, string prop) =>
        o[prop] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
}
