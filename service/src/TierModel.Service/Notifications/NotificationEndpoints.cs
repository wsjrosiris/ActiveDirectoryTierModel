using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using MimeKit;
using TierModel.Service.Auth;
using TierModel.Service.Data;
using TierModel.Service.Notifications.Siem;

namespace TierModel.Service.Notifications;

public static partial class NotificationEndpoints
{
    public record EventsDto(bool Drift, bool Failure, bool Apply, bool Approval, bool Certificate = false, bool Privileged = false,
        bool JitRequested = false, bool JitGranted = false);

    /// <summary>Log Analytics settings as shown to the UI: the client secret only as "stored".</summary>
    public record LogAnalyticsDto(string TenantId, string ClientId, string EndpointUrl, string DcrImmutableId, string StreamName, bool HasClientSecret);

    /// <summary>ClientSecret: null or empty keeps the stored secret.</summary>
    public record LogAnalyticsRequest(string? TenantId, string? ClientId, string? EndpointUrl, string? DcrImmutableId, string? StreamName, string? ClientSecret);

    public record ChannelDto(long Id, string Name, ChannelType Type, bool Enabled, string Target, EventsDto Events,
        DateTimeOffset? LastSentAt, string? LastError, DateTimeOffset CreatedAt,
        SyslogSettings? Syslog = null, LogAnalyticsDto? LogAnalytics = null, bool ForwardChangeLog = false, long DroppedEvents = 0)
    {
        public static ChannelDto From(NotificationChannel c) => new(c.Id, c.Name, c.Type, c.Enabled, c.TargetDisplay,
            new EventsDto(c.OnDrift, c.OnFailure, c.OnApply, c.OnApproval, c.OnCertificate, c.OnPrivilegedChange,
                c.OnJitRequested, c.OnJitGranted), c.LastSentAt, c.LastError, c.CreatedAt);

        /// <summary>With the (secret-free) SIEM settings and the number of events that could not be forwarded.</summary>
        public static ChannelDto From(NotificationChannel c, IDataProtector secrets, SiemForwarder forwarder)
        {
            var dto = From(c);
            if (SiemChannelConfig.Read(c, secrets) is not { } config) return dto;
            return dto with
            {
                Syslog = config.Syslog,
                LogAnalytics = config.LogAnalytics is { } l
                    ? new LogAnalyticsDto(l.TenantId, l.ClientId, l.EndpointUrl, l.DcrImmutableId, l.StreamName, !string.IsNullOrEmpty(config.ClientSecret))
                    : null,
                ForwardChangeLog = config.ForwardChangeLog,
                DroppedEvents = forwarder.Dropped(c.Id, config.ForwardChangeLog),
            };
        }
    }

    public record ChannelRequest(string Name, ChannelType Type, bool Enabled, string? Target, EventsDto? Events,
        SyslogSettings? Syslog = null, LogAnalyticsRequest? LogAnalytics = null, bool? ForwardChangeLog = null);

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

        g.MapGet("/channels", async (AppDbContext db, SettingsService settings, SiemForwarder forwarder) =>
            (await db.NotificationChannels.AsNoTracking().OrderBy(c => c.Name).ToListAsync()).Select(c => ChannelDto.From(c, settings.Secrets, forwarder)));

        g.MapPost("/channels", async (ChannelRequest r, HttpContext ctx, AppDbContext db, SettingsService settings, ChangeLogService log, SiemForwarder forwarder) =>
        {
            var siem = SiemChannelConfig.IsSiem(r.Type);
            var errors = Validate(r, requireTarget: !siem);
            var config = siem ? BuildSiem(r, null, errors) : null;
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            var target = config?.Serialize() ?? r.Target!.Trim();
            var channel = new NotificationChannel
            {
                Name = r.Name.Trim(), Type = r.Type, Enabled = r.Enabled,
                TargetProtected = settings.Secrets.Protect(target), TargetDisplay = config?.Display() ?? Mask(r.Type, target),
                CreatedAt = DateTimeOffset.UtcNow,
            };
            Apply(channel, r.Events);
            db.NotificationChannels.Add(channel);
            await db.SaveChangesAsync();
            log.Add(ctx.User.UserName(), "notification.create", "notification", channel.Id.ToString(), $"Benachrichtigungskanal '{channel.Name}' ({channel.Type}) angelegt");
            await db.SaveChangesAsync();
            forwarder.Invalidate();
            return Results.Ok(ChannelDto.From(channel, settings.Secrets, forwarder));
        });

        g.MapPut("/channels/{id:long}", async (long id, ChannelRequest r, HttpContext ctx, AppDbContext db, SettingsService settings, ChangeLogService log,
            SiemForwarder forwarder) =>
        {
            var channel = await db.NotificationChannels.FindAsync(id);
            if (channel is null) return Results.NotFound();
            var siem = SiemChannelConfig.IsSiem(r.Type);
            // Changing the type without a new target would reinterpret the old secret.
            var errors = Validate(r, requireTarget: !siem && r.Type != channel.Type);
            var config = siem ? BuildSiem(r, r.Type == channel.Type ? SiemChannelConfig.Read(channel, settings.Secrets) : null, errors) : null;
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            channel.Name = r.Name.Trim();
            channel.Type = r.Type;
            channel.Enabled = r.Enabled;
            if (config is not null)
            {
                var serialized = config.Serialize();
                if (SiemChannelConfig.Read(channel, settings.Secrets)?.Serialize() != serialized) channel.LastError = null;
                channel.TargetProtected = settings.Secrets.Protect(serialized);
                channel.TargetDisplay = config.Display();
            }
            else if (!string.IsNullOrWhiteSpace(r.Target))
            {
                channel.TargetProtected = settings.Secrets.Protect(r.Target.Trim());
                channel.TargetDisplay = Mask(r.Type, r.Target.Trim());
                channel.LastError = null;
            }
            Apply(channel, r.Events);
            log.Add(ctx.User.UserName(), "notification.update", "notification", id.ToString(), $"Benachrichtigungskanal '{channel.Name}' geändert");
            await db.SaveChangesAsync();
            forwarder.Invalidate();
            return Results.Ok(ChannelDto.From(channel, settings.Secrets, forwarder));
        });

        g.MapDelete("/channels/{id:long}", async (long id, HttpContext ctx, AppDbContext db, ChangeLogService log, SiemForwarder forwarder) =>
        {
            var channel = await db.NotificationChannels.FindAsync(id);
            if (channel is null) return Results.NotFound();
            db.NotificationChannels.Remove(channel);
            log.Add(ctx.User.UserName(), "notification.delete", "notification", id.ToString(), $"Benachrichtigungskanal '{channel.Name}' gelöscht");
            await db.SaveChangesAsync();
            forwarder.Invalidate();
            forwarder.Forget(id);
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
        else if (SiemChannelConfig.IsSiem(r.Type)) { /* validated by BuildSiem */ }
        else if (!string.IsNullOrWhiteSpace(r.Target) && ValidateTarget(r.Type, r.Target.Trim()) is { } error) errors["target"] = [error];
        else if (requireTarget && string.IsNullOrWhiteSpace(r.Target)) errors["target"] = [r.Type == ChannelType.Email ? "Empfänger angeben." : "Adresse (URL) angeben."];
        return errors;
    }

    [System.Text.RegularExpressions.GeneratedRegex(@"^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,62})(?:\.[A-Za-z0-9-]{1,63})*$|^[0-9a-fA-F:.]+$")]
    private static partial System.Text.RegularExpressions.Regex HostPattern();

    [System.Text.RegularExpressions.GeneratedRegex(@"^dcr-[0-9a-fA-F]{32}$")]
    private static partial System.Text.RegularExpressions.Regex DcrPattern();

    [System.Text.RegularExpressions.GeneratedRegex(@"^(Custom|Microsoft)-[A-Za-z0-9_]{1,100}$")]
    private static partial System.Text.RegularExpressions.Regex StreamPattern();

    /// <summary>Validates and merges the SIEM settings of a request with the stored ones (null parts keep the stored values).</summary>
    public static SiemChannelConfig? BuildSiem(ChannelRequest r, SiemChannelConfig? existing, Dictionary<string, string[]> errors)
    {
        var forward = r.ForwardChangeLog ?? existing?.ForwardChangeLog ?? false;
        if (r.Type == ChannelType.Syslog)
        {
            var s = r.Syslog ?? existing?.Syslog;
            if (s is null) { errors["syslog"] = ["Syslog-Server angeben."]; return null; }
            s = s with { Host = (s.Host ?? "").Trim() };
            if (s.Host.Length == 0 || !HostPattern().IsMatch(s.Host)) errors["syslog.host"] = ["Gültigen Hostnamen oder IP-Adresse angeben."];
            if (s.Port is < 1 or > 65535) errors["syslog.port"] = ["Port 1–65535."];
            if (!Enum.IsDefined(s.Protocol)) errors["syslog.protocol"] = ["UDP, TCP oder TLS."];
            if (!Enum.IsDefined(s.Format)) errors["syslog.format"] = ["CEF oder RFC 5424."];
            return new SiemChannelConfig(s, null, null, forward);
        }

        var req = r.LogAnalytics;
        var old = existing?.LogAnalytics;
        var l = new LogAnalyticsSettings(
            (req?.TenantId ?? old?.TenantId ?? "").Trim(), (req?.ClientId ?? old?.ClientId ?? "").Trim(),
            (req?.EndpointUrl ?? old?.EndpointUrl ?? "").Trim().TrimEnd('/'), (req?.DcrImmutableId ?? old?.DcrImmutableId ?? "").Trim(),
            (req?.StreamName ?? old?.StreamName ?? "").Trim());
        var secret = string.IsNullOrEmpty(req?.ClientSecret) ? existing?.ClientSecret : req.ClientSecret;
        if (!Guid.TryParse(l.TenantId, out _)) errors["logAnalytics.tenantId"] = ["Mandanten-ID als GUID angeben."];
        if (!Guid.TryParse(l.ClientId, out _)) errors["logAnalytics.clientId"] = ["Anwendungs-ID (Client-ID) als GUID angeben."];
        if (!(Uri.TryCreate(l.EndpointUrl, UriKind.Absolute, out var u) && (u.Scheme == "https" || (u.Scheme == "http" && u.IsLoopback))))
            errors["logAnalytics.endpointUrl"] = ["Vollständige https-Adresse des Datensammlungsendpunkts angeben."];
        if (!DcrPattern().IsMatch(l.DcrImmutableId)) errors["logAnalytics.dcrImmutableId"] = ["Unveränderliche ID der Regel im Format dcr-… (32 Hexadezimalzeichen)."];
        if (!StreamPattern().IsMatch(l.StreamName)) errors["logAnalytics.streamName"] = ["Streamname im Format Custom-Tabelle, z. B. Custom-TierModel_CL."];
        if (string.IsNullOrEmpty(secret)) errors["logAnalytics.clientSecret"] = ["Geheimen Clientschlüssel angeben."];
        return new SiemChannelConfig(null, l, secret, forward);
    }

    private static void Apply(NotificationChannel c, EventsDto? e)
    {
        e ??= new EventsDto(true, true, false, true, true, true, true, true);
        c.OnDrift = e.Drift;
        c.OnFailure = e.Failure;
        c.OnApply = e.Apply;
        c.OnApproval = e.Approval;
        c.OnCertificate = e.Certificate;
        c.OnPrivilegedChange = e.Privileged;
        c.OnJitRequested = e.JitRequested;
        c.OnJitGranted = e.JitGranted;
    }
}
