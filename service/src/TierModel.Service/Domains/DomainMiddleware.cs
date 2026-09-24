using TierModel.Service.Localization;
namespace TierModel.Service.Domains;

/// <summary>
/// Resolves the domain of an API request (roadmap 17): header <c>X-TierModel-Domain</c>, for GET requests alternatively
/// the query parameter <c>domain</c> (downloads opened by the browser), otherwise the default domain.
/// Unknown keys → 400. Disabled domains can be read but not changed (409). The resolved key is echoed in the response header.
/// </summary>
public sealed class DomainMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext ctx, DomainContext domain, DomainRegistry registry)
    {
        if (!ctx.Request.Path.StartsWithSegments("/api"))
        {
            await next(ctx);
            return;
        }
        string? key = ctx.Request.Headers[DomainRules.Header].ToString();
        if (string.IsNullOrWhiteSpace(key) && HttpMethods.IsGet(ctx.Request.Method)) key = ctx.Request.Query[DomainRules.QueryParameter].ToString();
        if (!string.IsNullOrWhiteSpace(key))
        {
            var found = registry.Find(key);
            if (found is null)
            {
                // Another instance or an administrator may just have created it.
                await registry.ReloadAsync(ctx.RequestServices, ctx.RequestAborted);
                found = registry.Find(key);
            }
            if (found is null)
            {
                await Results.Problem(title: L.T("Unbekannte Domäne"), detail: L.F("Eine Domäne mit dem Kurznamen „{0}“ ist nicht eingerichtet.", key.Trim()),
                    statusCode: StatusCodes.Status400BadRequest).ExecuteAsync(ctx);
                return;
            }
            var isDomainAdmin = ctx.Request.Path.StartsWithSegments("/api/domains") || ctx.Request.Path.StartsWithSegments("/api/auth");
            if (!found.Enabled && !HttpMethods.IsGet(ctx.Request.Method) && !HttpMethods.IsHead(ctx.Request.Method) && !isDomainAdmin)
            {
                await Results.Problem(title: L.T("Domäne deaktiviert"), detail: L.F("Die Domäne „{0}“ ist deaktiviert und kann nur gelesen werden.", found.DisplayName),
                    statusCode: StatusCodes.Status409Conflict).ExecuteAsync(ctx);
                return;
            }
            domain.Use(found, isExplicit: true);
        }
        ctx.Response.Headers[DomainRules.Header] = domain.Key;
        await next(ctx);
    }
}
