<#
.SYNOPSIS
  Stop the whole Polluxa dev stack by freeing its fixed ports.

.DESCRIPTION
  Kills whatever is listening on the gateway/service/frontend ports (4000-4003, 5173).
  Worker processes have no listening port, so they are matched by command line instead
  (the tsx-watched worker entrypoints under apps/api/src/workers). Redis on 6379 is left
  running by default since it may be shared; pass -IncludeRedis to stop it too.

.EXAMPLE
  npm run stop:all
  npm run stop:all -- -IncludeRedis
#>
param(
  [switch]$IncludeRedis
)

$ErrorActionPreference = "Continue"

$ports = @(4000, 4001, 4002, 4003, 5173)
if ($IncludeRedis) { $ports += 6379 }

Write-Host "== Stopping services on fixed ports ==" -ForegroundColor Cyan
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

# Workers bind no port - find the node processes whose command line runs a worker
# entrypoint and stop them. Uses CIM (WMI) to read CommandLine.
Write-Host "== Stopping worker processes ==" -ForegroundColor Cyan
$workerMatch = "src[\\/]workers[\\/].*Worker\.ts"
$procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and ($_.CommandLine -match $workerMatch) }
if ($procs) {
  foreach ($wp in $procs) {
    Write-Host ("  killing worker PID {0}" -f $wp.ProcessId) -ForegroundColor Yellow
    Stop-Process -Id $wp.ProcessId -Force -ErrorAction SilentlyContinue
  }
} else {
  Write-Host "  no worker processes found" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Done." -ForegroundColor Cyan
if (-not $IncludeRedis) { Write-Host "(Redis on 6379 left running - use '-IncludeRedis' to stop it too)" -ForegroundColor DarkGray }
