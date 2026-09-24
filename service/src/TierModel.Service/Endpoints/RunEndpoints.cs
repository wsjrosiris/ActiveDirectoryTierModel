using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using TierModel.Service.Auth;
using TierModel.Service.Data;
using TierModel.Service.Runs;
using TierModel.Service.Localization;

namespace TierModel.Service.Endpoints;

public static class RunEndpoints
{
    /// <param name="Kind">Audit (default) or Monitor; monitor schedules ignore scope, extensions and language.</param>
    public record ScheduleRequest(string Name, string Cron, string TimeZone, bool Enabled, string PreferredDc, DeployScope? Scope,
        bool IncludeMsa, bool IncludeGmsa, bool IncludeDmsa, bool IncludeWinLaps, string? AdmlLanguage, RunKind? Kind = null)
    {
        public RunKind EffectiveKind => Kind ?? RunKind.Audit;

        public RunRequest ToRunRequest() => EffectiveKind == RunKind.Monitor
            ? new(PreferredDc, null, false, false, false, false, null)
            : new(PreferredDc, Scope, IncludeMsa, IncludeGmsa, IncludeDmsa, IncludeWinLaps, AdmlLanguage);
    }

    public record ScheduleDto(long Id, string Name, RunKind Kind, string Cron, string TimeZone, bool Enabled, string PreferredDc, DeployScope? Scope,
        bool IncludeMsa, bool IncludeGmsa, bool IncludeDmsa, bool IncludeWinLaps, string? AdmlLanguage,
        DateTimeOffset? NextRunAt, DateTimeOffset? LastRunAt, long? LastRunId, string CreatedBy, DateTimeOffset CreatedAt, int DomainId)
    {
        public static ScheduleDto From(Schedule s) => new(s.Id, s.Name, s.Kind, s.Cron, s.TimeZone, s.Enabled, s.PreferredDc, s.Scope,
            s.IncludeMsa, s.IncludeGmsa, s.IncludeDmsa, s.IncludeWinLaps, s.AdmlLanguage, s.NextRunAt, s.LastRunAt, s.LastRunId, s.CreatedBy, s.CreatedAt, s.DomainId);
    }

    public record DomainInfoDto(int Id, string Key, string DisplayName, string DnsName)
    {
        public static DomainInfoDto From(Domain d) => new(d.Id, d.Key, d.DisplayName, d.DnsName);
    }

    public record RemediationRequest(string Area);

    public static void MapRunEndpoints(this IEndpointRouteBuilder app)
    {
        var runs = app.MapGroup("/api/runs").RequireAuthorization(nameof(Role.Viewer));

        // Lists show the runs of the current domain; a run's detail and actions work by id in any domain (ids are global).
        runs.MapGet("/", async (AppDbContext db, RunKind? kind, RunStatus? status, int? page, int? pageSize, Domains.DomainContext domain) =>
        {
            var size = Math.Clamp(pageSize ?? 25, 1, 200);
            var p = Math.Max(page ?? 1, 1);
            var domainId = domain.Id;
            var q = db.Runs.AsNoTracking().Where(r => r.DomainId == domainId);
            if (kind is not null) q = q.Where(r => r.Kind == kind);
            if (status is not null) q = q.Where(r => r.Status == status);
            var total = await q.CountAsync();
            var items = await q.OrderByDescending(r => r.Id).Skip((p - 1) * size).Take(size).ToListAsync();
            return new { items = items.Select(RunSummaryDto.From), total };
        });

        runs.MapPost("/deploy", async (DeployRequest r, HttpContext ctx, RunService service, Maintenance.MaintenanceService maintenance) =>
        {
            if (r.ConfirmApply && !ctx.User.HasRole(Role.Operator))
                return Results.Problem(title: L.T("Nur Operatoren dürfen Änderungen im Active Directory anwenden"), statusCode: 403);
            var errors = RunValidation.Validate(r.ToRunRequest());
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            Run? plan = null;
            if (r.ConfirmApply)
            {
                (plan, var planError) = await service.CheckPlanForApplyAsync(r);
                if (planError is not null) return Results.ValidationProblem(new Dictionary<string, string[]> { ["planRunId"] = [planError] });
                // Freeze periods (roadmap 4): rejected right away; outside a maintenance window the run is scheduled.
                if (await maintenance.CheckApplyRequestAsync(DateTimeOffset.UtcNow, service.DomainId) is { } freezeError)
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["maintenance"] = [freezeError] }, title: L.T("Anwenden derzeit gesperrt"));
            }
            var run = await service.EnqueueAsync(RunKind.Deploy, r.ToRunRequest(), r.ConfirmApply, ctx.User.UserName(), planRun: plan);
            return Results.Accepted($"/api/runs/{run.Id}", RunSummaryDto.From(run));
        }).RequireAuthorization(nameof(Role.Editor));

        runs.MapPost("/audit", async (RunRequest r, HttpContext ctx, RunService service) =>
        {
            var errors = RunValidation.Validate(r);
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            var run = await service.EnqueueAsync(RunKind.Audit, r, false, ctx.User.UserName());
            return Results.Accepted($"/api/runs/{run.Id}", RunSummaryDto.From(run));
        }).RequireAuthorization(nameof(Role.Editor));

        // Snapshot of the privileged groups (roadmap 7–9). Operators only: it reads the whole privileged membership of the domain.
        runs.MapPost("/monitor", async (MonitorRequest r, HttpContext ctx, RunService service) =>
        {
            var request = r.ToRunRequest();
            var errors = RunValidation.ValidateMonitor(request);
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            var run = await service.EnqueueAsync(RunKind.Monitor, request, false, ctx.User.UserName());
            return Results.Accepted($"/api/runs/{run.Id}", RunSummaryDto.From(run));
        }).RequireAuthorization(nameof(Role.Operator));

        // Remediation by click (roadmap 5): a planning run for one area of an audit's findings, with the audit's DC and language.
        runs.MapPost("/{id:long}/remediate", async (long id, RemediationRequest r, HttpContext ctx, AppDbContext db, RunService service, Domains.DomainContext domain) =>
        {
            var audit = await db.Runs.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
            if (audit is null) return Results.NotFound();
            domain.Use(audit.DomainId);   // the planning run belongs to the audit's domain
            if (audit.Kind != RunKind.Audit)
                return Results.Problem(title: L.T("Nur für Audits möglich"), detail: L.T("Eine Planung zur Behebung kann nur aus den Befunden eines Audits gestartet werden."), statusCode: 409);
            if (Remediation.For(r?.Area, audit.PreferredDc, audit.AdmlLanguage) is not { } request)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["area"] = [L.F("Unbekannter Bereich „{0}“.", r?.Area)] });
            var errors = RunValidation.Validate(request);
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            var run = await service.EnqueueAsync(RunKind.Deploy, request, false, ctx.User.UserName());
            return Results.Accepted($"/api/runs/{run.Id}", RunSummaryDto.From(run));
        }).RequireAuthorization(nameof(Role.Operator));

        runs.MapGet("/{id:long}", async (long id, AppDbContext db, RunService service, Domains.DomainRegistry domains, CancellationToken ct) =>
        {
            var run = await db.Runs.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id, ct);
            if (run is null) return Results.NotFound();
            var dto = (JsonObject)JsonSerializer.SerializeToNode(RunSummaryDto.From(run), JsonDefaults.Options)!;
            dto["domain"] = domains.Find(run.DomainId) is { } d ? JsonSerializer.SerializeToNode(DomainInfoDto.From(d), JsonDefaults.Options) : null;
            dto["summary"] = run.Summary is null ? null : JsonNode.Parse(run.Summary);
            dto["findings"] = run.Findings is null ? new JsonArray() : JsonNode.Parse(run.Findings);
            dto["configVersions"] = run.ConfigVersions is null ? new JsonObject() : JsonNode.Parse(run.ConfigVersions);
            dto["plan"] = JsonSerializer.SerializeToNode(DeployPlanReader.Deserialize(run.Plan), JsonDefaults.Options);
            dto["planApplicability"] = JsonSerializer.SerializeToNode(await service.PlanApplicabilityAsync(run, ct), JsonDefaults.Options);
            return Results.Json(dto, JsonDefaults.Options);
        });

        // The plan of a planning run on its own, e.g. for the approval view of the apply run that refers to it.
        runs.MapGet("/{id:long}/plan", async (long id, AppDbContext db, CancellationToken ct) =>
        {
            var run = await db.Runs.AsNoTracking().Where(r => r.Id == id).Select(r => new { r.Plan }).FirstOrDefaultAsync(ct);
            if (run is null) return Results.NotFound();
            return DeployPlanReader.Deserialize(run.Plan) is { } plan
                ? Results.Json(plan, JsonDefaults.Options)
                : Results.Problem(title: L.T("Für diesen Lauf liegt keine Planung vor"), statusCode: 404);
        });

        runs.MapGet("/plan-candidates", async (string? preferredDc, DeployScope? scope, bool? includeMsa, bool? includeGmsa, bool? includeDmsa, bool? includeWinLaps,
            string? admlLanguage, RunService service, CancellationToken ct) =>
        {
            var r = new RunRequest(preferredDc ?? "", scope, includeMsa ?? false, includeGmsa ?? false, includeDmsa ?? false, includeWinLaps ?? false, admlLanguage);
            var errors = RunValidation.Validate(r);
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            return Results.Json(await service.FindPlanCandidateAsync(r, ct), JsonDefaults.Options);
        });

        runs.MapGet("/{id:long}/log", async (long id, int? after, AppDbContext db) =>
        {
            var status = await db.Runs.Where(r => r.Id == id).Select(r => (RunStatus?)r.Status).FirstOrDefaultAsync();
            if (status is null) return Results.NotFound();
            var from = after ?? 0;
            var lines = await db.RunLogLines.AsNoTracking()
                .Where(l => l.RunId == id && l.Seq > from)
                .OrderBy(l => l.Seq).Take(2000)
                .Select(l => new LogLineDto(l.Seq, l.At, l.Stream, l.Level, l.Text))
                .ToListAsync();
            return Results.Ok(new LogPageDto(status.Value, lines));
        });

        runs.MapPost("/{id:long}/approve", (long id, DecisionRequest? r, HttpContext ctx, RunService service) =>
            Decide(id, approve: true, r?.Comment, ctx, service)).RequireAuthorization(nameof(Role.Operator));

        runs.MapPost("/{id:long}/reject", (long id, DecisionRequest? r, HttpContext ctx, RunService service) =>
            string.IsNullOrWhiteSpace(r?.Comment)
                ? Task.FromResult(Results.ValidationProblem(new Dictionary<string, string[]> { ["comment"] = [L.T("Bitte einen Grund angeben.")] }))
                : Decide(id, approve: false, r.Comment, ctx, service)).RequireAuthorization(nameof(Role.Operator));

        runs.MapPost("/{id:long}/cancel", async (long id, HttpContext ctx, RunService service) =>
            await service.CancelAsync(id, ctx.User.UserName()) switch
            {
                null => Results.NotFound(),
                true => Results.NoContent(),
                false => Results.Problem(title: L.T("Der Lauf ist bereits beendet"), statusCode: 409),
            })
            .RequireAuthorization(nameof(Role.Operator));

        var schedules = app.MapGroup("/api/schedules").RequireAuthorization(nameof(Role.Viewer));

        schedules.MapGet("/", async (AppDbContext db, Domains.DomainContext domain) =>
        {
            var domainId = domain.Id;
            return (await db.Schedules.AsNoTracking().Where(s => s.DomainId == domainId).OrderBy(s => s.Name).ToListAsync()).Select(ScheduleDto.From);
        });

        schedules.MapPost("/", async (ScheduleRequest r, HttpContext ctx, AppDbContext db, ChangeLogService log, Domains.DomainContext domain) =>
        {
            if (ValidateSchedule(r) is { } problem) return problem;
            var s = new Schedule
            {
                DomainId = domain.Id,
                Kind = r.EffectiveKind,
                Name = r.Name.Trim(), Cron = r.Cron.Trim(), TimeZone = r.TimeZone, PreferredDc = r.PreferredDc.Trim(),
                CreatedBy = ctx.User.UserName(), CreatedAt = DateTimeOffset.UtcNow,
            };
            Apply(s, r);
            db.Schedules.Add(s);
            await db.SaveChangesAsync();
            log.Add(ctx.User.UserName(), "schedule.create", "schedule", s.Id.ToString(), L.PF("Zeitplan '{0}' angelegt ({1}, {2})", s.Name, s.Cron, s.TimeZone));
            await db.SaveChangesAsync();
            return Results.Ok(ScheduleDto.From(s));
        }).RequireAuthorization(nameof(Role.Operator));

        schedules.MapPut("/{id:long}", async (long id, ScheduleRequest r, HttpContext ctx, AppDbContext db, ChangeLogService log, Domains.DomainContext domain) =>
        {
            var s = await db.Schedules.FindAsync(id);
            if (s is null) return Results.NotFound();
            domain.Use(s.DomainId);
            r = r with { Kind = r.Kind ?? s.Kind };   // clients that do not know the kind keep it
            if (ValidateSchedule(r) is { } problem) return problem;
            Apply(s, r);
            log.Add(ctx.User.UserName(), "schedule.update", "schedule", id.ToString(), L.PF("Zeitplan '{0}' geändert ({1}, {2})", s.Name, s.Cron, (s.Enabled ? L.P("aktiv") : L.P("inaktiv"))));
            await db.SaveChangesAsync();
            return Results.Ok(ScheduleDto.From(s));
        }).RequireAuthorization(nameof(Role.Operator));

        schedules.MapDelete("/{id:long}", async (long id, HttpContext ctx, AppDbContext db, ChangeLogService log, Domains.DomainContext domain) =>
        {
            var s = await db.Schedules.FindAsync(id);
            if (s is null) return Results.NotFound();
            domain.Use(s.DomainId);
            db.Schedules.Remove(s);
            log.Add(ctx.User.UserName(), "schedule.delete", "schedule", id.ToString(), L.PF("Zeitplan '{0}' gelöscht", s.Name));
            await db.SaveChangesAsync();
            return Results.NoContent();
        }).RequireAuthorization(nameof(Role.Operator));

        schedules.MapPost("/{id:long}/run", async (long id, HttpContext ctx, AppDbContext db, RunService service, Domains.DomainContext domain) =>
        {
            var s = await db.Schedules.FindAsync(id);
            if (s is null) return Results.NotFound();
            domain.Use(s.DomainId);
            var run = await service.EnqueueAsync(s.Kind, ScheduleWorker.RequestFor(s), false, ctx.User.UserName(), RunTrigger.Manual, s.Id);
            s.LastRunId = run.Id;
            s.LastRunAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            return Results.Accepted($"/api/runs/{run.Id}", RunSummaryDto.From(run));
        }).RequireAuthorization(nameof(Role.Operator));
    }

    public record DecisionRequest(string? Comment);

    private static async Task<IResult> Decide(long id, bool approve, string? comment, HttpContext ctx, RunService service)
    {
        var (outcome, run) = await service.DecideAsync(id, approve, ctx.User.UserName(), comment);
        return outcome switch
        {
            ApprovalOutcome.Done => Results.Ok(RunSummaryDto.From(run!)),
            ApprovalOutcome.NotFound => Results.NotFound(),
            ApprovalOutcome.OwnRequest => Results.Problem(title: L.T("Eigene Anträge können nicht selbst freigegeben oder abgelehnt werden"),
                detail: L.T("Das Vier-Augen-Prinzip verlangt eine zweite Person."), statusCode: 403),
            ApprovalOutcome.Expired => Results.Problem(title: L.T("Die Freigabefrist ist abgelaufen"), statusCode: 409),
            _ => Results.Problem(title: L.T("Der Lauf wartet nicht (mehr) auf eine Freigabe"), statusCode: 409),
        };
    }

    private static IResult? ValidateSchedule(ScheduleRequest r)
    {
        var errors = r.EffectiveKind switch
        {
            RunKind.Audit => RunValidation.Validate(r.ToRunRequest()),
            RunKind.Monitor => RunValidation.ValidateMonitor(r.ToRunRequest()),
            _ => new Dictionary<string, string[]> { ["kind"] = [L.T("Zeitpläne gibt es nur für Audits und Überwachungen.")] },
        };
        if (string.IsNullOrWhiteSpace(r.Name) || r.Name.Length > 100) errors["name"] = [L.T("Bitte einen Namen (max. 100 Zeichen) angeben.")];
        if (ScheduleWorker.Validate(r.Cron?.Trim() ?? "", r.TimeZone ?? "") is { } cronError) errors["cron"] = [cronError];
        return errors.Count > 0 ? Results.ValidationProblem(errors) : null;
    }

    private static void Apply(Schedule s, ScheduleRequest r)
    {
        var request = r.ToRunRequest();
        s.Kind = r.EffectiveKind;
        s.Name = r.Name.Trim();
        s.Cron = r.Cron.Trim();
        s.TimeZone = r.TimeZone;
        s.Enabled = r.Enabled;
        s.PreferredDc = r.PreferredDc.Trim();
        s.Scope = request.Scope;
        s.IncludeMsa = request.IncludeMsa;
        s.IncludeGmsa = request.IncludeGmsa;
        s.IncludeDmsa = request.IncludeDmsa;
        s.IncludeWinLaps = request.IncludeWinLaps;
        s.AdmlLanguage = string.IsNullOrWhiteSpace(request.AdmlLanguage) ? null : request.AdmlLanguage.Trim();
        s.NextRunAt = s.Enabled ? ScheduleWorker.NextOccurrence(s.Cron, s.TimeZone, DateTimeOffset.UtcNow) : null;
    }
}
