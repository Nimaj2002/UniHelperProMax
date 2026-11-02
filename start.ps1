# Start UniHelperProMax after .\install.ps1 (Windows).
#
# Environment variables (all optional):
#   UNIHELPER_DATA_DIR    where notes, PDFs, recordings and the database live (default backend\data)
#   UNIHELPER_HOST        address to listen on (default 127.0.0.1; 0.0.0.0 for your whole network)
#   UNIHELPER_PORT        port (default 8000; if taken, the next free one is used)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSCommandPath

if (-not (Test-Path (Join-Path $Root 'frontend\dist\index.html'))) {
    throw "The app isn't built yet. Run .\install.ps1 first."
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    $env:Path = (Join-Path $env:USERPROFILE '.local\bin') + ";$env:Path"
}

if (-not $env:UNIHELPER_DATA_DIR) { $env:UNIHELPER_DATA_DIR = Join-Path $Root 'backend\data' }
$env:UNIHELPER_STATIC_DIR = Join-Path $Root 'frontend\dist'
$hostAddr = if ($env:UNIHELPER_HOST) { $env:UNIHELPER_HOST } else { '127.0.0.1' }
$port     = if ($env:UNIHELPER_PORT) { $env:UNIHELPER_PORT } else { '8000' }
New-Item -ItemType Directory -Force -Path $env:UNIHELPER_DATA_DIR | Out-Null
# The port is taken by another program: try the next one.
function Test-PortFree([int]$p) {
    $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse($hostAddr), $p)
    try { $l.Start(); return $true } catch { return $false } finally { $l.Stop() }
}
$port = [int]$port
while (-not (Test-PortFree $port)) { $port++ }

Write-Host "UniHelperProMax on http://localhost:$port  (data: $env:UNIHELPER_DATA_DIR, Ctrl+C to stop)"
Push-Location (Join-Path $Root 'backend')
try {
    # A single process on purpose: never add --workers.
    uv run --no-sync uvicorn unihelper.main:app --host $hostAddr --port $port
} finally { Pop-Location }
