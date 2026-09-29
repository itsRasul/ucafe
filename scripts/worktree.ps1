[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet(
        "create",
        "list",
        "up",
        "down",
        "status",
        "config",
        "logs",
        "remove"
    )]
    [string]$Action,

    [Parameter(Position = 1)]
    [string]$Name,

    [string]$Branch,

    [switch]$Build,

    [switch]$Volumes
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"


# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------

function Write-Step {
    param([string]$Message)

    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}


function Invoke-Git {
    param(
        [string]$WorkingDirectory,
        [string[]]$Arguments,
        [switch]$Capture
    )

    if ($Capture) {
        $output = & git -C $WorkingDirectory @Arguments 2>&1

        if ($LASTEXITCODE -ne 0) {
            throw "Git command failed:`n$output"
        }

        return $output
    }

    & git -C $WorkingDirectory @Arguments

    if ($LASTEXITCODE -ne 0) {
        throw "Git command failed."
    }
}


function Get-CurrentRepoRoot {
    $output = & git -C $PSScriptRoot rev-parse --show-toplevel 2>&1

    if ($LASTEXITCODE -ne 0) {
        throw "This script must be executed from inside the UCafe Git repository."
    }

    return ($output | Select-Object -First 1).Trim()
}


function Get-MainRepoRoot {
    param([string]$RepoRoot)

    $lines = & git -C $RepoRoot worktree list --porcelain 2>&1

    if ($LASTEXITCODE -ne 0) {
        throw "Unable to inspect Git worktrees."
    }

    foreach ($line in $lines) {
        if ($line -match "^worktree (.+)$") {
            return $Matches[1]
        }
    }

    throw "Unable to determine the main Git worktree."
}


function Normalize-WorktreeName {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "A worktree name is required."
    }

    $normalized = $Value.Trim().ToLowerInvariant()

    if ($normalized -notmatch "^[a-z0-9][a-z0-9-]*$") {
        throw @"
Invalid worktree name: '$Value'

Use only:
- lowercase letters
- numbers
- hyphens

Example:
tenant-crm-phase-7
"@
    }

    return $normalized
}


function Test-PortAvailable {
    param([int]$Port)

    $listener = $null

    try {
        $listener = New-Object System.Net.Sockets.TcpListener(
            [System.Net.IPAddress]::Loopback,
            $Port
        )

        $listener.Start()

        return $true
    }
    catch {
        return $false
    }
    finally {
        if ($null -ne $listener) {
            try {
                $listener.Stop()
            }
            catch {
            }
        }
    }
}


function Get-EnvValue {
    param(
        [string]$Path,
        [string]$Key
    )

    if (-not (Test-Path $Path)) {
        return $null
    }

    $pattern = "^\s*" + [regex]::Escape($Key) + "\s*=(.*)$"

    foreach ($line in Get-Content $Path) {
        if ($line -match $pattern) {
            return $Matches[1].Trim().Trim('"').Trim("'")
        }
    }

    return $null
}


function Set-EnvValue {
    param(
        [string]$Path,
        [string]$Key,
        [string]$Value
    )

    $lines = @()

    if (Test-Path $Path) {
        $lines = @(Get-Content $Path)
    }

    $pattern = "^\s*" + [regex]::Escape($Key) + "\s*="

    $result = New-Object System.Collections.Generic.List[string]
    $found = $false

    foreach ($line in $lines) {
        if ($line -match $pattern) {
            if (-not $found) {
                $result.Add("$Key=$Value")
                $found = $true
            }

            continue
        }

        $result.Add($line)
    }

    if (-not $found) {
        $result.Add("$Key=$Value")
    }

    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)

    [System.IO.File]::WriteAllLines(
        $Path,
        $result,
        $utf8WithoutBom
    )
}


function Get-ManagedWorktreeDirectories {
    param([string]$Root)

    if (-not (Test-Path $Root)) {
        return @()
    }

    return @(
        Get-ChildItem $Root -Directory |
        Where-Object {
            Test-Path (Join-Path $_.FullName ".git")
        }
    )
}


function Get-AllocatedWebPorts {
    param([string]$Root)

    $ports = @()

    foreach ($directory in Get-ManagedWorktreeDirectories $Root) {
        $envPath = Join-Path $directory.FullName ".env.development"

        $port = Get-EnvValue $envPath "WEB_HOST_PORT"

        if ($null -ne $port -and $port -match "^\d+$") {
            $ports += [int]$port
        }
    }

    return $ports
}


function Get-SlotPorts {
    param([int]$Slot)

    return @{
        Web          = 3000 + ($Slot * 100)
        Api          = 3001 + ($Slot * 100)
        Postgres     = 5432 + ($Slot * 100)
        Redis        = 6379 + ($Slot * 100)
        Minio        = 9000 + ($Slot * 100)
        MinioConsole = 9001 + ($Slot * 100)
    }
}


function Find-FreeSlot {
    param([string]$WorktreesRoot)

    $allocatedWebPorts = @(Get-AllocatedWebPorts $WorktreesRoot)

    for ($slot = 1; $slot -le 50; $slot++) {

        $ports = Get-SlotPorts $slot

        if ($allocatedWebPorts -contains $ports.Web) {
            continue
        }

        $allAvailable = (
            (Test-PortAvailable $ports.Web) -and
            (Test-PortAvailable $ports.Api) -and
            (Test-PortAvailable $ports.Postgres) -and
            (Test-PortAvailable $ports.Redis) -and
            (Test-PortAvailable $ports.Minio) -and
            (Test-PortAvailable $ports.MinioConsole)
        )

        if ($allAvailable) {
            return @{
                Slot  = $slot
                Ports = $ports
            }
        }
    }

    throw "No free UCafe development port slot was found."
}


function Get-WorktreePath {
    param(
        [string]$WorktreesRoot,
        [string]$WorktreeName
    )

    return Join-Path $WorktreesRoot $WorktreeName
}


function Invoke-Compose {
    param(
        [string]$WorktreePath,
        [string[]]$Arguments
    )

    $envFile = Join-Path $WorktreePath ".env.development"

    if (-not (Test-Path $envFile)) {
        throw "Missing .env.development in: $WorktreePath"
    }

    Push-Location $WorktreePath

    try {
        & docker compose `
            --env-file ".env.development" `
            -f "compose.yaml" `
            -f "compose.dev.yaml" `
            @Arguments

        if ($LASTEXITCODE -ne 0) {
            throw "Docker Compose command failed."
        }
    }
    finally {
        Pop-Location
    }
}


# ------------------------------------------------------------
# Repository discovery
# ------------------------------------------------------------

$CurrentRepoRoot = Get-CurrentRepoRoot
$MainRepoRoot = Get-MainRepoRoot $CurrentRepoRoot

$RepoName = Split-Path $MainRepoRoot -Leaf
$ProjectsRoot = Split-Path $MainRepoRoot -Parent

$WorktreesRoot = Join-Path $ProjectsRoot "$RepoName-worktrees"

$SourceEnvFile = Join-Path $MainRepoRoot ".env.development"


# ------------------------------------------------------------
# Actions
# ------------------------------------------------------------

switch ($Action) {

    # --------------------------------------------------------
    # CREATE
    # --------------------------------------------------------

    "create" {

        $Name = Normalize-WorktreeName $Name

        if (-not (Test-Path $SourceEnvFile)) {
            throw @"
.env.development was not found in the main UCafe repository:

$SourceEnvFile
"@
        }

        if (-not (Test-Path $WorktreesRoot)) {
            Write-Step "Creating worktree directory"

            New-Item `
                -ItemType Directory `
                -Path $WorktreesRoot `
                -Force | Out-Null
        }

        $WorktreePath = Get-WorktreePath $WorktreesRoot $Name

        if (Test-Path $WorktreePath) {
            throw "Worktree directory already exists: $WorktreePath"
        }

        if ([string]::IsNullOrWhiteSpace($Branch)) {
            $Branch = "feat/$Name"
        }

        & git -C $MainRepoRoot show-ref `
            --verify `
            --quiet `
            "refs/heads/$Branch"

        $branchAlreadyExists = ($LASTEXITCODE -eq 0)

        if ($branchAlreadyExists) {
            throw @"
Branch already exists:

$Branch

Choose another name or manage the existing branch manually.
"@
        }

        Write-Step "Finding an available development port slot"

        $allocation = Find-FreeSlot $WorktreesRoot

        $slot = $allocation.Slot
        $ports = $allocation.Ports

        Write-Host "Using slot $slot"

        Write-Step "Creating Git worktree"

        Invoke-Git `
            -WorkingDirectory $MainRepoRoot `
            -Arguments @(
                "worktree",
                "add",
                "-b",
                $Branch,
                $WorktreePath,
                "HEAD"
            )

        Write-Step "Creating isolated .env.development"

        $TargetEnvFile = Join-Path $WorktreePath ".env.development"

        Copy-Item `
            $SourceEnvFile `
            $TargetEnvFile `
            -Force

        $projectName = "ucafe-$Name"

        Add-Content `
            -Path $TargetEnvFile `
            -Value "`n# ------------------------------------------"

        Add-Content `
            -Path $TargetEnvFile `
            -Value "# Worktree development overrides"

        Add-Content `
            -Path $TargetEnvFile `
            -Value "# Generated by scripts/worktree.ps1"

        Add-Content `
            -Path $TargetEnvFile `
            -Value "# ------------------------------------------"

        Set-EnvValue $TargetEnvFile "COMPOSE_PROJECT_NAME" $projectName

        Set-EnvValue $TargetEnvFile "WEB_HOST_PORT" $ports.Web
        Set-EnvValue $TargetEnvFile "API_HOST_PORT" $ports.Api

        Set-EnvValue $TargetEnvFile "POSTGRES_HOST_PORT" $ports.Postgres
        Set-EnvValue $TargetEnvFile "REDIS_HOST_PORT" $ports.Redis

        Set-EnvValue $TargetEnvFile "MINIO_HOST_PORT" $ports.Minio
        Set-EnvValue $TargetEnvFile "MINIO_CONSOLE_HOST_PORT" $ports.MinioConsole


        Write-Step "Validating Docker Compose configuration"

        if ($null -eq (Get-Command docker -ErrorAction SilentlyContinue)) {
            Write-Warning "Docker command was not found. Compose validation skipped."
        }
        else {
            Invoke-Compose `
                -WorktreePath $WorktreePath `
                -Arguments @(
                    "config",
                    "--quiet"
                )
        }


        Write-Host ""
        Write-Host "UCafe worktree created successfully." -ForegroundColor Green
        Write-Host ""

        Write-Host "Name:           $Name"
        Write-Host "Branch:         $Branch"
        Write-Host "Slot:           $slot"
        Write-Host ""
        Write-Host "Path:"
        Write-Host "  $WorktreePath"
        Write-Host ""
        Write-Host "Docker project:"
        Write-Host "  $projectName"
        Write-Host ""
        Write-Host "Web:"
        Write-Host "  http://localhost:$($ports.Web)"
        Write-Host ""
        Write-Host "API:"
        Write-Host "  http://localhost:$($ports.Api)"
        Write-Host ""
        Write-Host "PostgreSQL:"
        Write-Host "  localhost:$($ports.Postgres)"
        Write-Host ""
        Write-Host "Redis:"
        Write-Host "  localhost:$($ports.Redis)"
        Write-Host ""
        Write-Host "MinIO:"
        Write-Host "  http://localhost:$($ports.Minio)"
        Write-Host ""
        Write-Host "MinIO Console:"
        Write-Host "  http://localhost:$($ports.MinioConsole)"
        Write-Host ""
        Write-Host "Start it with:"
        Write-Host "  .\scripts\worktree.ps1 up $Name -Build" -ForegroundColor Yellow
        Write-Host ""
    }


    # --------------------------------------------------------
    # LIST
    # --------------------------------------------------------

    "list" {

        $items = @()

        foreach ($directory in Get-ManagedWorktreeDirectories $WorktreesRoot) {

            $envFile = Join-Path $directory.FullName ".env.development"

            $branchOutput = & git -C $directory.FullName `
                rev-parse `
                --abbrev-ref `
                HEAD 2>$null

            $branchName = ""

            if ($LASTEXITCODE -eq 0) {
                $branchName = ($branchOutput | Select-Object -First 1).Trim()
            }

            $items += [PSCustomObject]@{
                Name       = $directory.Name
                Branch     = $branchName
                Web        = Get-EnvValue $envFile "WEB_HOST_PORT"
                API        = Get-EnvValue $envFile "API_HOST_PORT"
                PostgreSQL = Get-EnvValue $envFile "POSTGRES_HOST_PORT"
                Redis      = Get-EnvValue $envFile "REDIS_HOST_PORT"
                MinIO      = Get-EnvValue $envFile "MINIO_HOST_PORT"
            }
        }

        if ($items.Count -eq 0) {
            Write-Host "No managed UCafe worktrees found."
            break
        }

        $items |
            Sort-Object Name |
            Format-Table -AutoSize
    }


    # --------------------------------------------------------
    # UP
    # --------------------------------------------------------

    "up" {

        $Name = Normalize-WorktreeName $Name
        $WorktreePath = Get-WorktreePath $WorktreesRoot $Name

        if (-not (Test-Path $WorktreePath)) {
            throw "Worktree does not exist: $Name"
        }

        $arguments = @(
            "up",
            "-d"
        )

        if ($Build) {
            $arguments += "--build"
        }

        Invoke-Compose `
            -WorktreePath $WorktreePath `
            -Arguments $arguments

        Write-Host ""
        Write-Host "$Name is running." -ForegroundColor Green

        $envFile = Join-Path $WorktreePath ".env.development"

        $webPort = Get-EnvValue $envFile "WEB_HOST_PORT"
        $apiPort = Get-EnvValue $envFile "API_HOST_PORT"

        Write-Host "Web: http://localhost:$webPort"
        Write-Host "API: http://localhost:$apiPort"
    }


    # --------------------------------------------------------
    # DOWN
    # --------------------------------------------------------

    "down" {

        $Name = Normalize-WorktreeName $Name
        $WorktreePath = Get-WorktreePath $WorktreesRoot $Name

        if (-not (Test-Path $WorktreePath)) {
            throw "Worktree does not exist: $Name"
        }

        $arguments = @("down")

        if ($Volumes) {
            Write-Warning "Docker volumes for this worktree will also be deleted."
            $arguments += "-v"
        }

        Invoke-Compose `
            -WorktreePath $WorktreePath `
            -Arguments $arguments
    }


    # --------------------------------------------------------
    # STATUS
    # --------------------------------------------------------

    "status" {

        $Name = Normalize-WorktreeName $Name
        $WorktreePath = Get-WorktreePath $WorktreesRoot $Name

        if (-not (Test-Path $WorktreePath)) {
            throw "Worktree does not exist: $Name"
        }

        Invoke-Compose `
            -WorktreePath $WorktreePath `
            -Arguments @("ps")
    }


    # --------------------------------------------------------
    # CONFIG
    # --------------------------------------------------------

    "config" {

        $Name = Normalize-WorktreeName $Name
        $WorktreePath = Get-WorktreePath $WorktreesRoot $Name

        if (-not (Test-Path $WorktreePath)) {
            throw "Worktree does not exist: $Name"
        }

        Invoke-Compose `
            -WorktreePath $WorktreePath `
            -Arguments @("config")
    }


    # --------------------------------------------------------
    # LOGS
    # --------------------------------------------------------

    "logs" {

        $Name = Normalize-WorktreeName $Name
        $WorktreePath = Get-WorktreePath $WorktreesRoot $Name

        if (-not (Test-Path $WorktreePath)) {
            throw "Worktree does not exist: $Name"
        }

        Invoke-Compose `
            -WorktreePath $WorktreePath `
            -Arguments @(
                "logs",
                "-f"
            )
    }


    # --------------------------------------------------------
    # REMOVE
    # --------------------------------------------------------

    "remove" {

        $Name = Normalize-WorktreeName $Name
        $WorktreePath = Get-WorktreePath $WorktreesRoot $Name

        if (-not (Test-Path $WorktreePath)) {
            throw "Worktree does not exist: $Name"
        }

        Write-Step "Checking worktree status"

        $status = & git -C $WorktreePath status --porcelain

        if ($LASTEXITCODE -ne 0) {
            throw "Unable to inspect Git status."
        }

        if ($status) {
            throw @"
The worktree contains uncommitted changes.

Commit or stash them before removing the worktree:

$WorktreePath
"@
        }


        Write-Step "Stopping Docker environment"

        $downArguments = @("down")

        if ($Volumes) {
            Write-Warning "Docker volumes will be permanently removed."
            $downArguments += "-v"
        }

        Invoke-Compose `
            -WorktreePath $WorktreePath `
            -Arguments $downArguments


        Write-Step "Removing Git worktree"

        Invoke-Git `
            -WorkingDirectory $MainRepoRoot `
            -Arguments @(
                "worktree",
                "remove",
                $WorktreePath
            )


        Invoke-Git `
            -WorkingDirectory $MainRepoRoot `
            -Arguments @(
                "worktree",
                "prune"
            )


        Write-Host ""
        Write-Host "Worktree removed." -ForegroundColor Green
        Write-Host ""
        Write-Host "The Git branch was NOT deleted." -ForegroundColor Yellow
        Write-Host "This is intentional for safety."
        Write-Host ""

        if (-not $Volumes) {
            Write-Host "Docker volumes were also preserved."
            Write-Host ""
        }
    }
}