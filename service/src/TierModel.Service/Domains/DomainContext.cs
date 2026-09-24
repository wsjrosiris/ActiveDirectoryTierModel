using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using TierModel.Service.Data;

namespace TierModel.Service.Domains;

/// <summary>
/// Cached list of the managed domains (roadmap 17). Reloaded after every change through the API and when a request names
/// an unknown domain. Entities handed out are detached copies and must not be modified.
/// </summary>
public sealed class DomainRegistry
{
    private volatile IReadOnlyList<Domain> _domains = [];

    /// <summary>Stand-in before the database was read (e.g. a CLI command before the migration).</summary>
    private static readonly Domain Fallback = new() { Id = 1, Key = "default", DisplayName = "Standard-Domäne", IsDefault = true, Enabled = true };

    public IReadOnlyList<Domain> All => _domains;

    public IEnumerable<Domain> Enabled => _domains.Where(d => d.Enabled);

    public Domain Default => _domains.FirstOrDefault(d => d.IsDefault) ?? _domains.FirstOrDefault() ?? Fallback;

    public Domain? Find(int id) => _domains.FirstOrDefault(d => d.Id == id);

    public Domain? Find(string? key) =>
        string.IsNullOrWhiteSpace(key) ? null : _domains.FirstOrDefault(d => string.Equals(d.Key, key.Trim(), StringComparison.OrdinalIgnoreCase));

    /// <summary>Key of a domain for DTOs and log entries ("?" when unknown).</summary>
    public string KeyOf(int id) => Find(id)?.Key ?? (id == Fallback.Id && _domains.Count == 0 ? Fallback.Key : "?");

    /// <summary>More than one domain exists: messages name the domain.</summary>
    public bool Multiple => _domains.Count > 1;

    public async Task ReloadAsync(AppDbContext db, CancellationToken ct = default) =>
        _domains = await db.Domains.AsNoTracking().OrderByDescending(d => d.IsDefault).ThenBy(d => d.DisplayName).ToListAsync(ct);

    public async Task ReloadAsync(IServiceProvider services, CancellationToken ct = default)
    {
        await using var scope = services.CreateAsyncScope();
        await ReloadAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>(), ct);
    }

    /// <summary>
    /// Startup: the first domain created by the migration gets the DC and language from appsettings.json when the
    /// database had none (the settings "defaultPreferredDc"/"admlLanguage" used to fall back to them).
    /// </summary>
    public async Task InitializeAsync(AppDbContext db, TierModelOptions options, CancellationToken ct = default)
    {
        var first = await db.Domains.FirstOrDefaultAsync(d => d.Id == 1, ct);
        if (first is not null)
        {
            var changed = false;
            if (string.IsNullOrWhiteSpace(first.PreferredDc) && !string.IsNullOrWhiteSpace(options.DefaultPreferredDc))
            {
                first.PreferredDc = options.DefaultPreferredDc.Trim();
                changed = true;
            }
            if (string.IsNullOrWhiteSpace(first.DnsName) && DomainRules.DnsFromDc(first.PreferredDc) is { } dns)
            {
                first.DnsName = dns;
                changed = true;
            }
            if (string.IsNullOrWhiteSpace(first.AdmlLanguage))
            {
                first.AdmlLanguage = string.IsNullOrWhiteSpace(options.AdmlLanguage) ? "en-US" : options.AdmlLanguage.Trim();
                changed = true;
            }
            if (changed) await db.SaveChangesAsync(ct);
        }
        await ReloadAsync(db, ct);
    }
}

/// <summary>
/// The domain a request (or a background job) works on. Requests choose it with the header <c>X-TierModel-Domain: &lt;key&gt;</c>
/// (see <see cref="DomainMiddleware"/>); without the header the default domain applies, so existing clients keep working.
/// Background workers call <see cref="Use(int)"/> before resolving domain-bound data.
/// </summary>
public sealed class DomainContext(DomainRegistry registry)
{
    private Domain? _domain;

    public Domain Current => _domain is { } d ? registry.Find(d.Id) ?? d : registry.Default;

    public int Id => Current.Id;

    public string Key => Current.Key;

    /// <summary>The request named the domain explicitly.</summary>
    public bool Explicit { get; private set; }

    public void Use(Domain domain, bool isExplicit = false)
    {
        _domain = domain;
        Explicit = isExplicit;
    }

    /// <summary>Switches to the domain of a stored row (run, schedule, request). Unknown ids (deleted domain) keep the row's id.</summary>
    public void Use(int id) =>
        _domain = registry.Find(id) ?? new Domain { Id = id, Key = "?", DisplayName = $"Domäne {id}" };

    /// <summary>"Contoso (contoso.com)" for messages.</summary>
    public string Label => DomainRules.Label(Current);
}
