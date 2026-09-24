@{
    RootModule           = 'TierModel.Service.Client.psm1'
    ModuleVersion        = '1.4.0'
    GUID                 = '3f0c6a52-8d5e-4b8e-9a51-6f2b7c1d9e44'
    Author               = 'TierModel Team'
    CompanyName          = 'Enterprise AD'
    Copyright            = '(c) 2026 Enterprise AD. All rights reserved.'
    Description          = 'Client for the TierModel Service REST API: start audits, monitor runs and deploys with an API token, wait for runs and read results.'
    PowerShellVersion    = '7.2'
    CompatiblePSEditions = @('Core')
    FunctionsToExport    = @(
        'Connect-TierModelService',
        'Disconnect-TierModelService',
        'Get-TierModelRun',
        'Start-TierModelAudit',
        'Start-TierModelMonitor',
        'Start-TierModelDeploy',
        'Wait-TierModelRun',
        'Get-TierModelRunLog',
        'Get-TierModelPrivileged',
        'Get-TierModelCompliance',
        'Get-TierModelConfigSection',
        'Get-TierModelDomain'
    )
    CmdletsToExport      = @()
    VariablesToExport    = @()
    AliasesToExport      = @()
    PrivateData          = @{
        PSData = @{
            Tags = @('ActiveDirectory', 'TierModel', 'REST')
        }
    }
}
