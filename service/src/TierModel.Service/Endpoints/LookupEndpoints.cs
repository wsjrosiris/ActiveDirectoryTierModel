using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TierModel.Service.Auth;
using TierModel.Service.Data;

namespace TierModel.Service.Endpoints;

/// <summary>
/// Suggestions for the form editors, so nothing has to be typed from memory: GPO backups and
/// ADMX/ADML files shipped with the framework, domain controllers and AD groups.
/// </summary>
public static partial class LookupEndpoints
{
    public record GpoBackupDto(string Path, string DisplayName, string Folder, string BackupId, DateTimeOffset? BackupTime);
    public record TemplateFileDto(string Name, string Md5, long Size, DateTimeOffset Modified);
    public record TemplateFilesDto(List<TemplateFileDto> Admx, Dictionary<string, List<TemplateFileDto>> Adml, List<string> Languages);
    public record DomainControllerDto(string Name, string? Site);
    public record DomainControllersDto(bool Available, List<DomainControllerDto> Items, List<string> Recent);
    public record AdGroupDto(string Name, string SamAccountName, string Sid, string? DistinguishedName, string? Description);
    public record AdGroupsDto(bool Available, List<AdGroupDto> Items);

    [GeneratedRegex(@"<GPODisplayName><!\[CDATA\[(.*?)\]\]></GPODisplayName>", RegexOptions.Singleline)]
    private static partial Regex DisplayNameTag();

    [GeneratedRegex(@"<BackupTime><!\[CDATA\[(.*?)\]\]></BackupTime>", RegexOptions.Singleline)]
    private static partial Regex BackupTimeTag();

    [GeneratedRegex(@"^\{[0-9A-Fa-f-]{36}\}$")]
    private static partial Regex GuidFolder();

    [GeneratedRegex(@"^[a-zA-Z]{2}-[a-zA-Z]{2}$")]
    private static partial Regex LanguageFolder();

    public static void MapLookupEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/lookup").RequireAuthorization(nameof(Role.Viewer));

        // GPO backups below <framework>\config\gpo, as the framework expects them in "importPath".
        g.MapGet("/gpo-backups", (IOptions<TierModelOptions> o) =>
        {
            var root = Path.Combine(o.Value.FrameworkPath, "config", "gpo");
            if (!Directory.Exists(root)) return Results.Ok(Array.Empty<GpoBackupDto>());
            var items = new List<GpoBackupDto>();
            foreach (var dir in Directory.EnumerateDirectories(root, "*", SearchOption.AllDirectories))
            {
                var name = Path.GetFileName(dir);
                if (!GuidFolder().IsMatch(name)) continue;
                var info = Path.Combine(dir, "bkupInfo.xml");
                string? display = null;
                DateTimeOffset? time = null;
                if (File.Exists(info))
                {
                    var xml = File.ReadAllText(info).Replace("\0", "");
                    display = DisplayNameTag().Match(xml) is { Success: true } m ? m.Groups[1].Value : null;
                    if (BackupTimeTag().Match(xml) is { Success: true } t && DateTimeOffset.TryParse(t.Groups[1].Value, out var parsed)) time = parsed;
                }
                var relative = Path.GetRelativePath(o.Value.FrameworkPath, dir).Replace('/', '\\');
                var folder = Path.GetRelativePath(root, Path.GetDirectoryName(dir)!).Replace('\\', '/');
                items.Add(new GpoBackupDto(relative, display ?? Path.GetFileName(Path.GetDirectoryName(dir)!), folder, name, time));
            }
            return Results.Ok(items.OrderBy(i => i.Folder).ThenBy(i => i.DisplayName));
        });

        // ADMX files (config\admx) and ADML files per language (config\admx\<xx-XX>) with MD5 as used by the framework.
        g.MapGet("/template-files", (IOptions<TierModelOptions> o) =>
        {
            var root = Path.Combine(o.Value.FrameworkPath, "config", "admx");
            var result = new TemplateFilesDto([], [], []);
            if (!Directory.Exists(root)) return Results.Ok(result);
            result.Admx.AddRange(Directory.EnumerateFiles(root, "*.admx").Select(Describe).OrderBy(f => f.Name, StringComparer.OrdinalIgnoreCase));
            foreach (var langDir in Directory.EnumerateDirectories(root).Where(d => LanguageFolder().IsMatch(Path.GetFileName(d))))
            {
                var lang = Path.GetFileName(langDir);
                result.Languages.Add(lang);
                result.Adml[lang] = Directory.EnumerateFiles(langDir, "*.adml").Select(Describe).OrderBy(f => f.Name, StringComparer.OrdinalIgnoreCase).ToList();
            }
            result.Languages.Sort(StringComparer.OrdinalIgnoreCase);
            return Results.Ok(result);
        });

        // Domain controllers of the current domain (roadmap 17): live from its directory, plus the ones used recently.
        g.MapGet("/domain-controllers", async (AppDbContext db, Domains.DomainContext domain, AdView.DirectoryService directories, CancellationToken ct) =>
        {
            var domainId = domain.Id;
            var recent = await db.Runs.AsNoTracking().Where(r => r.DomainId == domainId).OrderByDescending(r => r.Id).Select(r => r.PreferredDc).Take(200).ToListAsync(ct);
            var recentDistinct = new[] { domain.Current.PreferredDc }.Concat(recent).Where(x => !string.IsNullOrWhiteSpace(x))
                .Distinct(StringComparer.OrdinalIgnoreCase).Take(10).ToList();
            var (available, items) = await DomainControllersAsync(directories.For(domain.Current).Reader, ct);
            return new DomainControllersDto(available, items, recentDistinct);
        });

        g.MapGet("/ad-groups", async (string? q, Domains.DomainContext domain, AdView.DirectoryService directories, CancellationToken ct) =>
        {
            var reader = directories.For(domain.Current).Reader;
            if (!reader.Available) return new AdGroupsDto(false, []);
            var items = await Task.Run(() => reader.SearchGroups(q ?? "", 25), ct);
            return new AdGroupsDto(true, items.Select(g => new AdGroupDto(g.Name, g.SamAccountName, g.Sid, g.DistinguishedName, g.Description)).ToList());
        });
    }

    /// <summary>DCs of a domain, or (false, []) when its directory cannot be read.</summary>
    public static async Task<(bool Available, List<DomainControllerDto> Items)> DomainControllersAsync(AdView.IDirectoryReader reader, CancellationToken ct)
    {
        if (!reader.Available) return (false, []);
        try
        {
            var info = await Task.Run(reader.DomainInfo, ct);
            return (true, info.DomainControllers.Select(dc => new DomainControllerDto(dc.Name, dc.Site)).OrderBy(dc => dc.Name, StringComparer.OrdinalIgnoreCase).ToList());
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return (false, []);
        }
    }

    private static TemplateFileDto Describe(string path)
    {
        var info = new FileInfo(path);
        using var stream = File.OpenRead(path);
        return new TemplateFileDto(info.Name, Convert.ToHexString(MD5.HashData(stream)), info.Length, info.LastWriteTimeUtc);
    }
}
