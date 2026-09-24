function New-TierModelAuthSiloSddl {
    <#
    .SYNOPSIS
    Builds the "allowed to authenticate from" SDDL of a Kerberos authentication policy.

    .DESCRIPTION
    Pure function (no AD access). Produces the security descriptor stored in
    msDS-UserAllowedToAuthenticateFrom (New-/Set-ADAuthenticationPolicy -UserAllowedToAuthenticateFrom).
    The descriptor contains one conditional callback ACE (XA) that grants the Control Access right (CR)
    to Everyone (WD) when the condition is true. The condition is evaluated against the token of the
    DEVICE the user signs in from (Kerberos armoring / compound authentication), so "Member_of" here
    means "the device is a member of".

    Condition (a device may be used when it is a domain controller OR a member of ANY listed group):

      Domain controllers only : (Member_of {SID(ED)})
      Device groups only      : (Member_of_any {SID(<sid1>), SID(<sid2>)})
      Both                    : ((Member_of {SID(ED)}) || (Member_of_any {SID(<sid1>), SID(<sid2>)}))

    Result: O:SYG:SYD:(XA;OICI;CR;;;WD;<condition>)

    ED is the SDDL alias of "Enterprise Domain Controllers" (S-1-5-9): every writable and read-only
    DC of the forest carries it in its token. Member_of_any is used instead of Member_of for groups
    because Member_of {A, B} requires membership in ALL listed groups (the '&&' bug of the old
    optional scripts). Group SIDs are used as given (resolve names first, e.g. with
    Resolve-TierModelWellKnownPrincipalSid / Get-ADGroup), so localized group names are irrelevant.

    Returns $null when neither domain controllers nor device groups are requested (no device
    restriction; the caller decides whether this is allowed).

    .PARAMETER IncludeDomainControllers
    Allow sign-in from domain controllers (Enterprise Domain Controllers, SID S-1-5-9).

    .PARAMETER DeviceGroupSid
    SIDs (S-1-5-21-...) of the computer groups whose members may be used as sign-in devices.
    Duplicates are removed (first occurrence wins, order is kept so the result is deterministic).

    .EXAMPLE
    New-TierModelAuthSiloSddl -IncludeDomainControllers -DeviceGroupSid 'S-1-5-21-1-2-3-1105','S-1-5-21-1-2-3-1106'
    # O:SYG:SYD:(XA;OICI;CR;;;WD;((Member_of {SID(ED)}) || (Member_of_any {SID(S-1-5-21-1-2-3-1105), SID(S-1-5-21-1-2-3-1106)})))
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [switch]$IncludeDomainControllers,

        [AllowEmptyCollection()]
        [AllowNull()]
        [string[]]$DeviceGroupSid = @()
    )

    $sids = New-Object System.Collections.Generic.List[string]
    foreach ($sid in @($DeviceGroupSid)) {
        if ([string]::IsNullOrWhiteSpace($sid)) { continue }
        $candidate = $sid.Trim()
        if ($candidate -notmatch '^S-1-\d+(-\d+)+$') {
            throw "Invalid SID '$candidate' for the authentication policy condition. Resolve group names to SIDs first."
        }
        $candidate = $candidate.ToUpperInvariant()
        if (-not $sids.Contains($candidate)) { $sids.Add($candidate) }
    }

    $dcCondition = if ($IncludeDomainControllers) { '(Member_of {SID(ED)})' } else { $null }
    $groupCondition = if ($sids.Count -gt 0) {
        '(Member_of_any {' + (($sids | ForEach-Object { "SID($_)" }) -join ', ') + '})'
    } else { $null }

    $condition = if ($dcCondition -and $groupCondition) {
        "($dcCondition || $groupCondition)"
    } elseif ($dcCondition) {
        $dcCondition
    } elseif ($groupCondition) {
        $groupCondition
    } else {
        return $null
    }

    return "O:SYG:SYD:(XA;OICI;CR;;;WD;$condition)"
}
