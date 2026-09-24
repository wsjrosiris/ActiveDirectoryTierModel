using System.Text.Json;
using System.Text.Json.Nodes;
using TierModel.Service.Localization;

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
            return [new("Error", "config", L.F("Die Konfiguration hat eine unerwartete Struktur: {0}", ex.Message))];
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
                issues.Add(new("Error", "ous", L.T("OU ohne Namen")));
                continue;
            }
            if (!ouDns.Add(OuDn(name, Str(ou, "path"))))
                issues.Add(new("Error", "ous", L.T("OU ist doppelt definiert"), OuDn(name, Str(ou, "path"))));
        }
        foreach (var ou in ous)
        {
            var path = Str(ou, "path");
            if (string.IsNullOrWhiteSpace(path) || path == DomainDn) continue;
            var parent = path.EndsWith(DomainDn, StringComparison.OrdinalIgnoreCase) ? path : $"{path},{DomainDn}";
            if (!ouDns.Contains(parent) && !BuiltInTargets.Contains(parent))
                issues.Add(new("Error", "ous", L.F("Übergeordnete OU '{0}' existiert nicht", path), Str(ou, "name")));
        }

        bool OuKnown(string? dn) => dn is not null && (ouDns.Contains(dn) || BuiltInTargets.Contains(dn));

        var groups = Items(sections, "groups", "groups");
        var groupNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var sams = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var g in groups)
        {
            var sam = Str(g, "samaccountname");
            if (string.IsNullOrWhiteSpace(sam))
                issues.Add(new("Error", "groups", L.T("Gruppe ohne samaccountname"), Str(g, "name")));
            else if (!sams.Add(sam))
                issues.Add(new("Error", "groups", L.T("samaccountname ist doppelt vergeben"), sam));
            if (sam is not null) groupNames.Add(sam);
            if (Str(g, "name") is { } n) groupNames.Add(n);
            if (!OuKnown(Str(g, "path")))
                issues.Add(new("Warning", "groups", L.F("Ziel-OU '{0}' ist nicht in der OU-Konfiguration", Str(g, "path")), sam));
        }

        bool PrincipalKnown(string? p) => p is not null && (groupNames.Contains(p) || WellKnownPrincipals.Contains(p));

        foreach (var u in Items(sections, "users", "users"))
        {
            var sam = Str(u, "samAccountName");
            if (string.IsNullOrWhiteSpace(sam))
                issues.Add(new("Error", "users", L.T("Benutzer ohne samAccountName")));
            else if (!sams.Add(sam))
                issues.Add(new("Error", "users", L.T("samAccountName ist bereits vergeben"), sam));
            if (!OuKnown(Str(u, "ouPath")))
                issues.Add(new("Warning", "users", L.F("Ziel-OU '{0}' ist nicht in der OU-Konfiguration", Str(u, "ouPath")), sam));
            if (u["memberOf"] is JsonArray memberOf)
                foreach (var m in memberOf)
                {
                    var group = m is JsonValue v && v.TryGetValue<string>(out var g) ? g : null;
                    if (group is null) issues.Add(new("Error", "users", L.T("memberOf enthält einen Eintrag, der kein Gruppenname ist"), sam));
                    else if (!PrincipalKnown(group)) issues.Add(new("Warning", "users", L.F("Gruppe '{0}' ist unbekannt", group), sam));
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
                    issues.Add(new("Warning", key, L.F("Ziel-OU '{0}' ist nicht in der OU-Konfiguration", target), item));
                if (!PrincipalKnown(principal))
                    issues.Add(new("Warning", key, L.F("Principal '{0}' ist weder eine konfigurierte Gruppe noch ein bekanntes Konto", principal), item));
                if (a["activedirectoryrights"] is not JsonArray { Count: > 0 })
                    issues.Add(new("Error", key, L.T("Keine Rechte angegeben"), item));
            }
        }

        foreach (var w in Items(sections, "winlaps", "winLapsDelegations"))
        {
            var dn = Str(w, "ouDn");
            if (!OuKnown(dn))
                issues.Add(new("Warning", "winlaps", L.F("OU '{0}' ist nicht in der OU-Konfiguration", dn), dn));
            foreach (var field in new[] { "readGroup", "resetGroup", "decryptorGroup" })
                if (Str(w, field) is { } grp && !PrincipalKnown(grp))
                    issues.Add(new("Warning", "winlaps", L.F("{0} '{1}' ist unbekannt", field, grp), dn));
        }

        if (sections.GetValueOrDefault("gpos")?["gpos"] is JsonObject gpos)
            foreach (var (target, _) in gpos)
                if (target != "TemplateGpos" && !OuKnown(target))
                    issues.Add(new("Warning", "gpos", L.F("Verknüpfungsziel '{0}' ist nicht in der OU-Konfiguration", target), target));

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
                issues.Add(new("Error", key, L.T("Authentifizierungsrichtlinie ohne Namen")));
                continue;
            }
            if (!policyNames.Add(name))
                issues.Add(new("Error", key, L.T("Name der Richtlinie ist doppelt vergeben"), name));
            if (p["userTgtLifetimeMins"] is JsonValue tgtValue && tgtValue.TryGetValue<int>(out var tgt) && tgt is < MinTgtLifetime or > MaxTgtLifetime)
                issues.Add(new("Error", key, L.F("TGT-Lebensdauer {0} Minuten liegt außerhalb von {1} bis {2} Minuten", tgt, MinTgtLifetime, MaxTgtLifetime), name));
            var from = p["allowedToAuthenticateFrom"] as JsonObject;
            var includeDcs = from?["includeDomainControllers"] is JsonValue dcs && dcs.TryGetValue<bool>(out var b) && b;
            var deviceGroups = StrList(from, "deviceGroups");
            if (!includeDcs && deviceGroups.Count == 0)
                issues.Add(new("Warning", key, L.T("Richtlinie hat keine Gerätebedingung: weder Domänencontroller noch Gerätegruppen"), name));
            foreach (var g in deviceGroups.Where(g => !principalKnown(g)))
                issues.Add(new("Warning", key, L.F("Gerätegruppe '{0}' ist nicht in der Gruppen-Konfiguration", g), name));
        }

        var siloNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var s in Items(sections, key, "authenticationPolicySilos"))
        {
            var name = Str(s, "name");
            if (string.IsNullOrWhiteSpace(name))
            {
                issues.Add(new("Error", key, L.T("Silo ohne Namen")));
                continue;
            }
            if (!siloNames.Add(name))
                issues.Add(new("Error", key, L.T("Name des Silos ist doppelt vergeben"), name));
            var anyPolicy = false;
            foreach (var field in new[] { "userAuthenticationPolicy", "computerAuthenticationPolicy", "serviceAuthenticationPolicy" })
            {
                if (Str(s, field) is not { Length: > 0 } policy) continue;
                anyPolicy = true;
                if (!policyNames.Contains(policy))
                    issues.Add(new("Error", key, L.F("Richtlinie '{0}' ist nicht konfiguriert", policy), name));
            }
            if (!anyPolicy)
                issues.Add(new("Warning", key, L.T("Silo verweist auf keine Authentifizierungsrichtlinie"), name));
            var members = s["members"] as JsonObject;
            foreach (var ou in StrList(members, "userOUs").Concat(StrList(members, "computerOUs")).Where(ou => !ouKnown(ou)))
                issues.Add(new("Warning", key, L.F("OU '{0}' ist nicht in der OU-Konfiguration", ou), name));
            foreach (var g in StrList(members, "computerGroups").Where(g => !principalKnown(g)))
                issues.Add(new("Warning", key, L.F("Computergruppe '{0}' ist nicht in der Gruppen-Konfiguration", g), name));
        }

        var syncGroups = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var d in Items(sections, key, "deviceGroupSync"))
        {
            var group = Str(d, "group");
            if (string.IsNullOrWhiteSpace(group))
            {
                issues.Add(new("Error", key, L.T("Gerätegruppen-Synchronisierung ohne Gruppe")));
                continue;
            }
            if (!syncGroups.Add(group))
                issues.Add(new("Error", key, L.T("Gerätegruppe ist mehrfach für die Synchronisierung eingetragen"), group));
            if (!principalKnown(group))
                issues.Add(new("Warning", key, L.F("Gerätegruppe '{0}' ist nicht in der Gruppen-Konfiguration", group), group));
            var sources = StrList(d, "sourceOUs");
            if (sources.Count == 0)
                issues.Add(new("Error", key, L.T("Keine Quell-OU angegeben"), group));
            foreach (var ou in sources.Where(ou => !ouKnown(ou)))
                issues.Add(new("Warning", key, L.F("Quell-OU '{0}' ist nicht in der OU-Konfiguration", ou), group));
        }
    }

    private static List<string> StrList(JsonObject? o, string prop) =>
        o?[prop] is JsonArray a ? a.OfType<JsonValue>().Select(v => v.TryGetValue<string>(out var s) ? s : null).OfType<string>().Where(s => s.Length > 0).ToList() : [];

    private static List<JsonObject> Items(IReadOnlyDictionary<string, JsonNode?> sections, string key, string prop) =>
        sections.GetValueOrDefault(key)?[prop] is JsonArray a ? a.OfType<JsonObject>().ToList() : [];

    private static string? Str(JsonObject o, string prop) =>
        o[prop] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
}
