#!/usr/bin/env bash
# Fast dev loop for Agent-X desktop — builds deps, packs an unpacked .app, and launches it.
# Use scripts/sync-desktop.sh to hot-reload web-api/web-ui without a full repack.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/packages/desktop"
APP_PATH="$DESKTOP_DIR/release/mac-arm64/Agent-X.app"
APP_RES="$APP_PATH/Contents/Resources"

echo "=== Agent-X dev desktop ==="

echo ">>> Stopping any running Agent-X instance..."
pkill -9 -f "Agent-X.app/Contents/MacOS/Agent-X" 2>/dev/null || true
pkill -9 -f "release/mac-arm64/Agent-X.app" 2>/dev/null || true
sleep 1

echo ">>> Building shared, engine, web-api, web-ui, web-neuron..."
cd "$ROOT_DIR"
pnpm --filter @agentx/shared run build
pnpm --filter @agentx/canvas run build
pnpm --filter @agentx/engine run build
pnpm --filter @agentx/web-api run build
pnpm --filter @agentx/web-ui run build
pnpm --filter @agentx/web-neuron run build

echo ">>> Building desktop main/preload..."
cd "$DESKTOP_DIR"
pnpm run build

echo ">>> Packing unpacked desktop app (electron-builder --dir)..."
pnpm exec electron-builder --mac --dir

echo ">>> Syncing latest web assets into .app Resources..."
rsync -a --delete "$ROOT_DIR/packages/web-api/dist/" "$APP_RES/web-api/"
rsync -a --delete "$ROOT_DIR/packages/web-ui/dist/" "$APP_RES/web-ui/"
rsync -a --delete "$ROOT_DIR/packages/web-neuron/dist/" "$APP_RES/web-neuron/"

echo ">>> Removing Gatekeeper quarantine (if present)..."
xattr -dr com.apple.quarantine "$APP_PATH" 2>/dev/null || true

echo ">>> Launching $APP_PATH"
open -n "$APP_PATH"

echo "=== Dev desktop launched. API: http://127.0.0.1:3333 ==="
echo "Tip: after UI/API-only edits, run: ./scripts/sync-desktop.sh"
