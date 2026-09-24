function Test-TierModelJitPrerequisite {
    <#
    .SYNOPSIS
    Checks (read-only) whether time-limited group memberships (Just-in-Time access) are possible in the forest.

    .DESCRIPTION
    Time-limited group memberships (Add-ADGroupMember -MemberTimeToLive) need two things:
    - the optional feature "Privileged Access Management Feature" is enabled for the forest
      (Get-ADOptionalFeature: EnabledScopes is not empty), and
    - the forest functional level is Windows Server 2016 or later (required to enable the feature).

    The function only reads. It never enables the feature: enabling it cannot be undone, so that decision
    stays with the forest owner (Enable-ADOptionalFeature 'Privileged Access Management Feature' -Scope
    ForestOrConfigurationSet -Target <forest>). See docs/jit-access.md.

    Returns an object with PamEnabled, EnabledScopes, ForestMode, ForestLevelSufficient, Ready and a list of
    English Messages explaining what is missing.

    .PARAMETER Server
    Domain controller used for the queries.

    .EXAMPLE
    Test-TierModelJitPrerequisite -Server dc01.contoso.com
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Server
    )

    $messages = New-Object System.Collections.Generic.List[string]
    $pamEnabled = $false
    $scopes = @()
    try {
        $feature = Get-ADOptionalFeature -Filter "Name -eq 'Privileged Access Management Feature'" -Server $Server -ErrorAction Stop
        if ($feature) {
            $scopes = @(@($feature)[0].EnabledScopes | Where-Object { $_ } | ForEach-Object { [string]$_ })
            $pamEnabled = $scopes.Count -gt 0
        }
        if (-not $pamEnabled) {
            $messages.Add("The optional feature 'Privileged Access Management Feature' is not enabled in this forest. Enabling it is irreversible and must be done by the forest owner; this check never enables it.")
        }
    } catch {
        $messages.Add("The optional feature 'Privileged Access Management Feature' could not be read: $($_.Exception.Message)")
    }

    $forestMode = $null
    $levelOk = $false
    try {
        $forest = Get-ADForest -Server $Server -ErrorAction Stop
        $forestMode = [string]$forest.ForestMode
        $levelOk = Test-TierModelForestModeAtLeast2016 -ForestMode $forest.ForestMode
        if (-not $levelOk) {
            $messages.Add("The forest functional level is '$forestMode'; time-limited memberships need Windows Server 2016 or later.")
        }
    } catch {
        $messages.Add("The forest functional level could not be read: $($_.Exception.Message)")
    }

    [pscustomobject]@{
        PamEnabled            = $pamEnabled
        EnabledScopes         = $scopes
        ForestMode            = $forestMode
        ForestLevelSufficient = $levelOk
        Ready                 = ($pamEnabled -and $levelOk)
        Messages              = @($messages)
    }
}

function Test-TierModelForestModeAtLeast2016 {
    <#
    .SYNOPSIS
    True when an ADForestMode value (enum, name like 'Windows2016Forest' or number) is Windows Server 2016 or later.
    #>
    [CmdletBinding()]
    [OutputType([bool])]
    param([Parameter()][AllowNull()]$ForestMode)

    if ($null -eq $ForestMode) { return $false }
    $text = [string]$ForestMode
    if ($text -match '^Windows(\d{4})Forest$') { return ([int]$Matches[1] -ge 2016) }
    $number = 0
    # ADForestMode: Windows2012R2Forest = 6, Windows2016Forest = 7, Windows2025Forest = 10.
    if ([int]::TryParse($text, [ref]$number)) { return ($number -ge 7) }
    return $false
}
