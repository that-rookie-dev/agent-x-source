#!/usr/bin/env bash
# Agent-X server CLI — start / stop / status for headless server mode.
# Installed to $INSTALL_DIR/agentx by pack-server.mjs.

set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${AGENTX_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/agentx}"
LOG_DIR="${DATA_DIR}/logs"
PID_FILE="${DATA_DIR}/agentx.pid"
PORT="${AGENTX_PORT:-3333}"
INDEX_JS="${INSTALL_DIR}/index.js"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"
# Cold embedded Postgres init can take a while on first boot.
START_TIMEOUT_SECS="${AGENTX_START_TIMEOUT_SECS:-180}"

mkdir -p "$LOG_DIR"

set_embedded_pg_lib_path() {
  local os arch pkg lib_dir pg_lib
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Linux)
      case "$arch" in
        aarch64|arm64) pkg="linux-arm64" ;;
        x86_64|amd64) pkg="linux-x64" ;;
        *) return 0 ;;
      esac
      lib_dir="${INSTALL_DIR}/node_modules/@embedded-postgres/${pkg}/native/lib"
      if [ -d "$lib_dir" ]; then
        export LD_LIBRARY_PATH="${lib_dir}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
      fi
      ;;
    Darwin)
      case "$arch" in
        arm64) pkg="darwin-arm64" ;;
        x86_64) pkg="darwin-x64" ;;
        *) return 0 ;;
      esac
      lib_dir="${INSTALL_DIR}/node_modules/@embedded-postgres/${pkg}/native/lib"
      pg_lib="${lib_dir}/postgresql"
      if [ -d "$lib_dir" ]; then
        export DYLD_LIBRARY_PATH="${lib_dir}${DYLD_LIBRARY_PATH:+:${DYLD_LIBRARY_PATH}}"
      fi
      if [ -d "$pg_lib" ]; then
        export DYLD_LIBRARY_PATH="${pg_lib}:${DYLD_LIBRARY_PATH:-}"
      fi
      ;;
  esac
}

log() {
  printf '[%s] %s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$1"
}

is_running() {
  if [ ! -f "$PID_FILE" ]; then
    return 1
  fi
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -z "$pid" ]; then
    return 1
  fi
  kill -0 "$pid" 2>/dev/null
}

health_ok() {
  if command -v curl >/dev/null 2>&1; then
    curl -sf "$HEALTH_URL" >/dev/null 2>&1
    return $?
  fi
  # Fallback when curl is unavailable: TCP connect to the listen port.
  if command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1
    return $?
  fi
  return 1
}

print_startup_log_tail() {
  if [ -f "${LOG_DIR}/agentx.log" ]; then
    # Show recent startup lines without drowning the terminal.
    tail -n 8 "${LOG_DIR}/agentx.log" 2>/dev/null | sed 's/^/  | /' || true
  fi
}

cmd_start() {
  if is_running; then
    if health_ok; then
      echo "Agent-X server is already running (pid $(cat "$PID_FILE"))."
      echo "Agent is active at http://127.0.0.1:${PORT}"
      exit 0
    fi
    echo "Agent-X process is alive but not healthy yet (pid $(cat "$PID_FILE"))."
    echo "Logs: ${LOG_DIR}/agentx.log"
    exit 0
  fi

  if [ ! -f "$INDEX_JS" ]; then
    echo "Missing server entry at $INDEX_JS" >&2
    exit 1
  fi

  export AGENTX_INSTALL_DIR="$INSTALL_DIR"
  export AGENTX_DATA_DIR="$DATA_DIR"
  set_embedded_pg_lib_path

  # Truncate previous run noise so the live tail is useful.
  : > "${LOG_DIR}/agentx.log"

  log "Starting Agent-X server…"
  echo "  install: ${INSTALL_DIR}"
  echo "  data:    ${DATA_DIR}"
  echo "  port:    ${PORT}"
  echo "  logs:    ${LOG_DIR}/agentx.log"
  echo

  nohup node "$INDEX_JS" >> "${LOG_DIR}/agentx.log" 2>&1 &
  echo $! > "$PID_FILE"

  local i=0
  local last_size=0
  local size
  while [ "$i" -lt "$START_TIMEOUT_SECS" ]; do
    if ! is_running && [ "$i" -ge 2 ]; then
      echo
      echo "Agent-X server failed to start. See ${LOG_DIR}/agentx.log" >&2
      echo "---- agentx.log ----" >&2
      cat "${LOG_DIR}/agentx.log" 2>/dev/null || true
      rm -f "$PID_FILE"
      exit 1
    fi

    # Stream new log lines so the user sees PG / startup progress.
    if [ -f "${LOG_DIR}/agentx.log" ]; then
      size="$(wc -c < "${LOG_DIR}/agentx.log" | tr -d ' ')"
      if [ "${size:-0}" -gt "$last_size" ]; then
        tail -c +"$((last_size + 1))" "${LOG_DIR}/agentx.log" 2>/dev/null \
          | sed -n 's/^/  | /p' || true
        last_size="$size"
      fi
    fi

    if health_ok; then
      echo
      echo "Agent-X server started (pid $(cat "$PID_FILE"))."
      echo "Agent is active at http://127.0.0.1:${PORT}"
      echo "Logs: ${LOG_DIR}/agentx.log"
      return 0
    fi

    # Progress heartbeat when logs are quiet.
    if [ $((i % 5)) -eq 0 ] && [ "$i" -gt 0 ]; then
      printf '  … waiting for health (%ss / %ss)\n' "$i" "$START_TIMEOUT_SECS"
    fi

    sleep 1
    i=$((i + 1))
  done

  echo
  echo "Agent-X server did not become healthy within ${START_TIMEOUT_SECS}s." >&2
  echo "Process may still be starting — check ${LOG_DIR}/agentx.log" >&2
  print_startup_log_tail
  if is_running; then
    echo "Web UI (when ready): http://127.0.0.1:${PORT}"
    exit 0
  fi
  rm -f "$PID_FILE"
  exit 1
}

cmd_stop() {
  if ! is_running; then
    rm -f "$PID_FILE"
    echo "Agent-X server is not running."
    exit 0
  fi

  local pid
  pid="$(cat "$PID_FILE")"
  log "Stopping Agent-X server (pid $pid)..."
  kill "$pid" 2>/dev/null || true

  local i=0
  while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 20 ]; do
    sleep 0.5
    i=$((i + 1))
  done

  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
  fi

  rm -f "$PID_FILE"
  echo "Agent-X server stopped."
}

cmd_status() {
  if ! is_running; then
    rm -f "$PID_FILE"
    echo "Agent-X server: stopped"
    exit 1
  fi

  echo "Agent-X server: running (pid $(cat "$PID_FILE"))"
  if health_ok; then
    echo "Health: ok — agent is active at http://127.0.0.1:${PORT}"
  else
    echo "Health: process alive but HTTP not responding yet"
  fi
}

cmd_help() {
  cat <<EOF
Agent-X server commands:
  agentx start    Start headless server + Web UI (waits until healthy)
  agentx stop     Stop the server
  agentx status   Check server status
  agentx help     Show this help

Environment:
  AGENTX_DATA_DIR            Data directory (default: ~/.local/share/agentx)
  AGENTX_PORT                HTTP port (default: 3333)
  AGENTX_HOST                Bind address (default: 127.0.0.1)
  AGENTX_PUBLIC_URL          Public URL for OAuth redirects
  AGENTX_START_TIMEOUT_SECS  Seconds to wait for /api/health (default: 180)
EOF
}

case "${1:-help}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  help|--help|-h) cmd_help ;;
  *)
    echo "Unknown command: $1" >&2
    cmd_help
    exit 1
    ;;
esac
