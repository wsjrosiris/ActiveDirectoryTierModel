using Microsoft.AspNetCore.DataProtection;
using System.Text.Json;
using TierModel.Service.Auth;
using TierModel.Service.Data;
using TierModel.Service.GitSync;
using TierModel.Service.Localization;

namespace TierModel.Service.Transfer;

public record FilePreviewQuery(string? FileName);

/// <param name="RemoteDomain">Domain of the other instance to import from (roadmap 17); null = its default domain.</param>
public record RemotePreviewRequest(Guid InstanceId, List<ReplacementRule>? Replacements, string? RemoteDomain = null);

public record ValidateSelectionRequest(List<string>? Keys);

public record ReplacementsRequest(List<ReplacementRule>? Replacements);

/// <summary>Import (roadmap 15) and Git settings (roadmap 16) endpoints.</summary>
public static class TransferEndpoints
{
    public const string RemoteInstancesKey = "remoteInstances";

    public static void AddTransfer(IServiceCollection services)
    {
        services.AddScoped<ImportService>();
        services.AddScoped<RemoteConfigClient>();
        services.AddHttpClient(RemoteConfigClient.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(30))
            .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { AllowAutoRedirect = false });
        services.AddSingleton<GitSyncQueue>();
        services.AddSingleton<GitSyncStatus>();
        services.AddScoped<GitSyncService>();
    }

    public static void MapTransferEndpoints(this IEndpointRouteBuilder app)
    {
        var imp = app.MapGroup("/api/config/import").RequireAuthorization(nameof(Role.Editor));

        // Raw ZIP body (Content-Type application/zip); the file name only labels the source.
        imp.MapPost("/file", async (HttpContext ctx, string? fileName, ImportService import) =>
        {
            if (ctx.Request.ContentLength > ConfigArchive.MaxArchiveBytes)
                return Results.Problem(title: L.F("Die Datei ist zu groß (höchstens {0} MB).", ConfigArchive.MaxArchiveBytes >> 20), statusCode: 413);
            var buffer = new MemoryStream();
            var chunk = new byte[81920];
            int read;
            while ((read = await ctx.Request.Body.ReadAsync(chunk, ctx.RequestAborted)) > 0)
            {
                buffer.Write(chunk, 0, read);
                if (buffer.Length > ConfigArchive.MaxArchiveBytes)
                    return Results.Problem(title: L.F("Die Datei ist zu groß (höchstens {0} MB).", ConfigArchive.MaxArchiveBytes >> 20), statusCode: 413);
            }
            if (buffer.Length == 0) return Results.Problem(title: L.T("Keine Datei übertragen."), statusCode: 400);
            buffer.Position = 0;
            var label = string.IsNullOrWhiteSpace(fileName) ? L.P("Datei") : L.PF("Datei {0}", Path.GetFileName(fileName.Trim()));
            if (label.Length > 150) label = label[..150];
            try
            {
                var source = ConfigArchive.Read(buffer, label);
                return Results.Ok(await import.CreatePreviewAsync(source, "file", [], ctx.User.UserName(), ctx.RequestAborted));
            }
            catch (ImportFormatException ex)
            {
                return Results.Problem(title: ex.Message, statusCode: 400);
            }
        });

        imp.MapPost("/remote", async (RemotePreviewRequest r, HttpContext ctx, SettingsService settings, RemoteConfigClient client, ImportService import) =>
        {
            var (rules, ruleError) = ImportService.NormalizeRules(r.Replacements);
            if (ruleError is not null) return Results.Problem(title: ruleError, statusCode: 400);
            var instances = await LoadInstancesAsync(settings, ctx.RequestAborted);
            if (instances.FirstOrDefault(i => i.Id == r.InstanceId) is not { } instance) return Results.NotFound();
            string token;
            try
            {
                token = settings.Secrets.Unprotect(instance.TokenProtected);
            }
            catch (System.Security.Cryptography.CryptographicException)
            {
                return Results.Problem(title: L.T("Das gespeicherte Token ist nicht mehr lesbar. Bitte die Instanz neu anlegen."), statusCode: 400);
            }
            try
            {
                var label = string.IsNullOrWhiteSpace(r.RemoteDomain) ? L.PF("Instanz {0}", instance.Name) : L.PF("Instanz {0} (Domäne {1})", instance.Name, r.RemoteDomain.Trim());
                var source = await client.FetchAsync(label, instance.Url, token, ctx.RequestAborted, r.RemoteDomain);
                return Results.Ok(await import.CreatePreviewAsync(source, "remote", rules, ctx.User.UserName(), ctx.RequestAborted));
            }
            catch (RemoteImportException ex)
            {
                return Results.Problem(title: L.T("Abruf von der Instanz fehlgeschlagen"), detail: ex.Message, statusCode: 502);
            }
        });

        imp.MapGet("/{id:guid}", async (Guid id, ImportService import, CancellationToken ct) =>
        {
            try { return Results.Ok(await import.GetPreviewAsync(id, ct)); }
            catch (ImportPreviewNotFoundException ex) { return Results.Problem(title: ex.Message, statusCode: 404); }
        });

        imp.MapPost("/{id:guid}/replacements", async (Guid id, ReplacementsRequest r, HttpContext ctx, ImportService import) =>
        {
            var (rules, ruleError) = ImportService.NormalizeRules(r.Replacements);
            if (ruleError is not null) return Results.Problem(title: ruleError, statusCode: 400);
            try { return Results.Ok(await import.RecomputeAsync(id, rules, ctx.User.UserName(), ctx.RequestAborted)); }
            catch (ImportPreviewNotFoundException ex) { return Results.Problem(title: ex.Message, statusCode: 404); }
        });

        imp.MapPost("/{id:guid}/validate", async (Guid id, ValidateSelectionRequest r, ImportService import, CancellationToken ct) =>
        {
            try { return Results.Ok(await import.ValidateAsync(id, r.Keys ?? [], ct)); }
            catch (ImportPreviewNotFoundException ex) { return Results.Problem(title: ex.Message, statusCode: 404); }
        });

        imp.MapPost("/{id:guid}/apply", async (Guid id, ImportApplyRequest r, HttpContext ctx, ImportService import) =>
        {
            try
            {
                return Results.Ok(await import.ApplyAsync(id, r, ctx.User.UserName(), ctx.RequestAborted));
            }
            catch (ImportPreviewNotFoundException ex)
            {
                return Results.Problem(title: ex.Message, statusCode: 404);
            }
            catch (ImportConflictException ex)
            {
                return Results.Problem(title: L.T("Konflikt: Die Konfiguration wurde inzwischen geändert"), detail: ex.Message, statusCode: 409,
                    extensions: new Dictionary<string, object?> { ["sections"] = ex.Keys });
            }
            catch (ArgumentException ex)
            {
                return Results.Problem(title: ex.Message, statusCode: 400);
            }
        });

        // ---- remote instances: Editors use them, Administrators manage them (the token is a secret of the other instance).
        var inst = app.MapGroup("/api/config/remote-instances").RequireAuthorization(nameof(Role.Editor));

        inst.MapGet("", async (SettingsService settings, CancellationToken ct) =>
            (await LoadInstancesAsync(settings, ct)).Select(RemoteInstanceDto.From));

        inst.MapPost("", async (RemoteInstanceInput r, HttpContext ctx, SettingsService settings, ChangeLogService log, AppDbContext db, IHostEnvironment env) =>
        {
            var errors = ValidateInstance(r, env.IsDevelopment(), requireToken: true);
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            var list = await LoadInstancesAsync(settings, ctx.RequestAborted);
            if (list.Count >= 20) return Results.Problem(title: L.T("Höchstens 20 Instanzen."), statusCode: 400);
            var token = r.Token!.Trim();
            var item = new RemoteInstance(Guid.NewGuid(), r.Name!.Trim(), RemoteConfigClient.NormalizeUrl(r.Url!), settings.Secrets.Protect(token),
                RemoteConfigClient.TokenHint(token), DateTimeOffset.UtcNow, ctx.User.UserName());
            list.Add(item);
            await SaveInstancesAsync(settings, list, ctx.RequestAborted);
            log.Add(ctx.User.UserName(), "settings.remote-instance", "settings", item.Id.ToString(), L.PF("Instanz für Import angelegt: {0} ({1})", item.Name, item.Url));
            await db.SaveChangesAsync();
            return Results.Ok(RemoteInstanceDto.From(item));
        }).RequireAuthorization(nameof(Role.Admin));

        inst.MapPut("/{id:guid}", async (Guid id, RemoteInstanceInput r, HttpContext ctx, SettingsService settings, ChangeLogService log, AppDbContext db, IHostEnvironment env) =>
        {
            var errors = ValidateInstance(r, env.IsDevelopment(), requireToken: false);
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            var list = await LoadInstancesAsync(settings, ctx.RequestAborted);
            var idx = list.FindIndex(i => i.Id == id);
            if (idx < 0) return Results.NotFound();
            var token = r.Token?.Trim();
            var item = list[idx] with
            {
                Name = r.Name!.Trim(), Url = RemoteConfigClient.NormalizeUrl(r.Url!),
                TokenProtected = string.IsNullOrEmpty(token) ? list[idx].TokenProtected : settings.Secrets.Protect(token),
                TokenHint = string.IsNullOrEmpty(token) ? list[idx].TokenHint : RemoteConfigClient.TokenHint(token),
                LastCheckedAt = null, LastCheckOk = null, LastCheckMessage = null,
            };
            list[idx] = item;
            await SaveInstancesAsync(settings, list, ctx.RequestAborted);
            log.Add(ctx.User.UserName(), "settings.remote-instance", "settings", id.ToString(),
                L.PF("Instanz für Import geändert: {0} ({1}){2}", item.Name, item.Url, (string.IsNullOrEmpty(token) ? "" : L.P(", neues Token"))));
            await db.SaveChangesAsync();
            return Results.Ok(RemoteInstanceDto.From(item));
        }).RequireAuthorization(nameof(Role.Admin));

        inst.MapDelete("/{id:guid}", async (Guid id, HttpContext ctx, SettingsService settings, ChangeLogService log, AppDbContext db) =>
        {
            var list = await LoadInstancesAsync(settings, ctx.RequestAborted);
            var item = list.FirstOrDefault(i => i.Id == id);
            if (item is null) return Results.NotFound();
            list.Remove(item);
            await SaveInstancesAsync(settings, list, ctx.RequestAborted);
            log.Add(ctx.User.UserName(), "settings.remote-instance", "settings", id.ToString(), L.PF("Instanz für Import entfernt: {0}", item.Name));
            await db.SaveChangesAsync();
            return Results.NoContent();
        }).RequireAuthorization(nameof(Role.Admin));

        // "Verbindung prüfen": a saved instance, or unsaved form values (token optional when editing a saved instance).
        inst.MapPost("/check", async (RemoteCheckRequest r, HttpContext ctx, SettingsService settings, RemoteConfigClient client, IHostEnvironment env) =>
        {
            var list = await LoadInstancesAsync(settings, ctx.RequestAborted);
            var saved = r.Id is { } id ? list.FirstOrDefault(i => i.Id == id) : null;
            if (r.Id is not null && saved is null) return Results.NotFound();
            var url = string.IsNullOrWhiteSpace(r.Url) ? saved?.Url : r.Url;
            if (RemoteConfigClient.UrlError(url, env.IsDevelopment()) is { } urlError) return Results.Ok(new RemoteCheckResult(false, urlError, null));
            string? token = string.IsNullOrWhiteSpace(r.Token) ? null : r.Token.Trim();
            if (token is null && saved is not null)
            {
                try { token = settings.Secrets.Unprotect(saved.TokenProtected); }
                catch (System.Security.Cryptography.CryptographicException) { return Results.Ok(new RemoteCheckResult(false, L.T("Das gespeicherte Token ist nicht mehr lesbar."), null)); }
            }
            if (token is null) return Results.Ok(new RemoteCheckResult(false, L.T("Bitte ein API-Token angeben."), null));
            var result = await client.CheckAsync(url!, token, ctx.RequestAborted);
            if (saved is not null && string.IsNullOrWhiteSpace(r.Url) && string.IsNullOrWhiteSpace(r.Token))
            {
                var idx = list.IndexOf(saved);
                list[idx] = saved with { LastCheckedAt = DateTimeOffset.UtcNow, LastCheckOk = result.Ok, LastCheckMessage = result.Message };
                await SaveInstancesAsync(settings, list, ctx.RequestAborted);
            }
            return Results.Ok(result);
        });

        // ---- Git (roadmap 16), Admin only.
        var git = app.MapGroup("/api/settings/git").RequireAuthorization(nameof(Role.Admin));

        git.MapGet("", (GitSyncService g, CancellationToken ct) => g.GetDtoAsync(ct));

        git.MapPut("", async (GitSettingsInput r, HttpContext ctx, GitSyncService g, SettingsService settings, GitSyncQueue queue, ChangeLogService log, AppDbContext db) =>
        {
            var errors = g.Validate(r);
            var before = await g.GetSettingsAsync(ctx.RequestAborted);
            var password = r.ClearPassword == true ? null
                : string.IsNullOrEmpty(r.Password) ? before.PasswordProtected : settings.Secrets.Protect(r.Password);
            if (errors.Count > 0) return Results.ValidationProblem(errors);
            var next = new GitSettings(r.Enabled, r.RepositoryUrl?.Trim() ?? "", r.Branch!.Trim(), r.Username?.Trim() ?? "", password,
                r.AuthorName?.Trim() ?? "", r.AuthorEmail?.Trim() ?? "", GitRepositorySync.NormalizeRepoPath(r.PathInRepo)!, r.PushOnSave);
            await g.SaveSettingsAsync(next, ctx.RequestAborted);
            var target = next with { PasswordProtected = null } != before with { PasswordProtected = null } || next.PasswordProtected != before.PasswordProtected;
            var remoteChanged = next.RepositoryUrl != before.RepositoryUrl || next.Branch != before.Branch || next.PathInRepo != before.PathInRepo;
            if (remoteChanged)
                await g.SaveStateAsync(new GitSyncState(), ctx.RequestAborted); // new target: start over with an initial full sync
            if (next.Enabled && (remoteChanged || !before.Enabled || target)) queue.Enqueue(new GitSyncRequest(GitSyncKind.Full, RequestedBy: ctx.User.UserName()));
            log.Add(ctx.User.UserName(), "settings.git", "settings", null,
                L.PF("Git-Anbindung {0}: {1} ({2}, Ordner {3})", next.Enabled ? L.P("EIN") : L.P("AUS"), string.IsNullOrEmpty(next.RepositoryUrl) ? "–" : next.RepositoryUrl, next.Branch, next.PathInRepo)
                + (r.ClearPassword == true ? L.P(", Token entfernt") : !string.IsNullOrEmpty(r.Password) ? L.P(", Token geändert") : ""));
            await db.SaveChangesAsync();
            return Results.Ok(await g.GetDtoAsync(ctx.RequestAborted));
        });

        git.MapPost("/sync", async (HttpContext ctx, GitSyncService g, GitSyncQueue queue, ChangeLogService log, AppDbContext db) =>
        {
            var s = await g.GetSettingsAsync(ctx.RequestAborted);
            if (!s.Enabled) return Results.Problem(title: L.T("Die Git-Anbindung ist ausgeschaltet."), statusCode: 400);
            if ((await g.GetStateAsync(ctx.RequestAborted)).Conflict)
                return Results.Problem(title: L.T("Konflikt ungelöst"), detail: L.T("Zuerst „Remote übernehmen“ ausführen."), statusCode: 409);
            queue.Enqueue(new GitSyncRequest(GitSyncKind.Full, RequestedBy: ctx.User.UserName()));
            log.Add(ctx.User.UserName(), "settings.git-sync", "settings", null, L.P("Git: Synchronisierung angestoßen"));
            await db.SaveChangesAsync();
            return Results.Accepted();
        });

        git.MapPost("/resolve", async (HttpContext ctx, GitSyncService g, GitSyncQueue queue, ChangeLogService log, AppDbContext db) =>
        {
            var s = await g.GetSettingsAsync(ctx.RequestAborted);
            if (!s.Enabled) return Results.Problem(title: L.T("Die Git-Anbindung ist ausgeschaltet."), statusCode: 400);
            queue.Enqueue(new GitSyncRequest(GitSyncKind.TakeRemote, RequestedBy: ctx.User.UserName()));
            log.Add(ctx.User.UserName(), "settings.git-resolve", "settings", null, L.P("Git: Remote übernommen, lokaler Stand verworfen und neu exportiert"));
            await db.SaveChangesAsync();
            return Results.Accepted();
        });
    }

    public record RemoteCheckRequest(Guid? Id, string? Url, string? Token);

    private static Dictionary<string, string[]> ValidateInstance(RemoteInstanceInput r, bool allowHttp, bool requireToken)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(r.Name) || r.Name.Trim().Length > 100) errors["name"] = [L.T("Namen angeben (höchstens 100 Zeichen).")];
        if (RemoteConfigClient.UrlError(r.Url, allowHttp) is { } e) errors["url"] = [e];
        var token = r.Token?.Trim();
        if (requireToken && string.IsNullOrEmpty(token)) errors["token"] = [L.T("API-Token der anderen Instanz angeben.")];
        else if (!string.IsNullOrEmpty(token) && ApiTokens.ParsePrefix(token) is null) errors["token"] = [L.T("Kein gültiges API-Token (Format tmk_…).")];
        return errors;
    }

    public static async Task<List<RemoteInstance>> LoadInstancesAsync(SettingsService settings, CancellationToken ct)
    {
        var json = await settings.GetValueAsync(RemoteInstancesKey, ct);
        return json is null ? [] : JsonSerializer.Deserialize<List<RemoteInstance>>(json, JsonSerializerOptions.Web) ?? [];
    }

    private static Task SaveInstancesAsync(SettingsService settings, List<RemoteInstance> list, CancellationToken ct) =>
        settings.SetValueAsync(RemoteInstancesKey, JsonSerializer.Serialize(list, JsonSerializerOptions.Web), ct);
}
