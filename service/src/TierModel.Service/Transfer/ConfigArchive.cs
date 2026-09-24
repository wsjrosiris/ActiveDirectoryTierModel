using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using TierModel.Service.Config;
using TierModel.Service.Localization;

namespace TierModel.Service.Transfer;

/// <summary>Configuration read from an export ZIP or another instance, before it is compared with the current state.</summary>
/// <param name="Sections">Section key → raw file content (catalog sections only).</param>
/// <param name="SourceVersions">Section key → version at the source (from versions.json), if known.</param>
/// <param name="UnknownFiles">Files that match no catalog section; ignored.</param>
/// <param name="Invalid">Section key → why its content cannot be imported.</param>
public record ImportSource(
    string Label,
    Dictionary<string, string> Sections,
    Dictionary<string, int> SourceVersions,
    List<string> UnknownFiles,
    Dictionary<string, string> Invalid,
    List<string> Notices);

public class ImportFormatException(string message) : Exception(message);

/// <summary>Reads the export ZIP of <c>GET /api/config/export</c>: <c>config/&lt;file&gt;.json</c> per section plus <c>versions.json</c>.</summary>
public static class ConfigArchive
{
    public const long MaxArchiveBytes = 20L << 20;
    public const long MaxEntryBytes = 20L << 20;
    public const long MaxTotalBytes = 100L << 20;
    public const int MaxEntries = 500;

    /// <summary>
    /// Parses the archive. Throws <see cref="ImportFormatException"/> for anything that is not a usable export:
    /// not a ZIP, too large, entry names escaping the archive (zip slip), no section file at all.
    /// Nothing is ever extracted to disk.
    /// </summary>
    public static ImportSource Read(Stream stream, string label)
    {
        ZipArchive zip;
        try
        {
            zip = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: true);
        }
        catch (InvalidDataException)
        {
            throw new ImportFormatException(L.T("Die Datei ist kein gültiges ZIP-Archiv."));
        }
        using (zip)
        {
            if (zip.Entries.Count > MaxEntries)
                throw new ImportFormatException(L.F("Das Archiv enthält zu viele Dateien (höchstens {0}).", MaxEntries));
            var byFile = ConfigCatalog.Sections.ToDictionary(s => s.FileName, StringComparer.OrdinalIgnoreCase);
            var sections = new Dictionary<string, string>();
            var invalid = new Dictionary<string, string>();
            var unknown = new List<string>();
            var notices = new List<string>();
            var versions = new Dictionary<string, int>();
            string? manifest = null;
            long total = 0;

            foreach (var entry in zip.Entries)
            {
                var name = NormalizeEntryName(entry.FullName);
                if (name.EndsWith('/')) continue; // directory entry
                if (entry.Length > MaxEntryBytes)
                    throw new ImportFormatException(L.F("„{0}“ ist zu groß (höchstens {1} MB je Datei).", name, MaxEntryBytes >> 20));
                total += entry.Length;
                if (total > MaxTotalBytes)
                    throw new ImportFormatException(L.F("Das Archiv ist entpackt zu groß (höchstens {0} MB).", MaxTotalBytes >> 20));

                if (name.Equals("versions.json", StringComparison.OrdinalIgnoreCase))
                {
                    manifest = ReadText(entry);
                    continue;
                }
                var def = name.StartsWith("config/", StringComparison.OrdinalIgnoreCase) && name.IndexOf('/', 7) < 0
                    ? byFile.GetValueOrDefault(name[7..]) : null;
                if (def is null)
                {
                    unknown.Add(name);
                    continue;
                }
                var text = ReadText(entry);
                if (ParseObject(text) is { } error) invalid[def.Key] = error;
                else sections[def.Key] = text;
            }

            if (manifest is null)
                notices.Add(L.T("versions.json fehlt – die Versionsnummern der Quelle sind unbekannt."));
            else
            {
                try
                {
                    if (JsonNode.Parse(manifest) is JsonObject o)
                        foreach (var (k, v) in o)
                            if (ConfigCatalog.Find(k) is { } d && v is JsonValue jv && jv.TryGetValue<int>(out var n)) versions[d.Key] = n;
                }
                catch (JsonException)
                {
                    notices.Add(L.T("versions.json ist beschädigt und wurde ignoriert."));
                }
            }
            if (sections.Count == 0 && invalid.Count == 0)
                throw new ImportFormatException(L.T("Das Archiv enthält keine Konfigurationsdateien (erwartet: config/tiermodel-*.json aus einem Export)."));
            if (unknown.Count > 0)
                notices.Add(L.F("{0} unbekannte Datei(en) ignoriert: {1}{2}", unknown.Count, string.Join(", ", unknown.Take(10)), (unknown.Count > 10 ? " …" : "")));
            return new ImportSource(label, sections, versions, unknown, invalid, notices);
        }
    }

    /// <summary>Forward slashes, no leading "./"; rejects absolute paths, drive letters and ".." segments (zip slip).</summary>
    public static string NormalizeEntryName(string fullName)
    {
        var name = fullName.Replace('\\', '/');
        while (name.StartsWith("./", StringComparison.Ordinal)) name = name[2..];
        if (name.Length == 0 || name.StartsWith('/') || (name.Length > 1 && name[1] == ':') || name.Contains('\0')
            || name.Split('/').Any(seg => seg == ".."))
            throw new ImportFormatException(L.F("Unzulässiger Pfad im Archiv: „{0}“.", fullName));
        return name;
    }

    private static string ReadText(ZipArchiveEntry entry)
    {
        using var s = entry.Open();
        using var limited = new MemoryStream();
        var buffer = new byte[81920];
        int read;
        // Entry.Length comes from the archive header and can lie; enforce the limit while decompressing.
        while ((read = s.Read(buffer, 0, buffer.Length)) > 0)
        {
            limited.Write(buffer, 0, read);
            if (limited.Length > MaxEntryBytes)
                throw new ImportFormatException(L.F("„{0}“ ist zu groß (höchstens {1} MB je Datei).", entry.FullName, MaxEntryBytes >> 20));
        }
        var bytes = limited.ToArray();
        var offset = bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF ? 3 : 0;
        return Encoding.UTF8.GetString(bytes, offset, bytes.Length - offset);
    }

    /// <summary>Null when <paramref name="text"/> is a JSON object, else a German error message.</summary>
    public static string? ParseObject(string text)
    {
        try
        {
            return JsonNode.Parse(text) is JsonObject ? null : L.T("Der Inhalt ist kein JSON-Objekt.");
        }
        catch (JsonException ex)
        {
            return L.F("Ungültiges JSON: {0}", ex.Message);
        }
    }
}
