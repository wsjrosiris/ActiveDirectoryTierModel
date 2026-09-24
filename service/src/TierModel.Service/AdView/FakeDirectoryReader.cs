using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using TierModel.Service.Config;

namespace TierModel.Service.AdView;

/// <summary>
/// Development and test stand-in (TierModel:FakeDirectory=true): a deterministic domain contoso.local built from the
/// framework's shipped configuration files, with four deliberate differences so the comparison has something to show:
/// the OU "Tier 2 PAW Devices" is missing, "Legacy Servers" exists only in AD, "CONTOSO\Helpdesk" has an extra ACE on
/// "Tier 0 Member Servers" and the GPO "Legacy Drive Mappings" is additionally linked to "Tier 1 Member Servers".
/// </summary>
public sealed class FakeDirectoryReader : IDirectoryReader
{
    public const string DomainDn = "DC=contoso,DC=local";
    public const string MissingOu = "Tier 2 PAW Devices";
    public const string ExtraOuDn = "OU=Legacy Servers," + DomainDn;
    public const string ExtraAceOuDn = "OU=Tier 0 Member Servers," + DomainDn;
    public const string ExtraAcePrincipal = @"CONTOSO\Helpdesk";
    public const string ExtraLinkOuDn = "OU=Tier 1 Member Servers," + DomainDn;
    public const string ExtraLinkGpo = "Legacy Drive Mappings";

    private readonly string _configDir;
    private readonly Lazy<Model> _model;

    public FakeDirectoryReader(IOptions<TierModelOptions> options) : this(Path.Combine(options.Value.FrameworkPath, "config")) { }

    public FakeDirectoryReader(string configDir)
    {
        _configDir = configDir;
        _model = new Lazy<Model>(Build);
    }

    public string Source => "Testdaten";
    public bool Available => true;

    private sealed record Model(AdSnapshot Snapshot, Dictionary<string, string> Classes, Dictionary<string, List<AdMember>> Members, Dictionary<string, string> FakeGuids);

    public static AdDomainInfo Domain => new("contoso.local", DomainDn, "CONTOSO", "Windows2016Domain", "Windows2016Forest", "contoso.local",
        [new("dc01.contoso.local", "Default-First-Site-Name", true), new("dc02.contoso.local", "Default-First-Site-Name", true), new("dc03.contoso.local", "Aussenstelle-Nord", false)]);

    public AdSnapshot ReadSnapshot(int maxOus)
    {
        var s = _model.Value.Snapshot;
        return s.Ous.Count > maxOus ? s with { Ous = s.Ous.Take(maxOus).ToList(), Truncated = true } : s;
    }

    public AdObjectCounts CountChildren(string ouDn)
    {
        var name = ouDn.Split(',')[0];
        var h = Hash(ouDn);
        int Pick(params string[] words) => words.Any(w => name.Contains(w, StringComparison.OrdinalIgnoreCase)) ? 2 + h % 9 : 0;
        return new(Pick("Accounts", "Users", "VPN"), Pick("Groups"), Pick("Servers", "Devices", "Staging", "Quarantine", "Controllers"), h % 2);
    }

    public string? ObjectClass(string dn) => _model.Value.Classes.GetValueOrDefault(DirectoryComparer.NormalizeDn(dn));

    public List<AdMember> GroupMembers(string groupDn, int max) =>
        (_model.Value.Members.GetValueOrDefault(DirectoryComparer.NormalizeDn(groupDn)) ?? []).Take(max).ToList();

    public List<AdAce> Aces(string dn)
    {
        var key = DirectoryComparer.NormalizeDn(dn);
        var m = _model.Value;
        if (DirectoryComparer.NormalizeDn(m.Snapshot.Root.Dn) == key) return m.Snapshot.Root.Aces;
        if (m.Snapshot.Ous.FirstOrDefault(o => DirectoryComparer.NormalizeDn(o.Dn) == key) is { } ou) return ou.Aces;
        return m.Classes.ContainsKey(key) ? DefaultAces() : [];
    }

    public Dictionary<string, string> ResolveGuids(IEnumerable<string> guids)
    {
        var byGuid = _model.Value.FakeGuids.ToDictionary(kv => kv.Value, kv => kv.Key, StringComparer.OrdinalIgnoreCase);
        return guids.Where(byGuid.ContainsKey).Distinct(StringComparer.OrdinalIgnoreCase).ToDictionary(g => g, g => byGuid[g], StringComparer.OrdinalIgnoreCase);
    }

    private static int Hash(string s) => BitConverter.ToUInt16(SHA256.HashData(Encoding.UTF8.GetBytes(s.ToLowerInvariant())), 0);

    private static List<AdAce> DefaultAces() =>
    [
        new(@"NT AUTHORITY\SYSTEM", "S-1-5-18", ["GenericAll"], "Allow", null, null, "None", true),
        new(@"CONTOSO\Domain Admins", "S-1-5-21-1004336348-1177238915-682003330-512", ["GenericAll"], "Allow", null, null, "None", true),
        new(@"NT AUTHORITY\Authenticated Users", "S-1-5-11", ["GenericRead"], "Allow", null, null, "None", true),
    ];

    private JsonNode? Load(string file)
    {
        var path = Path.Combine(_configDir, file);
        return File.Exists(path) ? JsonNode.Parse(File.ReadAllText(path)) : null;
    }

    private static string? Str(JsonNode? o, string prop) => o?[prop] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    private Model Build()
    {
        var ous = Load("tiermodel-ous.json")?["organizationUnits"] as JsonArray ?? [];
        var guids = GuidNames.From(Load("tiermodel-guid-mappings.json"));
        var fakeGuids = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        string? GuidFor(string? name)
        {
            if (guids.IsAllObjects(name)) return null;
            if (guids.GuidOf(name) is { } g) return g;
            var technical = guids.Technical(name);
            if (!fakeGuids.TryGetValue(technical, out var fake))
                fakeGuids[technical] = fake = new Guid(MD5.HashData(Encoding.UTF8.GetBytes(technical.ToLowerInvariant()))).ToString();
            return fake;
        }

        // Explicit ACEs per OU from all delegation sections, as the framework would have set them.
        var aces = new Dictionary<string, List<AdAce>>();
        foreach (var file in new[] { "tiermodel-acls.json", "tiermodel-msa.json", "tiermodel-gmsa.json", "tiermodel-dmsa.json" })
            foreach (var a in (Load(file)?["aclDelegations"] as JsonArray ?? []).OfType<JsonObject>())
            {
                if (Str(a, "targetOUPath") is not { } target || Str(a, "identityreference") is not { } principal) continue;
                var dn = DirectoryComparer.NormalizeDn(DirectoryComparer.Resolve(target, DomainDn));
                var rights = a["activedirectoryrights"] is JsonArray r ? r.Select(x => x?.ToString() ?? "").ToList() : [];
                if (!aces.TryGetValue(dn, out var list)) aces[dn] = list = [];
                list.Add(new($@"CONTOSO\{principal}", null, rights, Str(a, "accesscontroltype") ?? "Allow", GuidFor(Str(a, "objecttype")),
                    GuidFor(Str(a, "inheritedObjectType") ?? Str(a, "inheritedobjecttype")), Str(a, "activeDirectorysecurityinheritance") ?? "None", false));
            }

        var links = new Dictionary<string, List<AdGpoLink>>();
        if (Load("tiermodel-gpos.json")?["gpos"] is JsonObject gpos)
            foreach (var (target, byKind) in gpos)
            {
                if (target == "TemplateGpos" || byKind is not JsonObject kinds) continue;
                var list = new List<(string Name, int Order, bool Enabled)>();
                foreach (var (_, node) in kinds)
                    foreach (var g in (node as JsonArray ?? []).OfType<JsonObject>())
                    {
                        var name = Str(g, "rename") is { Length: > 0 } renamed ? renamed : Str(g, "name");
                        if (string.IsNullOrWhiteSpace(name)) continue;
                        var order = g["linkOrder"] is JsonValue o && o.TryGetValue<int>(out var ord) ? ord : list.Count + 1;
                        var enabled = g["linkEnabled"] is not JsonValue e || !e.TryGetValue<bool>(out var en) || en;
                        list.Add((name, order, enabled));
                    }
                links[DirectoryComparer.NormalizeDn(DirectoryComparer.Resolve(target, DomainDn))] = list.OrderBy(l => l.Order)
                    .Select((l, i) => new AdGpoLink(l.Name, new Guid(MD5.HashData(Encoding.UTF8.GetBytes(l.Name))).ToString("B").ToUpperInvariant(), i + 1, l.Enabled, false)).ToList();
            }

        List<AdAce> AcesFor(string dn, bool protect)
        {
            var list = DefaultAces();
            if (protect) list.Add(new("Everyone", "S-1-1-0", ["Delete", "DeleteTree"], "Deny", null, null, "None", false));
            list.AddRange(aces.GetValueOrDefault(DirectoryComparer.NormalizeDn(dn)) ?? []);
            return list;
        }

        var result = new List<AdOu>();
        var classes = new Dictionary<string, string>();
        foreach (var o in ous.OfType<JsonObject>())
        {
            var name = Str(o, "name");
            if (string.IsNullOrWhiteSpace(name) || name == MissingOu) continue;
            var dn = DirectoryComparer.Resolve(ConfigValidator.OuDn(name, Str(o, "path")), DomainDn);
            var protect = o["protectFromAccidentalDeletion"] is JsonValue p && p.TryGetValue<bool>(out var pv) && pv;
            var block = o["blockGpoInheritance"] is JsonValue b && b.TryGetValue<bool>(out var bv) && bv;
            var ouAces = AcesFor(dn, protect);
            if (DirectoryComparer.NormalizeDn(dn) == DirectoryComparer.NormalizeDn(ExtraAceOuDn))
                ouAces.Add(new(ExtraAcePrincipal, "S-1-5-21-1004336348-1177238915-682003330-1301", ["GenericAll"], "Allow", null, null, "All", false));
            var ouLinks = links.GetValueOrDefault(DirectoryComparer.NormalizeDn(dn)) ?? [];
            if (DirectoryComparer.NormalizeDn(dn) == DirectoryComparer.NormalizeDn(ExtraLinkOuDn))
                ouLinks = [.. ouLinks, new AdGpoLink(ExtraLinkGpo, "{6AC1786C-016F-11D2-945F-00C04FB984F9}", ouLinks.Count + 1, true, false)];
            result.Add(new AdOu(dn, name, DirectoryComparer.ParentOf(dn)!, protect, block, Str(o, "comment"), ouLinks, ouAces));
        }
        var dcOu = $"OU=Domain Controllers,{DomainDn}";
        result.Add(new AdOu(dcOu, "Domain Controllers", DomainDn, true, false, "Default container for domain controllers",
            links.GetValueOrDefault(DirectoryComparer.NormalizeDn(dcOu)) ?? [], AcesFor(dcOu, true)));
        result.Add(new AdOu(ExtraOuDn, "Legacy Servers", DomainDn, false, false, "Alte Server aus der Migration 2019",
            [new AdGpoLink(ExtraLinkGpo, "{6AC1786C-016F-11D2-945F-00C04FB984F9}", 1, true, false)],
            [.. DefaultAces(), new(@"CONTOSO\Server-Admins-Alt", "S-1-5-21-1004336348-1177238915-682003330-1320", ["GenericAll"], "Allow", null, null, "All", false)]));
        result.Add(new AdOu($"OU=Archiv,{ExtraOuDn}", "Archiv", ExtraOuDn, false, false, null, [], DefaultAces()));
        foreach (var ou in result) classes[DirectoryComparer.NormalizeDn(ou.Dn)] = "organizationalUnit";

        var root = new AdOu(DomainDn, "contoso.local", "", false, false, null, links.GetValueOrDefault(DirectoryComparer.NormalizeDn(DomainDn)) ?? [], AcesFor(DomainDn, false));

        // Groups of the configuration with a few members each.
        var members = new Dictionary<string, List<AdMember>>();
        foreach (var g in (Load("tiermodel-groups.json")?["groups"] as JsonArray ?? []).OfType<JsonObject>())
        {
            if (Str(g, "name") is not { } name || Str(g, "path") is not { } path) continue;
            var dn = $"CN={name},{DirectoryComparer.Resolve(path, DomainDn)}";
            classes[DirectoryComparer.NormalizeDn(dn)] = "group";
            var tier = TierRules.TierOf(name) ?? 2;
            var sam = Str(g, "samaccountname") ?? name;
            var accountsOu = DirectoryComparer.Resolve($"OU=Tier {tier} Accounts,OU=Tier {tier},OU=Tier Model Administration,{{{{DOMAIN_DN}}}}", DomainDn);
            var list = new List<AdMember>();
            if (sam.Contains("Devices", StringComparison.OrdinalIgnoreCase) || sam.Contains("Servers", StringComparison.OrdinalIgnoreCase))
                for (var i = 1; i <= 2 + Hash(sam) % 3; i++)
                    list.Add(new($"T{tier}-{(sam.Contains("PAW") ? "PAW" : "SRV")}{i:00}", $"T{tier}-{(sam.Contains("PAW") ? "PAW" : "SRV")}{i:00}$", "computer",
                        $"CN=T{tier}-{(sam.Contains("PAW") ? "PAW" : "SRV")}{i:00},{accountsOu}", true));
            else
                foreach (var (who, i) in new[] { "alice", "bob", "carol" }.Take(1 + Hash(sam) % 3).Select((w, i) => (w, i)))
                    list.Add(new($"{char.ToUpperInvariant(who[0])}{who[1..]} (T{tier})", $"t{tier}-{who}", "user", $"CN={who} (T{tier}),{accountsOu}", i != 2));
            members[DirectoryComparer.NormalizeDn(dn)] = list;
        }

        return new Model(new AdSnapshot(Domain, root, result, false), classes, members, fakeGuids);
    }
}
