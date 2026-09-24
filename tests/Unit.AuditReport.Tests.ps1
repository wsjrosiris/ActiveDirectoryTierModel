#Requires -Modules Pester
<#
.SYNOPSIS
Unit tests for Merge-TierModelAuditResult (audit report consolidation, roadmap 0.1).

.DESCRIPTION
Audit-TierModel.ps1 -FullDeployment previously re-initialized the findings list per entity, so the
JSON report only contained the last entity's findings and the summary stayed 0. The report data is
now produced by Merge-TierModelAuditResult; these tests cover accumulation across entities, the
summary and the new Area/Severity fields.
#>

Describe 'Merge-TierModelAuditResult' -Tag 'Unit', 'Audit' {
    BeforeAll {
        Import-Module (Join-Path $PSScriptRoot '..' 'modules' 'TierModel' 'TierModel.psd1') -Force

        $script:Config = [PSCustomObject]@{
            gpos = [PSCustomObject]@{
                '{{DOMAIN_DN}}' = [PSCustomObject]@{
                    ImportOnlyGpo    = @()
                    PostConfigureGpo = @([PSCustomObject]@{ name = '*- Tier Model Account Restrictions' })
                }
                'OU=Tier 2 Devices,{{DOMAIN_DN}}' = [PSCustomObject]@{
                    ImportOnlyGpo    = @([PSCustomObject]@{ name = '*- Workstation Baseline' })
                    PostConfigureGpo = @()
                }
            }
        }

        $script:Results = @(
            [PSCustomObject]@{
                EntityType = 'OU'
                Summary = @{ TotalChecked = 10; DriftCount = 2; MissingCount = 1; MismatchCount = 1 }
                DriftFindings = @(
                    [PSCustomObject]@{ Type = 'Missing'; ResourceType = 'OrganizationalUnit'; Identifier = 'Tier 0 Groups'; ExpectedValue = 'OU=Tier 0 Groups,OU=Tier 0,DC=contoso,DC=com'; ActualValue = 'Not Found'; Details = 'missing' }
                    [PSCustomObject]@{ Type = 'Mismatch'; ResourceType = 'OrganizationalUnit'; Identifier = 'Contacts/GpoInheritance'; ExpectedValue = 'Blocked'; ActualValue = 'Inherited'; Details = 'inheritance' }
                )
                Errors = @()
            }
            [PSCustomObject]@{
                EntityType = 'Group'
                Summary = @{ TotalChecked = 5; DriftCount = 1; MissingCount = 1; MismatchCount = 0 }
                DriftFindings = @(
                    [PSCustomObject]@{ Type = 'Missing'; ResourceType = 'Group'; Identifier = 'Tier 1 Admins'; ExpectedValue = 'Present'; ActualValue = 'Missing'; Details = 'missing' }
                )
                Errors = @()
            }
            [PSCustomObject]@{
                EntityType = 'OU ACL'
                Summary = @{ TotalAcls = 4; Compliant = 2; Missing = 1; Mismatched = 0; Errors = 1 }
                Findings = @(
                    [PSCustomObject]@{ Type = 'Drift'; ResourceType = 'ACL'; Identifier = 'Tier2Admins → OU=Tier 2 Devices,{{DOMAIN_DN}}'; ActualValue = 'Missing'; Details = 'No Access Control Entry found' }
                    [PSCustomObject]@{ Type = 'Error'; ResourceType = 'ACL'; Identifier = 'Tier2Admins → OU=Tier 2 Devices,{{DOMAIN_DN}}'; Details = 'boom' }
                )
            }
            [PSCustomObject]@{
                EntityType = 'GPO'
                Summary = [PSCustomObject]@{ TotalGpos = 3; Drift = 2; Errors = 0; Compliant = 1 }
                Findings = @(
                    [PSCustomObject]@{ Type = 'Mismatch'; GpoName = 'CONTOSO- Tier Model Account Restrictions'; Message = 'link disabled' }
                    [PSCustomObject]@{ Type = 'Mismatch'; GpoName = 'CONTOSO- Workstation Baseline'; Message = 'settings differ' }
                )
                Errors = @()
            }
            [PSCustomObject]@{
                EntityType = 'ADMX'
                Summary = [PSCustomObject]@{ TotalFiles = 6; Drift = 1 }
                Findings = @([PSCustomObject]@{ Type = 'Missing'; ResourceType = 'ADML'; FileName = 'LAPS.adml'; Message = 'not found' })
            }
            [PSCustomObject]@{
                EntityType = 'MSA ACL'
                Summary = @{ TotalAcls = 3; Compliant = 1; Missing = 1; Mismatched = 0; Errors = 0; Drift = 2 }
                Findings = @(
                    [PSCustomObject]@{ Type = 'Compliant'; ResourceType = 'ACL'; Identifier = 'Tier1Admins → OU=Tier 1 Servers,{{DOMAIN_DN}}'; Details = 'ok' }
                    [PSCustomObject]@{ Type = 'MissingAcl'; ResourceType = 'ACL'; Identifier = 'Tier1Admins → OU=Tier 1 Servers,{{DOMAIN_DN}}'; Property = 'Rights'; Details = 'missing' }
                    [PSCustomObject]@{ Type = 'UnexpectedAcl'; ResourceType = 'ACL'; Identifier = 'Helpdesk → DC=contoso,DC=com'; Details = 'unexpected' }
                )
            }
            [PSCustomObject]@{
                EntityType = 'WinLaps Decryptor'
                Summary = @{ TotalAcls = 2; Compliant = 1; Missing = 0; Mismatched = 0; Errors = 1; Drift = 1 }
                Findings = @(
                    [PSCustomObject]@{ GpoName = '*- Tier 2 Devices Windows LAPS'; Expected = 'CONTOSO\Tier2Admins'; Actual = 'No matching GPO'; Status = 'Error' }
                    [PSCustomObject]@{ GpoName = '*- Tier 1 Servers Windows LAPS'; Expected = 'x'; Actual = 'x'; Status = 'Compliant' }
                )
            }
        )

        $script:Merged = Merge-TierModelAuditResult -AuditResults $script:Results -Config $script:Config
        $script:Findings = @($script:Merged.Findings)
    }

    It 'Accumulates the findings of ALL entities (not only the last one)' {
        $script:Findings.Count | Should -Be 11
        @($script:Findings | ForEach-Object Area | Sort-Object -Unique) | Should -Be @('acls', 'admx', 'gpos', 'groups', 'msa', 'ous', 'winlaps')
    }

    It 'Computes the summary from the accumulated data' {
        $s = $script:Merged.Summary
        $s.TotalChecked | Should -Be 33
        $s.MissingCount | Should -Be 5        # OU, Group, OU ACL, ADMX, MSA MissingAcl
        $s.MismatchCount | Should -Be 3       # OU + 2 GPO
        $s.UnexpectedCount | Should -Be 1
        $s.ErrorCount | Should -Be 2          # OU ACL error + WinLaps decryptor error
        $s.DriftCount | Should -Be 9
        $s.OrphanedGpoLinkCount | Should -Be 0
        $s.SecurityDeltaCount | Should -Be 0
        # OU 10-2, Group 5-1, OU ACL 2, GPO 1, ADMX 6-1, MSA 1, WinLaps 1
        $s.CompliantCount | Should -Be 22
    }

    It 'Keeps the existing finding fields unchanged' {
        $ou = $script:Findings | Where-Object { $_.Identifier -eq 'Tier 0 Groups' }
        $ou.Type | Should -Be 'Missing'
        $ou.ResourceType | Should -Be 'OrganizationalUnit'
        $ou.ExpectedValue | Should -Be 'OU=Tier 0 Groups,OU=Tier 0,DC=contoso,DC=com'
        $ou.ActualValue | Should -Be 'Not Found'
        $ou.Details | Should -Be 'missing'

        $msa = $script:Findings | Where-Object { $_.Type -eq 'MissingAcl' }
        $msa.Property | Should -Be 'Rights'
    }

    It 'Uses the single-scope conversions for OU ACL and GPO findings' {
        $acl = $script:Findings | Where-Object { $_.Area -eq 'acls' -and $_.Type -eq 'Missing' }
        @($acl.PSObject.Properties.Name) | Should -Be @('Type', 'ResourceType', 'Identifier', 'Details', 'Area', 'Severity')
        $gpo = @($script:Findings | Where-Object { $_.Area -eq 'gpos' })[0]
        @($gpo.PSObject.Properties.Name) | Should -Be @('Type', 'Identifier', 'Details', 'Area', 'Severity')
    }

    It 'Skips compliant entries' {
        $script:Findings | Where-Object { $_.Type -eq 'Compliant' -or $_.Status -eq 'Compliant' } | Should -BeNullOrEmpty
    }

    It 'Sets Severity: Tier 0 = High, Tier 1 = Medium, others = Low' {
        ($script:Findings | Where-Object Identifier -eq 'Tier 0 Groups').Severity | Should -Be 'High'
        ($script:Findings | Where-Object Identifier -eq 'Tier 1 Admins').Severity | Should -Be 'Medium'
        ($script:Findings | Where-Object Identifier -eq 'Contacts/GpoInheritance').Severity | Should -Be 'Low'
        ($script:Findings | Where-Object Type -eq 'MissingAcl').Severity | Should -Be 'Medium'
        ($script:Findings | Where-Object { $_.Area -eq 'admx' }).Severity | Should -Be 'Low'
    }

    It 'Rates GPOs linked to the domain root and ACLs on the domain root as High' {
        ($script:Findings | Where-Object Identifier -eq 'CONTOSO- Tier Model Account Restrictions').Severity | Should -Be 'High'
        ($script:Findings | Where-Object Identifier -eq 'CONTOSO- Workstation Baseline').Severity | Should -Be 'Low'
        ($script:Findings | Where-Object Type -eq 'UnexpectedAcl').Severity | Should -Be 'High'
    }

    It 'Rates Error findings as High' {
        @($script:Findings | Where-Object { $_.Type -eq 'Error' }) | ForEach-Object { $_.Severity | Should -Be 'High' }
        ($script:Findings | Where-Object { $_.Area -eq 'winlaps' }).Type | Should -Be 'Error'
    }

    It 'Serializes to the report shape with Area/Severity on every finding' {
        $json = @{ auditSummary = $script:Merged.Summary; driftFindings = @($script:Merged.Findings) } | ConvertTo-Json -Depth 10 | ConvertFrom-Json
        @($json.driftFindings).Count | Should -Be 11
        foreach ($f in $json.driftFindings) {
            $f.Area | Should -BeIn @('ous', 'groups', 'users', 'acls', 'gpos', 'admx', 'msa', 'gmsa', 'dmsa', 'winlaps')
            $f.Severity | Should -BeIn @('High', 'Medium', 'Low')
        }
    }

    It 'Handles a single entity (single-scope audits) and an empty list' {
        $single = Merge-TierModelAuditResult -AuditResults @($script:Results[1])
        @($single.Findings).Count | Should -Be 1
        $single.Findings[0].Area | Should -Be 'groups'
        $single.Summary.MissingCount | Should -Be 1

        $empty = Merge-TierModelAuditResult -AuditResults @()
        @($empty.Findings).Count | Should -Be 0
        $empty.Summary.TotalChecked | Should -Be 0
    }
}
