#!/usr/bin/env bash
set -euo pipefail

# Agent-X Installer — Ground Control Edition
# Usage: curl -fsSL https://raw.githubusercontent.com/SlashpanOrg/agent-x/main/install.sh | bash

REPO="SlashpanOrg/agent-x"
INSTALL_DIR="${AGENTX_INSTALL_DIR:-$HOME/.agentx}"
BIN_DIR="${AGENTX_BIN_DIR:-$HOME/.local/bin}"
VERSION="${AGENTX_VERSION:-latest}"
MIN_NODE_VERSION=20
LOG_FILE="${INSTALL_DIR}/install.log"

# Colours
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Animated spinner ─────────────────────────────────────────────────

SPINNER_FRAMES=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
BRAILLE_FRAMES=('⣀' '⣄' '⣤' '⣦' '⣶' '⣷' '⣿' '⣷' '⣶' '⣦' '⣤' '⣄')
SPINNER_PID=""

start_spinner() {
  local msg="$1"
  (
    local i=0
    while true; do
      printf "\r  ${CYAN}${SPINNER_FRAMES[$((i % ${#SPINNER_FRAMES[@]}))]}${NC} ${msg}" >&2
      i=$((i + 1))
      sleep 0.08
    done
  ) &
  SPINNER_PID=$!
}

stop_spinner() {
  local success="${1:-true}"
  local msg="$2"
  if [ -n "$SPINNER_PID" ]; then
    kill "$SPINNER_PID" 2>/dev/null || true
    wait "$SPINNER_PID" 2>/dev/null || true
    SPINNER_PID=""
  fi
  if [ "$success" = "true" ]; then
    printf "\r  ${GREEN}✓${NC} ${msg}\033[K\n" >&2
  else
    printf "\r  ${RED}✗${NC} ${msg}\033[K\n" >&2
  fi
}

# ─── Animated progress bar (indeterminate) ────────────────────────────

PROGRESS_PID=""

start_progress() {
  local msg="$1"
  (
    local chars=('▱' '▱' '▱' '▱' '▱' '▰' '▰' '▰' '▰' '▰')
    local i=0
    while true; do
      local bar=""
      for j in {0..4}; do
        pos=$(( (i + j) % ${#chars[@]} ))
        bar="${bar}${chars[$pos]}"
      done
      local braile_idx=$(( i % ${#BRAILLE_FRAMES[@]} ))
      printf "\r  ${CYAN}${BRAILLE_FRAMES[$braile_idx]}${NC} ${msg} ${DIM}[${bar}]${NC}" >&2
      i=$((i + 1))
      sleep 0.15
    done
  ) &
  PROGRESS_PID=$!
}

stop_progress() {
  local success="${1:-true}"
  local msg="$2"
  if [ -n "$PROGRESS_PID" ]; then
    kill "$PROGRESS_PID" 2>/dev/null || true
    wait "$PROGRESS_PID" 2>/dev/null || true
    PROGRESS_PID=""
  fi
  if [ "$success" = "true" ]; then
    printf "\r  ${GREEN}✓${NC} ${msg}\033[K\n" >&2
  else
    printf "\r  ${RED}✗${NC} ${msg}\033[K\n" >&2
  fi
}

# ─── Rotating mission phrases ────────────────────────────────────────

MISSION_IDX=0
MISSION_PHRASES=(
  "Calibrating orbital insertion vectors"
  "Synchronising quantum entanglement buffers"
  "Establishing neural handshake protocol"
  "Deploying phased-array telemetry array"
  "Running pre-flight diagnostic suite"
  "Engaging inertial dampeners"
  "Aligning main reflector dish"
  "Warming up magnetron spindles"
  "Initialising subspace transceiver"
  "Performing cross-check on nav computers"
  "Boosting signal gain on deep-space network"
  "Running parity check on uplink channel"
  "Calculating Lagrange point insertion burn"
  "Spooling up reaction control wheels"
  "Synchronising atomic clock array"
  "Pinging relay satellite constellation"
  "Verifying encryption handshake keys"
  "Charging capacitor banks for main bus"
  "Unfurling solar panel arrays"
  "Loading mission parameters into flight computer"
  "Cross-referencing star charts with telemetry"
  "Running final go/no-go poll"
  "Priming thruster ignition sequence"
  "Acquiring lock on navigation beacon"
  "Stabilising attitude control system"
  "Verifying life support telemetry downlink"
  "Cycling coolant through primary loop"
  "Performing burn-time calculation"
  "Calibrating star tracker against known reference"
  "Checking pressure seals on payload bay"
  "Uploading waypoint sequence to autopilot"
  "Running loopback test on comms channel"
)

get_phrase() {
  MISSION_IDX=$(( (MISSION_IDX + 1) % ${#MISSION_PHRASES[@]} ))
  echo "${MISSION_PHRASES[$MISSION_IDX]}"
}

mission_phrase() {
  local phrase
  phrase=$(get_phrase)
  printf "  ${DIM}⟡ ${phrase}...${NC}"
}



# ─── Signal meter ────────────────────────────────────────────────────

signal_meter() {
  local level="${1:-0}"
  local bars=""
  for i in {1..5}; do
    if [ "$i" -le "$level" ]; then
      bars="${bars}${GREEN}█${NC}"
    else
      bars="${bars}${DIM}░${NC}"
    fi
  done
  case "$level" in
    0|1) printf "  ${DIM}SIG:${NC} ${bars} ${RED}POOR${NC}" ;;
    2|3) printf "  ${DIM}SIG:${NC} ${bars} ${YELLOW}FAIR${NC}" ;;
    4|5) printf "  ${DIM}SIG:${NC} ${bars} ${GREEN}LOCK${NC}" ;;
  esac
}

# ─── Telemetry header ────────────────────────────────────────────────

telemetry_header() {
  local phase="$1"
  printf "\n"
  printf "  ${CYAN}MISSION CONTROL${NC} ${DIM}•${NC} ${BOLD}AGENT-X DEPLOYMENT${NC}\n"
  printf "  ${DIM}───────────────────────────────────────────────────${NC}\n"
  printf "$(signal_meter $(( RANDOM % 3 + 3 )))\n"
  printf "  ${DIM}STAT:${NC} ${CYAN}${phase}${NC}\n"
  printf "  ${DIM}T+$(date +%s):${NC} $(date '+%H:%M:%S UTC')\n"
  printf "\n"
}

# ─── Countdown ───────────────────────────────────────────────────────

countdown() {
  local secs=3
  printf "\n"
  printf "  ${CYAN}T-minus:${NC}\n"
  while [ "$secs" -gt 0 ]; do
    printf "\r  ${BOLD}${secs}${NC}  ${DIM}seconds to deployment...${NC}" >&2
    sleep 1
    secs=$((secs - 1))
  done
  printf "\r  ${GREEN}LAUNCH${NC}  ${DIM}All systems nominal.${NC}\n"
  sleep 0.5
}

# ─── Errors ──────────────────────────────────────────────────────────

die() {
  stop_spinner "false" "$1" 2>/dev/null || true
  stop_progress "false" "$1" 2>/dev/null || true
  printf "\n  ${RED}⚠  MISSION ABORT${NC}\n" >&2
  printf "  ${RED}${1}${NC}\n" >&2
  if [ -f "$LOG_FILE" ]; then
    printf "  ${DIM}Full telemetry log: %s${NC}\n" "$LOG_FILE" >&2
  fi
  printf "\n" >&2
  exit 1
}

# ─── Platform detection ──────────────────────────────────────────────

detect_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  case "$os" in
    linux)  OS="linux" ;;
    darwin) OS="darwin" ;;
    *)      die "Unsupported OS: $os" ;;
  esac

  case "$arch" in
    x86_64|amd64)  ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *)             die "Unsupported architecture: $arch" ;;
  esac

  PLATFORM="${OS}-${ARCH}"
}

# ─── Pre-requisite checks ────────────────────────────────────────────

check_command() {
  command -v "$1" >/dev/null 2>&1
}

check_node() {
  if ! check_command node; then
    printf "  ${YELLOW}Node.js is required but not found.${NC}\n" >&2
    printf "  Attempting to install Node.js now...\n"
    local installed=false
    if [ "$OS" = "darwin" ]; then
      if check_command brew; then
        brew install node && installed=true
      fi
    elif [ "$OS" = "linux" ]; then
      if check_command apt-get; then
        sudo apt-get update && sudo apt-get install -y nodejs npm && installed=true
      elif check_command dnf; then
        sudo dnf install -y nodejs && installed=true
      elif check_command pacman; then
        sudo pacman -S nodejs npm && installed=true
      fi
    fi
    if ! $installed && ! check_command node; then
      printf "\n  ${RED}Node.js could not be installed automatically.${NC}\n" >&2
      if [ "$OS" = "darwin" ]; then
        printf "  Please install Node.js (v${MIN_NODE_VERSION}+) manually:\n"
        printf "    ${CYAN}brew install node${NC}\n"
        printf "    Or download from: https://nodejs.org/en/download${NC}\n"
      elif [ "$OS" = "linux" ]; then
        printf "  Please install Node.js (v${MIN_NODE_VERSION}+) manually.\n"
        printf "    ${CYAN}sudo apt-get install -y nodejs npm${NC}  (Debian/Ubuntu)\n"
        printf "    ${CYAN}sudo dnf install -y nodejs${NC}         (Fedora)\n"
        printf "    ${CYAN}sudo pacman -S nodejs npm${NC}          (Arch)\n"
        printf "    Or download from: https://nodejs.org/en/download${NC}\n"
      fi
      die "Node.js is required. Please install it and re-run this script."
    fi
  fi
  local node_major
  node_major=$(node -v | sed 's/^v//' | cut -d. -f1)
  if [ "$node_major" -lt "$MIN_NODE_VERSION" ]; then
    die "Node.js ${MIN_NODE_VERSION}+ required (found $(node -v)). Upgrade: https://nodejs.org"
  fi
}

check_curl() {
  if ! check_command curl; then
    die "curl is required. Install curl first."
  fi
}

# ─── Version resolution ──────────────────────────────────────────────

get_version() {
  if [ "$VERSION" = "latest" ]; then
    start_progress "Resolving latest release tag from GitHub..."
    VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null \
      | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
    stop_progress "true" "Latest release: ${VERSION}"
    if [ -z "$VERSION" ]; then
      die "Failed to determine latest version. Check your internet connection."
    fi
  fi
}

# ─── Clean existing installation ─────────────────────────────────────

clean_existing() {
  if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
  fi

  if [ -e "$BIN_DIR/agentx" ]; then
    rm -f "$BIN_DIR/agentx"
  fi

  local cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/agentx"
  if [ -d "$cache_dir" ]; then
    rm -rf "$cache_dir"
  fi

  local data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/agentx"
  if [ -d "$data_dir/logs" ]; then
    rm -rf "$data_dir/logs"
  fi

  if check_command agentx; then
    local existing_path
    existing_path=$(command -v agentx)
    if [[ "$existing_path" == *"node_modules"* ]] || [[ "$existing_path" == *"npm"* ]]; then
      npm uninstall -g @agentx/cli >/dev/null 2>&1 || true
      pnpm remove -g @agentx/cli >/dev/null 2>&1 || true
    fi
  fi
}

# ─── Download server payload ─────────────────────────────────────────

download_and_install() {
  local url="https://github.com/${REPO}/releases/download/${VERSION}/agentx-${PLATFORM}-server.tar.gz"
  TMPDIR_INSTALL="$(mktemp -d)"
  trap 'rm -rf "$TMPDIR_INSTALL"' EXIT

  printf "  ${DIM}Downlinking from:${NC} ${CYAN}%s${NC}\n" "$url"
  mkdir -p "$INSTALL_DIR"

  if ! curl --progress-bar -fSL "$url" -o "${TMPDIR_INSTALL}/agentx.tar.gz" 2>&1 | \
    while IFS= read -r line; do
      if [[ "$line" =~ ([0-9]+)% ]]; then
        local pct="${BASH_REMATCH[1]}"
        local filled=$((pct / 5))
        local empty=$((20 - filled))
        local bar=""
        for ((i=0; i<filled; i++)); do bar="${bar}${CYAN}█${NC}"; done
        for ((i=0; i<empty; i++)); do bar="${bar}${DIM}░${NC}"; done
        printf "\r  ${DIM}RX:${NC} [${bar}] ${BOLD}%3d%%${NC} %s" "$pct" "$(mission_phrase)" >&2
      fi
    done; then
    die "Download failed for ${url}. Check your internet connection or try AGENTX_VERSION=<tag>."
  fi

  if [ ! -s "${TMPDIR_INSTALL}/agentx.tar.gz" ]; then
    die "Download failed. Check your internet connection."
  fi

  if ! gzip -t "${TMPDIR_INSTALL}/agentx.tar.gz" 2>/dev/null; then
    die "Downloaded file is not a valid server package (expected gzip). Asset may be missing for ${PLATFORM} in ${VERSION}."
  fi

  printf "\r  ${DIM}RX:${NC} [${CYAN}████████████████████${NC}] ${BOLD}100%%${NC} ${GREEN}Payload received${NC}\033[K\n"
  printf "  ${DIM}Unpacking payload...${NC}\n"
  tar -xzf "${TMPDIR_INSTALL}/agentx.tar.gz" -C "$INSTALL_DIR"
  printf "  ${GREEN}✓${NC} Payload extracted to ${CYAN}%s${NC}\n" "$INSTALL_DIR"
}

# ─── Rebuild native modules ──────────────────────────────────────────

rebuild_native() {
  mkdir -p "$(dirname "$LOG_FILE")"
  cd "$INSTALL_DIR"
  if [ -f package.json ] && grep -q 'better-sqlite3' package.json 2>/dev/null; then
    npm install --omit=dev --ignore-scripts >> "$LOG_FILE" 2>&1 || true
    npx --yes node-gyp rebuild --directory=node_modules/better-sqlite3 >> "$LOG_FILE" 2>&1 || \
      npm rebuild better-sqlite3 >> "$LOG_FILE" 2>&1 || true
    if [ -f node_modules/better-sqlite3/build/Release/better_sqlite3.node ]; then
      mkdir -p build/Release
      cp node_modules/better-sqlite3/build/Release/better_sqlite3.node build/Release/
    elif [ -f "node_modules/better-sqlite3/prebuilds/$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)/node.napi.node" ]; then
      mkdir -p build/Release
      cp "node_modules/better-sqlite3/prebuilds/$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)/node.napi.node" build/Release/better_sqlite3.node
    fi
  fi
  cd - >/dev/null
}

create_symlink() {
  mkdir -p "$BIN_DIR"

  cat > "$BIN_DIR/agentx" << EOF
#!/usr/bin/env bash
exec "$INSTALL_DIR/agentx" "\$@"
EOF
  chmod +x "$BIN_DIR/agentx"
}

ensure_path() {
  if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    export PATH="$BIN_DIR:$PATH"
    printf "  ${DIM}Navigation beacon locked for this session${NC}\n"
  fi

  local shell_rc=""
  case "$(basename "${SHELL:-bash}")" in
    zsh)  shell_rc="$HOME/.zshrc" ;;
    bash) shell_rc="$HOME/.bashrc" ;;
    fish) shell_rc="$HOME/.config/fish/config.fish" ;;
  esac

  if [ -n "$shell_rc" ] && [ -f "$shell_rc" ]; then
    if ! grep -q "# Agent-X" "$shell_rc" 2>/dev/null; then
      printf '\n# Agent-X\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >> "$shell_rc"
      printf "  ${DIM}Permanent navigation beacon added to %s${NC}\n" "$shell_rc"
      if [[ $- == *i* ]]; then
        # shellcheck disable=SC1090
        . "$shell_rc" 2>/dev/null || true
      fi
    fi
    printf "  ${DIM}To use in new terminals: source %s${NC}\n" "$shell_rc"
  else
    echo ""
    printf "  ${DIM}Add this to your shell profile for persistence across sessions:${NC}\n"
    printf "  ${CYAN}export PATH=\"%s:\$PATH\"${NC}\n" "$BIN_DIR"
  fi
}

# ─── Verify ──────────────────────────────────────────────────────────

verify_install() {
  if [ ! -f "$INSTALL_DIR/index.js" ] || [ ! -f "$INSTALL_DIR/agentx" ]; then
    die "Installation failed — payload integrity check failed in $INSTALL_DIR"
  fi
}

# ─── Install optional dependencies (Tesseract for OCR) ───────────────

install_optional_deps() {
  if check_command tesseract; then
    return 0
  fi

  if [ "$OS" = "darwin" ]; then
    if check_command brew; then
      brew install tesseract >/dev/null 2>&1 || true
    fi
  elif [ "$OS" = "linux" ]; then
    if check_command apt-get; then
      sudo apt-get install -y tesseract-ocr >/dev/null 2>&1 || true
    elif check_command dnf; then
      sudo dnf install -y tesseract >/dev/null 2>&1 || true
    elif check_command pacman; then
      sudo pacman -S --noconfirm tesseract >/dev/null 2>&1 || true
    fi
  fi

  if ! check_command tesseract; then
    printf "  ${YELLOW}⚠${NC}  Tesseract OCR not installed (needed for image text extraction)\n"
    printf "  ${DIM}  Install manually: brew install tesseract (macOS) or sudo apt install tesseract-ocr (Ubuntu)${NC}\n"
  fi
  return 0
}

# ─── Animated step runner ────────────────────────────────────────────

run_step() {
  local msg="$1"
  shift
  mission_phrase > /dev/null
  start_progress "$msg"
  if "$@"; then
    stop_progress "true" "$msg"
  else
    stop_progress "false" "$msg"
    die "$msg failed"
  fi
}

# ─── Main ────────────────────────────────────────────────────────────

main() {
  clear 2>/dev/null || printf "\033c" 2>/dev/null || true
  telemetry_header "PRE-LAUNCH"

  printf "  ${DIM}Running pre-flight checks...${NC}\n"
  detect_platform
  check_curl
  check_node
  get_version

  printf "  ${DIM}Telemetry:${NC} ${CYAN}%s${NC} • ${CYAN}Node %s${NC} • ${CYAN}%s${NC}\n\n" "$PLATFORM" "$(node -v)" "$VERSION"
  printf "  ${DIM}Payload:${NC} ${CYAN}Server (headless Web UI)${NC}\n"

  countdown

  printf "\n"

  run_step "Clearing previous installation artifacts" clean_existing
  download_and_install
  run_step "Assembling native modules" rebuild_native
  run_step "Locking navigation coordinates" create_symlink
  run_step "Running payload integrity check" verify_install
  run_step "Installing auxiliary sensors (OCR)" install_optional_deps

  ensure_path

  echo ""
  printf "  ${BOLD}✦  DEPLOYMENT COMPLETE  ✦${NC}\n"
  printf "  ${DIM}Agent-X server is now operational.${NC}\n"
  echo ""
  printf "  ${CYAN}Payload:${NC}  ${BOLD}Server (Web UI)${NC}\n"
  echo ""
  printf "  ${CYAN}Engage:${NC}\n"
  printf "    ${BOLD}agentx start${NC}                       Start server daemon\n"
  printf "    ${BOLD}agentx status${NC}                      Check server health\n"
  printf "    ${BOLD}agentx stop${NC}                        Stop server daemon\n"
  echo ""
  printf "  ${DIM}Web UI:${NC} http://127.0.0.1:3333 (or your server IP)\n"
  echo ""
  printf "  ${DIM}Mission control: agentx --help${NC}\n"
  echo ""
}

main "$@"
