using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using TierModel.Service.Config;
using TierModel.Service.Data;
using TierModel.Service.Monitoring;
using TierModel.Service.Runs;

namespace TierModel.Service.Reports;

/// <summary>Collects the data of a report from the database into a <see cref="ReportDocument"/> (rendered as HTML or PDF).</summary>
public class ReportBuilder(AppDbContext db, SettingsService settings)
{
    /// <summary>Tables are cut after this many rows; the report says so.</summary>
    public const int MaxRows = 1000;

    private static readonly CultureInfo De = CultureInfo.GetCultureInfo("de-DE");

    public static string Date(DateTimeOffset d) => d.ToLocalTime().ToString("dd.MM.yyyy", De);
    public static string DateTime(DateTimeOffset d) => d.ToLocalTime().ToString("dd.MM.yyyy HH:mm", De);
    public static string DateTime(DateTimeOffset? d) => d is { } v ? DateTime(v) : "–";

    public static readonly IReadOnlyDictionary<string, string> AreaLabels = new Dictionary<string, string>
    {
        ["ous"] = "OUs", ["groups"] = "Gruppen", ["users"] = "Benutzer", ["acls"] = "OU-ACLs", ["gpos"] = "GPOs", ["admx"] = "ADMX",
        ["msa"] = "MSA", ["gmsa"] = "gMSA", ["dmsa"] = "dMSA", ["winlaps"] = "Windows LAPS", ["authsilos"] = "Authentication Silos",
    };

    private static readonly IReadOnlyDictionary<string, string> FindingTypes = new Dictionary<string, string>
    {
        ["Missing"] = "Fehlend", ["Unexpected"] = "Unerwartet", ["Mismatch"] = "Abweichung", ["Error"] = "Fehler",
    };

    public static readonly IReadOnlyDictionary<RunStatus, string> StatusLabels = new Dictionary<RunStatus, string>
    {
        [RunStatus.Queued] = "In Warteschlange", [RunStatus.Running] = "Läuft", [RunStatus.Succeeded] = "Erfolgreich",
        [RunStatus.Failed] = "Fehlgeschlagen", [RunStatus.Cancelled] = "Abgebrochen", [RunStatus.AwaitingApproval] = "Wartet auf Freigabe",
        [RunStatus.Rejected] = "Abgelehnt",
    };

    public static string Severity(string? s) => ComplianceCalculator.NormalizeSeverity(s) switch { "High" => "Hoch", "Low" => "Niedrig", _ => "Mittel" };

    public static Tone SeverityTone(string? s) => ComplianceCalculator.NormalizeSeverity(s) switch { "High" => Tone.Danger, "Low" => Tone.Muted, _ => Tone.Warning };

    private static int SeverityRank(string? s) => ComplianceCalculator.NormalizeSeverity(s) switch { "High" => 0, "Medium" => 1, _ => 2 };

    public static Tone ScoreTone(int? score) => score switch { null => Tone.Muted, >= 90 => Tone.Success, >= 70 => Tone.Warning, _ => Tone.Danger };

    public static string StatusLabel(RunStatus s) => StatusLabels.GetValueOrDefault(s) ?? (s.ToString() == "Scheduled" ? "Geplant" : s.ToString());

    private static Tone StatusTone(RunStatus s) => s switch
    {
        RunStatus.Succeeded => Tone.Success,
        RunStatus.Failed or RunStatus.Rejected => Tone.Danger,
        RunStatus.Cancelled => Tone.Muted,
        _ => Tone.Info,
    };

    /// <summary>Local calendar days → [from 00:00, to+1 00:00) in the server's time zone; defaults to the last 30 days.</summary>
    public static (DateTimeOffset From, DateTimeOffset To) Range(DateOnly? from, DateOnly? to, DateTimeOffset now)
    {
        var today = DateOnly.FromDateTime(now.ToLocalTime().DateTime);
        var t = to ?? today;
        var f = from ?? t.AddDays(-29);
        if (f > t) (f, t) = (t, f);
        DateTimeOffset Local(DateOnly d)
        {
            var dt = d.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified);
            return new DateTimeOffset(dt, TimeZoneInfo.Local.GetUtcOffset(dt));
        }
        return (Local(f), Local(t.AddDays(1)));
    }

    public async Task<ReportDocument> BuildAsync(string type, DateOnly? from, DateOnly? to, string user, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var (start, end) = Range(from, to, now);
        var s = await settings.GetAsync(ct);
        var instance = string.IsNullOrWhiteSpace(s.PublicBaseUrl) ? Environment.MachineName : s.PublicBaseUrl;
        var compliance = await PrivilegedEndpoints.ComplianceAsync(db, now, ct);
        var scores = ComplianceCalculator.Tiers.Select(tier =>
        {
            var c = compliance.Current?.FirstOrDefault(x => x.Tier == tier);
            return new ReportScore($"Tier {tier}", c?.Score,
                c is null ? "keine Daten" : c.Deductions.Count == 0 ? "keine Abzüge" : $"{c.Deductions.Sum(d => d.Points)} Punkte Abzug");
        }).ToList();

        var doc = type switch
        {
            ReportTypes.SollIst => await SollIstAsync(end, ct),
            ReportTypes.Changes => await ChangesAsync(start, end, ct),
            ReportTypes.Privileged => await PrivilegedAsync(start, end, compliance, ct),
            _ => throw new ArgumentOutOfRangeException(nameof(type), type, "Unbekannter Berichtstyp."),
        };
        return doc with
        {
            Type = type, Title = ReportTypes.Title(type), GeneratedAt = now, GeneratedBy = user, From = type == ReportTypes.SollIst ? null : start,
            To = end.AddTicks(-1), Instance = instance, Scores = scores,
        };
    }

    private static ReportDocument Empty(string subtitle, string basis, List<ReportStat> highlights, List<ReportSection> sections) =>
        new("", "", subtitle, default, "", null, null, "", basis, [], highlights, sections);

    // ------------------------------------------------------------------ Soll/Ist

    private async Task<ReportDocument> SollIstAsync(DateTimeOffset end, CancellationToken ct)
    {
        var audit = await db.Runs.AsNoTracking()
            .Where(r => r.Kind == RunKind.Audit && r.Status == RunStatus.Succeeded && r.CreatedAt < end)
            .OrderByDescending(r => r.Id).FirstOrDefaultAsync(ct);
        const string subtitle = "Abgleich der Soll-Konfiguration mit dem Active Directory (letztes Audit)";
        if (audit is null)
            return Empty(subtitle, "Kein erfolgreiches Audit vorhanden", [],
                [new ReportSection("Zusammenfassung", null, [new ReportParagraph("Bis zum Enddatum wurde kein Audit erfolgreich abgeschlossen. Bitte zuerst ein Audit starten.", Tone.Warning)])]);

        var summary = audit.Summary is null ? null : JsonNode.Parse(audit.Summary) as JsonObject;
        var findings = (audit.Findings is null ? null : JsonNode.Parse(audit.Findings) as JsonArray)?.OfType<JsonObject>().ToList() ?? [];
        int? Num(string key) => summary?[key] is JsonValue v && v.TryGetValue<int>(out var n) ? n : null;
        string? Str(JsonObject o, string key) => o[key] switch
        {
            JsonValue v when v.TryGetValue<string>(out var str) => str,
            JsonValue v => v.ToJsonString(),
            JsonArray a => string.Join(", ", a.Select(x => x?.ToString())),
            _ => null,
        };
        string Area(JsonObject f) => Str(f, "area") is { } a && AreaLabels.ContainsKey(a) ? a : "other";

        var drift = audit.DriftCount ?? findings.Count;
        var highlights = new List<ReportStat>
        {
            new("Geprüfte Objekte", Num("totalChecked")?.ToString(De) ?? "–"),
            new("Abweichungen", drift.ToString(De), drift > 0 ? Tone.Danger : Tone.Success),
            new("Hoch", findings.Count(f => SeverityRank(Str(f, "severity")) == 0).ToString(De), Tone.Danger),
            new("Mittel", findings.Count(f => SeverityRank(Str(f, "severity")) == 1).ToString(De), Tone.Warning),
            new("Niedrig", findings.Count(f => SeverityRank(Str(f, "severity")) == 2).ToString(De), Tone.Muted),
        };

        var sections = new List<ReportSection>
        {
            new("Zusammenfassung", null,
            [
                new ReportKeyValues(
                [
                    new("Audit", $"#{audit.Id} vom {DateTime(audit.FinishedAt ?? audit.CreatedAt)}"),
                    new("Bereich", ScopeLabel(audit)),
                    new("Domänencontroller", audit.PreferredDc),
                    new("Angefordert von", audit.RequestedBy + (audit.Trigger == RunTrigger.Schedule ? " (Zeitplan)" : "")),
                ]),
                new ReportStats(
                [
                    new("Fehlend", (Num("missingCount") ?? 0).ToString(De), Num("missingCount") > 0 ? Tone.Warning : Tone.Default),
                    new("Unerwartet", (Num("unexpectedCount") ?? 0).ToString(De), Num("unexpectedCount") > 0 ? Tone.Warning : Tone.Default),
                    new("Abweichend", (Num("mismatchCount") ?? 0).ToString(De), Num("mismatchCount") > 0 ? Tone.Warning : Tone.Default),
                    new("Verwaiste GPO-Links", (Num("orphanedGpoLinkCount") ?? 0).ToString(De)),
                    new("Sicherheitsabweichungen", (Num("securityDeltaCount") ?? 0).ToString(De)),
                ]),
                drift == 0
                    ? new ReportParagraph("Das Active Directory entspricht der Soll-Konfiguration – es wurden keine Abweichungen gefunden.", Tone.Success)
                    : new ReportParagraph($"Das Audit hat {drift} Abweichung(en) gefunden. Die folgenden Abschnitte listen sie nach Bereich und Schweregrad.", Tone.Warning),
            ]),
        };

        if (findings.Count > 0)
        {
            var byArea = findings.GroupBy(Area).OrderBy(g => g.Min(f => SeverityRank(Str(f, "severity")))).ThenByDescending(g => g.Count()).ToList();
            sections.Add(new ReportSection("Befunde nach Bereich und Schweregrad", null,
            [
                new ReportTable(
                    [new("Bereich", 3), new("Hoch", 1), new("Mittel", 1), new("Niedrig", 1), new("Gesamt", 1)],
                    byArea.Select(g => new List<ReportCell>
                    {
                        AreaLabels.GetValueOrDefault(g.Key) ?? "Sonstige",
                        Count(g.Count(f => SeverityRank(Str(f, "severity")) == 0), Tone.Danger),
                        Count(g.Count(f => SeverityRank(Str(f, "severity")) == 1), Tone.Warning),
                        Count(g.Count(f => SeverityRank(Str(f, "severity")) == 2), Tone.Muted),
                        new(g.Count().ToString(De)),
                    }).ToList()),
            ]));
            foreach (var g in byArea)
            {
                var rows = g.OrderBy(f => SeverityRank(Str(f, "severity"))).Take(MaxRows).Select(f =>
                {
                    var expected = Str(f, "expectedValue");
                    var actual = Str(f, "actualValue");
                    return new List<ReportCell>
                    {
                        new(Severity(Str(f, "severity")), SeverityTone(Str(f, "severity")), Badge: true),
                        FindingTypes.GetValueOrDefault(Str(f, "type") ?? "") ?? Str(f, "type") ?? "–",
                        new(Str(f, "identifier") ?? "–", Sub: Str(f, "resourceType")),
                        new(Str(f, "details") ?? Str(f, "property") ?? "–",
                            Sub: expected is null && actual is null ? null : $"Soll: {expected ?? "–"} · Ist: {actual ?? "–"}"),
                    };
                }).ToList();
                sections.Add(new ReportSection($"{AreaLabels.GetValueOrDefault(g.Key) ?? "Sonstige"} ({g.Count()})", null,
                [
                    new ReportTable([new("Schwere", 1.1), new("Art", 1.2), new("Objekt", 4, Mono: true), new("Befund", 4.5)], rows,
                        Note: g.Count() > MaxRows ? $"Nur die ersten {MaxRows} von {g.Count()} Befunden." : null),
                ]));
            }
        }
        return Empty(subtitle, $"Audit #{audit.Id} vom {DateTime(audit.FinishedAt ?? audit.CreatedAt)}", highlights, sections);
    }

    private static ReportCell Count(int n, Tone tone) => n == 0 ? new ReportCell("–", Tone.Muted) : new ReportCell(n.ToString(De), tone);

    private static string ScopeLabel(Run r)
    {
        var scope = r.Scope switch
        {
            DeployScope.FullDeployment => "Vollständig",
            DeployScope.OuOnly => "Nur OUs",
            DeployScope.GroupOnly => "Nur Gruppen",
            DeployScope.UserOnly => "Nur Benutzer",
            DeployScope.GposOnly => "Nur GPOs",
            DeployScope.OuAclsOnly => "Nur OU-ACLs",
            DeployScope.AdmxOnly => "Nur ADMX",
            DeployScope.AuthSilosOnly => "Nur Authentication Silos",
            _ => r.Kind == RunKind.Monitor ? "Privilegierte Gruppen" : "–",
        };
        var includes = RunSummaryDto.IncludeList(r.IncludeMsa, r.IncludeGmsa, r.IncludeDmsa, r.IncludeWinLaps);
        return includes.Length == 0 ? scope : $"{scope} + {string.Join(", ", includes.Select(i => i switch { "Msa" => "MSA", "Gmsa" => "gMSA", "Dmsa" => "dMSA", "WinLaps" => "Windows LAPS", _ => i }))}";
    }

    // ------------------------------------------------------------------ Änderungen im Zeitraum

    private async Task<ReportDocument> ChangesAsync(DateTimeOffset start, DateTimeOffset end, CancellationToken ct)
    {
        var versions = await db.ConfigVersions.AsNoTracking().Where(v => v.CreatedAt >= start && v.CreatedAt < end)
            .OrderByDescending(v => v.CreatedAt).Select(v => new { v.SectionKey, v.Version, v.CreatedBy, v.CreatedAt, v.Comment }).ToListAsync(ct);
        var runs = await db.Runs.AsNoTracking().Where(r => r.CreatedAt >= start && r.CreatedAt < end).OrderByDescending(r => r.Id).ToListAsync(ct);
        var approvals = await db.Runs.AsNoTracking().Where(r => r.ApprovedAt >= start && r.ApprovedAt < end).OrderByDescending(r => r.ApprovedAt).ToListAsync(ct);
        var changeCount = await db.ChangeLog.CountAsync(e => e.At >= start && e.At < end, ct);
        var changes = await db.ChangeLog.AsNoTracking().Where(e => e.At >= start && e.At < end).OrderByDescending(e => e.Id).Take(MaxRows)
            .Select(e => new { e.At, e.Username, e.Action, e.Summary }).ToListAsync(ct);

        var applies = runs.Count(r => r.Kind == RunKind.Deploy && r.Mode == RunMode.Apply);
        var failed = runs.Count(r => r.Status == RunStatus.Failed);
        var highlights = new List<ReportStat>
        {
            new("Konfigurationsversionen", versions.Count.ToString(De), versions.Count > 0 ? Tone.Info : Tone.Default),
            new("Läufe", runs.Count.ToString(De)),
            new("Anwendungen", applies.ToString(De), applies > 0 ? Tone.Warning : Tone.Default),
            new("Freigabeentscheidungen", approvals.Count.ToString(De)),
            new("Protokolleinträge", changeCount.ToString(De)),
        };

        var sections = new List<ReportSection>
        {
            new("Übersicht", null,
            [
                new ReportStats(
                [
                    new("Audits", runs.Count(r => r.Kind == RunKind.Audit).ToString(De)),
                    new("Planungen", runs.Count(r => r.Kind == RunKind.Deploy && r.Mode != RunMode.Apply).ToString(De)),
                    new("Anwendungen", applies.ToString(De)),
                    new("Überwachungen", runs.Count(r => r.Kind == RunKind.Monitor).ToString(De)),
                    new("Fehlgeschlagen", failed.ToString(De), failed > 0 ? Tone.Danger : Tone.Default),
                ]),
            ]),
            new("Konfigurationsänderungen", "Jede gespeicherte Version der Soll-Konfiguration mit dem Kommentar der Person, die sie gespeichert hat.",
            [
                new ReportTable([new("Zeitpunkt", 1.6), new("Bereich", 2), new("Version", 0.9), new("Von", 1.6), new("Kommentar", 4)],
                    versions.Take(MaxRows).Select(v => new List<ReportCell>
                    {
                        DateTime(v.CreatedAt), ConfigCatalog.Find(v.SectionKey)?.Title ?? v.SectionKey, $"v{v.Version}", v.CreatedBy,
                        string.IsNullOrWhiteSpace(v.Comment) ? new ReportCell("ohne Kommentar", Tone.Muted) : new ReportCell(v.Comment!),
                    }).ToList(), "Im Zeitraum wurde die Konfiguration nicht geändert."),
            ]),
            new("Läufe", null,
            [
                new ReportTable([new("Lauf", 0.8), new("Art", 1.6), new("Status", 1.4), new("Angefordert", 2.2), new("Ergebnis", 4)],
                    runs.Take(MaxRows).Select(r => new List<ReportCell>
                    {
                        $"#{r.Id}", new(RunService.RunTitle(r), Sub: ScopeLabel(r)),
                        new(StatusLabel(r.Status), StatusTone(r.Status), Badge: true),
                        new(r.RequestedBy + (r.Trigger == RunTrigger.Schedule ? " (Zeitplan)" : ""), Sub: DateTime(r.CreatedAt)),
                        r.Message ?? "–",
                    }).ToList(), "Im Zeitraum gab es keine Läufe.", runs.Count > MaxRows ? $"Nur die neuesten {MaxRows} von {runs.Count} Läufen." : null),
            ]),
            new("Freigaben", "Entscheidungen im Vier-Augen-Verfahren für das Anwenden von Änderungen.",
            [
                new ReportTable([new("Deploy", 0.9), new("Beantragt von", 1.8), new("Entscheidung", 1.5), new("Durch", 1.8), new("Zeitpunkt", 1.6), new("Kommentar", 3)],
                    approvals.Select(r => new List<ReportCell>
                    {
                        $"#{r.Id}", r.RequestedBy,
                        r.Status == RunStatus.Rejected ? new ReportCell("Abgelehnt", Tone.Danger, Badge: true) : new ReportCell("Freigegeben", Tone.Success, Badge: true),
                        r.ApprovedBy ?? "–", DateTime(r.ApprovedAt),
                        string.IsNullOrWhiteSpace(r.ApprovalComment) ? new ReportCell("–", Tone.Muted) : new ReportCell(r.ApprovalComment!),
                    }).ToList(), "Im Zeitraum wurde nichts freigegeben oder abgelehnt."),
            ]),
            new("Änderungsprotokoll", "Alle protokollierten Aktionen im Zeitraum (Anmeldungen, Benutzer, Einstellungen, Läufe, Konfiguration).",
            [
                new ReportTable([new("Zeitpunkt", 1.5), new("Benutzer", 1.7), new("Aktion", 1.9), new("Beschreibung", 5)],
                    changes.Select(e => new List<ReportCell> { DateTime(e.At), e.Username, ActionLabel(e.Action), e.Summary }).ToList(),
                    "Keine Einträge im Zeitraum.", changeCount > MaxRows ? $"Nur die neuesten {MaxRows} von {changeCount} Einträgen – der vollständige Verlauf steht im Änderungsprotokoll." : null),
            ]),
        };
        return Empty("Konfiguration, Läufe, Freigaben und Änderungsprotokoll", $"{Date(start)} – {Date(end.AddTicks(-1))}", highlights, sections);
    }

    public static string ActionLabel(string action) => action switch
    {
        "config.update" => "Konfiguration geändert",
        "config.restore" => "Version wiederhergestellt",
        "run.deploy" => "Deploy gestartet",
        "run.audit" => "Audit gestartet",
        "run.monitor" => "Überwachung gestartet",
        "run.cancel" => "Lauf abgebrochen",
        "run.approve" => "Deploy freigegeben",
        "run.reject" => "Deploy abgelehnt",
        "user.create" => "Benutzer angelegt",
        "user.update" => "Benutzer geändert",
        "user.delete" => "Benutzer gelöscht",
        "auth.login" => "Anmeldung",
        "auth.login-failed" => "Fehlgeschlagene Anmeldung",
        "auth.windows-login" => "Windows-Anmeldung",
        "auth.entra-login" => "Entra-Anmeldung",
        "auth.entra-denied" => "Entra-Anmeldung abgelehnt",
        "settings.update" => "Einstellungen geändert",
        "notification.failed" => "Benachrichtigung fehlgeschlagen",
        _ => action,
    };

    // ------------------------------------------------------------------ Privilegierte Zugriffe

    private async Task<ReportDocument> PrivilegedAsync(DateTimeOffset start, DateTimeOffset end, ComplianceDto compliance, CancellationToken ct)
    {
        var latest = await db.PrivilegedSnapshots.AsNoTracking().Where(x => x.DomainId == 1 && x.TakenAt < end).OrderByDescending(x => x.Id).FirstOrDefaultAsync(ct);
        const string subtitle = "Mitglieder privilegierter Gruppen, Hygiene, Angriffspfade und Compliance-Wert";
        if (latest is null || PrivilegedSnapshotReader.Deserialize(latest.Data) is not { } data)
            return Empty(subtitle, "Keine Überwachung vorhanden", [],
                [new ReportSection("Zusammenfassung", null, [new ReportParagraph("Bis zum Enddatum gibt es keine Überwachung privilegierter Gruppen. Bitte zuerst eine Überwachung starten.", Tone.Warning)])]);

        var evaluation = PrivilegedEvaluation.Deserialize(latest.Evaluation) ?? new PrivilegedEvaluation(true, [], [], [], [], [], HygieneThresholds.Default);
        var unexpected = evaluation.Unexpected.Select(u => (u.GroupSid, u.MemberSid)).ToHashSet();
        var high = evaluation.Hygiene.Count(h => h.Severity == PrivilegedEvaluator.High);
        var highlights = new List<ReportStat>
        {
            new("Gruppen", data.Groups.Count.ToString(De)),
            new("Mitgliedschaften", data.MemberCount.ToString(De)),
            new("Nicht erwartet", evaluation.Unexpected.Count.ToString(De), evaluation.Unexpected.Count > 0 ? Tone.Danger : Tone.Success),
            new("Hygiene (hoch)", high.ToString(De), high > 0 ? Tone.Danger : Tone.Success),
            new("Angriffspfade", evaluation.AttackPaths.Count.ToString(De), evaluation.AttackPaths.Count > 0 ? Tone.Danger : Tone.Success),
        };

        var sections = new List<ReportSection>
        {
            new("Compliance-Wert", "Jede Ebene startet bei 100 Punkten; Befunde ziehen Punkte ab (Audit-Abweichungen, nicht erwartete Mitglieder, Hygiene, Angriffspfade).",
            [
                new ReportTable([new("Ebene", 1), new("Wert", 1), new("Abzüge", 6)],
                    (compliance.Current ?? []).Select(t => new List<ReportCell>
                    {
                        $"Tier {t.Tier}", new(t.Score.ToString(De), ScoreTone(t.Score), Badge: true),
                        t.Deductions.Count == 0 ? new ReportCell("keine", Tone.Muted)
                            : new ReportCell(string.Join("; ", t.Deductions.Select(d => $"{d.Label}: {d.Count} × {d.PointsEach} = {d.Points}"))),
                    }).ToList(), "Noch keine Daten für den Compliance-Wert."),
                new ReportKeyValues(
                [
                    new("Überwachung", $"#{latest.RunId} vom {DateTime(latest.TakenAt)}"),
                    new("Domäne", data.Metadata.Domain ?? "–"),
                    new("Domänencontroller", data.Metadata.PreferredDc ?? "–"),
                ]),
            ]),
            new("Nicht erwartete Mitglieder", "Mitglieder geschützter oder Tier-0-Gruppen, die weder zur Standard-Verschachtelung noch zur Tier-0-Konfiguration gehören.",
            [
                new ReportTable([new("Gruppe", 2), new("Mitglied", 2.4), new("Typ", 1), new("Mitgliedschaft", 2.6), new("Status", 1)],
                    evaluation.Unexpected.Select(u => new List<ReportCell>
                    {
                        u.GroupName, new(u.MemberName, Sub: u.MemberSam), ClassLabel(u.ObjectClass),
                        u.Direct ? "direkt" : "über " + string.Join(" › ", u.Via),
                        u.Enabled == false ? new ReportCell("deaktiviert", Tone.Muted) : new ReportCell("aktiv"),
                    }).ToList(), "Keine nicht erwarteten Mitglieder."),
            ]),
            new("Angriffspfade zu Tier 0", "Berechtigungen auf Tier-0-Objekten für Konten und Gruppen außerhalb von Tier 0.",
            [
                new ReportTable([new("Berechtigter", 2.2), new("Rechte", 2.2), new("Objekt", 3.2), new("Hinweis", 2.4)],
                    evaluation.AttackPaths.Take(MaxRows).Select(p => new List<ReportCell>
                    {
                        new(p.PrincipalName, Sub: PrivilegedEvaluator.PrincipalDescription(p.PrincipalClass, p.MemberCount)),
                        string.Join(", ", p.Rights),
                        new(p.ObjectName, Sub: PrivilegedEvaluator.ObjectTypeLabel(p.ObjectType) + (p.Inherited ? " · geerbt" : "")),
                        p.MembershipPath ?? "–",
                    }).ToList(), "Keine Angriffspfade gefunden."),
            ]),
            new("Hygiene-Befunde", $"Prüfung der Konten in Tier 0 und Tier 1 (Schwellwerte: {evaluation.Thresholds.StaleDays} Tage ohne Anmeldung, Passwort älter als {evaluation.Thresholds.PasswordMaxAgeDays} Tage).",
            [
                new ReportTable([new("Schwere", 1), new("Konto", 2), new("Tier", 0.7), new("Regel", 2.2), new("Details", 4)],
                    evaluation.Hygiene.OrderBy(h => SeverityRank(h.Severity)).ThenBy(h => h.Account, StringComparer.CurrentCultureIgnoreCase).Take(MaxRows)
                        .Select(h => new List<ReportCell>
                        {
                            new(Severity(h.Severity), SeverityTone(h.Severity), Badge: true), h.Account, h.Tier is { } t ? t.ToString(De) : "–", h.Title, h.Value,
                        }).ToList(), "Keine Hygiene-Befunde."),
            ]),
        };

        // Membership changes within the period.
        var changeRows = await db.PrivilegedSnapshots.AsNoTracking()
            .Where(x => x.DomainId == 1 && x.ChangeCount > 0 && x.TakenAt >= start && x.TakenAt < end)
            .OrderByDescending(x => x.Id).Take(200).Select(x => new { x.TakenAt, x.Evaluation }).ToListAsync(ct);
        var changes = changeRows.SelectMany(r => (PrivilegedEvaluation.Deserialize(r.Evaluation)?.Changes ?? []).Select(c => (r.TakenAt, c))).Take(MaxRows).ToList();
        sections.Add(new ReportSection("Änderungen an Mitgliedschaften im Zeitraum", null,
        [
            new ReportTable([new("Erkannt", 1.6), new("Änderung", 1.3), new("Gruppe", 2.2), new("Mitglied", 2.6), new("Mitgliedschaft", 2.2)],
                changes.Select(x => new List<ReportCell>
                {
                    DateTime(x.TakenAt),
                    x.c.Change == "Added" ? new ReportCell("hinzugefügt", Tone.Warning, Badge: true) : new ReportCell("entfernt", Tone.Muted, Badge: true),
                    x.c.GroupName, new(x.c.MemberName, Sub: x.c.MemberSam), x.c.Direct ? "direkt" : "über " + string.Join(" › ", x.c.Via),
                }).ToList(), "Im Zeitraum wurden keine Änderungen erkannt."),
        ]));

        var blocks = new List<ReportBlock>();
        foreach (var g in data.Groups.OrderByDescending(g => g.Members.Any(m => unexpected.Contains((g.Sid, m.Sid))))
                     .ThenBy(g => g.Source == "builtin" ? 0 : 1).ThenBy(g => g.Name, StringComparer.CurrentCultureIgnoreCase))
        {
            var n = g.Members.Count(m => unexpected.Contains((g.Sid, m.Sid)));
            blocks.Add(new ReportSubheading(g.Name, $"{g.Members.Count} Mitglied{(g.Members.Count == 1 ? "" : "er")}"
                + (g.Tier is { } tier ? $" · Tier {tier}" : "") + (n > 0 ? $" · {n} nicht erwartet" : "")));
            blocks.Add(new ReportTable([new("Mitglied", 2.6), new("Konto", 2), new("Typ", 1), new("Mitgliedschaft", 2.6), new("Bewertung", 1.4)],
                g.Members.OrderByDescending(m => unexpected.Contains((g.Sid, m.Sid))).ThenByDescending(m => m.IsDirect)
                    .ThenBy(m => m.DisplayName, StringComparer.CurrentCultureIgnoreCase).Take(MaxRows)
                    .Select(m => new List<ReportCell>
                    {
                        m.DisplayName, new(m.SamAccountName ?? "–"), ClassLabel(m.ObjectClass),
                        m.IsDirect ? "direkt" : "über " + string.Join(" › ", m.Via),
                        unexpected.Contains((g.Sid, m.Sid)) ? new ReportCell("nicht erwartet", Tone.Danger, Badge: true)
                            : m.Enabled == false ? new ReportCell("deaktiviert", Tone.Muted) : new ReportCell("erwartet", Tone.Success),
                    }).ToList(), "Keine Mitglieder."));
        }
        sections.Add(new ReportSection("Mitglieder privilegierter Gruppen", "Stand der letzten Überwachung; Gruppen mit Befunden zuerst.", blocks));

        return Empty(subtitle, $"Überwachung #{latest.RunId} vom {DateTime(latest.TakenAt)}", highlights, sections);
    }

    private static string ClassLabel(string objectClass) => objectClass.ToLowerInvariant() switch
    {
        "user" or "inetorgperson" => "Benutzer",
        "group" => "Gruppe",
        "computer" => "Computer",
        "msds-groupmanagedserviceaccount" => "gMSA",
        "msds-managedserviceaccount" => "MSA",
        "foreignsecurityprincipal" => "Fremd",
        _ => objectClass,
    };
}
