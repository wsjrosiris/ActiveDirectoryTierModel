using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using MimeKit;
using TierModel.Service.Auth;
using TierModel.Service.Data;

namespace TierModel.Service.Notifications;

public static class NotificationEndpoints
{
    public record EventsDto(bool Drift, bool Failure, bool Apply, bool Approval);

    public record ChannelDto(long Id, string Name, ChannelType Type, bool Enabled, string Target, EventsDto Events,
        DateTimeOffset? LastSentAt, string? LastError, DateTimeOffset CreatedAt)
    {
        public static ChannelDto From(NotificationChannel c) => new(c.Id, c.Name, c.Type, c.Enabled, c.TargetDisplay,
            new EventsDto(c.OnDrift, c.OnFailure, c.OnApply, c.OnApproval), c.LastSentAt, c.LastError, c.CreatedAt);
    }

    public record ChannelRequest(string Name, ChannelType Type, bool Enabled, string? Target, EventsDto? Events);

    public record SmtpDto(string Host, int Port, string Security, string Username, string From, bool HasPassword);

    public record SmtpRequest(string Host, int Port, string Security, string? Username, string From, string? Password);

    /// <summary>Webhook URLs usually embed a secret: only scheme and host are ever shown again.</summary>
    public static string Mask(ChannelType type, string target) =>
        type == ChannelType.Email || !Uri.TryCreate(target, UriKind.Absolute, out var u) ? target : $"{u.Scheme}://{u.Host}/…";

    private static string? ValidateTarget(ChannelType type, string target)
    {
        if (type == ChannelType.Email)
        {
            var parts = target.Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (parts.Length == 0) return "Mindestens eine E-Mail-Adresse angeben.";
            var bad = parts.FirstOrDefault(p => !MailboxAddress.TryParse(p, out var m) || !m.Address.Contains('@'));
            return bad is null ? null : $"'{bad}' ist keine gültige E-Mail-Adresse.";
        }
        // https only; plain http is accepted for receivers on the same machine (e.g. a local relay).
        return Uri.TryCreate(target, UriKind.Absolute, out var u) && (u.Scheme == "https" || (u.Scheme == "http" && u.IsLoopback))
            ? null : "Bitte eine vollständige https-Adresse angeben.";
    }

    public static void MapNotificationEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/notifications").RequireAuthorization(nameof(Role.Admin));

        g.MapGet("/channels", async (AppDbContext db) =>
            (await db.NotificationChannels.AsNoTracking().OrderBy(c => c.Name).ToListAsync()).Select(ChannelDto.From));

        g.MapPost("/channels", async (ChannelRequest r, HttpContext ctx, AppDbContext db, SettingsService settings, ChangeLogService log) =>
        {
            var errors = Validate(r, requireTarget: true);
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            var target = r.Target!.Trim();
            var channel = new NotificationChannel
            {
                Name = r.Name.Trim(), Type = r.Type, Enabled = r.Enabled,
                TargetProtected = settings.Secrets.Protect(target), TargetDisplay = Mask(r.Type, target),
                CreatedAt = DateTimeOffset.UtcNow,
            };
            Apply(channel, r.Events);
            db.NotificationChannels.Add(channel);
            await db.SaveChangesAsync();
            log.Add(ctx.User.UserName(), "notification.create", "notification", channel.Id.ToString(), $"Benachrichtigungskanal '{channel.Name}' ({channel.Type}) angelegt");
            await db.SaveChangesAsync();
            return Results.Ok(ChannelDto.From(channel));
        });

        g.MapPut("/channels/{id:long}", async (long id, ChannelRequest r, HttpContext ctx, AppDbContext db, SettingsService settings, ChangeLogService log) =>
        {
            var channel = await db.NotificationChannels.FindAsync(id);
            if (channel is null) return Results.NotFound();
            // Changing the type without a new target would reinterpret the old secret.
            var errors = Validate(r, requireTarget: r.Type != channel.Type);
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            channel.Name = r.Name.Trim();
            channel.Type = r.Type;
            channel.Enabled = r.Enabled;
            if (!string.IsNullOrWhiteSpace(r.Target))
            {
                channel.TargetProtected = settings.Secrets.Protect(r.Target.Trim());
                channel.TargetDisplay = Mask(r.Type, r.Target.Trim());
                channel.LastError = null;
            }
            Apply(channel, r.Events);
            log.Add(ctx.User.UserName(), "notification.update", "notification", id.ToString(), $"Benachrichtigungskanal '{channel.Name}' geändert");
            await db.SaveChangesAsync();
            return Results.Ok(ChannelDto.From(channel));
        });

        g.MapDelete("/channels/{id:long}", async (long id, HttpContext ctx, AppDbContext db, ChangeLogService log) =>
        {
            var channel = await db.NotificationChannels.FindAsync(id);
            if (channel is null) return Results.NotFound();
            db.NotificationChannels.Remove(channel);
            log.Add(ctx.User.UserName(), "notification.delete", "notification", id.ToString(), $"Benachrichtigungskanal '{channel.Name}' gelöscht");
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        g.MapPost("/channels/{id:long}/test", async (long id, HttpContext ctx, AppDbContext db, SettingsService settings,
            NotificationService notifications, ChangeLogService log, CancellationToken ct) =>
        {
            var channel = await db.NotificationChannels.FindAsync([id], ct);
            if (channel is null) return Results.NotFound();
            try
            {
                await notifications.SendAsync(channel, NotificationService.TestMessage((await settings.GetAsync(ct)).PublicBaseUrl), ct);
                channel.LastSentAt = DateTimeOffset.UtcNow;
                channel.LastError = null;
                log.Add(ctx.User.UserName(), "notification.test", "notification", id.ToString(), $"Testnachricht über '{channel.Name}' gesendet");
                await db.SaveChangesAsync(ct);
                return Results.NoContent();
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                channel.LastError = ex.Message;
                await db.SaveChangesAsync(ct);
                return Results.Problem(title: "Testnachricht konnte nicht zugestellt werden", detail: ex.Message, statusCode: 502);
            }
        });

        g.MapGet("/smtp", async (SettingsService settings) => ToDto(await settings.GetSmtpAsync()));

        g.MapPut("/smtp", async (SmtpRequest r, HttpContext ctx, SettingsService settings, ChangeLogService log, AppDbContext db) =>
        {
            var errors = new Dictionary<string, string[]>();
            if (r.Port is < 1 or > 65535) errors["port"] = ["Port 1–65535."];
            if (r.Security is not ("None" or "StartTls" or "SslOnConnect")) errors["security"] = ["None, StartTls oder SslOnConnect."];
            if (!string.IsNullOrWhiteSpace(r.From) && !(MailboxAddress.TryParse(r.From, out var from) && from.Address.Contains('@')))
                errors["from"] = ["Ungültige Absenderadresse."];
            if (!string.IsNullOrWhiteSpace(r.Host) && string.IsNullOrWhiteSpace(r.From)) errors["from"] = ["Absenderadresse angeben."];
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var current = await settings.GetSmtpAsync();
            // null = keep the stored password, "" = remove it.
            var password = r.Password is null ? current.PasswordProtected
                : r.Password.Length == 0 ? null : settings.Secrets.Protect(r.Password);
            var config = new SmtpConfig((r.Host ?? "").Trim(), r.Port, r.Security, (r.Username ?? "").Trim(), (r.From ?? "").Trim(), password);
            await settings.SetSmtpAsync(config);
            log.Add(ctx.User.UserName(), "smtp.update", "settings", null, $"SMTP-Einstellungen geändert: {config.Host}:{config.Port} ({config.Security})");
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(config));
        });
    }

    private static SmtpDto ToDto(SmtpConfig c) => new(c.Host, c.Port, c.Security, c.Username, c.From, c.PasswordProtected is not null);

    private static Dictionary<string, string[]> Validate(ChannelRequest r, bool requireTarget)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(r.Name) || r.Name.Length > 100) errors["name"] = ["Name angeben (max. 100 Zeichen)."];
        if (!Enum.IsDefined(r.Type)) errors["type"] = ["Unbekannter Typ."];
        else if (!string.IsNullOrWhiteSpace(r.Target) && ValidateTarget(r.Type, r.Target.Trim()) is { } error) errors["target"] = [error];
        else if (requireTarget && string.IsNullOrWhiteSpace(r.Target)) errors["target"] = [r.Type == ChannelType.Email ? "Empfänger angeben." : "Adresse (URL) angeben."];
        return errors;
    }

    private static void Apply(NotificationChannel c, EventsDto? e)
    {
        e ??= new EventsDto(true, true, false, true);
        c.OnDrift = e.Drift;
        c.OnFailure = e.Failure;
        c.OnApply = e.Apply;
        c.OnApproval = e.Approval;
    }
}
