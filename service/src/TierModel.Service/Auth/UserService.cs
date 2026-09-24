using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using TierModel.Service.Data;

namespace TierModel.Service.Auth;

public record UserDto(Guid Id, string Username, string DisplayName, Role Role, bool IsActive, bool MustChangePassword,
    DateTimeOffset? LastLoginAt, DateTimeOffset? LockedUntil, DateTimeOffset CreatedAt)
{
    public static UserDto From(AppUser u) => new(u.Id, u.Username, u.DisplayName, u.Role, u.IsActive, u.MustChangePassword,
        u.LastLoginAt, u.LockedUntil > DateTimeOffset.UtcNow ? u.LockedUntil : null, u.CreatedAt);
}

public enum LoginResult { Success, Invalid, LockedOut }

public static partial class AuthClaims
{
    public const string Stamp = "tm:stamp";
    public const string MustChangePassword = "tm:mcp";

    public const int MinPasswordLength = 12;
    public const int MaxFailedLogins = 5;
    public static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(15);

    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9._@-]{1,63}$")]
    public static partial Regex UsernamePattern();

    public static ClaimsPrincipal CreatePrincipal(AppUser u) => new(new ClaimsIdentity(
    [
        new Claim(ClaimTypes.NameIdentifier, u.Id.ToString()),
        new Claim(ClaimTypes.Name, u.Username),
        new Claim(ClaimTypes.Role, u.Role.ToString()),
        new Claim(Stamp, u.SecurityStamp),
        new Claim(MustChangePassword, u.MustChangePassword ? "1" : "0"),
    ], CookieAuthenticationDefaults.AuthenticationScheme));

    public static string UserName(this ClaimsPrincipal p) => p.Identity?.Name ?? "unbekannt";

    public static Guid? UserId(this ClaimsPrincipal p) =>
        Guid.TryParse(p.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : null;

    public static Role? Role(this ClaimsPrincipal p) =>
        Enum.TryParse<Role>(p.FindFirstValue(ClaimTypes.Role), out var r) ? r : null;

    public static bool HasRole(this ClaimsPrincipal p, Role min) => p.Role() is { } r && r >= min;

    public static string? PasswordProblem(string? password) =>
        string.IsNullOrEmpty(password) || password.Length < MinPasswordLength
            ? $"Das Passwort muss mindestens {MinPasswordLength} Zeichen lang sein."
            : password.Length > 256 ? "Das Passwort ist zu lang." : null;
}

public class UserService(AppDbContext db, IPasswordHasher<AppUser> hasher)
{
    public static string Normalize(string username) => username.Trim().ToUpperInvariant();

    public Task<AppUser?> FindByNameAsync(string username, CancellationToken ct = default)
    {
        var n = Normalize(username);
        return db.Users.FirstOrDefaultAsync(u => u.NormalizedUsername == n, ct);
    }

    public async Task<(LoginResult, AppUser?)> LoginAsync(string username, string password, CancellationToken ct = default)
    {
        var user = await FindByNameAsync(username, ct);
        if (user is null || !user.IsActive)
        {
            // Burn comparable time so response timing does not reveal whether the account exists.
            hasher.HashPassword(new AppUser { Username = "x", NormalizedUsername = "X", DisplayName = "x" }, password);
            return (LoginResult.Invalid, null);
        }
        if (user.LockedUntil > DateTimeOffset.UtcNow) return (LoginResult.LockedOut, user);

        var result = hasher.VerifyHashedPassword(user, user.PasswordHash, password);
        if (result == PasswordVerificationResult.Failed)
        {
            user.FailedLoginCount++;
            if (user.FailedLoginCount >= AuthClaims.MaxFailedLogins)
            {
                user.LockedUntil = DateTimeOffset.UtcNow.Add(AuthClaims.LockoutDuration);
                user.FailedLoginCount = 0;
            }
            await db.SaveChangesAsync(ct);
            return (user.LockedUntil > DateTimeOffset.UtcNow ? LoginResult.LockedOut : LoginResult.Invalid, user);
        }

        if (result == PasswordVerificationResult.SuccessRehashNeeded)
            user.PasswordHash = hasher.HashPassword(user, password);
        user.FailedLoginCount = 0;
        user.LockedUntil = null;
        user.LastLoginAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return (LoginResult.Success, user);
    }

    public bool VerifyPassword(AppUser user, string password) =>
        hasher.VerifyHashedPassword(user, user.PasswordHash, password) != PasswordVerificationResult.Failed;

    public void SetPassword(AppUser user, string password, bool mustChange)
    {
        user.PasswordHash = hasher.HashPassword(user, password);
        user.MustChangePassword = mustChange;
        user.FailedLoginCount = 0;
        user.LockedUntil = null;
        user.SecurityStamp = Guid.NewGuid().ToString("N");
    }

    public AppUser Create(string username, string displayName, Role role, string password, bool mustChange)
    {
        var user = new AppUser
        {
            Username = username.Trim(),
            NormalizedUsername = Normalize(username),
            DisplayName = string.IsNullOrWhiteSpace(displayName) ? username.Trim() : displayName.Trim(),
            Role = role,
        };
        SetPassword(user, password, mustChange);
        db.Users.Add(user);
        return user;
    }
}
