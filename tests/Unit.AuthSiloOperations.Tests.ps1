#Requires -Modules Pester
<#
.SYNOPSIS
Unit tests for the config-driven authentication policies / silos (roadmap item 10):
New-TierModelAuthSiloSddl, Get-TierModelAuthSilo, New-TierModelAuthSilo, Test-TierModelAuthSilo,
config loading (tiermodel-authsilos.json), plan export (area 'authsilos') and the audit report merge.

.DESCRIPTION
A small in-memory directory ($global:TMAS) backs mocked AD cmdlets. Runs without RSAT / a domain.
#>

BeforeAll {
    . (Join-Path $PSScriptRoot 'helpers' 'ADStubs.ps1')
    Import-Module (Join-Path $PSScriptRoot '..' 'modules' 'TierModel' 'TierModel.psd1') -Force

    $script:DomainDn = 'DC=contoso,DC=com'
    $script:T0PawOu = "OU=Tier 0 PAW Devices,OU=Tier 0,OU=Tier Model Administration,$script:DomainDn"
    $script:T0AccountsOu = "OU=Tier 0 Accounts,OU=Tier 0,OU=Tier Model Administration,$script:DomainDn"
    $script:T1AccountsOu = "OU=Tier 1 Accounts,OU=Tier 1,OU=Tier Model Administration,$script:DomainDn"
    $script:PawSid = 'S-1-5-21-1-2-3-1101'
    $script:MemberServerSid = 'S-1-5-21-1-2-3-1102'
    $script:T1PawSid = 'S-1-5-21-1-2-3-1201'

    function global:New-TMASConfig {
        param([bool]$Enforce = $false, [string[]]$ExcludeAccounts = @())
        [PSCustomObject]@{
            authSilos = [PSCustomObject]@{
                authenticationPolicies    = @(
                    [PSCustomObject]@{
                        name = 'Tier 0 Authentication Policy'; description = 'T0 policy'; enforce = $Enforce; userTgtLifetimeMins = 240
                        allowedToAuthenticateFrom = [PSCustomObject]@{ includeDomainControllers = $true; deviceGroups = @('Tier0PAWDevices', 'Tier0MemberServers') }
                    },
                    [PSCustomObject]@{
                        name = 'Tier 1 Authentication Policy'; description = 'T1 policy'; enforce = $false; userTgtLifetimeMins = 240
                        allowedToAuthenticateFrom = [PSCustomObject]@{ includeDomainControllers = $false; deviceGroups = @('Tier1PAWDevices') }
                    }
                )
                authenticationPolicySilos = @(
                    [PSCustomObject]@{
                        name = 'Tier 0 Authentication Silo'; description = 'T0 silo'; enforce = $false
                        userAuthenticationPolicy = 'Tier 0 Authentication Policy'; computerAuthenticationPolicy = ''; serviceAuthenticationPolicy = ''
                        members = [PSCustomObject]@{
                            userOUs = @('OU=Tier 0 Accounts,OU=Tier 0,OU=Tier Model Administration,{{DOMAIN_DN}}')
                            computerGroups = @(); computerOUs = @(); excludeAccounts = $ExcludeAccounts
                        }
                    }
                )
                deviceGroupSync           = @(
                    [PSCustomObject]@{ group = 'Tier0PAWDevices'; sourceOUs = @('OU=Tier 0 PAW Devices,OU=Tier 0,OU=Tier Model Administration,{{DOMAIN_DN}}') }
                )
            }
        }
    }

    # In-memory directory. Groups by sAMAccountName, policies/silos by name.
    function global:Initialize-TMAS {
        param([string]$DomainMode = 'Windows2016Domain')
        $global:TMAS = @{
            DomainMode = $DomainMode
            Groups     = @{
                'Tier0PAWDevices'    = [PSCustomObject]@{ DistinguishedName = "CN=Tier0PAWDevices,OU=Tier 0 Groups,$script:DomainDn"; SID = [PSCustomObject]@{ Value = $script:PawSid }; member = @() }
                'Tier0MemberServers' = [PSCustomObject]@{ DistinguishedName = "CN=Tier0MemberServers,OU=Tier 0 Groups,$script:DomainDn"; SID = [PSCustomObject]@{ Value = $script:MemberServerSid }; member = @() }
                'Tier1PAWDevices'    = [PSCustomObject]@{ DistinguishedName = "CN=Tier1PAWDevices,OU=Tier 1 Groups,$script:DomainDn"; SID = [PSCustomObject]@{ Value = $script:T1PawSid }; member = @() }
            }
            OUs        = @($script:T0PawOu, $script:T0AccountsOu)
            Computers  = @(
                [PSCustomObject]@{ Name = 'PAW01'; SamAccountName = 'PAW01$'; DistinguishedName = "CN=PAW01,$script:T0PawOu"; 'msDS-AssignedAuthNPolicySilo' = $null }
            )
            Users      = @(
                [PSCustomObject]@{ SamAccountName = 't0-alice'; DistinguishedName = "CN=t0-alice,$script:T0AccountsOu"; 'msDS-AssignedAuthNPolicySilo' = $null },
                [PSCustomObject]@{ SamAccountName = 't0-bob'; DistinguishedName = "CN=t0-bob,$script:T0AccountsOu"; 'msDS-AssignedAuthNPolicySilo' = $null }
            )
            Policies   = @{}
            Silos      = @{}
            Calls      = New-Object System.Collections.Generic.List[object]
        }
    }

    function global:Set-TMASConverged {
        # Everything matches the output of New-TMASConfig
        $global:TMAS.Groups['Tier0PAWDevices'].member = @("CN=PAW01,$script:T0PawOu")
        $global:TMAS.Policies['Tier 0 Authentication Policy'] = [PSCustomObject]@{
            Name = 'Tier 0 Authentication Policy'; Description = 'T0 policy'; Enforce = $false; UserTGTLifetimeMins = 240
            DistinguishedName = 'CN=Tier 0 Authentication Policy,CN=AuthN Policies,CN=AuthN Policy Configuration,CN=Services,CN=Configuration,DC=contoso,DC=com'
            # AD renders ED as its SID and may change whitespace - still equivalent
            UserAllowedToAuthenticateFrom = "O:SYG:SYD:(XA;OICI;CR;;;WD;((Member_of {SID(S-1-5-9)}) || (Member_of_any {SID($script:PawSid),SID($script:MemberServerSid)})))"
        }
        $global:TMAS.Policies['Tier 1 Authentication Policy'] = [PSCustomObject]@{
            Name = 'Tier 1 Authentication Policy'; Description = 'T1 policy'; Enforce = $false; UserTGTLifetimeMins = 240
            DistinguishedName = 'CN=Tier 1 Authentication Policy,CN=AuthN Policies,CN=AuthN Policy Configuration,CN=Services,CN=Configuration,DC=contoso,DC=com'
            UserAllowedToAuthenticateFrom = "O:SYG:SYD:(XA;OICI;CR;;;WD;(Member_of_any {SID($script:T1PawSid)}))"
        }
        $siloDn = 'CN=Tier 0 Authentication Silo,CN=AuthN Silos,CN=AuthN Policy Configuration,CN=Services,CN=Configuration,DC=contoso,DC=com'
        $global:TMAS.Silos['Tier 0 Authentication Silo'] = [PSCustomObject]@{
            Name = 'Tier 0 Authentication Silo'; Description = 'T0 silo'; Enforce = $false; DistinguishedName = $siloDn
            UserAuthenticationPolicy = $global:TMAS.Policies['Tier 0 Authentication Policy'].DistinguishedName
            ComputerAuthenticationPolicy = $null; ServiceAuthenticationPolicy = $null
            'msDS-AuthNPolicySiloMembers' = @($global:TMAS.Users | ForEach-Object { $_.DistinguishedName })
        }
        foreach ($u in $global:TMAS.Users) { $u.'msDS-AssignedAuthNPolicySilo' = $siloDn }
    }

    function global:Register-TMASMocks {
        Mock Write-TierModelLog -ModuleName TierModel { }
        Mock Write-Host -ModuleName TierModel { }
        Mock Get-ADDomain -ModuleName TierModel {
            [PSCustomObject]@{ DomainMode = $global:TMAS.DomainMode; DistinguishedName = 'DC=contoso,DC=com'; DNSRoot = 'contoso.com'; DomainSID = [PSCustomObject]@{ Value = 'S-1-5-21-1-2-3' } }
        }
        Mock Get-ADGroup -ModuleName TierModel {
            param($Identity)
            $g = $global:TMAS.Groups[[string]$Identity]
            if (-not $g) { throw [Microsoft.ActiveDirectory.Management.ADIdentityNotFoundException]::new("Cannot find group '$Identity'") }
            return $g
        }
        Mock Get-ADGroupMember -ModuleName TierModel { param($Identity) @() }
        Mock Get-ADComputer -ModuleName TierModel {
            param($Identity, $SearchBase)
            if ($SearchBase) {
                if ($global:TMAS.OUs -notcontains $SearchBase) { throw "Directory object not found: $SearchBase" }
                return @($global:TMAS.Computers | Where-Object { $_.DistinguishedName -like "*,$SearchBase" })
            }
            return @($global:TMAS.Computers | Where-Object { $_.DistinguishedName -eq $Identity })
        }
        Mock Get-ADUser -ModuleName TierModel {
            param($SearchBase)
            if ($global:TMAS.OUs -notcontains $SearchBase) { throw "Directory object not found: $SearchBase" }
            return @($global:TMAS.Users | Where-Object { $_.DistinguishedName -like "*,$SearchBase" })
        }
        Mock Get-ADAuthenticationPolicy -ModuleName TierModel {
            param($Filter)
            if ($Filter -match "Name -eq '(.+)'") { return $global:TMAS.Policies[$Matches[1]] }
        }
        Mock Get-ADAuthenticationPolicySilo -ModuleName TierModel {
            param($Filter)
            if ($Filter -match "Name -eq '(.+)'") { return $global:TMAS.Silos[$Matches[1]] }
        }
        Mock New-ADAuthenticationPolicy -ModuleName TierModel { $global:TMAS.Calls.Add([PSCustomObject]@{ Cmd = 'New-ADAuthenticationPolicy'; Args = $PesterBoundParameters }) }
        Mock Set-ADAuthenticationPolicy -ModuleName TierModel { $global:TMAS.Calls.Add([PSCustomObject]@{ Cmd = 'Set-ADAuthenticationPolicy'; Args = $PesterBoundParameters }) }
        Mock New-ADAuthenticationPolicySilo -ModuleName TierModel { $global:TMAS.Calls.Add([PSCustomObject]@{ Cmd = 'New-ADAuthenticationPolicySilo'; Args = $PesterBoundParameters }) }
        Mock Set-ADAuthenticationPolicySilo -ModuleName TierModel { $global:TMAS.Calls.Add([PSCustomObject]@{ Cmd = 'Set-ADAuthenticationPolicySilo'; Args = $PesterBoundParameters }) }
        Mock Grant-ADAuthenticationPolicySiloAccess -ModuleName TierModel { $global:TMAS.Calls.Add([PSCustomObject]@{ Cmd = 'Grant-ADAuthenticationPolicySiloAccess'; Args = $PesterBoundParameters }) }
        Mock Set-ADAccountAuthenticationPolicySilo -ModuleName TierModel { $global:TMAS.Calls.Add([PSCustomObject]@{ Cmd = 'Set-ADAccountAuthenticationPolicySilo'; Args = $PesterBoundParameters }) }
        Mock Add-ADGroupMember -ModuleName TierModel { $global:TMAS.Calls.Add([PSCustomObject]@{ Cmd = 'Add-ADGroupMember'; Args = $PesterBoundParameters }) }
    }
}

AfterAll {
    Remove-Item -Path Function:\New-TMASConfig, Function:\Initialize-TMAS, Function:\Set-TMASConverged, Function:\Register-TMASMocks -ErrorAction SilentlyContinue
    Remove-Variable -Name TMAS -Scope Global -ErrorAction SilentlyContinue
}

Describe 'New-TierModelAuthSiloSddl' -Tag 'Unit', 'AuthSilo' {
    It 'Domain controllers only' {
        New-TierModelAuthSiloSddl -IncludeDomainControllers |
            Should -BeExactly 'O:SYG:SYD:(XA;OICI;CR;;;WD;(Member_of {SID(ED)}))'
    }

    It 'Device groups only - Member_of_any, duplicates removed, SIDs upper case, order kept' {
        New-TierModelAuthSiloSddl -DeviceGroupSid 'S-1-5-21-1-2-3-1102', 's-1-5-21-1-2-3-1101', 'S-1-5-21-1-2-3-1102' |
            Should -BeExactly 'O:SYG:SYD:(XA;OICI;CR;;;WD;(Member_of_any {SID(S-1-5-21-1-2-3-1102), SID(S-1-5-21-1-2-3-1101)}))'
    }

    It 'Domain controllers OR device groups (never &&)' {
        $sddl = New-TierModelAuthSiloSddl -IncludeDomainControllers -DeviceGroupSid 'S-1-5-21-1-2-3-1101', 'S-1-5-21-1-2-3-1102'
        $sddl | Should -BeExactly 'O:SYG:SYD:(XA;OICI;CR;;;WD;((Member_of {SID(ED)}) || (Member_of_any {SID(S-1-5-21-1-2-3-1101), SID(S-1-5-21-1-2-3-1102)})))'
        $sddl | Should -Not -Match '&&'
    }

    It 'Returns $null when there is no condition' {
        New-TierModelAuthSiloSddl | Should -BeNullOrEmpty
        New-TierModelAuthSiloSddl -DeviceGroupSid @() | Should -BeNullOrEmpty
    }

    It 'Rejects group names (SIDs must be resolved first)' {
        { New-TierModelAuthSiloSddl -DeviceGroupSid 'Tier0PAWDevices' } | Should -Throw '*Invalid SID*'
    }
}

Describe 'Get-TierModelAuthSilo (plan)' -Tag 'Unit', 'AuthSilo' {
    BeforeEach {
        Initialize-TMAS
        Register-TMASMocks
    }

    It 'Plans everything when nothing exists, in execution order' {
        $plan = Get-TierModelAuthSilo -Config (New-TMASConfig) -DomainController 'dc01' -Silent
        @($plan.Errors).Count | Should -Be 0
        $plan.EntityType | Should -Be 'AuthSilo'
        $names = @($plan.Actions | ForEach-Object { $_.Action })
        $names | Should -Be @('AddDeviceGroupMember', 'CreateAuthPolicy', 'CreateAuthPolicy', 'CreateAuthSilo',
            'GrantSiloAccess', 'GrantSiloAccess', 'AssignSilo', 'AssignSilo')

        $t0 = $plan.Actions | Where-Object { $_.Action -eq 'CreateAuthPolicy' -and $_.Name -eq 'Tier 0 Authentication Policy' }
        $t0.ResourceType | Should -Be 'AuthenticationPolicy'
        $t0.Data.sddl | Should -BeExactly "O:SYG:SYD:(XA;OICI;CR;;;WD;((Member_of {SID(ED)}) || (Member_of_any {SID($script:PawSid), SID($script:MemberServerSid)})))"
        $t0.Data.userTgtLifetimeMins | Should -Be 240
        $t0.Data.tier | Should -Be 0

        $device = $plan.Actions | Where-Object Action -eq 'AddDeviceGroupMember'
        $device.Name | Should -Be 'PAW01'
        $device.Path | Should -Be "CN=PAW01,$script:T0PawOu"
        $device.Data.group | Should -Be 'Tier0PAWDevices'

        $grant = @($plan.Actions | Where-Object Action -eq 'GrantSiloAccess')[0]
        $grant.Data.silo | Should -Be 'Tier 0 Authentication Silo'
        $grant.Path | Should -Be "CN=t0-alice,$script:T0AccountsOu"
        $plan.Summary.TotalActions | Should -Be 8
        $plan.Summary.CreateActions | Should -Be 3
        $plan.Summary.ConfigureActions | Should -Be 4
    }

    It 'Returns no actions when AD matches the configuration (equivalent SDDL rendering)' {
        Set-TMASConverged
        $plan = Get-TierModelAuthSilo -Config (New-TMASConfig) -DomainController 'dc01' -Silent
        @($plan.Actions).Count | Should -Be 0
        $plan.Summary.ExistingCount | Should -Be 6   # 1 device member, 2 policies, 1 silo, 2 accounts
        @($plan.Errors).Count | Should -Be 0
    }

    It 'Plans UpdateAuthPolicy for the old && condition and a changed enforce flag' {
        Set-TMASConverged
        $global:TMAS.Policies['Tier 0 Authentication Policy'].UserAllowedToAuthenticateFrom =
            "O:SYG:SYD:(XA;OICI;CR;;;WD;((Member_of {SID(ED)}) || ((Member_of {SID($script:PawSid)}) && (Member_of {SID($script:MemberServerSid)}))))"
        $plan = Get-TierModelAuthSilo -Config (New-TMASConfig -Enforce $true) -DomainController 'dc01' -Silent
        $update = @($plan.Actions | Where-Object Action -eq 'UpdateAuthPolicy')
        $update.Count | Should -Be 1
        $update[0].Name | Should -Be 'Tier 0 Authentication Policy'
        @($update[0].Data.changes) | Should -Contain 'allowedToAuthenticateFrom'
        @($update[0].Data.changes) | Should -Contain 'enforce'
        @($plan.Warnings) -join ' ' | Should -Match 'enforced'
    }

    It 'Plans UpdateAuthSilo when the silo points to another policy' {
        Set-TMASConverged
        $global:TMAS.Silos['Tier 0 Authentication Silo'].UserAuthenticationPolicy = 'CN=Other,CN=AuthN Policies,CN=AuthN Policy Configuration,CN=Services,CN=Configuration,DC=contoso,DC=com'
        $plan = Get-TierModelAuthSilo -Config (New-TMASConfig) -DomainController 'dc01' -Silent
        $update = @($plan.Actions | Where-Object Action -eq 'UpdateAuthSilo')
        $update.Count | Should -Be 1
        @($update[0].Data.changes) | Should -Be @('userAuthenticationPolicy')
    }

    It 'Plans AssignSilo only for an account that is permitted but not assigned' {
        Set-TMASConverged
        $global:TMAS.Users[1].'msDS-AssignedAuthNPolicySilo' = $null
        $plan = Get-TierModelAuthSilo -Config (New-TMASConfig) -DomainController 'dc01' -Silent
        @($plan.Actions | ForEach-Object Action) | Should -Be @('AssignSilo')
        $plan.Actions[0].Name | Should -Be 't0-bob'
    }

    It 'Honours excludeAccounts' {
        $plan = Get-TierModelAuthSilo -Config (New-TMASConfig -ExcludeAccounts @('T0-BOB')) -DomainController 'dc01' -Silent
        @($plan.Actions | Where-Object { $_.Action -in 'GrantSiloAccess', 'AssignSilo' } | ForEach-Object Name | Select-Object -Unique) | Should -Be @('t0-alice')
    }

    It 'Returns an error and no actions below domain functional level 2012 R2' {
        Initialize-TMAS -DomainMode 'Windows2012Domain'
        $plan = Get-TierModelAuthSilo -Config (New-TMASConfig) -DomainController 'dc01' -Silent
        @($plan.Actions).Count | Should -Be 0
        $plan.Errors[0].Code | Should -Be 'AuthSiloDomainFunctionalLevel'
        $plan.Errors[0].Message | Should -Match '2012 R2'
        Should -Invoke Get-ADAuthenticationPolicy -ModuleName TierModel -Exactly -Times 0
    }

    It 'Warns about a missing device group and defers the SDDL (full deployment before groups exist)' {
        $global:TMAS.Groups.Remove('Tier0MemberServers')
        $plan = Get-TierModelAuthSilo -Config (New-TMASConfig) -DomainController 'dc01' -Silent
        $t0 = $plan.Actions | Where-Object { $_.Name -eq 'Tier 0 Authentication Policy' }
        $t0.Action | Should -Be 'CreateAuthPolicy'
        $t0.Data.sddl | Should -BeNullOrEmpty
        @($plan.Warnings) -join ' ' | Should -Match 'Tier0MemberServers'
    }

    It 'Resolves built-in groups by SID, not by (localized) name' {
        Mock Get-ADGroup -ModuleName TierModel -ParameterFilter { $Identity -eq 'Domain Controllers' } { throw 'lookup by name must not be used' }
        $cfg = New-TMASConfig
        $cfg.authSilos.authenticationPolicies[1].allowedToAuthenticateFrom.deviceGroups = @('Domain Controllers')
        $plan = Get-TierModelAuthSilo -Config $cfg -DomainController 'dc01' -Silent
        $t1 = $plan.Actions | Where-Object { $_.Name -eq 'Tier 1 Authentication Policy' }
        $t1.Data.sddl | Should -BeExactly 'O:SYG:SYD:(XA;OICI;CR;;;WD;(Member_of_any {SID(S-1-5-21-1-2-3-516)}))'
    }

    It 'Does nothing (and queries nothing) without auth silo configuration' {
        $plan = Get-TierModelAuthSilo -Config ([PSCustomObject]@{ groups = @() }) -DomainController 'dc01' -Silent
        @($plan.Actions).Count | Should -Be 0
        $plan.Summary.TotalInConfig | Should -Be 0
        Should -Invoke Get-ADDomain -ModuleName TierModel -Exactly -Times 0
    }

    It 'Reports device group members outside the source OUs without planning a removal' {
        Set-TMASConverged
        $global:TMAS.Groups['Tier0PAWDevices'].member += 'CN=WS42,OU=Tier 2 End-User Devices,DC=contoso,DC=com'
        $plan = Get-TierModelAuthSilo -Config (New-TMASConfig) -DomainController 'dc01' -Silent
        @($plan.Actions).Count | Should -Be 0
        @($plan.UnexpectedDeviceGroupMembers).Count | Should -Be 1
        $plan.UnexpectedDeviceGroupMembers[0].Member | Should -Match 'WS42'
    }
}

Describe 'New-TierModelAuthSilo (apply)' -Tag 'Unit', 'AuthSilo' {
    BeforeEach {
        Initialize-TMAS
        Register-TMASMocks
    }

    It 'Creates policies with the generated SDDL, the silo, grants, assignments and device members' {
        $plan = Get-TierModelAuthSilo -Config (New-TMASConfig) -DomainController 'dc01' -Silent
        $result = New-TierModelAuthSilo -Plan $plan -DomainController 'dc01' -Confirm:$false
        $result.Converged | Should -BeTrue
        @($result.Applied).Count | Should -Be 8
        @($result.Errors).Count | Should -Be 0

        $cmds = @($global:TMAS.Calls | ForEach-Object Cmd)
        $cmds[0] | Should -Be 'Add-ADGroupMember'
        $cmds | Should -Contain 'New-ADAuthenticationPolicySilo'
        $cmds[-1] | Should -Be 'Set-ADAccountAuthenticationPolicySilo'

        $newPolicy = $global:TMAS.Calls | Where-Object { $_.Cmd -eq 'New-ADAuthenticationPolicy' -and $_.Args.Name -eq 'Tier 0 Authentication Policy' }
        $newPolicy.Args.UserAllowedToAuthenticateFrom | Should -BeExactly "O:SYG:SYD:(XA;OICI;CR;;;WD;((Member_of {SID(ED)}) || (Member_of_any {SID($script:PawSid), SID($script:MemberServerSid)})))"
        $newPolicy.Args.UserTGTLifetimeMins | Should -Be 240
        $newPolicy.Args.Enforce | Should -BeFalse
        $newPolicy.Args.Server | Should -Be 'dc01'

        $silo = $global:TMAS.Calls | Where-Object Cmd -eq 'New-ADAuthenticationPolicySilo'
        $silo.Args.UserAuthenticationPolicy | Should -Be 'Tier 0 Authentication Policy'
        $silo.Args.ContainsKey('ComputerAuthenticationPolicy') | Should -BeFalse

        $grant = @($global:TMAS.Calls | Where-Object Cmd -eq 'Grant-ADAuthenticationPolicySiloAccess')[0]
        $grant.Args.Identity | Should -Be 'Tier 0 Authentication Silo'
        $grant.Args.Account | Should -Be "CN=t0-alice,$script:T0AccountsOu"

        $add = $global:TMAS.Calls | Where-Object Cmd -eq 'Add-ADGroupMember'
        $add.Args.Identity | Should -Be 'Tier0PAWDevices'
        $add.Args.Members | Should -Be "CN=PAW01,$script:T0PawOu"
    }

    It 'Regenerates the SDDL at apply time for groups created after planning' {
        $global:TMAS.Groups.Remove('Tier0MemberServers')
        $plan = Get-TierModelAuthSilo -Config (New-TMASConfig) -DomainController 'dc01' -Silent
        $global:TMAS.Groups['Tier0MemberServers'] = [PSCustomObject]@{ DistinguishedName = 'CN=Tier0MemberServers'; SID = [PSCustomObject]@{ Value = $script:MemberServerSid }; member = @() }
        $null = New-TierModelAuthSilo -Plan $plan -DomainController 'dc01' -Confirm:$false
        $newPolicy = $global:TMAS.Calls | Where-Object { $_.Cmd -eq 'New-ADAuthenticationPolicy' -and $_.Args.Name -eq 'Tier 0 Authentication Policy' }
        $newPolicy.Args.UserAllowedToAuthenticateFrom | Should -Match ([regex]::Escape("SID($script:MemberServerSid)"))
    }

    It 'Fails only the affected action when a device group still cannot be resolved' {
        $global:TMAS.Groups.Remove('Tier1PAWDevices')
        $plan = Get-TierModelAuthSilo -Config (New-TMASConfig) -DomainController 'dc01' -Silent
        $result = New-TierModelAuthSilo -Plan $plan -DomainController 'dc01' -Confirm:$false
        $result.Converged | Should -BeFalse
        @($result.Errors).Count | Should -Be 1
        $result.Errors[0].Message | Should -Match 'Tier1PAWDevices'
        @($result.Applied).Count | Should -Be 7
    }

    It 'Updates a policy and clears the condition when no device restriction is configured' {
        Set-TMASConverged
        $cfg = New-TMASConfig
        $cfg.authSilos.authenticationPolicies[1].allowedToAuthenticateFrom.deviceGroups = @()
        $plan = Get-TierModelAuthSilo -Config $cfg -DomainController 'dc01' -Silent
        $null = New-TierModelAuthSilo -Plan $plan -DomainController 'dc01' -Confirm:$false
        $set = $global:TMAS.Calls | Where-Object Cmd -eq 'Set-ADAuthenticationPolicy'
        $set.Args.Identity | Should -Be 'Tier 1 Authentication Policy'
        $set.Args.Clear | Should -Be 'msDS-UserAllowedToAuthenticateFrom'
    }

    It 'Changes nothing with -WhatIf' {
        $plan = Get-TierModelAuthSilo -Config (New-TMASConfig) -DomainController 'dc01' -Silent
        $result = New-TierModelAuthSilo -Plan $plan -DomainController 'dc01' -WhatIf
        @($result.Skipped).Count | Should -Be 8
        $global:TMAS.Calls.Count | Should -Be 0
    }

    It 'Does not apply a plan with errors' {
        Initialize-TMAS -DomainMode 'Windows2008R2Domain'
        $plan = Get-TierModelAuthSilo -Config (New-TMASConfig) -DomainController 'dc01' -Silent
        $result = New-TierModelAuthSilo -Plan $plan -DomainController 'dc01' -Confirm:$false
        $result.Converged | Should -BeFalse
        $global:TMAS.Calls.Count | Should -Be 0
    }
}

Describe 'Test-TierModelAuthSilo (audit)' -Tag 'Unit', 'AuthSilo' {
    BeforeEach {
        Initialize-TMAS
        Register-TMASMocks
    }

    It 'Is compliant when AD matches the configuration' {
        Set-TMASConverged
        $audit = Test-TierModelAuthSilo -Config (New-TMASConfig) -DomainController 'dc01' -Silent
        $audit.Drift | Should -Be 0
        $audit.Compliant | Should -Be 6
        $audit.TotalChecked | Should -Be 6
        @($audit.Findings).Count | Should -Be 0
    }

    It 'Reports standard findings with Area authsilos and tier-based severity' {
        $audit = Test-TierModelAuthSilo -Config (New-TMASConfig) -DomainController 'dc01' -Silent
        $audit.Missing | Should -Be 6        # 2 policies, 1 silo, 2 grants, 1 device member
        $audit.Mismatched | Should -Be 2     # 2 assignments
        foreach ($f in $audit.Findings) {
            $f.Area | Should -Be 'authsilos'
            @($f.PSObject.Properties.Name) | Should -Contain 'ExpectedValue'
            @($f.PSObject.Properties.Name) | Should -Contain 'ActualValue'
        }
        ($audit.Findings | Where-Object Identifier -eq 'Tier 0 Authentication Policy').Severity | Should -Be 'High'
        ($audit.Findings | Where-Object Identifier -eq 'Tier 1 Authentication Policy').Severity | Should -Be 'Medium'
        ($audit.Findings | Where-Object ResourceType -eq 'DeviceGroupMember').Severity | Should -Be 'High'
    }

    It 'Reports the old && condition as a mismatch and unexpected device group members' {
        Set-TMASConverged
        $global:TMAS.Policies['Tier 1 Authentication Policy'].UserAllowedToAuthenticateFrom = 'O:SYG:SYD:(XA;OICI;CR;;;WD;((Member_of {SID(S-1-5-21-1-2-3-1201)}) && (Member_of {SID(S-1-5-21-1-2-3-1202)})))'
        $global:TMAS.Groups['Tier0PAWDevices'].member += 'CN=WS42,OU=Tier 2 End-User Devices,DC=contoso,DC=com'
        $audit = Test-TierModelAuthSilo -Config (New-TMASConfig) -DomainController 'dc01' -Silent
        $mismatch = $audit.Findings | Where-Object Type -eq 'Mismatch'
        $mismatch.Identifier | Should -Be 'Tier 1 Authentication Policy'
        $mismatch.Property | Should -Be 'allowedToAuthenticateFrom'
        $mismatch.Severity | Should -Be 'Medium'
        $unexpected = $audit.Findings | Where-Object Type -eq 'Unexpected'
        $unexpected.Severity | Should -Be 'High'
        $audit.Unexpected | Should -Be 1
        $audit.Drift | Should -Be 2
    }

    It 'Reports the domain functional level as a High error finding' {
        Initialize-TMAS -DomainMode 'Windows2012Domain'
        $audit = Test-TierModelAuthSilo -Config (New-TMASConfig) -DomainController 'dc01' -Silent
        $audit.Errors | Should -Be 1
        $audit.Findings[0].Type | Should -Be 'Error'
        $audit.Findings[0].Severity | Should -Be 'High'
        $audit.Findings[0].Identifier | Should -Be 'AuthSiloDomainFunctionalLevel'
    }

    It 'Keeps area and severity in the consolidated audit report' {
        $audit = Test-TierModelAuthSilo -Config (New-TMASConfig) -DomainController 'dc01' -Silent
        $entity = [PSCustomObject]@{
            EntityType = 'AuthSilo'
            Summary    = @{ TotalAcls = $audit.TotalChecked; Compliant = $audit.Compliant; Missing = $audit.Missing; Mismatched = $audit.Mismatched; Errors = $audit.Errors; Drift = $audit.Drift }
            Findings   = $audit.Findings
        }
        $merged = Merge-TierModelAuditResult -AuditResults @($entity)
        @($merged.Findings).Count | Should -Be 8
        @($merged.Findings | ForEach-Object Area | Select-Object -Unique) | Should -Be @('authsilos')
        ($merged.Findings | Where-Object Identifier -eq 'Tier 1 Authentication Policy').Severity | Should -Be 'Medium'
        $merged.Summary.MissingCount | Should -Be 6
        $merged.Summary.MismatchCount | Should -Be 2
    }
}

Describe 'Auth silo configuration (tiermodel-authsilos.json)' -Tag 'Unit', 'AuthSilo', 'Config' {
    BeforeAll {
        Mock Write-TierModelLog -ModuleName TierModel { }
        $script:ConfigDir = Join-Path $PSScriptRoot '..' 'config'
    }

    It 'Is loaded by Get-TierModelConfig into authSilos' {
        $cfg = Get-TierModelConfig -ConfigPath $script:ConfigDir
        @($cfg.authSilos.authenticationPolicies).Count | Should -Be 2
        @($cfg.authSilos.authenticationPolicySilos).Count | Should -Be 2
        @($cfg.authSilos.deviceGroupSync).Count | Should -Be 4
        $cfg.authSilos.authenticationPolicies[0].allowedToAuthenticateFrom.includeDomainControllers | Should -BeTrue
    }

    It 'Leaves authSilos empty when the file is absent' {
        $dir = Join-Path $TestDrive 'cfg-noauthsilo'
        New-Item -ItemType Directory -Path $dir | Out-Null
        Get-ChildItem -Path $script:ConfigDir -Filter 'tiermodel-*.json' | Where-Object Name -ne 'tiermodel-authsilos.json' |
            Copy-Item -Destination $dir
        $cfg = Get-TierModelConfig -ConfigPath $dir
        $cfg.authSilos | Should -BeNullOrEmpty
    }

    It 'References only groups and OUs defined in the Tier Model configuration' {
        $raw = Get-Content (Join-Path $script:ConfigDir 'tiermodel-authsilos.json') -Raw | ConvertFrom-Json
        $groups = (Get-Content (Join-Path $script:ConfigDir 'tiermodel-groups.json') -Raw | ConvertFrom-Json).groups
        $ous = (Get-Content (Join-Path $script:ConfigDir 'tiermodel-ous.json') -Raw | ConvertFrom-Json).organizationUnits
        $groupSams = @($groups | ForEach-Object samaccountname)
        $ouDns = @($ous | ForEach-Object {
                $parent = if ($_.path -eq '{{DOMAIN_DN}}') { '{{DOMAIN_DN}}' } else { "$($_.path),{{DOMAIN_DN}}" }
                "OU=$($_.name),$parent"
            })

        $referencedGroups = @($raw.authenticationPolicies | ForEach-Object { $_.allowedToAuthenticateFrom.deviceGroups }) +
            @($raw.deviceGroupSync | ForEach-Object group)
        foreach ($g in $referencedGroups) { $groupSams | Should -Contain $g }

        $referencedOus = @($raw.deviceGroupSync | ForEach-Object { $_.sourceOUs }) +
            @($raw.authenticationPolicySilos | ForEach-Object { $_.members.userOUs })
        foreach ($ou in $referencedOus) { $ouDns | Should -Contain $ou }

        $policyNames = @($raw.authenticationPolicies | ForEach-Object name)
        foreach ($silo in $raw.authenticationPolicySilos) { $policyNames | Should -Contain $silo.userAuthenticationPolicy }
    }

    It 'Ships in audit mode (enforce = false)' {
        $raw = Get-Content (Join-Path $script:ConfigDir 'tiermodel-authsilos.json') -Raw | ConvertFrom-Json
        @($raw.authenticationPolicies + $raw.authenticationPolicySilos | Where-Object enforce).Count | Should -Be 0
    }

    It 'Is described in the configuration schema' {
        $schema = Get-Content (Join-Path $script:ConfigDir 'tiermodel.schema.json') -Raw | ConvertFrom-Json
        @($schema.properties.authSilos.properties.PSObject.Properties.Name) | Should -Be @('authenticationPolicies', 'authenticationPolicySilos', 'deviceGroupSync')
    }
}

Describe 'Auth silo plan export and script wiring' -Tag 'Unit', 'AuthSilo', 'Plan' {
    It 'Exports the phase with area authsilos and scope AuthSilosOnly' {
        Initialize-TMAS
        Register-TMASMocks
        $plan = Get-TierModelAuthSilo -Config (New-TMASConfig) -DomainController 'dc01' -Silent
        $doc = Export-TierModelPlan -Phases @(@{ Phase = 1; Area = 'authsilos'; Actions = $plan.Actions; ExistingCount = $plan.Summary.ExistingCount }) `
            -Scope AuthSilosOnly -PreferredDc 'dc01' -Warnings $plan.Warnings | ConvertFrom-Json
        $doc.metadata.scope | Should -Be 'AuthSilosOnly'
        $doc.phases[0].area | Should -Be 'authsilos'
        $doc.phases[0].name | Should -Be 'Authentication Policies and Silos'
        $doc.summary.create | Should -Be 3
        $doc.summary.update | Should -Be 1
        $doc.summary.configure | Should -Be 4
        $policy = $doc.actions | Where-Object { $_.action -eq 'CreateAuthPolicy' -and $_.name -eq 'Tier 0 Authentication Policy' }
        $policy.area | Should -Be 'authsilos'
        $policy.details.sddl | Should -Match 'Member_of_any'
        @($policy.details.deviceGroups) | Should -Be @('Tier0PAWDevices', 'Tier0MemberServers')
    }

    It 'Deploy-TierModel.ps1 and Audit-TierModel.ps1 declare -AuthSilosOnly' {
        foreach ($script in @('Deploy-TierModel.ps1', 'Audit-TierModel.ps1')) {
            $ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '..' $script), [ref]$null, [ref]$null)
            $params = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
            $params | Should -Contain 'AuthSilosOnly'
        }
    }
}
