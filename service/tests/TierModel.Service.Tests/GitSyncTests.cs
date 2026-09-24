using System.Diagnostics;
using LibGit2Sharp;
using TierModel.Service.GitSync;

namespace TierModel.Service.Tests;

/// <summary>The Git mirror against a local bare repository (file:// is only accepted in development / tests).</summary>
public sealed class GitSyncTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "tm-git-" + Guid.NewGuid().ToString("N")[..8]);
    private readonly string _bare;
    private readonly string _url;

    public GitSyncTests()
    {
        Directory.CreateDirectory(_root);
        _bare = Path.Combine(_root, "remote.git");
        Repository.Init(_bare, isBare: true);
        File.WriteAllText(Path.Combine(_bare, "HEAD"), "ref: refs/heads/main\n");
        _url = new Uri(_bare).AbsoluteUri;
    }

    public void Dispose()
    {
        foreach (var r in _open) r.Dispose();
        try { GitRepositorySync.DeleteDirectory(_root); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }

    private GitRepositorySync Open(string name = "clone", string path = "config", string[]? domainRoots = null)
    {
        var sync = new GitRepositorySync(Path.Combine(_root, name), new GitRemoteOptions(_url, "main", null, null, AllowFileUrls: true), path, domainRoots);
        sync.Open();
        return sync;
    }

    private static Signature Sig(string name, string email) => new(name, email, DateTimeOffset.UtcNow);

    private readonly List<Repository> _open = [];

    /// <summary>Tip of main in the bare repository (the repository stays open until Dispose, commits load lazily).</summary>
    private Commit RemoteHead()
    {
        var bare = new Repository(_bare);
        _open.Add(bare);
        return bare.Branches["main"].Tip;
    }

    /// <summary>Somebody else pushes a commit to the remote (another clone).</summary>
    private void ForeignPush(string path, string content)
    {
        var other = Path.Combine(_root, "other-" + Guid.NewGuid().ToString("N")[..6]);
        Repository.Clone(_url, other);
        using var repo = new Repository(other);
        var full = Path.Combine(other, path);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        File.WriteAllText(full, content);
        Commands.Stage(repo, path);
        repo.Commit("foreign", Sig("Kollege", "k@contoso.com"), Sig("Kollege", "k@contoso.com"));
        repo.Network.Push(repo.Network.Remotes["origin"], $"{repo.Head.CanonicalName}:refs/heads/main");
    }

    [Fact]
    public void Commits_files_with_author_and_trailers_and_pushes_to_an_empty_repository()
    {
        using var sync = Open();
        var message = GitSyncService.CommitMessage("OU-Struktur angepasst", [("TierModel-Section", "ous"), ("TierModel-Version", "7"), ("TierModel-Instance", "https://tm.contoso.com")]);
        var commit = sync.Commit([new GitFile(sync.FilePath("tiermodel-ous.json"), "{\n  \"a\": 1\n}"), new GitFile(sync.VersionsPath, "{\"ous\": 7}")],
            Sig("Anna Admin", "anna@contoso.com"), Sig("TierModel Service", "tm@contoso.com"), message);
        Assert.NotNull(commit);
        Assert.Equal(GitPushOutcome.Pushed, sync.Push().Outcome);
        Assert.Equal(0, sync.AheadCount());

        var head = RemoteHead();
        Assert.Equal(commit!.Sha, head.Sha);
        Assert.Equal("Anna Admin", head.Author.Name);
        Assert.Equal("anna@contoso.com", head.Author.Email);
        Assert.Equal("TierModel Service", head.Committer.Name);
        Assert.StartsWith("OU-Struktur angepasst\n\n", head.Message);
        Assert.Contains("TierModel-Section: ous\n", head.Message);
        Assert.Contains("TierModel-Version: 7\n", head.Message);
        Assert.Contains("TierModel-Instance: https://tm.contoso.com", head.Message);
        var blob = (Blob)head["config/tiermodel-ous.json"].Target;
        Assert.Equal("{\n  \"a\": 1\n}", blob.GetContentText());
        Assert.NotNull(head["versions.json"]);
    }

    [Fact]
    public void Identical_content_creates_no_commit()
    {
        using var sync = Open();
        var files = new[] { new GitFile(sync.FilePath("a.json"), "{}") };
        Assert.NotNull(sync.Commit(files, Sig("a", "a@x"), Sig("a", "a@x"), "1"));
        Assert.Null(sync.Commit(files, Sig("a", "a@x"), Sig("a", "a@x"), "2"));
    }

    [Fact]
    public void Remote_changes_outside_our_paths_are_integrated_on_non_fast_forward()
    {
        using (var first = Open())
        {
            first.Commit([new GitFile(first.FilePath("a.json"), "{\"v\":1}")], Sig("a", "a@x"), Sig("a", "a@x"), "one");
            Assert.Equal(GitPushOutcome.Pushed, first.Push().Outcome);
        }
        ForeignPush("README.md", "Doku");

        using var sync = Open(); // same clone, still at "one"
        sync.Commit([new GitFile(sync.FilePath("a.json"), "{\"v\":2}")], Sig("b", "b@x"), Sig("b", "b@x"), "two");
        var result = sync.Push();
        Assert.Equal(GitPushOutcome.Pushed, result.Outcome);

        var head = RemoteHead();
        Assert.Equal("two", head.MessageShort);
        Assert.Equal("{\"v\":2}", ((Blob)head["config/a.json"].Target).GetContentText());
        Assert.Equal("Doku", ((Blob)head["README.md"].Target).GetContentText()); // foreign change kept
        Assert.Equal("foreign", head.Parents.Single().MessageShort); // linear history
    }

    [Fact]
    public void Remote_changes_in_our_paths_are_a_conflict_and_take_remote_resets()
    {
        using (var first = Open())
        {
            first.Commit([new GitFile(first.FilePath("a.json"), "{\"v\":1}")], Sig("a", "a@x"), Sig("a", "a@x"), "one");
            first.Push();
        }
        ForeignPush("config/a.json", "{\"v\":\"fremd\"}");

        using (var sync = Open())
        {
            sync.Commit([new GitFile(sync.FilePath("a.json"), "{\"v\":2}")], Sig("b", "b@x"), Sig("b", "b@x"), "two");
            var result = sync.Push();
            Assert.Equal(GitPushOutcome.Conflict, result.Outcome);
            Assert.Equal("foreign", RemoteHead().MessageShort); // nothing overwritten
            Assert.Equal(1, sync.AheadCount());

            sync.ResetToRemote();
            Assert.Equal(0, sync.AheadCount());
            Assert.Equal(RemoteHead().Sha, sync.LocalTip()!.Sha);
            Assert.Equal("{\"v\":\"fremd\"}", sync.ReadFile("config/a.json"));
            // After the reset the current state is exported again as a new commit on top.
            sync.Commit([new GitFile(sync.FilePath("a.json"), "{\"v\":3}")], Sig("b", "b@x"), Sig("b", "b@x"), "re-export");
            Assert.Equal(GitPushOutcome.Pushed, sync.Push().Outcome);
        }
        Assert.Equal("re-export", RemoteHead().MessageShort);
    }

    [Fact]
    public void Catch_up_fast_forwards_when_only_the_remote_moved()
    {
        using (var first = Open())
        {
            first.Commit([new GitFile(first.FilePath("a.json"), "1")], Sig("a", "a@x"), Sig("a", "a@x"), "one");
            first.Push();
        }
        ForeignPush("other/file.txt", "x");
        using var sync = Open();
        sync.Fetch();
        Assert.True(sync.CatchUp());
        Assert.Equal(RemoteHead().Sha, sync.LocalTip()!.Sha);
    }

    [Fact]
    public void Existing_remote_branch_is_checked_out_on_first_open()
    {
        ForeignPush("README.md", "hallo");
        using var sync = Open("fresh");
        Assert.Equal(RemoteHead().Sha, sync.LocalTip()!.Sha);
        Assert.Equal("hallo", sync.ReadFile("README.md"));
    }

    [Fact]
    public void Further_domains_live_in_their_own_folder_which_belongs_to_the_service()
    {
        using (var first = Open(domainRoots: ["fabrikam"]))
        {
            Assert.Equal("fabrikam/config/a.json", first.FilePath("a.json", "fabrikam"));
            Assert.Equal("fabrikam/versions.json", first.VersionsPathFor("fabrikam"));
            Assert.Equal("config/a.json", first.FilePath("a.json", null));
            first.Commit([new GitFile(first.FilePath("a.json", null), "{\"d\":1}"), new GitFile(first.FilePath("a.json", "fabrikam"), "{\"d\":2}")],
                Sig("a", "a@x"), Sig("a", "a@x"), "both");
            Assert.Equal(GitPushOutcome.Pushed, first.Push().Outcome);
        }
        // Somebody edits a file outside our paths: integrated, both domains' commits replayed.
        ForeignPush("README.md", "Doku");
        using (var sync = Open(domainRoots: ["fabrikam"]))
        {
            sync.Commit([new GitFile(sync.FilePath("a.json", "fabrikam"), "{\"d\":3}")], Sig("b", "b@x"), Sig("b", "b@x"), "fabrikam only");
            Assert.Equal(GitPushOutcome.Pushed, sync.Push().Outcome);
        }
        var head = RemoteHead();
        Assert.Equal("{\"d\":3}", ((Blob)head["fabrikam/config/a.json"].Target).GetContentText());
        Assert.Equal("{\"d\":1}", ((Blob)head["config/a.json"].Target).GetContentText());
        Assert.Equal("Doku", ((Blob)head["README.md"].Target).GetContentText());

        // A change in the folder of a further domain is a conflict like one in the first domain's path.
        ForeignPush("fabrikam/config/a.json", "{\"d\":\"fremd\"}");
        using (var sync = Open(domainRoots: ["fabrikam"]))
        {
            sync.Commit([new GitFile(sync.FilePath("a.json", null), "{\"d\":4}")], Sig("b", "b@x"), Sig("b", "b@x"), "first domain");
            Assert.Equal(GitPushOutcome.Conflict, sync.Push().Outcome);
        }
    }

    [Theory]
    [InlineData("config", "versions.json")]
    [InlineData("tiermodel/config", "tiermodel/versions.json")]
    public void Versions_json_sits_next_to_the_config_folder(string path, string expected)
    {
        using var sync = new GitRepositorySync(Path.Combine(_root, "x"), new GitRemoteOptions(_url, "main", null, null, true), path);
        Assert.Equal(expected, sync.VersionsPath);
    }

    [Theory]
    [InlineData("https://git.contoso.com/it/cfg.git", false, true)]
    [InlineData("http://git.contoso.com/it/cfg.git", false, false)]
    [InlineData("https://user:secret@git.contoso.com/cfg.git", false, false)]
    [InlineData("file:///tmp/repo.git", false, false)]
    [InlineData("file:///tmp/repo.git", true, true)]
    [InlineData("ssh://git@host/repo.git", true, false)]
    public void Only_https_urls_are_accepted(string url, bool allowFile, bool ok) =>
        Assert.Equal(ok, GitRepositorySync.UrlError(url, allowFile) is null);

    [Theory]
    [InlineData("config", "config")]
    [InlineData("/a/b/", "a/b")]
    [InlineData("..", null)]
    [InlineData("a/../b", null)]
    [InlineData(".git", null)]
    [InlineData("", null)]
    public void Repository_path_is_normalised(string input, string? expected) =>
        Assert.Equal(expected, GitRepositorySync.NormalizeRepoPath(input));

    [Fact]
    public void Credentials_are_redacted_from_errors()
    {
        var m = GitRepositorySync.Redact("failed https://bob:ghp_secret123@host/x.git token ghp_secret123", "ghp_secret123");
        Assert.DoesNotContain("ghp_secret123", m);
        Assert.DoesNotContain("bob:", m);
    }

    [Fact]
    public void Versions_json_uses_catalog_order_and_export_formatting()
    {
        var json = GitSyncService.VersionsJson(new Dictionary<string, int> { ["groups"] = 3, ["ous"] = 5 });
        Assert.Equal("{\n  \"ous\": 5,\n  \"groups\": 3\n}", json.Replace("\r\n", "\n"));
    }

    [Fact]
    public void Git_cli_sees_the_pushed_commit()
    {
        using (var sync = Open())
        {
            sync.Commit([new GitFile(sync.FilePath("a.json"), "{}")], Sig("Anna", "anna@x"), Sig("TM", "tm@x"), "Nachricht\n\nTierModel-Section: ous\n");
            sync.Push();
        }
        var psi = new ProcessStartInfo("git", ["--git-dir", _bare, "log", "--format=%an|%s|%(trailers:key=TierModel-Section,valueonly)", "main"])
        { RedirectStandardOutput = true };
        try
        {
            using var p = Process.Start(psi)!;
            var output = p.StandardOutput.ReadToEnd();
            p.WaitForExit();
            Assert.Contains("Anna|Nachricht|ous", output);
        }
        catch (System.ComponentModel.Win32Exception)
        {
            // git not installed: nothing to compare against.
        }
    }
}
