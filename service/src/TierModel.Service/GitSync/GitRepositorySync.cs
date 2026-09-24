using System.Text;
using System.Text.RegularExpressions;
using LibGit2Sharp;

namespace TierModel.Service.GitSync;

/// <summary>Connection to the remote repository. <see cref="AllowFileUrls"/> only in development (tests against a local bare repository).</summary>
public record GitRemoteOptions(string Url, string Branch, string? Username, string? Password, bool AllowFileUrls = false);

public record GitFile(string Path, string Content);

public enum GitPushOutcome { Pushed, NothingToPush, Conflict, Failed }

public record GitPushResult(GitPushOutcome Outcome, string? Error = null);

public class GitSyncException(string message) : Exception(message);

/// <summary>
/// Local clone of the configuration repository (WorkPath/git/repo) and the few operations the sync needs:
/// write files + commit, push, integrate remote commits that do not touch our paths, reset to the remote.
/// Built on LibGit2Sharp, so the server needs no git installation.
/// </summary>
public sealed partial class GitRepositorySync : IDisposable
{
    public const string RemoteName = "origin";
    private readonly string _path;
    private readonly GitRemoteOptions _o;
    private readonly string _configDir;
    private Repository? _repo;

    /// <param name="configDir">Folder inside the repository for the section files, e.g. "config"; versions.json sits next to it.</param>
    public GitRepositorySync(string localPath, GitRemoteOptions options, string configDir)
    {
        _path = localPath;
        _o = options;
        _configDir = NormalizeRepoPath(configDir) ?? throw new GitSyncException("Ungültiger Pfad im Repository.");
    }

    public string ConfigDir => _configDir;

    /// <summary>versions.json lives beside the config folder, as in the export ZIP (config/… + versions.json).</summary>
    public string VersionsPath => _configDir.Contains('/') ? _configDir[.._configDir.LastIndexOf('/')] + "/versions.json" : "versions.json";

    public string FilePath(string fileName) => $"{_configDir}/{fileName}";

    /// <summary>"config", "tiermodel/config" … : relative, forward slashes, no "." / ".." segments; null if invalid or empty.</summary>
    public static string? NormalizeRepoPath(string? path)
    {
        var p = (path ?? "").Replace('\\', '/').Trim().Trim('/');
        if (p.Length == 0 || p.Length > 200) return null;
        var segments = p.Split('/');
        if (segments.Any(s => s.Length == 0 || s is "." or ".." || s.StartsWith(".git", StringComparison.OrdinalIgnoreCase) || s.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || s.Contains(':')))
            return null;
        return p;
    }

    /// <summary>Null when the URL may be used: https, or file:// in development. Never credentials in the URL.</summary>
    public static string? UrlError(string? url, bool allowFileUrls)
    {
        if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url.Trim(), UriKind.Absolute, out var u))
            return "Vollständige https-Adresse des Repositorys angeben, z. B. https://git.contoso.com/it/tiermodel-config.git";
        if (u.Scheme == Uri.UriSchemeFile && allowFileUrls) return null;
        if (u.Scheme != Uri.UriSchemeHttps) return "Nur https-Adressen sind erlaubt.";
        if (!string.IsNullOrEmpty(u.UserInfo)) return "Zugangsdaten nicht in die Adresse schreiben, sondern in die Felder Benutzername und Token.";
        if (!string.IsNullOrEmpty(u.Query) || !string.IsNullOrEmpty(u.Fragment)) return "Die Adresse darf keine Parameter enthalten.";
        return null;
    }

    public static bool IsValidBranch(string? branch) =>
        !string.IsNullOrWhiteSpace(branch) && branch.Length <= 100 && Reference.IsValidName("refs/heads/" + branch.Trim());

    /// <summary>Removes secrets and credentials embedded in URLs from an error text.</summary>
    public static string Redact(string message, params string?[] secrets)
    {
        var m = UrlCredentials().Replace(message, "$1***@");
        foreach (var s in secrets)
            if (!string.IsNullOrEmpty(s) && s.Length >= 3) m = m.Replace(s, "***", StringComparison.Ordinal);
        return m;
    }

    [GeneratedRegex(@"(\w+://)[^/@\s]+@")]
    private static partial Regex UrlCredentials();

    private string Redact(Exception ex) => Redact(ex.Message, _o.Password);

    private Repository Repo => _repo ?? throw new InvalidOperationException("Open() zuerst aufrufen.");

    /// <summary>Opens the local clone, creating it (init + fetch) when missing or when it points at another remote.</summary>
    public void Open()
    {
        if (UrlError(_o.Url, _o.AllowFileUrls) is { } urlError) throw new GitSyncException(urlError);
        if (Repository.IsValid(_path))
        {
            _repo = new Repository(_path);
            if (_repo.Network.Remotes[RemoteName]?.Url == _o.Url.Trim()) return;
            _repo.Dispose();
            _repo = null;
        }
        if (Directory.Exists(_path)) DeleteDirectory(_path);
        Directory.CreateDirectory(_path);
        Repository.Init(_path);
        _repo = new Repository(_path);
        _repo.Config.Set("core.autocrlf", false);
        _repo.Network.Remotes.Add(RemoteName, _o.Url.Trim());
        // Unborn branch until the first fetch finds it on the remote (or our first commit creates it).
        PointHeadAt("refs/heads/" + _o.Branch);
        Fetch();
        if (RemoteTip() is { } remote) ResetHard(remote);
    }

    private FetchOptions FetchOptions() => new() { CredentialsProvider = Credentials };

    private Credentials Credentials(string url, string? usernameFromUrl, SupportedCredentialTypes types) =>
        string.IsNullOrEmpty(_o.Password)
            ? new DefaultCredentials()
            : new UsernamePasswordCredentials { Username = string.IsNullOrWhiteSpace(_o.Username) ? "git" : _o.Username, Password = _o.Password };

    public void Fetch()
    {
        try
        {
            Commands.Fetch(Repo, RemoteName, [$"+refs/heads/{_o.Branch}:refs/remotes/{RemoteName}/{_o.Branch}"], FetchOptions(), null);
        }
        catch (LibGit2SharpException ex) when (IsMissingRemoteBranch(ex))
        {
            // Empty repository or branch not created yet: our first push creates it.
        }
        catch (LibGit2SharpException ex)
        {
            throw new GitSyncException($"Abrufen fehlgeschlagen: {Redact(ex)}");
        }
    }

    private static bool IsMissingRemoteBranch(LibGit2SharpException ex) =>
        ex.Message.Contains("couldn't find remote ref", StringComparison.OrdinalIgnoreCase)
        || ex.Message.Contains("could not find remote ref", StringComparison.OrdinalIgnoreCase);

    public Commit? LocalTip() => Repo.Head.Tip;

    public Commit? RemoteTip() => Repo.Branches[$"{RemoteName}/{_o.Branch}"]?.Tip;

    /// <summary>Local commits not on the remote yet.</summary>
    public int AheadCount()
    {
        var local = LocalTip();
        if (local is null) return 0;
        var remote = RemoteTip();
        return remote is null
            ? Repo.Commits.QueryBy(new CommitFilter { IncludeReachableFrom = local }).Count()
            : Repo.Commits.QueryBy(new CommitFilter { IncludeReachableFrom = local, ExcludeReachableFrom = remote }).Count();
    }

    /// <summary>After a fetch: fast-forward when only the remote moved; integrate when both moved. False on a conflict in our paths.</summary>
    public bool CatchUp()
    {
        var local = LocalTip();
        var remote = RemoteTip();
        if (remote is null || local?.Sha == remote.Sha) return true;
        if (local is null)
        {
            ResetHard(remote);
            return true;
        }
        var mergeBase = Repo.ObjectDatabase.FindMergeBase(local, remote);
        if (mergeBase?.Sha == local.Sha)
        {
            ResetHard(remote); // only the remote moved
            return true;
        }
        if (mergeBase?.Sha == remote.Sha) return true; // only we moved
        return Integrate(local, remote, mergeBase);
    }

    /// <summary>
    /// Replays our unpushed commits on top of the remote. Only allowed when the remote changed nothing in our paths
    /// (config folder and versions.json) since the common ancestor; each replayed commit takes the remote tree and
    /// replaces just our paths, so other content of the repository is never touched.
    /// </summary>
    /// <summary>Makes HEAD a symbolic reference to <paramref name="refName"/> (may be unborn).</summary>
    private void PointHeadAt(string refName) => File.WriteAllText(Path.Combine(Repo.Info.Path, "HEAD"), $"ref: {refName}\n");

    private bool Integrate(Commit local, Commit remote, Commit? mergeBase)
    {
        if (TouchesOurPaths(mergeBase?.Tree, remote.Tree)) return false;
        var ours = Repo.Commits.QueryBy(new CommitFilter
        {
            IncludeReachableFrom = local,
            ExcludeReachableFrom = remote,
            SortBy = CommitSortStrategies.Topological | CommitSortStrategies.Reverse,
        }).ToList();
        var parent = remote;
        foreach (var c in ours)
        {
            var td = TreeDefinition.From(parent.Tree);
            ReplacePath(td, c.Tree, _configDir);
            ReplacePath(td, c.Tree, VersionsPath);
            var tree = Repo.ObjectDatabase.CreateTree(td);
            parent = Repo.ObjectDatabase.CreateCommit(c.Author, c.Committer, c.Message, tree, [parent], prettifyMessage: false);
        }
        ResetHard(parent);
        return true;
    }

    private static void ReplacePath(TreeDefinition td, Tree source, string path)
    {
        td.Remove(path);
        if (source[path] is { } entry) td.Add(path, entry);
    }

    private bool TouchesOurPaths(Tree? from, Tree to)
    {
        var changes = Repo.Diff.Compare<TreeChanges>(from, to);
        return changes.Any(c => IsOurs(c.Path) || IsOurs(c.OldPath));
    }

    private bool IsOurs(string? path) =>
        path is not null && (path == VersionsPath || path == _configDir || path.StartsWith(_configDir + "/", StringComparison.Ordinal));

    private void ResetHard(Commit target)
    {
        var branch = Repo.Branches[_o.Branch] ?? Repo.CreateBranch(_o.Branch, target);
        if (!Repo.Head.IsCurrentRepositoryHead || Repo.Head.FriendlyName != _o.Branch || Repo.Head.Tip is null)
            PointHeadAt(branch.CanonicalName);
        Repo.Reset(ResetMode.Hard, target);
    }

    /// <summary>Writes the files and commits them if anything changed. Returns the new commit, or null when the content was already committed.</summary>
    public Commit? Commit(IEnumerable<GitFile> files, Signature author, Signature committer, string message)
    {
        var paths = new List<string>();
        foreach (var f in files)
        {
            var full = Path.GetFullPath(Path.Combine(_path, f.Path));
            if (!full.StartsWith(Path.GetFullPath(_path) + Path.DirectorySeparatorChar, StringComparison.Ordinal))
                throw new GitSyncException($"Unzulässiger Pfad: {f.Path}");
            Directory.CreateDirectory(Path.GetDirectoryName(full)!);
            File.WriteAllBytes(full, Encoding.UTF8.GetBytes(f.Content));
            paths.Add(f.Path);
        }
        if (paths.Count == 0) return null;
        Commands.Stage(Repo, paths);
        var status = Repo.RetrieveStatus(new StatusOptions { PathSpec = paths.ToArray(), IncludeUntracked = true });
        if (!status.IsDirty) return null;
        return Repo.Commit(message, author, committer, new CommitOptions());
    }

    /// <summary>Reads a file of the working tree (e.g. versions.json), null when absent.</summary>
    public string? ReadFile(string path)
    {
        var full = Path.Combine(_path, path);
        return File.Exists(full) ? File.ReadAllText(full) : null;
    }

    /// <summary>Pushes the branch; on a rejected (non-fast-forward) push fetches, integrates and tries once more.</summary>
    public GitPushResult Push()
    {
        if (LocalTip() is null || AheadCount() == 0) return new GitPushResult(GitPushOutcome.NothingToPush);
        for (var attempt = 0; ; attempt++)
        {
            var (ok, rejected, error) = TryPush();
            if (ok) return new GitPushResult(GitPushOutcome.Pushed);
            if (!rejected || attempt > 0) return new GitPushResult(rejected ? GitPushOutcome.Conflict : GitPushOutcome.Failed, error);
            Fetch();
            if (!CatchUp()) return new GitPushResult(GitPushOutcome.Conflict, "Die Gegenstelle enthält abweichende Änderungen an der Konfiguration.");
        }
    }

    private (bool Ok, bool Rejected, string? Error) TryPush()
    {
        string? statusError = null;
        try
        {
            var options = new PushOptions
            {
                CredentialsProvider = Credentials,
                OnPushStatusError = e => statusError = e.Message,
            };
            Repo.Network.Push(Repo.Network.Remotes[RemoteName], $"refs/heads/{_o.Branch}:refs/heads/{_o.Branch}", options);
        }
        catch (NonFastForwardException)
        {
            return (false, true, "Push abgelehnt (nicht vorspulbar).");
        }
        catch (LibGit2SharpException ex)
        {
            var msg = Redact(ex);
            return (false, IsRejection(msg), $"Push fehlgeschlagen: {msg}");
        }
        if (statusError is not null) return (false, IsRejection(statusError), $"Push abgelehnt: {Redact(statusError, _o.Password)}");
        // Remember what the remote has now, so AheadCount is 0.
        if (LocalTip() is { } tip) Repo.Refs.Add($"refs/remotes/{RemoteName}/{_o.Branch}", tip.Id, "push", allowOverwrite: true);
        return (true, false, null);
    }

    private static bool IsRejection(string message) =>
        message.Contains("fast-forward", StringComparison.OrdinalIgnoreCase)
        || message.Contains("fastforward", StringComparison.OrdinalIgnoreCase)
        || message.Contains("fetch first", StringComparison.OrdinalIgnoreCase)
        || message.Contains("rejected", StringComparison.OrdinalIgnoreCase);

    /// <summary>"Remote übernehmen": discard local commits and continue from the remote state.</summary>
    public void ResetToRemote()
    {
        Fetch();
        if (RemoteTip() is { } remote)
        {
            ResetHard(remote);
            return;
        }
        // Remote branch does not exist: start over with an empty history.
        _repo?.Dispose();
        _repo = null;
        DeleteDirectory(_path);
        Open();
    }

    public void Dispose() => _repo?.Dispose();

    /// <summary>Git marks pack files read-only; clear that before deleting (needed on Windows).</summary>
    public static void DeleteDirectory(string path)
    {
        if (!Directory.Exists(path)) return;
        foreach (var f in Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories))
            File.SetAttributes(f, FileAttributes.Normal);
        Directory.Delete(path, recursive: true);
    }
}
