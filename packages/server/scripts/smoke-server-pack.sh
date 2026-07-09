#!/usr/bin/env bash
# Smoke-test a packed Agent-X server tarball on the current host.
# Usage: smoke-server-pack.sh <tarball-path> [port]
#
# Verifies: extract → start → /api/health → Web UI HTML → stop.
# Designed for GitHub Actions release matrix (all 5 server platforms).

set -euo pipefail

TARBALL="${1:?Usage: $0 <tarball-path> [port]}"
PORT="${2:-3333}"

if [ ! -f "$TARBALL" ]; then
  echo "Tarball not found: $TARBALL" >&2
  exit 1
fi

SMOKE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agentx-smoke.XXXXXX")"
INSTALL_DIR="${SMOKE_DIR}/install"
DATA_DIR="${SMOKE_DIR}/data"
LOG_FILE="${DATA_DIR}/logs/agentx.log"
PID_FILE="${DATA_DIR}/agentx.pid"

is_windows() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*|Windows_NT) return 0 ;;
    *) return 1 ;;
  esac
}

stop_server() {
  if ! is_windows && [ -x "${INSTALL_DIR}/agentx" ]; then
    AGENTX_INSTALL_DIR="$INSTALL_DIR" AGENTX_DATA_DIR="$DATA_DIR" AGENTX_PORT="$PORT" \
      "${INSTALL_DIR}/agentx" stop >/dev/null 2>&1 || true
    return 0
  fi
  if [ -f "$PID_FILE" ]; then
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "${pid:-}" ]; then
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi
}

cleanup() {
  stop_server
  rm -rf "$SMOKE_DIR"
}
trap cleanup EXIT

mkdir -p "$INSTALL_DIR" "$DATA_DIR/logs"
echo "==> Extracting $(basename "$TARBALL") into $INSTALL_DIR"
tar -xzf "$TARBALL" -C "$INSTALL_DIR"

if [ ! -f "${INSTALL_DIR}/index.js" ]; then
  echo "Missing index.js in tarball" >&2
  exit 1
fi

# Fail fast on incomplete embedded Postgres trees (the packaging bugs we hit).
os="$(uname -s)"
arch="$(uname -m)"
case "${os}-${arch}" in
  Linux-x86_64|Linux-amd64)
    test -f "${INSTALL_DIR}/node_modules/@embedded-postgres/linux-x64/native/lib/libpq.so.5"
    ;;
  Linux-aarch64|Linux-arm64)
    test -f "${INSTALL_DIR}/node_modules/@embedded-postgres/linux-arm64/native/lib/libpq.so.5"
    ;;
  Darwin-arm64)
    test -f "${INSTALL_DIR}/node_modules/@embedded-postgres/darwin-arm64/native/lib/libicudata.68.dylib"
    test -f "${INSTALL_DIR}/node_modules/@embedded-postgres/darwin-arm64/native/lib/libpq.5.dylib"
    ;;
  Darwin-x86_64)
    test -f "${INSTALL_DIR}/node_modules/@embedded-postgres/darwin-x64/native/lib/libicudata.68.dylib"
    test -f "${INSTALL_DIR}/node_modules/@embedded-postgres/darwin-x64/native/lib/libpq.5.dylib"
    ;;
  *)
    if is_windows; then
      test -f "${INSTALL_DIR}/node_modules/@embedded-postgres/windows-x64/native/bin/libpq.dll"
    fi
    ;;
esac
echo "==> Embedded Postgres shared libraries present"

export AGENTX_INSTALL_DIR="$INSTALL_DIR"
export AGENTX_DATA_DIR="$DATA_DIR"
export AGENTX_PORT="$PORT"
export AGENTX_HOST="127.0.0.1"

dump_log() {
  echo "---- agentx.log ----" >&2
  if [ -f "$LOG_FILE" ]; then
    cat "$LOG_FILE" >&2 || true
  else
    echo "(log file missing: $LOG_FILE)" >&2
  fi
}

echo "==> Starting Agent-X server on port $PORT"
if ! is_windows && [ -x "${INSTALL_DIR}/agentx" ]; then
  if ! "${INSTALL_DIR}/agentx" start; then
    dump_log
    exit 1
  fi
else
  # Windows pack ships agentx.cmd (node passthrough), not the bash CLI.
  (
    cd "$INSTALL_DIR"
    nohup node index.js >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
  )
  sleep 3
  if [ ! -f "$PID_FILE" ] || ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Server process failed to start" >&2
    dump_log
    exit 1
  fi
fi

echo "==> Waiting for /api/health"
ok=0
i=0
while [ "$i" -lt 60 ]; do
  i=$((i + 1))
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/tmp/agentx-health.json 2>/dev/null; then
    ok=1
    break
  fi
  sleep 2
done

if [ "$ok" != "1" ]; then
  echo "Health check failed after ~120s" >&2
  dump_log
  exit 1
fi
echo "Health OK: $(tr -d '\n' </tmp/agentx-health.json | head -c 200)"

echo "==> Fetching Web UI"
ui="$(curl -fsS "http://127.0.0.1:${PORT}/")"
case "$ui" in
  *'<html'*|*'<!DOCTYPE'*|*'<!doctype'*)
    echo "Web UI HTML OK ($(printf '%s' "$ui" | wc -c | tr -d ' ') bytes)"
    ;;
  *)
    echo "Web UI response did not look like HTML:" >&2
    printf '%s\n' "$ui" | head -c 500 >&2
    echo >&2
    exit 1
    ;;
esac

echo "==> Stopping server"
stop_server

echo "==> Smoke test passed for $(basename "$TARBALL")"
