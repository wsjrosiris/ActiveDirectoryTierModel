using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using TierModel.Service.Data;
using TierModel.Service.Endpoints;
using TierModel.Service.Localization;

namespace TierModel.Service.Auth;

/// <summary>A role mapping entry: an Entra group (object ID) or an app role (value of the "roles" claim).</summary>
public record EntraRoleEntry(string Kind, string Value, string? DisplayName = null)
{
    public const string Group = "Group";
    public const string AppRole = "AppRole";
}

/// <summary>Stored form of the Entra ID sign-in (settings key "entraAuth"); the client secret is encrypted.</summary>
public record EntraAuthConfig(bool Enabled, string TenantId, string ClientId, string? ClientSecretProtected, Dictionary<Role, List<EntraRoleEntry>> RoleMappings)
{
    public static EntraAuthConfig Empty => new(false, "", "", null, Enum.GetValues<Role>().ToDictionary(r => r, _ => new List<EntraRoleEntry>()));

    /// <summary>Enabled and complete enough to send users to Entra ID.</summary>
    public bool Usable => Enabled && Guid.TryParse(TenantId, out _) && Guid.TryParse(ClientId, out _) && !string.IsNullOrEmpty(ClientSecretProtected);
}

public enum EntraSignInError { None, Failed, NoRole, Overage, Inactive, WrongTenant }

public record EntraSignInResult(AppUser? User, EntraSignInError Error)
{
    public string ErrorCode => Error switch
    {
        EntraSignInError.NoRole => "entra-norole",
        EntraSignInError.Overage => "entra-overage",
        EntraSignInError.Inactive => "entra-inactive",
        EntraSignInError.WrongTenant => "entra-tenant",
        _ => "entra-failed",
    };
}

/// <summary>
/// Sign-in with Microsoft Entra ID: OpenID Connect, authorization code flow with PKCE. The handler's options are built from the
/// settings stored in the database (<see cref="EntraOidcConfigure"/>) and rebuilt whenever an administrator saves them.
/// After a successful sign-in the normal session cookie is issued (like the Windows sign-in); accounts are created on first sign-in.
/// </summary>
public static partial class EntraAuth
{
    public const string Scheme = "Entra";
    public const string CallbackPath = "/signin-oidc";
    public const string SettingsKey = "entraAuth";
    public const string AuthorityHost = "https://login.microsoftonline.com";
    public const string HttpClientName = "entra";
    /// <summary>Placeholder so the handler's options validate while the sign-in is not configured (it is never used).</summary>
    private const string PlaceholderId = "00000000-0000-0000-0000-000000000000";

    private static readonly JsonSerializerOptions Json = JsonDefaults.Create();

    [GeneratedRegex(@"^[A-Za-z0-9._:\-]{1,120}$")]
    private static partial Regex AppRolePattern();

    public static string Authority(string tenantId) => $"{AuthorityHost}/{tenantId}/v2.0";

    public static async Task<EntraAuthConfig> LoadAsync(SettingsService settings, CancellationToken ct = default)
    {
        var json = await settings.GetValueAsync(SettingsKey, ct);
        EntraAuthConfig? config = null;
        if (json is not null)
        {
            try { config = JsonSerializer.Deserialize<EntraAuthConfig>(json, Json); }
            catch (JsonException) { /* unreadable: treat as not configured */ }
        }
        if (config is null) return EntraAuthConfig.Empty;
        foreach (var role in Enum.GetValues<Role>()) config.RoleMappings.TryAdd(role, []);
        return config;
    }

    public static Task SaveAsync(SettingsService settings, EntraAuthConfig config, CancellationToken ct = default) =>
        settings.SetValueAsync(SettingsKey, JsonSerializer.Serialize(config, Json), ct);

    /// <summary>Highest role whose groups or app roles the user has; null if none.</summary>
    public static Role? ResolveRole(EntraAuthConfig config, IEnumerable<string> groups, IEnumerable<string> appRoles)
    {
        var g = new HashSet<string>(groups, StringComparer.OrdinalIgnoreCase);
        var r = new HashSet<string>(appRoles, StringComparer.Ordinal);
        return Enum.GetValues<Role>().OrderDescending().Cast<Role?>().FirstOrDefault(role =>
            config.RoleMappings.TryGetValue(role!.Value, out var entries) && entries.Any(e =>
                e.Kind == EntraRoleEntry.AppRole ? r.Contains(e.Value) : g.Contains(e.Value)));
    }

    /// <summary>Validates one mapping entry; returns the normalised entry or an error message.</summary>
    public static (EntraRoleEntry? Entry, string? Error) Normalize(EntraRoleEntry e)
    {
        var value = (e.Value ?? "").Trim();
        var name = string.IsNullOrWhiteSpace(e.DisplayName) ? null : e.DisplayName.Trim();
        if (name is { Length: > 128 }) return (null, L.F("Anzeigename von '{0}' ist zu lang (max. 128 Zeichen).", value));
        if (e.Kind == EntraRoleEntry.AppRole)
            return AppRolePattern().IsMatch(value) ? (new EntraRoleEntry(EntraRoleEntry.AppRole, value, name), null)
                : (null, L.F("'{0}' ist kein gültiger Wert einer App-Rolle (Buchstaben, Ziffern, . _ : -).", value));
        if (e.Kind != EntraRoleEntry.Group) return (null, L.F("Unbekannte Art '{0}'.", e.Kind));
        return Guid.TryParse(value, out var id) ? (new EntraRoleEntry(EntraRoleEntry.Group, id.ToString("D"), name), null)
            : (null, L.F("'{0}' ist keine gültige Objekt-ID (GUID) einer Gruppe.", value));
    }

    /// <summary>Applies the stored configuration to the OpenID Connect handler's options.</summary>
    public static void Apply(OpenIdConnectOptions o, EntraAuthConfig c, IDataProtector secrets, bool requireHttps)
    {
        var tenant = Guid.TryParse(c.TenantId, out var t) ? t.ToString("D") : PlaceholderId;
        o.Authority = Authority(tenant);
        o.ClientId = Guid.TryParse(c.ClientId, out var client) ? client.ToString("D") : PlaceholderId;
        string? secret = null;
        if (c.ClientSecretProtected is { Length: > 0 } p)
        {
            try { secret = secrets.Unprotect(p); }
            catch (System.Security.Cryptography.CryptographicException) { /* key lost: sign-in fails with a clear log entry */ }
        }
        o.ClientSecret = secret;
        o.CallbackPath = CallbackPath;
        o.ResponseType = OpenIdConnectResponseType.Code;
        // Query instead of form_post: the callback is a top-level GET, so the correlation and nonce cookies work with SameSite=Lax.
        o.ResponseMode = OpenIdConnectResponseMode.Query;
        o.UsePkce = true;
        o.SaveTokens = false;
        o.GetClaimsFromUserInfoEndpoint = false;
        o.MapInboundClaims = false;
        o.RequireHttpsMetadata = true;
        o.SignInScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        o.Scope.Clear();
        o.Scope.Add("openid");
        o.Scope.Add("profile");
        o.Scope.Add("email");
        o.TokenValidationParameters.ValidateIssuer = true;
        o.TokenValidationParameters.ValidIssuer = Authority(tenant);
        o.TokenValidationParameters.ValidAudience = o.ClientId;
        o.TokenValidationParameters.NameClaimType = "name";
        o.TokenValidationParameters.RoleClaimType = "roles";
        o.CorrelationCookie.SameSite = SameSiteMode.Lax;
        o.CorrelationCookie.SecurePolicy = requireHttps ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
        o.NonceCookie.SameSite = SameSiteMode.Lax;
        o.NonceCookie.SecurePolicy = requireHttps ? CookieSecurePolicy.Always : CookieSecurePolicy.SameAsRequest;
        o.RemoteAuthenticationTimeout = TimeSpan.FromMinutes(10);
    }

    /// <summary>Checks the token of a signed-in Entra user, provisions or updates the account and returns it (or the reason for refusal).</summary>
    public static async Task<EntraSignInResult> ProcessAsync(ClaimsPrincipal token, EntraAuthConfig config, AppDbContext db, ChangeLogService log, CancellationToken ct = default)
    {
        var oid = token.FindFirstValue("oid");
        var tid = token.FindFirstValue("tid");
        if (string.IsNullOrEmpty(oid) || string.IsNullOrEmpty(tid)) return new(null, EntraSignInError.Failed);
        if (!Guid.TryParse(tid, out var tidGuid) || !Guid.TryParse(config.TenantId, out var cfgTenant) || tidGuid != cfgTenant)
            return new(null, EntraSignInError.WrongTenant);

        var account = token.FindFirstValue("preferred_username") ?? token.FindFirstValue("upn") ?? token.FindFirstValue("email") ?? oid;
        if (account.Length > 200) account = account[..200];
        var displayName = token.FindFirstValue("name") is { Length: > 0 } n ? n : account;
        if (displayName.Length > 128) displayName = displayName[..128];
        var groups = token.FindAll("groups").Select(c => c.Value).ToList();
        var roles = token.FindAll("roles").Select(c => c.Value).ToList();
        // More than ~200 groups: Entra ID leaves out the "groups" claim and points to Microsoft Graph instead.
        var overage = token.FindFirstValue("_claim_names") is { } names && names.Contains("groups", StringComparison.Ordinal);

        var key = $"entra:{tidGuid:D}:{oid}";
        var user = await db.Users.FirstOrDefaultAsync(u => u.Sid == key, ct);
        var role = ResolveRole(config, groups, roles);
        if (role is null)
        {
            log.Add(account, "auth.entra-denied", "auth", user?.Id.ToString(),
                L.PF("Entra-Anmeldung von '{0}' abgelehnt: keiner Rolle zugeordnet", account) + (overage ? L.P(" (zu viele Gruppen im Token – App-Rollen verwenden)") : ""));
            await db.SaveChangesAsync(ct);
            return new(null, overage ? EntraSignInError.Overage : EntraSignInError.NoRole);
        }

        if (user is null)
        {
            user = new AppUser
            {
                Username = account, NormalizedUsername = UserService.Normalize(account), DisplayName = displayName,
                AuthType = AuthType.Entra, Sid = key, Role = role.Value,
            };
            // A local or Windows account may already use this name: keep them apart.
            if (await db.Users.AnyAsync(u => u.NormalizedUsername == user.NormalizedUsername, ct))
                user.NormalizedUsername = UserService.Normalize(account + "@entra:" + oid);
            db.Users.Add(user);
            log.Add(account, "user.create", "user", user.Id.ToString(), L.PF("Entra-Konto '{0}' bei der ersten Anmeldung angelegt ({1})", account, role));
        }
        else if (user.Role != role || user.Username != account)
        {
            log.Add(account, "user.update", "user", user.Id.ToString(), L.PF("Rolle von '{0}' aus Entra ID: {1} → {2}", account, user.Role, role));
            user.Role = role.Value;
            user.Username = account;
            user.SecurityStamp = Guid.NewGuid().ToString("N");
        }
        if (!user.IsActive)
        {
            log.Add(account, "auth.entra-denied", "auth", user.Id.ToString(), L.PF("Entra-Anmeldung von '{0}' abgelehnt: Konto deaktiviert", account));
            await db.SaveChangesAsync(ct);
            return new(null, EntraSignInError.Inactive);
        }

        user.LastLoginAt = DateTimeOffset.UtcNow;
        log.Add(account, "auth.entra-login", "auth", user.Id.ToString(), L.PF("{0} hat sich mit Entra ID angemeldet ({1})", account, user.Role));
        await db.SaveChangesAsync(ct);
        return new(user, EntraSignInError.None);
    }

    public static AuthenticationBuilder AddEntraAuth(this AuthenticationBuilder authentication, bool requireHttps)
    {
        authentication.Services.AddHttpClient(HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(15));
        authentication.Services.AddSingleton<IConfigureOptions<OpenIdConnectOptions>>(sp =>
            new EntraOidcConfigure(sp.GetRequiredService<IServiceScopeFactory>(), requireHttps));
        authentication.AddOpenIdConnect(Scheme, "Microsoft Entra ID", o =>
        {
            o.Events = new OpenIdConnectEvents
            {
                // Never start or finish a sign-in while it is switched off (e.g. a stale callback after disabling).
                OnRedirectToIdentityProvider = async ctx =>
                {
                    var config = await LoadAsync(ctx.HttpContext.RequestServices.GetRequiredService<SettingsService>(), ctx.HttpContext.RequestAborted);
                    if (!config.Usable)
                    {
                        ctx.Response.Redirect("/login?error=entra-disabled");
                        ctx.HandleResponse();
                    }
                },
                OnMessageReceived = async ctx =>
                {
                    var config = await LoadAsync(ctx.HttpContext.RequestServices.GetRequiredService<SettingsService>(), ctx.HttpContext.RequestAborted);
                    if (!config.Usable)
                    {
                        ctx.Response.Redirect("/login?error=entra-disabled");
                        ctx.HandleResponse();
                    }
                },
                OnTokenValidated = async ctx =>
                {
                    var services = ctx.HttpContext.RequestServices;
                    var config = await LoadAsync(services.GetRequiredService<SettingsService>(), ctx.HttpContext.RequestAborted);
                    var result = await ProcessAsync(ctx.Principal!, config, services.GetRequiredService<AppDbContext>(),
                        services.GetRequiredService<ChangeLogService>(), ctx.HttpContext.RequestAborted);
                    if (result.User is null)
                    {
                        ctx.Response.Redirect("/login?error=" + result.ErrorCode);
                        ctx.HandleResponse();
                        return;
                    }
                    // The handler signs in the cookie scheme with this principal: the normal session.
                    ctx.Principal = AuthClaims.CreatePrincipal(result.User);
                    ctx.Properties!.RedirectUri = WindowsAuth.SafeReturnUrl(ctx.Properties.RedirectUri);
                },
                OnRemoteFailure = ctx =>
                {
                    services(ctx.HttpContext).GetRequiredService<ILoggerFactory>().CreateLogger("EntraAuth")
                        .LogWarning(ctx.Failure, "Entra ID sign-in failed");
                    // The user cancelled at Microsoft, or the state/nonce/correlation check failed.
                    var cancelled = ctx.Failure?.Message.Contains("access_denied", StringComparison.OrdinalIgnoreCase) == true;
                    ctx.Response.Redirect("/login?error=" + (cancelled ? "entra-cancelled" : "entra-failed"));
                    ctx.HandleResponse();
                    return Task.CompletedTask;
                },
            };
        });
        return authentication;

        static IServiceProvider services(HttpContext ctx) => ctx.RequestServices;
    }

    /// <summary>Drops the cached handler options so the next request builds them from the saved settings.</summary>
    public static void Reload(IServiceProvider services) =>
        services.GetRequiredService<IOptionsMonitorCache<OpenIdConnectOptions>>().TryRemove(Scheme);

    public record MetadataCheck(bool Ok, string Message, string? Issuer, string? AuthorizationEndpoint, string? TokenEndpoint);

    /// <summary>Fetches the tenant's OpenID Connect metadata document and checks the issuer.</summary>
    public static async Task<MetadataCheck> CheckMetadataAsync(HttpClient http, string tenantId, CancellationToken ct, string authorityHost = AuthorityHost)
    {
        if (!Guid.TryParse(tenantId, out var tenant))
            return new(false, L.T("Die Mandanten-ID muss eine GUID sein."), null, null, null);
        var url = $"{authorityHost.TrimEnd('/')}/{tenant:D}/v2.0/.well-known/openid-configuration";
        try
        {
            using var response = await http.GetAsync(url, ct);
            var text = await response.Content.ReadAsStringAsync(ct);
            JsonNode? json = null;
            try { json = JsonNode.Parse(text); } catch (JsonException) { /* below */ }
            if (!response.IsSuccessStatusCode)
                return new(false, L.F("Der Mandant wurde nicht gefunden (HTTP {0}): {1}", (int)response.StatusCode, json?["error_description"]?.GetValue<string>()?.Split('\n')[0] ?? L.T("keine Details")), null, null, null);
            var issuer = json?["issuer"]?.GetValue<string>();
            var auth = json?["authorization_endpoint"]?.GetValue<string>();
            var token = json?["token_endpoint"]?.GetValue<string>();
            if (issuer is null || auth is null || token is null)
                return new(false, L.T("Das Metadatendokument ist unvollständig."), issuer, auth, token);
            if (!issuer.Contains(tenant.ToString("D"), StringComparison.OrdinalIgnoreCase))
                return new(false, L.F("Der Aussteller '{0}' passt nicht zur Mandanten-ID.", issuer), issuer, auth, token);
            return new(true, L.T("Metadaten gefunden – der Mandant ist erreichbar."), issuer, auth, token);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return new(false, L.F("{0} ist nicht erreichbar: {1}", AuthorityHost, ex.GetBaseException().Message), null, null, null);
        }
    }

    public record EntraAuthDto(bool Enabled, string TenantId, string ClientId, bool HasClientSecret, Dictionary<Role, List<EntraRoleEntry>> RoleMappings,
        string CallbackPath);

    /// <summary>ClientSecret: null or empty keeps the stored secret.</summary>
    public record UpdateEntraAuthRequest(bool Enabled, string? TenantId, string? ClientId, string? ClientSecret, Dictionary<Role, List<EntraRoleEntry>>? RoleMappings);

    public record CheckRequest(string? TenantId);

    private static EntraAuthDto ToDto(EntraAuthConfig c) =>
        new(c.Enabled, c.TenantId, c.ClientId, !string.IsNullOrEmpty(c.ClientSecretProtected), c.RoleMappings, CallbackPath);

    public static void MapEntraAuthEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/auth/entra", async (HttpContext ctx, string? returnUrl, SettingsService settings, ILoggerFactory loggers) =>
        {
            var config = await LoadAsync(settings);
            if (!config.Usable) return Results.Redirect("/login?error=entra-disabled");
            try
            {
                // Fetches the tenant's metadata (cached) and redirects to Microsoft with state, nonce and PKCE challenge.
                await ctx.ChallengeAsync(Scheme, new AuthenticationProperties { RedirectUri = WindowsAuth.SafeReturnUrl(returnUrl) });
                return Results.Empty;
            }
            catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or IOException)
            {
                loggers.CreateLogger("EntraAuth").LogWarning(ex, "Entra ID sign-in could not be started");
                return Results.Redirect("/login?error=entra-unreachable");
            }
        });

        var g = app.MapGroup("/api/settings/entra-auth").RequireAuthorization(nameof(Role.Admin));

        g.MapGet("/", async (SettingsService settings) => ToDto(await LoadAsync(settings)));

        g.MapPut("/", async (UpdateEntraAuthRequest r, HttpContext ctx, SettingsService settings, ChangeLogService log, AppDbContext db) =>
        {
            var current = await LoadAsync(settings);
            var errors = new Dictionary<string, string[]>();
            var tenant = (r.TenantId ?? "").Trim();
            var client = (r.ClientId ?? "").Trim();
            if (tenant.Length > 0 && !Guid.TryParse(tenant, out _)) errors["tenantId"] = [L.T("Die Mandanten-ID (Verzeichnis-ID) ist eine GUID.")];
            if (client.Length > 0 && !Guid.TryParse(client, out _)) errors["clientId"] = [L.T("Die Anwendungs-ID (Client-ID) ist eine GUID.")];
            if (r.Enabled && tenant.Length == 0) errors["tenantId"] = [L.T("Mandanten-ID angeben.")];
            if (r.Enabled && client.Length == 0) errors["clientId"] = [L.T("Anwendungs-ID angeben.")];
            if (r.ClientSecret is { Length: > 512 }) errors["clientSecret"] = [L.T("Der geheime Clientschlüssel ist zu lang.")];
            var secret = string.IsNullOrEmpty(r.ClientSecret) ? current.ClientSecretProtected : settings.Secrets.Protect(r.ClientSecret.Trim());
            if (r.Enabled && secret is null) errors["clientSecret"] = [L.T("Geheimen Clientschlüssel angeben.")];

            var mappings = Enum.GetValues<Role>().ToDictionary(role => role, _ => new List<EntraRoleEntry>());
            foreach (var (role, entries) in r.RoleMappings ?? [])
            {
                if (!Enum.IsDefined(role)) continue;
                var messages = new List<string>();
                foreach (var entry in entries.Where(e => !string.IsNullOrWhiteSpace(e.Value)))
                {
                    var (normalized, error) = Normalize(entry);
                    if (error is not null) messages.Add(error);
                    else if (!mappings[role].Any(x => x.Kind == normalized!.Kind && string.Equals(x.Value, normalized.Value, StringComparison.OrdinalIgnoreCase)))
                        mappings[role].Add(normalized!);
                }
                if (messages.Count > 0) errors[$"roleMappings.{role}"] = [.. messages];
            }
            if (r.Enabled && mappings.Values.All(v => v.Count == 0))
                errors["roleMappings"] = [L.T("Mindestens einer Rolle eine Gruppe oder App-Rolle zuordnen.")];
            if (errors.Count > 0) return Results.ValidationProblem(errors);

            var config = new EntraAuthConfig(r.Enabled,
                Guid.TryParse(tenant, out var t) ? t.ToString("D") : "", Guid.TryParse(client, out var c) ? c.ToString("D") : "", secret, mappings);
            log.Add(ctx.User.UserName(), "settings.entra-auth", "settings", null,
                L.PF("Entra-Anmeldung {0}", (r.Enabled ? L.P("aktiviert") : L.P("deaktiviert")))
                + (string.IsNullOrEmpty(r.ClientSecret) ? "" : L.P(", geheimer Clientschlüssel geändert")) + ": "
                + string.Join(", ", mappings.Where(kv => kv.Value.Count > 0).Select(kv => $"{kv.Key} = {string.Join(" / ", kv.Value.Select(x => x.DisplayName ?? x.Value))}")),
                new { enabled = r.Enabled, tenantId = config.TenantId, clientId = config.ClientId, roleMappings = mappings });
            await SaveAsync(settings, config);
            Reload(ctx.RequestServices);
            return Results.Ok(ToDto(config));
        });

        g.MapPost("/check", async (CheckRequest r, SettingsService settings, IHttpClientFactory http, CancellationToken ct) =>
        {
            var tenant = string.IsNullOrWhiteSpace(r.TenantId) ? (await LoadAsync(settings, ct)).TenantId : r.TenantId.Trim();
            using var client = http.CreateClient(HttpClientName);
            return Results.Ok(await CheckMetadataAsync(client, tenant, ct));
        });
    }
}

/// <summary>Builds the OpenID Connect options from the stored settings (read when the options are created or after <see cref="EntraAuth.Reload"/>).</summary>
public class EntraOidcConfigure(IServiceScopeFactory scopes, bool requireHttps) : IConfigureNamedOptions<OpenIdConnectOptions>
{
    public void Configure(OpenIdConnectOptions options) => Configure(Options.DefaultName, options);

    public void Configure(string? name, OpenIdConnectOptions options)
    {
        if (name != EntraAuth.Scheme) return;
        EntraAuthConfig config;
        IDataProtector secrets;
        using (var scope = scopes.CreateScope())
        {
            var settings = scope.ServiceProvider.GetRequiredService<SettingsService>();
            secrets = settings.Secrets;
            try { config = EntraAuth.LoadAsync(settings).GetAwaiter().GetResult(); }
            catch (Exception) { config = EntraAuthConfig.Empty; } // database not reachable yet: "not configured"
        }
        EntraAuth.Apply(options, config, secrets, requireHttps);
    }
}
