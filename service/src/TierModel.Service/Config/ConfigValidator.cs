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

        ValidateAuthSilos(sections, issues, OuKnown, PrincipalKnown);

        issues.AddRange(TierRules.Check(sections));
        return issues;
    }

    public const int MinTgtLifetime = 45;
    public const int MaxTgtLifetime = 600;

    /// <summary>tiermodel-authsilos.json: unique names, TGT range and references to policies, groups and OUs.</summary>
    private static void ValidateAuthSilos(IReadOnlyDictionary<string, JsonNode?> sections, List<ValidationIssue> issues,
        Func<string?, bool> ouKnown, Func<string?, bool> principalKnown)
    {
        const string key = "authsilos";
        var policyNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in Items(sections, key, "authenticationPolicies"))
        {
            var name = Str(p, "name");
            if (string.IsNullOrWhiteSpace(name))
            {
                issues.Add(new("Error", key, "Authentifizierungsrichtlinie ohne Namen"));
                continue;
            }
            if (!policyNames.Add(name))
                issues.Add(new("Error", key, "Name der Richtlinie ist doppelt vergeben", name));
            if (p["userTgtLifetimeMins"] is JsonValue tgtValue && tgtValue.TryGetValue<int>(out var tgt) && tgt is < MinTgtLifetime or > MaxTgtLifetime)
                issues.Add(new("Error", key, $"TGT-Lebensdauer {tgt} Minuten liegt außerhalb von {MinTgtLifetime} bis {MaxTgtLifetime} Minuten", name));
            var from = p["allowedToAuthenticateFrom"] as JsonObject;
            var includeDcs = from?["includeDomainControllers"] is JsonValue dcs && dcs.TryGetValue<bool>(out var b) && b;
            var deviceGroups = StrList(from, "deviceGroups");
            if (!includeDcs && deviceGroups.Count == 0)
                issues.Add(new("Warning", key, "Richtlinie hat keine Gerätebedingung: weder Domänencontroller noch Gerätegruppen", name));
            foreach (var g in deviceGroups.Where(g => !principalKnown(g)))
                issues.Add(new("Warning", key, $"Gerätegruppe '{g}' ist nicht in der Gruppen-Konfiguration", name));
        }

        var siloNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var s in Items(sections, key, "authenticationPolicySilos"))
        {
            var name = Str(s, "name");
            if (string.IsNullOrWhiteSpace(name))
            {
                issues.Add(new("Error", key, "Silo ohne Namen"));
                continue;
            }
            if (!siloNames.Add(name))
                issues.Add(new("Error", key, "Name des Silos ist doppelt vergeben", name));
            var anyPolicy = false;
            foreach (var field in new[] { "userAuthenticationPolicy", "computerAuthenticationPolicy", "serviceAuthenticationPolicy" })
            {
                if (Str(s, field) is not { Length: > 0 } policy) continue;
                anyPolicy = true;
                if (!policyNames.Contains(policy))
                    issues.Add(new("Error", key, $"Richtlinie '{policy}' ist nicht konfiguriert", name));
            }
            if (!anyPolicy)
                issues.Add(new("Warning", key, "Silo verweist auf keine Authentifizierungsrichtlinie", name));
            var members = s["members"] as JsonObject;
            foreach (var ou in StrList(members, "userOUs").Concat(StrList(members, "computerOUs")).Where(ou => !ouKnown(ou)))
                issues.Add(new("Warning", key, $"OU '{ou}' ist nicht in der OU-Konfiguration", name));
            foreach (var g in StrList(members, "computerGroups").Where(g => !principalKnown(g)))
                issues.Add(new("Warning", key, $"Computergruppe '{g}' ist nicht in der Gruppen-Konfiguration", name));
        }

        var syncGroups = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var d in Items(sections, key, "deviceGroupSync"))
        {
            var group = Str(d, "group");
            if (string.IsNullOrWhiteSpace(group))
            {
                issues.Add(new("Error", key, "Gerätegruppen-Synchronisierung ohne Gruppe"));
                continue;
            }
            if (!syncGroups.Add(group))
                issues.Add(new("Error", key, "Gerätegruppe ist mehrfach für die Synchronisierung eingetragen", group));
            if (!principalKnown(group))
                issues.Add(new("Warning", key, $"Gerätegruppe '{group}' ist nicht in der Gruppen-Konfiguration", group));
            var sources = StrList(d, "sourceOUs");
            if (sources.Count == 0)
                issues.Add(new("Error", key, "Keine Quell-OU angegeben", group));
            foreach (var ou in sources.Where(ou => !ouKnown(ou)))
                issues.Add(new("Warning", key, $"Quell-OU '{ou}' ist nicht in der OU-Konfiguration", group));
        }
    }

    private static List<string> StrList(JsonObject? o, string prop) =>
        o?[prop] is JsonArray a ? a.OfType<JsonValue>().Select(v => v.TryGetValue<string>(out var s) ? s : null).OfType<string>().Where(s => s.Length > 0).ToList() : [];

    private static List<JsonObject> Items(IReadOnlyDictionary<string, JsonNode?> sections, string key, string prop) =>
        sections.GetValueOrDefault(key)?[prop] is JsonArray a ? a.OfType<JsonObject>().ToList() : [];

    private static string? Str(JsonObject o, string prop) =>
        o[prop] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
}
