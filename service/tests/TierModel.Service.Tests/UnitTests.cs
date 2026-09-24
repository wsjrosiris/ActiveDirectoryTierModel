using System.Text.Json.Nodes;
using TierModel.Service.Config;
using TierModel.Service.Data;
using TierModel.Service.Runs;

namespace TierModel.Service.Tests;

public class ConfigValidatorTests
{
    private static Dictionary<string, JsonNode?> Sections(string ous, string groups = "[]", string acls = "[]") => new()
    {
        ["ous"] = JsonNode.Parse($"{{\"organizationUnits\": {ous}}}"),
        ["groups"] = JsonNode.Parse($"{{\"groups\": {groups}}}"),
        ["acls"] = JsonNode.Parse($"{{\"aclDelegations\": {acls}}}"),
    };

    [Theory]
    [InlineData("Tier 0", "{{DOMAIN_DN}}", "OU=Tier 0,{{DOMAIN_DN}}")]
    [InlineData("Accounts", "OU=Tier 0,OU=Admin", "OU=Accounts,OU=Tier 0,OU=Admin,{{DOMAIN_DN}}")]
    [InlineData("Accounts", "OU=Tier 0,{{DOMAIN_DN}}", "OU=Accounts,OU=Tier 0,{{DOMAIN_DN}}")]
    public void OuDn_resolves_relative_parent_paths(string name, string path, string expected) =>
        Assert.Equal(expected, ConfigValidator.OuDn(name, path));

    [Fact]
    public void Real_framework_configuration_is_valid()
    {
        var configDir = Path.Combine(TestPaths.RepoRoot, "config");
        var sections = ConfigCatalog.Sections
            .Where(d => File.Exists(Path.Combine(configDir, d.FileName)))
            .ToDictionary(d => d.Key, d => JsonNode.Parse(File.ReadAllText(Path.Combine(configDir, d.FileName))));

        var issues = ConfigValidator.Validate(sections);

        Assert.Empty(issues);
    }

    [Fact]
    public void Missing_parent_ou_is_an_error()
    {
        var issues = ConfigValidator.Validate(Sections("""[{"name":"Child","path":"OU=Missing"}]"""));
        Assert.Contains(issues, i => i.Severity == "Error" && i.Section == "ous" && i.Message.Contains("OU=Missing"));
    }

    [Fact]
    public void Duplicate_group_sam_is_an_error_and_unknown_principal_a_warning()
    {
        var issues = ConfigValidator.Validate(Sections(
            """[{"name":"Tier 0","path":"{{DOMAIN_DN}}"}]""",
            """[{"name":"A","samaccountname":"Admins","path":"OU=Tier 0,{{DOMAIN_DN}}"},{"name":"B","samaccountname":"admins","path":"OU=Tier 0,{{DOMAIN_DN}}"}]""",
            """[{"targetOUPath":"OU=Tier 0,{{DOMAIN_DN}}","identityreference":"Nobody","activedirectoryrights":["GenericAll"]}]"""));

        Assert.Contains(issues, i => i.Severity == "Error" && i.Message.Contains("doppelt"));
        Assert.Contains(issues, i => i.Severity == "Warning" && i.Message.Contains("Nobody"));
    }
}

public class RunTests
{
    private static RunRequest Request(string dc = "dc01.contoso.com", DeployScope? scope = DeployScope.FullDeployment, string? lang = null) =>
        new(dc, scope, false, false, false, false, lang);

    [Theory]
    [InlineData("dc01")]
    [InlineData("dc01.contoso.com")]
    [InlineData("DC-01.sub.contoso.local")]
    public void Valid_domain_controller_names_are_accepted(string dc) => Assert.Empty(RunValidation.Validate(Request(dc)));

    [Theory]
    [InlineData("")]
    [InlineData("dc01; Remove-Item C:\\")]
    [InlineData("-ConfirmApply")]
    [InlineData("dc01 -ConfirmApply")]
    [InlineData("dc01.contoso.com\"")]
    public void Unsafe_domain_controller_names_are_rejected(string dc) =>
        Assert.True(RunValidation.Validate(Request(dc)).ContainsKey("preferredDc"));

    [Fact]
    public void Scope_or_include_is_required() =>
        Assert.True(RunValidation.Validate(Request(scope: null)).ContainsKey("scope"));

    [Fact]
    public void Adml_language_is_validated() =>
        Assert.True(RunValidation.Validate(Request(lang: "en-US;x")).ContainsKey("admlLanguage"));

    [Fact]
    public void Apply_deploy_passes_confirm_and_unattended()
    {
        var run = new Run { Kind = RunKind.Deploy, Mode = RunMode.Apply, Scope = DeployScope.OuOnly, IncludeWinLaps = true, PreferredDc = "dc01", AdmlLanguage = "de-DE", RequestedBy = "t" };
        var args = RunWorker.BuildArguments(run, "/w");

        Assert.Equal(Path.Combine("/w", "Deploy-TierModel.ps1"), args[args.IndexOf("-File") + 1]);
        Assert.Contains("-OuOnly", args);
        Assert.Contains("-IncludeWinLaps", args);
        Assert.Contains("-ConfirmApply", args);
        Assert.Contains("-Unattended", args);
        Assert.Equal("de-DE", args[args.IndexOf("-AdmlLanguage") + 1]);
    }

    [Fact]
    public void Plan_deploy_never_applies()
    {
        var run = new Run { Kind = RunKind.Deploy, Mode = RunMode.Plan, Scope = DeployScope.FullDeployment, PreferredDc = "dc01", AdmlLanguage = "en-US", RequestedBy = "t" };
        var args = RunWorker.BuildArguments(run, "/w");

        Assert.DoesNotContain("-ConfirmApply", args);
        Assert.DoesNotContain("-Unattended", args);
    }

    [Fact]
    public void Audit_requests_a_json_report()
    {
        var run = new Run { Kind = RunKind.Audit, Scope = DeployScope.GposOnly, PreferredDc = "dc01", AdmlLanguage = "en-US", RequestedBy = "t" };
        var args = RunWorker.BuildArguments(run, "/w");

        Assert.Equal(Path.Combine("/w", "Audit-TierModel.ps1"), args[args.IndexOf("-File") + 1]);
        Assert.Equal("Json", args[args.IndexOf("-OutputFormat") + 1]);
        Assert.DoesNotContain("-ConfirmApply", args);
    }

    [Theory]
    [InlineData("stderr", "anything", "error")]
    [InlineData("stdout", "ERROR: failed to create OU", "error")]
    [InlineData("stdout", "Total Errors: 0", "success")]
    [InlineData("stdout", "WARNING: drift detected", "warn")]
    [InlineData("stdout", "Deployment completed successfully", "success")]
    [InlineData("stdout", "Processing OU Tier 0", "info")]
    public void Log_lines_are_classified(string stream, string text, string level) =>
        Assert.Equal(level, RunLogWriter.Classify(stream, text));
}

public class ScheduleTests
{
    [Fact]
    public void Next_occurrence_is_returned_in_utc()
    {
        var after = new DateTimeOffset(2026, 7, 1, 12, 0, 0, TimeSpan.Zero);
        var next = ScheduleWorker.NextOccurrence("0 2 * * *", "Europe/Berlin", after);

        Assert.Equal(TimeSpan.Zero, next!.Value.Offset);
        Assert.Equal(new DateTimeOffset(2026, 7, 2, 0, 0, 0, TimeSpan.Zero), next); // 02:00 CEST = 00:00 UTC
    }

    [Theory]
    [InlineData("0 2 * * *", "Europe/Berlin", true)]
    [InlineData("61 * * * *", "Europe/Berlin", false)]
    [InlineData("0 2 * * *", "Mars/Olympus", false)]
    public void Cron_and_timezone_are_validated(string cron, string tz, bool valid) =>
        Assert.Equal(valid, ScheduleWorker.Validate(cron, tz) is null);
}

internal static class TestPaths
{
    public static string RepoRoot
    {
        get
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Deploy-TierModel.ps1"))) dir = dir.Parent;
            return dir?.FullName ?? throw new InvalidOperationException("Repository root not found.");
        }
    }
}
