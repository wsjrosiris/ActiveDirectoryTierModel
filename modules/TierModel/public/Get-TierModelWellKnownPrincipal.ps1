# TierModel well-known principal table
# Language-independent resolution of built-in users/groups via fixed SIDs / RIDs.
#
# The configuration references built-in principals by their English names (e.g. "Domain Admins").
# On a localized domain those objects carry translated names (e.g. "Domaenen-Admins"), so every lookup
# by name fails. The objects' SIDs are fixed, however: either absolute (BUILTIN S-1-5-32-5xx,
# NT AUTHORITY S-1-5-x) or relative to the domain SID (<domain SID>-<RID>). Enterprise-wide groups
# (Schema Admins, Enterprise Admins, Enterprise Key Admins, Enterprise Read-only Domain Controllers)
# exist only in the forest ROOT domain and are therefore built from the forest root domain SID.

# Module-level caches (keyed by domain controller)
if (-not (Get-Variable -Name TierModelDomainSidCache -Scope Script -ErrorAction SilentlyContinue)) {
    $script:TierModelDomainSidCache = @{}
}
if (-not (Get-Variable -Name TierModelForestRootCache -Scope Script -ErrorAction SilentlyContinue)) {
    $script:TierModelForestRootCache = @{}
}

function Get-TierModelWellKnownPrincipalTable {
    <#
    .SYNOPSIS
    Returns the raw well-known principal table (internal helper).
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject[]])]
    param()

    if ((Get-Variable -Name TierModelWellKnownTable -Scope Script -ErrorAction SilentlyContinue) -and $script:TierModelWellKnownTable) {
        return $script:TierModelWellKnownTable
    }

    $entries = New-Object System.Collections.Generic.List[object]

    function ConvertTo-WellKnownEntry {
        param([string]$Name, [string]$Kind, [string]$Sid, $Rid, [bool]$ForestRoot, [string]$ObjectClass, [string[]]$Aliases)
        [PSCustomObject]@{
            Name        = $Name
            Kind        = $Kind          # DomainRelative | Builtin | NtAuthority | WellKnown
            Sid         = $Sid           # absolute SID (Builtin/NtAuthority/WellKnown) or $null
            Rid         = $Rid           # domain RID (DomainRelative) or $null
            ForestRoot  = $ForestRoot    # $true: RID is relative to the forest ROOT domain SID
            ObjectClass = $ObjectClass   # group | user | wellKnown
            Aliases     = @($Aliases)
        }
    }

    # Domain-relative principals (<domain SID>-<RID>)
    $domainRids = @(
        ,@('Administrator', 500, $false, 'user')
        ,@('Guest', 501, $false, 'user')
        ,@('krbtgt', 502, $false, 'user')
        ,@('Domain Admins', 512, $false, 'group')
        ,@('Domain Users', 513, $false, 'group')
        ,@('Domain Guests', 514, $false, 'group')
        ,@('Domain Computers', 515, $false, 'group')
        ,@('Domain Controllers', 516, $false, 'group')
        ,@('Cert Publishers', 517, $false, 'group')
        ,@('Schema Admins', 518, $true, 'group')
        ,@('Enterprise Admins', 519, $true, 'group')
        ,@('Group Policy Creator Owners', 520, $false, 'group')
        ,@('Read-only Domain Controllers', 521, $false, 'group')
        ,@('Cloneable Domain Controllers', 522, $false, 'group')
        ,@('Protected Users', 525, $false, 'group')
        ,@('Key Admins', 526, $false, 'group')
        ,@('Enterprise Key Admins', 527, $true, 'group')
        ,@('Enterprise Read-only Domain Controllers', 498, $true, 'group')
        ,@('RAS and IAS Servers', 553, $false, 'group')
        ,@('Allowed RODC Password Replication Group', 571, $false, 'group')
        ,@('Denied RODC Password Replication Group', 572, $false, 'group')
    )
    foreach ($d in $domainRids) {
        $entries.Add((ConvertTo-WellKnownEntry -Name $d[0] -Kind 'DomainRelative' -Sid $null -Rid ([int]$d[1]) -ForestRoot $d[2] -ObjectClass $d[3] -Aliases @()))
    }

    # BUILTIN groups (S-1-5-32-5xx) - identical in every domain
    $builtin = @(
        @('Administrators', 544), @('Users', 545), @('Guests', 546), @('Power Users', 547),
        @('Account Operators', 548), @('Server Operators', 549), @('Print Operators', 550),
        @('Backup Operators', 551), @('Replicator', 552), @('Pre-Windows 2000 Compatible Access', 554),
        @('Remote Desktop Users', 555), @('Network Configuration Operators', 556),
        @('Incoming Forest Trust Builders', 557), @('Performance Monitor Users', 558),
        @('Performance Log Users', 559), @('Windows Authorization Access Group', 560),
        @('Terminal Server License Servers', 561), @('Distributed COM Users', 562),
        @('IIS_IUSRS', 568), @('Cryptographic Operators', 569), @('Event Log Readers', 573),
        @('Certificate Service DCOM Access', 574), @('RDS Remote Access Servers', 575),
        @('RDS Endpoint Servers', 576), @('RDS Management Servers', 577),
        @('Hyper-V Administrators', 578), @('Access Control Assistance Operators', 579),
        @('Remote Management Users', 580), @('Storage Replica Administrators', 582)
    )
    foreach ($b in $builtin) {
        $entries.Add((ConvertTo-WellKnownEntry -Name $b[0] -Kind 'Builtin' -Sid "S-1-5-32-$($b[1])" -Rid $null -ForestRoot $false -ObjectClass 'group' -Aliases @("BUILTIN\$($b[0])")))
    }

    # NT AUTHORITY principals
    $ntAuthority = @(
        @('SYSTEM', 'S-1-5-18'), @('LOCAL SERVICE', 'S-1-5-19'), @('NETWORK SERVICE', 'S-1-5-20'),
        @('Authenticated Users', 'S-1-5-11'), @('ANONYMOUS LOGON', 'S-1-5-7'), @('BATCH', 'S-1-5-3'),
        @('INTERACTIVE', 'S-1-5-4'), @('SERVICE', 'S-1-5-6'), @('DIALUP', 'S-1-5-1'), @('NETWORK', 'S-1-5-2'),
        @('TERMINAL SERVER USER', 'S-1-5-13'), @('REMOTE INTERACTIVE LOGON', 'S-1-5-14'),
        @('Local account', 'S-1-5-113'), @('Local account and member of Administrators group', 'S-1-5-114'),
        @('SELF', 'S-1-5-10'), @('ENTERPRISE DOMAIN CONTROLLERS', 'S-1-5-9'), @('IUSR', 'S-1-5-17')
    )
    foreach ($n in $ntAuthority) {
        $entries.Add((ConvertTo-WellKnownEntry -Name $n[0] -Kind 'NtAuthority' -Sid $n[1] -Rid $null -ForestRoot $false -ObjectClass 'wellKnown' -Aliases @("NT AUTHORITY\$($n[0])")))
    }

    # Universal well-known SIDs
    $entries.Add((ConvertTo-WellKnownEntry -Name 'Everyone' -Kind 'WellKnown' -Sid 'S-1-1-0' -Rid $null -ForestRoot $false -ObjectClass 'wellKnown' -Aliases @()))
    $entries.Add((ConvertTo-WellKnownEntry -Name 'CREATOR OWNER' -Kind 'WellKnown' -Sid 'S-1-3-0' -Rid $null -ForestRoot $false -ObjectClass 'wellKnown' -Aliases @()))
    $entries.Add((ConvertTo-WellKnownEntry -Name 'CREATOR GROUP' -Kind 'WellKnown' -Sid 'S-1-3-1' -Rid $null -ForestRoot $false -ObjectClass 'wellKnown' -Aliases @()))

    $script:TierModelWellKnownTable = $entries.ToArray()
    return $script:TierModelWellKnownTable
}

function Get-TierModelWellKnownPrincipal {
    <#
    .SYNOPSIS
    Looks up a built-in principal by its English name (or alias) in the well-known SID/RID table.

    .DESCRIPTION
    Accepts plain English names ("Domain Admins"), prefixed forms ("BUILTIN\Administrators",
    "NT AUTHORITY\SYSTEM", "CONTOSO\Domain Admins"), and returns the table entry: absolute SID or
    domain RID, plus a ForestRoot flag for the enterprise-wide groups (Schema Admins 518,
    Enterprise Admins 519, Enterprise Key Admins 527, Enterprise Read-only Domain Controllers 498).
    Without -Name the complete table is returned. Returns $null when the name is not a known
    built-in principal (e.g. custom groups or DnsAdmins, which has no fixed RID).

    .PARAMETER Name
    English principal name or alias. Matching is case-insensitive.

    .EXAMPLE
    Get-TierModelWellKnownPrincipal -Name 'Domain Admins'   # Rid 512, Kind DomainRelative

    .EXAMPLE
    Get-TierModelWellKnownPrincipal -Name 'BUILTIN\Server Operators'   # Sid S-1-5-32-549
    #>
    [CmdletBinding()]
    param(
        [Parameter(Position = 0)]
        [AllowEmptyString()]
        [string]$Name
    )

    $table = Get-TierModelWellKnownPrincipalTable
    if (-not $PSBoundParameters.ContainsKey('Name')) {
        return $table
    }
    if ([string]::IsNullOrWhiteSpace($Name)) { return $null }

    $candidate = $Name.Trim()

    # Exact name or alias match first (covers BUILTIN\x and NT AUTHORITY\x)
    foreach ($entry in $table) {
        if ($entry.Name -ieq $candidate) { return $entry }
        foreach ($alias in $entry.Aliases) {
            if ($alias -ieq $candidate) { return $entry }
        }
    }

    # "DOMAIN\Name" form: strip the prefix. BUILTIN / NT AUTHORITY prefixes restrict the lookup
    # to their own kind; any other prefix is treated as a domain name.
    if ($candidate -match '^(?<prefix>[^\\]+)\\(?<name>.+)$') {
        $prefix = $Matches['prefix']
        $shortName = $Matches['name']
        $allowedKinds = switch -Regex ($prefix) {
            '^BUILTIN$'      { @('Builtin') }
            '^NT AUTHORITY$' { @('NtAuthority') }
            default          { @('DomainRelative') }
        }
        foreach ($entry in $table) {
            if ($entry.Kind -in $allowedKinds -and $entry.Name -ieq $shortName) { return $entry }
        }
    }

    return $null
}

function Get-TierModelSidString {
    <# Normalizes a SecurityIdentifier / string / object with .Value to its SID string (internal helper). #>
    param($Value)
    if ($null -eq $Value) { return $null }
    if ($Value -is [string]) { return $Value }
    if ($Value.PSObject.Properties['Value'] -and $Value.Value) { return [string]$Value.Value }
    return [string]$Value
}

function Get-TierModelDomainSid {
    <#
    .SYNOPSIS
    Returns the SID of the domain served by the given domain controller (cached per DC).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$DomainController
    )

    if ($script:TierModelDomainSidCache.ContainsKey($DomainController)) {
        return $script:TierModelDomainSidCache[$DomainController]
    }
    $domain = Get-ADDomain -Server $DomainController -ErrorAction Stop
    $sid = Get-TierModelSidString $domain.DomainSID
    if ([string]::IsNullOrWhiteSpace($sid)) {
        throw "Could not determine the domain SID via domain controller '$DomainController'."
    }
    $script:TierModelDomainSidCache[$DomainController] = $sid
    return $sid
}

function Get-TierModelForestRootDomain {
    <#
    .SYNOPSIS
    Returns information about the forest root domain (DNS name, SID, whether it is the current domain).

    .DESCRIPTION
    Uses Get-ADForest -Server <DC> to find the root domain. When the DC's domain is not the root
    (child domain), the root domain SID is read with Get-ADDomain -Identity <root> -Server <root>.
    Results are cached per domain controller.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$DomainController
    )

    if ($script:TierModelForestRootCache.ContainsKey($DomainController)) {
        return $script:TierModelForestRootCache[$DomainController]
    }

    $domain = Get-ADDomain -Server $DomainController -ErrorAction Stop
    $forest = Get-ADForest -Server $DomainController -ErrorAction Stop
    $rootDns = [string]$forest.RootDomain
    $currentDns = [string]$domain.DNSRoot

    if ([string]::IsNullOrWhiteSpace($rootDns) -or $rootDns -ieq $currentDns) {
        $info = [PSCustomObject]@{
            DnsRoot         = if ($rootDns) { $rootDns } else { $currentDns }
            DomainSid       = Get-TierModelSidString $domain.DomainSID
            IsCurrentDomain = $true
            Server          = $DomainController
        }
    } else {
        $rootDomain = Get-ADDomain -Identity $rootDns -Server $rootDns -ErrorAction Stop
        $info = [PSCustomObject]@{
            DnsRoot         = $rootDns
            DomainSid       = Get-TierModelSidString $rootDomain.DomainSID
            IsCurrentDomain = $false
            Server          = $rootDns
        }
    }

    if ([string]::IsNullOrWhiteSpace($info.DomainSid)) {
        throw "Could not determine the forest root domain SID via domain controller '$DomainController'."
    }
    $script:TierModelForestRootCache[$DomainController] = $info
    return $info
}

function Clear-TierModelWellKnownPrincipalCache {
    <# Clears the domain / forest root SID caches (used by tests and after DC changes). #>
    [CmdletBinding(SupportsShouldProcess)]
    param()
    if ($PSCmdlet.ShouldProcess('TierModel well-known principal SID cache', 'Clear')) {
        $script:TierModelDomainSidCache = @{}
        $script:TierModelForestRootCache = @{}
    }
}

function Resolve-TierModelWellKnownPrincipalSid {
    <#
    .SYNOPSIS
    Resolves a built-in principal's English name to its SID without any lookup by name.

    .DESCRIPTION
    Returns the SID string for table entries: absolute SIDs directly, domain RIDs combined with the
    domain SID of -DomainController, forest-root RIDs combined with the forest ROOT domain SID.
    Returns $null when the name is not in the well-known table.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Name,

        [Parameter(Mandatory)]
        [string]$DomainController
    )

    $entry = Get-TierModelWellKnownPrincipal -Name $Name
    if (-not $entry) { return $null }
    if ($entry.Sid) { return $entry.Sid }

    if ($entry.ForestRoot) {
        $root = Get-TierModelForestRootDomain -DomainController $DomainController
        return "$($root.DomainSid)-$($entry.Rid)"
    }
    $domainSid = Get-TierModelDomainSid -DomainController $DomainController
    return "$domainSid-$($entry.Rid)"
}

function Get-TierModelADGroupByName {
    <#
    .SYNOPSIS
    Finds an AD group by its configured (English) name, language-independent for built-in groups.

    .DESCRIPTION
    Built-in groups from the well-known table are fetched by SID (Get-ADGroup -Identity <SID>), so
    "Domain Admins" also finds "Domaenen-Admins". Forest-root groups are queried on the forest root
    domain. All other names use the previous lookup (Get-ADGroup -Filter "Name -eq '...'").
    Returns $null if the group does not exist.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Name,

        [Parameter(Mandatory)]
        [string]$DomainController,

        [string[]]$Properties = @('sAMAccountName')
    )

    $entry = Get-TierModelWellKnownPrincipal -Name $Name
    if ($entry -and $entry.ObjectClass -eq 'group') {
        $server = $DomainController
        if ($entry.ForestRoot) {
            $server = (Get-TierModelForestRootDomain -DomainController $DomainController).Server
        }
        $sid = Resolve-TierModelWellKnownPrincipalSid -Name $Name -DomainController $DomainController
        try {
            return Get-ADGroup -Identity $sid -Server $server -Properties $Properties -ErrorAction Stop
        } catch {
            Write-Verbose "Well-known group '$Name' ($sid) not found on '$server': $($_.Exception.Message)"
            return $null
        }
    }

    $escapedName = $Name -replace "'", "''"
    return Get-ADGroup -Filter "Name -eq '$escapedName'" -Server $DomainController -Properties $Properties -ErrorAction Stop
}

function ConvertTo-TierModelSid {
    <#
    .SYNOPSIS
    Converts an account name ("DOMAIN\name", "BUILTIN\name") or SID string to a SID string.

    .DESCRIPTION
    SID strings are returned unchanged. Names are translated through the Windows security API
    (NTAccount.Translate); the well-known table is used as a fallback for built-in names. Returns
    $null when the name cannot be translated (e.g. on non-Windows hosts).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyString()]
        [string]$Identity,

        [string]$DomainController
    )

    if ([string]::IsNullOrWhiteSpace($Identity)) { return $null }
    if ($Identity -match '^S-\d+-\d+(-\d+)*$') { return $Identity }

    try {
        $nt = New-Object System.Security.Principal.NTAccount($Identity)
        return $nt.Translate([System.Security.Principal.SecurityIdentifier]).Value
    } catch {
        Write-Verbose "NTAccount translation failed for '$Identity': $($_.Exception.Message)"
    }

    if ($DomainController) {
        try {
            return Resolve-TierModelWellKnownPrincipalSid -Name $Identity -DomainController $DomainController
        } catch {
            Write-Verbose "Well-known resolution failed for '$Identity': $($_.Exception.Message)"
        }
    } else {
        $entry = Get-TierModelWellKnownPrincipal -Name $Identity
        if ($entry -and $entry.Sid) { return $entry.Sid }
    }
    return $null
}
