<#
.SYNOPSIS
RoadSenseAI demo launcher (Section 2 - Environment & Observability Dashboard).

.DESCRIPTION
Restart-capable launcher. Assumes scripts/setup.ps1 has already been run (does
NOT install anything). On every invocation:

  1. Sanity-checks that setup is complete - exits with a clear "run setup.ps1"
     message if any prereq is missing.
  2. Cleans up any previous run: stops tracked PIDs from the state file,
     sweeps orphan venv/node processes, brings docker compose down.
  3. Verifies ports 6380, 27017, 8000, 5173 are free.
  4. docker compose up -d + waits for both healthchecks.
  5. Spawns 3 separate console windows: Backend, Workers, Frontend. (Docker
     container logs are intentionally NOT mirrored into a window - tail them
     on demand with `docker compose logs -f mongodb` etc.) Frontend is
     launched via npm.cmd directly (not via powershell -Command) because
     that pattern is the only reliable way to keep Vite alive.
  6. Opens 2 browser tabs: http://localhost:5173/ and the dev dashboard.
  7. Persists tracked PIDs to output/dev/demo-state.json so stop.ps1 can
     terminate them cleanly.

Stop everything with scripts/stop.ps1.

.PARAMETER WorkerCount
Number of RQ workers (default 3, propagated as WORKER_COUNT to the supervisor).

.PARAMETER NoBrowser
Skip the browser-open step.
#>
param(
    [int]$WorkerCount = 3,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$stateDir  = Join-Path $workspaceRoot "output\dev"
$stateFile = Join-Path $stateDir "demo-state.json"

New-Item -ItemType Directory -Path $stateDir -Force | Out-Null

function Write-Step([string]$Message) { Write-Host "[start] $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message)   { Write-Host "[start] $Message" -ForegroundColor Green }
function Write-Err([string]$Message)  { Write-Host "[start] $Message" -ForegroundColor Red }
function Write-Skip([string]$Message) { Write-Host "[start] $Message" -ForegroundColor DarkGray }

# ----------------------------------------------------------------------------
# Invoke-Docker (mirrors setup.ps1 / stop.ps1)
# Routes docker calls through cmd.exe so docker's stderr-as-info lines
# ("Container X Started") don't trigger PowerShell's NativeCommandError under
# $ErrorActionPreference = "Stop".
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

function Get-ProcessUsingPort([int]$Port) {
    try {
        $conns = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
        if (-not $conns) { return $null }
        $owner = Get-Process -Id $conns[0].OwningProcess -ErrorAction SilentlyContinue
        if (-not $owner) { return $null }
        return [pscustomobject]@{ Pid = $owner.Id; Name = $owner.ProcessName }
    } catch { return $null }
}

function Stop-PidSafely([int]$ProcId, [string]$Label) {
    if (-not $ProcId) { return }
    $p = Get-Process -Id $ProcId -ErrorAction SilentlyContinue
    if ($null -eq $p) {
        Write-Skip "  $Label (PID $ProcId) is already stopped"
        return
    }
    try {
        Stop-Process -Id $ProcId -Force -ErrorAction Stop
        Write-Step "  Stopped $Label (PID $ProcId)"
    } catch {
        Write-Step "  Could not stop $Label (PID $ProcId): $($_.Exception.Message)"
    }
}

# ============================================================================
# Section 1: Sanity checks (NOT install)
# ============================================================================
Write-Step "Sanity-checking setup..."

if (-not (Test-DockerRunning)) {
    Write-Err "Docker engine is not running. Start Docker Desktop, wait for the whale icon to be steady, then re-run scripts/start.ps1."
    exit 1
}

$backendVenv = Join-Path $workspaceRoot "backend\venv"
$workerVenv  = Join-Path $workspaceRoot "worker\venv"
$frontendDir = Join-Path $workspaceRoot "frontend"
$nodeModules = Join-Path $frontendDir "node_modules"
$weightsPath = Join-Path $workspaceRoot "weights\model.pt"

$missing = @()
if (-not (Test-VenvReady $backendVenv)) { $missing += "backend venv (backend/venv)" }
if (-not (Test-VenvReady $workerVenv))  { $missing += "worker venv (worker/venv)" }
if (-not (Test-Path $nodeModules))      { $missing += "frontend dependencies (frontend/node_modules)" }
if (-not (Test-Path $weightsPath)) {
    $missing += "YOLO weights (weights/model.pt)"
} elseif ((Get-Item $weightsPath).Length -lt 50MB) {
    $missing += "YOLO weights (weights/model.pt is <50 MB - corrupted)"
}

# Resolves the npm command path on Windows.
$npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCmd) { $npmCmd = Get-Command npm -ErrorAction SilentlyContinue }
if (-not $npmCmd) { $missing += "npm (Node.js 18+ on PATH)" }

if ($missing.Count -gt 0) {
    Write-Err "Setup not complete. The following are missing or invalid:"
    foreach ($m in $missing) { Write-Err "  - $m" }
    Write-Err "Run .\scripts\setup.ps1 first."
    exit 1
}
$npmPath = $npmCmd.Source
Write-Ok "  All prereqs present"

# ============================================================================
# Section 2: Restart-capable cleanup
# ============================================================================
Write-Step "Cleaning up any previous run..."

# (a) Stop tracked processes from the previous state file, if any.
if (Test-Path $stateFile) {
    try {
        $prev = Get-Content -Raw -Path $stateFile | ConvertFrom-Json
        foreach ($entry in @($prev.processes)) {
            if ($entry.pid) {
                $label = if ($entry.name) { [string]$entry.name } else { "tracked process" }
                Stop-PidSafely -ProcId ([int]$entry.pid) -Label $label
            }
        }
    } catch {
        Write-Step "  Could not parse $stateFile : $($_.Exception.Message)"
    }
}

# (b) Sweep orphan venv/node processes (catches anything that survived).
Write-Step "  Sweeping orphan venv/node processes..."
$venvBackend  = "$workspaceRoot\backend\venv\*"
$venvWorker   = "$workspaceRoot\worker\venv\*"
$nodeModPath  = "$workspaceRoot\frontend\node_modules\*"
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.ExecutablePath -and (
            $_.ExecutablePath -like $venvBackend -or
            $_.ExecutablePath -like $venvWorker  -or
            $_.ExecutablePath -like $nodeModPath
        )
    } | ForEach-Object {
        try {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
            Write-Step "    Stopped orphan $($_.Name) (PID $($_.ProcessId))"
        } catch { }
    }

# Kill anything still listening on the project's ports (catches orphan
# node/python from npm/uvicorn child processes). Vite spawns its node.exe
# from the GLOBAL Node.js install, not from frontend\node_modules, so the
# ExecutablePath sweep above doesn't catch it.
$projectPorts = @(5173, 8000)
foreach ($port in $projectPorts) {
    $conns = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    foreach ($conn in $conns) {
        $owner = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        if ($owner) {
            Write-Step "  Killing orphan process on port $port - $($owner.ProcessName) (PID $($owner.Id))"
            Stop-Process -Id $owner.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

# (c) docker compose down (silent so leftover lifecycle messages don't clutter).
Push-Location $workspaceRoot
try {
    Invoke-Docker -DockerCommandLine "compose down --remove-orphans" -Silent | Out-Null
} finally { Pop-Location }

# (d) Brief pause so the OS releases the freed ports.
Start-Sleep -Milliseconds 500

# (e) Remove the old state file (we'll write a fresh one at the end).
Remove-Item -Path $stateFile -Force -ErrorAction SilentlyContinue

Write-Ok "  Cleanup complete"

# ============================================================================
# Section 3: Port availability
# ============================================================================
Write-Step "Checking port availability..."
$portsToCheck = @(6380, 27017, 8000, 5173)
foreach ($port in $portsToCheck) {
    $owner = Get-ProcessUsingPort -Port $port
    if ($owner) {
        Write-Err ("Port {0} is in use by process {1} (PID {2})." -f $port, $owner.Name, $owner.Pid)
        Write-Err "This is NOT a leftover Docker container (we already cleaned those up)."
        Write-Err "To identify and stop the process:"
        Write-Err ("  Get-Process -Id {0} | Format-List" -f $owner.Pid)
        Write-Err ("  Stop-Process -Id {0}   # only if you're sure it's safe" -f $owner.Pid)
        exit 1
    }
}
Write-Ok "  Ports 6380, 27017, 8000, 5173 are free"

# ============================================================================
# Section 4: Compose up + healthcheck wait
# ============================================================================
Write-Step "Starting infrastructure (docker compose up -d)..."
Push-Location $workspaceRoot
try {
    $up = Invoke-Docker -DockerCommandLine "compose up -d"
    if ($up.ExitCode -ne 0) {
        Write-Err "docker compose up -d failed (exit code $($up.ExitCode)). See output above."
        exit 1
    }
} finally { Pop-Location }

Write-Step "Waiting for Redis + MongoDB to become healthy (timeout 30s)..."
$deadline = (Get-Date).AddSeconds(30)
$bothHealthy = $false
while ((Get-Date) -lt $deadline) {
    $rRedis = Invoke-Docker -DockerCommandLine "inspect --format ""{{.State.Health.Status}}"" roadsense-redis"   -Silent -PassThrough
    $rMongo = Invoke-Docker -DockerCommandLine "inspect --format ""{{.State.Health.Status}}"" roadsense-mongodb" -Silent -PassThrough
    $redisHealth = ($rRedis.Output | Where-Object { $_ -and $_.ToString().Trim().Length -gt 0 } | Select-Object -First 1)
    $mongoHealth = ($rMongo.Output | Where-Object { $_ -and $_.ToString().Trim().Length -gt 0 } | Select-Object -First 1)
    if ([string]$redisHealth -eq "healthy" -and [string]$mongoHealth -eq "healthy") {
        $bothHealthy = $true
        break
    }
    Start-Sleep -Seconds 2
}
if (-not $bothHealthy) {
    Write-Err "Infrastructure did not become healthy in 30s. Check 'docker compose logs' for details."
    exit 1
}
Write-Ok "  Redis (:6380) + MongoDB (:27017) healthy"

# ============================================================================
# Section 4.5: Clear stale RQ worker registrations from Redis
# ============================================================================
# Defensive net for cases where stop.ps1 didn't run cleanly (terminal closed
# with the X button, system crash, etc.). RQ refuses to start a worker whose
# name is already registered, so we DEL and SREM here too. 2>$null swallows
# the "container not found" error in cold-start scenarios.
Write-Step "Clearing any stale RQ worker registrations..."
docker exec roadsense-redis redis-cli DEL rq:worker:worker-1 rq:worker:worker-2 rq:worker:worker-3 2>$null
docker exec roadsense-redis redis-cli SREM rq:workers worker-1 worker-2 worker-3 2>$null

# ============================================================================
# Section 5: Spawn 3 separate console windows (no Windows Terminal)
# ============================================================================
$backendPy   = Join-Path $workspaceRoot "backend\venv\Scripts\python.exe"
$workerPy    = Join-Path $workspaceRoot "worker\venv\Scripts\python.exe"
$backendDir  = Join-Path $workspaceRoot "backend"
$workerDir   = Join-Path $workspaceRoot "worker"

# Build env-setting prefix for the powershell-hosted services. Each command
# runs in its own powershell.exe child, so setting $env:X only affects that
# child and its descendants - no leakage into the parent.
$envBlock = @{
    "DEV_MODE"             = "true"
    "REDIS_URL"            = "redis://localhost:6380"
    "MONGODB_URL"          = "mongodb://localhost:27017"
    "MONGODB_DB_NAME"      = "roadsenseai"
    "WORKER_COUNT"         = "$WorkerCount"
    "ENABLE_OBSERVABILITY" = "true"
}
# Single-quoted PowerShell strings keep $env: literal in the parent so it
# evaluates only in the child shell - no backtick escaping needed.
$envSetupCmds = $envBlock.GetEnumerator() | ForEach-Object { '$env:' + $_.Key + " = '" + $_.Value + "'" }
$envSetup = ($envSetupCmds -join "; ")

$tracked = @()

# Note: docker compose logs are NOT spawned in their own window any more - they
# flooded with MongoDB connection chatter and were unreadable. Tail them on
# demand from any shell:  docker compose logs -f mongodb
#                         docker compose logs -f redis

# 1. Backend - uvicorn under the venv python, hosted by a powershell window so
# we can set env vars + see stack traces.
Write-Step "Spawning Backend window..."
$backendInner = "& '$backendPy' -m uvicorn main:app --reload --host 127.0.0.1 --port 8000"
$backendCmd   = "$envSetup; Set-Location '$backendDir'; Write-Host 'Backend (uvicorn) DEV_MODE=true' -ForegroundColor Cyan; $backendInner"
$backendProc = Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoExit", "-Command", $backendCmd) `
    -PassThru
$tracked += @{ name = "backend"; pid = $backendProc.Id }

# 2. Workers - supervisor under the worker venv.
Write-Step "Spawning Workers window..."
$workersInner = "& '$workerPy' worker_supervisor.py"
$workersCmd   = "$envSetup; Set-Location '$workerDir'; Write-Host 'Workers (supervisor x $WorkerCount)' -ForegroundColor Cyan; $workersInner"
$workersProc = Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoExit", "-Command", $workersCmd) `
    -PassThru
$tracked += @{ name = "workers"; pid = $workersProc.Id }

# 3. Frontend - npm.cmd LAUNCHED DIRECTLY. Going through powershell -Command
# breaks Vite (npm exits, kills the child node, dev server dies). This is the
# Standard pattern for Windows process spawning with logging.
Write-Step "Spawning Frontend window..."
$frontendProc = Start-Process -FilePath $npmPath `
    -ArgumentList @("run", "dev") `
    -WorkingDirectory $frontendDir `
    -PassThru
$tracked += @{ name = "frontend"; pid = $frontendProc.Id }

Write-Ok ("  Spawned PIDs: {0}" -f (($tracked | ForEach-Object { "$($_.name)=$($_.pid)" }) -join ", "))

# ============================================================================
# Section 6: Wait for frontend
# ============================================================================
$frontendUp = $false
if (-not $NoBrowser) {
    Write-Step "Waiting for Vite dev server on http://localhost:5173 (timeout 60s)..."
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri "http://localhost:5173" -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { $frontendUp = $true; break }
        } catch { Start-Sleep -Seconds 1 }
    }
    if ($frontendUp) {
        Write-Ok "  Frontend is responding"
    } else {
        Write-Step "  Frontend did not respond within 60s. Open the URLs manually after Vite finishes booting."
    }
}

# ============================================================================
# Section 7: Open browser tabs
# ============================================================================
if (-not $NoBrowser -and $frontendUp) {
    Write-Step "Opening browser tabs..."
    Start-Process "http://localhost:5173/"
    # 1-second pause so the second tab opens in the same window rather than
    # being swallowed by the still-loading first tab.
    Start-Sleep -Seconds 1
    Start-Process "http://localhost:5173/dev/pipeline-monitor"
}

# ============================================================================
# Section 8: Persist state.json
# ============================================================================
$state = [pscustomobject]@{
    schema_version = 3
    started_at     = (Get-Date).ToString("s")
    workspace      = $workspaceRoot
    worker_count   = $WorkerCount
    ports          = @{ redis = 6380; mongodb = 27017; backend = 8000; frontend = 5173 }
    processes      = @($tracked)
}
$state | ConvertTo-Json -Depth 4 | Set-Content -Path $stateFile

# ============================================================================
# Section 9: Final report
# ============================================================================
Write-Host ""
Write-Ok "Demo running. Stop with: .\scripts\stop.ps1"
Write-Host "  App dashboard:    http://localhost:5173/" -ForegroundColor White
Write-Host "  Pipeline monitor: http://localhost:5173/dev/pipeline-monitor" -ForegroundColor White
Write-Host ""
Write-Host "  Tracked PIDs:" -ForegroundColor White
foreach ($t in $tracked) {
    Write-Host ("    {0,-12} PID {1}" -f $t.name, $t.pid) -ForegroundColor White
}
