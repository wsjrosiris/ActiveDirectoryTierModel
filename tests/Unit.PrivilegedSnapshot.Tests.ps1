#Requires -Modules Pester
<#
.SYNOPSIS
Unit tests for the privileged access snapshot (Get-TierModelPrivilegedSnapshot / Export-TierModelPrivilegedSnapshot
and Watch-TierModelPrivilegedGroups.ps1).

.DESCRIPTION
A small in-memory directory (German built-in group names, found via SID) backs mocked AD cmdlets. Covers
recursive membership with nesting and a cycle, SID deduplication, foreign security principals, primary group
members, child domains with forest-wide groups in the root, account flag parsing, adminCount orphans, ACL
mapping and exclusions, and the JSON shape of the written file. Runs without RSAT / a domain.
#>

BeforeAll {
    . (Join-Path $PSScriptRoot 'helpers' 'ADStubs.ps1')
    $script:DefinedDcStub = $false
    if (-not (Get-Command Get-ADDomainController -ErrorAction SilentlyContinue)) {
        function global:Get-ADDomainController { param([switch]$Discover, $DomainName, $Server, $Identity, $ErrorAction) }
        $script:DefinedDcStub = $true
    }

    Import-Module (Join-Path $PSScriptRoot '..' 'modules' 'TierModel' 'TierModel.psd1') -Force

    $script:GuidMember = 'bf9679c0-0de6-11d0-a285-00aa003049e2'
    $script:GuidReset = '00299570-246d-11d0-a768-00aa006e0529'
    $script:GuidKeyCred = '5b47d60f-6090-40b2-9f37-2a4de88f3063'

    function global:New-TMFakeSecurityDescriptor {
        param([string]$Owner, [object[]]$Rules = @())
        $ruleObjects = @(foreach ($r in $Rules) {
                [PSCustomObject]@{
                    IdentityReference     = [PSCustomObject]@{ Value = $r.Sid }
                    ActiveDirectoryRights = [System.DirectoryServices.ActiveDirectoryRights]$r.Rights
                    AccessControlType     = if ($r.ContainsKey('Type')) { $r.Type } else { 'Allow' }
                    ObjectType            = if ($r.ContainsKey('Guid')) { [guid]$r.Guid } else { [guid]::Empty }
                    IsInherited           = if ($r.ContainsKey('Inherited')) { [bool]$r.Inherited } else { $false }
                }
            })
        $sd = [PSCustomObject]@{ OwnerSid = $Owner; RuleList = $ruleObjects }
        $sd | Add-Member -MemberType ScriptMethod -Name GetOwner -Value { param($t) [PSCustomObject]@{ Value = $this.OwnerSid } }
        $sd | Add-Member -MemberType ScriptMethod -Name GetAccessRules -Value { param($a, $b, $t) $this.RuleList }
        return $sd
    }

    function global:New-TMObject {
        param([string]$Dn, [string]$Class, [string]$Sid, [string]$Sam, [hashtable]$Extra = @{})
        $name = ($Dn -split ',')[0] -replace '^(CN|OU|DC)=', ''
        $h = [ordered]@{
            DistinguishedName = $Dn; ObjectClass = $Class; objectSid = $Sid; sAMAccountName = $Sam; Name = $name
        }
        foreach ($k in $Extra.Keys) { $h[$k] = $Extra[$k] }
        return [PSCustomObject]$h
    }

    # In-memory directory used by the mocks: objects keyed by lower-case DN.
    function global:Initialize-TMDirectory {
        param([object[]]$Objects)
        $global:TMDir = @{ Objects = @{}; BySid = @{}; Calls = New-Object System.Collections.Generic.List[string] }
        foreach ($o in $Objects) {
            $global:TMDir.Objects[$o.DistinguishedName.ToLowerInvariant()] = $o
            if ($o.objectSid) { $global:TMDir.BySid[[string]$o.objectSid] = $o }
        }
    }

    function global:Get-TMProp { param($o, $n) if ($o.PSObject.Properties[$n]) { $o.$n } else { $null } }

    $script:MockGetADObject = {
        $global:TMDir.Calls.Add("Get-ADObject|$Server|$Identity|$LDAPFilter|$SearchBase")
        $all = @($global:TMDir.Objects.Values)
        if ($Identity) {
            $o = $global:TMDir.Objects[([string]$Identity).ToLowerInvariant()]
            if (-not $o) { throw [Microsoft.ActiveDirectory.Management.ADIdentityNotFoundException]::new("Cannot find an object with identity: '$Identity'") }
            return $o
        }
        if ($SearchBase -and -not $global:TMDir.Objects.ContainsKey(([string]$SearchBase).ToLowerInvariant())) {
            throw [Microsoft.ActiveDirectory.Management.ADIdentityNotFoundException]::new("Directory object not found: '$SearchBase'")
        }
        $inBase = { param($o) (-not $SearchBase) -or $o.DistinguishedName -ieq $SearchBase -or $o.DistinguishedName.EndsWith(",$SearchBase", [StringComparison]::OrdinalIgnoreCase) }
        if ($LDAPFilter -match 'primaryGroupID=(\d+)') {
            $rid = [int]$Matches[1]
            return @($all | Where-Object { (Get-TMProp $_ 'primaryGroupID') -eq $rid -and (& $inBase $_) })
        }
        if ($LDAPFilter -match 'adminCount=1') {
            return @($all | Where-Object { (Get-TMProp $_ 'adminCount') -eq 1 -and $_.ObjectClass -in @('user', 'group', 'computer') -and (& $inBase $_) })
        }
        if ($LDAPFilter -match 'objectSid=(S-[0-9-]+)') {
            $o = $global:TMDir.BySid[$Matches[1]]
            if ($o) { return $o }
            return $null
        }
        if ($LDAPFilter -eq '(objectClass=user)') {
            return @($all | Where-Object { $_.ObjectClass -in @('user', 'computer', 'msDS-GroupManagedServiceAccount', 'msDS-ManagedServiceAccount') -and (& $inBase $_) })
        }
        throw "Unexpected Get-ADObject call: $LDAPFilter"
    }

    $script:MockGetADGroup = {
        $global:TMDir.Calls.Add("Get-ADGroup|$Server|$Identity|$Filter")
        if ($Identity) {
            $o = $global:TMDir.BySid[[string]$Identity]
            if (-not $o -or $o.ObjectClass -ne 'group') { throw [Microsoft.ActiveDirectory.Management.ADIdentityNotFoundException]::new("Cannot find an object with identity: '$Identity'") }
            return $o
        }
        if ($Filter -match "sAMAccountName -eq '([^']+)'") {
            $sam = $Matches[1]
            return @($global:TMDir.Objects.Values | Where-Object { $_.ObjectClass -eq 'group' -and $_.sAMAccountName -ieq $sam })
        }
        return @()
    }

    # --- Root domain contoso.com with German built-in names -------------------------------------------
    $script:Sid = 'S-1-5-21-100-200-300'
    $script:DomainDn = 'DC=contoso,DC=com'
    $d = $script:DomainDn
    $s = $script:Sid
    $script:LastLogonUtc = [datetime]::new(2026, 9, 20, 8, 0, 0, [DateTimeKind]::Utc)
    $script:PwdSetUtc = [datetime]::new(2025, 1, 2, 3, 4, 5, [DateTimeKind]::Utc)

    $script:RootObjects = {
        $d = $script:DomainDn; $s = $script:Sid
        $defaultSd = New-TMFakeSecurityDescriptor -Owner "$s-512"
        $gpoDn = "CN={31B2F340-016D-11D2-945F-00C04FB984F9},CN=Policies,CN=System,$d"
        @(
            New-TMObject -Dn $d -Class 'domainDNS' -Sid $s -Extra @{
                nTSecurityDescriptor = New-TMFakeSecurityDescriptor -Owner 'S-1-5-32-544' -Rules @(
                    @{ Sid = "$s-1400"; Rights = 'WriteProperty'; Guid = $script:GuidMember }                 # Helpdesk: WriteMember
                    @{ Sid = "$s-1401"; Rights = 'ExtendedRight'; Guid = $script:GuidReset; Inherited = $true } # ServiceDesk user: ResetPassword
                    @{ Sid = "$s-512"; Rights = 'GenericAll' }                                                 # Domain Admins: excluded
                    @{ Sid = "$s-526"; Rights = 'ReadProperty, WriteProperty'; Guid = $script:GuidKeyCred }   # Key Admins on KeyCredentialLink: excluded
                    @{ Sid = 'S-1-5-10'; Rights = 'WriteProperty' }                                           # SELF: excluded
                    @{ Sid = "$s-1400"; Rights = 'GenericAll'; Type = 'Deny' }                                # deny: ignored
                    @{ Sid = 'S-1-5-11'; Rights = 'ReadProperty, GenericExecute' }                            # read-only: ignored
                    @{ Sid = 'S-1-5-11'; Rights = 'ExtendedRight'; Guid = '1131f6aa-9c07-11d1-f79f-00c04fc2dcd2' } # other extended right: ignored
                )
                gPLink = ''
            }
            New-TMObject -Dn "CN=AdminSDHolder,CN=System,$d" -Class 'container' -Sid $null -Extra @{
                nTSecurityDescriptor = New-TMFakeSecurityDescriptor -Owner "$s-1401" -Rules @(
                    @{ Sid = "$s-1400"; Rights = 'ExtendedRight' }       # AllExtendedRights
                    @{ Sid = "$s-1300"; Rights = 'GenericAll' }          # Tier0Admins (config Tier 0): excluded
                    @{ Sid = "$s-526"; Rights = 'WriteProperty' }         # Key Admins, all properties: reported
                )
            }
            New-TMObject -Dn "OU=Domain Controllers,$d" -Class 'organizationalUnit' -Sid $null -Extra @{
                nTSecurityDescriptor = $defaultSd
                gPLink = "[LDAP://cn={31B2F340-016D-11D2-945F-00C04FB984F9},cn=policies,cn=system,$d;0]"
            }
            New-TMObject -Dn $gpoDn -Class 'groupPolicyContainer' -Sid $null -Extra @{
                displayName = 'Default Domain Controllers Policy'
                nTSecurityDescriptor = New-TMFakeSecurityDescriptor -Owner "$s-512" -Rules @(
                    @{ Sid = "$s-1400"; Rights = 'GenericWrite' }
                )
            }
            New-TMObject -Dn "OU=Tier 0,OU=Tier Model Administration,$d" -Class 'organizationalUnit' -Sid $null -Extra @{ nTSecurityDescriptor = $defaultSd }
            New-TMObject -Dn "OU=Tier 0 Accounts,OU=Tier 0,OU=Tier Model Administration,$d" -Class 'organizationalUnit' -Sid $null -Extra @{ nTSecurityDescriptor = $defaultSd }
            New-TMObject -Dn "OU=Tier 1 Accounts,OU=Tier 1,OU=Tier Model Administration,$d" -Class 'organizationalUnit' -Sid $null -Extra @{ nTSecurityDescriptor = $defaultSd }

            # Built-in groups (localized names)
            New-TMObject -Dn "CN=Domänen-Admins,CN=Users,$d" -Class 'group' -Sid "$s-512" -Sam 'Domänen-Admins' -Extra @{
                member = @("CN=Alice,CN=Users,$d", "CN=G-Nested,CN=Users,$d"); adminCount = 1; nTSecurityDescriptor = $defaultSd
            }
            New-TMObject -Dn "CN=Organisations-Admins,CN=Users,$d" -Class 'group' -Sid "$s-519" -Sam 'Organisations-Admins' -Extra @{ member = @("CN=Carol,CN=Users,$d"); nTSecurityDescriptor = $defaultSd }
            New-TMObject -Dn "CN=Schema-Admins,CN=Users,$d" -Class 'group' -Sid "$s-518" -Sam 'Schema-Admins' -Extra @{ nTSecurityDescriptor = $defaultSd }
            New-TMObject -Dn "CN=Administratoren,CN=Builtin,$d" -Class 'group' -Sid 'S-1-5-32-544' -Sam 'Administratoren' -Extra @{
                member = @("CN=Domänen-Admins,CN=Users,$d", "CN=S-1-5-21-999-888-777-1105,CN=ForeignSecurityPrincipals,$d", "CN=S-1-5-11,CN=ForeignSecurityPrincipals,$d")
                nTSecurityDescriptor = $defaultSd
            }
            New-TMObject -Dn "CN=Domänencontroller,CN=Users,$d" -Class 'group' -Sid "$s-516" -Sam 'Domänencontroller' -Extra @{ nTSecurityDescriptor = $defaultSd }
            New-TMObject -Dn "CN=Protected Users,CN=Users,$d" -Class 'group' -Sid "$s-525" -Sam 'Protected Users' -Extra @{ member = @("CN=Alice,CN=Users,$d") }
            New-TMObject -Dn "CN=Schlüsseladministratoren,CN=Users,$d" -Class 'group' -Sid "$s-526" -Sam 'Schlüsseladministratoren' -Extra @{ nTSecurityDescriptor = $defaultSd }

            # Nested groups with a cycle (G-Nested -> G-Cycle -> G-Nested)
            New-TMObject -Dn "CN=G-Nested,CN=Users,$d" -Class 'group' -Sid "$s-1200" -Sam 'G-Nested' -Extra @{ member = @("CN=Bob,CN=Users,$d", "CN=G-Cycle,CN=Users,$d") }
            New-TMObject -Dn "CN=G-Cycle,CN=Users,$d" -Class 'group' -Sid "$s-1201" -Sam 'G-Cycle' -Extra @{ member = @("CN=G-Nested,CN=Users,$d", "CN=Alice,CN=Users,$d", "CN=Domänen-Admins,CN=Users,$d") }

            # Config Tier 0 group and ACL principals
            New-TMObject -Dn "CN=Tier 0 Admins,OU=Tier 0 Groups,OU=Tier 0,OU=Tier Model Administration,$d" -Class 'group' -Sid "$s-1300" -Sam 'Tier0Admins' -Extra @{ member = @("CN=Dave,OU=Tier 0 Accounts,OU=Tier 0,OU=Tier Model Administration,$d") }
            New-TMObject -Dn "CN=Helpdesk,CN=Users,$d" -Class 'group' -Sid "$s-1400" -Sam 'Helpdesk' -Extra @{ member = @("CN=Bob,CN=Users,$d", "CN=Erin,OU=Tier 1 Accounts,OU=Tier 1,OU=Tier Model Administration,$d") }

            # Accounts
            New-TMObject -Dn "CN=Alice,CN=Users,$d" -Class 'user' -Sid "$s-1100" -Sam 't0-alice' -Extra @{
                userAccountControl = 0x10200 -bor 0x100000; lastLogonTimestamp = $script:LastLogonUtc.ToFileTimeUtc(); pwdLastSet = [string]$script:PwdSetUtc.ToFileTimeUtc()
                adminCount = 1; servicePrincipalName = @('MSSQLSvc/sql01.contoso.com:1433')
            }
            New-TMObject -Dn "CN=Bob,CN=Users,$d" -Class 'user' -Sid "$s-1101" -Sam 'bob' -Extra @{ userAccountControl = 0x202; pwdLastSet = 0 }
            New-TMObject -Dn "CN=Carol,CN=Users,$d" -Class 'user' -Sid "$s-1102" -Sam 'carol' -Extra @{ userAccountControl = 0x200; pwdLastSet = $script:PwdSetUtc.ToLocalTime() }
            New-TMObject -Dn "CN=Dave,OU=Tier 0 Accounts,OU=Tier 0,OU=Tier Model Administration,$d" -Class 'user' -Sid "$s-1103" -Sam 't0-dave' -Extra @{ userAccountControl = 0x200 }
            New-TMObject -Dn "CN=Erin,OU=Tier 1 Accounts,OU=Tier 1,OU=Tier Model Administration,$d" -Class 'user' -Sid "$s-1104" -Sam 't1-erin' -Extra @{ userAccountControl = 0x200 }
            New-TMObject -Dn "CN=ServiceDesk,CN=Users,$d" -Class 'user' -Sid "$s-1401" -Sam 'servicedesk' -Extra @{ userAccountControl = 0x200 }
            New-TMObject -Dn "CN=Frank,CN=Users,$d" -Class 'user' -Sid "$s-1105" -Sam 'frank' -Extra @{ userAccountControl = 0x200; adminCount = 1 }
            New-TMObject -Dn "CN=krbtgt,CN=Users,$d" -Class 'user' -Sid "$s-502" -Sam 'krbtgt' -Extra @{ userAccountControl = 0x202; adminCount = 1 }
            New-TMObject -Dn "CN=DC01,OU=Domain Controllers,$d" -Class 'computer' -Sid "$s-1000" -Sam 'DC01$' -Extra @{ userAccountControl = 0x82000; primaryGroupID = 516 }
            New-TMObject -Dn "CN=S-1-5-21-999-888-777-1105,CN=ForeignSecurityPrincipals,$d" -Class 'foreignSecurityPrincipal' -Sid 'S-1-5-21-999-888-777-1105' -Sam $null
            New-TMObject -Dn "CN=S-1-5-11,CN=ForeignSecurityPrincipals,$d" -Class 'foreignSecurityPrincipal' -Sid 'S-1-5-11' -Sam $null
        )
    }

    $script:TestConfig = [PSCustomObject]@{
        groups            = @(
            [PSCustomObject]@{ name = 'Tier 0 Admins'; samaccountname = 'Tier0Admins'; path = 'OU=Tier 0 Groups,OU=Tier 0,OU=Tier Model Administration,{{DOMAIN_DN}}' }
            [PSCustomObject]@{ name = 'Tier 1 Admins'; samaccountname = 'Tier1Admins'; path = 'OU=Tier 1 Groups,OU=Tier 1,OU=Tier Model Administration,{{DOMAIN_DN}}' }
            [PSCustomObject]@{ name = 'PAW Domain Join'; samaccountname = 'PAWDomainJoin'; path = 'OU=Tier 0 Groups,OU=Tier 0,OU=Tier Model Administration,{{DOMAIN_DN}}' }
        )
        organizationUnits = @(
            [PSCustomObject]@{ name = 'Tier Model Administration'; path = '{{DOMAIN_DN}}' }
            [PSCustomObject]@{ name = 'Tier 0'; path = 'OU=Tier Model Administration' }
            [PSCustomObject]@{ name = 'Tier 0 Accounts'; path = 'OU=Tier 0,OU=Tier Model Administration' }
            [PSCustomObject]@{ name = 'Tier 0 PAW Devices'; path = 'OU=Tier 0,OU=Tier Model Administration' }
            [PSCustomObject]@{ name = 'Tier 1 Accounts'; path = 'OU=Tier 1,OU=Tier Model Administration' }
            [PSCustomObject]@{ name = 'Tier 2 Accounts'; path = 'OU=Tier 2,OU=Tier Model Administration' }
        )
    }
}

AfterAll {
    if ($script:DefinedDcStub) { Remove-Item -Path Function:\global:Get-ADDomainController -ErrorAction SilentlyContinue }
    foreach ($f in 'New-TMFakeSecurityDescriptor', 'New-TMObject', 'Initialize-TMDirectory', 'Get-TMProp') {
        Remove-Item -Path "Function:\global:$f" -ErrorAction SilentlyContinue
    }
    Remove-Variable -Name TMDir -Scope Global -ErrorAction SilentlyContinue
}

Describe 'Privileged snapshot helpers' -Tag 'Unit', 'Privileged' {
    It 'Maps rights and object type GUIDs (<Rights> / <Guid>) to <Expected>' -TestCases @(
        @{ Rights = 'GenericAll'; Guid = ''; Expected = @('GenericAll') }
        @{ Rights = 'GenericWrite'; Guid = ''; Expected = @('GenericWrite') }
        @{ Rights = 'WriteDacl, WriteOwner'; Guid = ''; Expected = @('WriteDacl', 'WriteOwner') }
        @{ Rights = 'WriteProperty'; Guid = 'bf9679c0-0de6-11d0-a285-00aa003049e2'; Expected = @('WriteMember') }
        @{ Rights = 'Self'; Guid = 'bf9679c0-0de6-11d0-a285-00aa003049e2'; Expected = @('WriteMember') }
        @{ Rights = 'ExtendedRight'; Guid = '00299570-246d-11d0-a768-00aa006e0529'; Expected = @('ResetPassword') }
        @{ Rights = 'ExtendedRight'; Guid = ''; Expected = @('AllExtendedRights') }
        @{ Rights = 'ExtendedRight'; Guid = '00000000-0000-0000-0000-000000000000'; Expected = @('AllExtendedRights') }
        @{ Rights = 'WriteProperty'; Guid = ''; Expected = @('WriteProperty') }
        @{ Rights = 'WriteProperty'; Guid = '5b47d60f-6090-40b2-9f37-2a4de88f3063'; Expected = @('WriteProperty') }
        @{ Rights = 'WriteProperty'; Guid = 'bf967a7f-0de6-11d0-a285-00aa003049e2'; Expected = @() }
        @{ Rights = 'ExtendedRight'; Guid = '1131f6aa-9c07-11d1-f79f-00c04fc2dcd2'; Expected = @() }
        @{ Rights = 'ReadProperty, GenericExecute, ListChildren'; Guid = ''; Expected = @() }
    ) {
        $result = InModuleScope TierModel -Parameters @{ R = $Rights; G = $Guid } { param($R, $G) @(Get-TierModelAceRight -Rights $R -ObjectType $G) }
        @($result).Count | Should -Be @($Expected).Count
        foreach ($e in $Expected) { $result | Should -Contain $e }
    }

    It 'Converts FILETIME, DateTime and "never" values to ISO-8601 UTC' {
        InModuleScope TierModel {
            $utc = [datetime]::new(2026, 9, 24, 10, 0, 0, [DateTimeKind]::Utc)
            ConvertTo-TierModelIsoTimestamp $utc.ToFileTimeUtc() | Should -Be '2026-09-24T10:00:00Z'
            ConvertTo-TierModelIsoTimestamp ([string]$utc.ToFileTimeUtc()) | Should -Be '2026-09-24T10:00:00Z'
            ConvertTo-TierModelIsoTimestamp $utc.ToLocalTime() | Should -Be '2026-09-24T10:00:00Z'
            ConvertTo-TierModelIsoTimestamp 0 | Should -BeNullOrEmpty
            ConvertTo-TierModelIsoTimestamp ([long]::MaxValue) | Should -BeNullOrEmpty
            ConvertTo-TierModelIsoTimestamp $null | Should -BeNullOrEmpty
        }
    }

    It 'Detects tiers like the service (tier\s*([012]) without a following digit)' {
        InModuleScope TierModel {
            Get-TierModelTierFromText 'Tier 0 Admins' | Should -Be 0
            Get-TierModelTierFromText 'Tier1Admins' | Should -Be 1
            Get-TierModelTierFromText 'OU=Tier 0 Groups,DC=x' | Should -Be 0
            Get-TierModelTierFromText 'Tier 10' | Should -BeNullOrEmpty
            Get-TierModelTierFromText 'PAW Domain Join' | Should -BeNullOrEmpty
        }
    }

    It 'Parses gPLink values' {
        InModuleScope TierModel {
            $links = @(Get-TierModelGpLinkDn '[LDAP://cn={A},cn=policies,cn=system,DC=x;0][LDAP://cn={B},cn=policies,cn=system,DC=x;1]')
            $links | Should -Be @('cn={A},cn=policies,cn=system,DC=x', 'cn={B},cn=policies,cn=system,DC=x')
            @(Get-TierModelGpLinkDn '').Count | Should -Be 0
        }
    }
}

Describe 'Get-TierModelPrivilegedSnapshot (root domain, localized names)' -Tag 'Unit', 'Privileged' {
    BeforeAll {
        InModuleScope TierModel { Clear-TierModelWellKnownPrincipalCache }
        Initialize-TMDirectory -Objects (& $script:RootObjects)
        Mock Get-ADDomain -ModuleName TierModel {
            [PSCustomObject]@{ DomainSID = [PSCustomObject]@{ Value = 'S-1-5-21-100-200-300' }; DNSRoot = 'contoso.com'; NetBIOSName = 'CONTOSO'; DistinguishedName = 'DC=contoso,DC=com'; DomainControllersContainer = 'OU=Domain Controllers,DC=contoso,DC=com' }
        }
        Mock Get-ADForest -ModuleName TierModel { [PSCustomObject]@{ RootDomain = 'contoso.com' } }
        Mock Get-ADDomainController -ModuleName TierModel { throw 'must not be called in the root domain' }
        Mock Get-ADObject -ModuleName TierModel $script:MockGetADObject
        Mock Get-ADGroup -ModuleName TierModel $script:MockGetADGroup

        $script:Snap = Get-TierModelPrivilegedSnapshot -DomainController 'dc01.contoso.com' -Config $script:TestConfig
        $script:Groups = @{}
        foreach ($g in $script:Snap.groups) { $script:Groups[$(if ($g.wellKnownName) { $g.wellKnownName } else { $g.name })] = $g }
    }

    It 'Writes the metadata' {
        $m = $script:Snap.metadata
        $m.version | Should -Be '1'
        $m.preferredDc | Should -Be 'dc01.contoso.com'
        $m.domain | Should -Be 'contoso.com'
        $m.domainSid | Should -Be 'S-1-5-21-100-200-300'
        $m.forestRootDomain | Should -Be 'contoso.com'
        $m.isForestRoot | Should -BeTrue
        $m.timestamp | Should -Match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$'
    }

    It 'Finds built-in groups by SID although they carry German names' {
        $da = $script:Groups['Domain Admins']
        $da | Should -Not -BeNullOrEmpty
        $da.name | Should -Be 'Domänen-Admins'
        $da.sid | Should -Be 'S-1-5-21-100-200-300-512'
        $da.source | Should -Be 'builtin'
        $da.tier | Should -Be 0
        $script:Groups['Administrators'].name | Should -Be 'Administratoren'
        $script:Groups['Enterprise Admins'].name | Should -Be 'Organisations-Admins'
    }

    It 'Expands nested groups recursively, survives the cycle and deduplicates by SID' {
        $members = @($script:Groups['Domain Admins'].members)
        @($members | Where-Object sid -eq 'S-1-5-21-100-200-300-1100').Count | Should -Be 1
        $alice = $members | Where-Object samAccountName -eq 't0-alice'
        $alice.direct | Should -BeTrue
        @($alice.via).Count | Should -Be 0
        $bob = $members | Where-Object samAccountName -eq 'bob'
        $bob.direct | Should -BeFalse
        $bob.via | Should -Be @('G-Nested')
        $bob.enabled | Should -BeFalse
        $cycle = $members | Where-Object samAccountName -eq 'G-Cycle'
        $cycle.objectClass | Should -Be 'group'
        $cycle.enabled | Should -BeNullOrEmpty
        $cycle.via | Should -Be @('G-Nested')
        # The group itself (reachable through the cycle) is not its own member
        @($members | Where-Object sid -eq 'S-1-5-21-100-200-300-512').Count | Should -Be 0
        $members.Count | Should -Be 4
    }

    It 'Reports nesting paths outermost first' {
        $members = @($script:Groups['Administrators'].members)
        ($members | Where-Object samAccountName -eq 'bob').via | Should -Be @('Domänen-Admins', 'G-Nested')
    }

    It 'Reports foreign security principals and translates well-known SIDs' {
        $members = @($script:Groups['Administrators'].members)
        $fsp = $members | Where-Object sid -eq 'S-1-5-21-999-888-777-1105'
        $fsp.objectClass | Should -Be 'foreignSecurityPrincipal'
        $fsp.enabled | Should -BeNullOrEmpty
        $au = $members | Where-Object sid -eq 'S-1-5-11'
        $au.objectClass | Should -Be 'foreignSecurityPrincipal'
        $au.name | Should -Be 'NT AUTHORITY\Authenticated Users'
    }

    It 'Includes primary group members (domain controllers)' {
        $dcs = @($script:Groups['Domain Controllers'].members)
        $dcs.samAccountName | Should -Contain 'DC01$'
        ($dcs | Where-Object samAccountName -eq 'DC01$').objectClass | Should -Be 'computer'
    }

    It 'Adds Tier 0 groups from the configuration (name, sam or path) and skips Tier 1 groups' {
        $t0 = $script:Groups['Tier 0 Admins']
        $t0.source | Should -Be 'config'
        $t0.wellKnownName | Should -BeNullOrEmpty
        @($t0.members).samAccountName | Should -Contain 't0-dave'
        $script:Groups.ContainsKey('Tier 1 Admins') | Should -BeFalse
        # PAW Domain Join is Tier 0 by its path but does not exist -> error entry
        $script:Snap.errors | Where-Object { $_ -like "*PAW Domain Join*not found*" } | Should -Not -BeNullOrEmpty
    }

    It 'Parses account flags and timestamps' {
        $alice = $script:Snap.accounts | Where-Object samAccountName -eq 't0-alice'
        $alice.tier | Should -Be 0
        $alice.enabled | Should -BeTrue
        $alice.passwordNeverExpires | Should -BeTrue
        $alice.accountNotDelegated | Should -BeTrue
        $alice.protectedUsers | Should -BeTrue
        $alice.adminCount | Should -Be 1
        $alice.lastLogon | Should -Be '2026-09-20T08:00:00Z'
        $alice.passwordLastSet | Should -Be '2025-01-02T03:04:05Z'
        $alice.servicePrincipalNames | Should -Be @('MSSQLSvc/sql01.contoso.com:1433')
        $alice.memberOfPrivileged | Should -Contain 'Domain Admins'
        $alice.memberOfPrivileged | Should -Contain 'Administrators'

        $bob = $script:Snap.accounts | Where-Object samAccountName -eq 'bob'
        $bob.enabled | Should -BeFalse
        $bob.lastLogon | Should -BeNullOrEmpty
        $bob.passwordLastSet | Should -BeNullOrEmpty
        $bob.passwordNeverExpires | Should -BeFalse
        $bob.accountNotDelegated | Should -BeFalse
        $bob.protectedUsers | Should -BeFalse
        $bob.adminCount | Should -BeNullOrEmpty

        ($script:Snap.accounts | Where-Object samAccountName -eq 'carol').passwordLastSet | Should -Be '2025-01-02T03:04:05Z'
    }

    It 'Includes accounts from Tier 0 / Tier 1 account OUs with the OU tier' {
        $dave = $script:Snap.accounts | Where-Object samAccountName -eq 't0-dave'
        $dave.tier | Should -Be 0
        $dave.memberOfPrivileged | Should -Be @('Tier 0 Admins')
        $erin = $script:Snap.accounts | Where-Object samAccountName -eq 't1-erin'
        $erin.tier | Should -Be 1
        @($erin.memberOfPrivileged).Count | Should -Be 0
        # Group objects and FSPs are not accounts
        @($script:Snap.accounts | Where-Object objectClass -in @('group', 'foreignSecurityPrincipal')).Count | Should -Be 0
    }

    It 'Lists adminCount orphans but not members, krbtgt or protected groups' {
        $orphans = @($script:Snap.adminCountOrphans)
        $orphans.samAccountName | Should -Contain 'frank'
        $orphans.samAccountName | Should -Not -Contain 't0-alice'
        $orphans.samAccountName | Should -Not -Contain 'krbtgt'
        $orphans.samAccountName | Should -Not -Contain 'Domänen-Admins'
        $orphans.Count | Should -Be 1
        $orphans[0].objectClass | Should -Be 'user'
    }

    It 'Maps WriteMember on the domain root to the Helpdesk group with its members' {
        $f = $script:Snap.aclFindings | Where-Object { $_.objectType -eq 'DomainRoot' -and $_.principalSid -eq 'S-1-5-21-100-200-300-1400' }
        @($f).Count | Should -Be 1
        $f.rights | Should -Be @('WriteMember')
        $f.objectTypeGuid | Should -Be 'bf9679c0-0de6-11d0-a285-00aa003049e2'
        $f.principalName | Should -Be 'CONTOSO\Helpdesk'
        $f.principalClass | Should -Be 'group'
        $f.memberCount | Should -Be 2
        $f.sampleMembers | Should -Contain 'bob'
        $f.inherited | Should -BeFalse
        $f.objectName | Should -Be 'contoso.com'
    }

    It 'Maps ResetPassword and keeps the inherited flag' {
        $f = $script:Snap.aclFindings | Where-Object { $_.objectType -eq 'DomainRoot' -and $_.principalSid -eq 'S-1-5-21-100-200-300-1401' }
        $f.rights | Should -Be @('ResetPassword')
        $f.inherited | Should -BeTrue
        $f.principalClass | Should -Be 'user'
        $f.memberCount | Should -BeNullOrEmpty
        @($f.sampleMembers).Count | Should -Be 0
    }

    It 'Applies the exclusions (DA, SELF, Key Admins on KeyCredentialLink, config Tier 0, deny, read-only)' {
        $root = @($script:Snap.aclFindings | Where-Object objectType -eq 'DomainRoot')
        $root.principalSid | Should -Not -Contain 'S-1-5-21-100-200-300-512'
        $root.principalSid | Should -Not -Contain 'S-1-5-10'
        $root.principalSid | Should -Not -Contain 'S-1-5-21-100-200-300-526'
        $root.principalSid | Should -Not -Contain 'S-1-5-11'
        $root.principalSid | Should -Not -Contain 'S-1-5-32-544'   # owner Administrators
        $root.Count | Should -Be 2
        $holder = @($script:Snap.aclFindings | Where-Object objectType -eq 'AdminSDHolder')
        $holder.principalSid | Should -Not -Contain 'S-1-5-21-100-200-300-1300'
    }

    It 'Reports AllExtendedRights, Key Admins outside KeyCredentialLink and a foreign owner on AdminSDHolder' {
        $holder = @($script:Snap.aclFindings | Where-Object objectType -eq 'AdminSDHolder')
        ($holder | Where-Object principalSid -eq 'S-1-5-21-100-200-300-1400').rights | Should -Be @('AllExtendedRights')
        ($holder | Where-Object principalSid -eq 'S-1-5-21-100-200-300-526').rights | Should -Be @('WriteProperty')
        $owner = $holder | Where-Object { $_.rights -contains 'Owner' }
        $owner.principalSid | Should -Be 'S-1-5-21-100-200-300-1401'
        $owner.objectTypeGuid | Should -BeNullOrEmpty
        $owner.objectDn | Should -Be 'CN=AdminSDHolder,CN=System,DC=contoso,DC=com'
    }

    It 'Follows gPLink of the Domain Controllers OU to the GPO' {
        $gpo = $script:Snap.aclFindings | Where-Object objectType -eq 'Tier0GPO'
        $gpo.objectName | Should -Be 'Default Domain Controllers Policy'
        $gpo.rights | Should -Be @('GenericWrite')
    }

    It 'Records a missing Tier 0 OU as an error and continues' {
        $script:Snap.errors | Where-Object { $_ -like '*Tier0OU*OU=Tier 0 PAW Devices*' } | Should -Not -BeNullOrEmpty
        @($script:Snap.groups).Count | Should -BeGreaterThan 3
    }

    It 'Queries every AD object through the preferred DC' {
        @($global:TMDir.Calls | Where-Object { $_ -notmatch '^Get-AD(Object|Group)\|dc01\.contoso\.com\|' }).Count | Should -Be 0
    }
}

Describe 'Get-TierModelPrivilegedSnapshot (child domain)' -Tag 'Unit', 'Privileged' {
    BeforeEach {
        InModuleScope TierModel { Clear-TierModelWellKnownPrincipalCache }
        $c = 'DC=child,DC=contoso,DC=com'
        $cs = 'S-1-5-21-111-222-333'
        $r = 'DC=contoso,DC=com'
        $rs = 'S-1-5-21-900-800-700'
        $sd = New-TMFakeSecurityDescriptor -Owner "$cs-512"
        Initialize-TMDirectory -Objects @(
            New-TMObject -Dn $c -Class 'domainDNS' -Sid $cs -Extra @{ nTSecurityDescriptor = New-TMFakeSecurityDescriptor -Owner 'S-1-5-32-544' -Rules @(@{ Sid = "$rs-519"; Rights = 'GenericAll' }, @{ Sid = "$rs-527"; Rights = 'WriteProperty'; Guid = $script:GuidKeyCred }) }
            New-TMObject -Dn "CN=Domänen-Admins,CN=Users,$c" -Class 'group' -Sid "$cs-512" -Sam 'Domänen-Admins' -Extra @{ member = @("CN=Chris,CN=Users,$c"); nTSecurityDescriptor = $sd }
            New-TMObject -Dn "CN=Organisations-Admins,CN=Users,$r" -Class 'group' -Sid "$rs-519" -Sam 'Organisations-Admins' -Extra @{ member = @("CN=Chris,CN=Users,$c", "CN=Root-Admin,CN=Users,$r"); nTSecurityDescriptor = $sd }
            New-TMObject -Dn "CN=Chris,CN=Users,$c" -Class 'user' -Sid "$cs-1100" -Sam 'chris' -Extra @{ userAccountControl = 0x200 }
            New-TMObject -Dn "CN=Root-Admin,CN=Users,$r" -Class 'user' -Sid "$rs-1100" -Sam 'rootadmin' -Extra @{ userAccountControl = 0x200 }
        )
        Mock Get-ADDomain -ModuleName TierModel -ParameterFilter { $Identity -eq 'contoso.com' } {
            [PSCustomObject]@{ DomainSID = [PSCustomObject]@{ Value = 'S-1-5-21-900-800-700' }; DNSRoot = 'contoso.com'; NetBIOSName = 'CONTOSO'; DistinguishedName = 'DC=contoso,DC=com' }
        }
        Mock Get-ADDomain -ModuleName TierModel -ParameterFilter { $Identity -ne 'contoso.com' } {
            [PSCustomObject]@{ DomainSID = [PSCustomObject]@{ Value = 'S-1-5-21-111-222-333' }; DNSRoot = 'child.contoso.com'; NetBIOSName = 'CHILD'; DistinguishedName = 'DC=child,DC=contoso,DC=com' }
        }
        Mock Get-ADForest -ModuleName TierModel { [PSCustomObject]@{ RootDomain = 'contoso.com' } }
        Mock Get-ADObject -ModuleName TierModel $script:MockGetADObject
        Mock Get-ADGroup -ModuleName TierModel $script:MockGetADGroup
    }

    It 'Reads forest-wide groups from a discovered forest root DC and members from their own domain' {
        Mock Get-ADDomainController -ModuleName TierModel { [PSCustomObject]@{ HostName = @('rootdc01.contoso.com') } }
        $snap = Get-TierModelPrivilegedSnapshot -DomainController 'dc01.child.contoso.com' -Config ([PSCustomObject]@{ groups = @(); organizationUnits = @() })

        $snap.metadata.isForestRoot | Should -BeFalse
        $snap.metadata.forestRootDomain | Should -Be 'contoso.com'
        $snap.metadata.domain | Should -Be 'child.contoso.com'
        Should -Invoke Get-ADDomainController -ModuleName TierModel -ParameterFilter { $Discover -and $DomainName -eq 'contoso.com' }

        $ea = $snap.groups | Where-Object wellKnownName -eq 'Enterprise Admins'
        $ea.sid | Should -Be 'S-1-5-21-900-800-700-519'
        $ea.name | Should -Be 'Organisations-Admins'
        @($ea.members).samAccountName | Should -Be @('chris', 'rootadmin')
        $global:TMDir.Calls | Should -Contain 'Get-ADGroup|rootdc01.contoso.com|S-1-5-21-900-800-700-519|'
        $global:TMDir.Calls | Should -Contain 'Get-ADObject|dc01.child.contoso.com|CN=Chris,CN=Users,DC=child,DC=contoso,DC=com||'
        $global:TMDir.Calls | Should -Contain 'Get-ADObject|rootdc01.contoso.com|CN=Root-Admin,CN=Users,DC=contoso,DC=com||'

        $chris = $snap.accounts | Where-Object samAccountName -eq 'chris'
        $chris.memberOfPrivileged | Should -Contain 'Domain Admins'
        $chris.memberOfPrivileged | Should -Contain 'Enterprise Admins'

        # Root Enterprise Admins are excluded, Enterprise Key Admins only on msDS-KeyCredentialLink
        @($snap.aclFindings | Where-Object objectType -eq 'DomainRoot').Count | Should -Be 0
    }

    It 'Falls back to the root domain name and records an error when no root DC can be discovered' {
        Mock Get-ADDomainController -ModuleName TierModel { throw 'no DC found' }
        $snap = Get-TierModelPrivilegedSnapshot -DomainController 'dc01.child.contoso.com' -Config ([PSCustomObject]@{ groups = @(); organizationUnits = @() })
        $snap.errors | Where-Object { $_ -like '*forest root domain*contoso.com*' } | Should -Not -BeNullOrEmpty
        $global:TMDir.Calls | Should -Contain 'Get-ADGroup|contoso.com|S-1-5-21-900-800-700-519|'
        ($snap.groups | Where-Object wellKnownName -eq 'Enterprise Admins') | Should -Not -BeNullOrEmpty
    }

    It 'Skips forest-wide groups with an error entry when the forest root cannot be read' {
        Mock Get-ADForest -ModuleName TierModel { throw 'forest unavailable' }
        Mock Get-ADDomainController -ModuleName TierModel { throw 'not expected' }
        $snap = Get-TierModelPrivilegedSnapshot -DomainController 'dc01.child.contoso.com' -Config ([PSCustomObject]@{ groups = @(); organizationUnits = @() })
        ($snap.groups | Where-Object wellKnownName -eq 'Enterprise Admins') | Should -BeNullOrEmpty
        ($snap.groups | Where-Object wellKnownName -eq 'Domain Admins') | Should -Not -BeNullOrEmpty
        $snap.errors | Where-Object { $_ -like '*forest-wide groups*skipped*' } | Should -Not -BeNullOrEmpty
        $snap.metadata.forestRootDomain | Should -BeNullOrEmpty
    }

    It 'Throws when the domain itself cannot be read' {
        Mock Get-ADDomain -ModuleName TierModel -ParameterFilter { $true } { throw 'server not operational' }
        { Get-TierModelPrivilegedSnapshot -DomainController 'dc01.child.contoso.com' -Config ([PSCustomObject]@{ groups = @(); organizationUnits = @() }) } | Should -Throw '*server not operational*'
    }
}

Describe 'Export-TierModelPrivilegedSnapshot JSON shape' -Tag 'Unit', 'Privileged' {
    BeforeAll {
        InModuleScope TierModel { Clear-TierModelWellKnownPrincipalCache }
        Initialize-TMDirectory -Objects (& $script:RootObjects)
        Mock Get-ADDomain -ModuleName TierModel {
            [PSCustomObject]@{ DomainSID = [PSCustomObject]@{ Value = 'S-1-5-21-100-200-300' }; DNSRoot = 'contoso.com'; NetBIOSName = 'CONTOSO'; DistinguishedName = 'DC=contoso,DC=com' }
        }
        Mock Get-ADForest -ModuleName TierModel { [PSCustomObject]@{ RootDomain = 'contoso.com' } }
        Mock Get-ADObject -ModuleName TierModel $script:MockGetADObject
        Mock Get-ADGroup -ModuleName TierModel $script:MockGetADGroup

        $snap = Get-TierModelPrivilegedSnapshot -DomainController 'dc01.contoso.com' -Config $script:TestConfig
        $script:JsonPath = Join-Path ([System.IO.Path]::GetTempPath()) ("tm-privileged-{0}" -f [guid]::NewGuid()) 'out' 'privileged.json'
        $script:Written = Export-TierModelPrivilegedSnapshot -Snapshot $snap -Path $script:JsonPath
        $script:Raw = [System.IO.File]::ReadAllText($script:JsonPath)
        $script:Bytes = [System.IO.File]::ReadAllBytes($script:JsonPath)
        $script:Json = $script:Raw | ConvertFrom-Json
    }

    AfterAll {
        Remove-Item -LiteralPath (Split-Path (Split-Path $script:JsonPath -Parent) -Parent) -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'Creates the directory and writes UTF-8 without BOM' {
        $script:Written | Should -Be $script:JsonPath
        ($script:Bytes[0] -eq 0xEF -and $script:Bytes[1] -eq 0xBB) | Should -BeFalse
        $script:Raw | Should -Match 'Domänen-Admins'
    }

    It 'Has exactly the contract top-level keys' {
        @($script:Json.PSObject.Properties.Name) | Should -Be @('metadata', 'groups', 'accounts', 'adminCountOrphans', 'aclFindings', 'errors')
    }

    It 'Uses camelCase keys everywhere' {
        $bad = New-Object System.Collections.Generic.List[string]
        $walk = {
            param($node)
            if ($node -is [System.Management.Automation.PSCustomObject]) {
                foreach ($p in $node.PSObject.Properties) {
                    if ($p.Name -cnotmatch '^[a-z][A-Za-z]*$') { $bad.Add($p.Name) }
                    & $walk $p.Value
                }
            } elseif ($node -is [System.Array]) {
                foreach ($i in $node) { & $walk $i }
            }
        }
        & $walk $script:Json
        $bad | Should -BeNullOrEmpty
    }

    It 'Keeps arrays with zero or one element as arrays' {
        $alice = $script:Json.accounts | Where-Object samAccountName -eq 't0-alice'
        ($alice.servicePrincipalNames -is [System.Array]) | Should -BeTrue
        @($alice.servicePrincipalNames).Count | Should -Be 1
        $erin = $script:Json.accounts | Where-Object samAccountName -eq 't1-erin'
        ($erin.memberOfPrivileged -is [System.Array]) | Should -BeTrue
        ($erin.servicePrincipalNames -is [System.Array]) | Should -BeTrue
        ($script:Json.adminCountOrphans -is [System.Array]) | Should -BeTrue
        @($script:Json.adminCountOrphans).Count | Should -Be 1
        $member = $script:Json.groups[0].members[0]
        ($member.via -is [System.Array]) | Should -BeTrue
        $schema = $script:Json.groups | Where-Object wellKnownName -eq 'Schema Admins'
        ($schema.members -is [System.Array]) | Should -BeTrue
        @($schema.members).Count | Should -Be 0
        $script:Raw | Should -Match '"via": \[\]'
        $script:Raw | Should -Match '"memberOfPrivileged": \[\]'
        $script:Raw | Should -Match '"rights": \[\s*"WriteMember"\s*\]'
    }

    It 'Writes null for unknown values and ISO timestamps' {
        $script:Raw | Should -Match '"wellKnownName": null'
        $script:Raw | Should -Match '"lastLogon": null'
        $script:Raw | Should -Match '"lastLogon": "2026-09-20T08:00:00Z"'
        $script:Raw | Should -Match '"memberCount": null'
        $script:Raw | Should -Match '"objectTypeGuid": null'
        $script:Raw | Should -Match '"enabled": null'
        $script:Raw | Should -Match '"adminCount": null'
        $script:Raw | Should -Match '"timestamp": "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"'
    }
}

Describe 'Watch-TierModelPrivilegedGroups.ps1' -Tag 'Unit', 'Privileged' {
    BeforeAll {
        $script:ScriptPath = Join-Path $PSScriptRoot '..' 'Watch-TierModelPrivilegedGroups.ps1'
        $script:Pwsh = (Get-Process -Id $PID).Path
    }

    It 'Has comment-based help and the contract parameters' {
        $help = Get-Help $script:ScriptPath -Full
        $help.Synopsis | Should -Not -BeNullOrEmpty
        $cmd = Get-Command $script:ScriptPath
        $cmd.Parameters.Keys | Should -Contain 'PreferredDc'
        $cmd.Parameters.Keys | Should -Contain 'OutputPath'
        $cmd.Parameters.Keys | Should -Contain 'ConfigPath'
        $cmd.Parameters.Keys | Should -Not -Contain 'ConfirmApply'
    }

    It 'Writes the snapshot with the repository configuration and exits 0 (end to end, stubbed AD)' {
        $work = Join-Path ([System.IO.Path]::GetTempPath()) ("tm-watch-{0}" -f [guid]::NewGuid())
        New-Item -ItemType Directory -Path $work | Out-Null
        $out = Join-Path $work 'privileged.json'
        $runner = Join-Path $work 'run.ps1'
        @"
function global:Get-ADDomain { param(`$Server, `$Identity, `$ErrorAction) [PSCustomObject]@{ DomainSID = 'S-1-5-21-1-2-3'; DNSRoot = 'contoso.com'; NetBIOSName = 'CONTOSO'; DistinguishedName = 'DC=contoso,DC=com' } }
function global:Get-ADForest { param(`$Server, `$ErrorAction) [PSCustomObject]@{ RootDomain = 'contoso.com' } }
function global:Get-ADDomainController { param([switch]`$Discover, `$DomainName, `$ErrorAction) throw 'unexpected' }
function global:Get-ADGroup { param(`$Identity, `$Server, `$Filter, `$Properties, `$ErrorAction)
    if (`$Identity -eq 'S-1-5-21-1-2-3-512') { return [PSCustomObject]@{ DistinguishedName = 'CN=Domain Admins,CN=Users,DC=contoso,DC=com'; ObjectClass = 'group'; objectSid = `$Identity; sAMAccountName = 'Domain Admins'; Name = 'Domain Admins'; member = @('CN=Admin,CN=Users,DC=contoso,DC=com') } }
    if (`$Identity) { throw "not found: `$Identity" }
    return @()
}
function global:Get-ADObject { param(`$Identity, `$Server, `$Filter, `$SearchBase, `$Properties, `$LDAPFilter, `$ErrorAction)
    if (`$Identity -eq 'CN=Admin,CN=Users,DC=contoso,DC=com') { return [PSCustomObject]@{ DistinguishedName = `$Identity; ObjectClass = 'user'; objectSid = 'S-1-5-21-1-2-3-500'; sAMAccountName = 'Administrator'; Name = 'Admin'; userAccountControl = 66048; lastLogonTimestamp = 134031744000000000; pwdLastSet = 0; adminCount = 1 } }
    if (`$Identity) { throw "not found: `$Identity" }
    return @()
}
& '$($script:ScriptPath)' -PreferredDc 'dc01.contoso.com' -OutputPath '$out'
exit `$LASTEXITCODE
"@ | Set-Content -LiteralPath $runner -Encoding utf8

        $output = & $script:Pwsh -NoProfile -NonInteractive -File $runner 2>&1
        $LASTEXITCODE | Should -Be 0 -Because ($output -join "`n")
        Test-Path -LiteralPath $out | Should -BeTrue
        $json = Get-Content -LiteralPath $out -Raw | ConvertFrom-Json
        $json.metadata.domain | Should -Be 'contoso.com'
        $da = $json.groups | Where-Object wellKnownName -eq 'Domain Admins'
        @($da.members).samAccountName | Should -Be @('Administrator')
        @($json.errors).Count | Should -BeGreaterThan 0   # stubbed directory lacks most objects
        ($output -join "`n") | Should -Match 'Snapshot written to'
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'Exits 1 when the domain cannot be read' {
        $work = Join-Path ([System.IO.Path]::GetTempPath()) ("tm-watch-{0}" -f [guid]::NewGuid())
        New-Item -ItemType Directory -Path $work | Out-Null
        $out = Join-Path $work 'privileged.json'
        $runner = Join-Path $work 'run.ps1'
        @"
function global:Get-ADDomain { param(`$Server, `$Identity, `$ErrorAction) throw 'The server is not operational' }
& '$($script:ScriptPath)' -PreferredDc 'dc01.contoso.com' -OutputPath '$out'
exit `$LASTEXITCODE
"@ | Set-Content -LiteralPath $runner -Encoding utf8
        $output = & $script:Pwsh -NoProfile -NonInteractive -File $runner 2>&1
        $LASTEXITCODE | Should -Be 1
        Test-Path -LiteralPath $out | Should -BeFalse
        ($output -join "`n") | Should -Match 'could not be taken'
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}
