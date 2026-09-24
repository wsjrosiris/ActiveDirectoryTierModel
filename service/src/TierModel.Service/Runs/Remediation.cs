using TierModel.Service.Data;

namespace TierModel.Service.Runs;

/// <summary>Remediation by click (roadmap 5): the planning run that corrects one area of audit findings.</summary>
public static class Remediation
{
    public static readonly IReadOnlyList<string> Areas = ["ous", "groups", "users", "acls", "gpos", "admx", "msa", "gmsa", "dmsa", "winlaps", "authsilos"];

    /// <summary>
    /// Deploy parameters for an audit area. Areas of the core framework map to a scope switch; the extensions
    /// (MSA, gMSA, dMSA, Windows LAPS) run without scope and with their -Include* switch. Null for an unknown area.
    /// </summary>
    public static RunRequest? For(string? area, string preferredDc, string? admlLanguage)
    {
        RunRequest Scoped(DeployScope scope) => new(preferredDc, scope, false, false, false, false, admlLanguage);
        return area?.Trim().ToLowerInvariant() switch
        {
            "ous" => Scoped(DeployScope.OuOnly),
            "groups" => Scoped(DeployScope.GroupOnly),
            "users" => Scoped(DeployScope.UserOnly),
            "gpos" => Scoped(DeployScope.GposOnly),
            "acls" => Scoped(DeployScope.OuAclsOnly),
            "admx" => Scoped(DeployScope.AdmxOnly),
            "authsilos" => Scoped(DeployScope.AuthSilosOnly),
            "msa" => new RunRequest(preferredDc, null, true, false, false, false, admlLanguage),
            "gmsa" => new RunRequest(preferredDc, null, false, true, false, false, admlLanguage),
            "dmsa" => new RunRequest(preferredDc, null, false, false, true, false, admlLanguage),
            "winlaps" => new RunRequest(preferredDc, null, false, false, false, true, admlLanguage),
            _ => null,
        };
    }

    public static string AreaLabel(string area) => area switch
    {
        "ous" => "OUs",
        "groups" => "Gruppen",
        "users" => "Benutzer",
        "acls" => "OU-ACLs",
        "gpos" => "GPOs",
        "admx" => "ADMX",
        "msa" => "MSA",
        "gmsa" => "gMSA",
        "dmsa" => "dMSA",
        "winlaps" => "Windows LAPS",
        "authsilos" => "Authentication Silos",
        _ => area,
    };
}
