using System.Text.Json.Nodes;

namespace TierModel.Service.AdView;

/// <summary>ActiveDirectoryRights as bit masks, so "GenericAll, CreateChild" and "GenericAll" compare equal.</summary>
public static class AdRights
{
    private static readonly (string Name, long Value)[] Table =
    [
        ("GenericAll", 983551), ("GenericWrite", 131112), ("GenericRead", 131220), ("GenericExecute", 131076),
        ("CreateChild", 1), ("DeleteChild", 2), ("ListChildren", 4), ("Self", 8), ("ReadProperty", 16), ("WriteProperty", 32),
        ("DeleteTree", 64), ("ListObject", 128), ("ExtendedRight", 256), ("Delete", 65536), ("ReadControl", 131072),
        ("WriteDacl", 262144), ("WriteOwner", 524288), ("Synchronize", 1048576), ("AccessSystemSecurity", 16777216),
    ];

    private static readonly Dictionary<string, long> ByName = Table.ToDictionary(t => t.Name, t => t.Value, StringComparer.OrdinalIgnoreCase);

    public const long DeleteRights = 65536 | 64 | 2;

    public static long Mask(IEnumerable<string> names)
    {
        long mask = 0;
        foreach (var n in names)
            foreach (var part in n.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                if (ByName.TryGetValue(part, out var v)) mask |= v;
        return mask;
    }

    /// <summary>Readable names for a mask: composite rights (GenericAll, GenericRead, …) first, then the remaining single bits.</summary>
    public static List<string> Names(long mask)
    {
        var result = new List<string>();
        var rest = mask;
        foreach (var (name, value) in Table)
        {
            // Composite rights may share bits (ReadControl); each is named when fully present and adds something new.
            if ((mask & value) != value || (rest & value) == 0) continue;
            result.Add(name);
            rest &= ~value;
        }
        return result;
    }
}

/// <summary>Schema GUID ↔ name from tiermodel-guid-mappings.json (static mappings, aliases).</summary>
public sealed class GuidNames
{
    private readonly Dictionary<string, string> _nameToGuid = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, string> _guidToName = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, string> _aliases = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> _allObjects = new(StringComparer.OrdinalIgnoreCase) { "", "AllObjectClasses" };

    public static GuidNames From(JsonNode? mappings)
    {
        var g = new GuidNames();
        foreach (var kind in new[] { "staticMappings", "dynamicMappings" })
            if (mappings?[kind] is JsonObject block)
                foreach (var (cat, map) in block)
                    if (cat != "comment" && map is JsonObject entries)
                        foreach (var (name, value) in entries)
                            if (name != "comment" && value is JsonValue v && v.TryGetValue<string>(out var guid) && Guid.TryParse(guid, out var parsed))
                            {
                                var key = parsed.ToString();
                                g._nameToGuid[name] = key;
                                g._guidToName.TryAdd(key, name);
                            }
        if (mappings?["specialValues"] is JsonObject special)
            foreach (var (name, value) in special)
                if (name != "comment" && (value is null || value.ToString() == "")) g._allObjects.Add(name);
        if (mappings?["friendlyNameMappings"] is JsonObject friendly)
            foreach (var (name, value) in friendly)
                if (name != "comment" && value is JsonValue v && v.TryGetValue<string>(out var target)) g._aliases[name] = target;
        return g;
    }

    /// <summary>Adds names the directory resolved for GUIDs that are not in the mappings.</summary>
    public void AddResolved(IReadOnlyDictionary<string, string> resolved)
    {
        foreach (var (guid, name) in resolved)
            if (Guid.TryParse(guid, out var parsed))
            {
                _guidToName.TryAdd(parsed.ToString(), name);
                _nameToGuid.TryAdd(name, parsed.ToString());
            }
    }

    public bool IsAllObjects(string? name) => name is null || _allObjects.Contains(name.Trim());

    /// <summary>Technical name of a configured object type (aliases resolved); "" for all objects.</summary>
    public string Technical(string? name)
    {
        if (IsAllObjects(name)) return "";
        var n = name!.Trim();
        for (var i = 0; i < 3 && _aliases.TryGetValue(n, out var target); i++) n = target;
        return n;
    }

    /// <summary>Name for a GUID, or the GUID itself when unknown; "" for none.</summary>
    public string NameOf(string? guid)
    {
        if (string.IsNullOrWhiteSpace(guid) || !Guid.TryParse(guid, out var parsed) || parsed == Guid.Empty) return "";
        return _guidToName.TryGetValue(parsed.ToString(), out var name) ? name : parsed.ToString();
    }

    public string? GuidOf(string? name)
    {
        var t = Technical(name);
        return t.Length == 0 ? null : _nameToGuid.GetValueOrDefault(t);
    }

    /// <summary>Comparison key of an object type: the GUID when known, else the lower-case name; "" for all objects.</summary>
    public string Key(string? nameOrGuid)
    {
        if (string.IsNullOrWhiteSpace(nameOrGuid)) return "";
        if (Guid.TryParse(nameOrGuid, out var parsed)) return parsed == Guid.Empty ? "" : parsed.ToString();
        var technical = Technical(nameOrGuid);
        if (technical.Length == 0) return "";
        return _nameToGuid.TryGetValue(technical, out var guid) ? guid : technical.ToLowerInvariant();
    }
}
