using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using LibGit2Sharp;
using Microsoft.Extensions.DependencyInjection;
using TierModel.Service.GitSync;
using TierModel.Service.Transfer;

namespace TierModel.Service.Tests;

internal static class Zip
{
    public static MemoryStream Build(params (string Name, string Content)[] entries)
    {
        var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
            foreach (var (name, content) in entries)
            {
                using var s = zip.CreateEntry(name).Open();
                s.Write(Encoding.UTF8.GetBytes(content));
            }
        ms.Position = 0;
        return ms;
    }
}

public class ConfigArchiveTests
{
    [Fact]
    public void Reads_sections_and_versions_of_an_export()
    {
        using var zip = Zip.Build(("config/tiermodel-groups.json", "{\"groups\":[]}"), ("config/tiermodel-ous.json", "{\"organizationUnits\":[]}"),
            ("versions.json", "{\"groups\": 4, \"ous\": 2}"));
        var source = ConfigArchive.Read(zip, "Datei x.zip");
        Assert.Equal(["groups", "ous"], source.Sections.Keys.Order());
        Assert.Equal(4, source.SourceVersions["groups"]);
        Assert.Empty(source.Notices);
        Assert.Empty(source.UnknownFiles);
    }

    [Fact]
    public void Missing_versions_json_is_a_notice_not_an_error()
    {
        using var zip = Zip.Build(("config/tiermodel-groups.json", "{}"));
        var source = ConfigArchive.Read(zip, "x");
        Assert.Single(source.Sections);
        Assert.Empty(source.SourceVersions);
        Assert.Contains(source.Notices, n => n.Contains("versions.json fehlt"));
    }

    [Fact]
    public void Unknown_files_are_ignored_with_a_notice()
    {
        using var zip = Zip.Build(("config/tiermodel-groups.json", "{}"), ("config/other.json", "{}"), ("readme.txt", "x"), ("config/sub/tiermodel-ous.json", "{}"), ("versions.json", "{}"));
        var source = ConfigArchive.Read(zip, "x");
        Assert.Equal(["groups"], source.Sections.Keys);
        Assert.Equal(3, source.UnknownFiles.Count);
        Assert.Contains(source.Notices, n => n.Contains("3 unbekannte Datei"));
    }

    [Fact]
    public void Invalid_json_marks_the_section_invalid()
    {
        using var zip = Zip.Build(("config/tiermodel-groups.json", "{ kaputt"), ("config/tiermodel-ous.json", "[1,2]"), ("versions.json", "{}"));
        var source = ConfigArchive.Read(zip, "x");
        Assert.Empty(source.Sections);
        Assert.Equal(2, source.Invalid.Count);
    }

    [Theory]
    [InlineData("../evil.json")]
    [InlineData("config/../../evil.json")]
    [InlineData("/etc/passwd")]
    [InlineData("C:/Windows/evil.json")]
    [InlineData("..\\evil.json")]
    public void Zip_slip_paths_reject_the_archive(string name)
    {
        using var zip = Zip.Build(("config/tiermodel-groups.json", "{}"), (name, "{}"));
        Assert.Throws<ImportFormatException>(() => ConfigArchive.Read(zip, "x"));
    }

    [Fact]
    public void Backslash_paths_from_windows_tools_are_accepted()
    {
        using var zip = Zip.Build(("config\\tiermodel-groups.json", "{}"));
        Assert.Single(ConfigArchive.Read(zip, "x").Sections);
    }

    [Fact]
    public void Oversized_entries_are_rejected()
    {
        using var zip = Zip.Build(("config/tiermodel-groups.json", "{\"x\":\"" + new string('a', (int)ConfigArchive.MaxEntryBytes) + "\"}"));
        var ex = Assert.Throws<ImportFormatException>(() => ConfigArchive.Read(zip, "x"));
        Assert.Contains("zu groß", ex.Message);
    }

    [Fact]
    public void Non_zip_and_empty_archives_are_rejected()
    {
        Assert.Throws<ImportFormatException>(() => ConfigArchive.Read(new MemoryStream("kein zip"u8.ToArray()), "x"));
        using var zip = Zip.Build(("readme.txt", "x"));
        Assert.Throws<ImportFormatException>(() => ConfigArchive.Read(zip, "x"));
    }
}

public class ImportReplacementTests
{
    [Fact]
    public void Replaces_in_string_values_only_and_counts_occurrences()
    {
        var node = JsonNode.Parse("""{"dc":"dc01.test.local","list":["x.test.local","y"],"test.local":1,"nested":{"a":"TEST-GG-test.local test.local"}}""");
        var n = ImportService.ApplyReplacements(node, [new ReplacementRule("test.local", "prod.local"), new ReplacementRule("TEST-", "PRD-")]);
        Assert.Equal(5, n);
        Assert.Equal("dc01.prod.local", node!["dc"]!.GetValue<string>());
        Assert.Equal("x.prod.local", node["list"]![0]!.GetValue<string>());
        Assert.NotNull(node["test.local"]); // property names stay
        Assert.Equal("PRD-GG-prod.local prod.local", node["nested"]!["a"]!.GetValue<string>());
    }

    [Fact]
    public void Rules_are_normalised_and_limited()
    {
        var (rules, error) = ImportService.NormalizeRules([new("", "x"), new("a", null!)]);
        Assert.Null(error);
        Assert.Equal([new ReplacementRule("a", "")], rules);
        Assert.NotNull(ImportService.NormalizeRules(Enumerable.Range(0, 51).Select(i => new ReplacementRule($"s{i}", "r"))).Error);
    }
}

public class RemoteConfigClientTests
{
    private sealed class FakeHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public List<HttpRequestMessage> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Add(request);
            return Task.FromResult(respond(request));
        }
    }

    private sealed class Factory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private static HttpResponseMessage Json(object body) => new(HttpStatusCode.OK) { Content = JsonContent.Create(body) };

    private const string Token = "tmk_abcdefgh_0123456789012345678901234567890123456789012";

    [Fact]
    public async Task Fetches_all_known_sections_with_the_bearer_token()
    {
        var handler = new FakeHandler(r => r.RequestUri!.AbsolutePath switch
        {
            "/api/config/sections" => Json(new object[] { new { key = "groups", version = 7 }, new { key = "zukunft", version = 1 } }),
            "/api/config/sections/groups" => Json(new { key = "groups", version = 7, content = new { groups = new[] { new { name = "GG-T0" } } } }),
            _ => new HttpResponseMessage(HttpStatusCode.NotFound),
        });
        var client = new RemoteConfigClient(new Factory(handler));
        var source = await client.FetchAsync("Instanz Test", "https://test.contoso.com/", Token, CancellationToken.None);

        Assert.Equal(["groups"], source.Sections.Keys);
        Assert.Contains("GG-T0", source.Sections["groups"]);
        Assert.Equal(7, source.SourceVersions["groups"]);
        Assert.Equal(["zukunft"], source.UnknownFiles);
        Assert.All(handler.Requests, r =>
        {
            Assert.Equal("Bearer", r.Headers.Authorization!.Scheme);
            Assert.Equal(Token, r.Headers.Authorization.Parameter);
            Assert.StartsWith("https://test.contoso.com/api/", r.RequestUri!.ToString());
        });
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, "abgelehnt")]
    [InlineData(HttpStatusCode.Forbidden, "Leseberechtigung")]
    [InlineData(HttpStatusCode.NotFound, "keine TierModel-Instanz")]
    [InlineData(HttpStatusCode.InternalServerError, "500")]
    public async Task Check_reports_readable_errors(HttpStatusCode status, string expected)
    {
        var client = new RemoteConfigClient(new Factory(new FakeHandler(_ => new HttpResponseMessage(status))));
        var result = await client.CheckAsync("https://test.contoso.com", Token, CancellationToken.None);
        Assert.False(result.Ok);
        Assert.Contains(expected, result.Message);
    }

    [Fact]
    public async Task Connection_errors_never_contain_the_token()
    {
        var client = new RemoteConfigClient(new Factory(new FakeHandler(_ => throw new HttpRequestException($"boom {Token}"))));
        var result = await client.CheckAsync("https://test.contoso.com", Token, CancellationToken.None);
        Assert.False(result.Ok);
        Assert.DoesNotContain(Token, result.Message);
    }

    [Theory]
    [InlineData("https://tm.contoso.com", false, true)]
    [InlineData("http://tm.contoso.com", false, false)]
    [InlineData("http://localhost:5080", true, true)]
    [InlineData("https://u:p@tm.contoso.com", false, false)]
    [InlineData("ftp://tm", true, false)]
    public void Only_https_urls(string url, bool allowHttp, bool ok) => Assert.Equal(ok, RemoteConfigClient.UrlError(url, allowHttp) is null);
}

[Collection("api")]
public class TransferApiTests(ApiFixture fixture)
{
    private Task<HttpClient> AdminAsync() => PlanApiTests.LoginAsync(fixture, ApiFixture.AdminUser, ApiFixture.AdminPassword);

    private static async Task<JsonObject> UploadAsync(HttpClient client, byte[] zip, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var content = new ByteArrayContent(zip);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/zip");
        var response = await client.PostAsync("/api/config/import/file?fileName=export.zip", content);
        Assert.Equal(expected, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonObject>())!;
    }

    private static async Task<(int Version, JsonObject Content)> SectionAsync(HttpClient client, string key)
    {
        var s = await client.GetFromJsonAsync<JsonObject>($"/api/config/sections/{key}");
        return (s!["version"]!.GetValue<int>(), s["content"]!.AsObject());
    }

    private static async Task SaveAsync(HttpClient client, string key, JsonObject content, int baseVersion, string comment)
    {
        var r = await client.PutAsJsonAsync($"/api/config/sections/{key}", new { content, comment, baseVersion });
        r.EnsureSuccessStatusCode();
    }

    private static JsonObject Section(JsonObject preview, string key) =>
        preview["sections"]!.AsArray().OfType<JsonObject>().Single(s => s["key"]!.GetValue<string>() == key);

    [DbFact]
    public async Task Export_zip_roundtrip_previews_changes_and_applies_selected_sections()
    {
        var admin = await AdminAsync();
        var zip = await admin.GetByteArrayAsync("/api/config/export");

        // Change "users" after the export: importing the ZIP shows it as changed (back to the exported state).
        var (v, users) = await SectionAsync(admin, "users");
        users["users"]!.AsArray().Add(new JsonObject { ["name"] = "svc-import-test", ["path"] = "OU=X" });
        await SaveAsync(admin, "users", users, v, "Nach dem Export geändert");

        var preview = await UploadAsync(admin, zip);
        Assert.Equal("Datei export.zip", preview["label"]!.GetValue<string>());
        var u = Section(preview, "users");
        Assert.Equal("changed", u["status"]!.GetValue<string>());
        Assert.Equal(v + 1, u["baseVersion"]!.GetValue<int>());
        Assert.NotNull(u["current"]);
        Assert.NotNull(u["incoming"]);
        Assert.Equal("unchanged", Section(preview, "ous")["status"]!.GetValue<string>());
        Assert.Null(Section(preview, "ous")["incoming"]);

        var id = preview["id"]!.GetValue<string>();
        var noComment = await admin.PostAsJsonAsync($"/api/config/import/{id}/apply", new { keys = new[] { "users" }, comment = " " });
        Assert.Equal(HttpStatusCode.BadRequest, noComment.StatusCode);
        var unchanged = await admin.PostAsJsonAsync($"/api/config/import/{id}/apply", new { keys = new[] { "ous" }, comment = "x" });
        Assert.Equal(HttpStatusCode.BadRequest, unchanged.StatusCode);

        var apply = await admin.PostAsJsonAsync($"/api/config/import/{id}/apply", new { keys = new[] { "users" }, comment = "Übernahme Test" });
        apply.EnsureSuccessStatusCode();
        var (after, content) = await SectionAsync(admin, "users");
        Assert.Equal(v + 2, after);
        Assert.DoesNotContain(content["users"]!.AsArray(), x => x!["name"]?.GetValue<string>() == "svc-import-test");

        var versions = await admin.GetFromJsonAsync<JsonArray>("/api/config/sections/users/versions");
        Assert.Equal("Import aus Datei export.zip: Übernahme Test", versions![0]!["comment"]!.GetValue<string>());
        var log = await admin.GetFromJsonAsync<JsonObject>("/api/changelog?entityType=config&pageSize=5");
        var entry = log!["items"]!.AsArray().OfType<JsonObject>().First();
        Assert.Equal("config.import", entry["action"]!.GetValue<string>());
        Assert.Equal("users", entry["entityId"]!.GetValue<string>());
        Assert.Contains("Import aus Datei export.zip", entry["summary"]!.GetValue<string>());

        // The preview is consumed.
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsJsonAsync($"/api/config/import/{id}/apply", new { keys = new[] { "users" }, comment = "x" })).StatusCode);
    }

    [DbFact]
    public async Task Apply_is_rejected_with_409_when_a_section_changed_after_the_preview()
    {
        var admin = await AdminAsync();
        var (v, groups) = await SectionAsync(admin, "groups");
        groups["groups"]!.AsArray()[0]!["description"] = "Import-Konflikt " + Guid.NewGuid();
        using var zip = Zip.Build(("config/tiermodel-groups.json", groups.ToJsonString()), ("versions.json", "{\"groups\": 99}"));
        var preview = await UploadAsync(admin, zip.ToArray());
        Assert.Equal("changed", Section(preview, "groups")["status"]!.GetValue<string>());
        Assert.Equal(99, Section(preview, "groups")["sourceVersion"]!.GetValue<int>());
        Assert.Contains(preview["notices"]!.AsArray(), n => n!.GetValue<string>().Contains("Nicht in der Quelle enthalten"));

        var (_, current) = await SectionAsync(admin, "groups");
        current["groups"]!.AsArray()[0]!["description"] = "zwischendurch geändert";
        await SaveAsync(admin, "groups", current, v, "parallel");

        var apply = await admin.PostAsJsonAsync($"/api/config/import/{preview["id"]}/apply", new { keys = new[] { "groups" }, comment = "zu spät" });
        Assert.Equal(HttpStatusCode.Conflict, apply.StatusCode);
        Assert.Equal(v + 1, (await SectionAsync(admin, "groups")).Version);
    }

    [DbFact]
    public async Task Replacements_are_applied_to_the_stored_source_and_validation_flags_new_issues()
    {
        var admin = await AdminAsync();
        var (_, groups) = await SectionAsync(admin, "groups");
        var name = groups["groups"]!.AsArray()[0]!["name"]!.GetValue<string>();
        using var zip = Zip.Build(("config/tiermodel-groups.json", groups.ToJsonString()));
        var preview = await UploadAsync(admin, zip.ToArray());
        Assert.Equal("unchanged", Section(preview, "groups")["status"]!.GetValue<string>());

        var replaced = await admin.PostAsJsonAsync($"/api/config/import/{preview["id"]}/replacements",
            new { replacements = new[] { new { search = name, replace = name + "-PRD" } } });
        replaced.EnsureSuccessStatusCode();
        var next = (await replaced.Content.ReadFromJsonAsync<JsonObject>())!;
        var g = Section(next, "groups");
        Assert.Equal("changed", g["status"]!.GetValue<string>());
        Assert.True(g["replacements"]!.GetValue<int>() >= 1);
        Assert.Equal(name + "-PRD", g["incoming"]!["groups"]![0]!["name"]!.GetValue<string>());
        Assert.NotNull(next["issues"]);

        var validate = await admin.PostAsJsonAsync($"/api/config/import/{next["id"]}/validate", new { keys = Array.Empty<string>() });
        validate.EnsureSuccessStatusCode();
        Assert.DoesNotContain((await validate.Content.ReadFromJsonAsync<JsonArray>())!, i => i!["isNew"]!.GetValue<bool>());
    }

    [DbFact]
    public async Task Bad_archives_are_rejected_with_a_readable_message()
    {
        var admin = await AdminAsync();
        using var slip = Zip.Build(("config/tiermodel-groups.json", "{}"), ("../x.json", "{}"));
        var r = await UploadAsync(admin, slip.ToArray(), HttpStatusCode.BadRequest);
        Assert.Contains("Unzulässiger Pfad", r["title"]!.GetValue<string>());
    }

    [DbFact]
    public async Task Remote_instances_store_the_token_encrypted_and_never_return_it()
    {
        var admin = await AdminAsync();
        const string token = "tmk_abcdefgh_0123456789012345678901234567890123456789012";
        var bad = await admin.PostAsJsonAsync("/api/config/remote-instances", new { name = "Test", url = "http://test.contoso.com", token });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        var created = await admin.PostAsJsonAsync("/api/config/remote-instances", new { name = "Test", url = "https://tm-test.invalid/", token });
        created.EnsureSuccessStatusCode();
        var body = await created.Content.ReadAsStringAsync();
        Assert.DoesNotContain(token, body);
        var id = JsonNode.Parse(body)!["id"]!.GetValue<string>();
        Assert.Equal("https://tm-test.invalid", JsonNode.Parse(body)!["url"]!.GetValue<string>());

        using (var scope = fixture.Factory!.Services.CreateScope())
        {
            var stored = await scope.ServiceProvider.GetRequiredService<SettingsService>().GetValueAsync(TransferEndpoints.RemoteInstancesKey);
            Assert.DoesNotContain(token, stored);
        }
        var check = await admin.PostAsJsonAsync("/api/config/remote-instances/check", new { id });
        var result = (await check.Content.ReadFromJsonAsync<JsonObject>())!;
        Assert.False(result["ok"]!.GetValue<bool>());
        Assert.DoesNotContain(token, result["message"]!.GetValue<string>());

        var pull = await admin.PostAsJsonAsync("/api/config/import/remote", new { instanceId = id });
        Assert.Equal(HttpStatusCode.BadGateway, pull.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/config/remote-instances/{id}")).StatusCode);
    }

    [DbFact]
    public async Task Saved_versions_are_committed_to_git_with_author_and_trailers()
    {
        var admin = await AdminAsync();
        var root = Path.Combine(Path.GetTempPath(), "tm-gitapi-" + Guid.NewGuid().ToString("N")[..8]);
        var bare = Path.Combine(root, "remote.git");
        Repository.Init(bare, isBare: true);
        File.WriteAllText(Path.Combine(bare, "HEAD"), "ref: refs/heads/main\n");
        try
        {
            var invalid = await admin.PutAsJsonAsync("/api/settings/git", new { enabled = true, repositoryUrl = "http://git.contoso.com/x.git", branch = "main", pathInRepo = "config", pushOnSave = true });
            Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);

            var put = await admin.PutAsJsonAsync("/api/settings/git", new
            {
                enabled = true, repositoryUrl = new Uri(bare).AbsoluteUri, branch = "main", username = "", password = "geheim-123",
                authorName = "TierModel Test", authorEmail = "tm@contoso.com", pathInRepo = "config", pushOnSave = true,
            });
            put.EnsureSuccessStatusCode();
            var dto = await put.Content.ReadAsStringAsync();
            Assert.DoesNotContain("geheim-123", dto);
            Assert.True(JsonNode.Parse(dto)!["hasPassword"]!.GetValue<bool>());

            // Initial sync: every section plus versions.json.
            var initial = await WaitForAsync(bare, c => c.MessageShort.StartsWith("Synchronisierung aller Bereiche"));
            Assert.NotNull(initial["config/tiermodel-ous.json"]);
            Assert.NotNull(initial["versions.json"]);

            var (v, dependencies) = await SectionAsync(admin, "dependencies");
            dependencies["gitTest"] = Guid.NewGuid().ToString();
            await SaveAsync(admin, "dependencies", dependencies, v, "Git-Test");
            var commit = await WaitForAsync(bare, c => c.Message.Contains($"TierModel-Version: {v + 1}") && c.Message.Contains("TierModel-Section: dependencies"));
            Assert.Equal("Admin", commit.Author.Name);
            Assert.Equal("tm@contoso.com", commit.Author.Email);
            Assert.StartsWith("Git-Test\n\n", commit.Message);
            var (_, saved) = await SectionAsync(admin, "dependencies");
            var export = await admin.GetByteArrayAsync("/api/config/export");
            using var zip = new ZipArchive(new MemoryStream(export));
            using var reader = new StreamReader(zip.GetEntry("config/dependencies.json")!.Open());
            Assert.Equal(await reader.ReadToEndAsync(), ((Blob)commit["config/dependencies.json"].Target).GetContentText()); // same bytes as the export

            var status = await admin.GetFromJsonAsync<JsonObject>("/api/settings/git");
            Assert.Equal(commit.Sha, status!["status"]!["lastCommit"]!.GetValue<string>());
            var health = await admin.GetFromJsonAsync<JsonObject>("/api/health/details");
            Assert.Contains(health!["items"]!.AsArray(), i => i!["key"]!.GetValue<string>() == "git");
        }
        finally
        {
            await admin.PutAsJsonAsync("/api/settings/git", new { enabled = false, repositoryUrl = "", branch = "main", pathInRepo = "config", pushOnSave = true, clearPassword = true });
            try { GitRepositorySync.DeleteDirectory(root); } catch (IOException) { }
        }
    }

    private static async Task<Commit> WaitForAsync(string bare, Func<Commit, bool> match)
    {
        for (var i = 0; i < 100; i++)
        {
            var repo = new Repository(bare);
            var hit = repo.Branches["main"]?.Commits.Take(20).FirstOrDefault(match);
            if (hit is not null) return hit; // repository stays open for the lazy commit properties
            repo.Dispose();
            await Task.Delay(200);
        }
        throw new TimeoutException("Kein passender Commit im Repository.");
    }
}
