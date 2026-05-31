#!/usr/bin/env bash
set -euo pipefail

# Agent-X Installer — Space Edition
# Usage: curl -fsSL https://raw.githubusercontent.com/SlashpanOrg/agent-x/main/install.sh | bash

REPO="SlashpanOrg/agent-x"
INSTALL_DIR="${AGENTX_INSTALL_DIR:-$HOME/.agentx}"
BIN_DIR="${AGENTX_BIN_DIR:-$HOME/.local/bin}"
VERSION="${AGENTX_VERSION:-latest}"
MIN_NODE_VERSION=20
LOG_FILE="${INSTALL_DIR}/install.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# --- Animated spinner ---

SPINNER_FRAMES=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
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
    printf "\r  ${GREEN}✓${NC} ${msg}\n" >&2
  else
    printf "\r  ${RED}✗${NC} ${msg}\n" >&2
  fi
}

warn() {
  printf "  ${YELLOW}⚠ %s${NC}\n" "$1" >&2
}

die() {
  stop_spinner "false" "$1" 2>/dev/null || true
  printf "\n  ${RED}Houston, we have a problem:${NC}\n" >&2
  printf "  ${RED}%s${NC}\n\n" "$1" >&2
  if [ -f "$LOG_FILE" ]; then
    printf "  ${DIM}Full log: %s${NC}\n\n" "$LOG_FILE" >&2
  fi
  exit 1
}

# --- Platform detection ---

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

  # Intel Mac users get ARM binary (runs via Rosetta 2)
  if [ "$OS" = "darwin" ] && [ "$ARCH" = "x64" ]; then
    warn "Intel Mac detected — using ARM binary (runs via Rosetta 2)"
    ARCH="arm64"
  fi

  PLATFORM="${OS}-${ARCH}"
}

# --- Pre-requisite checks ---

check_command() {
  command -v "$1" >/dev/null 2>&1
}

check_node() {
  if ! check_command node; then
    die "Node.js is not installed. Install Node.js >= $MIN_NODE_VERSION: https://nodejs.org"
  fi
  local node_major
  node_major=$(node -v | sed 's/^v//' | cut -d. -f1)
  if [ "$node_major" -lt "$MIN_NODE_VERSION" ]; then
    die "Node.js $MIN_NODE_VERSION+ required (found $(node -v)). Upgrade: https://nodejs.org"
  fi
}

check_curl() {
  if ! check_command curl; then
    die "curl is required. Install curl first."
  fi
}

# --- Version resolution ---

get_version() {
  if [ "$VERSION" = "latest" ]; then
    VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null \
      | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
    if [ -z "$VERSION" ]; then
      die "Failed to determine latest version. Check your internet connection."
    fi
  fi
}

# --- Clean existing installation ---

clean_existing() {
  if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
  fi

  if [ -e "$BIN_DIR/agentx" ]; then
    rm -f "$BIN_DIR/agentx"
  fi

  # Clear cache and logs (stale data from previous versions)
  local cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/agentx"
  if [ -d "$cache_dir" ]; then
    rm -rf "$cache_dir"
  fi

  local data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/agentx"
  if [ -d "$data_dir/logs" ]; then
    rm -rf "$data_dir/logs"
  fi

  # Clean global npm/pnpm installs of agentx if present
  if check_command agentx; then
    local existing_path
    existing_path=$(command -v agentx)
    if [[ "$existing_path" == *"node_modules"* ]] || [[ "$existing_path" == *"npm"* ]]; then
      npm uninstall -g @slashpan-org/agentx >/dev/null 2>&1 || true
      pnpm remove -g @slashpan-org/agentx >/dev/null 2>&1 || true
    fi
  fi
}

# --- Installation mode selection ---

select_install_mode() {
  echo ""
  echo -e "  ${CYAN}Installation mode:${NC}"
  echo -e "    ${BOLD}1)${NC} TUI only     — Terminal interface (lightweight)"
  echo -e "    ${BOLD}2)${NC} TUI + Web-UI — Terminal + browser interface"
  echo ""

  local choice=""

  # Allow overriding via environment variable for non-interactive installs
  if [ -n "${AGENTX_INSTALL_MODE:-}" ]; then
    choice="${AGENTX_INSTALL_MODE}"
  # When piped (curl | bash), stdin is not a TTY. Read from /dev/tty instead.
  elif [ -e /dev/tty ]; then
    read -p "  Select [1/2] (default: 2): " choice < /dev/tty
  fi

  if [ "$choice" = "1" ]; then
    INSTALL_MODE="tui-only"
    echo -e "  ${DIM}TUI-only mode selected.${NC}"
  else
    INSTALL_MODE="full"
    echo -e "  ${DIM}Full mode selected (TUI + Web-UI).${NC}"
  fi
}

# --- Download and install ---

download_and_install() {
  local suffix=""
  if [ "${INSTALL_MODE:-full}" = "tui-only" ]; then
    suffix="-tui"
  fi
  local url="https://github.com/${REPO}/releases/download/${VERSION}/agentx-${PLATFORM}${suffix}.tar.gz"
  TMPDIR_INSTALL="$(mktemp -d)"
  trap 'rm -rf "$TMPDIR_INSTALL"' EXIT

  if ! curl -fsSL "$url" -o "${TMPDIR_INSTALL}/agentx.tar.gz"; then
    die "Download failed. Check your internet connection."
  fi

  mkdir -p "$INSTALL_DIR"
  tar -xzf "${TMPDIR_INSTALL}/agentx.tar.gz" -C "$INSTALL_DIR"
}

# --- Rebuild native modules ---

rebuild_native() {
  mkdir -p "$(dirname "$LOG_FILE")"
  cd "$INSTALL_DIR"
  if [ -f package.json ] && grep -q 'better-sqlite3' package.json 2>/dev/null; then
    npm install --omit=dev --ignore-scripts >> "$LOG_FILE" 2>&1 || true
    npx --yes node-gyp rebuild --directory=node_modules/better-sqlite3 >> "$LOG_FILE" 2>&1 || \
      npm rebuild better-sqlite3 >> "$LOG_FILE" 2>&1 || true
    # Copy rebuilt .node to expected location
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
  if [[ ":$PATH:" == *":$BIN_DIR:"* ]]; then
    return
  fi

  local shell_rc=""
  case "$(basename "${SHELL:-bash}")" in
    zsh)  shell_rc="$HOME/.zshrc" ;;
    bash) shell_rc="$HOME/.bashrc" ;;
    fish) shell_rc="$HOME/.config/fish/config.fish" ;;
  esac

  if [ -n "$shell_rc" ] && [ -f "$shell_rc" ]; then
    printf '\n# Agent-X\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >> "$shell_rc"
    printf "  ${DIM}Added %s to PATH in %s${NC}\n" "$BIN_DIR" "$shell_rc"
  else
    echo ""
    printf "  ${DIM}Add this to your shell profile:${NC}\n"
    printf "  ${CYAN}export PATH=\"%s:\$PATH\"${NC}\n" "$BIN_DIR"
  fi
}

# --- Verify ---

verify_install() {
  if [ ! -f "$INSTALL_DIR/index.js" ] || [ ! -f "$INSTALL_DIR/agentx" ]; then
    die "Installation failed — files not found in $INSTALL_DIR"
  fi
}

# --- Install optional dependencies (Tesseract for OCR) ---

install_optional_deps() {
  if check_command tesseract; then
    return 0 # Already installed
  fi

  # Attempt auto-install based on platform
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

  # Verify it installed
  if ! check_command tesseract; then
    printf "  ${YELLOW}⚠${NC}  Tesseract OCR not installed (needed for image text extraction)\n"
    printf "  ${DIM}  Install manually: brew install tesseract (macOS) or sudo apt install tesseract-ocr (Ubuntu)${NC}\n"
  fi
  return 0
}

# --- Animated step runner ---

run_step() {
  local msg="$1"
  shift
  start_spinner "$msg"
  if "$@"; then
    stop_spinner "true" "$msg"
  else
    stop_spinner "false" "$msg"
    die "$msg failed"
  fi
}

# --- Main ---

main() {
  echo ""
  echo -e "  ${CYAN}╭────────────────────────────────────────────╮${NC}"
  echo -e "  ${CYAN}│${NC}    ${BOLD}✦  A G E N T - X${NC}  ${DIM}— Your AI Wingman${NC}     ${CYAN}│${NC}"
  echo -e "  ${CYAN}╰────────────────────────────────────────────╯${NC}"
  echo ""

  detect_platform

  # Pre-flight checks (fast, no spinner needed)
  check_curl
  check_node
  get_version

  printf "  ${DIM}%s • Node %s • %s${NC}\n\n" "$PLATFORM" "$(node -v)" "$VERSION"

  # Ask user for installation mode
  select_install_mode

  # Animated installation steps
  run_step "Running pre-flight diagnostics..." clean_existing
  run_step "Downloading payload from orbit..." download_and_install
  run_step "Assembling quantum modules..." rebuild_native
  run_step "Locking navigation coordinates..." create_symlink
  run_step "Verifying mission integrity..." verify_install
  run_step "Installing optical sensors (OCR)..." install_optional_deps

  ensure_path

  echo ""
  echo -e "  ${GREEN}╭────────────────────────────────────────────╮${NC}"
  echo -e "  ${GREEN}│${NC}  ${BOLD}Mission ready. Welcome aboard, commander.${NC} ${GREEN}│${NC}"
  echo -e "  ${GREEN}╰────────────────────────────────────────────╯${NC}"
  echo ""
  if [ "${INSTALL_MODE:-full}" = "tui-only" ]; then
    echo -e "  ${CYAN}Installed:${NC}  ${BOLD}TUI only${NC}"
    echo ""
    echo -e "  ${CYAN}Get started:${NC}"
    echo -e "    ${BOLD}agentx${NC}                             Launch interactive TUI"
  else
    echo -e "  ${CYAN}Installed:${NC}  ${BOLD}TUI + Web-UI${NC}"
    echo ""
    echo -e "  ${CYAN}Get started:${NC}"
    echo -e "    ${BOLD}agentx${NC}                             Launch interactive TUI"
    echo -e "    ${BOLD}agentx start${NC}                       Start daemon with Web-UI"
  fi
  echo ""
  echo -e "  ${DIM}More info: agentx --help${NC}"
  echo ""
}

main "$@"
