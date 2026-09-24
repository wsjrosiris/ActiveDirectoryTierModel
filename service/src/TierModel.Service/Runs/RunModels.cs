using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using TierModel.Service.Data;

namespace TierModel.Service.Runs;

public record RunRequest(string PreferredDc, DeployScope? Scope, bool IncludeMsa, bool IncludeGmsa, bool IncludeDmsa, bool IncludeWinLaps, string? AdmlLanguage);

public record DeployRequest(string PreferredDc, DeployScope? Scope, bool IncludeMsa, bool IncludeGmsa, bool IncludeDmsa, bool IncludeWinLaps, string? AdmlLanguage, bool ConfirmApply)
{
    public RunRequest ToRunRequest() => new(PreferredDc, Scope, IncludeMsa, IncludeGmsa, IncludeDmsa, IncludeWinLaps, AdmlLanguage);
}

public record RunSummaryDto(
    long Id, RunKind Kind, RunStatus Status, RunTrigger Trigger, RunMode? Mode, DeployScope? Scope, string[] Includes,
    string PreferredDc, string RequestedBy, long? ScheduleId, DateTimeOffset CreatedAt, DateTimeOffset? StartedAt,
    DateTimeOffset? FinishedAt, int? ExitCode, int? DriftCount, int? ErrorCount, string? Message)
{
    public static RunSummaryDto From(Run r) => new(
        r.Id, r.Kind, r.Status, r.Trigger, r.Mode, r.Scope, IncludeList(r.IncludeMsa, r.IncludeGmsa, r.IncludeDmsa, r.IncludeWinLaps),
        r.PreferredDc, r.RequestedBy, r.ScheduleId, r.CreatedAt, r.StartedAt, r.FinishedAt, r.ExitCode, r.DriftCount, r.ErrorCount, r.Message);

    public static string[] IncludeList(bool msa, bool gmsa, bool dmsa, bool winLaps) =>
        new[] { (msa, "Msa"), (gmsa, "Gmsa"), (dmsa, "Dmsa"), (winLaps, "WinLaps") }.Where(x => x.Item1).Select(x => x.Item2).ToArray();
}

public record LogLineDto(int Seq, DateTimeOffset At, string Stream, string Level, string Text);

public record LogPageDto(RunStatus Status, List<LogLineDto> Lines);

public static partial class RunValidation
{
    [GeneratedRegex(@"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,62})(?:\.[A-Za-z0-9-]{1,63})*$")]
    private static partial Regex HostName();

    [GeneratedRegex(@"^[a-zA-Z]{2}-[a-zA-Z]{2}$")]
    private static partial Regex Language();

    /// <summary>Returns field errors; empty when valid. Values end up as process arguments, so they are strictly checked.</summary>
    public static Dictionary<string, string[]> Validate(RunRequest r)
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(r.PreferredDc) || r.PreferredDc.Length > 253 || !HostName().IsMatch(r.PreferredDc))
            errors["preferredDc"] = ["Bitte einen gültigen Domänencontroller-Namen angeben (z. B. dc01.contoso.com)."];
        var anyInclude = r.IncludeMsa || r.IncludeGmsa || r.IncludeDmsa || r.IncludeWinLaps;
        if (r.Scope is { } scope && !Enum.IsDefined(scope))
            errors["scope"] = ["Unbekannter Bereich."];
        else if (r.Scope is null && !anyInclude)
            errors["scope"] = ["Bereich wählen oder mindestens eine Erweiterung aktivieren."];
        // Deploy-/Audit-TierModel.ps1 reject -Include* together with any scope except -FullDeployment.
        else if (anyInclude && r.Scope is not (null or DeployScope.FullDeployment))
            errors["scope"] = ["Erweiterungen (MSA, gMSA, dMSA, Windows LAPS) sind nur mit „Vollständig“ oder ohne Bereich möglich."];
        if (r.AdmlLanguage is { Length: > 0 } lang && !Language().IsMatch(lang))
            errors["admlLanguage"] = ["Sprache im Format xx-XX angeben (z. B. en-US)."];
        return errors;
    }
}

internal static class JsonCase
{
    /// <summary>PowerShell emits PascalCase keys; the API is camelCase.</summary>
    public static JsonNode? CamelCaseKeys(JsonNode? node) => node switch
    {
        JsonObject o => new JsonObject(o.Select(kv => KeyValuePair.Create(JsonNamingPolicy.CamelCase.ConvertName(kv.Key), CamelCaseKeys(kv.Value)))),
        JsonArray a => new JsonArray(a.Select(CamelCaseKeys).ToArray()),
        _ => node?.DeepClone(),
    };
}
