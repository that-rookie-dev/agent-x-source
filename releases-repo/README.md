# Agent-X

Your AI-powered terminal agent. Multi-provider, 80+ tools, session persistence, Telegram integration — all from your terminal.

## Install

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/SlashpanOrg/agent-x/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/SlashpanOrg/agent-x/main/install.ps1 | iex
```

**Requirements:** Node.js >= 20 (the only prerequisite).

After installation:

```bash
agentx
```

A guided setup wizard walks you through provider selection, API key configuration, and preferences on first run.

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/SlashpanOrg/agent-x/main/uninstall.sh | bash
```

## Features

- **Multi-Provider AI** — OpenAI, Anthropic, Google, Ollama, LM Studio
- **80+ Built-in Tools** — filesystem, shell, git, code, packages, testing, web, browser automation, containers, database, GitHub, system, MCP
- **Permission System** — scope-based validation, risk assessment, interactive prompts
- **Session Management** — persistent sessions, auto-save, crash recovery, token tracking
- **Telegram Integration** — interact remotely via Telegram bot
- **Sub-Agents** — delegate tasks to lightweight isolated agents

## Commands

All configuration is managed inside the Agent-X terminal.

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/model <name>` | Switch AI model |
| `/provider <name>` | Switch provider |
| `/config` | Manage settings (keys, preferences) |
| `/session list` | List saved sessions |
| `/session restore <id>` | Restore a session |
| `/clear` | Clear message history |
| `/compact` | Summarize and compact context |
| `/permissions` | Manage tool permissions |
| `/telegram setup` | Configure Telegram bot |
| `/exit` | Exit Agent-X |

## Supported Platforms

| Platform | Architecture |
|----------|-------------|
| macOS | Apple Silicon (arm64) |
| macOS | Intel (x64 via Rosetta) |
| Linux | x64 |
| Linux | arm64 |
| Windows | x64 |

## Version Pinning

Install a specific version:

```bash
AGENTX_VERSION=v0.1.0 curl -fsSL https://raw.githubusercontent.com/SlashpanOrg/agent-x/main/install.sh | bash
```

## License

MIT
