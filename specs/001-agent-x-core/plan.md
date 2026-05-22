# Implementation Plan: Agent-X Core Platform

**Branch**: `001-agent-x-core` | **Date**: 2026-05-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-agent-x-core/spec.md`

---

## Summary

Agent-X is a TUI-first AI agent built with React Ink 7.x and TypeScript. It features a setup wizard, animated terminal UI, slash command system, session management, multi-provider AI integration, tool execution with permissions, a Secret Sauce personality system, and Telegram integration. The architecture uses a layered monorepo design that enables both TUI and Web-UI to share a common backend engine.

---

## Technical Context

**Language/Version**: TypeScript 5.5+ (strict mode)

**Runtime**: Node.js 20+ (LTS)

**Primary Dependencies**:
- React Ink 7.x (TUI rendering)
- React 19.x (component model)
- Zod (runtime validation & schema)
- Commander.js (CLI argument parsing)
- keytar or @aspect-build/credential-store (secure credential storage)
- node-telegram-bot-api (Telegram integration)
- tiktoken / gpt-tokenizer (token counting)
- better-sqlite3 (session persistence)
- figlet (ASCII art banner)
- chalk (color utilities)
- nanoid (ID generation)
- conf (configuration management)
- ink-text-input (text input component)
- ink-select-input (list selection)
- ink-spinner (loading spinners)
- ink-gradient (gradient text effects)
- ink-big-text (ASCII banner text)

**AI Provider SDKs**:
- openai (OpenAI)
- @anthropic-ai/sdk (Anthropic)
- @google/generative-ai (Google Gemini)
- ollama (local Llama models)

**Build Tool**: tsup (fast TypeScript bundling with esbuild)

**Package Manager**: pnpm (workspace support)

**Storage**: SQLite via better-sqlite3 (sessions, messages, permissions) + flat markdown files (Secret Sauce)

**Testing**: Vitest + ink-testing-library + @testing-library/react

**Target Platform**: macOS, Linux, Windows (via WSL for full TUI support)

**Project Type**: CLI application (monorepo with shared packages)

**Performance Goals**: <500ms startup, 30fps+ animations, <16ms input latency

**Constraints**: <150MB RSS, offline-capable for local models, terminal min 80 columns

**Scale/Scope**: Single-user local application, unlimited sessions, unlimited tools

---

## Constitution Check

*GATE: All principles verified*

| Principle | Status | Notes |
|-----------|--------|-------|
| UX Above All | ✅ | React Ink + animations + no raw AI output |
| Architecture Integrity | ✅ | Layered monorepo, shared engine |
| Security & Permissions | ✅ | Scope-locked, granular permissions, secure credential storage |
| Quality Standards | ✅ | TypeScript strict, Vitest, 85% coverage target |
| Performance | ✅ | Perf budgets defined, profiling plan in place |
| Versioning | ✅ | SemVer, CHANGELOG, Git tags |
| Extensibility | ✅ | Plugin architecture for tools and providers |
| Developer Experience | ✅ | Single command entry, setup wizard |
| Open Source | ✅ | MIT/Apache license, contributing guide |
| Resilience | ✅ | Graceful degradation, auto-save, crash recovery |

---

## Project Structure

### Documentation (this feature)

```text
specs/001-agent-x-core/
├── plan.md              # This file
├── spec.md              # Functional specification
├── research.md          # Technology research
├── data-model.md        # Data model & schema definitions
├── contracts/
│   └── api-spec.md      # Internal API contracts
└── tasks.md             # Implementation task breakdown
```

### Source Code (repository root)

```text
agent-x/
├── .specify/
│   └── memory/
│       └── constitution.md
├── docs/
│   └── INITIAL_IDEA.txt
├── specs/
│   └── 001-agent-x-core/
├── packages/
│   ├── cli/                          # CLI entry point & argument parsing
│   │   ├── src/
│   │   │   ├── index.ts              # Main entry: `agentx` command
│   │   │   ├── commands/
│   │   │   │   ├── start.ts          # Default command (launch TUI)
│   │   │   │   ├── session.ts        # `agentx session <id>`
│   │   │   │   └── version.ts        # `agentx --version`
│   │   │   └── config.ts             # CLI config resolution
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── tui/                          # React Ink TUI application
│   │   ├── src/
│   │   │   ├── app.tsx               # Root TUI application component
│   │   │   ├── screens/
│   │   │   │   ├── WelcomeScreen.tsx # Main screen with banner + input
│   │   │   │   ├── SetupWizard.tsx   # First-run setup flow
│   │   │   │   └── SessionRestore.tsx # Session restoration screen
│   │   │   ├── components/
│   │   │   │   ├── Banner.tsx        # ASCII art banner with gradient
│   │   │   │   ├── InputField.tsx    # Text input with token counter
│   │   │   │   ├── MessageArea.tsx   # Scrollable message display
│   │   │   │   ├── SessionPanel.tsx  # Side panel with session info
│   │   │   │   ├── CommandList.tsx   # Slash command dropdown
│   │   │   │   ├── PermissionPrompt.tsx # Permission dialog
│   │   │   │   ├── ProfileSelector.tsx  # Profile selection list
│   │   │   │   ├── ModelSelector.tsx    # Model selection list
│   │   │   │   ├── ProviderSelector.tsx # Provider selection
│   │   │   │   ├── TokenBar.tsx      # Animated token progress (color-coded, smooth transitions)
│   │   │   │   ├── ProcessTimer.tsx  # Per-tool/agent elapsed time counter
│   │   │   │   ├── ConsolidatedTimer.tsx # Total elapsed + per-tool breakdown
│   │   │   │   ├── BackgroundTaskIndicator.tsx # Compact bg task status
│   │   │   │   ├── LoadingIndicator.tsx # Multi-variant loading animations
│   │   │   │   ├── ToolAction.tsx    # Tool execution display
│   │   │   │   ├── ScrollableList.tsx   # Generic scrollable list
│   │   │   │   └── ConfirmDialog.tsx    # Yes/No confirmation
│   │   │   ├── hooks/
│   │   │   │   ├── useSlashCommands.ts  # Command detection & filtering
│   │   │   │   ├── useKeybindings.ts    # Global keybinding handler (Tab, double-Esc, etc.)
│   │   │   │   ├── useTokenCounter.ts   # Real-time token tracking
│   │   │   │   ├── useSession.ts        # Session state management
│   │   │   │   ├── useLoadingAnimation.ts # Animation orchestration
│   │   │   │   └── useScrollable.ts     # Scrollable list logic
│   │   │   ├── animations/
│   │   │   │   ├── spinners.ts       # Spinner frame definitions
│   │   │   │   ├── progress.ts       # Progress bar animations
│   │   │   │   ├── thinking.ts       # "Thinking" multi-stage animation
│   │   │   │   └── transitions.ts    # Screen transition effects
│   │   │   └── theme/
│   │   │       ├── colors.ts         # Color palette (amber/gold like Hermes)
│   │   │       ├── layout.ts         # Layout constants
│   │   │       └── typography.ts     # Text styles
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── engine/                       # Core AI engine (shared between TUI & Web)
│   │   ├── src/
│   │   │   ├── index.ts             # Engine entry point
│   │   │   ├── agent/
│   │   │   │   ├── Agent.ts         # Main agent orchestrator
│   │   │   │   ├── MessageProcessor.ts # Message routing & processing
│   │   │   │   ├── MessageSanitizer.ts # Sanitize user input for model consumption
│   │   │   │   ├── ResponseFormatter.ts # Format AI responses for UI
│   │   │   │   ├── SubAgentManager.ts  # Spawn, track, and collect sub-agent results
│   │   │   │   ├── SubAgent.ts         # Worker agent that executes tool tasks
│   │   │   │   ├── TaskAssigner.ts     # Decompose complex tasks into sub-agent assignments
│   │   │   │   ├── TaskManager.ts      # Foreground/background task orchestration, parallel agents
│   │   │   │   ├── SteerMessageHandler.ts # Handle steer messages mid-execution
│   │   │   │   └── ErrorShield.ts      # Catch all internal errors, emit UI gimmicks instead
│   │   │   ├── providers/
│   │   │   │   ├── ProviderInterface.ts # Abstract provider contract
│   │   │   │   ├── OpenAIProvider.ts
│   │   │   │   ├── AnthropicProvider.ts
│   │   │   │   ├── GoogleProvider.ts
│   │   │   │   ├── OllamaProvider.ts   # Local Llama via Ollama
│   │   │   │   ├── LMStudioProvider.ts # LM Studio local
│   │   │   │   └── ProviderRegistry.ts # Dynamic provider registration
│   │   │   ├── tools/
│   │   │   │   ├── ToolRegistry.ts     # Tool registration & discovery (all categories)
│   │   │   │   ├── ToolExecutor.ts     # Safe tool execution with scope
│   │   │   │   ├── ToolSchema.ts       # Zod schemas for tool definitions
│   │   │   │   ├── ToolLoader.ts       # Dynamic tool loading (builtin + plugins)
│   │   │   │   ├── ToolCategories.ts   # Category definitions & risk mappings
│   │   │   │   ├── builtin/
│   │   │   │   │   ├── filesystem/     # file-read, file-write, file-edit, file-delete, file-move, file-copy, file-search, file-diff, file-patch, file-metadata, file-open, folder-create, folder-delete, folder-list, folder-tree, folder-move, folder-open, archive-create, archive-extract
│   │   │   │   │   ├── code/           # code-search, code-grep, code-symbols, code-references, code-format, code-lint, code-fix, code-typecheck, code-analyze
│   │   │   │   │   ├── shell/          # shell-exec, shell-exec-streaming, shell-background, shell-kill, shell-status, process-list, port-check
│   │   │   │   │   ├── git/            # git-status, git-diff, git-log, git-add, git-commit, git-branch, git-checkout, git-push, git-pull, git-stash, git-blame
│   │   │   │   │   ├── packages/       # pkg-install, pkg-uninstall, pkg-update, pkg-list, pkg-outdated, pkg-audit, pkg-search
│   │   │   │   │   ├── web/            # http-request, http-download, web-scrape, web-search, web-browse, api-call
│   │   │   │   │   ├── database/       # db-query, db-execute, db-schema, db-migrate, db-backup
│   │   │   │   │   ├── documents/      # doc-markdown, doc-pdf, doc-html, doc-csv, doc-json, doc-yaml, doc-diagram, doc-docx, doc-excel, doc-presentation, doc-latex
│   │   │   │   │   ├── testing/        # test-run, test-run-single, test-coverage, test-generate, benchmark-run
│   │   │   │   │   ├── containers/     # docker-build, docker-run, docker-stop, docker-logs, docker-compose-up, docker-compose-down
│   │   │   │   │   ├── communication/  # notify-desktop, notify-telegram, notify-slack, notify-webhook, clipboard-read, clipboard-write
│   │   │   │   │   ├── ai/             # ai-complete, ai-embed, ai-summarize, ai-classify, ai-extract, memory-store, memory-recall
│   │   │   │   │   ├── browser/        # browser-open, browser-click, browser-type, browser-screenshot, browser-extract, browser-navigate
│   │   │   │   │   ├── system/         # system-info, system-monitor, cron-create, cron-list, open-app
│   │   │   │   │   ├── security/       # hash-generate, encrypt-file, decrypt-file, jwt-decode, secret-generate
│   │   │   │   │   ├── data/           # json-parse, json-transform, csv-parse, regex-match, regex-replace, text-diff, base64-encode, validate-schema
│   │   │   │   │   ├── github/         # github-issue-create, github-issue-list, github-pr-create, github-pr-review, github-release
│   │   │   │   │   ├── media/          # image-resize, image-convert, image-compress, image-ocr, chart-generate, qr-generate
│   │   │   │   │   └── mcp/            # mcp-server-connect, mcp-tool-list, mcp-tool-call, mcp-resource-read
│   │   │   │   ├── plugins/
│   │   │   │   │   ├── PluginLoader.ts  # Load custom tools from ~/.config/agentx/plugins/
│   │   │   │   │   └── MCPBridge.ts    # Bridge MCP server tools into ToolRegistry
│   │   │   │   └── permissions/
│   │   │   │       ├── PermissionManager.ts
│   │   │   │       ├── ScopeGuard.ts   # Enforce scope boundaries
│   │   │   │       ├── RiskPolicy.ts   # Auto-permission for Low risk, prompt for Medium+
│   │   │   │       └── PermissionStore.ts
│   │   │   ├── secret-sauce/
│   │   │   │   ├── SecretSauceManager.ts # Orchestrates all MD files
│   │   │   │   ├── SoulManager.ts       # SOUL.MD read/write
│   │   │   │   ├── ProfileManager.ts    # PROFILE.MD management
│   │   │   │   ├── MemoryManager.ts     # MEMORIES.MD with summarization
│   │   │   │   ├── DiaryManager.ts      # DIARY.MD daily tracking
│   │   │   │   ├── IdentityManager.ts   # IDENTITY.MD persona
│   │   │   │   └── Summarizer.ts        # Auto-summarization logic
│   │   │   ├── session/
│   │   │   │   ├── SessionManager.ts    # Create/restore/persist sessions
│   │   │   │   ├── SessionStore.ts      # SQLite session persistence
│   │   │   │   ├── SessionCompactor.ts  # Context compaction via content.txt
│   │   │   │   └── TokenTracker.ts      # Real-time token accounting
│   │   │   ├── commands/
│   │   │   │   ├── CommandRegistry.ts   # Slash command registration
│   │   │   │   ├── CommandParser.ts     # Parse "/" input locally
│   │   │   │   ├── builtin/
│   │   │   │   │   ├── help.ts
│   │   │   │   │   ├── exit.ts
│   │   │   │   │   ├── clear.ts
│   │   │   │   │   ├── sessions.ts
│   │   │   │   │   ├── profile.ts
│   │   │   │   │   ├── model.ts
│   │   │   │   │   ├── provider.ts
│   │   │   │   │   ├── telegram.ts
│   │   │   │   │   ├── tools.ts
│   │   │   │   │   ├── permissions.ts
│   │   │   │   │   ├── bg.ts            # Move current task to background
│   │   │   │   │   ├── tasks.ts         # List active/completed background tasks
│   │   │   │   │   └── version.ts
│   │   │   │   └── CommandInterface.ts
│   │   │   └── config/
│   │   │       ├── ConfigManager.ts     # Configuration CRUD
│   │   │       ├── ConfigSchema.ts      # Zod config validation
│   │   │       └── paths.ts            # XDG-compliant path resolution
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── web/                          # Web-UI (future, shares engine)
│   │   ├── src/
│   │   │   └── (placeholder)
│   │   └── package.json
│   │
│   └── shared/                       # Shared types & utilities
│       ├── src/
│       │   ├── types/
│       │   │   ├── session.ts
│       │   │   ├── message.ts
│       │   │   ├── provider.ts
│       │   │   ├── tool.ts
│       │   │   ├── profile.ts
│       │   │   ├── permission.ts
│       │   │   └── config.ts
│       │   ├── constants/
│       │   │   ├── providers.ts
│       │   │   ├── commands.ts
│       │   │   └── version.ts
│       │   └── utils/
│       │       ├── id.ts             # Nanoid wrappers
│       │       ├── paths.ts          # Path utilities
│       │       ├── tokens.ts         # Token counting utilities
│       │       └── validation.ts     # Common validators
│       ├── package.json
│       └── tsconfig.json
│
├── data/                             # Runtime data (gitignored except templates)
│   └── secret-sauce/
│       ├── SOUL.md                   # Agent soul template
│       ├── PROFILE.md                # Default profiles
│       ├── MEMORIES.md               # Empty template
│       ├── DIARY.md                  # Empty template
│       ├── IDENTITY.md              # Default identity
│       └── PERMISSION.md            # Permission schema
│
├── scripts/
│   ├── install.sh                   # curl installation script
│   ├── build.sh                     # Production build
│   └── release.sh                   # Release automation
│
├── docker/
│   ├── Dockerfile                   # Multi-stage production build
│   └── docker-compose.yml           # Development compose
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                   # Lint + test + build
│   │   ├── release.yml              # Publish to npm + Docker Hub + GitHub Releases (curl binary)
│   │   └── security.yml             # Dependency audit
│   └── ISSUE_TEMPLATE/
│       ├── bug.md
│       ├── feature.md
│       └── tool-request.md
│
├── package.json                     # Root workspace config
├── pnpm-workspace.yaml              # pnpm workspace definition
├── tsconfig.base.json              # Shared TS config
├── vitest.config.ts                # Test configuration
├── .eslintrc.cjs                   # ESLint config
├── .prettierrc                     # Prettier config
├── CHANGELOG.md
├── LICENSE
└── README.md
```

**Structure Decision**: Monorepo with pnpm workspaces. Four packages: `cli` (entry point), `tui` (React Ink UI), `engine` (core logic), `shared` (types/utils). This enables the Web-UI to import `engine` directly while keeping TUI-specific code isolated.

---

## Architecture Layers

```
┌─────────────────────────────────────────────────────┐
│                    CLI Layer                          │
│  (commander.js: argument parsing, entry routing)     │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│               Presentation Layer                     │
│  ┌──────────────────┐  ┌─────────────────────────┐  │
│  │   TUI (React Ink)│  │   Web-UI (Future)       │  │
│  │   - Screens      │  │   - React SPA           │  │
│  │   - Components   │  │   - WebSocket client    │  │
│  │   - Animations   │  │                         │  │
│  └────────┬─────────┘  └────────────┬────────────┘  │
└───────────┼──────────────────────────┼──────────────┘
            │                          │
┌───────────▼──────────────────────────▼──────────────┐
│               Engine Layer (Shared Core)             │
│  ┌─────────────┐ ┌──────────┐ ┌─────────────────┐  │
│  │    Agent    │ │  Session  │ │  Secret Sauce   │  │
│  │ Orchestrator│ │  Manager  │ │   Manager       │  │
│  └──────┬──────┘ └─────┬────┘ └────────┬────────┘  │
│         │               │               │           │
│  ┌──────▼──────┐ ┌─────▼────┐ ┌────────▼────────┐  │
│  │   Command   │ │   Token  │ │   Summarizer    │  │
│  │   Registry  │ │  Tracker │ │                  │  │
│  └─────────────┘ └──────────┘ └─────────────────┘  │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │              Tool Execution Pipeline            │ │
│  │  Request → Permission Check → Scope Guard →    │ │
│  │  Execute → Format Result → Return to UI        │ │
│  └─────────────────────────────────────────────────┘ │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│               Provider Layer                         │
│  ┌────────┐ ┌──────────┐ ┌────────┐ ┌───────────┐  │
│  │ OpenAI │ │Anthropic │ │ Google │ │Local(Ollama│  │
│  │Provider│ │ Provider │ │Provider│ │/LM Studio) │  │
│  └────────┘ └──────────┘ └────────┘ └───────────┘  │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│               Storage Layer                          │
│  ┌──────────────────┐  ┌──────────────────────────┐ │
│  │  SQLite Database │  │  Filesystem (Markdown)   │ │
│  │  - Sessions      │  │  - Secret Sauce files    │ │
│  │  - Messages      │  │  - Config (XDG paths)    │ │
│  │  - Permissions   │  │  - Scope folder access   │ │
│  │  - Token logs    │  │                          │ │
│  │  - Agent tasks   │  │                          │ │
│  └──────────────────┘  └──────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

---

## Key Architectural Decisions

### 1. Event-Driven Communication (Engine ↔ UI)

The engine emits typed events that the UI subscribes to. This decouples the rendering from business logic and enables multiple frontends.

```typescript
// Engine events
type EngineEvent =
  | { type: 'processing_start'; taskDescription: string }
  | { type: 'processing_progress'; stage: string; progress: number }
  | { type: 'processing_complete'; result: FormattedResponse }
  | { type: 'permission_required'; tool: string; path: string }
  | { type: 'token_update'; used: number; available: number }
  | { type: 'error'; code: string; message: string; recoverable: boolean }
  | { type: 'tool_executing'; tool: string; description: string; startTime: number }
  | { type: 'tool_complete'; tool: string; result: ToolResult; elapsed: number }
  | { type: 'agent_spawned'; agentId: string; task: string; startTime: number }
  | { type: 'agent_progress'; agentId: string; status: string }
  | { type: 'agent_complete'; agentId: string; summary: string; elapsed: number }
  | { type: 'task_consolidated_time'; totalElapsed: number; breakdown: Array<{ tool: string; elapsed: number }> }
  | { type: 'task_backgrounded'; taskId: string }   // Task moved to background
  | { type: 'steer_message'; taskId: string; instruction: string } // User steering mid-task
  | { type: 'background_task_complete'; taskId: string; summary: string }
  | { type: 'reasoning_start' }
  | { type: 'reasoning_glimpse'; text: string }   // e.g. "Analyzing project structure..."
  | { type: 'reasoning_complete' }                 // Triggers UI collapse → execution phase
  | { type: 'task_abort_requested' }               // User triggered double-Esc abort
  | { type: 'task_aborted'; reason: string }       // All sub-agents/tools cancelled
  | { type: 'compaction_start'; currentTokens: number; threshold: number }
  | { type: 'compaction_complete'; saved: number } // Tokens freed by compaction
```

### 2. Provider Abstraction Pattern

All AI providers implement a common interface. Switching providers requires zero code changes in the engine or UI.

```typescript
interface AIProvider {
  readonly id: string;
  readonly name: string;
  validate(credentials: ProviderCredentials): Promise<boolean>;
  listModels(): Promise<ModelInfo[]>;
  complete(request: CompletionRequest): AsyncGenerator<CompletionChunk>;
  countTokens(text: string): number;
}
```

### 3. Tool Execution Pipeline

Every tool call passes through a strict pipeline:
1. **Intent Detection** → Engine identifies tool need from conversation
2. **Task Assignment** → TaskAssigner decomposes into sub-agent tasks if complex
3. **Sub-Agent Spawn** → SubAgentManager creates workers with specific instructions
4. **Permission Check** → PermissionManager checks session grants (bubbles to user if needed)
5. **Scope Guard** → ScopeGuard validates target path is within scope
6. **Execution** → Sub-agent executes tool handler with timeout and error boundaries
7. **Error Shielding** → ErrorShield catches any internal failure, converts to UI gimmick
8. **Result Aggregation** → SubAgentManager collects all worker results
9. **Response Formatting** → ResponseFormatter composes clean user-facing output
10. **UI Update** → Event emitted for display (animated, never raw)

### 4. Sub-Agent (Worker) Architecture

Sub-agents are lightweight, stateless workers. They do NOT have their own AI context — they receive precise instructions from the orchestrator and execute tools.

```typescript
interface SubAgent {
  id: string;
  parentSessionId: string;
  task: TaskAssignment;
  status: 'queued' | 'running' | 'completed' | 'failed';
  tools: string[];           // Allowed tool IDs for this task
  result: SubAgentResult | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

interface TaskAssignment {
  id: string;
  instruction: string;       // What the model wants done (structured)
  tools: string[];           // Tools this agent can use
  scope: string;             // Scope boundary
  timeout: number;           // Max execution time
  priority: 'high' | 'normal' | 'low';
  parallel: boolean;         // Can run alongside other agents
}
```

**Key Principle**: Sub-agents are invisible to the user. The UI shows:
- **Tool names & actions in progress**: e.g., "Reading package.json", "Running tests", "Writing src/utils.ts"
- **Per-process timer**: each active tool/agent shows elapsed seconds (e.g., "Running tests... 4.2s")
- **Multi-stage progress animations** with descriptive labels of what's happening
- **"3 tasks in progress"** as a subtle activity indicator
- **Consolidated time summary** at completion: total time + per-tool breakdown
- NEVER: model prompts, model responses, structured instructions, raw tool input/output JSON, agent-to-agent messages, or internal errors

**Disclosure Rule**: The user can see WHAT tools are being used and WHAT actions are happening (human-readable descriptions). The user must NEVER see the input/output between the model and agents — no prompts, no raw completions, no structured data passed between orchestrator and workers. This boundary is absolute.

### 4.5. Background Tasks, Steering & Parallel Agents

These are core traits that make Agent-X truly powerful — not just a sequential chat bot:

**Background Task Switching**:
- User can move any running task to background via `/bg` command or Ctrl+B keybinding
- Background tasks continue execution silently; session panel shows compact indicators (task name + timer)
- When a background task completes, result is queued and presented when user is not mid-input
- User can run `/tasks` to see all active/completed background tasks
- Background tasks share the same permission grants as foreground

**Steer Messages**:
- While the agent is mid-execution (reasoning or tool execution phase), the user can type a new message
- This "steer message" does NOT cancel the current work — it augments/redirects it
- The orchestrator receives the steer message and can: (a) pass it to active sub-agents as additional instruction, (b) adjust task decomposition, (c) cancel irrelevant sub-agents and spawn new ones
- Example: Agent is refactoring 10 files. User types "actually skip the test files" → orchestrator cancels test-file sub-agents, continues with the rest
- Steer messages are rate-limited (max 1 per 3 seconds) to prevent flooding

**Parallel Multi-Agent Orchestration**:
- The orchestrator can spawn multiple independent agent groups working on different user requests simultaneously
- Each parallel task has its own set of sub-agents, progress tracking, timers, and result queue
- User can have one foreground task (with full progress UI) and N background tasks
- Example flow: User asks "Research X" → starts in foreground → user sends `/bg` → types new request → two tasks now running in parallel
- Resource management: token budget is shared across all active tasks; orchestrator prioritizes foreground

```typescript
interface TaskContext {
  id: string;
  mode: 'foreground' | 'background';
  agents: SubAgent[];
  startedAt: number;
  steerMessages: string[];       // Accumulated steer messages
  status: 'reasoning' | 'executing' | 'completed' | 'failed';
  result: FormattedResponse | null;
  elapsedMs: number;
  tokenBudget: number;           // Allocated portion of session budget
}
```

**Reasoning Glimpse System**: When the agent receives a user request, the model first reasons about HOW to approach it (like Claude's extended thinking or Copilot's reasoning). These reasoning steps are shown to the user as fleeting, animated glimpses — short phrases that convey the agent is thinking deeply:

```
┌─────────────────────────────────────────────────────┐
│  💭 "Analyzing the project structure..."            │
│  💭 "Considering 3 approaches for this refactor..." │
│  💭 "Planning file changes across 5 modules..."    │
│  💭 "Checking for potential side effects..."       │
└─────────────────────────────────────────────────────┘
         ↓ (reasoning done, collapses to progress bar)
┌─────────────────────────────────────────────────────┐
│  ⚡ Executing plan — 5 tasks in progress            │
│  ├─ Writing src/utils/parser.ts                     │
│  ├─ Updating src/index.ts                           │
│  └─ Running tests...                                │
└─────────────────────────────────────────────────────┘
```

**Reasoning Lifecycle**:
1. User sends request → Agent enters **reasoning phase**
2. Model produces reasoning tokens → UI shows animated glimpse lines (ephemeral, fading in/out)
3. Reasoning completes → glimpse collapses/fades away
4. Execution phase begins → UI switches to tool action progress display
5. Execution completes → Final response shown

**What reasoning glimpses show**: High-level thinking summaries ("Considering approach A vs B", "Identified 3 files to modify", "Planning test strategy")
**What reasoning glimpses NEVER show**: Raw model tokens, full reasoning chains, internal JSON, tool schemas, prompt content

**Why this matters**: This builds user trust. The user sees the agent is genuinely thinking about their problem — not just spinning a loader. It mirrors the experience of watching a senior engineer think out loud before acting.

### 5. Message Sanitization Layer

User messages are NEVER passed directly to the AI model. They go through a sanitization pipeline:

```
User Input → MessageSanitizer → Structured Model Prompt → AI Model → Response
```

**Sanitization Steps**:
1. **Intent Extraction** — Determine what the user actually wants (command? question? task?)
2. **Context Injection** — Attach relevant Secret Sauce, session history, scope info
3. **Prompt Structuring** — Format into optimal prompt structure for the active model
4. **Tool Hinting** — If task likely needs tools, pre-format tool descriptions
5. **Safety Filtering** — Remove anything that could cause prompt injection or leak internals
6. **Output Directive** — Append instructions telling the model to produce structured, executable output

The model receives a clean, structured prompt that is optimized for producing output that sub-agents can parse and execute. The user's raw text is embedded within a controlled structure — never sent as-is.

### 6. Error Shielding (No Internal Errors to User)

Every layer has an ErrorShield wrapper:

```typescript
class ErrorShield {
  static wrap<T>(operation: () => Promise<T>, fallbackEvent: EngineEvent): Promise<T | null> {
    try {
      return await operation();
    } catch (error) {
      // Log internally for debugging
      logger.error(error);
      // Emit a user-friendly gimmick event instead
      eventBus.emit(fallbackEvent);
      return null;
    }
  }
}
```

**Rules**:
- Internal errors → logged to `~/.local/share/agentx/logs/` for debugging
- User sees → animated "processing" gimmick, or a polite "Let me try a different approach"
- Stack traces, API errors, file system errors → NEVER reach the UI
- If truly unrecoverable → show "Something unexpected happened. Session saved." with recovery option

### 7. Secret Sauce Integration Strategy

The Secret Sauce files are injected into the system prompt dynamically:
- **SOUL.MD** → Always included (identity foundation)
- **IDENTITY.MD** → Always included (persona traits)
- **PROFILE.MD** → Active profile's content included
- **MEMORIES.MD** → Relevant memories selected by recency/relevance
- **DIARY.MD** → Today's entry + summary of recent days
- **PERMISSION.MD** → Current session permissions state

Token budget for Secret Sauce: 20% of model's context window, with intelligent truncation.

### 7.5. Session Compaction Strategy

When a session's conversation history grows large (approaching context window limits), the agent proactively compacts it:

**Mechanism**:
1. **Trigger**: When token usage exceeds 70% of model's context window, compaction is initiated
2. **content.txt scratch file**: A temporary `content.txt` file is written in `~/.cache/agentx/` containing a structured summary of the session so far (key decisions, active tasks, file states, user preferences expressed)
3. **Compaction**: Older messages are replaced in-context with the summary from `content.txt`. The full message history remains in SQLite for session restore, but the active context is trimmed
4. **Cleanup**: `content.txt` is cleared (truncated to 0 bytes) immediately after the summary is consumed back into the context window
5. **UI Progress**: During compaction, the UI shows an animated indicator: "Optimizing session memory..." (uses Pulse/Glow animation)

**Rules**:
- `content.txt` is ephemeral — exists only during compaction, cleared after use
- Compaction preserves: last N user messages verbatim, all active tool results, and the structured summary
- User is never interrupted — compaction happens between turns
- Compacted sessions still restore fully from SQLite (full history)
- Multiple compactions can occur in a long session (each builds on the previous summary)

```typescript
interface CompactionResult {
  originalTokens: number;
  compactedTokens: number;
  summaryPath: string;        // ~/.cache/agentx/content.txt
  preservedMessages: number;  // Recent messages kept verbatim
  cleared: boolean;           // true after content.txt is wiped
}
```

### 8. Animation Strategy

Multiple animation types communicate different processing states:
- **Reasoning Glimpse** → Ephemeral thought bubbles during model reasoning ("Analyzing structure...", "Planning approach...") — fades in/out, collapses when reasoning completes
- **Spinner** → Quick operation, expecting result soon
- **Progress Bar** → Known-length operation (file processing, etc.)
- **Multi-stage Indicator** → Complex reasoning (shows stages like "Analyzing...", "Planning...", "Composing...")
- **Tool Action List** → During execution phase, shows active tools and their human-readable actions
- **Pulse/Glow** → Background activity (memory summarization, etc.)
- **Typing Effect** → Response streaming (character-by-character appearance)

**Phase Transitions**:
```
User Input → [Reasoning Glimpse phase] → [Execution Progress phase] → [Response Streaming phase]
```

All animations use React Ink's `useAnimation` hook with shared timer consolidation.

### 9. Configuration & Data Storage Paths

Following XDG Base Directory Specification:
```
~/.config/agentx/          # Configuration
  ├── config.json          # Provider, model, preferences, org/contact, UI settings
  ├── credentials.enc      # Encrypted API keys (via keytar)
  └── plugins/             # User-installed plugin tools

~/.local/share/agentx/    # Application data
  ├── db/
  │   └── agentx.db       # SQLite (sessions, messages, permissions)
  ├── secret-sauce/        # Personality files
  │   ├── SOUL.md
  │   ├── PROFILE.md
  │   ├── MEMORIES.md
  │   ├── DIARY.md
  │   ├── IDENTITY.md
  │   └── PERMISSION.md
  └── logs/                # Debug logs (rotated)

~/.cache/agentx/           # Cache
  ├── models.json          # Cached model lists
  └── content.txt          # Ephemeral compaction scratch (cleared after each use)
```

---

## Implementation Phases

### Phase 0: Foundation (Blocking)
- Project scaffolding with pnpm workspace
- TypeScript configuration
- Build pipeline (tsup)
- Core type definitions
- Configuration management
- Storage layer (SQLite + filesystem)

### Phase 1: Engine Core
- Provider abstraction & registry
- OpenAI provider implementation
- Message processing pipeline
- Token tracking
- Session lifecycle management

### Phase 2: TUI Shell
- React Ink application shell
- Banner component
- Input field with basic interaction
- Screen routing (wizard vs. main)
- Theme system (colors, layout)

### Phase 3: Setup Wizard
- Provider selection screen
- Credential input
- Model fetching & selection
- Configuration persistence
- Wizard navigation (back/cancel/confirm)

### Phase 4: Main Interaction Loop
- Message sending & receiving
- Loading animations
- Response rendering
- Token progress bar (real-time, smooth animated transitions, color-coded green→amber→red)
- Per-process timer (counts elapsed time per active tool/agent)
- Consolidated timer (total elapsed shown at task completion with breakdown)
- Session panel

### Phase 5: Slash Commands & Input Keybindings
- Command registry
- "/" detection & filtering
- Command list UI (scrollable)
- Tab autocomplete (fills command into input, does NOT execute)
- Enter to execute selected/typed command
- Double-Esc to abort active task (with confirmation dialog)
- Built-in commands implementation

### Phase 6: Tool System (Core)
- Tool registry, loader & schema
- Permission manager + RiskPolicy (auto-allow Low, prompt Medium+)
- Scope guard
- Core builtin tools (file-read, file-write, file-edit, file-delete, folder-create, folder-delete, folder-list)
- Shell-exec (with timeout + sandbox)
- Tool execution UI

### Phase 6.5: Sub-Agent & Message Sanitization
- Sub-agent manager & worker implementation
- Task assignment & decomposition
- Agent TODO list system (internal task tracking for multi-step workflows)
- Message sanitization pipeline
- Error shielding layer
- Agent progress UI animations
- Background tasks, steer messages, parallel agent orchestration

### Phase 7: Secret Sauce
- MD file management
- System prompt injection
- Memory summarization
- Diary tracking
- Profile switching

### Phase 8: Session Management
- Session persistence
- Session restoration
- Session listing
- Multi-session support

### Phase 9: Additional Providers
- Anthropic provider
- Google provider
- Ollama provider (local)
- LM Studio provider (local)

### Phase 10: Telegram Integration
- Bot setup wizard
- Message bridge
- Session sharing across channels

### Phase 11: Distribution (Priority Order)
1. **curl install script** (primary) — `curl -fsSL https://github.com/agentx/install.sh | bash`
   - Auto-detect OS (macOS/Linux) and architecture (x64/arm64)
   - Download pre-built binary from GitHub Releases
   - Install to `/usr/local/bin/agentx` (or `~/.local/bin/` if no sudo)
   - Verify checksum (SHA-256)
   - Post-install: print version + "Run `agentx` to get started"
2. **npm package** — `npm install -g @agentx/cli`
   - Package published to npm registry under `@agentx` org scope
   - `bin` entry in package.json maps to bundled CLI
   - Postinstall script prints welcome message
3. **Docker image** — `docker run -it agentx/agent-x`
   - Multi-stage Dockerfile (build → alpine production)
   - Published to Docker Hub as `agentx/agent-x`
   - Supports `-v` volume mount for scope folder
   - Interactive TTY mode by default for TUI
4. **brew** (bonus, self-managed tap) — `brew install agentx/tap/agentx`
   - Homebrew formula maintained in repo (`Formula/agentx.rb`)
   - Points to GitHub Release binary — no external approval needed
   - Auto-updated by release pipeline
- CI/CD: GitHub Actions release pipeline (build → test → publish all 4 channels)

### Phase 12: Tool Expansion — Power User Tier
- Tool infrastructure (ToolLoader, ToolCategories, PluginLoader, MCPBridge)
- Filesystem complete set (file-edit, file-move, file-copy, file-search, file-diff, file-patch, archive-*)
- Code intelligence (code-search, code-grep, code-symbols, code-references, code-format, code-lint, code-fix, code-typecheck)
- Shell & process (shell-exec-streaming, shell-background, shell-kill, process-list, port-check)
- Git (git-status, git-diff, git-log, git-add, git-commit, git-branch, git-checkout, git-push, git-pull, git-stash)
- Package managers (pkg-install, pkg-uninstall, pkg-update, pkg-list, pkg-outdated, pkg-audit)
- Document generation (doc-markdown, doc-pdf, doc-html, doc-csv, doc-json, doc-yaml, doc-diagram, doc-docx, doc-excel, doc-presentation, doc-latex)", "oldString": "- Document generation (doc-markdown, doc-pdf, doc-html, doc-csv, doc-json, doc-yaml, doc-diagram)"
- Testing (test-run, test-run-single, test-coverage, test-generate, benchmark-run)
- Data processing (json-parse, json-transform, csv-parse, regex-match, text-diff, validate-schema)

### Phase 13: Tool Expansion — Advanced Tier
- Web/network (http-request, web-scrape, web-search, web-browse, api-call)
- Browser automation (browser-open, browser-click, browser-type, browser-screenshot, browser-extract)
- Database (db-query, db-execute, db-schema, db-migrate)
- Containers (docker-build, docker-run, docker-stop, docker-logs, docker-compose-*)
- AI meta-tools (ai-complete, ai-embed, ai-summarize, ai-classify, memory-store, memory-recall)
- Communication (notify-desktop, notify-telegram, notify-slack, clipboard-read, clipboard-write)

### Phase 14: Tool Expansion — Ecosystem & Specialist Tier
- GitHub integration (issue-create, pr-create, pr-review, release)
- System/OS (system-info, system-monitor, cron-create, open-app)
- Security (hash-generate, encrypt/decrypt-file, jwt-decode, secret-generate)
- Media (image-resize, image-convert, image-ocr, chart-generate, qr-generate)
- MCP integration (mcp-server-connect, mcp-tool-list, mcp-tool-call, mcp-resource-read)

### Phase 15: Polish & Hardening
- Error handling refinement
- Performance optimization
- Accessibility (screen reader support)
- Documentation
- Security audit
- Full tool integration verification (263 tools across 20 categories)

---

## Complexity Tracking

| Decision | Justification | Simpler Alternative Rejected Because |
|----------|---------------|--------------------------------------|
| Monorepo with 4 packages | TUI and Web-UI need shared engine; types shared everywhere | Single package would make Web-UI addition require massive refactor |
| SQLite for sessions | Structured queries, concurrent access, no external deps | JSON files break under concurrent access and lack query capability |
| Event-driven engine↔UI | Multiple frontends, testability, async operations | Direct function calls would couple UI to engine, blocking Web-UI |
| pnpm workspaces | Strict dependency isolation, fast installs, proven at scale | npm workspaces lack strictness; yarn has unnecessary complexity for this scale |
| Sub-agents as stateless workers | Parallel execution, failure isolation, clean separation | Single-threaded sequential execution is too slow for complex multi-tool tasks |
| Message sanitization layer | Security, prompt optimization, structured output | Passing raw user text produces unpredictable model output and leaks internals |
| Error shielding at every layer | User never sees internals, professional UX | Letting errors bubble creates jarring, unprofessional experience |
| 20 tool categories with risk levels | Organized toolset, auto-permission for safe tools, clear boundaries | Flat tool list becomes unmanageable at 263 tools and can't apply smart permission policies |
| Plugin/MCP bridge architecture | Users extend without forking; community tools possible | Hardcoding all tools limits growth and prevents ecosystem formation |
