using TierModel.Service.Localization;

namespace TierModel.Service.Config;

/// <param name="GermanTitle">German title – also the key of the English text (see <see cref="L"/>).</param>
/// <param name="ItemsProperty">Top-level property whose entries are counted as items, if any.</param>
public record SectionDefinition(string Key, string FileName, string GermanTitle, string GermanDescription, string? ItemsProperty)
{
    /// <summary>Title in the language of the current request.</summary>
    public string Title => L.TC("section", GermanTitle);
    public string Description => L.TC("section", GermanDescription);
    /// <summary>Title for persisted texts (change log, commit messages): instance default language.</summary>
    public string PersistedTitle => L.PC("section", GermanTitle);
}

/// <summary>The framework configuration files that the service manages.</summary>
public static class ConfigCatalog
{
    public static readonly IReadOnlyList<SectionDefinition> Sections =
    [
        new("ous", "tiermodel-ous.json", "Organisationseinheiten", "OU-Struktur des Tier Models", "organizationUnits"),
        new("groups", "tiermodel-groups.json", "Gruppen", "Sicherheitsgruppen", "groups"),
        new("users", "tiermodel-users.json", "Benutzer", "Dienstkonten", "users"),
        new("acls", "tiermodel-acls.json", "ACL-Delegationen", "Berechtigungen auf OUs", "aclDelegations"),
        new("gpos", "tiermodel-gpos.json", "GPOs", "Gruppenrichtlinien und ihre Verknüpfungen", "gpos"),
        new("authsilos", "tiermodel-authsilos.json", "Authentication Silos", "Kerberos-Authentifizierungsrichtlinien, Silos und Gerätegruppen (optional)", "authenticationPolicySilos"),
        new("admx", "tiermodel-admx.json", "ADMX", "Administrative Vorlagen", null),
        new("adml-en-US", "tiermodel-adml-en-US.json", "ADML (en-US)", "Sprachdateien der administrativen Vorlagen", null),
        new("msa", "tiermodel-msa.json", "MSA", "ACL-Delegationen für Managed Service Accounts", "aclDelegations"),
        new("gmsa", "tiermodel-gmsa.json", "gMSA", "ACL-Delegationen für Group Managed Service Accounts", "aclDelegations"),
        new("dmsa", "tiermodel-dmsa.json", "dMSA", "ACL-Delegationen für Delegated Managed Service Accounts", "aclDelegations"),
        new("winlaps", "tiermodel-winlaps.json", "Windows LAPS", "LAPS-Delegationen und Decryptor-Konfiguration", "winLapsDelegations"),
        new("metadata", "tiermodel-metadata.json", "Metadaten", "Versionierung und Bereitstellungslogik", null),
        new("guid-mappings", "tiermodel-guid-mappings.json", "GUID-Zuordnungen", "Schema-GUIDs für ACL-Objekttypen", null),
        new("dependencies", "dependencies.json", "Abhängigkeiten", "Voraussetzungen für die Bereitstellung", null),
    ];

    public static SectionDefinition? Find(string key) =>
        Sections.FirstOrDefault(s => string.Equals(s.Key, key, StringComparison.OrdinalIgnoreCase));
}
