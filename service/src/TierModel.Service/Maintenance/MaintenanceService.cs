using Microsoft.EntityFrameworkCore;
using TierModel.Service.Data;
using TierModel.Service.Runs;

namespace TierModel.Service.Maintenance;

public record FreezeInfoDto(long Id, string Reason, DateTimeOffset From, DateTimeOffset To);

public record WindowInstanceDto(long WindowId, string Name, DateTimeOffset Start, DateTimeOffset End);

/// <summary>What the deploy page shows before an apply.</summary>
/// <param name="Restricted">At least one enabled maintenance window exists.</param>
/// <param name="AllowedNow">An apply requested now would start immediately.</param>
/// <param name="NextStart">When an apply requested now would start (null: no possible start within the horizon).</param>
public record MaintenanceStatusDto(bool Restricted, bool AllowedNow, FreezeInfoDto? ActiveFreeze, WindowInstanceDto? CurrentWindow,
    DateTimeOffset? NextStart, WindowInstanceDto? NextWindow, List<WindowInstanceDto> Upcoming, List<FreezeInfoDto> UpcomingFreezes, int ScheduledRuns);

/// <summary>Applies the maintenance-window rules to apply runs (roadmap 4). Plans, audits and monitor runs are never restricted.</summary>
public class MaintenanceService(AppDbContext db, RunQueue queue, ChangeLogService changeLog, ILogger<MaintenanceService> logger)
{
    public async Task<MaintenanceCalendar> CalendarAsync(CancellationToken ct = default) =>
        new(await db.MaintenanceWindows.AsNoTracking().ToListAsync(ct), await db.FreezePeriods.AsNoTracking().ToListAsync(ct));

    public static bool IsRestricted(Run run) => run.Kind == RunKind.Deploy && run.Mode == RunMode.Apply;

    public static string FreezeMessage(FreezePeriod f) =>
        $"Sperrzeit „{f.Reason}“: Änderungen im Active Directory sind bis {MaintenanceCalendar.Format(f.To)} gesperrt. Anwenden ist erst danach wieder möglich.";

    /// <summary>German error when an apply cannot be requested now (active freeze, or no possible start at all); otherwise null.</summary>
    public async Task<string?> CheckApplyRequestAsync(DateTimeOffset now, CancellationToken ct = default)
    {
        var cal = await CalendarAsync(ct);
        if (cal.FreezeAt(now) is { } freeze) return FreezeMessage(freeze);
        if (cal.NextAllowedStart(now) is null)
            return "In den nächsten Monaten gibt es kein Wartungsfenster außerhalb einer Sperrzeit. Bitte die Wartungsfenster prüfen.";
        return null;
    }

    /// <summary>Queued now, or Scheduled for the next allowed start.</summary>
    public async Task<(RunStatus Status, DateTimeOffset? ScheduledFor)> StartStatusAsync(DateTimeOffset now, CancellationToken ct = default)
    {
        var cal = await CalendarAsync(ct);
        if (cal.Allows(now)) return (RunStatus.Queued, null);
        // No start within the horizon: stay scheduled and re-check daily (the worker recomputes).
        return (RunStatus.Scheduled, cal.NextAllowedStart(now) ?? now.AddDays(1));
    }

    /// <summary>Queues scheduled applies that are due and allowed; moves the others to their next allowed start.</summary>
    public async Task<int> PromoteDueAsync(DateTimeOffset now, CancellationToken ct = default)
    {
        var due = await db.Runs.Where(r => r.Status == RunStatus.Scheduled && r.ScheduledFor <= now).OrderBy(r => r.Id).ToListAsync(ct);
        if (due.Count == 0) return 0;
        var cal = await CalendarAsync(ct);
        var promoted = 0;
        foreach (var run in due)
        {
            if (cal.Allows(now))
            {
                var n = await db.Runs.Where(r => r.Id == run.Id && r.Status == RunStatus.Scheduled).ExecuteUpdateAsync(u => u
                    .SetProperty(r => r.Status, RunStatus.Queued), ct);
                if (n == 1)
                {
                    promoted++;
                    changeLog.Add("system", "run.window-start", "run", run.Id.ToString(),
                        $"Deploy #{run.Id} von {run.RequestedBy}: Wartungsfenster erreicht, Lauf eingereiht");
                }
            }
            else
            {
                var next = cal.NextAllowedStart(now) ?? now.AddDays(1);
                await db.Runs.Where(r => r.Id == run.Id && r.Status == RunStatus.Scheduled).ExecuteUpdateAsync(u => u
                    .SetProperty(r => r.ScheduledFor, next), ct);
                logger.LogInformation("Scheduled run {RunId} moved to {Next} (freeze or window changed)", run.Id, next);
            }
        }
        await db.SaveChangesAsync(ct);
        if (promoted > 0) queue.Notify();
        return promoted;
    }

    /// <summary>After windows or freezes changed: recompute the start of all scheduled applies.</summary>
    public async Task RescheduleAllAsync(CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow;
        var cal = await CalendarAsync(ct);
        var runs = await db.Runs.Where(r => r.Status == RunStatus.Scheduled).ToListAsync(ct);
        foreach (var run in runs)
            run.ScheduledFor = cal.Allows(now) ? now : cal.NextAllowedStart(now) ?? now.AddDays(1);
        await db.SaveChangesAsync(ct);
        if (runs.Count > 0) await PromoteDueAsync(now, ct);
    }

    public async Task<MaintenanceStatusDto> StatusAsync(DateTimeOffset now, CancellationToken ct = default)
    {
        var cal = await CalendarAsync(ct);
        var freeze = cal.FreezeAt(now);
        var current = cal.Restricted ? cal.WindowAt(now) : null;
        var next = cal.NextAllowedStart(now);
        var nextWindow = next is { } n && cal.Restricted ? cal.WindowAt(n) : null;
        var upcomingFreezes = await db.FreezePeriods.AsNoTracking().Where(f => f.Enabled && f.To > now).OrderBy(f => f.From).Take(5).ToListAsync(ct);
        return new MaintenanceStatusDto(cal.Restricted, cal.Allows(now), freeze is null ? null : ToDto(freeze), ToDto(current), next, ToDto(nextWindow),
            cal.Upcoming(now, 5).Select(i => ToDto(i)!).ToList(), upcomingFreezes.Select(ToDto).ToList(),
            await db.Runs.CountAsync(r => r.Status == RunStatus.Scheduled, ct));
    }

    private static FreezeInfoDto ToDto(FreezePeriod f) => new(f.Id, f.Reason, f.From, f.To);

    private static WindowInstanceDto? ToDto(WindowInstance? i) => i is null ? null : new(i.WindowId, i.Name, i.Start, i.End);
}
