#Requires -Modules Pester
<#
.SYNOPSIS
Unit tests for the HTML and NUnit XML audit report renderers.

.DESCRIPTION
Audit-TierModel.ps1 -OutputFormat Html / NUnitXml render the same report data as the JSON report
(auditSummary, driftFindings, metadata) with ConvertTo-TierModelAuditHtml and
ConvertTo-TierModelAuditNUnitXml. These tests cover structure, encoding of < > & " ' and non-ASCII
text, the "no drift" state, large reports and the NUnit counts.
#>

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..' 'modules' 'TierModel' 'TierModel.psd1') -Force

    $script:Nasty = 'Tier 0 <script>alert("x")</script> & ''quoted'''
    $script:German = '„Domänen-Admins“'

    $script:Meta = @{
        scope       = 'FullDeployment'
        preferredDc = 'DC01.contoso.com'
        timestamp   = [datetime]'2026-09-24T08:15:00'
        version     = 'v0.2'
        configHash  = '3f2a9c0d1e'
    }

    $script:Findings = @(
        [PSCustomObject]@{ Type = 'Missing';  ResourceType = 'Group';              Identifier = $script:German; ExpectedValue = 'Present'; ActualValue = 'Missing'; Details = 'Gruppe fehlt: Domänen-Admins'; Area = 'groups'; Severity = 'High' }
        [PSCustomObject]@{ Type = 'Mismatch'; ResourceType = 'OrganizationalUnit'; Identifier = 'Contacts/GpoInheritance'; ExpectedValue = 'Blocked'; ActualValue = 'Inherited'; Details = 'inheritance'; Area = 'ous'; Severity = 'Low' }
        [PSCustomObject]@{ Type = 'Missing';  ResourceType = 'OrganizationalUnit'; Identifier = 'Tier 0 Groups'; ExpectedValue = 'OU=Tier 0 Groups,OU=Tier 0,DC=contoso,DC=com'; ActualValue = 'Not Found'; Details = 'OU missing'; Area = 'ous'; Severity = 'High' }
        [PSCustomObject]@{ Type = 'Mismatch'; ResourceType = 'ACL'; Identifier = $script:Nasty; ExpectedValue = 'a < b && c > "d"'; ActualValue = "it's <none>"; Details = $script:Nasty; Area = 'acls'; Severity = 'Medium' }
        [PSCustomObject]@{ Type = 'Error';    Identifier = 'CONTOSO- Tier 0 Baseline'; Details = 'GPO report could not be read'; Area = 'gpos'; Severity = 'High' }
        # WinLaps decryptor style finding: Expected/Actual/Message instead of ExpectedValue/ActualValue/Details
        [PSCustomObject]@{ GpoName = 'CONTOSO- Tier 2 Windows LAPS'; Expected = 'CONTOSO\Tier2Admins'; Actual = 'No matching GPO'; Status = 'Mismatch'; Type = 'Mismatch'; ResourceType = 'LapsDecryptor'; Identifier = 'CONTOSO- Tier 2 Windows LAPS'; Message = 'decryptor differs'; Area = 'winlaps'; Severity = 'Low' }
    )
    $script:Summary = @{
        TotalChecked = 40; DriftCount = 5; MissingCount = 2; MismatchCount = 3; UnexpectedCount = 0
        OrphanedGpoLinkCount = 0; SecurityDeltaCount = 0; ErrorCount = 1; CompliantCount = 34
    }
    $script:Areas = [ordered]@{
        ous     = [ordered]@{ Checked = 12; Compliant = 10; Findings = 2 }
        groups  = [ordered]@{ Checked = 8;  Compliant = 7;  Findings = 1 }
        acls    = [ordered]@{ Checked = 6;  Compliant = 5;  Findings = 1 }
        gpos    = [ordered]@{ Checked = 5;  Compliant = 4;  Findings = 1 }
        admx    = [ordered]@{ Checked = 6;  Compliant = 6;  Findings = 0 }
        winlaps = [ordered]@{ Checked = 3;  Compliant = 2;  Findings = 1 }
    }

    function New-ManyFindings {
        param([int]$Count)
        $areas = @('ous', 'groups', 'users', 'acls', 'gpos', 'admx', 'msa', 'gmsa', 'dmsa', 'winlaps', 'authsilos')
        $severities = @('High', 'Medium', 'Low')
        for ($i = 0; $i -lt $Count; $i++) {
            [PSCustomObject]@{
                Type = @('Missing', 'Mismatch', 'Unexpected')[$i % 3]; ResourceType = 'Object'
                Identifier = "Objekt-$i <Ä&Ö>"; ExpectedValue = "E$i"; ActualValue = "A$i"; Details = "Detail $i"
                Area = $areas[$i % $areas.Count]; Severity = $severities[$i % 3]
            }
        }
    }
}

Describe 'ConvertTo-TierModelAuditHtml' -Tag 'Unit', 'Audit', 'Report' {
    BeforeAll {
        $script:Html = ConvertTo-TierModelAuditHtml -AuditSummary $script:Summary -Findings $script:Findings -Metadata $script:Meta -AreaSummary $script:Areas
        [xml]$script:HtmlXml = $script:Html
        $script:Ns = $null
    }

    It 'Returns one self-contained HTML document' {
        $script:Html | Should -BeOfType [string]
        $script:Html | Should -Match '^<!DOCTYPE html>'
        $script:Html | Should -Match '<meta charset="utf-8" />'
        $script:Html | Should -Match '<style>'
    }

    It 'Does not load external resources and needs no JavaScript' {
        $script:Html | Should -Not -Match '(?i)<script'
        $script:Html | Should -Not -Match '(?i)<link\b|<img\b|<iframe\b|@import|url\(|https?://'
        $script:Html | Should -Not -Match '(?i)\son[a-z]+='
    }

    It 'Is well-formed markup (parses as XML)' {
        $script:HtmlXml.html | Should -Not -BeNullOrEmpty
        $script:HtmlXml.html.lang | Should -Be 'en'
    }

    It 'Has a print stylesheet' {
        $script:Html | Should -Match '@media print'
    }

    It 'Shows scope, domain controller, timestamp, version and configuration hash in the header' {
        $dd = @($script:HtmlXml.SelectNodes('//header//dd') | ForEach-Object InnerText)
        $dd | Should -Contain 'FullDeployment'
        $dd | Should -Contain 'DC01.contoso.com'
        $dd | Should -Contain 'v0.2'
        $dd | Should -Contain '3f2a9c0d1e'
        ($dd -join ' ') | Should -Match '2026-09-24 08:15:00'
        $script:HtmlXml.SelectSingleNode('//time').datetime | Should -Match '^2026-09-24T08:15:00'
    }

    It 'Shows the summary tiles drift, missing, mismatch, unexpected, errors and compliant' {
        $tiles = @{}
        foreach ($t in $script:HtmlXml.SelectNodes("//div[contains(concat(' ', @class, ' '), ' tile ')]")) {
            $tiles[$t.SelectSingleNode("div[@class='label']").InnerText] = [int]$t.SelectSingleNode("div[@class='value']").InnerText
        }
        $tiles['Drift'] | Should -Be 5
        $tiles['Missing'] | Should -Be 2
        $tiles['Mismatch'] | Should -Be 3
        $tiles['Unexpected'] | Should -Be 0
        $tiles['Errors'] | Should -Be 1
        $tiles['Compliant'] | Should -Be 34
    }

    It 'Groups the findings by area in audit order' {
        $ids = @($script:HtmlXml.SelectNodes("//section[contains(@class,'area')]") | ForEach-Object id)
        $ids | Should -Be @('area-ous', 'area-groups', 'area-acls', 'area-gpos', 'area-winlaps')
        # Areas without findings are only listed in the overview
        $overview = @($script:HtmlXml.SelectNodes("//section[contains(@class,'overview')]//tbody/tr") | ForEach-Object { $_.SelectSingleNode('td[1]').InnerText })
        $overview | Should -Contain 'ADMX / ADML Templates'
        $script:Html | Should -Not -Match 'id="area-admx"'
    }

    It 'Sorts findings by severity within an area and shows severity badges' {
        $rows = $script:HtmlXml.SelectNodes("//section[@id='area-ous']//tbody/tr")
        $rows.Count | Should -Be 2
        $rows[0].SelectSingleNode('td[1]/span').InnerText | Should -Be 'High'
        $rows[0].SelectSingleNode('td[1]/span').class | Should -Match 'sev-high'
        $rows[1].SelectSingleNode('td[1]/span').InnerText | Should -Be 'Low'
    }

    It 'Shows expected and actual value side by side' {
        $row = $script:HtmlXml.SelectSingleNode("//section[@id='area-ous']//tbody/tr[1]")
        $expected = $row.SelectSingleNode("td[contains(@class,'expected')]")
        $expected.InnerText | Should -Be 'OU=Tier 0 Groups,OU=Tier 0,DC=contoso,DC=com'
        $expected.NextSibling.class | Should -Match 'actual'
        $expected.NextSibling.InnerText | Should -Be 'Not Found'
    }

    It 'Falls back to Expected/Actual/Message field names' {
        $row = $script:HtmlXml.SelectSingleNode("//section[@id='area-winlaps']//tbody/tr[1]")
        $row.SelectSingleNode("td[contains(@class,'expected')]").InnerText | Should -Be 'CONTOSO\Tier2Admins'
        $row.SelectSingleNode("td[contains(@class,'actual')]").InnerText | Should -Be 'No matching GPO'
        $row.SelectSingleNode("td[contains(@class,'details')]").InnerText | Should -Be 'decryptor differs'
    }

    It 'HTML-encodes the characters less-than, greater-than, ampersand, double and single quote in every value' {
        $script:Html | Should -Not -Match '<script>alert'
        $script:Html | Should -Match ([regex]::Escape('Tier 0 &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quoted&#39;'))
        $script:Html | Should -Match ([regex]::Escape('a &lt; b &amp;&amp; c &gt; &quot;d&quot;'))
        $script:Html | Should -Match ([regex]::Escape('it&#39;s &lt;none&gt;'))

        # Round trip: the decoded cell text equals the original value
        $row = $script:HtmlXml.SelectSingleNode("//section[@id='area-acls']//tbody/tr[1]")
        $row.SelectSingleNode("td[contains(@class,'identifier')]").InnerText | Should -BeExactly $script:Nasty
        $row.SelectSingleNode("td[contains(@class,'details')]").InnerText | Should -BeExactly $script:Nasty
        $row.SelectSingleNode("td[contains(@class,'expected')]").InnerText | Should -BeExactly 'a < b && c > "d"'
    }

    It 'Keeps non-ASCII text such as „Domänen-Admins“ intact' {
        $script:Html | Should -Match ([regex]::Escape($script:German))
        $row = $script:HtmlXml.SelectSingleNode("//section[@id='area-groups']//tbody/tr[1]")
        $row.SelectSingleNode("td[contains(@class,'identifier')]").InnerText | Should -BeExactly $script:German
        $row.SelectSingleNode("td[contains(@class,'details')]").InnerText | Should -BeExactly 'Gruppe fehlt: Domänen-Admins'
    }

    It 'Encodes metadata values too' {
        $html = ConvertTo-TierModelAuditHtml -AuditSummary $script:Summary -Findings @() -Metadata @{ scope = '<b>x</b>'; preferredDc = 'dc"1'; configHash = "a'b&c" }
        $html | Should -Not -Match '<b>x</b>'
        $html | Should -Match '&lt;b&gt;x&lt;/b&gt;'
        $html | Should -Match 'dc&quot;1'
        $html | Should -Match 'a&#39;b&amp;c'
        { [xml]$html } | Should -Not -Throw
    }

    It 'Replaces control characters that XML/HTML do not allow' {
        $f = [PSCustomObject]@{ Type = 'Mismatch'; Identifier = "bad`u{0001}char"; Details = "x`u{001B}y"; Area = 'ous'; Severity = 'Low' }
        $html = ConvertTo-TierModelAuditHtml -AuditSummary @{} -Findings @($f) -Metadata $script:Meta
        { [xml]$html } | Should -Not -Throw
        $html | Should -Match "bad$([char]0xFFFD)char"
    }

    It 'Marks the report as failed with drift and errors' {
        $script:HtmlXml.SelectSingleNode("//span[contains(@class,'status')]").class | Should -Match 'bad'
        $script:HtmlXml.SelectSingleNode("//span[contains(@class,'status')]").InnerText | Should -Be '5 drift items, 1 error'
        $script:Html | Should -Not -Match 'All compliant'
    }

    Context 'All compliant' {
        BeforeAll {
            $script:Empty = ConvertTo-TierModelAuditHtml -AuditSummary @{ TotalChecked = 25; DriftCount = 0; ErrorCount = 0; CompliantCount = 25 } -Findings @() -Metadata $script:Meta -AreaSummary ([ordered]@{ ous = @{ Checked = 25; Compliant = 25; Findings = 0 } })
            [xml]$script:EmptyXml = $script:Empty
        }

        It 'Shows the all-compliant state and no findings tables' {
            $script:EmptyXml.SelectSingleNode("//div[@class='allgood']") | Should -Not -BeNullOrEmpty
            $script:EmptyXml.SelectSingleNode("//div[@class='allgood']").InnerText | Should -Match 'All compliant'
            $script:EmptyXml.SelectSingleNode("//div[@class='allgood']").InnerText | Should -Match '25 of 25 checked items compliant'
            $script:EmptyXml.SelectSingleNode("//span[contains(@class,'status')]").class | Should -Match 'ok'
            $script:EmptyXml.SelectNodes("//section[contains(@class,'area')]").Count | Should -Be 0
        }

        It 'Accepts $null / empty input' {
            $html = ConvertTo-TierModelAuditHtml -AuditSummary $null -Findings $null -Metadata $null
            { [xml]$html } | Should -Not -Throw
            $html | Should -Match 'All compliant'
            $html | Should -Match '<dd>n/a</dd>'
        }

        It 'Does not claim compliance when errors were counted without findings' {
            $html = ConvertTo-TierModelAuditHtml -AuditSummary @{ TotalChecked = 3; ErrorCount = 2 } -Findings @() -Metadata $script:Meta
            $html | Should -Not -Match 'All compliant'
            $html | Should -Match 'class="errnote"'
            $html | Should -Match '2 audit errors'
        }
    }

    It 'Derives missing summary counters from the findings (single-scope audits)' {
        $html = ConvertTo-TierModelAuditHtml -AuditSummary @{ TotalChecked = 10 } -Findings $script:Findings -Metadata $script:Meta
        [xml]$x = $html
        $value = { param($label) [int]$x.SelectSingleNode("//div[div[@class='label']='$label']/div[@class='value']").InnerText }
        & $value 'Missing' | Should -Be 2
        & $value 'Mismatch' | Should -Be 3
        & $value 'Errors' | Should -Be 1
        & $value 'Drift' | Should -Be 5
    }

    It 'Renders many findings' {
        $many = @(New-ManyFindings -Count 1200)
        $elapsed = Measure-Command {
            $script:ManyHtml = ConvertTo-TierModelAuditHtml -AuditSummary @{ TotalChecked = 5000 } -Findings $many -Metadata $script:Meta
        }
        [xml]$x = $script:ManyHtml
        $x.SelectNodes("//section[contains(@class,'area')]//tbody/tr").Count | Should -Be 1200
        $x.SelectNodes("//section[contains(@class,'area')]").Count | Should -Be 11
        $elapsed.TotalSeconds | Should -BeLessThan 60
    }
}

Describe 'ConvertTo-TierModelAuditNUnitXml' -Tag 'Unit', 'Audit', 'Report' {
    BeforeAll {
        $script:Xml = ConvertTo-TierModelAuditNUnitXml -AuditSummary $script:Summary -Findings $script:Findings -Metadata $script:Meta -AreaSummary $script:Areas
        [xml]$script:Doc = $script:Xml

        # Checks that the counts on every level match the test cases below it
        function Assert-NUnitCounts {
            param([xml]$Document)
            $nodes = @($Document.SelectNodes('/test-run | //test-suite'))
            foreach ($n in $nodes) {
                $cases = @($n.SelectNodes('.//test-case'))
                $failed = @($cases | Where-Object { $_.result -eq 'Failed' }).Count
                $passed = @($cases | Where-Object { $_.result -eq 'Passed' }).Count
                [int]$n.total | Should -Be $cases.Count -Because "total of $($n.name)"
                [int]$n.testcasecount | Should -Be $cases.Count -Because "testcasecount of $($n.name)"
                [int]$n.failed | Should -Be $failed -Because "failed of $($n.name)"
                [int]$n.passed | Should -Be $passed -Because "passed of $($n.name)"
                $n.result | Should -Be $(if ($failed -gt 0) { 'Failed' } else { 'Passed' }) -Because "result of $($n.name)"
            }
        }
    }

    It 'Is a well-formed UTF-8 XML document with an NUnit 3 test-run root' {
        $script:Xml | Should -Match '^<\?xml version="1\.0" encoding="utf-8"\?>'
        $script:Doc.DocumentElement.get_LocalName() | Should -Be 'test-run'
        $script:Doc.'test-run'.name | Should -Be 'TierModelAudit'
        $script:Doc.'test-run'.'start-time' | Should -Match '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}Z$'
    }

    It 'Has test-run -> test-suite -> one TestFixture per area -> test-case' {
        $suite = $script:Doc.SelectSingleNode('/test-run/test-suite')
        $suite.type | Should -Be 'TestSuite'
        $suite.name | Should -Be 'TierModelAudit (FullDeployment)'
        $fixtures = @($suite.SelectNodes('test-suite'))
        @($fixtures | ForEach-Object type | Sort-Object -Unique) | Should -Be @('TestFixture')
        @($fixtures | ForEach-Object fullname) | Should -Be @('TierModelAudit.ous', 'TierModelAudit.groups', 'TierModelAudit.acls', 'TierModelAudit.gpos', 'TierModelAudit.admx', 'TierModelAudit.winlaps')
        $script:Doc.SelectNodes('//test-suite[@type="TestFixture"]/test-case').Count | Should -Be $script:Doc.SelectNodes('//test-case').Count
    }

    It 'Writes scope, DC and config hash as suite properties' {
        $props = @{}
        foreach ($p in $script:Doc.SelectNodes('/test-run/test-suite/properties/property')) { $props[$p.name] = $p.value }
        $props.Scope | Should -Be 'FullDeployment'
        $props.PreferredDc | Should -Be 'DC01.contoso.com'
        $props.ConfigHash | Should -Be '3f2a9c0d1e'
    }

    It 'Writes one failed test case per finding' {
        $failed = @($script:Doc.SelectNodes('//test-case[@result="Failed"]'))
        $failed.Count | Should -Be $script:Findings.Count
    }

    It 'Uses Details as failure message and adds Expected/Actual' {
        $case = $script:Doc.SelectSingleNode('//test-case[@name="[Missing] OrganizationalUnit/Tier 0 Groups"]')
        $case | Should -Not -BeNullOrEmpty
        $case.classname | Should -Be 'TierModelAudit.ous'
        $msg = $case.failure.message
        ($msg -split "`n")[0] | Should -Be 'OU missing'
        $msg | Should -Match 'Expected: OU=Tier 0 Groups,OU=Tier 0,DC=contoso,DC=com'
        $msg | Should -Match 'Actual:\s+Not Found'
        $msg | Should -Match 'Severity: High'
        $case.failure.'stack-trace' | Should -Match 'Area: ous'
    }

    It 'Labels Error findings' {
        $case = $script:Doc.SelectSingleNode('//test-case[@label="Error"]')
        $case.name | Should -Be '[Error] CONTOSO- Tier 0 Baseline'
        $case.result | Should -Be 'Failed'
    }

    It 'Writes one passed case per area with the compliant count' {
        $passed = @($script:Doc.SelectNodes('//test-case[@result="Passed"]'))
        $passed.Count | Should -Be 6
        $ous = $script:Doc.SelectSingleNode('//test-suite[@fullname="TierModelAudit.ous"]/test-case[@result="Passed"]')
        $ous.name | Should -Be '10 compliant items'
        ($ous.properties.property | Where-Object name -eq 'CompliantCount').value | Should -Be '10'
        ($ous.properties.property | Where-Object name -eq 'CheckedCount').value | Should -Be '12'
        # Area without findings: only the passed case
        $admx = @($script:Doc.SelectNodes('//test-suite[@fullname="TierModelAudit.admx"]/test-case'))
        $admx.Count | Should -Be 1
        $admx[0].result | Should -Be 'Passed'
    }

    It 'Has consistent counts on every level' {
        Assert-NUnitCounts -Document $script:Doc
        [int]$script:Doc.'test-run'.total | Should -Be 12
        [int]$script:Doc.'test-run'.failed | Should -Be 6
        [int]$script:Doc.'test-run'.passed | Should -Be 6
        $script:Doc.'test-run'.result | Should -Be 'Failed'
    }

    It 'XML-escapes less-than, greater-than, ampersand and quotes in names, messages and properties' {
        $script:Xml | Should -Not -Match '<script>'
        $case = @($script:Doc.SelectNodes('//test-suite[@fullname="TierModelAudit.acls"]/test-case[@result="Failed"]'))[0]
        $case.name | Should -BeExactly "[Mismatch] ACL/$($script:Nasty)"
        ($case.failure.message -split "`n")[0] | Should -BeExactly $script:Nasty
        $case.failure.message | Should -Match ([regex]::Escape('Expected: a < b && c > "d"'))
        $case.failure.message | Should -Match ([regex]::Escape("Actual:   it's <none>"))
        ($case.properties.property | Where-Object name -eq 'Identifier').value | Should -BeExactly $script:Nasty
    }

    It 'Keeps non-ASCII text such as „Domänen-Admins“ intact' {
        $script:Xml | Should -Match ([regex]::Escape($script:German))
        $case = $script:Doc.SelectSingleNode('//test-suite[@fullname="TierModelAudit.groups"]/test-case[@result="Failed"]')
        $case.name | Should -BeExactly "[Missing] Group/$($script:German)"
        ($case.failure.message -split "`n")[0] | Should -BeExactly 'Gruppe fehlt: Domänen-Admins'
    }

    It 'Survives control characters that XML does not allow' {
        $f = [PSCustomObject]@{ Type = 'Mismatch'; Identifier = "bad`u{0001}char"; Details = "x`u{0008}y"; Area = 'ous'; Severity = 'Low' }
        $xml = ConvertTo-TierModelAuditNUnitXml -AuditSummary @{} -Findings @($f) -Metadata $script:Meta
        { [xml]$xml } | Should -Not -Throw
        ([xml]$xml).SelectSingleNode('//test-case').name | Should -Be "[Mismatch] bad$([char]0xFFFD)char"
    }

    It 'Makes duplicate test case names unique within a fixture' {
        $f = [PSCustomObject]@{ Type = 'Missing'; ResourceType = 'ACL'; Identifier = 'same'; Details = 'd'; Area = 'acls'; Severity = 'Low' }
        [xml]$x = ConvertTo-TierModelAuditNUnitXml -AuditSummary @{} -Findings @($f, $f, $f) -Metadata $script:Meta
        $names = @($x.SelectNodes('//test-case[@result="Failed"]') | ForEach-Object name)
        $names.Count | Should -Be 3
        @($names | Sort-Object -Unique).Count | Should -Be 3
    }

    Context 'No drift' {
        It 'Writes a passing run with one compliant case when there are no findings' {
            [xml]$x = ConvertTo-TierModelAuditNUnitXml -AuditSummary @{ TotalChecked = 25; CompliantCount = 25; DriftCount = 0; ErrorCount = 0 } -Findings @() -Metadata $script:Meta
            $x.'test-run'.result | Should -Be 'Passed'
            [int]$x.'test-run'.total | Should -Be 1
            [int]$x.'test-run'.failed | Should -Be 0
            $x.SelectSingleNode('//test-case').name | Should -Be '25 compliant items'
            $x.SelectSingleNode('//test-suite[@type="TestSuite"]/failure') | Should -BeNullOrEmpty
            Assert-NUnitCounts -Document $x
        }

        It 'Writes one passed case per audited area' {
            $areas = [ordered]@{ ous = @{ Checked = 4; Compliant = 4; Findings = 0 }; groups = @{ Checked = 2; Compliant = 2; Findings = 0 } }
            [xml]$x = ConvertTo-TierModelAuditNUnitXml -AuditSummary @{ TotalChecked = 6; CompliantCount = 6 } -Findings @() -Metadata $script:Meta -AreaSummary $areas
            @($x.SelectNodes('//test-suite[@type="TestFixture"]') | ForEach-Object fullname) | Should -Be @('TierModelAudit.ous', 'TierModelAudit.groups')
            @($x.SelectNodes('//test-case') | ForEach-Object name) | Should -Be @('4 compliant items', '2 compliant items')
            Assert-NUnitCounts -Document $x
        }

        It 'Accepts $null input' {
            { [xml](ConvertTo-TierModelAuditNUnitXml -AuditSummary $null -Findings $null -Metadata $null) } | Should -Not -Throw
        }
    }

    It 'Uses the summary compliant count for a single area without per-area counts' {
        $f = [PSCustomObject]@{ Type = 'Missing'; ResourceType = 'Group'; Identifier = 'G1'; Details = 'd'; Area = 'groups'; Severity = 'Low' }
        [xml]$x = ConvertTo-TierModelAuditNUnitXml -AuditSummary @{ TotalChecked = 5; CompliantCount = 4 } -Findings @($f) -Metadata $script:Meta
        $x.SelectSingleNode('//test-case[@result="Passed"]').name | Should -Be '4 compliant items'
        Assert-NUnitCounts -Document $x
    }

    It 'Reports audit errors without findings as a failed case' {
        [xml]$x = ConvertTo-TierModelAuditNUnitXml -AuditSummary @{ TotalChecked = 3; CompliantCount = 3; ErrorCount = 2 } -Findings @() -Metadata $script:Meta
        $case = $x.SelectSingleNode('//test-suite[@fullname="TierModelAudit.audit"]/test-case')
        $case.result | Should -Be 'Failed'
        $case.label | Should -Be 'Error'
        $x.'test-run'.result | Should -Be 'Failed'
        Assert-NUnitCounts -Document $x
    }

    It 'Renders many findings with consistent counts' {
        $many = @(New-ManyFindings -Count 1200)
        [xml]$x = ConvertTo-TierModelAuditNUnitXml -AuditSummary @{ TotalChecked = 5000; CompliantCount = 3800 } -Findings $many -Metadata $script:Meta
        $x.SelectNodes('//test-case[@result="Failed"]').Count | Should -Be 1200
        $x.SelectNodes('//test-suite[@type="TestFixture"]').Count | Should -Be 12   # 11 areas + overall
        [int]$x.'test-run'.total | Should -Be 1201
        Assert-NUnitCounts -Document $x
    }
}

Describe 'Audit report renderers with Merge-TierModelAuditResult output' -Tag 'Unit', 'Audit', 'Report' {
    BeforeAll {
        $results = @(
            [PSCustomObject]@{
                EntityType = 'OU'
                Summary = @{ TotalChecked = 10; DriftCount = 1; MissingCount = 1; MismatchCount = 0 }
                DriftFindings = @([PSCustomObject]@{ Type = 'Missing'; ResourceType = 'OrganizationalUnit'; Identifier = 'Tier 0 Groups'; ExpectedValue = 'Present'; ActualValue = 'Not Found'; Details = 'missing' })
                Errors = @()
            }
            [PSCustomObject]@{
                EntityType = 'Group'
                Summary = @{ TotalChecked = 4; DriftCount = 0; MissingCount = 0; MismatchCount = 0 }
                DriftFindings = @()
                Errors = @()
            }
        )
        $script:Merged = Merge-TierModelAuditResult -AuditResults $results
    }

    It 'Merge-TierModelAuditResult returns per-area counts' {
        $script:Merged.Areas.ous.Checked | Should -Be 10
        $script:Merged.Areas.ous.Compliant | Should -Be 9
        $script:Merged.Areas.ous.Findings | Should -Be 1
        $script:Merged.Areas.groups.Compliant | Should -Be 4
    }

    It 'NUnit XML matches the merged summary' {
        [xml]$x = ConvertTo-TierModelAuditNUnitXml -AuditSummary $script:Merged.Summary -Findings $script:Merged.Findings -Metadata $script:Meta -AreaSummary $script:Merged.Areas
        [int]$x.'test-run'.failed | Should -Be $script:Merged.Summary.DriftCount
        $compliant = 0
        foreach ($p in $x.SelectNodes('//test-case[@result="Passed"]/properties/property[@name="CompliantCount"]')) { $compliant += [int]$p.value }
        $compliant | Should -Be $script:Merged.Summary.CompliantCount
    }

    It 'HTML shows the merged per-area counts' {
        [xml]$x = ConvertTo-TierModelAuditHtml -AuditSummary $script:Merged.Summary -Findings $script:Merged.Findings -Metadata $script:Meta -AreaSummary $script:Merged.Areas
        $x.SelectSingleNode("//section[@id='area-ous']//span[@class='counts']").InnerText | Should -Match '1 finding . 9 compliant . 10 checked'
    }
}
