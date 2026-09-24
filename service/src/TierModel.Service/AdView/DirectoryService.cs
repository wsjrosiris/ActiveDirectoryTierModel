using System.Text.Json.Nodes;

namespace TierModel.Service.AdView;

/// <summary>A snapshot with object type names resolved, and when it was read.</summary>
public record DirectoryState(AdSnapshot Snapshot, DateTimeOffset ReadAt);

/// <summary>
/// Caches the directory snapshot for 60 seconds (the AD view is read by every viewer of the configuration page)
/// and resolves ACE object types through the guid mappings. Reads are serialised so a burst of requests
/// never starts several LDAP passes.
/// </summary>
public sealed class DirectoryService(IDirectoryReader reader, ILogger<DirectoryService> logger)
{
    public static readonly TimeSpan CacheDuration = TimeSpan.FromSeconds(60);
    public const int MaxOus = 5000;

    private readonly SemaphoreSlim _gate = new(1, 1);
    private DirectoryState? _cached;

    public IDirectoryReader Reader => reader;
    public bool Available => reader.Available;
    public string Source => reader.Source;

    public async Task<DirectoryState> GetAsync(JsonNode? guidMappings, bool refresh, CancellationToken ct = default)
    {
        if (!refresh && _cached is { } hit && DateTimeOffset.UtcNow - hit.ReadAt < CacheDuration) return hit;
        await _gate.WaitAsync(ct);
        try
        {
            if (!refresh && _cached is { } again && DateTimeOffset.UtcNow - again.ReadAt < CacheDuration) return again;
            var started = DateTimeOffset.UtcNow;
            var snapshot = await Task.Run(() => reader.ReadSnapshot(MaxOus), ct);
            snapshot = Enrich(snapshot, Names(guidMappings, snapshot));
            logger.LogInformation("Read {Count} OUs from {Source} in {Ms} ms", snapshot.Ous.Count, reader.Source, (DateTimeOffset.UtcNow - started).TotalMilliseconds);
            return _cached = new DirectoryState(snapshot, DateTimeOffset.UtcNow);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Guid names from the mappings plus whatever the directory resolves for the rest.</summary>
    public GuidNames Names(JsonNode? guidMappings, AdSnapshot snapshot)
    {
        var names = GuidNames.From(guidMappings);
        var unknown = snapshot.Ous.Append(snapshot.Root).SelectMany(o => o.Aces)
            .SelectMany(a => new[] { a.ObjectTypeGuid, a.InheritedObjectTypeGuid })
            .OfType<string>().Where(g => Guid.TryParse(g, out var parsed) && names.NameOf(g) == parsed.ToString())
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (unknown.Count > 0) names.AddResolved(reader.ResolveGuids(unknown));
        return names;
    }

    public static AdSnapshot Enrich(AdSnapshot s, GuidNames names)
    {
        AdOu Ou(AdOu o) => o with { Aces = Aces(o.Aces, names) };
        return s with { Root = Ou(s.Root), Ous = s.Ous.Select(Ou).ToList() };
    }

    public static List<AdAce> Aces(IEnumerable<AdAce> aces, GuidNames names) =>
        aces.Select(a => a with { ObjectType = names.NameOf(a.ObjectTypeGuid), InheritedObjectType = names.NameOf(a.InheritedObjectTypeGuid) }).ToList();
}
