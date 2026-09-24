function Grant-TierModelJitAccess {
    <#
    .SYNOPSIS
    Adds a principal to a group for a limited time (Just-in-Time access) and verifies the time-to-live.

    .DESCRIPTION
    Uses Add-ADGroupMember -MemberTimeToLive. Active Directory removes the membership by itself when the
    time-to-live runs out, also when this tool is not running. Afterwards the membership is read back with
    -ShowMemberTimeToLive; the function fails when the member is missing or was added without a time-to-live.

    Refuses to run when the prerequisites are not met (Test-TierModelJitPrerequisite) and when the principal is
    already a member of the group (a permanent membership must not be turned into a temporary one silently; an
    existing temporary membership is reported with its expiry).

    Returns an object with Group, Member, Sids (Group, Member), TtlSeconds, ExpiresAt (UTC) and Dc.

    .PARAMETER Group
    Group as samAccountName or SID.

    .PARAMETER Member
    User, computer or group to add, as samAccountName (DOMAIN\ prefix allowed) or SID.

    .PARAMETER Minutes
    Lifetime of the membership in minutes (1 to 10080 = one week).

    .PARAMETER Server
    Domain controller used for all operations.

    .PARAMETER SkipPrerequisiteCheck
    Do not run Test-TierModelJitPrerequisite first (the caller already did).

    .EXAMPLE
    Grant-TierModelJitAccess -Group 'Tier0-JIT-DomainAdmins' -Member 't0-alice' -Minutes 60 -Server dc01.contoso.com
    #>
    [CmdletBinding(SupportsShouldProcess)]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Group,
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Member,
        [Parameter(Mandatory)][ValidateRange(1, 10080)][int]$Minutes,
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Server,
        [switch]$SkipPrerequisiteCheck
    )

    if (-not $SkipPrerequisiteCheck) {
        $prerequisite = Test-TierModelJitPrerequisite -Server $Server
        if (-not $prerequisite.Ready) {
            throw "Just-in-Time access is not possible: $(@($prerequisite.Messages) -join ' ')"
        }
    }

    $g = Resolve-TierModelJitPrincipal -Identity $Group -Kind Group -Server $Server
    $m = Resolve-TierModelJitPrincipal -Identity $Member -Kind Member -Server $Server

    $existing = Get-TierModelJitMemberEntry -GroupDn $g.DistinguishedName -MemberDn $m.DistinguishedName -Server $Server
    if ($existing) {
        if ($null -eq $existing.TtlSeconds) {
            throw "'$($m.SamAccountName)' is already a permanent member of '$($g.SamAccountName)'; a time-limited membership is not added."
        }
        $until = [DateTimeOffset]::UtcNow.AddSeconds($existing.TtlSeconds).ToString('u')
        throw "'$($m.SamAccountName)' already has a time-limited membership in '$($g.SamAccountName)' (expires $until)."
    }

    if (-not $PSCmdlet.ShouldProcess("$($g.SamAccountName)", "Add $($m.SamAccountName) for $Minutes minute(s)")) { return }

    Add-ADGroupMember -Identity $g.DistinguishedName -Members $m.DistinguishedName -MemberTimeToLive (New-TimeSpan -Minutes $Minutes) -Server $Server -ErrorAction Stop

    $entry = Get-TierModelJitMemberEntry -GroupDn $g.DistinguishedName -MemberDn $m.DistinguishedName -Server $Server
    if (-not $entry) {
        throw "Verification failed: '$($m.SamAccountName)' is not a member of '$($g.SamAccountName)' after adding it."
    }
    if ($null -eq $entry.TtlSeconds) {
        throw "Verification failed: '$($m.SamAccountName)' was added to '$($g.SamAccountName)' without a time-to-live. Remove the membership manually and check the Privileged Access Management feature."
    }

    [pscustomobject]@{
        Group      = $g.SamAccountName
        Member     = $m.SamAccountName
        Sids       = [pscustomobject]@{ Group = $g.Sid; Member = $m.Sid }
        GroupDn    = $g.DistinguishedName
        MemberDn   = $m.DistinguishedName
        TtlSeconds = [long]$entry.TtlSeconds
        ExpiresAt  = [DateTimeOffset]::UtcNow.AddSeconds($entry.TtlSeconds)
        Dc         = $Server
    }
}
