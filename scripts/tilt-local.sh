#!/usr/bin/env bash
# Run TiLT in your normal web browser on THIS computer (Linux/macOS).
# Builds what is missing, starts the local-only server (127.0.0.1) and opens the private link.
#   scripts/tilt-local.sh [--port N] [--root <storage dir>] [--no-open]
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f apps/desktop/dist/index.html ]; then
  (cd apps/desktop && npm ci && npm run build)
fi
cargo build --release -p tilt-local
exec ./target/release/tilt-local --ui apps/desktop/dist "$@"
