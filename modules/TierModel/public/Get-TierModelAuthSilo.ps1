# TierModel authentication policies and authentication policy silos (planning)
# Compares config/tiermodel-authsilos.json (merged into $Config.authSilos by Get-TierModelConfig)
# with Active Directory and returns the actions needed to converge.

#region Internal helpers (shared with New-/Test-TierModelAuthSilo)

function Get-TierModelAuthSiloValue {
    <# Reads a property from a PSCustomObject or dictionary under StrictMode (internal helper). #>
    param($Object, [string]$Name, $Default = $null)
    if ($null -eq $Object) { return $Default }
    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Name) -and $null -ne $Object[$Name]) { return $Object[$Name] }
        return $Default
    }
    $prop = $Object.PSObject.Properties[$Name]
    if ($prop -and $null -ne $prop.Value) { return $prop.Value }
    return $Default
}

function Get-TierModelAuthSiloStringList {
    <# Returns a property as a clean string array (null/empty entries removed) (internal helper). #>
    param($Object, [string]$Name)
    $value = Get-TierModelAuthSiloValue $Object $Name
    $list = New-Object System.Collections.Generic.List[string]
    foreach ($item in @($value)) {
        if ($null -eq $item) { continue }
        $text = ([string]$item).Trim()
        if ($text) { $list.Add($text) }
    }
    return $list.ToArray()
}

function Get-TierModelAuthSiloSection {
    <#
    .SYNOPSIS
    Returns the auth silo configuration section with three always-present arrays (internal helper).
    .DESCRIPTION
    Source: $Config.authSilos (loaded from tiermodel-authsilos.json). Result properties:
    Policies (authenticationPolicies), Silos (authenticationPolicySilos), DeviceGroupSync.
    #>
    param($Config)
    $section = Get-TierModelAuthSiloValue $Config 'authSilos'
    $policies = @(Get-TierModelAuthSiloValue $section 'authenticationPolicies' @()) | Where-Object { $null -ne $_ }
    $silos = @(Get-TierModelAuthSiloValue $section 'authenticationPolicySilos' @()) | Where-Object { $null -ne $_ }
    $sync = @(Get-TierModelAuthSiloValue $section 'deviceGroupSync' @()) | Where-Object { $null -ne $_ }
    return [PSCustomObject]@{
        Policies        = @($policies)
        Silos           = @($silos)
        DeviceGroupSync = @($sync)
        Count           = @($policies).Count + @($silos).Count + @($sync).Count
    }
}

function Get-TierModelAuthSiloTier {
    <#
    Tier of a config entry: explicit "tier" field, else derived from the names
    (Tier 0 / Tier0 / Tier 1 ...). $null when unknown (internal helper).
    #>
    param($Entry, [string[]]$Names = @())
    $explicit = Get-TierModelAuthSiloValue $Entry 'tier'
    if ($null -ne $explicit -and "$explicit" -match '^\d+$') { return [int]"$explicit" }
    foreach ($n in @($Names)) {
        if ($n -and $n -match '(?i)tier\s*([012])(?![0-9])') { return [int]$Matches[1] }
    }
    return $null
}

function ConvertTo-TierModelAuthSiloSeverity {
    <# High for Tier 0, Medium otherwise (internal helper). #>
    param($Tier)
    if ($null -ne $Tier -and [int]$Tier -eq 0) { return 'High' }
    return 'Medium'
}

function Test-TierModelAuthSiloDomainMode {
    <#
    True when the domain functional level supports authentication policies and silos
    (Windows Server 2012 R2 or later). Accepts the ADDomainMode enum/string
    (e.g. 'Windows2012R2Domain', 'Windows2025Domain') or its numeric value (6 = 2012 R2) (internal helper).
    #>
    param($DomainMode)
    if ($null -eq $DomainMode) { return $false }
    $text = [string]$DomainMode
    if ($text -match '^\d+$') { return ([int]$text -ge 6) }
    if ($text -match '(?i)^Windows(\d{4})(R2)?Domain$') {
        $rank = ([int]$Matches[1] * 10) + $(if ($Matches[2]) { 5 } else { 0 })
        return ($rank -ge 20125)
    }
    return $false
}

function Resolve-TierModelAuthSiloGroupSid {
    <#
    Resolves a group (sAMAccountName, name or SID) to its SID string, or $null when not found.
    Built-in groups are resolved language-independently via the well-known table; everything else
    with Get-ADGroup against the preferred DC (internal helper).
    #>
    param([string]$Name, [string]$DomainController)
    if ([string]::IsNullOrWhiteSpace($Name)) { return $null }
    if ($Name -match '^S-1-\d+(-\d+)+$') { return $Name }
    try {
        $wellKnown = Resolve-TierModelWellKnownPrincipalSid -Name $Name -DomainController $DomainController
        if ($wellKnown) { return [string]$wellKnown }
    } catch {
        Write-Verbose "Well-known resolution failed for '$Name': $($_.Exception.Message)"
    }
    try {
        $group = Get-ADGroup -Identity $Name -Server $DomainController -Properties objectSid
        if ($group) {
            foreach ($p in @('SID', 'objectSid')) {
                $sid = Get-TierModelSidString (Get-TierModelAuthSiloValue $group $p)
                if ($sid) { return $sid }
            }
        }
    } catch {
        Write-Verbose "Group '$Name' not found: $($_.Exception.Message)"
    }
    return $null
}

function Get-TierModelAuthSiloCn {
    <# First RDN value of a DN ('CN=Tier 0 Policy,CN=AuthN Policies,...' -> 'Tier 0 Policy'); plain names pass through (internal helper). #>
    param($Value)
    if ($null -eq $Value) { return $null }
    $text = [string](Get-TierModelAuthSiloValue $Value 'Name' $Value)
    if ($Value -isnot [string] -and $Value.PSObject.Properties['DistinguishedName'] -and $Value.DistinguishedName) {
        $text = [string]$Value.DistinguishedName
    }
    if ($text -match '^(?i)CN=((?:\\,|[^,])+)') { return ($Matches[1] -replace '\\,', ',') }
    return $text
}

function Get-TierModelAuthSiloSddlSids {
    <# All SIDs referenced in a conditional-ACE SDDL, upper case, ED mapped to S-1-5-9 (internal helper). #>
    param([string]$Sddl)
    $set = New-Object System.Collections.Generic.List[string]
    if (-not $Sddl) { return $set.ToArray() }
    foreach ($m in [regex]::Matches($Sddl, '(?i)SID\(\s*([^)\s]+)\s*\)')) {
        $sid = $m.Groups[1].Value.ToUpperInvariant()
        if ($sid -eq 'ED') { $sid = 'S-1-5-9' }
        if (-not $set.Contains($sid)) { $set.Add($sid) }
    }
    return $set.ToArray()
}

function Compare-TierModelAuthSiloSddl {
    <#
    True when the SDDL read from AD is equivalent to the generated one. AD may render the descriptor
    slightly differently (whitespace, ED vs S-1-5-9), so the comparison is: identical after
    normalization, or the same SID set with OR semantics (no '&&', Member_of_any for groups).
    #>
    param([AllowNull()][string]$Expected, [AllowNull()][string]$Actual)
    $norm = {
        param($s)
        if ([string]::IsNullOrWhiteSpace($s)) { return '' }
        (($s -replace '\s+', '').ToUpperInvariant()) -replace 'SID\(S-1-5-9\)', 'SID(ED)'
    }
    $e = & $norm $Expected
    $a = & $norm $Actual
    if ($e -eq $a) { return $true }
    if (-not $e -or -not $a) { return $false }
    if ($a.Contains('&&')) { return $false }
    $eSids = @(Get-TierModelAuthSiloSddlSids $Expected | Sort-Object)
    $aSids = @(Get-TierModelAuthSiloSddlSids $Actual | Sort-Object)
    if (($eSids -join ';') -ne ($aSids -join ';')) { return $false }
    # More than one group SID must be combined with Member_of_any (Member_of {A, B} = all of them)
    $groupSids = @($eSids | Where-Object { $_ -ne 'S-1-5-9' })
    if ($groupSids.Count -gt 1 -and -not $a.Contains('MEMBER_OF_ANY')) { return $false }
    return $true
}

function Copy-TierModelAuthSiloData {
    <# Shallow copy of an ordered dictionary (internal helper). #>
    param([System.Collections.IDictionary]$Data)
    $copy = [ordered]@{}
    foreach ($k in $Data.Keys) { $copy[$k] = $Data[$k] }
    return $copy
}

function Get-TierModelAuthSiloAdFilterValue {
    <# Escapes a value for an AD -Filter string literal (internal helper). #>
    param([string]$Value)
    return ($Value -replace "'", "''")
}

function Test-TierModelAuthSiloDnUnder {
    <# True when $Dn equals $ParentDn or lies below it (case-insensitive) (internal helper). #>
    param([string]$Dn, [string]$ParentDn)
    if (-not $Dn -or -not $ParentDn) { return $false }
    return ($Dn -ieq $ParentDn -or $Dn.EndsWith(",$ParentDn", [System.StringComparison]::OrdinalIgnoreCase))
}

#endregion

function Get-TierModelAuthSilo {
    <#
    .SYNOPSIS
    Plans Kerberos authentication policies, authentication policy silos, silo membership and device
    group synchronisation from the configuration.

    .DESCRIPTION
    Reads $Config.authSilos (config/tiermodel-authsilos.json) and compares it with Active Directory:

      deviceGroupSync            Get-ADGroup (member) / Get-ADComputer -SearchBase <sourceOU>
                                  -> AddDeviceGroupMember
      authenticationPolicies     Get-ADAuthenticationPolicy
                                  -> CreateAuthPolicy / UpdateAuthPolicy (description, enforce,
                                     userTgtLifetimeMins, generated UserAllowedToAuthenticateFrom SDDL)
      authenticationPolicySilos  Get-ADAuthenticationPolicySilo
                                  -> CreateAuthSilo / UpdateAuthSilo (description, enforce, user/computer/
                                     service policy)
      silo members               users below members.userOUs, computers in members.computerGroups and
                                  below members.computerOUs (minus members.excludeAccounts)
                                  -> GrantSiloAccess (msDS-AuthNPolicySiloMembers of the silo)
                                  -> AssignSilo      (msDS-AssignedAuthNPolicySilo of the account)

    Actions use the common shape { Action, ResourceType, Name, Path, Data } and are returned in
    execution order: device groups first (so the device condition is satisfiable), then policies,
    silos, access grants and assignments.

    Authentication policies require a domain functional level of Windows Server 2012 R2 or later;
    below that the plan contains an error (Code AuthSiloDomainFunctionalLevel) and no actions.
    Objects that do not exist yet (device groups, OUs - e.g. during a -FullDeployment plan before
    groups/OUs are created) produce warnings; the SDDL is generated again when the plan is applied.

    Accounts that are only reported (not changed): members of a synchronised device group that are
    not below one of its source OUs (UnexpectedDeviceGroupMembers - used by Test-TierModelAuthSilo).

    .PARAMETER Config
    Merged TierModel configuration (Get-TierModelConfig).

    .PARAMETER DomainController
    Domain controller for all AD queries.

    .PARAMETER Silent
    Suppress console output.

    .PARAMETER IncludeDetails
    Accepted for parity with the other planners; the actions always contain full details.

    .OUTPUTS
    PSCustomObject: EntityType ('AuthSilo'), Actions, Summary (TotalInConfig, TotalActions,
    CreateActions, UpdateActions, ConfigureActions, ExistingCount), Warnings (string[]), Errors
    (objects with Code/Message), UnexpectedDeviceGroupMembers, Compliant (list of compliant objects),
    DomainMode, CorrelationId.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [object]$Config,

        [Parameter(Mandatory)]
        [string]$DomainController,

        [switch]$Silent,

        [switch]$IncludeDetails
    )

    $correlationId = [System.Guid]::NewGuid().ToString()
    $actions = New-Object System.Collections.Generic.List[object]
    $warnings = New-Object System.Collections.Generic.List[string]
    $errors = New-Object System.Collections.Generic.List[object]
    $compliant = New-Object System.Collections.Generic.List[object]
    $unexpected = New-Object System.Collections.Generic.List[object]

    $section = Get-TierModelAuthSiloSection -Config $Config
    $newResult = {
        param($DomainMode)
        $create = @($actions | Where-Object { $_.Action -like 'Create*' }).Count
        $update = @($actions | Where-Object { $_.Action -like 'Update*' -or $_.Action -eq 'AddDeviceGroupMember' }).Count
        $configure = @($actions | Where-Object { $_.Action -in @('GrantSiloAccess', 'AssignSilo') }).Count
        [PSCustomObject]@{
            EntityType                   = 'AuthSilo'
            Actions                      = $actions.ToArray()
            Summary                      = [PSCustomObject]@{
                TotalInConfig    = $section.Count
                TotalActions     = $actions.Count
                CreateActions    = $create
                UpdateActions    = $update
                ConfigureActions = $configure
                ExistingCount    = $compliant.Count
            }
            Warnings                     = $warnings.ToArray()
            Errors                       = $errors.ToArray()
            UnexpectedDeviceGroupMembers = $unexpected.ToArray()
            Compliant                    = $compliant.ToArray()
            DomainMode                   = $DomainMode
            CorrelationId                = $correlationId
        }
    }

    if ($section.Count -eq 0) {
        Write-TierModelLog -Level Info -Message 'No authentication policies/silos configured' -Data @{ CorrelationId = $correlationId } | Out-Null
        return (& $newResult $null)
    }

    # --- Domain functional level (Windows Server 2012 R2 or later) ---
    try {
        $domain = Get-ADDomain -Server $DomainController
    } catch {
        $errors.Add([PSCustomObject]@{ Code = 'AuthSiloDomainUnavailable'; Message = "Cannot read the domain via '$DomainController': $($_.Exception.Message)" })
        return (& $newResult $null)
    }
    $domainMode = [string](Get-TierModelAuthSiloValue $domain 'DomainMode')
    if (-not (Test-TierModelAuthSiloDomainMode -DomainMode $domainMode)) {
        $friendly = if ($domainMode) { $domainMode } else { 'unknown' }
        $errors.Add([PSCustomObject]@{
            Code    = 'AuthSiloDomainFunctionalLevel'
            Message = "Authentication policies and silos require a domain functional level of Windows Server 2012 R2 or later (current: $friendly). Raise the domain functional level first."
        })
        return (& $newResult $domainMode)
    }
    $domainDn = [string](Get-TierModelAuthSiloValue $domain 'DistinguishedName')
    if (-not $domainDn) { $domainDn = Resolve-TierModelDomainDN -DomainController $DomainController }

    $resolveDn = { param($p) Resolve-TierModelPlaceholder -Path ([string]$p) -DomainDN $domainDn }
    $sidCache = @{}
    $resolveSid = {
        param($name)
        $key = ([string]$name).ToLowerInvariant()
        if (-not $sidCache.ContainsKey($key)) { $sidCache[$key] = Resolve-TierModelAuthSiloGroupSid -Name $name -DomainController $DomainController }
        return $sidCache[$key]
    }

    # --- 1. Device group synchronisation ---
    foreach ($sync in $section.DeviceGroupSync) {
        $groupName = [string](Get-TierModelAuthSiloValue $sync 'group')
        if (-not $groupName) { $warnings.Add('deviceGroupSync entry without a group name ignored.'); continue }
        $tier = Get-TierModelAuthSiloTier -Entry $sync -Names @($groupName)
        $sourceOus = @(Get-TierModelAuthSiloStringList $sync 'sourceOUs' | ForEach-Object { & $resolveDn $_ })

        $groupDn = $null
        $currentMembers = @()
        try {
            $group = Get-ADGroup -Identity $groupName -Server $DomainController -Properties member
            if ($group) {
                $groupDn = [string](Get-TierModelAuthSiloValue $group 'DistinguishedName')
                $currentMembers = @(Get-TierModelAuthSiloValue $group 'member' @() | ForEach-Object { [string]$_ })
            }
        } catch {
            $group = $null
        }
        if (-not $groupDn) {
            $warnings.Add("Device group '$groupName' does not exist yet - members are planned and added once the group exists.")
        }

        $expectedDns = New-Object System.Collections.Generic.List[string]
        foreach ($ou in $sourceOus) {
            try {
                $computers = @(Get-ADComputer -SearchBase $ou -Filter * -Server $DomainController)
            } catch {
                $warnings.Add("Source OU '$ou' of device group '$groupName' not found - skipped.")
                continue
            }
            foreach ($computer in $computers) {
                if ($null -eq $computer) { continue }
                $dn = [string](Get-TierModelAuthSiloValue $computer 'DistinguishedName')
                if (-not $dn -or $expectedDns.Contains($dn)) { continue }
                $expectedDns.Add($dn)
                $isMember = @($currentMembers | Where-Object { $_ -ieq $dn }).Count -gt 0
                $computerName = [string](Get-TierModelAuthSiloValue $computer 'Name' (Get-TierModelAuthSiloCn $dn))
                if ($isMember) {
                    $compliant.Add([PSCustomObject]@{ ResourceType = 'DeviceGroupMember'; Identifier = "$computerName -> $groupName"; Tier = $tier })
                } else {
                    $actions.Add([PSCustomObject]@{
                        Action       = 'AddDeviceGroupMember'
                        ResourceType = 'DeviceGroupMember'
                        Name         = $computerName
                        Path         = $dn
                        Data         = [ordered]@{
                            group    = $groupName
                            groupDn  = $groupDn
                            computer = $dn
                            sourceOU = $ou
                            tier     = $tier
                        }
                    })
                }
            }
        }

        foreach ($member in $currentMembers) {
            $inSource = @($sourceOus | Where-Object { Test-TierModelAuthSiloDnUnder -Dn $member -ParentDn $_ }).Count -gt 0
            if (-not $inSource) {
                $unexpected.Add([PSCustomObject]@{ Group = $groupName; Member = $member; SourceOUs = $sourceOus; Tier = $tier })
            }
        }
    }

    # --- 2. Authentication policies ---
    foreach ($policy in $section.Policies) {
        $name = [string](Get-TierModelAuthSiloValue $policy 'name')
        if (-not $name) { $warnings.Add('authenticationPolicies entry without a name ignored.'); continue }
        $description = [string](Get-TierModelAuthSiloValue $policy 'description' '')
        $enforce = [bool](Get-TierModelAuthSiloValue $policy 'enforce' $false)
        $tgtRaw = Get-TierModelAuthSiloValue $policy 'userTgtLifetimeMins'
        $tgt = if ($null -ne $tgtRaw -and "$tgtRaw" -match '^\d+$') { [int]"$tgtRaw" } else { $null }
        $from = Get-TierModelAuthSiloValue $policy 'allowedToAuthenticateFrom'
        $includeDcs = [bool](Get-TierModelAuthSiloValue $from 'includeDomainControllers' $false)
        $deviceGroups = @(Get-TierModelAuthSiloStringList $from 'deviceGroups')
        $tier = Get-TierModelAuthSiloTier -Entry $policy -Names (@($name) + $deviceGroups)

        $sids = @()
        $unresolved = @()
        foreach ($g in $deviceGroups) {
            $sid = & $resolveSid $g
            if ($sid) { $sids += $sid } else { $unresolved += $g }
        }
        $sddl = $null
        if ($unresolved.Count -gt 0) {
            $warnings.Add("Authentication policy '$name': device group(s) $($unresolved -join ', ') not found - the sign-in condition is generated when the plan is applied.")
        } else {
            $sddl = New-TierModelAuthSiloSddl -IncludeDomainControllers:$includeDcs -DeviceGroupSid $sids
            if (-not $sddl) {
                $warnings.Add("Authentication policy '$name' has no allowedToAuthenticateFrom condition - users may sign in from any device.")
            }
        }
        if ($enforce) {
            $warnings.Add("Authentication policy '$name' is enforced. Verify the audit events (Microsoft-Windows-Authentication/AuthenticationPolicyFailures-DomainController) before enforcing in production.")
        }

        $data = [ordered]@{
            name                     = $name
            description              = $description
            enforce                  = $enforce
            userTgtLifetimeMins      = $tgt
            includeDomainControllers = $includeDcs
            deviceGroups             = [string[]]$deviceGroups
            deviceGroupSids          = [string[]]$sids
            sddl                     = $sddl
            tier                     = $tier
        }

        $existing = $null
        try {
            $existing = @(Get-ADAuthenticationPolicy -Filter "Name -eq '$(Get-TierModelAuthSiloAdFilterValue $name)'" -Server $DomainController -Properties *) |
                Where-Object { $null -ne $_ } | Select-Object -First 1
        } catch {
            $errors.Add([PSCustomObject]@{ Code = 'AuthPolicyReadFailed'; Message = "Cannot read authentication policy '$name': $($_.Exception.Message)" })
            continue
        }

        if (-not $existing) {
            $actions.Add([PSCustomObject]@{ Action = 'CreateAuthPolicy'; ResourceType = 'AuthenticationPolicy'; Name = $name; Path = $null; Data = $data })
            continue
        }

        $changes = New-Object System.Collections.Generic.List[string]
        $curDescription = [string](Get-TierModelAuthSiloValue $existing 'Description' '')
        $curEnforce = [bool](Get-TierModelAuthSiloValue $existing 'Enforce' $false)
        $curTgtRaw = Get-TierModelAuthSiloValue $existing 'UserTGTLifetimeMins'
        $curTgt = if ($null -ne $curTgtRaw -and "$curTgtRaw" -match '^\d+$') { [int]"$curTgtRaw" } else { $null }
        $curSddl = [string](Get-TierModelAuthSiloValue $existing 'UserAllowedToAuthenticateFrom' '')
        if ($curDescription -cne $description) { $changes.Add('description') }
        if ($curEnforce -ne $enforce) { $changes.Add('enforce') }
        if ($null -ne $tgt -and $curTgt -ne $tgt) { $changes.Add('userTgtLifetimeMins') }
        if ($unresolved.Count -eq 0 -and -not (Compare-TierModelAuthSiloSddl -Expected $sddl -Actual $curSddl)) { $changes.Add('allowedToAuthenticateFrom') }

        if ($changes.Count -gt 0) {
            $data['changes'] = [string[]]$changes.ToArray()
            $data['currentEnforce'] = $curEnforce
            $data['currentUserTgtLifetimeMins'] = $curTgt
            $data['currentSddl'] = $curSddl
            $actions.Add([PSCustomObject]@{
                Action       = 'UpdateAuthPolicy'
                ResourceType = 'AuthenticationPolicy'
                Name         = $name
                Path         = [string](Get-TierModelAuthSiloValue $existing 'DistinguishedName')
                Data         = $data
            })
        } else {
            $compliant.Add([PSCustomObject]@{ ResourceType = 'AuthenticationPolicy'; Identifier = $name; Tier = $tier })
        }
    }

    # --- 3. Authentication policy silos and their members ---
    foreach ($silo in $section.Silos) {
        $name = [string](Get-TierModelAuthSiloValue $silo 'name')
        if (-not $name) { $warnings.Add('authenticationPolicySilos entry without a name ignored.'); continue }
        $description = [string](Get-TierModelAuthSiloValue $silo 'description' '')
        $enforce = [bool](Get-TierModelAuthSiloValue $silo 'enforce' $false)
        $userPolicy = [string](Get-TierModelAuthSiloValue $silo 'userAuthenticationPolicy' '')
        $computerPolicy = [string](Get-TierModelAuthSiloValue $silo 'computerAuthenticationPolicy' '')
        $servicePolicy = [string](Get-TierModelAuthSiloValue $silo 'serviceAuthenticationPolicy' '')
        $tier = Get-TierModelAuthSiloTier -Entry $silo -Names @($name, $userPolicy)

        foreach ($ref in @($userPolicy, $computerPolicy, $servicePolicy)) {
            if ($ref -and -not (@($section.Policies | Where-Object { (Get-TierModelAuthSiloValue $_ 'name') -eq $ref }).Count)) {
                $warnings.Add("Silo '$name' references authentication policy '$ref', which is not defined in tiermodel-authsilos.json (it must already exist in AD).")
            }
        }

        $data = [ordered]@{
            name                         = $name
            description                  = $description
            enforce                      = $enforce
            userAuthenticationPolicy     = $userPolicy
            computerAuthenticationPolicy = $computerPolicy
            serviceAuthenticationPolicy  = $servicePolicy
            tier                         = $tier
        }

        $existing = $null
        try {
            $existing = @(Get-ADAuthenticationPolicySilo -Filter "Name -eq '$(Get-TierModelAuthSiloAdFilterValue $name)'" -Server $DomainController -Properties *) |
                Where-Object { $null -ne $_ } | Select-Object -First 1
        } catch {
            $errors.Add([PSCustomObject]@{ Code = 'AuthSiloReadFailed'; Message = "Cannot read authentication policy silo '$name': $($_.Exception.Message)" })
            continue
        }

        $siloMembers = @()
        if (-not $existing) {
            $actions.Add([PSCustomObject]@{ Action = 'CreateAuthSilo'; ResourceType = 'AuthenticationPolicySilo'; Name = $name; Path = $null; Data = $data })
        } else {
            $siloMembers = @(Get-TierModelAuthSiloValue $existing 'msDS-AuthNPolicySiloMembers' @() | ForEach-Object { [string]$_ })
            $changes = New-Object System.Collections.Generic.List[string]
            if ([string](Get-TierModelAuthSiloValue $existing 'Description' '') -cne $description) { $changes.Add('description') }
            if ([bool](Get-TierModelAuthSiloValue $existing 'Enforce' $false) -ne $enforce) { $changes.Add('enforce') }
            foreach ($pair in @(
                    @('userAuthenticationPolicy', 'UserAuthenticationPolicy', $userPolicy),
                    @('computerAuthenticationPolicy', 'ComputerAuthenticationPolicy', $computerPolicy),
                    @('serviceAuthenticationPolicy', 'ServiceAuthenticationPolicy', $servicePolicy))) {
                $current = [string](Get-TierModelAuthSiloCn (Get-TierModelAuthSiloValue $existing $pair[1]))
                if ($current -ne [string]$pair[2]) { $changes.Add($pair[0]) }
            }
            if ($changes.Count -gt 0) {
                $data['changes'] = [string[]]$changes.ToArray()
                $actions.Add([PSCustomObject]@{
                    Action       = 'UpdateAuthSilo'
                    ResourceType = 'AuthenticationPolicySilo'
                    Name         = $name
                    Path         = [string](Get-TierModelAuthSiloValue $existing 'DistinguishedName')
                    Data         = $data
                })
            } else {
                $compliant.Add([PSCustomObject]@{ ResourceType = 'AuthenticationPolicySilo'; Identifier = $name; Tier = $tier })
            }
        }

        # Accounts that belong to the silo
        $members = Get-TierModelAuthSiloValue $silo 'members'
        $exclude = @(Get-TierModelAuthSiloStringList $members 'excludeAccounts' | ForEach-Object { $_.TrimEnd('$').ToLowerInvariant() })
        $accounts = [ordered]@{}
        $addAccount = {
            param($obj, [string]$kind)
            if ($null -eq $obj) { return }
            $dn = [string](Get-TierModelAuthSiloValue $obj 'DistinguishedName')
            if (-not $dn -or $accounts.Contains($dn.ToLowerInvariant())) { return }
            $sam = [string](Get-TierModelAuthSiloValue $obj 'SamAccountName' (Get-TierModelAuthSiloCn $dn))
            if ($exclude -contains $sam.TrimEnd('$').ToLowerInvariant()) { return }
            $accounts[$dn.ToLowerInvariant()] = [PSCustomObject]@{
                Dn           = $dn
                Sam          = $sam
                Kind         = $kind
                AssignedSilo = Get-TierModelAuthSiloValue $obj 'msDS-AssignedAuthNPolicySilo'
            }
        }
        foreach ($ou in @(Get-TierModelAuthSiloStringList $members 'userOUs' | ForEach-Object { & $resolveDn $_ })) {
            try {
                foreach ($u in @(Get-ADUser -SearchBase $ou -Filter * -Server $DomainController -Properties 'msDS-AssignedAuthNPolicySilo')) { & $addAccount $u 'user' }
            } catch {
                $warnings.Add("User OU '$ou' of silo '$name' not found - skipped.")
            }
        }
        foreach ($ou in @(Get-TierModelAuthSiloStringList $members 'computerOUs' | ForEach-Object { & $resolveDn $_ })) {
            try {
                foreach ($c in @(Get-ADComputer -SearchBase $ou -Filter * -Server $DomainController -Properties 'msDS-AssignedAuthNPolicySilo')) { & $addAccount $c 'computer' }
            } catch {
                $warnings.Add("Computer OU '$ou' of silo '$name' not found - skipped.")
            }
        }
        foreach ($groupName in @(Get-TierModelAuthSiloStringList $members 'computerGroups')) {
            try {
                $groupMembers = @(Get-ADGroupMember -Identity $groupName -Server $DomainController)
            } catch {
                $warnings.Add("Computer group '$groupName' of silo '$name' not found - skipped.")
                continue
            }
            foreach ($gm in $groupMembers) {
                if ($null -eq $gm -or [string](Get-TierModelAuthSiloValue $gm 'objectClass') -ne 'computer') { continue }
                $gmDn = [string](Get-TierModelAuthSiloValue $gm 'DistinguishedName')
                try {
                    & $addAccount (Get-ADComputer -Identity $gmDn -Server $DomainController -Properties 'msDS-AssignedAuthNPolicySilo') 'computer'
                } catch {
                    $warnings.Add("Computer '$gmDn' (group '$groupName') could not be read - skipped.")
                }
            }
        }

        foreach ($account in $accounts.Values) {
            $granted = @($siloMembers | Where-Object { $_ -ieq $account.Dn }).Count -gt 0
            $assignedName = Get-TierModelAuthSiloCn $account.AssignedSilo
            $assigned = $existing -and $assignedName -and ($assignedName -eq $name)
            $accountData = [ordered]@{
                silo           = $name
                account        = $account.Dn
                samAccountName = $account.Sam
                accountType    = $account.Kind
                currentSilo    = $assignedName
                tier           = $tier
            }
            if (-not $granted) {
                $actions.Add([PSCustomObject]@{ Action = 'GrantSiloAccess'; ResourceType = 'AuthenticationPolicySiloMember'; Name = $account.Sam; Path = $account.Dn; Data = $accountData })
            }
            if (-not $assigned) {
                $actions.Add([PSCustomObject]@{ Action = 'AssignSilo'; ResourceType = 'AuthenticationPolicySiloAssignment'; Name = $account.Sam; Path = $account.Dn; Data = (Copy-TierModelAuthSiloData $accountData) })
            }
            if ($granted -and $assigned) {
                $compliant.Add([PSCustomObject]@{ ResourceType = 'AuthenticationPolicySiloMember'; Identifier = "$($account.Sam) -> $name"; Tier = $tier })
            }
        }
    }

    # Execution order: device groups, policies, silos, grants, assignments
    $order = @{ AddDeviceGroupMember = 0; CreateAuthPolicy = 1; UpdateAuthPolicy = 1; CreateAuthSilo = 2; UpdateAuthSilo = 2; GrantSiloAccess = 3; AssignSilo = 4 }
    $sorted = @($actions | Sort-Object -Stable -Property { $order[$_.Action] })
    $actions.Clear()
    foreach ($a in $sorted) { $actions.Add($a) }

    $result = & $newResult $domainMode

    Write-TierModelLog -Level Info -Message 'Authentication silo plan generated' -Data @{
        TotalActions  = $result.Summary.TotalActions
        Existing      = $result.Summary.ExistingCount
        Warnings      = $warnings.Count
        CorrelationId = $correlationId
    } | Out-Null

    if (-not $Silent) {
        Write-Host "Authentication Silo Plan Summary:" -ForegroundColor White
        Write-Host "  Total in Config: $($result.Summary.TotalInConfig)" -ForegroundColor Gray
        Write-Host "  Actions: $($result.Summary.TotalActions)" -ForegroundColor Yellow
        Write-Host "  Already compliant: $($result.Summary.ExistingCount)" -ForegroundColor Green
    }

    return $result
}
