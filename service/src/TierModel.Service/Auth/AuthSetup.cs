using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using TierModel.Service.Data;

namespace TierModel.Service.Auth;

public static class AuthSetup
{
    public const string XsrfCookie = "XSRF-TOKEN";
    public const string XsrfHeader = "X-XSRF-TOKEN";
    public const string LoginRateLimit = "login";
    public const string DefaultScheme = "TierModel";

    public static IServiceCollection AddTierModelAuth(this IServiceCollection services, bool requireHttps)
    {
        services.AddScoped<IPasswordHasher<AppUser>, PasswordHasher<AppUser>>();
        services.AddScoped<UserService>();

        // Default: the session cookie; requests with "Authorization: Bearer …" are handled by the API-token scheme only
        // (the cookie is then ignored, so a token request can never ride on a browser session).
        var authentication = services.AddAuthentication(DefaultScheme);
        authentication.AddPolicyScheme(DefaultScheme, "Cookie oder API-Token", o => o.ForwardDefaultSelector = ctx =>
            ApiTokens.HasBearer(ctx.Request) ? ApiTokens.Scheme : CookieAuthenticationDefaults.AuthenticationScheme);
        authentication.AddScheme<AuthenticationSchemeOptions, ApiTokenHandler>(ApiTokens.Scheme, null);
        // Windows sign-in (Kerberos/NTLM) only on Windows; used solely by GET /api/auth/windows,
        // which then issues the normal cookie.
        if (WindowsAuth.Available) authentication.AddNegotiate();
        // Entra ID sign-in (OpenID Connect); configured at runtime from the settings, see EntraAuth.
        authentication.AddEntraAuth(requireHttps);
        authentication
            .AddCookie(o =>
            {
                o.Cookie.Name = "TierModel.Auth";
                o.Cookie.HttpOnly = true;
                o.Cookie.SameSite = SameSiteMode.Strict;
                o.Cookie.SecurePolicy = requireHttps ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
                o.ExpireTimeSpan = TimeSpan.FromHours(8);
                o.SlidingExpiration = true;
                o.Events = new CookieAuthenticationEvents
                {
                    // An API never redirects to a login page.
                    OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; },
                    OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; },
                    // Sessions end as soon as the account is disabled, deleted, or its password/role changes.
                    OnValidatePrincipal = async ctx =>
                    {
                        var id = ctx.Principal?.UserId();
                        var stamp = ctx.Principal?.FindFirst(AuthClaims.Stamp)?.Value;
                        var db = ctx.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
                        var valid = id is not null && await db.Users.AnyAsync(u => u.Id == id && u.IsActive && u.SecurityStamp == stamp);
                        if (!valid)
                        {
                            ctx.RejectPrincipal();
                            await ctx.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
                        }
                    },
                };
            });

        services.AddAuthorization(o =>
        {
            foreach (var role in Enum.GetValues<Role>())
                o.AddPolicy(role.ToString(), p => p.RequireAuthenticatedUser().RequireAssertion(c => c.User.HasRole(role)));
            o.FallbackPolicy = null;
        });

        services.AddAntiforgery(o =>
        {
            o.HeaderName = XsrfHeader;
            o.Cookie.Name = "TierModel.Antiforgery";
            o.Cookie.SameSite = SameSiteMode.Strict;
            o.Cookie.SecurePolicy = requireHttps ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
        });

        services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            o.AddPolicy(LoginRateLimit, ctx => RateLimitPartition.GetFixedWindowLimiter(
                ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
            // Requests with an API token: limited per token.
            o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
                ctx.User.IsTokenAuthenticated() && ctx.User.FindFirst(ApiTokens.TokenIdClaim)?.Value is { } tokenId
                    ? RateLimitPartition.GetFixedWindowLimiter("token:" + tokenId,
                        _ => new FixedWindowRateLimiterOptions { PermitLimit = ApiTokens.PermitsPerMinute, Window = TimeSpan.FromMinutes(1) })
                    : RateLimitPartition.GetNoLimiter(""));
        });
        return services;
    }

    /// <summary>Issues the readable XSRF-TOKEN cookie the SPA echoes back in the X-XSRF-TOKEN header.</summary>
    public static void IssueXsrfCookie(this HttpContext ctx, bool requireHttps)
    {
        var af = ctx.RequestServices.GetRequiredService<IAntiforgery>();
        var tokens = af.GetAndStoreTokens(ctx);
        ctx.Response.Cookies.Append(XsrfCookie, tokens.RequestToken!, new CookieOptions
        {
            HttpOnly = false,
            SameSite = SameSiteMode.Strict,
            Secure = requireHttps || ctx.Request.IsHttps,
            Path = "/",
        });
    }

    /// <summary>Security headers, CSRF validation for state-changing API calls, and the forced password change.</summary>
    public static IApplicationBuilder UseTierModelSecurity(this IApplicationBuilder app)
    {
        app.Use(async (ctx, next) =>
        {
            var h = ctx.Response.Headers;
            h["X-Content-Type-Options"] = "nosniff";
            h["X-Frame-Options"] = "DENY";
            h["Referrer-Policy"] = "no-referrer";
            h["Cross-Origin-Opener-Policy"] = "same-origin";
            h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
            h["Content-Security-Policy"] =
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
                "font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
            if (ctx.Request.Path.StartsWithSegments("/api"))
                h.CacheControl = "no-store";
            await next();
        });

        app.Use(async (ctx, next) =>
        {
            var path = ctx.Request.Path;
            // A bearer token that did not authenticate is an error of its own (no fallback to the cookie).
            if (path.StartsWithSegments("/api") && ApiTokens.HasBearer(ctx.Request) && !ctx.User.IsTokenAuthenticated())
            {
                var failure = (await ctx.AuthenticateAsync(ApiTokens.Scheme)).Failure?.Message;
                ctx.Response.Headers.WWWAuthenticate = "Bearer";
                await Results.Problem(title: "Nicht angemeldet", detail: failure ?? "Ungültiges API-Token.", statusCode: StatusCodes.Status401Unauthorized).ExecuteAsync(ctx);
                return;
            }
            // Sign-in, sign-out and password changes belong to the browser session, not to scripts.
            if (path.StartsWithSegments("/api/auth") && ctx.User.IsTokenAuthenticated() && !HttpMethods.IsGet(ctx.Request.Method))
            {
                await Results.Problem(title: "Mit einem API-Token nicht möglich", statusCode: StatusCodes.Status403Forbidden).ExecuteAsync(ctx);
                return;
            }
            // CSRF protects the cookie session only; token requests carry no cookie credentials.
            if (path.StartsWithSegments("/api") && !ctx.User.IsTokenAuthenticated() && !HttpMethods.IsGet(ctx.Request.Method) && !HttpMethods.IsHead(ctx.Request.Method) && !HttpMethods.IsOptions(ctx.Request.Method))
            {
                var af = ctx.RequestServices.GetRequiredService<IAntiforgery>();
                try
                {
                    await af.ValidateRequestAsync(ctx);
                }
                catch (AntiforgeryValidationException)
                {
                    await Results.Problem(title: "Ungültiges oder fehlendes CSRF-Token", detail: "Bitte die Seite neu laden.",
                        statusCode: StatusCodes.Status400BadRequest).ExecuteAsync(ctx);
                    return;
                }
            }

            if (path.StartsWithSegments("/api") && !path.StartsWithSegments("/api/auth")
                && ctx.User.Identity?.IsAuthenticated == true && ctx.User.FindFirst(AuthClaims.MustChangePassword)?.Value == "1")
            {
                await Results.Problem(title: "Passwortänderung erforderlich", statusCode: StatusCodes.Status403Forbidden).ExecuteAsync(ctx);
                return;
            }
            await next();
        });
        return app;
    }
}
