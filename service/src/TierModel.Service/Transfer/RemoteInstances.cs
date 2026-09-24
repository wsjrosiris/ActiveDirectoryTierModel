using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;
using TierModel.Service.Config;
using TierModel.Service.Localization;

namespace TierModel.Service.Transfer;

/// <summary>Stored form of another TierModel instance (settings key <c>remoteInstances</c>); the token is encrypted.</summary>
public record RemoteInstance(Guid Id, string Name, string Url, string TokenProtected, string TokenHint, DateTimeOffset CreatedAt, string CreatedBy,
    DateTimeOffset? LastCheckedAt = null, bool? LastCheckOk = null, string? LastCheckMessage = null);

public record RemoteInstanceDto(Guid Id, string Name, string Url, string TokenHint, DateTimeOffset CreatedAt, string CreatedBy,
    DateTimeOffset? LastCheckedAt, bool? LastCheckOk, string? LastCheckMessage)
{
    public static RemoteInstanceDto From(RemoteInstance r) =>
        new(r.Id, r.Name, r.Url, r.TokenHint, r.CreatedAt, r.CreatedBy, r.LastCheckedAt, r.LastCheckOk, r.LastCheckMessage);
}

public record RemoteInstanceInput(string? Name, string? Url, string? Token);

/// <param name="Domains">Domains of the other instance (roadmap 17); empty for instances without several domains.</param>
public record RemoteCheckResult(bool Ok, string Message, int? SectionCount, List<RemoteDomain>? Domains = null);

public record RemoteDomain(string Key, string DisplayName, string DnsName, bool IsDefault);

public class RemoteImportException(string message) : Exception(message);

/// <summary>Pulls the configuration of another TierModel instance over its API with a personal API token (Bearer tmk_…).</summary>
public class RemoteConfigClient(IHttpClientFactory httpFactory)
{
    public const string HttpClientName = "remote-instances";
    private const int MaxSections = 100;

    /// <summary>
    /// Null when <paramref name="url"/> is usable: https (plain http only when <paramref name="allowHttp"/>, i.e. in development),
    /// no credentials, query or fragment in the address.
    /// </summary>
    public static string? UrlError(string? url, bool allowHttp)
    {
        if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url.Trim(), UriKind.Absolute, out var u))
            return L.T("Vollständige Adresse angeben, z. B. https://tiermodel-test.contoso.com");
        if (u.Scheme != Uri.UriSchemeHttps && !(allowHttp && u.Scheme == Uri.UriSchemeHttp))
            return L.T("Nur https-Adressen sind erlaubt.");
        if (!string.IsNullOrEmpty(u.UserInfo) || !string.IsNullOrEmpty(u.Query) || !string.IsNullOrEmpty(u.Fragment))
            return L.T("Die Adresse darf weder Zugangsdaten noch Parameter enthalten.");
        return null;
    }

    public static string NormalizeUrl(string url) => url.Trim().TrimEnd('/');

    public static string TokenHint(string token) => token.Length > 12 ? token[..12] + "…" : "…";

    public async Task<RemoteCheckResult> CheckAsync(string url, string token, CancellationToken ct, string? remoteDomain = null)
    {
        try
        {
            var list = await GetSectionListAsync(url, token, ct, remoteDomain);
            var domains = await GetDomainsAsync(url, token, ct);
            return new RemoteCheckResult(true, L.F("Verbindung erfolgreich – {0} Bereiche lesbar", list.Count)
                + (domains.Count > 1 ? L.F(", {0} Domänen.", domains.Count) : "."), list.Count, domains);
        }
        catch (RemoteImportException ex)
        {
            return new RemoteCheckResult(false, ex.Message, null);
        }
    }

    /// <summary>Reads every section of the remote instance. Sections the remote has but this version does not know are reported as unknown.</summary>
    /// <param name="remoteDomain">Key of a domain of the other instance (header X-TierModel-Domain); null = its default domain.</param>
    public async Task<ImportSource> FetchAsync(string name, string url, string token, CancellationToken ct, string? remoteDomain = null)
    {
        var list = await GetSectionListAsync(url, token, ct, remoteDomain);
        var sections = new Dictionary<string, string>();
        var versions = new Dictionary<string, int>();
        var unknown = new List<string>();
        var invalid = new Dictionary<string, string>();
        foreach (var (key, version) in list)
        {
            var def = ConfigCatalog.Find(key);
            if (def is null)
            {
                unknown.Add(key);
                continue;
            }
            var node = await GetJsonAsync(url, token, $"/api/config/sections/{Uri.EscapeDataString(def.Key)}", ct, remoteDomain);
            var content = node?["content"];
            if (content is not JsonObject)
            {
                invalid[def.Key] = L.T("Die Gegenstelle lieferte keinen gültigen Inhalt.");
                continue;
            }
            sections[def.Key] = ConfigService.Serialize(content);
            versions[def.Key] = node?["version"] is JsonValue v && v.TryGetValue<int>(out var n) ? n : version;
        }
        var notices = new List<string>();
        if (unknown.Count > 0) notices.Add(L.F("{0} unbekannte(r) Bereich(e) der Gegenstelle ignoriert: {1}", unknown.Count, string.Join(", ", unknown)));
        return new ImportSource(name, sections, versions, unknown, invalid, notices);
    }

    /// <summary>Domains of the other instance; empty when it has no /api/domains (older version).</summary>
    private async Task<List<RemoteDomain>> GetDomainsAsync(string url, string token, CancellationToken ct)
    {
        try
        {
            if (await GetJsonAsync(url, token, "/api/domains", ct) is not JsonArray arr) return [];
            return arr.OfType<JsonObject>().Select(o => new RemoteDomain(o["key"]?.ToString() ?? "", o["displayName"]?.ToString() ?? "", o["dnsName"]?.ToString() ?? "",
                o["isDefault"] is JsonValue v && v.TryGetValue<bool>(out var b) && b)).Where(d => d.Key.Length > 0).Take(100).ToList();
        }
        catch (RemoteImportException)
        {
            return [];
        }
    }

    private async Task<List<(string Key, int Version)>> GetSectionListAsync(string url, string token, CancellationToken ct, string? remoteDomain = null)
    {
        var node = await GetJsonAsync(url, token, "/api/config/sections", ct, remoteDomain);
        if (node is not JsonArray arr) throw new RemoteImportException(L.T("Die Gegenstelle ist keine TierModel-Instanz (unerwartete Antwort)."));
        if (arr.Count > MaxSections) throw new RemoteImportException(L.T("Die Gegenstelle meldet zu viele Bereiche."));
        return arr.OfType<JsonObject>()
            .Select(o => (Key: o["key"]?.GetValue<string>() ?? "", Version: o["version"] is JsonValue v && v.TryGetValue<int>(out var n) ? n : 0))
            .Where(x => x.Key.Length > 0)
            .ToList();
    }

    private async Task<JsonNode?> GetJsonAsync(string baseUrl, string token, string path, CancellationToken ct, string? remoteDomain = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, NormalizeUrl(baseUrl) + path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (!string.IsNullOrWhiteSpace(remoteDomain)) request.Headers.Add(Domains.DomainRules.Header, remoteDomain.Trim());
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        HttpResponseMessage response;
        try
        {
            response = await httpFactory.CreateClient(HttpClientName).SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new RemoteImportException(L.T("Zeitüberschreitung – die Gegenstelle antwortet nicht."));
        }
        catch (HttpRequestException ex)
        {
            throw new RemoteImportException(L.F("Verbindung fehlgeschlagen: {0}", Redact(ex.GetBaseException().Message, token)));
        }
        using (response)
        {
            switch (response.StatusCode)
            {
                case HttpStatusCode.Unauthorized:
                    throw new RemoteImportException(L.T("Das API-Token wurde abgelehnt (ungültig, abgelaufen oder widerrufen)."));
                case HttpStatusCode.Forbidden:
                    throw new RemoteImportException(L.T("Das API-Token hat keine Leseberechtigung für die Konfiguration."));
                case HttpStatusCode.NotFound:
                    throw new RemoteImportException(L.T("Die Adresse ist keine TierModel-Instanz (404)."));
                case HttpStatusCode.BadRequest when !string.IsNullOrWhiteSpace(remoteDomain):
                    throw new RemoteImportException(L.F("Die Gegenstelle kennt die Domäne „{0}“ nicht.", remoteDomain));
            }
            if (!response.IsSuccessStatusCode)
                throw new RemoteImportException(L.F("Die Gegenstelle antwortete mit Fehler {0}.", (int)response.StatusCode));
            if (response.Content.Headers.ContentType?.MediaType?.Contains("json") != true)
                throw new RemoteImportException(L.T("Die Gegenstelle ist keine TierModel-Instanz (keine JSON-Antwort)."));
            if (response.Content.Headers.ContentLength > ConfigArchive.MaxEntryBytes)
                throw new RemoteImportException(L.T("Die Antwort der Gegenstelle ist zu groß."));
            try
            {
                await using var s = await response.Content.ReadAsStreamAsync(ct);
                return await JsonNode.ParseAsync(s, cancellationToken: ct);
            }
            catch (JsonException)
            {
                throw new RemoteImportException(L.T("Die Gegenstelle lieferte eine ungültige Antwort."));
            }
        }
    }

    public static string Redact(string message, string? secret) =>
        string.IsNullOrEmpty(secret) ? message : message.Replace(secret, "***", StringComparison.Ordinal);
}
