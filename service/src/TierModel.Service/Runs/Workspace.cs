using System.Text;
using TierModel.Service.Config;

namespace TierModel.Service.Runs;

/// <summary>
/// Per-run working copy of the framework. The PowerShell scripts read their configuration from
/// <c>$PSScriptRoot\config</c>, so each run gets its own copy with the database state written into it.
/// This keeps runs reproducible and isolated from edits made while they execute.
/// </summary>
public static class Workspace
{
    private static readonly string[] Files = ["Deploy-TierModel.ps1", "Audit-TierModel.ps1"];
    private static readonly string[] Directories = ["modules", "config"];

    public static string RunsRoot(TierModelOptions o) => Path.Combine(o.WorkPath, "runs");

    public static string PathFor(TierModelOptions o, long runId) => Path.Combine(RunsRoot(o), runId.ToString("D6"));

    public static string Create(TierModelOptions o, long runId, IEnumerable<(SectionDefinition Def, int Version, string Content)> snapshot)
    {
        var source = o.FrameworkPath;
        if (!File.Exists(Path.Combine(source, "Deploy-TierModel.ps1")))
            throw new InvalidOperationException($"Framework nicht gefunden: '{source}' enthält kein Deploy-TierModel.ps1. Einstellung TierModel:FrameworkPath prüfen.");

        var root = PathFor(o, runId);
        if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        Directory.CreateDirectory(root);

        foreach (var f in Files)
            File.Copy(Path.Combine(source, f), Path.Combine(root, f));
        foreach (var d in Directories)
            CopyDirectory(Path.Combine(source, d), Path.Combine(root, d));

        var utf8 = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
        foreach (var (def, _, content) in snapshot)
            File.WriteAllText(Path.Combine(root, "config", def.FileName), content, utf8);

        Directory.CreateDirectory(Path.Combine(root, "out"));
        return root;
    }

    private static void CopyDirectory(string from, string to)
    {
        if (!Directory.Exists(from)) return;
        Directory.CreateDirectory(to);
        foreach (var dir in Directory.EnumerateDirectories(from, "*", SearchOption.AllDirectories))
            Directory.CreateDirectory(Path.Combine(to, Path.GetRelativePath(from, dir)));
        foreach (var file in Directory.EnumerateFiles(from, "*", SearchOption.AllDirectories))
            File.Copy(file, Path.Combine(to, Path.GetRelativePath(from, file)));
    }

    /// <summary>Deletes run folders older than <paramref name="maxAge"/>. Returns the number removed.</summary>
    public static int Cleanup(TierModelOptions o, TimeSpan maxAge, ILogger logger)
    {
        var root = RunsRoot(o);
        if (!Directory.Exists(root)) return 0;
        var removed = 0;
        foreach (var dir in new DirectoryInfo(root).EnumerateDirectories())
        {
            if (DateTime.UtcNow - dir.LastWriteTimeUtc < maxAge) continue;
            try
            {
                dir.Delete(recursive: true);
                removed++;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Could not delete run folder {Dir}", dir.FullName);
            }
        }
        return removed;
    }
}
