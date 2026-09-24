using Microsoft.EntityFrameworkCore;
using TierModel.Service.Auth;
using TierModel.Service.Config;
using TierModel.Service.Data;
using TierModel.Service.Runs;
using TierModel.Service.Localization;

namespace TierModel.Service.Monitoring;

public record PrivilegedMemberDto(string Sid, string? SamAccountName, string Name, string ObjectClass, string? DistinguishedName,
    bool Direct, List<string> Via, bool? Enabled, bool Unexpected, string? Note);

public record PrivilegedGroupDto(string Sid, string Name, string? WellKnownName, string Source, int? Tier, string? DistinguishedName,
    int MemberCount, int DirectCount, int UnexpectedCount, List<PrivilegedMemberDto> Members);

public record SnapshotInfoDto(long RunId, DateTimeOffset TakenAt, string? PreferredDc, string? Domain, bool Baseline, int GroupCount,
    int MemberCount, int AccountCount, List<string> Errors);

public record PrivilegedOverviewDto(SnapshotInfoDto? Snapshot, HygieneThresholds Thresholds, List<PrivilegedGroupDto> Groups,
    List<UnexpectedMember> Unexpected, List<HygieneFinding> Hygiene, List<AttackPath> AttackPaths, RunSummaryDto? LastRun,
    int MonitorSchedules, int SnapshotCount);

public record ChangeSetDto(long RunId, DateTimeOffset TakenAt, List<MembershipChange> Changes);

public record ChangesDto(List<ChangeSetDto> Items, int SnapshotCount, DateTimeOffset? FirstSnapshotAt);

public record ComplianceBasisDto(long RunId, DateTimeOffset At);

public record ComplianceDayDto(string Date, int? Tier0, int? Tier1, int? Tier2);

public record ComplianceDto(ComplianceWeights Weights, ComplianceBasisDto? Audit, ComplianceBasisDto? Monitor, List<TierCompliance>? Current,
    List<ComplianceDayDto> History);

public static class PrivilegedEndpoints
{
    public static void MapPrivilegedEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api").RequireAuthorization(nameof(Role.Viewer));

        // Everything of the current domain (roadmap 17).
        api.MapGet("/privileged", async (AppDbContext db, ConfigService config, SettingsService settings, Domains.DomainContext domain, CancellationToken ct) =>
        {
            var domainId = domain.Id;
            var s = await settings.GetAsync(ct);
            var thresholds = new HygieneThresholds(s.StaleDays, s.PasswordMaxAgeDays);
            var latest = await db.PrivilegedSnapshots.AsNoTracking().Where(x => x.DomainId == domainId).OrderByDescending(x => x.Id).FirstOrDefaultAsync(ct);
            var lastRun = await db.Runs.AsNoTracking().Where(r => r.DomainId == domainId && r.Kind == RunKind.Monitor).OrderByDescending(r => r.Id).FirstOrDefaultAsync(ct);
            var schedules = await db.Schedules.CountAsync(x => x.DomainId == domainId && x.Kind == RunKind.Monitor && x.Enabled, ct);
            var count = await db.PrivilegedSnapshots.CountAsync(x => x.DomainId == domainId, ct);
            var lastRunDto = lastRun is null ? null : RunSummaryDto.From(lastRun);
            if (latest is null || PrivilegedSnapshotReader.Deserialize(latest.Data) is not { } data)
                return new PrivilegedOverviewDto(null, thresholds, [], [], [], [], lastRunDto, schedules, count);

            var evaluation = PrivilegedEvaluation.Deserialize(latest.Evaluation)
                ?? new PrivilegedEvaluation(true, [], [], [], [], [], thresholds);
            var tier0 = Tier0Config.From(await config.CurrentContentAsync(ct));
            tier0.Jit.AddRange(await Jit.JitService.ExpectationsAsync(db, latest.TakenAt, domainId, ct));
            var unexpected = evaluation.Unexpected.Select(u => (u.GroupSid, u.MemberSid)).ToHashSet();
            var monitored = data.Groups.SelectMany(g => new[] { g.Name, g.WellKnownName }).OfType<string>().ToHashSet(StringComparer.OrdinalIgnoreCase);

            var groups = data.Groups.Select(g =>
            {
                var members = g.Members.Select(m =>
                {
                    var isUnexpected = unexpected.Contains((g.Sid, m.Sid));
                    var note = isUnexpected ? null
                        : PrivilegedEvaluator.IsExpected(g, m, tier0)
                          ?? (!m.IsDirect && m.Via.Count > 0 && monitored.Contains(m.Via[^1]) ? L.F("Wird bei {0} bewertet", m.Via[^1]) : null);
                    return new PrivilegedMemberDto(m.Sid, m.SamAccountName, m.DisplayName, m.ObjectClass, m.DistinguishedName, m.IsDirect, m.Via,
                        m.Enabled, isUnexpected, note);
                })
                    .OrderByDescending(m => m.Unexpected).ThenByDescending(m => m.Direct).ThenBy(m => m.Name, StringComparer.CurrentCultureIgnoreCase)
                    .ToList();
                return new PrivilegedGroupDto(g.Sid, g.Name, g.WellKnownName, g.Source, g.Tier, g.DistinguishedName, members.Count,
                    members.Count(m => m.Direct), members.Count(m => m.Unexpected), members);
            })
                // Groups with findings first, then built-in before configured groups, then by name.
                .OrderByDescending(g => g.UnexpectedCount > 0).ThenBy(g => g.Source == "builtin" ? 0 : 1).ThenBy(g => g.Name, StringComparer.CurrentCultureIgnoreCase)
                .ToList();

            var info = new SnapshotInfoDto(latest.RunId, latest.TakenAt, data.Metadata.PreferredDc, data.Metadata.Domain, evaluation.Baseline,
                data.Groups.Count, data.MemberCount, data.Accounts.Count, data.Errors);
            return new PrivilegedOverviewDto(info, evaluation.Thresholds, groups, evaluation.Unexpected,
                // Rule titles in the request language; the details were stored in the instance default language.
                evaluation.Hygiene.Select(h => h with { Title = PrivilegedEvaluator.RuleTitle(h.Rule) })
                    .OrderBy(h => SeverityRank(h.Severity)).ThenBy(h => h.Account, StringComparer.CurrentCultureIgnoreCase).ToList(),
                evaluation.AttackPaths, lastRunDto, schedules, count);
        });

        api.MapGet("/privileged/changes", async (int? limit, AppDbContext db, Domains.DomainContext domain, CancellationToken ct) =>
        {
            var domainId = domain.Id;
            var take = Math.Clamp(limit ?? 50, 1, 200);
            var rows = await db.PrivilegedSnapshots.AsNoTracking()
                .Where(x => x.DomainId == domainId && x.ChangeCount > 0)
                .OrderByDescending(x => x.Id).Take(take)
                .Select(x => new { x.RunId, x.TakenAt, x.Evaluation })
                .ToListAsync(ct);
            var total = await db.PrivilegedSnapshots.CountAsync(x => x.DomainId == domainId, ct);
            var first = await db.PrivilegedSnapshots.AsNoTracking().Where(x => x.DomainId == domainId).OrderBy(x => x.Id).Select(x => (DateTimeOffset?)x.TakenAt).FirstOrDefaultAsync(ct);
            var items = rows.Select(r => new ChangeSetDto(r.RunId, r.TakenAt, PrivilegedEvaluation.Deserialize(r.Evaluation)?.Changes ?? [])).ToList();
            return new ChangesDto(items, total, first);
        });

        api.MapGet("/compliance", (AppDbContext db, Domains.DomainContext domain, CancellationToken ct) => ComplianceAsync(db, DateTimeOffset.UtcNow, domain.Id, ct));
    }

    private static int SeverityRank(string severity) => severity switch { "High" => 0, "Medium" => 1, _ => 2 };

    private record Point(long RunId, DateTimeOffset At);

    /// <summary>Current score and one value per day (UTC) for the last 30 days, each from the latest audit and monitor run up to that day.</summary>
    public static async Task<ComplianceDto> ComplianceAsync(AppDbContext db, DateTimeOffset now, int domainId, CancellationToken ct)
    {
        const int days = 30;
        var firstDay = now.UtcDateTime.Date.AddDays(-(days - 1));
        var windowStart = new DateTimeOffset(firstDay, TimeSpan.Zero);

        async Task<List<Point>> AuditsAsync()
        {
            var q = db.Runs.AsNoTracking().Where(r => r.DomainId == domainId && r.Kind == RunKind.Audit && r.Status == RunStatus.Succeeded && r.FinishedAt != null);
            var inWindow = await q.Where(r => r.FinishedAt >= windowStart).Select(r => new Point(r.Id, r.FinishedAt!.Value)).ToListAsync(ct);
            var before = await q.Where(r => r.FinishedAt < windowStart).OrderByDescending(r => r.FinishedAt).Select(r => new Point(r.Id, r.FinishedAt!.Value)).FirstOrDefaultAsync(ct);
            return [.. inWindow, .. before is null ? Array.Empty<Point>() : [before]];
        }

        async Task<List<Point>> MonitorsAsync()
        {
            var q = db.PrivilegedSnapshots.AsNoTracking().Where(x => x.DomainId == domainId);
            var inWindow = await q.Where(x => x.TakenAt >= windowStart).Select(x => new Point(x.RunId, x.TakenAt)).ToListAsync(ct);
            var before = await q.Where(x => x.TakenAt < windowStart).OrderByDescending(x => x.TakenAt).Select(x => new Point(x.RunId, x.TakenAt)).FirstOrDefaultAsync(ct);
            return [.. inWindow, .. before is null ? Array.Empty<Point>() : [before]];
        }

        var audits = (await AuditsAsync()).OrderBy(p => p.At).ToList();
        var monitors = (await MonitorsAsync()).OrderBy(p => p.At).ToList();

        static Point? LatestUntil(List<Point> points, DateTimeOffset end) => points.LastOrDefault(p => p.At < end);

        var dayEnds = Enumerable.Range(0, days).Select(i => new DateTimeOffset(firstDay.AddDays(i + 1), TimeSpan.Zero)).ToList();
        var auditIds = dayEnds.Select(e => LatestUntil(audits, e)?.RunId).Append(audits.LastOrDefault()?.RunId).OfType<long>().Distinct().ToList();
        var monitorIds = dayEnds.Select(e => LatestUntil(monitors, e)?.RunId).Append(monitors.LastOrDefault()?.RunId).OfType<long>().Distinct().ToList();

        var findings = (await db.Runs.AsNoTracking().Where(r => auditIds.Contains(r.Id)).Select(r => new { r.Id, r.Findings }).ToListAsync(ct))
            .ToDictionary(r => r.Id, r => ComplianceCalculator.AuditFindings(r.Findings));
        var evaluations = (await db.PrivilegedSnapshots.AsNoTracking().Where(x => monitorIds.Contains(x.RunId)).Select(x => new { x.RunId, x.Evaluation }).ToListAsync(ct))
            .ToDictionary(x => x.RunId, x => PrivilegedEvaluation.Deserialize(x.Evaluation));

        List<TierCompliance>? Score(Point? audit, Point? monitor) => audit is null && monitor is null ? null
            : ComplianceCalculator.Calculate(audit is null ? null : findings.GetValueOrDefault(audit.RunId), monitor is null ? null : evaluations.GetValueOrDefault(monitor.RunId));

        var history = dayEnds.Select(end =>
        {
            var scores = Score(LatestUntil(audits, end), LatestUntil(monitors, end));
            return new ComplianceDayDto(end.AddDays(-1).ToString("yyyy-MM-dd"), scores?[0].Score, scores?[1].Score, scores?[2].Score);
        }).ToList();

        var lastAudit = audits.LastOrDefault();
        var lastMonitor = monitors.LastOrDefault();
        return new ComplianceDto(ComplianceCalculator.Weights,
            lastAudit is null ? null : new(lastAudit.RunId, lastAudit.At),
            lastMonitor is null ? null : new(lastMonitor.RunId, lastMonitor.At),
            Score(lastAudit, lastMonitor), history);
    }
}
