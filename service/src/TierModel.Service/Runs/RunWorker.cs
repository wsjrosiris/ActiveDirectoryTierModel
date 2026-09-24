using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TierModel.Service.Config;
using TierModel.Service.Data;
using TierModel.Service.Monitoring;
using TierModel.Service.Notifications;

namespace TierModel.Service.Runs;

/// <summary>
/// Executes queued runs one at a time. Active Directory changes must not interleave,
/// so there is deliberately no parallelism.
/// </summary>
public class RunWorker(IServiceScopeFactory scopes, RunQueue queue, NotificationQueue notifications, IOptions<TierModelOptions> options,
    WorkerHeartbeats heartbeats, ILogger<RunWorker> logger) : BackgroundService
{
    public const string HeartbeatName = "RunWorker";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        heartbeats.Beat(HeartbeatName, TimeSpan.FromSeconds(10));
        await RecoverAsync(stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            heartbeats.Beat(HeartbeatName, TimeSpan.FromSeconds(10));
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
                    // A run can take hours; the worker is busy, not stuck.
                    heartbeats.Busy(HeartbeatName, $"Führt Lauf #{id} aus");
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
        var next = await db.Runs.Where(r => r.Status == RunStatus.Queued).OrderBy(r => r.Id).Select(r => new { r.Id, r.Kind, r.Mode }).FirstOrDefaultAsync(ct);
        if (next is null) return null;
        var id = next.Id;
        if (next.Kind == RunKind.Deploy && next.Mode == RunMode.Apply)
        {
            // Last line of defence (roadmap 4): an apply never starts outside a maintenance window or inside a freeze,
            // e.g. when a freeze was added after the run was queued. It goes back to "Scheduled".
            var maintenance = scope.ServiceProvider.GetRequiredService<Maintenance.MaintenanceService>();
            var (status, scheduledFor) = await maintenance.StartStatusAsync(DateTimeOffset.UtcNow, ct);
            if (status == RunStatus.Scheduled)
            {
                await db.Runs.Where(r => r.Id == id && r.Status == RunStatus.Queued).ExecuteUpdateAsync(u => u
                    .SetProperty(r => r.Status, RunStatus.Scheduled)
                    .SetProperty(r => r.ScheduledFor, scheduledFor), ct);
                logger.LogInformation("Run {RunId} deferred to {ScheduledFor}: outside a maintenance window or inside a freeze", id, scheduledFor);
                queue.Notify();   // look at the next queued run right away
                return null;
            }
        }
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
        var privilegedChange = false;
        Jit.JitRunResult? jitResult = null;
        try
        {
            log.System($"Lauf #{id} gestartet: {Describe(run)}");

            // Runs approved under the four-eyes principle execute exactly the configuration that was reviewed.
            var pinned = run.ConfigVersions is { } pinnedJson ? JsonSerializer.Deserialize<Dictionary<string, int>>(pinnedJson) : null;
            var snapshot = pinned is null ? await config.SnapshotAsync(linked.Token) : await config.SnapshotAsync(pinned, linked.Token);
            if (pinned is not null)
                log.System((run.PlanRunId is { } planId ? $"Konfigurationsversionen der Planung #{planId} werden verwendet" : "Freigegebene Konfigurationsversionen werden verwendet")
                    + (run.ApprovedBy is null ? "." : $" (freigegeben von {run.ApprovedBy})."));
            run.ConfigVersions = JsonSerializer.Serialize(snapshot.ToDictionary(s => s.Def.Key, s => s.Version));
            await db.SaveChangesAsync(CancellationToken.None);
            log.System("Konfiguration: " + string.Join(", ", snapshot.Select(s => $"{s.Def.Key} v{s.Version}")));

            // JIT runs only change one group membership; configuration issues do not concern them.
            List<ValidationIssue> issues = run.Kind == RunKind.Jit ? [] : ConfigValidator.Validate(snapshot.ToDictionary(s => s.Def.Key, s => JsonNode.Parse(s.Content)));
            foreach (var issue in issues.Where(i => i.Severity == "Error"))
                log.System($"Validierungsfehler [{issue.Section}] {issue.Message}{(issue.Item is null ? "" : $" ({issue.Item})")}", "error");
            var errors = issues.Count(i => i.Severity == "Error");
            var warnings = issues.Count - errors;
            if (warnings > 0) log.System($"{warnings} Validierungshinweis(e) – Details unter Konfiguration › Validierung.", "warn");
            if (errors > 0 && run.Mode == RunMode.Apply)
                throw new InvalidOperationException($"{errors} Validierungsfehler in der Konfiguration – Anwenden wurde nicht gestartet.");

            var workDir = Workspace.Create(o, id, snapshot);
            log.System($"Arbeitsverzeichnis: {workDir}");

            var jit = run.Kind == RunKind.Jit ? await JitArgumentsAsync(db, run, CancellationToken.None) : null;
            var wrapper = Path.Combine(workDir, "run.ps1");
            await File.WriteAllTextAsync(wrapper, BuildWrapperScript(run, workDir, jit), new UTF8Encoding(encoderShouldEmitUTF8Identifier: true), linked.Token);
            if (run.Kind is RunKind.Monitor or RunKind.Jit && !File.Exists(Path.Combine(workDir, ScriptName(run.Kind))))
                throw new InvalidOperationException($"Das Framework enthält {ScriptName(run.Kind)} nicht – bitte das Framework unter '{o.FrameworkPath}' aktualisieren.");
            log.System($"Aufruf: {ScriptName(run.Kind)} {string.Join(' ', ScriptParameters(run, workDir, jit))}");
            var exitCode = await RunPowerShellAsync(o.PwshPath, workDir, PwshArguments(wrapper), log, linked.Token);
            run.ExitCode = exitCode;

            if (run.Kind == RunKind.Audit) ReadAuditReport(run, workDir, log);
            var plan = run.Kind == RunKind.Deploy && run.Mode == RunMode.Plan ? ReadDeployPlan(run, workDir, (text, level) => log.System(text, level)) : null;
            string? monitorMessage = null;
            if (run.Kind == RunKind.Jit)
            {
                jitResult = Jit.JitRunResult.Read(workDir, (text, level) => log.System(text, level));
                if (jitResult is not null) run.Summary = jitResult.SummaryJson();
                if (jitResult is { Success: false, Error: { } jitError }) log.System($"Fehler: {jitError}", "error");
            }
            if (run.Kind == RunKind.Monitor && exitCode == 0)
            {
                var sections = snapshot.ToDictionary(x => x.Def.Key, x => JsonNode.Parse(x.Content));
                var settings = await scope.ServiceProvider.GetRequiredService<SettingsService>().GetAsync(CancellationToken.None);
                (monitorMessage, privilegedChange) = await ProcessMonitorAsync(db, run, workDir, sections,
                    new HygieneThresholds(settings.StaleDays, settings.PasswordMaxAgeDays), (text, level) => log.System(text, level));
            }

            run.ErrorCount ??= log.ErrorLines;
            status = exitCode == 0 ? RunStatus.Succeeded : RunStatus.Failed;
            message = exitCode == 0
                ? run.Kind switch
                {
                    RunKind.Audit => run.DriftCount is > 0 ? $"{run.DriftCount} Abweichung(en) gefunden" : "Keine Abweichungen",
                    RunKind.Monitor => monitorMessage,
                    RunKind.Jit => JitMessage(run, jitResult),
                    _ => run.Mode == RunMode.Apply ? "Bereitstellung abgeschlossen" : PlanMessage(plan),
                }
                : run.Kind == RunKind.Jit && jitResult?.Error is { } failure ? failure
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
        if (run.Kind == RunKind.Jit)
        {
            try
            {
                await scope.ServiceProvider.GetRequiredService<Jit.JitService>().CompleteRunAsync(run, jitResult, CancellationToken.None);
            }
            catch (Exception ex)
            {
                // The JIT maintenance repairs the request later (run finished without being processed).
                logger.LogError(ex, "JIT request of run {RunId} could not be updated", id);
            }
        }
        foreach (var e in NotificationService.EventsFor(run, privilegedChange)) notifications.Enqueue(e, id);
    }

    private static string Describe(Run r)
    {
        if (r.Kind == RunKind.Monitor) return $"Überwachung privilegierter Gruppen, DC {r.PreferredDc}, angefordert von {r.RequestedBy}";
        if (r.Kind == RunKind.Jit) return $"{RunService.RunTitle(r)}{(r.JitRequestId is { } req ? $" für Antrag #{req}" : "")}, DC {r.PreferredDc}, angefordert von {r.RequestedBy}";
        var what = r.Kind == RunKind.Audit ? "Audit" : r.Mode == RunMode.Apply ? "Deploy – ANWENDEN" : "Deploy – Planung";
        var includes = RunSummaryDto.IncludeList(r.IncludeMsa, r.IncludeGmsa, r.IncludeDmsa, r.IncludeWinLaps);
        return $"{what}, Bereich {r.Scope?.ToString() ?? "–"}{(includes.Length > 0 ? " + " + string.Join(", ", includes) : "")}, DC {r.PreferredDc}, angefordert von {r.RequestedBy}";
    }

    public static List<string> PwshArguments(string wrapper) =>
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", wrapper];

    /// <summary>Single-quoted PowerShell string literal.</summary>
    private static string Quote(string value) => "'" + value.Replace("'", "''") + "'";

    public static string ScriptName(RunKind kind) => kind switch
    {
        RunKind.Deploy => "Deploy-TierModel.ps1",
        RunKind.Monitor => Workspace.MonitorScript,
        RunKind.Jit => Workspace.JitScript,
        _ => "Audit-TierModel.ps1",
    };

    /// <summary>Parameters of a JIT run beyond the domain controller (from its request; none for the prerequisite check).</summary>
    public record JitArguments(JitAction Action, string? Group, string? Member, int? Minutes);

    private static async Task<JitArguments> JitArgumentsAsync(AppDbContext db, Run run, CancellationToken ct)
    {
        var action = run.JitAction ?? JitAction.Check;
        if (action == JitAction.Check) return new(action, null, null, null);
        var request = await db.JitRequests.AsNoTracking().FirstOrDefaultAsync(r => r.Id == run.JitRequestId, ct)
            ?? throw new InvalidOperationException($"Antrag #{run.JitRequestId} für diesen Lauf wurde nicht gefunden.");
        // Values become process arguments: they were validated when the request/group was saved, check again.
        var group = Jit.JitService.NormalizeIdentity(request.GroupSid ?? request.Group) ?? throw new InvalidOperationException("Ungültige Gruppe im Antrag.");
        var member = Jit.JitService.NormalizeIdentity(request.MemberAccount) ?? throw new InvalidOperationException("Ungültiges Konto im Antrag.");
        return new(action, group, member, action == JitAction.Grant ? request.Minutes : null);
    }

    private static string JitMessage(Run run, Jit.JitRunResult? result) => run.JitAction switch
    {
        JitAction.Check => result?.Raw["ready"] is JsonValue v && v.TryGetValue<bool>(out var ready) && ready
            ? "Voraussetzungen erfüllt"
            : "Voraussetzungen nicht erfüllt (Privileged Access Management Feature)",
        JitAction.Revoke => result?.Removed == false ? "Mitgliedschaft bestand nicht mehr – nichts zu entziehen" : $"Mitgliedschaft entzogen: {result?.Member} aus {result?.Group}",
        _ => result?.ExpiresAt is { } until ? $"Mitgliedschaft erteilt: {result.Member} in {result.Group} bis {Maintenance.MaintenanceCalendar.Format(until)}" : "Mitgliedschaft erteilt",
    };

    /// <summary>Parameters passed to the framework script. Values are validated before they get here.</summary>
    public static List<string> ScriptParameters(Run run, string workDir, JitArguments? jit = null)
    {
        var p = new List<string> { "-PreferredDc", Quote(run.PreferredDc) };
        if (run.Kind == RunKind.Jit)
        {
            jit ??= new JitArguments(run.JitAction ?? JitAction.Check, null, null, null);
            p.AddRange(["-Mode", jit.Action.ToString()]);
            if (jit.Group is { } g) p.AddRange(["-Group", Quote(g)]);
            if (jit.Member is { } m) p.AddRange(["-Member", Quote(m)]);
            if (jit.Minutes is { } minutes) p.AddRange(["-Minutes", minutes.ToString(System.Globalization.CultureInfo.InvariantCulture)]);
            p.AddRange(["-OutputPath", Quote(Path.Combine(workDir, "out", Jit.JitRunResult.FileName))]);
            return p;
        }
        // Watch-TierModelPrivilegedGroups.ps1 reads its configuration from $PSScriptRoot\config like the other scripts.
        if (run.Kind == RunKind.Monitor)
        {
            p.AddRange(["-OutputPath", Quote(Path.Combine(workDir, "out", PrivilegedSnapshotReader.FileName))]);
            return p;
        }
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
    public static string BuildWrapperScript(Run run, string workDir, JitArguments? jit = null)
    {
        var script = ScriptName(run.Kind);
        return $"""
            # Generated by TierModel Service for run #{run.Id} ({run.Kind}, requested by {run.RequestedBy.ReplaceLineEndings(" ")}).
            [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
            $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
            $global:LASTEXITCODE = 0
            & (Join-Path $PSScriptRoot '{script}') {string.Join(' ', ScriptParameters(run, workDir, jit))}
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

    public static string PlanMessage(DeployPlan? plan)
    {
        if (plan is null) return "Planung abgeschlossen";
        var n = DeployPlanReader.TotalChanges(plan);
        return n switch
        {
            0 => "Planung abgeschlossen: keine Änderungen nötig",
            1 => "Planung abgeschlossen: 1 Änderung",
            _ => $"Planung abgeschlossen: {n} Änderungen",
        };
    }

    /// <summary>Reads out/deploy-plan.json of a planning run into <see cref="Run.Plan"/>. Never fails the run.</summary>
    public static DeployPlan? ReadDeployPlan(Run run, string workDir, Action<string, string> log)
    {
        var file = Path.Combine(workDir, "out", DeployPlanReader.FileName);
        if (!File.Exists(file))
        {
            log($"Keine Plandatei ({DeployPlanReader.FileName}) gefunden – geplante Änderungen stehen nur im Protokoll.", "warn");
            return null;
        }
        try
        {
            var plan = DeployPlanReader.Parse(File.ReadAllText(file));
            run.Plan = DeployPlanReader.Serialize(plan);
            log($"Plan gelesen: {DeployPlanReader.TotalChanges(plan)} Änderung(en)"
                + (plan.Truncated ? $", die ersten {DeployPlanReader.MaxActions} werden gespeichert" : "")
                + (plan.Warnings.Count > 0 ? $", {plan.Warnings.Count} Warnung(en)" : "")
                + (plan.Errors.Count > 0 ? $", {plan.Errors.Count} Fehler" : "") + ".",
                plan.Errors.Count > 0 ? "error" : plan.Warnings.Count > 0 || plan.Truncated ? "warn" : "info");
            return plan;
        }
        catch (Exception ex) when (ex is JsonException or IOException or InvalidOperationException or FormatException)
        {
            log($"Plandatei konnte nicht gelesen werden: {ex.Message}", "warn");
            return null;
        }
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

    /// <summary>
    /// Reads out/privileged.json, evaluates it against the previous snapshot and the configuration used by this run, and
    /// stores the snapshot. A missing or unusable file fails the run (<see cref="InvalidOperationException"/> with a German message).
    /// </summary>
    public static async Task<(string Message, bool Notify)> ProcessMonitorAsync(AppDbContext db, Run run, string workDir,
        IReadOnlyDictionary<string, JsonNode?> sections, HygieneThresholds thresholds, Action<string, string> log)
    {
        var file = Path.Combine(workDir, "out", PrivilegedSnapshotReader.FileName);
        if (!File.Exists(file))
            throw new InvalidOperationException($"Überwachung fehlgeschlagen: Das Skript hat keine Ergebnisdatei ({PrivilegedSnapshotReader.FileName}) geschrieben.");
        PrivilegedSnapshotData data;
        try
        {
            data = PrivilegedSnapshotReader.Parse(await File.ReadAllTextAsync(file));
        }
        catch (FormatException ex)
        {
            throw new InvalidOperationException($"Überwachung fehlgeschlagen: {ex.Message}", ex);
        }

        var previous = await db.PrivilegedSnapshots.AsNoTracking()
            .Where(s => s.DomainId == 1 && s.RunId != run.Id)
            .OrderByDescending(s => s.Id)
            .Select(s => new { s.Data, s.Evaluation })
            .FirstOrDefaultAsync();
        // Members with an active Just-in-Time grant at the time of the snapshot are expected (roadmap 6).
        var tier0 = Tier0Config.From(sections);
        tier0.Jit.AddRange(await Jit.JitService.ExpectationsAsync(db, data.Metadata.Timestamp ?? DateTimeOffset.UtcNow));
        var evaluation = PrivilegedEvaluator.Evaluate(data, PrivilegedSnapshotReader.Deserialize(previous?.Data),
            PrivilegedEvaluation.Deserialize(previous?.Evaluation), tier0, thresholds, DateTimeOffset.UtcNow);

        db.PrivilegedSnapshots.Add(new PrivilegedSnapshot
        {
            RunId = run.Id,
            TakenAt = data.Metadata.Timestamp ?? DateTimeOffset.UtcNow,
            Data = PrivilegedSnapshotReader.Serialize(data),
            Evaluation = evaluation.Serialize(),
            GroupCount = data.Groups.Count,
            MemberCount = data.MemberCount,
            ChangeCount = evaluation.Changes.Count,
            UnexpectedCount = evaluation.Unexpected.Count,
            HygieneCount = evaluation.Hygiene.Count,
            AttackPathCount = evaluation.AttackPaths.Count,
        });
        var added = evaluation.Changes.Count(c => c.Change == "Added");
        run.DriftCount = evaluation.DriftCount;
        run.ErrorCount = data.Errors.Count;
        run.Summary = JsonSerializer.Serialize(new
        {
            groupCount = data.Groups.Count,
            memberCount = data.MemberCount,
            accountCount = data.Accounts.Count,
            addedCount = added,
            removedCount = evaluation.Changes.Count - added,
            unexpectedCount = evaluation.Unexpected.Count,
            hygieneCount = evaluation.Hygiene.Count,
            hygieneHighCount = evaluation.Hygiene.Count(h => h.Severity == PrivilegedEvaluator.High),
            attackPathCount = evaluation.AttackPaths.Count,
            errorCount = data.Errors.Count,
            baseline = evaluation.Baseline,
        });

        foreach (var error in data.Errors) log($"Teilfehler des Skripts: {error}", "warn");
        log($"Momentaufnahme gelesen: {data.Groups.Count} Gruppe(n), {data.MemberCount} Mitgliedschaft(en), {data.Accounts.Count} Konto/Konten"
            + (evaluation.Baseline ? " – erste Momentaufnahme, Änderungen werden ab dem nächsten Lauf erkannt." : "."), "info");

        var parts = new List<string>();
        if (evaluation.Changes.Count > 0) parts.Add($"{evaluation.Changes.Count} Änderung(en)");
        if (evaluation.Unexpected.Count > 0) parts.Add($"{evaluation.Unexpected.Count} nicht erwartete(s) Mitglied(er)");
        if (evaluation.Hygiene.Count > 0) parts.Add($"{evaluation.Hygiene.Count} Hygiene-Befund(e)");
        if (evaluation.AttackPaths.Count > 0) parts.Add($"{evaluation.AttackPaths.Count} Angriffspfad(e)");
        var message = parts.Count == 0 ? "Überwachung abgeschlossen: keine Auffälligkeiten" : "Überwachung abgeschlossen: " + string.Join(", ", parts);
        return (message, evaluation.Notify);
    }
}
