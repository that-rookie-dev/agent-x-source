<p align="center">
  <br/>
  <strong>AGENT-X</strong>
  <br/>
  <em>Your AI Wingman</em>
  <br/><br/>
  Multi-provider AI agent in your terminal. 80+ tools. Session persistence. Telegram remote control.
  <br/>
  One command to launch. Zero configuration required.
  <br/><br/>
  <a href="#installation">Install</a> · <a href="#features">Features</a> · <a href="#commands">Commands</a> · <a href="#providers">Providers</a>
</p>

---

## Overview

Agent-X is an autonomous AI agent that lives in your terminal. It connects to multiple AI providers, wields 80+ built-in tools, remembers context across sessions, and can be commanded remotely via Telegram — all wrapped in a deep-space-themed interface that makes every interaction feel like commanding a starship.

No cloud accounts. No subscriptions. Bring your own API keys and launch.

---

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/SlashpanOrg/agent-x/main/install.sh | bash
```

**Prerequisites** (the installer checks these automatically):
- Node.js >= 20
- Git

The installer handles pnpm and everything else. After installation:

```bash
agentx
```

A guided setup wizard walks you through provider selection, API key configuration, and preferences on first run.

---

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/SlashpanOrg/agent-x/main/uninstall.sh | bash
```

---

## Features

### Multi-Provider AI

Switch between providers mid-conversation. No restart needed.

| Provider | Models |
|----------|--------|
| OpenAI | GPT-4o, o1, o3 |
| Anthropic | Claude 3.5, Claude 4 |
| Google | Gemini |
| Ollama | Any local model |
| LM Studio | Any local model |

### 80+ Built-in Tools

Agent-X does not just talk — it acts. Tools are organized by domain:

- **Filesystem** — read, write, move, delete, search files and directories
- **Shell** — execute commands, manage background processes
- **Git** — status, diff, log, commit, branch, stash, blame
- **Code Intelligence** — search symbols, find definitions, replace, refactor
- **Packages** — install, remove, list, outdated, run scripts
- **Testing** — run suites, watch mode, coverage, generate tests
- **Web / HTTP** — GET, POST, scrape, search the web
- **Browser Automation** — open pages, click elements, screenshots, evaluate JS
- **Containers** — Docker lifecycle, compose, logs, exec
- **Database** — query, inspect schema, export data
- **GitHub** — issues, PRs, repos, workflows, releases
- **System** — disk, ports, env, processes, security audit
- **MCP** — connect to any Model Context Protocol server for extended capabilities

### Permission System

Every tool action passes through a clearance gate:

- Scope-based path validation
- Risk-level assessment per tool
- Interactive prompts — allow once, allow always, or deny
- Full audit trail of approved actions

### Session Persistence

- Auto-save on every turn
- Crash recovery — pick up exactly where you left off
- Token tracking and context management
- Session compaction when context grows large

### Telegram Integration

Run Agent-X as a background daemon and interact with it remotely through Telegram. Shared session context, permission prompts forwarded to your phone, and full command support — your agent is always reachable.

```bash
agentx start      # launch the background daemon
agentx status     # check daemon health
agentx stop       # terminate the daemon
```

### Profiles

Create multiple agent personalities — each with its own system prompt, tone, and behavioral boundaries. Switch between a DevOps specialist, a writing assistant, and a code reviewer without reconfiguring anything.

### Sub-Agents

Delegate complex subtasks to lightweight satellite agents with isolated tool access. The main agent orchestrates; sub-agents execute and report back.

---

## Commands

All configuration and control happens inside the Agent-X terminal:

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/model <name>` | Switch AI model |
| `/provider <name>` | Switch provider |
| `/config` | Manage settings and API keys |
| `/profile` | Switch or create profiles |
| `/session list` | List saved sessions |
| `/session restore <id>` | Restore a previous session |
| `/clear` | Clear message history |
| `/compact` | Summarize and compress context |
| `/permissions` | Review and manage tool permissions |
| `/telegram setup` | Configure Telegram bot integration |
| `/telegram status` | Check Telegram connection |
| `/exit` | Enter cryo-sleep |

---

## Providers

Agent-X works with any OpenAI-compatible API. Configure multiple providers and switch between them freely:

```
/provider openai
/model gpt-4o

/provider anthropic
/model claude-sonnet-4-20250514

/provider ollama
/model llama3
```

Local models via Ollama and LM Studio require no API key — just a running server.

---

## Architecture

```
agentx (CLI)
  |
  +-- TUI (Ink/React terminal interface)
  |     +-- Agent Engine
  |           +-- Tool Registry (80+ tools)
  |           +-- Session Manager
  |           +-- Permission Gate
  |           +-- Scheduler
  |
  +-- Daemon Mode (background)
        +-- Telegram Bridge
        +-- Message Queue
        +-- Remote Permission Handling
```

---

## Philosophy

Agent-X is built on three principles:

1. **Autonomy with accountability** — The agent acts independently but never bypasses your clearance. Every destructive or sensitive action requires explicit approval.

2. **Local-first** — Your data stays on your machine. Sessions, memories, and configuration live in `~/.config/agentx` and `~/.local/share/agentx`. Nothing phones home.

3. **Provider-agnostic** — No lock-in. Swap between cloud and local models at will. The same tools and workflows work regardless of the AI backend.

---

## License

MIT

---

<p align="center">
  <em>Ground control to Major — systems nominal.</em>
</p>
