#!/usr/bin/env bash
# Builds the UniHelperProMax desktop app for THIS computer's system (Linux or macOS):
#   1. the frontend (frontend/dist)
#   2. the standalone backend (PyInstaller onedir, backend/dist/unihelper-backend) + smoke test
#   3. the Electron app and its installers (desktop/release)
#
#   scripts/build-desktop.sh                 installers: AppImage + .deb on Linux, .dmg on macOS
#   scripts/build-desktop.sh --unpacked      only the unpacked app (quicker; for the probe)
#   scripts/build-desktop.sh --arch arm64    macOS: Apple Silicon (default: this Mac's CPU)
#   scripts/build-desktop.sh --arch x64      macOS: Intel
#
# Needs: uv, pnpm, node + npm. Windows: use scripts/build-desktop.ps1. Each system's installer is
# built on that system (PyInstaller can't cross-build); CI does all of them from a version tag.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
unpacked=0
arch=""
while [ $# -gt 0 ]; do
  case "$1" in
    --unpacked) unpacked=1 ;;
    --arch) arch="${2:?--arch needs x64 or arm64}"; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

for tool in uv pnpm node npm; do
  command -v "$tool" >/dev/null || { echo "build-desktop: '$tool' is not installed" >&2; exit 1; }
done

step() { printf '\n==> %s\n' "$*"; }

step "1/3 frontend"
(cd "$root/frontend" && pnpm install --frozen-lockfile && pnpm run build && pnpm run check:no-demo)

step "2/3 backend (PyInstaller onedir) + smoke test"
(
  cd "$root/backend"
  uv sync --frozen --group packaging
  uv run --frozen pyinstaller --noconfirm --clean packaging/unihelper-backend.spec
  uv run --frozen python -m unihelper.desktop.smoke dist/unihelper-backend
)

step "3/3 desktop app"
builder_args=(--publish never)
[ "$unpacked" = 1 ] && builder_args+=(--dir)
case "$arch" in
  "") ;;
  x64|arm64) builder_args+=("--$arch") ;;
  *) echo "build-desktop: --arch must be x64 or arm64" >&2; exit 2 ;;
esac
(cd "$root/desktop" && npm ci && npm run build && npx electron-builder "${builder_args[@]}")

step "done: $root/desktop/release"
find "$root/desktop/release" -maxdepth 1 \( -name '*.AppImage' -o -name '*.deb' -o -name '*.dmg' -o -name '*-unpacked' -o -name 'mac*' \) -print
