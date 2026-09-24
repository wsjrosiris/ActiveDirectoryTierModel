using Microsoft.EntityFrameworkCore;

namespace TierModel.Service.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<ConfigSection> ConfigSections => Set<ConfigSection>();
    public DbSet<ConfigVersion> ConfigVersions => Set<ConfigVersion>();
    public DbSet<Run> Runs => Set<Run>();
    public DbSet<RunLogLine> RunLogLines => Set<RunLogLine>();
    public DbSet<Schedule> Schedules => Set<Schedule>();
    public DbSet<ChangeEntry> ChangeLog => Set<ChangeEntry>();
    public DbSet<Setting> Settings => Set<Setting>();
    public DbSet<NotificationChannel> NotificationChannels => Set<NotificationChannel>();
    public DbSet<PrivilegedSnapshot> PrivilegedSnapshots => Set<PrivilegedSnapshot>();
    public DbSet<MaintenanceWindow> MaintenanceWindows => Set<MaintenanceWindow>();
    public DbSet<FreezePeriod> FreezePeriods => Set<FreezePeriod>();
    public DbSet<ApiToken> ApiTokens => Set<ApiToken>();
    public DbSet<JitGroup> JitGroups => Set<JitGroup>();
    public DbSet<JitRequest> JitRequests => Set<JitRequest>();

    // New change-log entries are hash-chained (roadmap 23): computed under an advisory lock in the same transaction.
    public override int SaveChanges(bool acceptAllChangesOnSuccess) =>
        HasNewChangeEntries()
            ? ChangeLogChain.SaveChainedAsync(this, ct => Task.FromResult(base.SaveChanges(acceptAllChangesOnSuccess)), CancellationToken.None).GetAwaiter().GetResult()
            : base.SaveChanges(acceptAllChangesOnSuccess);

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default) =>
        HasNewChangeEntries()
            ? ChangeLogChain.SaveChainedAsync(this, ct => base.SaveChangesAsync(acceptAllChangesOnSuccess, ct), cancellationToken)
            : base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);

    private bool HasNewChangeEntries() => ChangeTracker.Entries<ChangeEntry>().Any(e => e.State == EntityState.Added);

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<AppUser>(e =>
        {
            e.ToTable("users");
            e.HasIndex(x => x.NormalizedUsername).IsUnique();
            e.Property(x => x.Username).HasMaxLength(256);
            e.Property(x => x.NormalizedUsername).HasMaxLength(256);
            e.Property(x => x.DisplayName).HasMaxLength(128);
            e.Property(x => x.Role).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.AuthType).HasConversion<string>().HasMaxLength(16);
            e.HasIndex(x => x.Sid).IsUnique();
        });

        b.Entity<ConfigSection>(e =>
        {
            e.ToTable("config_sections");
            e.HasKey(x => x.Key);
            e.Property(x => x.Key).HasMaxLength(64);
        });

        b.Entity<ConfigVersion>(e =>
        {
            e.ToTable("config_versions");
            e.HasIndex(x => new { x.SectionKey, x.Version }).IsUnique();
            e.HasOne<ConfigSection>().WithMany().HasForeignKey(x => x.SectionKey);
        });

        b.Entity<Run>(e =>
        {
            e.ToTable("runs");
            e.HasIndex(x => new { x.Status, x.Id });
            e.HasIndex(x => new { x.Kind, x.Id });
            foreach (var p in new[] { nameof(Run.Kind), nameof(Run.Status), nameof(Run.Trigger), nameof(Run.Mode), nameof(Run.Scope) })
                e.Property(p).HasConversion<string>().HasMaxLength(24);
            e.Property(x => x.ConfigVersions).HasColumnType("jsonb");
            e.Property(x => x.Summary).HasColumnType("jsonb");
            e.Property(x => x.Findings).HasColumnType("jsonb");
            e.Property(x => x.Plan).HasColumnType("jsonb");
            e.HasIndex(x => x.PlanRunId);
            e.HasIndex(x => new { x.Status, x.ScheduledFor });
            e.Property(x => x.JitAction).HasConversion<string>().HasMaxLength(16);
            e.HasIndex(x => x.JitRequestId);
        });

        b.Entity<RunLogLine>(e =>
        {
            e.ToTable("run_log_lines");
            e.HasIndex(x => new { x.RunId, x.Seq }).IsUnique();
            e.HasOne<Run>().WithMany().HasForeignKey(x => x.RunId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Schedule>(e =>
        {
            e.ToTable("schedules");
            e.Property(x => x.Scope).HasConversion<string>().HasMaxLength(24);
            // Existing schedules are audits.
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(24).HasDefaultValue(RunKind.Audit).HasSentinel(RunKind.Deploy);
        });

        b.Entity<ChangeEntry>(e =>
        {
            e.ToTable("change_log");
            e.HasIndex(x => x.At);
            e.HasIndex(x => new { x.EntityType, x.At });
            e.Property(x => x.Details).HasColumnType("jsonb");
            e.Property(x => x.Hash).HasMaxLength(64);
            e.Property(x => x.PrevHash).HasMaxLength(64);
        });

        b.Entity<MaintenanceWindow>(e =>
        {
            e.ToTable("maintenance_windows");
            e.Property(x => x.Name).HasMaxLength(100);
            e.Property(x => x.TimeZone).HasMaxLength(64);
        });

        b.Entity<FreezePeriod>(e =>
        {
            e.ToTable("freeze_periods");
            e.Property(x => x.Reason).HasMaxLength(200);
            e.HasIndex(x => new { x.From, x.To });
        });

        b.Entity<ApiToken>(e =>
        {
            e.ToTable("api_tokens");
            e.Property(x => x.Name).HasMaxLength(100);
            e.Property(x => x.Prefix).HasMaxLength(8);
            e.Property(x => x.SecretHash).HasMaxLength(64);
            e.Property(x => x.Role).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.RevokedBy).HasMaxLength(256);
            e.HasIndex(x => x.Prefix).IsUnique();
            e.HasIndex(x => x.UserId);
            e.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<JitGroup>(e =>
        {
            e.ToTable("jit_groups");
            e.Property(x => x.Group).HasMaxLength(256);
            e.Property(x => x.GroupSid).HasMaxLength(184);
            e.Property(x => x.DisplayName).HasMaxLength(128);
            e.Property(x => x.MinimumRole).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.CreatedBy).HasMaxLength(256);
            e.HasIndex(x => x.Group).IsUnique();
        });

        b.Entity<JitRequest>(e =>
        {
            e.ToTable("jit_requests");
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.RequestedBy).HasMaxLength(256);
            e.Property(x => x.MemberAccount).HasMaxLength(256);
            e.Property(x => x.Group).HasMaxLength(256);
            e.Property(x => x.GroupDisplayName).HasMaxLength(128);
            e.Property(x => x.Justification).HasMaxLength(1000);
            e.Property(x => x.DecidedBy).HasMaxLength(256);
            e.Property(x => x.DecisionComment).HasMaxLength(1000);
            e.Property(x => x.RevokedBy).HasMaxLength(256);
            e.Property(x => x.GroupSid).HasMaxLength(184);
            e.Property(x => x.MemberSid).HasMaxLength(184);
            e.Property(x => x.Dc).HasMaxLength(253);
            e.HasIndex(x => new { x.Status, x.ExpiresAt });
            e.HasIndex(x => new { x.RequestedBy, x.Id });
            e.HasOne<JitGroup>().WithMany().HasForeignKey(x => x.JitGroupId).OnDelete(DeleteBehavior.SetNull);
        });

        b.Entity<NotificationChannel>(e =>
        {
            e.ToTable("notification_channels");
            e.Property(x => x.Type).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Name).HasMaxLength(100);
        });

        b.Entity<PrivilegedSnapshot>(e =>
        {
            e.ToTable("privileged_snapshots");
            e.Property(x => x.Data).HasColumnType("jsonb");
            e.Property(x => x.Evaluation).HasColumnType("jsonb");
            e.Property(x => x.DomainId).HasDefaultValue(1);
            e.HasIndex(x => new { x.DomainId, x.Id });
            e.HasIndex(x => x.RunId).IsUnique();
            e.HasOne<Run>().WithMany().HasForeignKey(x => x.RunId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Setting>(e =>
        {
            e.ToTable("settings");
            e.HasKey(x => x.Key);
        });
    }
}
