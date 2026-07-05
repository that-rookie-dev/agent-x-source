#!/usr/bin/env bash
set -euo pipefail
# Server install one-liner: curl -fsSL .../install-server.sh | bash
export AGENTX_INSTALL_MODE=server
REPO="${AGENTX_INSTALL_REPO:-SlashpanOrg/agent-x}"
INSTALL_SCRIPT="${AGENTX_INSTALL_SCRIPT:-https://raw.githubusercontent.com/${REPO}/main/install.sh}"
exec bash <(curl -fsSL "$INSTALL_SCRIPT")
