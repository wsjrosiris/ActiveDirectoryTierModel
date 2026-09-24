using System.DirectoryServices;
using System.DirectoryServices.ActiveDirectory;
using System.Runtime.Versioning;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;

namespace TierModel.Service.AdView;

/// <summary>
/// Reads a domain with System.DirectoryServices as the service account (read-only, bounded searches): the computer's
/// domain, or (roadmap 17) the domain of a managed domain entry through its preferred DC or DNS name — the service account
/// needs read access there (trust). Only explicit ACEs are returned; entries of the schema's default security descriptor
/// for OUs are flagged.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed partial class WindowsDirectoryReader : IDirectoryReader
{
    private readonly Dictionary<string, string> _sidNames = new(StringComparer.OrdinalIgnoreCase);
    private readonly Lock _lock = new();
    /// <summary>Server part of LDAP paths ("dc01.contoso.com/" or "contoso.com/"); empty for the computer's domain.</summary>
    private readonly string _server;
    private readonly DirectoryTarget _target;

    public WindowsDirectoryReader() : this(new DirectoryTarget("", "")) { }

    public WindowsDirectoryReader(DirectoryTarget target)
    {
        _target = target;
        var host = !string.IsNullOrWhiteSpace(target.PreferredDc) ? target.PreferredDc.Trim() : target.DnsName.Trim();
        _server = host.Length == 0 ? "" : host + "/";
    }

    public string Source => "Active Directory";

    public bool Available => ComputerDomain() is not null;

    private System.DirectoryServices.ActiveDirectory.Domain? ComputerDomain()
    {
        try { return OpenDomain(); }
        catch (Exception) { return null; }
    }

    private System.DirectoryServices.ActiveDirectory.Domain OpenDomain()
    {
        if (!string.IsNullOrWhiteSpace(_target.PreferredDc))
            return System.DirectoryServices.ActiveDirectory.Domain.GetDomain(new DirectoryContext(DirectoryContextType.DirectoryServer, _target.PreferredDc.Trim()));
        if (!string.IsNullOrWhiteSpace(_target.DnsName))
            return System.DirectoryServices.ActiveDirectory.Domain.GetDomain(new DirectoryContext(DirectoryContextType.Domain, _target.DnsName.Trim()));
        return System.DirectoryServices.ActiveDirectory.Domain.GetComputerDomain();
    }

    /// <summary>LDAP path on the reader's server.</summary>
    private string Path(string dn) => "LDAP://" + _server + dn.Replace("/", "\\/");

    private string RootDsePath => "LDAP://" + _server + "RootDSE";

    [GeneratedRegex(@"\[LDAP://(?:cn|CN)=(\{[0-9A-Fa-f-]{36}\})[^;\]]*;(\d+)\]")]
    private static partial Regex GpLinkEntry();

    /// <summary>A DN as part of an LDAP:// path: "/" must be escaped.</summary>
    public static string LdapPath(string dn) => "LDAP://" + dn.Replace("/", "\\/");

    /// <summary>RFC 4515 escaping of a value inside an LDAP filter.</summary>
    public static string EscapeFilter(string value) => string.Concat(value.Select(c => c switch
    {
        '\\' => "\\5c", '*' => "\\2a", '(' => "\\28", ')' => "\\29", '\0' => "\\00", _ => c.ToString(),
    }));

    private AdDomainInfo ReadDomain(System.DirectoryServices.ActiveDirectory.Domain domain)
    {
        using var root = domain.GetDirectoryEntry();
        var dn = root.Properties["distinguishedName"].Value?.ToString() ?? "";
        var netbios = domain.Name.Split('.')[0].ToUpperInvariant();
        try
        {
            using var rootDse = new DirectoryEntry(RootDsePath);
            var configNc = rootDse.Properties["configurationNamingContext"].Value?.ToString();
            using var partitions = new DirectoryEntry(Path($"CN=Partitions,{configNc}"));
            using var searcher = new DirectorySearcher(partitions, $"(&(objectClass=crossRef)(nCName={EscapeFilter(dn)}))", ["nETBIOSName"], SearchScope.OneLevel);
            if (searcher.FindOne()?.Properties["nETBIOSName"] is { Count: > 0 } p) netbios = p[0]!.ToString()!;
        }
        catch (Exception) { /* keep the DNS-derived name */ }

        var dcs = new List<AdDomainController>();
        try
        {
            foreach (DomainController dc in domain.DomainControllers)
            {
                bool gc;
                try { gc = dc.IsGlobalCatalog(); } catch (Exception) { gc = false; }
                dcs.Add(new AdDomainController(dc.Name, dc.SiteName, gc));
            }
        }
        catch (Exception) { /* list stays partial */ }

        string forestName = "", forestMode = "";
        try
        {
            forestName = domain.Forest.Name;
            forestMode = domain.Forest.ForestMode.ToString();
        }
        catch (Exception) { }
        return new AdDomainInfo(domain.Name, dn, netbios, domain.DomainMode.ToString(), forestMode, forestName,
            dcs.OrderBy(d => d.Name, StringComparer.OrdinalIgnoreCase).ToList());
    }

    public AdSnapshot ReadSnapshot(int maxOus)
    {
        var domain = ComputerDomain() ?? throw new DirectoryUnavailableException();
        var info = ReadDomain(domain);
        var gpoNames = ReadGpoNames(info.DistinguishedName);
        var defaults = ReadDefaultOuAces();

        using var root = domain.GetDirectoryEntry();
        using var searcher = new DirectorySearcher(root, "(objectCategory=organizationalUnit)",
            ["distinguishedName", "name", "description", "gPLink", "gPOptions", "nTSecurityDescriptor"], SearchScope.Subtree)
        {
            PageSize = 500,
            SizeLimit = maxOus + 1,
            SecurityMasks = SecurityMasks.Dacl,
        };
        var ous = new List<AdOu>();
        using (var results = searcher.FindAll())
            foreach (SearchResult r in results)
            {
                if (ous.Count >= maxOus) return new AdSnapshot(info, ReadRoot(info, gpoNames), ous, true);
                ous.Add(ToOu(r.Properties, gpoNames, defaults));
            }
        return new AdSnapshot(info, ReadRoot(info, gpoNames), ous, false);
    }

    private AdOu ReadRoot(AdDomainInfo info, Dictionary<string, string> gpoNames)
    {
        using var entry = new DirectoryEntry(Path(info.DistinguishedName));
        entry.Options!.SecurityMasks = SecurityMasks.Dacl;
        entry.RefreshCache(["gPLink", "gPOptions", "name"]);
        var sd = entry.ObjectSecurity.GetSecurityDescriptorBinaryForm();
        var ou = ToOu(name => name == "nTSecurityDescriptor" ? sd : entry.Properties[name].Value, gpoNames, []);
        return ou with { Dn = info.DistinguishedName, Name = info.DnsName, ParentDn = "" };
    }

    private AdOu ToOu(ResultPropertyCollection props, Dictionary<string, string> gpoNames, List<(string Sid, int Rights, string Type, Guid Obj, Guid Inh, string Inheritance)> defaults) =>
        ToOu(name => props[name] is { Count: > 0 } c ? c[0] : null, gpoNames, defaults);

    private AdOu ToOu(Func<string, object?> first, Dictionary<string, string> gpoNames, List<(string Sid, int Rights, string Type, Guid Obj, Guid Inh, string Inheritance)> defaults)
    {
        string? Prop(string name) => first(name)?.ToString();
        var dn = Prop("distinguishedName") ?? "";
        var aces = first("nTSecurityDescriptor") is byte[] sd ? ParseAces(sd, defaults) : [];
        var protect = aces.Any(DirectoryComparer.IsProtectionAce);
        var options = int.TryParse(Prop("gPOptions"), out var o) ? o : 0;
        return new AdOu(dn, Prop("name") ?? dn, DirectoryComparer.ParentOf(dn) ?? "", protect, (options & 1) == 1, Prop("description"),
            ParseGpLink(Prop("gPLink"), gpoNames), aces);
    }

    public static List<AdGpoLink> ParseGpLink(string? gpLink, IReadOnlyDictionary<string, string> gpoNames)
    {
        if (string.IsNullOrEmpty(gpLink)) return [];
        var entries = GpLinkEntry().Matches(gpLink).Select(m => (Guid: m.Groups[1].Value.ToUpperInvariant(), Options: int.Parse(m.Groups[2].Value))).ToList();
        // The last entry in gPLink has link order 1.
        entries.Reverse();
        return entries.Select((e, i) => new AdGpoLink(gpoNames.GetValueOrDefault(e.Guid) ?? e.Guid, e.Guid, i + 1, (e.Options & 1) == 0, (e.Options & 2) == 2)).ToList();
    }

    private Dictionary<string, string> ReadGpoNames(string domainDn)
    {
        var names = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            using var policies = new DirectoryEntry(Path($"CN=Policies,CN=System,{domainDn}"));
            using var searcher = new DirectorySearcher(policies, "(objectClass=groupPolicyContainer)", ["cn", "displayName"], SearchScope.OneLevel) { PageSize = 500, SizeLimit = 5000 };
            using var results = searcher.FindAll();
            foreach (SearchResult r in results)
                if (r.Properties["cn"] is { Count: > 0 } cn && r.Properties["displayName"] is { Count: > 0 } display)
                    names[cn[0]!.ToString()!.ToUpperInvariant()] = display[0]!.ToString()!;
        }
        catch (Exception) { /* links then show the GUID */ }
        return names;
    }

    private List<(string Sid, int Rights, string Type, Guid Obj, Guid Inh, string Inheritance)> ReadDefaultOuAces()
    {
        try
        {
            using var rootDse = new DirectoryEntry(RootDsePath);
            var schemaNc = rootDse.Properties["schemaNamingContext"].Value?.ToString();
            using var schema = new DirectoryEntry(Path(schemaNc!));
            using var searcher = new DirectorySearcher(schema, "(lDAPDisplayName=organizationalUnit)", ["defaultSecurityDescriptor"], SearchScope.OneLevel);
            if (searcher.FindOne()?.Properties["defaultSecurityDescriptor"] is not { Count: > 0 } p) return [];
            var security = new ActiveDirectorySecurity();
            security.SetSecurityDescriptorSddlForm(p[0]!.ToString()!, AccessControlSections.Access);
            return security.GetAccessRules(true, false, typeof(SecurityIdentifier)).OfType<ActiveDirectoryAccessRule>()
                .Select(r => (r.IdentityReference.Value, (int)r.ActiveDirectoryRights, r.AccessControlType.ToString(), r.ObjectType, r.InheritedObjectType, r.InheritanceType.ToString()))
                .ToList();
        }
        catch (Exception) { return []; }
    }

    private List<AdAce> ParseAces(byte[] descriptor, List<(string Sid, int Rights, string Type, Guid Obj, Guid Inh, string Inheritance)> defaults)
    {
        var security = new ActiveDirectorySecurity();
        security.SetSecurityDescriptorBinaryForm(descriptor, AccessControlSections.Access);
        var result = new List<AdAce>();
        foreach (var rule in security.GetAccessRules(true, false, typeof(SecurityIdentifier)).OfType<ActiveDirectoryAccessRule>())
        {
            if (rule.IsInherited) continue;
            var sid = rule.IdentityReference.Value;
            var type = rule.AccessControlType.ToString();
            var inheritance = rule.InheritanceType.ToString();
            var isDefault = defaults.Any(d => d.Sid == sid && d.Rights == (int)rule.ActiveDirectoryRights && d.Type == type
                && d.Obj == rule.ObjectType && d.Inh == rule.InheritedObjectType && d.Inheritance == inheritance);
            result.Add(new AdAce(SidName(sid), sid, AdRights.Names((long)rule.ActiveDirectoryRights), type,
                rule.ObjectType == Guid.Empty ? null : rule.ObjectType.ToString(),
                rule.InheritedObjectType == Guid.Empty ? null : rule.InheritedObjectType.ToString(), inheritance, isDefault));
        }
        return result;
    }

    private string SidName(string sid)
    {
        lock (_lock)
        {
            if (_sidNames.TryGetValue(sid, out var cached)) return cached;
            string name;
            try { name = new SecurityIdentifier(sid).Translate(typeof(NTAccount)).Value; }
            catch (Exception) { name = sid; }
            if (_sidNames.Count > 5000) _sidNames.Clear();
            _sidNames[sid] = name;
            return name;
        }
    }

    public AdObjectCounts CountChildren(string ouDn)
    {
        using var entry = new DirectoryEntry(Path(ouDn));
        int Count(string filter)
        {
            using var s = new DirectorySearcher(entry, filter, ["distinguishedName"], SearchScope.OneLevel) { PageSize = 500, SizeLimit = 20000 };
            using var r = s.FindAll();
            return r.Count;
        }
        var users = Count("(&(objectCategory=person)(objectClass=user))");
        var groups = Count("(objectCategory=group)");
        var computers = Count("(objectCategory=computer)");
        var all = Count("(!(objectCategory=organizationalUnit))");
        return new AdObjectCounts(users, groups, computers, Math.Max(0, all - users - groups - computers));
    }

    public string? ObjectClass(string dn)
    {
        var path = Path(dn);
        if (!DirectoryEntry.Exists(path)) return null;
        using var entry = new DirectoryEntry(path);
        return entry.Properties["objectClass"] is { Count: > 0 } c ? c[c.Count - 1]?.ToString() : null;
    }

    public List<AdMember> GroupMembers(string groupDn, int max)
    {
        using var group = new DirectoryEntry(Path(groupDn));
        var result = new List<AdMember>();
        foreach (var m in group.Properties["member"].Cast<object>().Take(max))
        {
            var dn = m.ToString()!;
            try
            {
                using var e = new DirectoryEntry(Path(dn));
                var classes = e.Properties["objectClass"];
                var cls = classes.Count > 0 ? classes[classes.Count - 1]!.ToString()! : "object";
                bool? enabled = e.Properties["userAccountControl"].Value is int uac ? (uac & 2) == 0 : null;
                result.Add(new AdMember(e.Properties["name"].Value?.ToString() ?? dn, e.Properties["sAMAccountName"].Value?.ToString() ?? "", cls, dn, enabled));
            }
            catch (Exception)
            {
                result.Add(new AdMember(dn, "", "object", dn, null));
            }
        }
        return result;
    }

    public List<AdAce> Aces(string dn)
    {
        using var entry = new DirectoryEntry(Path(dn));
        entry.Options!.SecurityMasks = SecurityMasks.Dacl;
        return ParseAces(entry.ObjectSecurity.GetSecurityDescriptorBinaryForm(), ReadDefaultOuAces());
    }

    public Dictionary<string, string> ResolveGuids(IEnumerable<string> guids)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            using var rootDse = new DirectoryEntry(RootDsePath);
            var schemaNc = rootDse.Properties["schemaNamingContext"].Value?.ToString();
            var configNc = rootDse.Properties["configurationNamingContext"].Value?.ToString();
            using var schema = new DirectoryEntry(Path(schemaNc!));
            using var rights = new DirectoryEntry(Path($"CN=Extended-Rights,{configNc}"));
            foreach (var g in guids.Distinct(StringComparer.OrdinalIgnoreCase).Take(100))
            {
                if (!Guid.TryParse(g, out var guid)) continue;
                var octets = string.Concat(guid.ToByteArray().Select(b => $"\\{b:x2}"));
                using (var s = new DirectorySearcher(schema, $"(schemaIDGUID={octets})", ["lDAPDisplayName"], SearchScope.OneLevel))
                    if (s.FindOne()?.Properties["lDAPDisplayName"] is { Count: > 0 } n) { result[g] = n[0]!.ToString()!; continue; }
                using (var s = new DirectorySearcher(rights, $"(rightsGuid={EscapeFilter(guid.ToString())})", ["cn"], SearchScope.OneLevel))
                    if (s.FindOne()?.Properties["cn"] is { Count: > 0 } n) result[g] = n[0]!.ToString()!;
            }
        }
        catch (Exception) { /* unresolved GUIDs are shown as GUIDs */ }
        return result;
    }

    /// <summary>Domain information without the OU pass (setup wizard, "Verbindung prüfen"). Throws when the domain cannot be reached.</summary>
    public AdDomainInfo DomainInfo()
    {
        using var d = OpenDomain();
        return ReadDomain(d);
    }

    public List<AdPrincipal> SearchGroups(string query, int max) =>
        Search(query, max, q => $"(&(objectCategory=group)(|(cn={q}*)(sAMAccountName={q}*)(cn=*{q}*)))");

    public List<AdPrincipal> SearchAccounts(string query, int max) =>
        Search(query, max, q => $"(&(objectCategory=person)(objectClass=user)(|(sAMAccountName={q}*)(displayName=*{q}*)(cn=*{q}*)))");

    private List<AdPrincipal> Search(string query, int max, Func<string, string> filter)
    {
        if (query.Trim().Length < 2) return [];
        try
        {
            using var domain = OpenDomain();
            using var root = domain.GetDirectoryEntry();
            using var searcher = new DirectorySearcher(root, filter(EscapeFilter(query.Trim())),
                ["cn", "displayName", "sAMAccountName", "objectSid", "distinguishedName", "description"]) { SizeLimit = max };
            using var results = searcher.FindAll();
            return results.Cast<SearchResult>().Select(r =>
            {
                var sid = r.Properties["objectSid"] is { Count: > 0 } s ? new SecurityIdentifier((byte[])s[0]!, 0).Value : "";
                string? Prop(string name) => r.Properties[name] is { Count: > 0 } p ? p[0]?.ToString() : null;
                var sam = Prop("sAMAccountName") ?? Prop("cn") ?? sid;
                return new AdPrincipal(Prop("displayName") ?? Prop("cn") ?? sam, sam, sid, Prop("distinguishedName"), Prop("description"));
            }).Where(p => p.SamAccountName.Length > 0).OrderBy(p => p.Name, StringComparer.OrdinalIgnoreCase).ToList();
        }
        catch (Exception) { return []; }
    }
}
