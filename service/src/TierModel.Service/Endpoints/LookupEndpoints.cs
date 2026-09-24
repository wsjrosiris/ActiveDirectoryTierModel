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

        g.MapGet("/domain-controllers", async (AppDbContext db, SettingsService settings) =>
        {
            var recent = await db.Runs.AsNoTracking().OrderByDescending(r => r.Id).Select(r => r.PreferredDc).Take(200).ToListAsync();
            var preferred = (await settings.GetAsync()).DefaultPreferredDc;
            var recentDistinct = new[] { preferred }.Concat(recent).Where(x => !string.IsNullOrWhiteSpace(x))
                .Distinct(StringComparer.OrdinalIgnoreCase).Take(10).ToList();
            return new DomainControllersDto(ActiveDirectoryLookup.Available, ActiveDirectoryLookup.DomainControllers(), recentDistinct);
        });

        g.MapGet("/ad-groups", (string? q) =>
            new AdGroupsDto(ActiveDirectoryLookup.Available, ActiveDirectoryLookup.SearchGroups(q ?? "", 25)));
    }

    private static TemplateFileDto Describe(string path)
    {
        var info = new FileInfo(path);
        using var stream = File.OpenRead(path);
        return new TemplateFileDto(info.Name, Convert.ToHexString(MD5.HashData(stream)), info.Length, info.LastWriteTimeUtc);
    }
}

/// <summary>Live directory lookups on a domain-joined Windows server; empty results elsewhere.</summary>
public static class ActiveDirectoryLookup
{
    public static bool Available => OperatingSystem.IsWindows() && Domain() is not null;


    [System.Runtime.Versioning.SupportedOSPlatform("windows")]
    private static System.DirectoryServices.ActiveDirectory.Domain? Domain()
    {
        try { return System.DirectoryServices.ActiveDirectory.Domain.GetComputerDomain(); }
        catch (Exception) { return null; }
    }

    public static List<LookupEndpoints.DomainControllerDto> DomainControllers() =>
        OperatingSystem.IsWindows() ? DomainControllersOnWindows() : [];

    public static List<LookupEndpoints.AdGroupDto> SearchGroups(string query, int max) =>
        OperatingSystem.IsWindows() ? SearchGroupsOnWindows(query, max) : [];

    [System.Runtime.Versioning.SupportedOSPlatform("windows")]
    private static List<LookupEndpoints.DomainControllerDto> DomainControllersOnWindows()
    {
        if (Domain() is not { } domain) return [];
        try
        {
            return domain.DomainControllers.Cast<System.DirectoryServices.ActiveDirectory.DomainController>()
                .Select(dc => new LookupEndpoints.DomainControllerDto(dc.Name, dc.SiteName))
                .OrderBy(dc => dc.Name, StringComparer.OrdinalIgnoreCase).ToList();
        }
        catch (Exception) { return []; }
    }

    [System.Runtime.Versioning.SupportedOSPlatform("windows")]
    private static List<LookupEndpoints.AdGroupDto> SearchGroupsOnWindows(string query, int max)
    {
        if (query.Trim().Length < 2 || Domain() is not { } domain) return [];
        try
        {
            // LDAP filter escaping (RFC 4515) for the user's search text.
            var q = string.Concat(query.Trim().Select(c => c switch
            {
                '\\' => "\\5c", '*' => "\\2a", '(' => "\\28", ')' => "\\29", '\0' => "\\00", _ => c.ToString(),
            }));
            using var root = domain.GetDirectoryEntry();
            using var searcher = new System.DirectoryServices.DirectorySearcher(root,
                $"(&(objectCategory=group)(|(cn={q}*)(sAMAccountName={q}*)(cn=*{q}*)))",
                ["cn", "sAMAccountName", "objectSid", "distinguishedName", "description"]) { SizeLimit = max };
            using var results = searcher.FindAll();
            return results.Cast<System.DirectoryServices.SearchResult>().Select(r =>
            {
                var sid = new System.Security.Principal.SecurityIdentifier((byte[])r.Properties["objectSid"][0], 0).Value;
                string? Prop(string name) => r.Properties[name] is { Count: > 0 } p ? p[0]?.ToString() : null;
                var sam = Prop("sAMAccountName") ?? Prop("cn") ?? sid;
                return new LookupEndpoints.AdGroupDto(Prop("cn") ?? sam, sam, sid, Prop("distinguishedName"), Prop("description"));
            }).OrderBy(g => g.Name, StringComparer.OrdinalIgnoreCase).ToList();
        }
        catch (Exception) { return []; }
    }
}
