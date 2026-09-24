using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TierModel.Service.Auth;
using TierModel.Service.Data;

namespace TierModel.Service.Endpoints;

public static class AuthEndpoints
{
    public record LoginRequest(string Username, string Password);
    public record ChangePasswordRequest(string CurrentPassword, string NewPassword);
    public record CreateUserRequest(string Username, string DisplayName, Role Role, string Password);
    public record UpdateUserRequest(string DisplayName, Role Role, bool IsActive);
    public record ResetPasswordRequest(string NewPassword);

    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/api/auth");

        auth.MapGet("/me", async (HttpContext ctx, AppDbContext db, IOptions<TierModelOptions> o) =>
        {
            ctx.IssueXsrfCookie(o.Value.RequireHttps);
            var id = ctx.User.UserId();
            var user = id is null ? null : await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id);
            return Results.Ok(new { user = user is null ? null : UserDto.From(user) });
        });

        auth.MapPost("/login", async (LoginRequest r, HttpContext ctx, UserService users, ChangeLogService log, AppDbContext db, IOptions<TierModelOptions> o) =>
        {
            if (string.IsNullOrWhiteSpace(r.Username) || string.IsNullOrEmpty(r.Password))
                return Results.Problem(title: "Benutzername und Passwort angeben", statusCode: 400);

            var (result, user) = await users.LoginAsync(r.Username, r.Password);
            switch (result)
            {
                case LoginResult.LockedOut:
                    log.Add(r.Username.Trim(), "auth.locked", "auth", user?.Id.ToString(), $"Anmeldung abgelehnt: Konto '{r.Username.Trim()}' ist gesperrt");
                    await db.SaveChangesAsync();
                    return Results.Problem(title: "Konto vorübergehend gesperrt",
                        detail: $"Zu viele Fehlversuche. Bitte in {AuthClaims.LockoutDuration.TotalMinutes:0} Minuten erneut versuchen oder einen Administrator kontaktieren.",
                        statusCode: StatusCodes.Status423Locked);
                case LoginResult.Invalid:
                    log.Add(r.Username.Trim(), "auth.login-failed", "auth", user?.Id.ToString(), $"Fehlgeschlagene Anmeldung für '{r.Username.Trim()}'");
                    await db.SaveChangesAsync();
                    return Results.Problem(title: "Benutzername oder Passwort ist falsch", statusCode: 401);
            }

            var principal = AuthClaims.CreatePrincipal(user!);
            await ctx.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, principal);
            ctx.User = principal; // bind the new CSRF token to the signed-in identity
            ctx.IssueXsrfCookie(o.Value.RequireHttps);
            log.Add(user!.Username, "auth.login", "auth", user.Id.ToString(), $"{user.Username} hat sich angemeldet");
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
            if (!users.VerifyPassword(user, r.CurrentPassword ?? ""))
                return Results.Problem(title: "Das aktuelle Passwort ist falsch", statusCode: 400);
            if (AuthClaims.PasswordProblem(r.NewPassword) is { } problem)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["newPassword"] = [problem] });
            if (r.NewPassword == r.CurrentPassword)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["newPassword"] = ["Das neue Passwort muss sich vom aktuellen unterscheiden."] });

            users.SetPassword(user, r.NewPassword, mustChange: false);
            log.Add(user.Username, "auth.password-changed", "auth", user.Id.ToString(), $"{user.Username} hat das eigene Passwort geändert");
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
                errors["username"] = ["2–64 Zeichen: Buchstaben, Ziffern, Punkt, Bindestrich, Unterstrich, @."];
            else if (await users.FindByNameAsync(r.Username) is not null)
                errors["username"] = ["Dieser Benutzername ist bereits vergeben."];
            if (AuthClaims.PasswordProblem(r.Password) is { } problem) errors["password"] = [problem];
            if (!Enum.IsDefined(r.Role)) errors["role"] = ["Unbekannte Rolle."];
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var user = users.Create(r.Username, r.DisplayName, r.Role, r.Password, mustChange: true);
            log.Add(ctx.User.UserName(), "user.create", "user", user.Id.ToString(), $"Benutzer '{user.Username}' ({user.Role}) angelegt");
            await db.SaveChangesAsync();
            return Results.Ok(UserDto.From(user));
        });

        admin.MapPut("/{id:guid}", async (Guid id, UpdateUserRequest r, HttpContext ctx, AppDbContext db, ChangeLogService log) =>
        {
            var user = await db.Users.FindAsync(id);
            if (user is null) return Results.NotFound();
            if (!Enum.IsDefined(r.Role))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["role"] = ["Unbekannte Rolle."] });
            var self = ctx.User.UserId() == id;
            if (self && (r.Role != Role.Admin || !r.IsActive))
                return Results.Problem(title: "Die eigene Admin-Rolle kann nicht entzogen oder deaktiviert werden", statusCode: 400);
            if (user.Role == Role.Admin && (r.Role != Role.Admin || !r.IsActive) && await IsLastAdminAsync(db, id))
                return Results.Problem(title: "Der letzte aktive Administrator kann nicht herabgestuft oder deaktiviert werden", statusCode: 400);

            var changes = new List<string>();
            if (user.Role != r.Role) changes.Add($"Rolle {user.Role} → {r.Role}");
            if (user.IsActive != r.IsActive) changes.Add(r.IsActive ? "aktiviert" : "deaktiviert");
            if (user.DisplayName != r.DisplayName.Trim()) changes.Add("Anzeigename geändert");
            if (user.Role != r.Role || user.IsActive != r.IsActive)
                user.SecurityStamp = Guid.NewGuid().ToString("N");
            user.DisplayName = string.IsNullOrWhiteSpace(r.DisplayName) ? user.Username : r.DisplayName.Trim();
            user.Role = r.Role;
            user.IsActive = r.IsActive;
            if (changes.Count > 0)
                log.Add(ctx.User.UserName(), "user.update", "user", id.ToString(), $"Benutzer '{user.Username}': {string.Join(", ", changes)}");
            await db.SaveChangesAsync();
            return Results.Ok(UserDto.From(user));
        });

        admin.MapPost("/{id:guid}/reset-password", async (Guid id, ResetPasswordRequest r, HttpContext ctx, AppDbContext db, UserService users, ChangeLogService log) =>
        {
            var user = await db.Users.FindAsync(id);
            if (user is null) return Results.NotFound();
            if (AuthClaims.PasswordProblem(r.NewPassword) is { } problem)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["newPassword"] = [problem] });
            users.SetPassword(user, r.NewPassword, mustChange: true);
            log.Add(ctx.User.UserName(), "user.reset-password", "user", id.ToString(), $"Passwort von '{user.Username}' zurückgesetzt");
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        admin.MapPost("/{id:guid}/unlock", async (Guid id, HttpContext ctx, AppDbContext db, ChangeLogService log) =>
        {
            var user = await db.Users.FindAsync(id);
            if (user is null) return Results.NotFound();
            user.LockedUntil = null;
            user.FailedLoginCount = 0;
            log.Add(ctx.User.UserName(), "user.unlock", "user", id.ToString(), $"Benutzer '{user.Username}' entsperrt");
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        admin.MapDelete("/{id:guid}", async (Guid id, HttpContext ctx, AppDbContext db, ChangeLogService log) =>
        {
            if (ctx.User.UserId() == id)
                return Results.Problem(title: "Das eigene Konto kann nicht gelöscht werden", statusCode: 400);
            var user = await db.Users.FindAsync(id);
            if (user is null) return Results.NotFound();
            if (user.Role == Role.Admin && await IsLastAdminAsync(db, id))
                return Results.Problem(title: "Der letzte aktive Administrator kann nicht gelöscht werden", statusCode: 400);
            db.Users.Remove(user);
            log.Add(ctx.User.UserName(), "user.delete", "user", id.ToString(), $"Benutzer '{user.Username}' gelöscht");
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }

    private static async Task<bool> IsLastAdminAsync(AppDbContext db, Guid id) =>
        !await db.Users.AnyAsync(u => u.Id != id && u.Role == Role.Admin && u.IsActive);
}
