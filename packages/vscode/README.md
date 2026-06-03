# Agent-X — AI-Powered Coding Assistant

Agent-X is a native VS Code extension that brings a full-featured autonomous AI agent directly into your editor. Built on a powerful engine with sub-agents, plan mode, RAG, memory, and tool execution.

## Features

- **Chat with AI** — Sidebar chat with streaming responses, markdown rendering, and code syntax highlighting
- **Tool Execution** — 168 built-in tools: file operations, code reading/writing, terminal commands, Git, search, web requests, and more
- **Multi-Provider** — Switch between OpenAI, Anthropic, Google, Ollama, LM Studio, DeepSeek, Groq, Mistral, and others
- **Sub-Agent Delegation** — Spawn autonomous sub-agents for parallel research and task execution
- **Plan Mode** — Review and approve multi-step plans before execution
- **RAG (Retrieval-Augmented Generation)** — Index your workspace and query it for context-aware answers
- **Memory & Personality** — Persistent agent memory, diary, and SOUL.md personality anchor
- **Session Management** — Tree view with history, duplication, export, and checkpoint/restore
- **Steer Messages** — Inject guidance mid-execution without interrupting
- **Background Tasks** — Queue and monitor long-running commands
- **MCP Server Integration** — Connect to MCP servers and call their tools
- **Scheduling** — One-shot and recurring reminders
- **Skills & Reflection** — View bundled/generated skills and reflective learnings
- **Permission System** — Granular risk-based approval with auto-approve rules
- **Scope Guard** — Path validation prevents accessing files outside workspace
- **Crews & Personas** — Switch between agent configurations

## Requirements

- **VS Code** ^1.90.0
- **Node.js** ^18 or ^20 (for engine)
- An API key for your preferred AI provider

## Quick Start

1. Install the extension from the VS Code Marketplace
2. Open the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
3. Run **Agent-X: Open Agent-X Chat** or press `Cmd+Shift+A`
4. Follow the first-run wizard to configure your provider and API key
5. Start chatting with your AI agent!

## Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| `agentx.provider` | Active AI provider | `openai` |
| `agentx.model` | Model ID (empty = provider default) | `""` |
| `agentx.autoApprove` | Permission auto-approval policy | `ask` |
| `agentx.enableSubAgents` | Allow sub-agent spawning | `true` |
| `agentx.enablePlans` | Enable plan mode | `true` |
| `agentx.enableRAG` | Enable RAG workspace indexing | `false` |

## Commands

| Command | Keybinding | Description |
|---------|-----------|-------------|
| `agentx.openChat` | `Cmd+Shift+A` | Open Agent-X Chat |
| `agentx.newSession` | `Cmd+Shift+Alt+N` | New Session |
| `agentx.cancelTask` | `Cmd+Shift+Alt+C` | Cancel Current Task |
| `agentx.switchProvider` | — | Switch AI Provider |
| `agentx.switchModel` | — | Switch Model |
| `agentx.switchCrew` | — | Switch Crew / Persona |
| `agentx.session.switchMode` | — | Switch Session Mode (Agent/Ask/Plan) |

Full list available in the VS Code Command Palette.

## Tree Views

- **Sessions** — History, duplication, export, checkpoint management
- **Permissions** — Approval log with revoke and export
- **Memories** — Global and crew-specific agent memories
- **Diary** — Agent diary entries with highlights and insights
- **Reminders** — Scheduled one-shot and recurring reminders
- **MCP Servers** — Connected MCP servers with explorable tools
- **Skills & Learnings** — Bundled and generated skills, reflective learnings

## Keyboard Shortcuts

- `Cmd+Shift+A` — Open Agent-X Chat
- `Cmd+Shift+Alt+N` — New Session
- `Cmd+Shift+Alt+C` — Cancel Current Task
- `Cmd+Shift+Alt+E` — Explain Selected Code

## Privacy & Security

- All AI requests go directly to your configured provider
- API keys are stored in VS Code SecretStorage (OS keychain)
- File access is restricted to workspace scope by default
- No telemetry unless explicitly enabled

## License

MIT
