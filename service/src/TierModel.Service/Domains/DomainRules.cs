using System.Text.RegularExpressions;
using TierModel.Service.Data;
using TierModel.Service.Localization;

namespace TierModel.Service.Domains;

public static partial class DomainRules
{
    public const string Header = "X-TierModel-Domain";
    /// <summary>Only for browser navigations (downloads, report preview) where no header can be set.</summary>
    public const string QueryParameter = "domain";

    [GeneratedRegex(@"^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$")]
    private static partial Regex KeyPattern();

    [GeneratedRegex(@"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,62})(?:\.[A-Za-z0-9-]{1,63})*$")]
    private static partial Regex HostPattern();

    /// <summary>Keys that would collide with folders of the Git layout or look like API words.</summary>
    public static readonly string[] ReservedKeys = ["config", "api", "all", "alle", "default", "versions"];

    public static string? KeyError(string? key)
    {
        if (string.IsNullOrWhiteSpace(key)) return L.T("Bitte einen Kurznamen angeben.");
        if (!KeyPattern().IsMatch(key)) return L.T("Nur Kleinbuchstaben, Ziffern und Bindestriche (höchstens 32 Zeichen), z. B. contoso oder fabrikam-test.");
        if (ReservedKeys.Contains(key)) return L.F("„{0}“ ist reserviert.", key);
        return null;
    }

    public static bool IsHostName(string? value) => !string.IsNullOrWhiteSpace(value) && value.Length <= 253 && HostPattern().IsMatch(value);

    /// <summary>dc01.contoso.com → contoso.com; null when the name has no domain part.</summary>
    public static string? DnsFromDc(string? dc)
    {
        if (string.IsNullOrWhiteSpace(dc)) return null;
        var dot = dc.Trim().IndexOf('.');
        return dot > 0 && dot < dc.Trim().Length - 1 ? dc.Trim()[(dot + 1)..].ToLowerInvariant() : null;
    }

    /// <summary>contoso.com → DC=contoso,DC=com.</summary>
    public static string DistinguishedName(string dnsName) =>
        string.Join(",", dnsName.Trim().TrimEnd('.').Split('.', StringSplitOptions.RemoveEmptyEntries).Select(p => "DC=" + p));

    public static string Label(Domain d) =>
        string.IsNullOrWhiteSpace(d.DnsName) || string.Equals(d.DnsName, d.DisplayName, StringComparison.OrdinalIgnoreCase)
            ? d.DisplayName : $"{d.DisplayName} ({d.DnsName})";
}
