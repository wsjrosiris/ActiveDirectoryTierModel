using System.Collections.Concurrent;
using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography.X509Certificates;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TierModel.Service.Data;
using TierModel.Service.Notifications;
using TierModel.Service.Runs;

namespace TierModel.Service;

/// <summary>Last sign of life of each background worker, shown on the health page.</summary>
public class WorkerHeartbeats
{
    public record Entry(string Name, DateTimeOffset LastBeat, TimeSpan Interval, string? Activity);

    private readonly ConcurrentDictionary<string, Entry> _entries = new();

    /// <summary>The worker's loop is alive; it will beat again within <paramref name="interval"/>.</summary>
    public void Beat(string name, TimeSpan interval) =>
        _entries[name] = new Entry(name, DateTimeOffset.UtcNow, interval, null);

    /// <summary>The worker is doing long work (e.g. executing a run); staleness is expected meanwhile.</summary>
    public void Busy(string name, string activity) =>
        _entries.AddOrUpdate(name, _ => new Entry(name, DateTimeOffset.UtcNow, TimeSpan.FromSeconds(30), activity),
            (_, e) => e with { LastBeat = DateTimeOffset.UtcNow, Activity = activity });

    public Entry? Get(string name) => _entries.GetValueOrDefault(name);
}

/// <summary>The HTTPS certificate Kestrel serves, when the service loaded it itself (thumbprint in appsettings.json).</summary>
public class ServerCertificateSource(X509Certificate2? certificate, string description)
{
    public X509Certificate2? Certificate { get; } = certificate;
    public string Description { get; } = description;
}

public record HealthFactDto(string Label, string Value);

public record HealthItemDto(string Key, string Title, string Status, string Message, List<HealthFactDto> Facts);

public record HealthDetailsDto(string Status, DateTimeOffset CheckedAt, string Version, List<HealthItemDto> Items);

public class HealthService(
    AppDbContext db,
    IOptions<TierModelOptions> options,
    IConfiguration configuration,
    WorkerHeartbeats heartbeats,
    ServerCertificateSource certificateSource,
    SettingsService settings,
    NotificationQueue notifications,
    ILogger<HealthService> logger,
    Domains.DomainRegistry domains,
    GitSync.GitSyncService? git = null)
{
    public const string Ok = "ok", Warn = "warn", Error = "error";
    public const int CertificateWarnDays = 30;
    private const string CertificateWarnedKey = "certificateWarnedAt";

    private static readonly DateTimeOffset ProcessStarted = new(Process.GetCurrentProcess().StartTime.ToUniversalTime());
    private static readonly System.Globalization.CultureInfo De = System.Globalization.CultureInfo.GetCultureInfo("de-DE");
    private static (DateTimeOffset At, string Path, string? Version, string? Error)? _pwshCache;
    private static readonly SemaphoreSlim PwshLock = new(1, 1);

    public static string AppVersion =>
        (Assembly.GetEntryAssembly() ?? typeof(HealthService).Assembly).GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0]
        ?? typeof(HealthService).Assembly.GetName().Version?.ToString() ?? "?";

    public async Task<HealthDetailsDto> GetAsync(CancellationToken ct)
    {
        var items = new List<HealthItemDto> { Application(), Certificate() };
        items.Add(await Safe("database", "Datenbank", () => DatabaseAsync(ct)));
        items.Add(await Safe("queue", "Warteschlange", () => QueueAsync(ct)));
        items.Add(await Safe("lastRuns", "Letzte erfolgreiche Läufe", () => LastRunsAsync(ct)));
        if (domains.Multiple) items.Add(await Safe("domains", "Domänen", () => DomainsAsync(ct)));
        items.Add(WorkPath());
        items.Add(await PowerShellAsync(ct));
        items.Add(Framework());
        items.Add(Workers());
        items.Add(DataProtection());
        items.Add(await Safe("changelog", "Änderungsprotokoll", () => ChangeLogChainAsync(ct)));
        if (git is not null && await GitSync.GitHealth.CheckAsync(git, ct) is { } gitItem) items.Add(gitItem);
        var overall = items.Any(i => i.Status == Error) ? Error : items.Any(i => i.Status == Warn) ? Warn : Ok;
        return new HealthDetailsDto(overall, DateTimeOffset.UtcNow, AppVersion, items);
    }

    /// <summary>Hash chain of the change log (roadmap 23), verified at most every 10 minutes.</summary>
    private async Task<HealthItemDto> ChangeLogChainAsync(CancellationToken ct)
    {
        var r = await ChangeLogChain.VerifyCachedAsync(db, ct: ct);
        var facts = new List<HealthFactDto>
        {
            new("Einträge geprüft", r.Count.ToString("N0", De)),
            new("Letzter Eintrag", r.LastId is { } id ? $"#{id}" : "–"),
            new("Ketten-Ende (SHA-256)", r.LastHash ?? "–"),
            new("Geprüft", Format(r.CheckedAt)),
        };
        if (r.Ok)
            return new HealthItemDto("changelog", "Änderungsprotokoll", Ok,
                $"Hash-Kette vollständig ({r.Count:N0} Einträge). Das Ketten-Ende regelmäßig notieren: damit fällt auch ein Austausch der ganzen Tabelle auf.", facts);
        facts.Insert(0, new("Unterbrochen bei", $"#{r.BrokenAtId}"));
        return new HealthItemDto("changelog", "Änderungsprotokoll", Error, $"Hash-Kette unterbrochen bei Eintrag #{r.BrokenAtId}: {r.Problem}.", facts);
    }

    private async Task<HealthItemDto> Safe(string key, string title, Func<Task<HealthItemDto>> check)
    {
        try
        {
            return await check();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Health check {Key} failed", key);
            return new HealthItemDto(key, title, Error, $"Prüfung fehlgeschlagen: {ex.GetBaseException().Message}", []);
        }
    }

    private static HealthItemDto Application()
    {
        var uptime = DateTimeOffset.UtcNow - ProcessStarted;
        return new HealthItemDto("app", "Anwendung", Ok, $"TierModel Service {AppVersion} läuft seit {FormatDuration(uptime)}.",
        [
            new("Version", AppVersion),
            new("Gestartet", Format(ProcessStarted)),
            new("Laufzeit", FormatDuration(uptime)),
            new(".NET", Environment.Version.ToString()),
            new("Betriebssystem", System.Runtime.InteropServices.RuntimeInformation.OSDescription),
            new("Rechner", Environment.MachineName),
        ]);
    }

    /// <summary>The configured HTTPS certificate: loaded by thumbprint, or a certificate file from the Kestrel section.</summary>
    public (X509Certificate2? Certificate, string Source) ResolveCertificate()
    {
        if (certificateSource.Certificate is { } loaded) return (loaded, certificateSource.Description);
        var paths = new List<(string Path, string? Password)>();
        var kestrel = configuration.GetSection("Kestrel");
        void AddFrom(IConfigurationSection c)
        {
            if (c["Path"] is { Length: > 0 } p) paths.Add((p, c["Password"]));
        }
        AddFrom(kestrel.GetSection("Certificates:Default"));
        foreach (var endpoint in kestrel.GetSection("Endpoints").GetChildren()) AddFrom(endpoint.GetSection("Certificate"));
        foreach (var (path, password) in paths)
        {
            try
            {
                var full = Path.GetFullPath(path, AppContext.BaseDirectory);
                var cert = Path.GetExtension(full).ToLowerInvariant() is ".pfx" or ".p12"
                    ? X509CertificateLoader.LoadPkcs12FromFile(full, password)
                    : X509CertificateLoader.LoadCertificateFromFile(full);
                return (cert, $"Datei {full}");
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Certificate file {Path} could not be read", path);
            }
        }
        return (null, certificateSource.Description);
    }

    private bool UsesHttps() =>
        configuration.GetSection("Kestrel:Endpoints").GetChildren().Any(e => e["Url"]?.StartsWith("https", StringComparison.OrdinalIgnoreCase) == true)
        || (configuration["urls"] ?? configuration["ASPNETCORE_URLS"] ?? "").Contains("https", StringComparison.OrdinalIgnoreCase);

    private HealthItemDto Certificate()
    {
        const string title = "HTTPS-Zertifikat";
        var (cert, source) = ResolveCertificate();
        if (cert is null)
        {
            return UsesHttps()
                ? new HealthItemDto("certificate", title, Warn,
                    "Kein Zertifikat hinterlegt – Kestrel verwendet ein Standard- bzw. Entwicklungszertifikat. Fingerabdruck in appsettings.json eintragen (TierModel:CertificateThumbprint).",
                    [new("Quelle", source)])
                : new HealthItemDto("certificate", title, Warn,
                    "Der Dienst ist nur über HTTP erreichbar (Entwicklung). Für den Betrieb ein HTTPS-Zertifikat einrichten.",
                    [new("Quelle", source)]);
        }
        var notAfter = new DateTimeOffset(cert.NotAfter.ToUniversalTime());
        var days = (int)Math.Floor((notAfter - DateTimeOffset.UtcNow).TotalDays);
        var status = days < 0 ? Error : days < CertificateWarnDays ? Warn : Ok;
        var message = days < 0 ? $"Das Zertifikat ist seit {Format(notAfter)} abgelaufen."
            : days < CertificateWarnDays ? $"Das Zertifikat läuft in {days} Tag(en) ab ({Format(notAfter)}). Bitte rechtzeitig erneuern."
            : $"Gültig bis {Format(notAfter)} (noch {days} Tage).";
        return new HealthItemDto("certificate", title, status, message,
        [
            new("Antragsteller", cert.Subject),
            new("Aussteller", cert.Issuer),
            new("Fingerabdruck", cert.Thumbprint),
            new("Gültig ab", Format(new DateTimeOffset(cert.NotBefore.ToUniversalTime()))),
            new("Gültig bis", Format(notAfter)),
            new("Verbleibende Tage", days.ToString()),
            new("Quelle", source),
        ]);
    }

    private async Task<HealthItemDto> DatabaseAsync(CancellationToken ct)
    {
        var conn = db.Database.GetDbConnection();
        if (conn.State != System.Data.ConnectionState.Open) await db.Database.OpenConnectionAsync(ct);
        string version;
        long size;
        string name;
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT current_setting('server_version'), pg_database_size(current_database()), current_database()";
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            await reader.ReadAsync(ct);
            version = reader.GetString(0);
            size = reader.GetInt64(1);
            name = reader.GetString(2);
        }
        var applied = (await db.Database.GetAppliedMigrationsAsync(ct)).ToList();
        var pending = (await db.Database.GetPendingMigrationsAsync(ct)).ToList();
        var status = pending.Count > 0 ? Warn : Ok;
        var message = pending.Count > 0
            ? $"{pending.Count} Migration(en) ausstehend – Dienst neu starten, damit sie angewendet werden."
            : $"PostgreSQL {version.Split(' ')[0]}, {FormatBytes(size)}, alle Migrationen angewendet.";
        return new HealthItemDto("database", "Datenbank", status, message,
        [
            new("Server-Version", version),
            new("Datenbank", name),
            new("Größe", FormatBytes(size)),
            new("Angewendete Migrationen", applied.Count.ToString()),
            new("Ausstehende Migrationen", pending.Count.ToString()),
            new("Letzte Migration", applied.LastOrDefault() ?? "–"),
        ]);
    }

    private async Task<HealthItemDto> QueueAsync(CancellationToken ct)
    {
        var queued = await db.Runs.CountAsync(r => r.Status == RunStatus.Queued, ct);
        var running = await db.Runs.CountAsync(r => r.Status == RunStatus.Running, ct);
        var awaiting = await db.Runs.CountAsync(r => r.Status == RunStatus.AwaitingApproval, ct);
        var oldest = await db.Runs.Where(r => r.Status == RunStatus.Queued).OrderBy(r => r.Id).Select(r => (DateTimeOffset?)(r.ApprovedAt ?? r.CreatedAt)).FirstOrDefaultAsync(ct);
        var age = oldest is { } o ? DateTimeOffset.UtcNow - o : (TimeSpan?)null;
        // Runs execute one at a time, so a waiting run is normal while another is running.
        var status = age is { } a && running == 0 && a > TimeSpan.FromMinutes(5) ? Error
            : age is { } b && b > TimeSpan.FromHours(4) ? Warn : Ok;
        var message = status == Error ? $"Ein Lauf wartet seit {FormatDuration(age!.Value)}, aber keiner wird ausgeführt – Worker prüfen."
            : status == Warn ? $"Der älteste Lauf wartet seit {FormatDuration(age!.Value)}."
            : queued + running == 0 ? "Keine Läufe in der Warteschlange." : $"{running} laufend, {queued} wartend.";
        return new HealthItemDto("queue", "Warteschlange", status, message,
        [
            new("Laufend", running.ToString()),
            new("Wartend", queued.ToString()),
            new("Warten auf Freigabe", awaiting.ToString()),
            new("Ältester wartender Lauf", age is null ? "–" : $"seit {FormatDuration(age.Value)}"),
        ]);
    }

    /// <summary>Several domains (roadmap 17): the last successful audit per enabled domain.</summary>
    private async Task<HealthItemDto> DomainsAsync(CancellationToken ct)
    {
        var facts = new List<HealthFactDto>();
        var stale = 0;
        foreach (var d in domains.All)
        {
            if (!d.Enabled)
            {
                facts.Add(new(d.DisplayName, "deaktiviert"));
                continue;
            }
            var id = d.Id;
            var audit = await db.Runs.Where(r => r.DomainId == id && r.Kind == RunKind.Audit && r.Status == RunStatus.Succeeded).OrderByDescending(r => r.Id)
                .Select(r => r.FinishedAt).FirstOrDefaultAsync(ct);
            if (audit is null || DateTimeOffset.UtcNow - audit > TimeSpan.FromDays(7)) stale++;
            facts.Add(new(d.DisplayName, $"{(d.PreferredDc.Length == 0 ? "kein DC" : d.PreferredDc)} · letztes Audit {(audit is { } a ? Format(a) : "noch keins")}"));
        }
        var enabled = domains.All.Count(d => d.Enabled);
        return new HealthItemDto("domains", "Domänen", stale > 0 ? Warn : Ok,
            stale > 0 ? $"{stale} von {enabled} aktiven Domänen ohne erfolgreiches Audit in den letzten 7 Tagen." : $"{enabled} aktive Domänen, alle mit aktuellem Audit.",
            facts);
    }

    private async Task<HealthItemDto> LastRunsAsync(CancellationToken ct)
    {
        var audit = await db.Runs.Where(r => r.Kind == RunKind.Audit && r.Status == RunStatus.Succeeded).OrderByDescending(r => r.Id)
            .Select(r => new { r.Id, r.FinishedAt }).FirstOrDefaultAsync(ct);
        var plan = await db.Runs.Where(r => r.Kind == RunKind.Deploy && r.Mode == RunMode.Plan && r.Status == RunStatus.Succeeded).OrderByDescending(r => r.Id)
            .Select(r => new { r.Id, r.FinishedAt }).FirstOrDefaultAsync(ct);
        var apply = await db.Runs.Where(r => r.Kind == RunKind.Deploy && r.Mode == RunMode.Apply && r.Status == RunStatus.Succeeded).OrderByDescending(r => r.Id)
            .Select(r => new { r.Id, r.FinishedAt }).FirstOrDefaultAsync(ct);
        var monitor = await db.Runs.Where(r => r.Kind == RunKind.Monitor && r.Status == RunStatus.Succeeded).OrderByDescending(r => r.Id)
            .Select(r => new { r.Id, r.FinishedAt }).FirstOrDefaultAsync(ct);
        var since = DateTimeOffset.UtcNow.AddDays(-1);
        var failed24h = await db.Runs.CountAsync(r => r.Status == RunStatus.Failed && r.FinishedAt >= since, ct);
        var auditAge = audit?.FinishedAt is { } at ? DateTimeOffset.UtcNow - at : (TimeSpan?)null;
        var status = audit is null || auditAge > TimeSpan.FromDays(7) || failed24h > 0 ? Warn : Ok;
        var message = audit is null ? "Noch kein erfolgreiches Audit – Abweichungen vom Soll-Zustand werden nicht erkannt."
            : auditAge > TimeSpan.FromDays(7) ? $"Das letzte erfolgreiche Audit liegt {FormatDuration(auditAge!.Value)} zurück. Einen Zeitplan einrichten."
            : failed24h > 0 ? (failed24h == 1 ? "1 fehlgeschlagener Lauf" : $"{failed24h} fehlgeschlagene Läufe") + " in den letzten 24 Stunden."
            : $"Letztes erfolgreiches Audit vor {FormatDuration(auditAge!.Value)}.";
        string Describe(long? id, DateTimeOffset? at) => id is null ? "noch keiner" : $"#{id} · {(at is { } t ? Format(t) : "–")}";
        return new HealthItemDto("lastRuns", "Letzte erfolgreiche Läufe", status, message,
        [
            new("Audit", Describe(audit?.Id, audit?.FinishedAt)),
            new("Deploy (Planung)", Describe(plan?.Id, plan?.FinishedAt)),
            new("Deploy (Anwenden)", Describe(apply?.Id, apply?.FinishedAt)),
            new("Überwachung", Describe(monitor?.Id, monitor?.FinishedAt)),
            new("Fehlgeschlagen (24 Std.)", failed24h.ToString()),
        ]);
    }

    private HealthItemDto WorkPath()
    {
        var path = options.Value.WorkPath;
        if (!Directory.Exists(path))
            return new HealthItemDto("workPath", "Arbeitsverzeichnis", Error, "Das Arbeitsverzeichnis existiert nicht.", [new("Pfad", path)]);
        try
        {
            var drive = new DriveInfo(Path.GetFullPath(path));
            // On Linux DriveInfo reports the file system root; good enough for a free-space figure.
            var free = drive.AvailableFreeSpace;
            var total = drive.TotalSize;
            var pct = total > 0 ? free * 100.0 / total : 100;
            var status = free < 1L << 30 ? Error : free < 5L << 30 || pct < 10 ? Warn : Ok;
            var message = status == Ok ? $"{FormatBytes(free)} frei ({pct.ToString("0", De)} %)."
                : $"Nur noch {FormatBytes(free)} frei ({pct.ToString("0", De)} %) – Aufbewahrungsdauer verkürzen oder Platz schaffen.";
            var runs = Workspace.RunsRoot(options.Value);
            return new HealthItemDto("workPath", "Arbeitsverzeichnis", status, message,
            [
                new("Pfad", path),
                new("Frei", FormatBytes(free)),
                new("Gesamt", FormatBytes(total)),
                new("Laufordner", Directory.Exists(runs) ? Directory.EnumerateDirectories(runs).Count().ToString() : "0"),
            ]);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
        {
            return new HealthItemDto("workPath", "Arbeitsverzeichnis", Warn, $"Freier Speicherplatz konnte nicht ermittelt werden: {ex.Message}", [new("Pfad", path)]);
        }
    }

    private async Task<HealthItemDto> PowerShellAsync(CancellationToken ct)
    {
        var pwsh = options.Value.PwshPath;
        var (version, error) = await PwshVersionAsync(pwsh, ct);
        if (version is null)
            return new HealthItemDto("pwsh", "PowerShell", Error, $"PowerShell konnte nicht gestartet werden: {error}", [new("Pfad", pwsh)]);
        var major = int.TryParse(version.Split('.')[0], out var m) ? m : 0;
        return new HealthItemDto("pwsh", "PowerShell", major >= 7 ? Ok : Warn,
            major >= 7 ? $"PowerShell {version} ist einsatzbereit." : $"PowerShell {version} ist zu alt – benötigt wird Version 7 oder neuer.",
            [new("Pfad", pwsh), new("Version", version)]);
    }

    /// <summary>Runs pwsh once to read its version; cached for ten minutes (starting pwsh takes a moment).</summary>
    public static async Task<(string? Version, string? Error)> PwshVersionAsync(string pwsh, CancellationToken ct)
    {
        if (_pwshCache is { } c && c.Path == pwsh && DateTimeOffset.UtcNow - c.At < TimeSpan.FromMinutes(10)) return (c.Version, c.Error);
        await PwshLock.WaitAsync(ct);
        try
        {
            if (_pwshCache is { } c2 && c2.Path == pwsh && DateTimeOffset.UtcNow - c2.At < TimeSpan.FromMinutes(10)) return (c2.Version, c2.Error);
            string? version = null, error = null;
            try
            {
                var psi = new ProcessStartInfo(pwsh)
                {
                    RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true,
                    UseShellExecute = false, CreateNoWindow = true,
                };
                foreach (var a in new[] { "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.ToString()" }) psi.ArgumentList.Add(a);
                psi.Environment["POWERSHELL_TELEMETRY_OPTOUT"] = "1";
                psi.Environment["POWERSHELL_UPDATECHECK"] = "Off";
                using var p = Process.Start(psi) ?? throw new InvalidOperationException("Prozess wurde nicht gestartet.");
                p.StandardInput.Close();
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeout.CancelAfter(TimeSpan.FromSeconds(15));
                var output = p.StandardOutput.ReadToEndAsync(timeout.Token);
                try
                {
                    await p.WaitForExitAsync(timeout.Token);
                }
                catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                {
                    try { p.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
                    throw new TimeoutException("Keine Antwort innerhalb von 15 Sekunden.");
                }
                var text = (await output).Trim().Split('\n').Select(l => l.Trim()).LastOrDefault(l => l.Length > 0);
                if (p.ExitCode != 0 || text is null || !char.IsDigit(text[0])) error = $"Unerwartete Ausgabe (Exit-Code {p.ExitCode}): {text ?? "leer"}";
                else version = text;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                error = ex.Message;
            }
            _pwshCache = (DateTimeOffset.UtcNow, pwsh, version, error);
            return (version, error);
        }
        finally
        {
            PwshLock.Release();
        }
    }

    private HealthItemDto Framework()
    {
        var path = options.Value.FrameworkPath;
        var files = new[] { "Deploy-TierModel.ps1", "Audit-TierModel.ps1" };
        var missing = files.Where(f => !File.Exists(Path.Combine(path, f))).ToList();
        if (!Directory.Exists(Path.Combine(path, "modules"))) missing.Add("modules\\");
        var facts = new List<HealthFactDto> { new("Pfad", path) };
        var deploy = Path.Combine(path, "Deploy-TierModel.ps1");
        if (File.Exists(deploy)) facts.Add(new("Deploy-TierModel.ps1 geändert", Format(new DateTimeOffset(File.GetLastWriteTimeUtc(deploy), TimeSpan.Zero))));
        return missing.Count == 0
            ? new HealthItemDto("framework", "Framework", Ok, "Deploy- und Audit-Skripte sind vorhanden.", facts)
            : new HealthItemDto("framework", "Framework", Error, $"Im Framework-Pfad fehlt: {string.Join(", ", missing)}.", facts);
    }

    private HealthItemDto Workers()
    {
        var workers = new (string Name, string Title)[]
        {
            (RunWorker.HeartbeatName, "Ausführung von Läufen"),
            (ScheduleWorker.HeartbeatName, "Zeitpläne und Aufräumen"),
            (NotificationWorker.HeartbeatName, "Benachrichtigungen"),
            (Jit.JitWorker.HeartbeatName, "Befristeter Zugriff (Ablauf)"),
        };
        var facts = new List<HealthFactDto>();
        var worst = Ok;
        var problems = new List<string>();
        foreach (var (name, title) in workers)
        {
            var e = heartbeats.Get(name);
            string state;
            string status;
            if (e is null)
            {
                status = Warn;
                state = "noch keine Rückmeldung";
            }
            else
            {
                var age = DateTimeOffset.UtcNow - e.LastBeat;
                status = e.Activity is not null ? Ok : age > e.Interval * 10 ? Error : age > e.Interval * 3 ? Warn : Ok;
                state = e.Activity ?? (status == Ok ? $"aktiv (vor {FormatDuration(age)})" : $"keine Rückmeldung seit {FormatDuration(age)}");
            }
            if (status != Ok) problems.Add(title);
            if (status == Error || (status == Warn && worst == Ok)) worst = status;
            facts.Add(new(title, state));
        }
        return new HealthItemDto("workers", "Hintergrunddienste", worst,
            problems.Count == 0 ? "Alle Hintergrunddienste arbeiten." : $"Auffällig: {string.Join(", ", problems)}.", facts);
    }

    private HealthItemDto DataProtection()
    {
        var path = Path.Combine(options.Value.WorkPath, "keys");
        var keys = Directory.Exists(path) ? Directory.EnumerateFiles(path, "key-*.xml").Count() : 0;
        return keys > 0
            ? new HealthItemDto("dataProtection", "Schlüssel für Anmeldung und Geheimnisse", Ok,
                $"{keys} Schlüssel vorhanden{(OperatingSystem.IsWindows() ? ", mit DPAPI geschützt" : "")}. Beim Umzug mitsichern, sonst sind gespeicherte Geheimnisse unlesbar.",
                [new("Pfad", path), new("Schlüssel", keys.ToString())])
            : new HealthItemDto("dataProtection", "Schlüssel für Anmeldung und Geheimnisse", Warn,
                "Es wurden noch keine Schlüssel gespeichert – Anmeldungen überstehen keinen Neustart.", [new("Pfad", path)]);
    }

    /// <summary>Daily: warns via notification channels when the HTTPS certificate expires within 30 days (at most once a day).</summary>
    public async Task CheckCertificateExpiryAsync(CancellationToken ct)
    {
        var (cert, _) = ResolveCertificate();
        if (cert is null) return;
        var notAfter = new DateTimeOffset(cert.NotAfter.ToUniversalTime());
        var days = (int)Math.Floor((notAfter - DateTimeOffset.UtcNow).TotalDays);
        if (days >= CertificateWarnDays) return;
        var last = await settings.GetValueAsync(CertificateWarnedKey, ct);
        if (DateTimeOffset.TryParse(last, out var at) && DateTimeOffset.UtcNow - at < TimeSpan.FromHours(23)) return;
        var s = await settings.GetAsync(ct);
        notifications.Enqueue(NotificationService.CertificateMessage(cert.Subject, cert.Thumbprint, notAfter, days, s.PublicBaseUrl));
        await settings.SetValueAsync(CertificateWarnedKey, DateTimeOffset.UtcNow.ToString("O"), ct);
        logger.LogWarning("HTTPS certificate {Thumbprint} expires in {Days} day(s)", cert.Thumbprint, days);
    }

    private static string Format(DateTimeOffset t) => t.ToLocalTime().ToString("dd.MM.yyyy HH:mm");

    public static string FormatDuration(TimeSpan t) => t.TotalMinutes < 1 ? $"{Math.Max(0, (int)t.TotalSeconds)} s"
        : t.TotalHours < 1 ? $"{(int)t.TotalMinutes} min"
        : t.TotalDays < 1 ? $"{(int)t.TotalHours} Std. {t.Minutes} min"
        : $"{(int)t.TotalDays} Tag(en) {t.Hours} Std.";

    public static string FormatBytes(long bytes) => bytes switch
    {
        >= 1L << 40 => (bytes / (double)(1L << 40)).ToString("0.0", De) + " TB",
        >= 1L << 30 => (bytes / (double)(1L << 30)).ToString("0.0", De) + " GB",
        >= 1L << 20 => (bytes / (double)(1L << 20)).ToString("0.0", De) + " MB",
        >= 1L << 10 => (bytes / 1024.0).ToString("0", De) + " KB",
        _ => $"{bytes} B",
    };
}
