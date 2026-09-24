# TierModel SID Resolution Module
# Handles resolution of security principals to SIDs for GPO editing

function Resolve-TierModelPrincipalSid {
    <#
    .SYNOPSIS
    Resolves security principal names to SIDs with caching
    
    .DESCRIPTION
    Converts security principal names (users, groups, well-known principals) to SIDs.
    Supports caching for performance and handles well-known SIDs directly.
    
    Built-in principals are resolved language-independently through the well-known table
    (Get-TierModelWellKnownPrincipal) BEFORE any lookup by name: absolute SIDs for BUILTIN /
    NT AUTHORITY, <domain SID>-<RID> for domain groups ("Domain Admins" -> -512, also when the
    group is called "Domänen-Admins"), and <forest root domain SID>-<RID> for Schema Admins,
    Enterprise Admins, Enterprise Key Admins and Enterprise Read-only Domain Controllers.
    
    Special handling for "Administrator" account:
    - When resolving "Administrator", first attempts to find the built-in Administrator account (RID 500)
    - This handles scenarios where the Administrator account has been renamed (e.g., to "Root")
    - Returns the actual SID even if the account name has changed
    - Protects against honeypot accounts that may have taken the "Administrator" name
    
    .PARAMETER Principal
    The security principal name to resolve (e.g., "Domain Admins", "BUILTIN\Users", "Administrator", "S-1-5-32-544")
    
    .PARAMETER DomainController
    The domain controller to use for Active Directory operations
    
    .PARAMETER UseCache
    Whether to use the SID cache for resolved principals (default: $true)
    
    .PARAMETER CorrelationId
    Tracking ID for logging correlation
    
    .EXAMPLE
    $sid = Resolve-TierModelPrincipalSid -Principal "Domain Admins"
    
    .EXAMPLE
    $sid = Resolve-TierModelPrincipalSid -Principal "BUILTIN\Administrators" -UseCache $false
    
    .EXAMPLE
    $sid = Resolve-TierModelPrincipalSid -Principal "Administrator"
    # Returns the SID for the built-in Administrator account (RID 500) even if renamed
    #>
    
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Principal,
        
        [Parameter(Mandatory)]
        [string]$DomainController,
        
        [bool]$UseCache = $true,
        
        [string]$CorrelationId = [System.Guid]::NewGuid().ToString()
    )
    
    begin {
        Write-Verbose "Starting SID resolution for principals (CorrelationId: $CorrelationId)"
        
        # Initialize cache if not exists
        if (-not $script:SidCache) {
            $script:SidCache = @{}
        }
    }
    
    process {
        Write-Verbose "Resolving SID for principal: '$Principal' (CorrelationId: $CorrelationId)"
        
        # Check if already a SID
        if ($Principal -match '^S-\d+-\d+') {
            Write-Verbose "Principal is already a SID: $Principal (CorrelationId: $CorrelationId)"
            return [PSCustomObject]@{
                Principal = $Principal
                Sid = $Principal
                Source = "DirectSID"
                Cached = $false
                Success = $true
                Error = $null
            }
        }
        
        # Special handling for "Administrator" account - bypass cache since it's domain-specific
        if ($Principal -ieq "Administrator") {
            try {
                # Get the domain SID from specified domain controller
                $domainSid = (Get-ADDomain -Server $DomainController).DomainSID.Value
                
                # Build the Administrator SID (RID 500)
                $adminSid = "$domainSid-500"
                
                # Look up the renamed built-in Administrator account by SID
                $adminUser = Get-ADUser -Identity $adminSid -Server $DomainController -ErrorAction Stop
                
                Write-Verbose "Found built-in Administrator account (RID 500) with current name: '$($adminUser.SamAccountName)' (CorrelationId: $CorrelationId)"
                
                return @{
                    Principal = $Principal
                    Sid = $adminUser.SID.Value
                    Source = "ADUser-RID500"
                    Success = $true
                    Error = $null
                    ActualName = $adminUser.SamAccountName
                    Cached = $false
                }
            } catch {
                Write-Verbose "Failed to resolve Administrator account via RID 500: $($_.Exception.Message) (CorrelationId: $CorrelationId)"
                # Continue to normal resolution if RID 500 lookup fails
            }
        }
        
        # Check cache first (except for Administrator which is handled above)
        if ($UseCache -and $script:SidCache.ContainsKey($Principal)) {
            Write-Verbose "Found cached SID for '$Principal' (CorrelationId: $CorrelationId)"
            $cachedResult = $script:SidCache[$Principal]
            return [PSCustomObject]@{
                Principal = $Principal
                Sid = $cachedResult.Sid
                Source = $cachedResult.Source
                Cached = $true
                Success = $cachedResult.Success
                Error = $cachedResult.Error
            }
        }
        
        # Try well-known principals first (language independent: fixed SIDs / domain RIDs).
        # Absolute SIDs (BUILTIN, NT AUTHORITY, Everyone) need no AD access and are cached.
        $wellKnownEntry = Get-TierModelWellKnownPrincipal -Name $Principal
        if ($wellKnownEntry -and $wellKnownEntry.Sid) {
            $wellKnownSid = $wellKnownEntry.Sid
            Write-Verbose "Resolved well-known SID for '$Principal': $wellKnownSid (CorrelationId: $CorrelationId)"
            $result = @{
                Sid = $wellKnownSid
                Source = "WellKnown" 
                Success = $true
                Error = $null
            }
            
            if ($UseCache) {
                $script:SidCache[$Principal] = $result
            }
            
            return [PSCustomObject]@{
                Principal = $Principal
                Sid = $wellKnownSid
                Source = "WellKnown"
                Cached = $false
                Success = $true
                Error = $null
            }
        }
        
        # Domain-relative built-in principals (e.g. "Domain Admins" = <domain SID>-512) are built
        # from the domain SID - or, for Schema/Enterprise Admins, Enterprise Key Admins and
        # Enterprise RODCs, from the forest ROOT domain SID - so they resolve on localized domains
        # ("Domänen-Admins") and in child domains. Not cached: the result depends on the DC's domain.
        if ($wellKnownEntry -and $null -ne $wellKnownEntry.Rid) {
            try {
                $ridSid = Resolve-TierModelWellKnownPrincipalSid -Name $Principal -DomainController $DomainController
                if ($ridSid) {
                    Write-Verbose "Resolved well-known RID for '$Principal': $ridSid (ForestRoot: $($wellKnownEntry.ForestRoot)) (CorrelationId: $CorrelationId)"
                    return [PSCustomObject]@{
                        Principal = $Principal
                        Sid = $ridSid
                        Source = if ($wellKnownEntry.ForestRoot) { "WellKnownForestRootRid" } else { "WellKnownRid" }
                        Cached = $false
                        Success = $true
                        Error = $null
                    }
                }
            } catch {
                Write-Verbose "Well-known RID resolution failed for '$Principal': $($_.Exception.Message) - falling back to AD name lookup (CorrelationId: $CorrelationId)"
            }
        }
        
        # Try AD resolution
        try {
            $adResult = Resolve-ADPrincipalSid -Principal $Principal -DomainController $DomainController -CorrelationId $CorrelationId
            
            if ($adResult.Success) {
                Write-Verbose "Resolved AD SID for '$Principal': $($adResult.Sid) (CorrelationId: $CorrelationId)"
                
                # Special logging for Administrator account resolution
                if ($Principal -ieq "Administrator" -and $adResult.PSObject.Properties.Name -contains 'ActualName') {
                    Write-Verbose "Administrator account resolved to actual account name: '$($adResult.ActualName)' (CorrelationId: $CorrelationId)"
                }
                
                if ($UseCache) {
                    $script:SidCache[$Principal] = @{
                        Sid = $adResult.Sid
                        Source = $adResult.Source
                        Success = $true
                        Error = $null
                    }
                }
                
                # Build result object with optional ActualName property
                $resultObj = [PSCustomObject]@{
                    Principal = $Principal
                    Sid = $adResult.Sid
                    Source = $adResult.Source
                    Cached = $false
                    Success = $true
                    Error = $null
                }
                
                # Add ActualName if it exists (for renamed Administrator account)
                if ($adResult.PSObject.Properties.Name -contains 'ActualName') {
                    $resultObj | Add-Member -NotePropertyName 'ActualName' -NotePropertyValue $adResult.ActualName -Force
                }
                
                return $resultObj
            }
            else {
                Write-Warning "Failed to resolve SID for '$Principal': $($adResult.Error) (CorrelationId: $CorrelationId)"
                
                $result = @{
                    Sid = $null
                    Source = "Failed"
                    Success = $false
                    Error = $adResult.Error
                }
                
                if ($UseCache) {
                    $script:SidCache[$Principal] = $result
                }
                
                return [PSCustomObject]@{
                    Principal = $Principal
                    Sid = $null
                    Source = "Failed"
                    Cached = $false
                    Success = $false
                    Error = $adResult.Error
                }
            }
        }
        catch {
            $errorMsg = "Exception resolving SID for '$Principal': $($_.Exception.Message)"
            Write-Warning "$errorMsg (CorrelationId: $CorrelationId)"
            
            $result = @{
                Sid = $null
                Source = "Exception"
                Success = $false
                Error = $errorMsg
            }
            
            if ($UseCache) {
                $script:SidCache[$Principal] = $result
            }
            
            return [PSCustomObject]@{
                Principal = $Principal
                Sid = $null
                Source = "Exception" 
                Cached = $false
                Success = $false
                Error = $errorMsg
            }
        }
    }
}

function Get-WellKnownSid {
    <#
    .SYNOPSIS
    Returns SID for well-known security principals
    
    .DESCRIPTION
    Maps common security principal names to their well-known SIDs without AD queries
    #>
    
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Principal
    )
    
    # Absolute well-known SIDs (BUILTIN, NT AUTHORITY, Everyone, ...) from the shared table.
    # Domain-relative principals (Domain Admins, ...) need a domain SID - see
    # Resolve-TierModelWellKnownPrincipalSid.
    $entry = Get-TierModelWellKnownPrincipal -Name $Principal
    if ($entry -and $entry.Sid) {
        return $entry.Sid
    }
    
    return $null
}

function Resolve-ADPrincipalSid {
    <#
    .SYNOPSIS
    Resolves security principal using Active Directory
    
    .DESCRIPTION
    Attempts to resolve security principal to SID using AD cmdlets against the given
    domain controller (-Server is passed to every AD cmdlet).
    
    .PARAMETER DomainController
    The domain controller used for all AD queries.
    #>
    
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Principal,
        
        [Parameter(Mandatory)]
        [string]$DomainController,
        
        [string]$CorrelationId
    )
    
    try {
        # Load ActiveDirectory module if available
        if (-not (Get-Module -Name ActiveDirectory -ListAvailable)) {
            throw "ActiveDirectory module is not available"
        }
        
        Import-Module ActiveDirectory -ErrorAction Stop
        
        # Try to resolve as user first
        try {
            $adUser = Get-ADUser -Identity $Principal -Server $DomainController -ErrorAction Stop
            return @{
                Sid = $adUser.SID.Value
                Source = "ADUser"
                Success = $true
                Error = $null
            }
        }
        catch {
            # Not a user, try as group
        }
        
        # Try to resolve as group
        try {
            $adGroup = Get-ADGroup -Identity $Principal -Server $DomainController -ErrorAction Stop
            return @{
                Sid = $adGroup.SID.Value
                Source = "ADGroup" 
                Success = $true
                Error = $null
            }
        }
        catch {
            # Not a group either
        }
        
        # Try generic AD object search
        try {
            $adObject = Get-ADObject -Filter "Name -eq '$Principal' -or SamAccountName -eq '$Principal'" -Properties objectSid -Server $DomainController | Select-Object -First 1
            if ($adObject -and $adObject.objectSid) {
                return @{
                    Sid = $adObject.objectSid.Value
                    Source = "ADObject"
                    Success = $true
                    Error = $null
                }
            }
        }
        catch {
            # Generic search also failed
        }
        
        # Principal not found in AD
        return @{
            Sid = $null
            Source = "NotFound"
            Success = $false
            Error = "Principal '$Principal' not found in Active Directory"
        }
    }
    catch {
        return @{
            Sid = $null
            Source = "ADError"
            Success = $false
            Error = "AD query failed: $($_.Exception.Message)"
        }
    }
}

function Get-TierModelConditionalGroupNames {
    <#
    .SYNOPSIS
    Evaluates conditional group conditions and returns only the group names that should be included.

    .DESCRIPTION
    For each name in a conditionalGroup entry, evaluates all conditions before including the name.
    Currently supports:
      - type: "groupExists", operator: "exists" — includes the name only if the AD group is found.
    Names that fail any condition are silently skipped.
    If no conditions are defined, all names are returned unconditionally (backwards compatible).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$ConditionalGroup,

        [Parameter(Mandatory)]
        [string]$DomainController,

        [string]$CorrelationId = [System.Guid]::NewGuid().ToString()
    )

    $resolvedNames = @()

    # No conditions defined — include all names unconditionally (backwards compatible)
    if (-not $ConditionalGroup.PSObject.Properties['conditions'] -or
        -not $ConditionalGroup.conditions -or
        @($ConditionalGroup.conditions).Count -eq 0) {
        foreach ($name in $ConditionalGroup.names) { $resolvedNames += $name }
        return $resolvedNames
    }

    foreach ($name in $ConditionalGroup.names) {
        $include = $true

        foreach ($condition in $ConditionalGroup.conditions) {
            if ($condition.type -eq 'groupExists' -and $condition.operator -eq 'exists') {
                try {
                    if (Get-TierModelWellKnownPrincipal -Name $name) {
                        # Built-in group: look it up by SID so localized names are found too
                        $adGroup = Get-TierModelADGroupByName -Name $name -DomainController $DomainController
                    } else {
                        $adGroup = Get-ADGroup -Identity $name -Server $DomainController -ErrorAction Stop
                    }
                } catch {
                    $adGroup = $null
                }
                if (-not $adGroup) {
                    Write-Verbose "Conditional group '$name' not found in AD - skipping (CorrelationId: $CorrelationId)"
                    $include = $false
                    break
                }
            }
            # Future condition types can be added here
        }

        if ($include) {
            $resolvedNames += $name
        }
    }

    return $resolvedNames
}

# Initialize module-level SID cache
$script:SidCache = @{}