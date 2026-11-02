#!/usr/bin/env bash
# Start UniHelperProMax after ./install.sh (Linux and macOS).
#
# Environment variables (all optional):
#   UNIHELPER_DATA_DIR    where notes, PDFs, recordings and the database live (default backend/data)
#   UNIHELPER_HOST        address to listen on (default 127.0.0.1; 0.0.0.0 for your whole network)
#   UNIHELPER_PORT        port (default 8000; if taken, the next free one is used)

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ -f "$ROOT/frontend/dist/index.html" ] || { echo "The app isn't built yet. Run ./install.sh first." >&2; exit 1; }
command -v uv >/dev/null 2>&1 || PATH="$HOME/.local/bin:$PATH"

export UNIHELPER_DATA_DIR="${UNIHELPER_DATA_DIR:-$ROOT/backend/data}"
export UNIHELPER_STATIC_DIR="$ROOT/frontend/dist"
host="${UNIHELPER_HOST:-127.0.0.1}"
port="${UNIHELPER_PORT:-8000}"
mkdir -p "$UNIHELPER_DATA_DIR"
# Another program answers on this port: try the next one.
while (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; do port=$((port + 1)); done

echo "UniHelperProMax on http://localhost:${port}  (data: $UNIHELPER_DATA_DIR, Ctrl+C to stop)"
cd "$ROOT/backend"
# A single process on purpose: never add --workers.
exec uv run --no-sync uvicorn unihelper.main:app --host "$host" --port "$port"
