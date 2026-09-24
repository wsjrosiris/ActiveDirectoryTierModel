using System.Text.Json.Nodes;
using TierModel.Service.Config;

namespace TierModel.Service.AdView;

public record DiffEntry(string Kind, string Text);

/// <param name="Status">same, missing (only in the configuration), extra (only in AD) or different.</param>
/// <param name="SuggestedPath">For OUs only in AD: the parent in the configuration's notation (relative or {{DOMAIN_DN}}).</param>
public record OuComparison(
    string Dn, string ConfigDn, string Name, string? ParentDn, string Status, bool InConfig, bool InAd, bool Builtin, bool IsRoot,
    int? ConfigIndex, string? SuggestedPath, bool? Protected, bool? BlockInheritance,
    int DesiredAces, int ActualAces, int DesiredLinks, int ActualLinks, List<DiffEntry> Differences);

public record ComparisonSummary(int Same, int Missing, int Extra, int Different);

public record ComparisonResult(string DomainDn, List<OuComparison> Items, ComparisonSummary Summary);

/// <summary>
/// Desired state (configuration) against the live directory: OUs, their explicit ACEs and GPO links.
/// Pure: no I/O, so every kind of difference is unit tested.
/// </summary>
public static class DirectoryComparer
{
    private const string DomainToken = ConfigValidator.DomainDn;

    private record DesiredAce(string Principal, List<string> Rights, string Type, string? ObjectType, string? InheritedObjectType, string Inheritance);

    private record DesiredLink(string Name, int Order, bool Enabled);

    private record AceGroup(string Principal, string Type, string ObjectType, string InheritedObjectType, string Inheritance, long Mask);

    public static string NormalizeDn(string dn) =>
        string.Join(",", dn.Split(',').Select(p => p.Trim())).ToLowerInvariant();

    /// <summary>"CONTOSO\\Tier0Admins", "Tier0Admins" and "tier0admins@contoso" all compare as "tier0admins".</summary>
    public static string NormalizePrincipal(string principal)
    {
        var bare = TierRules.Bare(principal.Trim());
        var at = bare.IndexOf('@');
        if (at > 0) bare = bare[..at];
        return bare.ToLowerInvariant();
    }

    public static string Resolve(string configDn, string domainDn) =>
        configDn.Replace(DomainToken, domainDn, StringComparison.OrdinalIgnoreCase);

    public static ComparisonResult Compare(IReadOnlyDictionary<string, JsonNode?> config, AdSnapshot ad, GuidNames guids)
    {
        var domainDn = ad.Domain.DistinguishedName;
        var items = new List<OuComparison>();

        // ---- desired state from the configuration
        var desiredOus = new List<(string Dn, string ConfigDn, JsonObject Ou, int Index)>();
        var ous = Items(config, "ous", "organizationUnits");
        for (var i = 0; i < ous.Count; i++)
        {
            var name = Str(ous[i], "name");
            if (string.IsNullOrWhiteSpace(name)) continue;
            var configDn = ConfigValidator.OuDn(name, Str(ous[i], "path"));
            desiredOus.Add((Resolve(configDn, domainDn), configDn, ous[i], i));
        }

        var desiredAces = new Dictionary<string, List<DesiredAce>>();
        foreach (var key in new[] { "acls", "msa", "gmsa", "dmsa" })
            foreach (var a in Items(config, key, "aclDelegations"))
            {
                if (Str(a, "targetOUPath") is not { Length: > 0 } target || Str(a, "identityreference") is not { Length: > 0 } principal) continue;
                var rights = a["activedirectoryrights"] is JsonArray r ? r.Select(x => x?.ToString() ?? "").ToList() : [];
                var ace = new DesiredAce(principal, rights, Str(a, "accesscontroltype") ?? "Allow", Str(a, "objecttype"),
                    Str(a, "inheritedObjectType") ?? Str(a, "inheritedobjecttype"), Str(a, "activeDirectorysecurityinheritance") ?? "None");
                var dn = NormalizeDn(Resolve(target, domainDn));
                if (!desiredAces.TryGetValue(dn, out var list)) desiredAces[dn] = list = [];
                list.Add(ace);
            }

        var desiredLinks = new Dictionary<string, List<DesiredLink>>();
        if (config.GetValueOrDefault("gpos")?["gpos"] is JsonObject gpos)
            foreach (var (target, byKind) in gpos)
            {
                if (target == "TemplateGpos" || byKind is not JsonObject kinds) continue;
                var list = new List<DesiredLink>();
                foreach (var (_, node) in kinds)
                    foreach (var g in (node as JsonArray ?? []).OfType<JsonObject>())
                    {
                        var name = Str(g, "rename") is { Length: > 0 } renamed ? renamed : Str(g, "name");
                        if (string.IsNullOrWhiteSpace(name)) continue;
                        var order = g["linkOrder"] is JsonValue o && o.TryGetValue<int>(out var ord) ? ord : list.Count + 1;
                        var enabled = g["linkEnabled"] is not JsonValue e || !e.TryGetValue<bool>(out var en) || en;
                        list.Add(new DesiredLink(name, order, enabled));
                    }
                desiredLinks[NormalizeDn(Resolve(target, domainDn))] = list;
            }

        // ---- actual state
        var actual = ad.Ous.ToDictionary(o => NormalizeDn(o.Dn), o => o);
        var desiredByDn = new Dictionary<string, (string Dn, string ConfigDn, JsonObject Ou, int Index)>();
        foreach (var d in desiredOus) desiredByDn.TryAdd(NormalizeDn(d.Dn), d);

        // Domain root: GPO links (e.g. account restrictions) and delegations on the domain object.
        items.Add(CompareOne(ad.Root.Dn, DomainToken, ad.Domain.DnsName, null, ad.Root, null, null,
            desiredAces.GetValueOrDefault(NormalizeDn(domainDn)) ?? [], desiredLinks.GetValueOrDefault(NormalizeDn(domainDn)) ?? [],
            guids, domainDn, builtin: true, isRoot: true));

        foreach (var (key, d) in desiredByDn)
        {
            actual.TryGetValue(key, out var ou);
            items.Add(CompareOne(ou?.Dn ?? d.Dn, d.ConfigDn, Str(d.Ou, "name")!, ParentOf(d.Dn), ou, d.Ou, d.Index,
                desiredAces.GetValueOrDefault(key) ?? [], desiredLinks.GetValueOrDefault(key) ?? [], guids, domainDn, builtin: false, isRoot: false));
        }

        foreach (var (key, ou) in actual.Where(a => !desiredByDn.ContainsKey(a.Key)))
        {
            // Built-in containers the configuration refers to without defining them (e.g. the Domain Controllers OU).
            var builtin = key == NormalizeDn($"OU=Domain Controllers,{domainDn}");
            items.Add(CompareOne(ou.Dn, ToConfigDn(ou.Dn, domainDn), ou.Name, ou.ParentDn, ou, null, null,
                desiredAces.GetValueOrDefault(key) ?? [], desiredLinks.GetValueOrDefault(key) ?? [], guids, domainDn, builtin, isRoot: false));
        }

        items.Sort((a, b) => a.IsRoot != b.IsRoot ? (a.IsRoot ? -1 : 1) : string.Compare(SortKey(a.Dn), SortKey(b.Dn), StringComparison.OrdinalIgnoreCase));
        var summary = new ComparisonSummary(
            items.Count(i => i.Status == "same"), items.Count(i => i.Status == "missing"),
            items.Count(i => i.Status == "extra"), items.Count(i => i.Status == "different"));
        return new ComparisonResult(domainDn, items, summary);
    }

    /// <summary>Parent-first ordering: "DC=…,OU=Tier 0,OU=Accounts".</summary>
    private static string SortKey(string dn) => string.Join(",", dn.Split(',').Select(p => p.Trim()).Reverse());

    public static string? ParentOf(string dn)
    {
        var i = dn.IndexOf(',');
        return i < 0 ? null : dn[(i + 1)..].Trim();
    }

    public static string ToConfigDn(string dn, string domainDn) =>
        dn.EndsWith(domainDn, StringComparison.OrdinalIgnoreCase) ? dn[..^domainDn.Length] + DomainToken : dn;

    /// <summary>Parent in the notation of the OU configuration: "{{DOMAIN_DN}}" or relative without the domain.</summary>
    public static string SuggestedPath(string parentDn, string domainDn)
    {
        if (NormalizeDn(parentDn) == NormalizeDn(domainDn)) return DomainToken;
        return parentDn.EndsWith("," + domainDn, StringComparison.OrdinalIgnoreCase) ? parentDn[..^(domainDn.Length + 1)] : parentDn;
    }

    private static OuComparison CompareOne(
        string dn, string configDn, string name, string? parentDn, AdOu? ou, JsonObject? desired, int? index,
        List<DesiredAce> wantAces, List<DesiredLink> wantLinks, GuidNames guids, string domainDn, bool builtin, bool isRoot)
    {
        var diffs = new List<DiffEntry>();
        var inConfig = desired is not null;
        var actualAces = ou?.Aces.Where(a => !a.IsDefault && !IsProtectionAce(a)).ToList() ?? [];

        if (ou is null)
        {
            diffs.Add(new("ou-missing", "Die OU fehlt im Active Directory und wird beim nächsten Deploy angelegt."));
            if (wantAces.Count > 0 || wantLinks.Count > 0)
                diffs.Add(new("ou-missing", $"Danach werden {wantAces.Count} Berechtigung{(wantAces.Count == 1 ? "" : "en")} und {wantLinks.Count} GPO-Verknüpfung{(wantLinks.Count == 1 ? "" : "en")} gesetzt."));
            return new(dn, configDn, name, parentDn, "missing", true, false, builtin, isRoot, index, null,
                null, null, wantAces.Count, 0, wantLinks.Count, 0, diffs);
        }

        if (!inConfig && !builtin)
        {
            diffs.Add(new("ou-extra", "Die OU existiert nur im Active Directory und ist nicht in der Konfiguration."));
            if (actualAces.Count > 0) diffs.Add(new("ou-extra", $"Sie hat {actualAces.Count} eigene Berechtigung{(actualAces.Count == 1 ? "" : "en")}."));
            if (ou.GpoLinks.Count > 0) diffs.Add(new("ou-extra", $"Verknüpfte GPOs: {string.Join(", ", ou.GpoLinks.OrderBy(l => l.Order).Select(l => $"„{l.Name}“"))}."));
            return new(dn, configDn, name, parentDn, "extra", false, true, false, false, null,
                parentDn is null ? null : SuggestedPath(parentDn, domainDn), ou.Protected, ou.BlockInheritance,
                0, actualAces.Count, 0, ou.GpoLinks.Count, diffs);
        }

        if (desired is not null)
        {
            var wantProtect = desired["protectFromAccidentalDeletion"] is JsonValue p && p.TryGetValue<bool>(out var pv) && pv;
            var wantBlock = desired["blockGpoInheritance"] is JsonValue b && b.TryGetValue<bool>(out var bv) && bv;
            if (wantProtect != ou.Protected)
                diffs.Add(new("protect", wantProtect ? "Der Löschschutz ist im AD aus, erwartet ist an." : "Der Löschschutz ist im AD an, erwartet ist aus."));
            if (wantBlock != ou.BlockInheritance)
                diffs.Add(new("block-inheritance", wantBlock ? "Die GPO-Vererbung ist im AD nicht blockiert, erwartet ist blockiert." : "Die GPO-Vererbung ist im AD blockiert, erwartet ist nicht blockiert."));
        }

        CompareAces(wantAces, actualAces, guids, diffs);
        CompareLinks(wantLinks, ou.GpoLinks, diffs);

        return new(dn, configDn, name, parentDn, diffs.Count == 0 ? "same" : "different", inConfig, true, builtin, isRoot, index, null,
            ou.Protected, ou.BlockInheritance, wantAces.Count, actualAces.Count, wantLinks.Count, ou.GpoLinks.Count, diffs);
    }

    /// <summary>The "protect from accidental deletion" deny ACE for Everyone is shown as the protection flag, not as an ACE.</summary>
    public static bool IsProtectionAce(AdAce a)
    {
        if (!string.Equals(a.Type, "Deny", StringComparison.OrdinalIgnoreCase)) return false;
        var everyone = a.PrincipalSid == "S-1-1-0" || NormalizePrincipal(a.Principal) == "everyone";
        var mask = AdRights.Mask(a.Rights);
        return everyone && mask != 0 && (mask & ~AdRights.DeleteRights) == 0;
    }

    private static void CompareAces(List<DesiredAce> want, List<AdAce> have, GuidNames guids, List<DiffEntry> diffs)
    {
        // AD merges entries that differ only in their rights into one ACE, so compare the combined rights per
        // principal, type, object type, inherited object type and inheritance.
        static Dictionary<string, AceGroup> Group(IEnumerable<AceGroup> aces)
        {
            var d = new Dictionary<string, AceGroup>();
            foreach (var a in aces)
            {
                var k = $"{a.Principal}|{a.Type}|{a.ObjectType}|{a.InheritedObjectType}|{a.Inheritance}";
                d[k] = d.TryGetValue(k, out var g) ? g with { Mask = g.Mask | a.Mask } : a;
            }
            return d;
        }

        var wanted = Group(want.Select(a => new AceGroup(NormalizePrincipal(a.Principal), a.Type.ToLowerInvariant(),
            guids.Key(a.ObjectType), guids.Key(a.InheritedObjectType), a.Inheritance.ToLowerInvariant(), AdRights.Mask(a.Rights))));
        var actual = Group(have.Select(a => new AceGroup(NormalizePrincipal(a.Principal), a.Type.ToLowerInvariant(),
            guids.Key(a.ObjectType is { Length: > 0 } ? a.ObjectType : a.ObjectTypeGuid),
            guids.Key(a.InheritedObjectType is { Length: > 0 } ? a.InheritedObjectType : a.InheritedObjectTypeGuid),
            a.Inheritance.ToLowerInvariant(), AdRights.Mask(a.Rights))));
        var display = want.GroupBy(a => NormalizePrincipal(a.Principal)).ToDictionary(g => g.Key, g => g.First().Principal);
        foreach (var a in have) display.TryAdd(NormalizePrincipal(a.Principal), a.Principal);

        foreach (var (k, w) in wanted)
        {
            if (!actual.TryGetValue(k, out var h))
                diffs.Add(new("ace-missing", $"Berechtigung fehlt im AD: {Describe(w, display, guids)}."));
            else if (h.Mask != w.Mask)
                diffs.Add(new("ace-rights", $"Rechte von „{display[w.Principal]}“ {ObjectText(w, guids)} weichen ab: erwartet {string.Join(", ", AdRights.Names(w.Mask))}, im AD {string.Join(", ", AdRights.Names(h.Mask))}."));
        }
        foreach (var (k, h) in actual.Where(a => !wanted.ContainsKey(a.Key)))
            diffs.Add(new("ace-extra", $"Zusätzliche Berechtigung im AD: {Describe(h, display, guids)}."));
    }

    private static string Describe(AceGroup a, Dictionary<string, string> display, GuidNames guids) =>
        $"„{display.GetValueOrDefault(a.Principal, a.Principal)}“ {(a.Type == "deny" ? "verweigert" : "erhält")} {string.Join(", ", AdRights.Names(a.Mask))} {ObjectText(a, guids)}, {InheritanceText(a.Inheritance)}";

    private static string ObjectText(AceGroup a, GuidNames guids)
    {
        var obj = guids.NameOf(a.ObjectType) is { Length: > 0 } n ? n : a.ObjectType;
        var inh = guids.NameOf(a.InheritedObjectType) is { Length: > 0 } m ? m : a.InheritedObjectType;
        var text = obj.Length == 0 ? "für alle Objekte" : $"für „{obj}“";
        return inh.Length == 0 ? text : $"{text} auf „{inh}“-Objekten";
    }

    public static string InheritanceText(string inheritance) => inheritance.ToLowerInvariant() switch
    {
        "none" => "nur für dieses Objekt",
        "all" => "für dieses Objekt und alle Nachfolger",
        "descendents" => "nur für Nachfolger",
        "selfandchildren" => "für dieses Objekt und direkte Kinder",
        "children" => "nur für direkte Kinder",
        _ => $"Vererbung {inheritance}",
    };

    private static void CompareLinks(List<DesiredLink> want, List<AdGpoLink> have, List<DiffEntry> diffs)
    {
        var haveByName = have.GroupBy(l => l.Name, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        var wantByName = want.GroupBy(l => l.Name, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

        foreach (var w in want.Where(w => !haveByName.ContainsKey(w.Name)))
            diffs.Add(new("gpo-missing", $"GPO-Verknüpfung fehlt im AD: „{w.Name}“ (Reihenfolge {w.Order})."));
        foreach (var h in have.Where(h => !wantByName.ContainsKey(h.Name)))
            diffs.Add(new("gpo-extra", $"Zusätzliche GPO-Verknüpfung im AD: „{h.Name}“ (Reihenfolge {h.Order})."));

        // Order: compare the rank among links present on both sides, so one extra link does not shift everything.
        var common = want.Where(w => haveByName.ContainsKey(w.Name)).ToList();
        var wantRank = common.OrderBy(w => w.Order).Select((w, i) => (w.Name, i)).ToDictionary(x => x.Name, x => x.i, StringComparer.OrdinalIgnoreCase);
        var haveRank = common.Select(w => haveByName[w.Name]).OrderBy(h => h.Order).Select((h, i) => (h.Name, i)).ToDictionary(x => x.Name, x => x.i, StringComparer.OrdinalIgnoreCase);
        foreach (var w in common)
        {
            var h = haveByName[w.Name];
            if (wantRank[w.Name] != haveRank[h.Name])
                diffs.Add(new("gpo-order", $"Reihenfolge von „{w.Name}“ weicht ab: erwartet {w.Order}, im AD {h.Order}."));
            if (w.Enabled != h.Enabled)
                diffs.Add(new("gpo-enabled", $"Verknüpfung „{w.Name}“ ist im AD {(h.Enabled ? "aktiviert" : "deaktiviert")}, erwartet {(w.Enabled ? "aktiviert" : "deaktiviert")}."));
        }
    }

    private static List<JsonObject> Items(IReadOnlyDictionary<string, JsonNode?> sections, string key, string prop) =>
        sections.GetValueOrDefault(key)?[prop] is JsonArray a ? a.OfType<JsonObject>().ToList() : [];

    private static string? Str(JsonObject o, string prop) =>
        o[prop] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
}
