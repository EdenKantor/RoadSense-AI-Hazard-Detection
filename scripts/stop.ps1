<#
.SYNOPSIS
RoadSenseAI demo shutdown (Section 2 - Environment & Observability Dashboard).

.DESCRIPTION
Counterpart to scripts/start.ps1. Reads tracked PIDs from
output/dev/demo-state.json, terminates each one, sweeps any orphan venv/node
processes, then runs docker compose down.

Fully idempotent: safe to run twice in a row, and safe to run when nothing is
up. Exit code is always 0 on success even if nothing was running.

.PARAMETER RemoveVolumes
Also wipe the named volumes (Redis + MongoDB data). Without this flag,
volumes are preserved so test data survives the restart.
#>
param(
    [switch]$RemoveVolumes
)

$ErrorActionPreference = "Continue"
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$stateDir  = Join-Path $workspaceRoot "output\dev"
$stateFile = Join-Path $stateDir "demo-state.json"

function Write-Step([string]$Message) { Write-Host "[stop] $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message)   { Write-Host "[stop] $Message" -ForegroundColor Green }
function Write-Skip([string]$Message) { Write-Host "[stop] $Message" -ForegroundColor DarkGray }

# ----------------------------------------------------------------------------
# Invoke-Docker (mirrors setup.ps1 / start.ps1)
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
# Section 1: Read state file
# ============================================================================
$state = $null
if (Test-Path $stateFile) {
    Write-Step "Reading $stateFile"
    try {
        $state = Get-Content -Raw -Path $stateFile | ConvertFrom-Json
    } catch {
        Write-Step "  Could not parse demo-state.json: $($_.Exception.Message)"
    }
} else {
    Write-Step "No demo state file found at $stateFile"
}

# ============================================================================
# Section 2: Stop tracked processes
# ============================================================================
if ($state -and $state.processes) {
    Write-Step "Stopping tracked processes..."
    foreach ($entry in @($state.processes)) {
        if ($entry.pid) {
            $label = if ($entry.name) { [string]$entry.name } else { "tracked process" }
            Stop-PidSafely -ProcId ([int]$entry.pid) -Label $label
        }
    }
}

# ============================================================================
# Section 3: Sweep orphan processes
# ============================================================================
Write-Step "Sweeping orphan venv/node processes..."
$venvBackend = "$workspaceRoot\backend\venv\*"
$venvWorker  = "$workspaceRoot\worker\venv\*"
$nodeModPath = "$workspaceRoot\frontend\node_modules\*"
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
            Write-Step "  Stopped orphan $($_.Name) (PID $($_.ProcessId))"
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

# ============================================================================
# Section 3.5: Clear stale RQ worker registrations from Redis
# ============================================================================
# RQ registers each worker under rq:worker:<name> with a multi-minute
# heartbeat TTL, and the Redis volume has appendonly=yes so the keys survive
# even a docker compose down. Without this cleanup, the next start.ps1 dies
# with: ValueError: There exists an active worker named 'worker-N'.
# Wrapped in 2>$null so a stopped Redis container doesn't fail the script.
Write-Step "Clearing stale RQ worker registrations in Redis..."
docker exec roadsense-redis redis-cli DEL rq:worker:worker-1 rq:worker:worker-2 rq:worker:worker-3 2>$null
docker exec roadsense-redis redis-cli SREM rq:workers worker-1 worker-2 worker-3 2>$null

# ============================================================================
# Section 4: Compose down
# ============================================================================
Push-Location $workspaceRoot
try {
    if ($RemoveVolumes) {
        Write-Host "[stop] WARNING: -RemoveVolumes specified - wiping Redis + MongoDB volumes." -ForegroundColor Yellow
        Write-Step "docker compose down -v --remove-orphans"
        $down = Invoke-Docker -DockerCommandLine "compose down -v --remove-orphans"
    } else {
        Write-Step "docker compose down --remove-orphans (volumes preserved - use -RemoveVolumes to wipe)"
        $down = Invoke-Docker -DockerCommandLine "compose down --remove-orphans"
    }
    if ($down.ExitCode -ne 0) {
        Write-Step "  (docker compose down returned exit code $($down.ExitCode); already stopped or no compose project)"
    }
} finally { Pop-Location }

# ============================================================================
# Section 5: Delete state.json
# ============================================================================
Remove-Item -Path $stateFile -Force -ErrorAction SilentlyContinue

# ============================================================================
# Section 6: Final line
# ============================================================================
Write-Ok "Demo stopped."
