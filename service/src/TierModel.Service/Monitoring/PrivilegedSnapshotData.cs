using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using TierModel.Service.Runs;
using TierModel.Service.Localization;

namespace TierModel.Service.Monitoring;

// Typed form of privileged.json written by Watch-TierModelPrivilegedGroups.ps1 (contract "privileged access snapshot").

public record PrivilegedMetadata(string? Version, string? PreferredDc, DateTimeOffset? Timestamp, string? Domain, string? DomainSid,
    string? ForestRootDomain, bool? IsForestRoot);

public record PrivilegedMember(string Sid, string? SamAccountName, string? Name, string ObjectClass, string? DistinguishedName,
    bool? Direct, List<string> Via, bool? Enabled)
{
    [JsonIgnore] public bool IsDirect => Direct ?? Via is not { Count: > 0 };

    [JsonIgnore] public string DisplayName => !string.IsNullOrWhiteSpace(Name) ? Name! : SamAccountName ?? Sid;
}

public record PrivilegedGroup(string Sid, string Name, string? WellKnownName, string Source, int? Tier, string? DistinguishedName,
    List<PrivilegedMember> Members);


public record PrivilegedAccount(string Sid, string? SamAccountName, string? DistinguishedName, string ObjectClass, int? Tier, bool? Enabled,
    DateTimeOffset? LastLogon, DateTimeOffset? PasswordLastSet, bool? PasswordNeverExpires, bool? AccountNotDelegated, bool? ProtectedUsers,
    int? AdminCount, List<string> ServicePrincipalNames, List<string> MemberOfPrivileged)
{
    [JsonIgnore] public string DisplayName => SamAccountName ?? Sid;
}

public record AdminCountOrphan(string Sid, string? SamAccountName, string? DistinguishedName, string ObjectClass);

public record AclFinding(string ObjectDn, string ObjectType, string ObjectName, string PrincipalSid, string PrincipalName, string PrincipalClass,
    List<string> Rights, string? ObjectTypeGuid, bool? Inherited, int? MemberCount, List<string> SampleMembers);

public record PrivilegedSnapshotData(PrivilegedMetadata Metadata, List<PrivilegedGroup> Groups, List<PrivilegedAccount> Accounts,
    List<AdminCountOrphan> AdminCountOrphans, List<AclFinding> AclFindings, List<string> Errors)
{
    [JsonIgnore] public int MemberCount => Groups.Sum(g => g.Members.Count);
}

/// <summary>Reads privileged.json defensively: PascalCase or camelCase keys, single objects where arrays are expected, missing optional parts.</summary>
public static class PrivilegedSnapshotReader
{
    public const string FileName = "privileged.json";

    /// <summary>Properties that must be arrays; PowerShell's ConvertTo-Json turns one-element arrays into objects.</summary>
    private static readonly HashSet<string> ArrayProperties =
    [
        "groups", "members", "via", "accounts", "servicePrincipalNames", "memberOfPrivileged", "adminCountOrphans",
        "aclFindings", "rights", "sampleMembers", "errors",
    ];

    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    /// <summary>Parses and validates the file content. Throws <see cref="FormatException"/> with a German message when unusable.</summary>
    public static PrivilegedSnapshotData Parse(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) throw new FormatException(L.T("Die Ergebnisdatei ist leer."));
        JsonNode? root;
        try
        {
            // A UTF-8 BOM is tolerated even though the contract says "without BOM".
            root = JsonNode.Parse(json.TrimStart('﻿'), documentOptions: new JsonDocumentOptions { AllowTrailingCommas = true });
        }
        catch (JsonException ex)
        {
            throw new FormatException(L.F("Die Ergebnisdatei ist kein gültiges JSON ({0}).", ex.Message), ex);
        }
        if (JsonCase.CamelCaseKeys(root) is not JsonObject obj) throw new FormatException(L.T("Die Ergebnisdatei enthält kein JSON-Objekt."));
        if (obj["groups"] is null) throw new FormatException(L.T("Die Ergebnisdatei enthält keinen Abschnitt „groups“."));
        NormalizeArrays(obj);

        PrivilegedSnapshotData? data;
        try
        {
            obj["metadata"] ??= new JsonObject();
            data = obj.Deserialize<PrivilegedSnapshotData>(Options);
        }
        catch (Exception ex) when (ex is JsonException or NotSupportedException or InvalidOperationException)
        {
            throw new FormatException(L.F("Die Ergebnisdatei entspricht nicht dem erwarteten Format ({0}).", ex.Message), ex);
        }
        if (data is null) throw new FormatException(L.T("Die Ergebnisdatei ist leer."));

        // Required identities; everything else may be missing.
        var groups = new List<PrivilegedGroup>();
        foreach (var g in data.Groups ?? [])
        {
            if (g is null) continue;
            if (string.IsNullOrWhiteSpace(g.Sid)) throw new FormatException(L.F("Gruppe „{0}“ ohne SID in der Ergebnisdatei.", g.Name));
            var members = (g.Members ?? []).Where(m => m is not null && !string.IsNullOrWhiteSpace(m.Sid))
                .Select(m => m with { ObjectClass = string.IsNullOrWhiteSpace(m.ObjectClass) ? "other" : m.ObjectClass, Via = m.Via ?? [] })
                .GroupBy(m => m.Sid, StringComparer.OrdinalIgnoreCase).Select(x => x.First()).ToList();
            groups.Add(g with { Name = string.IsNullOrWhiteSpace(g.Name) ? g.WellKnownName ?? g.Sid : g.Name, Source = g.Source ?? "builtin", Members = members });
        }
        return data with
        {
            Metadata = data.Metadata ?? new PrivilegedMetadata(null, null, null, null, null, null, null),
            Groups = groups,
            Accounts = (data.Accounts ?? []).Where(a => a is not null && !string.IsNullOrWhiteSpace(a.Sid))
                .Select(a => a with { ObjectClass = a.ObjectClass ?? "user", ServicePrincipalNames = a.ServicePrincipalNames ?? [], MemberOfPrivileged = a.MemberOfPrivileged ?? [] })
                .ToList(),
            AdminCountOrphans = (data.AdminCountOrphans ?? []).Where(o => o is not null && !string.IsNullOrWhiteSpace(o.Sid)).ToList(),
            AclFindings = (data.AclFindings ?? []).Where(a => a is not null && !string.IsNullOrWhiteSpace(a.PrincipalSid ?? a.PrincipalName))
                .Select(a => a with { Rights = a.Rights ?? [], SampleMembers = a.SampleMembers ?? [], ObjectName = a.ObjectName ?? a.ObjectDn, PrincipalName = a.PrincipalName ?? a.PrincipalSid })
                .ToList(),
            Errors = (data.Errors ?? []).Where(e => !string.IsNullOrWhiteSpace(e)).ToList(),
        };
    }

    public static string Serialize(PrivilegedSnapshotData data) => JsonSerializer.Serialize(data, Options);

    public static PrivilegedSnapshotData? Deserialize(string? json) =>
        string.IsNullOrEmpty(json) ? null : JsonSerializer.Deserialize<PrivilegedSnapshotData>(json, Options);

    private static void NormalizeArrays(JsonNode? node)
    {
        switch (node)
        {
            case JsonObject o:
                foreach (var key in o.Select(kv => kv.Key).ToList())
                {
                    var value = o[key];
                    if (ArrayProperties.Contains(key) && value is not JsonArray)
                    {
                        o[key] = value is null ? new JsonArray() : new JsonArray(value.DeepClone());
                        value = o[key];
                    }
                    NormalizeArrays(value);
                }
                break;
            case JsonArray a:
                foreach (var item in a) NormalizeArrays(item);
                break;
        }
    }
}
