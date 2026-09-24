using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using TierModel.Service.Config;
using TierModel.Service.Localization;

namespace TierModel.Service.Monitoring;

public record MembershipChange(string Change, string GroupSid, string GroupName, string MemberSid, string? MemberSam, string MemberName,
    string ObjectClass, bool Direct, List<string> Via);

public record UnexpectedMember(string GroupSid, string GroupName, string MemberSid, string? MemberSam, string MemberName, string ObjectClass,
    bool Direct, List<string> Via, bool? Enabled);

public record HygieneFinding(string Rule, string Title, string Severity, string Sid, string Account, string? DistinguishedName, string ObjectClass,
    int? Tier, string Value);

public record AttackPath(string ObjectDn, string ObjectType, string ObjectName, string PrincipalSid, string PrincipalName, string PrincipalClass,
    List<string> Rights, int? MemberCount, List<string> SampleMembers, bool Inherited, string Severity, string Sentence, string? MembershipPath);

public record HygieneThresholds(int StaleDays, int PasswordMaxAgeDays)
{
    public static readonly HygieneThresholds Default = new(90, 365);
}

/// <param name="Baseline">No previous snapshot: there are no membership changes to report.</param>
/// <param name="NewFindings">Unexpected members, High hygiene findings and attack paths not present in the previous evaluation (German lines).</param>
public record PrivilegedEvaluation(bool Baseline, List<MembershipChange> Changes, List<UnexpectedMember> Unexpected, List<HygieneFinding> Hygiene,
    List<AttackPath> AttackPaths, List<string> NewFindings, HygieneThresholds Thresholds)
{
    /// <summary>Drift of a monitor run: unexpected members plus membership changes.</summary>
    public int DriftCount => Unexpected.Count + Changes.Count;

    /// <summary>Whether the change is worth a PrivilegedChange notification.</summary>
    public bool Notify => Changes.Count > 0 || NewFindings.Count > 0;

    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public string Serialize() => JsonSerializer.Serialize(this, JsonOptions);

    public static PrivilegedEvaluation? Deserialize(string? json) =>
        string.IsNullOrEmpty(json) ? null : JsonSerializer.Deserialize<PrivilegedEvaluation>(json, JsonOptions);
}

/// <summary>Tier 0 as the desired configuration defines it.</summary>
public sealed class Tier0Config
{
    /// <summary>samAccountName and name of every configured Tier 0 group.</summary>
    public HashSet<string> Groups { get; } = new(StringComparer.OrdinalIgnoreCase);
    /// <summary>samAccountName of every configured Tier 0 account (users section: Tier 0 OU, or member of a Tier 0 group).</summary>
    public HashSet<string> Accounts { get; } = new(StringComparer.OrdinalIgnoreCase);
    /// <summary>Just-in-Time memberships active at the time of the snapshot (roadmap 6): expected, not flagged.</summary>
    public List<Jit.JitExpectation> Jit { get; } = [];

    /// <summary>The active JIT grant that explains this membership: same member SID (or account) and the JIT group itself or a JIT group on the nesting path.</summary>
    public Jit.JitExpectation? JitFor(PrivilegedGroup group, PrivilegedMember member) => Jit.FirstOrDefault(j =>
        (j.MemberSid is { } sid ? string.Equals(sid, member.Sid, StringComparison.OrdinalIgnoreCase)
            : string.Equals(j.MemberAccount, member.SamAccountName, StringComparison.OrdinalIgnoreCase))
        && ((j.GroupSid is { } g && string.Equals(g, group.Sid, StringComparison.OrdinalIgnoreCase))
            || j.GroupNames.Any(n => string.Equals(n, group.Name, StringComparison.OrdinalIgnoreCase)
                || member.Via.Any(v => string.Equals(v, n, StringComparison.OrdinalIgnoreCase)))));

    public static Tier0Config From(IReadOnlyDictionary<string, JsonNode?> sections)
    {
        var c = new Tier0Config();
        foreach (var g in Items(sections, "groups", "groups"))
        {
            var tier = TierRules.TierOf(Str(g, "name")) ?? TierRules.TierOf(Str(g, "samaccountname")) ?? TierRules.TierOf(Str(g, "path"));
            if (tier != 0) continue;
            if (Str(g, "samaccountname") is { Length: > 0 } sam) c.Groups.Add(sam);
            if (Str(g, "name") is { Length: > 0 } name) c.Groups.Add(name);
        }
        foreach (var u in Items(sections, "users", "users"))
        {
            if (Str(u, "samAccountName") is not { Length: > 0 } sam) continue;
            var memberOf = u["memberOf"] is JsonArray a ? a.Select(x => x?.ToString() ?? "") : [];
            if (TierRules.TierOf(Str(u, "ouPath")) == 0 || memberOf.Any(c.Groups.Contains)) c.Accounts.Add(sam);
        }
        return c;
    }

    public bool IsTier0Group(string? samOrName) => !string.IsNullOrWhiteSpace(samOrName) && Groups.Contains(TierRules.Bare(samOrName));

    public bool IsTier0Account(string? sam) => !string.IsNullOrWhiteSpace(sam) && Accounts.Contains(TierRules.Bare(sam));

    private static IEnumerable<JsonObject> Items(IReadOnlyDictionary<string, JsonNode?> sections, string key, string prop) =>
        sections.GetValueOrDefault(key)?[prop] is JsonArray a ? a.OfType<JsonObject>() : [];

    private static string? Str(JsonObject o, string prop) => o[prop] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
}

/// <summary>
/// Compares a privileged-access snapshot with the previous one and with the desired configuration. Pure: no I/O, no clock
/// (the caller passes "now"). Matching uses SIDs and samAccountNames only, so localized group names never matter.
/// </summary>
public static class PrivilegedEvaluator
{
    public const string High = "High";
    public const string Medium = "Medium";
    public const string Low = "Low";

    /// <summary>
    /// Default nesting of a fresh domain that is always expected, as (group, member). A value starting with "-" is a
    /// domain-relative RID (matches any S-1-5-21-…-RID, so also the forest root's Enterprise/Schema Admins), anything else a full SID.
    /// <list type="bullet">
    /// <item>Administrators (S-1-5-32-544) ← Domain Admins (-512), Enterprise Admins (-519)</item>
    /// <item>Denied RODC Password Replication Group (-572) ← krbtgt (-502), Domain Admins, Domain Controllers (-516), Cert Publishers (-517),
    /// Schema Admins (-518), Enterprise Admins, Group Policy Creator Owners (-520), Read-only Domain Controllers (-521)</item>
    /// <item>Windows Authorization Access Group (S-1-5-32-560) ← Enterprise Domain Controllers (S-1-5-9)</item>
    /// <item>Pre-Windows 2000 Compatible Access (S-1-5-32-554) ← Authenticated Users (S-1-5-11)</item>
    /// </list>
    /// In addition (see <see cref="IsExpected"/>): the built-in Administrator (RID 500) in any group, computer accounts in
    /// Domain Controllers (-516), Read-only Domain Controllers (-521) and Enterprise Read-only Domain Controllers (-498),
    /// configured Tier 0 groups and accounts, and accounts located in a Tier 0 OU of the model.
    /// </summary>
    public static readonly IReadOnlyList<(string Group, string Member)> DefaultNesting =
    [
        ("S-1-5-32-544", "-512"),
        ("S-1-5-32-544", "-519"),
        ("-572", "-502"), ("-572", "-512"), ("-572", "-516"), ("-572", "-517"), ("-572", "-518"), ("-572", "-519"), ("-572", "-520"), ("-572", "-521"),
        ("S-1-5-32-560", "S-1-5-9"),
        ("S-1-5-32-554", "S-1-5-11"),
    ];

    /// <summary>Groups whose computer members are domain controllers.</summary>
    private static readonly string[] DomainControllerGroups = ["-516", "-521", "-498"];

    /// <summary>Principals that are Tier 0 by definition in ACLs (contract exclusions plus the monitored groups themselves).</summary>
    private static readonly string[] Tier0AclPrincipals =
        ["S-1-5-18", "S-1-5-32-544", "-512", "-519", "-518", "S-1-5-9", "-516", "S-1-5-10", "S-1-3-0", "-526", "-527", "-500"];

    public static bool SidMatches(string? sid, string pattern) =>
        sid is not null && (pattern.StartsWith('-')
            ? sid.StartsWith("S-1-5-21-", StringComparison.OrdinalIgnoreCase) && sid.EndsWith(pattern, StringComparison.OrdinalIgnoreCase)
            : string.Equals(sid, pattern, StringComparison.OrdinalIgnoreCase));

    public static bool IsBuiltinAdministrator(string? sid) => SidMatches(sid, "-500");

    public static bool IsUser(string objectClass) => objectClass.Equals("user", StringComparison.OrdinalIgnoreCase) || objectClass.Equals("inetOrgPerson", StringComparison.OrdinalIgnoreCase);

    public static bool IsComputer(string objectClass) => objectClass.Equals("computer", StringComparison.OrdinalIgnoreCase);

    public static bool IsGroup(string objectClass) => objectClass.Equals("group", StringComparison.OrdinalIgnoreCase);

    /// <summary>Why a member of a protected/Tier 0 group is expected; null when it is not.</summary>
    public static string? IsExpected(PrivilegedGroup group, PrivilegedMember member, Tier0Config config)
    {
        if (IsBuiltinAdministrator(member.Sid)) return L.T("Integriertes Administratorkonto");
        if (IsComputer(member.ObjectClass) && DomainControllerGroups.Any(p => SidMatches(group.Sid, p))) return L.T("Domänencontroller");
        if (DefaultNesting.Any(n => SidMatches(group.Sid, n.Group) && SidMatches(member.Sid, n.Member))) return L.T("Standard-Verschachtelung");
        if (IsGroup(member.ObjectClass) && (config.IsTier0Group(member.SamAccountName) || config.IsTier0Group(member.Name))) return L.T("Tier-0-Gruppe laut Konfiguration");
        if (!IsGroup(member.ObjectClass) && config.IsTier0Account(member.SamAccountName)) return L.T("Tier-0-Konto laut Konfiguration");
        // Personal admin accounts are usually not in the users section; they live in the Tier 0 account OUs of the model.
        if (!IsGroup(member.ObjectClass) && TierRules.TierOf(ParentDn(member.DistinguishedName)) == 0) return L.T("Konto in einer Tier-0-OU");
        if (config.JitFor(group, member) is { } jit) return L.F("Erwartet (JIT bis {0})", Maintenance.MaintenanceCalendar.Format(jit.ExpiresAt));
        return null;
    }

    /// <summary>The container of an object ("CN=x,OU=Tier 0,…" → "OU=Tier 0,…"), so a name like "CN=Tier 0 fake" does not count.</summary>
    public static string? ParentDn(string? dn)
    {
        if (string.IsNullOrEmpty(dn)) return null;
        for (var i = 0; i < dn.Length; i++)
        {
            if (dn[i] == '\\') { i++; continue; }
            if (dn[i] == ',') return dn[(i + 1)..];
        }
        return null;
    }

    public static PrivilegedEvaluation Evaluate(PrivilegedSnapshotData current, PrivilegedSnapshotData? previous, PrivilegedEvaluation? previousEvaluation,
        Tier0Config config, HygieneThresholds thresholds, DateTimeOffset now)
    {
        var monitored = MonitoredNames(current);
        var changes = previous is null ? [] : Diff(current, previous, monitored, MonitoredNames(previous));
        var unexpected = Unexpected(current, config, monitored);
        var hygiene = Hygiene(current, thresholds, now);
        var paths = AttackPaths(current, config);

        var newFindings = new List<string>();
        var prevUnexpected = (previousEvaluation?.Unexpected ?? []).Select(u => Key(u.GroupSid, u.MemberSid)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var u in unexpected.Where(u => !prevUnexpected.Contains(Key(u.GroupSid, u.MemberSid))))
            newFindings.Add(L.F("Nicht erwartet: {0} in {1}{2}", u.MemberName, u.GroupName, (u.Direct ? "" : L.F(" (über {0})", string.Join(" › ", u.Via)))));
        var prevHygiene = (previousEvaluation?.Hygiene ?? []).Where(h => h.Severity == High).Select(h => Key(h.Rule, h.Sid)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var h in hygiene.Where(h => h.Severity == High && !prevHygiene.Contains(Key(h.Rule, h.Sid))))
            newFindings.Add(L.F("Hygiene (hoch): {0} – {1}", h.Account, h.Title));
        var prevPaths = (previousEvaluation?.AttackPaths ?? []).Select(PathKey).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var p in paths.Where(p => !prevPaths.Contains(PathKey(p))))
            newFindings.Add(L.F("Angriffspfad: {0}", p.Sentence));

        return new PrivilegedEvaluation(previous is null, changes, unexpected, hygiene, paths, newFindings, thresholds);
    }

    private static string Key(params string[] parts) => string.Join('|', parts);

    private static string PathKey(AttackPath p) => Key(p.ObjectDn, p.PrincipalSid, string.Join(',', p.Rights.Order(StringComparer.OrdinalIgnoreCase)));

    /// <summary>Names under which monitored groups can appear in a member's "via" list.</summary>
    private static HashSet<string> MonitoredNames(PrivilegedSnapshotData data)
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var g in data.Groups)
        {
            names.Add(g.Name);
            if (g.WellKnownName is { Length: > 0 } wk) names.Add(wk);
        }
        return names;
    }

    /// <summary>
    /// A nested member is reported where it is a direct member, if that (innermost) group is monitored itself;
    /// otherwise every addition to Domain Admins would also be reported for Administrators.
    /// </summary>
    private static bool ReportedElsewhere(PrivilegedMember m, HashSet<string> monitored) =>
        !m.IsDirect && m.Via is { Count: > 0 } via && monitored.Contains(via[^1]);

    public static List<MembershipChange> Diff(PrivilegedSnapshotData current, PrivilegedSnapshotData previous,
        HashSet<string>? monitoredNow = null, HashSet<string>? monitoredBefore = null)
    {
        monitoredNow ??= MonitoredNames(current);
        monitoredBefore ??= MonitoredNames(previous);
        var before = previous.Groups.GroupBy(g => g.Sid, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        var changes = new List<MembershipChange>();
        foreach (var g in current.Groups)
        {
            // A group monitored for the first time (e.g. new in the configuration) has no history to compare with.
            if (!before.TryGetValue(g.Sid, out var old)) continue;
            var oldMembers = old.Members.ToDictionary(m => m.Sid, StringComparer.OrdinalIgnoreCase);
            var newMembers = g.Members.ToDictionary(m => m.Sid, StringComparer.OrdinalIgnoreCase);
            foreach (var m in g.Members.Where(m => !oldMembers.ContainsKey(m.Sid) && !ReportedElsewhere(m, monitoredNow)))
                changes.Add(new("Added", g.Sid, g.Name, m.Sid, m.SamAccountName, m.DisplayName, m.ObjectClass, m.IsDirect, m.Via));
            foreach (var m in old.Members.Where(m => !newMembers.ContainsKey(m.Sid) && !ReportedElsewhere(m, monitoredBefore)))
                changes.Add(new("Removed", g.Sid, g.Name, m.Sid, m.SamAccountName, m.DisplayName, m.ObjectClass, m.IsDirect, m.Via));
        }
        return changes;
    }

    public static List<UnexpectedMember> Unexpected(PrivilegedSnapshotData current, Tier0Config config, HashSet<string>? monitored = null)
    {
        monitored ??= MonitoredNames(current);
        var result = new List<UnexpectedMember>();
        foreach (var g in current.Groups)
            foreach (var m in g.Members)
            {
                if (ReportedElsewhere(m, monitored) || IsExpected(g, m, config) is not null) continue;
                result.Add(new(g.Sid, g.Name, m.Sid, m.SamAccountName, m.DisplayName, m.ObjectClass, m.IsDirect, m.Via, m.Enabled));
            }
        return result;
    }

    // ------------------------------------------------------------------ hygiene (roadmap 8)

    /// <summary>Titles of the hygiene rules (language of the evaluation, see <see cref="L"/>).</summary>
    public static string RuleTitle(string rule) => rule switch
    {
        "NotInProtectedUsers" => L.T("Nicht in „Protected Users“"),
        "DelegationAllowed" => L.T("Delegierung erlaubt"),
        "PasswordOld" => L.T("Passwort zu alt"),
        "Stale" => L.T("Lange nicht angemeldet"),
        "HasSpn" => L.T("SPN gesetzt (Kerberoasting)"),
        "PasswordNeverExpires" => L.T("Passwort läuft nie ab"),
        "OrphanedAdminCount" => L.T("adminCount verwaist"),
        "DisabledButPrivileged" => L.T("Deaktiviert, aber privilegiert"),
        _ => rule,
    };

    /// <summary>
    /// Hygiene rules for accounts in Tier 0/1 (by membership or OU). Severities:
    /// <list type="bullet">
    /// <item>HasSpn – user with a service principal name: High when it is a member of a privileged group (Kerberoasting yields
    /// a privileged credential), otherwise Medium.</item>
    /// <item>DelegationAllowed – user without "Account is sensitive and cannot be delegated": High for Tier 0, otherwise Medium.</item>
    /// <item>NotInProtectedUsers – enabled Tier 0 user (not computers or managed service accounts) outside Protected Users: Medium.</item>
    /// <item>PasswordOld – user password older than <see cref="HygieneThresholds.PasswordMaxAgeDays"/> or never set: Medium.</item>
    /// <item>DisabledButPrivileged – disabled account that is still a member of a privileged group: Medium.</item>
    /// <item>Stale – enabled account without logon for <see cref="HygieneThresholds.StaleDays"/> days, or never: Low.</item>
    /// <item>PasswordNeverExpires – user with a non-expiring password: Low.</item>
    /// <item>OrphanedAdminCount – adminCount=1 without membership in a protected group (SDProp no longer maintains its ACL): Low.</item>
    /// </list>
    /// Only enabled accounts are checked, except for DisabledButPrivileged and OrphanedAdminCount.
    /// </summary>
    public static List<HygieneFinding> Hygiene(PrivilegedSnapshotData data, HygieneThresholds t, DateTimeOffset now)
    {
        var result = new List<HygieneFinding>();
        void Add(string rule, string severity, PrivilegedAccount a, string value) =>
            result.Add(new(rule, RuleTitle(rule), severity, a.Sid, a.DisplayName, a.DistinguishedName, a.ObjectClass, a.Tier, value));

        foreach (var a in data.Accounts)
        {
            var privileged = a.MemberOfPrivileged.Count > 0;
            if (a.Tier is not (0 or 1) && !privileged) continue;
            var user = IsUser(a.ObjectClass);
            var memberText = privileged ? string.Join(", ", a.MemberOfPrivileged) : null;

            if (a.Enabled == false)
            {
                if (privileged) Add("DisabledButPrivileged", Medium, a, L.F("Deaktiviert, aber Mitglied von {0}", memberText));
                continue;
            }

            if (user && a.ServicePrincipalNames.Count > 0)
                Add("HasSpn", privileged ? High : Medium, a,
                    $"{a.ServicePrincipalNames.Count} SPN{(a.ServicePrincipalNames.Count == 1 ? "" : "s")}: {string.Join(", ", a.ServicePrincipalNames.Take(3))}{(a.ServicePrincipalNames.Count > 3 ? " …" : "")}"
                    + (privileged ? L.F(" – Mitglied von {0}", memberText) : ""));
            if (user && a.AccountNotDelegated != true)
                Add("DelegationAllowed", a.Tier == 0 ? High : Medium, a, L.T("„Das Konto ist vertraulich und kann nicht delegiert werden“ ist nicht gesetzt"));
            if (user && a.Tier == 0 && a.ProtectedUsers != true)
                Add("NotInProtectedUsers", Medium, a, L.T("Kein Mitglied der Gruppe „Protected Users“"));
            if (user)
            {
                if (a.PasswordLastSet is not { } pw)
                    Add("PasswordOld", Medium, a, L.T("Passwort wurde nie gesetzt"));
                else if ((now - pw).TotalDays > t.PasswordMaxAgeDays)
                    Add("PasswordOld", Medium, a, L.F("Passwort zuletzt geändert vor {0} Tagen ({1}), erlaubt sind {2}", Days(now - pw), Date(pw), t.PasswordMaxAgeDays));
            }
            if (a.LastLogon is not { } logon)
                Add("Stale", Low, a, L.T("Noch nie angemeldet"));
            else if ((now - logon).TotalDays > t.StaleDays)
                Add("Stale", Low, a, L.F("Letzte Anmeldung vor {0} Tagen ({1}), Schwellwert {2}", Days(now - logon), Date(logon), t.StaleDays));
            if (user && a.PasswordNeverExpires == true)
                Add("PasswordNeverExpires", Low, a, L.T("„Kennwort läuft nie ab“ ist gesetzt"));
        }

        foreach (var o in data.AdminCountOrphans)
            result.Add(new("OrphanedAdminCount", RuleTitle("OrphanedAdminCount"), Low, o.Sid, o.SamAccountName ?? o.Sid, o.DistinguishedName, o.ObjectClass,
                TierRules.TierOf(o.DistinguishedName), L.T("adminCount=1, aber in keiner geschützten Gruppe mehr – die Berechtigungen bleiben eingeschränkt vererbt")));

        return result;
    }

    private static int Days(TimeSpan span) => (int)Math.Floor(span.TotalDays);

    private static string Date(DateTimeOffset d) => d.ToString("dd.MM.yyyy", CultureInfo.InvariantCulture);

    // ------------------------------------------------------------------ attack paths (roadmap 9)

    public static string ObjectTypeLabel(string type) => type.ToLowerInvariant() switch
    {
        "domainroot" => L.T("Domänenstamm"),
        "adminsdholder" => "AdminSDHolder",
        "protectedgroup" => L.T("geschützte Gruppe"),
        "tier0ou" => L.T("Tier-0-OU"),
        "tier0gpo" => L.T("Tier-0-GPO"),
        "domaincontrollersou" => L.T("OU der Domänencontroller"),
        _ => type,
    };

    public static string PrincipalDescription(string principalClass, int? memberCount) => principalClass.ToLowerInvariant() switch
    {
        "group" => memberCount is { } n ? L.F("Gruppe, {0} {1}", n, (n == 1 ? L.TC("count", "Mitglied") : L.TC("count", "Mitglieder"))) : L.T("Gruppe"),
        "user" or "inetorgperson" => L.T("Benutzer"),
        "computer" => "Computer",
        "msds-groupmanagedserviceaccount" => "gMSA",
        "msds-managedserviceaccount" => "MSA",
        "foreignsecurityprincipal" => L.T("fremder Sicherheitsprinzipal"),
        _ => L.T("Objekt"),
    };

    private static string JoinGerman(IReadOnlyList<string> items) =>
        items.Count <= 1 ? string.Join("", items) : L.F("{0} und {1}", string.Join(", ", items.Take(items.Count - 1)), items[^1]);

    /// <summary>
    /// ACL findings on Tier 0 objects whose principal is not Tier 0 per configuration. First stage: the direct right;
    /// second stage: for groups, the (sampled) members that hold the right through membership. All are High.
    /// </summary>
    public static List<AttackPath> AttackPaths(PrivilegedSnapshotData data, Tier0Config config)
    {
        var monitoredSids = data.Groups.Select(g => g.Sid).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var result = new List<AttackPath>();
        foreach (var f in data.AclFindings)
        {
            if (f.Rights.Count == 0) continue;
            if (Tier0AclPrincipals.Any(p => SidMatches(f.PrincipalSid, p)) || monitoredSids.Contains(f.PrincipalSid ?? "")) continue;
            if (TierRules.IsBuiltinTier0Principal(f.PrincipalName) || config.IsTier0Group(f.PrincipalName) || config.IsTier0Account(f.PrincipalName)
                || TierRules.TierOf(TierRules.Bare(f.PrincipalName)) == 0)
                continue;

            var name = TierRules.Bare(f.PrincipalName);
            var sentence = L.F("{0} ({1}) hat {2} auf {3} ({4})", name, PrincipalDescription(f.PrincipalClass ?? "", f.MemberCount), JoinGerman(f.Rights), f.ObjectName, ObjectTypeLabel(f.ObjectType ?? ""))
                + (f.Inherited == true ? L.T(" – geerbt") : "");
            string? path = null;
            if (IsGroup(f.PrincipalClass ?? "") && f.SampleMembers.Count > 0)
            {
                var more = (f.MemberCount ?? f.SampleMembers.Count) - f.SampleMembers.Count;
                path = L.F("Über die Mitgliedschaft in {0}: {1}{2}", name, string.Join(", ", f.SampleMembers), (more > 0 ? L.F(" und {0} weitere", more) : ""));
            }
            result.Add(new(f.ObjectDn, f.ObjectType ?? "", f.ObjectName, f.PrincipalSid ?? "", f.PrincipalName, f.PrincipalClass ?? "", f.Rights,
                f.MemberCount, f.SampleMembers, f.Inherited == true, High, sentence, path));
        }
        return result;
    }

    // ------------------------------------------------------------------ notification text

    /// <summary>Lines for the PrivilegedChange notification: changes first, then new findings; at most <paramref name="max"/> lines.</summary>
    public static List<string> NotificationLines(PrivilegedEvaluation e, int max = 10)
    {
        var lines = e.Changes.Select(c => c.Change == "Added"
                ? L.F("+ {0} zu {1} hinzugefügt{2}", c.MemberName, c.GroupName, (c.Direct ? "" : L.F(" (über {0})", string.Join(" › ", c.Via))))
                : L.F("− {0} aus {1} entfernt", c.MemberName, c.GroupName))
            .Concat(e.NewFindings).ToList();
        if (lines.Count <= max) return lines;
        var rest = lines.Count - (max - 1);
        return [.. lines.Take(max - 1), L.F("… und {0} weitere", rest)];
    }
}
