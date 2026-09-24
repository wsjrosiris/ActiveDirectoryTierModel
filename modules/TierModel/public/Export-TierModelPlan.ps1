# TierModel deployment plan export
# Serializes the in-memory deployment plan of Deploy-TierModel.ps1 (planning mode) to a stable,
# machine-readable JSON document (consumed by the TierModel Service).

# Canonical phase names per area
$script:TierModelPlanAreaNames = [ordered]@{
    ous     = 'Organizational Units'
    groups  = 'Groups'
    users   = 'Users'
    acls    = 'OU ACL Delegations'
    gpos    = 'Group Policy Objects'
    admx    = 'ADMX Templates'
    msa     = 'MSA ACL Delegations'
    gmsa    = 'gMSA ACL Delegations'
    dmsa    = 'dMSA ACL Delegations'
    winlaps = 'Windows LAPS ACL Delegations'
    authsilos = 'Authentication Policies and Silos'
}

# Known lower-case configuration keys -> camelCase detail keys
$script:TierModelPlanKeyMap = @{
    'identityreference'                  = 'identityReference'
    'activedirectoryrights'              = 'rights'
    'accesscontroltype'                  = 'accessControlType'
    'objecttype'                         = 'objectType'
    'inheritedobjecttype'                = 'inheritedObjectType'
    'activedirectorysecurityinheritance' = 'inheritance'
    'resolveguid'                        = 'resolveGuid'
    'targetoupath'                       = 'targetOuPath'
    'samaccountname'                     = 'samAccountName'
    'groupscope'                         = 'groupScope'
    'groupcategory'                      = 'groupCategory'
    'memberof'                           = 'memberOf'
    'displayname'                        = 'displayName'
    'oupath'                             = 'ouPath'
    'correctedpath'                      = 'correctedPath'
    'linkorder'                          = 'linkOrder'
    'linkenabled'                        = 'linkEnabled'
    'gponame'                            = 'gpoName'
    'gpostatus'                          = 'gpoStatus'
    'gpocomment'                         = 'gpoComment'
    'importpath'                         = 'importPath'
    'targetgroup'                        = 'targetGroup'
    'usersamaccountname'                 = 'userSamAccountName'
    'username'                           = 'userName'
    'groupname'                          = 'groupName'
    'protectedfromaccidentaldeletion'    = 'protectedFromAccidentalDeletion'
}

function ConvertTo-TierModelPlanKey {
    <# Converts a data key to camelCase (internal helper). #>
    param([Parameter(Mandatory)][string]$Key)
    $mapped = $script:TierModelPlanKeyMap[$Key.ToLowerInvariant()]
    if ($mapped) { return $mapped }
    if ($Key -cmatch '^[A-Z]{2,}$') { return $Key.ToLowerInvariant() }
    return $Key.Substring(0, 1).ToLowerInvariant() + $Key.Substring(1)
}

function Test-TierModelPlanSecretKey {
    <# True for keys that may hold secrets - never exported (internal helper). #>
    param([string]$Key)
    return ($Key -match '(?i)password|passwd|pwd|secret|credential|token|privatekey|apikey')
}

function ConvertTo-TierModelPlanScalar {
    <#
    Converts one value to a JSON-safe scalar (string/number/bool) or $null when it is complex
    (internal helper).
    #>
    param($Value)
    if ($null -eq $Value) { return $null }
    if ($Value -is [string] -or $Value -is [bool]) { return $Value }
    if ($Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal] -or
        $Value -is [single] -or $Value -is [int16] -or $Value -is [byte] -or $Value -is [uint32] -or $Value -is [uint64]) { return $Value }
    if ($Value -is [enum] -or $Value -is [guid] -or $Value -is [System.Security.Principal.SecurityIdentifier]) { return [string]$Value }
    if ($Value -is [datetime]) { return $Value.ToUniversalTime().ToString('o') }
    if ($Value -is [datetimeoffset]) { return $Value.UtcDateTime.ToString('o') }
    if ($Value -is [switch]) { return [bool]$Value }
    # AD objects and other rich .NET objects: reduce to a stable identifying string
    $typeName = $Value.GetType().FullName
    if ($typeName -like 'Microsoft.ActiveDirectory.*' -or $typeName -like 'Microsoft.GroupPolicy.*' -or $typeName -like 'System.DirectoryServices.*') {
        foreach ($p in @('DistinguishedName', 'DisplayName', 'Name', 'Value')) {
            if ($Value.PSObject.Properties[$p] -and $Value.$p) { return [string]$Value.$p }
        }
        return [string]$Value
    }
    return $null
}

function ConvertTo-TierModelPlanDetail {
    <#
    .SYNOPSIS
    Flattens an action's Data object to simple values (internal helper).

    .DESCRIPTION
    Result: ordered dictionary of camelCase keys with string / number / bool / string[] values.
    Nested objects are flattened with dotted keys ("parent.child"); arrays of simple values become
    string arrays; arrays of objects become arrays of compact JSON strings. Keys that may contain
    secrets (password, secret, credential, token, ...) are dropped, as are null values.
    #>
    param(
        $Data,
        [string]$Prefix = '',
        [int]$Depth = 0,
        [System.Collections.Specialized.OrderedDictionary]$Target
    )

    if ($null -eq $Target) { $Target = [ordered]@{} }
    if ($null -eq $Data) { return $Target }

    $pairs = @()
    if ($Data -is [System.Collections.IDictionary]) {
        foreach ($k in @($Data.Keys | Sort-Object { [string]$_ })) { $pairs += , @([string]$k, $Data[$k]) }
    } elseif ($null -ne (ConvertTo-TierModelPlanScalar $Data)) {
        $Target[$(if ($Prefix) { $Prefix } else { 'value' })] = ConvertTo-TierModelPlanScalar $Data
        return $Target
    } else {
        foreach ($p in $Data.PSObject.Properties) {
            if ($p.MemberType -in @('NoteProperty', 'Property', 'AliasProperty')) { $pairs += , @($p.Name, $p.Value) }
        }
    }

    foreach ($pair in $pairs) {
        $rawKey = $pair[0]
        $value = $pair[1]
        if ([string]::IsNullOrWhiteSpace($rawKey) -or (Test-TierModelPlanSecretKey $rawKey)) { continue }
        if ($value -is [System.Security.SecureString] -or $value -is [System.Management.Automation.PSCredential]) { continue }
        $key = ConvertTo-TierModelPlanKey $rawKey
        if ($Prefix) { $key = "$Prefix.$key" }
        if ($null -eq $value) { continue }

        $scalar = ConvertTo-TierModelPlanScalar $value
        if ($null -ne $scalar) {
            $Target[$key] = $scalar
            continue
        }

        if ($value -is [System.Collections.IEnumerable] -and $value -isnot [System.Collections.IDictionary]) {
            $items = New-Object System.Collections.Generic.List[string]
            foreach ($item in $value) {
                if ($null -eq $item) { continue }
                $itemScalar = ConvertTo-TierModelPlanScalar $item
                if ($null -ne $itemScalar) {
                    $items.Add([string]$itemScalar)
                } else {
                    $items.Add(($item | ConvertTo-Json -Depth 6 -Compress -WarningAction SilentlyContinue))
                }
            }
            $Target[$key] = [string[]]$items.ToArray()
            continue
        }

        # Nested object: flatten (bounded), deeper levels are stringified
        if ($Depth -lt 2) {
            $null = ConvertTo-TierModelPlanDetail -Data $value -Prefix $key -Depth ($Depth + 1) -Target $Target
        } else {
            $Target[$key] = ($value | ConvertTo-Json -Depth 6 -Compress -WarningAction SilentlyContinue)
        }
    }
    return $Target
}

function ConvertTo-TierModelPlanMessage {
    <# Error/warning entries (strings or @{Message=...} objects) -> string (internal helper). #>
    param($Entry)
    if ($null -eq $Entry) { return $null }
    if ($Entry -is [string]) { return $Entry }
    if ($Entry -is [System.Collections.IDictionary]) {
        if ($Entry.Contains('Message') -and $Entry['Message']) { return [string]$Entry['Message'] }
    } elseif ($Entry.PSObject.Properties['Message'] -and $Entry.Message) {
        return [string]$Entry.Message
    }
    return [string]$Entry
}

function Get-TierModelPlanActionCategory {
    <#
    Summary bucket of an action: create | update | link | configure (internal helper).
    CreateOU/CreateGroup/CreateUser/CreateAcl/CreateGPO/ImportAdmx/ImportAdml -> create;
    UpdateUserMembership/ImportGPO/UpdateAdmx/UpdateAdml -> update; LinkGPO -> link;
    ConfigureGPO/ConfigureLapsDecryptor -> configure.
    Auth silos: CreateAuthPolicy/CreateAuthSilo -> create; UpdateAuthPolicy/UpdateAuthSilo/
    AddDeviceGroupMember -> update; GrantSiloAccess/AssignSilo -> configure.
    #>
    param([string]$Action)
    switch -Regex ($Action) {
        '^Import(Admx|Adml)$' { return 'create' }
        '^Create'             { return 'create' }
        '^(Update|Import)'    { return 'update' }
        '^Link'               { return 'link' }
        '^Configure'          { return 'configure' }
        '^(Grant|Assign)'     { return 'configure' }
        '^Add'                { return 'update' }
        default               { return 'create' }
    }
}

function ConvertTo-TierModelAdmxPlanAction {
    <#
    Builds plan actions from a Get-TierModelAdmx analysis (ADMX has no action objects):
    Action ImportAdmx/UpdateAdmx/ImportAdml/UpdateAdml, ResourceType AdmxFile/AdmlFile (internal helper).
    #>
    param($AdmxPlan)
    $actions = @()
    if ($null -eq $AdmxPlan -or -not $AdmxPlan.PSObject.Properties['Analysis'] -or $null -eq $AdmxPlan.Analysis) { return $actions }
    $analysis = $AdmxPlan.Analysis
    foreach ($kind in @('Admx', 'Adml')) {
        $listName = "${kind}ToUpdate"
        $list = if ($analysis -is [System.Collections.IDictionary]) { $analysis[$listName] } else { $analysis.$listName }
        foreach ($file in @($list)) {
            if ($null -eq $file) { continue }
            $get = { param($n) if ($file -is [System.Collections.IDictionary]) { $file[$n] } else { $file.$n } }
            $actionType = if ((& $get 'ActionType') -eq 'Import') { 'Import' } else { 'Update' }
            $actions += [PSCustomObject]@{
                Action       = "$actionType$kind"
                ResourceType = "${kind}File"
                Name         = [string](& $get 'Name')
                Path         = [string](& $get 'DestinationPath')
                Data         = [ordered]@{
                    fileName     = & $get 'Name'
                    sourcePath   = & $get 'SourcePath'
                    expectedHash = & $get 'ExpectedHash'
                    reason       = & $get 'Reason'
                    importType   = $actionType
                }
            }
        }
    }
    return $actions
}

function Export-TierModelPlan {
    <#
    .SYNOPSIS
    Writes (or returns) the deployment plan of a planning run as JSON.

    .DESCRIPTION
    Contract (version "1", camelCase keys, UTF-8 without BOM, ConvertTo-Json -Depth 10):
    {
      "metadata": { "version": "1", "scope": "FullDeployment|OuOnly|GroupOnly|UserOnly|GposOnly|OuAclsOnly|AdmxOnly|AuthSilosOnly|IncludeOnly",
                    "preferredDc": "...", "timestamp": "<ISO-8601 UTC>", "includes": ["Msa","Gmsa","Dmsa","WinLaps"] },
      "summary":  { "totalActions": 0, "create": 0, "update": 0, "link": 0, "configure": 0, "existing": 0 },
      "phases":   [ { "phase": 1, "name": "Organizational Units", "area": "ous", "actionCount": 0, "existingCount": 0 } ],
      "actions":  [ { "phase": 1, "area": "ous", "action": "CreateOU", "resourceType": "OrganizationalUnit",
                      "name": "...", "path": "...", "details": { "key": "string|number|bool|string[]" } } ],
      "warnings": [ "..." ],
      "errors":   [ "..." ]
    }
    All arrays are always JSON arrays (also with 0 or 1 element). "details" holds the action's Data
    reduced to simple values (no AD objects, no secrets, nested objects flattened as "a.b").

    .PARAMETER Phases
    Phase descriptors: objects/hashtables with Phase (int), Area (ous|groups|users|acls|gpos|admx|
    msa|gmsa|dmsa|winlaps|authsilos), optional Name, Actions (plan action objects with Action, ResourceType,
    Name, Path, Data), optional ExistingCount and optional AdmxPlan (Get-TierModelAdmx result - its
    analysis is converted to actions).

    .PARAMETER Scope
    FullDeployment, OuOnly, GroupOnly, UserOnly, GposOnly, OuAclsOnly, AdmxOnly, AuthSilosOnly or IncludeOnly.

    .PARAMETER Path
    Output file. Without -Path the JSON string is returned.

    .EXAMPLE
    Export-TierModelPlan -Phases @(@{ Phase = 1; Area = 'ous'; Actions = $plan.Actions; ExistingCount = 3 }) `
        -Scope OuOnly -PreferredDc dc01.contoso.com -Path C:\Logs\deploy-plan.json
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [AllowEmptyCollection()]
        [object[]]$Phases,

        [Parameter(Mandatory)]
        [ValidateSet('FullDeployment', 'OuOnly', 'GroupOnly', 'UserOnly', 'GposOnly', 'OuAclsOnly', 'AdmxOnly', 'AuthSilosOnly', 'IncludeOnly')]
        [string]$Scope,

        [Parameter(Mandatory)]
        [string]$PreferredDc,

        [AllowEmptyCollection()]
        [string[]]$Includes = @(),

        [AllowEmptyCollection()]
        [object[]]$Warnings = @(),

        [AllowEmptyCollection()]
        [object[]]$Errors = @(),

        [datetime]$Timestamp = (Get-Date),

        [string]$Path
    )

    $get = {
        param($obj, $name)
        if ($null -eq $obj) { return $null }
        if ($obj -is [System.Collections.IDictionary]) { if ($obj.Contains($name)) { return $obj[$name] } else { return $null } }
        if ($obj.PSObject.Properties[$name]) { return $obj.$name }
        return $null
    }

    $phaseList = New-Object System.Collections.Generic.List[object]
    $actionList = New-Object System.Collections.Generic.List[object]
    $counts = [ordered]@{ create = 0; update = 0; link = 0; configure = 0 }
    $existingTotal = 0

    foreach ($phase in @($Phases)) {
        if ($null -eq $phase) { continue }
        $phaseNo = [int](& $get $phase 'Phase')
        $area = [string](& $get $phase 'Area')
        $name = [string](& $get $phase 'Name')
        if ([string]::IsNullOrWhiteSpace($name)) {
            $name = if ($script:TierModelPlanAreaNames.Contains($area)) { $script:TierModelPlanAreaNames[$area] } else { $area }
        }

        $phaseActions = @()
        $rawActions = & $get $phase 'Actions'
        if ($null -ne $rawActions) { $phaseActions += @($rawActions | Where-Object { $null -ne $_ }) }
        $admxPlan = & $get $phase 'AdmxPlan'
        if ($null -ne $admxPlan) { $phaseActions += @(ConvertTo-TierModelAdmxPlanAction -AdmxPlan $admxPlan) }

        $existing = & $get $phase 'ExistingCount'
        $existing = if ($null -ne $existing) { [int]$existing } else { 0 }
        $existingTotal += $existing

        foreach ($a in $phaseActions) {
            $actionName = [string](& $get $a 'Action')
            $details = ConvertTo-TierModelPlanDetail -Data (& $get $a 'Data')
            $actionList.Add([ordered]@{
                phase        = $phaseNo
                area         = $area
                action       = $actionName
                resourceType = [string](& $get $a 'ResourceType')
                name         = [string](& $get $a 'Name')
                path         = [string](& $get $a 'Path')
                details      = $details
            })
            $counts[(Get-TierModelPlanActionCategory -Action $actionName)]++
        }

        $phaseList.Add([ordered]@{
            phase         = $phaseNo
            name          = $name
            area          = $area
            actionCount   = @($phaseActions).Count
            existingCount = $existing
        })
    }

    $warningList = New-Object System.Collections.Generic.List[string]
    foreach ($w in @($Warnings)) { $m = ConvertTo-TierModelPlanMessage $w; if ($m -and -not $warningList.Contains($m)) { $warningList.Add($m) } }
    $errorList = New-Object System.Collections.Generic.List[string]
    foreach ($e in @($Errors)) { $m = ConvertTo-TierModelPlanMessage $e; if ($m -and -not $errorList.Contains($m)) { $errorList.Add($m) } }

    $document = [ordered]@{
        metadata = [ordered]@{
            version     = '1'
            scope       = $Scope
            preferredDc = $PreferredDc
            timestamp   = $Timestamp.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")
            includes    = [string[]]@($Includes | Where-Object { $_ })
        }
        summary  = [ordered]@{
            totalActions = $actionList.Count
            create       = $counts.create
            update       = $counts.update
            link         = $counts.link
            configure    = $counts.configure
            existing     = $existingTotal
        }
        phases   = [object[]]$phaseList.ToArray()
        actions  = [object[]]$actionList.ToArray()
        warnings = [string[]]$warningList.ToArray()
        errors   = [string[]]$errorList.ToArray()
    }

    # -InputObject keeps empty/single-element arrays as JSON arrays
    $json = ConvertTo-Json -InputObject $document -Depth 10

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $json
    }

    $directory = Split-Path -Path $Path -Parent
    if ($directory -and -not (Test-Path -LiteralPath $directory)) {
        New-Item -Path $directory -ItemType Directory -Force | Out-Null
    }
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    [System.IO.File]::WriteAllText($fullPath, $json, (New-Object System.Text.UTF8Encoding($false)))
    return $fullPath
}
