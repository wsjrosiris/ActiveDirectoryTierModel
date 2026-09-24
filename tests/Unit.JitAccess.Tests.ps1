#Requires -Modules Pester
<#
.SYNOPSIS
Unit tests for Just-in-Time access (Test-TierModelJitPrerequisite, Grant-/Revoke-TierModelJitAccess,
Get-TierModelJitMembership and Grant-TierModelJitAccess.ps1).

.DESCRIPTION
A small in-memory directory backs mocked AD cmdlets: group member values use the format returned by
Get-ADGroup -ShowMemberTimeToLive ("<TTL=seconds>,CN=…" for time-limited members, a plain DN otherwise).
Runs without RSAT / a domain.
#>

BeforeAll {
    . (Join-Path $PSScriptRoot 'helpers' 'ADStubs.ps1')
    Import-Module (Join-Path $PSScriptRoot '..' 'modules' 'TierModel' 'TierModel.psd1') -Force

    $global:TMBase = 'DC=contoso,DC=com'
    $global:TMD = 'S-1-5-21-1-2-3'

    function global:Reset-TMJitDirectory {
        param([string[]]$Members = @(), [bool]$Pam = $true, [string]$ForestMode = 'Windows2016Forest', [bool]$IgnoreTtl = $false)
        $global:TMJit = @{
            Objects   = @(
                [pscustomobject]@{ DistinguishedName = "CN=Tier0-JIT-DA,OU=Groups,$global:TMBase"; sAMAccountName = 'Tier0-JIT-DA'; objectSid = "$global:TMD-1100"; objectClass = @('top', 'group') }
                [pscustomobject]@{ DistinguishedName = "CN=Alice Admin,OU=Admins,$global:TMBase"; sAMAccountName = 't0-alice'; objectSid = "$global:TMD-1201"; objectClass = @('top', 'person', 'user') }
                [pscustomobject]@{ DistinguishedName = "CN=Bob Admin,OU=Admins,$global:TMBase"; sAMAccountName = 't0-bob'; objectSid = "$global:TMD-1202"; objectClass = @('top', 'person', 'user') }
            )
            Members   = [System.Collections.Generic.List[string]]::new()
            Pam       = $Pam
            Forest    = $ForestMode
            IgnoreTtl = $IgnoreTtl
            Calls     = [System.Collections.Generic.List[string]]::new()
        }
        foreach ($m in $Members) { $global:TMJit.Members.Add($m) }
    }

    $script:MockGetADObject = {
        $global:TMJit.Calls.Add("Get-ADObject|$Filter|$Server")
        $all = $global:TMJit.Objects
        if ($Filter -match "objectSid -eq '([^']+)'") { $v = $Matches[1]; $all = $all | Where-Object { $_.objectSid -eq $v } }
        elseif ($Filter -match "sAMAccountName -eq '([^']+)'") { $v = $Matches[1]; $all = $all | Where-Object { $_.sAMAccountName -ieq $v } }
        if ($Filter -match "objectClass -eq 'group'") { $all = $all | Where-Object { $_.objectClass -contains 'group' } }
        @($all)
    }
    $script:MockGetADGroup = {
        $global:TMJit.Calls.Add("Get-ADGroup|$Identity|ttl=$([bool]$ShowMemberTimeToLive)")
        $g = $global:TMJit.Objects | Where-Object { $_.DistinguishedName -ieq $Identity -or $_.sAMAccountName -ieq $Identity -or $_.objectSid -eq $Identity } | Select-Object -First 1
        if (-not $g) { throw [Microsoft.ActiveDirectory.Management.ADIdentityNotFoundException]::new("Cannot find an object with identity: '$Identity'") }
        $values = @($global:TMJit.Members | ForEach-Object { if ($ShowMemberTimeToLive) { $_ } else { $_ -replace '^<TTL=\d+>,', '' } })
        [pscustomobject]@{ DistinguishedName = $g.DistinguishedName; SamAccountName = $g.sAMAccountName; SID = $g.objectSid; member = $values }
    }
    $script:MockAdd = {
        $global:TMJit.Calls.Add("Add-ADGroupMember|$Identity|$Members|$($MemberTimeToLive.TotalMinutes)")
        if ($global:TMJit.IgnoreTtl) { $global:TMJit.Members.Add([string]$Members) }
        else { $global:TMJit.Members.Add("<TTL=$([int]$MemberTimeToLive.TotalSeconds - 2)>,$Members") }
    }
    $script:MockRemove = {
        $global:TMJit.Calls.Add("Remove-ADGroupMember|$Identity|$Members")
        $keep = @($global:TMJit.Members | Where-Object { ($_ -replace '^<TTL=\d+>,', '') -ine [string]$Members })
        $global:TMJit.Members.Clear(); foreach ($k in $keep) { $global:TMJit.Members.Add($k) }
    }
    $script:MockFeature = {
        $global:TMJit.Calls.Add("Get-ADOptionalFeature|$Filter")
        [pscustomobject]@{ Name = 'Privileged Access Management Feature'; EnabledScopes = $(if ($global:TMJit.Pam) { @("CN=Partitions,CN=Configuration,$global:TMBase") } else { @() }) }
    }
    $script:MockForest = { [pscustomobject]@{ Name = 'contoso.com'; ForestMode = $global:TMJit.Forest } }
}

Describe 'ConvertFrom-TierModelJitMemberValue' -Tag 'Unit', 'Jit' {
    It 'parses the TTL and the DN of a time-limited member' {
        InModuleScope TierModel {
            $r = ConvertFrom-TierModelJitMemberValue -Value '<TTL=3587>,CN=Alice Admin,OU=Admins,DC=contoso,DC=com'
            $r.TtlSeconds | Should -Be 3587
            $r.DistinguishedName | Should -Be 'CN=Alice Admin,OU=Admins,DC=contoso,DC=com'
        }
    }
    It 'returns no TTL for a permanent member' {
        InModuleScope TierModel {
            $r = ConvertFrom-TierModelJitMemberValue -Value 'CN=Bob\, Jr.,OU=Admins,DC=contoso,DC=com'
            $r.TtlSeconds | Should -BeNullOrEmpty
            $r.DistinguishedName | Should -Be 'CN=Bob\, Jr.,OU=Admins,DC=contoso,DC=com'
        }
    }
    It 'accepts a zero TTL and spaces after the marker' {
        InModuleScope TierModel {
            $r = ConvertFrom-TierModelJitMemberValue -Value '<TTL=0>, CN=x,DC=y'
            $r.TtlSeconds | Should -Be 0
            $r.DistinguishedName | Should -Be 'CN=x,DC=y'
        }
    }
}

Describe 'Test-TierModelForestModeAtLeast2016' -Tag 'Unit', 'Jit' {
    It 'evaluates <Mode> as <Expected>' -ForEach @(
        @{ Mode = 'Windows2016Forest'; Expected = $true }
        @{ Mode = 'Windows2025Forest'; Expected = $true }
        @{ Mode = 'Windows2012R2Forest'; Expected = $false }
        @{ Mode = '7'; Expected = $true }
        @{ Mode = '6'; Expected = $false }
        @{ Mode = 'Unknown'; Expected = $false }
    ) {
        InModuleScope TierModel -Parameters @{ Mode = $Mode; Expected = $Expected } {
            Test-TierModelForestModeAtLeast2016 -ForestMode $Mode | Should -Be $Expected
        }
    }
}

Describe 'Test-TierModelJitPrerequisite' -Tag 'Unit', 'Jit' {
    BeforeEach {
        Mock Get-ADOptionalFeature -ModuleName TierModel -MockWith $script:MockFeature
        Mock Get-ADForest -ModuleName TierModel -MockWith $script:MockForest
    }

    It 'is ready when the feature is enabled and the forest level is 2016' {
        Reset-TMJitDirectory
        $r = Test-TierModelJitPrerequisite -Server dc01
        $r.Ready | Should -BeTrue
        $r.PamEnabled | Should -BeTrue
        $r.ForestLevelSufficient | Should -BeTrue
        @($r.EnabledScopes).Count | Should -Be 1
        @($r.Messages).Count | Should -Be 0
        Should -Invoke Get-ADOptionalFeature -ModuleName TierModel -Times 1 -ParameterFilter { $Filter -eq "Name -eq 'Privileged Access Management Feature'" -and $Server -eq 'dc01' }
    }

    It 'is not ready when EnabledScopes is empty and explains that the feature is not enabled' {
        Reset-TMJitDirectory -Pam $false
        $r = Test-TierModelJitPrerequisite -Server dc01
        $r.Ready | Should -BeFalse
        $r.PamEnabled | Should -BeFalse
        ($r.Messages -join ' ') | Should -Match 'not enabled'
        ($r.Messages -join ' ') | Should -Match 'irreversible'
    }

    It 'is not ready with a forest level below 2016' {
        Reset-TMJitDirectory -ForestMode 'Windows2012R2Forest'
        $r = Test-TierModelJitPrerequisite -Server dc01
        $r.Ready | Should -BeFalse
        $r.ForestLevelSufficient | Should -BeFalse
        ($r.Messages -join ' ') | Should -Match '2016'
    }

    It 'reports a read error instead of throwing' {
        Reset-TMJitDirectory
        Mock Get-ADOptionalFeature -ModuleName TierModel -MockWith { throw 'Server unavailable' }
        $r = Test-TierModelJitPrerequisite -Server dc01
        $r.Ready | Should -BeFalse
        ($r.Messages -join ' ') | Should -Match 'Server unavailable'
    }

    It 'never enables the feature' {
        Reset-TMJitDirectory -Pam $false
        { Test-TierModelJitPrerequisite -Server dc01 } | Should -Not -Throw
        (Get-Content (Join-Path $PSScriptRoot '..' 'modules' 'TierModel' 'public' 'Test-TierModelJitPrerequisite.ps1') -Raw) | Should -Not -Match 'Enable-ADOptionalFeature\s+-'
    }
}

Describe 'Grant-TierModelJitAccess' -Tag 'Unit', 'Jit' {
    BeforeEach {
        Mock Get-ADOptionalFeature -ModuleName TierModel -MockWith $script:MockFeature
        Mock Get-ADForest -ModuleName TierModel -MockWith $script:MockForest
        Mock Get-ADObject -ModuleName TierModel -MockWith $script:MockGetADObject
        Mock Get-ADGroup -ModuleName TierModel -MockWith $script:MockGetADGroup
        Mock Add-ADGroupMember -ModuleName TierModel -MockWith $script:MockAdd
    }

    It 'adds the member with a time-to-live and returns SIDs and the expiry from the TTL' {
        Reset-TMJitDirectory
        $before = [DateTimeOffset]::UtcNow
        $r = Grant-TierModelJitAccess -Group 'Tier0-JIT-DA' -Member 't0-alice' -Minutes 60 -Server dc01
        $r.Group | Should -Be 'Tier0-JIT-DA'
        $r.Member | Should -Be 't0-alice'
        $r.Sids.Group | Should -Be "$global:TMD-1100"
        $r.Sids.Member | Should -Be "$global:TMD-1201"
        $r.TtlSeconds | Should -Be 3598
        $r.ExpiresAt | Should -BeGreaterOrEqual $before.AddSeconds(3598)
        $r.ExpiresAt | Should -BeLessOrEqual ([DateTimeOffset]::UtcNow.AddSeconds(3598))
        $r.Dc | Should -Be 'dc01'
        Should -Invoke Add-ADGroupMember -ModuleName TierModel -Times 1 -ParameterFilter {
            $MemberTimeToLive -eq (New-TimeSpan -Minutes 60) -and $Server -eq 'dc01' -and $Identity -like 'CN=Tier0-JIT-DA,*' -and $Members -like 'CN=Alice Admin,*'
        }
        Should -Invoke Get-ADGroup -ModuleName TierModel -ParameterFilter { $ShowMemberTimeToLive }
    }

    It 'resolves group and member by SID and strips a DOMAIN\ prefix' {
        Reset-TMJitDirectory
        (Grant-TierModelJitAccess -Group "$global:TMD-1100" -Member 'CONTOSO\t0-bob' -Minutes 15 -Server dc01).Sids.Member | Should -Be "$global:TMD-1202"
        Should -Invoke Get-ADObject -ModuleName TierModel -ParameterFilter { $Filter -like "*objectSid -eq '$global:TMD-1100'*objectClass -eq 'group'*" }
        Should -Invoke Get-ADObject -ModuleName TierModel -ParameterFilter { $Filter -eq "sAMAccountName -eq 't0-bob'" }
    }

    It 'refuses when the prerequisites are not met' {
        Reset-TMJitDirectory -Pam $false
        { Grant-TierModelJitAccess -Group 'Tier0-JIT-DA' -Member 't0-alice' -Minutes 60 -Server dc01 } | Should -Throw '*not enabled*'
        Should -Invoke Add-ADGroupMember -ModuleName TierModel -Times 0
    }

    It 'fails when the member does not exist' {
        Reset-TMJitDirectory
        { Grant-TierModelJitAccess -Group 'Tier0-JIT-DA' -Member 'nobody' -Minutes 60 -Server dc01 } | Should -Throw "*'nobody' was not found*"
        Should -Invoke Add-ADGroupMember -ModuleName TierModel -Times 0
    }

    It 'rejects identities that could change the filter' {
        Reset-TMJitDirectory
        { Grant-TierModelJitAccess -Group "x' -or name -like '*" -Member 't0-alice' -Minutes 60 -Server dc01 } | Should -Throw '*not a valid samAccountName or SID*'
    }

    It 'does not turn a permanent membership into a temporary one' {
        Reset-TMJitDirectory -Members @("CN=Alice Admin,OU=Admins,$global:TMBase")
        { Grant-TierModelJitAccess -Group 'Tier0-JIT-DA' -Member 't0-alice' -Minutes 60 -Server dc01 } | Should -Throw '*already a permanent member*'
        Should -Invoke Add-ADGroupMember -ModuleName TierModel -Times 0
    }

    It 'reports an existing time-limited membership' {
        Reset-TMJitDirectory -Members @("<TTL=120>,CN=Alice Admin,OU=Admins,$global:TMBase")
        { Grant-TierModelJitAccess -Group 'Tier0-JIT-DA' -Member 't0-alice' -Minutes 60 -Server dc01 } | Should -Throw '*already has a time-limited membership*'
    }

    It 'fails the verification when AD stored the membership without a TTL' {
        Reset-TMJitDirectory -IgnoreTtl $true
        { Grant-TierModelJitAccess -Group 'Tier0-JIT-DA' -Member 't0-alice' -Minutes 60 -Server dc01 } | Should -Throw '*without a time-to-live*'
    }

    It 'fails the verification when the member is missing afterwards' {
        Reset-TMJitDirectory
        Mock Add-ADGroupMember -ModuleName TierModel -MockWith { }
        { Grant-TierModelJitAccess -Group 'Tier0-JIT-DA' -Member 't0-alice' -Minutes 60 -Server dc01 } | Should -Throw '*Verification failed*not a member*'
    }

    It 'validates the duration' {
        { Grant-TierModelJitAccess -Group 'Tier0-JIT-DA' -Member 't0-alice' -Minutes 0 -Server dc01 } | Should -Throw
        { Grant-TierModelJitAccess -Group 'Tier0-JIT-DA' -Member 't0-alice' -Minutes 10081 -Server dc01 } | Should -Throw
    }
}

Describe 'Revoke-TierModelJitAccess' -Tag 'Unit', 'Jit' {
    BeforeEach {
        Mock Get-ADObject -ModuleName TierModel -MockWith $script:MockGetADObject
        Mock Get-ADGroup -ModuleName TierModel -MockWith $script:MockGetADGroup
        Mock Remove-ADGroupMember -ModuleName TierModel -MockWith $script:MockRemove
    }

    It 'removes a time-limited membership and verifies it' {
        Reset-TMJitDirectory -Members @("<TTL=900>,CN=Alice Admin,OU=Admins,$global:TMBase", "CN=Bob Admin,OU=Admins,$global:TMBase")
        $r = Revoke-TierModelJitAccess -Group 'Tier0-JIT-DA' -Member 't0-alice' -Server dc01
        $r.Removed | Should -BeTrue
        $r.WasMember | Should -BeTrue
        $r.Sids.Member | Should -Be "$global:TMD-1201"
        @($global:TMJit.Members) | Should -Be @("CN=Bob Admin,OU=Admins,$global:TMBase")
        Should -Invoke Remove-ADGroupMember -ModuleName TierModel -Times 1 -ParameterFilter { $Members -like 'CN=Alice Admin,*' -and $Server -eq 'dc01' }
    }

    It 'changes nothing when the membership already expired' {
        Reset-TMJitDirectory
        $r = Revoke-TierModelJitAccess -Group 'Tier0-JIT-DA' -Member 't0-alice' -Server dc01
        $r.Removed | Should -BeFalse
        $r.WasMember | Should -BeFalse
        Should -Invoke Remove-ADGroupMember -ModuleName TierModel -Times 0
    }

    It 'does not remove a permanent membership without -IncludePermanent' {
        Reset-TMJitDirectory -Members @("CN=Alice Admin,OU=Admins,$global:TMBase")
        { Revoke-TierModelJitAccess -Group 'Tier0-JIT-DA' -Member 't0-alice' -Server dc01 } | Should -Throw '*permanent member*'
        Should -Invoke Remove-ADGroupMember -ModuleName TierModel -Times 0
        (Revoke-TierModelJitAccess -Group 'Tier0-JIT-DA' -Member 't0-alice' -Server dc01 -IncludePermanent).Removed | Should -BeTrue
    }

    It 'fails the verification when the member is still there' {
        Reset-TMJitDirectory -Members @("<TTL=900>,CN=Alice Admin,OU=Admins,$global:TMBase")
        Mock Remove-ADGroupMember -ModuleName TierModel -MockWith { }
        { Revoke-TierModelJitAccess -Group 'Tier0-JIT-DA' -Member 't0-alice' -Server dc01 } | Should -Throw '*still a member*'
    }
}

Describe 'Get-TierModelJitMembership' -Tag 'Unit', 'Jit' {
    BeforeEach {
        Mock Get-ADGroup -ModuleName TierModel -MockWith $script:MockGetADGroup
    }

    It 'lists only time-limited members with the remaining seconds' {
        Reset-TMJitDirectory -Members @("<TTL=600>,CN=Alice Admin,OU=Admins,$global:TMBase", "CN=Bob Admin,OU=Admins,$global:TMBase")
        $r = @(Get-TierModelJitMembership -Group 'Tier0-JIT-DA' -Server dc01)
        $r.Count | Should -Be 1
        $r[0].MemberDn | Should -Be "CN=Alice Admin,OU=Admins,$global:TMBase"
        $r[0].TtlSeconds | Should -Be 600
        $r[0].GroupSid | Should -Be "$global:TMD-1100"
        $r[0].ExpiresAt | Should -BeGreaterThan ([DateTimeOffset]::UtcNow.AddSeconds(590))
    }

    It 'includes permanent members on request' {
        Reset-TMJitDirectory -Members @("<TTL=600>,CN=Alice Admin,OU=Admins,$global:TMBase", "CN=Bob Admin,OU=Admins,$global:TMBase")
        $r = @(Get-TierModelJitMembership -Group 'Tier0-JIT-DA' -Server dc01 -IncludePermanent)
        $r.Count | Should -Be 2
        ($r | Where-Object { -not $_.TimeLimited }).ExpiresAt | Should -BeNullOrEmpty
    }

    It 'returns nothing for an empty group' {
        Reset-TMJitDirectory
        @(Get-TierModelJitMembership -Group 'Tier0-JIT-DA' -Server dc01).Count | Should -Be 0
    }
}

Describe 'Grant-TierModelJitAccess.ps1' -Tag 'Unit', 'Jit' {
    BeforeAll {
        $script:Script = Join-Path $PSScriptRoot '..' 'Grant-TierModelJitAccess.ps1'
        $script:Pwsh = (Get-Process -Id $PID).Path
    }

    It 'writes an error result and exits with 1 when parameters of the mode are missing' {
        $out = Join-Path ([System.IO.Path]::GetTempPath()) ("jit-" + [guid]::NewGuid().ToString('N') + '.json')
        & $script:Pwsh -NoProfile -NonInteractive -File $script:Script -PreferredDc dc01 -Mode Grant -Group 'Tier0-JIT-DA' -OutputPath $out *> $null
        $LASTEXITCODE | Should -Be 1
        $json = Get-Content $out -Raw | ConvertFrom-Json
        $json.success | Should -BeFalse
        $json.mode | Should -Be 'grant'
        $json.error | Should -Match '-Member'
        $json.error | Should -Match '-Minutes'
        $json.dc | Should -Be 'dc01'
        Remove-Item $out -ErrorAction SilentlyContinue
    }

    It 'documents all modes and never enables the optional feature' {
        $text = Get-Content $script:Script -Raw
        foreach ($mode in 'Grant', 'Revoke', 'Check', 'List') { $text | Should -Match "'$mode'" }
        $text | Should -Not -Match 'Enable-ADOptionalFeature'
    }
}
