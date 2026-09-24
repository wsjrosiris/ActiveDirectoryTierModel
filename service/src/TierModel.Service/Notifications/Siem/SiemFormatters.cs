using System.Globalization;
using System.Text;

namespace TierModel.Service.Notifications.Siem;

/// <summary>ArcSight Common Event Format (CEF:0) as accepted by Microsoft Sentinel (CommonSecurityLog) and most SIEMs.</summary>
public static class CefFormatter
{
    public const string Vendor = "TierModel";
    public const string Product = "TierModelService";

    /// <summary>Neutral field → CEF extension key; custom string/number fields carry a label.</summary>
    private static readonly IReadOnlyDictionary<string, (string Key, string? Label)> Keys = new Dictionary<string, (string, string?)>
    {
        [SiemFields.Actor] = ("suser", null),
        [SiemFields.Account] = ("duser", null),
        [SiemFields.AccountSid] = ("duid", null),
        [SiemFields.Action] = ("act", null),
        [SiemFields.Url] = ("request", null),
        [SiemFields.Id] = ("externalId", null),
        [SiemFields.DomainController] = ("dhost", null),
        [SiemFields.Domain] = ("dntdom", null),
        [SiemFields.Group] = ("cs1", "Group"),
        [SiemFields.GroupSid] = ("cs2", "GroupSid"),
        [SiemFields.Rule] = ("cs3", "Rule"),
        [SiemFields.Object] = ("cs4", "Object"),
        [SiemFields.Rights] = ("cs5", "Rights"),
        [SiemFields.EntityType] = ("cs6", "EntityType"),
        [SiemFields.RunId] = ("cn1", "RunId"),
        [SiemFields.Count] = ("cn2", "Count"),
        [SiemFields.Tier] = ("cn3", "Tier"),
    };

    /// <summary>CEF key for a neutral field name; unknown fields become "tm" + PascalCase (Sentinel: AdditionalExtensions).</summary>
    public static string KeyFor(string field) => Keys.TryGetValue(field, out var k) ? k.Key : "tm" + char.ToUpperInvariant(field[0]) + field[1..];

    /// <summary>Header fields: backslash and pipe are escaped.</summary>
    public static string EscapeHeader(string value) =>
        Flatten(value).Replace("\\", "\\\\").Replace("|", "\\|");

    /// <summary>Extension values: backslash, equals sign and line breaks are escaped.</summary>
    public static string EscapeExtension(string value) =>
        value.Replace("\\", "\\\\").Replace("=", "\\=").Replace("\r\n", "\\n").Replace("\n", "\\n").Replace("\r", "\\r");

    private static string Flatten(string value) => value.Replace("\r\n", " ").Replace('\n', ' ').Replace('\r', ' ');

    public static string Format(SiemEvent e, string version, string? deviceHost = null)
    {
        var sb = new StringBuilder("CEF:0|");
        sb.Append(EscapeHeader(Vendor)).Append('|').Append(EscapeHeader(Product)).Append('|').Append(EscapeHeader(version)).Append('|')
          .Append(EscapeHeader(e.EventId)).Append('|').Append(EscapeHeader(e.Name)).Append('|')
          .Append(Math.Clamp(e.Severity, 0, 10).ToString(CultureInfo.InvariantCulture)).Append('|');

        var ext = new List<(string Key, string Value)>
        {
            ("rt", e.At.ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture)),
            ("cat", e.Category),
        };
        if (!string.IsNullOrEmpty(deviceHost)) ext.Add(("dvchost", deviceHost));
        foreach (var f in e.Fields)
        {
            if (Keys.TryGetValue(f.Key, out var k))
            {
                // Numeric custom fields must stay numeric.
                if (k.Key.StartsWith("cn", StringComparison.Ordinal) && !long.TryParse(f.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out _)) continue;
                ext.Add((k.Key, f.Value));
                if (k.Label is not null) ext.Add((k.Key + "Label", k.Label));
            }
            else ext.Add((KeyFor(f.Key), f.Value));
        }
        ext.Add(("msg", e.Message));
        sb.Append(string.Join(' ', ext.Select(x => $"{x.Key}={EscapeExtension(x.Value)}")));
        return sb.ToString();
    }
}

/// <summary>RFC 5424 syslog messages and RFC 6587/5425 octet-counting framing.</summary>
public static class SyslogFormatter
{
    /// <summary>Facility 13 = "log audit".</summary>
    public const int Facility = 13;
    public const string AppName = "TierModelService";
    /// <summary>
    /// SD-ID "name@PEN". 32473 is the enterprise number RFC 5612 reserves for documentation/examples; SIEM parsers match the
    /// name part. Replace it if your organization has its own PEN.
    /// </summary>
    public const string SdId = "tiermodel@32473";
    /// <summary>Largest UDP message sent; longer messages are cut (many receivers drop datagrams above 8 KB).</summary>
    public const int MaxUdpBytes = 8192;

    /// <summary>CEF 0–10 → syslog severity (2 critical … 6 informational).</summary>
    public static int SyslogSeverity(int cef) => cef switch
    {
        >= 9 => 2,
        >= 7 => 3,
        >= 4 => 4,
        >= 1 => 5,
        _ => 6,
    };

    public static int Priority(int cefSeverity) => Facility * 8 + SyslogSeverity(cefSeverity);

    /// <summary>PRINTUSASCII without spaces, at most <paramref name="max"/> characters; "-" when empty.</summary>
    public static string Token(string? value, int max)
    {
        var sb = new StringBuilder();
        foreach (var ch in value ?? "")
        {
            if (sb.Length >= max) break;
            if (ch is > (char)32 and < (char)127) sb.Append(ch);
        }
        return sb.Length == 0 ? "-" : sb.ToString();
    }

    /// <summary>SD-NAME: printable ASCII except '=', ' ', ']', '"'; max 32.</summary>
    public static string SdName(string value)
    {
        var sb = new StringBuilder();
        foreach (var ch in value)
            if (ch is > (char)32 and < (char)127 and not ('=' or ']' or '"') && sb.Length < 32) sb.Append(ch);
        return sb.ToString();
    }

    /// <summary>PARAM-VALUE: '"', '\' and ']' are escaped with a backslash.</summary>
    public static string EscapeParam(string value) => value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("]", "\\]");

    public static string StructuredData(SiemEvent e)
    {
        var sb = new StringBuilder("[").Append(SdId);
        void Param(string name, string value)
        {
            var n = SdName(name);
            if (n.Length > 0) sb.Append(' ').Append(n).Append("=\"").Append(EscapeParam(value)).Append('"');
        }
        Param("eventId", e.EventId);
        Param("name", e.Name);
        Param("severity", e.Severity.ToString(CultureInfo.InvariantCulture));
        Param("category", e.Category);
        foreach (var f in e.Fields) Param(f.Key, f.Value);
        return sb.Append(']').ToString();
    }

    /// <summary>
    /// One RFC 5424 message: &lt;PRI&gt;1 TIMESTAMP HOSTNAME APP-NAME PROCID MSGID SD MSG. With <see cref="SyslogFormat.Cef"/> the MSG
    /// is the CEF record and there is no structured data; otherwise the fields are structured data and MSG is the text (UTF-8 with BOM).
    /// </summary>
    public static string Format(SiemEvent e, SyslogFormat format, string version, string hostName, int processId)
    {
        var header = $"<{Priority(e.Severity)}>1 {e.At.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture)} " +
                     $"{Token(hostName, 255)} {AppName} {processId.ToString(CultureInfo.InvariantCulture)} {Token(e.EventId, 32)}";
        return format == SyslogFormat.Cef
            ? $"{header} - {CefFormatter.Format(e, version, hostName)}"
            : $"{header} {StructuredData(e)} \uFEFF{e.Message}";
    }

    /// <summary>Octet counting (RFC 6587 3.4.1 / RFC 5425): "LEN SP MSG", LEN = byte count of MSG.</summary>
    public static byte[] Frame(string message)
    {
        var body = Encoding.UTF8.GetBytes(message);
        var prefix = Encoding.ASCII.GetBytes(body.Length.ToString(CultureInfo.InvariantCulture) + " ");
        return [.. prefix, .. body];
    }

    /// <summary>UDP: the message as is, cut to <see cref="MaxUdpBytes"/> at a character boundary.</summary>
    public static byte[] Datagram(string message)
    {
        var bytes = Encoding.UTF8.GetBytes(message);
        if (bytes.Length <= MaxUdpBytes) return bytes;
        var cut = MaxUdpBytes;
        while (cut > 0 && (bytes[cut] & 0xC0) == 0x80) cut--; // do not split a UTF-8 sequence
        return bytes[..cut];
    }
}
