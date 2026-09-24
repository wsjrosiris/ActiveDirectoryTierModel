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

    public static IServiceCollection AddTierModelAuth(this IServiceCollection services, bool requireHttps)
    {
        services.AddScoped<IPasswordHasher<AppUser>, PasswordHasher<AppUser>>();
        services.AddScoped<UserService>();

        services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
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
            if (path.StartsWithSegments("/api") && !HttpMethods.IsGet(ctx.Request.Method) && !HttpMethods.IsHead(ctx.Request.Method) && !HttpMethods.IsOptions(ctx.Request.Method))
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
