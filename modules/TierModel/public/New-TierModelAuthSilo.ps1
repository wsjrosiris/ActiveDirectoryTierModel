function New-TierModelAuthSilo {
    <#
    .SYNOPSIS
    Applies an authentication policy / silo plan produced by Get-TierModelAuthSilo.

    .DESCRIPTION
    Executes the plan actions in order:
      AddDeviceGroupMember  Add-ADGroupMember -Identity <group> -Members <computer DN>
      CreateAuthPolicy      New-ADAuthenticationPolicy (-UserTGTLifetimeMins, -UserAllowedToAuthenticateFrom
                            <generated SDDL>, -Enforce, -ProtectedFromAccidentalDeletion $true)
      UpdateAuthPolicy      Set-ADAuthenticationPolicy (same values; -Clear msDS-UserAllowedToAuthenticateFrom
                            when no device condition is configured)
      CreateAuthSilo        New-ADAuthenticationPolicySilo (-User/-Computer/-ServiceAuthenticationPolicy, -Enforce)
      UpdateAuthSilo        Set-ADAuthenticationPolicySilo
      GrantSiloAccess       Grant-ADAuthenticationPolicySiloAccess -Identity <silo> -Account <DN>
      AssignSilo            Set-ADAccountAuthenticationPolicySilo -Identity <DN> -AuthenticationPolicySilo <silo>

    The SDDL of CreateAuthPolicy/UpdateAuthPolicy is generated again from the device group names at
    apply time (groups created earlier in the same deployment are therefore resolved). An action
    whose device group cannot be resolved fails; the remaining actions continue.

    .PARAMETER Plan
    Result of Get-TierModelAuthSilo.

    .PARAMETER DomainController
    Domain controller for all AD writes.

    .PARAMETER Config
    Accepted for parity with the other New-TierModel* functions (not needed).

    .OUTPUTS
    PSCustomObject: EntityType 'AuthSilo', Applied (actions done), Skipped, Errors (Code/Message/Action),
    DurationMs, Converged, CorrelationId.
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(Mandatory)]
        [object]$Plan,

        [Parameter(Mandatory)]
        [string]$DomainController,

        [object]$Config
    )

    $correlationId = [System.Guid]::NewGuid().ToString()
    $startTime = Get-Date
    $applied = New-Object System.Collections.Generic.List[object]
    $skipped = New-Object System.Collections.Generic.List[object]
    $errors = New-Object System.Collections.Generic.List[object]

    $planErrors = @(Get-TierModelAuthSiloValue $Plan 'Errors' @())
    if ($planErrors.Count -gt 0) {
        foreach ($e in $planErrors) { $errors.Add($e) }
        return [PSCustomObject]@{
            EntityType = 'AuthSilo'; Applied = @(); Skipped = @(); Errors = $errors.ToArray()
            DurationMs = ((Get-Date) - $startTime).TotalMilliseconds; Converged = $false; CorrelationId = $correlationId
        }
    }

    $sidCache = @{}
    $resolveSid = {
        param($name)
        $key = ([string]$name).ToLowerInvariant()
        if (-not $sidCache.ContainsKey($key)) { $sidCache[$key] = Resolve-TierModelAuthSiloGroupSid -Name $name -DomainController $DomainController }
        return $sidCache[$key]
    }

    $order = @{ AddDeviceGroupMember = 0; CreateAuthPolicy = 1; UpdateAuthPolicy = 1; CreateAuthSilo = 2; UpdateAuthSilo = 2; GrantSiloAccess = 3; AssignSilo = 4 }
    $planActions = @(Get-TierModelAuthSiloValue $Plan 'Actions' @()) | Where-Object { $null -ne $_ } |
        Sort-Object -Stable -Property { if ($order.ContainsKey([string]$_.Action)) { $order[[string]$_.Action] } else { 9 } }

    foreach ($action in $planActions) {
        $d = $action.Data
        $target = "$($action.Action) $($action.Name)"
        if (-not $PSCmdlet.ShouldProcess($target, $action.Action)) {
            $skipped.Add([PSCustomObject]@{ Action = $action.Action; Name = $action.Name; Reason = 'WhatIf' })
            continue
        }
        try {
            switch ($action.Action) {
                'AddDeviceGroupMember' {
                    Add-ADGroupMember -Identity ([string]$d.group) -Members ([string]$d.computer) -Server $DomainController
                    Write-Host "  ✅ Added $($action.Name) to $($d.group)" -ForegroundColor Green
                }
                { $_ -in @('CreateAuthPolicy', 'UpdateAuthPolicy') } {
                    $sids = @()
                    foreach ($g in @($d.deviceGroups)) {
                        if ([string]::IsNullOrWhiteSpace([string]$g)) { continue }
                        $sid = & $resolveSid $g
                        if (-not $sid) { throw "Device group '$g' not found - cannot build the sign-in condition." }
                        $sids += $sid
                    }
                    $sddl = New-TierModelAuthSiloSddl -IncludeDomainControllers:([bool]$d.includeDomainControllers) -DeviceGroupSid $sids
                    $params = @{
                        Description = [string]$d.description
                        Enforce     = [bool]$d.enforce
                        Server      = $DomainController
                    }
                    if ($null -ne $d.userTgtLifetimeMins) { $params['UserTGTLifetimeMins'] = [int]$d.userTgtLifetimeMins }
                    if ($action.Action -eq 'CreateAuthPolicy') {
                        if ($sddl) { $params['UserAllowedToAuthenticateFrom'] = $sddl }
                        New-ADAuthenticationPolicy -Name ([string]$d.name) -ProtectedFromAccidentalDeletion $true @params
                        Write-Host "  ✅ Created authentication policy: $($d.name)" -ForegroundColor Green
                    } else {
                        if ($sddl) {
                            $params['UserAllowedToAuthenticateFrom'] = $sddl
                        } else {
                            $params['Clear'] = 'msDS-UserAllowedToAuthenticateFrom'
                        }
                        Set-ADAuthenticationPolicy -Identity ([string]$d.name) @params
                        Write-Host "  ✅ Updated authentication policy: $($d.name)" -ForegroundColor Green
                    }
                }
                { $_ -in @('CreateAuthSilo', 'UpdateAuthSilo') } {
                    $params = @{
                        Description = [string]$d.description
                        Enforce     = [bool]$d.enforce
                        Server      = $DomainController
                    }
                    $clear = @()
                    foreach ($pair in @(
                            @('UserAuthenticationPolicy', 'userAuthenticationPolicy', 'msDS-UserAuthNPolicy'),
                            @('ComputerAuthenticationPolicy', 'computerAuthenticationPolicy', 'msDS-ComputerAuthNPolicy'),
                            @('ServiceAuthenticationPolicy', 'serviceAuthenticationPolicy', 'msDS-ServiceAuthNPolicy'))) {
                        $value = [string](Get-TierModelAuthSiloValue $d $pair[1] '')
                        if ($value) { $params[$pair[0]] = $value } elseif ($action.Action -eq 'UpdateAuthSilo') { $clear += $pair[2] }
                    }
                    if ($action.Action -eq 'CreateAuthSilo') {
                        New-ADAuthenticationPolicySilo -Name ([string]$d.name) -ProtectedFromAccidentalDeletion $true @params
                        Write-Host "  ✅ Created authentication policy silo: $($d.name)" -ForegroundColor Green
                    } else {
                        if ($clear.Count -gt 0) { $params['Clear'] = $clear }
                        Set-ADAuthenticationPolicySilo -Identity ([string]$d.name) @params
                        Write-Host "  ✅ Updated authentication policy silo: $($d.name)" -ForegroundColor Green
                    }
                }
                'GrantSiloAccess' {
                    Grant-ADAuthenticationPolicySiloAccess -Identity ([string]$d.silo) -Account ([string]$d.account) -Server $DomainController
                    Write-Host "  ✅ Granted silo access: $($action.Name) -> $($d.silo)" -ForegroundColor Green
                }
                'AssignSilo' {
                    Set-ADAccountAuthenticationPolicySilo -Identity ([string]$d.account) -AuthenticationPolicySilo ([string]$d.silo) -Server $DomainController
                    Write-Host "  ✅ Assigned silo: $($action.Name) -> $($d.silo)" -ForegroundColor Green
                }
                default {
                    throw "Unknown authentication silo action '$($action.Action)'."
                }
            }
            $applied.Add($action)
        } catch {
            $message = "$($action.Action) '$($action.Name)' failed: $($_.Exception.Message)"
            Write-Host "  ❌ $message" -ForegroundColor Red
            Write-TierModelLog -Level Error -Message 'Authentication silo action failed' -Data @{
                Action = $action.Action; Name = $action.Name; Exception = $_.Exception.Message; CorrelationId = $correlationId
            } | Out-Null
            $errors.Add([PSCustomObject]@{ Code = 'AuthSiloActionFailed'; Action = $action.Action; Name = $action.Name; Message = $message })
        }
    }

    $durationMs = ((Get-Date) - $startTime).TotalMilliseconds
    Write-TierModelLog -Level Info -Message 'Authentication silo plan applied' -Data @{
        Applied = $applied.Count; Errors = $errors.Count; DurationMs = $durationMs; CorrelationId = $correlationId
    } | Out-Null

    return [PSCustomObject]@{
        EntityType    = 'AuthSilo'
        Applied       = $applied.ToArray()
        Skipped       = $skipped.ToArray()
        Errors        = $errors.ToArray()
        DurationMs    = $durationMs
        Converged     = ($errors.Count -eq 0)
        CorrelationId = $correlationId
    }
}
