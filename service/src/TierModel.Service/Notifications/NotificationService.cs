using Microsoft.AspNetCore.DataProtection;
using System.Text.Json;
using System.Threading.Channels;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.EntityFrameworkCore;
using MimeKit;
using TierModel.Service.Data;
using TierModel.Service.Runs;

namespace TierModel.Service.Notifications;

public enum NotificationEvent { Drift, Failure, Apply, ApprovalRequested }

/// <summary>Events are sent in the background so a slow mail server never delays a run or a request.</summary>
public class NotificationQueue
{
    private readonly Channel<(NotificationEvent Event, long RunId)> _channel = Channel.CreateUnbounded<(NotificationEvent, long)>();

    public void Enqueue(NotificationEvent e, long runId) => _channel.Writer.TryWrite((e, runId));

    public ChannelReader<(NotificationEvent Event, long RunId)> Reader => _channel.Reader;
}

public record NotificationMessage(NotificationEvent? Event, string Title, string Text, IReadOnlyList<(string Label, string Value)> Facts, string? Url, string Color);

public class NotificationService(AppDbContext db, SettingsService settings, ChangeLogService changeLog, IHttpClientFactory httpFactory, ILogger<NotificationService> logger)
{
    public static readonly TimeSpan[] RetryDelays = [TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(30)];

    public static bool Wants(NotificationChannel c, NotificationEvent e) => e switch
    {
        NotificationEvent.Drift => c.OnDrift,
        NotificationEvent.Failure => c.OnFailure,
        NotificationEvent.Apply => c.OnApply,
        NotificationEvent.ApprovalRequested => c.OnApproval,
        _ => false,
    };

    /// <summary>Events a finished run triggers.</summary>
    public static IEnumerable<NotificationEvent> EventsFor(Run run)
    {
        if (run.Status == RunStatus.Failed) yield return NotificationEvent.Failure;
        if (run.Kind == RunKind.Audit && run.Status == RunStatus.Succeeded && run.DriftCount > 0) yield return NotificationEvent.Drift;
        if (run.Kind == RunKind.Deploy && run.Mode == RunMode.Apply && run.Status == RunStatus.Succeeded) yield return NotificationEvent.Apply;
    }

    public static NotificationMessage BuildMessage(NotificationEvent e, Run run, string publicBaseUrl)
    {
        var what = run.Kind == RunKind.Audit ? "Audit" : run.Mode == RunMode.Apply ? "Deploy (Anwenden)" : "Deploy (Planung)";
        var scope = run.Scope?.ToString() ?? "–";
        var includes = RunSummaryDto.IncludeList(run.IncludeMsa, run.IncludeGmsa, run.IncludeDmsa, run.IncludeWinLaps);
        if (includes.Length > 0) scope += " + " + string.Join(", ", includes);
        var facts = new List<(string, string)>
        {
            ("Lauf", $"#{run.Id} · {what}"),
            ("Bereich", scope),
            ("Domänencontroller", run.PreferredDc),
            ("Angefordert von", run.RequestedBy),
        };
        var (title, text, color) = e switch
        {
            NotificationEvent.Drift => ($"Drift erkannt: {run.DriftCount} Abweichung(en)",
                $"Das Audit #{run.Id} hat {run.DriftCount} Abweichung(en) zwischen Soll-Konfiguration und Active Directory gefunden.", "warning"),
            NotificationEvent.Failure => ($"{what} #{run.Id} fehlgeschlagen",
                run.Message ?? "Der Lauf ist fehlgeschlagen.", "attention"),
            NotificationEvent.Apply => ($"Deploy #{run.Id} angewendet",
                "Änderungen wurden im Active Directory angewendet." + (run.ApprovedBy is null ? "" : $" Freigegeben von {run.ApprovedBy}."), "good"),
            NotificationEvent.ApprovalRequested => ($"Freigabe angefordert: Deploy #{run.Id}",
                $"{run.RequestedBy} möchte Änderungen im Active Directory anwenden. Eine zweite Person mit der Rolle Operator muss freigeben"
                + (run.ApprovalExpiresAt is { } exp ? $" (bis {exp.ToLocalTime():dd.MM.yyyy HH:mm})." : "."), "accent"),
            _ => ("TierModel Service", "", "default"),
        };
        if (run.FinishedAt is { } f) facts.Add(("Beendet", f.ToLocalTime().ToString("dd.MM.yyyy HH:mm")));
        var url = string.IsNullOrWhiteSpace(publicBaseUrl) ? null : $"{publicBaseUrl.TrimEnd('/')}/laeufe/{run.Id}";
        return new NotificationMessage(e, title, text, facts, url, color);
    }

    public static NotificationMessage TestMessage(string publicBaseUrl) => new(null, "Testnachricht vom TierModel Service",
        "Dieser Kanal ist richtig eingerichtet.", [("Gesendet", DateTimeOffset.Now.ToString("dd.MM.yyyy HH:mm"))],
        string.IsNullOrWhiteSpace(publicBaseUrl) ? null : publicBaseUrl.TrimEnd('/') + "/", "good");

    public async Task DispatchAsync(NotificationEvent e, long runId, CancellationToken ct)
    {
        var run = await db.Runs.AsNoTracking().FirstOrDefaultAsync(r => r.Id == runId, ct);
        if (run is null) return;
        var channels = (await db.NotificationChannels.Where(c => c.Enabled).ToListAsync(ct)).Where(c => Wants(c, e)).ToList();
        if (channels.Count == 0) return;
        var message = BuildMessage(e, run, (await settings.GetAsync(ct)).PublicBaseUrl);

        foreach (var channel in channels)
        {
            string? error = null;
            for (var attempt = 0; ; attempt++)
            {
                try
                {
                    await SendAsync(channel, message, ct);
                    error = null;
                    break;
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    error = ex.Message;
                    if (attempt >= RetryDelays.Length) break;
                    await Task.Delay(RetryDelays[attempt], ct);
                }
            }
            channel.LastError = error;
            if (error is null) channel.LastSentAt = DateTimeOffset.UtcNow;
            else
            {
                logger.LogWarning("Notification channel {Channel} failed: {Error}", channel.Name, error);
                changeLog.Add("system", "notification.failed", "notification", channel.Id.ToString(),
                    $"Benachrichtigung über '{channel.Name}' fehlgeschlagen: {error}");
            }
        }
        await db.SaveChangesAsync(ct);
    }

    public async Task SendAsync(NotificationChannel channel, NotificationMessage message, CancellationToken ct)
    {
        var target = settings.Secrets.Unprotect(channel.TargetProtected);
        switch (channel.Type)
        {
            case ChannelType.Email:
                await SendMailAsync(target, message, ct);
                break;
            case ChannelType.Teams:
                await PostAsync(target, TeamsPayload(message), ct);
                break;
            case ChannelType.Webhook:
                await PostAsync(target, new
                {
                    @event = message.Event?.ToString() ?? "Test",
                    title = message.Title,
                    text = message.Text,
                    url = message.Url,
                    facts = message.Facts.ToDictionary(f => f.Label, f => f.Value),
                    sentAt = DateTimeOffset.UtcNow,
                }, ct);
                break;
        }
    }

    /// <summary>Adaptive Card as accepted by Teams "Workflows" webhooks and classic incoming webhooks.</summary>
    public static object TeamsPayload(NotificationMessage m) => new
    {
        type = "message",
        attachments = new[]
        {
            new
            {
                contentType = "application/vnd.microsoft.card.adaptive",
                contentUrl = (string?)null,
                content = new Dictionary<string, object?>
                {
                    ["$schema"] = "http://adaptivecards.io/schemas/adaptive-card.json",
                    ["type"] = "AdaptiveCard",
                    ["version"] = "1.4",
                    ["body"] = new object[]
                    {
                        new { type = "TextBlock", size = "Medium", weight = "Bolder", text = m.Title, wrap = true, color = m.Color },
                        new { type = "TextBlock", text = m.Text, wrap = true },
                        new { type = "FactSet", facts = m.Facts.Select(f => new { title = f.Label, value = f.Value }).ToArray() },
                    },
                    ["actions"] = m.Url is null ? Array.Empty<object>() : new object[] { new { type = "Action.OpenUrl", title = "Im TierModel Service öffnen", url = m.Url } },
                },
            },
        },
    };

    private async Task PostAsync(string url, object payload, CancellationToken ct)
    {
        using var client = httpFactory.CreateClient("notifications");
        HttpResponseMessage response;
        try
        {
            // Buffered with Content-Length: some receivers reject chunked request bodies.
            using var content = new StringContent(JsonSerializer.Serialize(payload, JsonSerializerOptions.Web), System.Text.Encoding.UTF8, "application/json");
            response = await client.PostAsync(url, content, ct);
        }
        catch (HttpRequestException ex)
        {
            // The outer message ("An error occurred while sending the request") says nothing; show the cause.
            var inner = ex.GetBaseException();
            throw new InvalidOperationException(inner == ex ? ex.Message : $"{ex.Message} {inner.Message}", ex);
        }
        using var _ = response;
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"HTTP {(int)response.StatusCode}: {(body.Length > 300 ? body[..300] : body)}");
        }
    }

    private async Task SendMailAsync(string recipients, NotificationMessage m, CancellationToken ct)
    {
        var smtp = await settings.GetSmtpAsync(ct);
        if (string.IsNullOrWhiteSpace(smtp.Host) || string.IsNullOrWhiteSpace(smtp.From))
            throw new InvalidOperationException("SMTP ist nicht eingerichtet (Server und Absender fehlen).");

        var mail = new MimeMessage();
        mail.From.Add(MailboxAddress.Parse(smtp.From));
        foreach (var r in recipients.Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            mail.To.Add(MailboxAddress.Parse(r));
        mail.Subject = $"[TierModel] {m.Title}";
        var facts = string.Join("\n", m.Facts.Select(f => $"{f.Label}: {f.Value}"));
        var html = $"""
            <div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#111">
            <h2 style="font-size:18px;margin:0 0 8px">{System.Net.WebUtility.HtmlEncode(m.Title)}</h2>
            <p>{System.Net.WebUtility.HtmlEncode(m.Text)}</p>
            <table style="border-collapse:collapse">{string.Concat(m.Facts.Select(f =>
                $"<tr><td style=\"padding:2px 12px 2px 0;color:#555\">{System.Net.WebUtility.HtmlEncode(f.Label)}</td><td>{System.Net.WebUtility.HtmlEncode(f.Value)}</td></tr>"))}</table>
            {(m.Url is null ? "" : $"<p><a href=\"{System.Net.WebUtility.HtmlEncode(m.Url)}\">Im TierModel Service öffnen</a></p>")}
            </div>
            """;
        mail.Body = new BodyBuilder { TextBody = $"{m.Text}\n\n{facts}\n{(m.Url is null ? "" : "\n" + m.Url)}", HtmlBody = html }.ToMessageBody();

        using var client = new SmtpClient { Timeout = 30_000 };
        var security = smtp.Security switch
        {
            "None" => SecureSocketOptions.None,
            "SslOnConnect" => SecureSocketOptions.SslOnConnect,
            _ => SecureSocketOptions.StartTls,
        };
        await client.ConnectAsync(smtp.Host, smtp.Port, security, ct);
        if (!string.IsNullOrEmpty(smtp.Username) && smtp.PasswordProtected is { } pw)
            await client.AuthenticateAsync(smtp.Username, settings.Secrets.Unprotect(pw), ct);
        await client.SendAsync(mail, ct);
        await client.DisconnectAsync(true, ct);
    }
}

public class NotificationWorker(NotificationQueue queue, IServiceScopeFactory scopes, ILogger<NotificationWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var (e, runId) in queue.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<NotificationService>().DispatchAsync(e, runId, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Notification {Event} for run {RunId} failed", e, runId);
            }
        }
    }
}
