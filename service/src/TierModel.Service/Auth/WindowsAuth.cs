using System.Security.Claims;
using System.Security.Principal;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Negotiate;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TierModel.Service.Data;

namespace TierModel.Service.Auth;

/// <summary>Windows sign-in (Kerberos/NTLM via Negotiate) with roles derived from AD group membership.</summary>
public static partial class WindowsAuth
{
    public static bool Available => OperatingSystem.IsWindows();

    [GeneratedRegex(@"^S-1-[0-9]+(-[0-9]+)+$", RegexOptions.IgnoreCase)]
    private static partial Regex SidPattern();

    /// <summary>Highest role whose configured groups contain the user or one of the user's groups; null if none.</summary>
    public static Role? ResolveRole(WindowsAuthConfig config, IEnumerable<string> sids)
    {
        var set = new HashSet<string>(sids, StringComparer.OrdinalIgnoreCase);
        return Enum.GetValues<Role>()
            .OrderDescending()
            .Cast<Role?>()
            .FirstOrDefault(role => config.RoleGroups.TryGetValue(role!.Value, out var groups) && groups.Any(g => set.Contains(g.Sid)));
    }

    /// <summary>Resolves "DOMAIN\Group" or a SID to a <see cref="GroupRef"/>; returns an error message on failure.</summary>
    public static (GroupRef? Group, string? Error) Resolve(string entry)
    {
        var value = entry.Trim();
        if (value.Length == 0) return (null, "Leerer Eintrag.");
        if (SidPattern().IsMatch(value))
        {
            var name = value;
            if (OperatingSystem.IsWindows())
            {
                try { name = new SecurityIdentifier(value).Translate(typeof(NTAccount)).Value; }
                catch (Exception) { /* unknown SID: keep it, the group may be in a trusted domain that is offline */ }
            }
            return (new GroupRef(name, value.ToUpperInvariant()), null);
        }
        if (!OperatingSystem.IsWindows())
            return (null, $"'{value}': Namen können nur unter Windows aufgelöst werden – bitte die SID angeben.");
        return ResolveNameOnWindows(value);
    }

    [System.Runtime.Versioning.SupportedOSPlatform("windows")]
    private static (GroupRef? Group, string? Error) ResolveNameOnWindows(string value)
    {
        try
        {
            var sid = (SecurityIdentifier)new NTAccount(value).Translate(typeof(SecurityIdentifier));
            var name = sid.Translate(typeof(NTAccount)).Value;
            return (new GroupRef(name, sid.Value), null);
        }
        catch (Exception)
        {
            return (null, $"'{value}' wurde im Active Directory nicht gefunden (Format DOMÄNE\\Gruppe).");
        }
    }

    private static (string? UserSid, List<string> Sids) ReadSids(ClaimsPrincipal principal)
    {
        var sids = new List<string>();
        string? userSid = null;
        if (OperatingSystem.IsWindows() && principal.Identity is WindowsIdentity wi)
        {
            userSid = wi.User?.Value;
            if (wi.Groups is { } groups) foreach (var g in groups) sids.Add(g.Value);
        }
        userSid ??= principal.FindFirstValue(ClaimTypes.PrimarySid) ?? principal.FindFirstValue(ClaimTypes.Sid);
        sids.AddRange(principal.FindAll(ClaimTypes.GroupSid).Select(c => c.Value));
        if (userSid is not null) sids.Add(userSid);
        return (userSid, sids);
    }

    /// <summary>Only local paths: never redirect to another site after sign-in.</summary>
    public static string SafeReturnUrl(string? returnUrl) =>
        !string.IsNullOrEmpty(returnUrl) && returnUrl.StartsWith('/') && !returnUrl.StartsWith("//") && !returnUrl.StartsWith("/\\")
            ? returnUrl : "/";

    public static void MapWindowsAuthEndpoints(this RouteGroupBuilder auth)
    {
        auth.MapGet("/options", async (SettingsService settings) =>
            Results.Ok(new { windowsAuth = Available && (await settings.GetWindowsAuthAsync()).Enabled }));

        auth.MapGet("/windows", async (HttpContext ctx, string? returnUrl, SettingsService settings, AppDbContext db,
            ChangeLogService log, IOptions<TierModelOptions> o, ILoggerFactory loggers) =>
        {
            var target = SafeReturnUrl(returnUrl);
            var config = await settings.GetWindowsAuthAsync();
            if (!Available || !config.Enabled) return Results.Redirect("/login?error=windows-disabled");

            var result = await ctx.AuthenticateAsync(NegotiateDefaults.AuthenticationScheme);
            if (result.Failure is not null)
            {
                loggers.CreateLogger("WindowsAuth").LogWarning(result.Failure, "Windows sign-in failed");
                return Results.Redirect("/login?error=windows-failed");
            }
            if (!result.Succeeded || result.Principal?.Identity?.Name is not { Length: > 0 } accountName)
                return Results.Challenge(authenticationSchemes: [NegotiateDefaults.AuthenticationScheme]);

            var (userSid, sids) = ReadSids(result.Principal);
            if (userSid is null) return Results.Redirect("/login?error=windows-failed");
            var role = ResolveRole(config, sids);
            var user = await db.Users.FirstOrDefaultAsync(u => u.Sid == userSid);
            if (role is null)
            {
                log.Add(accountName, "auth.windows-denied", "auth", user?.Id.ToString(), $"Windows-Anmeldung von '{accountName}' abgelehnt: keiner Rolle zugeordnet");
                await db.SaveChangesAsync();
                return Results.Redirect("/login?error=windows-norole");
            }

            if (user is null)
            {
                user = new AppUser
                {
                    Username = accountName, NormalizedUsername = UserService.Normalize(accountName),
                    DisplayName = accountName.Contains('\\') ? accountName[(accountName.IndexOf('\\') + 1)..] : accountName,
                    AuthType = AuthType.Windows, Sid = userSid, Role = role.Value,
                };
                // A local account may already use this name: keep them apart.
                if (await db.Users.AnyAsync(u => u.NormalizedUsername == user.NormalizedUsername))
                    user.NormalizedUsername = UserService.Normalize(accountName + "@" + userSid);
                db.Users.Add(user);
                log.Add(accountName, "user.create", "user", user.Id.ToString(), $"Windows-Konto '{accountName}' bei der ersten Anmeldung angelegt ({role})");
            }
            else if (user.Role != role || user.Username != accountName)
            {
                // Group membership decides: a changed role ends existing sessions.
                log.Add(accountName, "user.update", "user", user.Id.ToString(), $"Rolle von '{accountName}' aus AD-Gruppen: {user.Role} → {role}");
                user.Role = role.Value;
                user.Username = accountName;
                user.SecurityStamp = Guid.NewGuid().ToString("N");
            }
            if (!user.IsActive)
            {
                log.Add(accountName, "auth.windows-denied", "auth", user.Id.ToString(), $"Windows-Anmeldung von '{accountName}' abgelehnt: Konto deaktiviert");
                await db.SaveChangesAsync();
                return Results.Redirect("/login?error=windows-inactive");
            }

            user.LastLoginAt = DateTimeOffset.UtcNow;
            log.Add(accountName, "auth.windows-login", "auth", user.Id.ToString(), $"{accountName} hat sich mit Windows angemeldet ({user.Role})");
            await db.SaveChangesAsync();

            var principal = AuthClaims.CreatePrincipal(user);
            await ctx.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal);
            return Results.Redirect(target);
        });
    }

    public record WindowsAuthDto(bool Enabled, Dictionary<Role, List<GroupRef>> RoleGroups, bool Available);
    public record UpdateWindowsAuthRequest(bool Enabled, Dictionary<Role, List<string>>? RoleGroups);

    public static void MapWindowsAuthSettings(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/settings/windows-auth").RequireAuthorization(nameof(Role.Admin));

        g.MapGet("/", async (SettingsService settings) =>
        {
            var c = await settings.GetWindowsAuthAsync();
            return new WindowsAuthDto(c.Enabled, c.RoleGroups, Available);
        });

        g.MapPut("/", async (UpdateWindowsAuthRequest r, HttpContext ctx, SettingsService settings, ChangeLogService log, AppDbContext db) =>
        {
            var errors = new Dictionary<string, string[]>();
            var groups = Enum.GetValues<Role>().ToDictionary(role => role, _ => new List<GroupRef>());
            foreach (var (role, entries) in r.RoleGroups ?? [])
            {
                var messages = new List<string>();
                foreach (var entry in entries.Where(e => !string.IsNullOrWhiteSpace(e)).Distinct(StringComparer.OrdinalIgnoreCase))
                {
                    var (group, error) = Resolve(entry);
                    if (group is not null && groups[role].All(x => !x.Sid.Equals(group.Sid, StringComparison.OrdinalIgnoreCase))) groups[role].Add(group);
                    if (error is not null) messages.Add(error);
                }
                if (messages.Count > 0) errors[$"roleGroups.{role}"] = [.. messages];
            }
            if (r.Enabled && !Available) errors["enabled"] = ["Windows-Anmeldung ist nur auf einem Windows-Server verfügbar."];
            if (r.Enabled && groups[Role.Admin].Count == 0 && groups.Values.All(v => v.Count == 0))
                errors["roleGroups"] = ["Mindestens einer Rolle eine AD-Gruppe zuordnen."];
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            await settings.SetWindowsAuthAsync(new WindowsAuthConfig(r.Enabled, groups));
            log.Add(ctx.User.UserName(), "settings.windows-auth", "settings", null,
                $"Windows-Anmeldung {(r.Enabled ? "aktiviert" : "deaktiviert")}: " +
                string.Join(", ", groups.Where(kv => kv.Value.Count > 0).Select(kv => $"{kv.Key} = {string.Join(" / ", kv.Value.Select(x => x.Name))}")),
                new { enabled = r.Enabled, roleGroups = groups });
            await db.SaveChangesAsync();
            return Results.Ok(new WindowsAuthDto(r.Enabled, groups, Available));
        });
    }
}
