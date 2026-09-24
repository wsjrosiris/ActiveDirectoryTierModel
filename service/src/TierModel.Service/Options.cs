namespace TierModel.Service;

/// <summary>Bound from the "TierModel" section of appsettings.json.</summary>
public class TierModelOptions
{
    /// <summary>Folder containing Deploy-TierModel.ps1, Audit-TierModel.ps1, modules\ and config\.</summary>
    public string FrameworkPath { get; set; } = "";

    /// <summary>Folder for per-run working copies and reports.</summary>
    public string WorkPath { get; set; } = "";

    /// <summary>PowerShell 7 executable.</summary>
    public string PwshPath { get; set; } = "pwsh";

    /// <summary>Runs exceeding this are killed and marked failed.</summary>
    public int RunTimeoutMinutes { get; set; } = 240;

    /// <summary>Defaults for settings that are not stored in the database yet.</summary>
    public string DefaultPreferredDc { get; set; } = "";
    public string AdmlLanguage { get; set; } = "en-US";
    public int RunRetentionDays { get; set; } = 90;

    /// <summary>Thumbprint of the HTTPS certificate in LocalMachine\My. Empty = Kestrel configuration decides.</summary>
    public string CertificateThumbprint { get; set; } = "";

    /// <summary>Set to false only for local development over plain HTTP.</summary>
    public bool RequireHttps { get; set; } = true;
}
