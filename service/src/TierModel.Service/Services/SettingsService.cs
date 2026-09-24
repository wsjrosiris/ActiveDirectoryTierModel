using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TierModel.Service.Data;

namespace TierModel.Service;

public record SettingsDto(
    string DefaultPreferredDc, string AdmlLanguage, int RunRetentionDays,
    bool RequireApproval, int ApprovalTimeoutHours, string PublicBaseUrl,
    bool RequirePlanBeforeApply, int PlanMaxAgeHours,
    string FrameworkPath, string PwshPath,
    int StaleDays = 90, int PasswordMaxAgeDays = 365);

public record UpdateSettingsRequest(
    string DefaultPreferredDc, string AdmlLanguage, int RunRetentionDays,
    bool? RequireApproval, int? ApprovalTimeoutHours, string? PublicBaseUrl,
    bool? RequirePlanBeforeApply = null, int? PlanMaxAgeHours = null,
    int? StaleDays = null, int? PasswordMaxAgeDays = null);

public record GroupRef(string Name, string Sid);

/// <summary>Stored form of the Windows sign-in configuration.</summary>
public record WindowsAuthConfig(bool Enabled, Dictionary<Role, List<GroupRef>> RoleGroups)
{
    public static WindowsAuthConfig Empty => new(false, Enum.GetValues<Role>().ToDictionary(r => r, _ => new List<GroupRef>()));
}

public record SmtpConfig(string Host, int Port, string Security, string Username, string From, string? PasswordProtected);

/// <summary>
/// Runtime-editable settings stored in the database, falling back to appsettings.json. The default DC and the ADML language
/// belong to the current domain (roadmap 17) and are stored with it; everything else is instance-wide.
/// </summary>
public class SettingsService(AppDbContext db, IOptions<TierModelOptions> options, IDataProtectionProvider dataProtection, Domains.DomainContext domain)
{
    private const string RetentionKey = "runRetentionDays";
    private const string RequireApprovalKey = "requireApproval";
    private const string ApprovalTimeoutKey = "approvalTimeoutHours";
    private const string PublicBaseUrlKey = "publicBaseUrl";
    private const string RequirePlanKey = "requirePlanBeforeApply";
    private const string PlanMaxAgeKey = "planMaxAgeHours";
    private const string StaleDaysKey = "hygieneStaleDays";
    private const string PasswordMaxAgeKey = "hygienePasswordMaxAgeDays";
    private const string WindowsAuthKey = "windowsAuth";
    private const string SmtpKey = "smtp";

    /// <summary>Protects secrets stored in the database (SMTP password, webhook URLs).</summary>
    public IDataProtector Secrets { get; } = dataProtection.CreateProtector("TierModel.Secrets.v1");

    public async Task<SettingsDto> GetAsync(CancellationToken ct = default)
    {
        var o = options.Value;
        var stored = await db.Settings.AsNoTracking().ToDictionaryAsync(s => s.Key, s => s.Value, ct);
        var d = domain.Current;
        return new SettingsDto(
            d.PreferredDc,
            string.IsNullOrWhiteSpace(d.AdmlLanguage) ? o.AdmlLanguage : d.AdmlLanguage,
            int.TryParse(stored.GetValueOrDefault(RetentionKey), out var days) ? days : o.RunRetentionDays,
            bool.TryParse(stored.GetValueOrDefault(RequireApprovalKey), out var approval) && approval,
            int.TryParse(stored.GetValueOrDefault(ApprovalTimeoutKey), out var hours) ? hours : 24,
            stored.GetValueOrDefault(PublicBaseUrlKey) ?? o.PublicBaseUrl,
            // Safe default: applying requires a reviewed plan unless an administrator switches it off.
            !bool.TryParse(stored.GetValueOrDefault(RequirePlanKey), out var requirePlan) || requirePlan,
            int.TryParse(stored.GetValueOrDefault(PlanMaxAgeKey), out var planHours) ? planHours : 24,
            o.FrameworkPath,
            o.PwshPath,
            int.TryParse(stored.GetValueOrDefault(StaleDaysKey), out var stale) ? stale : 90,
            int.TryParse(stored.GetValueOrDefault(PasswordMaxAgeKey), out var pwAge) ? pwAge : 365);
    }

    /// <summary>Stages the changes; the caller saves and reloads the domain registry.</summary>
    public async Task UpdateAsync(UpdateSettingsRequest r, CancellationToken ct = default)
    {
        if (await db.Domains.FindAsync([domain.Id], ct) is { } d)
        {
            d.PreferredDc = r.DefaultPreferredDc.Trim();
            d.AdmlLanguage = r.AdmlLanguage.Trim();
            if (string.IsNullOrWhiteSpace(d.DnsName) && Domains.DomainRules.DnsFromDc(d.PreferredDc) is { } dns) d.DnsName = dns;
        }
        await SetAsync(RetentionKey, r.RunRetentionDays.ToString(), ct);
        if (r.RequireApproval is { } approval) await SetAsync(RequireApprovalKey, approval.ToString(), ct);
        if (r.ApprovalTimeoutHours is { } hours) await SetAsync(ApprovalTimeoutKey, hours.ToString(), ct);
        if (r.PublicBaseUrl is { } url) await SetAsync(PublicBaseUrlKey, url.Trim().TrimEnd('/'), ct);
        if (r.RequirePlanBeforeApply is { } requirePlan) await SetAsync(RequirePlanKey, requirePlan.ToString(), ct);
        if (r.PlanMaxAgeHours is { } planHours) await SetAsync(PlanMaxAgeKey, planHours.ToString(), ct);
        if (r.StaleDays is { } stale) await SetAsync(StaleDaysKey, stale.ToString(), ct);
        if (r.PasswordMaxAgeDays is { } pwAge) await SetAsync(PasswordMaxAgeKey, pwAge.ToString(), ct);
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

    /// <summary>Raw value store for small service-internal state (e.g. when a warning was last sent).</summary>
    public async Task<string?> GetValueAsync(string key, CancellationToken ct = default) =>
        (await db.Settings.AsNoTracking().FirstOrDefaultAsync(s => s.Key == key, ct))?.Value;

    public async Task SetValueAsync(string key, string value, CancellationToken ct = default)
    {
        await SetAsync(key, value, ct);
        await db.SaveChangesAsync(ct);
    }

    private async Task SetAsync(string key, string value, CancellationToken ct)
    {
        var s = await db.Settings.FindAsync([key], ct);
        if (s is null) db.Settings.Add(new Setting { Key = key, Value = value });
        else s.Value = value;
    }
}
