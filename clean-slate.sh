#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$ROOT_DIR/packages/desktop"
CREDENTIALS_FILE="$ROOT_DIR/../credentials.env"

# Load credentials early if available (PG targets, optional AGENTX_DATA_DIR override).
# This file is intentionally outside the source folder and is therefore optional.
if [ -f "$CREDENTIALS_FILE" ]; then
  # shellcheck disable=SC1091
  source "$CREDENTIALS_FILE"
  echo "Loaded credentials from $CREDENTIALS_FILE"
else
  echo "No credentials.env found outside source folder; using defaults and skipping external PG wipe."
fi

echo "=== Clean Slate: Agent-X ==="
echo "Root dir: $ROOT_DIR"

# ── 1. Stop all Agent-X / Electron / web-api processes ────────────────────────
echo ">>> Stopping Agent-X processes..."

stop_agentx() {
  pkill -9 -f "Agent-X" 2>/dev/null || true
  pkill -9 -f "com.agentx.desktop" 2>/dev/null || true
  pkill -9 -f "@agentx/desktop" 2>/dev/null || true
  pkill -9 -f "agentx/web-api" 2>/dev/null || true
  pkill -9 -f "packages/web-api/dist/index" 2>/dev/null || true

  # Embedded web-api listens on 3333; embedded PostgreSQL listens on 3335
  if command -v lsof >/dev/null 2>&1; then
    for port in 3333 3335; do
      lsof -ti:"$port" 2>/dev/null | xargs kill -9 2>/dev/null || true
    done
  fi
}

stop_agentx
sleep 2
stop_agentx
sleep 1

# ── 2. Remove installed app ───────────────────────────────────────────────────
echo ">>> Removing /Applications/Agent-X.app..."
sudo rm -rf /Applications/Agent-X.app 2>/dev/null || true

# ── 3. Wipe all local Agent-X state (config, auth, sessions, cache) ─
echo ">>> Wiping local Agent-X data (config, auth, sessions, cache)..."

wipe_path() {
  local target="$1"
  if [ -e "$target" ] || [ -L "$target" ]; then
    echo "    rm -rf $target"
    rm -rf "$target" 2>/dev/null || true
    # Retry once after clearing Electron singleton locks
    if [ -e "$target" ]; then
      rm -rf "$target" 2>/dev/null || true
    fi
  fi
}

# Matches @agentx/shared platform.ts defaults + Electron desktop paths on macOS
AGENTX_DIRS=(
  # XDG-style (used by web-api / engine on macOS and Linux)
  "$HOME/.config/agentx"
  "$HOME/.local/share/agentx"
  "$HOME/.cache/agentx"
  # macOS Electron userData / caches (appId: com.agentx.desktop, productName: Agent-X)
  "$HOME/Library/Application Support/@agentx"
  "$HOME/Library/Application Support/Agent-X"
  "$HOME/Library/Application Support/agentx"
  "$HOME/Library/Application Support/com.agentx.desktop"
  "$HOME/Library/Caches/agentx"
  "$HOME/Library/Caches/com.agentx.desktop"
  "$HOME/Library/Caches/com.agentxdesktop.ShipIt"
  "$HOME/Library/Caches/@agentxdesktop-updater"
  "$HOME/Library/HTTPStorages/com.agentx.desktop"
  "$HOME/Library/Logs/Agent-X"
  "$HOME/Library/Logs/agentx"
  "$HOME/Library/Saved Application State/com.agentx.desktop.savedState"
)

# Explicit env overrides
if [ -n "${XDG_CONFIG_HOME:-}" ]; then AGENTX_DIRS+=("$XDG_CONFIG_HOME/agentx"); fi
if [ -n "${XDG_DATA_HOME:-}" ]; then AGENTX_DIRS+=("$XDG_DATA_HOME/agentx"); fi
if [ -n "${XDG_CACHE_HOME:-}" ]; then AGENTX_DIRS+=("$XDG_CACHE_HOME/agentx"); fi
if [ -n "${AGENTX_DATA_DIR:-}" ]; then AGENTX_DIRS+=("$AGENTX_DATA_DIR"); fi

# macOS preferences plist (not a directory)
AGENTX_FILES=(
  "$HOME/Library/Preferences/com.agentx.desktop.plist"
)

# Dev workspace session dirs (GitManager / TaskExecutor use .agentx under cwd)
if [ -d "$ROOT_DIR/.agentx" ]; then AGENTX_DIRS+=("$ROOT_DIR/.agentx"); fi
if [ -d "$ROOT_DIR/../.agentx" ]; then AGENTX_DIRS+=("$ROOT_DIR/../.agentx"); fi

# Drop Electron singleton locks first so rm -rf can succeed while stale locks remain
for lock in \
  "$HOME/Library/Application Support/@agentx/desktop/SingletonLock" \
  "$HOME/Library/Application Support/@agentx/desktop/SingletonSocket" \
  "$HOME/Library/Application Support/@agentx/desktop/SingletonCookie" \
  "$HOME/Library/Application Support/Agent-X/SingletonLock" \
  "$HOME/Library/Application Support/Agent-X/SingletonSocket" \
  "$HOME/Library/Application Support/Agent-X/SingletonCookie"; do
  [ -e "$lock" ] && rm -f "$lock" 2>/dev/null || true
done

# De-duplicate directory list
deduped_dirs=()
for dir in "${AGENTX_DIRS[@]}"; do
  already=0
  for seen in "${deduped_dirs[@]:-}"; do
    if [ "$seen" = "$dir" ]; then already=1; break; fi
  done
  if [ "$already" -eq 0 ]; then deduped_dirs+=("$dir"); fi
done

for dir in "${deduped_dirs[@]}"; do
  wipe_path "$dir"
done

for f in "${AGENTX_FILES[@]}"; do
  [ -e "$f" ] && echo "    rm -f $f" && rm -f "$f" 2>/dev/null || true
done

# Fallback: remove any stray legacy SQLite sidecars under known Agent-X roots
echo ">>> Sweeping legacy Agent-X SQLite files..."
for root in "${deduped_dirs[@]}"; do
  if [ -d "$root" ]; then
    find "$root" \( -name '*.db' -o -name '*.db-wal' -o -name '*.db-shm' -o -name '*.sqlite' -o -name '*.sqlite3' \) -print -delete 2>/dev/null || true
    # Remove parent dir if find left an empty tree
    rm -rf "$root" 2>/dev/null || true
  fi
done

# Verify key paths are gone (warn if something survived — usually a live process)
VERIFY_PATHS=(
  "$HOME/.config/agentx/config.enc.json"
)
survivors=0
for p in "${VERIFY_PATHS[@]}"; do
  if [ -e "$p" ]; then
    echo "    WARNING: still present after wipe: $p"
    survivors=$((survivors + 1))
  fi
done
if [ "$survivors" -gt 0 ]; then
  echo "    WARNING: $survivors path(s) survived. Ensure Agent-X is fully quit and re-run."
else
  echo "    Local wipe verified (no core config files remain)."
fi

# ── 3b. Wipe PostgreSQL (drops every table/view/sequence in public schema) ───
echo ">>> Wiping PostgreSQL (public schema)..."

PG_TARGETS=()
if [ -n "${PG_CONN_STRING:-}" ]; then
  PG_TARGETS+=("$PG_CONN_STRING")
fi
if [ -n "${PG_CONN_STRING_LOCAL:-}" ]; then
  PG_TARGETS+=("$PG_CONN_STRING_LOCAL")
fi
# Opt-in only: set PG_WIPE_SUPABASE=1 to also wipe remote Supabase
if [ "${PG_WIPE_SUPABASE:-0}" = "1" ] && [ -n "${PG_CONN_STRING_SUPABASE:-}" ]; then
  PG_TARGETS+=("$PG_CONN_STRING_SUPABASE")
fi
if [ "${#PG_TARGETS[@]}" -eq 0 ]; then
  PG_TARGETS+=("postgresql://admin:admin@localhost:5432/agentx")
fi

deduped_pg_targets=()
for conn in "${PG_TARGETS[@]}"; do
  already=0
  for seen in "${deduped_pg_targets[@]:-}"; do
    if [ "$seen" = "$conn" ]; then already=1; break; fi
  done
  if [ "$already" -eq 0 ]; then deduped_pg_targets+=("$conn"); fi
done

cd "$ROOT_DIR/packages/engine"
pg_failures=0
for PG_CONN in "${deduped_pg_targets[@]}"; do
  echo "    wiping $(echo "$PG_CONN" | sed -E 's#://([^:]+):([^@]+)@#://\1:***@#')"
  if ! PG_CONN="$PG_CONN" node -e "
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
  "; then
    pg_failures=$((pg_failures + 1))
    echo "    WARNING: PG wipe failed for one target (continuing)."
  fi
done
if [ "$pg_failures" -gt 0 ]; then
  echo "    WARNING: $pg_failures PostgreSQL target(s) failed to wipe."
fi

# ── 4. Clean previous release artifacts ─────────────────────────────────────
echo ">>> Cleaning previous desktop build artifacts..."
cd "$DESKTOP_DIR"
rm -rf dist release

# ── 4b. Clean all package dist folders (so the fresh build has no stale code) ─
echo ">>> Cleaning all package dist/ outputs..."
cd "$ROOT_DIR"
for pkg in shared engine web-api web-ui web-neuron desktop; do
  rm -rf "packages/$pkg/dist" 2>/dev/null || true
done

# Remove any leftover bundled web-api/web-ui directories inside the desktop package
rm -rf "$DESKTOP_DIR/web-api" "$DESKTOP_DIR/web-ui" 2>/dev/null || true

# ── 5. Clean node_modules caches and ensure .env is present ─────────────────
echo ">>> Cleaning package-manager caches..."
pnpm store prune 2>/dev/null || true
rm -rf node_modules/.cache 2>/dev/null || true

# Ensure a .env file exists from the committed template (safe for fresh builds)
if [ ! -f "$ROOT_DIR/.env" ]; then
  echo ">>> Creating .env from .env.example..."
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
fi

# ── 6. Build dependencies in topological order (shared -> engine -> web-api) ─
echo ">>> Building dependencies in topological order..."
cd "$ROOT_DIR"
pnpm --filter @agentx/shared run build
pnpm --filter @agentx/engine run build
pnpm --filter @agentx/web-api run build
pnpm --filter @agentx/web-ui run build
pnpm --filter @agentx/web-neuron run build

# ── 6b. Build and install PostgreSQL extensions (pgvector + Apache AGE) ──────
echo ">>> Building PostgreSQL extensions (pgvector + AGE)..."
cd "$DESKTOP_DIR"
pnpm run setup:extensions || echo "WARNING: Extension build failed — app will fall back to relational CTE graph engine."
cd "$ROOT_DIR"

# ── 7. Typecheck all packages (after declarations are available) ─────────────
echo ">>> Typechecking all packages..."
pnpm -r run typecheck

# ── 8. Build desktop app (unpacked .app) ────────────────────────────────────
echo ">>> Building desktop app..."
cd "$DESKTOP_DIR"
pnpm run build
pnpm exec electron-builder --mac --dir

# ── 9. Copy to /Applications ─────────────────────────────────────────────────
echo ">>> Installing to /Applications (password prompt may appear)..."
osascript -e "do shell script \"rm -rf /Applications/Agent-X.app && cp -R '$DESKTOP_DIR/release/mac-arm64/Agent-X.app' /Applications/\" with administrator privileges"

# ── 10. Launch (creates fresh config + bundled native PostgreSQL on first run) ─
echo ">>> Launching Agent-X..."
echo "    Note: a fresh config is created on first launch; the bundled native PostgreSQL starts on port 3335."
open /Applications/Agent-X.app

echo "=== Clean slate done! ==="
