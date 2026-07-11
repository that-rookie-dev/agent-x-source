#!/usr/bin/env bash
# Hot-reload web-api / web-ui / web-neuron into the unpacked dev .app (no electron rebuild).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_RES="$ROOT_DIR/packages/desktop/release/mac-arm64/Agent-X.app/Contents/Resources"

if [[ ! -d "$APP_RES" ]]; then
  echo "Unpacked app not found. Run ./scripts/dev-desktop.sh first." >&2
  exit 1
fi

echo ">>> Building web-api, web-ui, web-neuron..."
cd "$ROOT_DIR"
pnpm --filter @agentx/canvas run build
pnpm --filter @agentx/engine run build
pnpm --filter @agentx/web-api run build
pnpm --filter @agentx/web-ui run build
pnpm --filter @agentx/web-neuron run build

echo ">>> Syncing into $APP_RES"
rsync -a --delete "$ROOT_DIR/packages/web-api/dist/" "$APP_RES/web-api/"
rsync -a --delete "$ROOT_DIR/packages/web-ui/dist/" "$APP_RES/web-ui/"
rsync -a --delete "$ROOT_DIR/packages/web-neuron/dist/" "$APP_RES/web-neuron/"

echo ">>> Reload the Agent-X window (Cmd+R) or restart the app to pick up changes."
