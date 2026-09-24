<#
.SYNOPSIS
Just-in-Time admin access: time-limited group membership, early revocation, membership list and a read-only
prerequisite check.

.DESCRIPTION
Modes:
- Check  (read-only): is the "Privileged Access Management Feature" enabled in the forest and is the forest
  functional level Windows Server 2016 or later? The script never enables the feature (irreversible).
- Grant:  adds -Member to -Group for -Minutes with Add-ADGroupMember -MemberTimeToLive and verifies the
  time-to-live. Refuses to run when the prerequisites are not met.
- Revoke: removes the time-limited membership before it expires and verifies the removal.
- List   (read-only): time-limited members of -Group with their remaining lifetime.

The result is written as JSON (UTF-8 without BOM) to -OutputPath (camelCase keys, ISO-8601 UTC times):
- Grant:  { mode, success, group, member, sids: { group, member }, ttlSeconds, expiresAt, dc, timestamp }
- Revoke: { mode, success, group, member, sids: { group, member }, wasMember, removed, dc, timestamp }
- Check:  { mode, success, ready, pamEnabled, enabledScopes, forestMode, forestLevelSufficient, messages, dc, timestamp }
- List:   { mode, success, group, members: [ { memberDn, ttlSeconds, expiresAt } ], dc, timestamp }
On failure: { mode, success: false, error, dc, timestamp } and exit code 1.

Unlike Deploy-TierModel.ps1 the script does not run Test-TierModelPrerequisites: it needs only the right to
change the membership of the JIT groups (Grant/Revoke) or read access (Check/List).

.PARAMETER PreferredDc
Domain controller used for all operations.

.PARAMETER Mode
Grant (default), Revoke, Check or List.

.PARAMETER Group
Group as samAccountName or SID (Grant, Revoke, List).

.PARAMETER Member
User, computer or group as samAccountName (DOMAIN\ prefix allowed) or SID (Grant, Revoke).

.PARAMETER Minutes
Lifetime in minutes, 1 to 10080 (Grant).

.PARAMETER OutputPath
Path of the JSON result file. Optional; without it the result is only printed.

.EXAMPLE
.\Grant-TierModelJitAccess.ps1 -PreferredDc dc01.contoso.com -Mode Check -OutputPath .\out\jit.json
Checks the prerequisites without changing anything.

.EXAMPLE
.\Grant-TierModelJitAccess.ps1 -PreferredDc dc01.contoso.com -Group Tier0-JIT-DomainAdmins -Member t0-alice -Minutes 60
Adds t0-alice to Tier0-JIT-DomainAdmins for one hour.

.EXAMPLE
.\Grant-TierModelJitAccess.ps1 -PreferredDc dc01.contoso.com -Mode Revoke -Group Tier0-JIT-DomainAdmins -Member t0-alice
Ends the membership early.

.NOTES
Version: 1.0
Requires: PowerShell 7, ActiveDirectory module (RSAT). See docs/jit-access.md.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$PreferredDc,

    [Parameter()]
    [ValidateSet('Grant', 'Revoke', 'Check', 'List')]
    [string]$Mode = 'Grant',

    [Parameter()]
    [string]$Group,

    [Parameter()]
    [string]$Member,

    [Parameter()]
    [ValidateRange(1, 10080)]
    [int]$Minutes,

    [Parameter()]
    [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-JitResult {
    param([System.Collections.IDictionary]$Result)
    $Result['dc'] = $PreferredDc
    $Result['timestamp'] = [DateTimeOffset]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
    $json = ConvertTo-Json -InputObject $Result -Depth 5
    if ($OutputPath) {
        $fullPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
        $directory = Split-Path -Path $fullPath -Parent
        if ($directory -and -not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
        [System.IO.File]::WriteAllText($fullPath, $json, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host "Result written to $fullPath"
    }
}

function Format-JitTime { param([DateTimeOffset]$Value) $Value.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }

Write-Host "Just-in-Time access ($Mode) starting." -ForegroundColor Cyan
Write-Host "Preferred DC: $PreferredDc" -ForegroundColor DarkCyan

if ($PSVersionTable.PSVersion.Major -lt 7) {
    Write-Host "Just-in-Time access requires PowerShell 7.x or later (current: $($PSVersionTable.PSVersion))." -ForegroundColor Red
    exit 1
}

$missing = @()
if (($Mode -in 'Grant', 'Revoke', 'List') -and -not $Group) { $missing += '-Group' }
if (($Mode -in 'Grant', 'Revoke') -and -not $Member) { $missing += '-Member' }
if ($Mode -eq 'Grant' -and -not $Minutes) { $missing += '-Minutes' }
if ($missing) {
    $message = "Mode $Mode needs $($missing -join ', ')."
    Write-Host $message -ForegroundColor Red
    Write-JitResult ([ordered]@{ mode = $Mode.ToLowerInvariant(); success = $false; error = $message })
    exit 1
}

try {
    Import-Module (Join-Path $PSScriptRoot 'modules' 'TierModel' 'TierModel.psd1') -Force -Verbose:$false
    if (-not (Get-Command Get-ADGroup -ErrorAction SilentlyContinue)) {
        Import-Module ActiveDirectory -ErrorAction Stop -Verbose:$false
    }
} catch {
    $message = "Could not load the required modules (TierModel, ActiveDirectory): $($_.Exception.Message)"
    Write-Host $message -ForegroundColor Red
    Write-JitResult ([ordered]@{ mode = $Mode.ToLowerInvariant(); success = $false; error = $message })
    exit 1
}

try {
    switch ($Mode) {
        'Check' {
            $p = Test-TierModelJitPrerequisite -Server $PreferredDc
            foreach ($m in $p.Messages) { Write-Host $m -ForegroundColor Yellow }
            Write-Host ("Privileged Access Management feature: {0}; forest functional level: {1}" -f ($(if ($p.PamEnabled) { 'enabled' } else { 'NOT enabled' })), $p.ForestMode)
            Write-JitResult ([ordered]@{
                    mode = 'check'; success = $true; ready = [bool]$p.Ready; pamEnabled = [bool]$p.PamEnabled
                    enabledScopes = @($p.EnabledScopes); forestMode = $p.ForestMode; forestLevelSufficient = [bool]$p.ForestLevelSufficient
                    messages = @($p.Messages)
                })
            Write-Host ($(if ($p.Ready) { 'Prerequisites met.' } else { 'Prerequisites NOT met - nothing was changed.' })) -ForegroundColor ($(if ($p.Ready) { 'Green' } else { 'Yellow' }))
        }
        'Grant' {
            $r = Grant-TierModelJitAccess -Group $Group -Member $Member -Minutes $Minutes -Server $PreferredDc
            Write-Host "Added $($r.Member) to $($r.Group) until $(Format-JitTime $r.ExpiresAt) (TTL $($r.TtlSeconds) s)." -ForegroundColor Green
            Write-JitResult ([ordered]@{
                    mode = 'grant'; success = $true; group = $r.Group; member = $r.Member
                    sids = [ordered]@{ group = $r.Sids.Group; member = $r.Sids.Member }
                    groupDn = $r.GroupDn; memberDn = $r.MemberDn; ttlSeconds = $r.TtlSeconds; expiresAt = (Format-JitTime $r.ExpiresAt)
                })
        }
        'Revoke' {
            $r = Revoke-TierModelJitAccess -Group $Group -Member $Member -Server $PreferredDc
            if ($r.Removed) { Write-Host "Removed $($r.Member) from $($r.Group)." -ForegroundColor Green }
            else { Write-Host "$($r.Member) was no longer a member of $($r.Group) (already expired); nothing changed." -ForegroundColor Yellow }
            Write-JitResult ([ordered]@{
                    mode = 'revoke'; success = $true; group = $r.Group; member = $r.Member
                    sids = [ordered]@{ group = $r.Sids.Group; member = $r.Sids.Member }; wasMember = [bool]$r.WasMember; removed = [bool]$r.Removed
                })
        }
        'List' {
            $members = @(Get-TierModelJitMembership -Group $Group -Server $PreferredDc)
            foreach ($m in $members) { Write-Host "$($m.MemberDn): $($m.TtlSeconds) s left" }
            Write-Host "$($members.Count) time-limited member(s)."
            Write-JitResult ([ordered]@{
                    mode = 'list'; success = $true; group = $Group
                    members = @($members | ForEach-Object { [ordered]@{ memberDn = $_.MemberDn; ttlSeconds = $_.TtlSeconds; expiresAt = (Format-JitTime $_.ExpiresAt) } })
                })
        }
    }
} catch {
    $message = $_.Exception.Message
    Write-Host "Just-in-Time access ($Mode) failed: $message" -ForegroundColor Red
    Write-JitResult ([ordered]@{ mode = $Mode.ToLowerInvariant(); success = $false; error = $message })
    exit 1
}
Write-Host "Script completed successfully." -ForegroundColor Green
exit 0
