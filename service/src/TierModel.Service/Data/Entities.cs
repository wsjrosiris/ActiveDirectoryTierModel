namespace TierModel.Service.Data;

/// <summary>Roles are ordered: each role includes the rights of the ones below it.</summary>
public enum Role
{
    Viewer = 0,
    Editor = 1,
    Operator = 2,
    Admin = 3,
}

/// <summary>Monitor: snapshot of the privileged groups (Watch-TierModelPrivilegedGroups.ps1).</summary>
public enum RunKind { Deploy, Audit, Monitor }

/// <summary>Scheduled: an apply waiting for the next maintenance window (<see cref="Run.ScheduledFor"/>).</summary>
public enum RunStatus { Queued, Running, Succeeded, Failed, Cancelled, AwaitingApproval, Rejected, Scheduled }

public enum AuthType { Local, Windows, Entra }

public enum ChannelType { Email, Teams, Webhook, Syslog, LogAnalytics }

public enum RunTrigger { Manual, Schedule }

public enum RunMode { Plan, Apply }

public enum DeployScope { FullDeployment, OuOnly, GroupOnly, UserOnly, GposOnly, OuAclsOnly, AdmxOnly, AuthSilosOnly }

public class AppUser
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string Username { get; set; }
    public required string NormalizedUsername { get; set; }
    public required string DisplayName { get; set; }
    public string PasswordHash { get; set; } = "";
    public Role Role { get; set; }
    public AuthType AuthType { get; set; } = AuthType.Local;
    /// <summary>Windows accounts: the user's SID, which identifies the account across renames.</summary>
    public string? Sid { get; set; }
    public bool IsActive { get; set; } = true;
    public bool MustChangePassword { get; set; }
    public int FailedLoginCount { get; set; }
    public DateTimeOffset? LockedUntil { get; set; }
    /// <summary>Changes whenever credentials, role or status change; invalidates existing sessions.</summary>
    public string SecurityStamp { get; set; } = Guid.NewGuid().ToString("N");
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? LastLoginAt { get; set; }
}

public class ConfigSection
{
    public required string Key { get; set; }
    public required string FileName { get; set; }
    public int CurrentVersion { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public required string UpdatedBy { get; set; }
}

public class ConfigVersion
{
    public long Id { get; set; }
    public required string SectionKey { get; set; }
    public int Version { get; set; }
    /// <summary>Pretty-printed JSON text. Stored as text (not jsonb) so key order and layout survive.</summary>
    public required string Content { get; set; }
    public required string Sha256 { get; set; }
    public required string CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string? Comment { get; set; }
}

public class Run
{
    public long Id { get; set; }
    public RunKind Kind { get; set; }
    public RunStatus Status { get; set; }
    public RunTrigger Trigger { get; set; }
    public RunMode? Mode { get; set; }
    public DeployScope? Scope { get; set; }
    public bool IncludeMsa { get; set; }
    public bool IncludeGmsa { get; set; }
    public bool IncludeDmsa { get; set; }
    public bool IncludeWinLaps { get; set; }
    public required string PreferredDc { get; set; }
    public required string AdmlLanguage { get; set; }
    public required string RequestedBy { get; set; }
    public long? ScheduleId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? FinishedAt { get; set; }
    public int? ExitCode { get; set; }
    public bool ApprovalRequired { get; set; }
    /// <summary>Approver, or the person who rejected the run.</summary>
    public string? ApprovedBy { get; set; }
    public DateTimeOffset? ApprovedAt { get; set; }
    public string? ApprovalComment { get; set; }
    public DateTimeOffset? ApprovalExpiresAt { get; set; }
    public int? DriftCount { get; set; }
    public int? ErrorCount { get; set; }
    public string? Message { get; set; }
    /// <summary>JSON object: section key -> config version used by this run.</summary>
    public string? ConfigVersions { get; set; }
    /// <summary>JSON object with the audit report's auditSummary.</summary>
    public string? Summary { get; set; }
    /// <summary>JSON array with the audit report's driftFindings.</summary>
    public string? Findings { get; set; }
    /// <summary>Deploy/Plan runs: the normalised deploy-plan.json (see <see cref="Runs.DeployPlan"/>).</summary>
    public string? Plan { get; set; }
    /// <summary>Apply runs: the planning run whose result was reviewed (and whose configuration versions are applied).</summary>
    public long? PlanRunId { get; set; }
    /// <summary>Status <see cref="RunStatus.Scheduled"/>: when the run is queued (start of the next maintenance window).</summary>
    public DateTimeOffset? ScheduledFor { get; set; }
}

public class RunLogLine
{
    public long Id { get; set; }
    public long RunId { get; set; }
    public int Seq { get; set; }
    public DateTimeOffset At { get; set; }
    public required string Stream { get; set; }
    public required string Level { get; set; }
    public required string Text { get; set; }
}

public class Schedule
{
    public long Id { get; set; }
    public required string Name { get; set; }
    /// <summary>Audit or Monitor; monitor schedules ignore scope and include flags.</summary>
    public RunKind Kind { get; set; } = RunKind.Audit;
    public required string Cron { get; set; }
    public required string TimeZone { get; set; }
    public bool Enabled { get; set; } = true;
    public required string PreferredDc { get; set; }
    public DeployScope? Scope { get; set; }
    public bool IncludeMsa { get; set; }
    public bool IncludeGmsa { get; set; }
    public bool IncludeDmsa { get; set; }
    public bool IncludeWinLaps { get; set; }
    public string? AdmlLanguage { get; set; }
    public DateTimeOffset? NextRunAt { get; set; }
    public DateTimeOffset? LastRunAt { get; set; }
    public long? LastRunId { get; set; }
    public required string CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class ChangeEntry
{
    public long Id { get; set; }
    public DateTimeOffset At { get; set; }
    public required string Username { get; set; }
    public required string Action { get; set; }
    public required string EntityType { get; set; }
    public string? EntityId { get; set; }
    public required string Summary { get; set; }
    /// <summary>Optional JSON payload.</summary>
    public string? Details { get; set; }
    /// <summary>Hex SHA-256 over <see cref="PrevHash"/> and the canonical entry (see <see cref="ChangeLogChain"/>).</summary>
    public string? Hash { get; set; }
    /// <summary>Hash of the previous entry (by Id); empty for the first entry.</summary>
    public string? PrevHash { get; set; }
}

public class NotificationChannel
{
    public long Id { get; set; }
    public required string Name { get; set; }
    public ChannelType Type { get; set; }
    public bool Enabled { get; set; } = true;
    /// <summary>Recipients or URL, encrypted with ASP.NET Core data protection (URLs often contain secrets).</summary>
    public required string TargetProtected { get; set; }
    /// <summary>What the UI may show: recipients, or the URL shortened to scheme and host.</summary>
    public required string TargetDisplay { get; set; }
    public bool OnDrift { get; set; }
    public bool OnFailure { get; set; }
    public bool OnApply { get; set; }
    public bool OnApproval { get; set; }
    public bool OnCertificate { get; set; }
    public bool OnPrivilegedChange { get; set; }
    public DateTimeOffset? LastSentAt { get; set; }
    public string? LastError { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class Setting
{
    public required string Key { get; set; }
    public required string Value { get; set; }
}

/// <summary>
/// Result of one monitor run: the normalised privileged.json (<see cref="Data"/>) and its evaluation against the
/// previous snapshot and the desired configuration (<see cref="Evaluation"/>). Counts are kept as columns for lists and charts.
/// </summary>
public class PrivilegedSnapshot
{
    public long Id { get; set; }
    public long RunId { get; set; }
    public DateTimeOffset TakenAt { get; set; }
    /// <summary>Preparation for several domains (roadmap 17); always 1 for now.</summary>
    public int DomainId { get; set; } = 1;
    /// <summary>jsonb: normalised snapshot (camelCase, arrays always arrays), see <see cref="Monitoring.PrivilegedSnapshotData"/>.</summary>
    public required string Data { get; set; }
    /// <summary>jsonb: <see cref="Monitoring.PrivilegedEvaluation"/>.</summary>
    public required string Evaluation { get; set; }
    public int GroupCount { get; set; }
    public int MemberCount { get; set; }
    public int ChangeCount { get; set; }
    public int UnexpectedCount { get; set; }
    public int HygieneCount { get; set; }
    public int AttackPathCount { get; set; }
}
