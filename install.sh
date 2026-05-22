#!/usr/bin/env bash
set -euo pipefail

# Agent-X Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/SlashpanOrg/agent-x/main/install.sh | bash

REPO="SlashpanOrg/agent-x"
INSTALL_DIR="${AGENTX_INSTALL_DIR:-$HOME/.agentx}"
BIN_DIR="${AGENTX_BIN_DIR:-$HOME/.local/bin}"
VERSION="${AGENTX_VERSION:-latest}"
MIN_NODE_VERSION=20

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { printf "${CYAN}▸${NC} %s\n" "$1"; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}!${NC} %s\n" "$1"; }
die()   { printf "${RED}✗${NC} %s\n" "$1" >&2; exit 1; }

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
  ok "Node.js $(node -v)"
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
  ok "Version: $VERSION"
}

# --- Clean existing installation ---

clean_existing() {
  if [ -d "$INSTALL_DIR" ]; then
    warn "Existing installation found at $INSTALL_DIR"
    info "Removing to avoid conflicts..."
    rm -rf "$INSTALL_DIR"
    ok "Removed $INSTALL_DIR"
  fi

  if [ -e "$BIN_DIR/agentx" ]; then
    rm -f "$BIN_DIR/agentx"
    ok "Removed old binary at $BIN_DIR/agentx"
  fi

  # Clean global npm/pnpm installs of agentx if present
  if check_command agentx; then
    local existing_path
    existing_path=$(command -v agentx)
    if [[ "$existing_path" == *"node_modules"* ]] || [[ "$existing_path" == *"npm"* ]]; then
      npm uninstall -g @agentx/cli >/dev/null 2>&1 || true
      pnpm remove -g @agentx/cli >/dev/null 2>&1 || true
      ok "Removed global npm package"
    fi
  fi
}

# --- Download and install ---

download_and_install() {
  local url="https://github.com/${REPO}/releases/download/${VERSION}/agentx-${PLATFORM}.tar.gz"
  local tmpdir
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT

  info "Downloading agentx-${PLATFORM}.tar.gz..."
  if ! curl -fsSL "$url" -o "${tmpdir}/agentx.tar.gz"; then
    die "Download failed. URL: $url"
  fi

  info "Installing to $INSTALL_DIR..."
  mkdir -p "$INSTALL_DIR"
  tar -xzf "${tmpdir}/agentx.tar.gz" -C "$INSTALL_DIR"
  ok "Extracted to $INSTALL_DIR"
}

create_symlink() {
  mkdir -p "$BIN_DIR"

  cat > "$BIN_DIR/agentx" << EOF
#!/usr/bin/env bash
exec "$INSTALL_DIR/agentx" "\$@"
EOF
  chmod +x "$BIN_DIR/agentx"
  ok "Executable: $BIN_DIR/agentx"
}

ensure_path() {
  if [[ ":$PATH:" == *":$BIN_DIR:"* ]]; then
    return
  fi

  warn "$BIN_DIR is not in your PATH"
  local shell_rc=""
  case "$(basename "${SHELL:-bash}")" in
    zsh)  shell_rc="$HOME/.zshrc" ;;
    bash) shell_rc="$HOME/.bashrc" ;;
    fish) shell_rc="$HOME/.config/fish/config.fish" ;;
  esac

  if [ -n "$shell_rc" ] && [ -f "$shell_rc" ]; then
    printf '\n# Agent-X\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >> "$shell_rc"
    info "Added $BIN_DIR to PATH in $shell_rc"
    info "Run: source $shell_rc (or open a new terminal)"
  else
    echo ""
    echo "  Add this to your shell profile:"
    echo "    export PATH=\"$BIN_DIR:\$PATH\""
  fi
}

# --- Verify ---

verify_install() {
  if [ -f "$INSTALL_DIR/index.js" ] && [ -f "$INSTALL_DIR/agentx" ]; then
    ok "Installation verified"
  else
    die "Installation failed — files not found in $INSTALL_DIR"
  fi
}

# --- Main ---

main() {
  echo ""
  echo -e "${CYAN}  ╔═══════════════════════════════════════╗${NC}"
  echo -e "${CYAN}  ║         Agent-X Installer             ║${NC}"
  echo -e "${CYAN}  ╚═══════════════════════════════════════╝${NC}"
  echo ""

  detect_platform
  info "Platform: $PLATFORM"
  echo ""

  info "Checking prerequisites..."
  check_curl
  check_node
  echo ""

  get_version
  echo ""

  clean_existing
  download_and_install
  create_symlink
  verify_install
  ensure_path

  echo ""
  echo -e "${GREEN}  ╔═══════════════════════════════════════╗${NC}"
  echo -e "${GREEN}  ║   Agent-X installed successfully! 🚀  ║${NC}"
  echo -e "${GREEN}  ╚═══════════════════════════════════════╝${NC}"
  echo ""
  echo "  Get started:   agentx"
  echo "  Help:          agentx --help"
  echo "  Uninstall:     curl -fsSL https://raw.githubusercontent.com/${REPO}/main/uninstall.sh | bash"
  echo ""
}

main "$@"
