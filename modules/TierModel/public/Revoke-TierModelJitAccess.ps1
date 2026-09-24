function Revoke-TierModelJitAccess {
    <#
    .SYNOPSIS
    Removes a (time-limited) membership before it expires and verifies the removal.

    .DESCRIPTION
    Uses Remove-ADGroupMember and reads the group back with -ShowMemberTimeToLive. When the principal is no
    longer a member (for example because the time-to-live already ran out) nothing is changed and Removed is
    $false with WasMember = $false. A permanent membership is not removed unless -IncludePermanent is set, so a
    revocation can never take away access that was not granted temporarily.

    Returns an object with Group, Member, Sids (Group, Member), WasMember, Removed and Dc.

    .PARAMETER Group
    Group as samAccountName or SID.

    .PARAMETER Member
    Member as samAccountName (DOMAIN\ prefix allowed) or SID.

    .PARAMETER Server
    Domain controller used for all operations.

    .PARAMETER IncludePermanent
    Also remove a permanent membership.

    .EXAMPLE
    Revoke-TierModelJitAccess -Group 'Tier0-JIT-DomainAdmins' -Member 't0-alice' -Server dc01.contoso.com
    #>
    [CmdletBinding(SupportsShouldProcess)]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Group,
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Member,
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Server,
        [switch]$IncludePermanent
    )

    $g = Resolve-TierModelJitPrincipal -Identity $Group -Kind Group -Server $Server
    $m = Resolve-TierModelJitPrincipal -Identity $Member -Kind Member -Server $Server

    $result = [pscustomobject]@{
        Group     = $g.SamAccountName
        Member    = $m.SamAccountName
        Sids      = [pscustomobject]@{ Group = $g.Sid; Member = $m.Sid }
        WasMember = $false
        Removed   = $false
        Dc        = $Server
    }

    $existing = Get-TierModelJitMemberEntry -GroupDn $g.DistinguishedName -MemberDn $m.DistinguishedName -Server $Server
    if (-not $existing) { return $result }
    $result.WasMember = $true
    if ($null -eq $existing.TtlSeconds -and -not $IncludePermanent) {
        throw "'$($m.SamAccountName)' is a permanent member of '$($g.SamAccountName)'; use -IncludePermanent to remove a membership that was not granted temporarily."
    }

    if (-not $PSCmdlet.ShouldProcess("$($g.SamAccountName)", "Remove $($m.SamAccountName)")) { return $result }

    Remove-ADGroupMember -Identity $g.DistinguishedName -Members $m.DistinguishedName -Server $Server -Confirm:$false -ErrorAction Stop

    if (Get-TierModelJitMemberEntry -GroupDn $g.DistinguishedName -MemberDn $m.DistinguishedName -Server $Server) {
        throw "Verification failed: '$($m.SamAccountName)' is still a member of '$($g.SamAccountName)' after removing it."
    }
    $result.Removed = $true
    return $result
}
