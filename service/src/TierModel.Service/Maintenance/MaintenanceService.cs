using Microsoft.EntityFrameworkCore;
using TierModel.Service.Data;
using TierModel.Service.Runs;
using TierModel.Service.Localization;

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
/// <remarks>Windows and freezes are instance-wide; one limited to some domains (roadmap 17) only applies to runs of those domains.</remarks>
public class MaintenanceService(AppDbContext db, RunQueue queue, ChangeLogService changeLog, ILogger<MaintenanceService> logger, Domains.DomainContext domain)
{
    public static bool AppliesTo(int[] domainIds, int domainId) => domainIds.Length == 0 || domainIds.Contains(domainId);

    /// <summary>Calendar of the windows and freezes that apply to <paramref name="domainId"/>.</summary>
    public async Task<MaintenanceCalendar> CalendarAsync(int domainId, CancellationToken ct = default) =>
        new((await db.MaintenanceWindows.AsNoTracking().ToListAsync(ct)).Where(w => AppliesTo(w.DomainIds, domainId)),
            (await db.FreezePeriods.AsNoTracking().ToListAsync(ct)).Where(f => AppliesTo(f.DomainIds, domainId)));

    public Task<MaintenanceCalendar> CalendarAsync(CancellationToken ct = default) => CalendarAsync(domain.Id, ct);

    public static bool IsRestricted(Run run) => run.Kind == RunKind.Deploy && run.Mode == RunMode.Apply;

    public static string FreezeMessage(FreezePeriod f) =>
        L.F("Sperrzeit „{0}“: Änderungen im Active Directory sind bis {1} gesperrt. Anwenden ist erst danach wieder möglich.", f.Reason, MaintenanceCalendar.Format(f.To));

    /// <summary>German error when an apply cannot be requested now (active freeze, or no possible start at all); otherwise null.</summary>
    public async Task<string?> CheckApplyRequestAsync(DateTimeOffset now, int domainId, CancellationToken ct = default)
    {
        var cal = await CalendarAsync(domainId, ct);
        if (cal.FreezeAt(now) is { } freeze) return FreezeMessage(freeze);
        if (cal.NextAllowedStart(now) is null)
            return L.T("In den nächsten Monaten gibt es kein Wartungsfenster außerhalb einer Sperrzeit. Bitte die Wartungsfenster prüfen.");
        return null;
    }

    /// <summary>Queued now, or Scheduled for the next allowed start.</summary>
    public async Task<(RunStatus Status, DateTimeOffset? ScheduledFor)> StartStatusAsync(DateTimeOffset now, int domainId, CancellationToken ct = default)
    {
        var cal = await CalendarAsync(domainId, ct);
        if (cal.Allows(now)) return (RunStatus.Queued, null);
        // No start within the horizon: stay scheduled and re-check daily (the worker recomputes).
        return (RunStatus.Scheduled, cal.NextAllowedStart(now) ?? now.AddDays(1));
    }

    /// <summary>Queues scheduled applies that are due and allowed; moves the others to their next allowed start.</summary>
    public async Task<int> PromoteDueAsync(DateTimeOffset now, CancellationToken ct = default)
    {
        var due = await db.Runs.Where(r => r.Status == RunStatus.Scheduled && r.ScheduledFor <= now).OrderBy(r => r.Id).ToListAsync(ct);
        if (due.Count == 0) return 0;
        var calendars = new Dictionary<int, MaintenanceCalendar>();
        var promoted = 0;
        foreach (var run in due)
        {
            if (!calendars.TryGetValue(run.DomainId, out var cal)) calendars[run.DomainId] = cal = await CalendarAsync(run.DomainId, ct);
            if (cal.Allows(now))
            {
                var n = await db.Runs.Where(r => r.Id == run.Id && r.Status == RunStatus.Scheduled).ExecuteUpdateAsync(u => u
                    .SetProperty(r => r.Status, RunStatus.Queued), ct);
                if (n == 1)
                {
                    promoted++;
                    changeLog.Add("system", "run.window-start", "run", run.Id.ToString(),
                        L.PF("Deploy #{0} von {1}: Wartungsfenster erreicht, Lauf eingereiht", run.Id, run.RequestedBy), domainId: run.DomainId);
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
        var runs = await db.Runs.Where(r => r.Status == RunStatus.Scheduled).ToListAsync(ct);
        var calendars = new Dictionary<int, MaintenanceCalendar>();
        foreach (var run in runs)
        {
            if (!calendars.TryGetValue(run.DomainId, out var cal)) calendars[run.DomainId] = cal = await CalendarAsync(run.DomainId, ct);
            run.ScheduledFor = cal.Allows(now) ? now : cal.NextAllowedStart(now) ?? now.AddDays(1);
        }
        await db.SaveChangesAsync(ct);
        if (runs.Count > 0) await PromoteDueAsync(now, ct);
    }

    /// <summary>Status for the current domain.</summary>
    public async Task<MaintenanceStatusDto> StatusAsync(DateTimeOffset now, CancellationToken ct = default)
    {
        var domainId = domain.Id;
        var cal = await CalendarAsync(domainId, ct);
        var freeze = cal.FreezeAt(now);
        var current = cal.Restricted ? cal.WindowAt(now) : null;
        var next = cal.NextAllowedStart(now);
        var nextWindow = next is { } n && cal.Restricted ? cal.WindowAt(n) : null;
        var upcomingFreezes = (await db.FreezePeriods.AsNoTracking().Where(f => f.Enabled && f.To > now).OrderBy(f => f.From).ToListAsync(ct))
            .Where(f => AppliesTo(f.DomainIds, domainId)).Take(5).ToList();
        return new MaintenanceStatusDto(cal.Restricted, cal.Allows(now), freeze is null ? null : ToDto(freeze), ToDto(current), next, ToDto(nextWindow),
            cal.Upcoming(now, 5).Select(i => ToDto(i)!).ToList(), upcomingFreezes.Select(ToDto).ToList(),
            await db.Runs.CountAsync(r => r.Status == RunStatus.Scheduled && r.DomainId == domainId, ct));
    }

    private static FreezeInfoDto ToDto(FreezePeriod f) => new(f.Id, f.Reason, f.From, f.To);

    private static WindowInstanceDto? ToDto(WindowInstance? i) => i is null ? null : new(i.WindowId, i.Name, i.Start, i.End);
}
