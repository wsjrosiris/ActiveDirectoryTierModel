function Test-TierModelAuthSilo {
    <#
    .SYNOPSIS
    Audits authentication policies, authentication policy silos, silo membership and device groups.

    .DESCRIPTION
    Uses the same comparison as Get-TierModelAuthSilo (so audit and deploy never disagree) and turns
    every planned action into a finding:

      CreateAuthPolicy / CreateAuthSilo      Type Missing   (policy / silo does not exist)
      UpdateAuthPolicy / UpdateAuthSilo      Type Mismatch  (Property = changed fields)
      GrantSiloAccess                        Type Missing   (account not permitted in the silo)
      AssignSilo                             Type Mismatch  (account not assigned to the silo)
      AddDeviceGroupMember                   Type Missing   (computer of a source OU not in the device group)
      device group member outside the        Type Unexpected (reported only - never removed automatically)
      source OUs
      planning errors (e.g. domain           Type Error
      functional level below 2012 R2)

    Every finding has the standard shape (Type, ResourceType, Identifier, Property, ExpectedValue,
    ActualValue, Details) plus Area = 'authsilos', Tier and Severity (High for Tier 0, Medium
    otherwise; the tier comes from the "tier" field of the config entry or from the names).

    .PARAMETER Config
    Merged TierModel configuration (Get-TierModelConfig).

    .PARAMETER DomainController
    Domain controller for all AD queries.

    .PARAMETER Silent
    Suppress all console output.

    .PARAMETER SuppressSummary
    Suppress the summary block (the caller prints a consolidated summary).

    .OUTPUTS
    PSCustomObject with TotalChecked, Compliant, Missing, Mismatched, Unexpected, Errors, Drift,
    Findings, Warnings, DurationMs, CorrelationId.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [object]$Config,

        [Parameter(Mandatory)]
        [string]$DomainController,

        [switch]$Silent,

        [switch]$SuppressSummary
    )

    $startTime = Get-Date
    $findings = New-Object System.Collections.Generic.List[object]
    $plan = $null
    try {
        $plan = Get-TierModelAuthSilo -Config $Config -DomainController $DomainController -Silent
    } catch {
        $findings.Add([PSCustomObject]@{
            Type = 'Error'; ResourceType = 'AuthenticationPolicy'; Identifier = 'Authentication Silo Audit'; Property = 'Execution'
            ExpectedValue = 'Audit should complete successfully'; ActualValue = 'Failed'; Details = $_.Exception.Message
            Area = 'authsilos'; Tier = $null; Severity = 'High'
        })
    }

    $newFinding = {
        param([string]$Type, [string]$ResourceType, [string]$Identifier, [string]$Property, $Expected, $Actual, [string]$Details, $Tier)
        [PSCustomObject]@{
            Type          = $Type
            ResourceType  = $ResourceType
            Identifier    = $Identifier
            Property      = $Property
            ExpectedValue = $Expected
            ActualValue   = $Actual
            Details       = $Details
            Area          = 'authsilos'
            Tier          = $Tier
            Severity      = $(if ($Type -eq 'Error') { 'High' } else { ConvertTo-TierModelAuthSiloSeverity $Tier })
        }
    }

    $compliantCount = 0
    if ($plan) {
        foreach ($e in @($plan.Errors)) {
            $msg = [string](Get-TierModelAuthSiloValue $e 'Message' $e)
            $findings.Add((& $newFinding 'Error' 'AuthenticationPolicy' ([string](Get-TierModelAuthSiloValue $e 'Code' 'AuthSilo')) 'Prerequisite' 'Supported' 'Not supported' $msg $null))
        }
        foreach ($a in @($plan.Actions)) {
            $d = $a.Data
            $tier = Get-TierModelAuthSiloValue $d 'tier'
            switch ($a.Action) {
                'CreateAuthPolicy' {
                    $findings.Add((& $newFinding 'Missing' 'AuthenticationPolicy' $a.Name 'Exists' 'Present' 'Not Found' "Authentication policy '$($a.Name)' does not exist." $tier))
                }
                'UpdateAuthPolicy' {
                    $changed = @(Get-TierModelAuthSiloValue $d 'changes' @()) -join ', '
                    $expected = "enforce=$($d.enforce); userTgtLifetimeMins=$($d.userTgtLifetimeMins); sddl=$($d.sddl)"
                    $actual = "enforce=$($d.currentEnforce); userTgtLifetimeMins=$($d.currentUserTgtLifetimeMins); sddl=$($d.currentSddl)"
                    $findings.Add((& $newFinding 'Mismatch' 'AuthenticationPolicy' $a.Name $changed $expected $actual "Authentication policy '$($a.Name)' differs from the configuration ($changed)." $tier))
                }
                'CreateAuthSilo' {
                    $findings.Add((& $newFinding 'Missing' 'AuthenticationPolicySilo' $a.Name 'Exists' 'Present' 'Not Found' "Authentication policy silo '$($a.Name)' does not exist." $tier))
                }
                'UpdateAuthSilo' {
                    $changed = @(Get-TierModelAuthSiloValue $d 'changes' @()) -join ', '
                    $findings.Add((& $newFinding 'Mismatch' 'AuthenticationPolicySilo' $a.Name $changed "enforce=$($d.enforce); userAuthenticationPolicy=$($d.userAuthenticationPolicy)" 'Differs' "Authentication policy silo '$($a.Name)' differs from the configuration ($changed)." $tier))
                }
                'GrantSiloAccess' {
                    $findings.Add((& $newFinding 'Missing' 'AuthenticationPolicySiloMember' "$($a.Name) -> $($d.silo)" 'SiloAccess' 'Permitted' 'Not permitted' "Account '$($a.Path)' is not permitted in silo '$($d.silo)'." $tier))
                }
                'AssignSilo' {
                    $current = if ($d.currentSilo) { [string]$d.currentSilo } else { 'None' }
                    $findings.Add((& $newFinding 'Mismatch' 'AuthenticationPolicySiloAssignment' "$($a.Name) -> $($d.silo)" 'AssignedSilo' ([string]$d.silo) $current "Account '$($a.Path)' is assigned to silo '$current' instead of '$($d.silo)'." $tier))
                }
                'AddDeviceGroupMember' {
                    $findings.Add((& $newFinding 'Missing' 'DeviceGroupMember' "$($a.Name) -> $($d.group)" 'Member' 'Member' 'Not a member' "Computer '$($a.Path)' (source OU '$($d.sourceOU)') is not a member of device group '$($d.group)'." $tier))
                }
            }
        }
        foreach ($u in @($plan.UnexpectedDeviceGroupMembers)) {
            $findings.Add((& $newFinding 'Unexpected' 'DeviceGroupMember' "$($u.Member) -> $($u.Group)" 'Member' 'Not a member' 'Member' "'$($u.Member)' is a member of device group '$($u.Group)' but not located in its source OUs ($(@($u.SourceOUs) -join '; ')). It is not removed automatically - review it." $u.Tier))
        }
        $compliantCount = @($plan.Compliant).Count
    }

    $missing = @($findings | Where-Object { $_.Type -eq 'Missing' }).Count
    $mismatched = @($findings | Where-Object { $_.Type -eq 'Mismatch' }).Count
    $unexpectedCount = @($findings | Where-Object { $_.Type -eq 'Unexpected' }).Count
    $errorCount = @($findings | Where-Object { $_.Type -eq 'Error' }).Count
    $totalChecked = $compliantCount + $missing + $mismatched + $unexpectedCount
    $durationMs = ((Get-Date) - $startTime).TotalMilliseconds

    if (-not $Silent) {
        foreach ($f in $findings) {
            $color = if ($f.Type -in @('Missing', 'Error')) { 'Red' } else { 'Yellow' }
            Write-Host "  [$($f.Type)] $($f.Identifier): $($f.Details)" -ForegroundColor $color
        }
        if (-not $SuppressSummary) {
            Write-Host "`n=== Authentication Silo Audit Summary ===" -ForegroundColor Blue
            Write-Host "Total Checked: $totalChecked" -ForegroundColor White
            Write-Host "Compliant: $compliantCount" -ForegroundColor Green
            Write-Host "Missing: $missing" -ForegroundColor Red
            Write-Host "Mismatched: $mismatched" -ForegroundColor Yellow
            Write-Host "Unexpected: $unexpectedCount" -ForegroundColor Yellow
            Write-Host "Errors: $errorCount" -ForegroundColor Red
        }
    }

    return [PSCustomObject]@{
        TotalChecked  = $totalChecked
        Compliant     = $compliantCount
        Missing       = $missing
        Mismatched    = $mismatched
        Unexpected    = $unexpectedCount
        Errors        = $errorCount
        Drift         = $missing + $mismatched + $unexpectedCount
        Findings      = $findings.ToArray()
        Warnings      = if ($plan) { @($plan.Warnings) } else { @() }
        DurationMs    = $durationMs
        CorrelationId = if ($plan) { $plan.CorrelationId } else { [System.Guid]::NewGuid().ToString() }
    }
}
