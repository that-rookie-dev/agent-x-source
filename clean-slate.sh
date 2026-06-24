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

# 3. Wipe all local SQLite state (config, data, cache, WAL/SHM sidecars)
echo ">>> Wiping SQLite databases and Agent-X data directories..."

wipe_path() {
  local target="$1"
  if [ -e "$target" ]; then
    echo "    rm -rf $target"
    rm -rf "$target"
  fi
}

wipe_file() {
  local target="$1"
  if [ -f "$target" ] || [ -e "$target" ]; then
    echo "    rm -f $target"
    rm -f "$target" 2>/dev/null || true
  fi
}

# Standard XDG / macOS paths used by @agentx/shared platform helpers
AGENTX_DIRS=(
  "$HOME/.config/agentx"
  "$HOME/.local/share/agentx"
  "$HOME/.cache/agentx"
  "$HOME/Library/Application Support/@agentx"
  "$HOME/Library/Application Support/Agent-X"
  "$HOME/Library/Application Support/agentx"
  "$HOME/Library/Caches/agentx"
)

# Respect explicit overrides when set in the shell environment
if [ -n "${XDG_CONFIG_HOME:-}" ]; then AGENTX_DIRS+=("$XDG_CONFIG_HOME/agentx"); fi
if [ -n "${XDG_DATA_HOME:-}" ]; then AGENTX_DIRS+=("$XDG_DATA_HOME/agentx"); fi
if [ -n "${XDG_CACHE_HOME:-}" ]; then AGENTX_DIRS+=("$XDG_CACHE_HOME/agentx"); fi
if [ -n "${AGENTX_DATA_DIR:-}" ]; then AGENTX_DIRS+=("$AGENTX_DATA_DIR"); fi

for dir in "${AGENTX_DIRS[@]}"; do
  wipe_path "$dir"
done

# Explicit SQLite files (main session DB, neural DB, WAL/SHM journals)
AGENTX_DB_FILES=(
  "$HOME/.local/share/agentx/db/agentx.db"
  "$HOME/.local/share/agentx/db/agentx.db-wal"
  "$HOME/.local/share/agentx/db/agentx.db-shm"
  "$HOME/.config/agentx/neural.db"
  "$HOME/.config/agentx/neural.db-wal"
  "$HOME/.config/agentx/neural.db-shm"
)

if [ -n "${XDG_DATA_HOME:-}" ]; then
  AGENTX_DB_FILES+=(
    "$XDG_DATA_HOME/agentx/db/agentx.db"
    "$XDG_DATA_HOME/agentx/db/agentx.db-wal"
    "$XDG_DATA_HOME/agentx/db/agentx.db-shm"
  )
fi
if [ -n "${XDG_CONFIG_HOME:-}" ]; then
  AGENTX_DB_FILES+=(
    "$XDG_CONFIG_HOME/agentx/neural.db"
    "$XDG_CONFIG_HOME/agentx/neural.db-wal"
    "$XDG_CONFIG_HOME/agentx/neural.db-shm"
  )
fi

for db_file in "${AGENTX_DB_FILES[@]}"; do
  wipe_file "$db_file"
done

# 3b. Wipe PostgreSQL (drops every table/view/sequence in public schema)
echo ">>> Wiping PostgreSQL (public schema)..."

PG_TARGETS=()
if [ -n "${PG_CONN_STRING:-}" ]; then
  PG_TARGETS+=("$PG_CONN_STRING")
fi
if [ -f "$ROOT_DIR/../credentials.env" ]; then
  # shellcheck disable=SC1091
  source "$ROOT_DIR/../credentials.env"
  if [ -n "${PG_CONN_STRING_LOCAL:-}" ]; then
    PG_TARGETS+=("$PG_CONN_STRING_LOCAL")
  fi
  # Opt-in only: set PG_WIPE_SUPABASE=1 to also wipe remote Supabase
  if [ "${PG_WIPE_SUPABASE:-0}" = "1" ] && [ -n "${PG_CONN_STRING_SUPABASE:-}" ]; then
    PG_TARGETS+=("$PG_CONN_STRING_SUPABASE")
  fi
fi
if [ "${#PG_TARGETS[@]}" -eq 0 ]; then
  PG_TARGETS+=("postgresql://admin:admin@localhost:5432/agentx")
fi

# De-duplicate connection strings while preserving order
deduped_pg_targets=()
for conn in "${PG_TARGETS[@]}"; do
  already=0
  for seen in "${deduped_pg_targets[@]:-}"; do
    if [ "$seen" = "$conn" ]; then already=1; break; fi
  done
  if [ "$already" -eq 0 ]; then deduped_pg_targets+=("$conn"); fi
done

cd "$ROOT_DIR/packages/engine"
for PG_CONN in "${deduped_pg_targets[@]}"; do
  echo "    wiping $(echo "$PG_CONN" | sed -E 's#://([^:]+):([^@]+)@#://\1:***@#')"
  PG_CONN="$PG_CONN" node -e "
    const { Pool } = require('pg');

    function redact(url) {
      return url.replace(/:\\/\\/([^:]+):([^@]+)@/, '://\$1:***@');
    }

    async function wipePublicSchema() {
      const connectionString = process.env.PG_CONN;
      const pool = new Pool({ connectionString, max: 1 });
      const client = await pool.connect();
      try {
        const before = await client.query(
          \"SELECT COUNT(*)::int AS c FROM pg_tables WHERE schemaname = 'public'\"
        );
        await client.query('DROP SCHEMA IF EXISTS public CASCADE');
        await client.query('CREATE SCHEMA public');
        await client.query('GRANT ALL ON SCHEMA public TO public');
        try {
          await client.query('GRANT ALL ON SCHEMA public TO CURRENT_USER');
        } catch { /* role may already own schema */ }
        const after = await client.query(
          \"SELECT COUNT(*)::int AS c FROM pg_tables WHERE schemaname = 'public'\"
        );
        console.log(
          'PG wiped',
          redact(connectionString),
          '(' + before.rows[0].c + ' tables -> ' + after.rows[0].c + ')'
        );
      } finally {
        client.release();
        await pool.end();
      }
    }

    wipePublicSchema().then(() => process.exit(0)).catch((e) => {
      console.error('PG wipe failed for', redact(process.env.PG_CONN), '-', e.message);
      process.exit(1);
    });
  "
done

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
