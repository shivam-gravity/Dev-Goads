<#
.SYNOPSIS
  Bring up the whole Polluxa dev stack on fixed ports, in one command.

.DESCRIPTION
  This app is a microservice architecture: the API gateway (4000) is only a proxy, and
  the BullMQ workers are SEPARATE processes the gateway does not start. "Start frontend
  and backend" is therefore not enough - the campaign-generate flow hangs at "pending"
  forever unless the campaign-generation worker is also running. This script starts every
  piece on its fixed port, each in its own titled window so logs are visible and killable.

  It first frees the fixed ports (killing any stale/orphaned dev server still holding them),
  which is exactly the situation that used to make Vite silently drift to 5174/5175.

.PARAMETER AllWorkers
  Start every background worker (creative, research, metrics, lead, crm-webhook,
  competitor-ad-refresh) in addition to the campaign-generation worker. Without this
  flag, only the campaign-generation worker starts (the one the generate flow needs).

.EXAMPLE
  npm run start:all
  npm run start:all -- -AllWorkers
#>
param(
  [switch]$AllWorkers
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$api  = Join-Path $root "apps\api"

# Fixed ports every process binds. Keep in sync with vite.config.ts (5173, strictPort)
# and the gateway/service defaults (AUTH_SERVICE_URL=4001, CAMPAIGN=4002, SCRAPER=4003).
$ports = @(4000, 4001, 4002, 4003, 5173)

Write-Host "== Freeing fixed ports (killing stale dev servers) ==" -ForegroundColor Cyan
foreach ($p in $ports) {
  $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  foreach ($procId in ($conns | Select-Object -ExpandProperty OwningProcess -Unique)) {
    try {
      $proc = Get-Process -Id $procId -ErrorAction Stop
      Write-Host ("  port {0} -> killing PID {1} ({2})" -f $p, $procId, $proc.ProcessName) -ForegroundColor Yellow
      Stop-Process -Id $procId -Force -ErrorAction Stop
    } catch {
      Write-Host ("  port {0} -> could not kill PID {1} ({2})" -f $p, $procId, $_.Exception.Message) -ForegroundColor Red
    }
  }
}

# Launch one service in its own titled PowerShell window (-NoExit keeps it open so logs
# stay visible and Ctrl+C / closing the window stops just that service).
function Start-Svc {
  param([string]$Title, [string]$WorkDir, [string]$Command)
  $inner = "`$host.UI.RawUI.WindowTitle = '$Title'; Set-Location '$WorkDir'; $Command"
  Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoExit", "-NoProfile", "-Command", $inner `
    -WindowStyle Normal | Out-Null
  Write-Host "  started: $Title" -ForegroundColor Green
}

# --- Redis (6379): start only if not already answering PING ---
Write-Host "== Redis (6379) ==" -ForegroundColor Cyan
$redisCli    = (Get-Command redis-cli -ErrorAction SilentlyContinue).Source
$redisServer = (Get-Command redis-server -ErrorAction SilentlyContinue).Source
if (-not $redisServer) {
  # Fall back to the winget install location used on this machine.
  $winget = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter "redis-server.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($winget) { $redisServer = $winget.FullName; $redisCli = Join-Path (Split-Path $winget.FullName) "redis-cli.exe" }
}
$redisUp = $false
if ($redisCli) {
  try { if ((& $redisCli -p 6379 ping 2>$null) -match "PONG") { $redisUp = $true } } catch {}
}
if ($redisUp) {
  Write-Host "  already up (PONG)" -ForegroundColor Green
} elseif ($redisServer) {
  Start-Svc -Title "redis" -WorkDir $root -Command "& '$redisServer' --port 6379"
} else {
  Write-Host "  redis-server not found - install it or start Redis manually (queues won't work without it)" -ForegroundColor Red
}

# --- Core services + frontend ---
Write-Host "== Services ==" -ForegroundColor Cyan
Start-Svc -Title "api-gateway (4000)"      -WorkDir $root -Command "npm run dev:api"
Start-Svc -Title "auth-service (4001)"     -WorkDir $root -Command "npm run dev:auth-service"
Start-Svc -Title "campaign-service (4002)" -WorkDir $root -Command "npm run dev:campaign-service"
Start-Svc -Title "scraper-service (4003)"  -WorkDir $root -Command "npm run dev:scraper-service"
Start-Svc -Title "web (5173)"              -WorkDir $root -Command "npm run dev:web"

# --- Workers (separate processes; gateway does NOT start these) ---
Write-Host "== Workers ==" -ForegroundColor Cyan
Start-Svc -Title "worker: campaign-generation" -WorkDir $api -Command "npm run dev:campaign-generation-worker"
if ($AllWorkers) {
  Start-Svc -Title "worker: creative"              -WorkDir $api -Command "npm run dev:worker"
  Start-Svc -Title "worker: research-orchestrator" -WorkDir $api -Command "npm run dev:research-orchestrator-worker"
  Start-Svc -Title "worker: research-session"      -WorkDir $api -Command "npm run dev:research-worker"
  Start-Svc -Title "worker: metrics"               -WorkDir $api -Command "npm run dev:metrics-worker"
  Start-Svc -Title "worker: lead-ingestion"        -WorkDir $api -Command "npm run dev:lead-worker"
  Start-Svc -Title "worker: crm-webhook"           -WorkDir $api -Command "npm run dev:crm-webhook-worker"
  Start-Svc -Title "worker: competitor-ad-refresh" -WorkDir $api -Command "npm run dev:competitor-ad-refresh-worker"
}

Write-Host ""
Write-Host "Stack starting. Frontend: http://localhost:5173  |  API: http://localhost:4000" -ForegroundColor Cyan
if (-not $AllWorkers) {
  Write-Host "(only the campaign-generation worker started - use '-AllWorkers' for the rest)" -ForegroundColor DarkGray
}
Write-Host "Give services ~5-10s to bind. Stop everything with: npm run stop:all" -ForegroundColor DarkGray
