using Microsoft.EntityFrameworkCore;
using TierModel.Service.Auth;
using TierModel.Service.Data;
using TierModel.Service.Endpoints;
using TierModel.Service.Runs;

namespace TierModel.Service.Jit;

public static class JitEndpoints
{
    public record DecisionRequest(string? Comment);

    public record CheckRequest(string? PreferredDc);

    public static void AddJit(IServiceCollection services)
    {
        services.AddScoped<JitService>();
    }

    public static void MapJitEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/jit").RequireAuthorization(nameof(Role.Viewer));

        api.MapGet("/overview", async (HttpContext ctx, AppDbContext db, JitService jit, CancellationToken ct) =>
            await CurrentUserAsync(ctx, db, ct) is { } user
                ? Results.Json(await jit.OverviewAsync(user, ctx.User.Role() ?? Role.Viewer, ct), JsonDefaults.Options)
                : Results.Unauthorized());

        // Operators see every request; everyone else only their own.
        api.MapGet("/requests", async (HttpContext ctx, JitService jit, CancellationToken ct) =>
            Results.Json(await jit.ListAsync(ctx.User.UserName(), ctx.User.Role() ?? Role.Viewer, ct), JsonDefaults.Options));

        api.MapPost("/requests", async (JitRequestInput r, HttpContext ctx, AppDbContext db, JitService jit, CancellationToken ct) =>
        {
            if (await CurrentUserAsync(ctx, db, ct) is not { } user) return Results.Unauthorized();
            var role = ctx.User.Role() ?? Role.Viewer;
            var (request, errors, problem) = await jit.CreateAsync(user, role, r, ct);
            if (errors is not null) return Results.ValidationProblem(errors);
            if (problem is not null)
                return Results.Problem(title: problem, statusCode: problem.StartsWith("Sie sind") || problem.StartsWith("Nur Administratoren") ? 403 : 409);
            return Results.Json(JitService.ToDto(request!, user.Username, role), JsonDefaults.Options, statusCode: 201);
        });

        api.MapPost("/requests/{id:long}/approve", (long id, DecisionRequest? r, HttpContext ctx, JitService jit, CancellationToken ct) =>
            Decide(id, true, r?.Comment, ctx, jit, ct)).RequireAuthorization(nameof(Role.Operator));

        api.MapPost("/requests/{id:long}/reject", (long id, DecisionRequest? r, HttpContext ctx, JitService jit, CancellationToken ct) =>
            string.IsNullOrWhiteSpace(r?.Comment)
                ? Task.FromResult(Results.ValidationProblem(new Dictionary<string, string[]> { ["comment"] = ["Bitte einen Grund angeben."] }))
                : Decide(id, false, r.Comment, ctx, jit, ct)).RequireAuthorization(nameof(Role.Operator));

        api.MapPost("/requests/{id:long}/withdraw", async (long id, HttpContext ctx, JitService jit, CancellationToken ct) =>
            Outcome(await jit.WithdrawAsync(id, ctx.User.UserName(), ct), ctx, "Nur der Antragsteller kann den Antrag zurückziehen.",
                "Der Antrag wartet nicht (mehr) auf eine Freigabe."));

        api.MapPost("/requests/{id:long}/revoke", async (long id, HttpContext ctx, JitService jit, CancellationToken ct) =>
            Outcome(await jit.RevokeAsync(id, ctx.User.UserName(), ctx.User.Role() ?? Role.Viewer, ct), ctx,
                "Entziehen dürfen der Antragsteller und Operatoren.", "Der Zugriff ist nicht (mehr) aktiv oder wird bereits entzogen."));

        api.MapPost("/prerequisite/check", async (CheckRequest? r, HttpContext ctx, JitService jit, CancellationToken ct) =>
        {
            var (run, errors) = await jit.StartCheckAsync(r?.PreferredDc, ctx.User.UserName(), ct);
            return errors is not null ? Results.ValidationProblem(errors) : Results.Accepted($"/api/runs/{run!.Id}", RunSummaryDto.From(run));
        }).RequireAuthorization(nameof(Role.Operator));

        // ---- administration of the JIT groups
        var groups = api.MapGroup("/groups").RequireAuthorization(nameof(Role.Admin));

        // JIT groups of the current domain (roadmap 17).
        groups.MapGet("/", async (AppDbContext db, Domains.DomainContext domain, CancellationToken ct) =>
        {
            var domainId = domain.Id;
            return Results.Json((await db.JitGroups.AsNoTracking().Where(g => g.DomainId == domainId).OrderBy(g => g.Tier).ThenBy(g => g.DisplayName).ToListAsync(ct))
                .Select(JitGroupDto.From), JsonDefaults.Options);
        });

        groups.MapPost("/", async (JitGroupInput r, HttpContext ctx, AppDbContext db, JitService jit, ChangeLogService log, Domains.DomainContext domain, CancellationToken ct) =>
        {
            var errors = jit.ValidateGroup(r);
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            var g = new JitGroup { DomainId = domain.Id, Group = "", DisplayName = "", CreatedBy = ctx.User.UserName(), CreatedAt = DateTimeOffset.UtcNow };
            JitService.Apply(g, r);
            if (await db.JitGroups.AnyAsync(x => x.DomainId == g.DomainId && x.Group == g.Group, ct))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["group"] = ["Diese Gruppe ist bereits als JIT-Gruppe eingerichtet."] });
            db.JitGroups.Add(g);
            await db.SaveChangesAsync(ct);
            log.Add(ctx.User.UserName(), "jitgroup.create", "jitgroup", g.Id.ToString(), $"JIT-Gruppe '{g.DisplayName}' angelegt: {Describe(g)}");
            await db.SaveChangesAsync(ct);
            return Results.Json(JitGroupDto.From(g), JsonDefaults.Options);
        });

        groups.MapPut("/{id:long}", async (long id, JitGroupInput r, HttpContext ctx, AppDbContext db, JitService jit, ChangeLogService log,
            Domains.DomainContext domain, CancellationToken ct) =>
        {
            var g = await db.JitGroups.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (g is null) return Results.NotFound();
            domain.Use(g.DomainId);
            var errors = jit.ValidateGroup(r);
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            var identity = JitService.NormalizeIdentity(r.Group);
            if (await db.JitGroups.AnyAsync(x => x.Id != id && x.DomainId == g.DomainId && x.Group == identity, ct))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["group"] = ["Diese Gruppe ist bereits als JIT-Gruppe eingerichtet."] });
            if (!string.Equals(identity, g.Group, StringComparison.OrdinalIgnoreCase) && string.IsNullOrWhiteSpace(r.GroupSid)) g.GroupSid = null;
            JitService.Apply(g, r);
            g.UpdatedAt = DateTimeOffset.UtcNow;
            log.Add(ctx.User.UserName(), "jitgroup.update", "jitgroup", id.ToString(), $"JIT-Gruppe '{g.DisplayName}' geändert: {Describe(g)}");
            await db.SaveChangesAsync(ct);
            return Results.Json(JitGroupDto.From(g), JsonDefaults.Options);
        });

        groups.MapDelete("/{id:long}", async (long id, HttpContext ctx, AppDbContext db, ChangeLogService log, Domains.DomainContext domain, CancellationToken ct) =>
        {
            var g = await db.JitGroups.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (g is null) return Results.NotFound();
            domain.Use(g.DomainId);
            if (await db.JitRequests.AnyAsync(r => r.JitGroupId == id && (r.Status == JitStatus.Pending || r.Status == JitStatus.Approved || r.Status == JitStatus.Active), ct))
                return Results.Problem(title: "Die Gruppe hat offene oder aktive Anträge", detail: "Bitte zuerst die Anträge abschließen oder die Gruppe deaktivieren.", statusCode: 409);
            db.JitGroups.Remove(g);
            log.Add(ctx.User.UserName(), "jitgroup.delete", "jitgroup", id.ToString(), $"JIT-Gruppe '{g.DisplayName}' gelöscht");
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        api.MapGet("/lookup/groups", async (string? q, JitService jit, CancellationToken ct) =>
            Results.Json(await jit.GroupCandidatesAsync(q, ct), JsonDefaults.Options)).RequireAuthorization(nameof(Role.Admin));

        api.MapGet("/lookup/accounts", async (string? q, JitService jit, CancellationToken ct) =>
            Results.Json(await jit.AccountCandidatesAsync(q, ct), JsonDefaults.Options)).RequireAuthorization(nameof(Role.Admin));
    }

    private static string Describe(JitGroup g) =>
        $"{g.Group}, Tier {g.Tier?.ToString() ?? "–"}, max. {JitService.FormatMinutes(g.MaxMinutes)}, {(g.RequiresApproval ? "mit" : "ohne")} Freigabe, ab Rolle {g.MinimumRole}"
        + (g.EligibleUsers.Length > 0 ? $", nur {string.Join(", ", g.EligibleUsers)}" : "") + (g.Enabled ? "" : ", deaktiviert");

    private static async Task<AppUser?> CurrentUserAsync(HttpContext ctx, AppDbContext db, CancellationToken ct) =>
        ctx.User.UserId() is { } id ? await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id, ct) : null;

    private static async Task<IResult> Decide(long id, bool approve, string? comment, HttpContext ctx, JitService jit, CancellationToken ct) =>
        await jit.DecideAsync(id, approve, ctx.User.UserName(), ctx.User.Role() ?? Role.Viewer, comment, ct) switch
        {
            (JitOutcome.Done, var r) => Results.Json(JitService.ToDto(r!, ctx.User.UserName(), ctx.User.Role() ?? Role.Viewer), JsonDefaults.Options),
            (JitOutcome.NotFound, _) => Results.NotFound(),
            (JitOutcome.OwnRequest, _) => Results.Problem(title: "Eigene Anträge können nicht selbst freigegeben oder abgelehnt werden",
                detail: "Das Vier-Augen-Prinzip verlangt eine zweite Person.", statusCode: 403),
            (JitOutcome.Forbidden, _) => Results.Problem(title: "Nur Operatoren dürfen entscheiden", statusCode: 403),
            (JitOutcome.Expired, _) => Results.Problem(title: "Die Freigabefrist ist abgelaufen", statusCode: 409),
            _ => Results.Problem(title: "Der Antrag wartet nicht (mehr) auf eine Freigabe", statusCode: 409),
        };

    private static IResult Outcome((JitOutcome, JitRequest?) result, HttpContext ctx, string forbidden, string conflict) => result switch
    {
        (JitOutcome.Done, var r) => Results.Json(JitService.ToDto(r!, ctx.User.UserName(), ctx.User.Role() ?? Role.Viewer), JsonDefaults.Options),
        (JitOutcome.NotFound, _) => Results.NotFound(),
        (JitOutcome.Forbidden, _) => Results.Problem(title: forbidden, statusCode: 403),
        _ => Results.Problem(title: conflict, statusCode: 409),
    };
}

/// <summary>Every 20 seconds: marks elapsed JIT memberships as expired, rejects overdue approvals, repairs requests of lost runs.</summary>
public class JitWorker(IServiceScopeFactory scopes, WorkerHeartbeats heartbeats, ILogger<JitWorker> logger) : BackgroundService
{
    public const string HeartbeatName = "JitWorker";
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(20);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval);
        do
        {
            heartbeats.Beat(HeartbeatName, Interval);
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var n = await scope.ServiceProvider.GetRequiredService<JitService>().MaintainAsync(DateTimeOffset.UtcNow, stoppingToken);
                if (n > 0) logger.LogInformation("JIT maintenance updated {Count} request(s)", n);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "JIT maintenance failed");
            }
        }
        while (await WaitAsync(timer, stoppingToken));
    }

    private static async Task<bool> WaitAsync(PeriodicTimer timer, CancellationToken ct)
    {
        try { return await timer.WaitForNextTickAsync(ct); }
        catch (OperationCanceledException) { return false; }
    }
}
