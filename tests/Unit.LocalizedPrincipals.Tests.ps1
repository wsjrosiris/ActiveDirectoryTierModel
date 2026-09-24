#Requires -Modules Pester
<#
.SYNOPSIS
Unit tests for language-independent resolution of built-in principals (well-known SIDs / RIDs).

.DESCRIPTION
Simulates domains whose built-in groups carry localized names (German "Domänen-Admins",
French "Admins du domaine") and a child domain whose enterprise groups live in the forest root.
All AD cmdlets are mocked; the tests run without RSAT / a domain.
#>

Describe 'Localized built-in principals' -Tag 'Unit', 'Localization' {
    BeforeAll {
        . (Join-Path $PSScriptRoot 'helpers' 'ADStubs.ps1')
        # Without RSAT the ADStubs Get-ADGroupMember declares -Recursive untyped; provide a stub with a
        # real [switch] so the mock accepts the production call. Never shadows the real RSAT cmdlet.
        $script:DefinedGroupMemberStub = $false
        $existing = Get-Command Get-ADGroupMember -ErrorAction SilentlyContinue
        if (-not $existing -or -not $existing.Parameters.ContainsKey('Recursive') -or
            $existing.Parameters['Recursive'].ParameterType -ne [switch]) {
            function global:Get-ADGroupMember { param($Identity, $Server, [switch]$Recursive, $ErrorAction) }
            $script:DefinedGroupMemberStub = $true
        }

        Import-Module (Join-Path $PSScriptRoot '..' 'modules' 'TierModel' 'TierModel.psd1') -Force

        $script:ChildSid = 'S-1-5-21-1111-2222-3333'
        $script:RootSid  = 'S-1-5-21-9999-8888-7777'
    }

    AfterAll {
        if ($script:DefinedGroupMemberStub) {
            Remove-Item -Path Function:\global:Get-ADGroupMember -ErrorAction SilentlyContinue
        }
    }

    BeforeEach {
        InModuleScope TierModel {
            Clear-TierModelWellKnownPrincipalCache
            $script:SidCache = @{}
        }

        # Child domain child.contoso.com served by dc01, forest root contoso.com
        Mock Get-ADDomain -ModuleName TierModel -ParameterFilter { $Identity -eq 'contoso.com' } {
            [PSCustomObject]@{ DomainSID = [PSCustomObject]@{ Value = 'S-1-5-21-9999-8888-7777' }; DNSRoot = 'contoso.com'; NetBIOSName = 'CONTOSO' }
        }
        Mock Get-ADDomain -ModuleName TierModel -ParameterFilter { $Identity -ne 'contoso.com' } {
            [PSCustomObject]@{ DomainSID = [PSCustomObject]@{ Value = 'S-1-5-21-1111-2222-3333' }; DNSRoot = 'child.contoso.com'; NetBIOSName = 'CHILD' }
        }
        Mock Get-ADForest -ModuleName TierModel { [PSCustomObject]@{ RootDomain = 'contoso.com' } }

        # The directory only knows the German names; lookups by English name fail.
        Mock Get-ADGroup -ModuleName TierModel {
            switch ([string]$Identity) {
                'S-1-5-21-1111-2222-3333-512' { return [PSCustomObject]@{ Name = 'Domänen-Admins'; sAMAccountName = 'Domänen-Admins'; SID = [PSCustomObject]@{ Value = 'S-1-5-21-1111-2222-3333-512' } } }
                'S-1-5-21-9999-8888-7777-519' { return [PSCustomObject]@{ Name = 'Organisations-Admins'; sAMAccountName = 'Organisations-Admins'; SID = [PSCustomObject]@{ Value = 'S-1-5-21-9999-8888-7777-519' } } }
                default { throw [Microsoft.ActiveDirectory.Management.ADIdentityNotFoundException]::new("Cannot find an object with identity: '$Identity'") }
            }
        }
    }

    Context 'Well-known principal table' {
        It 'Contains the domain RIDs from the roadmap' {
            $expected = @{
                'Administrator' = 500; 'Guest' = 501; 'krbtgt' = 502; 'Domain Admins' = 512; 'Domain Users' = 513
                'Domain Guests' = 514; 'Domain Computers' = 515; 'Domain Controllers' = 516; 'Cert Publishers' = 517
                'Schema Admins' = 518; 'Enterprise Admins' = 519; 'Group Policy Creator Owners' = 520
                'Read-only Domain Controllers' = 521; 'Cloneable Domain Controllers' = 522; 'Protected Users' = 525
                'Key Admins' = 526; 'Enterprise Key Admins' = 527; 'Enterprise Read-only Domain Controllers' = 498
                'RAS and IAS Servers' = 553; 'Allowed RODC Password Replication Group' = 571
                'Denied RODC Password Replication Group' = 572
            }
            foreach ($name in $expected.Keys) {
                $entry = Get-TierModelWellKnownPrincipal -Name $name
                $entry | Should -Not -BeNullOrEmpty -Because "'$name' must be in the table"
                $entry.Kind | Should -Be 'DomainRelative'
                $entry.Rid | Should -Be $expected[$name]
            }
        }

        It 'Flags exactly the enterprise groups as forest-root relative' {
            $forestRoot = @(Get-TierModelWellKnownPrincipal | Where-Object { $_.ForestRoot } | ForEach-Object { $_.Rid } | Sort-Object)
            $forestRoot | Should -Be @(498, 518, 519, 527)
        }

        It 'Resolves BUILTIN / NT AUTHORITY aliases to absolute SIDs' {
            (Get-TierModelWellKnownPrincipal -Name 'BUILTIN\Administrators').Sid | Should -Be 'S-1-5-32-544'
            (Get-TierModelWellKnownPrincipal -Name 'Server Operators').Sid | Should -Be 'S-1-5-32-549'
            (Get-TierModelWellKnownPrincipal -Name 'Cryptographic Operators').Sid | Should -Be 'S-1-5-32-569'
            (Get-TierModelWellKnownPrincipal -Name 'nt authority\authenticated users').Sid | Should -Be 'S-1-5-11'
        }

        It 'Resolves the DOMAIN\Name form to the domain-relative entry' {
            (Get-TierModelWellKnownPrincipal -Name 'CONTOSO\Domain Admins').Rid | Should -Be 512
        }

        It 'Returns nothing for custom groups and DnsAdmins (no fixed RID)' {
            Get-TierModelWellKnownPrincipal -Name 'DnsAdmins' | Should -BeNullOrEmpty
            Get-TierModelWellKnownPrincipal -Name 'Tier0Admins' | Should -BeNullOrEmpty
        }
    }

    Context 'Resolve-TierModelPrincipalSid on a German domain' {
        It 'Resolves the English config name "Domain Admins" to the domain SID + RID 512 without a name lookup' {
            $result = Resolve-TierModelPrincipalSid -Principal 'Domain Admins' -DomainController 'dc01'
            $result.Success | Should -BeTrue
            $result.Sid | Should -Be "$script:ChildSid-512"
            $result.Source | Should -Be 'WellKnownRid'
            Should -Invoke Get-ADGroup -ModuleName TierModel -Times 0 -ParameterFilter { $Identity -eq 'Domain Admins' }
        }

        It 'Uses the forest ROOT domain SID for Enterprise Admins in a child domain' {
            $result = Resolve-TierModelPrincipalSid -Principal 'Enterprise Admins' -DomainController 'dc01'
            $result.Sid | Should -Be "$script:RootSid-519"
            $result.Source | Should -Be 'WellKnownForestRootRid'
        }

        It 'Uses the forest ROOT domain SID for Schema Admins, Enterprise Key Admins and Enterprise RODCs' {
            (Resolve-TierModelPrincipalSid -Principal 'Schema Admins' -DomainController 'dc01').Sid | Should -Be "$script:RootSid-518"
            (Resolve-TierModelPrincipalSid -Principal 'Enterprise Key Admins' -DomainController 'dc01').Sid | Should -Be "$script:RootSid-527"
            (Resolve-TierModelPrincipalSid -Principal 'Enterprise Read-only Domain Controllers' -DomainController 'dc01').Sid | Should -Be "$script:RootSid-498"
        }

        It 'Resolves BUILTIN groups without AD access' {
            $result = Resolve-TierModelPrincipalSid -Principal 'Backup Operators' -DomainController 'dc01'
            $result.Sid | Should -Be 'S-1-5-32-551'
            Should -Invoke Get-ADDomain -ModuleName TierModel -Times 0
        }

        It 'Caches the domain SID per domain controller' {
            $null = Resolve-TierModelPrincipalSid -Principal 'Domain Admins' -DomainController 'dc01'
            $null = Resolve-TierModelPrincipalSid -Principal 'Domain Users' -DomainController 'dc01'
            $null = Resolve-TierModelPrincipalSid -Principal 'Key Admins' -DomainController 'dc01'
            Should -Invoke Get-ADDomain -ModuleName TierModel -Times 1 -Exactly
        }
    }

    Context 'Get-TierModelADGroupByName' {
        It 'Finds "Domain Admins" when the group is called "Domänen-Admins"' {
            $group = InModuleScope TierModel { Get-TierModelADGroupByName -Name 'Domain Admins' -DomainController 'dc01' }
            $group.Name | Should -Be 'Domänen-Admins'
            Should -Invoke Get-ADGroup -ModuleName TierModel -Times 1 -ParameterFilter { $Identity -eq 'S-1-5-21-1111-2222-3333-512' -and $Server -eq 'dc01' }
        }

        It 'Queries forest-root groups on the forest root domain' {
            $group = InModuleScope TierModel { Get-TierModelADGroupByName -Name 'Enterprise Admins' -DomainController 'dc01' }
            $group.Name | Should -Be 'Organisations-Admins'
            Should -Invoke Get-ADGroup -ModuleName TierModel -Times 1 -ParameterFilter { $Identity -eq 'S-1-5-21-9999-8888-7777-519' -and $Server -eq 'contoso.com' }
        }

        It 'Finds a French "Admins du domaine" group by SID as well' {
            Mock Get-ADGroup -ModuleName TierModel -ParameterFilter { $Identity -eq 'S-1-5-21-1111-2222-3333-512' } {
                [PSCustomObject]@{ Name = 'Admins du domaine'; sAMAccountName = 'Admins du domaine' }
            }
            $group = InModuleScope TierModel { Get-TierModelADGroupByName -Name 'Domain Admins' -DomainController 'dc01' }
            $group.sAMAccountName | Should -Be 'Admins du domaine'
        }

        It 'Keeps the name lookup for custom groups' {
            Mock Get-ADGroup -ModuleName TierModel -ParameterFilter { $Filter -eq "Name -eq 'Tier 0 Admins'" } {
                [PSCustomObject]@{ Name = 'Tier 0 Admins'; sAMAccountName = 'Tier0Admins' }
            }
            $group = InModuleScope TierModel { Get-TierModelADGroupByName -Name 'Tier 0 Admins' -DomainController 'dc01' }
            $group.sAMAccountName | Should -Be 'Tier0Admins'
        }
    }

    Context 'ConvertTo-TierModelSid' {
        It 'Falls back to the well-known table for "DOMAIN\Domain Admins"' {
            # NTAccount translation is not possible in the test host (no domain) -> table fallback
            $sid = InModuleScope TierModel { ConvertTo-TierModelSid -Identity 'CHILD\Domain Admins' -DomainController 'dc01' }
            $sid | Should -Be 'S-1-5-21-1111-2222-3333-512'
        }

        It 'Returns SID strings unchanged' {
            InModuleScope TierModel { ConvertTo-TierModelSid -Identity 'S-1-5-32-544' } | Should -Be 'S-1-5-32-544'
        }
    }

    Context 'Resolve-ADPrincipalSid (0.3)' {
        It 'Requires -DomainController' {
            $cmd = InModuleScope TierModel { Get-Command Resolve-ADPrincipalSid }
            $cmd.Parameters['DomainController'].Attributes.Where({ $_ -is [System.Management.Automation.ParameterAttribute] }).Mandatory | Should -Contain $true
        }

        It 'Passes -Server to the AD cmdlets' {
            Mock Get-Module -ModuleName TierModel -ParameterFilter { $Name -eq 'ActiveDirectory' -and $ListAvailable } { [PSCustomObject]@{ Name = 'ActiveDirectory' } }
            Mock Import-Module -ModuleName TierModel { }
            Mock Get-ADUser -ModuleName TierModel { throw 'not a user' }
            Mock Get-ADGroup -ModuleName TierModel { [PSCustomObject]@{ SID = [PSCustomObject]@{ Value = 'S-1-5-21-1-2-3-1234' } } }

            $result = InModuleScope TierModel { Resolve-ADPrincipalSid -Principal 'Tier0Admins' -DomainController 'dc42.contoso.com' }
            $result.Sid | Should -Be 'S-1-5-21-1-2-3-1234'
            Should -Invoke Get-ADUser -ModuleName TierModel -Times 1 -ParameterFilter { $Server -eq 'dc42.contoso.com' }
            Should -Invoke Get-ADGroup -ModuleName TierModel -Times 1 -ParameterFilter { $Server -eq 'dc42.contoso.com' }
        }
    }

    Context 'Test-TierModelDomainAdminMembership (prerequisites Domain Admins check)' {
        BeforeEach {
            Mock Get-ADGroupMember -ModuleName TierModel {
                @([PSCustomObject]@{ Name = 'admin1'; SID = [PSCustomObject]@{ Value = 'S-1-5-21-1111-2222-3333-1105' } })
            }
        }

        It 'Finds the localized Domain Admins group by SID and detects membership' {
            $check = InModuleScope TierModel { Test-TierModelDomainAdminMembership -DomainController 'dc01' -UserSid 'S-1-5-21-1111-2222-3333-1105' }
            $check.GroupFound | Should -BeTrue
            $check.IsMember | Should -BeTrue
            $check.GroupSid | Should -Be 'S-1-5-21-1111-2222-3333-512'
            $check.GroupName | Should -Be 'Domänen-Admins'
            Should -Invoke Get-ADGroup -ModuleName TierModel -Times 0 -ParameterFilter { $Identity -eq 'Domain Admins' }
        }

        It 'Reports non-members' {
            $check = InModuleScope TierModel { Test-TierModelDomainAdminMembership -DomainController 'dc01' -UserSid 'S-1-5-21-1111-2222-3333-4242' }
            $check.GroupFound | Should -BeTrue
            $check.IsMember | Should -BeFalse
        }

        It 'Reports a missing group' {
            Mock Get-ADGroup -ModuleName TierModel { throw 'not found' }
            $check = InModuleScope TierModel { Test-TierModelDomainAdminMembership -DomainController 'dc01' -UserSid 'S-1-5-21-1111-2222-3333-1105' }
            $check.GroupFound | Should -BeFalse
            $check.IsMember | Should -BeFalse
        }
    }

    Context 'New-TierModelGptTmplContent in a localized child domain' {
        It 'Writes the domain SID for resolvableGroups and the forest-root SID for forestRootOnly groups' {
            $gpoData = [PSCustomObject]@{
                userRightsAssignments = @(
                    [PSCustomObject]@{
                        right = 'SeDenyInteractiveLogonRight'
                        principals = [PSCustomObject]@{
                            resolvableGroups = @('Domain Admins', 'Guests')
                            forestRootOnly   = @('Enterprise Admins', 'Schema Admins')
                            literalStrings   = @()
                        }
                    }
                )
            }
            $content = New-TierModelGptTmplContent -GPOData $gpoData -DomainController 'dc01'
            $content | Should -Match ([regex]::Escape("SeDenyInteractiveLogonRight = *$script:ChildSid-512,*S-1-5-32-546,*$script:RootSid-519,*$script:RootSid-518"))
        }
    }
}
