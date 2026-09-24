using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using TierModel.Service.Auth;
using TierModel.Service.Data;
using TierModel.Service.Runs;

namespace TierModel.Service.Endpoints;

public static class RunEndpoints
{
    public record ScheduleRequest(string Name, string Cron, string TimeZone, bool Enabled, string PreferredDc, DeployScope? Scope,
        bool IncludeMsa, bool IncludeGmsa, bool IncludeDmsa, bool IncludeWinLaps, string? AdmlLanguage)
    {
        public RunRequest ToRunRequest() => new(PreferredDc, Scope, IncludeMsa, IncludeGmsa, IncludeDmsa, IncludeWinLaps, AdmlLanguage);
    }

    public record ScheduleDto(long Id, string Name, string Cron, string TimeZone, bool Enabled, string PreferredDc, DeployScope? Scope,
        bool IncludeMsa, bool IncludeGmsa, bool IncludeDmsa, bool IncludeWinLaps, string? AdmlLanguage,
        DateTimeOffset? NextRunAt, DateTimeOffset? LastRunAt, long? LastRunId, string CreatedBy, DateTimeOffset CreatedAt)
    {
        public static ScheduleDto From(Schedule s) => new(s.Id, s.Name, s.Cron, s.TimeZone, s.Enabled, s.PreferredDc, s.Scope,
            s.IncludeMsa, s.IncludeGmsa, s.IncludeDmsa, s.IncludeWinLaps, s.AdmlLanguage, s.NextRunAt, s.LastRunAt, s.LastRunId, s.CreatedBy, s.CreatedAt);
    }

    public static void MapRunEndpoints(this IEndpointRouteBuilder app)
    {
        var runs = app.MapGroup("/api/runs").RequireAuthorization(nameof(Role.Viewer));

        runs.MapGet("/", async (AppDbContext db, RunKind? kind, RunStatus? status, int? page, int? pageSize) =>
        {
            var size = Math.Clamp(pageSize ?? 25, 1, 200);
            var p = Math.Max(page ?? 1, 1);
            var q = db.Runs.AsNoTracking();
            if (kind is not null) q = q.Where(r => r.Kind == kind);
            if (status is not null) q = q.Where(r => r.Status == status);
            var total = await q.CountAsync();
            var items = await q.OrderByDescending(r => r.Id).Skip((p - 1) * size).Take(size).ToListAsync();
            return new { items = items.Select(RunSummaryDto.From), total };
        });

        runs.MapPost("/deploy", async (DeployRequest r, HttpContext ctx, RunService service) =>
        {
            if (r.ConfirmApply && !ctx.User.HasRole(Role.Operator))
                return Results.Problem(title: "Nur Operatoren dürfen Änderungen im Active Directory anwenden", statusCode: 403);
            var errors = RunValidation.Validate(r.ToRunRequest());
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            Run? plan = null;
            if (r.ConfirmApply)
            {
                (plan, var planError) = await service.CheckPlanForApplyAsync(r);
                if (planError is not null) return Results.ValidationProblem(new Dictionary<string, string[]> { ["planRunId"] = [planError] });
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

        runs.MapGet("/{id:long}", async (long id, AppDbContext db, RunService service, CancellationToken ct) =>
        {
            var run = await db.Runs.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id, ct);
            if (run is null) return Results.NotFound();
            var dto = (JsonObject)JsonSerializer.SerializeToNode(RunSummaryDto.From(run), JsonDefaults.Options)!;
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
                : Results.Problem(title: "Für diesen Lauf liegt keine Planung vor", statusCode: 404);
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
                ? Task.FromResult(Results.ValidationProblem(new Dictionary<string, string[]> { ["comment"] = ["Bitte einen Grund angeben."] }))
                : Decide(id, approve: false, r.Comment, ctx, service)).RequireAuthorization(nameof(Role.Operator));

        runs.MapPost("/{id:long}/cancel", async (long id, HttpContext ctx, RunService service) =>
            await service.CancelAsync(id, ctx.User.UserName()) switch
            {
                null => Results.NotFound(),
                true => Results.NoContent(),
                false => Results.Problem(title: "Der Lauf ist bereits beendet", statusCode: 409),
            })
            .RequireAuthorization(nameof(Role.Operator));

        var schedules = app.MapGroup("/api/schedules").RequireAuthorization(nameof(Role.Viewer));

        schedules.MapGet("/", async (AppDbContext db) =>
            (await db.Schedules.AsNoTracking().OrderBy(s => s.Name).ToListAsync()).Select(ScheduleDto.From));

        schedules.MapPost("/", async (ScheduleRequest r, HttpContext ctx, AppDbContext db, ChangeLogService log) =>
        {
            if (ValidateSchedule(r) is { } problem) return problem;
            var s = new Schedule
            {
                Name = r.Name.Trim(), Cron = r.Cron.Trim(), TimeZone = r.TimeZone, PreferredDc = r.PreferredDc.Trim(),
                CreatedBy = ctx.User.UserName(), CreatedAt = DateTimeOffset.UtcNow,
            };
            Apply(s, r);
            db.Schedules.Add(s);
            await db.SaveChangesAsync();
            log.Add(ctx.User.UserName(), "schedule.create", "schedule", s.Id.ToString(), $"Zeitplan '{s.Name}' angelegt ({s.Cron}, {s.TimeZone})");
            await db.SaveChangesAsync();
            return Results.Ok(ScheduleDto.From(s));
        }).RequireAuthorization(nameof(Role.Operator));

        schedules.MapPut("/{id:long}", async (long id, ScheduleRequest r, HttpContext ctx, AppDbContext db, ChangeLogService log) =>
        {
            var s = await db.Schedules.FindAsync(id);
            if (s is null) return Results.NotFound();
            if (ValidateSchedule(r) is { } problem) return problem;
            Apply(s, r);
            log.Add(ctx.User.UserName(), "schedule.update", "schedule", id.ToString(), $"Zeitplan '{s.Name}' geändert ({s.Cron}, {(s.Enabled ? "aktiv" : "inaktiv")})");
            await db.SaveChangesAsync();
            return Results.Ok(ScheduleDto.From(s));
        }).RequireAuthorization(nameof(Role.Operator));

        schedules.MapDelete("/{id:long}", async (long id, HttpContext ctx, AppDbContext db, ChangeLogService log) =>
        {
            var s = await db.Schedules.FindAsync(id);
            if (s is null) return Results.NotFound();
            db.Schedules.Remove(s);
            log.Add(ctx.User.UserName(), "schedule.delete", "schedule", id.ToString(), $"Zeitplan '{s.Name}' gelöscht");
            await db.SaveChangesAsync();
            return Results.NoContent();
        }).RequireAuthorization(nameof(Role.Operator));

        schedules.MapPost("/{id:long}/run", async (long id, HttpContext ctx, AppDbContext db, RunService service) =>
        {
            var s = await db.Schedules.FindAsync(id);
            if (s is null) return Results.NotFound();
            var run = await service.EnqueueAsync(RunKind.Audit,
                new RunRequest(s.PreferredDc, s.Scope, s.IncludeMsa, s.IncludeGmsa, s.IncludeDmsa, s.IncludeWinLaps, s.AdmlLanguage),
                false, ctx.User.UserName(), RunTrigger.Manual, s.Id);
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
            ApprovalOutcome.OwnRequest => Results.Problem(title: "Eigene Anträge können nicht selbst freigegeben oder abgelehnt werden",
                detail: "Das Vier-Augen-Prinzip verlangt eine zweite Person.", statusCode: 403),
            ApprovalOutcome.Expired => Results.Problem(title: "Die Freigabefrist ist abgelaufen", statusCode: 409),
            _ => Results.Problem(title: "Der Lauf wartet nicht (mehr) auf eine Freigabe", statusCode: 409),
        };
    }

    private static IResult? ValidateSchedule(ScheduleRequest r)
    {
        var errors = RunValidation.Validate(r.ToRunRequest());
        if (string.IsNullOrWhiteSpace(r.Name) || r.Name.Length > 100) errors["name"] = ["Bitte einen Namen (max. 100 Zeichen) angeben."];
        if (ScheduleWorker.Validate(r.Cron?.Trim() ?? "", r.TimeZone ?? "") is { } cronError) errors["cron"] = [cronError];
        return errors.Count > 0 ? Results.ValidationProblem(errors) : null;
    }

    private static void Apply(Schedule s, ScheduleRequest r)
    {
        s.Name = r.Name.Trim();
        s.Cron = r.Cron.Trim();
        s.TimeZone = r.TimeZone;
        s.Enabled = r.Enabled;
        s.PreferredDc = r.PreferredDc.Trim();
        s.Scope = r.Scope;
        s.IncludeMsa = r.IncludeMsa;
        s.IncludeGmsa = r.IncludeGmsa;
        s.IncludeDmsa = r.IncludeDmsa;
        s.IncludeWinLaps = r.IncludeWinLaps;
        s.AdmlLanguage = string.IsNullOrWhiteSpace(r.AdmlLanguage) ? null : r.AdmlLanguage.Trim();
        s.NextRunAt = s.Enabled ? ScheduleWorker.NextOccurrence(s.Cron, s.TimeZone, DateTimeOffset.UtcNow) : null;
    }
}
