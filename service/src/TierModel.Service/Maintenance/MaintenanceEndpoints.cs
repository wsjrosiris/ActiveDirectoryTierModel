using Microsoft.EntityFrameworkCore;
using TierModel.Service.Auth;
using TierModel.Service.Data;

namespace TierModel.Service.Maintenance;

public static class MaintenanceEndpoints
{
    public record WindowRequest(string Name, int[]? Days, string From, string To, string TimeZone, bool Enabled);

    public record FreezeRequest(DateTimeOffset? From, DateTimeOffset? To, string Reason, bool Enabled);

    public record WindowDto(long Id, string Name, int[] Days, string From, string To, string TimeZone, bool Enabled, string CreatedBy, DateTimeOffset CreatedAt)
    {
        public static WindowDto Of(MaintenanceWindow w) =>
            new(w.Id, w.Name, w.Days.Order().ToArray(), w.From.ToString("HH:mm"), w.To.ToString("HH:mm"), w.TimeZone, w.Enabled, w.CreatedBy, w.CreatedAt);
    }

    public record FreezeDto(long Id, DateTimeOffset From, DateTimeOffset To, string Reason, bool Enabled, bool Active, bool Past, string CreatedBy, DateTimeOffset CreatedAt)
    {
        public static FreezeDto Of(FreezePeriod f, DateTimeOffset now) =>
            new(f.Id, f.From, f.To, f.Reason, f.Enabled, f.Enabled && f.From <= now && now < f.To, f.To <= now, f.CreatedBy, f.CreatedAt);
    }

    public static void MapMaintenanceEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/maintenance").RequireAuthorization(nameof(Role.Viewer));

        api.MapGet("/", async (AppDbContext db, MaintenanceService service, CancellationToken ct) =>
        {
            var now = DateTimeOffset.UtcNow;
            var windows = await db.MaintenanceWindows.AsNoTracking().OrderBy(w => w.Name).ToListAsync(ct);
            var freezes = await db.FreezePeriods.AsNoTracking().OrderByDescending(f => f.From).ToListAsync(ct);
            return Results.Json(new
            {
                windows = windows.Select(WindowDto.Of),
                freezes = freezes.Select(f => FreezeDto.Of(f, now)),
                status = await service.StatusAsync(now, ct),
            }, Endpoints.JsonDefaults.Options);
        });

        api.MapGet("/status", async (MaintenanceService service, CancellationToken ct) =>
            Results.Json(await service.StatusAsync(DateTimeOffset.UtcNow, ct), Endpoints.JsonDefaults.Options));

        var admin = api.MapGroup("/").RequireAuthorization(nameof(Role.Admin));

        admin.MapPost("/windows", async (WindowRequest r, HttpContext ctx, AppDbContext db, ChangeLogService log, MaintenanceService service) =>
        {
            if (ValidateWindow(r, out var from, out var to) is { } problem) return problem;
            var w = new MaintenanceWindow { Name = r.Name.Trim(), TimeZone = r.TimeZone, CreatedBy = ctx.User.UserName(), CreatedAt = DateTimeOffset.UtcNow };
            Apply(w, r, from, to);
            db.MaintenanceWindows.Add(w);
            await db.SaveChangesAsync();
            log.Add(ctx.User.UserName(), "maintenance.window-create", "maintenance", w.Id.ToString(), $"Wartungsfenster '{w.Name}' angelegt ({Describe(w)})");
            await db.SaveChangesAsync();
            await service.RescheduleAllAsync();
            return Results.Ok(WindowDto.Of(w));
        });

        admin.MapPut("/windows/{id:long}", async (long id, WindowRequest r, HttpContext ctx, AppDbContext db, ChangeLogService log, MaintenanceService service) =>
        {
            var w = await db.MaintenanceWindows.FindAsync(id);
            if (w is null) return Results.NotFound();
            if (ValidateWindow(r, out var from, out var to) is { } problem) return problem;
            Apply(w, r, from, to);
            log.Add(ctx.User.UserName(), "maintenance.window-update", "maintenance", id.ToString(), $"Wartungsfenster '{w.Name}' geändert ({Describe(w)})");
            await db.SaveChangesAsync();
            await service.RescheduleAllAsync();
            return Results.Ok(WindowDto.Of(w));
        });

        admin.MapDelete("/windows/{id:long}", async (long id, HttpContext ctx, AppDbContext db, ChangeLogService log, MaintenanceService service) =>
        {
            var w = await db.MaintenanceWindows.FindAsync(id);
            if (w is null) return Results.NotFound();
            db.MaintenanceWindows.Remove(w);
            log.Add(ctx.User.UserName(), "maintenance.window-delete", "maintenance", id.ToString(), $"Wartungsfenster '{w.Name}' gelöscht");
            await db.SaveChangesAsync();
            await service.RescheduleAllAsync();
            return Results.NoContent();
        });

        admin.MapPost("/freezes", async (FreezeRequest r, HttpContext ctx, AppDbContext db, ChangeLogService log, MaintenanceService service) =>
        {
            if (ValidateFreeze(r) is { } problem) return problem;
            var f = new FreezePeriod { Reason = r.Reason.Trim(), CreatedBy = ctx.User.UserName(), CreatedAt = DateTimeOffset.UtcNow };
            Apply(f, r);
            db.FreezePeriods.Add(f);
            await db.SaveChangesAsync();
            log.Add(ctx.User.UserName(), "maintenance.freeze-create", "maintenance", f.Id.ToString(),
                $"Sperrzeit '{f.Reason}' angelegt ({MaintenanceCalendar.Format(f.From)} bis {MaintenanceCalendar.Format(f.To)})");
            await db.SaveChangesAsync();
            await service.RescheduleAllAsync();
            return Results.Ok(FreezeDto.Of(f, DateTimeOffset.UtcNow));
        });

        admin.MapPut("/freezes/{id:long}", async (long id, FreezeRequest r, HttpContext ctx, AppDbContext db, ChangeLogService log, MaintenanceService service) =>
        {
            var f = await db.FreezePeriods.FindAsync(id);
            if (f is null) return Results.NotFound();
            if (ValidateFreeze(r) is { } problem) return problem;
            Apply(f, r);
            log.Add(ctx.User.UserName(), "maintenance.freeze-update", "maintenance", id.ToString(),
                $"Sperrzeit '{f.Reason}' geändert ({MaintenanceCalendar.Format(f.From)} bis {MaintenanceCalendar.Format(f.To)}, {(f.Enabled ? "aktiv" : "inaktiv")})");
            await db.SaveChangesAsync();
            await service.RescheduleAllAsync();
            return Results.Ok(FreezeDto.Of(f, DateTimeOffset.UtcNow));
        });

        admin.MapDelete("/freezes/{id:long}", async (long id, HttpContext ctx, AppDbContext db, ChangeLogService log, MaintenanceService service) =>
        {
            var f = await db.FreezePeriods.FindAsync(id);
            if (f is null) return Results.NotFound();
            db.FreezePeriods.Remove(f);
            log.Add(ctx.User.UserName(), "maintenance.freeze-delete", "maintenance", id.ToString(), $"Sperrzeit '{f.Reason}' gelöscht");
            await db.SaveChangesAsync();
            await service.RescheduleAllAsync();
            return Results.NoContent();
        });
    }

    private static string Describe(MaintenanceWindow w) =>
        $"{string.Join(", ", w.Days.Order().Select(d => MaintenanceCalendar.DayNames[d]))} {w.From:HH\\:mm}–{w.To:HH\\:mm} {w.TimeZone}{(w.Enabled ? "" : ", inaktiv")}";

    private static IResult? ValidateWindow(WindowRequest r, out TimeOnly from, out TimeOnly to)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(r.Name) || r.Name.Trim().Length > 100) errors["name"] = ["Bitte einen Namen (max. 100 Zeichen) angeben."];
        if (r.Days is not { Length: > 0 } || r.Days.Any(d => d is < 0 or > 6)) errors["days"] = ["Mindestens einen Wochentag wählen."];
        if (!TimeOnly.TryParseExact(r.From ?? "", "HH:mm", out from)) errors["from"] = ["Uhrzeit im Format HH:MM angeben."];
        if (!TimeOnly.TryParseExact(r.To ?? "", "HH:mm", out to)) errors["to"] = ["Uhrzeit im Format HH:MM angeben."];
        if (MaintenanceCalendar.TryZone(r.TimeZone ?? "") is null) errors["timeZone"] = [$"Unbekannte Zeitzone „{r.TimeZone}“."];
        return errors.Count > 0 ? Results.ValidationProblem(errors) : null;
    }

    private static IResult? ValidateFreeze(FreezeRequest r)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(r.Reason) || r.Reason.Trim().Length > 200) errors["reason"] = ["Bitte einen Grund (max. 200 Zeichen) angeben."];
        if (r.From is null) errors["from"] = ["Beginn angeben."];
        if (r.To is null) errors["to"] = ["Ende angeben."];
        else if (r.From is not null && r.To <= r.From) errors["to"] = ["Das Ende muss nach dem Beginn liegen."];
        return errors.Count > 0 ? Results.ValidationProblem(errors) : null;
    }

    private static void Apply(MaintenanceWindow w, WindowRequest r, TimeOnly from, TimeOnly to)
    {
        w.Name = r.Name.Trim();
        w.Days = r.Days!.Distinct().Order().ToArray();
        w.From = from;
        w.To = to;
        w.TimeZone = r.TimeZone;
        w.Enabled = r.Enabled;
    }

    private static void Apply(FreezePeriod f, FreezeRequest r)
    {
        f.From = r.From!.Value.ToUniversalTime();
        f.To = r.To!.Value.ToUniversalTime();
        f.Reason = r.Reason.Trim();
        f.Enabled = r.Enabled;
    }
}
