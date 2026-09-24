using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TierModel.Service.Data;

namespace TierModel.Service;

public record SettingsDto(string DefaultPreferredDc, string AdmlLanguage, int RunRetentionDays, string FrameworkPath, string PwshPath);

public record UpdateSettingsRequest(string DefaultPreferredDc, string AdmlLanguage, int RunRetentionDays);

/// <summary>Runtime-editable settings stored in the database, falling back to appsettings.json.</summary>
public class SettingsService(AppDbContext db, IOptions<TierModelOptions> options)
{
    private const string PreferredDcKey = "defaultPreferredDc";
    private const string AdmlLanguageKey = "admlLanguage";
    private const string RetentionKey = "runRetentionDays";

    public async Task<SettingsDto> GetAsync(CancellationToken ct = default)
    {
        var o = options.Value;
        var stored = await db.Settings.AsNoTracking().ToDictionaryAsync(s => s.Key, s => s.Value, ct);
        return new SettingsDto(
            stored.GetValueOrDefault(PreferredDcKey) ?? o.DefaultPreferredDc,
            stored.GetValueOrDefault(AdmlLanguageKey) ?? o.AdmlLanguage,
            int.TryParse(stored.GetValueOrDefault(RetentionKey), out var days) ? days : o.RunRetentionDays,
            o.FrameworkPath,
            o.PwshPath);
    }

    public async Task UpdateAsync(UpdateSettingsRequest r, CancellationToken ct = default)
    {
        await SetAsync(PreferredDcKey, r.DefaultPreferredDc.Trim(), ct);
        await SetAsync(AdmlLanguageKey, r.AdmlLanguage.Trim(), ct);
        await SetAsync(RetentionKey, r.RunRetentionDays.ToString(), ct);
    }

    private async Task SetAsync(string key, string value, CancellationToken ct)
    {
        var s = await db.Settings.FindAsync([key], ct);
        if (s is null) db.Settings.Add(new Setting { Key = key, Value = value });
        else s.Value = value;
    }
}
