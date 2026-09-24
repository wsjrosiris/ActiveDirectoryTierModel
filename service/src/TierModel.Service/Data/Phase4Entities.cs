namespace TierModel.Service.Data;

/// <summary>
/// Recurring maintenance window: applies may start on the given weekdays between <see cref="From"/> and <see cref="To"/>
/// (local time of <see cref="TimeZone"/>). <c>To &lt;= From</c> means the window ends on the next day (e.g. 22:00–04:00);
/// <c>To == From</c> is a whole day. As long as no window is enabled, applies are not restricted by windows.
/// </summary>
public class MaintenanceWindow
{
    public long Id { get; set; }
    public required string Name { get; set; }
    /// <summary>Days on which the window opens, as <see cref="DayOfWeek"/> numbers (0 = Sunday).</summary>
    public int[] Days { get; set; } = [];
    public TimeOnly From { get; set; }
    public TimeOnly To { get; set; }
    public required string TimeZone { get; set; }
    public bool Enabled { get; set; } = true;
    /// <summary>Domains the window applies to (roadmap 17); empty = all domains.</summary>
    public int[] DomainIds { get; set; } = [];
    public required string CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>Change freeze: no apply may start between <see cref="From"/> (inclusive) and <see cref="To"/> (exclusive).</summary>
public class FreezePeriod
{
    public long Id { get; set; }
    public DateTimeOffset From { get; set; }
    public DateTimeOffset To { get; set; }
    public required string Reason { get; set; }
    public bool Enabled { get; set; } = true;
    /// <summary>Domains the freeze applies to (roadmap 17); empty = all domains.</summary>
    public int[] DomainIds { get; set; } = [];
    public required string CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>
/// Personal API token (<c>tmk_&lt;prefix&gt;_&lt;secret&gt;</c>). Only the SHA-256 hash of the whole token is stored;
/// the token acts with <see cref="Role"/>, capped at the owner's current role on every request.
/// </summary>
public class ApiToken
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public required string Name { get; set; }
    /// <summary>Random 8 characters identifying the token (shown in lists, used for the lookup).</summary>
    public required string Prefix { get; set; }
    /// <summary>Hex SHA-256 of the complete token string.</summary>
    public required string SecretHash { get; set; }
    public Role Role { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? LastUsedAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public string? RevokedBy { get; set; }
}
