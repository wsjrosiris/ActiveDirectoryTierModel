using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Net.Security;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.DataProtection;
using TierModel.Service.Data;

namespace TierModel.Service.Notifications.Siem;

/// <summary>Sends events to Syslog receivers (UDP, TCP, TCP+TLS).</summary>
public class SyslogSender
{
    public static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(10);

    public static string Version { get; } =
        typeof(SyslogSender).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0]
        ?? typeof(SyslogSender).Assembly.GetName().Version?.ToString(3) ?? "1.0";

    public async Task SendAsync(SyslogSettings s, IReadOnlyList<SiemEvent> events, CancellationToken ct)
    {
        if (events.Count == 0) return;
        var host = Environment.MachineName;
        var pid = Environment.ProcessId;
        var messages = events.Select(e => SyslogFormatter.Format(e, s.Format, Version, host, pid)).ToList();
        try
        {
            if (s.Protocol == SyslogProtocol.Udp)
            {
                using var udp = new UdpClient();
                udp.Connect(s.Host, s.Port);
                foreach (var m in messages) await udp.SendAsync(SyslogFormatter.Datagram(m), ct);
                return;
            }

            using var tcp = new TcpClient { NoDelay = true };
            using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct))
            {
                timeout.CancelAfter(ConnectTimeout);
                try { await tcp.ConnectAsync(s.Host, s.Port, timeout.Token); }
                catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                {
                    throw new InvalidOperationException($"Keine Verbindung zu {s.Host}:{s.Port} innerhalb von {ConnectTimeout.TotalSeconds:0} Sekunden.");
                }
            }
            Stream stream = tcp.GetStream();
            if (s.Protocol == SyslogProtocol.Tls)
            {
                var ssl = new SslStream(stream, leaveInnerStreamOpen: false);
                await ssl.AuthenticateAsClientAsync(new SslClientAuthenticationOptions
                {
                    TargetHost = s.Host,
                    // Switching validation off is only meant for test receivers with self-signed certificates.
                    RemoteCertificateValidationCallback = s.ValidateCertificate ? null : (_, _, _, _) => true,
                }, ct);
                stream = ssl;
            }
            await using (stream)
            {
                foreach (var m in messages) await stream.WriteAsync(SyslogFormatter.Frame(m), ct);
                await stream.FlushAsync(ct);
            }
        }
        catch (SocketException ex)
        {
            throw new InvalidOperationException($"Syslog {s.Protocol.ToString().ToUpperInvariant()} {s.Host}:{s.Port}: {ex.Message}", ex);
        }
        catch (System.Security.Authentication.AuthenticationException ex)
        {
            throw new InvalidOperationException($"TLS-Verbindung zu {s.Host}:{s.Port} fehlgeschlagen: {ex.GetBaseException().Message}", ex);
        }
    }
}

/// <summary>
/// Azure Monitor Logs Ingestion API. The OAuth token (client credentials, scope https://monitor.azure.com//.default) is cached
/// until shortly before it expires.
/// </summary>
public class LogAnalyticsSender(IHttpClientFactory httpFactory, TimeProvider clock)
{
    public const string HttpClientName = "siem";
    public const string ApiVersion = "2023-01-01";
    public const string Scope = "https://monitor.azure.com//.default";
    /// <summary>The API accepts at most 1 MB per call; stay well below.</summary>
    public const int MaxBatchBytes = 900_000;
    public static readonly TimeSpan RefreshMargin = TimeSpan.FromMinutes(5);

    public string AuthorityHost { get; init; } = "https://login.microsoftonline.com";

    private readonly ConcurrentDictionary<string, (string Token, DateTimeOffset ExpiresAt)> _tokens = new();

    /// <summary>Number of token requests (tests check the cache).</summary>
    public int TokenRequests;

    private static string CacheKey(LogAnalyticsSettings s, string secret) =>
        $"{s.TenantId}|{s.ClientId}|{Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(secret)))}";

    public async Task<string> GetTokenAsync(LogAnalyticsSettings s, string secret, CancellationToken ct, bool force = false)
    {
        var key = CacheKey(s, secret);
        if (!force && _tokens.TryGetValue(key, out var cached) && cached.ExpiresAt - RefreshMargin > clock.GetUtcNow()) return cached.Token;

        Interlocked.Increment(ref TokenRequests);
        using var client = httpFactory.CreateClient(HttpClientName);
        using var body = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "client_credentials",
            ["client_id"] = s.ClientId,
            ["client_secret"] = secret,
            ["scope"] = Scope,
        });
        using var response = await client.PostAsync($"{AuthorityHost.TrimEnd('/')}/{Uri.EscapeDataString(s.TenantId)}/oauth2/v2.0/token", body, ct);
        var text = await response.Content.ReadAsStringAsync(ct);
        JsonNode? json = null;
        try { json = JsonNode.Parse(text); } catch (JsonException) { /* reported below */ }
        if (!response.IsSuccessStatusCode || json?["access_token"]?.GetValue<string>() is not { Length: > 0 } token)
        {
            var error = json?["error_description"]?.GetValue<string>() ?? json?["error"]?.GetValue<string>() ?? Shorten(text);
            throw new InvalidOperationException($"Anmeldung bei Entra ID (Client-Credentials) fehlgeschlagen: HTTP {(int)response.StatusCode} – {FirstLine(error)}");
        }
        var seconds = json["expires_in"] switch
        {
            JsonValue v when v.TryGetValue<int>(out var i) => i,
            JsonValue v when v.TryGetValue<string>(out var str) && int.TryParse(str, out var i) => i,
            _ => 3600,
        };
        _tokens[key] = (token, clock.GetUtcNow().AddSeconds(seconds));
        return token;
    }

    public static JsonObject Record(SiemEvent e, string computer)
    {
        var fields = new JsonObject();
        foreach (var f in e.Fields) fields[f.Key] = f.Value;
        return new JsonObject
        {
            ["TimeGenerated"] = e.At.UtcDateTime.ToString("O"),
            ["EventId"] = e.EventId,
            ["EventName"] = e.Name,
            ["Severity"] = e.Severity,
            ["Category"] = e.Category,
            ["Message"] = e.Message,
            ["Computer"] = computer,
            ["Actor"] = e.Field(SiemFields.Actor),
            ["Account"] = e.Field(SiemFields.Account),
            ["AccountSid"] = e.Field(SiemFields.AccountSid),
            ["GroupName"] = e.Field(SiemFields.Group),
            ["Action"] = e.Field(SiemFields.Action),
            ["RunId"] = long.TryParse(e.Field(SiemFields.RunId), out var run) ? run : null,
            ["Url"] = e.Field(SiemFields.Url),
            ["Fields"] = fields,
        };
    }

    /// <summary>Records split into calls below <see cref="MaxBatchBytes"/>.</summary>
    public static List<string> Batches(IEnumerable<JsonObject> records)
    {
        var batches = new List<string>();
        var current = new List<string>();
        var size = 2;
        foreach (var r in records)
        {
            var json = r.ToJsonString();
            if (current.Count > 0 && size + json.Length + 1 > MaxBatchBytes)
            {
                batches.Add("[" + string.Join(',', current) + "]");
                current.Clear();
                size = 2;
            }
            current.Add(json);
            size += Encoding.UTF8.GetByteCount(json) + 1;
        }
        if (current.Count > 0) batches.Add("[" + string.Join(',', current) + "]");
        return batches;
    }

    public static string IngestionUrl(LogAnalyticsSettings s) =>
        $"{s.EndpointUrl.TrimEnd('/')}/dataCollectionRules/{Uri.EscapeDataString(s.DcrImmutableId)}/streams/{Uri.EscapeDataString(s.StreamName)}?api-version={ApiVersion}";

    public async Task SendAsync(LogAnalyticsSettings s, string secret, IReadOnlyList<SiemEvent> events, CancellationToken ct)
    {
        if (events.Count == 0) return;
        var computer = Environment.MachineName;
        foreach (var batch in Batches(events.Select(e => Record(e, computer))))
        {
            for (var attempt = 0; ; attempt++)
            {
                var token = await GetTokenAsync(s, secret, ct, force: attempt > 0);
                using var client = httpFactory.CreateClient(HttpClientName);
                using var request = new HttpRequestMessage(HttpMethod.Post, IngestionUrl(s))
                {
                    Content = new StringContent(batch, Encoding.UTF8, "application/json"),
                };
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                HttpResponseMessage response;
                try { response = await client.SendAsync(request, ct); }
                catch (HttpRequestException ex)
                {
                    throw new InvalidOperationException($"Logs Ingestion API nicht erreichbar: {ex.GetBaseException().Message}", ex);
                }
                using (response)
                {
                    // An expired or revoked token: fetch a new one once.
                    if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized && attempt == 0) continue;
                    if (!response.IsSuccessStatusCode)
                    {
                        var text = await response.Content.ReadAsStringAsync(ct);
                        throw new InvalidOperationException($"Logs Ingestion API: HTTP {(int)response.StatusCode} – {Shorten(text)}");
                    }
                    break;
                }
            }
        }
    }

    private static string Shorten(string text) => text.Length > 300 ? text[..300] + "…" : text;

    private static string FirstLine(string text) => text.Split('\n', 2)[0].Trim();
}

/// <summary>Sends events to a Syslog or Log Analytics channel.</summary>
public class SiemSender(SyslogSender syslog, LogAnalyticsSender logAnalytics, IDataProtectionProvider dataProtection)
{
    private readonly IDataProtector _secrets = dataProtection.CreateProtector("TierModel.Secrets.v1");

    public async Task SendAsync(NotificationChannel channel, IReadOnlyList<SiemEvent> events, CancellationToken ct)
    {
        var config = SiemChannelConfig.Read(channel, _secrets)
            ?? throw new InvalidOperationException("Die Kanal-Konfiguration ist unvollständig – bitte den Kanal bearbeiten und speichern.");
        switch (channel.Type)
        {
            case ChannelType.Syslog when config.Syslog is { } s:
                await syslog.SendAsync(s, events, ct);
                break;
            case ChannelType.LogAnalytics when config.LogAnalytics is { } l && !string.IsNullOrEmpty(config.ClientSecret):
                await logAnalytics.SendAsync(l, config.ClientSecret, events, ct);
                break;
            default:
                throw new InvalidOperationException("Die Kanal-Konfiguration ist unvollständig – bitte den Kanal bearbeiten und speichern.");
        }
    }
}
