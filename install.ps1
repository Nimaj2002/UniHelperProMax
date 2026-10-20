# UniHelperProMax installer for Windows (PowerShell 5.1 or 7+).
#
#   irm https://raw.githubusercontent.com/Nimaj2002/UniHelperProMax/main/install.ps1 | iex
#   .\install.ps1                 install from a checkout (or clone one) and build the app
#   .\install.ps1 -Docker         build and run it with Docker Desktop instead
#
# Options (or the matching environment variables when piping into iex):
#   -Docker                       $env:UNIHELPER_INSTALL = 'docker'
#   -Dir <path>                   $env:UNIHELPER_DIR = '<path>'   (default .\UniHelperProMax)
#   -Start                        $env:UNIHELPER_START = '1'
#   -Yes                          $env:UNIHELPER_YES = '1'
#
# If PowerShell refuses to run scripts, use:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#
# Running it again updates the dependencies and rebuilds; your data folder is never touched.

$ErrorActionPreference = 'Stop'

$RepoUrl   = 'https://github.com/Nimaj2002/UniHelperProMax.git'
$NodeMajor = 22
$Mode      = if ($env:UNIHELPER_INSTALL) { $env:UNIHELPER_INSTALL } else { 'native' }
$TargetDir = $env:UNIHELPER_DIR
$Start     = $env:UNIHELPER_START -eq '1'
$Yes       = $env:UNIHELPER_YES -eq '1'

# $args works when this runs as a file; `irm | iex` uses the environment variables above.
for ($i = 0; $i -lt $args.Count; $i++) {
    switch -Regex ($args[$i]) {
        '^-{1,2}docker$' { $Mode = 'docker' }
        '^-{1,2}dir$'    { $i++; $TargetDir = $args[$i] }
        '^-{1,2}start$'  { $Start = $true }
        '^-{1,2}(y|yes)$' { $Yes = $true }
        '^-{1,2}(h|help)$' { Write-Host 'Usage: install.ps1 [-Docker] [-Dir <path>] [-Start] [-Yes]'; return }
        default { throw "Unknown option: $($args[$i])" }
    }
}

function Step($msg) { Write-Host ''; Write-Host "==> $msg" -ForegroundColor White }
function Ok($msg)   { Write-Host "  + $msg" -ForegroundColor Green }
function Info($msg) { Write-Host "  $msg" -ForegroundColor DarkGray }
function Fail($msg) { Write-Host ''; Write-Host "Error: $msg" -ForegroundColor Red; throw $msg }
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Confirm-Step($question) {
    if ($Yes) { return $true }
    $answer = Read-Host "  $question [Y/n]"
    return ($answer -eq '' -or $answer -match '^(y|yes)$')
}
function Invoke-Checked {
    param([string]$Exe, [string[]]$Arguments)
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { Fail "'$Exe $($Arguments -join ' ')' failed (exit code $LASTEXITCODE)." }
}
function Test-Checkout($dir) {
    $dir -and (Test-Path (Join-Path $dir 'backend\pyproject.toml')) -and (Test-Path (Join-Path $dir 'frontend\package.json'))
}
function Update-SessionPath {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

# ---------- Find or fetch the code ----------

Step 'Getting UniHelperProMax'
$ScriptDir = if ($PSCommandPath) { Split-Path -Parent $PSCommandPath } else { $null }

if ($TargetDir -and (Test-Checkout $TargetDir)) {
    $Root = (Resolve-Path $TargetDir).Path
} elseif (-not $TargetDir -and (Test-Checkout $ScriptDir)) {
    $Root = $ScriptDir
} elseif (-not $TargetDir -and (Test-Checkout (Get-Location).Path)) {
    $Root = (Get-Location).Path
} else {
    if (-not (Have git)) { Fail 'git is needed to download the code. Install it with "winget install Git.Git" and run this again.' }
    $Root = if ($TargetDir) { $TargetDir } else { Join-Path (Get-Location).Path 'UniHelperProMax' }
    if ((Test-Path $Root) -and (Get-ChildItem -Force $Root | Select-Object -First 1)) {
        Fail "$Root already exists and is not a UniHelperProMax checkout. Choose another folder with -Dir."
    }
    Invoke-Checked git @('clone', '--depth', '1', $RepoUrl, $Root)
    $Root = (Resolve-Path $Root).Path
}
Ok "Code in $Root"
Set-Location $Root

# ---------- Docker ----------

if ($Mode -eq 'docker') {
    Step 'Checking Docker'
    if (-not (Have docker)) { Fail 'Docker Desktop is not installed. Get it from https://docs.docker.com/desktop/setup/install/windows-install/' }
    cmd /c 'docker info >nul 2>&1'
    if ($LASTEXITCODE -ne 0) { Fail 'Docker is installed but not running. Start Docker Desktop and try again.' }
    cmd /c 'docker compose version >nul 2>&1'
    if ($LASTEXITCODE -ne 0) { Fail 'Docker Compose is missing. Update Docker Desktop.' }
    Ok (docker --version)

    New-Item -ItemType Directory -Force -Path (Join-Path $Root 'backend\data') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $Root 'keys') | Out-Null  # 014: encryption key for saved API keys

    Step 'Building and starting the container (the first build takes a few minutes)'
    Invoke-Checked docker @('compose', 'up', '-d', '--build')
    Write-Host ''
    Write-Host 'UniHelperProMax is running at http://localhost:8000' -ForegroundColor Green
    Write-Host "Your notes, PDFs and recordings are in $Root\backend\data"
    Write-Host "Stop it with 'docker compose down', update it by running this script again."
    return
}

# ---------- Native: uv + Node ----------

Step 'Checking requirements'

if (-not (Have uv)) {
    $localUv = Join-Path $env:USERPROFILE '.local\bin'
    if (Test-Path (Join-Path $localUv 'uv.exe')) { $env:Path = "$localUv;$env:Path" }
}
if (-not (Have uv)) {
    Info 'uv (the Python package manager) is not installed.'
    if (Confirm-Step 'Install uv now from https://astral.sh/uv (for your user only, no admin)?') {
        powershell -ExecutionPolicy ByPass -NoProfile -Command 'irm https://astral.sh/uv/install.ps1 | iex'
        Update-SessionPath
        $env:Path = (Join-Path $env:USERPROFILE '.local\bin') + ";$env:Path"
        if (-not (Have uv)) { Fail 'uv was installed but is not on PATH. Open a new terminal and run this again.' }
    } else {
        Fail 'uv is required: https://docs.astral.sh/uv/getting-started/installation/'
    }
}
Ok (uv --version)

$nodeHint = "Install Node.js $NodeMajor LTS with 'winget install OpenJS.NodeJS.LTS' or from https://nodejs.org, then open a new terminal."
if (-not (Have node)) { Fail "Node.js $NodeMajor+ is required to build the app. $nodeHint" }
$nodeVersion = (node -p 'process.versions.node').Trim()
if ([int]($nodeVersion.Split('.')[0]) -lt $NodeMajor) { Fail "Node.js $NodeMajor+ is required, found $nodeVersion. $nodeHint" }
Ok "Node.js $nodeVersion"

$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
if (Have corepack) {
    $Pnpm = 'corepack'; $PnpmPrefix = @('pnpm')
} elseif (Have pnpm) {
    $Pnpm = 'pnpm'; $PnpmPrefix = @()
} else {
    Fail "Neither corepack nor pnpm was found. Run 'npm install -g corepack' and try again."
}
Ok ("pnpm " + (& $Pnpm @($PnpmPrefix + '--version')))

Step "Installing the backend (uv downloads Python 3.12 if you don't have it)"
Push-Location (Join-Path $Root 'backend')
try { Invoke-Checked uv @('sync', '--frozen', '--no-dev', '--inexact') } finally { Pop-Location }
Ok 'Backend ready'

Step 'Installing and building the frontend'
Push-Location (Join-Path $Root 'frontend')
try {
    Invoke-Checked $Pnpm ($PnpmPrefix + @('install', '--frozen-lockfile'))
    Invoke-Checked $Pnpm ($PnpmPrefix + @('build'))
} finally { Pop-Location }
Ok 'Frontend built'

Write-Host ''
Write-Host 'UniHelperProMax is installed.' -ForegroundColor Green
Write-Host "Start it with:  cd `"$Root`"; .\start.ps1"
Write-Host 'Then open http://localhost:8000 and create your account.'

# -Yes alone doesn't start the server (it blocks the terminal); -Start does.
if ($Start -or (-not $Yes -and (Confirm-Step 'Start it now?'))) {
    & (Join-Path $Root 'start.ps1')
}
