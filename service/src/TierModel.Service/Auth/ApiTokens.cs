using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TierModel.Service.Data;
using TierModel.Service.Localization;

namespace TierModel.Service.Auth;

/// <summary>
/// Personal API tokens (roadmap 18): <c>Authorization: Bearer tmk_&lt;prefix&gt;_&lt;secret&gt;</c>.
/// Only accepted from the Authorization header (never from a cookie or the query string), so requests carrying a token
/// cannot be forged cross-site and need no CSRF token. The token's role is capped at the owner's current role;
/// tokens of deactivated or deleted users stop working immediately.
/// </summary>
public static partial class ApiTokens
{
    public const string Scheme = "ApiToken";
    public const string TokenIdClaim = "tm:token";
    public const string RateLimitPolicy = "api-token";
    public const int PermitsPerMinute = 300;
    public static readonly int[] AllowedDays = [30, 90, 180, 365];

    [GeneratedRegex(@"^tmk_([a-z0-9]{8})_([A-Za-z0-9_-]{43})$")]
    private static partial Regex Format();

    private const string PrefixAlphabet = "abcdefghijklmnopqrstuvwxyz0123456789";

    public static (string Token, string Prefix, string Hash) Generate()
    {
        var prefix = RandomNumberGenerator.GetString(PrefixAlphabet, 8);
        var secret = Base64Url(RandomNumberGenerator.GetBytes(32));
        var token = $"tmk_{prefix}_{secret}";
        return (token, prefix, Hash(token));
    }

    public static string Hash(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>The prefix of a well-formed token, otherwise null.</summary>
    public static string? ParsePrefix(string token) => Format().Match(token) is { Success: true } m ? m.Groups[1].Value : null;

    /// <summary>Whether the request carries a bearer token in the Authorization header.</summary>
    public static bool HasBearer(HttpRequest request) =>
        request.Headers.Authorization.ToString().StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase);

    public static bool IsTokenAuthenticated(this ClaimsPrincipal user) =>
        user.Identity is { IsAuthenticated: true, AuthenticationType: Scheme };

    public static Role Min(Role a, Role b) => a <= b ? a : b;
}

public class ApiTokenHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var header = Request.Headers.Authorization.ToString();
        if (!header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return AuthenticateResult.NoResult();
        var token = header["Bearer ".Length..].Trim();
        if (ApiTokens.ParsePrefix(token) is not { } prefix) return AuthenticateResult.Fail(L.T("Ungültiges API-Token."));

        var db = Context.RequestServices.GetRequiredService<AppDbContext>();
        var found = await db.ApiTokens.AsNoTracking()
            .Where(t => t.Prefix == prefix)
            .Join(db.Users.AsNoTracking(), t => t.UserId, u => u.Id, (t, u) => new { Token = t, User = u })
            .FirstOrDefaultAsync(Context.RequestAborted);
        var hash = ApiTokens.Hash(token);
        // Constant-time comparison of the stored hash; compare against a dummy when the prefix is unknown.
        var expected = found?.Token.SecretHash ?? new string('0', 64);
        var match = CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(hash), Encoding.ASCII.GetBytes(expected));
        if (found is null || !match) return AuthenticateResult.Fail(L.T("Ungültiges API-Token."));

        var now = DateTimeOffset.UtcNow;
        var (t, u) = (found.Token, found.User);
        if (t.RevokedAt is not null) return AuthenticateResult.Fail(L.T("Das API-Token wurde widerrufen."));
        if (t.ExpiresAt <= now) return AuthenticateResult.Fail(L.T("Das API-Token ist abgelaufen."));
        if (!u.IsActive) return AuthenticateResult.Fail(L.T("Das Benutzerkonto des API-Tokens ist deaktiviert."));

        // At most one write per minute and token.
        if (t.LastUsedAt is null || now - t.LastUsedAt > TimeSpan.FromMinutes(1))
        {
            var cutoff = now.AddMinutes(-1);
            await db.ApiTokens.Where(x => x.Id == t.Id && (x.LastUsedAt == null || x.LastUsedAt < cutoff))
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.LastUsedAt, now), Context.RequestAborted);
        }

        var identity = new ClaimsIdentity(
        [
            new Claim(ClaimTypes.NameIdentifier, u.Id.ToString()),
            new Claim(ClaimTypes.Name, u.Username),
            new Claim(ClaimTypes.Role, ApiTokens.Min(t.Role, u.Role).ToString()),
            new Claim(AuthClaims.Stamp, u.SecurityStamp),
            new Claim(AuthClaims.MustChangePassword, u.MustChangePassword ? "1" : "0"),
            new Claim(ApiTokens.TokenIdClaim, t.Id.ToString()),
        ], ApiTokens.Scheme);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), ApiTokens.Scheme));
    }

    protected override async Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        var result = await HandleAuthenticateOnceSafeAsync();
        Response.Headers.WWWAuthenticate = "Bearer";
        await Results.Problem(title: L.T("Nicht angemeldet"), detail: result.Failure?.Message ?? L.T("API-Token fehlt."), statusCode: 401).ExecuteAsync(Context);
    }

    protected override Task HandleForbiddenAsync(AuthenticationProperties properties) =>
        Results.Problem(title: L.T("Keine Berechtigung"), detail: L.T("Die Rolle des API-Tokens reicht dafür nicht aus."), statusCode: 403).ExecuteAsync(Context);
}

public static class ApiTokenEndpoints
{
    public record CreateTokenRequest(string Name, Role Role, int ExpiresInDays);

    public record ApiTokenDto(Guid Id, string Name, string Prefix, Role Role, Role EffectiveRole, Guid UserId, string Username, DateTimeOffset CreatedAt,
        DateTimeOffset ExpiresAt, DateTimeOffset? LastUsedAt, DateTimeOffset? RevokedAt, string? RevokedBy, string State);

    public record CreatedTokenDto(ApiTokenDto Info, string Token);

    private static ApiTokenDto ToDto(ApiToken t, AppUser u, DateTimeOffset now) => new(t.Id, t.Name, t.Prefix, t.Role, ApiTokens.Min(t.Role, u.Role), u.Id, u.Username,
        t.CreatedAt, t.ExpiresAt, t.LastUsedAt, t.RevokedAt, t.RevokedBy,
        t.RevokedAt is not null ? "Revoked" : t.ExpiresAt <= now ? "Expired" : !u.IsActive ? "Inactive" : "Active");

    public static void MapApiTokenEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/tokens").RequireAuthorization(nameof(Role.Viewer));

        // Tokens are managed in the browser session only: a token must not mint or revoke tokens.
        api.AddEndpointFilter(async (ctx, next) => ctx.HttpContext.User.IsTokenAuthenticated()
            ? Results.Problem(title: L.T("API-Tokens können nur in der Oberfläche verwaltet werden"), statusCode: 403)
            : await next(ctx));

        api.MapGet("/", async (HttpContext ctx, AppDbContext db, bool? all, CancellationToken ct) =>
        {
            var me = ctx.User.UserId();
            var everyone = all == true && ctx.User.HasRole(Role.Admin);
            var q = db.ApiTokens.AsNoTracking().Join(db.Users.AsNoTracking(), t => t.UserId, u => u.Id, (t, u) => new { t, u });
            if (!everyone) q = q.Where(x => x.t.UserId == me);
            var list = await q.OrderByDescending(x => x.t.CreatedAt).ToListAsync(ct);
            var now = DateTimeOffset.UtcNow;
            return Results.Json(list.Select(x => ToDto(x.t, x.u, now)), Endpoints.JsonDefaults.Options);
        });

        api.MapPost("/", async (CreateTokenRequest r, HttpContext ctx, AppDbContext db, ChangeLogService log, CancellationToken ct) =>
        {
            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == ctx.User.UserId(), ct);
            if (user is null) return Results.Unauthorized();
            var errors = new Dictionary<string, string[]>();
            var name = r.Name?.Trim() ?? "";
            if (name.Length is 0 or > 100) errors["name"] = [L.T("Bitte einen Namen (max. 100 Zeichen) angeben, z. B. den Zweck oder das Skript.")];
            if (!Enum.IsDefined(r.Role)) errors["role"] = [L.T("Unbekannte Rolle.")];
            else if (r.Role > user.Role) errors["role"] = [L.T("Die Rolle eines Tokens darf nicht höher sein als die eigene Rolle.")];
            if (!ApiTokens.AllowedDays.Contains(r.ExpiresInDays)) errors["expiresInDays"] = [L.T("Gültigkeit: 30, 90, 180 oder 365 Tage.")];
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var (token, prefix, hash) = ApiTokens.Generate();
            var now = DateTimeOffset.UtcNow;
            var entity = new ApiToken
            {
                UserId = user.Id, Name = name, Prefix = prefix, SecretHash = hash, Role = r.Role, CreatedAt = now, ExpiresAt = now.AddDays(r.ExpiresInDays),
            };
            db.ApiTokens.Add(entity);
            log.Add(user.Username, "token.create", "token", entity.Id.ToString(),
                L.PF("API-Token '{0}' (tmk_{1}…, Rolle {2}, gültig bis {3:dd.MM.yyyy}) angelegt", name, prefix, r.Role, entity.ExpiresAt));
            await db.SaveChangesAsync(ct);
            return Results.Json(new CreatedTokenDto(ToDto(entity, user, now), token), Endpoints.JsonDefaults.Options);
        });

        api.MapPost("/{id:guid}/revoke", async (Guid id, HttpContext ctx, AppDbContext db, ChangeLogService log, CancellationToken ct) =>
        {
            var token = await db.ApiTokens.FirstOrDefaultAsync(t => t.Id == id, ct);
            if (token is null || (token.UserId != ctx.User.UserId() && !ctx.User.HasRole(Role.Admin))) return Results.NotFound();
            if (token.RevokedAt is not null) return Results.Problem(title: L.T("Das Token ist bereits widerrufen"), statusCode: 409);
            token.RevokedAt = DateTimeOffset.UtcNow;
            token.RevokedBy = ctx.User.UserName();
            var owner = await db.Users.AsNoTracking().FirstAsync(u => u.Id == token.UserId, ct);
            log.Add(ctx.User.UserName(), "token.revoke", "token", id.ToString(),
                L.PF("API-Token '{0}' (tmk_{1}…) von {2} widerrufen", token.Name, token.Prefix, owner.Username));
            await db.SaveChangesAsync(ct);
            return Results.Json(ToDto(token, owner, DateTimeOffset.UtcNow), Endpoints.JsonDefaults.Options);
        });
    }
}
