# Drift Detection Details

This document provides detailed guidance for using the `Audit-TierModel.ps1` script to detect configuration drift between the TierModel configuration and the actual Active Directory state.

## Overview
`Audit-TierModel.ps1` analyzes current Active Directory state against the declarative Tier Model configuration using modular Test-TierModel* cmdlets. It identifies missing objects, mismatched configurations, and provides structured drift findings for remediation.

## Basic Drift Detection

### Full Deployment Audit
```powershell
# Run comprehensive audit of all components
.\Audit-TierModel.ps1 -PreferredDc DC01.contoso.com -FullDeployment

.\Audit-TierModel.ps1 -PreferredDc DC01.contoso.com -FullDeployment -IncludeMsa -IncludeGmsa -IncludeDmsa -IncludeWinLaps
```

### Scoped Audits
```powershell
# Audit only organizational units
.\Audit-TierModel.ps1 -PreferredDc DC01.contoso.com -OuOnly

# Audit only groups
.\Audit-TierModel.ps1 -PreferredDc DC01.contoso.com -GroupOnly

# Audit only Users
.\Audit-TierModel.ps1 -PreferredDc DC01.contoso.com -UserOnly

# Audit only OU ACLs
.\Audit-TierModel.ps1 -PreferredDc DC01.contoso.com -OuAclsOnly

# Audit only GPOs
.\Audit-TierModel.ps1 -PreferredDc DC01.contoso.com -GposOnly

# Audit only ADMX templates
.\Audit-TierModel.ps1 -PreferredDc DC01.contoso.com -AdmxOnly

# Audit only MSA ACL delegations (optional feature)
.\Audit-TierModel.ps1 -PreferredDc DC01.contoso.com -IncludeMsa

# Audit only gMSA ACL delegations (optional feature)
.\Audit-TierModel.ps1 -PreferredDc DC01.contoso.com -IncludeGmsa

# Audit only dMSA ACL delegations (optional feature)
.\Audit-TierModel.ps1 -PreferredDc DC01.contoso.com -IncludeDmsa

# Audit only Windows LAPS ACL delegations + GPO decryptor (optional feature)
.\Audit-TierModel.ps1 -PreferredDc DC01.contoso.com -IncludeWinLaps
```

## Audit Output Structure

The audit script displays real-time progress and returns structured results:

### Console Output
Each component audit displays:
- **Summary**: TotalChecked, Missing, Mismatched, Total Drift, Compliance %
- **Warnings**: Non-critical issues requiring attention
- **Errors**: Critical issues preventing full audit
- **Drift Findings**: Detailed list of configuration mismatches

### Drift Finding Structure
| Field | Description |
|-------|-------------|
| Type | Missing, Mismatch, ExtraProtection, HashMismatch |
| ResourceType | OrganizationalUnit, Group, User, GPO, ACL, ADMXTemplate |
| Identifier | Object name or distinguished name |
| ExpectedValue | Configuration from JSON |
| ActualValue | Current AD state (null if missing) |
| Details | Human-readable description |
| Area | Configuration area: ous, groups, users, acls, gpos, admx, msa, gmsa, dmsa, winlaps |
| Severity | High (Tier 0 objects, GPOs linked to the domain root or a Tier 0 OU, errors), Medium (Tier 1), Low (other) |

## Generating Reports

### JSON Output for Automation
```powershell
.\Audit-TierModel.ps1 -PreferredDc DC01.contoso.com -FullDeployment `
    -OutputFormat Json `
    -OutputFileBase "TierModel-Audit" `
    -LogPath "C:\Reports"
```

**JSON Structure:**
```json
{
  "auditSummary": {
    "TotalChecked": 150,
    "DriftCount": 3,
    "MissingCount": 1,
    "UnexpectedCount": 0,
    "MismatchCount": 2,
    "OrphanedGpoLinkCount": 0,
    "SecurityDeltaCount": 0,
    "ErrorCount": 0,
    "CompliantCount": 147
  },
  "driftFindings": [
    {
      "Type": "Missing",
      "ResourceType": "OrganizationalUnit",
      "Identifier": "Tier0-PAW-Staging",
      "ExpectedValue": "OU=PAW Staging,OU=Tier Model Administration,DC=contoso,DC=com",
      "ActualValue": null,
      "Details": "OU does not exist in Active Directory",
      "Area": "ous",
      "Severity": "Low"
    }
  ],
  "metadata": {
    "scope": "FullDeployment",
    "preferredDc": "DC01.contoso.com",
    "timestamp": "2026-02-27T10:30:00Z",
    "version": "v0.2",
    "configHash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
  }
}
```

### File names

All report formats are written to `-LogPath` (or the current directory when it is omitted) as
`<OutputFileBase>-MMddyy-HHmm.<ext>`: `.txt` (Text), `.json` (Json), `.html` (Html) and `.xml`
(NUnitXml). The directory is created when it does not exist. JSON, HTML and NUnit XML are rendered
from the same data: `auditSummary`, `driftFindings` (with `Area` and `Severity`) and `metadata`
(scope, preferred DC, timestamp, version, configuration hash). HTML and NUnit XML additionally use
the per-area counts (checked / compliant / findings) that `Merge-TierModelAuditResult` returns in
its `Areas` property.

### HTML Report
```powershell
.\Audit-TierModel.ps1 -PreferredDc DC01.contoso.com -GposOnly `
    -OutputFormat Html `
    -OutputFileBase "GPO-Compliance" `
    -LogPath "C:\Reports"
# -> C:\Reports\GPO-Compliance-092426-1030.html
```

The HTML report is one self-contained file (rendered by `ConvertTo-TierModelAuditHtml`):

- **No external resources, no JavaScript.** All CSS is inline, so the file can be mailed, attached
  to a ticket or opened offline. Light theme with a print stylesheet (table headers repeat on every
  page, rows are not split, badge colours are kept).
- **Header:** scope, domain controller, generation time, report version and configuration hash,
  plus an overall status (`Compliant - no drift detected` or `N drift items, M errors`).
- **Summary tiles:** Drift, Missing, Mismatch, Unexpected, Errors, Compliant; below them the checked
  total, orphaned GPO links, security deltas and the number of High / Medium / Low findings.
- **Area overview:** one row per audited area (Organizational Units, Groups, Users, OU ACL
  Delegations, Group Policy Objects, ADMX / ADML Templates, MSA/gMSA/dMSA ACL Delegations,
  Windows LAPS, Authentication Policies and Silos) with findings per severity, compliant and
  checked counts; areas with findings link to their section.
- **Findings per area:** a table per area, sorted by severity (High, Medium, Low), then type and
  identifier, with the columns Severity, Type, Resource, Identifier, **Expected** and **Actual**
  (side by side, tinted green/red) and Details. Findings that use `Expected`/`Actual`/`Message`
  (e.g. the Windows LAPS decryptor audit) are shown in the same columns.
- **No drift:** when there are no findings and no errors, a green "All compliant" panel replaces
  the tables ("Active Directory matches the Tier Model configuration. 147 of 147 checked items
  compliant, no drift findings."). Errors or drift that were counted without finding details are
  shown as a red note instead, never as compliant.
- **Encoding:** every value (findings and metadata) is HTML-encoded (`&` `<` `>` `"` `'`); non-ASCII
  text such as `„Domänen-Admins“` is written unchanged as UTF-8. Control characters that are not
  valid in HTML/XML are replaced with U+FFFD. The output is well-formed XML, so it can also be
  checked with `[xml]`.

Excerpt of a findings table (one area):

```html
<section class="card area" id="area-groups" aria-labelledby="area-title-groups">
<div class="card-head"><h2 id="area-title-groups">Groups</h2><span class="counts">1 finding &#183; 17 compliant &#183; 18 checked</span></div>
<div class="card-body table-wrap">
<table>
<thead><tr><th scope="col" class="sorted">Severity</th><th scope="col" class="sortable">Type</th><th scope="col" class="sortable">Resource</th><th scope="col" class="sortable">Identifier</th><th scope="col">Expected</th><th scope="col">Actual</th><th scope="col">Details</th></tr></thead>
<tbody>
<tr><td><span class="badge sev-high">High</span></td><td><span class="badge type">Mismatch</span></td><td class="resource">Group</td><td class="identifier mono">Tier0-Admins</td><td class="expected">Member: Tier0-Admin01</td><td class="actual">Member: Tier0-Admin01, Helpdesk &lt;Ops&gt;</td><td class="details">Membership differs from configuration</td></tr>
</tbody>
</table>
</div>
</section>
```

The renderer can also be used directly, e.g. to re-render a saved JSON report:

```powershell
Import-Module .\modules\TierModel\TierModel.psd1
$report = Get-Content .\Reports\TierModel-Audit-092426-1030.json -Raw | ConvertFrom-Json
ConvertTo-TierModelAuditHtml -AuditSummary $report.auditSummary -Findings $report.driftFindings -Metadata $report.metadata |
    Set-Content .\Reports\TierModel-Audit.html -Encoding utf8
```

(Without the per-area counts of `Merge-TierModelAuditResult` the overview shows `–` in the
Compliant/Checked columns.)

### NUnit XML for CI/CD Integration
```powershell
.\Audit-TierModel.ps1 -PreferredDc DC01.contoso.com -FullDeployment `
    -OutputFormat NUnitXml `
    -OutputFileBase "TierModel-Tests" `
    -LogPath "C:\TestResults"
# -> C:\TestResults\TierModel-Tests-092426-1030.xml
```

The file is an **NUnit 3** test result (`<test-run>` root, rendered by
`ConvertTo-TierModelAuditNUnitXml`), so CI systems show the audit like a test run:

| NUnit element | Content |
|---------------|---------|
| `test-run` / `test-suite type="TestSuite"` | `TierModelAudit (<scope>)`; properties Scope, PreferredDc, ReportVersion, ConfigHash, TotalChecked, DriftCount, ErrorCount, CompliantCount |
| `test-suite type="TestFixture"` | one per area, in audit order (`fullname` = `TierModelAudit.<area>`, e.g. `TierModelAudit.ous`) |
| `test-case result="Failed"` | one per finding, named `[Type] ResourceType/Identifier`; `failure/message` = Details, then `Expected:` / `Actual:` / `Severity:` lines; `stack-trace` lists Area, Type, Severity, ResourceType, Identifier; `Error` findings carry `label="Error"` |
| `test-case result="Passed"` | one per area: `N compliant items` (properties CompliantCount, CheckedCount). The report data does not list compliant objects individually, so they are summarised per area. An area without findings always gets this case. |
| fixture `audit` | one failed case when the summary counts audit errors that have no finding of their own |
| fixture `overall` | the compliant count when there is no per-area breakdown (e.g. an empty audit) |

`total`, `passed` and `failed` on every level are computed from the written test cases, so they
always add up (Azure DevOps and the GitHub reporters show exactly these numbers). A run with at
least one finding has `result="Failed"`. All values are XML-escaped; duplicate case names within
an area get a ` (#2)` suffix.

Example (full deployment, two findings):

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- TierModel audit report (NUnit 3 format) generated by Audit-TierModel.ps1 -->
<test-run id="0" name="TierModelAudit" fullname="TierModelAudit" runstate="Runnable" testcasecount="4" result="Failed" total="4" passed="2" failed="2" warnings="0" inconclusive="0" skipped="0" asserts="4" engine-version="3.0.0" clr-version="9.0.8" start-time="2026-09-24 10:30:00Z" end-time="2026-09-24 10:30:00Z" duration="0.000">
  <command-line>Audit-TierModel.ps1 -PreferredDc DC01.contoso.com (FullDeployment)</command-line>
  <test-suite type="TestSuite" id="1" name="TierModelAudit (FullDeployment)" fullname="TierModelAudit" runstate="Runnable" testcasecount="4" result="Failed" total="4" passed="2" failed="2" ...>
    <properties>
      <property name="Scope" value="FullDeployment" />
      <property name="PreferredDc" value="DC01.contoso.com" />
      <property name="ConfigHash" value="9f86d081884c7d65" />
      ...
    </properties>
    <failure>
      <message>2 of 4 audit checks failed (drift: 2, errors: 0).</message>
    </failure>
    <test-suite type="TestFixture" id="2" name="Organizational Units" fullname="TierModelAudit.ous" classname="TierModelAudit.ous" testcasecount="2" result="Failed" total="2" passed="1" failed="1" ...>
      ...
      <test-case id="3" name="[Missing] OrganizationalUnit/Tier0-PAW-Staging" fullname="TierModelAudit.ous.[Missing] OrganizationalUnit/Tier0-PAW-Staging" classname="TierModelAudit.ous" result="Failed" ...>
        <properties>
          <property name="Severity" value="Low" />
          <property name="Type" value="Missing" />
          ...
        </properties>
        <failure>
          <message>OU does not exist in Active Directory
Expected: OU=PAW Staging,OU=Tier Model Administration,DC=contoso,DC=com
Actual:   (not specified)
Severity: Low</message>
          <stack-trace>Area: ous
Type: Missing
Severity: Low
ResourceType: OrganizationalUnit
Identifier: Tier0-PAW-Staging</stack-trace>
        </failure>
      </test-case>
      <test-case id="4" name="41 compliant items" fullname="TierModelAudit.ous.41 compliant items" classname="TierModelAudit.ous" result="Passed" ...>
        <properties>
          <property name="CompliantCount" value="41" />
          <property name="Area" value="ous" />
          <property name="CheckedCount" value="42" />
        </properties>
      </test-case>
    </test-suite>
    <test-suite type="TestFixture" id="5" name="Groups" fullname="TierModelAudit.groups" ...>
      <test-case id="6" name="[Mismatch] Group/Tier0-Admins" ... result="Failed" ...>
        ...
        <failure>
          <message>Membership differs from configuration
Expected: Member: Tier0-Admin01
Actual:   Member: Tier0-Admin01, Helpdesk &lt;Ops&gt;
Severity: High</message>
          ...
        </failure>
      </test-case>
      <test-case id="7" name="17 compliant items" ... result="Passed" ... />
    </test-suite>
  </test-suite>
</test-run>
```

Without drift the run contains only passed `N compliant items` cases and has `result="Passed"`.

**Publishing the result**

Azure DevOps (`PublishTestResults@2` reads NUnit 3 with the `NUnit` format):

```yaml
- task: PowerShell@2
  displayName: TierModel drift audit
  inputs:
    pwsh: true
    targetType: inline
    script: |
      ./Audit-TierModel.ps1 -PreferredDc $(PreferredDc) -FullDeployment `
        -OutputFormat NUnitXml -OutputFileBase TierModel-Audit -LogPath '$(Build.ArtifactStagingDirectory)/audit'
- task: PublishTestResults@2
  condition: always()
  inputs:
    testResultsFormat: NUnit
    testResultsFiles: '$(Build.ArtifactStagingDirectory)/audit/TierModel-Audit-*.xml'
    testRunTitle: TierModel drift audit
    failTaskOnFailedTests: true
```

GitHub Actions (self-hosted runner in the domain; any reporter that reads NUnit 3 XML, e.g.
`EnricoMi/publish-unit-test-result-action`):

```yaml
- name: TierModel drift audit
  shell: pwsh
  run: ./Audit-TierModel.ps1 -PreferredDc ${{ vars.PREFERRED_DC }} -FullDeployment -OutputFormat NUnitXml -OutputFileBase TierModel-Audit -LogPath audit
- name: Publish audit result
  if: always()
  uses: EnricoMi/publish-unit-test-result-action/windows@v2
  with:
    nunit_files: audit/TierModel-Audit-*.xml
    check_name: TierModel drift audit
```

The audit script itself exits with 0 when it completes; use the published test result (for example
`failTaskOnFailedTests: true`) to fail the pipeline on drift.

## Interpreting Common Drift Issues

| Type | ResourceType | Cause | Recommended Action |
|------|--------------|-------|---------------------|
| Missing | OrganizationalUnit | OU deleted manually | Re-run Deploy-TierModel.ps1 with -OuOnly or -FullDeployment |
| Missing | Group | Group deleted or not created | Re-run Deploy-TierModel.ps1 with -GroupOnly |
| Missing | User | User account deleted or not created | Re-run Deploy-TierModel.ps1 with -UserOnly |
| Missing | ADMXTemplate | Template removed from PolicyDefinitions | Re-run Deploy-TierModel.ps1 with -AdmxOnly |
| Missing | ACL | OU ACL delegation not applied | Re-run Deploy-TierModel.ps1 with -OuAclsOnly |
| Missing | ManagedServiceAccountACL | MSA ACL delegation not applied | Re-run Deploy-TierModel.ps1 with -IncludeMsa (optional feature) |
| Missing | GroupManagedServiceAccountACL | gMSA ACL delegation not applied | Re-run Deploy-TierModel.ps1 with -IncludeGmsa (optional feature) |
| Missing | DelegatedManagedServiceAccountACL | dMSA ACL delegation not applied | Re-run Deploy-TierModel.ps1 with -IncludeDmsa (optional feature) |
| Missing | LapsPermission | Windows LAPS ACL delegation not applied | Re-run Deploy-TierModel.ps1 with -IncludeWinLaps (optional feature); verify LAPS schema is extended |
| Missing | LapsDecryptor | ADPasswordEncryptionPrincipal not set on LAPS GPO | Re-run Deploy-TierModel.ps1 with -IncludeWinLaps; ensure GPO exists before re-deploying |
| Mismatch | Group | Membership differs from config | Manual remediation or update configuration |
| Mismatch | User | User properties differ from config | Manual remediation or update configuration |
| Mismatch | GPO | Link order incorrect | Manual GPO link order adjustment required |
| Mismatch | ManagedServiceAccountACL | MSA ACL permissions do not match config | Re-run Deploy-TierModel.ps1 with -IncludeMsa |
| Mismatch | GroupManagedServiceAccountACL | gMSA ACL permissions do not match config | Re-run Deploy-TierModel.ps1 with -IncludeGmsa |
| Mismatch | DelegatedManagedServiceAccountACL | dMSA ACL permissions do not match config | Re-run Deploy-TierModel.ps1 with -IncludeDmsa |
| Mismatched | LapsDecryptor | ADPasswordEncryptionPrincipal set to wrong principal | Re-run Deploy-TierModel.ps1 with -IncludeWinLaps to correct the GPO registry value |
| HashMismatch | ADMXTemplate | Template file content differs | Re-run Deploy-TierModel.ps1 with -AdmxOnly to update |
| ExtraProtection | OrganizationalUnit | Additional OU protection enabled | Manual review; may be intentional hardening |

## Integrating with CI/CD

### Scheduled Drift Detection
```powershell
# Daily audit with JSON output for trending
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
.\Audit-TierModel.ps1 -PreferredDc DC01.contoso.com -FullDeployment `
    -OutputFormat Json `
    -OutputFileBase "TierModel-Audit-$timestamp" `
    -LogPath "\\FileServer\ComplianceReports"
```

### CI Pipeline Integration
See [CI/CD Documentation](ci-cd.md) for examples of integrating audit scripts into GitHub Actions and Azure DevOps pipelines.

## Remediation Workflow

1. **Run Audit**: Identify drift using `Audit-TierModel.ps1`
2. **Review Findings**: Analyze DriftFindings for Missing/Mismatch issues
3. **Plan Remediation**: Decide whether to update config or redeploy
4. **Deploy Changes**: Use `Deploy-TierModel.ps1` with appropriate scope
5. **Verify**: Re-run audit to confirm drift resolution

## Component-Specific Details

### OUs (Organizational Units)
- **Checks**: Existence, protection from deletion, GPO inheritance blocking
- **Cmdlet**: `Test-TierModelOu`
- **Common Issues**: Missing OUs, mismatched protection settings

### Groups
- **Checks**: Existence, group scope, group category, description
- **Cmdlet**: `Test-TierModelGroup`
- **Common Issues**: Missing groups, membership drift (future)

### Users
- **Checks**: Existence, enabled status, OU placement
- **Cmdlet**: `Test-TierModelUser`
- **Common Issues**: Missing users, incorrect OU assignment

### GPOs
- **Checks**: Existence, link presence, link order, settings (partial)
- **Cmdlets**: `Test-TierModelGpo`, `Test-TierModelGPOAudit`, `Test-TierModelGPOLink`
- **Common Issues**: Missing GPOs, incorrect link order, missing links

### OU ACLs
- **Checks**: Presence of delegation ACEs for specified groups
- **Cmdlet**: `Test-TierModelOuAcl`
- **Common Issues**: Missing delegations, extra permissions

### ADMX Templates
- **Checks**: File existence, MD5 hash verification
- **Cmdlet**: `Test-TierModelAdmx`
- **Common Issues**: Missing templates, outdated files (hash mismatch)

### Managed Service Account (MSA) ACLs (Optional)
- **Checks**: Presence of delegation ACEs on msDS-ManagedServiceAccount objects
- **Cmdlets**: `Test-TierModelMsaAcl`, `Get-TierModelMsaAcl`
- **Enable with**: `-IncludeMsa` switch
- **Common Issues**: Missing delegations, extra permissions on MSA objects
- **Example**:
  ```powershell
  .\Audit-TierModel.ps1 -IncludeMsa -PreferredDc DC01.contoso.com
  ```

### Group Managed Service Account (gMSA) ACLs (Optional)
- **Checks**: Presence of delegation ACEs on msDS-GroupManagedServiceAccount objects
- **Cmdlets**: `Test-TierModelGmsaAcl`, `Get-TierModelGmsaAcl`
- **Enable with**: `-IncludeGmsa` switch
- **Common Issues**: Missing delegations, extra permissions on gMSA objects
- **Example**:
  ```powershell
  .\Audit-TierModel.ps1 -IncludeGmsa -PreferredDc DC01.contoso.com
  ```

### Delegated Managed Service Account (dMSA) ACLs (Optional)
- **Checks**: Presence of delegation ACEs on msDS-DelegatedManagedServiceAccount objects
- **Cmdlets**: `Test-TierModelDmsaAcl`, `Get-TierModelDmsaAcl`
- **Enable with**: `-IncludeDmsa` switch
- **Common Issues**: Missing delegations, extra permissions on dMSA objects
- **Example**:
  ```powershell
  .\Audit-TierModel.ps1 -IncludeDmsa -PreferredDc DC01.contoso.com
  ```

### Windows LAPS ACL Delegations (Optional)
- **Checks**: Self-permission (computer writes own LAPS attributes), Read-permission, Reset-permission on each configured OU; AND `ADPasswordEncryptionPrincipal` registry value on each non-DC LAPS GPO
- **Cmdlets**: `Test-TierModelWinLapsAcl` (ACL delegation audit), `Test-TierModelWinLapsDecryptor` (GPO decryptor audit)
- **Enable with**: `-IncludeWinLaps` switch
- **Prerequisites**: Windows LAPS schema extension (`ms-LAPS-Password` attribute) must be present; all 7 configured LAPS GPOs must exist
- **Windows LAPS only** — legacy Microsoft LAPS (`ms-Mcs-AdmPwd*`, `AdmPwd.PS`) is never checked
- **Opt-in**: `-FullDeployment` without `-IncludeWinLaps` does **not** audit Windows LAPS; the flag is required
- **Drift types**:
  - `MissingAcl` / `LapsPermission` — Self, Read, or Reset permission absent on a target OU
  - `Missing` / `LapsDecryptor` — `ADPasswordEncryptionPrincipal` not set on a LAPS GPO
  - `Mismatched` / `LapsDecryptor` — `ADPasswordEncryptionPrincipal` set to wrong principal (case-insensitive compare)
  - `Error` — GPO pattern matched 0 or multiple GPOs, or group resolution failed
- **Domain Controllers OU**: always skipped in decryptor audit — DSRM uses Domain Admins by Microsoft specification
- **Examples**:
  ```powershell
  # Audit only Windows LAPS ACLs + decryptor
  .\Audit-TierModel.ps1 -IncludeWinLaps -PreferredDc DC01.contoso.com

  # Full audit including Windows LAPS
  .\Audit-TierModel.ps1 -FullDeployment -IncludeWinLaps -PreferredDc DC01.contoso.com
  ```

## Notes
- Drift detection is **read-only**; no changes are made to AD
- Remediation is performed using `Deploy-TierModel.ps1` script
- MD5 hash-based ADMX drift detection is fully implemented
- MSA/gMSA/dMSA drift detection is optional and enabled via `-IncludeMsa`, `-IncludeGmsa`, `-IncludeDmsa` switches
- Windows LAPS drift detection is optional and enabled via `-IncludeWinLaps` switch; requires LAPS schema to be present

## Related Documentation

For additional documentation, see:
- [Deployment Methodology](deployment-methodology.md)
- [Quick Deployment Guide](quick-deployment-guide.md)
- [Detailed Deployment Guide](detailed-deployment-guide.md)
- [CI/CD](ci-cd.md)
