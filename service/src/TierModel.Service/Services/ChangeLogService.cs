using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using TierModel.Service.Data;
using TierModel.Service.Domains;

namespace TierModel.Service;

/// <summary>Adds change-log entries to the current unit of work; the caller saves.</summary>
public class ChangeLogService(AppDbContext db, DomainContext domain, DomainRegistry registry)
{
    /// <summary>Entity types that belong to one domain (roadmap 17): their entries carry the domain key.</summary>
    public static readonly IReadOnlySet<string> DomainEntityTypes = new HashSet<string> { "config", "run", "schedule", "jit", "jitgroup", "privileged" };

    private static readonly IReadOnlySet<string> DomainActions = new HashSet<string> { "setup.complete", "report.send", "report.failed" };

    /// <param name="domainId">Domain of the entry when it differs from the current request (e.g. seeding a new domain).</param>
    public void Add(string username, string action, string entityType, string? entityId, string summary, object? details = null, int? domainId = null)
    {
        Domain? d = domainId is { } id ? registry.Find(id) ?? new Domain { Id = id, Key = registry.KeyOf(id), DisplayName = "" }
            : DomainEntityTypes.Contains(entityType) || DomainActions.Contains(action) ? domain.Current : null;
        string? json = details is null ? null : JsonSerializer.Serialize(details, JsonSerializerOptions.Web);
        if (d is not null)
        {
            // Hash-chained with the entry, so the domain of a change cannot be altered later.
            var node = json is null ? new JsonObject() : JsonNode.Parse(json);
            if (node is JsonObject o && !o.ContainsKey("domain"))
            {
                o["domain"] = d.Key;
                json = o.ToJsonString(JsonSerializerOptions.Web);
            }
            if (registry.Multiple) summary = $"[{d.Key}] {summary}";
        }
        db.ChangeLog.Add(new ChangeEntry
        {
            At = DateTimeOffset.UtcNow,
            Username = username,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            Summary = summary,
            Details = json,
        });
    }

    /// <summary>
    /// Entries of <paramref name="d"/> plus instance-wide entries. Domain-bound entries written before roadmap 17 (no domain
    /// in the details) belong to the first domain.
    /// </summary>
    public static IQueryable<ChangeEntry> ForDomain(IQueryable<ChangeEntry> q, Domain d)
    {
        var types = DomainEntityTypes.ToList();
        var filter = JsonSerializer.Serialize(new { domain = d.Key });
        var first = d.Id == 1;
        return q.Where(e => !types.Contains(e.EntityType)
            || (e.Details != null && EF.Functions.JsonContains(e.Details, filter))
            || (first && (e.Details == null || !EF.Functions.JsonExists(e.Details, "domain"))));
    }
}
