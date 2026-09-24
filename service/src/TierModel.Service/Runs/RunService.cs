using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TierModel.Service.Config;
using TierModel.Service.Data;
using TierModel.Service.Notifications;

namespace TierModel.Service.Runs;

public enum ApprovalOutcome { Done, NotFound, NotAwaiting, OwnRequest, Expired }

public record PlanCandidateDto(long Id, string RequestedBy, DateTimeOffset? FinishedAt, DateTimeOffset? ExpiresAt, PlanSummaryDto? Summary, int Changes);

/// <summary>Latest planning run usable for an apply with the given parameters, or why none is.</summary>
public record PlanCandidatesDto(bool RequirePlan, int MaxAgeHours, PlanCandidateDto? Candidate, long? LatestPlanRunId, string? Reason);

/// <summary>Whether a planning run can be applied right now.</summary>
public record PlanApplicabilityDto(bool Applicable, string? Reason, DateTimeOffset? ExpiresAt);

public class RunService(AppDbContext db, RunQueue queue, ChangeLogService changeLog, SettingsService settings, ConfigService config, NotificationQueue notifications)
{
    public async Task<Run> EnqueueAsync(RunKind kind, RunRequest r, bool confirmApply, string user, RunTrigger trigger = RunTrigger.Manual, long? scheduleId = null,
        CancellationToken ct = default, Run? planRun = null)
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
        if (run.Mode == RunMode.Apply && planRun is not null)
        {
            // Apply exactly the configuration the reviewed planning run was made with.
            run.PlanRunId = planRun.Id;
            run.ConfigVersions = planRun.ConfigVersions;
        }
        if (run.Mode == RunMode.Apply && s.RequireApproval)
        {
            // Four-eyes principle: a second operator must approve. Pin the configuration now, so exactly
            // the reviewed state is deployed even if someone keeps editing in the meantime.
            run.Status = RunStatus.AwaitingApproval;
            run.ApprovalRequired = true;
            run.ApprovalExpiresAt = run.CreatedAt.AddHours(s.ApprovalTimeoutHours);
            run.ConfigVersions ??= JsonSerializer.Serialize((await config.SnapshotAsync(ct)).ToDictionary(x => x.Def.Key, x => x.Version));
        }
        db.Runs.Add(run);
        await db.SaveChangesAsync(ct);

        var what = kind == RunKind.Audit ? "Audit" : run.Mode == RunMode.Apply ? "Deploy (Anwenden)" : "Deploy (Planung)";
        if (run.PlanRunId is { } planId) what += $" nach Planung #{planId}";
        var scope = run.Scope?.ToString() ?? string.Join(", ", RunSummaryDto.IncludeList(run.IncludeMsa, run.IncludeGmsa, run.IncludeDmsa, run.IncludeWinLaps));
        changeLog.Add(user, kind == RunKind.Audit ? "run.audit" : "run.deploy", "run", run.Id.ToString(),
            run.Status == RunStatus.AwaitingApproval
                ? $"{what} #{run.Id} zur Freigabe eingereicht: {scope} über {run.PreferredDc}"
                : $"{what} #{run.Id} gestartet: {scope} über {run.PreferredDc}");
        await db.SaveChangesAsync(ct);
        if (run.Status == RunStatus.AwaitingApproval) notifications.Enqueue(NotificationEvent.ApprovalRequested, run.Id);
        else queue.Notify();
        return run;
    }

    private async Task<Dictionary<string, int>> CurrentVersionsAsync(CancellationToken ct) =>
        (await config.SnapshotAsync(ct)).ToDictionary(x => x.Def.Key, x => x.Version);

    /// <summary>
    /// Checks the planning run an apply refers to. Returns the plan run (null when none is needed and none was given)
    /// or a German error for the <c>planRunId</c> field.
    /// </summary>
    public async Task<(Run? Plan, string? Error)> CheckPlanForApplyAsync(DeployRequest r, CancellationToken ct = default)
    {
        var s = await settings.GetAsync(ct);
        if (r.PlanRunId is not { } planId)
            return s.RequirePlanBeforeApply
                ? (null, "Anwenden ist nur nach einer geprüften Planung möglich. Bitte zuerst einen Planungslauf mit denselben Parametern starten und dessen Ergebnis anwenden.")
                : (null, null);
        var plan = await db.Runs.AsNoTracking().FirstOrDefaultAsync(x => x.Id == planId, ct);
        var error = PlanGate.Check(plan, PlanGate.From(r.ToRunRequest(), s.AdmlLanguage), await CurrentVersionsAsync(ct), DateTimeOffset.UtcNow, s.PlanMaxAgeHours);
        return error is null ? (plan, null) : (null, error);
    }

    /// <summary>Whether the given planning run could be applied now (same parameters as itself, current configuration, not expired).</summary>
    public async Task<PlanApplicabilityDto?> PlanApplicabilityAsync(Run plan, CancellationToken ct = default)
    {
        if (plan.Kind != RunKind.Deploy || plan.Mode != RunMode.Plan) return null;
        var s = await settings.GetAsync(ct);
        var target = new PlanGate.Target(plan.Scope, plan.IncludeMsa, plan.IncludeGmsa, plan.IncludeDmsa, plan.IncludeWinLaps, plan.PreferredDc, plan.AdmlLanguage);
        var error = PlanGate.Check(plan, target, await CurrentVersionsAsync(ct), DateTimeOffset.UtcNow, s.PlanMaxAgeHours);
        return new PlanApplicabilityDto(error is null, error, plan.Status == RunStatus.Succeeded ? PlanGate.ExpiresAt(plan, s.PlanMaxAgeHours) : null);
    }

    /// <summary>The newest planning run an apply with these parameters could use.</summary>
    public async Task<PlanCandidatesDto> FindPlanCandidateAsync(RunRequest r, CancellationToken ct = default)
    {
        var s = await settings.GetAsync(ct);
        var target = PlanGate.From(r, s.AdmlLanguage);
        var since = DateTimeOffset.UtcNow.AddHours(-Math.Max(s.PlanMaxAgeHours, 24) * 2);
        var recent = await db.Runs.AsNoTracking()
            .Where(x => x.Kind == RunKind.Deploy && x.Mode == RunMode.Plan && x.Scope == r.Scope
                && x.IncludeMsa == r.IncludeMsa && x.IncludeGmsa == r.IncludeGmsa && x.IncludeDmsa == r.IncludeDmsa && x.IncludeWinLaps == r.IncludeWinLaps
                && x.CreatedAt >= since)
            .OrderByDescending(x => x.Id).Take(50).ToListAsync(ct);
        var sameParameters = recent.Where(x => PlanGate.ParameterMismatch(x, target) is null).ToList();
        var versions = await CurrentVersionsAsync(ct);
        var now = DateTimeOffset.UtcNow;
        foreach (var plan in sameParameters.Where(x => x.Status == RunStatus.Succeeded))
        {
            if (PlanGate.Check(plan, target, versions, now, s.PlanMaxAgeHours) is not null) continue;
            var parsed = DeployPlanReader.Deserialize(plan.Plan);
            return new PlanCandidatesDto(s.RequirePlanBeforeApply, s.PlanMaxAgeHours,
                new PlanCandidateDto(plan.Id, plan.RequestedBy, plan.FinishedAt, PlanGate.ExpiresAt(plan, s.PlanMaxAgeHours), parsed?.Summary,
                    parsed is null ? 0 : DeployPlanReader.TotalChanges(parsed)),
                plan.Id, null);
        }
        var latest = sameParameters.FirstOrDefault();
        var reason = latest is null
            ? "Für diese Parameter gibt es noch keinen Planungslauf."
            : latest.Status is RunStatus.Queued or RunStatus.Running
                ? $"Planung #{latest.Id} läuft noch."
                : PlanGate.Check(latest, target, versions, now, s.PlanMaxAgeHours);
        return new PlanCandidatesDto(s.RequirePlanBeforeApply, s.PlanMaxAgeHours, null, latest?.Id, reason);
    }

    /// <summary>Cancels a queued or running run. Returns null if the run does not exist, false if it has already finished.</summary>
    public async Task<bool?> CancelAsync(long id, string user, CancellationToken ct = default)
    {
        if (!await db.Runs.AnyAsync(r => r.Id == id, ct)) return null;
        var cancelledQueued = await db.Runs
            .Where(r => r.Id == id && (r.Status == RunStatus.Queued || r.Status == RunStatus.AwaitingApproval))
            .ExecuteUpdateAsync(u => u
                .SetProperty(r => r.Status, RunStatus.Cancelled)
                .SetProperty(r => r.FinishedAt, DateTimeOffset.UtcNow)
                .SetProperty(r => r.Message, $"Vor dem Start abgebrochen von {user}"), ct);
        if (cancelledQueued == 0)
        {
            var running = await db.Runs.AnyAsync(r => r.Id == id && r.Status == RunStatus.Running, ct);
            if (!running) return false;
            queue.Cancel(id);
        }
        changeLog.Add(user, "run.cancel", "run", id.ToString(), $"Lauf #{id} abgebrochen");
        await db.SaveChangesAsync(ct);
        return true;
    }

    public async Task<(ApprovalOutcome, Run?)> DecideAsync(long id, bool approve, string user, string? comment, CancellationToken ct = default)
    {
        var run = await db.Runs.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (run is null) return (ApprovalOutcome.NotFound, null);
        if (run.Status != RunStatus.AwaitingApproval) return (ApprovalOutcome.NotAwaiting, run);
        if (string.Equals(run.RequestedBy, user, StringComparison.OrdinalIgnoreCase)) return (ApprovalOutcome.OwnRequest, run);
        if (run.ApprovalExpiresAt <= DateTimeOffset.UtcNow)
        {
            await ExpireAsync(run, ct);
            return (ApprovalOutcome.Expired, run);
        }

        var now = DateTimeOffset.UtcNow;
        run.ApprovedBy = user;
        run.ApprovedAt = now;
        run.ApprovalComment = string.IsNullOrWhiteSpace(comment) ? null : comment.Trim();
        if (approve)
        {
            run.Status = RunStatus.Queued;
            changeLog.Add(user, "run.approve", "run", id.ToString(),
                $"Deploy #{id} von {run.RequestedBy} freigegeben" + (run.ApprovalComment is null ? "" : $": {run.ApprovalComment}"));
        }
        else
        {
            run.Status = RunStatus.Rejected;
            run.FinishedAt = now;
            run.Message = $"Abgelehnt von {user}: {run.ApprovalComment}";
            changeLog.Add(user, "run.reject", "run", id.ToString(), $"Deploy #{id} von {run.RequestedBy} abgelehnt: {run.ApprovalComment}");
        }
        // Optimistic check: only one decision wins if two operators click at the same time.
        var updated = await db.Runs.Where(r => r.Id == id && r.Status == RunStatus.AwaitingApproval).ExecuteUpdateAsync(u => u
            .SetProperty(r => r.Status, run.Status)
            .SetProperty(r => r.ApprovedBy, run.ApprovedBy)
            .SetProperty(r => r.ApprovedAt, run.ApprovedAt)
            .SetProperty(r => r.ApprovalComment, run.ApprovalComment)
            .SetProperty(r => r.FinishedAt, run.FinishedAt)
            .SetProperty(r => r.Message, run.Message), ct);
        if (updated == 0) return (ApprovalOutcome.NotAwaiting, run);
        await db.Entry(run).ReloadAsync(ct);   // values written by ExecuteUpdate; also drops the tracked edits
        await db.SaveChangesAsync(ct);         // change log entry
        if (approve) queue.Notify();
        return (ApprovalOutcome.Done, run);
    }

    private async Task ExpireAsync(Run run, CancellationToken ct)
    {
        var n = await db.Runs.Where(r => r.Id == run.Id && r.Status == RunStatus.AwaitingApproval).ExecuteUpdateAsync(u => u
            .SetProperty(r => r.Status, RunStatus.Rejected)
            .SetProperty(r => r.FinishedAt, DateTimeOffset.UtcNow)
            .SetProperty(r => r.Message, "Freigabe abgelaufen – niemand hat rechtzeitig freigegeben."), ct);
        if (n == 0) return;
        run.Status = RunStatus.Rejected;
        changeLog.Add("system", "run.approval-expired", "run", run.Id.ToString(), $"Freigabe für Deploy #{run.Id} von {run.RequestedBy} abgelaufen");
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Rejects all approval requests past their deadline. Returns the number expired.</summary>
    public async Task<int> ExpireOverdueAsync(CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow;
        var overdue = await db.Runs.Where(r => r.Status == RunStatus.AwaitingApproval && r.ApprovalExpiresAt <= now).ToListAsync(ct);
        foreach (var run in overdue) await ExpireAsync(run, ct);
        return overdue.Count;
    }
}
