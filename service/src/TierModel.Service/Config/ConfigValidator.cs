using System.Text.Json;
using System.Text.Json.Nodes;

namespace TierModel.Service.Config;

public record ValidationIssue(string Severity, string Section, string Message, string? Item = null);

/// <summary>Cross-reference checks across config sections, run before a deploy and on demand.</summary>
public static class ConfigValidator
{
    public const string DomainDn = "{{DOMAIN_DN}}";

    private static readonly HashSet<string> BuiltInTargets = new(StringComparer.OrdinalIgnoreCase)
    {
        DomainDn,
        $"OU=Domain Controllers,{DomainDn}",
        $"CN=Users,{DomainDn}",
        $"CN=Computers,{DomainDn}",
    };

    private static readonly HashSet<string> WellKnownPrincipals = new(StringComparer.OrdinalIgnoreCase)
    {
        "Domain Admins", "Enterprise Admins", "Schema Admins", "Administrators", "Account Operators",
        "Server Operators", "Backup Operators", "Print Operators", "Domain Controllers",
        "Read-only Domain Controllers", "Enterprise Domain Controllers", "Authenticated Users",
        "Everyone", "SELF", "SYSTEM", "Creator Owner", "Domain Users", "Domain Computers",
        "Protected Users", "Group Policy Creator Owners",
    };

    /// <summary>Full DN of an OU entry: its <c>path</c> is the parent, either {{DOMAIN_DN}} or relative to it.</summary>
    public static string OuDn(string name, string? path) =>
        string.IsNullOrWhiteSpace(path) || path == DomainDn
            ? $"OU={name},{DomainDn}"
            : path.EndsWith(DomainDn, StringComparison.OrdinalIgnoreCase)
                ? $"OU={name},{path}"
                : $"OU={name},{path},{DomainDn}";

    public static List<ValidationIssue> Validate(IReadOnlyDictionary<string, JsonNode?> sections)
    {
        try
        {
            return ValidateCore(sections);
        }
        catch (Exception ex) when (ex is InvalidOperationException or FormatException or JsonException)
        {
            // Unexpected JSON shapes must not break the dashboard or every run.
            return [new("Error", "config", $"Die Konfiguration hat eine unerwartete Struktur: {ex.Message}")];
        }
    }

    private static List<ValidationIssue> ValidateCore(IReadOnlyDictionary<string, JsonNode?> sections)
    {
        var issues = new List<ValidationIssue>();

        var ous = Items(sections, "ous", "organizationUnits");
        var ouDns = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var ou in ous)
        {
            var name = Str(ou, "name");
            if (string.IsNullOrWhiteSpace(name))
            {
                issues.Add(new("Error", "ous", "OU ohne Namen"));
                continue;
            }
            if (!ouDns.Add(OuDn(name, Str(ou, "path"))))
                issues.Add(new("Error", "ous", "OU ist doppelt definiert", OuDn(name, Str(ou, "path"))));
        }
        foreach (var ou in ous)
        {
            var path = Str(ou, "path");
            if (string.IsNullOrWhiteSpace(path) || path == DomainDn) continue;
            var parent = path.EndsWith(DomainDn, StringComparison.OrdinalIgnoreCase) ? path : $"{path},{DomainDn}";
            if (!ouDns.Contains(parent) && !BuiltInTargets.Contains(parent))
                issues.Add(new("Error", "ous", $"Übergeordnete OU '{path}' existiert nicht", Str(ou, "name")));
        }

        bool OuKnown(string? dn) => dn is not null && (ouDns.Contains(dn) || BuiltInTargets.Contains(dn));

        var groups = Items(sections, "groups", "groups");
        var groupNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var sams = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var g in groups)
        {
            var sam = Str(g, "samaccountname");
            if (string.IsNullOrWhiteSpace(sam))
                issues.Add(new("Error", "groups", "Gruppe ohne samaccountname", Str(g, "name")));
            else if (!sams.Add(sam))
                issues.Add(new("Error", "groups", "samaccountname ist doppelt vergeben", sam));
            if (sam is not null) groupNames.Add(sam);
            if (Str(g, "name") is { } n) groupNames.Add(n);
            if (!OuKnown(Str(g, "path")))
                issues.Add(new("Warning", "groups", $"Ziel-OU '{Str(g, "path")}' ist nicht in der OU-Konfiguration", sam));
        }

        bool PrincipalKnown(string? p) => p is not null && (groupNames.Contains(p) || WellKnownPrincipals.Contains(p));

        foreach (var u in Items(sections, "users", "users"))
        {
            var sam = Str(u, "samAccountName");
            if (string.IsNullOrWhiteSpace(sam))
                issues.Add(new("Error", "users", "Benutzer ohne samAccountName"));
            else if (!sams.Add(sam))
                issues.Add(new("Error", "users", "samAccountName ist bereits vergeben", sam));
            if (!OuKnown(Str(u, "ouPath")))
                issues.Add(new("Warning", "users", $"Ziel-OU '{Str(u, "ouPath")}' ist nicht in der OU-Konfiguration", sam));
            if (u["memberOf"] is JsonArray memberOf)
                foreach (var m in memberOf)
                {
                    var group = m is JsonValue v && v.TryGetValue<string>(out var g) ? g : null;
                    if (group is null) issues.Add(new("Error", "users", "memberOf enthält einen Eintrag, der kein Gruppenname ist", sam));
                    else if (!PrincipalKnown(group)) issues.Add(new("Warning", "users", $"Gruppe '{group}' ist unbekannt", sam));
                }
        }

        foreach (var key in new[] { "acls", "msa", "gmsa", "dmsa" })
        {
            var i = 0;
            foreach (var a in Items(sections, key, "aclDelegations"))
            {
                i++;
                var target = Str(a, "targetOUPath");
                var principal = Str(a, "identityreference");
                var item = $"#{i} {principal} → {target}";
                if (!OuKnown(target))
                    issues.Add(new("Warning", key, $"Ziel-OU '{target}' ist nicht in der OU-Konfiguration", item));
                if (!PrincipalKnown(principal))
                    issues.Add(new("Warning", key, $"Principal '{principal}' ist weder eine konfigurierte Gruppe noch ein bekanntes Konto", item));
                if (a["activedirectoryrights"] is not JsonArray { Count: > 0 })
                    issues.Add(new("Error", key, "Keine Rechte angegeben", item));
            }
        }

        foreach (var w in Items(sections, "winlaps", "winLapsDelegations"))
        {
            var dn = Str(w, "ouDn");
            if (!OuKnown(dn))
                issues.Add(new("Warning", "winlaps", $"OU '{dn}' ist nicht in der OU-Konfiguration", dn));
            foreach (var field in new[] { "readGroup", "resetGroup", "decryptorGroup" })
                if (Str(w, field) is { } grp && !PrincipalKnown(grp))
                    issues.Add(new("Warning", "winlaps", $"{field} '{grp}' ist unbekannt", dn));
        }

        if (sections.GetValueOrDefault("gpos")?["gpos"] is JsonObject gpos)
            foreach (var (target, _) in gpos)
                if (target != "TemplateGpos" && !OuKnown(target))
                    issues.Add(new("Warning", "gpos", $"Verknüpfungsziel '{target}' ist nicht in der OU-Konfiguration", target));

        issues.AddRange(TierRules.Check(sections));
        return issues;
    }

    private static List<JsonObject> Items(IReadOnlyDictionary<string, JsonNode?> sections, string key, string prop) =>
        sections.GetValueOrDefault(key)?[prop] is JsonArray a ? a.OfType<JsonObject>().ToList() : [];

    private static string? Str(JsonObject o, string prop) =>
        o[prop] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
}
