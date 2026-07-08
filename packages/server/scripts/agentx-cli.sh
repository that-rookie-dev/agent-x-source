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

mkdir -p "$LOG_DIR"

set_embedded_pg_lib_path() {
  if [ "$(uname -s)" != "Linux" ]; then
    return 0
  fi

  local arch pkg lib_dir
  arch="$(uname -m)"
  case "$arch" in
    aarch64|arm64) pkg="linux-arm64" ;;
    x86_64|amd64) pkg="linux-x64" ;;
    *) return 0 ;;
  esac

  lib_dir="${INSTALL_DIR}/node_modules/@embedded-postgres/${pkg}/native/lib"
  if [ -d "$lib_dir" ]; then
    export LD_LIBRARY_PATH="${lib_dir}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
  fi
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

cmd_start() {
  if is_running; then
    echo "Agent-X server is already running (pid $(cat "$PID_FILE"))."
    echo "Web UI: http://127.0.0.1:${PORT}"
    exit 0
  fi

  if [ ! -f "$INDEX_JS" ]; then
    echo "Missing server entry at $INDEX_JS" >&2
    exit 1
  fi

  export AGENTX_INSTALL_DIR="$INSTALL_DIR"
  export AGENTX_DATA_DIR="$DATA_DIR"
  set_embedded_pg_lib_path

  log "Starting Agent-X server..."
  nohup node "$INDEX_JS" >> "${LOG_DIR}/agentx.log" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 2

  if is_running; then
    echo "Agent-X server started (pid $(cat "$PID_FILE"))."
    echo "Web UI: http://127.0.0.1:${PORT}"
    echo "Logs: ${LOG_DIR}/agentx.log"
  else
    echo "Agent-X server failed to start. See ${LOG_DIR}/agentx.log" >&2
    rm -f "$PID_FILE"
    exit 1
  fi
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
  if command -v curl >/dev/null 2>&1; then
    if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
      echo "Health: ok (http://127.0.0.1:${PORT}/api/health)"
    else
      echo "Health: process alive but HTTP not responding yet"
    fi
  fi
}

cmd_help() {
  cat <<EOF
Agent-X server commands:
  agentx start    Start headless server + Web UI
  agentx stop     Stop the server
  agentx status   Check server status
  agentx help     Show this help

Environment:
  AGENTX_DATA_DIR   Data directory (default: ~/.local/share/agentx)
  AGENTX_PORT       HTTP port (default: 3333)
  AGENTX_HOST       Bind address (default: 0.0.0.0 in server mode)
  AGENTX_PUBLIC_URL Public URL for OAuth redirects
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
