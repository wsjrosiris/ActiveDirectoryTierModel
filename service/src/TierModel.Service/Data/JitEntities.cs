namespace TierModel.Service.Data;

/// <summary>
/// Lifecycle of a Just-in-Time request (roadmap 6):
/// Pending → Approved (grant run queued) → Active (membership with TTL) → Expired / Revoked;
/// Pending → Rejected (decision or approval timeout) / Cancelled (withdrawn); Approved → Failed (grant run failed).
/// </summary>
public enum JitStatus { Pending, Approved, Rejected, Active, Expired, Revoked, Failed, Cancelled }

/// <summary>What a run of kind <see cref="RunKind.Jit"/> does (Grant-TierModelJitAccess.ps1 -Mode …).</summary>
public enum JitAction { Grant, Revoke, Check }

/// <summary>A group that may be requested for time-limited membership, with its rules.</summary>
public class JitGroup : IDomainScoped
{
    public long Id { get; set; }
    public int DomainId { get; set; }
    /// <summary>samAccountName or SID as passed to the framework script.</summary>
    public required string Group { get; set; }
    /// <summary>Known SID (from the configuration/AD lookup or the first grant); used for the monitoring match.</summary>
    public string? GroupSid { get; set; }
    public required string DisplayName { get; set; }
    public int? Tier { get; set; }
    public int MaxMinutes { get; set; } = 60;
    public bool RequiresApproval { get; set; } = true;
    /// <summary>Minimum application role needed to request the group.</summary>
    public Role MinimumRole { get; set; } = Role.Operator;
    /// <summary>Optional: only these application user names may request the group (empty = everyone with the minimum role).</summary>
    public string[] EligibleUsers { get; set; } = [];
    public bool Enabled { get; set; } = true;
    public required string CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
}

public class JitRequest : IDomainScoped
{
    public long Id { get; set; }
    public int DomainId { get; set; }
    /// <summary>Application user who asked for the access.</summary>
    public required string RequestedBy { get; set; }
    /// <summary>AD account (samAccountName) that becomes a member.</summary>
    public required string MemberAccount { get; set; }
    /// <summary>Null when the JIT group was deleted later; the names below keep the request readable.</summary>
    public long? JitGroupId { get; set; }
    public required string Group { get; set; }
    public required string GroupDisplayName { get; set; }
    public int? Tier { get; set; }
    public int Minutes { get; set; }
    public required string Justification { get; set; }
    public JitStatus Status { get; set; }
    public bool ApprovalRequired { get; set; }
    public DateTimeOffset RequestedAt { get; set; }
    public DateTimeOffset? ApprovalExpiresAt { get; set; }
    /// <summary>Approver, or the person who rejected the request.</summary>
    public string? DecidedBy { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }
    public string? DecisionComment { get; set; }
    public DateTimeOffset? GrantedAt { get; set; }
    /// <summary>From the time-to-live read back after the grant.</summary>
    public DateTimeOffset? ExpiresAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public string? RevokedBy { get; set; }
    /// <summary>Grant run.</summary>
    public long? RunId { get; set; }
    /// <summary>Revoke run (early revocation), while it is pending or after it failed.</summary>
    public long? RevokeRunId { get; set; }
    public string? GroupSid { get; set; }
    public string? MemberSid { get; set; }
    public string? Dc { get; set; }
    /// <summary>Last error or note (German).</summary>
    public string? Message { get; set; }
}
