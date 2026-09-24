using Cronos;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TierModel.Service.Data;

namespace TierModel.Service.Runs;

/// <summary>Queues scheduled audits when they are due and removes expired run data once a day.</summary>
public class ScheduleWorker(IServiceScopeFactory scopes, IOptions<TierModelOptions> options, ILogger<ScheduleWorker> logger) : BackgroundService
{
    private DateTimeOffset _lastCleanup = DateTimeOffset.MinValue;

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
            return $"Ungültiger Cron-Ausdruck: {ex.Message}";
        }
        try
        {
            TimeZoneConverter.TZConvert.GetTimeZoneInfo(timeZone);
        }
        catch (Exception)
        {
            return $"Unbekannte Zeitzone '{timeZone}'.";
        }
        return null;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        do
        {
            try
            {
                await QueueDueAsync(stoppingToken);
                if (DateTimeOffset.UtcNow - _lastCleanup > TimeSpan.FromDays(1))
                {
                    await CleanupAsync(stoppingToken);
                    _lastCleanup = DateTimeOffset.UtcNow;
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
        var now = DateTimeOffset.UtcNow;

        var due = await db.Schedules.Where(s => s.Enabled && s.NextRunAt != null && s.NextRunAt <= now).ToListAsync(ct);
        foreach (var s in due)
        {
            // Skip if the previous run of this schedule is still waiting or running.
            var busy = s.LastRunId is { } last && await db.Runs.AnyAsync(r => r.Id == last && (r.Status == RunStatus.Queued || r.Status == RunStatus.Running), ct);
            if (!busy)
            {
                var run = await runs.EnqueueAsync(RunKind.Audit,
                    new RunRequest(s.PreferredDc, s.Scope, s.IncludeMsa, s.IncludeGmsa, s.IncludeDmsa, s.IncludeWinLaps, s.AdmlLanguage),
                    confirmApply: false, $"Zeitplan: {s.Name}", RunTrigger.Schedule, s.Id, ct);
                s.LastRunId = run.Id;
                s.LastRunAt = now;
                logger.LogInformation("Schedule {Schedule} queued audit run {RunId}", s.Name, run.Id);
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
