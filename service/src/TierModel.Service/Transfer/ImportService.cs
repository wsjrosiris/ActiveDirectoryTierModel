using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TierModel.Service.Config;
using TierModel.Service.Data;

namespace TierModel.Service.Transfer;

/// <summary>One "suchen → ersetzen" rule applied to every text value of the incoming configuration (e.g. test DC name → production DC name).</summary>
public record ReplacementRule(string Search, string Replace);

public static class ImportStatus
{
    public const string Unchanged = "unchanged", Changed = "changed", New = "new", Invalid = "invalid", Unknown = "unknown";
}

/// <summary>Stored preview (WorkPath/imports/&lt;id&gt;.json). Contents are the incoming texts after replacements.</summary>
/// <param name="DomainId">Domain the preview was made for (roadmap 17); previews from before have none and belong to the first domain.</param>
public record StoredPreview(Guid Id, string Label, string SourceKind, string CreatedBy, DateTimeOffset CreatedAt,
    List<ReplacementRule> Replacements, List<string> Notices, List<StoredPreviewSection> Sections, ImportSource Source, int DomainId = 1);

public record StoredPreviewSection(string Key, string Status, int? BaseVersion, int? SourceVersion, string? Content, int Replacements, string? Error);

public record ImportIssueDto(string Severity, string Section, string Message, string? Item, bool IsNew);

public record ImportPreviewSectionDto(
    string Key, string Title, string FileName, string Status, int? BaseVersion, int? SourceVersion, int Replacements, string? Error,
    JsonNode? Current, JsonNode? Incoming);

public record ImportPreviewDto(Guid Id, string Label, string SourceKind, DateTimeOffset CreatedAt, List<ReplacementRule> Replacements,
    List<string> Notices, List<ImportPreviewSectionDto> Sections, List<ImportIssueDto> Issues);

public record ImportApplyRequest(List<string>? Keys, string? Comment);

public record ImportApplyResultDto(List<ImportAppliedSectionDto> Applied);

public record ImportAppliedSectionDto(string Key, string Title, int FromVersion, int ToVersion);

public class ImportPreviewNotFoundException(string message = "Die Vorschau ist abgelaufen oder existiert nicht. Bitte erneut laden.") : Exception(message);

public class ImportConflictException(string message, List<string> keys) : Exception(message)
{
    public List<string> Keys { get; } = keys;
}

/// <summary>Test → Produktion (roadmap 15): preview of an incoming configuration and its takeover as new versions.</summary>
/// <remarks>Previews and imports target the current domain (roadmap 17); a preview can only be used in the domain it was made for.</remarks>
public class ImportService(AppDbContext db, ConfigService config, IOptions<TierModelOptions> options, Domains.DomainContext domain, Domains.DomainRegistry domains)
{
    public static readonly TimeSpan PreviewLifetime = TimeSpan.FromHours(24);
    public const int MaxReplacements = 50;

    private string Dir => Path.Combine(options.Value.WorkPath, "imports");

    /// <summary>Applies the rules to every string value (not to property names). Returns the number of replaced occurrences.</summary>
    public static int ApplyReplacements(JsonNode? node, IReadOnlyList<ReplacementRule> rules)
    {
        if (node is null || rules.Count == 0) return 0;
        var count = 0;
        switch (node)
        {
            case JsonObject o:
                foreach (var key in o.Select(p => p.Key).ToList())
                {
                    if (o[key] is JsonValue v && v.TryGetValue<string>(out var s))
                    {
                        var (replaced, n) = Replace(s, rules);
                        if (n > 0) o[key] = replaced;
                        count += n;
                    }
                    else count += ApplyReplacements(o[key], rules);
                }
                break;
            case JsonArray a:
                for (var i = 0; i < a.Count; i++)
                {
                    if (a[i] is JsonValue v && v.TryGetValue<string>(out var s))
                    {
                        var (replaced, n) = Replace(s, rules);
                        if (n > 0) a[i] = replaced;
                        count += n;
                    }
                    else count += ApplyReplacements(a[i], rules);
                }
                break;
        }
        return count;
    }

    private static (string, int) Replace(string s, IReadOnlyList<ReplacementRule> rules)
    {
        var n = 0;
        foreach (var r in rules)
        {
            if (string.IsNullOrEmpty(r.Search)) continue;
            var idx = 0;
            while ((idx = s.IndexOf(r.Search, idx, StringComparison.Ordinal)) >= 0)
            {
                n++;
                idx += r.Search.Length;
            }
            if (n > 0) s = s.Replace(r.Search, r.Replace ?? "", StringComparison.Ordinal);
        }
        return (s, n);
    }

    /// <summary>Validates rules; returns a German error or null. Normalises (trims search, drops empty rows).</summary>
    public static (List<ReplacementRule> Rules, string? Error) NormalizeRules(IEnumerable<ReplacementRule>? rules)
    {
        var list = (rules ?? []).Where(r => !string.IsNullOrEmpty(r.Search)).Select(r => new ReplacementRule(r.Search, r.Replace ?? "")).ToList();
        if (list.Count > MaxReplacements) return (list, $"Höchstens {MaxReplacements} Ersetzungen.");
        if (list.Any(r => r.Search.Length > 500 || r.Replace.Length > 500)) return (list, "Suchen und Ersetzen: jeweils höchstens 500 Zeichen.");
        return (list, null);
    }

    /// <summary>Compares the incoming configuration with the current state and stores the result as a preview.</summary>
    public async Task<ImportPreviewDto> CreatePreviewAsync(ImportSource source, string sourceKind, List<ReplacementRule> rules, string user, CancellationToken ct = default)
    {
        Cleanup();
        var current = await CurrentAsync(ct);
        var sections = new List<StoredPreviewSection>();
        foreach (var def in ConfigCatalog.Sections)
        {
            var hasCurrent = current.TryGetValue(def.Key, out var cur);
            source.SourceVersions.TryGetValue(def.Key, out var sv);
            int? sourceVersion = sv > 0 ? sv : null;
            if (source.Invalid.TryGetValue(def.Key, out var error))
            {
                sections.Add(new(def.Key, ImportStatus.Invalid, hasCurrent ? cur.Version : null, sourceVersion, null, 0, error));
                continue;
            }
            if (!source.Sections.TryGetValue(def.Key, out var text)) continue;
            var node = JsonNode.Parse(text);
            var replaced = ApplyReplacements(node, rules);
            var normalized = ConfigService.Serialize(node);
            var status = !hasCurrent ? ImportStatus.New
                : ConfigService.Hash(normalized) == cur.Sha256 ? ImportStatus.Unchanged : ImportStatus.Changed;
            sections.Add(new(def.Key, status, hasCurrent ? cur.Version : null, sourceVersion, normalized, replaced, null));
        }
        foreach (var name in source.UnknownFiles)
            sections.Add(new(name, ImportStatus.Unknown, null, null, null, 0, "Unbekannt – wird ignoriert."));

        var notices = new List<string>(source.Notices);
        var missing = ConfigCatalog.Sections.Where(d => current.ContainsKey(d.Key) && sections.All(s => s.Key != d.Key)).Select(d => d.Title).ToList();
        if (missing.Count > 0) notices.Add($"Nicht in der Quelle enthalten (bleiben unverändert): {string.Join(", ", missing)}");
        if (rules.Count > 0 && sections.Sum(s => s.Replacements) == 0) notices.Add("Die Ersetzungen haben keinen Treffer.");

        var preview = new StoredPreview(Guid.NewGuid(), source.Label, sourceKind, user, DateTimeOffset.UtcNow, rules, notices, sections, source, domain.Id);
        Directory.CreateDirectory(Dir);
        await File.WriteAllTextAsync(PathOf(preview.Id), JsonSerializer.Serialize(preview, JsonSerializerOptions.Web), ct);
        return await ToDtoAsync(preview, null, ct);
    }

    /// <summary>Builds the preview again from the stored source with other replacement rules (no new upload or remote fetch).</summary>
    public async Task<ImportPreviewDto> RecomputeAsync(Guid id, List<ReplacementRule> rules, string user, CancellationToken ct = default)
    {
        var p = await LoadAsync(id, ct);
        var next = await CreatePreviewAsync(p.Source, p.SourceKind, rules, user, ct);
        TryDelete(PathOf(id));
        return next;
    }

    public async Task<ImportPreviewDto> GetPreviewAsync(Guid id, CancellationToken ct = default) =>
        await ToDtoAsync(await LoadAsync(id, ct), null, ct);

    /// <summary>Validation issues of the configuration as it would be after importing <paramref name="keys"/> (default: every changed / new section).</summary>
    public async Task<List<ImportIssueDto>> ValidateAsync(Guid id, IReadOnlyCollection<string>? keys, CancellationToken ct = default) =>
        Validate(await LoadAsync(id, ct), await CurrentAsync(ct), keys);

    private static List<ImportIssueDto> Validate(StoredPreview p, Dictionary<string, (int Version, string Sha256, string Content)> current, IReadOnlyCollection<string>? keys)
    {
        var selected = Importable(p).Where(s => keys is null || keys.Contains(s.Key, StringComparer.OrdinalIgnoreCase)).ToList();
        var before = current.ToDictionary(c => c.Key, c => JsonNode.Parse(c.Value.Content));
        var after = current.ToDictionary(c => c.Key, c => JsonNode.Parse(c.Value.Content));
        foreach (var s in selected) after[s.Key] = JsonNode.Parse(s.Content!);
        var existing = ConfigValidator.Validate(before).Select(Signature).ToHashSet();
        return ConfigValidator.Validate(after)
            .Select(i => new ImportIssueDto(i.Severity, i.Section, i.Message, i.Item, !existing.Contains(Signature(i))))
            .OrderBy(i => i.Severity == "Error" ? 0 : 1).ThenBy(i => i.IsNew ? 0 : 1)
            .ToList();
    }

    private static string Signature(ValidationIssue i) => $"{i.Severity}|{i.Section}|{i.Item}|{i.Message}";

    private static IEnumerable<StoredPreviewSection> Importable(StoredPreview p) =>
        p.Sections.Where(s => s.Status is ImportStatus.Changed or ImportStatus.New && s.Content is not null);

    /// <summary>
    /// Saves every selected section as a new version through the normal save path. All base versions are checked first,
    /// so a section changed since the preview aborts the whole import with <see cref="ImportConflictException"/> before anything is written.
    /// </summary>
    public async Task<ImportApplyResultDto> ApplyAsync(Guid id, ImportApplyRequest r, string user, CancellationToken ct = default)
    {
        var p = await LoadAsync(id, ct);
        var comment = r.Comment?.Trim();
        if (string.IsNullOrEmpty(comment)) throw new ArgumentException("Bitte einen Kommentar angeben.");
        var keys = (r.Keys ?? []).Select(k => ConfigCatalog.Find(k)?.Key ?? k).Distinct().ToList();
        if (keys.Count == 0) throw new ArgumentException("Bitte mindestens einen Bereich auswählen.");
        var importable = Importable(p).ToDictionary(s => s.Key);
        var notImportable = keys.Where(k => !importable.ContainsKey(k)).ToList();
        if (notImportable.Count > 0) throw new ArgumentException($"Nicht übernehmbar (unverändert, ungültig oder unbekannt): {string.Join(", ", notImportable)}");

        var current = await CurrentAsync(ct);
        var stale = keys.Where(k => (current.TryGetValue(k, out var c) ? c.Version : (int?)null) != importable[k].BaseVersion).ToList();
        if (stale.Count > 0)
            throw new ImportConflictException(
                $"Seit der Vorschau geändert: {string.Join(", ", stale.Select(k => ConfigCatalog.Find(k)!.Title))}. Bitte die Vorschau neu laden.", stale);

        var fullComment = $"Import aus {p.Label}: {comment}";
        var applied = new List<ImportAppliedSectionDto>();
        foreach (var def in ConfigCatalog.Sections.Where(d => keys.Contains(d.Key)))
        {
            var s = importable[def.Key];
            var content = JsonNode.Parse(s.Content!);
            try
            {
                var saved = s.BaseVersion is { } baseVersion
                    ? await config.SaveAsync(def.Key, content, fullComment, baseVersion, user, "config.import", ct)
                    : await config.CreateAsync(def.Key, content, fullComment, user, "config.import", ct);
                applied.Add(new(def.Key, def.Title, s.BaseVersion ?? 0, saved.Version));
            }
            catch (ConfigConflictException)
            {
                var done = applied.Count == 0 ? "" : $" Bereits übernommen: {string.Join(", ", applied.Select(a => a.Title))}.";
                throw new ImportConflictException($"„{def.Title}“ wurde gerade geändert.{done} Bitte die Vorschau neu laden.", [def.Key]);
            }
        }
        TryDelete(PathOf(id));
        return new ImportApplyResultDto(applied);
    }

    private async Task<ImportPreviewDto> ToDtoAsync(StoredPreview p, IReadOnlyCollection<string>? keys, CancellationToken ct)
    {
        var current = await CurrentAsync(ct);
        var sections = p.Sections.Select(s =>
        {
            var def = ConfigCatalog.Find(s.Key);
            var withContent = s.Status is ImportStatus.Changed or ImportStatus.New;
            return new ImportPreviewSectionDto(s.Key, def?.Title ?? s.Key, def?.FileName ?? s.Key, s.Status, s.BaseVersion, s.SourceVersion, s.Replacements, s.Error,
                withContent && current.TryGetValue(s.Key, out var c) ? JsonNode.Parse(c.Content) : null,
                withContent && s.Content is not null ? JsonNode.Parse(s.Content) : null);
        }).ToList();
        return new ImportPreviewDto(p.Id, p.Label, p.SourceKind, p.CreatedAt, p.Replacements, p.Notices, sections, Validate(p, current, keys));
    }

    private async Task<Dictionary<string, (int Version, string Sha256, string Content)>> CurrentAsync(CancellationToken ct)
    {
        var domainId = domain.Id;
        var rows = await (from s in db.ConfigSections
                          join v in db.ConfigVersions on new { s.DomainId, s.Key, V = s.CurrentVersion } equals new { v.DomainId, Key = v.SectionKey, V = v.Version }
                          where s.DomainId == domainId
                          select new { s.Key, v.Version, v.Sha256, v.Content }).AsNoTracking().ToListAsync(ct);
        return rows.ToDictionary(r => r.Key, r => (r.Version, r.Sha256, r.Content));
    }

    private async Task<StoredPreview> LoadAsync(Guid id, CancellationToken ct)
    {
        var path = PathOf(id);
        if (!File.Exists(path) || File.GetLastWriteTimeUtc(path) < DateTime.UtcNow - PreviewLifetime) throw new ImportPreviewNotFoundException();
        var preview = JsonSerializer.Deserialize<StoredPreview>(await File.ReadAllTextAsync(path, ct), JsonSerializerOptions.Web)
            ?? throw new ImportPreviewNotFoundException();
        if (preview.DomainId != domain.Id)
            throw new ImportPreviewNotFoundException(
                $"Die Vorschau wurde für die Domäne „{domains.Find(preview.DomainId)?.DisplayName ?? "?"}“ erstellt. Bitte dorthin wechseln oder die Vorschau neu laden.");
        return preview;
    }

    private string PathOf(Guid id) => Path.Combine(Dir, $"{id:N}.json");

    private void Cleanup()
    {
        if (!Directory.Exists(Dir)) return;
        foreach (var f in Directory.EnumerateFiles(Dir, "*.json"))
            if (File.GetLastWriteTimeUtc(f) < DateTime.UtcNow - PreviewLifetime) TryDelete(f);
    }

    private static void TryDelete(string path)
    {
        try { File.Delete(path); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
}
