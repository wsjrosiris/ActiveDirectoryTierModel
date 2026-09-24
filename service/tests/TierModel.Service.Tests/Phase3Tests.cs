using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using TierModel.Service.AdView;
using TierModel.Service.Config;
using TierModel.Service.Data;
using TierModel.Service.Runs;
using TierModel.Service.Setup;

namespace TierModel.Service.Tests;

public class AuthSiloConfigTests
{
    private const string Groups = """
        [ { "name": "Tier 0 PAW Devices", "samaccountname": "Tier0PAWDevices", "path": "OU=Tier 0,{{DOMAIN_DN}}" },
          { "name": "Tier 1 Member Servers", "samaccountname": "Tier1MemberServers", "path": "OU=Tier 1,{{DOMAIN_DN}}" } ]
        """;

    private static Dictionary<string, JsonNode?> Sections(string authsilos) => new()
    {
        ["ous"] = JsonNode.Parse("""{ "organizationUnits": [ { "name": "Tier 0", "path": "{{DOMAIN_DN}}" }, { "name": "Tier 1", "path": "{{DOMAIN_DN}}" } ] }"""),
        ["groups"] = JsonNode.Parse($$"""{ "groups": {{Groups}} }"""),
        ["authsilos"] = JsonNode.Parse(authsilos),
    };

    private static List<ValidationIssue> AuthIssues(string authsilos) =>
        ConfigValidator.Validate(Sections(authsilos)).Where(i => i.Section == "authsilos").ToList();

    [Fact]
    public void Catalog_contains_the_optional_authsilos_section()
    {
        var def = ConfigCatalog.Find("authsilos");
        Assert.NotNull(def);
        Assert.Equal("tiermodel-authsilos.json", def.FileName);
        Assert.Equal("Authentication Silos", def.Title);
        Assert.Equal(2, ConfigService.CountItems(def, JsonNode.Parse(File.ReadAllText(Path.Combine(TestPaths.RepoRoot, "config", def.FileName)))));
    }

    [Fact]
    public void Shipped_authsilos_configuration_is_valid()
    {
        var configDir = Path.Combine(TestPaths.RepoRoot, "config");
        var sections = ConfigCatalog.Sections.Where(d => File.Exists(Path.Combine(configDir, d.FileName)))
            .ToDictionary(d => d.Key, d => JsonNode.Parse(File.ReadAllText(Path.Combine(configDir, d.FileName))));
        Assert.True(sections.ContainsKey("authsilos"));
        Assert.DoesNotContain(ConfigValidator.Validate(sections), i => i.Section == "authsilos");
    }

    [Fact]
    public void Valid_policy_and_silo_have_no_issues()
    {
        var issues = AuthIssues("""
            { "authenticationPolicies": [ { "name": "Tier 0 Policy", "userTgtLifetimeMins": 240, "allowedToAuthenticateFrom": { "includeDomainControllers": true, "deviceGroups": ["Tier0PAWDevices"] } } ],
              "authenticationPolicySilos": [ { "name": "Tier 0 Silo", "userAuthenticationPolicy": "Tier 0 Policy", "members": { "userOUs": ["OU=Tier 0,{{DOMAIN_DN}}"] } } ],
              "deviceGroupSync": [ { "group": "Tier0PAWDevices", "sourceOUs": ["OU=Tier 0,{{DOMAIN_DN}}"] } ] }
            """);
        Assert.Empty(issues);
    }

    [Fact]
    public void Duplicate_names_tgt_range_and_unknown_references_are_reported()
    {
        var issues = AuthIssues("""
            { "authenticationPolicies": [
                { "name": "P", "userTgtLifetimeMins": 30, "allowedToAuthenticateFrom": { "includeDomainControllers": false, "deviceGroups": ["NoSuchGroup"] } },
                { "name": "p", "userTgtLifetimeMins": 700, "allowedToAuthenticateFrom": { "includeDomainControllers": false, "deviceGroups": [] } } ],
              "authenticationPolicySilos": [
                { "name": "S", "userAuthenticationPolicy": "Missing Policy", "members": { "userOUs": ["OU=Nowhere,{{DOMAIN_DN}}"], "computerGroups": ["Ghost"] } },
                { "name": "S", "members": {} } ],
              "deviceGroupSync": [ { "group": "Tier0PAWDevices", "sourceOUs": [] }, { "group": "Tier0PAWDevices", "sourceOUs": ["OU=Tier 0,{{DOMAIN_DN}}"] } ] }
            """);
        Assert.Contains(issues, i => i.Severity == "Error" && i.Message.Contains("Richtlinie ist doppelt"));
        Assert.Contains(issues, i => i.Severity == "Error" && i.Message.Contains("30 Minuten"));
        Assert.Contains(issues, i => i.Severity == "Error" && i.Message.Contains("700 Minuten"));
        Assert.Contains(issues, i => i.Severity == "Warning" && i.Message.Contains("'NoSuchGroup'"));
        Assert.Contains(issues, i => i.Severity == "Warning" && i.Message.Contains("keine Gerätebedingung"));
        Assert.Contains(issues, i => i.Severity == "Error" && i.Message.Contains("'Missing Policy' ist nicht konfiguriert"));
        Assert.Contains(issues, i => i.Severity == "Warning" && i.Message.Contains("OU=Nowhere"));
        Assert.Contains(issues, i => i.Severity == "Warning" && i.Message.Contains("'Ghost'"));
        Assert.Contains(issues, i => i.Severity == "Error" && i.Message.Contains("Silos ist doppelt"));
        Assert.Contains(issues, i => i.Severity == "Warning" && i.Message.Contains("keine Authentifizierungsrichtlinie"));
        Assert.Contains(issues, i => i.Severity == "Error" && i.Message.Contains("Keine Quell-OU"));
        Assert.Contains(issues, i => i.Severity == "Error" && i.Message.Contains("mehrfach"));
    }

    [Fact]
    public void Tier0_policy_with_tier1_devices_violates_the_tier_model()
    {
        var issues = AuthIssues("""
            { "authenticationPolicies": [ { "name": "Tier 0 Policy", "allowedToAuthenticateFrom": { "includeDomainControllers": true, "deviceGroups": ["Tier0PAWDevices", "Tier1MemberServers"] } } ],
              "authenticationPolicySilos": [ { "name": "Tier 0 Silo", "userAuthenticationPolicy": "Tier 0 Policy", "members": { "userOUs": ["OU=Tier 1,{{DOMAIN_DN}}"] } } ],
              "deviceGroupSync": [ { "group": "Tier0PAWDevices", "sourceOUs": ["OU=Tier 1,{{DOMAIN_DN}}"] } ] }
            """);
        Assert.Contains(issues, i => i.Severity == "Error" && i.Message.StartsWith("Tier-Verstoß: Tier-0-Richtlinie") && i.Message.Contains("Tier1MemberServers"));
        Assert.Contains(issues, i => i.Severity == "Error" && i.Message.StartsWith("Tier-Verstoß: Tier-0-Silo"));
        Assert.Contains(issues, i => i.Severity == "Error" && i.Message.Contains("Konten aus einer Tier-1-OU"));
        Assert.Contains(issues, i => i.Severity == "Error" && i.Message.Contains("Tier-0-Gerätegruppe 'Tier0PAWDevices'"));
    }

    [Fact]
    public void Explicit_tier_overrides_the_name()
    {
        var issues = AuthIssues("""
            { "authenticationPolicies": [ { "name": "Admins", "tier": 0, "allowedToAuthenticateFrom": { "includeDomainControllers": false, "deviceGroups": ["Tier1MemberServers"] } } ] }
            """);
        Assert.Contains(issues, i => i.Severity == "Error" && i.Message.Contains("Tier-0-Richtlinie"));
    }
}

public class AuthSiloScopeTests
{
    [Fact]
    public void AuthSilosOnly_is_a_valid_scope_without_extensions()
    {
        Assert.Empty(RunValidation.Validate(new RunRequest("dc01.contoso.local", DeployScope.AuthSilosOnly, false, false, false, false, null)));
        Assert.True(RunValidation.Validate(new RunRequest("dc01.contoso.local", DeployScope.AuthSilosOnly, false, false, false, true, null)).ContainsKey("scope"));
    }

    [Fact]
    public void Remediation_of_authsilo_findings_plans_AuthSilosOnly()
    {
        var r = Remediation.For("authsilos", "dc01", "en-US");
        Assert.NotNull(r);
        Assert.Equal(DeployScope.AuthSilosOnly, r.Scope);
        Assert.Contains("authsilos", Remediation.Areas);
        Assert.Equal("Authentication Silos", Remediation.AreaLabel("authsilos"));
    }
}

public class DirectoryComparerTests
{
    private const string Dom = "DC=corp,DC=test";

    private static AdAce Ace(string principal, string[] rights, string? objGuid = null, string inheritance = "All", string type = "Allow", bool isDefault = false) =>
        new(principal, null, rights.ToList(), type, objGuid, null, inheritance, isDefault);

    private static AdSnapshot Snapshot(params AdOu[] ous) =>
        new(new AdDomainInfo("corp.test", Dom, "CORP", "Windows2016Domain", "Windows2016Forest", "corp.test", []),
            new AdOu(Dom, "corp.test", "", false, false, null, [], []), ous.ToList(), false);

    private static AdOu Ou(string dn, bool protect = true, bool block = false, List<AdGpoLink>? links = null, List<AdAce>? aces = null) =>
        new(dn, dn.Split(',')[0][3..], DirectoryComparer.ParentOf(dn)!, protect, block, null, links ?? [], aces ?? []);

    private static readonly JsonNode Guids = JsonNode.Parse("""
        { "staticMappings": { "objectClasses": { "Computer": "bf967a86-0de6-11d0-a285-00aa003049e2" },
                              "extendedRights": { "UserForceChangePassword": "00299570-246d-11d0-a768-00aa006e0529" } },
          "specialValues": { "AllObjectClasses": "" },
          "friendlyNameMappings": { "PasswordReset": "UserForceChangePassword" } }
        """)!;

    private static Dictionary<string, JsonNode?> Config(string ous, string acls = "[]", string gpos = "{}") => new()
    {
        ["ous"] = JsonNode.Parse($$"""{ "organizationUnits": {{ous}} }"""),
        ["acls"] = JsonNode.Parse($$"""{ "aclDelegations": {{acls}} }"""),
        ["gpos"] = JsonNode.Parse($$"""{ "gpos": {{gpos}} }"""),
    };

    private static ComparisonResult Compare(Dictionary<string, JsonNode?> config, AdSnapshot snapshot) =>
        DirectoryComparer.Compare(config, snapshot, GuidNames.From(Guids));

    private static OuComparison Item(ComparisonResult r, string dn) => r.Items.Single(i => string.Equals(i.Dn, dn, StringComparison.OrdinalIgnoreCase));

    [Fact]
    public void Missing_extra_and_same_ous_are_detected()
    {
        var config = Config("""[ { "name": "Tier 0", "path": "{{DOMAIN_DN}}", "protectFromAccidentalDeletion": true }, { "name": "Tier 1", "path": "{{DOMAIN_DN}}", "protectFromAccidentalDeletion": true } ]""");
        var r = Compare(config, Snapshot(Ou($"OU=Tier 0,{Dom}"), Ou($"OU=Old,OU=Tier 0,{Dom}", protect: false)));

        Assert.Equal("same", Item(r, $"OU=Tier 0,{Dom}").Status);
        var missing = Item(r, $"OU=Tier 1,{Dom}");
        Assert.Equal("missing", missing.Status);
        Assert.Equal("OU=Tier 1,{{DOMAIN_DN}}", missing.ConfigDn);
        Assert.Equal(1, missing.ConfigIndex);
        var extra = Item(r, $"OU=Old,OU=Tier 0,{Dom}");
        Assert.Equal("extra", extra.Status);
        Assert.Equal("OU=Tier 0", extra.SuggestedPath);
        Assert.False(extra.InConfig);
        Assert.True(r.Items[0].IsRoot);
        Assert.Equal(new ComparisonSummary(2, 1, 1, 0), r.Summary);
    }

    [Fact]
    public void Dn_comparison_ignores_case_and_spaces()
    {
        var r = Compare(Config("""[ { "name": "Tier 0", "path": "{{DOMAIN_DN}}", "protectFromAccidentalDeletion": true } ]"""),
            Snapshot(Ou("ou=tier 0, dc=corp, dc=test")));
        Assert.Equal(0, r.Summary.Missing + r.Summary.Extra);
    }

    [Fact]
    public void Protection_and_gpo_block_flags_are_compared()
    {
        var r = Compare(Config("""[ { "name": "A", "path": "{{DOMAIN_DN}}", "protectFromAccidentalDeletion": true, "blockGpoInheritance": true } ]"""),
            Snapshot(Ou($"OU=A,{Dom}", protect: false, block: false)));
        var a = Item(r, $"OU=A,{Dom}");
        Assert.Equal("different", a.Status);
        Assert.Contains(a.Differences, d => d.Kind == "protect" && d.Text.Contains("Löschschutz ist im AD aus"));
        Assert.Contains(a.Differences, d => d.Kind == "block-inheritance");
    }

    [Fact]
    public void Aces_match_on_principal_rights_object_type_and_inheritance()
    {
        var acls = """
            [ { "targetOUPath": "OU=A,{{DOMAIN_DN}}", "identityreference": "Tier0Admins", "activedirectoryrights": ["GenericAll", "CreateChild"], "accesscontroltype": "Allow", "objecttype": "Computer", "activeDirectorysecurityinheritance": "Descendents" },
              { "targetOUPath": "OU=A,{{DOMAIN_DN}}", "identityreference": "Helpdesk", "activedirectoryrights": ["ExtendedRight"], "accesscontroltype": "Allow", "objecttype": "PasswordReset", "activeDirectorysecurityinheritance": "Descendents" },
              { "targetOUPath": "OU=A,{{DOMAIN_DN}}", "identityreference": "Readers", "activedirectoryrights": ["ReadProperty"], "accesscontroltype": "Allow", "objecttype": "AllObjectClasses", "activeDirectorysecurityinheritance": "All" },
              { "targetOUPath": "OU=A,{{DOMAIN_DN}}", "identityreference": "Readers", "activedirectoryrights": ["ListChildren"], "accesscontroltype": "Allow", "objecttype": "", "activeDirectorysecurityinheritance": "All" },
              { "targetOUPath": "OU=A,{{DOMAIN_DN}}", "identityreference": "Writers", "activedirectoryrights": ["WriteProperty"], "accesscontroltype": "Allow", "objecttype": "", "activeDirectorysecurityinheritance": "All" },
              { "targetOUPath": "OU=A,{{DOMAIN_DN}}", "identityreference": "Missing", "activedirectoryrights": ["CreateChild"], "accesscontroltype": "Allow", "objecttype": "Computer", "activeDirectorysecurityinheritance": "All" } ]
            """;
        var ou = Ou($"OU=A,{Dom}", aces:
        [
            Ace(@"CORP\tier0admins", ["GenericAll"], "BF967A86-0DE6-11D0-A285-00AA003049E2", "Descendents"),
            Ace(@"CORP\Helpdesk", ["ExtendedRight"], "00299570-246d-11d0-a768-00aa006e0529", "Descendents"),
            // AD merges both "Readers" entries into one ACE.
            Ace(@"CORP\Readers", ["ReadProperty", "ListChildren"]),
            Ace(@"CORP\Writers", ["WriteProperty", "WriteDacl"]),
            Ace(@"CORP\Intruder", ["GenericAll"]),
            Ace(@"NT AUTHORITY\SYSTEM", ["GenericAll"], isDefault: true),
            Ace("Everyone", ["Delete", "DeleteTree"], type: "Deny"),
        ]);
        var r = Compare(Config("""[ { "name": "A", "path": "{{DOMAIN_DN}}", "protectFromAccidentalDeletion": true } ]""", acls), Snapshot(ou));
        var a = Item(r, $"OU=A,{Dom}");

        Assert.Equal("different", a.Status);
        Assert.Single(a.Differences, d => d.Kind == "ace-missing");
        Assert.Contains(a.Differences, d => d.Kind == "ace-missing" && d.Text.Contains("„Missing“") && d.Text.Contains("„Computer“"));
        Assert.Single(a.Differences, d => d.Kind == "ace-extra");
        Assert.Contains(a.Differences, d => d.Kind == "ace-extra" && d.Text.Contains(@"CORP\Intruder"));
        Assert.Single(a.Differences, d => d.Kind == "ace-rights");
        Assert.Contains(a.Differences, d => d.Kind == "ace-rights" && d.Text.Contains("Writers") && d.Text.Contains("WriteDacl"));
        Assert.Equal(3, a.Differences.Count);
    }

    [Fact]
    public void Gpo_links_missing_extra_order_and_enabled_are_reported()
    {
        var gpos = """
            { "OU=A,{{DOMAIN_DN}}": { "ImportOnlyGpo": [ { "name": "G1", "linkOrder": 1, "linkEnabled": true }, { "name": "G2 [Version]", "rename": "G2", "linkOrder": 2, "linkEnabled": false } ],
                                      "PostConfigureGpo": [ { "name": "G3", "linkOrder": 3 }, { "name": "G4", "linkOrder": 4 } ] },
              "TemplateGpos": { "ImportOnlyGpo": [ { "name": "Template" } ] } }
            """;
        var ou = Ou($"OU=A,{Dom}", links:
        [
            new AdGpoLink("Extra", null, 1, true, false),
            new AdGpoLink("G1", null, 2, true, false),
            new AdGpoLink("G3", null, 3, true, false),
            new AdGpoLink("g2", null, 4, true, false),
        ]);
        var r = Compare(Config("""[ { "name": "A", "path": "{{DOMAIN_DN}}", "protectFromAccidentalDeletion": true } ]""", gpos: gpos), Snapshot(ou));
        var d = Item(r, $"OU=A,{Dom}").Differences;

        Assert.Contains(d, x => x.Kind == "gpo-missing" && x.Text.Contains("„G4“"));
        Assert.Contains(d, x => x.Kind == "gpo-extra" && x.Text.Contains("„Extra“"));
        // G1 stays first among the common links (the extra link does not count); G2 and G3 swapped.
        Assert.DoesNotContain(d, x => x.Kind == "gpo-order" && x.Text.Contains("„G1“"));
        Assert.Contains(d, x => x.Kind == "gpo-order" && x.Text.Contains("„G3“"));
        Assert.Contains(d, x => x.Kind == "gpo-enabled" && x.Text.Contains("„G2“"));
        Assert.DoesNotContain(d, x => x.Text.Contains("Template"));
    }

    [Fact]
    public void Principal_names_are_normalized()
    {
        Assert.Equal("tier0admins", DirectoryComparer.NormalizePrincipal(@"CONTOSO\Tier0Admins"));
        Assert.Equal("tier0admins", DirectoryComparer.NormalizePrincipal("Tier0Admins"));
        Assert.Equal("tier0admins", DirectoryComparer.NormalizePrincipal("tier0admins@contoso.local"));
    }

    [Fact]
    public void Rights_masks_treat_composite_rights_as_equal()
    {
        Assert.Equal(AdRights.Mask(["GenericAll"]), AdRights.Mask(["GenericAll", "CreateChild", "DeleteChild"]));
        Assert.Equal(["GenericAll"], AdRights.Names(AdRights.Mask(["GenericAll", "WriteDacl"])));
        Assert.Equal(["CreateChild", "DeleteChild"], AdRights.Names(3));
        Assert.Contains("GenericRead", AdRights.Names(AdRights.Mask(["GenericRead", "GenericWrite"])));
    }

    [Fact]
    public void GpLink_is_parsed_with_order_enabled_and_enforced()
    {
        var links = WindowsDirectoryReader.ParseGpLink(
            "[LDAP://cn={11111111-1111-1111-1111-111111111111},cn=policies,cn=system,DC=corp,DC=test;0][LDAP://cn={22222222-2222-2222-2222-222222222222},cn=policies,cn=system,DC=corp,DC=test;3]",
            new Dictionary<string, string> { ["{11111111-1111-1111-1111-111111111111}"] = "First" });
        Assert.Equal(2, links.Count);
        Assert.Equal(new AdGpoLink("{22222222-2222-2222-2222-222222222222}", "{22222222-2222-2222-2222-222222222222}", 1, false, true), links[0]);
        Assert.Equal("First", links[1].Name);
        Assert.Equal(2, links[1].Order);
        Assert.True(links[1].Enabled);
    }

    [Fact]
    public void Suggested_path_uses_the_configuration_notation()
    {
        Assert.Equal("{{DOMAIN_DN}}", DirectoryComparer.SuggestedPath(Dom, Dom));
        Assert.Equal("OU=Tier 0,OU=Admin", DirectoryComparer.SuggestedPath($"OU=Tier 0,OU=Admin,{Dom}", Dom));
    }
}

public class FakeDirectoryTests
{
    private static readonly string ConfigDir = Path.Combine(TestPaths.RepoRoot, "config");

    private static Dictionary<string, JsonNode?> ShippedConfig() =>
        ConfigCatalog.Sections.Where(d => File.Exists(Path.Combine(ConfigDir, d.FileName)))
            .ToDictionary(d => d.Key, d => JsonNode.Parse(File.ReadAllText(Path.Combine(ConfigDir, d.FileName))));

    [Fact]
    public void Fake_directory_differs_from_the_shipped_configuration_in_exactly_the_documented_places()
    {
        var reader = new FakeDirectoryReader(ConfigDir);
        var config = ShippedConfig();
        var snapshot = reader.ReadSnapshot(5000);
        var names = GuidNames.From(config["guid-mappings"]);
        names.AddResolved(reader.ResolveGuids(snapshot.Ous.SelectMany(o => o.Aces).Select(a => a.ObjectTypeGuid).OfType<string>()));
        var r = DirectoryComparer.Compare(config, DirectoryService.Enrich(snapshot, names), names);

        var missing = Assert.Single(r.Items, i => i.Status == "missing");
        Assert.Equal(FakeDirectoryReader.MissingOu, missing.Name);
        Assert.Equal(["Archiv", "Legacy Servers"], r.Items.Where(i => i.Status == "extra").Select(i => i.Name).Order().ToArray());
        var different = r.Items.Where(i => i.Status == "different").ToList();
        Assert.Equal(2, different.Count);
        var ace = Assert.Single(Assert.Single(different, i => i.Dn == FakeDirectoryReader.ExtraAceOuDn).Differences);
        Assert.Equal("ace-extra", ace.Kind);
        Assert.Contains("Helpdesk", ace.Text);
        var link = Assert.Single(Assert.Single(different, i => i.Dn == FakeDirectoryReader.ExtraLinkOuDn).Differences);
        Assert.Equal("gpo-extra", link.Kind);
        Assert.Contains(FakeDirectoryReader.ExtraLinkGpo, link.Text);
        Assert.Contains(r.Items, i => i.Builtin && i.Name == "Domain Controllers" && i.Status == "same");
    }

    [Fact]
    public void Fake_directory_is_deterministic_and_serves_objects()
    {
        var a = new FakeDirectoryReader(ConfigDir);
        var b = new FakeDirectoryReader(ConfigDir);
        Assert.Equal(a.ReadSnapshot(5000).Ous.Select(o => o.Dn), b.ReadSnapshot(5000).Ous.Select(o => o.Dn));
        Assert.Equal("contoso.local", a.ReadSnapshot(5000).Domain.DnsName);
        Assert.Equal(3, a.ReadSnapshot(5000).Domain.DomainControllers.Count);
        Assert.True(a.ReadSnapshot(3).Truncated);

        var groupDn = "CN=Tier 0 Admins,OU=Tier 0 Groups,OU=Tier 0,OU=Tier Model Administration," + FakeDirectoryReader.DomainDn;
        Assert.Equal("group", a.ObjectClass(groupDn));
        Assert.NotEmpty(a.GroupMembers(groupDn, 10));
        Assert.Equal("organizationalUnit", a.ObjectClass(FakeDirectoryReader.ExtraOuDn));
        Assert.Null(a.ObjectClass("CN=Nobody," + FakeDirectoryReader.DomainDn));
        Assert.Equal(a.CountChildren(FakeDirectoryReader.ExtraAceOuDn), b.CountChildren(FakeDirectoryReader.ExtraAceOuDn));
    }
}

public class GpoPrefixTests
{
    private static readonly JsonNode Gpos = JsonNode.Parse("""
        { "gpos": { "{{DOMAIN_DN}}": { "PostConfigureGpo": [ { "name": "*- Tier Model Account Restrictions", "linkOrder": 1 } ] },
                    "OU=A,{{DOMAIN_DN}}": { "ImportOnlyGpo": [ { "name": "*- Tier 0 SHF [Version]", "rename": "*- Tier 0 SHF" }, { "name": "Other GPO" } ] } } }
        """)!;

    private static readonly JsonNode Laps = JsonNode.Parse("""{ "winLapsDelegations": [ { "ouDn": "OU=A,{{DOMAIN_DN}}", "decryptorGpoName": "*- Tier 0 LAPS" } ] }""")!;

    [Fact]
    public void Preview_lists_every_gpo_name_with_the_prefix()
    {
        Assert.Equal("*-", GpoPrefix.Detect(Gpos));
        var renames = GpoPrefix.Preview(Gpos, Laps, "*-", "CONTOSO -");
        Assert.Equal(4, renames.Count);
        Assert.Contains(renames, r => r.Field == "rename" && r.To == "CONTOSO - Tier 0 SHF");
        Assert.Contains(renames, r => r.Section == "winlaps" && r.To == "CONTOSO - Tier 0 LAPS");
        Assert.DoesNotContain(renames, r => r.From == "Other GPO");
    }

    [Theory]
    [InlineData("CONTOSO -", null)]
    [InlineData("", "Bitte")]
    [InlineData("A*B", "Nicht erlaubt")]
    [InlineData("123456789012345678901", "Höchstens")]
    public void Prefix_is_validated(string prefix, string? error)
    {
        var result = GpoPrefix.ValidatePrefix(prefix);
        if (error is null) Assert.Null(result);
        else Assert.StartsWith(error, result);
    }

    [Fact]
    public void Detect_finds_a_prefix_that_was_already_replaced()
    {
        var gpos = JsonNode.Parse("""{ "gpos": { "X": { "ImportOnlyGpo": [ { "name": "CORP - Tier 0 A" }, { "name": "CORP - Tier 1 B" }, { "name": "Other" } ] } } }""");
        Assert.Equal("CORP -", GpoPrefix.Detect(gpos));
    }
}

[Collection("api")]
public class Phase3ApiTests(ApiFixture fixture)
{
    private async Task<HttpClient> LoginAsync(string user = ApiFixture.AdminUser, string password = ApiFixture.AdminPassword)
    {
        var client = fixture.Factory!.CreateClient();
        client.DefaultRequestHeaders.Add(TestClientAddressFilter.Header, $"10.3.{Random.Shared.Next(0, 255)}.{Random.Shared.Next(2, 250)}");
        SetXsrf(client, await client.GetAsync("/api/auth/me"));
        var response = await client.PostAsJsonAsync("/api/auth/login", new { username = user, password });
        response.EnsureSuccessStatusCode();
        SetXsrf(client, response);
        return client;
    }

    private static void SetXsrf(HttpClient client, HttpResponseMessage response)
    {
        var cookie = response.Headers.GetValues("Set-Cookie").First(c => c.StartsWith("XSRF-TOKEN="));
        client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        client.DefaultRequestHeaders.Add("X-XSRF-TOKEN", Uri.UnescapeDataString(cookie.Split(';')[0]["XSRF-TOKEN=".Length..]));
    }

    private async Task<HttpClient> UserAsync(string role)
    {
        var admin = await LoginAsync();
        var name = $"{role.ToLowerInvariant()}-{Guid.NewGuid().ToString("N")[..6]}";
        (await admin.PostAsJsonAsync("/api/users", new { username = name, displayName = name, role, password = "Initial-Password-1" })).EnsureSuccessStatusCode();
        var client = await LoginAsync(name, "Initial-Password-1");
        var changed = await client.PostAsJsonAsync("/api/auth/change-password", new { currentPassword = "Initial-Password-1", newPassword = "Changed-Password-2" });
        Assert.Equal(HttpStatusCode.NoContent, changed.StatusCode);
        SetXsrf(client, changed);
        return client;
    }

    [DbFact]
    public async Task Viewer_can_read_the_live_ad_view()
    {
        var viewer = await UserAsync("Viewer");
        var tree = await viewer.GetFromJsonAsync<JsonObject>("/api/ad/tree");
        Assert.True(tree!["available"]!.GetValue<bool>());
        Assert.Equal("Testdaten", tree["source"]!.GetValue<string>());
        Assert.Equal("contoso.local", tree["domain"]!["dnsName"]!.GetValue<string>());
        Assert.Contains(tree["nodes"]!.AsArray(), n => n!["dn"]!.GetValue<string>() == FakeDirectoryReader.ExtraOuDn);

        var ou = await viewer.GetFromJsonAsync<JsonObject>($"/api/ad/object?dn={Uri.EscapeDataString(FakeDirectoryReader.ExtraAceOuDn)}");
        Assert.Equal("organizationalUnit", ou!["kind"]!.GetValue<string>());
        Assert.Contains(ou["aces"]!.AsArray(), a => a!["principal"]!.GetValue<string>() == FakeDirectoryReader.ExtraAcePrincipal);
        Assert.Contains(ou["aces"]!.AsArray(), a => a!["objectType"]!.GetValue<string>() == "Computer");
        Assert.NotNull(ou["ou"]!["counts"]);

        var group = await viewer.GetFromJsonAsync<JsonObject>($"/api/ad/object?dn={Uri.EscapeDataString("CN=Tier 0 Admins,OU=Tier 0 Groups,OU=Tier 0,OU=Tier Model Administration," + FakeDirectoryReader.DomainDn)}");
        Assert.Equal("group", group!["kind"]!.GetValue<string>());
        Assert.NotEmpty(group["members"]!.AsArray());

        Assert.Equal(HttpStatusCode.BadRequest, (await viewer.GetAsync("/api/ad/object?dn=")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await viewer.GetAsync("/api/ad/object?dn=CN%3DSchema%2CCN%3DConfiguration%2CDC%3Dother%2CDC%3Dcom")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await viewer.GetAsync($"/api/ad/object?dn={Uri.EscapeDataString("CN=Nobody," + FakeDirectoryReader.DomainDn)}")).StatusCode);

        var compare = await viewer.GetFromJsonAsync<JsonObject>("/api/ad/compare?refresh=true");
        Assert.True(compare!["available"]!.GetValue<bool>());
        Assert.Contains(compare["result"]!["items"]!.AsArray(), i => i!["status"]!.GetValue<string>() == "extra" && i["name"]!.GetValue<string>() == "Legacy Servers");
    }

    [DbFact]
    public async Task Setup_endpoints_are_admin_only_and_completion_is_stored()
    {
        var viewer = await UserAsync("Viewer");
        Assert.Equal(HttpStatusCode.Forbidden, (await viewer.GetAsync("/api/setup/state")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await viewer.PostAsJsonAsync("/api/setup/complete", new { skipped = true })).StatusCode);
        var editor = await UserAsync("Editor");
        Assert.Equal(HttpStatusCode.Forbidden, (await editor.PostAsJsonAsync("/api/setup/gpo-prefix/preview", new { prefix = "X -" })).StatusCode);

        var admin = await LoginAsync();
        var state = await admin.GetFromJsonAsync<JsonObject>("/api/setup/state");
        Assert.True(state!["directoryAvailable"]!.GetValue<bool>());
        Assert.False(state["completed"]!.GetValue<bool>());
        // Other tests of this collection may already have saved configuration versions.
        Assert.Equal(state["userVersions"]!.GetValue<int>() == 0, state["needed"]!.GetValue<bool>());

        var preview = await admin.PostAsJsonAsync("/api/setup/gpo-prefix/preview", new { prefix = "CONTOSO -" });
        preview.EnsureSuccessStatusCode();
        var p = (await preview.Content.ReadFromJsonAsync<JsonObject>())!;
        Assert.Equal("*-", p["current"]!.GetValue<string>());
        Assert.True(p["gpoCount"]!.GetValue<int>() > 50);
        Assert.All(p["renames"]!.AsArray(), r => Assert.StartsWith("CONTOSO - ", r!["to"]!.GetValue<string>()));
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync("/api/setup/gpo-prefix/preview", new { prefix = "a|b" })).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsJsonAsync("/api/setup/complete", new { skipped = false })).StatusCode);
        state = await admin.GetFromJsonAsync<JsonObject>("/api/setup/state");
        Assert.True(state!["completed"]!.GetValue<bool>());
        Assert.False(state["needed"]!.GetValue<bool>());
        Assert.Equal(ApiFixture.AdminUser, state["completedBy"]!.GetValue<string>());
    }

    [DbFact]
    public async Task AuthSilos_section_is_imported_and_AuthSilosOnly_plans_run()
    {
        var admin = await LoginAsync();
        var section = await admin.GetFromJsonAsync<JsonObject>("/api/config/sections/authsilos");
        Assert.Equal(2, section!["content"]!["authenticationPolicies"]!.AsArray().Count);

        var start = await admin.PostAsJsonAsync("/api/runs/deploy", new
        {
            preferredDc = "dc01.contoso.local", scope = "AuthSilosOnly", includeMsa = false, includeGmsa = false, includeDmsa = false, includeWinLaps = false, confirmApply = false,
        });
        Assert.Equal(HttpStatusCode.Accepted, start.StatusCode);
        var id = (await start.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<long>();
        JsonObject? run = null;
        for (var i = 0; i < 80; i++)
        {
            run = await admin.GetFromJsonAsync<JsonObject>($"/api/runs/{id}");
            if (run!["status"]!.GetValue<string>() is "Succeeded" or "Failed") break;
            await Task.Delay(500);
        }
        Assert.Equal("Succeeded", run!["status"]!.GetValue<string>());
        Assert.Equal("AuthSilosOnly", run["scope"]!.GetValue<string>());
        var plan = await admin.GetFromJsonAsync<JsonObject>($"/api/runs/{id}/plan");
        Assert.All(plan!["actions"]!.AsArray(), a => Assert.Equal("authsilos", a!["area"]!.GetValue<string>()));
        Assert.Contains(plan["actions"]!.AsArray(), a => a!["action"]!.GetValue<string>() == "AssignSilo");

        var audit = await admin.PostAsJsonAsync("/api/runs/audit", new
        {
            preferredDc = "dc01.contoso.local", scope = "AuthSilosOnly", includeMsa = false, includeGmsa = false, includeDmsa = false, includeWinLaps = false,
        });
        var auditId = (await audit.Content.ReadFromJsonAsync<JsonObject>())!["id"]!.GetValue<long>();
        for (var i = 0; i < 80; i++)
        {
            run = await admin.GetFromJsonAsync<JsonObject>($"/api/runs/{auditId}");
            if (run!["status"]!.GetValue<string>() is "Succeeded" or "Failed") break;
            await Task.Delay(500);
        }
        Assert.Equal("Succeeded", run!["status"]!.GetValue<string>());
        Assert.Equal(3, run["driftCount"]!.GetValue<int>());
        Assert.All(run["findings"]!.AsArray(), f => Assert.Equal("authsilos", f!["area"]!.GetValue<string>()));
    }
}
