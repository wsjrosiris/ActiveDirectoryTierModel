using Microsoft.AspNetCore.DataProtection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Channels;
using LibGit2Sharp;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TierModel.Service.Config;
using TierModel.Service.Data;

namespace TierModel.Service.GitSync;

/// <summary>Stored Git settings (settings key <c>git</c>); the token/password is encrypted with the secrets protector.</summary>
public record GitSettings(bool Enabled, string RepositoryUrl, string Branch, string Username, string? PasswordProtected,
    string AuthorName, string AuthorEmail, string PathInRepo, bool PushOnSave)
{
    public static GitSettings Default => new(false, "", "main", "", null, "TierModel Service", "", "config", true);
}

/// <summary>Sync state (settings key <c>gitState</c>), survives restarts; a conflict blocks pushing until an administrator resolves it.</summary>
public record GitSyncState(DateTimeOffset? LastSyncAt = null, string? LastCommit = null, string? LastError = null, DateTimeOffset? LastErrorAt = null,
    bool Conflict = false, DateTimeOffset? ConflictSince = null, int Ahead = 0);

public enum GitSyncKind { Section, Full, TakeRemote }

/// <param name="DomainId">Domain of a section version (roadmap 17).</param>
public record GitSyncRequest(GitSyncKind Kind, string? SectionKey = null, int Version = 0, string? RequestedBy = null, int DomainId = 1);

/// <summary>Bounded queue between config saves and the Git worker. Enqueue never blocks; on overflow the worker does a full sync instead.</summary>
public class GitSyncQueue
{
    public const int Capacity = 1000;
    private readonly Channel<GitSyncRequest> _channel = Channel.CreateBounded<GitSyncRequest>(new BoundedChannelOptions(Capacity)
    {
        FullMode = BoundedChannelFullMode.DropWrite, SingleReader = true,
    });
    private int _overflow;

    public void Enqueue(string sectionKey, int version, int domainId = 1)
    {
        if (!_channel.Writer.TryWrite(new GitSyncRequest(GitSyncKind.Section, sectionKey, version, DomainId: domainId))) Interlocked.Exchange(ref _overflow, 1);
    }

    public void Enqueue(GitSyncRequest request)
    {
        if (!_channel.Writer.TryWrite(request)) Interlocked.Exchange(ref _overflow, 1);
    }

    /// <summary>True once after items were dropped because the queue was full.</summary>
    public bool TakeOverflow() => Interlocked.Exchange(ref _overflow, 0) == 1;

    public int Count => _channel.Reader.Count;

    public ChannelReader<GitSyncRequest> Reader => _channel.Reader;
}

/// <summary>In-memory status of the worker for the settings and health pages.</summary>
public class GitSyncStatus
{
    public volatile bool Busy;
    public DateTimeOffset? NextRetryAt;
    public int SkippedWhileConflict;
    /// <summary>Section versions not committed yet because the last attempt failed; retried first.</summary>
    public readonly List<GitSyncRequest> Deferred = [];
    public bool NeedsFull;
}

public record GitSettingsDto(bool Enabled, string RepositoryUrl, string Branch, string Username, bool HasPassword,
    string AuthorName, string AuthorEmail, string PathInRepo, bool PushOnSave, bool AllowFileUrls, GitStatusDto Status);

public record GitStatusDto(string State, DateTimeOffset? LastSyncAt, string? LastCommit, string? LastError, DateTimeOffset? LastErrorAt,
    bool Conflict, DateTimeOffset? ConflictSince, int Pending, bool Busy, DateTimeOffset? NextRetryAt);

public record GitSettingsInput(bool Enabled, string? RepositoryUrl, string? Branch, string? Username, string? Password, bool? ClearPassword,
    string? AuthorName, string? AuthorEmail, string? PathInRepo, bool PushOnSave);

/// <summary>
/// Git mirror of the configuration (roadmap 16): settings, state and the actual sync steps executed by <see cref="GitSyncWorker"/>.
/// Several domains (roadmap 17): the first domain (Id 1) keeps the layout from before (&lt;path&gt;/…, versions.json), every further
/// domain is mirrored below a folder named after its key (&lt;key&gt;/&lt;path&gt;/…, &lt;key&gt;/versions.json). Existing repositories stay valid.
/// </summary>
public class GitSyncService(AppDbContext db, SettingsService settings, GitSyncQueue queue, GitSyncStatus status, IOptions<TierModelOptions> options,
    IHostEnvironment env, ILogger<GitSyncService> logger, Domains.DomainRegistry domains)
{
    /// <summary>Top-level folder of a domain in the repository; null for the first domain.</summary>
    public static string? RootOf(Domain d) => d.Id == 1 ? null : d.Key;

    /// <summary>Further domains whose folder would collide with the configured path are not mirrored.</summary>
    private IEnumerable<Domain> MirroredDomains(GitSettings s)
    {
        var first = (GitRepositorySync.NormalizeRepoPath(s.PathInRepo) ?? "config").Split('/')[0];
        return domains.All.Where(d => d.Id == 1 || !string.Equals(d.Key, first, StringComparison.Ordinal));
    }

    public const string SettingsKey = "git";
    public const string StateKey = "gitState";

    /// <summary>file:// repositories (local bare repository) only for development and the automated tests.</summary>
    public bool AllowFileUrls => env.IsDevelopment() || env.IsEnvironment("Testing");

    public string LocalPath => Path.Combine(options.Value.WorkPath, "git", "repo");

    public async Task<GitSettings> GetSettingsAsync(CancellationToken ct = default)
    {
        var json = await settings.GetValueAsync(SettingsKey, ct);
        return (json is null ? null : JsonSerializer.Deserialize<GitSettings>(json, JsonSerializerOptions.Web)) ?? GitSettings.Default;
    }

    public Task SaveSettingsAsync(GitSettings s, CancellationToken ct = default) =>
        settings.SetValueAsync(SettingsKey, JsonSerializer.Serialize(s, JsonSerializerOptions.Web), ct);

    public async Task<GitSyncState> GetStateAsync(CancellationToken ct = default)
    {
        var json = await settings.GetValueAsync(StateKey, ct);
        return (json is null ? null : JsonSerializer.Deserialize<GitSyncState>(json, JsonSerializerOptions.Web)) ?? new GitSyncState();
    }

    public Task SaveStateAsync(GitSyncState s, CancellationToken ct = default) =>
        settings.SetValueAsync(StateKey, JsonSerializer.Serialize(s, JsonSerializerOptions.Web), ct);

    public async Task<GitStatusDto> GetStatusAsync(CancellationToken ct = default)
    {
        var s = await GetSettingsAsync(ct);
        var st = await GetStateAsync(ct);
        var pending = queue.Count + st.Ahead + status.SkippedWhileConflict + status.Deferred.Count;
        var state = !s.Enabled ? "disabled"
            : st.Conflict ? "conflict"
            : status.Busy ? "busy"
            : st.LastError is not null && (st.LastSyncAt is null || st.LastErrorAt > st.LastSyncAt) ? "error"
            : st.LastSyncAt is null ? "never"
            : pending > 0 ? "pending" : "ok";
        return new GitStatusDto(state, st.LastSyncAt, st.LastCommit, st.LastError, st.LastErrorAt, st.Conflict, st.ConflictSince, pending, status.Busy, status.NextRetryAt);
    }

    public async Task<GitSettingsDto> GetDtoAsync(CancellationToken ct = default)
    {
        var s = await GetSettingsAsync(ct);
        return new GitSettingsDto(s.Enabled, s.RepositoryUrl, s.Branch, s.Username, s.PasswordProtected is not null, s.AuthorName, s.AuthorEmail,
            s.PathInRepo, s.PushOnSave, AllowFileUrls, await GetStatusAsync(ct));
    }

    /// <summary>Validation errors of an input (field → German message).</summary>
    public Dictionary<string, string[]> Validate(GitSettingsInput r)
    {
        var errors = new Dictionary<string, string[]>();
        var enabled = r.Enabled;
        if (enabled || !string.IsNullOrWhiteSpace(r.RepositoryUrl))
            if (GitRepositorySync.UrlError(r.RepositoryUrl, AllowFileUrls) is { } e) errors["repositoryUrl"] = [e];
        if (!GitRepositorySync.IsValidBranch(r.Branch)) errors["branch"] = ["Gültigen Branch-Namen angeben, z. B. main."];
        if (GitRepositorySync.NormalizeRepoPath(r.PathInRepo) is null) errors["pathInRepo"] = ["Relativen Ordner angeben, z. B. config (ohne .. und ohne .git)."];
        if (!string.IsNullOrWhiteSpace(r.AuthorEmail) && !r.AuthorEmail.Contains('@')) errors["authorEmail"] = ["Gültige E-Mail-Adresse angeben."];
        if ((r.AuthorName?.Length ?? 0) > 200) errors["authorName"] = ["Höchstens 200 Zeichen."];
        if ((r.Username?.Length ?? 0) > 200) errors["username"] = ["Höchstens 200 Zeichen."];
        if ((r.Password?.Length ?? 0) > 2000) errors["password"] = ["Zu lang."];
        return errors;
    }

    /// <summary>Opens the configured repository; caller disposes.</summary>
    private GitRepositorySync OpenRepository(GitSettings s)
    {
        var password = s.PasswordProtected is null ? null : settings.Secrets.Unprotect(s.PasswordProtected);
        var repo = new GitRepositorySync(LocalPath, new GitRemoteOptions(s.RepositoryUrl, s.Branch, s.Username, password, AllowFileUrls), s.PathInRepo,
            MirroredDomains(s).Select(RootOf).OfType<string>());
        try
        {
            repo.Open();
            return repo;
        }
        catch
        {
            repo.Dispose();
            throw;
        }
    }

    private string? Password(GitSettings s) => s.PasswordProtected is null ? null : settings.Secrets.Unprotect(s.PasswordProtected);

    /// <summary>
    /// Processes a batch of requests: one commit per saved section version (author = the saving user), a full export for
    /// "Jetzt synchronisieren" / overflow / first sync, then a single push. Errors are recorded in the state; never thrown.
    /// </summary>
    public async Task ProcessAsync(IReadOnlyList<GitSyncRequest> batch, CancellationToken ct)
    {
        var s = await GetSettingsAsync(ct);
        var st = await GetStateAsync(ct);
        if (!s.Enabled || string.IsNullOrWhiteSpace(s.RepositoryUrl)) return;
        var takeRemote = batch.Any(b => b.Kind == GitSyncKind.TakeRemote);
        if (st.Conflict && !takeRemote)
        {
            status.SkippedWhileConflict += batch.Count(b => b.Kind == GitSyncKind.Section);
            return;
        }
        var full = takeRemote || status.NeedsFull || batch.Any(b => b.Kind == GitSyncKind.Full) || st.LastSyncAt is null;
        var sections = s.PushOnSave ? status.Deferred.Concat(batch.Where(b => b.Kind == GitSyncKind.Section)).ToList() : [];
        status.Deferred.Clear();
        var committed = 0;
        var retryOnly = batch.Count == 0;
        var instance = (await settings.GetAsync(ct)).PublicBaseUrl;

        try
        {
            using var repo = OpenRepository(s);
            if (takeRemote)
            {
                repo.ResetToRemote();
                status.SkippedWhileConflict = 0;
                st = st with { Conflict = false, ConflictSince = null };
            }
            else
            {
                repo.Fetch();
                if (!repo.CatchUp())
                {
                    st = st with { Conflict = true, ConflictSince = DateTimeOffset.UtcNow, LastError = "Konflikt: Im Repository wurde die Konfiguration außerhalb des Dienstes geändert.", LastErrorAt = DateTimeOffset.UtcNow, Ahead = repo.AheadCount() };
                    status.SkippedWhileConflict += sections.Count;
                    await SaveStateAsync(st, ct);
                    logger.LogWarning("Git sync: conflict with remote changes in the configuration path");
                    return;
                }
            }

            if (full)
            {
                await CommitAllAsync(repo, s, instance, takeRemote ? "Remote übernommen, aktueller Stand neu exportiert" : "Synchronisierung aller Bereiche", ct);
                status.NeedsFull = false;
                committed = sections.Count; // the full export contains them
            }
            else
            {
                foreach (var item in sections)
                {
                    await CommitSectionAsync(repo, s, item, instance, ct);
                    committed++;
                }
            }

            var push = repo.Push();
            var now = DateTimeOffset.UtcNow;
            switch (push.Outcome)
            {
                case GitPushOutcome.Pushed:
                case GitPushOutcome.NothingToPush:
                    status.NextRetryAt = null;
                    st = st with { LastSyncAt = now, LastCommit = repo.LocalTip()?.Sha, LastError = null, LastErrorAt = null, Ahead = 0 };
                    break;
                case GitPushOutcome.Conflict:
                    st = st with { Conflict = true, ConflictSince = now, LastError = push.Error ?? "Konflikt beim Push.", LastErrorAt = now, LastCommit = repo.LocalTip()?.Sha, Ahead = repo.AheadCount() };
                    logger.LogWarning("Git sync: push rejected, conflict: {Error}", push.Error);
                    break;
                default:
                    st = st with { LastError = push.Error, LastErrorAt = now, LastCommit = repo.LocalTip()?.Sha, Ahead = repo.AheadCount() };
                    logger.LogWarning("Git sync: push failed: {Error}", push.Error);
                    break;
            }
        }
        catch (Exception ex) when (ex is GitSyncException or LibGit2SharpException or IOException or UnauthorizedAccessException or System.Security.Cryptography.CryptographicException)
        {
            var message = GitRepositorySync.Redact(ex.Message, Password(s));
            st = st with { LastError = message, LastErrorAt = DateTimeOffset.UtcNow };
            logger.LogWarning("Git sync failed{Retry}: {Error}", retryOnly ? " (retry)" : "", message);
            var remaining = sections.Skip(committed).ToList();
            if (status.Deferred.Count + remaining.Count > GitSyncQueue.Capacity) status.NeedsFull = true;
            else status.Deferred.AddRange(remaining);
        }
        await SaveStateAsync(st, ct);
    }

    private async Task CommitSectionAsync(GitRepositorySync repo, GitSettings s, GitSyncRequest item, string instance, CancellationToken ct)
    {
        var def = ConfigCatalog.Find(item.SectionKey ?? "");
        if (def is null) return;
        var domain = MirroredDomains(s).FirstOrDefault(d => d.Id == item.DomainId);
        if (domain is null) return;
        var root = RootOf(domain);
        var v = await db.ConfigVersions.AsNoTracking().FirstOrDefaultAsync(x => x.DomainId == domain.Id && x.SectionKey == def.Key && x.Version == item.Version, ct);
        if (v is null) return;
        var versions = ReadVersions(repo, root) ?? await CurrentVersionsAsync(domain.Id, ct);
        versions[def.Key] = v.Version;
        var files = new List<GitFile> { new(repo.FilePath(def.FileName, root), v.Content), new(repo.VersionsPathFor(root), VersionsJson(versions)) };
        var author = await AuthorAsync(v.CreatedBy, s, v.CreatedAt, ct);
        var message = CommitMessage(string.IsNullOrWhiteSpace(v.Comment) ? $"{def.Title}: Version {v.Version}" : v.Comment!,
            [("TierModel-Section", def.Key), ("TierModel-Version", v.Version.ToString()), ("TierModel-Domain", domains.Multiple ? domain.Key : ""),
             ("TierModel-Instance", instance)]);
        repo.Commit(files, author, Committer(s), message);
    }

    private async Task CommitAllAsync(GitRepositorySync repo, GitSettings s, string instance, string subject, CancellationToken ct)
    {
        var snapshot = await db.ConfigSections.AsNoTracking()
            .Join(db.ConfigVersions.AsNoTracking(), c => new { c.DomainId, c.Key, V = c.CurrentVersion }, v => new { v.DomainId, Key = v.SectionKey, V = v.Version },
                (c, v) => new { c.DomainId, c.Key, v.Version, v.Content })
            .ToListAsync(ct);
        var files = new List<GitFile>();
        foreach (var domain in MirroredDomains(s))
        {
            var root = RootOf(domain);
            var versions = new Dictionary<string, int>();
            foreach (var def in ConfigCatalog.Sections)
            {
                var row = snapshot.FirstOrDefault(r => r.DomainId == domain.Id && r.Key == def.Key);
                if (row is null) continue;
                files.Add(new(repo.FilePath(def.FileName, root), row.Content));
                versions[def.Key] = row.Version;
            }
            if (versions.Count > 0) files.Add(new(repo.VersionsPathFor(root), VersionsJson(versions)));
        }
        var message = CommitMessage(subject, [("TierModel-Instance", instance)]);
        repo.Commit(files, Committer(s), Committer(s), message);
    }

    private static Dictionary<string, int>? ReadVersions(GitRepositorySync repo, string? root)
    {
        try
        {
            if (repo.ReadFile(repo.VersionsPathFor(root)) is not { } text || JsonNode.Parse(text) is not JsonObject o) return null;
            var d = new Dictionary<string, int>();
            foreach (var (k, v) in o)
                if (v is JsonValue jv && jv.TryGetValue<int>(out var n)) d[k] = n;
            return d;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private async Task<Dictionary<string, int>> CurrentVersionsAsync(int domainId, CancellationToken ct) =>
        await db.ConfigSections.AsNoTracking().Where(c => c.DomainId == domainId).ToDictionaryAsync(c => c.Key, c => c.CurrentVersion, ct);

    /// <summary>Same layout as versions.json in the export ZIP, in catalog order.</summary>
    public static string VersionsJson(IReadOnlyDictionary<string, int> versions)
    {
        var o = new JsonObject();
        foreach (var def in ConfigCatalog.Sections)
            if (versions.TryGetValue(def.Key, out var v)) o[def.Key] = v;
        return ConfigService.Serialize(o);
    }

    public static string CommitMessage(string text, IEnumerable<(string Key, string Value)> trailers)
    {
        var body = text.Replace("\r\n", "\n").Trim();
        var lines = trailers.Where(t => !string.IsNullOrWhiteSpace(t.Value)).Select(t => $"{t.Key}: {t.Value.Replace('\n', ' ').Trim()}");
        return $"{body}\n\n{string.Join("\n", lines)}\n";
    }

    private static Signature Committer(GitSettings s) =>
        new(string.IsNullOrWhiteSpace(s.AuthorName) ? "TierModel Service" : s.AuthorName, FallbackEmail(s), DateTimeOffset.UtcNow);

    private static string FallbackEmail(GitSettings s) => string.IsNullOrWhiteSpace(s.AuthorEmail) ? "tiermodel@localhost" : s.AuthorEmail.Trim();

    /// <summary>Author = the saving user: display name, e-mail when the account name is one (Entra UPN), else the fallback e-mail.</summary>
    private async Task<Signature> AuthorAsync(string username, GitSettings s, DateTimeOffset when, CancellationToken ct)
    {
        if (username == "system") return new Signature(Committer(s).Name, FallbackEmail(s), when);
        var normalized = Auth.UserService.Normalize(username);
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.NormalizedUsername == normalized, ct);
        var name = string.IsNullOrWhiteSpace(user?.DisplayName) ? username : user!.DisplayName;
        var email = username.Contains('@') && !username.Contains('\\') ? username : FallbackEmail(s);
        return new Signature(name, email, when);
    }
}

/// <summary>Background worker: drains the queue in batches, retries failed pushes with back-off. Never touches the HTTP request path.</summary>
public class GitSyncWorker(GitSyncQueue queue, GitSyncStatus status, IServiceScopeFactory scopes, WorkerHeartbeats heartbeats, ILogger<GitSyncWorker> logger) : BackgroundService
{
    public const string HeartbeatName = "GitSyncWorker";
    private static readonly TimeSpan Idle = TimeSpan.FromSeconds(30);
    private int _failures;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            heartbeats.Beat(HeartbeatName, Idle);
            var wait = status.NextRetryAt is { } next ? next - DateTimeOffset.UtcNow : Idle;
            if (wait > Idle) wait = Idle;
            if (wait < TimeSpan.Zero) wait = TimeSpan.Zero;
            var hasItems = false;
            using (var cts = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken))
            {
                cts.CancelAfter(wait);
                try
                {
                    hasItems = await queue.Reader.WaitToReadAsync(cts.Token);
                }
                catch (OperationCanceledException) when (!stoppingToken.IsCancellationRequested) { }
            }
            var retryDue = status.NextRetryAt is { } due && due <= DateTimeOffset.UtcNow;
            if (!hasItems && !retryDue) continue;

            var batch = new List<GitSyncRequest>();
            while (batch.Count < 200 && queue.Reader.TryRead(out var item)) batch.Add(item);
            if (queue.TakeOverflow()) batch.Add(new GitSyncRequest(GitSyncKind.Full));
            status.Busy = true;
            heartbeats.Busy(HeartbeatName, "Synchronisiert mit Git");
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var git = scope.ServiceProvider.GetRequiredService<GitSyncService>();
                await git.ProcessAsync(batch, stoppingToken);
                var state = await git.GetStateAsync(stoppingToken);
                var settings = await git.GetSettingsAsync(stoppingToken);
                if (settings.Enabled && !state.Conflict && state.LastErrorAt is not null && (state.LastSyncAt is null || state.LastErrorAt > state.LastSyncAt))
                {
                    _failures++;
                    // 30 s, 1 min, 2 min … at most 15 min.
                    var delay = TimeSpan.FromSeconds(Math.Min(900, 30 * Math.Pow(2, Math.Min(_failures - 1, 5))));
                    status.NextRetryAt = DateTimeOffset.UtcNow + delay;
                }
                else
                {
                    _failures = 0;
                    status.NextRetryAt = null;
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError("Git sync worker error: {Type}", ex.GetType().Name);
                status.NextRetryAt = DateTimeOffset.UtcNow + TimeSpan.FromMinutes(1);
            }
            finally
            {
                status.Busy = false;
            }
        }
    }
}

/// <summary>Health page item for the Git mirror; null (no item) while the integration is switched off.</summary>
public static class GitHealth
{
    public static async Task<HealthItemDto?> CheckAsync(GitSyncService git, CancellationToken ct)
    {
        var s = await git.GetSettingsAsync(ct);
        if (!s.Enabled) return null;
        var st = await git.GetStatusAsync(ct);
        static string F(DateTimeOffset? t) => t is { } v ? v.ToLocalTime().ToString("dd.MM.yyyy HH:mm") : "–";
        var facts = new List<HealthFactDto>
        {
            new("Repository", s.RepositoryUrl),
            new("Branch", s.Branch),
            new("Letzte Synchronisierung", F(st.LastSyncAt)),
            new("Letzter Commit", st.LastCommit is { Length: >= 7 } c ? c[..7] : "–"),
            new("Ausstehend", st.Pending.ToString()),
        };
        if (st.LastError is not null) facts.Add(new("Letzter Fehler", st.LastError));
        return st.State switch
        {
            "conflict" => new HealthItemDto("git", "Git-Anbindung", HealthService.Error,
                "Konflikt mit Änderungen im Repository – es wird nicht mehr übertragen. In den Einstellungen „Remote übernehmen“ ausführen.", facts),
            "error" => new HealthItemDto("git", "Git-Anbindung", HealthService.Warn, $"Übertragung fehlgeschlagen, wird wiederholt: {st.LastError}", facts),
            "never" => new HealthItemDto("git", "Git-Anbindung", HealthService.Warn, "Noch nicht synchronisiert.", facts),
            _ => new HealthItemDto("git", "Git-Anbindung", HealthService.Ok,
                st.Pending > 0 ? $"{st.Pending} Änderung(en) werden übertragen." : $"Synchron (zuletzt {F(st.LastSyncAt)}).", facts),
        };
    }
}
