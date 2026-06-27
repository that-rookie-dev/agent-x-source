#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$ROOT_DIR/packages/desktop"

echo "=== Clean Install: Agent-X ==="

# 1. Kill running app
echo ">>> Killing Agent-X if running..."
pkill -9 -f "Agent-X" 2>/dev/null || true
sleep 1

# 2. Remove from /Applications
echo ">>> Removing /Applications/Agent-X.app..."
sudo rm -rf /Applications/Agent-X.app 2>/dev/null || true

# 3. Clear cache only (preserve config, data, and databases)
echo ">>> Clearing cache..."
rm -rf "$HOME/.cache/agentx"
rm -rf "$HOME/Library/Application Support/@agentx"

# 4. Clean reinstall dependencies (fixes broken pnpm links like missing resolve-from/nanoid)
echo ">>> Reinstalling dependencies (clean node_modules)..."
cd "$ROOT_DIR"
rm -rf node_modules packages/*/node_modules
pnpm install --no-frozen-lockfile

# 5. Clean previous build artifacts
echo ">>> Cleaning previous desktop build artifacts..."
cd "$DESKTOP_DIR"
rm -rf dist release

# 6. Build dependencies
echo ">>> Building shared, engine, web-api, web-ui, and web-neuron..."
cd "$ROOT_DIR"
pnpm --filter @agentx/shared run build
pnpm --filter @agentx/engine run build
pnpm --filter @agentx/web-api run build
pnpm --filter @agentx/web-ui run build
pnpm --filter @agentx/web-neuron run build

# 7. Build desktop app (unpacked .app)
echo ">>> Building desktop app..."
cd "$DESKTOP_DIR"
pnpm run build
pnpm exec electron-builder --mac --dir

# 8. Copy to /Applications
echo ">>> Installing to /Applications (password prompt may appear)..."
osascript -e "do shell script \"rm -rf /Applications/Agent-X.app && cp -R '$DESKTOP_DIR/release/mac-arm64/Agent-X.app' /Applications/\" with administrator privileges"

# 9. Launch
echo ">>> Launching Agent-X..."
open /Applications/Agent-X.app

echo "=== Clean install done! ==="
