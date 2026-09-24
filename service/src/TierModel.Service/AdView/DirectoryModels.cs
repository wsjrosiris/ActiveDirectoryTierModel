using TierModel.Service.Localization;
namespace TierModel.Service.AdView;

/* Read-only view of the live Active Directory (roadmap 14). Readers return raw data (SIDs, GUIDs, rights);
 * DirectoryService resolves object type names through the guid-mappings section and caches the result. */

public record AdDomainController(string Name, string? Site, bool IsGlobalCatalog);

public record AdDomainInfo(
    string DnsName, string DistinguishedName, string NetBiosName, string DomainFunctionalLevel, string ForestFunctionalLevel,
    string ForestName, List<AdDomainController> DomainControllers);

/// <summary>One explicit (non-inherited) access control entry.</summary>
/// <param name="Principal">DOMAIN\name as resolved by the reader (SID when it cannot be translated).</param>
/// <param name="Rights">ActiveDirectoryRights names, e.g. ["CreateChild", "DeleteChild"].</param>
/// <param name="Type">Allow or Deny.</param>
/// <param name="ObjectTypeGuid">Schema/extended right GUID the ACE is limited to; null = all.</param>
/// <param name="Inheritance">ActiveDirectorySecurityInheritance: None, All, Descendents, SelfAndChildren, Children.</param>
/// <param name="IsDefault">Part of the schema's default security descriptor for OUs (not managed by the Tier Model).</param>
public record AdAce(
    string Principal, string? PrincipalSid, List<string> Rights, string Type, string? ObjectTypeGuid, string? InheritedObjectTypeGuid,
    string Inheritance, bool IsDefault)
{
    /// <summary>Resolved names (filled by DirectoryService from the guid mappings).</summary>
    public string? ObjectType { get; init; }
    public string? InheritedObjectType { get; init; }
}

/// <param name="Order">Link order as shown in the GPMC (1 = highest precedence).</param>
public record AdGpoLink(string Name, string? GpoGuid, int Order, bool Enabled, bool Enforced);

public record AdOu(
    string Dn, string Name, string ParentDn, bool Protected, bool BlockInheritance, string? Description,
    List<AdGpoLink> GpoLinks, List<AdAce> Aces);

/// <summary>Everything the comparison needs, read in one pass.</summary>
/// <param name="Root">The domain root itself (GPO links and ACEs on the domain object).</param>
public record AdSnapshot(AdDomainInfo Domain, AdOu Root, List<AdOu> Ous, bool Truncated);

public record AdMember(string Name, string SamAccountName, string ObjectClass, string DistinguishedName, bool? Enabled);

public record AdObjectCounts(int Users, int Groups, int Computers, int Other);

/// <summary>A group or user account found by a search (lookups for the forms).</summary>
public record AdPrincipal(string Name, string SamAccountName, string Sid, string? DistinguishedName, string? Description);

/// <summary>Reads the directory. Implementations must be read-only and bounded.</summary>
public interface IDirectoryReader
{
    /// <summary>"Active Directory" or "Testdaten"; shown in the UI.</summary>
    string Source { get; }

    /// <summary>False on non-Windows hosts or when the computer is not in a domain.</summary>
    bool Available { get; }

    /// <summary>Domain, all OUs with explicit ACEs and GPO links. Throws when the directory cannot be read.</summary>
    AdSnapshot ReadSnapshot(int maxOus);

    /// <summary>Direct child objects of an OU per class.</summary>
    AdObjectCounts CountChildren(string ouDn);

    /// <summary>Object class of a DN (organizationalUnit, group, user, …); null when it does not exist.</summary>
    string? ObjectClass(string dn);

    /// <summary>Direct members of a group (bounded).</summary>
    List<AdMember> GroupMembers(string groupDn, int max);

    /// <summary>Explicit ACEs of any object.</summary>
    List<AdAce> Aces(string dn);

    /// <summary>Names for schema / extended-right GUIDs that are not in the guid mappings (lDAPDisplayName or rights name).</summary>
    Dictionary<string, string> ResolveGuids(IEnumerable<string> guids);

    /// <summary>Domain, forest and domain controllers without the OU pass ("Verbindung prüfen", DC suggestions). Throws when unreachable.</summary>
    AdDomainInfo DomainInfo();

    /// <summary>Groups whose name starts with or contains <paramref name="query"/> (at least 2 characters).</summary>
    List<AdPrincipal> SearchGroups(string query, int max);

    /// <summary>User accounts whose sAMAccountName starts with or whose name contains <paramref name="query"/> (at least 2 characters).</summary>
    List<AdPrincipal> SearchAccounts(string query, int max);
}

/// <summary>Used when the service does not run on a domain-joined Windows server.</summary>
public sealed class UnavailableDirectoryReader : IDirectoryReader
{
    public string Source => "Active Directory";
    public bool Available => false;
    public AdSnapshot ReadSnapshot(int maxOus) => throw new DirectoryUnavailableException();
    public AdObjectCounts CountChildren(string ouDn) => throw new DirectoryUnavailableException();
    public string? ObjectClass(string dn) => throw new DirectoryUnavailableException();
    public List<AdMember> GroupMembers(string groupDn, int max) => throw new DirectoryUnavailableException();
    public List<AdAce> Aces(string dn) => throw new DirectoryUnavailableException();
    public Dictionary<string, string> ResolveGuids(IEnumerable<string> guids) => [];
    public AdDomainInfo DomainInfo() => throw new DirectoryUnavailableException();
    public List<AdPrincipal> SearchGroups(string query, int max) => [];
    public List<AdPrincipal> SearchAccounts(string query, int max) => [];
}

public class DirectoryUnavailableException() : Exception(L.T("Active Directory ist auf diesem Server nicht erreichbar."));
