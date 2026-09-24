using System.Text.Json.Nodes;
using TierModel.Service.Data;
using TierModel.Service.Monitoring;
using TierModel.Service.Notifications;
using TierModel.Service.Runs;

namespace TierModel.Service.Tests;

internal static class Snap
{
    public const string D = "S-1-5-21-1-2-3";

    public static PrivilegedMember M(string rid, string sam, string cls = "user", bool direct = true, string[]? via = null, bool? enabled = true, string? dn = null) =>
        new(rid.StartsWith("S-") ? rid : D + rid, sam, sam, cls, dn ?? $"CN={sam},OU=Users,DC=contoso,DC=local", direct, [.. via ?? []], enabled);

    public static PrivilegedGroup G(string sid, string name, string? wk, params PrivilegedMember[] members) =>
        new(sid.StartsWith("S-") ? sid : D + sid, name, wk, wk is null ? "config" : "builtin", 0, $"CN={name},DC=contoso,DC=local", [.. members]);

    public static PrivilegedAccount A(string sam, int? tier = 0, string cls = "user", bool? enabled = true, int? logonDaysAgo = 1, int? pwDaysAgo = 10,
        bool neverExpires = false, bool notDelegated = true, bool protectedUsers = true, string[]? spns = null, string[]? memberOf = null) =>
        new(D + "-" + sam.GetHashCode().ToString("x"), sam, $"CN={sam},DC=contoso,DC=local", cls, tier, enabled,
            logonDaysAgo is null ? null : Now.AddDays(-logonDaysAgo.Value), pwDaysAgo is null ? null : Now.AddDays(-pwDaysAgo.Value),
            neverExpires, notDelegated, protectedUsers, 1, [.. spns ?? []], [.. memberOf ?? []]);

    public static readonly DateTimeOffset Now = new(2026, 9, 24, 10, 0, 0, TimeSpan.Zero);

    public static PrivilegedSnapshotData Data(PrivilegedGroup[] groups, PrivilegedAccount[]? accounts = null, AdminCountOrphan[]? orphans = null, AclFinding[]? acls = null) =>
        new(new PrivilegedMetadata("1", "dc01", Now, "contoso.local", D, "contoso.local", true), [.. groups], [.. accounts ?? []], [.. orphans ?? []], [.. acls ?? []], []);

    /// <summary>Configuration: Tier0Admins (Tier 0 group), Tier1Admins, users svc-t0 (Tier 0 OU) and t0-alice (member of Tier0Admins).</summary>
    public static Tier0Config Config() => Tier0Config.From(new Dictionary<string, JsonNode?>
    {
        ["groups"] = JsonNode.Parse("""
            {"groups":[
            {"name":"Tier 0 Admins","samaccountname":"Tier0Admins","path":"OU=Tier 0 Groups,{{DOMAIN_DN}}"},
            {"name":"PAW Domain Join","samaccountname":"PAWDomainJoin","path":"OU=Tier 0 Groups,OU=Tier 0,{{DOMAIN_DN}}"},
            {"name":"Tier 1 Admins","samaccountname":"Tier1Admins","path":"OU=Tier 1 Groups,{{DOMAIN_DN}}"}]}
            """),
        ["users"] = JsonNode.Parse("""
            {"users":[
            {"samAccountName":"svc-t0","ouPath":"OU=Tier 0 Service Accounts,{{DOMAIN_DN}}","memberOf":[]},
            {"samAccountName":"t0-alice","ouPath":"OU=Admins,{{DOMAIN_DN}}","memberOf":["Tier0Admins"]},
            {"samAccountName":"t1-bob","ouPath":"OU=Tier 1 Accounts,{{DOMAIN_DN}}","memberOf":["Tier1Admins"]}]}
            """),
    });
}

public class PrivilegedSnapshotReaderTests
{
    [Fact]
    public void Parses_the_contract_including_pascal_case_and_single_objects()
    {
        // ConvertTo-Json writes one-element arrays as objects; keys may come in PascalCase.
        var data = PrivilegedSnapshotReader.Parse("""
            { "Metadata": { "Version": "1", "PreferredDc": "dc01", "Timestamp": "2026-09-24T10:00:00Z", "DomainSid": "S-1-5-21-1-2-3" },
              "Groups": { "Sid": "S-1-5-21-1-2-3-512", "Name": "Domänen-Admins", "WellKnownName": "Domain Admins", "Source": "builtin", "Tier": 0,
                          "Members": { "Sid": "S-1-5-21-1-2-3-500", "SamAccountName": "Administrator", "ObjectClass": "user", "Direct": true, "Via": null, "Enabled": true } },
              "Accounts": { "Sid": "S-1-5-21-1-2-3-500", "SamAccountName": "Administrator", "ObjectClass": "user", "Tier": 0, "ServicePrincipalNames": "http/x", "MemberOfPrivileged": "Domain Admins", "LastLogon": null },
              "AclFindings": [ { "ObjectDn": "DC=x", "ObjectType": "DomainRoot", "ObjectName": "x", "PrincipalSid": "S-1-5-21-1-2-3-1100", "PrincipalName": "X\\Helpdesk", "PrincipalClass": "group", "Rights": "WriteDacl", "MemberCount": 3, "SampleMembers": "a" } ],
              "Errors": null }
            """);
        var g = Assert.Single(data.Groups);
        Assert.Equal("Domain Admins", g.WellKnownName);
        var m = Assert.Single(g.Members);
        Assert.Empty(m.Via);
        Assert.True(m.IsDirect);
        var a = Assert.Single(data.Accounts);
        Assert.Equal(["http/x"], a.ServicePrincipalNames);
        Assert.Equal(["Domain Admins"], a.MemberOfPrivileged);
        Assert.Null(a.LastLogon);
        Assert.Equal(["WriteDacl"], Assert.Single(data.AclFindings).Rights);
        Assert.Empty(data.AdminCountOrphans);
        Assert.Empty(data.Errors);
        Assert.Equal(new DateTimeOffset(2026, 9, 24, 10, 0, 0, TimeSpan.Zero), data.Metadata.Timestamp);
    }

    [Fact]
    public void Members_without_sid_are_skipped_and_duplicates_removed()
    {
        var data = PrivilegedSnapshotReader.Parse("""
            {"groups":[{"sid":"S-1-5-32-544","name":"Administratoren","members":[
              {"sid":"S-1-5-21-1-2-3-500","samAccountName":"Administrator","objectClass":"user","direct":true,"via":[]},
              {"sid":"s-1-5-21-1-2-3-500","samAccountName":"Administrator","objectClass":"user","direct":false,"via":["X"]},
              {"samAccountName":"ghost","objectClass":"user"}]}]}
            """);
        Assert.Single(Assert.Single(data.Groups).Members);
    }

    [Theory]
    [InlineData("")]
    [InlineData("{ \"metadata\": { \"version\": \"1\", ")]
    [InlineData("[1,2]")]
    [InlineData("{ \"metadata\": {} }")]
    [InlineData("{ \"groups\": [ { \"name\": \"no sid\" } ] }")]
    [InlineData("{ \"groups\": [], \"accounts\": [ { \"sid\": \"S-1\", \"lastLogon\": \"gestern\" } ] }")]
    public void Unusable_files_are_rejected_with_a_german_message(string json)
    {
        var ex = Assert.Throws<FormatException>(() => PrivilegedSnapshotReader.Parse(json));
        Assert.Contains("Ergebnisdatei", ex.Message);
    }

    [Fact]
    public void Serialized_snapshot_round_trips()
    {
        var data = Snap.Data([Snap.G("-512", "Domain Admins", "Domain Admins", Snap.M("-500", "Administrator"))]);
        var copy = PrivilegedSnapshotReader.Deserialize(PrivilegedSnapshotReader.Serialize(data))!;
        Assert.Equal("Administrator", copy.Groups[0].Members[0].SamAccountName);
        Assert.DoesNotContain("isDirect", PrivilegedSnapshotReader.Serialize(data));
    }
}

public class PrivilegedEvaluatorTests
{
    private static readonly HygieneThresholds T = HygieneThresholds.Default;

    [Fact]
    public void Diff_reports_added_and_removed_members_and_ignores_new_groups()
    {
        var before = Snap.Data([Snap.G("-512", "Domänen-Admins", "Domain Admins", Snap.M("-500", "Administrator"), Snap.M("-1201", "t0-alice"))]);
        var after = Snap.Data([
            Snap.G("-512", "Domänen-Admins", "Domain Admins", Snap.M("-500", "Administrator"), Snap.M("-2301", "helpdesk-jan")),
            Snap.G("-1105", "Tier 0 Admins", null, Snap.M("-1201", "t0-alice"))]);

        var changes = PrivilegedEvaluator.Diff(after, before);

        Assert.Equal(2, changes.Count);
        Assert.Contains(changes, c => c.Change == "Added" && c.MemberSam == "helpdesk-jan" && c.GroupName == "Domänen-Admins");
        Assert.Contains(changes, c => c.Change == "Removed" && c.MemberSam == "t0-alice");
    }

    [Fact]
    public void Nested_changes_are_reported_only_at_the_monitored_group_that_holds_the_member()
    {
        var before = Snap.Data([
            Snap.G("S-1-5-32-544", "Administratoren", "Administrators", Snap.M("-512", "Domänen-Admins", "group")),
            Snap.G("-512", "Domänen-Admins", "Domain Admins")]);
        var after = Snap.Data([
            Snap.G("S-1-5-32-544", "Administratoren", "Administrators", Snap.M("-512", "Domänen-Admins", "group"),
                Snap.M("-2301", "helpdesk-jan", direct: false, via: ["Domänen-Admins"])),
            Snap.G("-512", "Domänen-Admins", "Domain Admins", Snap.M("-2301", "helpdesk-jan"))]);

        var change = Assert.Single(PrivilegedEvaluator.Diff(after, before));
        Assert.Equal("Domänen-Admins", change.GroupName);
    }

    [Fact]
    public void Default_nesting_builtin_administrator_and_domain_controllers_are_expected()
    {
        var data = Snap.Data([
            // Localized names on purpose: matching uses SIDs only.
            Snap.G("S-1-5-32-544", "Administratoren", "Administrators", Snap.M("-500", "Administrator"), Snap.M("-512", "Domänen-Admins", "group"),
                Snap.M("-519", "Organisations-Admins", "group")),
            Snap.G("-512", "Domänen-Admins", "Domain Admins", Snap.M("-500", "Administrator")),
            Snap.G("-516", "Domänencontroller", "Domain Controllers", Snap.M("-1001", "DC01$", "computer"))]);

        Assert.Empty(PrivilegedEvaluator.Unexpected(data, Snap.Config()));
    }

    [Fact]
    public void Default_nesting_is_group_specific()
    {
        // Domain Admins in Administrators is standard – Enterprise Admins inside Domain Admins is not.
        var data = Snap.Data([Snap.G("-512", "Domain Admins", "Domain Admins", Snap.M("-519", "Enterprise Admins", "group"))]);
        Assert.Single(PrivilegedEvaluator.Unexpected(data, Snap.Config()));
        // A computer in Domain Admins is not a domain controller membership.
        var computer = Snap.Data([Snap.G("-512", "Domain Admins", "Domain Admins", Snap.M("-1001", "SRV01$", "computer"))]);
        Assert.Single(PrivilegedEvaluator.Unexpected(computer, Snap.Config()));
    }

    [Fact]
    public void Configured_tier0_groups_and_accounts_are_expected_everything_else_not()
    {
        var data = Snap.Data([Snap.G("-512", "Domain Admins", "Domain Admins",
            Snap.M("-1105", "Tier0Admins", "group"),
            Snap.M("-1106", "PAWDomainJoin", "group"),               // Tier 0 by its path
            Snap.M("-1201", "t0-alice"),                              // member of a Tier 0 group in the users section
            Snap.M("-1301", "svc-t0"),                                // in a Tier 0 OU in the users section
            Snap.M("-1302", "t0-dave", dn: "CN=t0-dave,OU=Accounts,OU=Tier 0,DC=contoso,DC=local"),   // located in a Tier 0 OU
            Snap.M("-1401", "t1-bob"),                                // Tier 1 account
            Snap.M("-1402", "Tier1Admins", "group"),
            Snap.M("-1403", "fake", dn: "CN=Tier 0 fake,OU=Users,DC=contoso,DC=local"),              // "Tier 0" only in its own name
            Snap.M("-1404", "helpdesk", "group"))]);

        var unexpected = PrivilegedEvaluator.Unexpected(data, Snap.Config()).Select(u => u.MemberSam).ToList();

        Assert.Equal(["t1-bob", "Tier1Admins", "fake", "helpdesk"], unexpected);
    }

    [Fact]
    public void Unexpected_nested_members_of_unmonitored_groups_are_reported_with_their_path()
    {
        var data = Snap.Data([Snap.G("S-1-5-32-544", "Administratoren", "Administrators",
            Snap.M("-1404", "Helpdesk", "group"),
            Snap.M("-2301", "jan", direct: false, via: ["Helpdesk"]))]);

        var unexpected = PrivilegedEvaluator.Unexpected(data, Snap.Config());

        Assert.Equal(2, unexpected.Count);
        Assert.Equal(["Helpdesk"], unexpected.Single(u => u.MemberSam == "jan").Via);
    }

    [Fact]
    public void Evaluation_counts_drift_and_only_new_findings_are_notable()
    {
        var config = Snap.Config();
        var first = Snap.Data([Snap.G("-512", "Domain Admins", "Domain Admins", Snap.M("-2301", "jan"))]);
        var e1 = PrivilegedEvaluator.Evaluate(first, null, null, config, T, Snap.Now);
        Assert.True(e1.Baseline);
        Assert.Empty(e1.Changes);
        Assert.Equal(1, e1.DriftCount);
        Assert.Contains(e1.NewFindings, l => l.Contains("jan"));

        var e2 = PrivilegedEvaluator.Evaluate(first, first, e1, config, T, Snap.Now);
        Assert.False(e2.Baseline);
        Assert.Empty(e2.NewFindings);
        Assert.False(e2.Notify);

        var third = Snap.Data([Snap.G("-512", "Domain Admins", "Domain Admins", Snap.M("-2301", "jan"), Snap.M("-2302", "lea"))]);
        var e3 = PrivilegedEvaluator.Evaluate(third, first, e2, config, T, Snap.Now);
        Assert.Equal(3, e3.DriftCount);   // 2 unexpected + 1 change
        Assert.True(e3.Notify);
        Assert.Equal(["+ lea zu Domain Admins hinzugefügt", "Nicht erwartet: lea in Domain Admins"], PrivilegedEvaluator.NotificationLines(e3));
    }

    [Fact]
    public void Notification_lines_are_capped()
    {
        var changes = Enumerable.Range(1, 15).Select(i => new MembershipChange("Added", "g", "Domain Admins", $"s{i}", $"u{i}", $"u{i}", "user", true, [])).ToList();
        var lines = PrivilegedEvaluator.NotificationLines(new PrivilegedEvaluation(false, changes, [], [], [], [], T));
        Assert.Equal(10, lines.Count);
        Assert.Equal("… und 6 weitere", lines[^1]);
    }
}

public class HygieneTests
{
    private static readonly HygieneThresholds T = new(90, 365);

    private static List<HygieneFinding> Run(params PrivilegedAccount[] accounts) =>
        PrivilegedEvaluator.Hygiene(Snap.Data([], accounts), T, Snap.Now);

    [Fact]
    public void Clean_tier0_account_has_no_findings() => Assert.Empty(Run(Snap.A("t0-alice")));

    [Fact]
    public void Tier0_user_outside_protected_users_with_delegation_is_flagged()
    {
        var f = Run(Snap.A("t0-x", protectedUsers: false, notDelegated: false));
        Assert.Contains(f, x => x.Rule == "NotInProtectedUsers" && x.Severity == "Medium");
        Assert.Contains(f, x => x.Rule == "DelegationAllowed" && x.Severity == "High");
    }

    [Fact]
    public void Protected_users_rule_is_for_tier0_users_only()
    {
        Assert.Empty(Run(Snap.A("DC01$", cls: "computer", protectedUsers: false, notDelegated: false)));
        Assert.Empty(Run(Snap.A("gmsa$", cls: "msDS-GroupManagedServiceAccount", protectedUsers: false, notDelegated: false)));
        var tier1 = Run(Snap.A("t1-x", tier: 1, protectedUsers: false, notDelegated: false));
        Assert.DoesNotContain(tier1, x => x.Rule == "NotInProtectedUsers");
        Assert.Contains(tier1, x => x.Rule == "DelegationAllowed" && x.Severity == "Medium");
    }

    [Theory]
    [InlineData(365, false)]
    [InlineData(366, true)]
    public void Password_age_threshold(int days, bool flagged) =>
        Assert.Equal(flagged, Run(Snap.A("t0-x", pwDaysAgo: days)).Any(x => x.Rule == "PasswordOld"));

    [Fact]
    public void Password_never_set_is_old() =>
        Assert.Contains(Run(Snap.A("t0-x", pwDaysAgo: null)), x => x.Rule == "PasswordOld" && x.Value.Contains("nie"));

    [Theory]
    [InlineData(90, false)]
    [InlineData(91, true)]
    public void Stale_threshold(int days, bool flagged) =>
        Assert.Equal(flagged, Run(Snap.A("t0-x", logonDaysAgo: days)).Any(x => x.Rule == "Stale" && x.Severity == "Low"));

    [Fact]
    public void Never_logged_on_is_stale_but_thresholds_are_configurable()
    {
        Assert.Contains(Run(Snap.A("t0-x", logonDaysAgo: null)), x => x.Rule == "Stale" && x.Value.Contains("nie"));
        var lenient = PrivilegedEvaluator.Hygiene(Snap.Data([], [Snap.A("t0-x", logonDaysAgo: 120, pwDaysAgo: 500)]), new HygieneThresholds(180, 730), Snap.Now);
        Assert.Empty(lenient);
    }

    [Fact]
    public void Spn_on_privileged_user_is_high_otherwise_medium()
    {
        Assert.Contains(Run(Snap.A("svc", spns: ["MSSQLSvc/sql01:1433"], memberOf: ["Domain Admins"])), x => x.Rule == "HasSpn" && x.Severity == "High");
        Assert.Contains(Run(Snap.A("svc", tier: 1, spns: ["http/web01"])), x => x.Rule == "HasSpn" && x.Severity == "Medium");
        Assert.DoesNotContain(Run(Snap.A("DC01$", cls: "computer", spns: ["ldap/dc01"], memberOf: ["Domain Controllers"])), x => x.Rule == "HasSpn");
    }

    [Fact]
    public void Disabled_privileged_account_orphans_and_never_expiring_passwords()
    {
        var f = PrivilegedEvaluator.Hygiene(Snap.Data([],
            [Snap.A("old", enabled: false, pwDaysAgo: 900, logonDaysAgo: 900, memberOf: ["Backup Operators"]), Snap.A("t0-y", neverExpires: true)],
            [new AdminCountOrphan(Snap.D + "-9", "ex-admin", "CN=ex-admin,OU=Users,DC=x", "user")]), T, Snap.Now);

        // Disabled accounts only get the membership finding, no password or logon findings.
        Assert.Equal(["DisabledButPrivileged"], f.Where(x => x.Account == "old").Select(x => x.Rule));
        Assert.Contains(f, x => x.Rule == "PasswordNeverExpires" && x.Account == "t0-y" && x.Severity == "Low");
        Assert.Contains(f, x => x.Rule == "OrphanedAdminCount" && x.Account == "ex-admin" && x.Severity == "Low");
    }

    [Fact]
    public void Accounts_outside_tier0_and_1_without_privileged_membership_are_ignored() =>
        Assert.Empty(Run(Snap.A("user", tier: null, protectedUsers: false, notDelegated: false, pwDaysAgo: 999)));
}

public class AttackPathTests
{
    private static AclFinding Acl(string principal, string sid, string cls = "group", string[]? rights = null, int? count = 12, string[]? samples = null,
        string type = "ProtectedGroup", string name = "Domain Admins") =>
        new($"CN={name},DC=x", type, name, sid.StartsWith("S-") ? sid : Snap.D + sid, principal, cls, [.. rights ?? ["WriteDacl"]], null, false, count, [.. samples ?? []]);

    [Fact]
    public void Tier0_principals_are_filtered_out()
    {
        var data = Snap.Data([Snap.G("-1105", "Tier 0 Admins", null)], acls:
        [
            Acl("CONTOSO\\Domain Admins", "-512"),
            Acl("CONTOSO\\Tier0Admins", "-1105"),
            Acl("CONTOSO\\PAWDomainJoin", "-1106"),          // configured Tier 0 group
            Acl("CONTOSO\\t0-alice", "-1201", "user"),        // configured Tier 0 account
            Acl("NT AUTHORITY\\SYSTEM", "S-1-5-18", "other"),
            Acl("CONTOSO\\Tier 0 Operators", "-1107"),        // Tier 0 by its name
            Acl("CONTOSO\\Helpdesk", "-1301", samples: ["jan", "lea"]),
        ]);

        var path = Assert.Single(PrivilegedEvaluator.AttackPaths(data, Snap.Config()));

        Assert.Equal("Helpdesk (Gruppe, 12 Mitglieder) hat WriteDacl auf Domain Admins (geschützte Gruppe)", path.Sentence);
        Assert.Equal("Über die Mitgliedschaft in Helpdesk: jan, lea und 10 weitere", path.MembershipPath);
        Assert.Equal("High", path.Severity);
    }

    [Fact]
    public void Users_get_a_single_step_sentence_with_all_rights()
    {
        var data = Snap.Data([], acls: [Acl("CONTOSO\\svc-sync", "-1302", "user", ["GenericAll", "WriteOwner", "Owner"], null, type: "DomainRoot", name: "contoso.local")]);
        var path = Assert.Single(PrivilegedEvaluator.AttackPaths(data, Snap.Config()));
        Assert.Equal("svc-sync (Benutzer) hat GenericAll, WriteOwner und Owner auf contoso.local (Domänenstamm)", path.Sentence);
        Assert.Null(path.MembershipPath);
    }
}

public class ComplianceTests
{
    private static PrivilegedEvaluation Eval(int unexpected = 0, int paths = 0, params HygieneFinding[] hygiene) => new(false, [],
        Enumerable.Range(0, unexpected).Select(i => new UnexpectedMember("g", "Domain Admins", $"m{i}", null, $"m{i}", "user", true, [], true)).ToList(),
        [.. hygiene],
        Enumerable.Range(0, paths).Select(i => new AttackPath("dn", "DomainRoot", "x", $"p{i}", "p", "user", ["GenericAll"], null, [], false, "High", "s", null)).ToList(),
        [], HygieneThresholds.Default);

    private static HygieneFinding H(int? tier, string severity) => new("Stale", "t", severity, "s", "a", null, "user", tier, "v");

    [Fact]
    public void Nothing_found_means_100_everywhere() =>
        Assert.All(ComplianceCalculator.Calculate([], Eval()), t => Assert.Equal(100, t.Score));

    [Fact]
    public void Audit_findings_are_weighted_by_severity_and_tier_from_the_identifier()
    {
        var scores = ComplianceCalculator.Calculate(
        [
            new("OU=Tier 1 Accounts,OU=Tier 1,DC=x", "High"),     // tier 1: -10
            new("Tier1Admins", "Low"),                             // tier 1: -2
            new("Tier0Admins", null),                              // tier 0: Medium -5
            new("Domain Users", "High"),                           // no tier: not scored
        ], null);
        Assert.Equal([95, 88, 100], scores.Select(s => s.Score));
        Assert.Equal(10, scores[1].Deductions[0].Points);
    }

    [Fact]
    public void Monitor_findings_are_weighted_and_the_score_is_clamped()
    {
        var scores = ComplianceCalculator.Calculate(null, Eval(2, 1, H(0, "High"), H(1, "Medium"), H(1, "Low"), H(null, "High")));
        Assert.Equal(100 - 30 - 20 - 8, scores[0].Score);
        Assert.Equal(100 - 4 - 1, scores[1].Score);
        Assert.Equal(100, scores[2].Score);
        Assert.Equal(0, ComplianceCalculator.Calculate(null, Eval(unexpected: 10))[0].Score);
        Assert.Contains(scores[0].Deductions, d => d.Category == "unexpected" && d.Label == "2 nicht erwartete Mitglieder in geschützten Gruppen");
    }

    [Fact]
    public void Findings_json_of_a_run_is_read() =>
        Assert.Equal("High", ComplianceCalculator.AuditFindings("""[{"identifier":"Tier0Admins","severity":"High","area":"groups"}]""")[0].Severity);
}

public class MonitorRunTests
{
    [Theory]
    [InlineData("ous", DeployScope.OuOnly)]
    [InlineData("groups", DeployScope.GroupOnly)]
    [InlineData("users", DeployScope.UserOnly)]
    [InlineData("gpos", DeployScope.GposOnly)]
    [InlineData("acls", DeployScope.OuAclsOnly)]
    [InlineData("ADMX", DeployScope.AdmxOnly)]
    public void Core_areas_map_to_a_scope(string area, DeployScope scope)
    {
        var r = Remediation.For(area, "dc01.contoso.local", "de-DE")!;
        Assert.Equal(scope, r.Scope);
        Assert.False(r.IncludeMsa || r.IncludeGmsa || r.IncludeDmsa || r.IncludeWinLaps);
        Assert.Equal("de-DE", r.AdmlLanguage);
        Assert.Empty(RunValidation.Validate(r));
    }

    [Fact]
    public void Extension_areas_map_to_an_include_without_scope()
    {
        Assert.True(Remediation.For("msa", "dc01", null)!.IncludeMsa);
        Assert.True(Remediation.For("gmsa", "dc01", null)!.IncludeGmsa);
        Assert.True(Remediation.For("dmsa", "dc01", null)!.IncludeDmsa);
        var laps = Remediation.For("winlaps", "dc01", null)!;
        Assert.True(laps.IncludeWinLaps);
        Assert.Null(laps.Scope);
        Assert.Empty(RunValidation.Validate(laps));
        Assert.Null(Remediation.For("schema", "dc01", null));
        Assert.All(Remediation.Areas, a => Assert.NotNull(Remediation.For(a, "dc01", null)));
    }

    [Fact]
    public void Monitor_run_calls_the_watch_script_with_an_output_path()
    {
        var run = new Run { Id = 7, Kind = RunKind.Monitor, PreferredDc = "dc01.contoso.local", AdmlLanguage = "en-US", RequestedBy = "admin" };
        var p = RunWorker.ScriptParameters(run, "/work");
        Assert.Equal(["-PreferredDc", "'dc01.contoso.local'", "-OutputPath", $"'{Path.Combine("/work", "out", "privileged.json")}'"], p);
        Assert.Contains("'Watch-TierModelPrivilegedGroups.ps1'", RunWorker.BuildWrapperScript(run, "/work"));
    }

    [Fact]
    public void Monitor_requests_validate_only_the_domain_controller()
    {
        Assert.Empty(RunValidation.ValidateMonitor(new MonitorRequest("dc01.contoso.local").ToRunRequest()));
        Assert.Contains("preferredDc", RunValidation.ValidateMonitor(new MonitorRequest("dc01; rm -rf").ToRunRequest()).Keys);
    }

    [Fact]
    public void Privileged_change_notification_only_for_successful_monitor_runs_with_changes()
    {
        var run = new Run { Kind = RunKind.Monitor, Status = RunStatus.Succeeded, PreferredDc = "dc", AdmlLanguage = "en-US", RequestedBy = "x", DriftCount = 3 };
        Assert.Equal([NotificationEvent.PrivilegedChange], NotificationService.EventsFor(run, privilegedChange: true));
        Assert.Empty(NotificationService.EventsFor(run, privilegedChange: false));
        var channel = new NotificationChannel { Name = "c", TargetProtected = "", TargetDisplay = "", OnPrivilegedChange = true };
        Assert.True(NotificationService.Wants(channel, NotificationEvent.PrivilegedChange));
        Assert.False(NotificationService.Wants(channel, NotificationEvent.Drift));
    }

    [Fact]
    public void Privileged_change_message_lists_the_changes()
    {
        var run = new Run { Id = 9, Kind = RunKind.Monitor, Status = RunStatus.Succeeded, PreferredDc = "dc01", AdmlLanguage = "en-US", RequestedBy = "Zeitplan: x" };
        var e = new PrivilegedEvaluation(false, [new("Added", "g", "Domänen-Admins", "s", "jan", "Jan", "user", true, [])], [], [], [], ["Nicht erwartet: Jan in Domänen-Admins"], HygieneThresholds.Default);
        var m = NotificationService.BuildMessage(NotificationEvent.PrivilegedChange, run, "https://tm.contoso.local", evaluation: e);
        Assert.Equal("Privilegierte Gruppen: 1 hinzugefügt, 1 neuer Befund", m.Title);
        Assert.Equal("+ Jan zu Domänen-Admins hinzugefügt\nNicht erwartet: Jan in Domänen-Admins", m.Text);
        Assert.Equal("https://tm.contoso.local/privilegiert", m.Url);
    }
}
