using Microsoft.EntityFrameworkCore;
using TierModel.Service.AdView;
using TierModel.Service.Auth;
using TierModel.Service.Config;
using TierModel.Service.Data;
using TierModel.Service.Monitoring;
using TierModel.Service.Runs;

namespace TierModel.Service.Domains;

public record DomainDto(int Id, string Key, string DisplayName, string DnsName, string PreferredDc, string AdmlLanguage, bool Enabled, bool IsDefault,
    DateTimeOffset CreatedAt, string? Notes)
{
    public static DomainDto From(Domain d) => new(d.Id, d.Key, d.DisplayName, d.DnsName, d.PreferredDc, d.AdmlLanguage, d.Enabled, d.IsDefault, d.CreatedAt, d.Notes);
}

public record DomainInput(string? Key, string? DisplayName, string? DnsName, string? PreferredDc, string? AdmlLanguage, bool Enabled = true, bool IsDefault = false,
    string? Notes = null);

public record DomainCheckRequest(string? DnsName, string? PreferredDc);

public record DomainCheckDto(bool Ok, string Message, string Source, AdDomainInfo? Domain);

public record DomainRunInfoDto(long Id, RunStatus Status, DateTimeOffset? At, int? DriftCount);

/// <summary>One card of the "Alle Domänen" overview.</summary>
public record DomainOverviewDto(int Id, string Key, string DisplayName, string DnsName, bool Enabled, bool IsDefault,
    List<TierCompliance>? Compliance, DomainRunInfoDto? LastAudit, DomainRunInfoDto? LastMonitor, int PendingApprovals, int Active, bool SetupNeeded);

public record DomainDeletionDto(bool CanDelete, string? Reason);

/// <summary>Managed domains (roadmap 17): list for everyone, maintenance for administrators.</summary>
public static class DomainEndpoints
{
    public static void MapDomainEndpoints(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api/domains").RequireAuthorization(nameof(Role.Viewer));

        api.MapGet("/", (DomainRegistry registry) => registry.All.Select(DomainDto.From));

        api.MapGet("/overview", async (AppDbContext db, DomainRegistry registry, CancellationToken ct) =>
        {
            var now = DateTimeOffset.UtcNow;
            var result = new List<DomainOverviewDto>();
            foreach (var d in registry.All.Where(d => d.Enabled))
            {
                var id = d.Id;
                var compliance = await PrivilegedEndpoints.ComplianceAsync(db, now, id, ct);
                var audit = await db.Runs.AsNoTracking().Where(r => r.DomainId == id && r.Kind == RunKind.Audit && r.FinishedAt != null && r.Status != RunStatus.Cancelled)
                    .OrderByDescending(r => r.Id).Select(r => new DomainRunInfoDto(r.Id, r.Status, r.FinishedAt, r.DriftCount)).FirstOrDefaultAsync(ct);
                var monitor = await db.Runs.AsNoTracking().Where(r => r.DomainId == id && r.Kind == RunKind.Monitor && r.FinishedAt != null && r.Status != RunStatus.Cancelled)
                    .OrderByDescending(r => r.Id).Select(r => new DomainRunInfoDto(r.Id, r.Status, r.FinishedAt, r.DriftCount)).FirstOrDefaultAsync(ct);
                var pending = await db.Runs.CountAsync(r => r.DomainId == id && r.Status == RunStatus.AwaitingApproval, ct);
                var active = await db.Runs.CountAsync(r => r.DomainId == id && (r.Status == RunStatus.Queued || r.Status == RunStatus.Running), ct);
                var sample = !await db.ConfigVersions.AnyAsync(v => v.DomainId == id && v.CreatedBy != "system", ct);
                result.Add(new DomainOverviewDto(d.Id, d.Key, d.DisplayName, d.DnsName, d.Enabled, d.IsDefault, compliance.Current, audit, monitor, pending, active, sample));
            }
            return result;
        });

        var admin = api.MapGroup("/").RequireAuthorization(nameof(Role.Admin));

        admin.MapPost("/", async (DomainInput r, HttpContext ctx, AppDbContext db, DomainRegistry registry, ConfigService config, ChangeLogService log, CancellationToken ct) =>
        {
            var input = Normalize(r);
            if (await ValidateAsync(input, null, db, ct) is { Count: > 0 } errors) return Results.ValidationProblem(errors);
            if (!input.Enabled && input.IsDefault) return Results.ValidationProblem(new Dictionary<string, string[]> { ["enabled"] = ["Die Standard-Domäne kann nicht deaktiviert sein."] });
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            if (input.IsDefault) await db.Domains.Where(d => d.IsDefault).ExecuteUpdateAsync(u => u.SetProperty(d => d.IsDefault, false), ct);
            var domain = new Domain
            {
                Key = input.Key!, DisplayName = input.DisplayName!, DnsName = input.DnsName ?? "", PreferredDc = input.PreferredDc ?? "",
                AdmlLanguage = input.AdmlLanguage!, Enabled = input.Enabled, IsDefault = input.IsDefault, Notes = input.Notes, CreatedAt = DateTimeOffset.UtcNow,
            };
            db.Domains.Add(domain);
            await db.SaveChangesAsync(ct);
            log.Add(ctx.User.UserName(), "domain.create", "domain", domain.Id.ToString(), $"Domäne „{domain.DisplayName}“ ({domain.Key}) angelegt: {Describe(domain)}",
                new { domain = domain.Key });
            await db.SaveChangesAsync(ct);
            await registry.ReloadAsync(db, ct);
            // A new domain starts with the shipped sample configuration, like the first one; the setup wizard adapts it.
            await config.SeedDomainAsync(domain.Id, ct);
            await tx.CommitAsync(ct);
            await registry.ReloadAsync(db, ct);
            return Results.Json(DomainDto.From(domain), Endpoints.JsonDefaults.Options, statusCode: 201);
        });

        admin.MapPut("/{id:int}", async (int id, DomainInput r, HttpContext ctx, AppDbContext db, DomainRegistry registry, ChangeLogService log, CancellationToken ct) =>
        {
            var domain = await db.Domains.FirstOrDefaultAsync(d => d.Id == id, ct);
            if (domain is null) return Results.NotFound();
            var input = Normalize(r);
            if (await ValidateAsync(input, id, db, ct) is { Count: > 0 } errors) return Results.ValidationProblem(errors);
            if (domain.IsDefault && !input.IsDefault)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["isDefault"] = ["Bitte eine andere Domäne zur Standard-Domäne machen."] });
            if ((domain.IsDefault || input.IsDefault) && !input.Enabled)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["enabled"] = ["Die Standard-Domäne kann nicht deaktiviert werden."] });
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            if (input.IsDefault && !domain.IsDefault)
                await db.Domains.Where(d => d.IsDefault).ExecuteUpdateAsync(u => u.SetProperty(d => d.IsDefault, false), ct);
            var oldKey = domain.Key;
            domain.Key = input.Key!;
            domain.DisplayName = input.DisplayName!;
            domain.DnsName = input.DnsName ?? "";
            domain.PreferredDc = input.PreferredDc ?? "";
            domain.AdmlLanguage = input.AdmlLanguage!;
            domain.Enabled = input.Enabled;
            domain.IsDefault = input.IsDefault;
            domain.Notes = input.Notes;
            log.Add(ctx.User.UserName(), "domain.update", "domain", id.ToString(),
                $"Domäne „{domain.DisplayName}“ ({domain.Key}) geändert: {Describe(domain)}" + (oldKey != domain.Key ? $" – Kurzname vorher {oldKey}" : ""),
                new { domain = domain.Key, previousKey = oldKey == domain.Key ? null : oldKey });
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            await registry.ReloadAsync(db, ct);
            return Results.Json(DomainDto.From(domain), Endpoints.JsonDefaults.Options);
        });

        admin.MapGet("/{id:int}/deletion", async (int id, AppDbContext db, CancellationToken ct) =>
        {
            if (await db.Domains.AsNoTracking().FirstOrDefaultAsync(d => d.Id == id, ct) is not { } domain) return Results.NotFound();
            var reason = await DeletionBlockerAsync(domain, db, ct);
            return Results.Ok(new DomainDeletionDto(reason is null, reason));
        });

        // Only a domain without history can be deleted; otherwise it is disabled (the runs and the change log stay readable).
        admin.MapDelete("/{id:int}", async (int id, HttpContext ctx, AppDbContext db, DomainRegistry registry, ChangeLogService log, CancellationToken ct) =>
        {
            var domain = await db.Domains.FirstOrDefaultAsync(d => d.Id == id, ct);
            if (domain is null) return Results.NotFound();
            if (await DeletionBlockerAsync(domain, db, ct) is { } reason)
                return Results.Problem(title: "Die Domäne kann nicht gelöscht werden", detail: reason, statusCode: 409);
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            await db.ConfigVersions.Where(v => v.DomainId == id).ExecuteDeleteAsync(ct);
            await db.ConfigSections.Where(s => s.DomainId == id).ExecuteDeleteAsync(ct);
            foreach (var w in await db.MaintenanceWindows.Where(w => w.DomainIds.Contains(id)).ToListAsync(ct))
                w.DomainIds = w.DomainIds.Where(x => x != id).ToArray();
            foreach (var f in await db.FreezePeriods.Where(f => f.DomainIds.Contains(id)).ToListAsync(ct))
                f.DomainIds = f.DomainIds.Where(x => x != id).ToArray();
            db.Domains.Remove(domain);
            log.Add(ctx.User.UserName(), "domain.delete", "domain", id.ToString(), $"Domäne „{domain.DisplayName}“ ({domain.Key}) gelöscht", new { domain = domain.Key });
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            await registry.ReloadAsync(db, ct);
            return Results.NoContent();
        });

        admin.MapPost("/check", async (DomainCheckRequest r, DirectoryService directories, CancellationToken ct) =>
        {
            var dns = r.DnsName?.Trim() ?? "";
            var dc = r.PreferredDc?.Trim() ?? "";
            var errors = new Dictionary<string, string[]>();
            if (dns.Length > 0 && !DomainRules.IsHostName(dns)) errors["dnsName"] = ["Ungültiger DNS-Name."];
            if (dc.Length > 0 && !DomainRules.IsHostName(dc)) errors["preferredDc"] = ["Ungültiger Hostname."];
            if (dns.Length == 0 && dc.Length == 0) errors["dnsName"] = ["DNS-Name oder Domänencontroller angeben."];
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            var reader = directories.Probe(new DirectoryTarget(dns, dc));
            if (!reader.Available)
                return Results.Ok(new DomainCheckDto(false, OperatingSystem.IsWindows()
                    ? $"Die Domäne ist über {(dc.Length > 0 ? dc : dns)} nicht erreichbar oder das Dienstkonto hat keinen Lesezugriff."
                    : "Die Prüfung ist nur möglich, wenn der Dienst auf einem Windows-Server in einer Domäne läuft.", reader.Source, null));
            try
            {
                var info = await Task.Run(reader.DomainInfo, ct);
                var mismatch = dns.Length > 0 && !string.Equals(info.DnsName, dns, StringComparison.OrdinalIgnoreCase)
                    ? $" Achtung: Der Domänencontroller gehört zu {info.DnsName}, nicht zu {dns}." : "";
                return Results.Ok(new DomainCheckDto(mismatch.Length == 0,
                    $"Verbindung hergestellt: {info.DnsName} ({info.NetBiosName}), Gesamtstruktur {info.ForestName}, {info.DomainControllers.Count} Domänencontroller.{mismatch}",
                    reader.Source, info));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                return Results.Ok(new DomainCheckDto(false, $"Verbindung fehlgeschlagen: {ex.Message}", reader.Source, null));
            }
        });
    }

    private static DomainInput Normalize(DomainInput r) => r with
    {
        Key = r.Key?.Trim().ToLowerInvariant(),
        DisplayName = r.DisplayName?.Trim(),
        DnsName = string.IsNullOrWhiteSpace(r.DnsName) ? DomainRules.DnsFromDc(r.PreferredDc) : r.DnsName.Trim().TrimEnd('.').ToLowerInvariant(),
        PreferredDc = r.PreferredDc?.Trim(),
        AdmlLanguage = string.IsNullOrWhiteSpace(r.AdmlLanguage) ? "en-US" : r.AdmlLanguage.Trim(),
        Notes = string.IsNullOrWhiteSpace(r.Notes) ? null : r.Notes.Trim(),
    };

    private static async Task<Dictionary<string, string[]>> ValidateAsync(DomainInput r, int? id, AppDbContext db, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();
        if (DomainRules.KeyError(r.Key) is { } keyError) errors["key"] = [keyError];
        else if (await db.Domains.AnyAsync(d => d.Key == r.Key && d.Id != (id ?? 0), ct)) errors["key"] = ["Dieser Kurzname wird bereits verwendet."];
        if (string.IsNullOrWhiteSpace(r.DisplayName) || r.DisplayName.Length > 100) errors["displayName"] = ["Bitte einen Anzeigenamen (max. 100 Zeichen) angeben."];
        else if (await db.Domains.AnyAsync(d => d.DisplayName == r.DisplayName && d.Id != (id ?? 0), ct)) errors["displayName"] = ["Dieser Anzeigename wird bereits verwendet."];
        if (!string.IsNullOrEmpty(r.DnsName) && (!DomainRules.IsHostName(r.DnsName) || !r.DnsName.Contains('.')))
            errors["dnsName"] = ["Vollständigen DNS-Namen angeben, z. B. contoso.com."];
        // Optional (the first domain may have none, as the former setting); runs then name their DC themselves.
        if (!string.IsNullOrWhiteSpace(r.PreferredDc) && RunValidation.ValidateMonitor(new RunRequest(r.PreferredDc, null, false, false, false, false, null)).ContainsKey("preferredDc"))
            errors["preferredDc"] = ["Ungültiger Hostname."];
        if (RunValidation.Validate(new RunRequest("dc", DeployScope.FullDeployment, false, false, false, false, r.AdmlLanguage)).ContainsKey("admlLanguage"))
            errors["admlLanguage"] = ["Sprache im Format xx-XX angeben (z. B. en-US)."];
        if (r.Notes is { Length: > 1000 }) errors["notes"] = ["Höchstens 1000 Zeichen."];
        return errors;
    }

    private static string Describe(Domain d) =>
        $"DNS {(d.DnsName.Length == 0 ? "–" : d.DnsName)}, DC {d.PreferredDc}, ADML {d.AdmlLanguage}{(d.Enabled ? "" : ", deaktiviert")}{(d.IsDefault ? ", Standard" : "")}";

    /// <summary>Why a domain cannot be deleted (German), or null.</summary>
    public static async Task<string?> DeletionBlockerAsync(Domain domain, AppDbContext db, CancellationToken ct)
    {
        var id = domain.Id;
        if (domain.IsDefault) return "Die Standard-Domäne kann nicht gelöscht werden.";
        if (id == 1) return "Die erste Domäne enthält die Daten aus der Zeit vor mehreren Domänen und kann nur deaktiviert werden.";
        if (await db.Runs.AnyAsync(r => r.DomainId == id, ct)) return "Für die Domäne gibt es Läufe. Sie kann nur deaktiviert werden, damit die Historie erhalten bleibt.";
        if (await db.Schedules.AnyAsync(s => s.DomainId == id, ct)) return "Für die Domäne gibt es Zeitpläne. Bitte zuerst löschen oder die Domäne deaktivieren.";
        if (await db.JitGroups.AnyAsync(g => g.DomainId == id, ct) || await db.JitRequests.AnyAsync(r => r.DomainId == id, ct))
            return "Für die Domäne gibt es JIT-Gruppen oder -Anträge. Sie kann nur deaktiviert werden.";
        if (await db.ConfigVersions.AnyAsync(v => v.DomainId == id && v.CreatedBy != "system", ct))
            return "Die Konfiguration der Domäne wurde bereits bearbeitet. Sie kann nur deaktiviert werden.";
        return null;
    }
}
