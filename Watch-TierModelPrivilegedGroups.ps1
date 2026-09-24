<#
.SYNOPSIS
Read-only snapshot of privileged access (Tier 0 membership, admin account hygiene, ACL paths to Tier 0).

.DESCRIPTION
Collects, without changing anything in Active Directory:
- the recursive membership of the protected built-in groups (Domain Admins, Enterprise Admins, Schema Admins,
  Administrators, Account/Server/Backup/Print Operators, Domain Controllers, (Enterprise) Read-only Domain
  Controllers, Group Policy Creator Owners, (Enterprise) Key Admins, Cert Publishers, DnsAdmins, Replicator)
  resolved by SID, so localized group names work, plus every Tier 0 group of the configuration;
- hygiene attributes of every account in those groups and in the configured Tier 0 / Tier 1 account OUs
  (last logon, password age, PasswordNeverExpires, AccountNotDelegated, Protected Users, adminCount, SPNs);
- objects with adminCount=1 that are no longer in a protected group;
- dangerous ACEs and owners on Tier 0 objects (domain root, AdminSDHolder, protected groups, Domain
  Controllers OU, Tier 0 OUs and the GPOs linked to them) held by principals that are not Tier 0.

The result is written as JSON (UTF-8 without BOM) to -OutputPath. Partial failures (for example one
unreadable group) are listed in the "errors" array of the file and do not fail the run. The script exits
with 0 when the snapshot was written (also with findings) and with 1 when it could not be taken.

Unlike Deploy-TierModel.ps1 / Audit-TierModel.ps1 the script does not run Test-TierModelPrerequisites: it
needs neither Domain Admin rights nor an English-language domain, only normal authenticated read access.

.PARAMETER PreferredDc
Domain controller used for all queries of the current domain. In a child domain the forest-wide groups
(Enterprise Admins, Schema Admins, Enterprise Key Admins, Enterprise Read-only Domain Controllers) are
read from a discovered domain controller of the forest root domain.

.PARAMETER OutputPath
Path of the JSON file to write. The directory is created when it does not exist.

.PARAMETER ConfigPath
Optional configuration directory (defaults to the config folder next to this script). Used for the Tier 0
groups and the Tier 0 / Tier 1 OUs.

.EXAMPLE
.\Watch-TierModelPrivilegedGroups.ps1 -PreferredDc "DC01.contoso.com" -OutputPath "C:\Reports\privileged.json"
Writes the privileged access snapshot of contoso.com to C:\Reports\privileged.json.

.EXAMPLE
.\Watch-TierModelPrivilegedGroups.ps1 -PreferredDc "DC01.contoso.com" -OutputPath .\out\privileged.json -ConfigPath .\config -Verbose
Uses an explicit configuration directory and shows every partial failure as verbose output.

.NOTES
Version: 1.0
Requires: PowerShell 7, ActiveDirectory module (RSAT), read access to the domain. See
docs/privileged-access-monitoring.md.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$PreferredDc,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath,

    [Parameter()]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Container })]
    [string]$ConfigPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host "Watch privileged groups starting (read-only)." -ForegroundColor Cyan
Write-Host "Preferred DC: $PreferredDc" -ForegroundColor DarkCyan

if ($PSVersionTable.PSVersion.Major -lt 7) {
    Write-Host "Watching privileged groups requires PowerShell 7.x or later (current: $($PSVersionTable.PSVersion))." -ForegroundColor Red
    exit 1
}

try {
    Import-Module (Join-Path $PSScriptRoot 'modules' 'TierModel' 'TierModel.psd1') -Force -Verbose:$false
    if (-not (Get-Command Get-ADDomain -ErrorAction SilentlyContinue)) {
        Import-Module ActiveDirectory -ErrorAction Stop -Verbose:$false
    }
} catch {
    Write-Host "Could not load the required modules (TierModel, ActiveDirectory): $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

try {
    $snapshotParams = @{ DomainController = $PreferredDc; ShowProgress = $true }
    if ($ConfigPath) { $snapshotParams['ConfigPath'] = (Resolve-Path -LiteralPath $ConfigPath).ProviderPath }
    $snapshot = Get-TierModelPrivilegedSnapshot @snapshotParams
    $written = Export-TierModelPrivilegedSnapshot -Snapshot $snapshot -Path $OutputPath
} catch {
    Write-Host "Privileged snapshot could not be taken: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

$errorCount = @($snapshot['errors']).Count
Write-Host "Snapshot written to $written" -ForegroundColor Green
if ($errorCount -gt 0) {
    Write-Host "$errorCount partial failure(s), see the 'errors' array in the output file." -ForegroundColor Yellow
}
exit 0
