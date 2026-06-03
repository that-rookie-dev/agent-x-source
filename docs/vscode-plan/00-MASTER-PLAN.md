# Agent-X Native VS Code Extension — Master Implementation Plan

> **Status**: 🟡 Planning Complete — Ready for Implementation
> **Created**: 2026-06-03
> **Goal**: Build a fully native VS Code extension that embeds the Agent-X engine with 100% feature parity to the TUI/Web-UI, without modifying any existing TUI/Web-UI code paths.

---

## 0. Document Index

| Document | Phase | Focus | Status |
|----------|-------|-------|--------|
| [01-SCAFFOLDING.md](./01-SCAFFOLDING.md) | Phase 1 | Extension project setup, build config, package.json | ⬜ Not Started |
| [02-ENGINE-ADAPTER.md](./02-ENGINE-ADAPTER.md) | Phase 2 | Additive engine changes, VSCodeEngine wrapper | ⬜ Not Started |
| [03-EXTENSION-CORE.md](./03-EXTENSION-CORE.md) | Phase 3 | Activation, commands, status bar, config reading | ⬜ Not Started |
| [04-CHAT-WEBVIEW.md](./04-CHAT-WEBVIEW.md) | Phase 4 | Sidebar webview, message rendering, streaming UI | ⬜ Not Started |
| [05-TOOL-ADAPTATION.md](./05-TOOL-ADAPTATION.md) | Phase 5 | VS Code tool adapters for all 165 tools | ⬜ Not Started |
| [06-PERMISSIONS-AND-SCOPE.md](./06-PERMISSIONS-AND-SCOPE.md) | Phase 6 | Permission modals, scope guard, path validation | ⬜ Not Started |
| [07-SESSION-MANAGEMENT.md](./07-SESSION-MANAGEMENT.md) | Phase 7 | TreeView, persistence, restore, export, checkpoints | ⬜ Not Started |
| [08-PROVIDER-MODEL-CREW.md](./08-PROVIDER-MODEL-CREW.md) | Phase 8 | Provider/model/crew switching UI | ⬜ Not Started |
| [09-SECRET-SAUCE-AND-MEMORY.md](./09-SECRET-SAUCE-AND-MEMORY.md) | Phase 9 | Personality, memory, diary, identity integration | ⬜ Not Started |
| [10-ADVANCED-FEATURES.md](./10-ADVANCED-FEATURES.md) | Phase 10 | Sub-agents, plans, RAG, steer, background tasks | ⬜ Not Started |
| [11-INTEGRATION-TESTING-PACKAGING.md](./11-INTEGRATION-TESTING-PACKAGING.md) | Phase 11 | Tests, VSIX packaging, CI/CD, marketplace prep | ⬜ Not Started |

---

## 1. Architecture Overview

### 1.1 Current Architecture (TUI / Web-UI)

```
┌─────────────────────────────────────────────────────────┐
│                    CLI (packages/cli)                    │
│  agentx command → Ink/React TUI or spawns web-api       │
└──────────────┬──────────────────────────┬───────────────┘
               │                          │
    ┌──────────▼──────────┐    ┌──────────▼──────────┐
    │   TUI (packages/tui)│    │ Web-API (web-api/)  │
    │  Ink/React terminal │    │ Express + WebSocket  │
    │  useSession hook    │    │ engine.ts singleton  │
    └──────────┬──────────┘    └──────────┬──────────┘
               │                          │
               └──────────┬───────────────┘
                          │
               ┌──────────▼──────────┐
               │ Engine (@agentx/    │
               │   engine)           │
               │ Agent class         │
               │ 165 tools           │
               │ Providers           │
               │ Session/Config/     │
               │ Secret Sauce        │
               └──────────┬──────────┘
                          │
               ┌──────────▼──────────┐
               │ Shared (@agentx/    │
               │   shared)           │
               │ Types, utils, IDs   │
               └─────────────────────┘
```

### 1.2 Target Architecture (VS Code Extension)

```
┌─────────────────────────────────────────────────────────┐
│              VS Code Extension Host Process              │
│                                                         │
│  ┌────────────────────────────────────────────────────┐ │
│  │  Extension (packages/vscode/)                      │ │
│  │  ┌──────────────┐  ┌──────────────┐               │ │
│  │  │  Activation   │  │  Commands    │               │ │
│  │  │  & Lifecycle  │  │  & Palette   │               │ │
│  │  └──────┬───────┘  └──────┬───────┘               │ │
│  │         │                  │                        │ │
│  │  ┌──────▼──────────────────▼───────┐               │ │
│  │  │  VSCodeEngine (adapter layer)   │               │ │
│  │  │  - Wraps Agent class            │               │ │
│  │  │  - Provides workspaceRoot       │               │ │
│  │  │  - Maps events → VS Code UI     │               │ │
│  │  │  - Manages singleton lifecycle  │               │ │
│  │  └──────────────┬──────────────────┘               │ │
│  │                 │                                   │ │
│  │  ┌──────────────▼──────────────────┐               │ │
│  │  │  Tool Adapter Layer             │               │ │
│  │  │  - VSCodeFilesystemTools        │               │ │
│  │  │  - VSCodeShellTools             │               │ │
│  │  │  - VSCodeGitTools               │               │ │
│  │  │  - VSCodeCodeIntelligenceTools  │               │ │
│  │  │  - DisabledToolStub             │               │ │
│  │  └──────────────┬──────────────────┘               │ │
│  │                 │                                   │ │
│  └─────────────────┼───────────────────────────────────┘ │
│                    │                                     │
│         ┌──────────▼──────────┐                          │
│         │ @agentx/engine      │ ← UNMODIFIED             │
│         │ Agent class         │                          │
│         │ CompletionLoop      │                          │
│         │ Providers           │                          │
│         │ SessionManager      │                          │
│         │ SecretSauce         │                          │
│         └──────────┬──────────┘                          │
│                    │                                     │
│         ┌──────────▼──────────┐                          │
│         │ @agentx/shared      │ ← UNMODIFIED             │
│         │ Types & Utils       │                          │
│         └─────────────────────┘                          │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              VS Code UI Layer (Webview)                  │
│                                                         │
│  ┌────────────────┐  ┌────────────────┐                │
│  │  Chat Sidebar   │  │  Session Tree  │                │
│  │  (Webview)      │  │  (TreeView)    │                │
│  │  - Messages     │  │  - List        │                │
│  │  - Streaming    │  │  - Restore     │                │
│  │  - Tool cards   │  │  - Delete      │                │
│  │  - Permissions  │  │  - Export      │                │
│  │  - Plans        │  │  - Search      │                │
│  │  - Input        │  │                │                │
│  └────────────────┘  └────────────────┘                │
│                                                         │
│  ┌────────────────┐  ┌────────────────┐                │
│  │  Status Bar     │  │  Command       │                │
│  │  - Model        │  │  Palette       │                │
│  │  - Tokens       │  │  - /model      │                │
│  │  - Provider     │  │  - /provider   │                │
│  │  - Session      │  │  - /profile    │                │
│  └────────────────┘  └────────────────┘                │
└─────────────────────────────────────────────────────────┘
```

### 1.3 Key Design Principles

1. **Additive only** — No modifications to existing TUI/Web-UI code paths. All changes are new files or new optional parameters.
2. **Engine as library** — The VS Code extension imports `@agentx/engine` as a library dependency, not as a running server.
3. **Workspace-aware** — All `process.cwd()` usages are replaced with `vscode.workspace.workspaceFolders[0].uri.fsPath` via the adapter layer.
4. **Event-driven UI** — The extension subscribes to `AgentEventBus` events and maps them to VS Code UI primitives (webview messages, status bar updates, tree view refreshes).
5. **Permission via modals** — The callback-based permission system (`permission_required` event → `respondToPermission()`) maps naturally to `vscode.window.showWarningMessage()`.
6. **Shared config** — The extension reads/writes the same `~/.config/agentx/` directory as the CLI. No config duplication.

---

## 2. Dependency Graph (Phase Execution Order)

```
Phase 1: Scaffolding
    │
    ▼
Phase 2: Engine Adapter ──────────────────────────────┐
    │                                                  │
    ▼                                                  │
Phase 3: Extension Core                                │
    │                                                  │
    ├──▶ Phase 4: Chat Webview                         │
    │                                                  │
    ├──▶ Phase 5: Tool Adaptation ◄────────────────────┘
    │        │
    │        ▼
    ├──▶ Phase 6: Permissions & Scope
    │        │
    │        ▼
    ├──▶ Phase 7: Session Management
    │        │
    │        ▼
    ├──▶ Phase 8: Provider / Model / Crew
    │        │
    │        ▼
    ├──▶ Phase 9: Secret Sauce & Memory
    │        │
    │        ▼
    └──▶ Phase 10: Advanced Features
             │
             ▼
         Phase 11: Testing & Packaging
```

**Critical path**: 1 → 2 → 3 → 5 → 6 → 4 → 7 → 8 → 9 → 10 → 11

**Parallelizable**: Phases 4, 7, 8, 9 can be worked on in parallel once Phase 5+6 are complete.

---

## 3. Source Code Map (Key Files Reference)

This section maps every critical source file an implementing agent needs to understand. All paths are relative to `/source/`.

### 3.1 Engine Core (`packages/engine/src/`)

| File | Purpose | Lines | Key Exports |
|------|---------|-------|-------------|
| `agent/Agent.ts` | Main agent class, 395-line constructor | 1700+ | `Agent`, `AgentOptions` |
| `agent/CompletionLoop.ts` | AI completion loop with tool execution | 635 | `CompletionLoop`, `CompletionLoopDeps` |
| `agent/SubAgentManager.ts` | Sub-agent lifecycle | ~150 | `SubAgentManager`, `SubAgentTask` |
| `agent/SmartSubAgent.ts` | Full-capability sub-agent | ~200 | `SmartSubAgent`, `SmartSubAgentOptions` |
| `agent/AgentBus.ts` | Multi-agent pub/sub mesh | ~170 | `AgentBus`, `getAgentBus`, `setAgentBus` |
| `agent/DecisionEngine.ts` | Message classification | ~100 | `DecisionEngine`, `MessageClass` |
| `agent/TaskManager.ts` | Background task tracking | ~80 | `TaskManager`, `TaskContext` |
| `agent/TodoManager.ts` | TODO list management | ~60 | `TodoManager` |
| `agent/SteerMessageHandler.ts` | Mid-execution steering | ~50 | `SteerMessageHandler` |
| `agent/CrewOrchestrator.ts` | Multi-agent crew coordination | ~120 | `CrewOrchestrator` |
| `EventBus.ts` | Event pub/sub | 20 | `AgentEventBus` |
| `tools/toolkit.ts` | Tool definitions + handler registration | ~500 | `createDefaultToolkit` |
| `tools/ToolRegistry.ts` | Tool metadata storage | ~80 | `ToolRegistry` |
| `tools/ToolExecutor.ts` | Permission + scope + dispatch | ~194 | `ToolExecutor` |
| `tools/EnhancedToolExecutor.ts` | Parallel + doom-loop + repair | ~143 | `EnhancedToolExecutor` |
| `tools/permissions/PermissionManager.ts` | Permission storage + decisions | ~151 | `PermissionManager` |
| `tools/permissions/ScopeGuard.ts` | Path validation + symlink protection | ~176 | `ScopeGuard` |
| `providers/ProviderFactory.ts` | Provider instantiation | ~50 | `ProviderFactory` |
| `providers/OpenAIProvider.ts` | OpenAI API transport | ~200 | `OpenAIProvider` |
| `providers/AnthropicProvider.ts` | Anthropic API transport | ~200 | `AnthropicProvider` |
| `providers/GoogleProvider.ts` | Google Gemini transport | ~150 | `GoogleProvider` |
| `providers/OllamaProvider.ts` | Ollama local model | ~100 | `OllamaProvider` |
| `providers/LMStudioProvider.ts` | LM Studio local model | ~80 | `LMStudioProvider` |
| `config/ConfigManager.ts` | Config read/write/encrypt | ~381 | `ConfigManager` |
| `config/ConfigSchema.ts` | Zod validation for config | ~100 | `agentXConfigSchema` |
| `config/paths.ts` | Config/data/cache paths | ~32 | `getConfigDir`, `getDataDir` |
| `session/SessionManager.ts` | Session CRUD | ~200 | `SessionManager` |
| `session/SessionStore.ts` | SQLite-backed session store | ~260 | `SessionStore` |
| `session/TokenTracker.ts` | Token usage + cost tracking | ~80 | `TokenTracker` |
| `session/CrashRecovery.ts` | Crash detection + recovery | ~60 | `CrashRecovery` |
| `session/GitManager.ts` | Git repo detection + operations | ~100 | `GitManager` |
| `session/FileWatcher.ts` | File change watching | ~80 | `FileWatcher` |
| `session/BackgroundQueue.ts` | Background command queue | ~60 | `BackgroundQueue` |
| `session/ModelRouter.ts` | Task-based model routing | ~80 | `ModelRouter` |
| `secret-sauce/index.ts` | SecretSauceManager facade | ~171 | `SecretSauceManager` |
| `secret-sauce/CrewManager.ts` | Crew/persona CRUD | ~200 | `CrewManager` |
| `secret-sauce/SoulManager.ts` | SOUL.md management | ~45 | `SoulManager` |
| `secret-sauce/MemoryManager.ts` | Memory persistence | ~192 | `MemoryManager` |
| `secret-sauce/DiaryManager.ts` | Daily diary entries | ~80 | `DiaryManager` |
| `secret-sauce/IdentityManager.ts` | Agent identity | ~60 | `IdentityManager` |
| `secret-sauce/MemoryExtractor.ts` | LLM-based memory extraction | ~100 | `MemoryExtractor` |
| `prompt/PromptEngine.ts` | Dynamic prompt assembly | ~200 | `PromptEngine` |
| `commands/index.ts` | Command parser + registry | ~100 | `CommandParser`, `CommandRegistry` |
| `index.ts` | Public API barrel export | 235 | All public exports |

### 3.2 Shared Types (`packages/shared/src/`)

| File | Purpose | Key Types |
|------|---------|-----------|
| `types/events.ts` | 55+ engine event types | `EngineEvent`, `EventBus`, `EventHandler` |
| `types/tool.ts` | Tool definitions + execution | `ToolDefinition`, `ToolResult`, `ToolExecutionContext`, `ToolCategory` |
| `types/session.ts` | Session model | `Session`, `SessionStatus` |
| `types/message.ts` | Message + completion types | `Message`, `CompletionMessage`, `CompletionChunk` |
| `types/config.ts` | Configuration schema | `AgentXConfig`, `ProviderSettings`, `UISettings` |
| `types/provider.ts` | Provider abstraction | `ProviderId`, `ModelInfo` |
| `types/crew.ts` | Crew/persona model | `CrewMember`, `Crew`, `CrewEmotion` |
| `types/permission.ts` | Permission model | `Permission`, `PermissionDecision` |
| `types/storage.ts` | Storage abstraction | `StorageAdapter`, `StorableSession` |
| `types/plugin.ts` | Plugin system | `PluginManifest`, `PluginInstance` |
| `types/communication.ts` | Channel + streaming types | `ChannelKind`, `AgentXStreamEvent` |
| `utils/paths.ts` | Path resolution | `getConfigDir()`, `getDataDir()` |
| `utils/id.ts` | ID generation | `generateSessionId()`, `generateMessageId()` |

### 3.3 Tool Implementations (`packages/engine/src/tools/`)

| File | Category | Tool Count | Shell-Dependent? |
|------|----------|-----------|-----------------|
| `builtin/filesystem.ts` | filesystem | 16 | Yes (node:fs, execSync) |
| `builtin/shell.ts` | shell_process | 5 | Yes (child_process) |
| `builtin/git.ts` | git_vcs | 13 | Yes (execSync git) |
| `builtin/code.ts` | code_intelligence | 13 | Yes (execSync) |
| `builtin/documents.ts` | documents | 15 | Partial |
| `builtin/browser.ts` | browser_automation | 6 | Yes (Playwright) |
| `builtin/web.ts` | web_network | 7 | Partial (fetch) |
| `builtin/containers.ts` | containers_infra | 9 | Yes (execSync docker) |
| `builtin/database.ts` | database | 5 | Yes (better-sqlite3) |
| `builtin/github.ts` | github | 9 | Yes (execSync gh) |
| `builtin/packages.ts` | package_managers | 8 | Yes (execSync npm) |
| `builtin/testing.ts` | testing | 5 | Yes (execSync vitest) |
| `builtin/system.ts` | system_os | 12 | Yes (execSync) |
| `builtin/security.ts` | security_crypto | 4 | No (pure JS) |
| `builtin/ai_meta.ts` | ai_meta | 7 | No (provider API) |
| `builtin/communication.ts` | communication | 5 | Yes (execSync osascript) |
| `builtin/media.ts` | media_image | 4 | Yes (execSync sips) |
| `builtin/scheduler.ts` | scheduler | 3 | No (singleton) |
| `builtin/subagent.ts` | agent_orchestration | 3 | No (singleton) |
| `builtin/mcp.ts` | mcp_integration | 4 | Yes (spawn) |
| `builtin/data_processing.ts` | data_processing | 8 | No (pure JS) |

### 3.4 Singleton Setters (Must Be Aware Of)

| File | Setter | Set In Agent Constructor |
|------|--------|------------------------|
| `commands/builtin/schedule.ts` | `setSchedulerInstance()` | Line 199 |
| `commands/builtin/tasks.ts` | `setTaskManagerInstance()` | Line 197 |
| `commands/builtin/tasks.ts` | `setBackgroundQueueInstance()` | Line 307 |
| `commands/builtin/tools.ts` | `setToolRegistryInstance()` | Line 260 |
| `commands/builtin/watch.ts` | `setFileWatcherInstance()` | Line 335 |
| `commands/builtin/route.ts` | `setModelRouterInstance()` | Line 311 |
| `commands/builtin/recipe.ts` | `setRecipeEngineInstance()` | Line 326 |
| `commands/builtin/commands.ts` | `setUserCommandRegistryInstance()` | Line 317 |
| `commands/builtin/rag_index.ts` | `setIndexerEventBus()` | Line 200 |
| `tools/builtin/subagent.ts` | `setSubAgentManagerInstance()` | Line 195 |
| `agent/AgentBus.ts` | `setAgentBus()` / `getAgentBus()` | Line 359 |

---

## 4. Event Type Reference (Complete List)

The VS Code extension must handle ALL of these events. Grouped by category:

### Message Lifecycle
| Event | Payload | VS Code Mapping |
|-------|---------|-----------------|
| `message_sent` | `{ message: Message }` | Append user bubble to chat |
| `message_received` | `{ message: Message, elapsed: number }` | Append assistant bubble to chat |
| `stream_chunk` | `{ content: string, fullContent: string }` | Update streaming text in real-time |
| `loading_start` | `{ stage: string }` | Show spinner / progress indicator |
| `loading_end` | — | Hide spinner |

### Tool Lifecycle
| Event | Payload | VS Code Mapping |
|-------|---------|-----------------|
| `tool_executing` | `{ tool: string, description: string, startTime: number }` | Show tool card (running) |
| `tool_complete` | `{ tool: string, result: ToolResult, elapsed: number }` | Update tool card (done/failed) |
| `diff_preview` | `{ tool: string, filePath: string, diff: string, oldContent: string, newContent: string }` | Show inline diff in editor |

### Permission & Clarification
| Event | Payload | VS Code Mapping |
|-------|---------|-----------------|
| `permission_required` | `{ tool: string, path: string, riskLevel: string }` | `showWarningMessage` modal |
| `clarification_required` | `{ question: string, options: string[], allowFreeform: boolean }` | QuickPick or InputBox |

### Reasoning & Planning
| Event | Payload | VS Code Mapping |
|-------|---------|-----------------|
| `reasoning_start` | — | Show "thinking" indicator |
| `reasoning_glimpse` | `{ text: string }` | Show ephemeral reasoning text |
| `reasoning_complete` | — | Hide reasoning indicator |
| `intent_detected` | `{ intent: string, confidence: number }` | Status bar (optional) |
| `decision_made` | `{ messageClass, executionPath, confidence }` | Internal (optional display) |
| `plan_generated` | `{ plan: Plan, userRequest: string }` | Show plan approval UI |
| `plan_approved` | `{ planId: string }` | Update plan UI |
| `plan_rejected` | `{ planId: string }` | Update plan UI |
| `plan_step_pending` | `{ stepId, planId, description }` | Show step approval |
| `plan_step_complete` | `{ stepId, planId, result }` | Mark step done |
| `plan_step_failed` | `{ stepId, planId, error }` | Mark step failed |
| `plan_step_skipped` | `{ stepId, planId }` | Mark step skipped |
| `plan_mode_entered` | — | Status bar indicator |
| `plan_mode_exited` | — | Remove status bar indicator |

### Sub-Agents
| Event | Payload | VS Code Mapping |
|-------|---------|-----------------|
| `agent_spawned` | `{ agentId, task, startTime }` | Show sub-agent card |
| `agent_progress` | `{ agentId, status }` | Update sub-agent card |
| `agent_complete` | `{ agentId, summary, elapsed }` | Complete sub-agent card |

### Errors & Recovery
| Event | Payload | VS Code Mapping |
|-------|---------|-----------------|
| `error` | `{ code, message, recoverable, actions: RemediationAction[] }` | Error notification + action buttons |

### Meta
| Event | Payload | VS Code Mapping |
|-------|---------|-----------------|
| `token_usage` | `{ used, total, percentage, cost }` | Status bar update |
| `todo_update` | `{ items: TodoItem[] }` | TODO panel update |
| `steer_message` | `{ instruction: string }` | Show steer indicator |
| `watch_event` | `{ event, filePath, command }` | Notification |
| `reminder_fired` | `{ taskId, name, message }` | Notification toast |
| `context_compacted` | — | Optional notification |
| `rag_queried` | `{ resultCount, elapsed }` | Optional indicator |

### Visual / Advanced
| Event | Payload | VS Code Mapping |
|-------|---------|-----------------|
| `agent_message` | `{ message: VisualUpdate }` | Feed to VisualStateManager |
| `tot_start` | — | Tree of Thoughts indicator |
| `tot_thought_generated` | `{ depth, beamIndex, content }` | ToT progress |
| `tot_complete` | `{ bestPath }` | ToT result |
| `research_start` | — | Research indicator |
| `research_query` | `{ query, sourceCount }` | Research progress |
| `research_complete` | `{ result }` | Research result |
| `indexing_start` | `{ totalFiles }` | Indexing progress |
| `indexing_progress` | `{ indexed, total }` | Indexing progress bar |
| `indexing_complete` | — | Indexing done |

---

## 5. Tool Category Disposition for VS Code

| Category | Count | VS Code Strategy | Priority |
|----------|-------|-----------------|----------|
| filesystem | 16 | Adapt to `vscode.workspace.fs` + `node:fs` | P1 |
| shell_process | 5 | Use `child_process` (works in extension host) | P1 |
| git_vcs | 13 | Use VS Code Git extension API + fallback to shell | P1 |
| code_intelligence | 13 | Use VS Code language APIs (`executeCommand`) | P1 |
| documents | 15 | Keep pure-JS handlers, disable shell-dependent | P2 |
| browser_automation | 6 | Disable (not relevant in VS Code) | P3 |
| web_network | 7 | Keep as-is (pure `fetch`) | P1 |
| containers_infra | 9 | Keep shell-based (works in extension host) | P2 |
| database | 5 | Keep with `better-sqlite3` fallback to `sql.js` | P2 |
| github | 9 | Keep shell-based (`gh` CLI) | P2 |
| package_managers | 8 | Keep shell-based (works in extension host) | P1 |
| testing | 5 | Keep shell-based + integrate with VS Code Test API | P2 |
| system_os | 12 | Keep shell-based (works in extension host) | P2 |
| security_crypto | 4 | Keep as-is (pure JS) | P1 |
| ai_meta | 7 | Keep as-is (provider API) | P1 |
| communication | 5 | Disable desktop notifications, keep Telegram | P3 |
| media_image | 4 | Keep shell-based | P3 |
| scheduler | 3 | Keep as-is (singleton) | P1 |
| agent_orchestration | 3 | Keep as-is (singleton) | P1 |
| mcp_integration | 4 | Keep as-is (spawn) | P2 |
| data_processing | 8 | Keep as-is (pure JS) | P1 |

---

## 6. Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| `better-sqlite3` fails to compile in extension host | High | Use `sql.js` (pure JS) or JSON-file `StorageAdapter` |
| Singletons clash if multiple extensions load engine | Medium | Engine runs in isolated worker thread (Phase 2) |
| Extension host memory limit (256MB default) | Medium | Lazy-init subsystems, defer non-critical startup |
| Tool handlers assume terminal output formatting | Low | Tool adapter layer normalizes output for webview |
| `process.cwd()` returns VS Code install dir | High | Adapter layer injects workspace root everywhere |
| Webview CSP blocks inline scripts | Low | All webview code bundled, no inline scripts |
| Extension activation time > 5s | Medium | Defer engine init until first user interaction |

---

## 7. Estimated Effort

| Phase | Effort | Dependencies |
|-------|--------|-------------|
| 1: Scaffolding | 2 days | None |
| 2: Engine Adapter | 3-4 days | Phase 1 |
| 3: Extension Core | 3 days | Phase 2 |
| 4: Chat Webview | 5-7 days | Phase 3 |
| 5: Tool Adaptation | 7-10 days | Phase 2 |
| 6: Permissions & Scope | 2 days | Phase 5 |
| 7: Session Management | 3-4 days | Phase 3 |
| 8: Provider/Model/Crew | 3 days | Phase 3 |
| 9: Secret Sauce | 2-3 days | Phase 3 |
| 10: Advanced Features | 5-7 days | Phases 4-9 |
| 11: Testing & Packaging | 3-4 days | Phase 10 |
| **Total** | **~6-8 weeks** | |

---

## 8. Conventions for Implementing Agents

When implementing tasks from these documents:

1. **Check status markers**: Each task has a `⬜` (not started), `🔲` (in progress), or `✅` (complete) marker. Only work on `⬜` or `🔲` tasks.
2. **Update markers**: When completing a task, change `⬜` to `✅`. When starting, change to `🔲`.
3. **Follow file paths exactly**: All file paths in task descriptions are relative to `/source/`. The VS Code extension lives at `packages/vscode/`.
4. **Run typecheck after every change**: `pnpm --filter @agentx/vscode run typecheck`
5. **Run lint after every change**: `pnpm --filter @agentx/vscode run lint`
6. **Test in Extension Development Host**: Use VS Code's "Run Extension" launch config after every functional change.
7. **Never modify existing packages**: If you need to change `@agentx/engine` or `@agentx/shared`, it must be an additive change (new export, new optional parameter). Never change existing function signatures or behavior.
8. **Commit granularity**: One commit per task ID (e.g., `feat(vscode): T5.3.1 — filesystem tool adapter`).
