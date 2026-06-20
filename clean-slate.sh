#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$ROOT_DIR/packages/desktop"

echo "=== Clean Slate: Agent-X ==="

# 1. Kill running app (force-quit everything including helpers)
echo ">>> Killing Agent-X if running..."
pkill -9 -f "Agent-X" 2>/dev/null || true
sleep 1

# 2. Remove from /Applications
echo ">>> Removing /Applications/Agent-X.app..."
sudo rm -rf /Applications/Agent-X.app 2>/dev/null || true

# 3. Remove SQLite DB files first, then data directories
echo ">>> Removing agentx config/data/cache..."
rm -f "$HOME/.local/share/agentx/db/agentx.db" 2>/dev/null || true
rm -f "$HOME/.local/share/agentx/db/agentx.db-wal" 2>/dev/null || true
rm -f "$HOME/.local/share/agentx/db/agentx.db-shm" 2>/dev/null || true
rm -rf "$HOME/.config/agentx"
rm -rf "$HOME/.local/share/agentx"
rm -rf "$HOME/.cache/agentx"
rm -rf "$HOME/Library/Application Support/@agentx"

# 3b. Clear PostgreSQL tables (hardcoded local dev connection)
echo ">>> Clearing PostgreSQL tables..."
cd "$ROOT_DIR/packages/engine"
node -e "
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: 'postgresql://admin:admin@localhost:5432/agentx' });
  pool.query(\`
    DROP TABLE IF EXISTS agent_persona CASCADE;
    DROP TABLE IF EXISTS crew_feedback CASCADE;
    DROP TABLE IF EXISTS session_crew_states CASCADE;
    DROP TABLE IF EXISTS agent_tasks CASCADE;
    DROP TABLE IF EXISTS permission_rules CASCADE;
    DROP TABLE IF EXISTS session_events CASCADE;
    DROP TABLE IF EXISTS tool_executions CASCADE;
    DROP TABLE IF EXISTS checkpoints CASCADE;
    DROP TABLE IF EXISTS permissions CASCADE;
    DROP TABLE IF EXISTS token_logs CASCADE;
    DROP TABLE IF EXISTS message_parts CASCADE;
    DROP TABLE IF EXISTS messages CASCADE;
    DROP TABLE IF EXISTS crews CASCADE;
    DROP TABLE IF EXISTS sessions CASCADE;
  \`).then(() => { console.log('PG tables cleared'); process.exit(0); }).catch(e => { console.error('PG clear failed:', e.message); process.exit(1); });
" || true

# 4. Clean previous release artifacts
echo ">>> Cleaning previous desktop build artifacts..."
cd "$DESKTOP_DIR"
rm -rf dist release

# 5. Build dependencies
echo ">>> Building shared, web-api, and web-ui..."
pnpm --filter @agentx/shared run build
pnpm --filter @agentx/engine run build
pnpm --filter @agentx/web-api run build
pnpm --filter @agentx/web-ui run build

# 6. Build desktop app (unpacked .app)
echo ">>> Building desktop app..."
npm run build
pnpm exec electron-rebuild -f -w better-sqlite3 -m ../web-api
npx electron-builder --mac --dir

# 7. Copy to /Applications (uses osascript to prompt for password)
echo ">>> Installing to /Applications (password prompt may appear)..."
osascript -e "do shell script \"rm -rf /Applications/Agent-X.app && cp -R '$DESKTOP_DIR/release/mac-arm64/Agent-X.app' /Applications/\" with administrator privileges"

# 8. Launch
echo ">>> Launching Agent-X..."
open /Applications/Agent-X.app

echo "=== Clean slate done! ==="
