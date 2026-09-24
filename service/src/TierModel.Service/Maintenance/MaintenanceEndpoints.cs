using Microsoft.EntityFrameworkCore;
using TierModel.Service.Auth;
using TierModel.Service.Data;
using TierModel.Service.Localization;

namespace TierModel.Service.Maintenance;

public static class MaintenanceEndpoints
{
    /// <param name="DomainIds">Domains the window applies to (roadmap 17); empty = all domains, null = unchanged (new: all).</param>
    public record WindowRequest(string Name, int[]? Days, string From, string To, string TimeZone, bool Enabled, int[]? DomainIds = null);

    public record FreezeRequest(DateTimeOffset? From, DateTimeOffset? To, string Reason, bool Enabled, int[]? DomainIds = null);

    public record WindowDto(long Id, string Name, int[] Days, string From, string To, string TimeZone, bool Enabled, string CreatedBy, DateTimeOffset CreatedAt,
        int[] DomainIds)
    {
        public static WindowDto Of(MaintenanceWindow w) =>
            new(w.Id, w.Name, w.Days.Order().ToArray(), w.From.ToString("HH:mm"), w.To.ToString("HH:mm"), w.TimeZone, w.Enabled, w.CreatedBy, w.CreatedAt,
                w.DomainIds.Order().ToArray());
    }

    public record FreezeDto(long Id, DateTimeOffset From, DateTimeOffset To, string Reason, bool Enabled, bool Active, bool Past, string CreatedBy, DateTimeOffset CreatedAt,
        int[] DomainIds)
    {
        public static FreezeDto Of(FreezePeriod f, DateTimeOffset now) =>
            new(f.Id, f.From, f.To, f.Reason, f.Enabled, f.Enabled && f.From <= now && now < f.To, f.To <= now, f.CreatedBy, f.CreatedAt, f.DomainIds.Order().ToArray());
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

        admin.MapPost("/windows", async (WindowRequest r, HttpContext ctx, AppDbContext db, ChangeLogService log, MaintenanceService service, Domains.DomainRegistry domains) =>
        {
            if (ValidateWindow(r, domains, out var from, out var to) is { } problem) return problem;
            var w = new MaintenanceWindow { Name = r.Name.Trim(), TimeZone = r.TimeZone, CreatedBy = ctx.User.UserName(), CreatedAt = DateTimeOffset.UtcNow };
            Apply(w, r, from, to);
            db.MaintenanceWindows.Add(w);
            await db.SaveChangesAsync();
            log.Add(ctx.User.UserName(), "maintenance.window-create", "maintenance", w.Id.ToString(), L.PF("Wartungsfenster '{0}' angelegt ({1})", w.Name, Describe(w)));
            await db.SaveChangesAsync();
            await service.RescheduleAllAsync();
            return Results.Ok(WindowDto.Of(w));
        });

        admin.MapPut("/windows/{id:long}", async (long id, WindowRequest r, HttpContext ctx, AppDbContext db, ChangeLogService log, MaintenanceService service,
            Domains.DomainRegistry domains) =>
        {
            var w = await db.MaintenanceWindows.FindAsync(id);
            if (w is null) return Results.NotFound();
            if (ValidateWindow(r, domains, out var from, out var to) is { } problem) return problem;
            Apply(w, r, from, to);
            log.Add(ctx.User.UserName(), "maintenance.window-update", "maintenance", id.ToString(), L.PF("Wartungsfenster '{0}' geändert ({1})", w.Name, Describe(w)));
            await db.SaveChangesAsync();
            await service.RescheduleAllAsync();
            return Results.Ok(WindowDto.Of(w));
        });

        admin.MapDelete("/windows/{id:long}", async (long id, HttpContext ctx, AppDbContext db, ChangeLogService log, MaintenanceService service) =>
        {
            var w = await db.MaintenanceWindows.FindAsync(id);
            if (w is null) return Results.NotFound();
            db.MaintenanceWindows.Remove(w);
            log.Add(ctx.User.UserName(), "maintenance.window-delete", "maintenance", id.ToString(), L.PF("Wartungsfenster '{0}' gelöscht", w.Name));
            await db.SaveChangesAsync();
            await service.RescheduleAllAsync();
            return Results.NoContent();
        });

        admin.MapPost("/freezes", async (FreezeRequest r, HttpContext ctx, AppDbContext db, ChangeLogService log, MaintenanceService service, Domains.DomainRegistry domains) =>
        {
            if (ValidateFreeze(r, domains) is { } problem) return problem;
            var f = new FreezePeriod { Reason = r.Reason.Trim(), CreatedBy = ctx.User.UserName(), CreatedAt = DateTimeOffset.UtcNow };
            Apply(f, r);
            db.FreezePeriods.Add(f);
            await db.SaveChangesAsync();
            log.Add(ctx.User.UserName(), "maintenance.freeze-create", "maintenance", f.Id.ToString(),
                L.PF("Sperrzeit '{0}' angelegt ({1} bis {2})", f.Reason, MaintenanceCalendar.Format(f.From, persisted: true), MaintenanceCalendar.Format(f.To, persisted: true)));
            await db.SaveChangesAsync();
            await service.RescheduleAllAsync();
            return Results.Ok(FreezeDto.Of(f, DateTimeOffset.UtcNow));
        });

        admin.MapPut("/freezes/{id:long}", async (long id, FreezeRequest r, HttpContext ctx, AppDbContext db, ChangeLogService log, MaintenanceService service,
            Domains.DomainRegistry domains) =>
        {
            var f = await db.FreezePeriods.FindAsync(id);
            if (f is null) return Results.NotFound();
            if (ValidateFreeze(r, domains) is { } problem) return problem;
            Apply(f, r);
            log.Add(ctx.User.UserName(), "maintenance.freeze-update", "maintenance", id.ToString(),
                L.PF("Sperrzeit '{0}' geändert ({1} bis {2}, {3})", f.Reason, MaintenanceCalendar.Format(f.From, persisted: true), MaintenanceCalendar.Format(f.To, persisted: true), (f.Enabled ? L.P("aktiv") : L.P("inaktiv"))));
            await db.SaveChangesAsync();
            await service.RescheduleAllAsync();
            return Results.Ok(FreezeDto.Of(f, DateTimeOffset.UtcNow));
        });

        admin.MapDelete("/freezes/{id:long}", async (long id, HttpContext ctx, AppDbContext db, ChangeLogService log, MaintenanceService service) =>
        {
            var f = await db.FreezePeriods.FindAsync(id);
            if (f is null) return Results.NotFound();
            db.FreezePeriods.Remove(f);
            log.Add(ctx.User.UserName(), "maintenance.freeze-delete", "maintenance", id.ToString(), L.PF("Sperrzeit '{0}' gelöscht", f.Reason));
            await db.SaveChangesAsync();
            await service.RescheduleAllAsync();
            return Results.NoContent();
        });
    }

    private static string Describe(MaintenanceWindow w) =>
        $"{string.Join(", ", w.Days.Order().Select(d => MaintenanceCalendar.DayName(d, persisted: true)))} {w.From:HH\\:mm}–{w.To:HH\\:mm} {w.TimeZone}{(w.Enabled ? "" : L.P(", inaktiv"))}";

    private static void ValidateDomains(int[]? ids, Domains.DomainRegistry domains, Dictionary<string, string[]> errors)
    {
        if ((ids ?? []).Any(id => domains.Find(id) is null)) errors["domainIds"] = [L.T("Unbekannte Domäne.")];
    }

    private static IResult? ValidateWindow(WindowRequest r, Domains.DomainRegistry domains, out TimeOnly from, out TimeOnly to)
    {
        var errors = new Dictionary<string, string[]>();
        ValidateDomains(r.DomainIds, domains, errors);
        if (string.IsNullOrWhiteSpace(r.Name) || r.Name.Trim().Length > 100) errors["name"] = [L.T("Bitte einen Namen (max. 100 Zeichen) angeben.")];
        if (r.Days is not { Length: > 0 } || r.Days.Any(d => d is < 0 or > 6)) errors["days"] = [L.T("Mindestens einen Wochentag wählen.")];
        if (!TimeOnly.TryParseExact(r.From ?? "", "HH:mm", out from)) errors["from"] = [L.T("Uhrzeit im Format HH:MM angeben.")];
        if (!TimeOnly.TryParseExact(r.To ?? "", "HH:mm", out to)) errors["to"] = [L.T("Uhrzeit im Format HH:MM angeben.")];
        if (MaintenanceCalendar.TryZone(r.TimeZone ?? "") is null) errors["timeZone"] = [L.F("Unbekannte Zeitzone „{0}“.", r.TimeZone)];
        return errors.Count > 0 ? Results.ValidationProblem(errors) : null;
    }

    private static IResult? ValidateFreeze(FreezeRequest r, Domains.DomainRegistry domains)
    {
        var errors = new Dictionary<string, string[]>();
        ValidateDomains(r.DomainIds, domains, errors);
        if (string.IsNullOrWhiteSpace(r.Reason) || r.Reason.Trim().Length > 200) errors["reason"] = [L.T("Bitte einen Grund (max. 200 Zeichen) angeben.")];
        if (r.From is null) errors["from"] = [L.T("Beginn angeben.")];
        if (r.To is null) errors["to"] = [L.T("Ende angeben.")];
        else if (r.From is not null && r.To <= r.From) errors["to"] = [L.T("Das Ende muss nach dem Beginn liegen.")];
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
        // null (older clients, toggles): unchanged; [] = all domains.
        if (r.DomainIds is not null) w.DomainIds = r.DomainIds.Distinct().Order().ToArray();
    }

    private static void Apply(FreezePeriod f, FreezeRequest r)
    {
        f.From = r.From!.Value.ToUniversalTime();
        f.To = r.To!.Value.ToUniversalTime();
        f.Reason = r.Reason.Trim();
        f.Enabled = r.Enabled;
        if (r.DomainIds is not null) f.DomainIds = r.DomainIds.Distinct().Order().ToArray();
    }
}
