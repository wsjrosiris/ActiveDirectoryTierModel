function Get-TierModelJitMembership {
    <#
    .SYNOPSIS
    Lists the time-limited (TTL) members of a group with their remaining lifetime.

    .DESCRIPTION
    Reads the group's member attribute with -ShowMemberTimeToLive. With the Privileged Access Management
    feature enabled, time-limited members are returned as "<TTL=seconds>,CN=…" (the remaining lifetime in
    seconds); permanent members are plain distinguished names. By default only time-limited members are
    returned; -IncludePermanent adds the permanent ones (TtlSeconds and ExpiresAt are then $null).

    Read-only.

    .PARAMETER Group
    Group as samAccountName, SID or distinguished name.

    .PARAMETER Server
    Domain controller used for the query.

    .PARAMETER IncludePermanent
    Also return members without a time-to-live.

    .EXAMPLE
    Get-TierModelJitMembership -Group 'Tier0-JIT-DomainAdmins' -Server dc01.contoso.com
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Group,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Server,

        [switch]$IncludePermanent
    )

    $adGroup = Get-ADGroup -Identity $Group -Server $Server -Properties member -ShowMemberTimeToLive -ErrorAction Stop
    $now = [DateTimeOffset]::UtcNow
    foreach ($value in @($adGroup.member | Where-Object { $_ })) {
        $entry = ConvertFrom-TierModelJitMemberValue -Value ([string]$value)
        if ($null -eq $entry.TtlSeconds -and -not $IncludePermanent) { continue }
        [pscustomobject]@{
            Group             = [string]$adGroup.SamAccountName
            GroupSid          = [string]$adGroup.SID
            MemberDn          = $entry.DistinguishedName
            TtlSeconds        = $entry.TtlSeconds
            ExpiresAt         = if ($null -ne $entry.TtlSeconds) { $now.AddSeconds($entry.TtlSeconds) } else { $null }
            TimeLimited       = ($null -ne $entry.TtlSeconds)
        }
    }
}

function ConvertFrom-TierModelJitMemberValue {
    <#
    .SYNOPSIS
    Splits a member value read with -ShowMemberTimeToLive into the remaining TTL (seconds or $null) and the DN.

    .EXAMPLE
    ConvertFrom-TierModelJitMemberValue -Value '<TTL=3587>,CN=Alice,OU=Admins,DC=contoso,DC=com'
    # TtlSeconds = 3587, DistinguishedName = 'CN=Alice,OU=Admins,DC=contoso,DC=com'
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Value)

    if ($Value -match '^\s*<TTL=(\d+)>\s*[,;]\s*(.+)$') {
        return [pscustomobject]@{ TtlSeconds = [long]$Matches[1]; DistinguishedName = $Matches[2].Trim() }
    }
    return [pscustomobject]@{ TtlSeconds = $null; DistinguishedName = $Value.Trim() }
}

function Resolve-TierModelJitPrincipal {
    <#
    .SYNOPSIS
    Finds a group (-Kind Group) or any security principal (-Kind Member) by samAccountName or SID.

    .DESCRIPTION
    Returns an object with SamAccountName, Sid, DistinguishedName and ObjectClass, or throws an English error
    when nothing or more than one object matches. Input is validated before it is placed into a filter.
    #>
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Identity,
        [Parameter(Mandatory)][ValidateSet('Group', 'Member')][string]$Kind,
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Server
    )

    $value = $Identity.Trim()
    if ($value -match '^[^\\]+\\(.+)$') { $value = $Matches[1] }   # DOMAIN\sam -> sam
    if ($value -match '^S-1-[0-9-]+$') {
        $filter = "objectSid -eq '$value'"
    } elseif ($value -match '^[^"/\\\[\]:;|=,+*?<>@'']{1,256}$') {
        $filter = "sAMAccountName -eq '$value'"
    } else {
        throw "'$Identity' is not a valid samAccountName or SID."
    }
    if ($Kind -eq 'Group') { $filter = "($filter) -and (objectClass -eq 'group')" }

    $found = @(Get-ADObject -Filter $filter -Server $Server -Properties objectSid, sAMAccountName, objectClass -ErrorAction Stop)
    if ($found.Count -eq 0) {
        throw "$Kind '$Identity' was not found on $Server."
    }
    if ($found.Count -gt 1) {
        throw "$Kind '$Identity' is ambiguous ($($found.Count) objects)."
    }
    $o = $found[0]
    $sid = $o.objectSid
    if ($sid -and $sid.PSObject.Properties['Value']) { $sid = $sid.Value }
    [pscustomobject]@{
        SamAccountName    = [string]$o.sAMAccountName
        Sid               = [string]$sid
        DistinguishedName = [string]$o.DistinguishedName
        ObjectClass       = [string](@($o.objectClass)[-1])
    }
}

function Get-TierModelJitMemberEntry {
    <#
    .SYNOPSIS
    The member entry (TTL and DN) of one principal in a group, or $null when it is not a direct member.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$GroupDn,
        [Parameter(Mandatory)][string]$MemberDn,
        [Parameter(Mandatory)][string]$Server
    )

    $adGroup = Get-ADGroup -Identity $GroupDn -Server $Server -Properties member -ShowMemberTimeToLive -ErrorAction Stop
    foreach ($value in @($adGroup.member | Where-Object { $_ })) {
        $entry = ConvertFrom-TierModelJitMemberValue -Value ([string]$value)
        if ($entry.DistinguishedName -ieq $MemberDn) { return $entry }
    }
    return $null
}
