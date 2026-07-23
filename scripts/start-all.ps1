<#
.SYNOPSIS
  Bring up the whole Polluxa dev stack on fixed ports, in one command.

.DESCRIPTION
  This app is a microservice architecture: the API gateway (4000) is only a proxy, and
  the BullMQ workers are SEPARATE processes the gateway does not start. "Start frontend
  and backend" is therefore not enough - the campaign-generate flow hangs at "pending"
  forever unless the campaign-generation worker is also running. This script starts every
  piece in ONE window: their logs are streamed together via `concurrently`, each line
  prefixed and color-coded by service name so a dozen processes don't mean a dozen windows.

  It first frees the fixed ports (killing any stale/orphaned dev server still holding them),
  which is exactly the situation that used to make Vite silently drift to 5174/5175.
  Ctrl+C in the aggregated window stops the whole stack (concurrently -k); `npm run stop:all`
  still works too.

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

# Fixed ports every process binds. Keep in sync with vite.config.ts (5173, strictPort)
# and the gateway/service defaults (api gateway 4000, SCRAPER_SERVICE_URL=4003).
$ports = @(4000, 4003, 5173)

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

# --- Redis (6379): start only if not already answering PING ---
# Redis is the one piece that can't share the aggregated window (it's a native exe, not an
# npm script), so it still gets its own minimized window when we have to start it.
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
  $inner = "`$host.UI.RawUI.WindowTitle = 'redis'; & '$redisServer' --port 6379"
  Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoExit", "-NoProfile", "-Command", $inner `
    -WindowStyle Minimized | Out-Null
  Write-Host "  started redis (minimized window)" -ForegroundColor Green
} else {
  Write-Host "  redis-server not found - install it or start Redis manually (queues won't work without it)" -ForegroundColor Red
}

# --- Everything else in ONE aggregated window via `concurrently` ---
# Each entry is a "name:command" pair; -n sets the prefixes, -c their colors, and -k makes
# Ctrl+C tear the whole stack down together. Workers live in the apps/api package.json, so
# they run via the npm workspace flag (`-w apps/api`) - relative and space-free, unlike an
# absolute --prefix path which breaks on the space in "New folder" once cmd re-parses it.
Write-Host "== Starting stack (aggregated logs) ==" -ForegroundColor Cyan

$names = @("api", "scraper", "web", "w:campaign", "w:vector")
$cmds  = @(
  "npm run dev:api",
  "npm run dev:scraper-service",
  "npm run dev:web",
  "npm run dev:campaign-generation-worker -w apps/api",
  # Part of the generate flow: the campaign pipeline enqueues vector ad-image jobs at its tail, so this
  # worker must run for those images to be generated and attached (mirrors campaign-generation above).
  "npm run dev:vector-ad-worker -w apps/api"
)
$colors = @("cyan", "magenta", "green", "yellow", "blue")

if ($AllWorkers) {
  $names  += @("w:creative", "w:research-orch", "w:research", "w:metrics", "w:lead", "w:crm-webhook", "w:competitor")
  $cmds   += @(
    "npm run dev:worker -w apps/api",
    "npm run dev:research-orchestrator-worker -w apps/api",
    "npm run dev:research-worker -w apps/api",
    "npm run dev:metrics-worker -w apps/api",
    "npm run dev:lead-worker -w apps/api",
    "npm run dev:crm-webhook-worker -w apps/api",
    "npm run dev:competitor-ad-refresh-worker -w apps/api"
  )
  $colors += @("gray", "red", "redBright", "greenBright", "yellowBright", "blueBright", "magentaBright")
}

Write-Host ""
Write-Host "Stack starting. Frontend: http://localhost:5173  |  API: http://localhost:4000" -ForegroundColor Cyan
if (-not $AllWorkers) {
  Write-Host "(only the campaign-generation + vector-ad workers started - use '-AllWorkers' for the rest)" -ForegroundColor DarkGray
}
Write-Host "Logs are aggregated below; a crashed service auto-restarts (up to 5x) on its own." -ForegroundColor DarkGray
Write-Host "Ctrl+C here stops the whole stack (or: npm run stop:all)." -ForegroundColor DarkGray
Write-Host ""

# Run concurrently in THIS window (foreground) so all logs stream here.
# NOTE: deliberately NO -k (kill-others). A dev stack must be crash-tolerant: if one service
# dies (e.g. the gateway hiccups), -k would SIGTERM every other process and take the whole
# stack down. Instead we auto-restart each command a few times so a transient crash self-heals
# without dragging its neighbours down. Ctrl+C still stops everything (SIGINT hits the group).
$concurrently = Join-Path $root "node_modules\.bin\concurrently.cmd"
$cliArgs = @(
  "--restart-tries", "5",
  "--restart-after", "1000",
  "-n", ($names -join ","),
  "-c", ($colors -join ",")
) + $cmds
Set-Location $root
& $concurrently @cliArgs
