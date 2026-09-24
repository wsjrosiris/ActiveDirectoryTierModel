using System.Globalization;
using Microsoft.AspNetCore.DataProtection;
using System.Text.Json;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.EntityFrameworkCore;
using MimeKit;
using TierModel.Service.Auth;
using TierModel.Service.Data;
using TierModel.Service.Endpoints;
using TierModel.Service.Localization;

namespace TierModel.Service.Reports;

public record ReportTypeDto(string Type, string Title, string Description, bool NeedsRange, string? Basis, DateTimeOffset? BasisAt);

public enum ReportFrequency { Weekly, Monthly }

/// <summary>A report sent by e-mail on a schedule (stored as a list in the settings, key "reportSchedules").</summary>
/// <param name="DomainId">Domain the report covers (roadmap 17); null = the default domain.</param>
public record ReportSchedule(Guid Id, string Name, string Type, ReportFrequency Frequency, int Day, string Time, List<string> Recipients, bool Enabled,
    DateTimeOffset CreatedAt, DateTimeOffset? LastSentAt = null, string? LastError = null, int? DomainId = null)
{
    /// <summary>Next delivery after <paramref name="after"/> in the server's time zone. Weekly: Day = 0 (Sunday) … 6; monthly: day 1–28.</summary>
    public DateTimeOffset NextAfter(DateTimeOffset after)
    {
        var tz = TimeZoneInfo.Local;
        var time = TimeOnly.TryParseExact(Time, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var t) ? t : new TimeOnly(7, 0);
        var local = TimeZoneInfo.ConvertTime(after, tz);
        var date = DateOnly.FromDateTime(local.DateTime);
        for (var i = 0; i < 400; i++, date = date.AddDays(1))
        {
            var match = Frequency == ReportFrequency.Weekly ? (int)date.DayOfWeek == Day : date.Day == Day;
            if (!match) continue;
            var dt = date.ToDateTime(time, DateTimeKind.Unspecified);
            var at = new DateTimeOffset(dt, tz.GetUtcOffset(dt));
            if (at > after) return at;
        }
        return after.AddDays(7);
    }

    /// <summary>Period a delivery covers: the last 7 days or the last month up to yesterday.</summary>
    public (DateOnly From, DateOnly To) Period(DateTimeOffset at)
    {
        var to = DateOnly.FromDateTime(at.ToLocalTime().DateTime).AddDays(-1);
        return (Frequency == ReportFrequency.Weekly ? to.AddDays(-6) : to.AddMonths(-1).AddDays(1), to);
    }
}

public record ReportScheduleDto(Guid Id, string Name, string Type, ReportFrequency Frequency, int Day, string Time, List<string> Recipients, bool Enabled,
    DateTimeOffset CreatedAt, DateTimeOffset? LastSentAt, string? LastError, DateTimeOffset? NextRunAt, int? DomainId)
{
    public static ReportScheduleDto From(ReportSchedule s, DateTimeOffset now) => new(s.Id, s.Name, s.Type, s.Frequency, s.Day, s.Time, s.Recipients,
        s.Enabled, s.CreatedAt, s.LastSentAt, s.LastError, s.Enabled ? Max(s.NextAfter(ReportSchedules.Reference(s)), now) : null, s.DomainId);

    private static DateTimeOffset Max(DateTimeOffset a, DateTimeOffset b) => a > b ? a : b;
}

public record ReportScheduleInput(Guid? Id, string Name, string Type, ReportFrequency Frequency, int Day, string Time, List<string>? Recipients, bool Enabled,
    int? DomainId = null);

public static class ReportSchedules
{
    public const string SettingsKey = "reportSchedules";
    private static readonly JsonSerializerOptions Json = JsonDefaults.Create();

    public static async Task<List<ReportSchedule>> LoadAsync(SettingsService settings, CancellationToken ct = default)
    {
        var json = await settings.GetValueAsync(SettingsKey, ct);
        if (string.IsNullOrWhiteSpace(json)) return [];
        try { return JsonSerializer.Deserialize<List<ReportSchedule>>(json, Json) ?? []; }
        catch (JsonException) { return []; }
    }

    public static Task SaveAsync(SettingsService settings, List<ReportSchedule> list, CancellationToken ct = default) =>
        settings.SetValueAsync(SettingsKey, JsonSerializer.Serialize(list, Json), ct);

    /// <summary>Last delivery or creation: the reference point for the next due time.</summary>
    public static DateTimeOffset Reference(ReportSchedule s) => s.LastSentAt is { } l && l > s.CreatedAt ? l : s.CreatedAt;

    public static bool IsDue(ReportSchedule s, DateTimeOffset now) => s.Enabled && s.NextAfter(Reference(s)) <= now;

    public static Dictionary<string, string[]> Validate(ReportScheduleInput r)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(r.Name) || r.Name.Trim().Length > 100) errors["name"] = [L.T("Name angeben (max. 100 Zeichen).")];
        if (!ReportTypes.All.Contains(r.Type)) errors["type"] = [L.T("Unbekannter Berichtstyp.")];
        if (!Enum.IsDefined(r.Frequency)) errors["frequency"] = [L.T("Wöchentlich oder monatlich.")];
        else if (r.Frequency == ReportFrequency.Weekly && r.Day is < 0 or > 6) errors["day"] = [L.T("Wochentag 0 (Sonntag) bis 6 (Samstag).")];
        else if (r.Frequency == ReportFrequency.Monthly && r.Day is < 1 or > 28) errors["day"] = [L.T("Tag 1 bis 28.")];
        if (!TimeOnly.TryParseExact(r.Time ?? "", "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out _)) errors["time"] = [L.T("Uhrzeit im Format HH:MM.")];
        var recipients = (r.Recipients ?? []).Where(x => !string.IsNullOrWhiteSpace(x)).ToList();
        if (recipients.Count == 0) errors["recipients"] = [L.T("Mindestens einen Empfänger angeben.")];
        else if (recipients.FirstOrDefault(x => !MailboxAddress.TryParse(x.Trim(), out var m) || !m.Address.Contains('@')) is { } bad)
            errors["recipients"] = [L.F("'{0}' ist keine gültige E-Mail-Adresse.", bad)];
        return errors;
    }

    /// <summary>Builds the report of a schedule (for its domain) and sends it as PDF attachment through the SMTP server of the notifications.</summary>
    public static async Task SendAsync(ReportSchedule s, ReportBuilder builder, SettingsService settings, DateTimeOffset now, CancellationToken ct,
        Domains.DomainContext? domain = null)
    {
        if (domain is not null && s.DomainId is { } domainId) domain.Use(domainId);
        var smtp = await settings.GetSmtpAsync(ct);
        if (string.IsNullOrWhiteSpace(smtp.Host) || string.IsNullOrWhiteSpace(smtp.From))
            throw new InvalidOperationException(L.T("SMTP ist nicht eingerichtet (Server und Absender fehlen) – siehe Benachrichtigungen."));
        var (from, to) = s.Period(now);
        // E-mailed reports use the instance default language, also when sent from a request ("Jetzt senden").
        using var language = L.Use(L.InstanceDefault);
        var doc = await builder.BuildAsync(s.Type, from, to, L.F("Zeitplan „{0}“", s.Name), ct);
        var pdf = PdfReportRenderer.Render(doc);

        var mail = new MimeMessage();
        mail.From.Add(MailboxAddress.Parse(smtp.From));
        foreach (var r in s.Recipients) mail.To.Add(MailboxAddress.Parse(r.Trim()));
        mail.Subject = $"[TierModel] {doc.Title} – {HtmlReportRenderer.Range(doc)}" + (domain is not null && s.DomainId is not null ? $" – {domain.Current.DisplayName}" : "");
        var body = new BodyBuilder
        {
            TextBody = L.F("Im Anhang: {0} ({1}).\nGrundlage: {2}\nInstanz: {3}\n\nGesendet vom Zeitplan „{4}“.", doc.Title, HtmlReportRenderer.Range(doc), doc.Basis, doc.Instance, s.Name),
        };
        body.Attachments.Add(new MimePart("application", "pdf")
        {
            Content = new MimeContent(new MemoryStream(pdf)),
            ContentDisposition = new MimeKit.ContentDisposition(MimeKit.ContentDisposition.Attachment),
            ContentTransferEncoding = ContentEncoding.Base64,
            FileName = ReportTypes.FileName(s.Type, now, "pdf"),
        });
        mail.Body = body.ToMessageBody();

        using var client = new SmtpClient { Timeout = 30_000 };
        var security = smtp.Security switch { "None" => SecureSocketOptions.None, "SslOnConnect" => SecureSocketOptions.SslOnConnect, _ => SecureSocketOptions.StartTls };
        await client.ConnectAsync(smtp.Host, smtp.Port, security, ct);
        if (!string.IsNullOrEmpty(smtp.Username) && smtp.PasswordProtected is { } pw)
            await client.AuthenticateAsync(smtp.Username, settings.Secrets.Unprotect(pw), ct);
        await client.SendAsync(mail, ct);
        await client.DisconnectAsync(true, ct);
    }
}

public static class ReportEndpoints
{
    private static readonly string[] Formats = ["pdf", "html"];

    public static IServiceCollection AddReports(this IServiceCollection services)
    {
        services.AddScoped<ReportBuilder>();
        services.AddHostedService<ReportScheduleWorker>();
        return services;
    }

    private static bool TryDate(string? value, out DateOnly? date)
    {
        date = null;
        if (string.IsNullOrWhiteSpace(value)) return true;
        if (!DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) return false;
        date = d;
        return true;
    }

    public static void MapReportEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/reports").RequireAuthorization(nameof(Role.Viewer));

        api.MapGet("/", async (AppDbContext db, Domains.DomainContext domain, CancellationToken ct) =>
        {
            var domainId = domain.Id;
            var audit = await db.Runs.AsNoTracking().Where(r => r.DomainId == domainId && r.Kind == RunKind.Audit && r.Status == RunStatus.Succeeded)
                .OrderByDescending(r => r.Id).Select(r => new { r.Id, At = r.FinishedAt ?? r.CreatedAt }).FirstOrDefaultAsync(ct);
            var snapshot = await db.PrivilegedSnapshots.AsNoTracking().Where(x => x.DomainId == domainId).OrderByDescending(x => x.Id)
                .Select(x => new { x.RunId, x.TakenAt }).FirstOrDefaultAsync(ct);
            return new List<ReportTypeDto>
            {
                new(ReportTypes.SollIst, ReportTypes.Title(ReportTypes.SollIst),
                    L.T("Ergebnis des letzten Audits: Zusammenfassung und alle Abweichungen nach Bereich und Schweregrad."), false,
                    audit is null ? null : $"Audit #{audit.Id}", audit?.At),
                new(ReportTypes.Changes, ReportTypes.Title(ReportTypes.Changes),
                    L.T("Konfigurationsversionen mit Kommentar, Läufe, Freigaben und Änderungsprotokoll zwischen zwei Daten."), true, null, null),
                new(ReportTypes.Privileged, ReportTypes.Title(ReportTypes.Privileged),
                    L.T("Mitglieder privilegierter Gruppen, nicht erwartete Mitglieder, Hygiene, Angriffspfade und Compliance-Wert."), false,
                    snapshot is null ? null : L.F("Überwachung #{0}", snapshot.RunId), snapshot?.TakenAt),
            };
        });

        api.MapGet("/schedules", async (SettingsService settings, CancellationToken ct) =>
        {
            var now = DateTimeOffset.UtcNow;
            return (await ReportSchedules.LoadAsync(settings, ct)).Select(s => ReportScheduleDto.From(s, now));
        }).RequireAuthorization(nameof(Role.Admin));

        api.MapPut("/schedules", async (List<ReportScheduleInput> input, HttpContext ctx, SettingsService settings, ChangeLogService log, AppDbContext db,
            Domains.DomainRegistry domains) =>
        {
            var errors = new Dictionary<string, string[]>();
            if (input.Count > 50) errors["schedules"] = [L.T("Höchstens 50 Zeitpläne.")];
            for (var i = 0; i < input.Count; i++)
            {
                foreach (var (k, v) in ReportSchedules.Validate(input[i])) errors[$"schedules[{i}].{k}"] = v;
                if (input[i].DomainId is { } d && domains.Find(d) is null) errors[$"schedules[{i}].domainId"] = [L.T("Unbekannte Domäne.")];
            }
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var existing = (await ReportSchedules.LoadAsync(settings)).ToDictionary(s => s.Id);
            var now = DateTimeOffset.UtcNow;
            var list = input.Select(r =>
            {
                var old = r.Id is { } id ? existing.GetValueOrDefault(id) : null;
                var recipients = r.Recipients!.Select(x => x.Trim()).Where(x => x.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                var changedTiming = old is null || old.Frequency != r.Frequency || old.Day != r.Day || old.Time != r.Time || (!old.Enabled && r.Enabled);
                return new ReportSchedule(old?.Id ?? Guid.NewGuid(), r.Name.Trim(), r.Type, r.Frequency, r.Day, r.Time, recipients, r.Enabled,
                    // A new or re-timed schedule starts counting now, so it does not fire for a time slot in the past.
                    changedTiming ? now : old!.CreatedAt, old?.LastSentAt, old?.LastError, r.DomainId);
            }).ToList();
            await ReportSchedules.SaveAsync(settings, list);
            log.Add(ctx.User.UserName(), "settings.report-schedules", "settings", null,
                list.Count == 0 ? L.P("Alle Berichtszeitpläne entfernt") : L.PF("Berichtszeitpläne gespeichert: {0}", string.Join(", ", list.Select(s => s.Name))));
            await db.SaveChangesAsync();
            return Results.Ok(list.Select(s => ReportScheduleDto.From(s, now)));
        }).RequireAuthorization(nameof(Role.Admin));

        api.MapPost("/schedules/{id:guid}/send", async (Guid id, HttpContext ctx, SettingsService settings, ReportBuilder builder, ChangeLogService log,
            AppDbContext db, Domains.DomainContext domain, Domains.DomainRegistry domains, CancellationToken ct) =>
        {
            var list = await ReportSchedules.LoadAsync(settings, ct);
            var s = list.FirstOrDefault(x => x.Id == id);
            if (s is null) return Results.NotFound();
            domain.Use(s.DomainId is { } sd ? domains.Find(sd) ?? domains.Default : domains.Default);
            try
            {
                await ReportSchedules.SendAsync(s, builder, settings, DateTimeOffset.UtcNow, ct, domain);
                log.Add(ctx.User.UserName(), "report.send", "settings", null, L.PF("Bericht „{0}“ an {1} gesendet", s.Name, string.Join(", ", s.Recipients)));
                await db.SaveChangesAsync(ct);
                return Results.NoContent();
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                return Results.Problem(title: L.T("Bericht konnte nicht gesendet werden"), detail: ex.Message, statusCode: 502);
            }
        }).RequireAuthorization(nameof(Role.Admin));

        api.MapGet("/{type}", async (string type, string? from, string? to, string? format, bool? download, HttpContext ctx, ReportBuilder builder, CancellationToken ct) =>
        {
            if (!ReportTypes.All.Contains(type)) return Results.Problem(title: L.T("Unbekannter Bericht"), statusCode: 404);
            var f = (format ?? "pdf").ToLowerInvariant();
            var errors = new Dictionary<string, string[]>();
            if (!Formats.Contains(f)) errors["format"] = [L.T("pdf oder html.")];
            if (!TryDate(from, out var fromDate)) errors["from"] = [L.T("Datum im Format JJJJ-MM-TT.")];
            if (!TryDate(to, out var toDate)) errors["to"] = [L.T("Datum im Format JJJJ-MM-TT.")];
            if (fromDate is { } a && toDate is { } b && b.DayNumber - a.DayNumber > 3660) errors["from"] = [L.T("Höchstens zehn Jahre.")];
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var doc = await builder.BuildAsync(type, fromDate, toDate, ctx.User.UserName(), ct);
            if (f == "html")
            {
                // The preview is shown in an iframe of the UI: allow same-origin framing, but no scripts or external resources.
                ctx.Response.Headers["X-Frame-Options"] = "SAMEORIGIN";
                ctx.Response.Headers.ContentSecurityPolicy = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";
                var html = HtmlReportRenderer.Render(doc);
                if (download == true)
                    ctx.Response.Headers.ContentDisposition = $"attachment; filename=\"{ReportTypes.FileName(type, doc.GeneratedAt, "html")}\"";
                return Results.Content(html, "text/html; charset=utf-8");
            }
            var pdf = PdfReportRenderer.Render(doc);
            return download == false
                ? Results.File(pdf, "application/pdf")
                : Results.File(pdf, "application/pdf", ReportTypes.FileName(type, doc.GeneratedAt, "pdf"));
        });
    }
}

/// <summary>Sends scheduled reports by e-mail; checks once a minute.</summary>
public class ReportScheduleWorker(IServiceScopeFactory scopes, ILogger<ReportScheduleWorker> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval);
        do
        {
            try { await TickAsync(DateTimeOffset.UtcNow, stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception ex) { logger.LogError(ex, "Scheduled reports failed"); }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    public async Task TickAsync(DateTimeOffset now, CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var settings = scope.ServiceProvider.GetRequiredService<SettingsService>();
        var domain = scope.ServiceProvider.GetRequiredService<Domains.DomainContext>();
        var domains = scope.ServiceProvider.GetRequiredService<Domains.DomainRegistry>();
        var due = (await ReportSchedules.LoadAsync(settings, ct)).Where(s => ReportSchedules.IsDue(s, now)).ToList();
        foreach (var s in due)
        {
            string? error = null;
            domain.Use(s.DomainId is { } sd ? domains.Find(sd) ?? domains.Default : domains.Default);
            try { await ReportSchedules.SendAsync(s, scope.ServiceProvider.GetRequiredService<ReportBuilder>(), settings, now, ct, domain); }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                error = ex.Message;
                logger.LogWarning("Scheduled report {Name} failed: {Error}", s.Name, error);
            }
            // Re-read right before writing: an administrator may have edited the list meanwhile.
            var list = await ReportSchedules.LoadAsync(settings, ct);
            var i = list.FindIndex(x => x.Id == s.Id);
            if (i < 0) continue;
            // A failed delivery is not repeated every minute: it waits for the next slot (the error is shown on the page).
            list[i] = list[i] with { LastSentAt = now, LastError = error };
            await ReportSchedules.SaveAsync(settings, list, ct);
            var log = scope.ServiceProvider.GetRequiredService<ChangeLogService>();
            log.Add("system", error is null ? "report.send" : "report.failed", "settings", null,
                error is null ? L.PF("Bericht „{0}“ an {1} gesendet", s.Name, string.Join(", ", s.Recipients)) : L.PF("Bericht „{0}“ nicht gesendet: {1}", s.Name, error));
            await scope.ServiceProvider.GetRequiredService<AppDbContext>().SaveChangesAsync(ct);
        }
    }
}
