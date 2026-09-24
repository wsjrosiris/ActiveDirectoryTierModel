<#
.SYNOPSIS
    Installiert, aktualisiert oder entfernt den TierModel Service (Web-Oberfläche + Dienst + PostgreSQL).

.DESCRIPTION
    Interaktiver Assistent. Er prüft die Voraussetzungen, installiert auf Wunsch PowerShell 7,
    die AD-Verwaltungstools und PostgreSQL, legt Datenbank und Datenbankbenutzer an, richtet
    Dienstkonto, HTTPS-Zertifikat, Firewall und den Windows-Dienst ein und erstellt das erste
    Administratorkonto für die Web-Oberfläche.

    Läuft unter Windows PowerShell 5.1 und PowerShell 7. Wird über Setup.cmd gestartet.

.PARAMETER Uninstall
    Direkt die Deinstallation starten.

.PARAMETER PostgresInstaller
    Pfad oder URL des PostgreSQL-Installers (EDB, Windows x64) für die lokale Installation.
#>
[CmdletBinding()]
param(
    [switch]$Uninstall,
    [string]$PostgresInstaller = 'https://get.enterprisedb.com/postgresql/postgresql-17.6-1-windows-x64.exe'
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ServiceName = 'TierModelService'
$ServiceDisplayName = 'TierModel Service'
$ServiceDescription = 'Verwaltung und Bereitstellung des Active Directory Tier Models (Web-Oberfläche, Deploy, Audit).'
$EventSource = 'TierModel.Service'
$FirewallRuleName = 'TierModelService-HTTPS'
$PackageRoot = $PSScriptRoot
$ExeName = 'TierModel.Service.exe'

#region ---------- Ausgabe und Eingabe ----------

function Write-Banner {
    Clear-Host
    Write-Host ''
    Write-Host '  ████████╗██╗███████╗██████╗     ███╗   ███╗ ██████╗ ██████╗ ███████╗██╗     ' -ForegroundColor Cyan
    Write-Host '  ╚══██╔══╝██║██╔════╝██╔══██╗    ████╗ ████║██╔═══██╗██╔══██╗██╔════╝██║     ' -ForegroundColor Cyan
    Write-Host '     ██║   ██║█████╗  ██████╔╝    ██╔████╔██║██║   ██║██║  ██║█████╗  ██║     ' -ForegroundColor Cyan
    Write-Host '     ██║   ██║██╔══╝  ██╔══██╗    ██║╚██╔╝██║██║   ██║██║  ██║██╔══╝  ██║     ' -ForegroundColor Cyan
    Write-Host '     ██║   ██║███████╗██║  ██║    ██║ ╚═╝ ██║╚██████╔╝██████╔╝███████╗███████╗' -ForegroundColor Cyan
    Write-Host '     ╚═╝   ╚═╝╚══════╝╚═╝  ╚═╝    ╚═╝     ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝╚══════╝' -ForegroundColor Cyan
    Write-Host ''
    Write-Host "  TierModel Service – Installationsassistent  (Version $(Get-PackageVersion))" -ForegroundColor White
    Write-Host '  ─────────────────────────────────────────────────────────────────────────────' -ForegroundColor DarkGray
    Write-Host ''
}

function Write-Step([string]$Text) {
    Write-Host ''
    Write-Host "  ▶ $Text" -ForegroundColor Cyan
    Write-Host ('  ' + ('─' * ($Text.Length + 2))) -ForegroundColor DarkGray
}

function Write-Info([string]$Text) { Write-Host "    $Text" -ForegroundColor Gray }
function Write-Ok([string]$Text) { Write-Host "    ✔ $Text" -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host "    ⚠ $Text" -ForegroundColor Yellow }
function Write-Err([string]$Text) { Write-Host "    ✖ $Text" -ForegroundColor Red }

function Read-Value {
    param([string]$Prompt, [string]$Default = '', [scriptblock]$Validate, [string]$ValidationMessage = 'Ungültige Eingabe.')
    while ($true) {
        $suffix = ''
        if ($Default) { $suffix = " [$Default]" }
        $value = Read-Host "    $Prompt$suffix"
        if ([string]::IsNullOrWhiteSpace($value)) { $value = $Default }
        $value = "$value".Trim()
        if (-not $value) { Write-Warn 'Eine Eingabe ist erforderlich.'; continue }
        if ($Validate -and -not (& $Validate $value)) { Write-Warn $ValidationMessage; continue }
        return $value
    }
}

function Read-YesNo([string]$Prompt, [bool]$Default = $true) {
    $hint = 'J/n'
    if (-not $Default) { $hint = 'j/N' }
    while ($true) {
        $a = Read-Host "    $Prompt ($hint)"
        if ([string]::IsNullOrWhiteSpace($a)) { return $Default }
        switch -Regex ($a.Trim()) {
            '^(j|ja|y|yes)$' { return $true }
            '^(n|nein|no)$' { return $false }
        }
        Write-Warn 'Bitte j oder n eingeben.'
    }
}

function Read-Choice {
    param([string]$Prompt, [string[]]$Options, [int]$Default = 1)
    for ($i = 0; $i -lt $Options.Count; $i++) {
        $marker = ' '
        if ($i + 1 -eq $Default) { $marker = '*' }
        Write-Host ("    {0} [{1}] {2}" -f $marker, ($i + 1), $Options[$i]) -ForegroundColor White
    }
    while ($true) {
        $a = Read-Host "    $Prompt [$Default]"
        if ([string]::IsNullOrWhiteSpace($a)) { return $Default }
        $n = 0
        if ([int]::TryParse($a.Trim(), [ref]$n) -and $n -ge 1 -and $n -le $Options.Count) { return $n }
        Write-Warn "Bitte eine Zahl zwischen 1 und $($Options.Count) eingeben."
    }
}

function ConvertTo-PlainText([Security.SecureString]$Secure) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Read-Secret {
    param([string]$Prompt, [int]$MinLength = 1, [switch]$Repeat)
    while ($true) {
        $first = ConvertTo-PlainText (Read-Host "    $Prompt" -AsSecureString)
        if ($first.Length -lt $MinLength) { Write-Warn "Mindestens $MinLength Zeichen erforderlich."; continue }
        if ($Repeat) {
            $second = ConvertTo-PlainText (Read-Host '    Wiederholen' -AsSecureString)
            if ($first -cne $second) { Write-Warn 'Die Eingaben stimmen nicht überein.'; continue }
        }
        return $first
    }
}

function New-RandomPassword([int]$Length = 32) {
    $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'.ToCharArray()
    $bytes = New-Object byte[] $Length
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

#endregion

#region ---------- Hilfsfunktionen ----------

function Get-PackageVersion {
    $f = Join-Path $PackageRoot 'VERSION'
    if (Test-Path $f) { return (Get-Content $f -Raw).Trim() }
    return 'dev'
}

function Test-IsAdmin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-Fqdn {
    try { return [Net.Dns]::GetHostEntry('').HostName } catch { return $env:COMPUTERNAME }
}

# NetBIOS name of the domain this computer belongs to (the installing admin may be local or from another domain).
function Get-ComputerDomainNetBios([string]$DnsDomain) {
    try {
        $root = [adsi]'LDAP://RootDSE'
        $partitions = [adsi]"LDAP://CN=Partitions,$($root.configurationNamingContext)"
        $searcher = New-Object DirectoryServices.DirectorySearcher($partitions, "(&(objectClass=crossRef)(nCName=$($root.defaultNamingContext))(nETBIOSName=*))", @('nETBIOSName'))
        $hit = $searcher.FindOne()
        if ($hit) { return [string]$hit.Properties['netbiosname'][0] }
    }
    catch { }
    return ($DnsDomain -split '\.')[0].ToUpperInvariant()
}

function Get-DomainInfo {
    try {
        $cs = Get-CimInstance Win32_ComputerSystem
        if (-not $cs.PartOfDomain) { return $null }
        $dc = $null
        try { $dc = [DirectoryServices.ActiveDirectory.Domain]::GetComputerDomain().FindDomainController().Name } catch { }
        return [pscustomobject]@{ Name = $cs.Domain; NetBios = (Get-ComputerDomainNetBios $cs.Domain); DomainController = $dc }
    }
    catch { return $null }
}

function Find-Pwsh {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe'),
        (Join-Path $env:ProgramFiles 'PowerShell\7-preview\pwsh.exe')
    )
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    $cmd = Get-Command pwsh.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

function Invoke-Download([string]$Url, [string]$Target) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Write-Info "Lade herunter: $Url"
    Invoke-WebRequest -Uri $Url -OutFile $Target -UseBasicParsing
}

# Runs the service executable with secrets passed on stdin (UTF-8), never on the command line.
function Invoke-ServiceCli {
    param([string]$AppDir, [string[]]$Arguments, [string[]]$StdinLines = @(), [switch]$Quiet)
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName = Join-Path $AppDir $ExeName
    $psi.Arguments = ($Arguments | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
    $psi.WorkingDirectory = $AppDir
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.EnvironmentVariables['DOTNET_CLI_TELEMETRY_OPTOUT'] = '1'
    $p = [Diagnostics.Process]::Start($psi)
    $utf8 = New-Object Text.UTF8Encoding $false
    foreach ($line in $StdinLines) {
        $bytes = $utf8.GetBytes($line + "`n")
        $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    }
    $p.StandardInput.Close()
    $out = $p.StandardOutput.ReadToEndAsync()
    $err = $p.StandardError.ReadToEndAsync()
    $p.WaitForExit()
    $stdout = $out.Result
    $stderr = $err.Result
    if (-not $Quiet) {
        foreach ($l in ($stdout -split "`r?`n")) {
            if ($l -and $l -notmatch '^\s*(info|warn|dbug):' -and $l -notmatch '^\s{6}') { Write-Info $l }
        }
    }
    if ($p.ExitCode -ne 0) {
        $msg = ($stderr + "`n" + $stdout).Trim()
        throw "Befehl '$($Arguments -join ' ')' fehlgeschlagen (Code $($p.ExitCode)): $msg"
    }
    return $stdout
}

function Grant-LogonAsService([string]$Account) {
    if (-not ('TierModelSetup.Lsa' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Security.Principal;
namespace TierModelSetup {
  public static class Lsa {
    [StructLayout(LayoutKind.Sequential)] struct LSA_UNICODE_STRING { public ushort Length; public ushort MaximumLength; public IntPtr Buffer; }
    [StructLayout(LayoutKind.Sequential)] struct LSA_OBJECT_ATTRIBUTES { public int Length; public IntPtr RootDirectory; public IntPtr ObjectName; public uint Attributes; public IntPtr SecurityDescriptor; public IntPtr SecurityQualityOfService; }
    [DllImport("advapi32.dll")] static extern uint LsaOpenPolicy(IntPtr SystemName, ref LSA_OBJECT_ATTRIBUTES ObjectAttributes, uint DesiredAccess, out IntPtr PolicyHandle);
    [DllImport("advapi32.dll")] static extern uint LsaAddAccountRights(IntPtr PolicyHandle, byte[] AccountSid, LSA_UNICODE_STRING[] UserRights, uint CountOfRights);
    [DllImport("advapi32.dll")] static extern uint LsaClose(IntPtr PolicyHandle);
    [DllImport("advapi32.dll")] static extern int LsaNtStatusToWinError(uint status);
    public static void AddRight(string account, string right) {
      var sid = (SecurityIdentifier)new NTAccount(account).Translate(typeof(SecurityIdentifier));
      var sidBytes = new byte[sid.BinaryLength]; sid.GetBinaryForm(sidBytes, 0);
      var attrs = new LSA_OBJECT_ATTRIBUTES();
      IntPtr policy;
      uint rc = LsaOpenPolicy(IntPtr.Zero, ref attrs, 0x00000800 | 0x00000010, out policy);
      if (rc != 0) throw new System.ComponentModel.Win32Exception(LsaNtStatusToWinError(rc));
      try {
        var s = new LSA_UNICODE_STRING();
        s.Buffer = Marshal.StringToHGlobalUni(right);
        s.Length = (ushort)(right.Length * 2); s.MaximumLength = (ushort)((right.Length + 1) * 2);
        try {
          rc = LsaAddAccountRights(policy, sidBytes, new[] { s }, 1);
          if (rc != 0) throw new System.ComponentModel.Win32Exception(LsaNtStatusToWinError(rc));
        } finally { Marshal.FreeHGlobal(s.Buffer); }
      } finally { LsaClose(policy); }
    }
  }
}
'@
    }
    [TierModelSetup.Lsa]::AddRight($Account, 'SeServiceLogonRight')
}

function Set-PathAcl {
    param([string]$Path, [string]$Account, [ValidateSet('ReadAndExecute', 'Modify', 'Read')][string]$Rights, [switch]$Exclusive)
    if ($Exclusive) {
        # Only SYSTEM, Administrators and the service account – used for files containing secrets.
        & icacls.exe $Path /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Berechtigungen auf $Path konnten nicht eingeschränkt werden." }
    }
    if ($Account -and $Account -ne 'LocalSystem') {
        $inherit = ''
        if ((Get-Item $Path) -is [IO.DirectoryInfo]) { $inherit = '(OI)(CI)' }
        $flag = @{ ReadAndExecute = 'RX'; Modify = 'M'; Read = 'R' }[$Rights]
        & icacls.exe $Path /grant:r "${Account}:$inherit($flag)" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Berechtigung für $Account auf $Path konnte nicht gesetzt werden." }
    }
}

function Grant-CertificateKeyAccess($Certificate, [string]$Account) {
    if (-not $Account -or $Account -eq 'LocalSystem') { return }
    # The key file name is the key's unique name; CNG keys live in Crypto\Keys, legacy CSP keys in RSA\MachineKeys.
    $names = @()
    try {
        $rsa = [Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($Certificate)
        if ($rsa -is [Security.Cryptography.RSACng]) { $names += $rsa.Key.UniqueName }
    }
    catch { }
    try {
        if ($Certificate.PrivateKey -and $Certificate.PrivateKey.CspKeyContainerInfo) { $names += $Certificate.PrivateKey.CspKeyContainerInfo.UniqueKeyContainerName }
    }
    catch { }
    $keyPath = $null
    foreach ($n in ($names | Where-Object { $_ })) {
        foreach ($dir in 'Microsoft\Crypto\Keys', 'Microsoft\Crypto\RSA\MachineKeys') {
            $candidate = Join-Path $env:ProgramData (Join-Path $dir $n)
            if (-not $keyPath -and (Test-Path $candidate)) { $keyPath = $candidate }
        }
    }
    if ($keyPath) {
        & icacls.exe $keyPath /grant "${Account}:(R)" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Leserecht auf den privaten Schlüssel ($keyPath) konnte nicht gesetzt werden." }
        Write-Ok "Dienstkonto darf den privaten Schlüssel des Zertifikats lesen."
    }
    else {
        Write-Warn "Privater Schlüssel des Zertifikats nicht gefunden – Leserecht für $Account bitte manuell vergeben (certlm.msc › Private Schlüssel verwalten)."
    }
}

function Wait-ServiceHealthy([int]$Port, [int]$TimeoutSeconds = 90) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $previous = [Net.ServicePointManager]::ServerCertificateValidationCallback
    # Only for this local health probe: the certificate may be self-signed or issued for the FQDN.
    [Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
    try {
        $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
        while ((Get-Date) -lt $deadline) {
            $svc = Get-Service $ServiceName -ErrorAction SilentlyContinue
            if ($svc -and $svc.Status -eq 'Stopped') { return $false }
            try {
                $probe = @{ Uri = "https://localhost:$Port/healthz"; UseBasicParsing = $true; TimeoutSec = 5 }
                # PowerShell 7 ignores ServerCertificateValidationCallback.
                if ($PSVersionTable.PSEdition -eq 'Core') { $probe.SkipCertificateCheck = $true }
                $r = Invoke-WebRequest @probe
                if ($r.StatusCode -eq 200) { return $true }
            }
            catch { }
            Start-Sleep -Seconds 2
        }
        return $false
    }
    finally { [Net.ServicePointManager]::ServerCertificateValidationCallback = $previous }
}

function Show-RecentServiceErrors {
    $events = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = (Get-Date).AddMinutes(-5); Level = 1, 2 } -ErrorAction SilentlyContinue |
        Where-Object { $_.ProviderName -in @($EventSource, '.NET Runtime', 'Application Error') } | Select-Object -First 3
    foreach ($e in $events) { Write-Err (($e.Message -split "`n")[0..4] -join ' ') }
    if (-not $events) { Write-Info 'Details in der Ereignisanzeige unter Windows-Protokolle › Anwendung.' }
}

function Test-RunningFromInstallDir([string]$InstallDir) {
    $a = [IO.Path]::GetFullPath($PackageRoot).TrimEnd('\')
    $b = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
    return $a -ieq $b
}

function Copy-Payload([string]$InstallDir) {
    if (Test-RunningFromInstallDir $InstallDir) {
        Write-Info 'Setup läuft aus dem Installationsverzeichnis – Programmdateien bleiben unverändert.'
        return
    }
    foreach ($part in 'app', 'framework') {
        $src = Join-Path $PackageRoot $part
        if (-not (Test-Path $src)) { throw "Paket unvollständig: Ordner '$part' fehlt neben dem Installer." }
        $dst = Join-Path $InstallDir $part
        if ($part -eq 'app' -and (Test-Path $dst)) {
            # Keep the machine-specific configuration.
            Get-ChildItem $dst -Force | Where-Object { $_.Name -ne 'appsettings.Production.json' } | Remove-Item -Recurse -Force
        }
        elseif (Test-Path $dst) {
            Remove-Item $dst -Recurse -Force
        }
        New-Item -ItemType Directory -Path $dst -Force | Out-Null
        Copy-Item (Join-Path $src '*') $dst -Recurse -Force
    }
    Copy-Item (Join-Path $PackageRoot 'Install-TierModelService.ps1') $InstallDir -Force
    Copy-Item (Join-Path $PackageRoot 'Setup.cmd') $InstallDir -Force
    if (Test-Path (Join-Path $PackageRoot 'VERSION')) { Copy-Item (Join-Path $PackageRoot 'VERSION') $InstallDir -Force }
}

function Get-InstalledState {
    $svc = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
    if (-not $svc) { return $null }
    $exe = ($svc.PathName -replace '^"([^"]+)".*$', '$1')
    $appDir = Split-Path $exe -Parent
    return [pscustomobject]@{
        Service     = $svc
        AppDir      = $appDir
        InstallDir  = Split-Path $appDir -Parent
        Settings    = Join-Path $appDir 'appsettings.Production.json'
        Account     = $svc.StartName
        Version     = $(if (Test-Path (Join-Path (Split-Path $appDir -Parent) 'VERSION')) { (Get-Content (Join-Path (Split-Path $appDir -Parent) 'VERSION') -Raw).Trim() } else { '?' })
    }
}

# Stops and deletes the service and waits until the SCM has really removed it.
function Remove-TierModelService {
    Stop-Service $ServiceName -ErrorAction SilentlyContinue
    & sc.exe delete $ServiceName | Out-Null
    for ($i = 0; $i -lt 30 -and (Get-Service $ServiceName -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Seconds 1 }
    if (Get-Service $ServiceName -ErrorAction SilentlyContinue) {
        throw 'Der Dienst ist noch zum Löschen markiert (z. B. weil die Diensteverwaltung geöffnet ist). Fenster schließen und erneut versuchen.'
    }
}

function Get-InstalledPort($State) {
    try {
        $url = (Get-Content $State.Settings -Raw | ConvertFrom-Json).Kestrel.Endpoints.Https.Url
        if ($url -match ':(\d+)/?$') { return [int]$Matches[1] }
    }
    catch { }
    return 8443
}

#endregion

#region ---------- Schritte ----------

function Test-Prerequisites {
    Write-Step 'Voraussetzungen prüfen'
    $os = Get-CimInstance Win32_OperatingSystem
    Write-Info "Betriebssystem: $($os.Caption) ($($os.Version))"
    if ($os.ProductType -eq 1) { Write-Warn 'Kein Windows Server – für den Produktivbetrieb wird Windows Server 2019 oder neuer empfohlen.' }
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Ein 64-Bit-Betriebssystem ist erforderlich.' }

    $domain = Get-DomainInfo
    if ($domain) { Write-Ok "Mitglied der Domäne $($domain.Name)" }
    else { Write-Warn 'Der Server ist kein Domänenmitglied. Deploy und Audit benötigen eine Domänenmitgliedschaft.' }

    # PowerShell 7 runs Deploy-/Audit-TierModel.ps1.
    $pwsh = Find-Pwsh
    if ($pwsh) {
        Write-Ok "PowerShell 7 gefunden: $pwsh"
    }
    else {
        Write-Warn 'PowerShell 7 ist nicht installiert (wird für Deploy und Audit benötigt).'
        if (Read-YesNo 'PowerShell 7 jetzt installieren?' $true) {
            $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
            if ($winget) {
                & winget.exe install --id Microsoft.PowerShell --source winget --silent --accept-package-agreements --accept-source-agreements --scope machine
            }
            else {
                $src = Read-Value 'Pfad oder URL zum PowerShell-7-MSI (Enter = aktuelle Version von GitHub laden)' 'github'
                $msi = Join-Path $env:TEMP 'PowerShell-7-win-x64.msi'
                if ($src -eq 'github') {
                    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
                    $rel = Invoke-RestMethod 'https://api.github.com/repos/PowerShell/PowerShell/releases/latest' -UseBasicParsing
                    $asset = $rel.assets | Where-Object { $_.name -match '^PowerShell-[\d\.]+-win-x64\.msi$' } | Select-Object -First 1
                    if (-not $asset) { throw 'PowerShell-MSI nicht gefunden. Bitte manuell installieren: https://aka.ms/powershell' }
                    Invoke-Download $asset.browser_download_url $msi
                }
                elseif ($src -match '^https?://') { Invoke-Download $src $msi }
                else { $msi = $src }
                $p = Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart ADD_PATH=1 ENABLE_PSREMOTING=0 REGISTER_MANIFEST=1" -Wait -PassThru
                if ($p.ExitCode -notin 0, 3010) { throw "Installation von PowerShell 7 fehlgeschlagen (msiexec Code $($p.ExitCode))." }
            }
            $pwsh = Find-Pwsh
            if (-not $pwsh) { throw 'PowerShell 7 wurde nicht gefunden. Bitte manuell installieren und den Installer erneut starten.' }
            Write-Ok "PowerShell 7 installiert: $pwsh"
        }
        else {
            $pwsh = Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe'
            Write-Warn "Es wird $pwsh erwartet. Bis zur Installation schlagen Deploy und Audit fehl."
        }
    }

    # Active Directory and Group Policy modules for the framework.
    $missing = @(@('ActiveDirectory', 'GroupPolicy') | Where-Object { -not (Get-Module -ListAvailable -Name $_) })
    if ($missing.Count -eq 0) {
        Write-Ok 'PowerShell-Module ActiveDirectory und GroupPolicy vorhanden.'
    }
    else {
        Write-Warn "Fehlende Module: $($missing -join ', ')"
        $hasFeature = [bool](Get-Command Install-WindowsFeature -ErrorAction SilentlyContinue)
        $hasCapability = [bool](Get-Command Add-WindowsCapability -ErrorAction SilentlyContinue)
        if (($hasFeature -or $hasCapability) -and (Read-YesNo 'RSAT-Tools für Active Directory und Gruppenrichtlinien jetzt installieren?' $true)) {
            if ($hasFeature) {
                $r = Install-WindowsFeature -Name RSAT-AD-PowerShell, GPMC
                if (-not $r.Success) { throw 'Installation der RSAT-Features fehlgeschlagen.' }
            }
            else {
                Add-WindowsCapability -Online -Name 'Rsat.ActiveDirectory.DS-LDS.Tools~~~~0.0.1.0' | Out-Null
                Add-WindowsCapability -Online -Name 'Rsat.GroupPolicy.Management.Tools~~~~0.0.1.0' | Out-Null
            }
            Write-Ok 'RSAT-Tools installiert.'
        }
        else {
            Write-Warn 'Bitte die RSAT-Tools für Active Directory und Gruppenrichtlinien manuell installieren.'
        }
    }
    return [pscustomobject]@{ Pwsh = $pwsh; Domain = $domain }
}

function Read-Paths {
    Write-Step 'Installationsort'
    # Must be a dedicated folder: the service account gets rights on it and uninstall removes its content.
    $installDir = Read-Value 'Programmverzeichnis (eigener, neuer Ordner)' (Join-Path $env:ProgramFiles 'TierModelService') {
        param($v)
        if (-not (Test-Path $v)) { return $true }
        $items = @(Get-ChildItem $v -Force -ErrorAction SilentlyContinue)
        ($items.Count -eq 0) -or (Test-Path (Join-Path $v 'app\TierModel.Service.exe'))
    } 'Der Ordner existiert und ist nicht leer. Bitte einen neuen oder leeren Ordner angeben.'
    $dataDir = Read-Value 'Datenverzeichnis (Arbeitskopien, Berichte)' (Join-Path $env:ProgramData 'TierModelService')
    return [pscustomobject]@{ InstallDir = $installDir; DataDir = $dataDir }
}

function Install-LocalPostgres {
    param([string]$SuperPassword, [int]$Port)
    $src = Read-Value 'Pfad oder URL zum PostgreSQL-Installer (EDB, Windows x64)' $PostgresInstaller
    $exe = $src
    if ($src -match '^https?://') {
        $exe = Join-Path $env:TEMP ([IO.Path]::GetFileName(([Uri]$src).AbsolutePath))
        try { Invoke-Download $src $exe }
        catch {
            throw "Download fehlgeschlagen ($($_.Exception.Message)). Installer manuell von https://www.enterprisedb.com/downloads/postgres-postgresql-downloads laden und den Pfad angeben."
        }
    }
    if (-not (Test-Path $exe)) { throw "Installer nicht gefunden: $exe" }

    $major = '17'
    if ($exe -match 'postgresql-(\d+)') { $major = $Matches[1] }
    $prefix = Join-Path $env:ProgramFiles "PostgreSQL\$major"
    $dataDir = Join-Path $env:ProgramData "PostgreSQL\$major\data"

    # Pass the superuser password through an option file instead of the command line.
    $optionFile = Join-Path $env:TEMP ('pg-setup-' + [Guid]::NewGuid().ToString('N') + '.ini')
    @(
        'mode=unattended', 'unattendedmodeui=none', "superpassword=$SuperPassword", "serverport=$Port",
        "prefix=$prefix", "datadir=$dataDir", "servicename=postgresql-x64-$major",
        'enable-components=server,commandlinetools', 'disable-components=pgAdmin,stackbuilder'
    ) | Set-Content -Path $optionFile -Encoding ASCII
    & icacls.exe $optionFile /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
    try {
        Write-Info "Installiere PostgreSQL $major (das dauert einige Minuten) …"
        $p = Start-Process -FilePath $exe -ArgumentList "--optionfile `"$optionFile`"" -Wait -PassThru
        if ($p.ExitCode -ne 0) { throw "PostgreSQL-Installation fehlgeschlagen (Code $($p.ExitCode)). Protokoll: $env:TEMP\install-postgresql.log" }
    }
    finally { Remove-Item $optionFile -Force -ErrorAction SilentlyContinue }

    # Local-only database: do not listen on the network.
    $conf = Join-Path $dataDir 'postgresql.conf'
    if (Test-Path $conf) {
        $content = Get-Content $conf
        $content = $content -replace "^\s*#?\s*listen_addresses\s*=.*$", "listen_addresses = 'localhost'"
        # PowerShell 5.1 would write a UTF-8 BOM, which PostgreSQL rejects as a syntax error.
        [IO.File]::WriteAllLines($conf, [string[]]$content, (New-Object Text.UTF8Encoding $false))
        Restart-Service "postgresql-x64-$major"
    }
    Write-Ok "PostgreSQL $major installiert (nur lokal erreichbar, Port $Port)."
}

function Read-Database {
    Write-Step 'Datenbank (PostgreSQL)'
    $existingPg = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1
    $default = 2
    if ($existingPg) {
        Write-Ok "Lokaler PostgreSQL-Dienst gefunden: $($existingPg.Name)"
        $default = 1
    }
    $mode = Read-Choice 'Auswahl' @(
        'Vorhandenen PostgreSQL-Server verwenden – Datenbank und Benutzer automatisch anlegen (Admin-Zugang nötig)',
        'PostgreSQL auf diesem Server installieren (empfohlen, wenn noch keiner vorhanden ist)',
        'Datenbank und Benutzer existieren bereits – nur Verbindungsdaten eingeben'
    ) $default

    $dbHost = 'localhost'; $port = 5432; $ssl = 'Prefer'
    if ($mode -ne 2) {
        $dbHost = Read-Value 'Server (Hostname)' 'localhost'
        $port = [int](Read-Value 'Port' '5432' { param($v) $v -match '^\d{2,5}$' })
        if ($dbHost -notin 'localhost', '127.0.0.1', '::1') {
            $sslChoice = Read-Choice 'Verschlüsselung der Verbindung' @('TLS erforderlich (empfohlen bei entferntem Server)', 'TLS erforderlich und Zertifikat vollständig prüfen', 'TLS wenn verfügbar') 1
            $ssl = @('Require', 'VerifyFull', 'Prefer')[$sslChoice - 1]
        }
    }
    $database = Read-Value 'Name der Datenbank' 'tiermodel' { param($v) $v -cmatch '^[a-z_][a-z0-9_]{0,62}$' } 'Nur Kleinbuchstaben, Ziffern und _.'
    $appUser = Read-Value 'Datenbankbenutzer für den Dienst' 'tiermodel' { param($v) $v -cmatch '^[a-z_][a-z0-9_]{0,62}$' } 'Nur Kleinbuchstaben, Ziffern und _.'

    $appPassword = $null
    if ($mode -eq 3) {
        $appPassword = Read-Secret "Passwort von '$appUser'"
    }
    else {
        $appPassword = New-RandomPassword 32
        Write-Info "Für '$appUser' wird ein zufälliges 32-stelliges Passwort erzeugt und nur geschützt in der Dienstkonfiguration abgelegt."
    }

    $admin = $null
    if ($mode -eq 1) {
        $adminUser = Read-Value 'PostgreSQL-Administrator' 'postgres'
        $admin = [pscustomobject]@{ User = $adminUser; Password = (Read-Secret "Passwort von '$adminUser'") }
    }
    elseif ($mode -eq 2) {
        Write-Info 'Für den PostgreSQL-Superuser "postgres" wird ein Passwort benötigt. Bitte sicher aufbewahren (z. B. im Passwort-Tresor).'
        while ($true) {
            $pgPw = Read-Secret 'Neues Passwort für "postgres" (nur ASCII-Zeichen)' -MinLength 12 -Repeat
            # The EDB installer reads its option file as ASCII.
            if ($pgPw -match '^[\x21-\x7E]+$') { break }
            Write-Warn 'Bitte nur ASCII-Zeichen ohne Leerzeichen verwenden (keine Umlaute).'
        }
        $admin = [pscustomobject]@{ User = 'postgres'; Password = $pgPw }
    }

    # DbConnectionStringBuilder quotes values containing ; ' or " correctly.
    $b = New-Object Data.Common.DbConnectionStringBuilder
    $b['Host'] = $dbHost; $b['Port'] = $port; $b['Database'] = $database; $b['Username'] = $appUser
    $b['Password'] = $appPassword; $b['SSL Mode'] = $ssl
    if ($ssl -eq 'Require') { $b['Trust Server Certificate'] = 'true' }
    $csb = $b.ConnectionString
    return [pscustomobject]@{
        Mode = $mode; Host = $dbHost; Port = $port; Ssl = $ssl; Database = $database; AppUser = $appUser
        AppPassword = $appPassword; Admin = $admin; ConnectionString = $csb
    }
}

# The framework's prerequisite check aborts every run unless the account is (recursively) in Domain Admins.
function Confirm-DomainAdminMembership([string]$SamAccountName) {
    if (-not (Get-Command Get-ADGroupMember -ErrorAction SilentlyContinue)) {
        Write-Info 'Mitgliedschaft in "Domain Admins" kann ohne ActiveDirectory-Modul nicht geprüft werden.'
        return
    }
    try {
        $sid = "$((Get-ADDomain).DomainSID.Value)-512"
        $member = @(Get-ADGroupMember -Identity $sid -Recursive | Where-Object { $_.SamAccountName -eq $SamAccountName })
        if ($member.Count -gt 0) {
            Write-Ok "$SamAccountName ist Mitglied von Domain Admins."
            return
        }
        Write-Warn "$SamAccountName ist NICHT Mitglied von Domain Admins. Das Framework verlangt diese Mitgliedschaft –"
        Write-Warn 'ohne sie schlagen Deploy und Audit bei der Voraussetzungsprüfung fehl.'
        Write-Info "Nachholen mit: Add-ADGroupMember -Identity '$sid' -Members '$SamAccountName'  (danach Dienst neu starten)"
        if (-not (Read-YesNo 'Trotzdem fortfahren?' $true)) { throw 'Abgebrochen: Dienstkonto ohne Domain-Admins-Mitgliedschaft.' }
    }
    catch {
        if ($_.Exception.Message -like 'Abgebrochen:*') { throw }
        Write-Warn "Mitgliedschaft in Domain Admins konnte nicht geprüft werden: $($_.Exception.Message)"
    }
}

function Read-ServiceAccount {
    param($Domain)
    Write-Step 'Dienstkonto'
    Write-Info 'Deploy und Audit laufen unter diesem Konto. Es benötigt die Rechte für das Tier Model im AD'
    Write-Info '(für eine vollständige Bereitstellung Tier-0-Rechte). Der Server wird damit selbst zu einem Tier-0-System.'
    $options = @('Group Managed Service Account (gMSA) – empfohlen', 'Domänenkonto mit Passwort', 'LocalSystem (Computerkonto – nur für Tests)')
    $choice = Read-Choice 'Auswahl' $options 1
    $netbios = 'DOMAIN'
    if ($Domain) { $netbios = $Domain.NetBios }
    switch ($choice) {
        1 {
            $name = Read-Value 'Name des gMSA (ohne Domäne und $)' 'svc-tiermodel' { param($v) $v -notmatch '[\\@]' } 'Nur den Kontonamen angeben, ohne Domäne.'
            $account = "$netbios\$($name.TrimEnd('$'))$"
            if (Get-Command Test-ADServiceAccount -ErrorAction SilentlyContinue) {
                $sam = $name.TrimEnd('$')
                $ready = $false
                try { $ready = [bool](Test-ADServiceAccount -Identity $sam -ErrorAction Stop) } catch { $ready = $false }
                if (-not $ready) {
                    $dnsDomain = 'contoso.com'
                    if ($Domain) { $dnsDomain = $Domain.Name }
                    Write-Warn "Der gMSA '$sam' ist auf diesem Server nicht einsatzbereit (existiert nicht oder dieser Server darf das Passwort nicht abrufen)."
                    Write-Info "Anlegen: New-ADServiceAccount -Name $sam -DNSHostName $sam.$dnsDomain -PrincipalsAllowedToRetrieveManagedPassword '$env:COMPUTERNAME$'"
                    if (Read-YesNo 'Jetzt mit Install-ADServiceAccount auf diesem Server installieren?' $true) {
                        try {
                            Install-ADServiceAccount -Identity $sam -ErrorAction Stop
                            $ready = [bool](Test-ADServiceAccount -Identity $sam -ErrorAction Stop)
                        }
                        catch { Write-Warn $_.Exception.Message }
                        if (-not $ready) { throw "gMSA '$sam' ist nicht nutzbar (anlegen, Berechtigung des Computerkontos prüfen, ggf. Neustart)." }
                    }
                }
                Write-Ok "gMSA $account ist einsatzbereit."
            }
            Confirm-DomainAdminMembership "$($name.TrimEnd('$'))$"
            return [pscustomobject]@{ Kind = 'gMSA'; Account = $account; Password = '' }
        }
        2 {
            $account = Read-Value 'Konto (DOMÄNE\Benutzer)' "$netbios\svc-tiermodel" { param($v) $v -match '^[^\\]+\\[^\\]+$' } 'Format: DOMÄNE\Benutzer'
            $pw = Read-Secret "Passwort von $account"
            if ($Domain) {
                try {
                    Add-Type -AssemblyName System.DirectoryServices.AccountManagement
                    $ctx = New-Object DirectoryServices.AccountManagement.PrincipalContext 'Domain', $Domain.Name
                    if (-not $ctx.ValidateCredentials($account.Split('\')[1], $pw)) { throw 'Anmeldedaten ungültig.' }
                    Write-Ok 'Anmeldedaten geprüft.'
                }
                catch { Write-Warn "Anmeldedaten konnten nicht geprüft werden: $($_.Exception.Message)" }
            }
            Confirm-DomainAdminMembership $account.Split('\')[1]
            return [pscustomobject]@{ Kind = 'User'; Account = $account; Password = $pw }
        }
        default {
            Write-Warn 'LocalSystem nutzt das Computerkonto dieses Servers für AD-Änderungen.'
            Confirm-DomainAdminMembership "$env:COMPUTERNAME$"
            return [pscustomobject]@{ Kind = 'LocalSystem'; Account = 'LocalSystem'; Password = '' }
        }
    }
}

function Read-Web {
    param([int]$InstalledPort = 0)
    Write-Step 'Web-Oberfläche (HTTPS)'
    $fqdn = Get-Fqdn
    $defaultPort = '8443'
    if ($InstalledPort) { $defaultPort = "$InstalledPort" }
    $port = [int](Read-Value 'HTTPS-Port' $defaultPort {
            param($v)
            if ($v -notmatch '^\d{2,5}$' -or [int]$v -gt 65535) { return $false }
            if ([int]$v -eq $InstalledPort) { return $true }   # the running service itself uses it
            -not (Get-NetTCPConnection -LocalPort ([int]$v) -State Listen -ErrorAction SilentlyContinue)
        } 'Ungültiger oder bereits belegter Port.')

    $certs = @(Get-ChildItem Cert:\LocalMachine\My | Where-Object {
            $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date) -and
            (-not $_.EnhancedKeyUsageList -or ($_.EnhancedKeyUsageList.ObjectId -contains '1.3.6.1.5.5.7.3.1'))
        } | Sort-Object NotAfter -Descending)
    $options = @("Neues selbstsigniertes Zertifikat für $fqdn erstellen")
    foreach ($c in $certs) { $options += ('{0}  (gültig bis {1:dd.MM.yyyy}, {2})' -f $c.Subject, $c.NotAfter, $c.Thumbprint.Substring(0, 8)) }
    $default = 1
    $match = 0
    for ($i = 0; $i -lt $certs.Count; $i++) { if ($certs[$i].Subject -like "*$fqdn*" -and $match -eq 0) { $match = $i + 2 } }
    if ($match -gt 0) { $default = $match }
    Write-Info 'Zertifikat (empfohlen: eines Ihrer Unternehmens-CA, damit Browser ihm vertrauen):'
    $choice = Read-Choice 'Auswahl' $options $default
    $cert = $null
    if ($choice -gt 1) { $cert = $certs[$choice - 2] }

    $firewall = Read-YesNo "Firewall-Regel für TCP $port (Profil Domäne) anlegen?" $true
    $remote = 'Any'
    if ($firewall) {
        $remote = Read-Value 'Zugriff erlauben von (Any oder z. B. 10.0.10.0/24,10.0.20.5)' 'Any'
    }
    return [pscustomobject]@{ Fqdn = $fqdn; Port = $port; Certificate = $cert; Firewall = $firewall; RemoteAddress = $remote }
}

function Read-Defaults($Domain) {
    Write-Step 'Standardwerte für Deploy und Audit'
    $dc = ''
    if ($Domain -and $Domain.DomainController) { $dc = $Domain.DomainController }
    $dc = Read-Value 'Bevorzugter Domänencontroller (FQDN)' $dc { param($v) $v -match '^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$' }
    $lang = Read-Value 'ADML-Sprache' 'en-US' { param($v) $v -match '^[a-zA-Z]{2}-[a-zA-Z]{2}$' }
    return [pscustomobject]@{ PreferredDc = $dc; AdmlLanguage = $lang }
}

function Read-AdminAccount {
    Write-Step 'Erstes Administratorkonto der Web-Oberfläche'
    $user = Read-Value 'Benutzername' 'admin' { param($v) $v -match '^[A-Za-z0-9][A-Za-z0-9._@-]{1,63}$' } '2–64 Zeichen: Buchstaben, Ziffern, . _ - @'
    $display = Read-Value 'Anzeigename' $user
    $pw = Read-Secret 'Passwort (mind. 12 Zeichen)' -MinLength 12 -Repeat
    return [pscustomobject]@{ User = $user; Display = $display; Password = $pw }
}

function Write-Settings {
    param([string]$Path, $Db, $Web, $Defaults, [string]$Pwsh, [string]$FrameworkDir, [string]$DataDir)
    $settings = [ordered]@{
        ConnectionStrings = [ordered]@{ TierModel = $Db.ConnectionString }
        TierModel         = [ordered]@{
            FrameworkPath         = $FrameworkDir
            WorkPath              = $DataDir
            PwshPath              = $Pwsh
            DefaultPreferredDc    = $Defaults.PreferredDc
            AdmlLanguage          = $Defaults.AdmlLanguage
            CertificateThumbprint = $Web.Certificate.Thumbprint
            RequireHttps          = $true
        }
        Kestrel           = [ordered]@{ Endpoints = [ordered]@{ Https = [ordered]@{ Url = "https://*:$($Web.Port)" } } }
    }
    $json = $settings | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText($Path, $json, (New-Object Text.UTF8Encoding $false))
}

#endregion

#region ---------- Abläufe ----------

function Install-New {
    param($Existing)
    $pre = Test-Prerequisites
    $paths = Read-Paths
    $appDir = Join-Path $paths.InstallDir 'app'
    $db = Read-Database
    $svc = Read-ServiceAccount $pre.Domain
    $installedPort = 0
    if ($Existing) { $installedPort = Get-InstalledPort $Existing }
    $web = Read-Web -InstalledPort $installedPort
    $defaults = Read-Defaults $pre.Domain
    $admin = Read-AdminAccount

    Write-Step 'Zusammenfassung'
    $dbText = @('vorhandener Server (automatisch einrichten)', 'lokale Installation', 'vorhandene Datenbank')[$db.Mode - 1]
    $certText = 'neu, selbstsigniert'
    if ($web.Certificate) { $certText = $web.Certificate.Subject }
    @(
        @('Programmverzeichnis', $paths.InstallDir), @('Datenverzeichnis', $paths.DataDir),
        @('PostgreSQL', "$dbText – $($db.Host):$($db.Port)/$($db.Database) als $($db.AppUser)"),
        @('Dienstkonto', "$($svc.Account) ($($svc.Kind))"),
        @('Adresse', "https://$($web.Fqdn):$($web.Port)/"), @('Zertifikat', $certText),
        @('Firewall', $(if ($web.Firewall) { "ja, von $($web.RemoteAddress)" } else { 'nein' })),
        @('Domänencontroller', $defaults.PreferredDc), @('PowerShell 7', $pre.Pwsh),
        @('Administrator', $admin.User)
    ) | ForEach-Object { Write-Host ('    {0,-20} {1}' -f $_[0], $_[1]) }
    Write-Host ''
    if (-not (Read-YesNo 'Installation jetzt durchführen?' $true)) { Write-Warn 'Abgebrochen – es wurde nichts verändert.'; return }

    Write-Step 'Installation'
    if ($Existing) { Remove-TierModelService }

    if ($db.Mode -eq 2) {
        Install-LocalPostgres -SuperPassword $db.Admin.Password -Port $db.Port
    }

    foreach ($d in $paths.InstallDir, $paths.DataDir, (Join-Path $paths.DataDir 'logs')) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
    Copy-Payload $paths.InstallDir
    Write-Ok 'Programmdateien kopiert.'

    if ($db.Mode -ne 3) {
        Invoke-ServiceCli -AppDir $appDir -Arguments @('db', 'provision', '--host', $db.Host, '--port', "$($db.Port)", '--ssl-mode', $db.Ssl,
            '--admin-user', $db.Admin.User, '--database', $db.Database, '--app-user', $db.AppUser) -StdinLines @($db.Admin.Password, $db.AppPassword) | Out-Null
        Write-Ok "Datenbank '$($db.Database)' und Benutzer '$($db.AppUser)' eingerichtet."
    }
    Invoke-ServiceCli -AppDir $appDir -Arguments @('db', 'test') -StdinLines @($db.ConnectionString) -Quiet | Out-Null
    Write-Ok 'Verbindung zur Datenbank erfolgreich.'

    if (-not $web.Certificate) {
        $web.Certificate = New-SelfSignedCertificate -DnsName $web.Fqdn, $env:COMPUTERNAME, 'localhost' -CertStoreLocation Cert:\LocalMachine\My `
            -FriendlyName 'TierModel Service' -KeyAlgorithm RSA -KeyLength 3072 -KeyExportPolicy NonExportable -NotAfter (Get-Date).AddYears(3)
        Write-Ok "Selbstsigniertes Zertifikat erstellt ($($web.Certificate.Thumbprint))."
        Write-Info 'Hinweis: Browser zeigen eine Warnung, bis das Zertifikat durch eines der Unternehmens-CA ersetzt wird.'
    }

    $settingsPath = Join-Path $appDir 'appsettings.Production.json'
    if (-not (Test-Path $settingsPath)) { New-Item -ItemType File -Path $settingsPath -Force | Out-Null }
    # Restrict the file BEFORE the connection string is written into it.
    Set-PathAcl -Path $settingsPath -Account $svc.Account -Rights Read -Exclusive
    Write-Settings -Path $settingsPath -Db $db -Web $web -Defaults $defaults -Pwsh $pre.Pwsh -FrameworkDir (Join-Path $paths.InstallDir 'framework') -DataDir $paths.DataDir

    Invoke-ServiceCli -AppDir $appDir -Arguments @('migrate') | Out-Null
    Write-Ok 'Datenbankschema angelegt, Konfiguration des Frameworks importiert.'
    $existingAdmin = $false
    try {
        Invoke-ServiceCli -AppDir $appDir -Arguments @('admin', 'create', '--username', $admin.User, '--display', $admin.Display) -StdinLines @($admin.Password) -Quiet | Out-Null
        Write-Ok "Administrator '$($admin.User)' angelegt."
    }
    catch {
        if ($_.Exception.Message -match 'existiert bereits') { $existingAdmin = $true } else { throw }
    }
    if ($existingAdmin) {
        if (Read-YesNo "Benutzer '$($admin.User)' existiert bereits. Passwort auf das eingegebene zurücksetzen?" $false) {
            Invoke-ServiceCli -AppDir $appDir -Arguments @('admin', 'reset-password', '--username', $admin.User) -StdinLines @($admin.Password) -Quiet | Out-Null
            Write-Ok 'Passwort zurückgesetzt.'
        }
    }

    # Permissions: program read-only, data writable, secrets restricted.
    Set-PathAcl -Path $paths.InstallDir -Account $svc.Account -Rights ReadAndExecute
    Set-PathAcl -Path $paths.DataDir -Account $svc.Account -Rights Modify
    Set-PathAcl -Path $settingsPath -Account $svc.Account -Rights Read -Exclusive
    if ($svc.Kind -ne 'LocalSystem') { Grant-CertificateKeyAccess $web.Certificate $svc.Account }
    Write-Ok 'Dateiberechtigungen gesetzt (Konfiguration mit Zugangsdaten nur für SYSTEM, Administratoren und Dienstkonto lesbar).'

    if (-not [Diagnostics.EventLog]::SourceExists($EventSource)) { [Diagnostics.EventLog]::CreateEventSource($EventSource, 'Application') }

    $exe = Join-Path $appDir $ExeName
    New-Service -Name $ServiceName -BinaryPathName "`"$exe`"" -DisplayName $ServiceDisplayName -Description $ServiceDescription -StartupType Automatic | Out-Null
    & sc.exe config $ServiceName start= delayed-auto | Out-Null
    & sc.exe failure $ServiceName reset= 86400 actions= restart/60000/restart/60000/restart/300000 | Out-Null
    if ($svc.Kind -ne 'LocalSystem') {
        Grant-LogonAsService $svc.Account
        $wmi = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
        $r = Invoke-CimMethod -InputObject $wmi -MethodName Change -Arguments @{ StartName = $svc.Account; StartPassword = $svc.Password }
        if ($r.ReturnValue -ne 0) { throw "Dienstkonto konnte nicht gesetzt werden (Win32_Service.Change Code $($r.ReturnValue))." }
    }
    Write-Ok "Dienst '$ServiceDisplayName' registriert (Autostart verzögert, Neustart bei Fehlern)."

    if ($web.Firewall) {
        Remove-NetFirewallRule -Name $FirewallRuleName -ErrorAction SilentlyContinue
        $remote = @($web.RemoteAddress -split '\s*,\s*' | Where-Object { $_ })
        New-NetFirewallRule -Name $FirewallRuleName -DisplayName "TierModel Service (HTTPS $($web.Port))" -Direction Inbound -Protocol TCP `
            -LocalPort $web.Port -Action Allow -Profile Domain -RemoteAddress $remote | Out-Null
        Write-Ok 'Firewall-Regel angelegt.'
    }

    Start-Service $ServiceName
    Write-Info 'Warte auf den Start des Dienstes …'
    if (Wait-ServiceHealthy -Port $web.Port) {
        Write-Step 'Fertig'
        Write-Ok 'Der TierModel Service läuft.'
        Write-Host ''
        Write-Host "    ➜  https://$($web.Fqdn):$($web.Port)/" -ForegroundColor Green
        Write-Host "       Anmeldung mit '$($admin.User)'" -ForegroundColor Gray
        Write-Host ''
        Write-Info "Konfiguration: $settingsPath"
        Write-Info "Aktualisieren oder deinstallieren: $(Join-Path $paths.InstallDir 'Setup.cmd')"
    }
    else {
        Write-Err 'Der Dienst antwortet nicht.'
        Show-RecentServiceErrors
    }
}

function Update-Existing($State) {
    Write-Step "Aktualisierung von Version $($State.Version) auf $(Get-PackageVersion)"
    if (Test-RunningFromInstallDir $State.InstallDir) {
        throw 'Zum Aktualisieren bitte Setup.cmd aus dem entpackten NEUEN Paket starten, nicht aus dem Installationsverzeichnis.'
    }
    if (-not (Test-Path $State.Settings)) { throw "Konfiguration $($State.Settings) fehlt – bitte 'Neu konfigurieren' wählen." }
    $port = Get-InstalledPort $State
    $framework = Join-Path $State.InstallDir 'framework'
    $backups = @{ $State.AppDir = "$($State.AppDir).bak"; $framework = "$framework.bak" }

    Write-Info 'Stoppe den Dienst …'
    Stop-Service $ServiceName -ErrorAction SilentlyContinue
    (Get-Service $ServiceName).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60))
    foreach ($src in $backups.Keys) {
        if (Test-Path $backups[$src]) { Remove-Item $backups[$src] -Recurse -Force }
        if (Test-Path $src) { Copy-Item $src $backups[$src] -Recurse }
    }
    # Copy-Item does not copy ACLs: re-protect the copied secrets.
    $backupSettings = Join-Path $backups[$State.AppDir] 'appsettings.Production.json'
    $account = $State.Account
    if ($account -eq 'LocalSystem') { $account = $null }
    if (Test-Path $backupSettings) { Set-PathAcl -Path $backupSettings -Account $account -Rights Read -Exclusive }
    Write-Ok 'Sicherung der bisherigen Version angelegt (app.bak, framework.bak).'

    try {
        Copy-Payload $State.InstallDir
        Invoke-ServiceCli -AppDir $State.AppDir -Arguments @('migrate') | Out-Null
        Write-Ok 'Programmdateien und Datenbankschema aktualisiert.'
        Start-Service $ServiceName
        if (-not (Wait-ServiceHealthy -Port $port)) { throw 'Der Dienst antwortet nach der Aktualisierung nicht.' }
        foreach ($b in $backups.Values) { Remove-Item $b -Recurse -Force -ErrorAction SilentlyContinue }
        Write-Ok "Aktualisierung abgeschlossen: https://$(Get-Fqdn):$port/"
    }
    catch {
        Write-Err $_.Exception.Message
        Show-RecentServiceErrors
        if (Read-YesNo 'Vorherige Programmversion wiederherstellen?' $true) {
            Stop-Service $ServiceName -ErrorAction SilentlyContinue
            foreach ($src in $backups.Keys) {
                if (-not (Test-Path $backups[$src])) { continue }
                if (Test-Path $src) { Remove-Item $src -Recurse -Force }
                Rename-Item $backups[$src] (Split-Path $src -Leaf)
            }
            Start-Service $ServiceName
            Write-Warn 'Vorherige Version wiederhergestellt. Hinweis: Eine bereits durchgeführte Schemaänderung bleibt bestehen.'
        }
    }
}

function Uninstall-Service($State) {
    Write-Step 'Deinstallation'
    if (-not $State) { Write-Warn 'Der TierModel Service ist nicht installiert.'; return }
    if (-not (Read-YesNo "TierModel Service aus $($State.InstallDir) entfernen?" $false)) { return }
    $dbName = 'tiermodel'; $dbUser = 'tiermodel'
    try {
        $cs = (Get-Content $State.Settings -Raw | ConvertFrom-Json).ConnectionStrings.TierModel
        if ($cs -match '(?i)(^|;)\s*Database=([^;]+)') { $dbName = $Matches[2] }
        if ($cs -match '(?i)(^|;)\s*Username=([^;]+)') { $dbUser = $Matches[2] }
    }
    catch { }
    Remove-TierModelService
    Remove-NetFirewallRule -Name $FirewallRuleName -ErrorAction SilentlyContinue
    Write-Ok 'Dienst und Firewall-Regel entfernt.'
    if (Read-YesNo "Programmdateien in $($State.InstallDir) löschen?" $true) {
        Set-Location $env:SystemRoot   # the folder cannot be deleted while it is the current directory
        # Only what the installer put there – never the whole folder, it may have been an existing one.
        $owned = 'app', 'app.bak', 'framework', 'framework.bak', 'Install-TierModelService.ps1', 'Setup.cmd', 'VERSION'
        foreach ($item in $owned) {
            $path = Join-Path $State.InstallDir $item
            if (Test-Path $path) { Remove-Item $path -Recurse -Force -ErrorAction SilentlyContinue }
        }
        $left = @(Get-ChildItem $State.InstallDir -Force -ErrorAction SilentlyContinue)
        if ($left.Count -eq 0) { Remove-Item $State.InstallDir -Force -ErrorAction SilentlyContinue }
        if (Test-Path (Join-Path $State.InstallDir 'app')) { Write-Warn "Einige Dateien sind noch in Benutzung und bleiben in $($State.InstallDir) (nach einem Neustart löschen)." }
        else { Write-Ok 'Programmdateien gelöscht.' }
    }
    Write-Info 'Die PostgreSQL-Datenbank (Konfiguration, Historie, Benutzer) und das Datenverzeichnis bleiben erhalten.'
    Write-Info "Bei Bedarf manuell entfernen: DROP DATABASE $dbName; DROP ROLE $dbUser;"

}

#endregion

# ---------- Einstieg ----------

if (-not (Test-IsAdmin)) {
    Write-Host 'Administratorrechte werden angefordert …' -ForegroundColor Yellow
    $argList = @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', "`"$PSCommandPath`"")
    if ($Uninstall) { $argList += '-Uninstall' }
    if ($PSBoundParameters.ContainsKey('PostgresInstaller')) { $argList += @('-PostgresInstaller', "`"$PostgresInstaller`"") }
    Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList $argList -Verb RunAs
    exit 0
}

$exitCode = 0
$transcriptDir = Join-Path $env:ProgramData 'TierModelService\logs'
New-Item -ItemType Directory -Path $transcriptDir -Force | Out-Null
$transcript = Join-Path $transcriptDir ('setup-{0:yyyyMMdd-HHmmss}.log' -f (Get-Date))
Start-Transcript -Path $transcript | Out-Null

try {
    # Files extracted from a downloaded ZIP carry the "from the internet" mark.
    Get-ChildItem $PackageRoot -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
    Write-Banner
    $state = Get-InstalledState
    if ($Uninstall) {
        Uninstall-Service $state
    }
    elseif ($state) {
        Write-Ok "Installiert: Version $($state.Version) in $($state.InstallDir) (Dienst: $($state.Service.State), Konto: $($state.Account))"
        Write-Host ''
        $choice = Read-Choice 'Was möchten Sie tun?' @(
            "Aktualisieren auf Version $(Get-PackageVersion) (Einstellungen und Daten bleiben erhalten)",
            'Neu konfigurieren (Assistent erneut durchlaufen)',
            'Deinstallieren',
            'Beenden'
        ) 1
        switch ($choice) {
            1 { Update-Existing $state }
            2 { Install-New -Existing $state }
            3 { Uninstall-Service $state }
        }
    }
    else {
        Write-Info 'Dieser Assistent richtet den TierModel Service vollständig ein. Alle Eingaben haben sinnvolle'
        Write-Info 'Vorgaben in [eckigen Klammern] – Enter übernimmt sie. Vor der Installation folgt eine Zusammenfassung.'
        Install-New
    }
}
catch {
    Write-Host ''
    Write-Err "Fehler: $($_.Exception.Message)"
    Write-Info "Protokoll: $transcript"
    $exitCode = 1
}
finally {
    Stop-Transcript | Out-Null
}
exit $exitCode
