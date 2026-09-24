function Export-TierModelPrivilegedSnapshot {
    <#
    .SYNOPSIS
    Writes a privileged access snapshot to a JSON file (UTF-8 without BOM).

    .DESCRIPTION
    Serializes the object returned by Get-TierModelPrivilegedSnapshot with ConvertTo-Json -Depth 10. The
    snapshot already uses camelCase keys, real arrays (also for 0 or 1 elements), ISO-8601 UTC timestamps
    and $null for unknown values, so the file matches the contract read by the TierModel service. The
    target directory is created when missing. Returns the full path of the written file.

    .PARAMETER Snapshot
    Snapshot from Get-TierModelPrivilegedSnapshot.

    .PARAMETER Path
    Target file path (relative paths are resolved against the current location).

    .EXAMPLE
    Get-TierModelPrivilegedSnapshot -DomainController dc01.contoso.com | Export-TierModelPrivilegedSnapshot -Path .\privileged.json
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory, ValueFromPipeline)]
        [ValidateNotNull()]
        [System.Collections.IDictionary]$Snapshot,

        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Path
    )

    process {
        $fullPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
        $directory = Split-Path -Path $fullPath -Parent
        if ($directory -and -not (Test-Path -LiteralPath $directory)) {
            New-Item -ItemType Directory -Path $directory -Force | Out-Null
        }
        $json = ConvertTo-Json -InputObject $Snapshot -Depth 10
        [System.IO.File]::WriteAllText($fullPath, $json, (New-Object System.Text.UTF8Encoding($false)))
        return $fullPath
    }
}
