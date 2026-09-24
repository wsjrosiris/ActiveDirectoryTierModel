# TierModel audit report - NUnit 3 test-result XML renderer
# Turns the report data of Audit-TierModel.ps1 (auditSummary / driftFindings / metadata, the same
# data as the JSON report) into an NUnit 3 result file that CI systems can display (Azure DevOps
# PublishTestResults with testResultsFormat NUnit, GitHub test reporters that read NUnit 3 XML).
# Uses the helpers defined in ConvertTo-TierModelAuditHtml.ps1.

function ConvertTo-TierModelAuditNUnitXml {
    <#
    .SYNOPSIS
    Renders TierModel audit report data as NUnit 3 test-result XML.

    .DESCRIPTION
    Structure:
      test-run
        test-suite type="TestSuite"   TierModelAudit (scope, DC, config hash as properties)
          test-suite type="TestFixture"  one per Area (ous, groups, users, acls, gpos, admx, msa,
                                         gmsa, dmsa, winlaps, authsilos) in audit order
            test-case result="Failed"    one per finding: name "[Type] ResourceType/Identifier",
                                         failure message = Details plus "Expected: ..." and
                                         "Actual: ..." lines, stack-trace = the finding fields;
                                         Error findings carry label="Error"
            test-case result="Passed"    one per area for its compliant items ("N compliant
                                         items"), because the report data does not list compliant
                                         objects individually; also written for an area without
                                         findings and without a compliant count
      Audit errors that are counted in the summary but not listed as findings are reported as one
      additional failed case in the fixture "audit". Without any area (no findings, no per-area
      counts) a single fixture "overall" with one passed case is written.
    Counts (total/passed/failed) on every level are computed from the written test cases, so they
    are always consistent. The document is produced with System.Xml.XmlWriter: all values are
    XML-escaped and characters that XML 1.0 does not allow are replaced with U+FFFD.

    .PARAMETER AuditSummary
    Summary hashtable/object as in the JSON report (ErrorCount, CompliantCount, ...).

    .PARAMETER Findings
    Drift findings (Type, ResourceType, Identifier, ExpectedValue, ActualValue, Details, Area, Severity).

    .PARAMETER Metadata
    Report metadata (scope, preferredDc, timestamp, version, configHash).

    .PARAMETER AreaSummary
    Optional per-area counts (Merge-TierModelAuditResult .Areas). Without it the compliant count of
    the summary is used when all findings belong to one area.

    .EXAMPLE
    ConvertTo-TierModelAuditNUnitXml -AuditSummary $merged.Summary -Findings $merged.Findings `
        -Metadata @{ scope = 'FullDeployment'; preferredDc = 'DC01'; timestamp = Get-Date } -AreaSummary $merged.Areas |
        Set-Content -Path .\audit.xml -Encoding utf8

    .OUTPUTS
    System.String (UTF-8 XML document)
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
    $t = { param($v) ConvertTo-TierModelAuditReportText -Value $v }

    $scope = & $t (Get-TierModelAuditReportValue $Metadata 'scope')
    $dc = & $t (Get-TierModelAuditReportValue $Metadata 'preferredDc', 'domainController')
    $version = & $t (Get-TierModelAuditReportValue $Metadata 'version')
    $configHash = & $t (Get-TierModelAuditReportValue $Metadata 'configHash')
    $ts = Get-TierModelAuditReportValue $Metadata 'timestamp'
    $start = if ($ts -is [datetime]) { $ts } elseif ($ts) { try { [datetime]::Parse([string]$ts, [cultureinfo]::InvariantCulture) } catch { Get-Date } } else { Get-Date }
    $startText = $start.ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss'Z'", [cultureinfo]::InvariantCulture)

    # ---- Build the test cases per fixture first, so all counts come from the same data ----
    $fixtures = New-Object System.Collections.Generic.List[object]
    $newCase = {
        param($Name, $Result, $Label, $Message, $Trace, $Properties)
        [PSCustomObject]@{ Name = $Name; Result = $Result; Label = $Label; Message = $Message; StackTrace = $Trace; Properties = $Properties }
    }

    $singleArea = $model.Areas.Count -eq 1
    foreach ($a in $model.Areas) {
        $cases = New-Object System.Collections.Generic.List[object]
        $usedNames = @{}
        foreach ($f in $a.Findings) {
            $target = if ($f.ResourceType -and $f.Identifier) { "$($f.ResourceType)/$($f.Identifier)" }
                elseif ($f.Identifier) { $f.Identifier } elseif ($f.ResourceType) { $f.ResourceType } else { 'item' }
            $name = "[$($f.Type)] $target"
            if ($usedNames.ContainsKey($name)) {
                $usedNames[$name]++
                $name = "$name (#$($usedNames[$name]))"
            } else {
                $usedNames[$name] = 1
            }

            $msgLines = New-Object System.Collections.Generic.List[string]
            $msgLines.Add($(if ($f.Details) { $f.Details } else { "$($f.Type): $target" }))
            if ($f.ExpectedValue -or $f.ActualValue) {
                $msgLines.Add("Expected: $(if ($f.ExpectedValue) { $f.ExpectedValue } else { '(not specified)' })")
                $msgLines.Add("Actual:   $(if ($f.ActualValue) { $f.ActualValue } else { '(not specified)' })")
            }
            $msgLines.Add("Severity: $($f.Severity)")

            $trace = @(
                "Area: $($a.Name)"
                "Type: $($f.Type)"
                "Severity: $($f.Severity)"
                "ResourceType: $($f.ResourceType)"
                "Identifier: $($f.Identifier)"
            ) -join "`n"

            $props = [ordered]@{ Severity = $f.Severity; Type = $f.Type; Area = $a.Name }
            if ($f.ResourceType) { $props.ResourceType = $f.ResourceType }
            if ($f.Identifier) { $props.Identifier = $f.Identifier }

            $label = if ($f.Type -eq 'Error') { 'Error' } else { $null }
            $cases.Add((& $newCase $name 'Failed' $label ($msgLines -join "`n") $trace $props))
        }

        $compliant = $a.Compliant
        if ($null -eq $compliant -and $singleArea) { $compliant = [int]$model.Summary.CompliantCount }
        if (($null -ne $compliant -and $compliant -gt 0) -or $a.Findings.Count -eq 0) {
            $n = if ($null -ne $compliant) { [int]$compliant } else { 0 }
            $caseName = "$n compliant item$(if ($n -ne 1) { 's' })"
            $props = [ordered]@{ CompliantCount = $n; Area = $a.Name }
            if ($null -ne $a.Checked) { $props.CheckedCount = [int]$a.Checked }
            $cases.Add((& $newCase $caseName 'Passed' $null $null $null $props))
        }
        $fixtures.Add([PSCustomObject]@{ Name = $a.Name; DisplayName = $a.DisplayName; Cases = $cases })
    }

    # Without per-area counts and with findings in several areas the compliant objects cannot be
    # attributed to an area: report them once in the fixture "overall".
    $anyAreaCompliant = @($model.Areas | Where-Object { $null -ne $_.Compliant }).Count -gt 0
    if (-not $singleArea -and $model.Areas.Count -gt 0 -and -not $anyAreaCompliant -and [int]$model.Summary.CompliantCount -gt 0) {
        $n = [int]$model.Summary.CompliantCount
        $cases = New-Object System.Collections.Generic.List[object]
        $cases.Add((& $newCase "$n compliant item$(if ($n -ne 1) { 's' })" 'Passed' $null $null $null ([ordered]@{ CompliantCount = $n })))
        $fixtures.Add([PSCustomObject]@{ Name = 'overall'; DisplayName = 'Overall'; Cases = $cases })
    }

    # Errors counted in the summary that have no finding of their own (entity-level errors)
    $errorFindings = @($model.Findings | Where-Object Type -eq 'Error').Count
    $unlistedErrors = [int]$model.Summary.ErrorCount - $errorFindings
    if ($unlistedErrors -gt 0) {
        $cases = New-Object System.Collections.Generic.List[object]
        $cases.Add((& $newCase "$unlistedErrors audit error$(if ($unlistedErrors -ne 1) { 's' }) without finding details" 'Failed' 'Error' `
            "$unlistedErrors audit error$(if ($unlistedErrors -ne 1) { 's' }) occurred that are not listed as findings. See the console output or the TierModel log." `
            $null ([ordered]@{ ErrorCount = $unlistedErrors })))
        $fixtures.Add([PSCustomObject]@{ Name = 'audit'; DisplayName = 'Audit errors'; Cases = $cases })
    }

    if ($fixtures.Count -eq 0) {
        $n = [int]$model.Summary.CompliantCount
        $cases = New-Object System.Collections.Generic.List[object]
        $cases.Add((& $newCase "$n compliant item$(if ($n -ne 1) { 's' })" 'Passed' $null $null $null ([ordered]@{ CompliantCount = $n; CheckedCount = [int]$model.Summary.TotalChecked })))
        $fixtures.Add([PSCustomObject]@{ Name = 'overall'; DisplayName = 'Overall'; Cases = $cases })
    }

    $total = 0; $failed = 0
    foreach ($fx in $fixtures) {
        $total += $fx.Cases.Count
        $failed += @($fx.Cases | Where-Object Result -eq 'Failed').Count
    }
    $passed = $total - $failed

    # ---- Write the XML ----
    $settings = New-Object System.Xml.XmlWriterSettings
    $settings.Indent = $true
    $settings.IndentChars = '  '
    $settings.Encoding = New-Object System.Text.UTF8Encoding($false)
    $settings.NewLineChars = "`n"
    $stream = New-Object System.IO.MemoryStream
    $xw = [System.Xml.XmlWriter]::Create($stream, $settings)
    $id = 0
    $rootName = 'TierModelAudit'

    $writeCounts = {
        param($Total, $Passed, $Failed)
        $xw.WriteAttributeString('testcasecount', [string]$Total)
        $xw.WriteAttributeString('result', $(if ($Failed -gt 0) { 'Failed' } else { 'Passed' }))
        $xw.WriteAttributeString('total', [string]$Total)
        $xw.WriteAttributeString('passed', [string]$Passed)
        $xw.WriteAttributeString('failed', [string]$Failed)
        $xw.WriteAttributeString('warnings', '0')
        $xw.WriteAttributeString('inconclusive', '0')
        $xw.WriteAttributeString('skipped', '0')
        $xw.WriteAttributeString('asserts', [string]$Total)
    }
    $writeTimes = {
        $xw.WriteAttributeString('start-time', $startText)
        $xw.WriteAttributeString('end-time', $startText)
        $xw.WriteAttributeString('duration', '0.000')
    }
    $writeProperties = {
        param($Properties)
        if ($null -eq $Properties -or $Properties.Count -eq 0) { return }
        $xw.WriteStartElement('properties')
        foreach ($k in $Properties.Keys) {
            $xw.WriteStartElement('property')
            $xw.WriteAttributeString('name', [string]$k)
            $xw.WriteAttributeString('value', (& $t $Properties[$k]))
            $xw.WriteEndElement()
        }
        $xw.WriteEndElement()
    }

    try {
        $xw.WriteStartDocument()
        $xw.WriteComment(' TierModel audit report (NUnit 3 format) generated by Audit-TierModel.ps1 ')

        $xw.WriteStartElement('test-run')
        $xw.WriteAttributeString('id', [string]$id); $id++
        $xw.WriteAttributeString('name', $rootName)
        $xw.WriteAttributeString('fullname', $rootName)
        $xw.WriteAttributeString('runstate', 'Runnable')
        & $writeCounts $total $passed $failed
        $xw.WriteAttributeString('engine-version', '3.0.0')
        $xw.WriteAttributeString('clr-version', [System.Environment]::Version.ToString())
        & $writeTimes

        $xw.WriteStartElement('command-line')
        $xw.WriteString("Audit-TierModel.ps1 -PreferredDc $dc$(if ($scope) { ' (' + $scope + ')' })")
        $xw.WriteEndElement()

        $xw.WriteStartElement('test-suite')
        $xw.WriteAttributeString('type', 'TestSuite')
        $xw.WriteAttributeString('id', [string]$id); $id++
        $xw.WriteAttributeString('name', $(if ($scope) { "$rootName ($scope)" } else { $rootName }))
        $xw.WriteAttributeString('fullname', $rootName)
        $xw.WriteAttributeString('runstate', 'Runnable')
        & $writeCounts $total $passed $failed
        & $writeTimes
        $suiteProps = [ordered]@{}
        if ($scope) { $suiteProps.Scope = $scope }
        if ($dc) { $suiteProps.PreferredDc = $dc }
        if ($version) { $suiteProps.ReportVersion = $version }
        if ($configHash) { $suiteProps.ConfigHash = $configHash }
        $suiteProps.TotalChecked = [int]$model.Summary.TotalChecked
        $suiteProps.DriftCount = [int]$model.Summary.DriftCount
        $suiteProps.ErrorCount = [int]$model.Summary.ErrorCount
        $suiteProps.CompliantCount = [int]$model.Summary.CompliantCount
        & $writeProperties $suiteProps
        if ($failed -gt 0) {
            $xw.WriteStartElement('failure')
            $xw.WriteStartElement('message')
            $xw.WriteString("$failed of $total audit checks failed (drift: $([int]$model.Summary.DriftCount), errors: $([int]$model.Summary.ErrorCount)).")
            $xw.WriteEndElement()
            $xw.WriteEndElement()
        }

        foreach ($fx in $fixtures) {
            $fxTotal = $fx.Cases.Count
            $fxFailed = @($fx.Cases | Where-Object Result -eq 'Failed').Count
            $fxFull = "$rootName.$($fx.Name)"

            $xw.WriteStartElement('test-suite')
            $xw.WriteAttributeString('type', 'TestFixture')
            $xw.WriteAttributeString('id', [string]$id); $id++
            $xw.WriteAttributeString('name', $fx.DisplayName)
            $xw.WriteAttributeString('fullname', $fxFull)
            $xw.WriteAttributeString('classname', $fxFull)
            $xw.WriteAttributeString('runstate', 'Runnable')
            & $writeCounts $fxTotal ($fxTotal - $fxFailed) $fxFailed
            & $writeTimes
            & $writeProperties ([ordered]@{ Area = $fx.Name })
            if ($fxFailed -gt 0) {
                $xw.WriteStartElement('failure')
                $xw.WriteStartElement('message')
                $xw.WriteString("$fxFailed finding$(if ($fxFailed -ne 1) { 's' }) in $($fx.DisplayName).")
                $xw.WriteEndElement()
                $xw.WriteEndElement()
            }

            foreach ($c in $fx.Cases) {
                $caseName = & $t $c.Name
                $xw.WriteStartElement('test-case')
                $xw.WriteAttributeString('id', [string]$id); $id++
                $xw.WriteAttributeString('name', $caseName)
                $xw.WriteAttributeString('fullname', "$fxFull.$caseName")
                $xw.WriteAttributeString('methodname', $caseName)
                $xw.WriteAttributeString('classname', $fxFull)
                $xw.WriteAttributeString('runstate', 'Runnable')
                $xw.WriteAttributeString('result', $c.Result)
                if ($c.Label) { $xw.WriteAttributeString('label', $c.Label) }
                & $writeTimes
                $xw.WriteAttributeString('asserts', '1')
                & $writeProperties $c.Properties
                if ($c.Result -eq 'Failed') {
                    $xw.WriteStartElement('failure')
                    $xw.WriteStartElement('message')
                    $xw.WriteString((& $t $c.Message))
                    $xw.WriteEndElement()
                    if ($c.StackTrace) {
                        $xw.WriteStartElement('stack-trace')
                        $xw.WriteString((& $t $c.StackTrace))
                        $xw.WriteEndElement()
                    }
                    $xw.WriteEndElement()
                }
                $xw.WriteEndElement() # test-case
            }
            $xw.WriteEndElement() # fixture
        }

        $xw.WriteEndElement() # suite
        $xw.WriteEndElement() # test-run
        $xw.WriteEndDocument()
        $xw.Flush()
        return [System.Text.Encoding]::UTF8.GetString($stream.ToArray())
    } finally {
        $xw.Dispose()
        $stream.Dispose()
    }
}
