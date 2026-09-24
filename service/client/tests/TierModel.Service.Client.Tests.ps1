#Requires -Modules @{ ModuleName = 'Pester'; ModuleVersion = '5.0' }

BeforeAll {
    $modulePath = Join-Path $PSScriptRoot '..' 'TierModel.Service.Client' 'TierModel.Service.Client.psd1'
    Import-Module $modulePath -Force
    $script:ValidToken = 'tmk_abcd1234_' + ('A' * 43)
}

AfterAll {
    Remove-Module TierModel.Service.Client -Force -ErrorAction SilentlyContinue
}

Describe 'Module manifest' {
    It 'is valid and exports the documented commands' {
        $m = Test-ModuleManifest (Join-Path $PSScriptRoot '..' 'TierModel.Service.Client' 'TierModel.Service.Client.psd1')
        $m.ExportedFunctions.Keys | Should -Contain 'Connect-TierModelService'
        $m.ExportedFunctions.Keys | Should -Contain 'Wait-TierModelRun'
        $m.ExportedFunctions.Keys | Should -Not -Contain 'Invoke-TierModelApi'
        $m.ExportedFunctions.Keys | Should -Contain 'Get-TierModelDomain'
        $m.ExportedFunctions.Count | Should -Be 12
    }

    It 'has comment-based help for every command' {
        foreach ($name in (Get-Command -Module TierModel.Service.Client).Name) {
            (Get-Help $name).Synopsis | Should -Not -BeNullOrEmpty -Because $name
            (Get-Help $name).Synopsis | Should -Not -Match "^\s*$name" -Because "$name needs a written synopsis"
        }
    }
}

Describe 'Connect-TierModelService' {
    BeforeEach {
        Disconnect-TierModelService
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod { [pscustomobject]@{ user = [pscustomobject]@{ username = 'svc-audit'; role = 'Editor' } } }
    }

    It 'checks the token with /api/auth/me and sends it as bearer header' {
        $c = Connect-TierModelService -Uri 'https://tm.contoso.local:8443/' -Token $script:ValidToken
        $c.User | Should -Be 'svc-audit'
        $c.Role | Should -Be 'Editor'
        $c.Uri | Should -Be 'https://tm.contoso.local:8443'
        Should -Invoke -ModuleName TierModel.Service.Client Invoke-RestMethod -Times 1 -ParameterFilter {
            $Uri -eq 'https://tm.contoso.local:8443/api/auth/me' -and $Authentication -eq 'Bearer' -and
            (ConvertFrom-SecureString $Token -AsPlainText) -eq $script:ValidToken -and $Uri -notmatch 'tmk_'
        }
    }

    It 'accepts a SecureString and passes -SkipCertificateCheck' {
        $secure = ConvertTo-SecureString $script:ValidToken -AsPlainText -Force
        Connect-TierModelService -Uri 'https://tm' -Token $secure -SkipCertificateCheck | Out-Null
        Should -Invoke -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter { $SkipCertificateCheck -eq $true }
    }

    It 'rejects malformed tokens without calling the service' {
        { Connect-TierModelService -Uri 'https://tm' -Token 'geheim' } | Should -Throw '*Format*'
        Should -Invoke -ModuleName TierModel.Service.Client Invoke-RestMethod -Times 0
    }

    It 'reports a rejected token readably and stays disconnected' {
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod {
            $response = [System.Net.Http.HttpResponseMessage]::new([System.Net.HttpStatusCode]::Unauthorized)
            $ex = [Microsoft.PowerShell.Commands.HttpResponseException]::new('401', $response)
            $record = [System.Management.Automation.ErrorRecord]::new($ex, 'Unauthorized', 'AuthenticationError', $null)
            $record.ErrorDetails = [System.Management.Automation.ErrorDetails]::new('{"title":"Nicht angemeldet","detail":"Das API-Token ist abgelaufen."}')
            throw $record
        }
        { Connect-TierModelService -Uri 'https://tm' -Token $script:ValidToken } | Should -Throw '*Das API-Token ist abgelaufen*'
        { Get-TierModelRun } | Should -Throw '*Keine Verbindung*'
    }
}

Describe 'Commands' {
    BeforeAll {
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod { [pscustomobject]@{ user = [pscustomobject]@{ username = 'ops'; role = 'Operator' } } }
        Connect-TierModelService -Uri 'https://tm' -Token $script:ValidToken | Out-Null
    }

    It 'requires a connection' {
        Disconnect-TierModelService
        { Get-TierModelCompliance } | Should -Throw '*Connect-TierModelService*'
        Connect-TierModelService -Uri 'https://tm' -Token $script:ValidToken | Out-Null
    }

    It 'lists runs with filters as query string' {
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod { [pscustomobject]@{ items = @([pscustomobject]@{ id = 7; status = 'Failed' }); total = 1 } }
        $runs = @(Get-TierModelRun -Kind Audit -Status Failed -First 5)
        $runs.Count | Should -Be 1
        $runs[0].PSObject.TypeNames[0] | Should -Be 'TierModel.Service.Run'
        Should -Invoke -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter {
            $Method -eq 'GET' -and $Uri -like 'https://tm/api/runs?*' -and $Uri -match 'kind=Audit' -and $Uri -match 'status=Failed' -and $Uri -match 'pageSize=5'
        }
    }

    It 'gets one run by id' {
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod { [pscustomobject]@{ id = 42; status = 'Succeeded' } }
        (Get-TierModelRun -Id 42).id | Should -Be 42
        Should -Invoke -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter { $Uri -eq 'https://tm/api/runs/42' }
    }

    It 'starts an audit with a JSON body' {
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod { [pscustomobject]@{ id = 5; status = 'Queued' } }
        (Start-TierModelAudit -PreferredDc 'dc01.contoso.local' -Scope OuOnly).id | Should -Be 5
        Should -Invoke -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter {
            $b = $Body | ConvertFrom-Json
            $Method -eq 'POST' -and $Uri -eq 'https://tm/api/runs/audit' -and $b.preferredDc -eq 'dc01.contoso.local' -and $b.scope -eq 'OuOnly' -and $b.includeMsa -eq $false
        }
    }

    It 'rejects unknown scopes' {
        { Start-TierModelAudit -PreferredDc dc01 -Scope Everything } | Should -Throw
    }

    It 'starts a monitor run' {
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod { [pscustomobject]@{ id = 6; kind = 'Monitor' } }
        (Start-TierModelMonitor -PreferredDc dc01).kind | Should -Be 'Monitor'
        Should -Invoke -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter { $Uri -eq 'https://tm/api/runs/monitor' -and ($Body | ConvertFrom-Json).preferredDc -eq 'dc01' }
    }

    It 'starts a planning run without confirmation' {
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod { [pscustomobject]@{ id = 8; mode = 'Plan' } }
        (Start-TierModelDeploy -Plan -PreferredDc dc01 -Scope GroupOnly).id | Should -Be 8
        Should -Invoke -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter {
            $b = $Body | ConvertFrom-Json
            $Uri -eq 'https://tm/api/runs/deploy' -and $b.confirmApply -eq $false -and $b.scope -eq 'GroupOnly'
        }
    }

    It 'applies a plan with the parameters of the planning run' {
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter { $Method -eq 'GET' } {
            [pscustomobject]@{ id = 8; kind = 'Deploy'; mode = 'Plan'; status = 'Succeeded'; preferredDc = 'dc02'; scope = 'FullDeployment'; includes = @('Gmsa'); admlLanguage = 'de-DE' }
        }
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter { $Method -eq 'POST' } { [pscustomobject]@{ id = 9; status = 'Scheduled'; scheduledFor = '2026-09-25T20:00:00Z' } }
        $run = Start-TierModelDeploy -Apply -PlanRunId 8 -Confirm:$false
        $run.status | Should -Be 'Scheduled'
        Should -Invoke -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter {
            $Method -eq 'POST' -and $(
                $b = $Body | ConvertFrom-Json
                $b.confirmApply -eq $true -and $b.planRunId -eq 8 -and $b.preferredDc -eq 'dc02' -and $b.includeGmsa -eq $true -and $b.includeMsa -eq $false -and $b.admlLanguage -eq 'de-DE')
        }
    }

    It 'does not apply with -WhatIf' {
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter { $Method -eq 'GET' } {
            [pscustomobject]@{ id = 8; kind = 'Deploy'; mode = 'Plan'; status = 'Succeeded'; preferredDc = 'dc02'; scope = 'OuOnly'; includes = @(); admlLanguage = 'en-US' }
        }
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter { $Method -eq 'POST' } { throw 'must not be called' }
        Start-TierModelDeploy -Apply -PlanRunId 8 -WhatIf
        Should -Invoke -ModuleName TierModel.Service.Client Invoke-RestMethod -Times 0 -ParameterFilter { $Method -eq 'POST' }
    }

    It 'refuses to apply a run that is not a successful plan' {
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod { [pscustomobject]@{ id = 3; kind = 'Audit'; mode = $null; status = 'Succeeded' } }
        { Start-TierModelDeploy -Apply -PlanRunId 3 -Confirm:$false } | Should -Throw '*kein Planungslauf*'
    }

    It 'waits until the run is finished' {
        $script:calls = 0
        Mock -ModuleName TierModel.Service.Client Start-Sleep { }
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod {
            $script:calls++
            $status = switch ($script:calls) { 1 { 'Queued' } 2 { 'Running' } default { 'Succeeded' } }
            [pscustomobject]@{ id = 11; status = $status; driftCount = 0 }
        }
        $run = [pscustomobject]@{ id = 11 } | Wait-TierModelRun -PollSeconds 1
        $run.status | Should -Be 'Succeeded'
        Should -Invoke -ModuleName TierModel.Service.Client Invoke-RestMethod -Times 3 -Exactly
        Should -Invoke -ModuleName TierModel.Service.Client Start-Sleep -Times 2 -Exactly
    }

    It 'times out while a run stays scheduled' {
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod { [pscustomobject]@{ id = 12; status = 'Scheduled'; scheduledFor = '2026-09-25T20:00:00Z' } }
        { Wait-TierModelRun -Id 12 -TimeoutSeconds 1 -PollSeconds 1 } | Should -Throw '*Zeitüberschreitung*Scheduled*'
    }

    It 'pages through the run log' {
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod {
            [pscustomobject]@{ status = 'Succeeded'; lines = @([pscustomobject]@{ seq = 1; text = 'a'; level = 'info' }, [pscustomobject]@{ seq = 2; text = 'b'; level = 'error' }) }
        }
        $lines = @(Get-TierModelRunLog -Id 4)
        $lines.Count | Should -Be 2
        Should -Invoke -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter { $Uri -eq 'https://tm/api/runs/4/log?after=0' }
    }

    It 'reads privileged overview, compliance and configuration sections' {
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter { $Uri -like '*/api/config/sections/groups' } {
            [pscustomobject]@{ key = 'groups'; version = 3; updatedAt = '2026-09-24T10:00:00Z'; updatedBy = 'admin'; content = [pscustomobject]@{ groups = @([pscustomobject]@{ name = 'T0-Admins' }) } }
        }
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter { $Uri -like '*/api/compliance' } { [pscustomobject]@{ score = 87 } }
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter { $Uri -like '*/api/privileged' } { [pscustomobject]@{ groups = @() } }
        $section = Get-TierModelConfigSection -Key groups
        $section.Version | Should -Be 3
        $section.Content.groups[0].name | Should -Be 'T0-Admins'
        (Get-TierModelCompliance).score | Should -Be 87
        (Get-TierModelPrivileged).groups | Should -HaveCount 0
        { Get-TierModelConfigSection -Key '../users' } | Should -Throw
    }
}

Describe 'Several domains' {
    BeforeEach {
        Disconnect-TierModelService
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter { $Uri -like '*/api/auth/me' } {
            [pscustomobject]@{ user = [pscustomobject]@{ username = 'ops'; role = 'Operator' } }
        }
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter { $Uri -like '*/api/domains' } {
            @([pscustomobject]@{ id = 1; key = 'contoso'; isDefault = $true }, [pscustomobject]@{ id = 2; key = 'fabrikam'; isDefault = $false })
        }
    }

    It 'sends no domain header without -Domain (default domain of the service)' {
        (Connect-TierModelService -Uri 'https://tm' -Token $script:ValidToken).Domain | Should -BeNullOrEmpty
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter { $Uri -like '*/api/runs*' } { [pscustomobject]@{ items = @(); total = 0 } }
        Get-TierModelRun | Out-Null
        Should -Invoke -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter { $Uri -like '*/api/runs*' -and -not $Headers.ContainsKey('X-TierModel-Domain') }
    }

    It 'checks the domain on connect and sends it with every request' {
        (Connect-TierModelService -Uri 'https://tm' -Token $script:ValidToken -Domain FABRIKAM).Domain | Should -Be 'fabrikam'
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter { $Uri -like '*/api/compliance' } { [pscustomobject]@{ current = @() } }
        Get-TierModelCompliance | Out-Null
        Should -Invoke -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter { $Uri -like '*/api/compliance' -and $Headers['X-TierModel-Domain'] -eq 'fabrikam' }
        Get-TierModelCompliance -Domain contoso | Out-Null
        Should -Invoke -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter { $Uri -like '*/api/compliance' -and $Headers['X-TierModel-Domain'] -eq 'contoso' }
    }

    It 'rejects an unknown domain and stays disconnected' {
        { Connect-TierModelService -Uri 'https://tm' -Token $script:ValidToken -Domain northwind } | Should -Throw '*nicht eingerichtet*'
        { Get-TierModelRun } | Should -Throw '*Keine Verbindung*'
    }

    It 'lists the domains' {
        Connect-TierModelService -Uri 'https://tm' -Token $script:ValidToken | Out-Null
        (Get-TierModelDomain).key | Should -Be @('contoso', 'fabrikam')
    }

    It 'uses the domain controller of the domain when none is given' {
        Connect-TierModelService -Uri 'https://tm' -Token $script:ValidToken | Out-Null
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter { $Uri -like '*/api/settings' } { [pscustomobject]@{ defaultPreferredDc = 'dc01.fabrikam.com' } }
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter { $Uri -like '*/api/runs/audit' } { [pscustomobject]@{ id = 21; status = 'Queued' } }
        (Start-TierModelAudit -Domain fabrikam -Confirm:$false).id | Should -Be 21
        Should -Invoke -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter { $Uri -like '*/api/settings' -and $Headers['X-TierModel-Domain'] -eq 'fabrikam' }
        Should -Invoke -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter {
            $Uri -like '*/api/runs/audit' -and $Headers['X-TierModel-Domain'] -eq 'fabrikam' -and ($Body | ConvertFrom-Json).preferredDc -eq 'dc01.fabrikam.com'
        }
    }

    It 'applies a plan in the domain of the planning run' {
        Connect-TierModelService -Uri 'https://tm' -Token $script:ValidToken | Out-Null
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter { $Uri -like '*/api/runs/30' } {
            [pscustomobject]@{ id = 30; kind = 'Deploy'; mode = 'Plan'; status = 'Succeeded'; preferredDc = 'dc01.fabrikam.com'; scope = 'OuOnly'; includes = @();
                admlLanguage = 'en-US'; domainId = 2; domain = [pscustomobject]@{ id = 2; key = 'fabrikam' } }
        }
        Mock -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter { $Method -eq 'POST' } { [pscustomobject]@{ id = 31; status = 'Queued' } }
        Start-TierModelDeploy -Apply -PlanRunId 30 -Confirm:$false | Out-Null
        Should -Invoke -ModuleName TierModel.Service.Client Invoke-RestMethod -ParameterFilter { $Method -eq 'POST' -and $Headers['X-TierModel-Domain'] -eq 'fabrikam' }
    }
}
