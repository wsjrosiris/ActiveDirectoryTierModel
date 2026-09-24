# TierModel privileged access snapshot (read-only)
# Collects the recursive membership of the protected built-in groups and of every Tier 0 group from the
# configuration, hygiene attributes of the privileged accounts, adminCount orphans and dangerous ACEs on
# Tier 0 objects. The output shape is the "privileged access snapshot" contract consumed by the
# TierModel service (see docs/privileged-access-monitoring.md). Nothing in this file writes to AD.

# Attribute / extended-right GUIDs used by the ACL mapping
$script:TierModelGuidMember = 'bf9679c0-0de6-11d0-a285-00aa003049e2'            # member attribute (also Self-Membership validated write)
$script:TierModelGuidGroupMembershipSet = 'bc0ac240-79a9-11d0-9020-00c04fc2d4cf' # Group-Membership property set (contains member)
$script:TierModelGuidResetPassword = '00299570-246d-11d0-a768-00aa006e0529'     # User-Force-Change-Password extended right
$script:TierModelGuidKeyCredentialLink = '5b47d60f-6090-40b2-9f37-2a4de88f3063' # msDS-KeyCredentialLink attribute

# Protected built-in groups resolved by SID through the well-known principal table (DnsAdmins has no fixed RID)
$script:TierModelProtectedGroupNames = @(
    'Domain Admins', 'Enterprise Admins', 'Schema Admins', 'Administrators', 'Account Operators',
    'Server Operators', 'Backup Operators', 'Print Operators', 'Domain Controllers',
    'Read-only Domain Controllers', 'Enterprise Read-only Domain Controllers', 'Group Policy Creator Owners',
    'Key Admins', 'Enterprise Key Admins', 'Cert Publishers', 'Replicator'
)

# Attributes read for every object that can appear in the snapshot
$script:TierModelSnapshotProperties = @(
    'objectSid', 'sAMAccountName', 'name', 'objectClass', 'distinguishedName', 'member', 'userAccountControl',
    'lastLogonTimestamp', 'pwdLastSet', 'adminCount', 'servicePrincipalName'
)

function Get-TierModelSnapshotValue {
    <# Reads a property from an AD object / PSCustomObject / hashtable without tripping StrictMode (internal helper). #>
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) {
        foreach ($key in $Object.Keys) { if ([string]$key -ieq $Name) { return $Object[$key] } }
        return $null
    }
    $prop = $Object.PSObject.Properties[$Name]
    if ($prop) { return $prop.Value }
    return $null
}

function Get-TierModelTierFromText {
    <# Tier (0/1/2) found in a name or DN ("Tier 0 Admins", "Tier0Admins"); $null if none (internal helper). #>
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
    $m = [regex]::Match($Text, 'tier\s*([012])(?![0-9])', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($m.Success) { return [int]$m.Groups[1].Value }
    return $null
}

function ConvertTo-TierModelIsoTimestamp {
    <#
    Converts a FILETIME (Int64 / numeric string, as returned for lastLogonTimestamp / pwdLastSet) or a
    DateTime to an ISO-8601 UTC string ("2026-09-24T10:00:00Z"). 0, "never" (Int64.MaxValue) and $null
    become $null (internal helper).
    #>
    param($Value)
    if ($null -eq $Value) { return $null }
    $first = @($Value)
    if ($first.Count -eq 0) { return $null }
    $Value = $first[0]
    if ($null -eq $Value) { return $null }
    if ($Value -is [datetime]) {
        $dt = [datetime]$Value
        if ($dt.Kind -eq [DateTimeKind]::Unspecified) { $dt = [datetime]::SpecifyKind($dt, [DateTimeKind]::Utc) }
        return $dt.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", [System.Globalization.CultureInfo]::InvariantCulture)
    }
    if ($Value -is [datetimeoffset]) {
        return $Value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", [System.Globalization.CultureInfo]::InvariantCulture)
    }
    [long]$fileTime = 0
    if (-not [long]::TryParse([string]$Value, [System.Globalization.NumberStyles]::Integer, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$fileTime)) {
        return $null
    }
    if ($fileTime -le 0 -or $fileTime -eq [long]::MaxValue) { return $null }
    try {
        return [datetime]::FromFileTimeUtc($fileTime).ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", [System.Globalization.CultureInfo]::InvariantCulture)
    } catch {
        return $null
    }
}

function ConvertTo-TierModelSnapshotClass {
    <# Maps an AD objectClass (string or multi-valued list) to the contract's objectClass values (internal helper). #>
    param($ObjectClass)
    $values = @($ObjectClass | Where-Object { $null -ne $_ } | ForEach-Object { [string]$_ })
    if ($values.Count -eq 0) { return 'other' }
    # The most specific class is the last value of the objectClass attribute
    $class = $values[$values.Count - 1]
    switch ($class) {
        'user' { return 'user' }
        'inetOrgPerson' { return 'user' }
        'group' { return 'group' }
        'computer' { return 'computer' }
        'msDS-GroupManagedServiceAccount' { return 'msDS-GroupManagedServiceAccount' }
        'msDS-ManagedServiceAccount' { return 'msDS-ManagedServiceAccount' }
        'foreignSecurityPrincipal' { return 'foreignSecurityPrincipal' }
        default { return 'other' }
    }
}

function ConvertTo-TierModelDnsFromDn {
    <# "CN=x,DC=child,DC=contoso,DC=com" -> "child.contoso.com" (internal helper). #>
    param([string]$DistinguishedName)
    $parts = @([regex]::Matches($DistinguishedName, '(?i)(?:^|,)DC=([^,]+)') | ForEach-Object { $_.Groups[1].Value })
    return ($parts -join '.')
}

function ConvertTo-TierModelDnFromDns {
    <# "contoso.com" -> "DC=contoso,DC=com" (internal helper). #>
    param([string]$DnsName)
    return (@($DnsName.Split('.') | Where-Object { $_ } | ForEach-Object { "DC=$_" }) -join ',')
}

function Add-TierModelSnapshotError {
    <# Records a partial failure (internal helper). #>
    param($Context, [string]$Message)
    $Context.Errors.Add($Message)
    Write-Verbose "Privileged snapshot: $Message"
}

function Get-TierModelSnapshotServer {
    <# Picks the DC for a DN: preferred DC for the own domain, forest root DC for the root, else the DNS domain name (internal helper). #>
    param($Context, [string]$DistinguishedName)
    $dns = ConvertTo-TierModelDnsFromDn $DistinguishedName
    if ([string]::IsNullOrWhiteSpace($dns) -or $dns -ieq $Context.DomainDns) { return $Context.Server }
    if ($dns -ieq $Context.RootDns -and $Context.RootServer) { return $Context.RootServer }
    return $dns
}

function ConvertTo-TierModelSnapshotRecord {
    <# Normalizes an AD object into the internal record used by the snapshot and caches it by DN and SID (internal helper). #>
    param($Context, $AdObject)
    if ($null -eq $AdObject) { return $null }

    $dn = [string](Get-TierModelSnapshotValue $AdObject 'DistinguishedName')
    $sid = Get-TierModelSidString (Get-TierModelSnapshotValue $AdObject 'objectSid')
    if (-not $sid) { $sid = Get-TierModelSidString (Get-TierModelSnapshotValue $AdObject 'SID') }
    $class = ConvertTo-TierModelSnapshotClass (Get-TierModelSnapshotValue $AdObject 'ObjectClass')
    $rawClass = @(Get-TierModelSnapshotValue $AdObject 'ObjectClass') | Select-Object -Last 1
    $name = [string](Get-TierModelSnapshotValue $AdObject 'Name')
    $sam = Get-TierModelSnapshotValue $AdObject 'sAMAccountName'
    if ($null -ne $sam) { $sam = [string]$sam }

    if ($class -eq 'foreignSecurityPrincipal') {
        # FSP objects are named after the SID of the foreign principal
        if (-not $sid -and $name -match '^S-\d+-\d+(-\d+)*$') { $sid = $name }
        $translated = Resolve-TierModelSnapshotSidName -Sid $sid
        if ($translated) { $name = $translated }
    }

    $uacRaw = Get-TierModelSnapshotValue $AdObject 'userAccountControl'
    $uac = $null
    if ($null -ne $uacRaw -and "$uacRaw" -ne '') { $uac = [long](@($uacRaw)[0]) }
    $adminCountRaw = Get-TierModelSnapshotValue $AdObject 'adminCount'
    $adminCount = $null
    if ($null -ne $adminCountRaw -and "$adminCountRaw" -ne '') { $adminCount = [int](@($adminCountRaw)[0]) }

    $record = [PSCustomObject]@{
        Dn          = $dn
        Sid         = $sid
        Sam         = $sam
        Name        = $name
        Class       = $class
        RawClass    = [string]$rawClass
        Uac         = $uac
        LastLogon   = ConvertTo-TierModelIsoTimestamp (Get-TierModelSnapshotValue $AdObject 'lastLogonTimestamp')
        PwdLastSet  = ConvertTo-TierModelIsoTimestamp (Get-TierModelSnapshotValue $AdObject 'pwdLastSet')
        AdminCount  = $adminCount
        Spns        = @(@(Get-TierModelSnapshotValue $AdObject 'servicePrincipalName') | Where-Object { $null -ne $_ -and "$_" -ne '' } | ForEach-Object { [string]$_ })
        MemberDns   = @(@(Get-TierModelSnapshotValue $AdObject 'member') | Where-Object { $null -ne $_ -and "$_" -ne '' } | ForEach-Object { [string]$_ })
    }
    if ($dn) { $Context.ObjectCache[$dn.ToLowerInvariant()] = $record }
    if ($sid) { $Context.SidCache[$sid] = $record }
    return $record
}

function Resolve-TierModelSnapshotSidName {
    <# Best-effort SID -> "DOMAIN\name" translation (well-known table first, then the Windows security API) (internal helper). #>
    param([string]$Sid)
    if ([string]::IsNullOrWhiteSpace($Sid)) { return $null }
    foreach ($entry in @(Get-TierModelWellKnownPrincipal)) {
        if ($entry.Sid -and $entry.Sid -eq $Sid) {
            $alias = @($entry.Aliases | Where-Object { $_ }) | Select-Object -First 1
            if ($alias) { return [string]$alias }
            return [string]$entry.Name
        }
    }
    try {
        $sidObject = New-Object System.Security.Principal.SecurityIdentifier($Sid)
        return $sidObject.Translate([System.Security.Principal.NTAccount]).Value
    } catch {
        return $null
    }
}

function Get-TierModelSnapshotObject {
    <# Reads (cached) one object by DN with all snapshot attributes; $null + errors entry on failure (internal helper). #>
    param($Context, [string]$DistinguishedName)
    if ([string]::IsNullOrWhiteSpace($DistinguishedName)) { return $null }
    $key = $DistinguishedName.ToLowerInvariant()
    if ($Context.ObjectCache.ContainsKey($key)) { return $Context.ObjectCache[$key] }
    $server = Get-TierModelSnapshotServer -Context $Context -DistinguishedName $DistinguishedName
    try {
        $obj = Get-ADObject -Identity $DistinguishedName -Server $server -Properties $script:TierModelSnapshotProperties -ErrorAction Stop
    } catch {
        Add-TierModelSnapshotError -Context $Context -Message "Could not read '$DistinguishedName' on '$server': $($_.Exception.Message)"
        $Context.ObjectCache[$key] = $null
        return $null
    }
    if ($null -eq $obj) {
        $Context.ObjectCache[$key] = $null
        return $null
    }
    return (ConvertTo-TierModelSnapshotRecord -Context $Context -AdObject $obj)
}

function Get-TierModelSnapshotDirectMemberDns {
    <#
    Direct member DNs of a group: the member attribute plus accounts whose primaryGroupID points to the group
    (e.g. domain controllers in "Domain Controllers"). The primaryGroupID lookup runs only for built-in groups
    of the own domain (RID < 1000) except Domain Users/Guests/Computers (internal helper).
    #>
    param($Context, $GroupRecord)
    $key = if ($GroupRecord.Dn) { $GroupRecord.Dn.ToLowerInvariant() } else { [string]$GroupRecord.Sid }
    if ($Context.DirectMemberCache.ContainsKey($key)) { return $Context.DirectMemberCache[$key] }

    $dns = New-Object System.Collections.Generic.List[string]
    foreach ($m in @($GroupRecord.MemberDns)) { $dns.Add($m) }

    $sid = [string]$GroupRecord.Sid
    if ($sid -and $Context.DomainSid -and $sid.StartsWith("$($Context.DomainSid)-")) {
        $rid = 0
        [void][int]::TryParse($sid.Substring($Context.DomainSid.Length + 1), [ref]$rid)
        if ($rid -gt 0 -and $rid -lt 1000 -and $rid -notin @(513, 514, 515)) {
            try {
                $primary = @(Get-ADObject -LDAPFilter "(primaryGroupID=$rid)" -SearchBase $Context.DomainDn -Server $Context.Server -Properties $script:TierModelSnapshotProperties -ErrorAction Stop)
                foreach ($p in $primary) {
                    if ($null -eq $p) { continue }
                    $rec = ConvertTo-TierModelSnapshotRecord -Context $Context -AdObject $p
                    if ($rec -and $rec.Dn -and -not ($dns -contains $rec.Dn)) { $dns.Add($rec.Dn) }
                }
            } catch {
                Add-TierModelSnapshotError -Context $Context -Message "Could not read primary group members of '$($GroupRecord.Name)': $($_.Exception.Message)"
            }
        }
    }
    $result = $dns.ToArray()
    $Context.DirectMemberCache[$key] = $result
    return $result
}

function Get-TierModelSnapshotRecursiveMember {
    <#
    Recursive members of a group (breadth-first, so the shortest nesting path wins), deduplicated by SID
    (DN when no SID), protected against cycles. Returns objects { Record; Direct; Via } where Via lists the
    names of the nested groups, outermost first (internal helper).
    #>
    param($Context, $GroupRecord)
    $cacheKey = if ($GroupRecord.Dn) { $GroupRecord.Dn.ToLowerInvariant() } else { [string]$GroupRecord.Sid }
    if ($Context.RecursiveCache.ContainsKey($cacheKey)) { return $Context.RecursiveCache[$cacheKey] }

    $results = New-Object System.Collections.Generic.List[object]
    $seen = @{}
    $expanded = @{}
    $rootKey = if ($GroupRecord.Sid) { [string]$GroupRecord.Sid } else { $GroupRecord.Dn.ToLowerInvariant() }
    $seen[$rootKey] = $true
    if ($GroupRecord.Dn) { $expanded[$GroupRecord.Dn.ToLowerInvariant()] = $true }

    $queue = New-Object System.Collections.Generic.Queue[object]
    foreach ($dn in @(Get-TierModelSnapshotDirectMemberDns -Context $Context -GroupRecord $GroupRecord)) {
        $queue.Enqueue([PSCustomObject]@{ Dn = $dn; Via = @() })
    }

    while ($queue.Count -gt 0) {
        $item = $queue.Dequeue()
        $rec = Get-TierModelSnapshotObject -Context $Context -DistinguishedName $item.Dn
        if ($null -eq $rec) { continue }
        $key = if ($rec.Sid) { [string]$rec.Sid } else { $rec.Dn.ToLowerInvariant() }
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = $true
        $via = @($item.Via)
        $results.Add([PSCustomObject]@{ Record = $rec; Direct = ($via.Count -eq 0); Via = $via })

        if ($rec.Class -eq 'group' -and $rec.Dn -and -not $expanded.ContainsKey($rec.Dn.ToLowerInvariant())) {
            $expanded[$rec.Dn.ToLowerInvariant()] = $true
            $childVia = @($via + @($rec.Name))
            foreach ($childDn in @(Get-TierModelSnapshotDirectMemberDns -Context $Context -GroupRecord $rec)) {
                $queue.Enqueue([PSCustomObject]@{ Dn = $childDn; Via = $childVia })
            }
        }
    }

    $array = $results.ToArray()
    $Context.RecursiveCache[$cacheKey] = $array
    return $array
}

function Test-TierModelSnapshotAccountClass {
    <# $true for users, computers and (group/delegated) managed service accounts (internal helper). #>
    param($Record)
    if ($null -eq $Record) { return $false }
    if ($Record.Class -in @('user', 'computer', 'msDS-GroupManagedServiceAccount', 'msDS-ManagedServiceAccount')) { return $true }
    return ($Record.RawClass -eq 'msDS-DelegatedManagedServiceAccount')
}

function Get-TierModelAceRight {
    <#
    .SYNOPSIS
    Maps an ActiveDirectoryRights value plus ObjectType GUID to the dangerous rights reported by the snapshot.

    .DESCRIPTION
    Returns a subset of GenericAll, GenericWrite, WriteDacl, WriteOwner, AllExtendedRights, WriteMember,
    ResetPassword, WriteProperty. Read-only rights and extended rights / properties other than the ones below
    return an empty array:
    - WriteMember   = WriteProperty (or the Self validated write) on member bf9679c0-... or the Group-Membership property set
    - ResetPassword = ExtendedRight 00299570-...
    - AllExtendedRights = ExtendedRight with an empty GUID
    - WriteProperty = WriteProperty with an empty GUID (all properties) or on msDS-KeyCredentialLink
    #>
    [CmdletBinding()]
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)]
        $Rights,

        [AllowNull()]
        [AllowEmptyString()]
        [string]$ObjectType
    )

    $value = [long]([System.DirectoryServices.ActiveDirectoryRights]$Rights)
    $guid = if ([string]::IsNullOrWhiteSpace($ObjectType) -or $ObjectType -eq [guid]::Empty.ToString()) { '' } else { $ObjectType.ToLowerInvariant() }

    $genericAll = 0xF01FF
    $genericWrite = 0x20028
    if (($value -band $genericAll) -eq $genericAll) { return 'GenericAll' }

    $rights = New-Object System.Collections.Generic.List[string]
    $isGenericWrite = ($guid -eq '' -and ($value -band $genericWrite) -eq $genericWrite)
    if ($isGenericWrite) { $rights.Add('GenericWrite') }
    if ($value -band 0x40000) { $rights.Add('WriteDacl') }
    if ($value -band 0x80000) { $rights.Add('WriteOwner') }
    if ($value -band 0x100) {
        if ($guid -eq '') { $rights.Add('AllExtendedRights') }
        elseif ($guid -eq $script:TierModelGuidResetPassword) { $rights.Add('ResetPassword') }
    }
    if (-not $isGenericWrite -and ($value -band 0x20)) {
        if ($guid -eq '' -or $guid -eq $script:TierModelGuidKeyCredentialLink) { $rights.Add('WriteProperty') }
        elseif ($guid -in @($script:TierModelGuidMember, $script:TierModelGuidGroupMembershipSet)) { $rights.Add('WriteMember') }
    }
    if (-not $isGenericWrite -and ($value -band 0x8) -and ($guid -eq '' -or $guid -eq $script:TierModelGuidMember)) {
        if (-not $rights.Contains('WriteMember')) { $rights.Add('WriteMember') }
    }
    # Unrolled output: callers wrap the result in @() (an empty result yields an empty array)
    return $rights.ToArray()
}

function Get-TierModelSnapshotSecurity {
    <#
    Reads owner and access rules of an object (nTSecurityDescriptor via Get-ADObject on the chosen DC) and
    returns { Owner; Rules[] { Sid; Rights; Deny; ObjectType; Inherited } } (internal helper).
    #>
    param($Context, [string]$DistinguishedName)
    $server = Get-TierModelSnapshotServer -Context $Context -DistinguishedName $DistinguishedName
    $obj = Get-ADObject -Identity $DistinguishedName -Server $server -Properties @('nTSecurityDescriptor', 'gPLink', 'displayName', 'name') -ErrorAction Stop
    if ($null -eq $obj) { throw "Object '$DistinguishedName' not found." }
    $sd = Get-TierModelSnapshotValue $obj 'nTSecurityDescriptor'
    if ($null -eq $sd) { throw "No security descriptor returned for '$DistinguishedName'." }

    $sidType = [System.Security.Principal.SecurityIdentifier]
    $owner = Get-TierModelSidString ($sd.GetOwner($sidType))
    $rules = New-Object System.Collections.Generic.List[object]
    foreach ($rule in @($sd.GetAccessRules($true, $true, $sidType))) {
        if ($null -eq $rule) { continue }
        $objectType = Get-TierModelSnapshotValue $rule 'ObjectType'
        $rules.Add([PSCustomObject]@{
            Sid        = Get-TierModelSidString (Get-TierModelSnapshotValue $rule 'IdentityReference')
            Rights     = Get-TierModelSnapshotValue $rule 'ActiveDirectoryRights'
            Deny       = ([string](Get-TierModelSnapshotValue $rule 'AccessControlType') -eq 'Deny')
            ObjectType = if ($null -eq $objectType) { '' } else { ([string]$objectType).ToLowerInvariant() }
            Inherited  = [bool](Get-TierModelSnapshotValue $rule 'IsInherited')
        })
    }
    return [PSCustomObject]@{
        Owner       = $owner
        Rules       = $rules.ToArray()
        GpLink      = [string](Get-TierModelSnapshotValue $obj 'gPLink')
        DisplayName = [string](Get-TierModelSnapshotValue $obj 'displayName')
        Name        = [string](Get-TierModelSnapshotValue $obj 'name')
    }
}

function Get-TierModelGpLinkDn {
    <# Extracts the GPO DNs (CN={GUID},CN=Policies,CN=System,...) from a gPLink value (internal helper). #>
    param([string]$GpLink)
    if ([string]::IsNullOrWhiteSpace($GpLink)) { return }
    $dns = @([regex]::Matches($GpLink, '(?i)\[LDAP://([^;\]]+);\d+\]') | ForEach-Object { $_.Groups[1].Value })
    return $dns
}

function Resolve-TierModelSnapshotPrincipal {
    <# Resolves an ACE principal SID to name, class and (for groups) recursive member count / samples; cached (internal helper). #>
    param($Context, [string]$Sid)
    if ($Context.PrincipalCache.ContainsKey($Sid)) { return $Context.PrincipalCache[$Sid] }

    $result = [PSCustomObject]@{ Name = $Sid; Class = 'other'; MemberCount = $null; SampleMembers = @() }
    $prefix = $null
    $server = $null
    if ($Sid -like 'S-1-5-32-*') { $prefix = 'BUILTIN'; $server = $Context.Server }
    elseif ($Context.DomainSid -and $Sid.StartsWith("$($Context.DomainSid)-")) { $prefix = $Context.NetBios; $server = $Context.Server }
    elseif ($Context.RootSid -and $Context.RootServer -and $Sid.StartsWith("$($Context.RootSid)-")) { $prefix = $Context.RootNetBios; $server = $Context.RootServer }

    $record = $null
    if ($server) {
        if ($Context.SidCache.ContainsKey($Sid) -and $Context.SidCache[$Sid]) {
            $record = $Context.SidCache[$Sid]
        } else {
            try {
                $found = @(Get-ADObject -LDAPFilter "(objectSid=$Sid)" -Server $server -Properties $script:TierModelSnapshotProperties -ErrorAction Stop) | Where-Object { $null -ne $_ } | Select-Object -First 1
                if ($found) { $record = ConvertTo-TierModelSnapshotRecord -Context $Context -AdObject $found }
            } catch {
                Add-TierModelSnapshotError -Context $Context -Message "Could not resolve principal '$Sid': $($_.Exception.Message)"
            }
        }
    }

    if ($record) {
        $short = if ($record.Sam) { $record.Sam } else { $record.Name }
        $result.Name = if ($prefix) { "$prefix\$short" } else { $short }
        $result.Class = $record.Class
        if ($record.Class -eq 'group') {
            $members = @(Get-TierModelSnapshotRecursiveMember -Context $Context -GroupRecord $record | Where-Object { $_.Record.Class -ne 'group' })
            $result.MemberCount = $members.Count
            $result.SampleMembers = @($members | Select-Object -First 10 | ForEach-Object { if ($_.Record.Sam) { $_.Record.Sam } else { $_.Record.Name } })
        }
    } else {
        $translated = Resolve-TierModelSnapshotSidName -Sid $Sid
        if ($translated) { $result.Name = $translated }
    }
    $Context.PrincipalCache[$Sid] = $result
    return $result
}

function Get-TierModelSnapshotAclFinding {
    <# Evaluates one Tier 0 object's owner and DACL against the exclusion list and adds findings (internal helper). #>
    param($Context, [string]$DistinguishedName, [string]$ObjectType, [string]$ObjectName, $Security, $Findings)

    $index = @{}
    $addFinding = {
        param([string]$PrincipalSid, [string[]]$Rights, [string]$Guid, [bool]$Inherited)
        $key = "$PrincipalSid|$Guid|$Inherited"
        if ($index.ContainsKey($key)) {
            $existing = $index[$key]
            foreach ($r in $Rights) { if ($existing['rights'] -notcontains $r) { $existing['rights'] = @($existing['rights'] + $r) } }
            return
        }
        $principal = Resolve-TierModelSnapshotPrincipal -Context $Context -Sid $PrincipalSid
        $finding = [ordered]@{
            objectDn       = $DistinguishedName
            objectType     = $ObjectType
            objectName     = $ObjectName
            principalSid   = $PrincipalSid
            principalName  = $principal.Name
            principalClass = $principal.Class
            rights         = @($Rights)
            objectTypeGuid = if ($Guid) { $Guid } else { $null }
            inherited      = $Inherited
            memberCount    = $principal.MemberCount
            sampleMembers  = @($principal.SampleMembers)
        }
        $index[$key] = $finding
        $Findings.Add($finding)
    }

    if ($Security.Owner -and -not $Context.ExcludedSids.ContainsKey($Security.Owner)) {
        & $addFinding $Security.Owner @('Owner') '' $false
    }

    foreach ($rule in @($Security.Rules)) {
        if ($rule.Deny -or -not $rule.Sid) { continue }
        if ($Context.ExcludedSids.ContainsKey($rule.Sid)) { continue }
        if ($Context.KeyAdminSids.ContainsKey($rule.Sid) -and $rule.ObjectType -eq $script:TierModelGuidKeyCredentialLink) { continue }
        $rights = @(Get-TierModelAceRight -Rights $rule.Rights -ObjectType $rule.ObjectType)
        if ($rights.Count -eq 0) { continue }
        $guid = if ($rule.ObjectType -and $rule.ObjectType -ne [guid]::Empty.ToString()) { $rule.ObjectType } else { '' }
        & $addFinding $rule.Sid $rights $guid ([bool]$rule.Inherited)
    }
}

function Get-TierModelPrivilegedSnapshot {
    <#
    .SYNOPSIS
    Takes a read-only snapshot of privileged access in the domain (Tier 0 membership, account hygiene, ACL paths).

    .DESCRIPTION
    Builds the "privileged access snapshot" consumed by the TierModel service:
    - groups: the protected built-in groups (resolved by SID, so localized names work; forest-wide groups are
      read from a forest root DC in child domains) plus every Tier 0 group of the configuration, each with
      recursive, SID-deduplicated members (direct flag and nesting path).
    - accounts: every user/computer/managed service account in those groups plus every account in a
      configured Tier 0/Tier 1 account OU, with lastLogonTimestamp, pwdLastSet, UAC flags, adminCount, SPNs
      and Protected Users membership.
    - adminCountOrphans: objects with adminCount=1 that are no longer in any protected built-in group.
    - aclFindings: dangerous owner/ACEs on Tier 0 objects held by principals that are not Tier 0.
    - errors: partial failures; every AD call is wrapped so one unreadable object never aborts the snapshot.

    Only the domain itself must be readable; if Get-ADDomain fails the function throws.

    .PARAMETER DomainController
    Domain controller used for every query of the own domain.

    .PARAMETER Config
    Configuration object from Get-TierModelConfig. When omitted, it is loaded from -ConfigPath (or the
    default config directory); a load failure is recorded in errors and the snapshot continues.

    .PARAMETER ConfigPath
    Configuration directory passed to Get-TierModelConfig when -Config is not given.

    .PARAMETER ShowProgress
    Writes short progress lines to the host.

    .OUTPUTS
    Ordered dictionary following the snapshot contract (metadata, groups, accounts, adminCountOrphans,
    aclFindings, errors); write it with Export-TierModelPrivilegedSnapshot.

    .EXAMPLE
    $snapshot = Get-TierModelPrivilegedSnapshot -DomainController dc01.contoso.com
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$DomainController,

        [Parameter()]
        $Config,

        [Parameter()]
        [string]$ConfigPath,

        [switch]$ShowProgress
    )

    $progress = { param([string]$Text) if ($ShowProgress) { Write-Host $Text } else { Write-Verbose $Text } }

    # --- Domain / forest -------------------------------------------------------------------------------
    $domain = Get-ADDomain -Server $DomainController -ErrorAction Stop
    if ($null -eq $domain) { throw "Domain information could not be read via '$DomainController'." }
    $domainDns = [string](Get-TierModelSnapshotValue $domain 'DNSRoot')
    $domainDn = [string](Get-TierModelSnapshotValue $domain 'DistinguishedName')
    if (-not $domainDn) { $domainDn = ConvertTo-TierModelDnFromDns $domainDns }
    $domainSid = Get-TierModelSidString (Get-TierModelSnapshotValue $domain 'DomainSID')
    if (-not $domainSid) { throw "The domain SID could not be read via '$DomainController'." }

    $ctx = [PSCustomObject]@{
        Server            = $DomainController
        DomainDns         = $domainDns
        DomainDn          = $domainDn
        DomainSid         = $domainSid
        NetBios           = [string](Get-TierModelSnapshotValue $domain 'NetBIOSName')
        RootDns           = $domainDns
        RootSid           = $domainSid
        RootServer        = $DomainController
        RootNetBios       = [string](Get-TierModelSnapshotValue $domain 'NetBIOSName')
        IsForestRoot      = $true
        Errors            = New-Object System.Collections.Generic.List[string]
        ObjectCache       = @{}
        SidCache          = @{}
        DirectMemberCache = @{}
        RecursiveCache    = @{}
        PrincipalCache    = @{}
        ExcludedSids      = @{}
        KeyAdminSids      = @{}
    }
    if (-not $ctx.NetBios) { $ctx.NetBios = ($domainDns -split '\.')[0].ToUpperInvariant(); $ctx.RootNetBios = $ctx.NetBios }

    & $progress "Domain: $domainDns ($domainSid) via $DomainController"

    $rootAvailable = $true
    try {
        $root = Get-TierModelForestRootDomain -DomainController $DomainController
        $ctx.RootDns = [string]$root.DnsRoot
        $ctx.RootSid = [string]$root.DomainSid
        $ctx.IsForestRoot = [bool]$root.IsCurrentDomain
        if (-not $ctx.IsForestRoot) {
            $ctx.RootServer = $null
            try {
                $rootDc = Get-ADDomainController -Discover -DomainName $ctx.RootDns -ErrorAction Stop
                $ctx.RootServer = [string](@(Get-TierModelSnapshotValue $rootDc 'HostName')[0])
            } catch {
                Add-TierModelSnapshotError -Context $ctx -Message "Could not discover a domain controller of the forest root domain '$($ctx.RootDns)', using the domain name instead: $($_.Exception.Message)"
            }
            if (-not $ctx.RootServer) { $ctx.RootServer = $ctx.RootDns }
            try {
                $rootDomain = Get-ADDomain -Identity $ctx.RootDns -Server $ctx.RootServer -ErrorAction Stop
                $rootNetBios = [string](Get-TierModelSnapshotValue $rootDomain 'NetBIOSName')
                $ctx.RootNetBios = if ($rootNetBios) { $rootNetBios } else { ($ctx.RootDns -split '\.')[0].ToUpperInvariant() }
            } catch {
                $ctx.RootNetBios = ($ctx.RootDns -split '\.')[0].ToUpperInvariant()
                Add-TierModelSnapshotError -Context $ctx -Message "Could not read the forest root domain '$($ctx.RootDns)' on '$($ctx.RootServer)': $($_.Exception.Message)"
            }
            & $progress "Child domain: forest-wide groups are read from $($ctx.RootServer) ($($ctx.RootDns))"
        }
    } catch {
        $rootAvailable = $false
        Add-TierModelSnapshotError -Context $ctx -Message "Could not determine the forest root domain; forest-wide groups (Enterprise Admins, Schema Admins, Enterprise Key Admins, Enterprise Read-only Domain Controllers) are skipped: $($_.Exception.Message)"
    }

    # --- Configuration --------------------------------------------------------------------------------
    if ($null -eq $Config) {
        try {
            $Config = if ($ConfigPath) { Get-TierModelConfig -ConfigPath $ConfigPath } else { Get-TierModelConfig }
        } catch {
            Add-TierModelSnapshotError -Context $ctx -Message "Could not load the configuration, Tier 0 groups and OUs from the configuration are skipped: $($_.Exception.Message)"
            $Config = $null
        }
    }
    $configGroups = @(Get-TierModelSnapshotValue $Config 'groups' | Where-Object { $null -ne $_ })
    $configOus = @(Get-TierModelSnapshotValue $Config 'organizationUnits' | Where-Object { $null -ne $_ })

    # --- Protected and Tier 0 groups ------------------------------------------------------------------
    & $progress 'Reading protected and Tier 0 groups...'
    $groupProperties = @('objectSid', 'sAMAccountName', 'name', 'objectClass', 'distinguishedName', 'member')
    $groupDefs = New-Object System.Collections.Generic.List[object]
    $groupSids = @{}

    foreach ($wellKnownName in $script:TierModelProtectedGroupNames) {
        $entry = Get-TierModelWellKnownPrincipal -Name $wellKnownName
        if (-not $entry) { continue }
        if ($entry.ForestRoot -and -not $rootAvailable) { continue }
        try {
            $sid = Resolve-TierModelWellKnownPrincipalSid -Name $wellKnownName -DomainController $DomainController
        } catch {
            Add-TierModelSnapshotError -Context $ctx -Message "Could not resolve the SID of '$wellKnownName': $($_.Exception.Message)"
            continue
        }
        $server = if ($entry.ForestRoot) { $ctx.RootServer } else { $DomainController }
        try {
            $adGroup = Get-ADGroup -Identity $sid -Server $server -Properties $groupProperties -ErrorAction Stop
        } catch {
            Add-TierModelSnapshotError -Context $ctx -Message "Could not read protected group '$wellKnownName' ($sid) on '$server': $($_.Exception.Message)"
            continue
        }
        if ($null -eq $adGroup) { continue }
        $rec = ConvertTo-TierModelSnapshotRecord -Context $ctx -AdObject $adGroup
        if (-not $rec.Sid) { $rec.Sid = $sid; $ctx.SidCache[$sid] = $rec }
        $groupDefs.Add([PSCustomObject]@{ Record = $rec; WellKnownName = $wellKnownName; DisplayName = $wellKnownName; Source = 'builtin' })
        $groupSids[$rec.Sid] = $true
    }

    # DnsAdmins has no fixed RID: looked up by name in the own domain, silently skipped when DNS is not AD-integrated
    try {
        $dnsAdmins = @(Get-ADGroup -Filter "sAMAccountName -eq 'DnsAdmins'" -Server $DomainController -Properties $groupProperties -ErrorAction Stop) | Where-Object { $null -ne $_ } | Select-Object -First 1
        if ($dnsAdmins) {
            $rec = ConvertTo-TierModelSnapshotRecord -Context $ctx -AdObject $dnsAdmins
            if ($rec.Sid -and -not $groupSids.ContainsKey($rec.Sid)) {
                $groupDefs.Add([PSCustomObject]@{ Record = $rec; WellKnownName = 'DnsAdmins'; DisplayName = 'DnsAdmins'; Source = 'builtin' })
                $groupSids[$rec.Sid] = $true
            }
        } else {
            Write-Verbose 'DnsAdmins not found (DNS not AD-integrated?) - skipped.'
        }
    } catch {
        Add-TierModelSnapshotError -Context $ctx -Message "Could not read DnsAdmins: $($_.Exception.Message)"
    }

    $configTier0Sids = @{}
    foreach ($cg in $configGroups) {
        $cgName = [string](Get-TierModelSnapshotValue $cg 'name')
        $cgSam = [string](Get-TierModelSnapshotValue $cg 'samaccountname')
        $cgPath = [string](Get-TierModelSnapshotValue $cg 'path')
        $tier = Get-TierModelTierFromText $cgName
        if ($null -eq $tier) { $tier = Get-TierModelTierFromText $cgSam }
        if ($null -eq $tier) { $tier = Get-TierModelTierFromText $cgPath }
        if ($tier -ne 0) { continue }
        $lookup = if ($cgSam) { $cgSam } else { $cgName }
        try {
            $escaped = $lookup -replace "'", "''"
            $adGroup = @(Get-ADGroup -Filter "sAMAccountName -eq '$escaped'" -Server $DomainController -Properties $groupProperties -ErrorAction Stop) | Where-Object { $null -ne $_ } | Select-Object -First 1
        } catch {
            Add-TierModelSnapshotError -Context $ctx -Message "Could not read Tier 0 group '$cgName' from the configuration: $($_.Exception.Message)"
            continue
        }
        if (-not $adGroup) {
            Add-TierModelSnapshotError -Context $ctx -Message "Tier 0 group '$cgName' ($lookup) from the configuration was not found."
            continue
        }
        $rec = ConvertTo-TierModelSnapshotRecord -Context $ctx -AdObject $adGroup
        if ($rec.Sid) { $configTier0Sids[$rec.Sid] = $true }
        if ($rec.Sid -and $groupSids.ContainsKey($rec.Sid)) { continue }
        $groupDefs.Add([PSCustomObject]@{ Record = $rec; WellKnownName = $null; DisplayName = $cgName; Source = 'config' })
        if ($rec.Sid) { $groupSids[$rec.Sid] = $true }
    }

    # --- Membership -----------------------------------------------------------------------------------
    & $progress "Expanding membership of $($groupDefs.Count) groups..."
    $groupsOut = New-Object System.Collections.Generic.List[object]
    $accounts = [ordered]@{}
    $protectedMemberSids = @{}

    $addAccount = {
        param($Record, $Tier, [string]$PrivilegedGroup)
        $key = if ($Record.Sid) { [string]$Record.Sid } else { $Record.Dn.ToLowerInvariant() }
        if (-not $accounts.Contains($key)) {
            $accounts[$key] = [PSCustomObject]@{ Record = $Record; Tier = $Tier; Groups = New-Object System.Collections.Generic.List[string] }
        } elseif ($null -ne $Tier -and ($null -eq $accounts[$key].Tier -or $Tier -lt $accounts[$key].Tier)) {
            $accounts[$key].Tier = $Tier
        }
        if ($PrivilegedGroup -and -not $accounts[$key].Groups.Contains($PrivilegedGroup)) { $accounts[$key].Groups.Add($PrivilegedGroup) }
    }

    foreach ($def in $groupDefs) {
        $members = @(Get-TierModelSnapshotRecursiveMember -Context $ctx -GroupRecord $def.Record)
        $membersOut = New-Object System.Collections.Generic.List[object]
        foreach ($m in $members) {
            $r = $m.Record
            $enabled = $null
            if ($r.Class -ne 'group' -and $null -ne $r.Uac) { $enabled = -not [bool]($r.Uac -band 0x2) }
            $membersOut.Add([ordered]@{
                sid               = $r.Sid
                samAccountName    = $r.Sam
                name              = $r.Name
                objectClass       = $r.Class
                distinguishedName = $r.Dn
                direct            = [bool]$m.Direct
                via               = @($m.Via)
                enabled           = $enabled
            })
            if ($def.Source -eq 'builtin' -and $r.Sid) { $protectedMemberSids[$r.Sid] = $true }
            if (Test-TierModelSnapshotAccountClass $r) { & $addAccount $r 0 $def.DisplayName }
        }
        $groupsOut.Add([ordered]@{
            sid               = $def.Record.Sid
            name              = $def.Record.Name
            wellKnownName     = $def.WellKnownName
            source            = $def.Source
            tier              = 0
            distinguishedName = $def.Record.Dn
            members           = $membersOut.ToArray()
        })
    }

    # --- Accounts in Tier 0 / Tier 1 account OUs ------------------------------------------------------
    # Rule: a configured OU whose resolved DN contains Tier 0 or Tier 1 and whose own name contains "Accounts"
    # (covers "Tier 0 Accounts" and "Tier 0 Service Accounts"); the whole subtree is read.
    $tier0OuDns = New-Object System.Collections.Generic.List[string]
    foreach ($ou in $configOus) {
        $ouName = [string](Get-TierModelSnapshotValue $ou 'name')
        if (-not $ouName) { continue }
        $parent = Resolve-TierModelOuPath -OuPath ([string](Get-TierModelSnapshotValue $ou 'path')) -DomainDN $domainDn
        $ouDn = "OU=$ouName,$parent"
        $ouTier = Get-TierModelTierFromText $ouDn
        if ($ouTier -eq 0 -and -not $tier0OuDns.Contains($ouDn)) { $tier0OuDns.Add($ouDn) }
        if ($null -eq $ouTier -or $ouTier -gt 1 -or $ouName -notmatch 'Accounts') { continue }
        try {
            $found = @(Get-ADObject -LDAPFilter '(objectClass=user)' -SearchBase $ouDn -Server $DomainController -Properties $script:TierModelSnapshotProperties -ErrorAction Stop)
        } catch {
            Add-TierModelSnapshotError -Context $ctx -Message "Could not read accounts in '$ouDn': $($_.Exception.Message)"
            continue
        }
        foreach ($obj in $found) {
            if ($null -eq $obj) { continue }
            $rec = ConvertTo-TierModelSnapshotRecord -Context $ctx -AdObject $obj
            if (Test-TierModelSnapshotAccountClass $rec) { & $addAccount $rec $ouTier $null }
        }
    }

    # --- Protected Users ------------------------------------------------------------------------------
    $protectedUsersSids = @{}
    try {
        $pu = Get-ADGroup -Identity "$domainSid-525" -Server $DomainController -Properties $groupProperties -ErrorAction Stop
        if ($pu) {
            $puRec = ConvertTo-TierModelSnapshotRecord -Context $ctx -AdObject $pu
            foreach ($m in @(Get-TierModelSnapshotRecursiveMember -Context $ctx -GroupRecord $puRec)) {
                if ($m.Record.Sid) { $protectedUsersSids[$m.Record.Sid] = $true }
            }
        }
    } catch {
        Add-TierModelSnapshotError -Context $ctx -Message "Could not read Protected Users ($domainSid-525): $($_.Exception.Message)"
    }

    & $progress "Evaluating $($accounts.Count) privileged accounts..."
    $accountsOut = New-Object System.Collections.Generic.List[object]
    foreach ($key in $accounts.Keys) {
        $a = $accounts[$key]
        $r = $a.Record
        $uac = $r.Uac
        $accountsOut.Add([ordered]@{
            sid                   = $r.Sid
            samAccountName        = $r.Sam
            distinguishedName     = $r.Dn
            objectClass           = $r.Class
            tier                  = $a.Tier
            enabled               = if ($null -ne $uac) { -not [bool]($uac -band 0x2) } else { $null }
            lastLogon             = $r.LastLogon
            passwordLastSet       = $r.PwdLastSet
            passwordNeverExpires  = if ($null -ne $uac) { [bool]($uac -band 0x10000) } else { $false }
            accountNotDelegated   = if ($null -ne $uac) { [bool]($uac -band 0x100000) } else { $false }
            protectedUsers        = [bool]($r.Sid -and $protectedUsersSids.ContainsKey($r.Sid))
            adminCount            = $r.AdminCount
            servicePrincipalNames = @($r.Spns)
            memberOfPrivileged    = $a.Groups.ToArray()
        })
    }

    # --- adminCount orphans ---------------------------------------------------------------------------
    # adminCount=1 users/groups that are not a (recursive) member of a protected built-in group; the protected
    # groups themselves, krbtgt, BUILTIN groups and other built-in domain principals (RID < 1000) are skipped.
    & $progress 'Searching adminCount orphans...'
    $orphansOut = New-Object System.Collections.Generic.List[object]
    try {
        $flagged = @(Get-ADObject -LDAPFilter '(&(adminCount=1)(|(objectClass=user)(objectClass=group)))' -SearchBase $domainDn -Server $DomainController -Properties $script:TierModelSnapshotProperties -ErrorAction Stop)
        foreach ($obj in $flagged) {
            if ($null -eq $obj) { continue }
            $rec = ConvertTo-TierModelSnapshotRecord -Context $ctx -AdObject $obj
            if (-not $rec.Sid) { continue }
            if ($protectedMemberSids.ContainsKey($rec.Sid) -or $groupSids.ContainsKey($rec.Sid)) { continue }
            if ($rec.Sid -like 'S-1-5-32-*') { continue }
            if ($rec.Sid.StartsWith("$domainSid-")) {
                $rid = 0
                [void][int]::TryParse($rec.Sid.Substring($domainSid.Length + 1), [ref]$rid)
                if ($rid -gt 0 -and $rid -lt 1000) { continue }
            }
            $orphansOut.Add([ordered]@{
                sid               = $rec.Sid
                samAccountName    = $rec.Sam
                distinguishedName = $rec.Dn
                objectClass       = $rec.Class
            })
        }
    } catch {
        Add-TierModelSnapshotError -Context $ctx -Message "Could not search adminCount=1 objects: $($_.Exception.Message)"
    }

    # --- ACL findings ---------------------------------------------------------------------------------
    & $progress 'Reading ACLs of Tier 0 objects...'
    foreach ($s in @('S-1-5-18', 'S-1-5-32-544', 'S-1-5-9', 'S-1-5-10', 'S-1-3-0', "$domainSid-512", "$domainSid-516")) { $ctx.ExcludedSids[$s] = $true }
    if ($rootAvailable) {
        $ctx.ExcludedSids["$($ctx.RootSid)-519"] = $true
        $ctx.ExcludedSids["$($ctx.RootSid)-518"] = $true
        $ctx.KeyAdminSids["$($ctx.RootSid)-527"] = $true
    }
    $ctx.KeyAdminSids["$domainSid-526"] = $true
    foreach ($s in $configTier0Sids.Keys) { $ctx.ExcludedSids[$s] = $true }

    $targets = New-Object System.Collections.Generic.List[object]
    $targets.Add([PSCustomObject]@{ Dn = $domainDn; Type = 'DomainRoot'; Name = $domainDns; Links = $true })
    $targets.Add([PSCustomObject]@{ Dn = "CN=AdminSDHolder,CN=System,$domainDn"; Type = 'AdminSDHolder'; Name = 'AdminSDHolder'; Links = $false })
    foreach ($def in $groupDefs) {
        if ($def.Source -ne 'builtin' -or -not $def.Record.Dn) { continue }
        $targets.Add([PSCustomObject]@{ Dn = $def.Record.Dn; Type = 'ProtectedGroup'; Name = $def.WellKnownName; Links = $false })
    }
    $dcOu = [string](Get-TierModelSnapshotValue $domain 'DomainControllersContainer')
    if (-not $dcOu) { $dcOu = "OU=Domain Controllers,$domainDn" }
    $targets.Add([PSCustomObject]@{ Dn = $dcOu; Type = 'DomainControllersOU'; Name = 'Domain Controllers'; Links = $true })
    foreach ($ouDn in $tier0OuDns) {
        $ouLabel = ($ouDn -split '(?<!\\),')[0] -replace '^(?i)OU=', ''
        $targets.Add([PSCustomObject]@{ Dn = $ouDn; Type = 'Tier0OU'; Name = $ouLabel; Links = $true })
    }

    $findings = New-Object System.Collections.Generic.List[object]
    $gpoDns = New-Object System.Collections.Generic.List[string]
    foreach ($t in $targets) {
        try {
            $security = Get-TierModelSnapshotSecurity -Context $ctx -DistinguishedName $t.Dn
        } catch {
            Add-TierModelSnapshotError -Context $ctx -Message "Could not read the ACL of $($t.Type) '$($t.Dn)': $($_.Exception.Message)"
            continue
        }
        Get-TierModelSnapshotAclFinding -Context $ctx -DistinguishedName $t.Dn -ObjectType $t.Type -ObjectName $t.Name -Security $security -Findings $findings
        if ($t.Links) {
            foreach ($gpoDn in @(Get-TierModelGpLinkDn $security.GpLink)) {
                if (-not ($gpoDns | Where-Object { $_ -ieq $gpoDn })) { $gpoDns.Add($gpoDn) }
            }
        }
    }
    foreach ($gpoDn in $gpoDns) {
        try {
            $security = Get-TierModelSnapshotSecurity -Context $ctx -DistinguishedName $gpoDn
        } catch {
            Add-TierModelSnapshotError -Context $ctx -Message "Could not read the ACL of linked GPO '$gpoDn': $($_.Exception.Message)"
            continue
        }
        $gpoName = if ($security.DisplayName) { $security.DisplayName } elseif ($security.Name) { $security.Name } else { $gpoDn }
        Get-TierModelSnapshotAclFinding -Context $ctx -DistinguishedName $gpoDn -ObjectType 'Tier0GPO' -ObjectName $gpoName -Security $security -Findings $findings
    }

    & $progress "Snapshot: $($groupsOut.Count) groups, $($accountsOut.Count) accounts, $($orphansOut.Count) adminCount orphans, $($findings.Count) ACL findings, $($ctx.Errors.Count) errors."

    return [ordered]@{
        metadata          = [ordered]@{
            version          = '1'
            preferredDc      = $DomainController
            timestamp        = [datetime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", [System.Globalization.CultureInfo]::InvariantCulture)
            domain           = $domainDns
            domainSid        = $domainSid
            forestRootDomain = if ($rootAvailable) { $ctx.RootDns } else { $null }
            isForestRoot     = if ($rootAvailable) { [bool]$ctx.IsForestRoot } else { $null }
        }
        groups            = $groupsOut.ToArray()
        accounts          = $accountsOut.ToArray()
        adminCountOrphans = $orphansOut.ToArray()
        aclFindings       = $findings.ToArray()
        errors            = $ctx.Errors.ToArray()
    }
}
