# Agent-X

A TUI-first AI agent built with React Ink and TypeScript. Features multi-provider LLM integration, tool execution with permissions, session management, a "Secret Sauce" personality system, sub-agents, Telegram integration, and browser automation.

## Quick Start

```bash
# Prerequisites: Node.js >= 20, pnpm >= 9
pnpm install
pnpm build
pnpm dev
```

## Architecture

```
packages/
├── shared/     # Types, schemas, utilities shared across all packages
├── engine/     # Core AI engine: providers, tools, sessions, agents
├── tui/        # Terminal UI built with React Ink 5
├── cli/        # CLI entry point (launches TUI)
└── web/        # Web UI (placeholder)
```

### Monorepo Structure

- **@agentx/shared** — Zod schemas, type definitions, token utilities, ID generators
- **@agentx/engine** — Provider abstraction (OpenAI, Anthropic, Google, Ollama, LM Studio), tool executor with permission system, session persistence (SQLite), Secret Sauce personality engine, sub-agent orchestration, Telegram bridge, crash recovery
- **@agentx/tui** — Animated terminal interface with streaming responses, command palette, permission prompts, token bar, session panel
- **@agentx/cli** — Entry point that bootstraps the TUI app

## Features

### Multi-Provider AI
Switch between providers on the fly:
- OpenAI (GPT-4o, o1, etc.)
- Anthropic (Claude 3.5/4)
- Google (Gemini)
- Ollama (local models)
- LM Studio (local models)

### Tool Execution
80+ built-in tools across categories:
- **Filesystem** — read, write, delete, move, list files/folders
- **Shell** — execute commands, background processes
- **Git** — status, diff, log, commit, branch, stash, blame
- **Code Intelligence** — search, definitions, symbols, replace, insert
- **Packages** — install, remove, list, outdated, run scripts
- **Testing** — run, watch, coverage, generate tests
- **Web/HTTP** — GET, POST, scrape, search
- **Browser Automation** — open pages, click, screenshot, evaluate JS (Playwright)
- **Containers** — Docker management, compose, logs
- **Database** — query, schema, export
- **GitHub** — issues, PRs, repos, workflows, releases
- **System** — info, disk, env, ports, security audit
- **MCP** — call Model Context Protocol servers, list tools

### Permission System
- Scope-based path validation (no escaping project root)
- Risk-level assessment per tool (low/medium/high/critical)
- Interactive permission prompts (allow once / allow always / deny)
- Persistent permission grants

### Secret Sauce
Personality system that shapes agent behavior:
- **Soul** — Core identity and values
- **Profile** — Active persona configuration
- **Memories** — Accumulated interaction context
- **Diary** — Session-level reflections

### Sub-Agents
Spawn lightweight sub-agents for delegated tasks with isolated tool access and automatic lifecycle management.

### Telegram Bridge
Remote interaction via Telegram bot:
- Long-polling or webhook mode
- User allow-list for security
- Shared session context with TUI
- Message chunking for long responses

### Session Management
- SQLite-backed persistence (WAL mode)
- Auto-save every 30 seconds
- Crash recovery with session state restoration
- Token tracking per session

### TUI Features
- Streaming response rendering with markdown
- Slash commands (`/help`, `/model`, `/session`, `/clear`, etc.)
- Tab autocomplete for commands
- Animated loading indicators
- Token usage bar
- Session panel with elapsed time
- Permission prompt dialogs
- Setup wizard for first-time configuration

## Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/model <name>` | Switch AI model |
| `/provider <name>` | Switch provider |
| `/session list` | List saved sessions |
| `/session restore <id>` | Restore a session |
| `/clear` | Clear message history |
| `/compact` | Summarize and compact context |
| `/permissions` | Manage tool permissions |
| `/telegram setup` | Configure Telegram bot |
| `/telegram status` | Show Telegram connection status |
| `/exit` | Exit Agent-X |

## Development

```bash
# Run in development mode (hot reload)
pnpm dev

# Type check all packages
pnpm typecheck

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Build all packages
pnpm build

# Format code
pnpm format
```

## Configuration

Agent-X stores configuration in XDG-compliant paths:
- **Config**: `~/.config/agentx/config.json`
- **Data**: `~/.local/share/agentx/` (sessions, memories)
- **Cache**: `~/.cache/agentx/` (crash recovery)

### Config File

```json
{
  "provider": {
    "activeProvider": "anthropic",
    "activeModel": "claude-sonnet-4-20250514",
    "providers": {
      "anthropic": { "apiKey": "sk-..." },
      "openai": { "apiKey": "sk-..." }
    }
  },
  "session": {
    "autoSave": true,
    "maxHistory": 100
  },
  "organization": "My Org"
}
```

## Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript 5.9 (strict mode, ESM only)
- **Build**: tsup (esbuild-based bundler)
- **TUI**: React 18 + Ink 5
- **Database**: better-sqlite3 (WAL mode)
- **Testing**: Vitest
- **Package Manager**: pnpm 9 (workspaces)
- **CI/CD**: GitHub Actions (triggers on `release` branch)

## License

MIT
