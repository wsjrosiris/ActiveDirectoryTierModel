using System.IO.Compression;
using System.Text;
using System.Text.Json.Nodes;
using TierModel.Service.Auth;
using TierModel.Service.Config;
using TierModel.Service.Data;
using TierModel.Service.Localization;

namespace TierModel.Service.Endpoints;

public static class ConfigEndpoints
{
    public record SaveSectionRequest(JsonNode? Content, string? Comment, int BaseVersion);
    public record RestoreRequest(string? Comment);

    public static void MapConfigEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/config").RequireAuthorization(nameof(Role.Viewer));

        g.MapGet("/sections", (ConfigService config, CancellationToken ct) => config.ListAsync(ct));

        g.MapGet("/sections/{key}", async (string key, ConfigService config, CancellationToken ct) =>
            await config.GetAsync(key, ct: ct) is { } s ? Results.Ok(s) : Results.NotFound());

        g.MapPut("/sections/{key}", async (string key, SaveSectionRequest r, HttpContext ctx, ConfigService config) =>
        {
            if (ConfigCatalog.Find(key) is null) return Results.NotFound();
            try
            {
                return Results.Ok(await config.SaveAsync(key, r.Content, r.Comment, r.BaseVersion, ctx.User.UserName()));
            }
            catch (ConfigConflictException ex)
            {
                return Results.Problem(title: L.T("Konflikt: Der Bereich wurde inzwischen geändert"),
                    detail: L.F("Aktuelle Version ist {0}. Bitte neu laden und die Änderungen erneut anwenden.", ex.CurrentVersion),
                    statusCode: StatusCodes.Status409Conflict,
                    extensions: new Dictionary<string, object?> { ["currentVersion"] = ex.CurrentVersion });
            }
            catch (ArgumentException ex)
            {
                return Results.Problem(title: ex.Message, statusCode: 400);
            }
        }).RequireAuthorization(nameof(Role.Editor));

        g.MapGet("/sections/{key}/versions", async (string key, ConfigService config, CancellationToken ct) =>
            ConfigCatalog.Find(key) is { } def ? Results.Ok(await config.VersionsAsync(def.Key, ct)) : Results.NotFound());

        g.MapGet("/sections/{key}/versions/{version:int}", async (string key, int version, ConfigService config, CancellationToken ct) =>
            await config.GetAsync(key, version, ct) is { } s ? Results.Ok(s) : Results.NotFound());

        g.MapPost("/sections/{key}/versions/{version:int}/restore", async (string key, int version, RestoreRequest r, HttpContext ctx, ConfigService config) =>
        {
            var old = await config.GetAsync(key, version);
            var current = await config.GetAsync(key);
            if (old is null || current is null) return Results.NotFound();
            var comment = string.IsNullOrWhiteSpace(r.Comment) ? L.PF("Version {0} wiederhergestellt", version) : L.PF("Version {0} wiederhergestellt: {1}", version, r.Comment.Trim());
            try
            {
                return Results.Ok(await config.SaveAsync(key, old.Content, comment, current.Version, ctx.User.UserName(), "config.restore"));
            }
            catch (ConfigConflictException)
            {
                return Results.Problem(title: L.T("Konflikt: Der Bereich wurde gerade geändert, bitte erneut versuchen"), statusCode: 409);
            }
        }).RequireAuthorization(nameof(Role.Editor));

        g.MapGet("/validate", async (ConfigService config, CancellationToken ct) =>
            ConfigValidator.Validate(await config.CurrentContentAsync(ct)));

        g.MapGet("/export", async (ConfigService config, Domains.DomainContext domain, Domains.DomainRegistry domains, CancellationToken ct) =>
        {
            var snapshot = await config.SnapshotAsync(ct);
            var ms = new MemoryStream();
            using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
            {
                foreach (var (def, _, content) in snapshot)
                {
                    var entry = zip.CreateEntry($"config/{def.FileName}", CompressionLevel.Optimal);
                    await using var s = entry.Open();
                    await s.WriteAsync(Encoding.UTF8.GetBytes(content), ct);
                }
                var manifest = zip.CreateEntry("versions.json");
                await using (var s = manifest.Open())
                    await s.WriteAsync(Encoding.UTF8.GetBytes(ConfigService.Serialize(
                        new JsonObject(snapshot.Select(x => KeyValuePair.Create(x.Def.Key, (JsonNode?)x.Version))))), ct);
            }
            ms.Position = 0;
            var name = domains.Multiple ? $"tiermodel-config-{domain.Key}-{DateTime.UtcNow:yyyyMMdd-HHmm}.zip" : $"tiermodel-config-{DateTime.UtcNow:yyyyMMdd-HHmm}.zip";
            return Results.File(ms, "application/zip", name);
        });
    }
}
