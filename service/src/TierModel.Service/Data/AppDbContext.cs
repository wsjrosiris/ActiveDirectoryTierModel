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
        });

        b.Entity<ChangeEntry>(e =>
        {
            e.ToTable("change_log");
            e.HasIndex(x => x.At);
            e.HasIndex(x => new { x.EntityType, x.At });
            e.Property(x => x.Details).HasColumnType("jsonb");
        });

        b.Entity<NotificationChannel>(e =>
        {
            e.ToTable("notification_channels");
            e.Property(x => x.Type).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Name).HasMaxLength(100);
        });

        b.Entity<Setting>(e =>
        {
            e.ToTable("settings");
            e.HasKey(x => x.Key);
        });
    }
}
