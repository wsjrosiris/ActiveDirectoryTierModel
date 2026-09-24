using System.Text.Json;
using TierModel.Service.Data;

namespace TierModel.Service;

/// <summary>Adds change-log entries to the current unit of work; the caller saves.</summary>
public class ChangeLogService(AppDbContext db)
{
    public void Add(string username, string action, string entityType, string? entityId, string summary, object? details = null) =>
        db.ChangeLog.Add(new ChangeEntry
        {
            At = DateTimeOffset.UtcNow,
            Username = username,
            Action = action,
            EntityType = entityType,
            EntityId = entityId,
            Summary = summary,
            Details = details is null ? null : JsonSerializer.Serialize(details, JsonSerializerOptions.Web),
        });
}
