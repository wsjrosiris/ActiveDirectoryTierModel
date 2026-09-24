namespace TierModel.Service.Data;

/// <summary>Entities that belong to one managed domain (roadmap 17). New rows without a domain get the one of the current request.</summary>
public interface IDomainScoped
{
    int DomainId { get; set; }
}

/// <summary>
/// An Active Directory domain managed by this instance (roadmap 17). Each domain has its own desired configuration, runs,
/// schedules, monitoring snapshots and JIT groups; users, roles, notification channels, tokens and instance settings are shared.
/// The framework resolves {{DOMAIN_DN}} from the domain controller, so the only per-domain parameters are the DC and the ADML language.
/// </summary>
public class Domain
{
    public int Id { get; set; }
    /// <summary>Short identifier used in the header X-TierModel-Domain, Git folders and the PowerShell client (e.g. "contoso").</summary>
    public required string Key { get; set; }
    public required string DisplayName { get; set; }
    /// <summary>DNS name of the domain (contoso.com); used by the live AD view.</summary>
    public string DnsName { get; set; } = "";
    /// <summary>Default domain controller for runs of this domain.</summary>
    public string PreferredDc { get; set; } = "";
    public string AdmlLanguage { get; set; } = "en-US";
    public bool Enabled { get; set; } = true;
    /// <summary>Used when a request names no domain (existing integrations, PowerShell client without -Domain).</summary>
    public bool IsDefault { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string? Notes { get; set; }
}
