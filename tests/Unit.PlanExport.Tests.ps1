#Requires -Modules Pester
<#
.SYNOPSIS
Unit tests for Export-TierModelPlan (machine-readable deployment plan, roadmap 0.2).
#>

Describe 'Export-TierModelPlan' -Tag 'Unit', 'Plan' {
    BeforeAll {
        Import-Module (Join-Path $PSScriptRoot '..' 'modules' 'TierModel' 'TierModel.psd1') -Force
        $script:Timestamp = [datetime]::SpecifyKind([datetime]'2026-09-24T08:15:00', [DateTimeKind]::Utc)

        $script:OuAction = [PSCustomObject]@{
            Action       = 'CreateOU'
            ResourceType = 'OrganizationalUnit'
            Name         = 'Tier 1 Servers'
            Path         = 'OU=Tier 1 Servers,OU=Tier 1,DC=contoso,DC=com'
            Data         = [PSCustomObject]@{
                name          = 'Tier 1 Servers'
                description   = 'Tier 1 member servers'
                correctedPath = 'OU=Tier 1,DC=contoso,DC=com'
            }
        }
    }

    Context 'Document shape' {
        BeforeAll {
            $json = Export-TierModelPlan -Phases @(@{ Phase = 1; Area = 'ous'; Actions = @($script:OuAction); ExistingCount = 4 }) `
                -Scope OuOnly -PreferredDc 'dc01.contoso.com' -Timestamp $script:Timestamp
            $script:Json = $json
            $script:Doc = $json | ConvertFrom-Json
        }

        It 'Produces the documented camelCase top-level keys' {
            @($script:Doc.PSObject.Properties.Name) | Should -Be @('metadata', 'summary', 'phases', 'actions', 'warnings', 'errors')
            @($script:Doc.metadata.PSObject.Properties.Name) | Should -Be @('version', 'scope', 'preferredDc', 'timestamp', 'includes')
            @($script:Doc.summary.PSObject.Properties.Name) | Should -Be @('totalActions', 'create', 'update', 'link', 'configure', 'existing')
            @($script:Doc.phases[0].PSObject.Properties.Name) | Should -Be @('phase', 'name', 'area', 'actionCount', 'existingCount')
            @($script:Doc.actions[0].PSObject.Properties.Name) | Should -Be @('phase', 'area', 'action', 'resourceType', 'name', 'path', 'details')
        }

        It 'Fills metadata' {
            $script:Doc.metadata.version | Should -Be '1'
            $script:Doc.metadata.scope | Should -Be 'OuOnly'
            $script:Doc.metadata.preferredDc | Should -Be 'dc01.contoso.com'
            $script:Json | Should -Match '"timestamp": "2026-09-24T08:15:00Z"'
        }

        It 'Computes the summary from the actions' {
            $script:Doc.summary.totalActions | Should -Be 1
            $script:Doc.summary.create | Should -Be 1
            $script:Doc.summary.existing | Should -Be 4
        }

        It 'Writes arrays with 0 and 1 elements as JSON arrays' {
            $script:Json | Should -Match '"includes": \[\]'
            $script:Json | Should -Match '"warnings": \[\]'
            $script:Json | Should -Match '"errors": \[\]'
            $script:Json | Should -Match '"phases": \[\s*\{'
            $script:Json | Should -Match '"actions": \[\s*\{'
        }

        It 'Maps the action fields' {
            $a = $script:Doc.actions[0]
            $a.phase | Should -Be 1
            $a.area | Should -Be 'ous'
            $a.action | Should -Be 'CreateOU'
            $a.resourceType | Should -Be 'OrganizationalUnit'
            $a.name | Should -Be 'Tier 1 Servers'
            $a.path | Should -Be 'OU=Tier 1 Servers,OU=Tier 1,DC=contoso,DC=com'
            $a.details.description | Should -Be 'Tier 1 member servers'
            $script:Doc.phases[0].name | Should -Be 'Organizational Units'
        }
    }

    Context 'Details flattening' {
        BeforeAll {
            $aclAction = [PSCustomObject]@{
                Action = 'CreateAcl'; ResourceType = 'ACL'; Name = 'ACL Delegation: Tier1Admins on OU=Tier 1'; Path = 'OU=Tier 1,DC=contoso,DC=com'
                Data = [PSCustomObject]@{
                    identityreference                  = 'Tier1Admins'
                    activedirectoryrights              = @('GenericAll')
                    accesscontroltype                  = 'Allow'
                    objecttype                         = 'Computer'
                    activeDirectorysecurityinheritance = 'Descendents'
                    resolveguid                        = $false
                    password                           = 'P@ssw0rd!'
                    Validation                         = @{ TargetOUExists = $true; Nested = @{ Deep = @{ Deeper = 1 } } }
                    members                            = @('A', 'B')
                    principals                         = @([PSCustomObject]@{ right = 'SeDenyBatchLogonRight' })
                    guid                               = [guid]'5c1a2c3d-0000-4000-8000-000000000001'
                    accessType                         = [System.Security.AccessControl.AccessControlType]::Deny
                    empty                              = $null
                }
            }
            $groupAction = [PSCustomObject]@{
                Action = 'CreateGroup'; ResourceType = 'Group'; Name = 'Tier 0 Admins'; Path = 'OU=Tier 0 Groups,DC=contoso,DC=com'
                Data = @{ samaccountname = 'Tier0Admins'; groupscope = 'Global'; memberOf = @('Single') }
            }
            $json = Export-TierModelPlan -Phases @(
                @{ Phase = 2; Area = 'groups'; Actions = @($groupAction); ExistingCount = 0 },
                @{ Phase = 4; Area = 'acls'; Actions = @($aclAction); ExistingCount = 1 }
            ) -Scope FullDeployment -PreferredDc 'dc01' -Timestamp $script:Timestamp
            $script:Json = $json
            $script:Doc = $json | ConvertFrom-Json
            $script:Acl = ($script:Doc.actions | Where-Object action -eq 'CreateAcl').details
            $script:Group = ($script:Doc.actions | Where-Object action -eq 'CreateGroup').details
        }

        It 'Normalizes known config keys to camelCase' {
            $script:Acl.identityReference | Should -Be 'Tier1Admins'
            $script:Acl.rights | Should -Be @('GenericAll')
            $script:Acl.accessControlType | Should -Be 'Allow'
            $script:Acl.objectType | Should -Be 'Computer'
            $script:Acl.inheritance | Should -Be 'Descendents'
            $script:Acl.resolveGuid | Should -BeFalse
            $script:Group.samAccountName | Should -Be 'Tier0Admins'
            $script:Group.groupScope | Should -Be 'Global'
        }

        It 'Never exports secrets' {
            $script:Json | Should -Not -Match 'P@ssw0rd'
            $script:Acl.PSObject.Properties.Name | Should -Not -Contain 'password'
        }

        It 'Flattens nested objects with dotted keys and stringifies deeper levels' {
            $script:Acl.'validation.targetOUExists' | Should -BeTrue
            $script:Acl.'validation.nested.deep' | Should -BeOfType [string]
        }

        It 'Keeps single-element arrays as arrays' {
            $script:Json | Should -Match '"memberOf": \[\s*"Single"\s*\]'
            $script:Json | Should -Match '"rights": \[\s*"GenericAll"\s*\]'
        }

        It 'Turns arrays of objects into string arrays and enums/guids into strings' {
            @($script:Acl.principals)[0] | Should -BeOfType [string]
            $script:Acl.guid | Should -Be '5c1a2c3d-0000-4000-8000-000000000001'
            $script:Acl.accessType | Should -Be 'Deny'
            $script:Acl.PSObject.Properties.Name | Should -Not -Contain 'empty'
        }

        It 'Sums phases and existing counts' {
            $script:Doc.summary.totalActions | Should -Be 2
            $script:Doc.summary.create | Should -Be 2
            $script:Doc.summary.existing | Should -Be 1
            @($script:Doc.phases).Count | Should -Be 2
            $script:Doc.phases[1].area | Should -Be 'acls'
            $script:Doc.phases[1].name | Should -Be 'OU ACL Delegations'
        }
    }

    Context 'Categories, ADMX, includes, messages' {
        It 'Counts create / update / link / configure' {
            $actions = @(
                [PSCustomObject]@{ Action = 'CreateGPO'; ResourceType = 'GPO'; Name = 'g'; Path = 'p'; Data = @{ name = 'g' } }
                [PSCustomObject]@{ Action = 'ImportGPO'; ResourceType = 'GPO'; Name = 'g'; Path = 'p'; Data = @{ name = 'g' } }
                [PSCustomObject]@{ Action = 'ConfigureGPO'; ResourceType = 'GPO'; Name = 'g'; Path = 'p'; Data = @{ name = 'g' } }
                [PSCustomObject]@{ Action = 'LinkGPO'; ResourceType = 'GPO'; Name = 'g'; Path = 'p'; Data = @{ name = 'g'; linkOrder = 2; enforced = 'No' } }
                [PSCustomObject]@{ Action = 'UpdateUserMembership'; ResourceType = 'User'; Name = 'u -> g'; Path = 'p'; Data = @{ UserName = 'u'; GroupName = 'g' } }
                [PSCustomObject]@{ Action = 'ConfigureLapsDecryptor'; ResourceType = 'LapsDecryptor'; Name = 'd'; Path = 'p'; Data = @{ gpoName = 'x'; targetGroup = 'Tier 0 Admins' } }
            )
            $doc = Export-TierModelPlan -Phases @(@{ Phase = 5; Area = 'gpos'; Actions = $actions }) -Scope GposOnly -PreferredDc 'dc01' | ConvertFrom-Json
            $doc.summary.create | Should -Be 1
            $doc.summary.update | Should -Be 2
            $doc.summary.link | Should -Be 1
            $doc.summary.configure | Should -Be 2
            $doc.summary.totalActions | Should -Be 6
            ($doc.actions | Where-Object action -eq 'LinkGPO').details.linkOrder | Should -Be 2
            ($doc.actions | Where-Object action -eq 'UpdateUserMembership').details.userName | Should -Be 'u'
        }

        It 'Builds ADMX actions from the Get-TierModelAdmx analysis' {
            $admxPlan = [PSCustomObject]@{
                Analysis = @{
                    AdmxToUpdate = @(@{ Name = 'LAPS.admx'; SourcePath = 'C:\src\LAPS.admx'; DestinationPath = '\\contoso.com\SYSVOL\PolicyDefinitions\LAPS.admx'; ExpectedHash = 'ABC'; Reason = 'File not present in SYSVOL - new import'; ActionType = 'Import' })
                    AdmlToUpdate = @(@{ Name = 'LAPS.adml'; SourcePath = 's'; DestinationPath = 'd'; ExpectedHash = 'DEF'; Reason = 'Hash mismatch - overwrite required'; ActionType = 'Update' })
                    Errors = @()
                }
                Summary = [PSCustomObject]@{ FilesUpToDate = 7 }
            }
            $doc = Export-TierModelPlan -Phases @(@{ Phase = 1; Area = 'admx'; AdmxPlan = $admxPlan; ExistingCount = 7 }) -Scope AdmxOnly -PreferredDc 'dc01' | ConvertFrom-Json
            @($doc.actions).Count | Should -Be 2
            $doc.actions[0].action | Should -Be 'ImportAdmx'
            $doc.actions[0].resourceType | Should -Be 'AdmxFile'
            $doc.actions[0].details.expectedHash | Should -Be 'ABC'
            $doc.actions[1].action | Should -Be 'UpdateAdml'
            $doc.summary.create | Should -Be 1
            $doc.summary.update | Should -Be 1
            $doc.summary.existing | Should -Be 7
            $doc.phases[0].name | Should -Be 'ADMX Templates'
        }

        It 'Handles an empty plan (include-only scope) with a single include and messages' {
            $json = Export-TierModelPlan -Phases @() -Scope IncludeOnly -PreferredDc 'dc01' -Includes @('WinLaps') `
                -Warnings @('Only warning') -Errors @(@{ Message = 'Required group missing' }, @{ Message = 'Required group missing' })
            $doc = $json | ConvertFrom-Json
            $json | Should -Match '"includes": \[\s*"WinLaps"\s*\]'
            $json | Should -Match '"phases": \[\]'
            $json | Should -Match '"actions": \[\]'
            $json | Should -Match '"warnings": \[\s*"Only warning"\s*\]'
            @($doc.errors) | Should -Be @('Required group missing')
            $doc.summary.totalActions | Should -Be 0
        }

        It 'Writes UTF-8 without BOM to -Path' {
            $target = Join-Path ([System.IO.Path]::GetTempPath()) "tm-plan-$([guid]::NewGuid()).json"
            try {
                $written = Export-TierModelPlan -Phases @(@{ Phase = 1; Area = 'ous'; Actions = @($script:OuAction) }) -Scope OuOnly -PreferredDc 'dc01' -Path $target
                $written | Should -Be ([System.IO.Path]::GetFullPath($target))
                $bytes = [System.IO.File]::ReadAllBytes($target)
                ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) | Should -BeFalse
                ([System.Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json).actions[0].action | Should -Be 'CreateOU'
            } finally {
                Remove-Item -LiteralPath $target -ErrorAction SilentlyContinue
            }
        }
    }
}
