# TierModel audit report consolidation
# Collects the findings of all audited entity types into one list, tags every finding with the
# functional area and a severity, and computes the report summary from the collected data.

function Get-TierModelAuditArea {
    <#
    .SYNOPSIS
    Maps an audit result EntityType to the report area (ous, groups, users, acls, gpos, admx, msa, gmsa, dmsa, winlaps).
    #>
    [CmdletBinding()]
    param([AllowNull()][AllowEmptyString()][string]$EntityType)

    switch -Regex ($EntityType) {
        '^OU$'                  { return 'ous' }
        '^Group$'               { return 'groups' }
        '^User$'                { return 'users' }
        '^(OU ACL|OuAcl)$'      { return 'acls' }
        '^(GPO|Gpo)$'           { return 'gpos' }
        '^ADMX$'                { return 'admx' }
        '^MSA ACL$'             { return 'msa' }
        '^gMSA ACL$'            { return 'gmsa' }
        '^dMSA ACL$'            { return 'dmsa' }
        '^WinLaps( ACL| Decryptor)?$' { return 'winlaps' }
        default                 { return $null }
    }
}

function Get-TierModelGpoTargetMap {
    <#
    .SYNOPSIS
    Builds a map GPO name (pattern) -> linked OU keys from the GPO configuration (internal helper).
    #>
    [CmdletBinding()]
    param($Config)

    $map = @{}
    if ($null -eq $Config -or -not $Config.PSObject.Properties['gpos'] -or -not $Config.gpos) { return $map }
    foreach ($ouKey in $Config.gpos.PSObject.Properties.Name) {
        $ouData = $Config.gpos.$ouKey
        foreach ($listName in @('ImportOnlyGpo', 'PostConfigureGpo')) {
            if ($ouData.PSObject.Properties[$listName] -and $ouData.$listName) {
                foreach ($gpo in @($ouData.$listName)) {
                    if ($gpo -and $gpo.PSObject.Properties['name'] -and $gpo.name) {
                        if (-not $map.ContainsKey($gpo.name)) { $map[$gpo.name] = @() }
                        $map[$gpo.name] += $ouKey
                    }
                }
            }
        }
    }
    return $map
}

function Get-TierModelAuditFindingSeverity {
    <#
    .SYNOPSIS
    Derives the severity of an audit finding.

    .DESCRIPTION
    High   - Error findings, and objects belonging to Tier 0 (identifier/path mentions "Tier 0" /
             "Tier0", the Domain Controllers OU, or a GPO/ACL targeting a Tier-0 OU or the domain root).
    Medium - objects belonging to Tier 1.
    Low    - everything else.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Finding,
        [string]$Area,
        [hashtable]$GpoTargets = @{}
    )

    $source = $Finding
    $arrow = [string][char]0x2192
    $get = {
        param($name)
        if ($source -is [System.Collections.IDictionary]) {
            if ($source.Contains($name)) { return [string]$source[$name] }
            return $null
        }
        if ($source.PSObject.Properties[$name]) { return [string]$source.$name }
        return $null
    }

    $type = & $get 'Type'
    $status = & $get 'Status'
    if ($type -eq 'Error' -or $status -eq 'Error') { return 'High' }

    $texts = New-Object System.Collections.Generic.List[string]
    foreach ($prop in @('Identifier', 'Path', 'ExpectedValue', 'GpoName', 'TargetOU', 'TargetOUPath', 'OuDn', 'DistinguishedName', 'FileName')) {
        $v = & $get $prop
        if (-not [string]::IsNullOrWhiteSpace($v)) { $texts.Add($v) }
    }

    # GPO findings: include the OUs the GPO is linked to according to the configuration
    $gpoName = & $get 'GpoName'
    if (-not $gpoName -and $Area -eq 'gpos') { $gpoName = & $get 'Identifier' }
    if ($gpoName -and $GpoTargets.Count -gt 0) {
        foreach ($pattern in $GpoTargets.Keys) {
            if ($gpoName -eq $pattern -or $gpoName -like $pattern) {
                foreach ($target in @($GpoTargets[$pattern])) { $texts.Add("$arrow $target") }
            }
        }
    }

    $tier0Pattern = '(?i)\bTier\s*0|Tier0|Domain Controllers'
    # ACL / GPO on the domain root ("X -> {{DOMAIN_DN}}" or "X -> DC=contoso,DC=com"; the audit
    # identifiers use the arrow character U+2192)
    $domainRootPattern = '(?i)(^|' + $arrow + '\s*)(\{\{DOMAIN_DN\}\}|DC=[^,]+(,DC=[^,]+)*)\s*$'

    foreach ($t in $texts) {
        if ($t -match $tier0Pattern) { return 'High' }
        if ($Area -in @('acls', 'gpos', 'msa', 'gmsa', 'dmsa', 'winlaps') -and $t -match $domainRootPattern) { return 'High' }
    }
    foreach ($t in $texts) {
        if ($t -match '(?i)\bTier\s*1|Tier1') { return 'Medium' }
    }
    return 'Low'
}

function ConvertTo-TierModelAuditReportFinding {
    <#
    .SYNOPSIS
    Extracts the non-compliant findings of one audit result in report format (internal helper).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $AuditResult,
        [Parameter(Mandatory)] [string]$Area
    )

    $has = { param($obj, $name) $null -ne $obj -and $obj.PSObject.Properties[$name] -and $null -ne $obj.$name }
    $out = New-Object System.Collections.Generic.List[object]

    switch ($Area) {
        { $_ -in @('ous', 'groups', 'users') } {
            if (& $has $AuditResult 'DriftFindings') {
                foreach ($f in @($AuditResult.DriftFindings)) { if ($null -ne $f) { $out.Add($f) } }
            }
        }
        'acls' {
            # Same conversion as the OU ACL single-scope report
            if (& $has $AuditResult 'Findings') {
                foreach ($f in @($AuditResult.Findings)) {
                    if ($null -eq $f) { continue }
                    $out.Add([PSCustomObject]@{
                        Type = if ($f.Type -eq 'Drift') {
                            if ($f.ActualValue -eq 'Missing' -or $f.Details -like "*missing*" -or $f.Details -like "*No Access Control Entry*") {
                                'Missing'
                            } else {
                                'Mismatch'
                            }
                        } else {
                            'Error'
                        }
                        ResourceType = $f.ResourceType
                        Identifier = $f.Identifier
                        Details = $f.Details
                    })
                }
            }
        }
        'gpos' {
            # Same conversion as the GPO single-scope report
            if (& $has $AuditResult 'Findings') {
                foreach ($f in @($AuditResult.Findings)) {
                    if ($null -eq $f) { continue }
                    $out.Add([PSCustomObject]@{
                        Type = $f.Type
                        Identifier = $f.GpoName
                        Details = $f.Message
                    })
                }
            }
        }
        default {
            # admx, msa, gmsa, dmsa, winlaps: keep every original field, skip compliant entries,
            # and add Type/Identifier/Details where the source object has other names for them.
            if (& $has $AuditResult 'Findings') {
                foreach ($f in @($AuditResult.Findings)) {
                    if ($null -eq $f) { continue }
                    $fType = if ($f.PSObject.Properties['Type']) { [string]$f.Type } else { $null }
                    $fStatus = if ($f.PSObject.Properties['Status']) { [string]$f.Status } else { $null }
                    if ($fType -in @('Compliant', 'Pass') -or (-not $fType -and $fStatus -in @('Compliant', 'Pass', 'OK'))) { continue }

                    $copy = [ordered]@{}
                    foreach ($p in $f.PSObject.Properties) { $copy[$p.Name] = $p.Value }
                    if (-not $copy.Contains('Type')) { $copy['Type'] = if ($fStatus) { $fStatus } else { 'Mismatch' } }
                    if (-not $copy.Contains('ResourceType') -and $copy.Contains('GpoName')) { $copy['ResourceType'] = 'LapsDecryptor' }
                    if (-not $copy.Contains('Identifier')) {
                        if ($copy.Contains('FileName')) { $copy['Identifier'] = $copy['FileName'] }
                        elseif ($copy.Contains('GpoName')) { $copy['Identifier'] = $copy['GpoName'] }
                    }
                    if (-not $copy.Contains('Details')) {
                        if ($copy.Contains('Message')) { $copy['Details'] = $copy['Message'] }
                        elseif ($copy.Contains('Expected') -or $copy.Contains('Actual')) {
                            $copy['Details'] = "Expected: $($copy['Expected']); Actual: $($copy['Actual'])"
                        }
                    }
                    $out.Add([PSCustomObject]$copy)
                }
            }
        }
    }
    return , $out.ToArray()
}

function Get-TierModelAuditCheckedCount {
    <#
    .SYNOPSIS
    Returns the number of checked objects of one audit result (property names differ per entity type).
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory)] $AuditResult)

    $summary = if ($AuditResult.PSObject.Properties['Summary']) { $AuditResult.Summary } else { $null }
    foreach ($name in @('TotalChecked', 'TotalGpos', 'TotalFiles', 'TotalAcls')) {
        if ($null -ne $summary) {
            if ($summary -is [System.Collections.IDictionary]) {
                if ($summary.Contains($name) -and $null -ne $summary[$name]) { return [int]$summary[$name] }
            } elseif ($summary.PSObject.Properties[$name] -and $null -ne $summary.$name) {
                return [int]$summary.$name
            }
        }
    }
    if ($AuditResult.PSObject.Properties['TotalChecked'] -and $null -ne $AuditResult.TotalChecked) {
        return [int]$AuditResult.TotalChecked
    }
    return 0
}

function Merge-TierModelAuditResult {
    <#
    .SYNOPSIS
    Consolidates audit results of several entity types into one findings list and summary.

    .DESCRIPTION
    Used by Audit-TierModel.ps1 for the JSON/Text report. For every audit result (OU, Group, User,
    OU ACL, GPO, ADMX, MSA/gMSA/dMSA ACL, WinLaps ACL/Decryptor - identified by its EntityType
    property) the non-compliant findings are collected in report format. Every finding keeps its
    existing fields and gets two additional ones:
      Area     - ous | groups | users | acls | gpos | admx | msa | gmsa | dmsa | winlaps
      Severity - High (Tier 0 object, GPO/ACL on a Tier-0 OU or the domain root, or an Error finding),
                 Medium (Tier 1), Low (otherwise)
    The summary is computed from the collected findings (and the per-entity checked counts).

    .PARAMETER AuditResults
    Audit result objects, each with an EntityType property.

    .PARAMETER Config
    Optional TierModel configuration - used to find the OUs a GPO is linked to (severity of GPO findings).

    .OUTPUTS
    PSCustomObject with Summary (hashtable: TotalChecked, DriftCount, MissingCount, UnexpectedCount,
    MismatchCount, OrphanedGpoLinkCount, SecurityDeltaCount, ErrorCount, CompliantCount) and
    Findings (array).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$AuditResults,

        $Config
    )

    $gpoTargets = Get-TierModelGpoTargetMap -Config $Config
    $findings = New-Object System.Collections.Generic.List[object]
    $summary = [ordered]@{
        TotalChecked = 0
        DriftCount = 0
        MissingCount = 0
        UnexpectedCount = 0
        MismatchCount = 0
        OrphanedGpoLinkCount = 0
        SecurityDeltaCount = 0
        ErrorCount = 0
        CompliantCount = 0
    }

    foreach ($result in @($AuditResults)) {
        if ($null -eq $result) { continue }
        $entityType = if ($result.PSObject.Properties['EntityType']) { [string]$result.EntityType } else { $null }
        $area = Get-TierModelAuditArea -EntityType $entityType
        if (-not $area) {
            Write-Verbose "Skipping audit result with unknown EntityType '$entityType'"
            continue
        }

        $checked = Get-TierModelAuditCheckedCount -AuditResult $result
        $summary.TotalChecked += $checked

        $entityFindings = ConvertTo-TierModelAuditReportFinding -AuditResult $result -Area $area
        $entityIssues = 0
        foreach ($finding in @($entityFindings)) {
            $severity = Get-TierModelAuditFindingSeverity -Finding $finding -Area $area -GpoTargets $gpoTargets
            $finding | Add-Member -NotePropertyName 'Area' -NotePropertyValue $area -Force
            $finding | Add-Member -NotePropertyName 'Severity' -NotePropertyValue $severity -Force
            $findings.Add($finding)
            $entityIssues++

            switch -Regex ([string]$finding.Type) {
                '^Error$'                 { $summary.ErrorCount++; break }
                '^Missing(Acl)?$'         { $summary.MissingCount++; break }
                '^Unexpected(Acl)?$'      { $summary.UnexpectedCount++; break }
                '^OrphanedGpoLink$'       { $summary.OrphanedGpoLinkCount++; break }
                '^SecurityDelta$'         { $summary.SecurityDeltaCount++; break }
                default                   { $summary.MismatchCount++ }
            }
        }

        # Entity-level errors reported outside the findings (e.g. Errors = @(@{Message=...}))
        if ($result.PSObject.Properties['Errors'] -and $result.Errors -is [System.Collections.IEnumerable] -and $result.Errors -isnot [string]) {
            $summary.ErrorCount += @($result.Errors | Where-Object { $null -ne $_ }).Count
        }

        # Compliant objects: explicit count where the entity reports one, else checked - issues
        $compliant = $null
        if ($result.PSObject.Properties['Summary'] -and $null -ne $result.Summary) {
            $s = $result.Summary
            if ($s -is [System.Collections.IDictionary]) {
                if ($s.Contains('Compliant') -and $null -ne $s['Compliant']) { $compliant = [int]$s['Compliant'] }
            } elseif ($s.PSObject.Properties['Compliant'] -and $null -ne $s.Compliant) {
                $compliant = [int]$s.Compliant
            }
        }
        if ($null -eq $compliant) { $compliant = [Math]::Max(0, $checked - $entityIssues) }
        $summary.CompliantCount += $compliant
    }

    $summary.DriftCount = $summary.MissingCount + $summary.UnexpectedCount + $summary.MismatchCount +
        $summary.OrphanedGpoLinkCount + $summary.SecurityDeltaCount

    $summaryTable = @{}
    foreach ($k in $summary.Keys) { $summaryTable[$k] = $summary[$k] }

    return [PSCustomObject]@{
        Summary  = $summaryTable
        Findings = $findings.ToArray()
    }
}
