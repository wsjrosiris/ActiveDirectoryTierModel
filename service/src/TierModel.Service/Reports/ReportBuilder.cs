using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using TierModel.Service.Config;
using TierModel.Service.Data;
using TierModel.Service.Monitoring;
using TierModel.Service.Runs;
using TierModel.Service.Localization;

namespace TierModel.Service.Reports;

/// <summary>Collects the data of a report from the database into a <see cref="ReportDocument"/> (rendered as HTML or PDF).</summary>
/// <summary>Reports cover the current domain (<see cref="Domains.DomainContext"/>, roadmap 17); instance-wide change-log entries are included.</summary>
public class ReportBuilder(AppDbContext db, SettingsService settings, Domains.DomainContext domain, Domains.DomainRegistry domains)
{
    private int DomainId => domain.Id;

    /// <summary>Tables are cut after this many rows; the report says so.</summary>
    public const int MaxRows = 1000;

    private static readonly CultureInfo De = CultureInfo.GetCultureInfo("de-DE");

    /// <summary>Dates in the report language (request language, or the instance default for scheduled e-mails).</summary>
    private static CultureInfo DateCulture => L.Language == L.EnglishCode ? L.EnglishCulture : De;
    public static string Date(DateTimeOffset d) => d.ToLocalTime().ToString(L.DateFormat, DateCulture);
    public static string DateTime(DateTimeOffset d) => d.ToLocalTime().ToString(L.DateTimeFormat, DateCulture);
    public static string DateTime(DateTimeOffset? d) => d is { } v ? DateTime(v) : "–";

    private static readonly IReadOnlySet<string> Areas = new HashSet<string> { "ous", "groups", "users", "acls", "gpos", "admx", "msa", "gmsa", "dmsa", "winlaps", "authsilos" };

    public static string? AreaLabel(string area) => area switch
    {
        "ous" => "OUs", "groups" => L.T("Gruppen"), "users" => L.TC("section", "Benutzer"), "acls" => "OU-ACLs", "gpos" => "GPOs", "admx" => "ADMX",
        "msa" => "MSA", "gmsa" => "gMSA", "dmsa" => "dMSA", "winlaps" => "Windows LAPS", "authsilos" => L.TC("section", "Authentication Silos"),
        _ => null,
    };

    private static string? FindingType(string type) => type switch
    {
        "Missing" => L.T("Fehlend"), "Unexpected" => L.T("Unerwartet"), "Mismatch" => L.T("Abweichung"), "Error" => L.T("Fehler"),
        _ => null,
    };

    public static string? StatusText(RunStatus s) => s switch
    {
        RunStatus.Queued => L.T("In Warteschlange"), RunStatus.Running => L.T("Läuft"), RunStatus.Succeeded => L.T("Erfolgreich"),
        RunStatus.Failed => L.T("Fehlgeschlagen"), RunStatus.Cancelled => L.T("Abgebrochen"), RunStatus.AwaitingApproval => L.T("Wartet auf Freigabe"),
        RunStatus.Rejected => L.T("Abgelehnt"),
        _ => null,
    };

    public static string Severity(string? s) => ComplianceCalculator.NormalizeSeverity(s) switch { "High" => L.T("Hoch"), "Low" => L.T("Niedrig"), _ => L.T("Mittel") };

    public static Tone SeverityTone(string? s) => ComplianceCalculator.NormalizeSeverity(s) switch { "High" => Tone.Danger, "Low" => Tone.Muted, _ => Tone.Warning };

    private static int SeverityRank(string? s) => ComplianceCalculator.NormalizeSeverity(s) switch { "High" => 0, "Medium" => 1, _ => 2 };

    public static Tone ScoreTone(int? score) => score switch { null => Tone.Muted, >= 90 => Tone.Success, >= 70 => Tone.Warning, _ => Tone.Danger };

    public static string StatusLabel(RunStatus s) => StatusText(s) ?? (s.ToString() == "Scheduled" ? L.T("Geplant") : s.ToString());

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
        // Several domains: the report names the one it covers.
        if (domains.Multiple) instance = L.F("{0} · Domäne {1}", instance, domain.Label);
        var compliance = await PrivilegedEndpoints.ComplianceAsync(db, now, DomainId, ct);
        var scores = ComplianceCalculator.Tiers.Select(tier =>
        {
            var c = compliance.Current?.FirstOrDefault(x => x.Tier == tier);
            return new ReportScore($"Tier {tier}", c?.Score,
                c is null ? L.T("keine Daten") : c.Deductions.Count == 0 ? L.T("keine Abzüge") : L.F("{0} Punkte Abzug", c.Deductions.Sum(d => d.Points)));
        }).ToList();

        var doc = type switch
        {
            ReportTypes.SollIst => await SollIstAsync(end, ct),
            ReportTypes.Changes => await ChangesAsync(start, end, ct),
            ReportTypes.Privileged => await PrivilegedAsync(start, end, compliance, ct),
            _ => throw new ArgumentOutOfRangeException(nameof(type), type, L.T("Unbekannter Berichtstyp.")),
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
        var domainId = DomainId;
        var audit = await db.Runs.AsNoTracking()
            .Where(r => r.DomainId == domainId && r.Kind == RunKind.Audit && r.Status == RunStatus.Succeeded && r.CreatedAt < end)
            .OrderByDescending(r => r.Id).FirstOrDefaultAsync(ct);
        var subtitle = L.T("Abgleich der Soll-Konfiguration mit dem Active Directory (letztes Audit)");
        if (audit is null)
            return Empty(subtitle, L.T("Kein erfolgreiches Audit vorhanden"), [],
                [new ReportSection(L.T("Zusammenfassung"), null, [new ReportParagraph(L.T("Bis zum Enddatum wurde kein Audit erfolgreich abgeschlossen. Bitte zuerst ein Audit starten."), Tone.Warning)])]);

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
        string Area(JsonObject f) => Str(f, "area") is { } a && Areas.Contains(a) ? a : "other";

        var drift = audit.DriftCount ?? findings.Count;
        var highlights = new List<ReportStat>
        {
            new(L.T("Geprüfte Objekte"), Num("totalChecked")?.ToString(De) ?? "–"),
            new(L.T("Abweichungen"), drift.ToString(De), drift > 0 ? Tone.Danger : Tone.Success),
            new(L.T("Hoch"), findings.Count(f => SeverityRank(Str(f, "severity")) == 0).ToString(De), Tone.Danger),
            new(L.T("Mittel"), findings.Count(f => SeverityRank(Str(f, "severity")) == 1).ToString(De), Tone.Warning),
            new(L.T("Niedrig"), findings.Count(f => SeverityRank(Str(f, "severity")) == 2).ToString(De), Tone.Muted),
        };

        var sections = new List<ReportSection>
        {
            new(L.T("Zusammenfassung"), null,
            [
                new ReportKeyValues(
                [
                    new("Audit", L.F("#{0} vom {1}", audit.Id, DateTime(audit.FinishedAt ?? audit.CreatedAt))),
                    new(L.T("Bereich"), ScopeLabel(audit)),
                    new(L.T("Domänencontroller"), audit.PreferredDc),
                    new(L.T("Angefordert von"), audit.RequestedBy + (audit.Trigger == RunTrigger.Schedule ? L.T(" (Zeitplan)") : "")),
                ]),
                new ReportStats(
                [
                    new(L.T("Fehlend"), (Num("missingCount") ?? 0).ToString(De), Num("missingCount") > 0 ? Tone.Warning : Tone.Default),
                    new(L.T("Unerwartet"), (Num("unexpectedCount") ?? 0).ToString(De), Num("unexpectedCount") > 0 ? Tone.Warning : Tone.Default),
                    new(L.T("Abweichend"), (Num("mismatchCount") ?? 0).ToString(De), Num("mismatchCount") > 0 ? Tone.Warning : Tone.Default),
                    new(L.T("Verwaiste GPO-Links"), (Num("orphanedGpoLinkCount") ?? 0).ToString(De)),
                    new(L.T("Sicherheitsabweichungen"), (Num("securityDeltaCount") ?? 0).ToString(De)),
                ]),
                drift == 0
                    ? new ReportParagraph(L.T("Das Active Directory entspricht der Soll-Konfiguration – es wurden keine Abweichungen gefunden."), Tone.Success)
                    : new ReportParagraph(L.F("Das Audit hat {0} Abweichung(en) gefunden. Die folgenden Abschnitte listen sie nach Bereich und Schweregrad.", drift), Tone.Warning),
            ]),
        };

        if (findings.Count > 0)
        {
            var byArea = findings.GroupBy(Area).OrderBy(g => g.Min(f => SeverityRank(Str(f, "severity")))).ThenByDescending(g => g.Count()).ToList();
            sections.Add(new ReportSection(L.T("Befunde nach Bereich und Schweregrad"), null,
            [
                new ReportTable(
                    [new(L.T("Bereich"), 3), new(L.T("Hoch"), 1), new(L.T("Mittel"), 1), new(L.T("Niedrig"), 1), new(L.T("Gesamt"), 1)],
                    byArea.Select(g => new List<ReportCell>
                    {
                        AreaLabel(g.Key) ?? L.T("Sonstige"),
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
                        FindingType(Str(f, "type") ?? "") ?? Str(f, "type") ?? "–",
                        new(Str(f, "identifier") ?? "–", Sub: Str(f, "resourceType")),
                        new(Str(f, "details") ?? Str(f, "property") ?? "–",
                            Sub: expected is null && actual is null ? null : L.F("Soll: {0} · Ist: {1}", expected ?? "–", actual ?? "–")),
                    };
                }).ToList();
                sections.Add(new ReportSection($"{AreaLabel(g.Key) ?? L.T("Sonstige")} ({g.Count()})", null,
                [
                    new ReportTable([new(L.T("Schwere"), 1.1), new(L.T("Art"), 1.2), new(L.T("Objekt"), 4, Mono: true), new(L.T("Befund"), 4.5)], rows,
                        Note: g.Count() > MaxRows ? L.F("Nur die ersten {0} von {1} Befunden.", MaxRows, g.Count()) : null),
                ]));
            }
        }
        return Empty(subtitle, L.F("Audit #{0} vom {1}", audit.Id, DateTime(audit.FinishedAt ?? audit.CreatedAt)), highlights, sections);
    }

    private static ReportCell Count(int n, Tone tone) => n == 0 ? new ReportCell("–", Tone.Muted) : new ReportCell(n.ToString(De), tone);

    private static string ScopeLabel(Run r)
    {
        var scope = r.Scope switch
        {
            DeployScope.FullDeployment => L.T("Vollständig"),
            DeployScope.OuOnly => L.T("Nur OUs"),
            DeployScope.GroupOnly => L.T("Nur Gruppen"),
            DeployScope.UserOnly => L.T("Nur Benutzer"),
            DeployScope.GposOnly => L.T("Nur GPOs"),
            DeployScope.OuAclsOnly => L.T("Nur OU-ACLs"),
            DeployScope.AdmxOnly => L.T("Nur ADMX"),
            DeployScope.AuthSilosOnly => L.T("Nur Authentication Silos"),
            _ => r.Kind == RunKind.Monitor ? L.T("Privilegierte Gruppen") : "–",
        };
        var includes = RunSummaryDto.IncludeList(r.IncludeMsa, r.IncludeGmsa, r.IncludeDmsa, r.IncludeWinLaps);
        return includes.Length == 0 ? scope : $"{scope} + {string.Join(", ", includes.Select(i => i switch { "Msa" => "MSA", "Gmsa" => "gMSA", "Dmsa" => "dMSA", "WinLaps" => "Windows LAPS", _ => i }))}";
    }

    // ------------------------------------------------------------------ Änderungen im Zeitraum

    private async Task<ReportDocument> ChangesAsync(DateTimeOffset start, DateTimeOffset end, CancellationToken ct)
    {
        var domainId = DomainId;
        var versions = await db.ConfigVersions.AsNoTracking().Where(v => v.DomainId == domainId && v.CreatedAt >= start && v.CreatedAt < end)
            .OrderByDescending(v => v.CreatedAt).Select(v => new { v.SectionKey, v.Version, v.CreatedBy, v.CreatedAt, v.Comment }).ToListAsync(ct);
        var runs = await db.Runs.AsNoTracking().Where(r => r.DomainId == domainId && r.CreatedAt >= start && r.CreatedAt < end).OrderByDescending(r => r.Id).ToListAsync(ct);
        var approvals = await db.Runs.AsNoTracking().Where(r => r.DomainId == domainId && r.ApprovedAt >= start && r.ApprovedAt < end).OrderByDescending(r => r.ApprovedAt).ToListAsync(ct);
        var log = ChangeLogService.ForDomain(db.ChangeLog.AsNoTracking(), domain.Current);
        var changeCount = await log.CountAsync(e => e.At >= start && e.At < end, ct);
        var changes = await log.Where(e => e.At >= start && e.At < end).OrderByDescending(e => e.Id).Take(MaxRows)
            .Select(e => new { e.At, e.Username, e.Action, e.Summary }).ToListAsync(ct);

        var applies = runs.Count(r => r.Kind == RunKind.Deploy && r.Mode == RunMode.Apply);
        var failed = runs.Count(r => r.Status == RunStatus.Failed);
        var highlights = new List<ReportStat>
        {
            new(L.T("Konfigurationsversionen"), versions.Count.ToString(De), versions.Count > 0 ? Tone.Info : Tone.Default),
            new(L.T("Läufe"), runs.Count.ToString(De)),
            new(L.T("Anwendungen"), applies.ToString(De), applies > 0 ? Tone.Warning : Tone.Default),
            new(L.T("Freigabeentscheidungen"), approvals.Count.ToString(De)),
            new(L.T("Protokolleinträge"), changeCount.ToString(De)),
        };

        var sections = new List<ReportSection>
        {
            new(L.T("Übersicht"), null,
            [
                new ReportStats(
                [
                    new("Audits", runs.Count(r => r.Kind == RunKind.Audit).ToString(De)),
                    new(L.T("Planungen"), runs.Count(r => r.Kind == RunKind.Deploy && r.Mode != RunMode.Apply).ToString(De)),
                    new(L.T("Anwendungen"), applies.ToString(De)),
                    new(L.T("Überwachungen"), runs.Count(r => r.Kind == RunKind.Monitor).ToString(De)),
                    new(L.T("Fehlgeschlagen"), failed.ToString(De), failed > 0 ? Tone.Danger : Tone.Default),
                ]),
            ]),
            new(L.T("Konfigurationsänderungen"), L.T("Jede gespeicherte Version der Soll-Konfiguration mit dem Kommentar der Person, die sie gespeichert hat."),
            [
                new ReportTable([new(L.T("Zeitpunkt"), 1.6), new(L.T("Bereich"), 2), new(L.T("Version"), 0.9), new(L.T("Von"), 1.6), new(L.T("Kommentar"), 4)],
                    versions.Take(MaxRows).Select(v => new List<ReportCell>
                    {
                        DateTime(v.CreatedAt), ConfigCatalog.Find(v.SectionKey)?.Title ?? v.SectionKey, $"v{v.Version}", v.CreatedBy,
                        string.IsNullOrWhiteSpace(v.Comment) ? new ReportCell(L.T("ohne Kommentar"), Tone.Muted) : new ReportCell(v.Comment!),
                    }).ToList(), L.T("Im Zeitraum wurde die Konfiguration nicht geändert.")),
            ]),
            new(L.T("Läufe"), null,
            [
                new ReportTable([new(L.T("Lauf"), 0.8), new(L.T("Art"), 1.6), new("Status", 1.4), new(L.T("Angefordert"), 2.2), new(L.T("Ergebnis"), 4)],
                    runs.Take(MaxRows).Select(r => new List<ReportCell>
                    {
                        $"#{r.Id}", new(RunService.RunTitle(r), Sub: ScopeLabel(r)),
                        new(StatusLabel(r.Status), StatusTone(r.Status), Badge: true),
                        new(r.RequestedBy + (r.Trigger == RunTrigger.Schedule ? L.T(" (Zeitplan)") : ""), Sub: DateTime(r.CreatedAt)),
                        r.Message ?? "–",
                    }).ToList(), L.T("Im Zeitraum gab es keine Läufe."), runs.Count > MaxRows ? L.F("Nur die neuesten {0} von {1} Läufen.", MaxRows, runs.Count) : null),
            ]),
            new(L.T("Freigaben"), L.T("Entscheidungen im Vier-Augen-Verfahren für das Anwenden von Änderungen."),
            [
                new ReportTable([new("Deploy", 0.9), new(L.T("Beantragt von"), 1.8), new(L.T("Entscheidung"), 1.5), new(L.T("Durch"), 1.8), new(L.T("Zeitpunkt"), 1.6), new(L.T("Kommentar"), 3)],
                    approvals.Select(r => new List<ReportCell>
                    {
                        $"#{r.Id}", r.RequestedBy,
                        r.Status == RunStatus.Rejected ? new ReportCell(L.T("Abgelehnt"), Tone.Danger, Badge: true) : new ReportCell(L.T("Freigegeben"), Tone.Success, Badge: true),
                        r.ApprovedBy ?? "–", DateTime(r.ApprovedAt),
                        string.IsNullOrWhiteSpace(r.ApprovalComment) ? new ReportCell("–", Tone.Muted) : new ReportCell(r.ApprovalComment!),
                    }).ToList(), L.T("Im Zeitraum wurde nichts freigegeben oder abgelehnt.")),
            ]),
            new(L.T("Änderungsprotokoll"), L.T("Alle protokollierten Aktionen im Zeitraum (Anmeldungen, Benutzer, Einstellungen, Läufe, Konfiguration)."),
            [
                new ReportTable([new(L.T("Zeitpunkt"), 1.5), new(L.T("Benutzer"), 1.7), new(L.T("Aktion"), 1.9), new(L.T("Beschreibung"), 5)],
                    changes.Select(e => new List<ReportCell> { DateTime(e.At), e.Username, ActionLabel(e.Action), e.Summary }).ToList(),
                    L.T("Keine Einträge im Zeitraum."), changeCount > MaxRows ? L.F("Nur die neuesten {0} von {1} Einträgen – der vollständige Verlauf steht im Änderungsprotokoll.", MaxRows, changeCount) : null),
            ]),
        };
        return Empty(L.T("Konfiguration, Läufe, Freigaben und Änderungsprotokoll"), $"{Date(start)} – {Date(end.AddTicks(-1))}", highlights, sections);
    }

    public static string ActionLabel(string action) => action switch
    {
        "config.update" => L.T("Konfiguration geändert"),
        "config.restore" => L.T("Version wiederhergestellt"),
        "run.deploy" => L.T("Deploy gestartet"),
        "run.audit" => L.T("Audit gestartet"),
        "run.monitor" => L.T("Überwachung gestartet"),
        "run.cancel" => L.T("Lauf abgebrochen"),
        "run.approve" => L.T("Deploy freigegeben"),
        "run.reject" => L.T("Deploy abgelehnt"),
        "user.create" => L.T("Benutzer angelegt"),
        "user.update" => L.T("Benutzer geändert"),
        "user.delete" => L.T("Benutzer gelöscht"),
        "auth.login" => L.T("Anmeldung"),
        "auth.login-failed" => L.T("Fehlgeschlagene Anmeldung"),
        "auth.windows-login" => L.T("Windows-Anmeldung"),
        "auth.entra-login" => L.T("Entra-Anmeldung"),
        "auth.entra-denied" => L.T("Entra-Anmeldung abgelehnt"),
        "settings.update" => L.T("Einstellungen geändert"),
        "notification.failed" => L.T("Benachrichtigung fehlgeschlagen"),
        _ => action,
    };

    // ------------------------------------------------------------------ Privilegierte Zugriffe

    private async Task<ReportDocument> PrivilegedAsync(DateTimeOffset start, DateTimeOffset end, ComplianceDto compliance, CancellationToken ct)
    {
        var latest = await db.PrivilegedSnapshots.AsNoTracking().Where(x => x.DomainId == DomainId && x.TakenAt < end).OrderByDescending(x => x.Id).FirstOrDefaultAsync(ct);
        var subtitle = L.T("Mitglieder privilegierter Gruppen, Hygiene, Angriffspfade und Compliance-Wert");
        if (latest is null || PrivilegedSnapshotReader.Deserialize(latest.Data) is not { } data)
            return Empty(subtitle, L.T("Keine Überwachung vorhanden"), [],
                [new ReportSection(L.T("Zusammenfassung"), null, [new ReportParagraph(L.T("Bis zum Enddatum gibt es keine Überwachung privilegierter Gruppen. Bitte zuerst eine Überwachung starten."), Tone.Warning)])]);

        var evaluation = PrivilegedEvaluation.Deserialize(latest.Evaluation) ?? new PrivilegedEvaluation(true, [], [], [], [], [], HygieneThresholds.Default);
        var unexpected = evaluation.Unexpected.Select(u => (u.GroupSid, u.MemberSid)).ToHashSet();
        var high = evaluation.Hygiene.Count(h => h.Severity == PrivilegedEvaluator.High);
        var highlights = new List<ReportStat>
        {
            new(L.T("Gruppen"), data.Groups.Count.ToString(De)),
            new(L.T("Mitgliedschaften"), data.MemberCount.ToString(De)),
            new(L.T("Nicht erwartet"), evaluation.Unexpected.Count.ToString(De), evaluation.Unexpected.Count > 0 ? Tone.Danger : Tone.Success),
            new(L.T("Hygiene (hoch)"), high.ToString(De), high > 0 ? Tone.Danger : Tone.Success),
            new(L.T("Angriffspfade"), evaluation.AttackPaths.Count.ToString(De), evaluation.AttackPaths.Count > 0 ? Tone.Danger : Tone.Success),
        };

        var sections = new List<ReportSection>
        {
            new(L.T("Compliance-Wert"), L.T("Jede Ebene startet bei 100 Punkten; Befunde ziehen Punkte ab (Audit-Abweichungen, nicht erwartete Mitglieder, Hygiene, Angriffspfade)."),
            [
                new ReportTable([new(L.T("Ebene"), 1), new(L.T("Wert"), 1), new(L.T("Abzüge"), 6)],
                    (compliance.Current ?? []).Select(t => new List<ReportCell>
                    {
                        $"Tier {t.Tier}", new(t.Score.ToString(De), ScoreTone(t.Score), Badge: true),
                        t.Deductions.Count == 0 ? new ReportCell(L.T("keine"), Tone.Muted)
                            : new ReportCell(string.Join("; ", t.Deductions.Select(d => $"{d.Label}: {d.Count} × {d.PointsEach} = {d.Points}"))),
                    }).ToList(), L.T("Noch keine Daten für den Compliance-Wert.")),
                new ReportKeyValues(
                [
                    new(L.T("Überwachung"), L.F("#{0} vom {1}", latest.RunId, DateTime(latest.TakenAt))),
                    new(L.T("Domäne"), data.Metadata.Domain ?? "–"),
                    new(L.T("Domänencontroller"), data.Metadata.PreferredDc ?? "–"),
                ]),
            ]),
            new(L.T("Nicht erwartete Mitglieder"), L.T("Mitglieder geschützter oder Tier-0-Gruppen, die weder zur Standard-Verschachtelung noch zur Tier-0-Konfiguration gehören."),
            [
                new ReportTable([new(L.T("Gruppe"), 2), new(L.T("Mitglied"), 2.4), new(L.T("Typ"), 1), new(L.T("Mitgliedschaft"), 2.6), new("Status", 1)],
                    evaluation.Unexpected.Select(u => new List<ReportCell>
                    {
                        u.GroupName, new(u.MemberName, Sub: u.MemberSam), ClassLabel(u.ObjectClass),
                        u.Direct ? L.T("direkt") : L.T("über ") + string.Join(" › ", u.Via),
                        u.Enabled == false ? new ReportCell(L.T("deaktiviert"), Tone.Muted) : new ReportCell(L.T("aktiv")),
                    }).ToList(), L.T("Keine nicht erwarteten Mitglieder.")),
            ]),
            new(L.T("Angriffspfade zu Tier 0"), L.T("Berechtigungen auf Tier-0-Objekten für Konten und Gruppen außerhalb von Tier 0."),
            [
                new ReportTable([new(L.T("Berechtigter"), 2.2), new(L.T("Rechte"), 2.2), new(L.T("Objekt"), 3.2), new(L.T("Hinweis"), 2.4)],
                    evaluation.AttackPaths.Take(MaxRows).Select(p => new List<ReportCell>
                    {
                        new(p.PrincipalName, Sub: PrivilegedEvaluator.PrincipalDescription(p.PrincipalClass, p.MemberCount)),
                        string.Join(", ", p.Rights),
                        new(p.ObjectName, Sub: PrivilegedEvaluator.ObjectTypeLabel(p.ObjectType) + (p.Inherited ? L.T(" · geerbt") : "")),
                        p.MembershipPath ?? "–",
                    }).ToList(), L.T("Keine Angriffspfade gefunden.")),
            ]),
            new(L.T("Hygiene-Befunde"), L.F("Prüfung der Konten in Tier 0 und Tier 1 (Schwellwerte: {0} Tage ohne Anmeldung, Passwort älter als {1} Tage).", evaluation.Thresholds.StaleDays, evaluation.Thresholds.PasswordMaxAgeDays),
            [
                new ReportTable([new(L.T("Schwere"), 1), new(L.T("Konto"), 2), new("Tier", 0.7), new(L.T("Regel"), 2.2), new("Details", 4)],
                    evaluation.Hygiene.OrderBy(h => SeverityRank(h.Severity)).ThenBy(h => h.Account, StringComparer.CurrentCultureIgnoreCase).Take(MaxRows)
                        .Select(h => new List<ReportCell>
                        {
                            new(Severity(h.Severity), SeverityTone(h.Severity), Badge: true), h.Account, h.Tier is { } t ? t.ToString(De) : "–", PrivilegedEvaluator.RuleTitle(h.Rule), h.Value,
                        }).ToList(), L.T("Keine Hygiene-Befunde.")),
            ]),
        };

        // Membership changes within the period.
        var changeRows = await db.PrivilegedSnapshots.AsNoTracking()
            .Where(x => x.DomainId == DomainId && x.ChangeCount > 0 && x.TakenAt >= start && x.TakenAt < end)
            .OrderByDescending(x => x.Id).Take(200).Select(x => new { x.TakenAt, x.Evaluation }).ToListAsync(ct);
        var changes = changeRows.SelectMany(r => (PrivilegedEvaluation.Deserialize(r.Evaluation)?.Changes ?? []).Select(c => (r.TakenAt, c))).Take(MaxRows).ToList();
        sections.Add(new ReportSection(L.T("Änderungen an Mitgliedschaften im Zeitraum"), null,
        [
            new ReportTable([new(L.T("Erkannt"), 1.6), new(L.T("Änderung"), 1.3), new(L.T("Gruppe"), 2.2), new(L.T("Mitglied"), 2.6), new(L.T("Mitgliedschaft"), 2.2)],
                changes.Select(x => new List<ReportCell>
                {
                    DateTime(x.TakenAt),
                    x.c.Change == "Added" ? new ReportCell(L.T("hinzugefügt"), Tone.Warning, Badge: true) : new ReportCell(L.T("entfernt"), Tone.Muted, Badge: true),
                    x.c.GroupName, new(x.c.MemberName, Sub: x.c.MemberSam), x.c.Direct ? L.T("direkt") : L.T("über ") + string.Join(" › ", x.c.Via),
                }).ToList(), L.T("Im Zeitraum wurden keine Änderungen erkannt.")),
        ]));

        var blocks = new List<ReportBlock>();
        foreach (var g in data.Groups.OrderByDescending(g => g.Members.Any(m => unexpected.Contains((g.Sid, m.Sid))))
                     .ThenBy(g => g.Source == "builtin" ? 0 : 1).ThenBy(g => g.Name, StringComparer.CurrentCultureIgnoreCase))
        {
            var n = g.Members.Count(m => unexpected.Contains((g.Sid, m.Sid)));
            blocks.Add(new ReportSubheading(g.Name, (g.Members.Count == 1 ? L.T("1 Mitglied") : L.F("{0} Mitglieder", g.Members.Count))
                + (g.Tier is { } tier ? $" · Tier {tier}" : "") + (n > 0 ? L.F(" · {0} nicht erwartet", n) : "")));
            blocks.Add(new ReportTable([new(L.T("Mitglied"), 2.6), new(L.T("Konto"), 2), new(L.T("Typ"), 1), new(L.T("Mitgliedschaft"), 2.6), new(L.T("Bewertung"), 1.4)],
                g.Members.OrderByDescending(m => unexpected.Contains((g.Sid, m.Sid))).ThenByDescending(m => m.IsDirect)
                    .ThenBy(m => m.DisplayName, StringComparer.CurrentCultureIgnoreCase).Take(MaxRows)
                    .Select(m => new List<ReportCell>
                    {
                        m.DisplayName, new(m.SamAccountName ?? "–"), ClassLabel(m.ObjectClass),
                        m.IsDirect ? L.T("direkt") : L.T("über ") + string.Join(" › ", m.Via),
                        unexpected.Contains((g.Sid, m.Sid)) ? new ReportCell(L.T("nicht erwartet"), Tone.Danger, Badge: true)
                            : m.Enabled == false ? new ReportCell(L.T("deaktiviert"), Tone.Muted) : new ReportCell(L.T("erwartet"), Tone.Success),
                    }).ToList(), L.T("Keine Mitglieder.")));
        }
        sections.Add(new ReportSection(L.T("Mitglieder privilegierter Gruppen"), L.T("Stand der letzten Überwachung; Gruppen mit Befunden zuerst."), blocks));

        return Empty(subtitle, L.F("Überwachung #{0} vom {1}", latest.RunId, DateTime(latest.TakenAt)), highlights, sections);
    }

    private static string ClassLabel(string objectClass) => objectClass.ToLowerInvariant() switch
    {
        "user" or "inetorgperson" => L.T("Benutzer"),
        "group" => L.T("Gruppe"),
        "computer" => "Computer",
        "msds-groupmanagedserviceaccount" => "gMSA",
        "msds-managedserviceaccount" => "MSA",
        "foreignsecurityprincipal" => L.T("Fremd"),
        _ => objectClass,
    };
}
