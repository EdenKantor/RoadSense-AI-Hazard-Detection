<#
.SYNOPSIS
RoadSenseAI one-time installer (Section 2 - Environment & Observability Dashboard).

.DESCRIPTION
Idempotent first-run setup. Verifies prerequisites, offers to install missing
ones via winget, creates Python venvs + installs requirements, runs npm install,
copies .env templates, and pre-pulls Docker images.

Designed to be safe to re-run: every step is preceded by a "is this already
done?" check. Worst-case second-run time is a few seconds.

After this script succeeds, run scripts/start.ps1 to launch the demo.

.PARAMETER Force
Recreate venvs and re-run npm install even when they appear healthy.
Use after upgrading Python, switching branches with new requirements, or
when you suspect environment corruption.
#>
param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Write-Step([string]$Message) { Write-Host "[setup] $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message)   { Write-Host "[setup] $Message" -ForegroundColor Green }
function Write-Err([string]$Message)  { Write-Host "[setup] $Message" -ForegroundColor Red }
function Write-Skip([string]$Message) { Write-Host "[setup] $Message" -ForegroundColor DarkGray }

# Status accumulator for the final report.
$report = @()
function Add-Report([string]$Component, [string]$Status) {
    $script:report += [pscustomobject]@{ Component = $Component; Status = $Status }
}

# ----------------------------------------------------------------------------
# Invoke-Docker helper for consistent docker compose calls
# Routes docker through cmd.exe so its stderr-as-info lines don't trigger
# PowerShell's NativeCommandError under $ErrorActionPreference = "Stop".
# ----------------------------------------------------------------------------
function Invoke-Docker {
    param(
        [Parameter(Mandatory)][string]$DockerCommandLine,
        [switch]$Silent,
        [switch]$PassThrough
    )
    $raw = & cmd.exe /c "docker $DockerCommandLine 2>&1"
    $exit = $LASTEXITCODE
    if (-not $Silent -and -not $PassThrough) {
        foreach ($line in @($raw)) {
            if ($null -ne $line -and $line.ToString().Length -gt 0) {
                Write-Host "    $line"
            }
        }
    }
    return [pscustomobject]@{ ExitCode = $exit; Output = @($raw) }
}

function Test-DockerRunning {
    try {
        $r = Invoke-Docker -DockerCommandLine "info --format ""{{.ServerVersion}}""" -Silent -PassThrough
        if ($r.ExitCode -ne 0) { return $false }
        $line = ($r.Output | Where-Object { $_ -and $_.ToString().Trim().Length -gt 0 } | Select-Object -First 1)
        if ([string]::IsNullOrWhiteSpace([string]$line)) { return $false }
        if ([string]$line -match "ERROR|error during connect|Cannot connect") { return $false }
        return $true
    } catch { return $false }
}

function Test-VenvReady([string]$VenvDir) {
    $py = Join-Path $VenvDir "Scripts\python.exe"
    if (-not (Test-Path $py)) { return $false }
    try { & $py -c "import sys" 2>&1 | Out-Null; return ($LASTEXITCODE -eq 0) } catch { return $false }
}

function Confirm-WingetInstall([string]$ToolName, [string]$WingetId, [string]$ManualUrl) {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        Write-Err "  winget is not available. Install $ToolName manually from $ManualUrl"
        return $false
    }
    $answer = Read-Host "  Install $ToolName via winget now? (Y/N)"
    if ($answer -notmatch '^(?i)y(es)?$') {
        Write-Err "  Skipped. Install $ToolName manually from $ManualUrl"
        return $false
    }
    Write-Step "  Running: winget install --id $WingetId --silent --accept-package-agreements --accept-source-agreements"
    & winget install --id $WingetId --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        Write-Err "  winget install for $ToolName failed (exit code $LASTEXITCODE). Install manually from $ManualUrl"
        return $false
    }
    Write-Ok  "  $ToolName installed via winget. You may need to restart this PowerShell session for PATH updates to apply."
    return $true
}

# ============================================================================
# Section 1: Docker
# ============================================================================
Write-Step "1/10 Checking Docker..."
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Err "  Docker is not installed."
    Write-Err "  Install Docker Desktop manually: https://www.docker.com/products/docker-desktop/"
    Write-Err "  (Docker Desktop install requires a reboot; winget is not offered here.)"
    exit 1
}
if (-not (Test-DockerRunning)) {
    Write-Err "  Docker is installed but the engine is not running."
    Write-Err "  Start Docker Desktop, wait for the whale icon in the tray to be steady, then re-run scripts/setup.ps1."
    exit 1
}
Write-Ok "  Docker engine: OK"
Add-Report "Docker"          "already present"

# ============================================================================
# Section 2: Python 3.11+
# ============================================================================
Write-Step "2/10 Checking Python (>=3.11)..."

function Get-PythonCommand {
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if (-not $cmd) { $cmd = Get-Command py -ErrorAction SilentlyContinue }
    return $cmd
}

function Get-PythonVersion([System.Management.Automation.CommandInfo]$Cmd) {
    if (-not $Cmd) { return $null }
    $ver = & $Cmd.Source -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>&1
    if ($LASTEXITCODE -ne 0) { return $null }
    return $ver.Trim()
}

$pythonCmd = Get-PythonCommand
$pyVersion = Get-PythonVersion $pythonCmd
$pyOk = $false
if ($pyVersion) {
    $parts = $pyVersion -split "\."
    if ([int]$parts[0] -gt 3 -or ([int]$parts[0] -eq 3 -and [int]$parts[1] -ge 11)) { $pyOk = $true }
}

if (-not $pyOk) {
    if ($pyVersion) {
        Write-Err "  Python $pyVersion detected; 3.11+ is required."
    } else {
        Write-Err "  Python is not installed."
    }
    $installed = Confirm-WingetInstall -ToolName "Python 3.12" -WingetId "Python.Python.3.12" -ManualUrl "https://www.python.org/downloads/"
    if (-not $installed) { exit 1 }
    # Re-detect after install (PATH may not be refreshed in the current session).
    $pythonCmd = Get-PythonCommand
    $pyVersion = Get-PythonVersion $pythonCmd
    $parts = if ($pyVersion) { $pyVersion -split "\." } else { @() }
    if (-not $pyVersion -or -not ([int]$parts[0] -gt 3 -or ([int]$parts[0] -eq 3 -and [int]$parts[1] -ge 11))) {
        Write-Err "  Python install reported success but Python >=3.11 is still not on PATH."
        Write-Err "  Open a NEW PowerShell window and re-run scripts/setup.ps1."
        exit 1
    }
    Add-Report "Python"           ("installed (now {0})" -f $pyVersion)
} else {
    Add-Report "Python"           ("already present ({0})" -f $pyVersion)
}
Write-Ok ("  Python {0}: OK" -f $pyVersion)

# ============================================================================
# Section 3: Node.js 18+
# ============================================================================
Write-Step "3/10 Checking Node.js (>=18)..."

function Get-NodeCommand { return (Get-Command node -ErrorAction SilentlyContinue) }
function Get-NodeMajor([System.Management.Automation.CommandInfo]$Cmd) {
    if (-not $Cmd) { return $null }
    $v = (& $Cmd.Source -v) -replace "v",""
    if ($LASTEXITCODE -ne 0) { return $null }
    return [int]($v -split "\.")[0]
}

$nodeCmd   = Get-NodeCommand
$nodeMajor = Get-NodeMajor $nodeCmd
$nodeOk = ($nodeMajor -ge 18)
if (-not $nodeOk) {
    if ($nodeMajor) {
        Write-Err "  Node.js v$nodeMajor detected; 18+ is required."
    } else {
        Write-Err "  Node.js is not installed."
    }
    $installed = Confirm-WingetInstall -ToolName "Node.js LTS" -WingetId "OpenJS.NodeJS.LTS" -ManualUrl "https://nodejs.org/en/download/"
    if (-not $installed) { exit 1 }
    $nodeCmd   = Get-NodeCommand
    $nodeMajor = Get-NodeMajor $nodeCmd
    if (-not $nodeMajor -or $nodeMajor -lt 18) {
        Write-Err "  Node.js install reported success but Node >=18 is still not on PATH."
        Write-Err "  Open a NEW PowerShell window and re-run scripts/setup.ps1."
        exit 1
    }
    Add-Report "Node.js"          ("installed (now v{0})" -f $nodeMajor)
} else {
    Add-Report "Node.js"          ("already present (v{0})" -f $nodeMajor)
}
Write-Ok ("  Node.js v{0}: OK" -f $nodeMajor)

# ============================================================================
# Section 4: YOLO weights
# ============================================================================
Write-Step "4/10 Checking YOLO weights..."
$weightsPath = Join-Path $workspaceRoot "weights\model.pt"
if (-not (Test-Path $weightsPath)) {
    Write-Err "  weights/model.pt is missing."
    Write-Err "  See weights/README.md and request a fresh copy of model.pt from the project owner."
    exit 1
}
$weightsSize = (Get-Item $weightsPath).Length
$weightsMB = [math]::Round($weightsSize / 1MB, 2)
if ($weightsSize -lt 50MB) {
    Write-Err ("  weights/model.pt is only {0} MB (expected ~85 MB). The file is corrupted or incomplete." -f $weightsMB)
    Write-Err "  See weights/README.md and request a fresh copy of model.pt from the project owner."
    exit 1
}
Write-Ok ("  weights/model.pt: {0} MB" -f $weightsMB)
Add-Report "YOLO weights"     ("already present ({0} MB)" -f $weightsMB)

# ============================================================================
# Section 5: Backend venv + pip install
# ============================================================================
Write-Step "5/10 Backend venv..."
$backendDir  = Join-Path $workspaceRoot "backend"
$backendVenv = Join-Path $backendDir "venv"

if ($Force -and (Test-Path $backendVenv)) {
    Write-Step "  -Force specified; removing existing backend venv..."
    Remove-Item -Recurse -Force $backendVenv
}

if (-not (Test-VenvReady $backendVenv)) {
    Write-Step "  Creating backend venv..."
    & $pythonCmd.Source -m venv $backendVenv
    if ($LASTEXITCODE -ne 0) { Write-Err "  Failed to create backend venv."; exit 1 }
    Add-Report "Backend venv"     "created"
} else {
    Write-Skip "  Backend venv already present"
    Add-Report "Backend venv"     "already present"
}

$backendPy = Join-Path $backendVenv "Scripts\python.exe"
Write-Step "  Installing backend dependencies (pip install -r backend/requirements.txt)..."
& $backendPy -m pip install --quiet --disable-pip-version-check -r (Join-Path $backendDir "requirements.txt")
if ($LASTEXITCODE -ne 0) { Write-Err "  pip install failed for backend."; exit 1 }
Write-Ok "  Backend dependencies: OK"

# ============================================================================
# Section 6: Worker venv + pip install
# ============================================================================
Write-Step "6/10 Worker venv..."
$workerDir  = Join-Path $workspaceRoot "worker"
$workerVenv = Join-Path $workerDir "venv"

if ($Force -and (Test-Path $workerVenv)) {
    Write-Step "  -Force specified; removing existing worker venv..."
    Remove-Item -Recurse -Force $workerVenv
}

if (-not (Test-VenvReady $workerVenv)) {
    Write-Step "  Creating worker venv..."
    & $pythonCmd.Source -m venv $workerVenv
    if ($LASTEXITCODE -ne 0) { Write-Err "  Failed to create worker venv."; exit 1 }
    Add-Report "Worker venv"      "created"
} else {
    Write-Skip "  Worker venv already present"
    Add-Report "Worker venv"      "already present"
}

$workerPy = Join-Path $workerVenv "Scripts\python.exe"
Write-Step "  Installing worker dependencies (pip install -r worker/requirements.txt)..."
& $workerPy -m pip install --quiet --disable-pip-version-check -r (Join-Path $workerDir "requirements.txt")
if ($LASTEXITCODE -ne 0) { Write-Err "  pip install failed for worker."; exit 1 }
Write-Ok "  Worker dependencies: OK"

# ============================================================================
# Section 7: Frontend npm install
# ============================================================================
Write-Step "7/10 Frontend node_modules..."
$frontendDir    = Join-Path $workspaceRoot "frontend"
$nodeModulesDir = Join-Path $frontendDir "node_modules"

if ($Force -and (Test-Path $nodeModulesDir)) {
    Write-Step "  -Force specified; removing existing frontend/node_modules..."
    Remove-Item -Recurse -Force $nodeModulesDir
}

if (-not (Test-Path $nodeModulesDir)) {
    Write-Step "  Running npm install in frontend/..."
    Push-Location $frontendDir
    try {
        # --legacy-peer-deps: required because react-leaflet-cluster has a peer-dep
        # conflict with @react-leaflet/core. The conflict is benign in our usage
        # (the map works correctly), and the project was originally installed this way.
        npm install --silent --legacy-peer-deps
        if ($LASTEXITCODE -ne 0) { Write-Err "  npm install failed."; exit 1 }
    } finally { Pop-Location }
    Write-Ok "  Frontend dependencies: OK"
    Add-Report "Frontend deps"    "installed"
} else {
    Write-Skip "  frontend/node_modules already present"
    Add-Report "Frontend deps"    "already present"
}

# ============================================================================
# Section 8: .env file copies
# ============================================================================
Write-Step "8/10 Environment files..."
foreach ($comp in @("backend", "worker")) {
    $envFile    = Join-Path $workspaceRoot "$comp\.env"
    $envExample = Join-Path $workspaceRoot "$comp\.env.example"
    if (Test-Path $envFile) {
        Write-Skip "  $comp/.env already present (not touching)"
        Add-Report "$comp/.env"  "already present"
    } elseif (Test-Path $envExample) {
        Copy-Item -Path $envExample -Destination $envFile
        Write-Ok "  Created $comp/.env from $comp/.env.example"
        Add-Report "$comp/.env"  "created from template"
    } else {
        Write-Err "  $comp/.env.example is missing - cannot create $comp/.env"
        exit 1
    }
}

# ============================================================================
# Section 9: Pre-pull Docker images
# ============================================================================
Write-Step "9/10 Pre-pulling Docker images (redis, mongo)..."
Push-Location $workspaceRoot
try {
    $pull = Invoke-Docker -DockerCommandLine "compose pull" -Silent
    if ($pull.ExitCode -ne 0) {
        Write-Host "[setup] WARNING: docker compose pull returned exit code $($pull.ExitCode)." -ForegroundColor Yellow
        Write-Host "[setup] WARNING: Images will be pulled on first 'docker compose up' instead." -ForegroundColor Yellow
        Add-Report "Docker images"    "pull skipped (will retry on start)"
    } else {
        Write-Ok "  Docker images cached locally"
        Add-Report "Docker images"    "pulled"
    }
} finally { Pop-Location }

# ============================================================================
# Section 10: Final report
# ============================================================================
Write-Host ""
Write-Host "=========================================================" -ForegroundColor Green
Write-Host "  Setup summary" -ForegroundColor Green
Write-Host "=========================================================" -ForegroundColor Green
$report | Format-Table -AutoSize | Out-String | ForEach-Object { Write-Host $_ }
Write-Ok "Setup complete. Run .\scripts\start.ps1 to launch the demo."
