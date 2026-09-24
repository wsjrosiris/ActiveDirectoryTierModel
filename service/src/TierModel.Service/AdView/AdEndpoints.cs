using TierModel.Service.Config;
using TierModel.Service.Data;

namespace TierModel.Service.AdView;

/// <summary>Read-only live view of Active Directory (roadmap 14). Every role may read it.</summary>
public static class AdEndpoints
{
    public record AdTreeNode(string Dn, string Name, string ParentDn, int ChildCount, bool Protected, bool BlockInheritance, string? Description, List<string> Gpos);

    public record AdTreeDto(bool Available, string Source, string? Message, DateTimeOffset? ReadAt, AdDomainInfo? Domain, bool Truncated, List<AdTreeNode> Nodes);

    public record AdOuDetails(List<AdTreeNode> ChildOus, AdObjectCounts? Counts, List<AdGpoLink> GpoLinks, bool Protected, bool BlockInheritance);

    public record AdObjectDto(bool Available, string Source, string? Message, string Dn, string Kind, string Name, AdOuDetails? Ou, List<AdMember>? Members, List<AdAce> Aces);

    public record AdCompareDto(bool Available, string Source, string? Message, DateTimeOffset? ReadAt, AdDomainInfo? Domain, ComparisonResult? Result);

    public const int MaxMembers = 500;

    private static string UnavailableMessage(DomainDirectory d) =>
        d.Source == "Testdaten" ? "Testdaten sind nicht verfügbar." :
        OperatingSystem.IsWindows()
            ? "Der Server ist keiner Domäne beigetreten oder das Dienstkonto kann das Active Directory nicht lesen."
            : "Die Ist-Ansicht ist nur verfügbar, wenn der Dienst auf einem Windows-Server in der Domäne läuft.";

    public static void MapAdEndpoints(this IEndpointRouteBuilder app)
    {
        // The directory of the current domain (roadmap 17): its preferred DC or DNS name.
        var g = app.MapGroup("/api/ad").RequireAuthorization(nameof(Role.Viewer));

        g.MapGet("/tree", async (bool? refresh, DirectoryService directories, Domains.DomainContext domain, ConfigService config, CancellationToken ct) =>
        {
            var directory = directories.For(domain.Current);
            if (!directory.Available) return new AdTreeDto(false, directory.Source, UnavailableMessage(directory), null, null, false, []);
            try
            {
                var state = await directory.GetAsync((await config.GetAsync("guid-mappings", ct: ct))?.Content, refresh == true, ct);
                return new AdTreeDto(true, directory.Source, null, state.ReadAt, state.Snapshot.Domain, state.Snapshot.Truncated, Nodes(state.Snapshot));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                return new AdTreeDto(false, directory.Source, $"Active Directory konnte nicht gelesen werden: {ex.Message}", null, null, false, []);
            }
        });

        g.MapGet("/object", async (string? dn, DirectoryService directories, Domains.DomainContext domain, ConfigService config, CancellationToken ct) =>
        {
            var directory = directories.For(domain.Current);
            if (string.IsNullOrWhiteSpace(dn) || dn.Length > 2048 || dn.Contains('\0'))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["dn"] = ["Bitte einen gültigen Distinguished Name angeben."] });
            dn = dn.Trim();
            if (!directory.Available)
                return Results.Ok(new AdObjectDto(false, directory.Source, UnavailableMessage(directory), dn, "unknown", dn, null, null, []));
            try
            {
                var mappings = (await config.GetAsync("guid-mappings", ct: ct))?.Content;
                var state = await directory.GetAsync(mappings, false, ct);
                var domainDn = state.Snapshot.Domain.DistinguishedName;
                // Only objects of the domain partition; configuration and schema are out of scope.
                if (!DirectoryComparer.NormalizeDn(dn).EndsWith(DirectoryComparer.NormalizeDn(domainDn)))
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["dn"] = ["Das Objekt liegt nicht in der Domäne."] });
                return await Task.Run(() =>
                {
                    var reader = directory.Reader;
                    var key = DirectoryComparer.NormalizeDn(dn);
                    var nodes = Nodes(state.Snapshot);
                    var ou = DirectoryComparer.NormalizeDn(state.Snapshot.Root.Dn) == key ? state.Snapshot.Root
                        : state.Snapshot.Ous.FirstOrDefault(o => DirectoryComparer.NormalizeDn(o.Dn) == key);
                    if (ou is not null)
                    {
                        var children = nodes.Where(n => DirectoryComparer.NormalizeDn(n.ParentDn) == key).OrderBy(n => n.Name, StringComparer.OrdinalIgnoreCase).ToList();
                        AdObjectCounts? counts = null;
                        try { counts = reader.CountChildren(ou.Dn); } catch (Exception) { /* counts are optional */ }
                        return Results.Ok(new AdObjectDto(true, directory.Source, null, ou.Dn, "organizationalUnit", ou.Name,
                            new AdOuDetails(children, counts, ou.GpoLinks.OrderBy(l => l.Order).ToList(), ou.Protected, ou.BlockInheritance), null, ou.Aces));
                    }
                    var cls = reader.ObjectClass(dn);
                    if (cls is null) return Results.Problem(title: "Objekt nicht gefunden", detail: $"„{dn}“ existiert nicht im Active Directory.", statusCode: 404);
                    var names = directory.Names(mappings, state.Snapshot);
                    var aces = DirectoryService.Aces(reader.Aces(dn), names);
                    var name = dn.Split(',')[0];
                    name = name[(name.IndexOf('=') + 1)..];
                    var members = cls.Equals("group", StringComparison.OrdinalIgnoreCase) ? reader.GroupMembers(dn, MaxMembers) : null;
                    return Results.Ok(new AdObjectDto(true, directory.Source, null, dn, cls, name, null, members, aces));
                }, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                return Results.Ok(new AdObjectDto(false, directory.Source, $"Active Directory konnte nicht gelesen werden: {ex.Message}", dn, "unknown", dn, null, null, []));
            }
        });

        g.MapGet("/compare", async (bool? refresh, DirectoryService directories, Domains.DomainContext domain, ConfigService config, CancellationToken ct) =>
        {
            var directory = directories.For(domain.Current);
            if (!directory.Available) return new AdCompareDto(false, directory.Source, UnavailableMessage(directory), null, null, null);
            try
            {
                var content = await config.CurrentContentAsync(ct);
                var state = await directory.GetAsync(content.GetValueOrDefault("guid-mappings"), refresh == true, ct);
                var names = directory.Names(content.GetValueOrDefault("guid-mappings"), state.Snapshot);
                return new AdCompareDto(true, directory.Source, null, state.ReadAt, state.Snapshot.Domain, DirectoryComparer.Compare(content, state.Snapshot, names));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                return new AdCompareDto(false, directory.Source, $"Active Directory konnte nicht gelesen werden: {ex.Message}", null, null, null);
            }
        });
    }

    public static List<AdTreeNode> Nodes(AdSnapshot s)
    {
        var childCounts = s.Ous.GroupBy(o => DirectoryComparer.NormalizeDn(o.ParentDn)).ToDictionary(g => g.Key, g => g.Count());
        return s.Ous.Select(o => new AdTreeNode(o.Dn, o.Name, o.ParentDn, childCounts.GetValueOrDefault(DirectoryComparer.NormalizeDn(o.Dn)),
                o.Protected, o.BlockInheritance, o.Description, o.GpoLinks.OrderBy(l => l.Order).Select(l => l.Name).ToList()))
            .OrderBy(n => string.Join(",", n.Dn.Split(',').Reverse()), StringComparer.OrdinalIgnoreCase).ToList();
    }
}
