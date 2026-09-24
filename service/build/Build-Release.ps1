<#
.SYNOPSIS
    Builds the installable release package: TierModelService-<version>.zip

.DESCRIPTION
    1. Builds the web UI (service/web → wwwroot)
    2. Publishes the service self-contained for win-x64 (no .NET runtime needed on the server)
    3. Adds the PowerShell framework (Deploy/Audit scripts, modules, config) and the installer
    4. Zips everything into service/artifacts/

    Runs on Windows, Linux or macOS with PowerShell 7, the .NET 10 SDK and Node.js 20+.
#>
[CmdletBinding()]
param(
    [string]$Version = (Get-Content (Join-Path $PSScriptRoot '..' 'VERSION') -Raw).Trim(),
    [switch]$SkipWeb
)

$ErrorActionPreference = 'Stop'
$serviceRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$repoRoot = Resolve-Path (Join-Path $serviceRoot '..')
$artifacts = Join-Path $serviceRoot 'artifacts'
$name = "TierModelService-$Version"
$staging = Join-Path $artifacts $name

function Invoke-Checked([string]$File, [string[]]$Arguments, [string]$WorkingDirectory) {
    Push-Location $WorkingDirectory
    try {
        & $File @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$File $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
    }
    finally { Pop-Location }
}

if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging -Force | Out-Null

if (-not $SkipWeb) {
    Write-Host '==> Web UI' -ForegroundColor Cyan
    $web = Join-Path $serviceRoot 'web'
    Invoke-Checked npm @('ci', '--no-audit', '--no-fund') $web
    Invoke-Checked npm @('run', 'build') $web
}
if (-not (Test-Path (Join-Path $serviceRoot 'src/TierModel.Service/wwwroot/index.html'))) {
    throw 'wwwroot/index.html fehlt – Web UI zuerst bauen (ohne -SkipWeb).'
}

Write-Host '==> Service (win-x64, self-contained)' -ForegroundColor Cyan
Invoke-Checked dotnet @(
    'publish', 'src/TierModel.Service/TierModel.Service.csproj',
    '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true',
    '-o', (Join-Path $staging 'app'),
    "-p:Version=$Version", '-p:DebugType=none', '-p:GenerateDocumentationFile=false'
) $serviceRoot
Remove-Item (Join-Path $staging 'app/appsettings.Development.json') -ErrorAction SilentlyContinue

Write-Host '==> Framework' -ForegroundColor Cyan
$framework = New-Item -ItemType Directory -Path (Join-Path $staging 'framework') -Force
foreach ($f in 'Deploy-TierModel.ps1', 'Audit-TierModel.ps1', 'LICENSE') {
    Copy-Item (Join-Path $repoRoot $f) $framework
}
foreach ($d in 'modules', 'config') {
    Copy-Item (Join-Path $repoRoot $d) (Join-Path $framework $d) -Recurse
}

Write-Host '==> Installer' -ForegroundColor Cyan
Copy-Item (Join-Path $serviceRoot 'installer/Install-TierModelService.ps1') $staging
Copy-Item (Join-Path $serviceRoot 'installer/README.txt') $staging
# cmd.exe needs CRLF line endings, regardless of how the repository was checked out.
$cmd = (Get-Content (Join-Path $serviceRoot 'installer/Setup.cmd') -Raw) -replace "`r?`n", "`r`n"
[IO.File]::WriteAllText((Join-Path $staging 'Setup.cmd'), $cmd, [Text.Encoding]::ASCII)
Set-Content -Path (Join-Path $staging 'VERSION') -Value $Version -NoNewline

$zip = Join-Path $artifacts "$name.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $staging -DestinationPath $zip -CompressionLevel Optimal
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash
Set-Content -Path "$zip.sha256" -Value "$hash  $name.zip"

Write-Host ''
Write-Host "Paket: $zip" -ForegroundColor Green
Write-Host "SHA256: $hash"
