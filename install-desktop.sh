#!/usr/bin/env bash
set -euo pipefail

REPO="SlashpanOrg/agent-x"
VERSION="${AGENTX_VERSION:-latest}"
ARCH="arm64"

echo ""
echo "  Agent-X Desktop Installer"
echo "  ========================="
echo ""

# Resolve latest version
if [ "$VERSION" = "latest" ]; then
  VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
  if [ -z "$VERSION" ]; then
    echo "  Failed to determine latest version."
    exit 1
  fi
  echo "  Latest version: $VERSION"
fi

# Download DMG
DMG_URL="https://github.com/${REPO}/releases/download/${VERSION}/Agent-X-${VERSION#v}-${ARCH}.dmg"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

echo "  Downloading..."
curl -fsSL "$DMG_URL" -o "$TMP_DIR/Agent-X.dmg"

# Mount DMG
echo "  Installing..."
MOUNT_POINT=$(hdiutil attach "$TMP_DIR/Agent-X.dmg" -nobrowse 2>/dev/null | tail -1 | awk '{print $NF}')

# Remove existing app and copy new one
rm -rf /Applications/Agent-X.app
cp -R "$MOUNT_POINT/Agent-X.app" /Applications/

# Strip quarantine — this is the fix for the "damaged" / "unidentified developer" error
xattr -cr /Applications/Agent-X.app

# Detach DMG
hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true

echo ""
echo "  Agent-X Desktop installed successfully!"
echo ""

# Launch
echo "  Launching..."
open /Applications/Agent-X.app
