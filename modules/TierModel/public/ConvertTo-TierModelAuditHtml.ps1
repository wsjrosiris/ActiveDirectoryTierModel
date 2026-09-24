# TierModel audit report - HTML renderer
# Renders the report data of Audit-TierModel.ps1 (the same auditSummary / driftFindings / metadata
# as the JSON report) into one self-contained HTML file: inline CSS, no external resources, no
# JavaScript. The shared helpers below are also used by ConvertTo-TierModelAuditNUnitXml.

# Characters that are not allowed in XML 1.0 (and make no sense in HTML text)
$script:TierModelInvalidXmlCharRegex = [regex]::new(
    '[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]',
    [System.Text.RegularExpressions.RegexOptions]::Compiled)

function Get-TierModelAuditReportValue {
    <#
    .SYNOPSIS
    Reads a named value from a hashtable/dictionary or an object property (internal helper).
    .DESCRIPTION
    Returns the first non-null value of the given names; lookups are case-insensitive for
    PSObject properties and for Hashtable/ordered dictionaries created in PowerShell.
    #>
    [CmdletBinding()]
    param(
        [AllowNull()] $InputObject,
        [Parameter(Mandatory)] [string[]]$Name
    )

    if ($null -eq $InputObject) { return $null }
    foreach ($n in $Name) {
        if ($InputObject -is [System.Collections.IDictionary]) {
            if ($InputObject.Contains($n) -and $null -ne $InputObject[$n]) { return $InputObject[$n] }
            foreach ($key in $InputObject.Keys) {
                if ([string]$key -ieq $n -and $null -ne $InputObject[$key]) { return $InputObject[$key] }
            }
        } else {
            $prop = $InputObject.PSObject.Properties[$n]
            if ($prop -and $null -ne $prop.Value) { return $prop.Value }
        }
    }
    return $null
}

function ConvertTo-TierModelAuditReportText {
    <#
    .SYNOPSIS
    Converts a finding value (string, number, date, array, hashtable, object) to display text (internal helper).
    .DESCRIPTION
    Removes characters that are not allowed in XML 1.0 (control characters other than tab, CR, LF
    and unpaired surrogates) so the text can be written into both the HTML and the NUnit XML report.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param([AllowNull()] $Value)

    if ($null -eq $Value) { return '' }
    $text = if ($Value -is [string]) {
        $Value
    } elseif ($Value -is [datetime]) {
        $Value.ToString('yyyy-MM-dd HH:mm:ss')
    } elseif ($Value -is [datetimeoffset]) {
        $Value.ToString('yyyy-MM-dd HH:mm:ss zzz')
    } elseif ($Value -is [System.Collections.IDictionary] -or $Value -is [System.Management.Automation.PSCustomObject]) {
        try { $Value | ConvertTo-Json -Depth 5 -Compress } catch { [string]$Value }
    } elseif ($Value -is [System.Collections.IEnumerable]) {
        (@($Value) | ForEach-Object { ConvertTo-TierModelAuditReportText -Value $_ }) -join ', '
    } else {
        [string]$Value
    }

    # Control characters (except tab/CR/LF), U+FFFE/U+FFFF and unpaired surrogates -> U+FFFD
    if ($script:TierModelInvalidXmlCharRegex.IsMatch($text)) {
        $text = $script:TierModelInvalidXmlCharRegex.Replace($text, [string][char]0xFFFD)
    }
    return $text
}

function ConvertTo-TierModelHtmlEncoded {
    <#
    .SYNOPSIS
    HTML-encodes text for element content and attribute values (internal helper).
    .DESCRIPTION
    Encodes & < > " ' as entities (valid in HTML and XML). Other characters, including non-ASCII
    text such as German group names with umlauts, are kept as UTF-8.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param([AllowNull()] $Value)

    $text = ConvertTo-TierModelAuditReportText -Value $Value
    return $text.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;').Replace('"', '&quot;').Replace("'", '&#39;')
}

function Get-TierModelAuditAreaInfo {
    <#
    .SYNOPSIS
    Returns the display order and display name of the audit report areas (internal helper).
    #>
    [CmdletBinding()]
    param()

    return [ordered]@{
        ous       = 'Organizational Units'
        groups    = 'Groups'
        users     = 'Users'
        acls      = 'OU ACL Delegations'
        gpos      = 'Group Policy Objects'
        admx      = 'ADMX / ADML Templates'
        msa       = 'MSA ACL Delegations'
        gmsa      = 'gMSA ACL Delegations'
        dmsa      = 'dMSA ACL Delegations'
        winlaps   = 'Windows LAPS'
        authsilos = 'Authentication Policies and Silos'
    }
}

function Get-TierModelAuditReportModel {
    <#
    .SYNOPSIS
    Normalizes the audit report data for the HTML and NUnit renderers (internal helper).

    .DESCRIPTION
    Groups the findings by Area (canonical area order, unknown areas afterwards, findings without
    Area in 'general'), sorts them by severity (High, Medium, Low), type and identifier, and merges
    the optional per-area counts (Merge-TierModelAuditResult .Areas). Each normalized finding has
    Area, Severity, Type, ResourceType, Identifier, ExpectedValue, ActualValue, Details and the
    original object (Source). ExpectedValue/ActualValue fall back to Expected/Actual and Details
    falls back to Message, matching the field names used by the different Test-TierModel* cmdlets.
    #>
    [CmdletBinding()]
    param(
        [AllowNull()] $AuditSummary,
        [AllowNull()] [AllowEmptyCollection()] [object[]]$Findings,
        [AllowNull()] $AreaSummary
    )

    $areaInfo = Get-TierModelAuditAreaInfo
    $severityRank = @{ High = 0; Medium = 1; Low = 2 }

    $normalized = New-Object System.Collections.Generic.List[object]
    foreach ($f in @($Findings)) {
        if ($null -eq $f) { continue }
        $area = [string](Get-TierModelAuditReportValue $f 'Area')
        if ([string]::IsNullOrWhiteSpace($area)) { $area = 'general' }
        $severity = [string](Get-TierModelAuditReportValue $f 'Severity')
        if ([string]::IsNullOrWhiteSpace($severity)) { $severity = 'Low' }
        $type = [string](Get-TierModelAuditReportValue $f 'Type', 'Status')
        if ([string]::IsNullOrWhiteSpace($type)) { $type = 'Mismatch' }
        $normalized.Add([PSCustomObject]@{
            Area          = $area
            Severity      = $severity
            SeverityRank  = if ($severityRank.ContainsKey($severity)) { $severityRank[$severity] } else { 3 }
            Type          = $type
            ResourceType  = ConvertTo-TierModelAuditReportText (Get-TierModelAuditReportValue $f 'ResourceType')
            Identifier    = ConvertTo-TierModelAuditReportText (Get-TierModelAuditReportValue $f 'Identifier', 'GpoName', 'FileName')
            ExpectedValue = ConvertTo-TierModelAuditReportText (Get-TierModelAuditReportValue $f 'ExpectedValue', 'Expected')
            ActualValue   = ConvertTo-TierModelAuditReportText (Get-TierModelAuditReportValue $f 'ActualValue', 'Actual')
            Details       = ConvertTo-TierModelAuditReportText (Get-TierModelAuditReportValue $f 'Details', 'Message')
            Source        = $f
        })
    }

    # Area order: canonical areas first, then any other area in order of appearance
    $areaNames = New-Object System.Collections.Generic.List[string]
    $present = @{}
    foreach ($n in $normalized) { $present[$n.Area] = $true }
    if ($null -ne $AreaSummary) {
        $keys = if ($AreaSummary -is [System.Collections.IDictionary]) { @($AreaSummary.Keys) } else { @($AreaSummary.PSObject.Properties.Name) }
        foreach ($k in $keys) { $present[[string]$k] = $true }
    }
    foreach ($k in $areaInfo.Keys) { if ($present.ContainsKey($k)) { $areaNames.Add($k) } }
    foreach ($n in $normalized) { if (-not $areaNames.Contains($n.Area)) { $areaNames.Add($n.Area) } }
    if ($null -ne $AreaSummary) {
        foreach ($k in $keys) { if (-not $areaNames.Contains([string]$k)) { $areaNames.Add([string]$k) } }
    }

    $areas = New-Object System.Collections.Generic.List[object]
    foreach ($name in $areaNames) {
        $areaFindings = @($normalized | Where-Object { $_.Area -eq $name } |
            Sort-Object -Property SeverityRank, Type, Identifier, ResourceType)
        $stats = if ($null -ne $AreaSummary) { Get-TierModelAuditReportValue $AreaSummary $name } else { $null }
        $checked = Get-TierModelAuditReportValue $stats 'Checked'
        $compliant = Get-TierModelAuditReportValue $stats 'Compliant'
        $areas.Add([PSCustomObject]@{
            Name        = $name
            DisplayName = if ($areaInfo.Contains($name)) { $areaInfo[$name] } elseif ($name -eq 'general') { 'General' } else { $name }
            Findings    = $areaFindings
            Checked     = if ($null -ne $checked) { [int]$checked } else { $null }
            Compliant   = if ($null -ne $compliant) { [int]$compliant } else { $null }
            High        = @($areaFindings | Where-Object Severity -eq 'High').Count
            Medium      = @($areaFindings | Where-Object Severity -eq 'Medium').Count
            Low         = @($areaFindings | Where-Object { $_.Severity -notin @('High', 'Medium') }).Count
        })
    }

    $count = {
        param($names)
        $v = Get-TierModelAuditReportValue $AuditSummary $names
        if ($null -eq $v) { return $null }
        return [int]$v
    }
    $summary = [ordered]@{
        TotalChecked         = & $count 'TotalChecked'
        DriftCount           = & $count 'DriftCount'
        MissingCount         = & $count 'MissingCount'
        MismatchCount        = & $count 'MismatchCount'
        UnexpectedCount      = & $count 'UnexpectedCount'
        OrphanedGpoLinkCount = & $count 'OrphanedGpoLinkCount'
        SecurityDeltaCount   = & $count 'SecurityDeltaCount'
        ErrorCount           = & $count 'ErrorCount'
        CompliantCount       = & $count 'CompliantCount'
    }
    # Values the summary does not carry (single-scope audits fill only some counters) are derived
    # from the findings so the tiles never show an empty value.
    $byType = {
        param($pattern)
        @($normalized | Where-Object { $_.Type -match $pattern }).Count
    }
    if ($null -eq $summary.MissingCount)         { $summary.MissingCount = & $byType '^Missing(Acl)?$' }
    if ($null -eq $summary.UnexpectedCount)      { $summary.UnexpectedCount = & $byType '^Unexpected(Acl)?$' }
    if ($null -eq $summary.OrphanedGpoLinkCount) { $summary.OrphanedGpoLinkCount = & $byType '^OrphanedGpoLink$' }
    if ($null -eq $summary.SecurityDeltaCount)   { $summary.SecurityDeltaCount = & $byType '^SecurityDelta$' }
    if ($null -eq $summary.ErrorCount)           { $summary.ErrorCount = & $byType '^Error$' }
    if ($null -eq $summary.MismatchCount) {
        $summary.MismatchCount = & $byType '^(?!(Missing(Acl)?|Unexpected(Acl)?|OrphanedGpoLink|SecurityDelta|Error)$)'
    }
    if ($null -eq $summary.DriftCount) {
        $summary.DriftCount = $summary.MissingCount + $summary.UnexpectedCount + $summary.MismatchCount +
            $summary.OrphanedGpoLinkCount + $summary.SecurityDeltaCount
    }
    if ($null -eq $summary.TotalChecked) { $summary.TotalChecked = 0 }
    if ($null -eq $summary.CompliantCount) {
        $areaCompliant = @($areas | Where-Object { $null -ne $_.Compliant })
        $summary.CompliantCount = if ($areaCompliant.Count -gt 0) {
            ($areaCompliant | Measure-Object -Property Compliant -Sum).Sum
        } else {
            [Math]::Max(0, $summary.TotalChecked - $normalized.Count)
        }
    }

    return [PSCustomObject]@{
        Summary  = $summary
        Areas    = $areas.ToArray()
        Findings = $normalized.ToArray()
        High     = @($normalized | Where-Object Severity -eq 'High').Count
        Medium   = @($normalized | Where-Object Severity -eq 'Medium').Count
        Low      = @($normalized | Where-Object { $_.Severity -notin @('High', 'Medium') }).Count
    }
}

function ConvertTo-TierModelAuditHtml {
    <#
    .SYNOPSIS
    Renders TierModel audit report data as a self-contained HTML document.

    .DESCRIPTION
    Takes the same data as the JSON report of Audit-TierModel.ps1 (auditSummary, driftFindings,
    metadata) and returns one HTML document as a string:
      - header with scope, domain controller, timestamp, version and configuration hash
      - summary tiles (drift, missing, mismatch, unexpected, errors, compliant) and severity counts
      - an area overview and, per area, a findings table sorted by severity with expected and
        actual value side by side
      - a clear "no drift" state when there are no findings
    All CSS is inline; the page loads no external resources and needs no JavaScript. It uses a light
    theme and a print stylesheet. Every value is HTML-encoded (& < > " '), non-ASCII text is kept as
    UTF-8. The output is also well-formed XML, so it can be checked with [xml].

    .PARAMETER AuditSummary
    Summary hashtable/object (TotalChecked, DriftCount, MissingCount, MismatchCount, UnexpectedCount,
    OrphanedGpoLinkCount, SecurityDeltaCount, ErrorCount, CompliantCount). Missing counters are
    derived from the findings.

    .PARAMETER Findings
    Drift findings (Type, ResourceType, Identifier, ExpectedValue, ActualValue, Details, Area, Severity).

    .PARAMETER Metadata
    Report metadata (scope, preferredDc, timestamp, version, configHash).

    .PARAMETER AreaSummary
    Optional per-area counts (Merge-TierModelAuditResult .Areas: area -> Checked, Compliant, Findings).

    .EXAMPLE
    $merged = Merge-TierModelAuditResult -AuditResults $results -Config $config
    ConvertTo-TierModelAuditHtml -AuditSummary $merged.Summary -Findings $merged.Findings `
        -Metadata @{ scope = 'FullDeployment'; preferredDc = 'DC01'; timestamp = Get-Date } -AreaSummary $merged.Areas |
        Set-Content -Path .\audit.html -Encoding utf8

    .OUTPUTS
    System.String
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [AllowNull()] $AuditSummary,

        [AllowNull()]
        [AllowEmptyCollection()]
        [object[]]$Findings = @(),

        [AllowNull()] $Metadata,

        [AllowNull()] $AreaSummary
    )

    $model = Get-TierModelAuditReportModel -AuditSummary $AuditSummary -Findings $Findings -AreaSummary $AreaSummary
    $s = $model.Summary
    $e = { param($v) ConvertTo-TierModelHtmlEncoded -Value $v }

    $scope = Get-TierModelAuditReportValue $Metadata 'scope'
    $dc = Get-TierModelAuditReportValue $Metadata 'preferredDc', 'domainController'
    $ts = Get-TierModelAuditReportValue $Metadata 'timestamp'
    $version = Get-TierModelAuditReportValue $Metadata 'version'
    $configHash = Get-TierModelAuditReportValue $Metadata 'configHash'
    $tsText = if ($ts -is [datetime]) { $ts.ToString('yyyy-MM-dd HH:mm:ss (zzz)') } elseif ($ts) { ConvertTo-TierModelAuditReportText $ts } else { '' }
    $tsIso = if ($ts -is [datetime]) { $ts.ToString('o') } else { $tsText }

    $issueCount = $model.Findings.Count
    $isCompliant = $issueCount -eq 0 -and $s.ErrorCount -eq 0 -and $s.DriftCount -eq 0

    $sb = New-Object System.Text.StringBuilder (16384 + 1024 * $issueCount)
    $w = { param([string]$line) [void]$sb.AppendLine($line) }

    & $w '<!DOCTYPE html>'
    & $w '<html lang="en">'
    & $w '<head>'
    & $w '<meta charset="utf-8" />'
    & $w '<meta name="viewport" content="width=device-width, initial-scale=1" />'
    & $w '<meta name="generator" content="TierModel Audit-TierModel.ps1" />'
    & $w "<title>TierModel Audit Report$(if ($scope) { ' - ' + (& $e $scope) })</title>"
    & $w '<style>'
    & $w @'
:root {
  --bg: #f6f7f9; --surface: #ffffff; --text: #1d2330; --muted: #5d6677; --border: #dde1e7;
  --accent: #2458c6; --ok: #1d7a46; --ok-bg: #e6f4ec; --warn: #9a5b00; --warn-bg: #fdf1dc;
  --bad: #b3261e; --bad-bg: #fbe7e6; --info-bg: #eef2fb;
  --high: #b3261e; --high-bg: #fbe7e6; --medium: #8a5300; --medium-bg: #fdf0d8; --low: #3a5a87; --low-bg: #e8eef8;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif; }
.page { max-width: 1280px; margin: 0 auto; padding: 24px 16px 48px; }
header.report { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 20px 24px; }
header.report .title-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; justify-content: space-between; }
h1 { font-size: 22px; margin: 0; letter-spacing: -0.01em; }
h2 { font-size: 17px; margin: 0; }
.status { display: inline-block; padding: 4px 12px; border-radius: 999px; font-weight: 600; font-size: 13px; }
.status.ok { background: var(--ok-bg); color: var(--ok); }
.status.bad { background: var(--bad-bg); color: var(--bad); }
dl.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px 24px; margin: 16px 0 0; }
dl.meta div { min-width: 0; }
dl.meta dt { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
dl.meta dd { margin: 2px 0 0; font-weight: 600; overflow-wrap: anywhere; }
.mono { font-family: Consolas, "Cascadia Mono", "SFMono-Regular", Menlo, monospace; font-size: 12.5px; font-weight: 500; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 20px 0 8px; }
.tile { background: var(--surface); border: 1px solid var(--border); border-left-width: 4px; border-radius: 8px; padding: 12px 16px; }
.tile .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
.tile .value { font-size: 28px; font-weight: 700; line-height: 1.2; font-variant-numeric: tabular-nums; }
.tile.drift, .tile.missing, .tile.errors { border-left-color: var(--bad); }
.tile.mismatch, .tile.unexpected { border-left-color: var(--warn); }
.tile.compliant { border-left-color: var(--ok); }
.tile.zero { border-left-color: var(--border); }
.tile.zero .value { color: var(--muted); }
.subline { color: var(--muted); font-size: 13px; margin: 4px 2px 0; }
.badge { display: inline-block; min-width: 58px; text-align: center; padding: 1px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.badge.sev-high { background: var(--high-bg); color: var(--high); }
.badge.sev-medium { background: var(--medium-bg); color: var(--medium); }
.badge.sev-low { background: var(--low-bg); color: var(--low); }
.badge.type { background: #eef0f3; color: #3b4352; font-weight: 500; min-width: 0; }
.badge.type-error { background: var(--bad-bg); color: var(--bad); }
section.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; margin-top: 20px; overflow: hidden; }
section.card > .card-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; padding: 14px 20px; border-bottom: 1px solid var(--border); }
section.card > .card-head .counts { color: var(--muted); font-size: 13px; }
section.card > .card-body { padding: 16px 20px; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead th { position: sticky; top: 0; background: #f0f2f5; text-align: left; font-weight: 600; color: #394150; padding: 8px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
thead th.sorted::after { content: " \25BC"; font-size: 10px; color: var(--accent); }
thead th.sortable::after { content: " \21C5"; font-size: 10px; color: #a0a7b3; }
tbody td { padding: 8px 10px; border-bottom: 1px solid #edf0f3; vertical-align: top; overflow-wrap: anywhere; }
tbody tr:nth-child(even) td { background: #fafbfc; }
tbody tr:last-child td { border-bottom: 0; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
td.expected { background: #f2f9f4 !important; }
td.actual { background: #fdf3f2 !important; }
td.empty { color: #a0a7b3; }
.overview a { color: var(--accent); text-decoration: none; }
.overview a:hover { text-decoration: underline; }
.allgood { display: flex; gap: 16px; align-items: center; background: var(--ok-bg); color: var(--ok); border: 1px solid #bfe3cd; border-radius: 10px; padding: 20px 24px; margin-top: 20px; }
.allgood .mark { font-size: 34px; line-height: 1; }
.allgood strong { display: block; font-size: 17px; }
.allgood span { color: #2c5e40; }
.errnote { background: var(--bad-bg); color: var(--bad); border: 1px solid #f1c3bf; border-radius: 10px; padding: 12px 18px; margin-top: 20px; }
footer { color: var(--muted); font-size: 12px; margin-top: 28px; text-align: center; }
@media (max-width: 640px) {
  .tile .value { font-size: 22px; }
  header.report { padding: 16px; }
  section.card > .card-body { padding: 12px; }
}
@media print {
  @page { margin: 14mm 12mm; }
  body { background: #fff; font-size: 11px; }
  .page { max-width: none; padding: 0; }
  header.report, section.card, .tile, .allgood, .errnote { border-color: #bbb; box-shadow: none; }
  section.card { break-inside: auto; }
  section.card > .card-head { break-after: avoid; }
  thead { display: table-header-group; }
  thead th { position: static; }
  tr { break-inside: avoid; }
  .table-wrap { overflow: visible; }
  .badge, .status, .tile, td.expected, td.actual, .allgood { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .overview a { color: inherit; }
}
'@
    & $w '</style>'
    & $w '</head>'
    & $w '<body>'
    & $w '<div class="page">'

    # --- Header ---
    & $w '<header class="report">'
    & $w '<div class="title-row">'
    & $w '<h1>TierModel Audit Report</h1>'
    if ($isCompliant) {
        & $w '<span class="status ok">Compliant - no drift detected</span>'
    } else {
        $statusText = "$($s.DriftCount) drift item$(if ($s.DriftCount -ne 1) { 's' })"
        if ($s.ErrorCount -gt 0) { $statusText += ", $($s.ErrorCount) error$(if ($s.ErrorCount -ne 1) { 's' })" }
        & $w "<span class=`"status bad`">$(& $e $statusText)</span>"
    }
    & $w '</div>'
    & $w '<dl class="meta">'
    $metaItems = @(
        @('Scope', $scope, $false),
        @('Domain controller', $dc, $false),
        @('Generated', $tsText, $false),
        @('Report version', $version, $false),
        @('Configuration hash', $configHash, $true)
    )
    foreach ($m in $metaItems) {
        $value = if ($null -eq $m[1] -or [string]::IsNullOrEmpty([string]$m[1])) { 'n/a' } else { $m[1] }
        $cls = if ($m[2]) { ' class="mono"' } else { '' }
        if ($m[0] -eq 'Generated' -and $tsIso) {
            & $w "<div><dt>$($m[0])</dt><dd><time datetime=`"$(& $e $tsIso)`">$(& $e $value)</time></dd></div>"
        } else {
            & $w "<div><dt>$($m[0])</dt><dd$cls>$(& $e $value)</dd></div>"
        }
    }
    & $w '</dl>'
    & $w '</header>'

    # --- Summary tiles ---
    & $w '<div class="tiles" role="list">'
    $tiles = @(
        @('drift', 'Drift', $s.DriftCount),
        @('missing', 'Missing', $s.MissingCount),
        @('mismatch', 'Mismatch', $s.MismatchCount),
        @('unexpected', 'Unexpected', $s.UnexpectedCount),
        @('errors', 'Errors', $s.ErrorCount),
        @('compliant', 'Compliant', $s.CompliantCount)
    )
    foreach ($t in $tiles) {
        $cls = if ([int]$t[2] -eq 0 -and $t[0] -ne 'compliant') { "tile $($t[0]) zero" } else { "tile $($t[0])" }
        & $w "<div class=`"$cls`" role=`"listitem`"><div class=`"label`">$($t[1])</div><div class=`"value`">$([int]$t[2])</div></div>"
    }
    & $w '</div>'
    & $w "<p class=`"subline`">Checked: $([int]$s.TotalChecked) &#183; Orphaned GPO links: $([int]$s.OrphanedGpoLinkCount) &#183; Security deltas: $([int]$s.SecurityDeltaCount) &#183; Severity: <span class=`"badge sev-high`">High $($model.High)</span> <span class=`"badge sev-medium`">Medium $($model.Medium)</span> <span class=`"badge sev-low`">Low $($model.Low)</span></p>"

    # --- All compliant state ---
    if ($isCompliant) {
        & $w '<div class="allgood" role="status">'
        & $w '<div class="mark" aria-hidden="true">&#10004;</div>'
        & $w "<div><strong>All compliant</strong><span>Active Directory matches the Tier Model configuration. $([int]$s.CompliantCount) of $([int]$s.TotalChecked) checked item$(if ($s.TotalChecked -ne 1) { 's' }) compliant, no drift findings.</span></div>"
        & $w '</div>'
    } elseif ($issueCount -eq 0) {
        $parts = @()
        if ($s.DriftCount -gt 0) { $parts += "$([int]$s.DriftCount) drift item$(if ($s.DriftCount -ne 1) { 's' })" }
        if ($s.ErrorCount -gt 0) { $parts += "$([int]$s.ErrorCount) audit error$(if ($s.ErrorCount -ne 1) { 's' })" }
        & $w "<div class=`"errnote`" role=`"status`"><strong>$($parts -join ' and ')</strong> reported without finding details. See the console output or the TierModel log.</div>"
    }

    # --- Area overview ---
    if ($model.Areas.Count -gt 0) {
        & $w '<section class="card overview" aria-labelledby="overview-title">'
        & $w '<div class="card-head"><h2 id="overview-title">Areas</h2><span class="counts">Sorted by audit order</span></div>'
        & $w '<div class="card-body table-wrap">'
        & $w '<table>'
        & $w '<thead><tr><th scope="col" class="sorted">Area</th><th scope="col" class="sortable">Findings</th><th scope="col" class="sortable">High</th><th scope="col" class="sortable">Medium</th><th scope="col" class="sortable">Low</th><th scope="col" class="sortable">Compliant</th><th scope="col" class="sortable">Checked</th></tr></thead>'
        & $w '<tbody>'
        foreach ($a in $model.Areas) {
            $areaLabel = if ($a.Findings.Count -gt 0) { "<a href=`"#area-$(& $e $a.Name)`">$(& $e $a.DisplayName)</a>" } else { & $e $a.DisplayName }
            $compliantText = if ($null -ne $a.Compliant) { [string]$a.Compliant } else { '&#8211;' }
            $checkedText = if ($null -ne $a.Checked) { [string]$a.Checked } else { '&#8211;' }
            & $w "<tr><td>$areaLabel</td><td class=`"num`">$($a.Findings.Count)</td><td class=`"num`">$($a.High)</td><td class=`"num`">$($a.Medium)</td><td class=`"num`">$($a.Low)</td><td class=`"num`">$compliantText</td><td class=`"num`">$checkedText</td></tr>"
        }
        & $w '</tbody>'
        & $w '</table>'
        & $w '</div>'
        & $w '</section>'
    }

    # --- Findings per area ---
    $cell = {
        param($value, $cls)
        if ([string]::IsNullOrEmpty($value)) { return "<td class=`"$cls empty`">&#8211;</td>" }
        return "<td class=`"$cls`">$(& $e $value)</td>"
    }
    foreach ($a in $model.Areas) {
        if ($a.Findings.Count -eq 0) { continue }
        $countText = "$($a.Findings.Count) finding$(if ($a.Findings.Count -ne 1) { 's' })"
        if ($null -ne $a.Compliant) { $countText += " &#183; $($a.Compliant) compliant" }
        if ($null -ne $a.Checked) { $countText += " &#183; $($a.Checked) checked" }
        & $w "<section class=`"card area`" id=`"area-$(& $e $a.Name)`" aria-labelledby=`"area-title-$(& $e $a.Name)`">"
        & $w "<div class=`"card-head`"><h2 id=`"area-title-$(& $e $a.Name)`">$(& $e $a.DisplayName)</h2><span class=`"counts`">$countText</span></div>"
        & $w '<div class="card-body table-wrap">'
        & $w '<table>'
        & $w '<thead><tr><th scope="col" class="sorted">Severity</th><th scope="col" class="sortable">Type</th><th scope="col" class="sortable">Resource</th><th scope="col" class="sortable">Identifier</th><th scope="col">Expected</th><th scope="col">Actual</th><th scope="col">Details</th></tr></thead>'
        & $w '<tbody>'
        foreach ($f in $a.Findings) {
            $sevClass = switch ($f.Severity) { 'High' { 'sev-high' } 'Medium' { 'sev-medium' } default { 'sev-low' } }
            $typeClass = if ($f.Type -eq 'Error') { 'badge type type-error' } else { 'badge type' }
            [void]$sb.Append('<tr>')
            [void]$sb.Append("<td><span class=`"badge $sevClass`">$(& $e $f.Severity)</span></td>")
            [void]$sb.Append("<td><span class=`"$typeClass`">$(& $e $f.Type)</span></td>")
            [void]$sb.Append((& $cell $f.ResourceType 'resource'))
            [void]$sb.Append((& $cell $f.Identifier 'identifier mono'))
            [void]$sb.Append((& $cell $f.ExpectedValue 'expected'))
            [void]$sb.Append((& $cell $f.ActualValue 'actual'))
            [void]$sb.Append((& $cell $f.Details 'details'))
            [void]$sb.AppendLine('</tr>')
        }
        & $w '</tbody>'
        & $w '</table>'
        & $w '</div>'
        & $w '</section>'
    }

    & $w "<footer>Generated by Audit-TierModel.ps1$(if ($version) { ' (' + (& $e $version) + ')' }) &#183; self-contained report, no external resources</footer>"
    & $w '</div>'
    & $w '</body>'
    & $w '</html>'

    return $sb.ToString()
}
