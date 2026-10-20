#!/usr/bin/env bash
# UniHelperProMax installer for Linux and macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/Nimaj2002/UniHelperProMax/main/install.sh | bash
#   ./install.sh                 install from a checkout (or clone one) and build the app
#   ./install.sh --docker        build and run it with Docker Compose instead
#
# Options (or the matching environment variables when piping into bash):
#   --docker                     UNIHELPER_INSTALL=docker   use Docker instead of uv + Node
#   --dir <path>                 UNIHELPER_DIR=<path>       where to clone (default ./UniHelperProMax)
#   --start                      UNIHELPER_START=1          start the app when done
#   -y, --yes                    UNIHELPER_YES=1            answer yes to every question
#
# Running it again updates the dependencies and rebuilds; your data folder is never touched.

set -euo pipefail

REPO_URL="https://github.com/Nimaj2002/UniHelperProMax.git"
MODE="${UNIHELPER_INSTALL:-native}"
TARGET_DIR="${UNIHELPER_DIR:-}"
START="${UNIHELPER_START:-0}"
YES="${UNIHELPER_YES:-0}"
NODE_MAJOR=22

while [ $# -gt 0 ]; do
  case "$1" in
    --docker) MODE=docker ;;
    --dir) TARGET_DIR="${2:?--dir needs a path}"; shift ;;
    --start) START=1 ;;
    -y|--yes) YES=1 ;;
    -h|--help) echo "Usage: install.sh [--docker] [--dir <path>] [--start] [--yes]"; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; RESET=""
fi
step() { printf '\n%s==>%s %s\n' "$BOLD" "$RESET" "$*"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
info() { printf '  %s%s%s\n' "$DIM" "$*" "$RESET"; }
die()  { printf '\n%sError:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# Ask a yes/no question. Reads from the terminal, so it also works under `curl … | bash`.
confirm() {
  [ "$YES" = 1 ] && return 0
  local answer
  if [ -r /dev/tty ]; then
    printf '  %s [Y/n] ' "$1" > /dev/tty
    read -r answer < /dev/tty || answer=n
  else
    return 1
  fi
  case "$answer" in ""|y|Y|yes|Yes) return 0 ;; *) return 1 ;; esac
}

case "$(uname -s)" in
  Linux)  OS=linux ;;
  Darwin) OS=macos ;;
  *) die "This script is for Linux and macOS. On Windows, run install.ps1 in PowerShell." ;;
esac

node_hint() {
  if [ "$OS" = macos ]; then
    echo "Install it with 'brew install node@${NODE_MAJOR}' or from https://nodejs.org (LTS)."
  else
    echo "Install Node.js ${NODE_MAJOR} LTS from https://nodejs.org, your package manager, or nvm (https://github.com/nvm-sh/nvm)."
  fi
}

# ---------- Find or fetch the code ----------

step "Getting UniHelperProMax"
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
is_checkout() { [ -f "$1/backend/pyproject.toml" ] && [ -f "$1/frontend/package.json" ]; }

if [ -n "$TARGET_DIR" ] && is_checkout "$TARGET_DIR"; then
  ROOT="$(cd "$TARGET_DIR" && pwd)"
elif [ -z "$TARGET_DIR" ] && [ -n "$SCRIPT_DIR" ] && is_checkout "$SCRIPT_DIR"; then
  ROOT="$SCRIPT_DIR"
elif [ -z "$TARGET_DIR" ] && is_checkout "$PWD"; then
  ROOT="$PWD"
else
  have git || die "git is needed to download the code. Install git and run this again."
  ROOT="${TARGET_DIR:-$PWD/UniHelperProMax}"
  if [ -e "$ROOT" ] && [ -n "$(ls -A "$ROOT" 2>/dev/null)" ]; then
    die "$ROOT already exists and is not a UniHelperProMax checkout. Choose another folder with --dir."
  fi
  git clone --depth 1 "$REPO_URL" "$ROOT"
fi
ok "Code in $ROOT"
cd "$ROOT"

# ---------- Docker ----------

if [ "$MODE" = docker ]; then
  step "Checking Docker"
  have docker || die "Docker is not installed. Get it from https://docs.docker.com/get-docker/"
  docker info >/dev/null 2>&1 || die "Docker is installed but not running (or needs sudo). Start Docker and try again."
  if docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose)
  elif have docker-compose; then
    COMPOSE=(docker-compose)
  else
    die "Docker Compose is missing. Install the Docker Compose plugin: https://docs.docker.com/compose/install/"
  fi
  ok "$(docker --version)"

  # The container writes backend/data (same folder as ./start.sh) as your user.
  mkdir -p backend/data keys  # 014: keys holds the key that encrypts saved API keys
  if [ ! -f .env ]; then
    printf 'UNIHELPER_UID=%s\nUNIHELPER_GID=%s\n' "$(id -u)" "$(id -g)" > .env
    info "Wrote .env (runs the container as your user)"
  fi

  step "Building and starting the container (the first build takes a few minutes)"
  "${COMPOSE[@]}" up -d --build
  port="$(sed -n 's/^UNIHELPER_PORT=//p' .env 2>/dev/null | tail -1)"
  printf '\n%sUniHelperProMax is running at http://localhost:%s%s\n' "$GREEN$BOLD" "${port:-8000}" "$RESET"
  echo "Your notes, PDFs and recordings are in $ROOT/backend/data"
  echo "Stop it with '${COMPOSE[*]} down', update it by running this script again."
  exit 0
fi

# ---------- Native: uv + Node ----------

step "Checking requirements"

if ! have uv; then
  for candidate in "$HOME/.local/bin/uv" "$HOME/.cargo/bin/uv"; do
    [ -x "$candidate" ] && PATH="$(dirname "$candidate"):$PATH"
  done
fi
if ! have uv; then
  info "uv (the Python package manager) is not installed."
  if confirm "Install uv now from https://astral.sh/uv (into your home folder, no sudo)?"; then
    have curl || die "curl is needed to install uv."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    PATH="$HOME/.local/bin:$PATH"
    have uv || die "uv was installed but isn't on PATH. Open a new terminal and run this again."
  else
    die "uv is required: https://docs.astral.sh/uv/getting-started/installation/"
  fi
fi
ok "$(uv --version)"

have node || die "Node.js ${NODE_MAJOR}+ is required to build the app. $(node_hint)"
node_version="$(node -p 'process.versions.node')"
[ "${node_version%%.*}" -ge "$NODE_MAJOR" ] || die "Node.js ${NODE_MAJOR}+ is required, found ${node_version}. $(node_hint)"
ok "Node.js ${node_version}"

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if have corepack; then
  PNPM=(corepack pnpm)
elif have pnpm; then
  PNPM=(pnpm)
else
  die "Neither corepack nor pnpm was found. Run 'npm install -g corepack' and try again."
fi
ok "pnpm $("${PNPM[@]}" --version)"

step "Installing the backend (uv downloads Python 3.12 if you don't have it)"
(cd backend && uv sync --frozen --no-dev --inexact)  # --inexact keeps dev tools if you have them
ok "Backend ready"

step "Installing and building the frontend"
(cd frontend && "${PNPM[@]}" install --frozen-lockfile && "${PNPM[@]}" build)
ok "Frontend built"

chmod +x start.sh 2>/dev/null || true

printf '\n%sUniHelperProMax is installed.%s\n' "$GREEN$BOLD" "$RESET"
echo "Start it with:  cd \"$ROOT\" && ./start.sh"
echo "Then open http://localhost:8000 and create your account."

# --yes alone doesn't start the server (it blocks the terminal); --start does.
if [ "$START" = 1 ] || { [ "$YES" != 1 ] && confirm "Start it now?"; }; then
  exec ./start.sh
fi
