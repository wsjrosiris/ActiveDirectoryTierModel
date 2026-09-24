using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using TierModel.Service.Auth;
using TierModel.Service.Config;
using TierModel.Service.Data;
using TierModel.Service.Monitoring;
using TierModel.Service.Notifications;
using TierModel.Service.Runs;

namespace TierModel.Service.Jit;

public record JitRequestInput(long GroupId, int Minutes, string? Justification, string? MemberAccount);

public record JitGroupInput(string? Group, string? GroupSid, string? DisplayName, int? Tier, int MaxMinutes, bool RequiresApproval, Role? MinimumRole,
    string[]? EligibleUsers, bool Enabled = true);

public record JitGroupDto(long Id, string Group, string? GroupSid, string DisplayName, int? Tier, int MaxMinutes, bool RequiresApproval, Role MinimumRole,
    string[] EligibleUsers, bool Enabled, string CreatedBy, DateTimeOffset CreatedAt, DateTimeOffset? UpdatedAt)
{
    public static JitGroupDto From(JitGroup g) => new(g.Id, g.Group, g.GroupSid, g.DisplayName, g.Tier, g.MaxMinutes, g.RequiresApproval, g.MinimumRole,
        g.EligibleUsers, g.Enabled, g.CreatedBy, g.CreatedAt, g.UpdatedAt);
}

/// <summary>A group the current user may request (without the admin-only rules).</summary>
public record EligibleGroupDto(long Id, string Group, string DisplayName, int? Tier, int MaxMinutes, bool RequiresApproval);

public record JitRequestDto(long Id, string RequestedBy, string MemberAccount, long? GroupId, string Group, string GroupDisplayName, int? Tier, int Minutes,
    string Justification, JitStatus Status, bool ApprovalRequired, DateTimeOffset RequestedAt, DateTimeOffset? ApprovalExpiresAt, string? DecidedBy,
    DateTimeOffset? DecidedAt, string? DecisionComment, DateTimeOffset? GrantedAt, DateTimeOffset? ExpiresAt, DateTimeOffset? RevokedAt, string? RevokedBy,
    long? RunId, long? RevokeRunId, string? Dc, string? Message, bool Mine, bool CanDecide, bool CanWithdraw, bool CanRevoke);

/// <summary>Result of the last prerequisite check (a run of kind Jit, action Check). Status: Unknown, Running, Ready, NotReady, Error.</summary>
public record JitPrerequisiteDto(string Status, long? RunId, DateTimeOffset? CheckedAt, string? Dc, bool? PamEnabled, string? ForestMode,
    bool? ForestLevelSufficient, List<string> Messages, string? Error);

public record JitOverviewDto(JitPrerequisiteDto Prerequisite, List<EligibleGroupDto> Groups, string DefaultMemberAccount, bool CanChooseMember,
    bool CanDecide, bool CanCheck, string? DefaultDc, int[] Durations);

/// <summary>An active JIT membership as the privileged-group monitoring needs it (roadmap 6 → 7).</summary>
public record JitExpectation(string? GroupSid, IReadOnlyList<string> GroupNames, string? MemberSid, string MemberAccount, DateTimeOffset ExpiresAt);

public enum JitOutcome { Done, NotFound, Forbidden, Conflict, OwnRequest, Expired }

/// <summary>Just-in-Time admin access (roadmap 6): eligible groups, requests with four-eyes approval, grant/revoke runs, expiry.</summary>
public partial class JitService(AppDbContext db, RunQueue queue, ChangeLogService changeLog, SettingsService settings, NotificationQueue notifications,
    ConfigService config)
{
    /// <summary>Durations offered by the UI (minutes).</summary>
    public static readonly int[] Durations = [15, 30, 60, 120, 240, 480];
    public const int MinMinutes = 5;
    public const int MaxMinutesLimit = 1440;
    public const string EntityType = "jit";

    // Same rule as Resolve-TierModelJitPrincipal: the value ends up in a filter and a process argument.
    [GeneratedRegex(@"^[^""/\\\[\]:;|=,+*?<>@']{1,256}$")]
    private static partial Regex SamPattern();

    [GeneratedRegex(@"^S-1-[0-9]+(-[0-9]+){1,14}$", RegexOptions.IgnoreCase)]
    private static partial Regex SidPattern();

    /// <summary>Normalises an AD account/group identifier (strips DOMAIN\) or returns null when it is not a valid samAccountName or SID.</summary>
    public static string? NormalizeIdentity(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var v = value.Trim();
        var slash = v.IndexOf('\\');
        if (slash >= 0) v = v[(slash + 1)..];
        if (SidPattern().IsMatch(v)) return v.ToUpperInvariant();
        return SamPattern().IsMatch(v) && v.Trim().Length == v.Length ? v : null;
    }

    /// <summary>The AD account an application user gets by default: sam of DOMAIN\sam (Windows), the UPN prefix (Entra), else the user name.</summary>
    public static string DefaultMemberAccount(string username, AuthType authType)
    {
        var name = username.Trim();
        return authType switch
        {
            AuthType.Windows when name.Contains('\\') => name[(name.LastIndexOf('\\') + 1)..],
            AuthType.Entra when name.Contains('@') => name[..name.IndexOf('@')],
            _ => name,
        };
    }

    public static bool SameUser(string? a, string? b) => !string.IsNullOrWhiteSpace(a) && !string.IsNullOrWhiteSpace(b)
        && string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);

    public static bool IsEligible(JitGroup g, string username, Role role) =>
        g.Enabled && role >= g.MinimumRole && (g.EligibleUsers.Length == 0 || g.EligibleUsers.Any(u => SameUser(u, username)));

    // ------------------------------------------------------------------ groups (admin)

    public Dictionary<string, string[]> ValidateGroup(JitGroupInput r)
    {
        var errors = new Dictionary<string, string[]>();
        if (NormalizeIdentity(r.Group) is null) errors["group"] = ["Bitte eine Gruppe wählen (samAccountName oder SID)."];
        if (!string.IsNullOrWhiteSpace(r.GroupSid) && !SidPattern().IsMatch(r.GroupSid.Trim())) errors["groupSid"] = ["Ungültige SID."];
        if (r.DisplayName is { Length: > 128 }) errors["displayName"] = ["Anzeigename: höchstens 128 Zeichen."];
        if (r.Tier is not (null or 0 or 1 or 2)) errors["tier"] = ["Tier 0, 1 oder 2."];
        if (r.MaxMinutes is < MinMinutes or > MaxMinutesLimit) errors["maxMinutes"] = [$"Höchstdauer zwischen {MinMinutes} Minuten und {MaxMinutesLimit / 60} Stunden."];
        if (r.MinimumRole is { } role && !Enum.IsDefined(role)) errors["minimumRole"] = ["Unbekannte Rolle."];
        if ((r.EligibleUsers ?? []).Any(u => string.IsNullOrWhiteSpace(u) || u.Length > 256)) errors["eligibleUsers"] = ["Ungültiger Benutzername."];
        return errors;
    }

    public static void Apply(JitGroup g, JitGroupInput r)
    {
        g.Group = NormalizeIdentity(r.Group)!;
        g.GroupSid = string.IsNullOrWhiteSpace(r.GroupSid) ? (g.Group.StartsWith("S-1-", StringComparison.Ordinal) ? g.Group : g.GroupSid) : r.GroupSid.Trim().ToUpperInvariant();
        g.DisplayName = string.IsNullOrWhiteSpace(r.DisplayName) ? g.Group : r.DisplayName.Trim();
        g.Tier = r.Tier ?? TierRules.TierOf(g.DisplayName) ?? TierRules.TierOf(g.Group);
        g.MaxMinutes = r.MaxMinutes;
        g.RequiresApproval = r.RequiresApproval;
        g.MinimumRole = r.MinimumRole ?? Role.Operator;
        g.EligibleUsers = (r.EligibleUsers ?? []).Select(u => u.Trim()).Where(u => u.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        g.Enabled = r.Enabled;
    }

    // ------------------------------------------------------------------ overview and lists

    public async Task<JitOverviewDto> OverviewAsync(AppUser user, Role role, CancellationToken ct = default)
    {
        var groups = await db.JitGroups.AsNoTracking().OrderBy(g => g.Tier).ThenBy(g => g.DisplayName).ToListAsync(ct);
        var eligible = groups.Where(g => IsEligible(g, user.Username, role))
            .Select(g => new EligibleGroupDto(g.Id, g.Group, g.DisplayName, g.Tier, g.MaxMinutes, g.RequiresApproval)).ToList();
        return new JitOverviewDto(await PrerequisiteAsync(ct), eligible, DefaultMemberAccount(user.Username, user.AuthType), role >= Role.Admin,
            role >= Role.Operator, role >= Role.Operator, await DefaultDcAsync(ct), Durations);
    }

    public async Task<List<JitRequestDto>> ListAsync(string username, Role role, CancellationToken ct = default)
    {
        var q = db.JitRequests.AsNoTracking();
        if (role < Role.Operator) q = q.Where(r => r.RequestedBy == username);
        var items = await q.OrderByDescending(r => r.Id).Take(300).ToListAsync(ct);
        return items.Select(r => ToDto(r, username, role)).ToList();
    }

    public static JitRequestDto ToDto(JitRequest r, string username, Role role)
    {
        var mine = SameUser(r.RequestedBy, username);
        return new JitRequestDto(r.Id, r.RequestedBy, r.MemberAccount, r.JitGroupId, r.Group, r.GroupDisplayName, r.Tier, r.Minutes, r.Justification, r.Status,
            r.ApprovalRequired, r.RequestedAt, r.Status == JitStatus.Pending ? r.ApprovalExpiresAt : null, r.DecidedBy, r.DecidedAt, r.DecisionComment,
            r.GrantedAt, r.ExpiresAt, r.RevokedAt, r.RevokedBy, r.RunId, r.RevokeRunId, r.Dc, r.Message, mine,
            CanDecide: r.Status == JitStatus.Pending && role >= Role.Operator && !mine,
            CanWithdraw: r.Status == JitStatus.Pending && mine,
            CanRevoke: r.Status == JitStatus.Active && r.RevokeRunId is null && (mine || role >= Role.Operator));
    }

    private async Task<string?> DefaultDcAsync(CancellationToken ct)
    {
        var s = await settings.GetAsync(ct);
        if (!string.IsNullOrWhiteSpace(s.DefaultPreferredDc)) return s.DefaultPreferredDc.Trim();
        return await db.Runs.AsNoTracking().Where(r => r.Kind == RunKind.Jit && r.JitAction == JitAction.Check)
            .OrderByDescending(r => r.Id).Select(r => r.PreferredDc).FirstOrDefaultAsync(ct);
    }

    public async Task<JitPrerequisiteDto> PrerequisiteAsync(CancellationToken ct = default)
    {
        var run = await db.Runs.AsNoTracking().Where(r => r.Kind == RunKind.Jit && r.JitAction == JitAction.Check)
            .OrderByDescending(r => r.Id).FirstOrDefaultAsync(ct);
        if (run is null) return new("Unknown", null, null, null, null, null, null, [], null);
        if (run.Status is RunStatus.Queued or RunStatus.Running)
        {
            // Show the previous result while the new check runs.
            var previous = await db.Runs.AsNoTracking().Where(r => r.Kind == RunKind.Jit && r.JitAction == JitAction.Check && r.Id < run.Id && r.Status == RunStatus.Succeeded)
                .OrderByDescending(r => r.Id).FirstOrDefaultAsync(ct);
            var p = previous is null ? null : FromCheckRun(previous);
            return new("Running", run.Id, p?.CheckedAt, run.PreferredDc, p?.PamEnabled, p?.ForestMode, p?.ForestLevelSufficient, p?.Messages ?? [], null);
        }
        return FromCheckRun(run);
    }

    private static JitPrerequisiteDto FromCheckRun(Run run)
    {
        var node = run.Summary is null ? null : JsonNode.Parse(run.Summary);
        bool? Bool(string key) => node?[key] is JsonValue v && v.TryGetValue<bool>(out var b) ? b : null;
        var messages = node?["messages"] is JsonArray a ? a.Select(x => x?.ToString() ?? "").Where(x => x.Length > 0).ToList() : [];
        if (run.Status != RunStatus.Succeeded || node is null)
            return new("Error", run.Id, run.FinishedAt, run.PreferredDc, null, null, null, messages, run.Message ?? "Die Prüfung ist fehlgeschlagen.");
        var ready = Bool("ready") == true;
        return new(ready ? "Ready" : "NotReady", run.Id, run.FinishedAt, run.PreferredDc, Bool("pamEnabled"), node["forestMode"]?.ToString(),
            Bool("forestLevelSufficient"), messages, null);
    }

    // ------------------------------------------------------------------ requests

    public async Task<(JitRequest? Request, Dictionary<string, string[]>? Errors, string? Problem)> CreateAsync(AppUser user, Role role, JitRequestInput r,
        CancellationToken ct = default)
    {
        var errors = new Dictionary<string, string[]>();
        var group = await db.JitGroups.AsNoTracking().FirstOrDefaultAsync(g => g.Id == r.GroupId, ct);
        if (group is null || !group.Enabled) errors["groupId"] = ["Bitte eine freigegebene JIT-Gruppe wählen."];
        else if (!IsEligible(group, user.Username, role)) return (null, null, "Sie sind für diese Gruppe nicht berechtigt.");
        if (group is not null && (r.Minutes < MinMinutes || r.Minutes > group.MaxMinutes))
            errors["minutes"] = [$"Die Dauer muss zwischen {MinMinutes} und {group.MaxMinutes} Minuten liegen (Höchstdauer der Gruppe)."];
        var justification = r.Justification?.Trim() ?? "";
        if (justification.Length < 5) errors["justification"] = ["Bitte begründen Sie den Antrag (mindestens 5 Zeichen)."];
        else if (justification.Length > 1000) errors["justification"] = ["Die Begründung darf höchstens 1000 Zeichen lang sein."];

        var defaultMember = DefaultMemberAccount(user.Username, user.AuthType);
        var member = string.IsNullOrWhiteSpace(r.MemberAccount) ? defaultMember : r.MemberAccount;
        var normalized = NormalizeIdentity(member);
        if (normalized is null) errors["memberAccount"] = ["Ungültiges AD-Konto (samAccountName oder SID)."];
        else if (role < Role.Admin && !SameUser(normalized, NormalizeIdentity(defaultMember)))
            return (null, null, "Nur Administratoren dürfen Zugriff für ein anderes Konto beantragen.");
        if (errors.Count > 0) return (null, errors, null);

        var prerequisite = await PrerequisiteAsync(ct);
        if (prerequisite.Status == "NotReady")
            return (null, null, "Die Voraussetzungen für befristete Gruppenmitgliedschaften sind nicht erfüllt (Privileged Access Management Feature). Details auf der Seite „Befristeter Zugriff“.");
        if (await DefaultDcAsync(ct) is not { Length: > 0 })
            return (null, null, "Kein Domänencontroller bekannt: Bitte in den Einstellungen einen Standard-Domänencontroller hinterlegen oder die Voraussetzungen mit einem DC prüfen.");
        var duplicate = await db.JitRequests.AnyAsync(x => x.JitGroupId == group!.Id && x.MemberAccount == normalized
            && (x.Status == JitStatus.Pending || x.Status == JitStatus.Approved || x.Status == JitStatus.Active), ct);
        if (duplicate) return (null, null, $"Für {normalized} gibt es bereits einen offenen oder aktiven Antrag für diese Gruppe.");

        var s = await settings.GetAsync(ct);
        var now = DateTimeOffset.UtcNow;
        var request = new JitRequest
        {
            RequestedBy = user.Username,
            MemberAccount = normalized!,
            JitGroupId = group!.Id,
            Group = group.Group,
            GroupDisplayName = group.DisplayName,
            GroupSid = group.GroupSid,
            Tier = group.Tier,
            Minutes = r.Minutes,
            Justification = justification,
            ApprovalRequired = group.RequiresApproval,
            Status = JitStatus.Pending,
            RequestedAt = now,
            ApprovalExpiresAt = group.RequiresApproval ? now.AddHours(s.ApprovalTimeoutHours) : null,
        };
        db.JitRequests.Add(request);
        await db.SaveChangesAsync(ct);
        changeLog.Add(user.Username, "jit.request", EntityType, request.Id.ToString(),
            $"Befristeter Zugriff #{request.Id} beantragt: {request.MemberAccount} in {request.GroupDisplayName} für {FormatMinutes(request.Minutes)} – {request.Justification}");
        if (!group.RequiresApproval)
        {
            request.Status = JitStatus.Approved;
            request.DecidedAt = now;
            changeLog.Add("system", "jit.approve", EntityType, request.Id.ToString(),
                $"Befristeter Zugriff #{request.Id} ohne Freigabe genehmigt (Gruppe {request.GroupDisplayName} verlangt keine Freigabe)");
            await db.SaveChangesAsync(ct);
            await StartRunAsync(request, JitAction.Grant, user.Username, ct);
        }
        await db.SaveChangesAsync(ct);
        notifications.Enqueue(RequestedMessage(request, s.PublicBaseUrl));
        return (request, null, null);
    }

    public async Task<(JitOutcome, JitRequest?)> DecideAsync(long id, bool approve, string user, Role role, string? comment, CancellationToken ct = default)
    {
        var request = await db.JitRequests.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (request is null) return (JitOutcome.NotFound, null);
        if (role < Role.Operator) return (JitOutcome.Forbidden, request);
        if (request.Status != JitStatus.Pending) return (JitOutcome.Conflict, request);
        if (SameUser(request.RequestedBy, user)) return (JitOutcome.OwnRequest, request);
        var now = DateTimeOffset.UtcNow;
        if (request.ApprovalExpiresAt <= now)
        {
            await ExpireApprovalAsync(request, ct);
            return (JitOutcome.Expired, request);
        }
        var trimmed = string.IsNullOrWhiteSpace(comment) ? null : comment.Trim();
        var status = approve ? JitStatus.Approved : JitStatus.Rejected;
        // Optimistic check: only one decision wins if two operators click at the same time.
        var updated = await db.JitRequests.Where(r => r.Id == id && r.Status == JitStatus.Pending).ExecuteUpdateAsync(u => u
            .SetProperty(r => r.Status, status)
            .SetProperty(r => r.DecidedBy, user)
            .SetProperty(r => r.DecidedAt, now)
            .SetProperty(r => r.DecisionComment, trimmed), ct);
        if (updated == 0) return (JitOutcome.Conflict, request);
        await db.Entry(request).ReloadAsync(ct);
        changeLog.Add(user, approve ? "jit.approve" : "jit.reject", EntityType, id.ToString(),
            $"Befristeter Zugriff #{id} von {request.RequestedBy} ({request.MemberAccount} in {request.GroupDisplayName}) {(approve ? "freigegeben" : "abgelehnt")}"
            + (trimmed is null ? "" : $": {trimmed}"));
        await db.SaveChangesAsync(ct);
        if (approve) await StartRunAsync(request, JitAction.Grant, user, ct);
        return (JitOutcome.Done, request);
    }

    public async Task<(JitOutcome, JitRequest?)> WithdrawAsync(long id, string user, CancellationToken ct = default)
    {
        var request = await db.JitRequests.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (request is null) return (JitOutcome.NotFound, null);
        if (!SameUser(request.RequestedBy, user)) return (JitOutcome.Forbidden, request);
        var n = await db.JitRequests.Where(r => r.Id == id && r.Status == JitStatus.Pending).ExecuteUpdateAsync(u => u
            .SetProperty(r => r.Status, JitStatus.Cancelled)
            .SetProperty(r => r.Message, "Vom Antragsteller zurückgezogen"), ct);
        if (n == 0) return (JitOutcome.Conflict, request);
        await db.Entry(request).ReloadAsync(ct);
        changeLog.Add(user, "jit.withdraw", EntityType, id.ToString(), $"Antrag auf befristeten Zugriff #{id} zurückgezogen");
        await db.SaveChangesAsync(ct);
        return (JitOutcome.Done, request);
    }

    /// <summary>Early revocation by the requester or an operator: queues a revoke run; the request becomes Revoked when it succeeded.</summary>
    public async Task<(JitOutcome, JitRequest?)> RevokeAsync(long id, string user, Role role, CancellationToken ct = default)
    {
        var request = await db.JitRequests.FirstOrDefaultAsync(r => r.Id == id, ct);
        if (request is null) return (JitOutcome.NotFound, null);
        if (!SameUser(request.RequestedBy, user) && role < Role.Operator) return (JitOutcome.Forbidden, request);
        if (request.Status != JitStatus.Active || request.RevokeRunId is not null) return (JitOutcome.Conflict, request);
        changeLog.Add(user, "jit.revoke-request", EntityType, id.ToString(),
            $"Vorzeitiger Entzug von befristetem Zugriff #{id} angefordert: {request.MemberAccount} aus {request.GroupDisplayName}");
        await StartRunAsync(request, JitAction.Revoke, user, ct);
        return (JitOutcome.Done, request);
    }

    /// <summary>Read-only prerequisite check (Grant-TierModelJitAccess.ps1 -Mode Check) on the given or default DC.</summary>
    public async Task<(Run? Run, Dictionary<string, string[]>? Errors)> StartCheckAsync(string? preferredDc, string user, CancellationToken ct = default)
    {
        var dc = string.IsNullOrWhiteSpace(preferredDc) ? await DefaultDcAsync(ct) : preferredDc.Trim();
        var errors = RunValidation.ValidateMonitor(new RunRequest(dc ?? "", null, false, false, false, false, null));
        if (errors.Count > 0) return (null, errors);
        var run = NewRun(dc!, user, JitAction.Check, null);
        db.Runs.Add(run);
        await db.SaveChangesAsync(ct);
        changeLog.Add(user, "jit.check", EntityType, null, $"Voraussetzungen für befristeten Zugriff werden geprüft (Lauf #{run.Id} über {dc})");
        await db.SaveChangesAsync(ct);
        queue.Notify();
        return (run, null);
    }

    private Run NewRun(string dc, string user, JitAction action, JitRequest? request) => new()
    {
        Kind = RunKind.Jit,
        Status = RunStatus.Queued,
        Trigger = RunTrigger.Manual,
        PreferredDc = dc,
        AdmlLanguage = "en-US",
        RequestedBy = user,
        CreatedAt = DateTimeOffset.UtcNow,
        JitAction = action,
        JitRequestId = request?.Id,
        ApprovalRequired = request?.ApprovalRequired ?? false,
        ApprovedBy = action == JitAction.Grant ? request?.DecidedBy : null,
        ApprovedAt = action == JitAction.Grant ? request?.DecidedAt : null,
    };

    private async Task StartRunAsync(JitRequest request, JitAction action, string user, CancellationToken ct)
    {
        var dc = request.Dc ?? await DefaultDcAsync(ct) ?? "";
        var run = NewRun(dc, action == JitAction.Grant ? request.RequestedBy : user, action, request);
        db.Runs.Add(run);
        await db.SaveChangesAsync(ct);
        if (action == JitAction.Grant)
        {
            request.RunId = run.Id;
            request.Dc = dc;
        }
        else request.RevokeRunId = run.Id;
        changeLog.Add(user, "run.jit", "run", run.Id.ToString(),
            $"{RunService.RunTitle(run)} #{run.Id} gestartet: {request.MemberAccount} {(action == JitAction.Grant ? "in" : "aus")} {request.GroupDisplayName} über {dc}");
        await db.SaveChangesAsync(ct);
        queue.Notify();
    }

    // ------------------------------------------------------------------ run results

    /// <summary>
    /// Called by the run worker after a run of kind Jit finished (<paramref name="result"/>: the parsed output file, null when missing).
    /// Updates the request (grant/revoke) and returns the notifications to send.
    /// </summary>
    public async Task CompleteRunAsync(Run run, JitRunResult? result, CancellationToken ct = default)
    {
        if (run.JitAction == JitAction.Check || run.JitRequestId is not { } requestId) return;
        var request = await db.JitRequests.FirstOrDefaultAsync(r => r.Id == requestId, ct);
        if (request is null) return;
        await db.Entry(request).ReloadAsync(ct);   // the context may hold an older state of the request
        var ok = run.Status == RunStatus.Succeeded && result is { Success: true };
        var s = await settings.GetAsync(ct);
        if (run.JitAction == JitAction.Grant)
        {
            if (request.Status != JitStatus.Approved) return;
            if (ok)
            {
                request.Status = JitStatus.Active;
                request.GrantedAt = run.FinishedAt ?? DateTimeOffset.UtcNow;
                request.ExpiresAt = result!.ExpiresAt ?? request.GrantedAt.Value.AddMinutes(request.Minutes);
                request.GroupSid = result.GroupSid ?? request.GroupSid;
                request.MemberSid = result.MemberSid ?? request.MemberSid;
                request.Dc = result.Dc ?? request.Dc;
                request.Message = null;
                changeLog.Add("system", "jit.grant", EntityType, request.Id.ToString(),
                    $"Befristeter Zugriff #{request.Id} aktiv: {request.MemberAccount} ist bis {Format(request.ExpiresAt.Value)} Mitglied von {request.GroupDisplayName} (Lauf #{run.Id})",
                    new { runId = run.Id, groupSid = request.GroupSid, memberSid = request.MemberSid, expiresAt = request.ExpiresAt });
                // Remember the SID of the group for the monitoring match.
                if (request.JitGroupId is { } gid && request.GroupSid is { } sid)
                    await db.JitGroups.Where(g => g.Id == gid && g.GroupSid == null).ExecuteUpdateAsync(u => u.SetProperty(g => g.GroupSid, sid), ct);
                await db.SaveChangesAsync(ct);
                notifications.Enqueue(GrantedMessage(request, s.PublicBaseUrl));
            }
            else
            {
                request.Status = JitStatus.Failed;
                request.Message = result?.Error ?? run.Message ?? "Der Lauf ist fehlgeschlagen.";
                changeLog.Add("system", "jit.grant-failed", EntityType, request.Id.ToString(),
                    $"Befristeter Zugriff #{request.Id} konnte nicht erteilt werden (Lauf #{run.Id}): {request.Message}");
                await db.SaveChangesAsync(ct);
            }
            return;
        }

        // Revoke
        if (request.RevokeRunId != run.Id) return;
        if (ok && request.Status == JitStatus.Active)
        {
            request.Status = JitStatus.Revoked;
            request.RevokedAt = run.FinishedAt ?? DateTimeOffset.UtcNow;
            request.RevokedBy = run.RequestedBy;
            request.Message = result!.Removed == false ? "Die Mitgliedschaft bestand beim Entzug nicht mehr (bereits abgelaufen)." : null;
            changeLog.Add(run.RequestedBy, "jit.revoke", EntityType, request.Id.ToString(),
                $"Befristeter Zugriff #{request.Id} vorzeitig entzogen: {request.MemberAccount} aus {request.GroupDisplayName} (Lauf #{run.Id})");
        }
        else if (!ok)
        {
            request.RevokeRunId = null;
            request.Message = "Entzug fehlgeschlagen: " + (result?.Error ?? run.Message ?? "unbekannter Fehler");
            changeLog.Add("system", "jit.revoke-failed", EntityType, request.Id.ToString(),
                $"Vorzeitiger Entzug von befristetem Zugriff #{request.Id} fehlgeschlagen (Lauf #{run.Id}): {request.Message}");
        }
        await db.SaveChangesAsync(ct);
    }

    // ------------------------------------------------------------------ background maintenance

    /// <summary>
    /// Marks elapsed memberships as Expired, rejects overdue approvals and repairs requests whose run ended without a result
    /// (e.g. cancelled or interrupted by a restart). Returns the number of changed requests.
    /// </summary>
    public async Task<int> MaintainAsync(DateTimeOffset now, CancellationToken ct = default)
    {
        var changed = 0;
        var expired = await db.JitRequests.Where(r => r.Status == JitStatus.Active && r.ExpiresAt <= now).ToListAsync(ct);
        foreach (var r in expired)
        {
            r.Status = JitStatus.Expired;
            changeLog.Add("system", "jit.expire", EntityType, r.Id.ToString(),
                $"Befristeter Zugriff #{r.Id} abgelaufen: {r.MemberAccount} ist seit {Format(r.ExpiresAt!.Value)} nicht mehr Mitglied von {r.GroupDisplayName}");
            changed++;
        }
        var overdue = await db.JitRequests.Where(r => r.Status == JitStatus.Pending && r.ApprovalExpiresAt <= now).ToListAsync(ct);
        foreach (var r in overdue)
        {
            r.Status = JitStatus.Rejected;
            r.Message = "Freigabe abgelaufen – niemand hat rechtzeitig entschieden.";
            changeLog.Add("system", "jit.approval-expired", EntityType, r.Id.ToString(), $"Freigabe für befristeten Zugriff #{r.Id} von {r.RequestedBy} abgelaufen");
            changed++;
        }
        // Grant or revoke runs that ended without being processed (cancelled before the start, service restart).
        var finished = new[] { RunStatus.Failed, RunStatus.Cancelled };
        var stuck = await (from r in db.JitRequests
                           join run in db.Runs on r.RunId equals run.Id
                           where r.Status == JitStatus.Approved && finished.Contains(run.Status)
                           select new { Request = r, run.Message }).ToListAsync(ct);
        foreach (var x in stuck)
        {
            x.Request.Status = JitStatus.Failed;
            x.Request.Message = x.Message ?? "Der Lauf wurde nicht ausgeführt.";
            changeLog.Add("system", "jit.grant-failed", EntityType, x.Request.Id.ToString(), $"Befristeter Zugriff #{x.Request.Id} nicht erteilt: {x.Request.Message}");
            changed++;
        }
        var stuckRevoke = await (from r in db.JitRequests
                                 join run in db.Runs on r.RevokeRunId equals run.Id
                                 where r.Status == JitStatus.Active && finished.Contains(run.Status)
                                 select new { Request = r, run.Message }).ToListAsync(ct);
        foreach (var x in stuckRevoke)
        {
            x.Request.RevokeRunId = null;
            x.Request.Message = "Entzug fehlgeschlagen: " + (x.Message ?? "Der Lauf wurde nicht ausgeführt.");
            changed++;
        }
        if (changed > 0) await db.SaveChangesAsync(ct);
        return changed;
    }

    // ------------------------------------------------------------------ monitoring

    /// <summary>JIT memberships that were active at <paramref name="at"/> (granted, not yet expired or revoked).</summary>
    public static async Task<List<JitExpectation>> ExpectationsAsync(AppDbContext db, DateTimeOffset at, CancellationToken ct = default)
    {
        var rows = await db.JitRequests.AsNoTracking()
            .Where(r => r.GrantedAt != null && r.GrantedAt <= at.AddMinutes(5) && r.ExpiresAt > at && (r.RevokedAt == null || r.RevokedAt > at)
                && (r.Status == JitStatus.Active || r.Status == JitStatus.Expired || r.Status == JitStatus.Revoked))
            .Select(r => new { r.GroupSid, r.Group, r.GroupDisplayName, r.MemberSid, r.MemberAccount, r.ExpiresAt })
            .ToListAsync(ct);
        return rows.Select(r => new JitExpectation(r.GroupSid, new[] { r.Group, r.GroupDisplayName }.Distinct(StringComparer.OrdinalIgnoreCase).ToList(),
            r.MemberSid, r.MemberAccount, r.ExpiresAt!.Value)).ToList();
    }

    // ------------------------------------------------------------------ lookups

    private static readonly string[] BuiltinGroups = ["Domain Admins", "Enterprise Admins", "Schema Admins", "Administrators", "Account Operators",
        "Server Operators", "Backup Operators", "Group Policy Creator Owners", "DnsAdmins"];

    public record GroupCandidate(string Group, string DisplayName, string? Sid, int? Tier, string Source);

    public record AccountCandidate(string Account, string DisplayName, string Source);

    /// <summary>Groups from the configuration, well-known privileged groups and (on a domain member) the AD search.</summary>
    public async Task<List<GroupCandidate>> GroupCandidatesAsync(string? query, CancellationToken ct = default)
    {
        var q = query?.Trim() ?? "";
        var sections = await config.CurrentContentAsync(ct);
        var list = new List<GroupCandidate>();
        if (sections.GetValueOrDefault("groups")?["groups"] is JsonArray groups)
            foreach (var g in groups.OfType<JsonObject>())
            {
                var sam = g["samaccountname"]?.ToString();
                if (string.IsNullOrWhiteSpace(sam)) continue;
                var name = g["name"]?.ToString() ?? sam;
                list.Add(new(sam, name, null, TierRules.TierOf(name) ?? TierRules.TierOf(sam) ?? TierRules.TierOf(g["path"]?.ToString()), "Konfiguration"));
            }
        list.AddRange(BuiltinGroups.Select(b => new GroupCandidate(b, b, null, 0, "Integriert")));
        foreach (var g in Endpoints.ActiveDirectoryLookup.SearchGroups(q, 25))
            list.Add(new(g.SamAccountName, g.Name, g.Sid, TierRules.TierOf(g.Name) ?? TierRules.TierOf(g.DistinguishedName), "Active Directory"));
        return list.Where(c => q.Length == 0 || c.Group.Contains(q, StringComparison.OrdinalIgnoreCase) || c.DisplayName.Contains(q, StringComparison.OrdinalIgnoreCase))
            .GroupBy(c => c.Group, StringComparer.OrdinalIgnoreCase).Select(g => g.OrderBy(c => c.Sid is null).First())
            .OrderBy(c => c.Tier ?? 9).ThenBy(c => c.DisplayName, StringComparer.OrdinalIgnoreCase).Take(50).ToList();
    }

    /// <summary>AD accounts: application users (Windows/Entra), accounts of the configuration and (on a domain member) the AD search.</summary>
    public async Task<List<AccountCandidate>> AccountCandidatesAsync(string? query, CancellationToken ct = default)
    {
        var q = query?.Trim() ?? "";
        var list = new List<AccountCandidate>();
        foreach (var u in await db.Users.AsNoTracking().Where(u => u.IsActive).Select(u => new { u.Username, u.DisplayName, u.AuthType }).ToListAsync(ct))
            list.Add(new(DefaultMemberAccount(u.Username, u.AuthType), u.DisplayName, u.AuthType == AuthType.Local ? "Dienst-Benutzer" : "Anmeldung " + u.AuthType));
        var sections = await config.CurrentContentAsync(ct);
        if (sections.GetValueOrDefault("users")?["users"] is JsonArray users)
            foreach (var u in users.OfType<JsonObject>())
                if (u["samAccountName"]?.ToString() is { Length: > 0 } sam) list.Add(new(sam, u["displayName"]?.ToString() ?? sam, "Konfiguration"));
        foreach (var a in SearchAccounts(q, 25)) list.Add(a);
        return list.Where(c => NormalizeIdentity(c.Account) is not null)
            .Where(c => q.Length == 0 || c.Account.Contains(q, StringComparison.OrdinalIgnoreCase) || c.DisplayName.Contains(q, StringComparison.OrdinalIgnoreCase))
            .GroupBy(c => c.Account, StringComparer.OrdinalIgnoreCase).Select(g => g.First())
            .OrderBy(c => c.Account, StringComparer.OrdinalIgnoreCase).Take(50).ToList();
    }

    private static List<AccountCandidate> SearchAccounts(string query, int max) =>
        OperatingSystem.IsWindows() ? SearchAccountsOnWindows(query, max) : [];

    [System.Runtime.Versioning.SupportedOSPlatform("windows")]
    private static List<AccountCandidate> SearchAccountsOnWindows(string query, int max)
    {
        if (query.Length < 2) return [];
        try
        {
            using var domain = System.DirectoryServices.ActiveDirectory.Domain.GetComputerDomain();
            var q = string.Concat(query.Select(c => c switch { '\\' => "\\5c", '*' => "\\2a", '(' => "\\28", ')' => "\\29", '\0' => "\\00", _ => c.ToString() }));
            using var root = domain.GetDirectoryEntry();
            using var searcher = new System.DirectoryServices.DirectorySearcher(root,
                $"(&(objectCategory=person)(objectClass=user)(|(sAMAccountName={q}*)(displayName=*{q}*)(cn=*{q}*)))",
                ["sAMAccountName", "displayName", "cn"]) { SizeLimit = max };
            using var results = searcher.FindAll();
            return results.Cast<System.DirectoryServices.SearchResult>().Select(r =>
            {
                string? Prop(string name) => r.Properties[name] is { Count: > 0 } p ? p[0]?.ToString() : null;
                var sam = Prop("sAMAccountName") ?? "";
                return new AccountCandidate(sam, Prop("displayName") ?? Prop("cn") ?? sam, "Active Directory");
            }).Where(a => a.Account.Length > 0).ToList();
        }
        catch (Exception) { return []; }
    }

    // ------------------------------------------------------------------ helpers and notifications

    public static string FormatMinutes(int minutes) => minutes % 60 == 0
        ? (minutes == 60 ? "1 Stunde" : $"{minutes / 60} Stunden")
        : $"{minutes} Minuten";

    public static string Format(DateTimeOffset at) => MaintenanceFormat(at);

    private static string MaintenanceFormat(DateTimeOffset at) => Maintenance.MaintenanceCalendar.Format(at);

    private static string? PageUrl(string publicBaseUrl) => string.IsNullOrWhiteSpace(publicBaseUrl) ? null : $"{publicBaseUrl.TrimEnd('/')}/zugriff";

    public static NotificationMessage RequestedMessage(JitRequest r, string publicBaseUrl) => new(
        NotificationEvent.JitRequested,
        $"Befristeter Zugriff beantragt: {r.GroupDisplayName}",
        r.ApprovalRequired
            ? $"{r.RequestedBy} beantragt {FormatMinutes(r.Minutes)} Mitgliedschaft in {r.GroupDisplayName}. Eine zweite Person mit der Rolle Operator muss freigeben"
              + (r.ApprovalExpiresAt is { } exp ? $" (bis {Format(exp)})." : ".")
            : $"{r.RequestedBy} erhält {FormatMinutes(r.Minutes)} Mitgliedschaft in {r.GroupDisplayName} (Gruppe ohne Freigabepflicht).",
        [("Antrag", $"#{r.Id}"), ("Konto", r.MemberAccount), ("Gruppe", r.GroupDisplayName), ("Tier", r.Tier?.ToString() ?? "–"),
         ("Dauer", FormatMinutes(r.Minutes)), ("Begründung", r.Justification), ("Beantragt von", r.RequestedBy)],
        PageUrl(publicBaseUrl), "accent");

    public static NotificationMessage GrantedMessage(JitRequest r, string publicBaseUrl) => new(
        NotificationEvent.JitGranted,
        $"Befristeter Zugriff erteilt: {r.MemberAccount} in {r.GroupDisplayName}",
        $"{r.MemberAccount} ist bis {Format(r.ExpiresAt ?? DateTimeOffset.UtcNow)} Mitglied von {r.GroupDisplayName}. Active Directory entfernt die Mitgliedschaft danach selbst.",
        [("Antrag", $"#{r.Id}"), ("Konto", r.MemberAccount), ("Gruppe", r.GroupDisplayName), ("Tier", r.Tier?.ToString() ?? "–"),
         ("Gültig bis", Format(r.ExpiresAt ?? DateTimeOffset.UtcNow)), ("Freigegeben von", r.DecidedBy ?? "keine Freigabe nötig"),
         ("Beantragt von", r.RequestedBy), ("Domänencontroller", r.Dc ?? "–")],
        PageUrl(publicBaseUrl), "warning");

    private async Task ExpireApprovalAsync(JitRequest request, CancellationToken ct)
    {
        var n = await db.JitRequests.Where(r => r.Id == request.Id && r.Status == JitStatus.Pending).ExecuteUpdateAsync(u => u
            .SetProperty(r => r.Status, JitStatus.Rejected)
            .SetProperty(r => r.Message, "Freigabe abgelaufen – niemand hat rechtzeitig entschieden."), ct);
        if (n == 0) return;
        request.Status = JitStatus.Rejected;
        changeLog.Add("system", "jit.approval-expired", EntityType, request.Id.ToString(), $"Freigabe für befristeten Zugriff #{request.Id} von {request.RequestedBy} abgelaufen");
        await db.SaveChangesAsync(ct);
    }
}

/// <summary>Parsed output file of Grant-TierModelJitAccess.ps1 (out/jit-result.json).</summary>
public record JitRunResult(bool Success, string? Error, string? Group, string? Member, string? GroupSid, string? MemberSid, DateTimeOffset? ExpiresAt,
    long? TtlSeconds, bool? Removed, string? Dc, JsonObject Raw)
{
    public const string FileName = "jit-result.json";

    /// <summary>Reads the result file; null when it is missing or unreadable.</summary>
    public static JitRunResult? Read(string workDir, Action<string, string> log)
    {
        var file = Path.Combine(workDir, "out", FileName);
        if (!File.Exists(file))
        {
            log($"Keine Ergebnisdatei ({FileName}) gefunden.", "warn");
            return null;
        }
        try
        {
            return Parse(File.ReadAllText(file));
        }
        catch (Exception ex) when (ex is JsonException or FormatException or InvalidOperationException)
        {
            log($"Ergebnisdatei konnte nicht gelesen werden: {ex.Message}", "warn");
            return null;
        }
    }

    public static JitRunResult Parse(string json)
    {
        if (JsonCase.CamelCaseKeys(JsonNode.Parse(json)) is not JsonObject o) throw new FormatException("Die Ergebnisdatei enthält kein JSON-Objekt.");
        string? Str(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) && !string.IsNullOrWhiteSpace(s) ? s : null;
        bool? Bool(JsonNode? n) => n is JsonValue v && v.TryGetValue<bool>(out var b) ? b : null;
        long? Long(JsonNode? n) => n is JsonValue v && v.TryGetValue<long>(out var l) ? l : n is JsonValue d && d.TryGetValue<double>(out var x) ? (long)x : null;
        DateTimeOffset? expires = Str(o["expiresAt"]) is { } e && DateTimeOffset.TryParse(e, System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.AssumeUniversal, out var parsed) ? parsed.ToUniversalTime() : null;
        return new JitRunResult(Bool(o["success"]) ?? false, Str(o["error"]), Str(o["group"]), Str(o["member"]), Str(o["sids"]?["group"]),
            Str(o["sids"]?["member"]), expires, Long(o["ttlSeconds"]), Bool(o["removed"]), Str(o["dc"]), o);
    }

    /// <summary>Summary stored on the run: the result without the large parts.</summary>
    public string SummaryJson() => Raw.ToJsonString();
}
