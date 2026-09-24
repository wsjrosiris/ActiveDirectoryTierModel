using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using TierModel.Service.Config;
using TierModel.Service.Localization;

namespace TierModel.Service.Tests;

/// <summary>Roadmap 25: server texts in German (default) and English.</summary>
public partial class LocalizationUnitTests
{
    private static string SourceRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "src", "TierModel.Service")))
            dir = dir.Parent;
        Assert.NotNull(dir);
        return Path.Combine(dir!.FullName, "src", "TierModel.Service");
    }

    [GeneratedRegex(@"\bL\.(?:T|F|P|PF)\((@?)""((?:[^""\\]|\\.|"""")*)""")]
    private static partial Regex PlainCall();

    [GeneratedRegex(@"\bL\.(?:In|FormatIn)\([^,()""]+,\s*(@?)""((?:[^""\\]|\\.|"""")*)""")]
    private static partial Regex LanguageCall();

    [GeneratedRegex(@"\bL\.(?:TC|PC)\(""([^""]+)"",\s*(@?)""((?:[^""\\]|\\.|"""")*)""")]
    private static partial Regex ContextCall();

    [GeneratedRegex(@"\{(\d+)[^}]*\}")]
    private static partial Regex Placeholder();

    private static string Literal(string verbatim, string text) => verbatim == "@" ? text.Replace("\"\"", "\"") : Regex.Unescape(text);

    private static IEnumerable<(string File, string Key)> CatalogKeys()
    {
        var root = SourceRoot();
        foreach (var file in Directory.EnumerateFiles(root, "*.cs", SearchOption.AllDirectories))
        {
            if (file.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}") || file.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}")
                || file.EndsWith("English.cs")) continue;
            var src = File.ReadAllText(file);
            var rel = Path.GetRelativePath(root, file);
            foreach (Match m in PlainCall().Matches(src)) yield return (rel, Literal(m.Groups[1].Value, m.Groups[2].Value));
            foreach (Match m in LanguageCall().Matches(src)) yield return (rel, Literal(m.Groups[1].Value, m.Groups[2].Value));
            foreach (Match m in ContextCall().Matches(src)) yield return (rel, m.Groups[1].Value + "|" + Literal(m.Groups[2].Value, m.Groups[3].Value));
        }
        foreach (var section in ConfigCatalog.Sections)
        {
            yield return ("ConfigCatalog", "section|" + section.GermanTitle);
            yield return ("ConfigCatalog", "section|" + section.GermanDescription);
        }
    }

    [Fact]
    public void Every_localized_server_text_has_an_english_translation_with_the_same_placeholders()
    {
        var keys = CatalogKeys().ToList();
        Assert.True(keys.Count > 500, $"only {keys.Count} texts found – source scan broken?");
        var missing = keys.Where(k => !English.Texts.ContainsKey(k.Key)).Select(k => $"{k.File}: {k.Key}").Distinct().ToList();
        Assert.True(missing.Count == 0, "Missing English texts:\n" + string.Join("\n", missing));

        static string Holes(string s) => string.Join(",", Placeholder().Matches(s).Select(m => m.Groups[1].Value).Distinct().Order());
        var mismatched = English.Texts.Where(e => Holes(e.Key) != Holes(e.Value)).Select(e => e.Key).ToList();
        Assert.True(mismatched.Count == 0, "Placeholder mismatch:\n" + string.Join("\n", mismatched));
        // Every English format must be usable with string.Format.
        foreach (var (_, en) in English.Texts)
            _ = string.Format(L.EnglishCulture, en, Enumerable.Range(0, 10).Select(_ => (object?)new AnyValue()).ToArray());
    }

    private sealed class AnyValue : IFormattable
    {
        public string ToString(string? format, IFormatProvider? formatProvider) => "x";
    }

    [Fact]
    public void German_is_the_default_and_fallback()
    {
        Assert.Equal("de", L.Normalize("de-DE"));
        Assert.Equal("en", L.Normalize("en-US"));
        Assert.Null(L.Normalize("fr"));
        Assert.Equal("Zusammenfassung", L.In("de", "Zusammenfassung"));
        Assert.Equal("Summary", L.In("en", "Zusammenfassung"));
        Assert.Equal("Nicht übersetzter Text", L.In("en", "Nicht übersetzter Text"));
        using (L.Use("en"))
        {
            Assert.Equal("Summary", L.T("Zusammenfassung"));
            Assert.Equal("Users", ConfigCatalog.Find("users")!.Title);
        }
        Assert.Equal("Benutzer", ConfigCatalog.Find("users")!.Title);
    }
}

[Collection("api")]
public class LocalizationApiTests(ApiFixture fixture)
{
    private static Task<HttpClient>? _admin;
    private Task<HttpClient> AdminAsync() => _admin ??= PlanApiTests.LoginAsync(fixture, ApiFixture.AdminUser, ApiFixture.AdminPassword);

    private static HttpRequestMessage Request(HttpMethod method, string url, string? language, object? body = null)
    {
        var request = new HttpRequestMessage(method, url);
        if (language is not null) request.Headers.AcceptLanguage.ParseAdd(language);
        if (body is not null) request.Content = JsonContent.Create(body);
        return request;
    }

    private static object Settings(int retention = 90, string? defaultLanguage = null) => new
    {
        defaultPreferredDc = "dc01.contoso.local", admlLanguage = "en-US", runRetentionDays = retention,
        requireApproval = false, approvalTimeoutHours = 24, publicBaseUrl = "", requirePlanBeforeApply = true, planMaxAgeHours = 24, defaultLanguage,
    };

    [DbFact]
    public async Task Validation_messages_follow_accept_language_and_default_to_german()
    {
        var admin = await AdminAsync();
        var invalid = Settings(retention: 99999);

        var german = await admin.SendAsync(Request(HttpMethod.Put, "/api/settings", null, invalid));
        Assert.Equal(HttpStatusCode.BadRequest, german.StatusCode);
        Assert.Contains("0 bis 3650 Tage (0 = unbegrenzt).", await german.Content.ReadAsStringAsync());

        var english = await admin.SendAsync(Request(HttpMethod.Put, "/api/settings", "en-US,en;q=0.9", invalid));
        Assert.Equal(HttpStatusCode.BadRequest, english.StatusCode);
        var text = await english.Content.ReadAsStringAsync();
        Assert.Contains("0 to 3650 days (0 = unlimited).", text);
        Assert.DoesNotContain("Tage", text);

        // Unsupported languages fall back to German.
        var french = await admin.SendAsync(Request(HttpMethod.Put, "/api/settings", "fr-FR", invalid));
        Assert.Contains("0 bis 3650 Tage (0 = unbegrenzt).", await french.Content.ReadAsStringAsync());
    }

    [DbFact]
    public async Task Reports_on_demand_use_the_request_language()
    {
        var admin = await AdminAsync();
        var english = await admin.SendAsync(Request(HttpMethod.Get, "/api/reports/aenderungen?format=html&lang=en", null));
        english.EnsureSuccessStatusCode();
        var html = await english.Content.ReadAsStringAsync();
        Assert.Contains("lang=\"en\"", html);
        Assert.Contains("Change log", html);
        Assert.DoesNotContain("Änderungsprotokoll", html);

        var viaHeader = await admin.SendAsync(Request(HttpMethod.Get, "/api/reports/soll-ist?format=html", "en"));
        viaHeader.EnsureSuccessStatusCode();
        Assert.Contains("Summary", await viaHeader.Content.ReadAsStringAsync());

        var german = await admin.GetStringAsync("/api/reports/aenderungen?format=html");
        Assert.Contains("Änderungsprotokoll", german);
        Assert.Contains("lang=\"de\"", german);
    }

    [DbFact]
    public async Task Persisted_change_log_texts_use_the_instance_default_language()
    {
        var admin = await AdminAsync();
        try
        {
            // English instance default, German request: the stored summary is English.
            (await admin.SendAsync(Request(HttpMethod.Put, "/api/settings", "de", Settings(defaultLanguage: "en")))).EnsureSuccessStatusCode();
            Assert.Equal("en", (await admin.GetFromJsonAsync<JsonObject>("/api/settings"))!["defaultLanguage"]!.GetValue<string>());
            var log = await admin.GetFromJsonAsync<JsonObject>("/api/changelog?entityType=settings&pageSize=1");
            Assert.StartsWith("Settings changed: DC 'dc01.contoso.local'", log!["items"]![0]!["summary"]!.GetValue<string>());
            Assert.Contains("default language en", log["items"]![0]!["summary"]!.GetValue<string>());
        }
        finally
        {
            // Back to German with an English request: the stored summary is German again.
            (await admin.SendAsync(Request(HttpMethod.Put, "/api/settings", "en", Settings(defaultLanguage: "de")))).EnsureSuccessStatusCode();
        }
        var after = await admin.GetFromJsonAsync<JsonObject>("/api/changelog?entityType=settings&pageSize=1");
        Assert.StartsWith("Einstellungen geändert: DC 'dc01.contoso.local'", after!["items"]![0]!["summary"]!.GetValue<string>());
        Assert.Equal("de", L.InstanceDefault);
    }

    [DbFact]
    public async Task Users_store_their_language()
    {
        var admin = await AdminAsync();
        try
        {
            Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/auth/me/language", new { language = "en" })).StatusCode);
            var me = await admin.GetFromJsonAsync<JsonObject>("/api/auth/me");
            Assert.Equal("en", me!["user"]!["language"]!.GetValue<string>());

            var bad = await admin.SendAsync(Request(HttpMethod.Put, "/api/auth/me/language", "en", new { language = "fr" }));
            Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
            Assert.Contains("are supported", await bad.Content.ReadAsStringAsync());
        }
        finally
        {
            (await admin.PutAsJsonAsync("/api/auth/me/language", new { language = (string?)null })).EnsureSuccessStatusCode();
        }
        var reset = await admin.GetFromJsonAsync<JsonObject>("/api/auth/me");
        Assert.Null(reset!["user"]!["language"]);
    }
}
