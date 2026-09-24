#Requires -Version 7.2
Set-StrictMode -Version Latest

# Connection of this session: base URI, token (SecureString), certificate check.
$script:Connection = $null

$script:FinalStatuses = @('Succeeded', 'Failed', 'Cancelled', 'Rejected')
$script:Scopes = @('FullDeployment', 'OuOnly', 'GroupOnly', 'UserOnly', 'GposOnly', 'OuAclsOnly', 'AdmxOnly', 'AuthSilosOnly')

function Assert-Connected {
    if ($null -eq $script:Connection) {
        throw 'Keine Verbindung. Zuerst Connect-TierModelService -Uri <Adresse> -Token <API-Token> ausführen.'
    }
}

function Get-ProblemMessage {
    param([System.Management.Automation.ErrorRecord]$ErrorRecord)
    $status = $null
    try { $status = [int]$ErrorRecord.Exception.Response.StatusCode } catch { }
    $text = $ErrorRecord.ErrorDetails.Message
    if ($text) {
        try {
            $problem = $text | ConvertFrom-Json -ErrorAction Stop
            $parts = @()
            if ($problem.PSObject.Properties['title'] -and $problem.title) { $parts += $problem.title }
            if ($problem.PSObject.Properties['detail'] -and $problem.detail) { $parts += $problem.detail }
            if ($problem.PSObject.Properties['errors'] -and $problem.errors) {
                foreach ($p in $problem.errors.PSObject.Properties) { $parts += ($p.Value -join ' ') }
            }
            if ($parts) { $text = $parts -join ' – ' }
        }
        catch { }
    }
    if (-not $text) { $text = $ErrorRecord.Exception.Message }
    if ($status) { return "HTTP $status`: $text" }
    return $text
}

function Invoke-TierModelApi {
    # Private helper: every request carries the token in the Authorization header (never in the URL).
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [ValidateSet('GET', 'POST', 'PUT', 'DELETE')][string]$Method = 'GET',
        [object]$Body,
        [hashtable]$Query
    )
    Assert-Connected
    $uri = $script:Connection.Uri + $Path
    if ($Query) {
        $pairs = foreach ($k in $Query.Keys) {
            if ($null -ne $Query[$k] -and "$($Query[$k])" -ne '') { '{0}={1}' -f [uri]::EscapeDataString($k), [uri]::EscapeDataString("$($Query[$k])") }
        }
        if ($pairs) { $uri += '?' + ($pairs -join '&') }
    }
    $params = @{
        Uri            = $uri
        Method         = $Method
        Authentication = 'Bearer'
        Token          = $script:Connection.Token
        Headers        = @{ Accept = 'application/json' }
        ErrorAction    = 'Stop'
    }
    if ($script:Connection.SkipCertificateCheck) { $params.SkipCertificateCheck = $true }
    # Plain HTTP only for development setups; Invoke-RestMethod refuses tokens over HTTP otherwise.
    if ($script:Connection.Uri.StartsWith('http://', [StringComparison]::OrdinalIgnoreCase)) { $params.AllowUnencryptedAuthentication = $true }
    if ($PSBoundParameters.ContainsKey('Body')) {
        $params.ContentType = 'application/json; charset=utf-8'
        $params.Body = ($Body | ConvertTo-Json -Depth 10 -Compress)
    }
    try {
        Invoke-RestMethod @params
    }
    catch {
        throw (Get-ProblemMessage $_)
    }
}

function ConvertTo-RunRequest {
    param([string]$PreferredDc, [string]$Scope, [bool]$Msa, [bool]$Gmsa, [bool]$Dmsa, [bool]$WinLaps, [string]$AdmlLanguage)
    $r = [ordered]@{
        preferredDc    = $PreferredDc
        scope          = if ($Scope) { $Scope } else { $null }
        includeMsa     = $Msa
        includeGmsa    = $Gmsa
        includeDmsa    = $Dmsa
        includeWinLaps = $WinLaps
    }
    if ($AdmlLanguage) { $r.admlLanguage = $AdmlLanguage }
    $r
}

function Add-RunType {
    param([Parameter(ValueFromPipeline)]$Run)
    process {
        if ($null -ne $Run) {
            $Run.PSObject.TypeNames.Insert(0, 'TierModel.Service.Run')
            $Run
        }
    }
}

<#
.SYNOPSIS
    Verbindet die PowerShell-Sitzung mit dem TierModel Service.
.DESCRIPTION
    Speichert Adresse und API-Token für die weiteren Befehle dieses Moduls und prüft die Verbindung
    (GET /api/auth/me). API-Tokens werden in der Oberfläche unter Benutzermenü › API-Tokens erstellt.
    Das Token wird nur im Header "Authorization: Bearer" übertragen.
.PARAMETER Uri
    Adresse des Dienstes, z. B. https://tiermodel01.contoso.com:8443
.PARAMETER Token
    API-Token (tmk_…) als SecureString (empfohlen) oder als Zeichenkette.
.PARAMETER SkipCertificateCheck
    Zertifikatsprüfung überspringen (nur für Tests mit selbstsignierten Zertifikaten).
.EXAMPLE
    Connect-TierModelService -Uri https://tiermodel01.contoso.com:8443 -Token (Read-Host -AsSecureString 'Token')
.EXAMPLE
    Connect-TierModelService -Uri https://tiermodel01 -Token (Get-Secret TierModelToken)
.OUTPUTS
    Objekt mit Uri, Benutzer und Rolle.
#>
function Connect-TierModelService {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Uri,
        [Parameter(Mandatory)][ValidateNotNull()][object]$Token,
        [switch]$SkipCertificateCheck
    )
    $secure = if ($Token -is [securestring]) { $Token }
    elseif ($Token -is [string]) { ConvertTo-SecureString -String $Token -AsPlainText -Force }
    else { throw 'Das Token muss ein SecureString oder eine Zeichenkette sein.' }

    $plain = ConvertFrom-SecureString -SecureString $secure -AsPlainText
    if ($plain -notmatch '^tmk_[a-z0-9]{8}_[A-Za-z0-9_-]{43}$') {
        throw 'Das Token hat nicht das erwartete Format (tmk_<Präfix>_<Geheimnis>).'
    }
    $parsed = [uri]$Uri.Trim()
    if (-not $parsed.IsAbsoluteUri -or $parsed.Scheme -notin 'http', 'https') {
        throw "Ungültige Adresse '$Uri'. Beispiel: https://tiermodel01.contoso.com:8443"
    }
    if ($parsed.Scheme -eq 'http' -and -not $parsed.IsLoopback) {
        Write-Warning 'Die Verbindung ist nicht verschlüsselt (http). Das Token wird im Klartext übertragen – nur für Testumgebungen.'
    }
    $previous = $script:Connection
    $script:Connection = [pscustomobject]@{
        Uri                  = $parsed.GetLeftPart([UriPartial]::Authority) + $parsed.AbsolutePath.TrimEnd('/')
        Token                = $secure
        SkipCertificateCheck = [bool]$SkipCertificateCheck
        User                 = $null
        Role                 = $null
    }
    try {
        $me = Invoke-TierModelApi -Path '/api/auth/me'
    }
    catch {
        $script:Connection = $previous
        throw "Verbindung zu $Uri fehlgeschlagen: $_"
    }
    if ($null -eq $me.user) {
        $script:Connection = $previous
        throw 'Der Dienst hat das Token nicht akzeptiert.'
    }
    $script:Connection.User = $me.user.username
    $script:Connection.Role = $me.user.role
    [pscustomobject]@{
        Uri  = $script:Connection.Uri
        User = $me.user.username
        Role = $me.user.role
    }
}

<#
.SYNOPSIS
    Beendet die Verbindung zum TierModel Service (vergisst Adresse und Token).
.EXAMPLE
    Disconnect-TierModelService
#>
function Disconnect-TierModelService {
    [CmdletBinding()]
    param()
    $script:Connection = $null
}

<#
.SYNOPSIS
    Liest Läufe (Deploy, Audit, Überwachung).
.DESCRIPTION
    Ohne -Id: Liste der neuesten Läufe, optional gefiltert nach Art und Status.
    Mit -Id: ein Lauf mit Details (Befunde, Planung, Konfigurationsversionen).
.PARAMETER Id
    Nummer des Laufs.
.PARAMETER Kind
    Deploy, Audit oder Monitor.
.PARAMETER Status
    z. B. Queued, Running, Succeeded, Failed, Scheduled, AwaitingApproval.
.PARAMETER First
    Anzahl der Läufe (1–200, Standard 25).
.EXAMPLE
    Get-TierModelRun -Kind Audit -Status Failed
.EXAMPLE
    Get-TierModelRun -Id 42 | Select-Object -ExpandProperty findings
#>
function Get-TierModelRun {
    [CmdletBinding(DefaultParameterSetName = 'List')]
    param(
        [Parameter(Mandatory, ParameterSetName = 'Id', ValueFromPipelineByPropertyName, Position = 0)][long]$Id,
        [Parameter(ParameterSetName = 'List')][ValidateSet('Deploy', 'Audit', 'Monitor')][string]$Kind,
        [Parameter(ParameterSetName = 'List')]
        [ValidateSet('Queued', 'Running', 'Succeeded', 'Failed', 'Cancelled', 'AwaitingApproval', 'Rejected', 'Scheduled')][string]$Status,
        [Parameter(ParameterSetName = 'List')][ValidateRange(1, 200)][int]$First = 25
    )
    process {
        if ($PSCmdlet.ParameterSetName -eq 'Id') {
            Invoke-TierModelApi -Path "/api/runs/$Id" | Add-RunType
        }
        else {
            $page = Invoke-TierModelApi -Path '/api/runs' -Query @{ kind = $Kind; status = $Status; pageSize = $First }
            $page.items | Add-RunType
        }
    }
}

<#
.SYNOPSIS
    Startet ein Audit (Vergleich des AD mit der Soll-Konfiguration).
.PARAMETER PreferredDc
    Domain Controller (FQDN).
.PARAMETER Scope
    Bereich, z. B. FullDeployment, OuOnly, GroupOnly, GposOnly.
.PARAMETER IncludeMsa
    Add-on MSA (nur mit FullDeployment oder ohne Bereich). Entsprechend -IncludeGmsa, -IncludeDmsa, -IncludeWinLaps.
.PARAMETER AdmlLanguage
    Sprache der ADML-Dateien (z. B. de-DE); Standard aus den Einstellungen.
.EXAMPLE
    Start-TierModelAudit -PreferredDc dc01.contoso.local -Scope FullDeployment | Wait-TierModelRun
.OUTPUTS
    Der eingereihte Lauf.
#>
function Start-TierModelAudit {
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(Mandatory)][string]$PreferredDc,
        [ValidateScript({ $_ -in $script:Scopes })][string]$Scope = 'FullDeployment',
        [switch]$IncludeMsa, [switch]$IncludeGmsa, [switch]$IncludeDmsa, [switch]$IncludeWinLaps,
        [string]$AdmlLanguage
    )
    $body = ConvertTo-RunRequest $PreferredDc $Scope $IncludeMsa $IncludeGmsa $IncludeDmsa $IncludeWinLaps $AdmlLanguage
    if ($PSCmdlet.ShouldProcess($PreferredDc, "Audit ($Scope) starten")) {
        Invoke-TierModelApi -Path '/api/runs/audit' -Method POST -Body $body | Add-RunType
    }
}

<#
.SYNOPSIS
    Startet eine Überwachung der privilegierten Gruppen (Rolle Operator).
.PARAMETER PreferredDc
    Domain Controller (FQDN).
.EXAMPLE
    Start-TierModelMonitor -PreferredDc dc01.contoso.local | Wait-TierModelRun
#>
function Start-TierModelMonitor {
    [CmdletBinding(SupportsShouldProcess)]
    param([Parameter(Mandatory)][string]$PreferredDc)
    if ($PSCmdlet.ShouldProcess($PreferredDc, 'Überwachung der privilegierten Gruppen starten')) {
        Invoke-TierModelApi -Path '/api/runs/monitor' -Method POST -Body @{ preferredDc = $PreferredDc } | Add-RunType
    }
}

<#
.SYNOPSIS
    Startet einen Planungslauf (WhatIf) oder wendet eine geprüfte Planung an.
.DESCRIPTION
    -Plan startet einen Planungslauf, der nichts verändert.
    -Apply wendet das Ergebnis eines erfolgreichen Planungslaufs an (-PlanRunId). Bereich, DC, Add-ons und
    Konfigurationsversionen werden aus der Planung übernommen. Je nach Einstellungen wird der Lauf zur Freigabe
    eingereicht (Vier-Augen-Prinzip) oder bis zum nächsten Wartungsfenster geplant (Status Scheduled);
    in einer Sperrzeit wird er abgelehnt. Erfordert die Rolle Operator.
.PARAMETER Plan
    Planungslauf starten.
.PARAMETER Apply
    Geprüfte Planung anwenden.
.PARAMETER PlanRunId
    Nummer des erfolgreichen Planungslaufs, der angewendet werden soll.
.EXAMPLE
    $plan = Start-TierModelDeploy -Plan -PreferredDc dc01.contoso.local -Scope GroupOnly | Wait-TierModelRun
    Start-TierModelDeploy -Apply -PlanRunId $plan.id -Confirm:$false
#>
function Start-TierModelDeploy {
    [CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High', DefaultParameterSetName = 'Plan')]
    param(
        [Parameter(Mandatory, ParameterSetName = 'Plan')][switch]$Plan,
        [Parameter(Mandatory, ParameterSetName = 'Plan')][string]$PreferredDc,
        [Parameter(ParameterSetName = 'Plan')][ValidateScript({ $_ -in $script:Scopes })][string]$Scope = 'FullDeployment',
        [Parameter(ParameterSetName = 'Plan')][switch]$IncludeMsa,
        [Parameter(ParameterSetName = 'Plan')][switch]$IncludeGmsa,
        [Parameter(ParameterSetName = 'Plan')][switch]$IncludeDmsa,
        [Parameter(ParameterSetName = 'Plan')][switch]$IncludeWinLaps,
        [Parameter(ParameterSetName = 'Plan')][string]$AdmlLanguage,
        [Parameter(Mandatory, ParameterSetName = 'Apply')][switch]$Apply,
        [Parameter(Mandatory, ParameterSetName = 'Apply')][long]$PlanRunId
    )
    if ($PSCmdlet.ParameterSetName -eq 'Plan') {
        $body = ConvertTo-RunRequest $PreferredDc $Scope $IncludeMsa $IncludeGmsa $IncludeDmsa $IncludeWinLaps $AdmlLanguage
        $body.confirmApply = $false
        # A planning run changes nothing: no confirmation needed.
        return Invoke-TierModelApi -Path '/api/runs/deploy' -Method POST -Body $body | Add-RunType
    }

    $planRun = Invoke-TierModelApi -Path "/api/runs/$PlanRunId"
    if ($planRun.kind -ne 'Deploy' -or $planRun.mode -ne 'Plan') { throw "Lauf #$PlanRunId ist kein Planungslauf." }
    if ($planRun.status -ne 'Succeeded') { throw "Planungslauf #$PlanRunId ist nicht erfolgreich abgeschlossen (Status $($planRun.status))." }
    $includes = @($planRun.includes)
    $body = ConvertTo-RunRequest $planRun.preferredDc $planRun.scope ('Msa' -in $includes) ('Gmsa' -in $includes) ('Dmsa' -in $includes) ('WinLaps' -in $includes) $planRun.admlLanguage
    $body.confirmApply = $true
    $body.planRunId = $PlanRunId
    $what = "Planung #$PlanRunId über $($planRun.preferredDc) ($($planRun.scope))"
    if ($PSCmdlet.ShouldProcess($what, 'Änderungen im Active Directory anwenden')) {
        Invoke-TierModelApi -Path '/api/runs/deploy' -Method POST -Body $body | Add-RunType
    }
}

<#
.SYNOPSIS
    Wartet, bis ein Lauf beendet ist, und gibt ihn zurück.
.DESCRIPTION
    Fragt den Status regelmäßig ab und zeigt den Fortschritt an. Beendet ist ein Lauf mit Status
    Succeeded, Failed, Cancelled oder Rejected. Läufe mit Status Scheduled (Wartungsfenster) oder
    AwaitingApproval (Freigabe) werden ebenfalls abgewartet – bis zum Timeout.
.PARAMETER Id
    Nummer des Laufs; nimmt auch Objekte aus der Pipeline an (Eigenschaft id).
.PARAMETER TimeoutSeconds
    Maximale Wartezeit (Standard 3600 Sekunden, 0 = unbegrenzt).
.PARAMETER PollSeconds
    Abfrageintervall (Standard 3 Sekunden).
.EXAMPLE
    Start-TierModelAudit -PreferredDc dc01 | Wait-TierModelRun | Select-Object status, driftCount
#>
function Wait-TierModelRun {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, ValueFromPipelineByPropertyName, Position = 0)][long]$Id,
        [ValidateRange(0, [int]::MaxValue)][int]$TimeoutSeconds = 3600,
        [ValidateRange(1, 300)][int]$PollSeconds = 3
    )
    process {
        $started = [datetime]::UtcNow
        $activity = "TierModel-Lauf #$Id"
        try {
            while ($true) {
                $run = Invoke-TierModelApi -Path "/api/runs/$Id"
                if ($run.status -in $script:FinalStatuses) {
                    return $run | Add-RunType
                }
                $elapsed = [int]([datetime]::UtcNow - $started).TotalSeconds
                $text = switch ($run.status) {
                    'Scheduled' { "Geplant für $(([datetimeoffset]$run.scheduledFor).LocalDateTime) (Wartungsfenster)" }
                    'AwaitingApproval' { 'Wartet auf Freigabe' }
                    'Queued' { 'In Warteschlange' }
                    default { "Läuft seit $elapsed s" }
                }
                Write-Progress -Activity $activity -Status $text -SecondsRemaining ($(if ($TimeoutSeconds) { [math]::Max(0, $TimeoutSeconds - $elapsed) } else { -1 }))
                if ($TimeoutSeconds -gt 0 -and $elapsed -ge $TimeoutSeconds) {
                    throw "Zeitüberschreitung: Lauf #$Id hat nach $TimeoutSeconds s noch Status $($run.status)."
                }
                Start-Sleep -Seconds $PollSeconds
            }
        }
        finally {
            Write-Progress -Activity $activity -Completed
        }
    }
}

<#
.SYNOPSIS
    Liest das Protokoll eines Laufs.
.PARAMETER Id
    Nummer des Laufs.
.PARAMETER After
    Nur Zeilen nach dieser Zeilennummer (seq).
.EXAMPLE
    Get-TierModelRunLog -Id 42 | Where-Object level -eq 'error'
.OUTPUTS
    Zeilen mit seq, at, stream, level und text.
#>
function Get-TierModelRunLog {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, ValueFromPipelineByPropertyName, Position = 0)][long]$Id,
        [int]$After = 0
    )
    process {
        $next = $After
        while ($true) {
            $page = Invoke-TierModelApi -Path "/api/runs/$Id/log" -Query @{ after = $next }
            $lines = @($page.lines)
            if ($lines.Count -eq 0) { break }
            $lines
            $next = $lines[-1].seq
            if ($lines.Count -lt 2000) { break }
        }
    }
}

<#
.SYNOPSIS
    Übersicht der privilegierten Gruppen aus der letzten Überwachung (Mitglieder, Hygiene, Angriffspfade).
.EXAMPLE
    (Get-TierModelPrivileged).groups | Select-Object name, memberCount
#>
function Get-TierModelPrivileged {
    [CmdletBinding()]
    param()
    Invoke-TierModelApi -Path '/api/privileged'
}

<#
.SYNOPSIS
    Compliance-Wert mit Aufschlüsselung und Verlauf.
.EXAMPLE
    (Get-TierModelCompliance).score
#>
function Get-TierModelCompliance {
    [CmdletBinding()]
    param()
    Invoke-TierModelApi -Path '/api/compliance'
}

<#
.SYNOPSIS
    Liest eine Sektion der Soll-Konfiguration (z. B. ous, groups, users, acls, gpos).
.PARAMETER Key
    Schlüssel der Sektion.
.EXAMPLE
    (Get-TierModelConfigSection -Key groups).Content.groups | Select-Object name, tier
.OUTPUTS
    Objekt mit Key, Version, UpdatedAt, UpdatedBy und Content.
#>
function Get-TierModelConfigSection {
    [CmdletBinding()]
    param([Parameter(Mandatory, Position = 0)][ValidatePattern('^[A-Za-z0-9_-]{1,64}$')][string]$Key)
    $s = Invoke-TierModelApi -Path "/api/config/sections/$Key"
    [pscustomobject]@{
        Key       = $Key
        Version   = $s.version
        UpdatedAt = $(if ($s.PSObject.Properties['updatedAt']) { $s.updatedAt })
        UpdatedBy = $(if ($s.PSObject.Properties['updatedBy']) { $s.updatedBy })
        Content   = $s.content
    }
}

Export-ModuleMember -Function @(
    'Connect-TierModelService', 'Disconnect-TierModelService', 'Get-TierModelRun', 'Start-TierModelAudit', 'Start-TierModelMonitor',
    'Start-TierModelDeploy', 'Wait-TierModelRun', 'Get-TierModelRunLog', 'Get-TierModelPrivileged', 'Get-TierModelCompliance',
    'Get-TierModelConfigSection'
)
