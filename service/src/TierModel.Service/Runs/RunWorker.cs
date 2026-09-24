using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TierModel.Service.Config;
using TierModel.Service.Data;
using TierModel.Service.Notifications;

namespace TierModel.Service.Runs;

/// <summary>
/// Executes queued runs one at a time. Active Directory changes must not interleave,
/// so there is deliberately no parallelism.
/// </summary>
public class RunWorker(IServiceScopeFactory scopes, RunQueue queue, NotificationQueue notifications, IOptions<TierModelOptions> options, ILogger<RunWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await RecoverAsync(stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            long? next;
            try
            {
                next = await ClaimNextAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Could not read the run queue");
                next = null;
            }

            if (next is { } id)
            {
                try
                {
                    await ExecuteRunAsync(id, stoppingToken);
                }
                catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
                {
                    // Never let a database hiccup stop the Windows service; the run is marked failed on a best-effort basis.
                    logger.LogError(ex, "Run {RunId} could not be completed", id);
                    await MarkFailedAsync(id, "Interner Fehler beim Abschluss des Laufs: " + ex.Message);
                }
                continue;
            }
            try
            {
                await queue.WaitAsync(TimeSpan.FromSeconds(10), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    /// <summary>Runs left in "Running" by a crash or restart can never complete.</summary>
    private async Task RecoverAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var n = await db.Runs.Where(r => r.Status == RunStatus.Running).ExecuteUpdateAsync(u => u
            .SetProperty(r => r.Status, RunStatus.Failed)
            .SetProperty(r => r.FinishedAt, DateTimeOffset.UtcNow)
            .SetProperty(r => r.Message, "Abgebrochen: Der Dienst wurde während des Laufs beendet."), ct);
        if (n > 0) logger.LogWarning("Marked {Count} interrupted run(s) as failed", n);
    }

    private async Task MarkFailedAsync(long id, string message)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Runs.Where(r => r.Id == id && (r.Status == RunStatus.Running || r.Status == RunStatus.Queued)).ExecuteUpdateAsync(u => u
                .SetProperty(r => r.Status, RunStatus.Failed)
                .SetProperty(r => r.FinishedAt, DateTimeOffset.UtcNow)
                .SetProperty(r => r.Message, message));
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Run {RunId} could not be marked as failed", id);
        }
    }

    private async Task<long?> ClaimNextAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var id = await db.Runs.Where(r => r.Status == RunStatus.Queued).OrderBy(r => r.Id).Select(r => (long?)r.Id).FirstOrDefaultAsync(ct);
        if (id is null) return null;
        var claimed = await db.Runs.Where(r => r.Id == id && r.Status == RunStatus.Queued).ExecuteUpdateAsync(u => u
            .SetProperty(r => r.Status, RunStatus.Running)
            .SetProperty(r => r.StartedAt, DateTimeOffset.UtcNow), ct);
        return claimed == 1 ? id : null;
    }

    private async Task ExecuteRunAsync(long id, CancellationToken stoppingToken)
    {
        var o = options.Value;
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var config = scope.ServiceProvider.GetRequiredService<ConfigService>();
        var run = await db.Runs.FirstAsync(r => r.Id == id, CancellationToken.None);

        using var cancel = queue.Register(id);
        using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(o.RunTimeoutMinutes));
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancel.Token, timeout.Token, stoppingToken);

        var log = new RunLogWriter(scopes, id);
        var status = RunStatus.Failed;
        string? message = null;
        try
        {
            log.System($"Lauf #{id} gestartet: {Describe(run)}");

            // Runs approved under the four-eyes principle execute exactly the configuration that was reviewed.
            var pinned = run.ConfigVersions is { } pinnedJson ? JsonSerializer.Deserialize<Dictionary<string, int>>(pinnedJson) : null;
            var snapshot = pinned is null ? await config.SnapshotAsync(linked.Token) : await config.SnapshotAsync(pinned, linked.Token);
            if (pinned is not null) log.System("Freigegebene Konfigurationsversionen werden verwendet" + (run.ApprovedBy is null ? "." : $" (freigegeben von {run.ApprovedBy})."));
            run.ConfigVersions = JsonSerializer.Serialize(snapshot.ToDictionary(s => s.Def.Key, s => s.Version));
            await db.SaveChangesAsync(CancellationToken.None);
            log.System("Konfiguration: " + string.Join(", ", snapshot.Select(s => $"{s.Def.Key} v{s.Version}")));

            var issues = ConfigValidator.Validate(snapshot.ToDictionary(s => s.Def.Key, s => JsonNode.Parse(s.Content)));
            foreach (var issue in issues.Where(i => i.Severity == "Error"))
                log.System($"Validierungsfehler [{issue.Section}] {issue.Message}{(issue.Item is null ? "" : $" ({issue.Item})")}", "error");
            var errors = issues.Count(i => i.Severity == "Error");
            var warnings = issues.Count - errors;
            if (warnings > 0) log.System($"{warnings} Validierungshinweis(e) – Details unter Konfiguration › Validierung.", "warn");
            if (errors > 0 && run.Mode == RunMode.Apply)
                throw new InvalidOperationException($"{errors} Validierungsfehler in der Konfiguration – Anwenden wurde nicht gestartet.");

            var workDir = Workspace.Create(o, id, snapshot);
            log.System($"Arbeitsverzeichnis: {workDir}");

            var wrapper = Path.Combine(workDir, "run.ps1");
            await File.WriteAllTextAsync(wrapper, BuildWrapperScript(run, workDir), new UTF8Encoding(encoderShouldEmitUTF8Identifier: true), linked.Token);
            log.System($"Aufruf: {(run.Kind == RunKind.Deploy ? "Deploy" : "Audit")}-TierModel.ps1 {string.Join(' ', ScriptParameters(run, workDir))}");
            var exitCode = await RunPowerShellAsync(o.PwshPath, workDir, PwshArguments(wrapper), log, linked.Token);
            run.ExitCode = exitCode;

            if (run.Kind == RunKind.Audit) ReadAuditReport(run, workDir, log);

            run.ErrorCount ??= log.ErrorLines;
            status = exitCode == 0 ? RunStatus.Succeeded : RunStatus.Failed;
            message = exitCode == 0
                ? run.Kind == RunKind.Audit
                    ? run.DriftCount is > 0 ? $"{run.DriftCount} Abweichung(en) gefunden" : "Keine Abweichungen"
                    : run.Mode == RunMode.Apply ? "Bereitstellung abgeschlossen" : "Planung abgeschlossen"
                : $"PowerShell wurde mit Code {exitCode} beendet";
        }
        catch (OperationCanceledException) when (cancel.IsCancellationRequested)
        {
            status = RunStatus.Cancelled;
            message = "Vom Benutzer abgebrochen";
        }
        catch (OperationCanceledException) when (timeout.IsCancellationRequested)
        {
            message = $"Zeitüberschreitung nach {o.RunTimeoutMinutes} Minuten";
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            message = "Abgebrochen: Der Dienst wurde beendet.";
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Run {RunId} failed", id);
            message = ex.Message;
        }
        finally
        {
            queue.Unregister(id);
        }

        log.System(message ?? status.ToString(), status == RunStatus.Succeeded ? "success" : status == RunStatus.Cancelled ? "warn" : "error");
        await log.DisposeAsync();

        run.Status = status;
        run.Message = message;
        run.FinishedAt = DateTimeOffset.UtcNow;
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await db.SaveChangesAsync(CancellationToken.None);
                break;
            }
            catch (Exception ex) when (attempt < 5)
            {
                logger.LogWarning(ex, "Saving the result of run {RunId} failed (attempt {Attempt}), retrying", id, attempt);
                await Task.Delay(TimeSpan.FromSeconds(2 * attempt), CancellationToken.None);
            }
        }
        logger.LogInformation("Run {RunId} finished with {Status}: {Message}", id, status, message);
        foreach (var e in NotificationService.EventsFor(run)) notifications.Enqueue(e, id);
    }

    private static string Describe(Run r)
    {
        var what = r.Kind == RunKind.Audit ? "Audit" : r.Mode == RunMode.Apply ? "Deploy – ANWENDEN" : "Deploy – Planung";
        var includes = RunSummaryDto.IncludeList(r.IncludeMsa, r.IncludeGmsa, r.IncludeDmsa, r.IncludeWinLaps);
        return $"{what}, Bereich {r.Scope?.ToString() ?? "–"}{(includes.Length > 0 ? " + " + string.Join(", ", includes) : "")}, DC {r.PreferredDc}, angefordert von {r.RequestedBy}";
    }

    public static List<string> PwshArguments(string wrapper) =>
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", wrapper];

    /// <summary>Single-quoted PowerShell string literal.</summary>
    private static string Quote(string value) => "'" + value.Replace("'", "''") + "'";

    /// <summary>Parameters passed to Deploy-/Audit-TierModel.ps1. Values are validated before they get here.</summary>
    public static List<string> ScriptParameters(Run run, string workDir)
    {
        var p = new List<string> { "-PreferredDc", Quote(run.PreferredDc) };
        if (run.Scope is { } scope) p.Add("-" + scope);
        if (run.IncludeMsa) p.Add("-IncludeMsa");
        if (run.IncludeGmsa) p.Add("-IncludeGmsa");
        if (run.IncludeDmsa) p.Add("-IncludeDmsa");
        if (run.IncludeWinLaps) p.Add("-IncludeWinLaps");
        p.AddRange(["-AdmlLanguage", Quote(run.AdmlLanguage)]);

        var outDir = Quote(Path.Combine(workDir, "out"));
        if (run.Kind == RunKind.Deploy)
        {
            if (run.Mode == RunMode.Apply) p.AddRange(["-ConfirmApply", "-Unattended"]);
            p.AddRange(["-Logging", "-LogPath", outDir, "-OutputFileBase", "deploy"]);
        }
        else
        {
            p.AddRange(["-OutputFormat", "Json", "-LogPath", outDir, "-OutputFileBase", "audit"]);
        }
        return p;
    }

    /// <summary>
    /// run.ps1 in the working copy: switches the console to UTF-8 (a service's hidden console would
    /// otherwise use the OEM code page and garble umlauts and symbols) and calls the framework script.
    /// It stays in the run folder, so an administrator can re-run exactly the same call for troubleshooting.
    /// </summary>
    public static string BuildWrapperScript(Run run, string workDir)
    {
        var script = run.Kind == RunKind.Deploy ? "Deploy-TierModel.ps1" : "Audit-TierModel.ps1";
        return $"""
            # Generated by TierModel Service for run #{run.Id} ({run.Kind}, requested by {run.RequestedBy.ReplaceLineEndings(" ")}).
            [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
            $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
            $global:LASTEXITCODE = 0
            & (Join-Path $PSScriptRoot '{script}') {string.Join(' ', ScriptParameters(run, workDir))}
            exit $LASTEXITCODE

            """;
    }

    private static async Task<int> RunPowerShellAsync(string pwsh, string workDir, List<string> args, RunLogWriter log, CancellationToken ct)
    {
        var psi = new ProcessStartInfo(pwsh)
        {
            WorkingDirectory = workDir,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);
        psi.Environment["NO_COLOR"] = "1";
        psi.Environment["TERM"] = "dumb";
        psi.Environment["POWERSHELL_TELEMETRY_OPTOUT"] = "1";
        psi.Environment["POWERSHELL_UPDATECHECK"] = "Off";

        log.System($"> {pwsh} {string.Join(' ', args.Select(a => a.Contains(' ') ? $"\"{a}\"" : a))}");
        using var p = Process.Start(psi) ?? throw new InvalidOperationException($"'{pwsh}' konnte nicht gestartet werden.");
        p.StandardInput.Close(); // any unexpected Read-Host fails fast instead of hanging

        var stdout = PumpAsync(p.StandardOutput, "stdout", log);
        var stderr = PumpAsync(p.StandardError, "stderr", log);
        await using (ct.Register(() =>
        {
            try { p.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
        }))
        {
            await p.WaitForExitAsync(CancellationToken.None);
            await Task.WhenAll(stdout, stderr);
        }
        ct.ThrowIfCancellationRequested();
        return p.ExitCode;
    }

    private static async Task PumpAsync(StreamReader reader, string stream, RunLogWriter log)
    {
        while (await reader.ReadLineAsync() is { } line)
            log.Add(stream, line);
    }

    private static void ReadAuditReport(Run run, string workDir, RunLogWriter log)
    {
        var report = new DirectoryInfo(Path.Combine(workDir, "out"))
            .EnumerateFiles("audit-*.json")
            .OrderByDescending(f => f.LastWriteTimeUtc)
            .FirstOrDefault();
        if (report is null)
        {
            log.System("Kein Audit-Bericht gefunden.", "warn");
            return;
        }
        try
        {
            var json = JsonNode.Parse(File.ReadAllText(report.FullName));
            var summary = JsonCase.CamelCaseKeys(json?["auditSummary"]);
            var findings = JsonCase.CamelCaseKeys(json?["driftFindings"]) switch
            {
                JsonArray a => a,
                JsonObject single => new JsonArray(single),
                _ => new JsonArray(),
            };
            run.Summary = summary?.ToJsonString();
            run.Findings = findings.ToJsonString();
            run.DriftCount = summary?["driftCount"] is JsonValue d && d.TryGetValue<int>(out var drift) ? drift : findings.Count;
            // Extension-only audits (-Include* without a scope) do not fill the report's summary;
            // the script prints "Total Drift: N" instead.
            if (run.Scope is null && log.LastTotalDrift is { } standaloneDrift && standaloneDrift > (run.DriftCount ?? 0))
            {
                run.DriftCount = standaloneDrift;
                log.System($"Drift aus der Skriptausgabe übernommen (Erweiterungen ohne Bereich): {standaloneDrift}. Einzelbefunde stehen im Protokoll.", "warn");
            }
            if (summary?["errorCount"] is JsonValue e && e.TryGetValue<int>(out var errors)) run.ErrorCount = errors;
            log.System($"Audit-Bericht gelesen: {report.Name}, {findings.Count} Abweichung(en).");
        }
        catch (JsonException ex)
        {
            log.System($"Audit-Bericht konnte nicht gelesen werden: {ex.Message}", "error");
        }
    }
}
