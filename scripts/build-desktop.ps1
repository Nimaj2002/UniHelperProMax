<#
.SYNOPSIS
  Builds the UniHelperProMax desktop app for Windows:
    1. the frontend (frontend\dist)
    2. the standalone backend (PyInstaller onedir, backend\dist\unihelper-backend) + smoke test
    3. the Electron app and its installer (desktop\release\UniHelperProMax-Setup-<version>-x64.exe)

.EXAMPLE
  .\scripts\build-desktop.ps1             # the installer
  .\scripts\build-desktop.ps1 -Unpacked   # only the unpacked app (quicker; for the probe)

.NOTES
  Needs uv, pnpm, node and npm. Linux and macOS: scripts/build-desktop.sh.
#>
param([switch]$Unpacked)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

foreach ($tool in "uv", "pnpm", "node", "npm") {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "build-desktop: '$tool' is not installed" }
}

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }

# Native commands don't throw on failure: stop at the first non-zero exit code.
function Run {
  param([Parameter(Mandatory)][string]$Exe, [Parameter(ValueFromRemainingArguments)][string[]]$Rest)
  & $Exe @Rest
  if ($LASTEXITCODE -ne 0) { throw "build-desktop: '$Exe $($Rest -join ' ')' failed with exit code $LASTEXITCODE" }
}

Step "1/3 frontend"
Push-Location "$root\frontend"
try { Run pnpm install --frozen-lockfile; Run pnpm run build } finally { Pop-Location }

Step "2/3 backend (PyInstaller onedir) + smoke test"
Push-Location "$root\backend"
try {
  Run uv sync --frozen --group packaging
  Run uv run --frozen pyinstaller --noconfirm --clean packaging/unihelper-backend.spec
  Run uv run --frozen python -m unihelper.desktop.smoke dist/unihelper-backend
} finally { Pop-Location }

Step "3/3 desktop app"
Push-Location "$root\desktop"
try {
  Run npm ci
  Run npm run build
  $builderArgs = @("--publish", "never")
  if ($Unpacked) { $builderArgs += "--dir" }
  Run npx electron-builder @builderArgs
} finally { Pop-Location }

Step "done: $root\desktop\release"
Get-ChildItem "$root\desktop\release" -Filter "*.exe" -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
if ($Unpacked) { "$root\desktop\release\win-unpacked\UniHelperProMax.exe" }
