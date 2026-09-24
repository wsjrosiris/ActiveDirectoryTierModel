using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TierModel.Service.Data;

namespace TierModel.Service.Config;

public class ConfigConflictException(int currentVersion) : Exception($"Section was changed in the meantime (current version {currentVersion}).")
{
    public int CurrentVersion { get; } = currentVersion;
}

public record SectionSummaryDto(string Key, string FileName, string Title, string Description, int Version, int? ItemCount, DateTimeOffset UpdatedAt, string UpdatedBy);

public record SectionDto(string Key, string FileName, string Title, string Description, int Version, int? ItemCount, DateTimeOffset UpdatedAt, string UpdatedBy, JsonNode? Content);

public record VersionInfoDto(int Version, DateTimeOffset CreatedAt, string CreatedBy, string? Comment, string Sha256);

public class ConfigService(AppDbContext db, ChangeLogService changeLog, IOptions<TierModelOptions> options, ILogger<ConfigService> logger)
{
    private static readonly JsonSerializerOptions WriteOptions = new()
    {
        WriteIndented = true,
        // Keep umlauts and punctuation readable in the generated files.
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static string Serialize(JsonNode? node) => node?.ToJsonString(WriteOptions) ?? "null";

    public static string Hash(string content) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(content)));

    public static int? CountItems(SectionDefinition def, JsonNode? content)
    {
        if (def.ItemsProperty is null || content is not JsonObject obj) return null;
        return obj[def.ItemsProperty] switch
        {
            JsonArray a => a.Count,
            JsonObject o => o.Count,
            _ => 0,
        };
    }

    /// <summary>Imports framework config files for every catalog section that is not in the database yet.</summary>
    public async Task SeedAsync(CancellationToken ct = default)
    {
        var existing = await db.ConfigSections.Select(s => s.Key).ToListAsync(ct);
        var configDir = Path.Combine(options.Value.FrameworkPath, "config");
        foreach (var def in ConfigCatalog.Sections.Where(d => !existing.Contains(d.Key)))
        {
            var file = Path.Combine(configDir, def.FileName);
            if (!File.Exists(file))
            {
                logger.LogWarning("Config file {File} not found, section {Key} starts empty", file, def.Key);
                continue;
            }
            var node = JsonNode.Parse(await File.ReadAllTextAsync(file, ct));
            var content = Serialize(node);
            var now = DateTimeOffset.UtcNow;
            db.ConfigSections.Add(new ConfigSection { Key = def.Key, FileName = def.FileName, CurrentVersion = 1, UpdatedAt = now, UpdatedBy = "system" });
            db.ConfigVersions.Add(new ConfigVersion
            {
                SectionKey = def.Key, Version = 1, Content = content, Sha256 = Hash(content),
                CreatedBy = "system", CreatedAt = now, Comment = $"Import aus {def.FileName}",
            });
            changeLog.Add("system", "config.import", "config", def.Key, $"{def.Title}: aus {def.FileName} importiert");
            logger.LogInformation("Imported config section {Key} from {File}", def.Key, file);
        }
        await db.SaveChangesAsync(ct);
    }

    public async Task<List<SectionSummaryDto>> ListAsync(CancellationToken ct = default)
    {
        var rows = await (from s in db.ConfigSections
                          join v in db.ConfigVersions on new { s.Key, V = s.CurrentVersion } equals new { Key = v.SectionKey, V = v.Version }
                          select new { s, v.Content }).ToListAsync(ct);
        var result = new List<SectionSummaryDto>();
        foreach (var def in ConfigCatalog.Sections)
        {
            var row = rows.FirstOrDefault(r => r.s.Key == def.Key);
            if (row is null) continue;
            var count = CountItems(def, JsonNode.Parse(row.Content));
            result.Add(new(def.Key, def.FileName, def.Title, def.Description, row.s.CurrentVersion, count, row.s.UpdatedAt, row.s.UpdatedBy));
        }
        return result;
    }

    /// <summary>Returns the section at <paramref name="version"/>, or the current version when null.</summary>
    public async Task<SectionDto?> GetAsync(string key, int? version = null, CancellationToken ct = default)
    {
        var def = ConfigCatalog.Find(key);
        if (def is null) return null;
        var section = await db.ConfigSections.AsNoTracking().FirstOrDefaultAsync(s => s.Key == def.Key, ct);
        if (section is null) return null;
        var v = await db.ConfigVersions.AsNoTracking()
            .FirstOrDefaultAsync(x => x.SectionKey == def.Key && x.Version == (version ?? section.CurrentVersion), ct);
        if (v is null) return null;
        var content = JsonNode.Parse(v.Content);
        return version is null
            ? new(def.Key, def.FileName, def.Title, def.Description, section.CurrentVersion, CountItems(def, content), section.UpdatedAt, section.UpdatedBy, content)
            : new(def.Key, def.FileName, def.Title, def.Description, v.Version, CountItems(def, content), v.CreatedAt, v.CreatedBy, content);
    }

    public Task<List<VersionInfoDto>> VersionsAsync(string key, CancellationToken ct = default) =>
        db.ConfigVersions.AsNoTracking()
            .Where(v => v.SectionKey == key)
            .OrderByDescending(v => v.Version)
            .Select(v => new VersionInfoDto(v.Version, v.CreatedAt, v.CreatedBy, v.Comment, v.Sha256))
            .ToListAsync(ct);

    /// <summary>Stores <paramref name="content"/> as a new version. Throws <see cref="ConfigConflictException"/> if <paramref name="baseVersion"/> is stale.</summary>
    public async Task<SectionDto> SaveAsync(string key, JsonNode? content, string? comment, int baseVersion, string user, string action = "config.update", CancellationToken ct = default)
    {
        var def = ConfigCatalog.Find(key) ?? throw new KeyNotFoundException(key);
        if (content is not JsonObject)
            throw new ArgumentException("Der Inhalt muss ein JSON-Objekt sein.");

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        // Row lock serialises concurrent saves of the same section.
        var section = await db.ConfigSections
            .FromSqlInterpolated($"SELECT * FROM config_sections WHERE \"Key\" = {def.Key} FOR UPDATE")
            .FirstOrDefaultAsync(ct) ?? throw new KeyNotFoundException(key);
        if (section.CurrentVersion != baseVersion)
            throw new ConfigConflictException(section.CurrentVersion);

        var text = Serialize(content);
        var hash = Hash(text);
        var current = await db.ConfigVersions.AsNoTracking()
            .FirstAsync(v => v.SectionKey == def.Key && v.Version == section.CurrentVersion, ct);
        if (current.Sha256 == hash)
        {
            await tx.RollbackAsync(ct);
            return (await GetAsync(def.Key, ct: ct))!;
        }

        var now = DateTimeOffset.UtcNow;
        var newVersion = section.CurrentVersion + 1;
        db.ConfigVersions.Add(new ConfigVersion
        {
            SectionKey = def.Key, Version = newVersion, Content = text, Sha256 = hash,
            CreatedBy = user, CreatedAt = now, Comment = string.IsNullOrWhiteSpace(comment) ? null : comment.Trim(),
        });
        section.CurrentVersion = newVersion;
        section.UpdatedAt = now;
        section.UpdatedBy = user;
        changeLog.Add(user, action, "config", def.Key,
            $"{def.Title}: Version {baseVersion} → {newVersion}" + (string.IsNullOrWhiteSpace(comment) ? "" : $" ({comment.Trim()})"),
            new { section = def.Key, fromVersion = baseVersion, toVersion = newVersion, comment });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return (await GetAsync(def.Key, ct: ct))!;
    }

    /// <summary>Current content and version of every section, used to materialise a run's working copy.</summary>
    public async Task<List<(SectionDefinition Def, int Version, string Content)>> SnapshotAsync(CancellationToken ct = default)
    {
        var rows = await (from s in db.ConfigSections
                          join v in db.ConfigVersions on new { s.Key, V = s.CurrentVersion } equals new { Key = v.SectionKey, V = v.Version }
                          select new { s.Key, v.Version, v.Content }).AsNoTracking().ToListAsync(ct);
        return rows
            .Select(r => (Def: ConfigCatalog.Find(r.Key), r.Version, r.Content))
            .Where(r => r.Def is not null)
            .Select(r => (r.Def!, r.Version, r.Content))
            .ToList();
    }

    /// <summary>Current content of every section as parsed JSON, keyed by section key.</summary>
    public async Task<Dictionary<string, JsonNode?>> CurrentContentAsync(CancellationToken ct = default) =>
        (await SnapshotAsync(ct)).ToDictionary(s => s.Def.Key, s => JsonNode.Parse(s.Content));
}
