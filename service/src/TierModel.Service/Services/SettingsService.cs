using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TierModel.Service.Data;

namespace TierModel.Service;

public record SettingsDto(
    string DefaultPreferredDc, string AdmlLanguage, int RunRetentionDays,
    bool RequireApproval, int ApprovalTimeoutHours, string PublicBaseUrl,
    string FrameworkPath, string PwshPath);

public record UpdateSettingsRequest(
    string DefaultPreferredDc, string AdmlLanguage, int RunRetentionDays,
    bool? RequireApproval, int? ApprovalTimeoutHours, string? PublicBaseUrl);

public record GroupRef(string Name, string Sid);

/// <summary>Stored form of the Windows sign-in configuration.</summary>
public record WindowsAuthConfig(bool Enabled, Dictionary<Role, List<GroupRef>> RoleGroups)
{
    public static WindowsAuthConfig Empty => new(false, Enum.GetValues<Role>().ToDictionary(r => r, _ => new List<GroupRef>()));
}

public record SmtpConfig(string Host, int Port, string Security, string Username, string From, string? PasswordProtected);

/// <summary>Runtime-editable settings stored in the database, falling back to appsettings.json.</summary>
public class SettingsService(AppDbContext db, IOptions<TierModelOptions> options, IDataProtectionProvider dataProtection)
{
    private const string PreferredDcKey = "defaultPreferredDc";
    private const string AdmlLanguageKey = "admlLanguage";
    private const string RetentionKey = "runRetentionDays";
    private const string RequireApprovalKey = "requireApproval";
    private const string ApprovalTimeoutKey = "approvalTimeoutHours";
    private const string PublicBaseUrlKey = "publicBaseUrl";
    private const string WindowsAuthKey = "windowsAuth";
    private const string SmtpKey = "smtp";

    /// <summary>Protects secrets stored in the database (SMTP password, webhook URLs).</summary>
    public IDataProtector Secrets { get; } = dataProtection.CreateProtector("TierModel.Secrets.v1");

    public async Task<SettingsDto> GetAsync(CancellationToken ct = default)
    {
        var o = options.Value;
        var stored = await db.Settings.AsNoTracking().ToDictionaryAsync(s => s.Key, s => s.Value, ct);
        return new SettingsDto(
            stored.GetValueOrDefault(PreferredDcKey) ?? o.DefaultPreferredDc,
            stored.GetValueOrDefault(AdmlLanguageKey) ?? o.AdmlLanguage,
            int.TryParse(stored.GetValueOrDefault(RetentionKey), out var days) ? days : o.RunRetentionDays,
            bool.TryParse(stored.GetValueOrDefault(RequireApprovalKey), out var approval) && approval,
            int.TryParse(stored.GetValueOrDefault(ApprovalTimeoutKey), out var hours) ? hours : 24,
            stored.GetValueOrDefault(PublicBaseUrlKey) ?? o.PublicBaseUrl,
            o.FrameworkPath,
            o.PwshPath);
    }

    public async Task UpdateAsync(UpdateSettingsRequest r, CancellationToken ct = default)
    {
        await SetAsync(PreferredDcKey, r.DefaultPreferredDc.Trim(), ct);
        await SetAsync(AdmlLanguageKey, r.AdmlLanguage.Trim(), ct);
        await SetAsync(RetentionKey, r.RunRetentionDays.ToString(), ct);
        if (r.RequireApproval is { } approval) await SetAsync(RequireApprovalKey, approval.ToString(), ct);
        if (r.ApprovalTimeoutHours is { } hours) await SetAsync(ApprovalTimeoutKey, hours.ToString(), ct);
        if (r.PublicBaseUrl is { } url) await SetAsync(PublicBaseUrlKey, url.Trim().TrimEnd('/'), ct);
    }

    public async Task<WindowsAuthConfig> GetWindowsAuthAsync(CancellationToken ct = default)
    {
        var json = (await db.Settings.AsNoTracking().FirstOrDefaultAsync(s => s.Key == WindowsAuthKey, ct))?.Value;
        var config = json is null ? null : JsonSerializer.Deserialize<WindowsAuthConfig>(json, JsonSerializerOptions.Web);
        if (config is null) return WindowsAuthConfig.Empty;
        foreach (var role in Enum.GetValues<Role>()) config.RoleGroups.TryAdd(role, []);
        return config;
    }

    public Task SetWindowsAuthAsync(WindowsAuthConfig config, CancellationToken ct = default) =>
        SetAsync(WindowsAuthKey, JsonSerializer.Serialize(config, JsonSerializerOptions.Web), ct);

    public async Task<SmtpConfig> GetSmtpAsync(CancellationToken ct = default)
    {
        var json = (await db.Settings.AsNoTracking().FirstOrDefaultAsync(s => s.Key == SmtpKey, ct))?.Value;
        return (json is null ? null : JsonSerializer.Deserialize<SmtpConfig>(json, JsonSerializerOptions.Web))
            ?? new SmtpConfig("", 25, "StartTls", "", "", null);
    }

    public Task SetSmtpAsync(SmtpConfig config, CancellationToken ct = default) =>
        SetAsync(SmtpKey, JsonSerializer.Serialize(config, JsonSerializerOptions.Web), ct);

    private async Task SetAsync(string key, string value, CancellationToken ct)
    {
        var s = await db.Settings.FindAsync([key], ct);
        if (s is null) db.Settings.Add(new Setting { Key = key, Value = value });
        else s.Value = value;
    }
}
