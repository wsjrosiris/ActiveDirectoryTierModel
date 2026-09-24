using Microsoft.EntityFrameworkCore;
using TierModel.Service.Data;

namespace TierModel.Service.Runs;

public class RunService(AppDbContext db, RunQueue queue, ChangeLogService changeLog, SettingsService settings)
{
    public async Task<Run> EnqueueAsync(RunKind kind, RunRequest r, bool confirmApply, string user, RunTrigger trigger = RunTrigger.Manual, long? scheduleId = null, CancellationToken ct = default)
    {
        var s = await settings.GetAsync(ct);
        var run = new Run
        {
            Kind = kind,
            Status = RunStatus.Queued,
            Trigger = trigger,
            Mode = kind == RunKind.Deploy ? (confirmApply ? RunMode.Apply : RunMode.Plan) : null,
            Scope = r.Scope,
            IncludeMsa = r.IncludeMsa,
            IncludeGmsa = r.IncludeGmsa,
            IncludeDmsa = r.IncludeDmsa,
            IncludeWinLaps = r.IncludeWinLaps,
            PreferredDc = r.PreferredDc.Trim(),
            AdmlLanguage = string.IsNullOrWhiteSpace(r.AdmlLanguage) ? s.AdmlLanguage : r.AdmlLanguage.Trim(),
            RequestedBy = user,
            ScheduleId = scheduleId,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Runs.Add(run);
        await db.SaveChangesAsync(ct);

        var what = kind == RunKind.Audit ? "Audit" : run.Mode == RunMode.Apply ? "Deploy (Anwenden)" : "Deploy (Planung)";
        var scope = run.Scope?.ToString() ?? string.Join(", ", RunSummaryDto.IncludeList(run.IncludeMsa, run.IncludeGmsa, run.IncludeDmsa, run.IncludeWinLaps));
        changeLog.Add(user, kind == RunKind.Audit ? "run.audit" : "run.deploy", "run", run.Id.ToString(),
            $"{what} #{run.Id} gestartet: {scope} über {run.PreferredDc}");
        await db.SaveChangesAsync(ct);
        queue.Notify();
        return run;
    }

    /// <summary>Cancels a queued or running run. Returns false if it has already finished.</summary>
    public async Task<bool> CancelAsync(long id, string user, CancellationToken ct = default)
    {
        var cancelledQueued = await db.Runs
            .Where(r => r.Id == id && r.Status == RunStatus.Queued)
            .ExecuteUpdateAsync(u => u
                .SetProperty(r => r.Status, RunStatus.Cancelled)
                .SetProperty(r => r.FinishedAt, DateTimeOffset.UtcNow)
                .SetProperty(r => r.Message, $"Vor dem Start abgebrochen von {user}"), ct);
        if (cancelledQueued == 0)
        {
            var running = await db.Runs.AnyAsync(r => r.Id == id && r.Status == RunStatus.Running, ct);
            if (!running || !queue.TryCancel(id)) return false;
        }
        changeLog.Add(user, "run.cancel", "run", id.ToString(), $"Lauf #{id} abgebrochen");
        await db.SaveChangesAsync(ct);
        return true;
    }
}
