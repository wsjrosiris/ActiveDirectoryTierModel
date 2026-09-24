using Microsoft.EntityFrameworkCore;

namespace TierModel.Service.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options, TierModel.Service.Domains.DomainContext? domainContext = null) : DbContext(options)
{
    public DbSet<Domain> Domains => Set<Domain>();
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
    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        AssignDomains();
        return HasNewChangeEntries()
            ? ChangeLogChain.SaveChainedAsync(this, ct => Task.FromResult(base.SaveChanges(acceptAllChangesOnSuccess)), CancellationToken.None).GetAwaiter().GetResult()
            : base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        AssignDomains();
        return HasNewChangeEntries()
            ? ChangeLogChain.SaveChainedAsync(this, ct => base.SaveChangesAsync(acceptAllChangesOnSuccess, ct), cancellationToken)
            : base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    /// <summary>New domain-bound rows without an explicit domain belong to the domain of the current request (roadmap 17).</summary>
    private void AssignDomains()
    {
        foreach (var e in ChangeTracker.Entries<IDomainScoped>())
            if (e.State == EntityState.Added && e.Entity.DomainId == 0)
                e.Entity.DomainId = domainContext?.Id ?? throw new InvalidOperationException($"{e.Entity.GetType().Name} ohne Domäne gespeichert.");
    }

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
            e.Property(x => x.Language).HasMaxLength(8);
        });

        b.Entity<Domain>(e =>
        {
            e.ToTable("domains");
            e.Property(x => x.Key).HasMaxLength(32);
            e.Property(x => x.DisplayName).HasMaxLength(100);
            e.Property(x => x.DnsName).HasMaxLength(253);
            e.Property(x => x.PreferredDc).HasMaxLength(253);
            e.Property(x => x.AdmlLanguage).HasMaxLength(5);
            e.Property(x => x.Notes).HasMaxLength(1000);
            e.HasIndex(x => x.Key).IsUnique();
            // At most one default domain.
            e.HasIndex(x => x.IsDefault).IsUnique().HasFilter("\"IsDefault\"");
        });

        // Domain-bound tables (roadmap 17): existing rows belong to the first domain (Id 1).
        b.Entity<ConfigSection>(e =>
        {
            e.ToTable("config_sections");
            e.HasKey(x => new { x.DomainId, x.Key });
            e.Property(x => x.Key).HasMaxLength(64);
            e.Property(x => x.DomainId).HasDefaultValue(1);
            e.HasOne<Domain>().WithMany().HasForeignKey(x => x.DomainId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<ConfigVersion>(e =>
        {
            e.ToTable("config_versions");
            e.Property(x => x.DomainId).HasDefaultValue(1);
            e.HasIndex(x => new { x.DomainId, x.SectionKey, x.Version }).IsUnique();
            e.HasOne<ConfigSection>().WithMany().HasForeignKey(x => new { x.DomainId, x.SectionKey }).OnDelete(DeleteBehavior.Cascade);
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
            e.Property(x => x.DomainId).HasDefaultValue(1);
            e.HasIndex(x => new { x.DomainId, x.Id });
            e.HasOne<Domain>().WithMany().HasForeignKey(x => x.DomainId).OnDelete(DeleteBehavior.Restrict);
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
            e.Property(x => x.DomainId).HasDefaultValue(1);
            e.HasOne<Domain>().WithMany().HasForeignKey(x => x.DomainId).OnDelete(DeleteBehavior.Restrict);
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
            e.Property(x => x.DomainIds).HasDefaultValueSql("'{}'::integer[]");
        });

        b.Entity<FreezePeriod>(e =>
        {
            e.ToTable("freeze_periods");
            e.Property(x => x.Reason).HasMaxLength(200);
            e.HasIndex(x => new { x.From, x.To });
            e.Property(x => x.DomainIds).HasDefaultValueSql("'{}'::integer[]");
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
            e.Property(x => x.DomainId).HasDefaultValue(1);
            e.HasIndex(x => new { x.DomainId, x.Group }).IsUnique();
            e.HasOne<Domain>().WithMany().HasForeignKey(x => x.DomainId).OnDelete(DeleteBehavior.Restrict);
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
            e.Property(x => x.DomainId).HasDefaultValue(1);
            e.HasIndex(x => new { x.DomainId, x.Id });
            e.HasOne<Domain>().WithMany().HasForeignKey(x => x.DomainId).OnDelete(DeleteBehavior.Restrict);
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
            e.HasOne<Domain>().WithMany().HasForeignKey(x => x.DomainId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<Setting>(e =>
        {
            e.ToTable("settings");
            e.HasKey(x => x.Key);
        });
    }
}
