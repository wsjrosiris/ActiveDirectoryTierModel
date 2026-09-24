using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TierModel.Service.Auth;
using TierModel.Service.Data;
using TierModel.Service.Localization;

namespace TierModel.Service.Endpoints;

public static class AuthEndpoints
{
    public record LoginRequest(string Username, string Password);
    public record ChangePasswordRequest(string CurrentPassword, string NewPassword);
    public record CreateUserRequest(string Username, string DisplayName, Role Role, string Password);
    public record UpdateUserRequest(string DisplayName, Role Role, bool IsActive);
    public record ResetPasswordRequest(string NewPassword);
    public record SetLanguageRequest(string? Language);

    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/api/auth");

        auth.MapWindowsAuthEndpoints();

        auth.MapGet("/me", async (HttpContext ctx, AppDbContext db, IOptions<TierModelOptions> o) =>
        {
            ctx.IssueXsrfCookie(o.Value.RequireHttps);
            var id = ctx.User.UserId();
            var user = id is null ? null : await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id);
            return Results.Ok(new { user = user is null ? null : UserDto.From(user) });
        });

        // UI language of the signed-in user (roadmap 25): "de", "en" or null for the browser default.
        auth.MapPut("/me/language", async (SetLanguageRequest r, HttpContext ctx, AppDbContext db) =>
        {
            var language = r.Language is null ? null : L.Normalize(r.Language);
            if (r.Language is not null && (language is null || r.Language.Trim().Length != 2))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["language"] = [L.T("Unterstützt werden „de“ und „en“ (oder leer für die Sprache des Browsers).")] });
            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == ctx.User.UserId());
            if (user is null) return Results.Unauthorized();
            user.Language = language;
            await db.SaveChangesAsync();
            return Results.Ok(UserDto.From(user));
        }).RequireAuthorization();

        auth.MapPost("/login", async (LoginRequest r, HttpContext ctx, UserService users, ChangeLogService log, AppDbContext db, IOptions<TierModelOptions> o) =>
        {
            if (string.IsNullOrWhiteSpace(r.Username) || string.IsNullOrEmpty(r.Password))
                return Results.Problem(title: L.T("Benutzername und Passwort angeben"), statusCode: 400);

            var (result, user) = await users.LoginAsync(r.Username, r.Password);
            // Attacker-controlled text: keep it short (people sometimes type a password into the user field).
            var attempted = r.Username.Trim() is var n && n.Length > 64 ? n[..64] + "…" : r.Username.Trim();
            switch (result)
            {
                case LoginResult.LockedOut:
                    log.Add(attempted, "auth.locked", "auth", user?.Id.ToString(), L.PF("Anmeldung abgelehnt: Konto '{0}' ist gesperrt", attempted));
                    await db.SaveChangesAsync();
                    return Results.Problem(title: L.T("Konto vorübergehend gesperrt"),
                        detail: L.F("Zu viele Fehlversuche. Bitte in {0:0} Minuten erneut versuchen oder einen Administrator kontaktieren.", AuthClaims.LockoutDuration.TotalMinutes),
                        statusCode: StatusCodes.Status423Locked);
                case LoginResult.Invalid:
                    log.Add(attempted, "auth.login-failed", "auth", user?.Id.ToString(), L.PF("Fehlgeschlagene Anmeldung für '{0}'", attempted));
                    await db.SaveChangesAsync();
                    return Results.Problem(title: L.T("Benutzername oder Passwort ist falsch"), statusCode: 401);
            }

            var principal = AuthClaims.CreatePrincipal(user!);
            await ctx.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal);
            ctx.User = principal; // bind the new CSRF token to the signed-in identity
            ctx.IssueXsrfCookie(o.Value.RequireHttps);
            log.Add(user!.Username, "auth.login", "auth", user.Id.ToString(), L.PF("{0} hat sich angemeldet", user.Username));
            await db.SaveChangesAsync();
            return Results.Ok(UserDto.From(user));
        }).RequireRateLimiting(AuthSetup.LoginRateLimit);

        auth.MapPost("/logout", async (HttpContext ctx, IOptions<TierModelOptions> o) =>
        {
            await ctx.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            ctx.User = new();
            ctx.IssueXsrfCookie(o.Value.RequireHttps);
            return Results.NoContent();
        });

        auth.MapPost("/change-password", async (ChangePasswordRequest r, HttpContext ctx, AppDbContext db, UserService users, ChangeLogService log, IOptions<TierModelOptions> o) =>
        {
            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == ctx.User.UserId());
            if (user is null) return Results.Unauthorized();
            if (user.AuthType != AuthType.Local)
                return Results.Problem(title: L.T("Windows- und Entra-Konten haben hier kein Passwort"), statusCode: 400);
            if (!users.VerifyPassword(user, r.CurrentPassword ?? ""))
                return Results.Problem(title: L.T("Das aktuelle Passwort ist falsch"), statusCode: 400);
            if (AuthClaims.PasswordProblem(r.NewPassword) is { } problem)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["newPassword"] = [problem] });
            if (r.NewPassword == r.CurrentPassword)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["newPassword"] = [L.T("Das neue Passwort muss sich vom aktuellen unterscheiden.")] });

            users.SetPassword(user, r.NewPassword, mustChange: false);
            log.Add(user.Username, "auth.password-changed", "auth", user.Id.ToString(), L.PF("{0} hat das eigene Passwort geändert", user.Username));
            await db.SaveChangesAsync();

            var principal = AuthClaims.CreatePrincipal(user);
            await ctx.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal);
            ctx.User = principal;
            ctx.IssueXsrfCookie(o.Value.RequireHttps);
            return Results.NoContent();
        }).RequireAuthorization();

        var admin = app.MapGroup("/api/users").RequireAuthorization(nameof(Role.Admin));

        admin.MapGet("/", async (AppDbContext db) =>
            (await db.Users.AsNoTracking().OrderBy(u => u.Username).ToListAsync()).Select(UserDto.From));

        admin.MapPost("/", async (CreateUserRequest r, HttpContext ctx, AppDbContext db, UserService users, ChangeLogService log) =>
        {
            var errors = new Dictionary<string, string[]>();
            if (string.IsNullOrWhiteSpace(r.Username) || !AuthClaims.UsernamePattern().IsMatch(r.Username.Trim()))
                errors["username"] = [L.T("2–64 Zeichen: Buchstaben, Ziffern, Punkt, Bindestrich, Unterstrich, @.")];
            else if (await users.FindByNameAsync(r.Username) is not null)
                errors["username"] = [L.T("Dieser Benutzername ist bereits vergeben.")];
            if (AuthClaims.PasswordProblem(r.Password) is { } problem) errors["password"] = [problem];
            if (!Enum.IsDefined(r.Role)) errors["role"] = [L.T("Unbekannte Rolle.")];
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var user = users.Create(r.Username, r.DisplayName, r.Role, r.Password, mustChange: true);
            log.Add(ctx.User.UserName(), "user.create", "user", user.Id.ToString(), L.PF("Benutzer '{0}' ({1}) angelegt", user.Username, user.Role));
            await db.SaveChangesAsync();
            return Results.Ok(UserDto.From(user));
        });

        admin.MapPut("/{id:guid}", async (Guid id, UpdateUserRequest r, HttpContext ctx, AppDbContext db, ChangeLogService log) =>
        {
            var user = await db.Users.FindAsync(id);
            if (user is null) return Results.NotFound();
            // The role of Windows accounts comes from their AD groups at every sign-in.
            if (user.AuthType is AuthType.Windows or AuthType.Entra) r = r with { Role = user.Role };
            if (!Enum.IsDefined(r.Role))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["role"] = [L.T("Unbekannte Rolle.")] });
            var self = ctx.User.UserId() == id;
            if (self && (r.Role != Role.Admin || !r.IsActive))
                return Results.Problem(title: L.T("Die eigene Admin-Rolle kann nicht entzogen oder deaktiviert werden"), statusCode: 400);
            if (user.Role == Role.Admin && (r.Role != Role.Admin || !r.IsActive) && await IsLastAdminAsync(db, id))
                return Results.Problem(title: L.T("Der letzte aktive Administrator kann nicht herabgestuft oder deaktiviert werden"), statusCode: 400);

            var changes = new List<string>();
            if (user.Role != r.Role) changes.Add(L.PF("Rolle {0} → {1}", user.Role, r.Role));
            if (user.IsActive != r.IsActive) changes.Add(r.IsActive ? L.P("aktiviert") : L.P("deaktiviert"));
            var displayName = string.IsNullOrWhiteSpace(r.DisplayName) ? user.Username : r.DisplayName.Trim();
            if (user.DisplayName != displayName) changes.Add(L.P("Anzeigename geändert"));
            if (user.Role != r.Role || user.IsActive != r.IsActive)
                user.SecurityStamp = Guid.NewGuid().ToString("N");
            user.DisplayName = displayName;
            user.Role = r.Role;
            user.IsActive = r.IsActive;
            if (changes.Count > 0)
                log.Add(ctx.User.UserName(), "user.update", "user", id.ToString(), L.PF("Benutzer '{0}': {1}", user.Username, string.Join(", ", changes)));
            await db.SaveChangesAsync();
            return Results.Ok(UserDto.From(user));
        });

        admin.MapPost("/{id:guid}/reset-password", async (Guid id, ResetPasswordRequest r, HttpContext ctx, AppDbContext db, UserService users, ChangeLogService log) =>
        {
            var user = await db.Users.FindAsync(id);
            if (user is null) return Results.NotFound();
            if (user.AuthType != AuthType.Local)
                return Results.Problem(title: L.T("Windows- und Entra-Konten haben hier kein Passwort"), statusCode: 400);
            if (AuthClaims.PasswordProblem(r.NewPassword) is { } problem)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["newPassword"] = [problem] });
            users.SetPassword(user, r.NewPassword, mustChange: true);
            log.Add(ctx.User.UserName(), "user.reset-password", "user", id.ToString(), L.PF("Passwort von '{0}' zurückgesetzt", user.Username));
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        admin.MapPost("/{id:guid}/unlock", async (Guid id, HttpContext ctx, AppDbContext db, ChangeLogService log) =>
        {
            var user = await db.Users.FindAsync(id);
            if (user is null) return Results.NotFound();
            user.LockedUntil = null;
            user.FailedLoginCount = 0;
            log.Add(ctx.User.UserName(), "user.unlock", "user", id.ToString(), L.PF("Benutzer '{0}' entsperrt", user.Username));
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        admin.MapDelete("/{id:guid}", async (Guid id, HttpContext ctx, AppDbContext db, ChangeLogService log) =>
        {
            if (ctx.User.UserId() == id)
                return Results.Problem(title: L.T("Das eigene Konto kann nicht gelöscht werden"), statusCode: 400);
            var user = await db.Users.FindAsync(id);
            if (user is null) return Results.NotFound();
            if (user.Role == Role.Admin && await IsLastAdminAsync(db, id))
                return Results.Problem(title: L.T("Der letzte aktive Administrator kann nicht gelöscht werden"), statusCode: 400);
            db.Users.Remove(user);
            log.Add(ctx.User.UserName(), "user.delete", "user", id.ToString(), L.PF("Benutzer '{0}' gelöscht", user.Username));
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }

    private static async Task<bool> IsLastAdminAsync(AppDbContext db, Guid id) =>
        !await db.Users.AnyAsync(u => u.Id != id && u.Role == Role.Admin && u.IsActive);
}
