using Cronos;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TierModel.Service.Data;
using TierModel.Service.Localization;

namespace TierModel.Service.Runs;

/// <summary>Queues scheduled audits and monitor runs when they are due and removes expired run data once a day.</summary>
public class ScheduleWorker(IServiceScopeFactory scopes, IOptions<TierModelOptions> options, WorkerHeartbeats heartbeats, ILogger<ScheduleWorker> logger) : BackgroundService
{
    public const string HeartbeatName = "ScheduleWorker";
    private DateTimeOffset _lastCleanup = DateTimeOffset.MinValue;
    private DateTimeOffset _lastCertificateCheck = DateTimeOffset.MinValue;

    public static RunRequest RequestFor(Schedule s) => s.Kind == RunKind.Monitor
        ? new(s.PreferredDc, null, false, false, false, false, null)
        : new(s.PreferredDc, s.Scope, s.IncludeMsa, s.IncludeGmsa, s.IncludeDmsa, s.IncludeWinLaps, s.AdmlLanguage);

    public static DateTimeOffset? NextOccurrence(string cron, string timeZone, DateTimeOffset after)
    {
        var expr = CronExpression.Parse(cron, CronFormat.Standard);
        var tz = TimeZoneConverter.TZConvert.GetTimeZoneInfo(timeZone);
        return expr.GetNextOccurrence(after, tz)?.ToUniversalTime();
    }

    /// <summary>Returns an error message, or null if the cron expression and time zone are valid.</summary>
    public static string? Validate(string cron, string timeZone)
    {
        try
        {
            CronExpression.Parse(cron, CronFormat.Standard);
        }
        catch (CronFormatException ex)
        {
            return L.F("Ungültiger Cron-Ausdruck: {0}", ex.Message);
        }
        try
        {
            TimeZoneConverter.TZConvert.GetTimeZoneInfo(timeZone);
        }
        catch (Exception)
        {
            return L.F("Unbekannte Zeitzone '{0}'.", timeZone);
        }
        return null;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        do
        {
            heartbeats.Beat(HeartbeatName, TimeSpan.FromSeconds(30));
            try
            {
                await QueueDueAsync(stoppingToken);
                await PromoteScheduledAsync(stoppingToken);
                await ExpireApprovalsAsync(stoppingToken);
                if (DateTimeOffset.UtcNow - _lastCleanup > TimeSpan.FromDays(1))
                {
                    await CleanupAsync(stoppingToken);
                    _lastCleanup = DateTimeOffset.UtcNow;
                }
                if (DateTimeOffset.UtcNow - _lastCertificateCheck > TimeSpan.FromDays(1))
                {
                    _lastCertificateCheck = DateTimeOffset.UtcNow;
                    await using var scope = scopes.CreateAsyncScope();
                    await scope.ServiceProvider.GetRequiredService<HealthService>().CheckCertificateExpiryAsync(stoppingToken);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Scheduler iteration failed");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task QueueDueAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var runs = scope.ServiceProvider.GetRequiredService<RunService>();
        var domain = scope.ServiceProvider.GetRequiredService<Domains.DomainContext>();
        var domains = scope.ServiceProvider.GetRequiredService<Domains.DomainRegistry>();
        var now = DateTimeOffset.UtcNow;

        var due = await db.Schedules.Where(s => s.Enabled && s.NextRunAt != null && s.NextRunAt <= now).ToListAsync(ct);
        foreach (var s in due)
        {
            // The run belongs to the schedule's domain (roadmap 17); disabled domains do not run.
            domain.Use(s.DomainId);
            var disabled = domains.Find(s.DomainId) is { Enabled: false };
            // Skip if the previous run of this schedule is still waiting or running.
            var busy = s.LastRunId is { } last && await db.Runs.AnyAsync(r => r.Id == last && (r.Status == RunStatus.Queued || r.Status == RunStatus.Running), ct);
            if (disabled)
            {
                logger.LogInformation("Schedule {Schedule} skipped: domain {Domain} is disabled", s.Name, domain.Key);
            }
            else if (!busy)
            {
                var run = await runs.EnqueueAsync(s.Kind == RunKind.Monitor ? RunKind.Monitor : RunKind.Audit, RequestFor(s),
                    confirmApply: false, L.PF("Zeitplan: {0}", s.Name), RunTrigger.Schedule, s.Id, ct);
                s.LastRunId = run.Id;
                s.LastRunAt = now;
                logger.LogInformation("Schedule {Schedule} queued {Kind} run {RunId}", s.Name, s.Kind, run.Id);
            }
            else
            {
                logger.LogWarning("Schedule {Schedule} skipped: previous run still active", s.Name);
            }

            try
            {
                s.NextRunAt = NextOccurrence(s.Cron, s.TimeZone, now);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Schedule {Schedule} has an invalid cron/timezone and was disabled", s.Name);
                s.Enabled = false;
                s.NextRunAt = null;
            }
        }
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Applies waiting for a maintenance window (roadmap 4) are queued once it opens.</summary>
    private async Task PromoteScheduledAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var n = await scope.ServiceProvider.GetRequiredService<Maintenance.MaintenanceService>().PromoteDueAsync(DateTimeOffset.UtcNow, ct);
        if (n > 0) logger.LogInformation("{Count} scheduled apply run(s) queued: maintenance window open", n);
    }

    private async Task ExpireApprovalsAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var n = await scope.ServiceProvider.GetRequiredService<RunService>().ExpireOverdueAsync(ct);
        if (n > 0) logger.LogInformation("{Count} approval request(s) expired", n);
    }

    private async Task CleanupAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var settings = await scope.ServiceProvider.GetRequiredService<SettingsService>().GetAsync(ct);
        if (settings.RunRetentionDays <= 0) return;

        var cutoff = DateTimeOffset.UtcNow.AddDays(-settings.RunRetentionDays);
        var lines = await db.RunLogLines
            .Where(l => db.Runs.Any(r => r.Id == l.RunId && r.FinishedAt != null && r.FinishedAt < cutoff))
            .ExecuteDeleteAsync(ct);
        var folders = Workspace.Cleanup(options.Value, TimeSpan.FromDays(settings.RunRetentionDays), logger);
        if (lines > 0 || folders > 0)
            logger.LogInformation("Retention: removed {Lines} log lines and {Folders} run folders older than {Days} days", lines, folders, settings.RunRetentionDays);
    }
}
