using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using TierModel.Service.Data;

namespace TierModel.Service.AdView;

/// <summary>A snapshot with object type names resolved, and when it was read.</summary>
public record DirectoryState(AdSnapshot Snapshot, DateTimeOffset ReadAt);

/// <summary>Which directory a reader talks to (roadmap 17): the domain's DNS name and preferred DC; both empty = the computer's domain.</summary>
public record DirectoryTarget(string DnsName, string PreferredDc)
{
    public static DirectoryTarget Of(Domain d) => new(d.DnsName?.Trim() ?? "", d.PreferredDc?.Trim() ?? "");
}

/// <summary>Creates a reader for one domain.</summary>
public interface IDirectoryReaderFactory
{
    IDirectoryReader Create(DirectoryTarget target);
}

public sealed class DelegateDirectoryReaderFactory(Func<DirectoryTarget, IDirectoryReader> create) : IDirectoryReaderFactory
{
    public IDirectoryReader Create(DirectoryTarget target) => create(target);
}

/// <summary>Readers and 60-second snapshot caches per managed domain (roadmap 17).</summary>
public sealed class DirectoryService(IDirectoryReaderFactory factory, ILogger<DirectoryService> logger)
{
    private readonly ConcurrentDictionary<int, DomainDirectory> _byDomain = new();

    /// <summary>The directory of <paramref name="domain"/>; recreated when its DNS name or DC changed.</summary>
    public DomainDirectory For(Domain domain)
    {
        var target = DirectoryTarget.Of(domain);
        return _byDomain.AddOrUpdate(domain.Id,
            _ => new DomainDirectory(factory.Create(target), target, logger),
            (_, existing) => existing.Target == target ? existing : new DomainDirectory(factory.Create(target), target, logger));
    }

    /// <summary>A reader for settings that are not saved yet ("Verbindung prüfen" in the domain form); not cached.</summary>
    public IDirectoryReader Probe(DirectoryTarget target) => factory.Create(target);

    public static AdSnapshot Enrich(AdSnapshot s, GuidNames names) => DirectoryDefaults.Enrich(s, names);

    public static List<AdAce> Aces(IEnumerable<AdAce> aces, GuidNames names) => DirectoryDefaults.Aces(aces, names);
}

/// <summary>
/// Caches the directory snapshot of one domain for 60 seconds (the AD view is read by every viewer of the configuration page)
/// and resolves ACE object types through the guid mappings. Reads are serialised so a burst of requests
/// never starts several LDAP passes.
/// </summary>
public sealed class DomainDirectory(IDirectoryReader reader, DirectoryTarget target, ILogger logger)
{
    public static readonly TimeSpan CacheDuration = DirectoryDefaults.CacheDuration;
    public const int MaxOus = DirectoryDefaults.MaxOus;

    private readonly SemaphoreSlim _gate = new(1, 1);
    private DirectoryState? _cached;

    public DirectoryTarget Target => target;
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
            snapshot = DirectoryDefaults.Enrich(snapshot, Names(guidMappings, snapshot));
            logger.LogInformation("Read {Count} OUs from {Source} ({Domain}) in {Ms} ms", snapshot.Ous.Count, reader.Source, snapshot.Domain.DnsName,
                (DateTimeOffset.UtcNow - started).TotalMilliseconds);
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

    public static List<AdAce> Aces(IEnumerable<AdAce> aces, GuidNames names) => DirectoryDefaults.Aces(aces, names);
}

public static class DirectoryDefaults
{
    public static readonly TimeSpan CacheDuration = TimeSpan.FromSeconds(60);
    public const int MaxOus = 5000;

    public static AdSnapshot Enrich(AdSnapshot s, GuidNames names)
    {
        AdOu Ou(AdOu o) => o with { Aces = Aces(o.Aces, names) };
        return s with { Root = Ou(s.Root), Ous = s.Ous.Select(Ou).ToList() };
    }

    public static List<AdAce> Aces(IEnumerable<AdAce> aces, GuidNames names) =>
        aces.Select(a => a with { ObjectType = names.NameOf(a.ObjectTypeGuid), InheritedObjectType = names.NameOf(a.InheritedObjectTypeGuid) }).ToList();
}
