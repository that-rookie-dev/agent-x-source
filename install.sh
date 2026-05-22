#!/usr/bin/env bash
set -euo pipefail

# Agent-X Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/agent-x/agent-x/main/install.sh | bash

VERSION="${AGENTX_VERSION:-latest}"
INSTALL_DIR="${AGENTX_INSTALL_DIR:-$HOME/.local/bin}"
REPO="agent-x/agent-x"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info() { printf "${CYAN}▸${NC} %s\n" "$1"; }
success() { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}!${NC} %s\n" "$1"; }
error() { printf "${RED}✗${NC} %s\n" "$1" >&2; exit 1; }

# Detect OS and architecture
detect_platform() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  case "$os" in
    linux)  OS="linux" ;;
    darwin) OS="darwin" ;;
    *)      error "Unsupported OS: $os" ;;
  esac

  case "$arch" in
    x86_64|amd64) ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *)            error "Unsupported architecture: $arch" ;;
  esac

  PLATFORM="${OS}-${ARCH}"
}

# Check dependencies
check_deps() {
  local missing=()
  for dep in curl tar; do
    if ! command -v "$dep" &>/dev/null; then
      missing+=("$dep")
    fi
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    error "Missing dependencies: ${missing[*]}"
  fi
}

# Get latest version from GitHub
get_version() {
  if [[ "$VERSION" == "latest" ]]; then
    VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"v?([^"]+)".*/\1/')
    if [[ -z "$VERSION" ]]; then
      error "Failed to determine latest version"
    fi
  fi
}

# Download and install
install() {
  local url="https://github.com/${REPO}/releases/download/v${VERSION}/agentx-${PLATFORM}.tar.gz"
  local tmpdir
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT

  info "Downloading Agent-X v${VERSION} for ${PLATFORM}..."
  if ! curl -fsSL "$url" -o "${tmpdir}/agentx.tar.gz"; then
    error "Download failed. Check your internet connection and version."
  fi

  info "Extracting..."
  tar -xzf "${tmpdir}/agentx.tar.gz" -C "$tmpdir"

  info "Installing to ${INSTALL_DIR}..."
  mkdir -p "$INSTALL_DIR"
  mv "${tmpdir}/agentx" "${INSTALL_DIR}/agentx"
  chmod +x "${INSTALL_DIR}/agentx"
}

# Verify PATH
check_path() {
  if [[ ":$PATH:" != *":${INSTALL_DIR}:"* ]]; then
    warn "${INSTALL_DIR} is not in your PATH"
    echo ""
    echo "  Add this to your shell profile (~/.bashrc, ~/.zshrc, etc.):"
    echo ""
    echo "    export PATH=\"${INSTALL_DIR}:\$PATH\""
    echo ""
  fi
}

main() {
  echo ""
  echo "  ╔═══════════════════════════════╗"
  echo "  ║       Agent-X Installer       ║"
  echo "  ╚═══════════════════════════════╝"
  echo ""

  detect_platform
  check_deps
  get_version
  install
  check_path

  echo ""
  success "Agent-X v${VERSION} installed successfully!"
  echo ""
  echo "  Get started:  agentx"
  echo "  Help:         agentx --help"
  echo ""
}

main "$@"
