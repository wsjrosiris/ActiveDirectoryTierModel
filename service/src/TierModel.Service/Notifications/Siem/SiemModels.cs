using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using TierModel.Service.Data;
using TierModel.Service.Endpoints;
using TierModel.Service.Monitoring;
using TierModel.Service.Runs;

namespace TierModel.Service.Notifications.Siem;

public enum SyslogProtocol { Udp, Tcp, Tls }

/// <summary>Cef: RFC 5424 header with a CEF message (ArcSight/Sentinel "Common Event Format"). Rfc5424: structured data plus plain text.</summary>
public enum SyslogFormat { Cef, Rfc5424 }

public record SyslogSettings(string Host, int Port, SyslogProtocol Protocol, SyslogFormat Format, bool ValidateCertificate = true);

/// <summary>Azure Monitor Logs Ingestion API: data collection endpoint + rule + stream, app registration with client secret.</summary>
public record LogAnalyticsSettings(string TenantId, string ClientId, string EndpointUrl, string DcrImmutableId, string StreamName);

/// <summary>
/// Stored encrypted in <see cref="NotificationChannel.TargetProtected"/> for Syslog and Log Analytics channels (no schema change needed).
/// <paramref name="ClientSecret"/> is only returned to the UI as "set / not set".
/// </summary>
public record SiemChannelConfig(SyslogSettings? Syslog, LogAnalyticsSettings? LogAnalytics, string? ClientSecret, bool ForwardChangeLog)
{
    private static readonly JsonSerializerOptions Json = JsonDefaults.Create();

    public string Serialize() => JsonSerializer.Serialize(this, Json);

    public static SiemChannelConfig? Deserialize(string? json)
    {
        if (string.IsNullOrWhiteSpace(json) || !json.TrimStart().StartsWith('{')) return null;
        try { return JsonSerializer.Deserialize<SiemChannelConfig>(json, Json); }
        catch (JsonException) { return null; }
    }

    public static bool IsSiem(ChannelType type) => type is ChannelType.Syslog or ChannelType.LogAnalytics;

    /// <summary>Decrypts the configuration of a SIEM channel; null for other types or unreadable data.</summary>
    public static SiemChannelConfig? Read(NotificationChannel c, IDataProtector secrets)
    {
        if (!IsSiem(c.Type)) return null;
        try { return Deserialize(secrets.Unprotect(c.TargetProtected)); }
        catch (System.Security.Cryptography.CryptographicException) { return null; }
    }

    /// <summary>Short, secret-free description for lists ("tls://siem.contoso.com:6514 · CEF").</summary>
    public string Display() => Syslog is { } s
        ? $"{s.Protocol.ToString().ToLowerInvariant()}://{s.Host}:{s.Port} · {(s.Format == SyslogFormat.Cef ? "CEF" : "RFC 5424")}"
        : LogAnalytics is { } l
            ? $"{(Uri.TryCreate(l.EndpointUrl, UriKind.Absolute, out var u) ? u.Host : l.EndpointUrl)} · {l.StreamName}"
            : "–";
}

/// <summary>
/// One event for a SIEM. <see cref="Fields"/> use neutral keys (see <see cref="SiemFields"/>) that each format maps to its own names.
/// Severity follows CEF: 0 (lowest) … 10 (highest).
/// </summary>
public record SiemEvent(string EventId, string Name, int Severity, string Category, DateTimeOffset At, string Message,
    IReadOnlyList<KeyValuePair<string, string>> Fields)
{
    public string? Field(string key) => Fields.FirstOrDefault(f => f.Key == key).Value;
}

/// <summary>Neutral field names used by <see cref="SiemEvent.Fields"/>.</summary>
public static class SiemFields
{
    public const string Actor = "actor";
    public const string Account = "account";
    public const string AccountSid = "accountSid";
    public const string Action = "action";
    public const string Group = "group";
    public const string GroupSid = "groupSid";
    public const string Rule = "rule";
    public const string Object = "object";
    public const string Rights = "rights";
    public const string EntityType = "entityType";
    public const string EntityId = "entityId";
    public const string RunId = "runId";
    public const string Count = "count";
    public const string Tier = "tier";
    public const string Url = "url";
    public const string Id = "id";
    public const string DomainController = "dc";
    public const string Via = "via";
    public const string Direct = "direct";
    public const string RunKind = "runKind";
    public const string Status = "status";
    public const string Details = "details";
}

/// <summary>Builds <see cref="SiemEvent"/>s from notifications, runs, monitor findings and change-log entries.</summary>
public static class SiemEvents
{
    // Event catalogue (stable identifiers for SIEM rules; documented for the Sentinel mapping).
    public const string Test = "TM-100";
    public const string Drift = "TM-200";
    public const string RunFailed = "TM-201";
    public const string DeployApplied = "TM-202";
    public const string ApprovalRequested = "TM-203";
    public const string CertificateExpiring = "TM-204";
    public const string PrivilegedChange = "TM-300";
    public const string MemberAdded = "TM-301";
    public const string MemberRemoved = "TM-302";
    public const string UnexpectedMember = "TM-310";
    public const string HygieneFinding = "TM-320";
    public const string AttackPath = "TM-330";
    public const string ChangeLog = "TM-400";
    public const string JitRequested = "TM-500";
    public const string JitGranted = "TM-501";

    private static KeyValuePair<string, string> F(string key, object? value) =>
        new(key, Convert.ToString(value, CultureInfo.InvariantCulture) ?? "");

    private static List<KeyValuePair<string, string>> Clean(IEnumerable<KeyValuePair<string, string>> fields) =>
        fields.Where(f => !string.IsNullOrEmpty(f.Value)).ToList();

    /// <summary>Events without a run (test message, certificate warning) – facts become fields.</summary>
    public static SiemEvent FromMessage(NotificationMessage m, DateTimeOffset? at = null)
    {
        var (id, name, severity, category) = m.Event switch
        {
            null => (Test, "Test message", 1, "Test"),
            NotificationEvent.CertificateExpiring => (CertificateExpiring, "Service certificate expiring", m.Color == "attention" ? 8 : 6, "Service"),
            NotificationEvent.Drift => (Drift, "Audit drift detected", 5, "Audit"),
            NotificationEvent.Failure => (RunFailed, "Run failed", 6, "Run"),
            NotificationEvent.Apply => (DeployApplied, "Deployment applied", 7, "Deploy"),
            NotificationEvent.ApprovalRequested => (ApprovalRequested, "Approval requested", 4, "Deploy"),
            NotificationEvent.PrivilegedChange => (PrivilegedChange, "Privileged group change", 8, "PrivilegedAccess"),
            NotificationEvent.JitRequested => (JitRequested, "Just-in-time access requested", 4, "PrivilegedAccess"),
            NotificationEvent.JitGranted => (JitGranted, "Just-in-time access granted", 7, "PrivilegedAccess"),
            _ => (Test, "Event", 3, "Service"),
        };
        var fields = m.Facts.Select(f => F("fact" + Pascal(f.Label), f.Value)).ToList();
        if (m.Url is { } url) fields.Add(F(SiemFields.Url, url));
        return new SiemEvent(id, name, severity, category, at ?? DateTimeOffset.UtcNow, Join(m.Title, m.Text), Clean(fields));
    }

    /// <summary>A run event (drift, failure, applied, approval requested).</summary>
    public static SiemEvent ForRun(NotificationEvent e, Run run, string publicBaseUrl)
    {
        var (id, name, severity, message) = e switch
        {
            NotificationEvent.Drift => (Drift, "Audit drift detected", 5,
                $"Audit #{run.Id}: {run.DriftCount} Abweichung(en) zwischen Soll-Konfiguration und Active Directory"),
            NotificationEvent.Failure => (RunFailed, "Run failed", 6, $"{RunService.RunTitle(run)} #{run.Id} fehlgeschlagen: {run.Message}"),
            NotificationEvent.Apply => (DeployApplied, "Deployment applied", 7,
                $"Deploy #{run.Id} hat Änderungen im Active Directory angewendet" + (run.ApprovedBy is null ? "" : $" (freigegeben von {run.ApprovedBy})")),
            NotificationEvent.ApprovalRequested => (ApprovalRequested, "Approval requested", 4, $"{run.RequestedBy} möchte Deploy #{run.Id} anwenden"),
            _ => (PrivilegedChange, "Privileged group change", 8, $"Überwachung #{run.Id}: Änderung an privilegierten Gruppen"),
        };
        var url = string.IsNullOrWhiteSpace(publicBaseUrl) ? null : $"{publicBaseUrl.TrimEnd('/')}/laeufe/{run.Id}";
        return new SiemEvent(id, name, severity, run.Kind.ToString(), run.FinishedAt ?? DateTimeOffset.UtcNow, message, Clean(
        [
            F(SiemFields.RunId, run.Id), F(SiemFields.RunKind, run.Kind), F(SiemFields.Status, run.Status),
            F(SiemFields.Actor, run.RequestedBy), F(SiemFields.DomainController, run.PreferredDc),
            F(SiemFields.Count, e == NotificationEvent.Drift ? run.DriftCount : null),
            F("approvedBy", run.ApprovedBy), F("scope", run.Scope), F("mode", run.Mode), F(SiemFields.Url, url),
        ]));
    }

    /// <summary>
    /// One event per membership change and per new finding of a monitor run (unexpected member, high hygiene finding, attack path),
    /// using the same "new" rule as the notification (<see cref="PrivilegedEvaluator.Evaluate"/>).
    /// </summary>
    public static List<SiemEvent> ForMonitor(Run run, PrivilegedEvaluation current, PrivilegedEvaluation? previous, string publicBaseUrl)
    {
        var at = run.FinishedAt ?? DateTimeOffset.UtcNow;
        var url = string.IsNullOrWhiteSpace(publicBaseUrl) ? null : $"{publicBaseUrl.TrimEnd('/')}/privilegiert";
        var events = new List<SiemEvent>();
        var common = new[] { F(SiemFields.RunId, run.Id), F(SiemFields.DomainController, run.PreferredDc), F(SiemFields.Url, url) };

        foreach (var c in current.Changes)
        {
            var added = c.Change == "Added";
            events.Add(new SiemEvent(added ? MemberAdded : MemberRemoved, added ? "Privileged member added" : "Privileged member removed",
                added ? 8 : 5, "PrivilegedAccess", at,
                added ? $"{c.MemberName} zu {c.GroupName} hinzugefügt{(c.Direct ? "" : $" (über {string.Join(" › ", c.Via)})")}"
                    : $"{c.MemberName} aus {c.GroupName} entfernt",
                Clean([
                    F(SiemFields.Action, c.Change), F(SiemFields.Group, c.GroupName), F(SiemFields.GroupSid, c.GroupSid),
                    F(SiemFields.Account, c.MemberSam ?? c.MemberName), F(SiemFields.AccountSid, c.MemberSid), F("objectClass", c.ObjectClass),
                    F(SiemFields.Direct, c.Direct ? "true" : "false"), F(SiemFields.Via, string.Join(" > ", c.Via)), .. common,
                ])));
        }

        var prevUnexpected = (previous?.Unexpected ?? []).Select(u => u.GroupSid + "|" + u.MemberSid).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var u in current.Unexpected.Where(u => !prevUnexpected.Contains(u.GroupSid + "|" + u.MemberSid)))
            events.Add(new SiemEvent(UnexpectedMember, "Unexpected privileged member", 9, "PrivilegedAccess", at,
                $"Nicht erwartet: {u.MemberName} in {u.GroupName}{(u.Direct ? "" : $" (über {string.Join(" › ", u.Via)})")}",
                Clean([
                    F(SiemFields.Group, u.GroupName), F(SiemFields.GroupSid, u.GroupSid), F(SiemFields.Account, u.MemberSam ?? u.MemberName),
                    F(SiemFields.AccountSid, u.MemberSid), F("objectClass", u.ObjectClass), F(SiemFields.Direct, u.Direct ? "true" : "false"),
                    F(SiemFields.Via, string.Join(" > ", u.Via)), F(SiemFields.Tier, 0), .. common,
                ])));

        var prevHygiene = (previous?.Hygiene ?? []).Where(h => h.Severity == PrivilegedEvaluator.High).Select(h => h.Rule + "|" + h.Sid)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var h in current.Hygiene.Where(h => h.Severity == PrivilegedEvaluator.High && !prevHygiene.Contains(h.Rule + "|" + h.Sid)))
            events.Add(new SiemEvent(HygieneFinding, "Admin account hygiene finding", 7, "Hygiene", at,
                $"Hygiene (hoch): {h.Account} – {h.Title}: {h.Value}",
                Clean([
                    F(SiemFields.Rule, h.Rule), F(SiemFields.Account, h.Account), F(SiemFields.AccountSid, h.Sid), F(SiemFields.Tier, h.Tier),
                    F(SiemFields.Object, h.DistinguishedName), F(SiemFields.Details, h.Value), F("findingSeverity", h.Severity), .. common,
                ])));

        static string PathKey(AttackPath p) => $"{p.ObjectDn}|{p.PrincipalSid}|{string.Join(',', p.Rights.Order(StringComparer.OrdinalIgnoreCase))}";
        var prevPaths = (previous?.AttackPaths ?? []).Select(PathKey).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var p in current.AttackPaths.Where(p => !prevPaths.Contains(PathKey(p))))
            events.Add(new SiemEvent(AttackPath, "Attack path to Tier 0", 9, "AttackPath", at, $"Angriffspfad: {p.Sentence}",
                Clean([
                    F(SiemFields.Account, p.PrincipalName), F(SiemFields.AccountSid, p.PrincipalSid), F("objectClass", p.PrincipalClass),
                    F(SiemFields.Object, p.ObjectDn), F("objectType", p.ObjectType), F(SiemFields.Rights, string.Join(", ", p.Rights)),
                    F("inherited", p.Inherited ? "true" : "false"), F(SiemFields.Tier, 0), .. common,
                ])));
        return events;
    }

    /// <summary>Severity of a change-log entry by its action.</summary>
    public static int ChangeSeverity(string action) => action switch
    {
        "auth.locked" => 7,
        "auth.login-failed" or "auth.windows-denied" or "auth.entra-denied" => 5,
        _ when action.StartsWith("user.", StringComparison.Ordinal) || action.StartsWith("settings.", StringComparison.Ordinal)
            || action.StartsWith("run.approve", StringComparison.Ordinal) => 5,
        _ when action.StartsWith("auth.", StringComparison.Ordinal) => 2,
        _ => 3,
    };

    public static SiemEvent ForChange(ChangeEntry e) => new(ChangeLog, "Change log entry", ChangeSeverity(e.Action), "ChangeLog", e.At, e.Summary,
        Clean([
            F(SiemFields.Id, e.Id == 0 ? null : e.Id), F(SiemFields.Actor, e.Username), F(SiemFields.Action, e.Action),
            F(SiemFields.EntityType, e.EntityType), F(SiemFields.EntityId, e.EntityId),
        ]));

    private static string Join(string title, string text) => string.IsNullOrWhiteSpace(text) ? title : $"{title}: {text.Replace('\n', ' ')}";

    /// <summary>"Gültig bis" → "GultigBis": ASCII-only identifier from a German label.</summary>
    public static string Pascal(string label)
    {
        var sb = new System.Text.StringBuilder();
        var upper = true;
        foreach (var ch in label.Normalize(System.Text.NormalizationForm.FormD))
        {
            if (char.IsAsciiLetterOrDigit(ch)) { sb.Append(upper ? char.ToUpperInvariant(ch) : ch); upper = false; }
            else if (ch == 'ß') { sb.Append("ss"); upper = false; }
            else if (char.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark) upper = true;
        }
        return sb.ToString();
    }
}
