using System.Net;
using System.Net.Http.Json;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using TierModel.Service.Auth;
using TierModel.Service.Data;
using TierModel.Service.Monitoring;
using TierModel.Service.Notifications;
using TierModel.Service.Notifications.Siem;
using TierModel.Service.Reports;

namespace TierModel.Service.Tests;

internal static class Siem
{
    public static SiemEvent Event(params (string Key, string Value)[] fields) => new("TM-301", "Privileged member added", 8, "PrivilegedAccess",
        new DateTimeOffset(2026, 9, 1, 12, 30, 15, 123, TimeSpan.Zero), "t0-admin zu Domänen-Admins hinzugefügt",
        fields.Select(f => KeyValuePair.Create(f.Key, f.Value)).ToList());
}

public class CefFormatterTests
{
    [Fact]
    public void Header_escapes_pipe_and_backslash_and_flattens_line_breaks()
    {
        Assert.Equal(@"a\|b\\c d", CefFormatter.EscapeHeader("a|b\\c\nd"));
    }

    [Fact]
    public void Extension_escapes_equals_backslash_and_line_breaks_but_not_pipes()
    {
        Assert.Equal(@"k\=v \\ x|y\nz\r", CefFormatter.EscapeExtension("k=v \\ x|y\nz\r"));
        Assert.Equal(@"a\nb", CefFormatter.EscapeExtension("a\r\nb"));
    }

    [Fact]
    public void Formats_header_and_mapped_extension_fields()
    {
        var e = Siem.Event((SiemFields.Group, "Domänen-Admins"), (SiemFields.Account, "t0-admin"), (SiemFields.AccountSid, "S-1-5-21-1-2-3-1105"),
            (SiemFields.RunId, "42"), (SiemFields.Actor, "CONTOSO\\svc"), ("via", "A=B"));
        var cef = CefFormatter.Format(e with { Name = "Member|added" }, "1.4.0", "tm01");
        Assert.StartsWith(@"CEF:0|TierModel|TierModelService|1.4.0|TM-301|Member\|added|8|", cef);
        Assert.Contains("rt=1788265815123", cef);
        Assert.Contains("cat=PrivilegedAccess", cef);
        Assert.Contains("dvchost=tm01", cef);
        Assert.Contains("cs1=Domänen-Admins cs1Label=Group", cef);
        Assert.Contains("duser=t0-admin", cef);
        Assert.Contains("duid=S-1-5-21-1-2-3-1105", cef);
        Assert.Contains("cn1=42 cn1Label=RunId", cef);
        Assert.Contains(@"suser=CONTOSO\\svc", cef);
        Assert.Contains(@"tmVia=A\=B", cef);
        Assert.EndsWith("msg=t0-admin zu Domänen-Admins hinzugefügt", cef);
    }

    [Fact]
    public void Numeric_custom_fields_with_text_are_left_out()
    {
        var cef = CefFormatter.Format(Siem.Event((SiemFields.Count, "viele")), "1.0");
        Assert.DoesNotContain("cn2", cef);
    }

    [Fact]
    public void Severity_is_clamped_to_0_10()
    {
        Assert.Contains("|10|", CefFormatter.Format(Siem.Event() with { Severity = 99 }, "1.0"));
    }
}

public class SyslogFormatterTests
{
    [Theory]
    [InlineData(10, 106)] // 13*8 + 2 (critical)
    [InlineData(8, 107)]
    [InlineData(5, 108)]
    [InlineData(2, 109)]
    [InlineData(0, 110)]
    public void Priority_uses_facility_log_audit_and_mapped_severity(int cef, int pri) => Assert.Equal(pri, SyslogFormatter.Priority(cef));

    [Fact]
    public void Rfc5424_message_has_header_structured_data_and_bom_text()
    {
        var e = Siem.Event((SiemFields.Group, "Admins \"Tier 0\" [x]"), ("bad key=1", "v"));
        var m = SyslogFormatter.Format(e, SyslogFormat.Rfc5424, "1.4.0", "tm 01", 4711);
        Assert.StartsWith("<107>1 2026-09-01T12:30:15.123Z tm01 TierModelService 4711 TM-301 [tiermodel@32473 eventId=\"TM-301\"", m);
        Assert.Contains("group=\"Admins \\\"Tier 0\\\" [x\\]\"", m);
        Assert.Contains("badkey1=\"v\"", m);
        Assert.EndsWith("] ﻿t0-admin zu Domänen-Admins hinzugefügt", m);
    }

    [Fact]
    public void Cef_format_puts_the_cef_record_into_msg_without_structured_data()
    {
        var m = SyslogFormatter.Format(Siem.Event(), SyslogFormat.Cef, "1.4.0", "tm01", 1);
        Assert.Matches(@"^<107>1 \S+ tm01 TierModelService 1 TM-301 - CEF:0\|TierModel\|", m);
    }

    [Fact]
    public void Tcp_framing_counts_utf8_octets()
    {
        var frame = SyslogFormatter.Frame("äöü");
        Assert.Equal("6 äöü", Encoding.UTF8.GetString(frame));
    }

    [Fact]
    public void Udp_datagrams_are_cut_at_a_character_boundary()
    {
        var bytes = SyslogFormatter.Datagram(new string('a', SyslogFormatter.MaxUdpBytes - 1) + "ü" + "rest");
        Assert.True(bytes.Length <= SyslogFormatter.MaxUdpBytes);
        Assert.Equal(new string('a', SyslogFormatter.MaxUdpBytes - 1), Encoding.UTF8.GetString(bytes));
    }

    [Fact]
    public void Tokens_are_printable_ascii_and_limited()
    {
        Assert.Equal("-", SyslogFormatter.Token("  ", 10));
        Assert.Equal("abc", SyslogFormatter.Token("a b\tc", 10));
        Assert.Equal("ab", SyslogFormatter.Token("abcdef", 2));
    }
}

public class SyslogSenderTests
{
    [Fact]
    public async Task Sends_udp_datagrams()
    {
        using var listener = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0));
        var port = ((IPEndPoint)listener.Client.LocalEndPoint!).Port;
        var receive = listener.ReceiveAsync();
        await new SyslogSender().SendAsync(new SyslogSettings("127.0.0.1", port, SyslogProtocol.Udp, SyslogFormat.Cef), [Siem.Event()], CancellationToken.None);
        var result = await receive.WaitAsync(TimeSpan.FromSeconds(5));
        var text = Encoding.UTF8.GetString(result.Buffer);
        Assert.Contains("CEF:0|TierModel|TierModelService|", text);
        Assert.StartsWith("<107>1 ", text);
    }

    private static async Task<List<string>> ReadFramesAsync(Stream stream, int count)
    {
        var frames = new List<string>();
        var buffer = new List<byte>();
        var chunk = new byte[4096];
        while (frames.Count < count)
        {
            var n = await stream.ReadAsync(chunk);
            if (n == 0) break;
            buffer.AddRange(chunk[..n]);
            while (true)
            {
                var space = buffer.IndexOf((byte)' ');
                if (space < 0) break;
                var len = int.Parse(Encoding.ASCII.GetString(buffer.GetRange(0, space).ToArray()));
                if (buffer.Count < space + 1 + len) break;
                frames.Add(Encoding.UTF8.GetString(buffer.GetRange(space + 1, len).ToArray()));
                buffer.RemoveRange(0, space + 1 + len);
            }
        }
        return frames;
    }

    [Fact]
    public async Task Sends_octet_counted_frames_over_tcp()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        try
        {
            var port = ((IPEndPoint)listener.LocalEndpoint).Port;
            var accept = Task.Run(async () =>
            {
                using var client = await listener.AcceptTcpClientAsync();
                return await ReadFramesAsync(client.GetStream(), 2);
            });
            await new SyslogSender().SendAsync(new SyslogSettings("127.0.0.1", port, SyslogProtocol.Tcp, SyslogFormat.Rfc5424),
                [Siem.Event(), Siem.Event() with { Message = "zweite Zeile\nmit Umbruch" }], CancellationToken.None);
            var frames = await accept.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.Equal(2, frames.Count);
            Assert.Contains("[tiermodel@32473 ", frames[0]);
            Assert.EndsWith("zweite Zeile\nmit Umbruch", frames[1]);
        }
        finally { listener.Stop(); }
    }

    private static X509Certificate2 SelfSigned()
    {
        using var key = RSA.Create(2048);
        var request = new CertificateRequest("CN=localhost", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using var cert = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-5), DateTimeOffset.UtcNow.AddHours(1));
        return X509CertificateLoader.LoadPkcs12(cert.Export(X509ContentType.Pfx), null);
    }

    [Fact]
    public async Task Tls_with_validation_switched_off_accepts_a_self_signed_certificate()
    {
        using var cert = SelfSigned();
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        try
        {
            var port = ((IPEndPoint)listener.LocalEndpoint).Port;
            var accept = Task.Run(async () =>
            {
                using var client = await listener.AcceptTcpClientAsync();
                await using var ssl = new SslStream(client.GetStream());
                await ssl.AuthenticateAsServerAsync(cert);
                return await ReadFramesAsync(ssl, 1);
            });
            await new SyslogSender().SendAsync(new SyslogSettings("localhost", port, SyslogProtocol.Tls, SyslogFormat.Cef, ValidateCertificate: false),
                [Siem.Event()], CancellationToken.None);
            var frames = await accept.WaitAsync(TimeSpan.FromSeconds(10));
            Assert.Single(frames);
            Assert.Contains("CEF:0|", frames[0]);
        }
        finally { listener.Stop(); }
    }

    [Fact]
    public async Task Tls_with_validation_rejects_an_untrusted_certificate()
    {
        using var cert = SelfSigned();
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        try
        {
            var port = ((IPEndPoint)listener.LocalEndpoint).Port;
            _ = Task.Run(async () =>
            {
                try
                {
                    using var client = await listener.AcceptTcpClientAsync();
                    await using var ssl = new SslStream(client.GetStream());
                    await ssl.AuthenticateAsServerAsync(cert);
                }
                catch (Exception) { /* the client aborts the handshake */ }
            });
            var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => new SyslogSender().SendAsync(
                new SyslogSettings("localhost", port, SyslogProtocol.Tls, SyslogFormat.Cef, ValidateCertificate: true), [Siem.Event()], CancellationToken.None));
            Assert.Contains("TLS", ex.Message);
        }
        finally { listener.Stop(); }
    }

    [Fact]
    public async Task Connection_refused_is_reported_in_german_with_host_and_port()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => new SyslogSender().SendAsync(
            new SyslogSettings("127.0.0.1", port, SyslogProtocol.Tcp, SyslogFormat.Cef), [Siem.Event()], CancellationToken.None));
        Assert.Contains($"127.0.0.1:{port}", ex.Message);
    }
}

public class LogAnalyticsTests
{
    private sealed class FakeClock : TimeProvider
    {
        public DateTimeOffset Now = new(2026, 9, 1, 8, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private sealed class FakeHandler : HttpMessageHandler
    {
        public int TokenCalls;
        public readonly List<(HttpRequestMessage Request, string Body)> Posts = [];
        public int RejectNext;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
            if (request.RequestUri!.AbsolutePath.EndsWith("/oauth2/v2.0/token"))
            {
                TokenCalls++;
                Assert.Contains("grant_type=client_credentials", body);
                Assert.Contains("scope=https%3A%2F%2Fmonitor.azure.com%2F%2F.default", body);
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(new { access_token = $"token-{TokenCalls}", expires_in = 3600, token_type = "Bearer" }) };
            }
            Posts.Add((request, body));
            if (RejectNext > 0) { RejectNext--; return new HttpResponseMessage(HttpStatusCode.Unauthorized); }
            return new HttpResponseMessage(HttpStatusCode.NoContent);
        }
    }

    private sealed class Factory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private static readonly LogAnalyticsSettings Settings = new("11111111-2222-3333-4444-555555555555", "66666666-7777-8888-9999-000000000000",
        "https://tm-dce.westeurope-1.ingest.monitor.azure.com", "dcr-0123456789abcdef0123456789abcdef", "Custom-TierModel_CL");

    [Fact]
    public async Task Posts_records_to_the_dcr_stream_and_caches_the_token_until_shortly_before_expiry()
    {
        var handler = new FakeHandler();
        var clock = new FakeClock();
        var sender = new LogAnalyticsSender(new Factory(handler), clock);
        var e = Siem.Event((SiemFields.Group, "Domänen-Admins"), (SiemFields.RunId, "42"), (SiemFields.Account, "t0-admin"));

        await sender.SendAsync(Settings, "geheim", [e], CancellationToken.None);
        await sender.SendAsync(Settings, "geheim", [e, e], CancellationToken.None);
        Assert.Equal(1, handler.TokenCalls);
        Assert.Equal(2, handler.Posts.Count);

        var (request, body) = handler.Posts[0];
        Assert.Equal("https://tm-dce.westeurope-1.ingest.monitor.azure.com/dataCollectionRules/dcr-0123456789abcdef0123456789abcdef/streams/Custom-TierModel_CL?api-version=2023-01-01",
            request.RequestUri!.ToString());
        Assert.Equal("Bearer", request.Headers.Authorization!.Scheme);
        Assert.Equal("token-1", request.Headers.Authorization.Parameter);
        var records = JsonNode.Parse(body)!.AsArray();
        var r = Assert.Single(records)!;
        Assert.Equal("TM-301", r["EventId"]!.GetValue<string>());
        Assert.Equal(8, r["Severity"]!.GetValue<int>());
        Assert.Equal("Domänen-Admins", r["GroupName"]!.GetValue<string>());
        Assert.Equal(42, r["RunId"]!.GetValue<long>());
        Assert.Equal("t0-admin", r["Fields"]!["account"]!.GetValue<string>());
        Assert.Equal("2026-09-01T12:30:15.1230000Z", r["TimeGenerated"]!.GetValue<string>());
        Assert.Equal(2, JsonNode.Parse(handler.Posts[1].Body)!.AsArray().Count);

        clock.Now = clock.Now.AddMinutes(56); // within the 5-minute refresh margin
        await sender.SendAsync(Settings, "geheim", [e], CancellationToken.None);
        Assert.Equal(2, handler.TokenCalls);
        Assert.Equal("token-2", handler.Posts[^1].Request.Headers.Authorization!.Parameter);
    }

    [Fact]
    public async Task A_rejected_token_is_renewed_once()
    {
        var handler = new FakeHandler { RejectNext = 1 };
        var sender = new LogAnalyticsSender(new Factory(handler), new FakeClock());
        await sender.SendAsync(Settings, "geheim", [Siem.Event()], CancellationToken.None);
        Assert.Equal(2, handler.TokenCalls);
        Assert.Equal(2, handler.Posts.Count);
    }

    [Fact]
    public async Task Another_secret_gets_its_own_token()
    {
        var handler = new FakeHandler();
        var sender = new LogAnalyticsSender(new Factory(handler), new FakeClock());
        await sender.SendAsync(Settings, "eins", [Siem.Event()], CancellationToken.None);
        await sender.SendAsync(Settings, "zwei", [Siem.Event()], CancellationToken.None);
        Assert.Equal(2, handler.TokenCalls);
    }

    [Fact]
    public void Large_payloads_are_split_below_one_megabyte()
    {
        var big = new string('x', 100_000);
        var batches = LogAnalyticsSender.Batches(Enumerable.Range(0, 20).Select(_ => new JsonObject { ["Message"] = big }));
        Assert.True(batches.Count >= 3);
        Assert.All(batches, b => Assert.True(Encoding.UTF8.GetByteCount(b) < 1_000_000));
        Assert.Equal(20, batches.Sum(b => JsonNode.Parse(b)!.AsArray().Count));
    }
}

public class SiemEventTests
{
    private static PrivilegedEvaluation Eval(List<UnexpectedMember> unexpected, List<HygieneFinding> hygiene, List<AttackPath> paths, List<MembershipChange>? changes = null) =>
        new(false, changes ?? [], unexpected, hygiene, paths, [], HygieneThresholds.Default);

    private static UnexpectedMember U(string member) => new("S-1-5-21-1-512", "Domänen-Admins", member, member, member, "user", true, [], true);
    private static HygieneFinding H(string sid, string severity) => new("HasSpn", "SPN gesetzt", severity, sid, sid, null, "user", 0, "1 SPN");
    private static AttackPath P(string principal) => new("DC=contoso,DC=local", "DomainRoot", "contoso.local", principal, principal, "group", ["WriteDacl"], 3, [], false, "High", "x hat WriteDacl", null);

    [Fact]
    public void Monitor_events_contain_only_new_findings_and_every_change()
    {
        var previous = Eval([U("S-old")], [H("S-h1", "High")], [P("S-p1")]);
        var current = Eval([U("S-old"), U("S-new")], [H("S-h1", "High"), H("S-h2", "High"), H("S-h3", "Medium")], [P("S-p1"), P("S-p2")],
            [new MembershipChange("Added", "S-1-5-21-1-512", "Domänen-Admins", "S-new", "new", "New", "user", true, []),
             new MembershipChange("Removed", "S-1-5-21-1-512", "Domänen-Admins", "S-gone", "gone", "Gone", "user", true, [])]);
        var run = new Run { Id = 7, Kind = RunKind.Monitor, PreferredDc = "dc01", AdmlLanguage = "en-US", RequestedBy = "admin", FinishedAt = DateTimeOffset.UtcNow };
        var events = SiemEvents.ForMonitor(run, current, previous, "https://tm.contoso.com");
        Assert.Equal(["TM-301", "TM-302", "TM-310", "TM-320", "TM-330"], events.Select(e => e.EventId));
        Assert.Equal("S-new", events[2].Field(SiemFields.AccountSid));
        Assert.Equal("S-h2", events[3].Field(SiemFields.AccountSid));
        Assert.Equal("S-p2", events[4].Field(SiemFields.AccountSid));
        Assert.All(events, e => Assert.Equal("7", e.Field(SiemFields.RunId)));
        Assert.Equal("https://tm.contoso.com/privilegiert", events[0].Field(SiemFields.Url));
    }

    [Fact]
    public void Change_log_entries_map_actor_action_and_severity()
    {
        var e = SiemEvents.ForChange(new ChangeEntry { Id = 5, At = DateTimeOffset.UtcNow, Username = "bob", Action = "auth.locked", EntityType = "auth", Summary = "gesperrt" });
        Assert.Equal("TM-400", e.EventId);
        Assert.Equal(7, e.Severity);
        Assert.Equal("bob", e.Field(SiemFields.Actor));
        Assert.Equal("auth.locked", e.Field(SiemFields.Action));
        Assert.Equal("5", e.Field(SiemFields.Id));
    }

    [Fact]
    public void Forwarder_queue_is_bounded_and_counts_drops()
    {
        var forwarder = new SiemForwarder();
        var e = Siem.Event();
        for (var i = 0; i < SiemForwarder.Capacity; i++) Assert.True(forwarder.Enqueue(e));
        Assert.False(forwarder.Enqueue(e));
        Assert.False(forwarder.Enqueue(e));
        Assert.Equal(2, forwarder.QueueDrops);
        forwarder.CountFailed(3, 10);
        Assert.Equal(12, forwarder.Dropped(3, forwardsChangeLog: true));
        Assert.Equal(10, forwarder.Dropped(3, forwardsChangeLog: false));
        Assert.Equal(0, forwarder.Dropped(4, forwardsChangeLog: false));
    }

    [Fact]
    public void Channel_config_round_trips_and_describes_itself_without_secrets()
    {
        var protector = new EphemeralDataProtectionProvider().CreateProtector("TierModel.Secrets.v1");
        var config = new SiemChannelConfig(null, new LogAnalyticsSettings("t", "c", "https://dce.example.com", "dcr-x", "Custom-T_CL"), "geheim", true);
        var channel = new NotificationChannel { Name = "LA", Type = ChannelType.LogAnalytics, TargetProtected = protector.Protect(config.Serialize()), TargetDisplay = config.Display() };
        Assert.Equal(config, SiemChannelConfig.Read(channel, protector));
        Assert.Equal("dce.example.com · Custom-T_CL", config.Display());
        Assert.DoesNotContain("geheim", config.Display());
        Assert.Null(SiemChannelConfig.Read(new NotificationChannel { Name = "M", Type = ChannelType.Email, TargetProtected = "x", TargetDisplay = "x" }, protector));
    }
}

public class EntraAuthUnitTests
{
    private static EntraAuthConfig Config() => new(true, "11111111-2222-3333-4444-555555555555", "66666666-7777-8888-9999-000000000000", "x",
        new Dictionary<Role, List<EntraRoleEntry>>
        {
            [Role.Viewer] = [new(EntraRoleEntry.AppRole, "TierModel.Viewer")],
            [Role.Editor] = [],
            [Role.Operator] = [new(EntraRoleEntry.Group, "0a0a0a0a-0000-0000-0000-000000000001")],
            [Role.Admin] = [new(EntraRoleEntry.Group, "0a0a0a0a-0000-0000-0000-00000000000a"), new(EntraRoleEntry.AppRole, "TierModel.Admin")],
        });

    [Fact]
    public void Resolves_the_highest_role_from_groups_and_app_roles()
    {
        var c = Config();
        Assert.Equal(Role.Admin, EntraAuth.ResolveRole(c, ["0A0A0A0A-0000-0000-0000-00000000000A", "0a0a0a0a-0000-0000-0000-000000000001"], []));
        Assert.Equal(Role.Operator, EntraAuth.ResolveRole(c, ["0a0a0a0a-0000-0000-0000-000000000001"], ["TierModel.Viewer"]));
        Assert.Equal(Role.Admin, EntraAuth.ResolveRole(c, [], ["TierModel.Admin"]));
        Assert.Equal(Role.Viewer, EntraAuth.ResolveRole(c, [], ["TierModel.Viewer"]));
        // App role values are case-sensitive in Entra ID.
        Assert.Null(EntraAuth.ResolveRole(c, ["ffffffff-0000-0000-0000-000000000000"], ["tiermodel.viewer"]));
    }

    [Fact]
    public void Validates_mapping_entries()
    {
        Assert.Equal("0a0a0a0a-0000-0000-0000-00000000000a", EntraAuth.Normalize(new(EntraRoleEntry.Group, " 0A0A0A0A-0000-0000-0000-00000000000A ")).Entry!.Value);
        Assert.NotNull(EntraAuth.Normalize(new(EntraRoleEntry.Group, "Tier0-Admins")).Error);
        Assert.NotNull(EntraAuth.Normalize(new(EntraRoleEntry.AppRole, "mit Leerzeichen")).Error);
        Assert.NotNull(EntraAuth.Normalize(new("User", "x")).Error);
        Assert.Equal("Admins", EntraAuth.Normalize(new(EntraRoleEntry.AppRole, "TierModel.Admin", " Admins ")).Entry!.DisplayName);
    }

    [Fact]
    public void Options_come_from_the_settings_code_flow_with_pkce_and_tenant_issuer()
    {
        var protector = new EphemeralDataProtectionProvider().CreateProtector("TierModel.Secrets.v1");
        var c = Config() with { ClientSecretProtected = protector.Protect("s3cret") };
        var o = new OpenIdConnectOptions();
        EntraAuth.Apply(o, c, protector, requireHttps: true);
        Assert.Equal("https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0", o.Authority);
        Assert.Equal("66666666-7777-8888-9999-000000000000", o.ClientId);
        Assert.Equal("s3cret", o.ClientSecret);
        Assert.Equal("code", o.ResponseType);
        Assert.Equal("query", o.ResponseMode);
        Assert.True(o.UsePkce);
        Assert.Equal("/signin-oidc", o.CallbackPath.Value);
        Assert.Equal(o.Authority, o.TokenValidationParameters.ValidIssuer);
        Assert.True(o.TokenValidationParameters.ValidateIssuer);
        Assert.Equal(o.ClientId, o.TokenValidationParameters.ValidAudience);
        Assert.False(o.MapInboundClaims);
        Assert.True(o.RequireHttpsMetadata);
        Assert.Equal(Microsoft.AspNetCore.Http.SameSiteMode.Lax, o.CorrelationCookie.SameSite);
        Assert.Equal(Microsoft.AspNetCore.Http.CookieSecurePolicy.Always, o.NonceCookie.SecurePolicy);
        Assert.Equal(["openid", "profile", "email"], o.Scope);
    }

    [Fact]
    public void Unconfigured_options_still_validate_with_placeholders()
    {
        var o = new OpenIdConnectOptions();
        EntraAuth.Apply(o, EntraAuthConfig.Empty, new EphemeralDataProtectionProvider().CreateProtector("x"), requireHttps: false);
        Assert.Equal("00000000-0000-0000-0000-000000000000", o.ClientId);
        Assert.False(EntraAuthConfig.Empty.Usable);
        Assert.Equal(Microsoft.AspNetCore.Http.CookieSecurePolicy.SameAsRequest, o.CorrelationCookie.SecurePolicy);
    }

    private sealed class MetadataHandler(HttpStatusCode status, object body) : HttpMessageHandler
    {
        public Uri? Requested;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requested = request.RequestUri;
            return Task.FromResult(new HttpResponseMessage(status) { Content = JsonContent.Create(body) });
        }
    }

    [Fact]
    public async Task Metadata_check_fetches_the_tenant_document_and_compares_the_issuer()
    {
        const string tenant = "11111111-2222-3333-4444-555555555555";
        var ok = new MetadataHandler(HttpStatusCode.OK, new
        {
            issuer = $"https://login.microsoftonline.com/{tenant}/v2.0",
            authorization_endpoint = "https://login.microsoftonline.com/x/oauth2/v2.0/authorize",
            token_endpoint = "https://login.microsoftonline.com/x/oauth2/v2.0/token",
        });
        var result = await EntraAuth.CheckMetadataAsync(new HttpClient(ok), tenant, CancellationToken.None);
        Assert.True(result.Ok);
        Assert.Equal($"https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration", ok.Requested!.ToString());

        var wrong = new MetadataHandler(HttpStatusCode.OK, new { issuer = "https://evil.example/v2.0", authorization_endpoint = "a", token_endpoint = "t" });
        Assert.False((await EntraAuth.CheckMetadataAsync(new HttpClient(wrong), tenant, CancellationToken.None)).Ok);
        var missing = new MetadataHandler(HttpStatusCode.BadRequest, new { error = "invalid_tenant", error_description = "AADSTS90002: Tenant not found." });
        var notFound = await EntraAuth.CheckMetadataAsync(new HttpClient(missing), tenant, CancellationToken.None);
        Assert.False(notFound.Ok);
        Assert.Contains("AADSTS90002", notFound.Message);
        Assert.False((await EntraAuth.CheckMetadataAsync(new HttpClient(ok), "kein-guid", CancellationToken.None)).Ok);
    }
}

public class ReportUnitTests
{
    private static ReportDocument Doc(int rows) => new(ReportTypes.Changes, "Änderungen im Zeitraum", "Untertitel <b>", DateTimeOffset.UtcNow, "admin",
        DateTimeOffset.UtcNow.AddDays(-7), DateTimeOffset.UtcNow, "https://tm.contoso.com", "01.09.2026 – 07.09.2026",
        [new("Tier 0", 80, "20 Punkte Abzug"), new("Tier 1", null, "keine Daten")],
        [new("Läufe", "3", Tone.Info)],
        [new ReportSection("Läufe", "Einleitung", [
            new ReportStats([new("Audits", "1")]),
            new ReportKeyValues([new("Instanz", "tm01")]),
            new ReportParagraph("Hinweis <script>alert(1)</script>", Tone.Warning),
            new ReportSubheading("Domänen-Admins", "3 Mitglieder"),
            new ReportTable([new("Zeitpunkt", 1), new("Objekt", 3, Mono: true), new("Status", 1)],
                Enumerable.Range(0, rows).Select(i => new List<ReportCell> { $"Zeile {i}", new($"OU=Tier 0,OU=Admin,DC=contoso,DC=local #{i}", Sub: "OU"), new("Erfolgreich", Tone.Success, Badge: true) }).ToList()),
            new ReportTable([new("Leer", 1)], [], "Nichts da."),
        ])]);

    [Fact]
    public void Html_is_self_contained_escaped_and_german()
    {
        var html = HtmlReportRenderer.Render(Doc(3));
        Assert.StartsWith("<!doctype html><html lang=\"de\">", html);
        Assert.Contains("Änderungen im Zeitraum", html);
        Assert.Contains("&lt;script&gt;", html);
        Assert.DoesNotContain("<script", html);
        Assert.Contains("Seite \" counter(page)", html);
        Assert.Contains("Nichts da.", html);
        Assert.Contains("Compliance-Wert", html);
    }

    [Fact]
    public void Pdf_is_a_pdf_with_several_pages_for_long_tables()
    {
        var pdf = PdfReportRenderer.Render(Doc(200));
        Assert.Equal("%PDF", Encoding.ASCII.GetString(pdf, 0, 4));
        var text = Encoding.Latin1.GetString(pdf);
        var pages = System.Text.RegularExpressions.Regex.Matches(text, @"/Type\s*/Page[^s]").Count;
        Assert.True(pages >= 4, $"{pages} Seiten");
    }

    [Fact]
    public void Range_uses_local_calendar_days_and_defaults_to_30_days()
    {
        var now = new DateTimeOffset(2026, 9, 24, 10, 0, 0, TimeSpan.Zero);
        var (from, to) = ReportBuilder.Range(null, null, now);
        Assert.Equal(30, (int)Math.Round((to - from).TotalDays));
        var (f2, t2) = ReportBuilder.Range(new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 1), now);
        Assert.True(f2 < t2);
        Assert.Equal(new DateTime(2026, 9, 1), f2.DateTime);
        Assert.Equal(new DateTime(2026, 9, 11), t2.DateTime);
    }

    [Fact]
    public void Schedules_compute_the_next_delivery_and_period()
    {
        var weekly = new ReportSchedule(Guid.NewGuid(), "Woche", ReportTypes.Changes, ReportFrequency.Weekly, 1, "07:30", ["a@contoso.com"], true,
            new DateTimeOffset(2026, 9, 1, 0, 0, 0, TimeZoneInfo.Local.GetUtcOffset(new DateTime(2026, 9, 1))));
        var next = weekly.NextAfter(weekly.CreatedAt);
        Assert.Equal(DayOfWeek.Monday, next.LocalDateTime.DayOfWeek);
        Assert.Equal(new TimeSpan(7, 30, 0), next.LocalDateTime.TimeOfDay);
        Assert.True(next > weekly.CreatedAt);
        Assert.False(ReportSchedules.IsDue(weekly, next.AddMinutes(-1)));
        Assert.True(ReportSchedules.IsDue(weekly, next));
        Assert.False(ReportSchedules.IsDue(weekly with { Enabled = false }, next));
        Assert.True(ReportSchedules.IsDue(weekly with { LastSentAt = next }, next.AddDays(7)));
        Assert.False(ReportSchedules.IsDue(weekly with { LastSentAt = next }, next.AddDays(6)));
        var (from, to) = weekly.Period(next);
        Assert.Equal(6, to.DayNumber - from.DayNumber);

        var monthly = weekly with { Frequency = ReportFrequency.Monthly, Day = 3 };
        Assert.Equal(3, monthly.NextAfter(monthly.CreatedAt).LocalDateTime.Day);
    }

    [Fact]
    public void Schedule_input_is_validated()
    {
        Assert.Empty(ReportSchedules.Validate(new ReportScheduleInput(null, "Monat", ReportTypes.Privileged, ReportFrequency.Monthly, 28, "06:00", ["x@contoso.com"], true)));
        var errors = ReportSchedules.Validate(new ReportScheduleInput(null, "", "unbekannt", ReportFrequency.Weekly, 9, "25:00", ["kein-mail"], true));
        foreach (var key in new[] { "name", "type", "day", "time", "recipients" }) Assert.Contains(key, errors.Keys);
    }
}

[Collection("api")]
public class Phase4bApiTests(ApiFixture fixture)
{
    private static Task<HttpClient>? _admin;
    private Task<HttpClient> AdminAsync() => _admin ??= PlanApiTests.LoginAsync(fixture, ApiFixture.AdminUser, ApiFixture.AdminPassword);

    [DbFact]
    public async Task Syslog_channel_forwards_the_test_message_and_change_log_entries()
    {
        var admin = await AdminAsync();
        using var listener = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0));
        var port = ((IPEndPoint)listener.Client.LocalEndPoint!).Port;

        var bad = await admin.PostAsJsonAsync("/api/notifications/channels", new
        {
            name = "SIEM", type = "Syslog", enabled = true, events = new { drift = true, failure = true, apply = true, approval = true },
            syslog = new { host = "bad host!", port = 70000, protocol = "Udp", format = "Cef" },
        });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        var problem = await bad.Content.ReadFromJsonAsync<JsonObject>();
        Assert.NotNull(problem!["errors"]!["syslog.host"]);
        Assert.NotNull(problem["errors"]!["syslog.port"]);

        var created = await admin.PostAsJsonAsync("/api/notifications/channels", new
        {
            name = "SIEM UDP", type = "Syslog", enabled = true, events = new { drift = true, failure = true, apply = true, approval = true },
            syslog = new { host = "127.0.0.1", port, protocol = "Udp", format = "Rfc5424" }, forwardChangeLog = true,
        });
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        var channel = (await created.Content.ReadFromJsonAsync<JsonObject>())!;
        var id = channel["id"]!.GetValue<long>();
        Assert.Equal($"udp://127.0.0.1:{port} · RFC 5424", channel["target"]!.GetValue<string>());
        Assert.True(channel["forwardChangeLog"]!.GetValue<bool>());
        Assert.Equal(0, channel["droppedEvents"]!.GetValue<long>());

        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync($"/api/notifications/channels/{id}/test", null)).StatusCode);
        var received = new List<string>();
        using (var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10)))
        {
            while (!received.Any(m => m.Contains(" TM-100 ")) || !received.Any(m => m.Contains("notification.test")))
                received.Add(Encoding.UTF8.GetString((await listener.ReceiveAsync(cts.Token)).Buffer));
        }
        Assert.Contains(received, m => m.Contains("[tiermodel@32473 eventId=\"TM-400\"") && m.Contains("action=\"notification.test\""));

        // Switching the channel off keeps its settings (the UI sends no syslog block then).
        var off = await admin.PutAsJsonAsync($"/api/notifications/channels/{id}", new
        {
            name = "SIEM UDP", type = "Syslog", enabled = false, target = (string?)null, events = new { drift = true, failure = true, apply = true, approval = true },
        });
        Assert.Equal(HttpStatusCode.OK, off.StatusCode);
        var offDto = (await off.Content.ReadFromJsonAsync<JsonObject>())!;
        Assert.Equal(port, offDto["syslog"]!["port"]!.GetValue<int>());
        Assert.True(offDto["forwardChangeLog"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/notifications/channels/{id}")).StatusCode);
    }

    [DbFact]
    public async Task Log_analytics_channel_keeps_its_secret_write_only()
    {
        var admin = await AdminAsync();
        var body = new
        {
            name = "Sentinel", type = "LogAnalytics", enabled = false, events = new { drift = true, failure = true, apply = true, approval = true },
            logAnalytics = new
            {
                tenantId = "11111111-2222-3333-4444-555555555555", clientId = "66666666-7777-8888-9999-000000000000",
                endpointUrl = "https://tm-dce.westeurope-1.ingest.monitor.azure.com", dcrImmutableId = "dcr-0123456789abcdef0123456789abcdef",
                streamName = "Custom-TierModel_CL", clientSecret = "ganz-geheim",
            },
        };
        var created = await admin.PostAsJsonAsync("/api/notifications/channels", body);
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        var text = await created.Content.ReadAsStringAsync();
        Assert.DoesNotContain("ganz-geheim", text);
        var dto = JsonNode.Parse(text)!;
        Assert.True(dto["logAnalytics"]!["hasClientSecret"]!.GetValue<bool>());
        var id = dto["id"]!.GetValue<long>();

        // Without a secret the stored one is kept.
        var update = await admin.PutAsJsonAsync($"/api/notifications/channels/{id}", body with { logAnalytics = body.logAnalytics with { clientSecret = "" } });
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        Assert.True((await update.Content.ReadFromJsonAsync<JsonObject>())!["logAnalytics"]!["hasClientSecret"]!.GetValue<bool>());

        var list = await admin.GetStringAsync("/api/notifications/channels");
        Assert.DoesNotContain("ganz-geheim", list);
        await using (var scope = fixture.Factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var stored = await db.NotificationChannels.AsNoTracking().FirstAsync(c => c.Id == id);
            Assert.DoesNotContain("ganz-geheim", stored.TargetProtected);
        }
        var invalid = await admin.PostAsJsonAsync("/api/notifications/channels", body with { logAnalytics = body.logAnalytics with { dcrImmutableId = "abc", streamName = "Tabelle" } });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/notifications/channels/{id}")).StatusCode);
    }

    private static ClaimsPrincipal Token(string tid, string oid, string upn, IEnumerable<string>? groups = null, IEnumerable<string>? roles = null, bool overage = false)
    {
        var claims = new List<Claim> { new("tid", tid), new("oid", oid), new("preferred_username", upn), new("name", "Erika Muster") };
        claims.AddRange((groups ?? []).Select(g => new Claim("groups", g)));
        claims.AddRange((roles ?? []).Select(r => new Claim("roles", r)));
        if (overage) claims.Add(new Claim("_claim_names", "{\"groups\":\"src1\"}"));
        return new ClaimsPrincipal(new ClaimsIdentity(claims, "oidc"));
    }

    [DbFact]
    public async Task Entra_sign_in_provisions_updates_and_denies_accounts()
    {
        const string tenant = "11111111-2222-3333-4444-555555555555";
        var config = new EntraAuthConfig(true, tenant, "66666666-7777-8888-9999-000000000000", "x", new Dictionary<Role, List<EntraRoleEntry>>
        {
            [Role.Viewer] = [new(EntraRoleEntry.AppRole, "TierModel.Viewer")],
            [Role.Editor] = [], [Role.Operator] = [],
            [Role.Admin] = [new(EntraRoleEntry.Group, "0a0a0a0a-0000-0000-0000-00000000000a")],
        });
        var oid = Guid.NewGuid().ToString();
        var upn = $"erika-{oid[..6]}@contoso.com";
        await using var scope = fixture.Factory!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var log = scope.ServiceProvider.GetRequiredService<ChangeLogService>();

        var first = await EntraAuth.ProcessAsync(Token(tenant, oid, upn, roles: ["TierModel.Viewer"]), config, db, log);
        Assert.Equal(EntraSignInError.None, first.Error);
        Assert.Equal(AuthType.Entra, first.User!.AuthType);
        Assert.Equal(Role.Viewer, first.User.Role);
        Assert.Equal(upn, first.User.Username);
        Assert.Equal("Erika Muster", first.User.DisplayName);
        Assert.Equal($"entra:{tenant}:{oid}", first.User.Sid);
        var stamp = first.User.SecurityStamp;

        var second = await EntraAuth.ProcessAsync(Token(tenant, oid, upn, groups: ["0A0A0A0A-0000-0000-0000-00000000000A"]), config, db, log);
        Assert.Equal(first.User.Id, second.User!.Id);
        Assert.Equal(Role.Admin, second.User.Role);
        Assert.NotEqual(stamp, second.User.SecurityStamp);

        Assert.Equal(EntraSignInError.NoRole, (await EntraAuth.ProcessAsync(Token(tenant, Guid.NewGuid().ToString(), "nobody@contoso.com"), config, db, log)).Error);
        Assert.Equal("entra-overage", (await EntraAuth.ProcessAsync(Token(tenant, Guid.NewGuid().ToString(), "many@contoso.com", overage: true), config, db, log)).ErrorCode);
        Assert.Equal(EntraSignInError.WrongTenant, (await EntraAuth.ProcessAsync(Token(Guid.NewGuid().ToString(), oid, upn, roles: ["TierModel.Viewer"]), config, db, log)).Error);
        Assert.True(await db.ChangeLog.AnyAsync(e => e.Action == "auth.entra-denied" && e.Username == "nobody@contoso.com"));

        second.User.IsActive = false;
        await db.SaveChangesAsync();
        Assert.Equal(EntraSignInError.Inactive, (await EntraAuth.ProcessAsync(Token(tenant, oid, upn, roles: ["TierModel.Viewer"]), config, db, log)).Error);
    }

    [DbFact]
    public async Task Entra_settings_are_validated_saved_and_applied_to_the_handler()
    {
        var admin = await AdminAsync();
        var bad = await admin.PutAsJsonAsync("/api/settings/entra-auth", new
        {
            enabled = true, tenantId = "contoso", clientId = "", clientSecret = "",
            roleMappings = new Dictionary<string, object[]> { ["Admin"] = [new { kind = "Group", value = "Tier0-Admins" }] },
        });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        var errors = (await bad.Content.ReadFromJsonAsync<JsonObject>())!["errors"]!;
        Assert.NotNull(errors["tenantId"]);
        Assert.NotNull(errors["clientId"]);
        Assert.NotNull(errors["clientSecret"]);
        Assert.NotNull(errors["roleMappings.Admin"]);

        var clientId = Guid.NewGuid().ToString();
        var ok = await admin.PutAsJsonAsync("/api/settings/entra-auth", new
        {
            enabled = true, tenantId = "11111111-2222-3333-4444-555555555555", clientId, clientSecret = "s3cret",
            roleMappings = new Dictionary<string, object[]> { ["Admin"] = [new { kind = "Group", value = "0a0a0a0a-0000-0000-0000-00000000000a", displayName = "TM Admins" }] },
        });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var text = await ok.Content.ReadAsStringAsync();
        Assert.DoesNotContain("s3cret", text);
        Assert.True(JsonNode.Parse(text)!["hasClientSecret"]!.GetValue<bool>());

        var options = fixture.Factory!.Services.GetRequiredService<IOptionsMonitor<OpenIdConnectOptions>>().Get(EntraAuth.Scheme);
        Assert.Equal(clientId, options.ClientId);
        Assert.Equal("s3cret", options.ClientSecret);
        Assert.True((await admin.GetFromJsonAsync<JsonObject>("/api/auth/options"))!["entraAuth"]!.GetValue<bool>());

        // Switching off: the login page hides the button and the challenge refuses.
        var off = await admin.PutAsJsonAsync("/api/settings/entra-auth", new { enabled = false, tenantId = "11111111-2222-3333-4444-555555555555", clientId });
        Assert.Equal(HttpStatusCode.OK, off.StatusCode);
        Assert.True((await off.Content.ReadFromJsonAsync<JsonObject>())!["hasClientSecret"]!.GetValue<bool>());
        Assert.False((await admin.GetFromJsonAsync<JsonObject>("/api/auth/options"))!["entraAuth"]!.GetValue<bool>());
        var anonymous = fixture.Factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var challenge = await anonymous.GetAsync("/api/auth/entra?returnUrl=/audits");
        Assert.Equal(HttpStatusCode.Redirect, challenge.StatusCode);
        Assert.Equal("/login?error=entra-disabled", challenge.Headers.Location!.ToString());
    }

    [DbFact]
    public async Task Reports_render_as_pdf_and_html()
    {
        var admin = await AdminAsync();
        var types = await admin.GetFromJsonAsync<JsonArray>("/api/reports");
        Assert.Equal(["soll-ist", "aenderungen", "privilegiert"], types!.Select(t => t!["type"]!.GetValue<string>()));

        foreach (var type in new[] { "soll-ist", "aenderungen", "privilegiert" })
        {
            var pdf = await admin.GetAsync($"/api/reports/{type}?from=2026-01-01&to=2026-12-31&format=pdf");
            Assert.Equal(HttpStatusCode.OK, pdf.StatusCode);
            Assert.Equal("application/pdf", pdf.Content.Headers.ContentType!.MediaType);
            Assert.Equal("attachment", pdf.Content.Headers.ContentDisposition!.DispositionType);
            var bytes = await pdf.Content.ReadAsByteArrayAsync();
            Assert.Equal("%PDF", Encoding.ASCII.GetString(bytes, 0, 4));

            var html = await admin.GetAsync($"/api/reports/{type}?format=html");
            Assert.Equal(HttpStatusCode.OK, html.StatusCode);
            Assert.Equal("SAMEORIGIN", html.Headers.GetValues("X-Frame-Options").Single());
            Assert.Contains("frame-ancestors 'self'", html.Headers.GetValues("Content-Security-Policy").Single());
            var content = await html.Content.ReadAsStringAsync();
            Assert.Contains("Compliance-Wert", content);
            Assert.Contains("admin", content);
        }
        Assert.Contains("Änderungsprotokoll", await admin.GetStringAsync("/api/reports/aenderungen?format=html"));
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/reports/unbekannt")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync("/api/reports/aenderungen?from=01.09.2026")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await fixture.Factory!.CreateClient().GetAsync("/api/reports/soll-ist")).StatusCode);
    }

    [DbFact]
    public async Task Report_schedules_are_stored_in_the_settings()
    {
        var admin = await AdminAsync();
        var bad = await admin.PutAsJsonAsync("/api/reports/schedules", new[] { new { name = "", type = "x", frequency = "Weekly", day = 9, time = "7", recipients = new[] { "nope" }, enabled = true } });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        var ok = await admin.PutAsJsonAsync("/api/reports/schedules", new[]
        {
            new { name = "Wochenbericht", type = "aenderungen", frequency = "Weekly", day = 1, time = "07:00", recipients = new[] { "secops@contoso.com" }, enabled = true },
        });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var list = await admin.GetFromJsonAsync<JsonArray>("/api/reports/schedules");
        var s = Assert.Single(list!)!;
        Assert.Equal("Wochenbericht", s["name"]!.GetValue<string>());
        Assert.NotNull(s["nextRunAt"]);
        // Without SMTP the manual delivery reports the problem.
        var send = await admin.PostAsync($"/api/reports/schedules/{s["id"]!.GetValue<Guid>()}/send", null);
        Assert.Equal(HttpStatusCode.BadGateway, send.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/reports/schedules", Array.Empty<object>())).StatusCode);
    }
}
