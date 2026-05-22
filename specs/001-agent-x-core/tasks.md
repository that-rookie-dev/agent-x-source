# Tasks: Agent-X Core Platform

**Input**: Design documents from `/specs/001-agent-x-core/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/api-spec.md

**Tests**: Include tests for core functionality (engine, providers, tools, session management).

**Organization**: Tasks grouped by user story to enable independent implementation and testing.

---

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1-US9)
- Include exact file paths in descriptions

## Path Conventions

- **Monorepo**: `packages/cli/src/`, `packages/tui/src/`, `packages/engine/src/`, `packages/shared/src/`
- **Tests**: `packages/*/tests/`
- **Data**: `data/secret-sauce/`
- **Config**: Root-level config files

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, workspace scaffolding, build pipeline

- [ ] T001 Initialize pnpm workspace with `pnpm-workspace.yaml` defining packages/cli, packages/tui, packages/engine, packages/shared, packages/web
- [ ] T002 Create root `package.json` with workspace scripts (build, test, lint, dev, clean)
- [ ] T003 [P] Create `tsconfig.base.json` with strict TypeScript configuration (strict: true, paths, composite)
- [ ] T004 [P] Create `.eslintrc.cjs` with flat config, TypeScript rules, React rules for TSX
- [ ] T005 [P] Create `.prettierrc` with consistent formatting rules
- [ ] T006 [P] Create `vitest.config.ts` with workspace-aware test configuration
- [ ] T007 Create `packages/shared/package.json` and `packages/shared/tsconfig.json` (extends base)
- [ ] T008 [P] Create `packages/engine/package.json` and `packages/engine/tsconfig.json` (depends on shared)
- [ ] T009 [P] Create `packages/tui/package.json` and `packages/tui/tsconfig.json` (depends on engine, shared)
- [ ] T010 [P] Create `packages/cli/package.json` and `packages/cli/tsconfig.json` (depends on tui, engine)
- [ ] T011 Create `packages/web/package.json` (placeholder, depends on engine, shared)
- [ ] T012 [P] Create `.github/workflows/ci.yml` for lint + test + build pipeline
- [ ] T013 [P] Create `.gitignore` covering node_modules, dist, .env, *.db, coverage/
- [ ] T014 Create root `README.md` with project overview, setup instructions, and architecture diagram
- [ ] T015 [P] Create `CHANGELOG.md` with initial entry
- [ ] T016 [P] Create `LICENSE` file (MIT)

**Checkpoint**: `pnpm install` succeeds, `pnpm build` produces empty dist folders, workspace structure verified

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core types, utilities, configuration, and storage that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T017 [P] Create all shared type definitions in `packages/shared/src/types/session.ts`
- [ ] T018 [P] Create all shared type definitions in `packages/shared/src/types/message.ts`
- [ ] T019 [P] Create all shared type definitions in `packages/shared/src/types/provider.ts`
- [ ] T020 [P] Create all shared type definitions in `packages/shared/src/types/tool.ts`
- [ ] T021 [P] Create all shared type definitions in `packages/shared/src/types/profile.ts`
- [ ] T022 [P] Create all shared type definitions in `packages/shared/src/types/permission.ts`
- [ ] T023 [P] Create all shared type definitions in `packages/shared/src/types/config.ts`
- [ ] T024 [P] Create event type definitions in `packages/shared/src/types/events.ts`
- [ ] T025 [P] Create shared constants in `packages/shared/src/constants/providers.ts` (provider metadata)
- [ ] T026 [P] Create shared constants in `packages/shared/src/constants/commands.ts` (built-in command list)
- [ ] T027 [P] Create shared constants in `packages/shared/src/constants/version.ts` (SemVer)
- [ ] T028 [P] Create utility: `packages/shared/src/utils/id.ts` (nanoid wrapper for session/message IDs)
- [ ] T029 [P] Create utility: `packages/shared/src/utils/paths.ts` (XDG path resolution, scope validation)
- [ ] T030 [P] Create utility: `packages/shared/src/utils/tokens.ts` (token counting wrappers)
- [ ] T031 [P] Create utility: `packages/shared/src/utils/validation.ts` (common Zod schemas)
- [ ] T032 Create `packages/shared/src/index.ts` barrel export
- [ ] T033 Create ConfigManager in `packages/engine/src/config/ConfigManager.ts` (read/write config, isConfigured check)
- [ ] T034 Create ConfigSchema in `packages/engine/src/config/ConfigSchema.ts` (Zod schema for AgentXConfig)
- [ ] T035 Create path resolver in `packages/engine/src/config/paths.ts` (XDG-compliant data/config/cache paths)
- [ ] T036 Create SQLite database setup in `packages/engine/src/session/SessionStore.ts` (schema migration, connection)
- [ ] T037 Create Secret Sauce file templates in `data/secret-sauce/` (SOUL.md, PROFILE.md, MEMORIES.md, DIARY.md, IDENTITY.md, PERMISSION.md)
- [ ] T038 Create theme constants in `packages/tui/src/theme/colors.ts` (amber/gold color scheme)
- [ ] T039 [P] Create layout constants in `packages/tui/src/theme/layout.ts`
- [ ] T040 [P] Create typography constants in `packages/tui/src/theme/typography.ts`

**Checkpoint**: `pnpm build` succeeds for all packages, types compile cleanly, SQLite creates schema on first run

---

## Phase 3: User Story 1 - First-Time Setup & Onboarding (Priority: P1) 🎯 MVP

**Goal**: User runs `agentx` → sees setup wizard → configures provider → selects model → reaches main TUI

**Independent Test**: Run with no config → complete wizard → verify config persisted → main TUI loads

### Tests for User Story 1

- [ ] T041 [P] [US1] Unit test: ConfigManager.isConfigured() returns false when no config in `packages/engine/tests/config/ConfigManager.test.ts`
- [ ] T042 [P] [US1] Unit test: ConfigManager persists provider/model config correctly
- [ ] T043 [P] [US1] Integration test: SetupWizard component renders all steps in `packages/tui/tests/screens/SetupWizard.test.tsx`
- [ ] T044 [P] [US1] Unit test: Provider validation (mock API call) in `packages/engine/tests/providers/validation.test.ts`

### Implementation for User Story 1

- [ ] T045 [US1] Create CLI entry point in `packages/cli/src/index.ts` (commander.js, detect configured state, route to wizard or main)
- [ ] T046 [US1] Create start command in `packages/cli/src/commands/start.ts` (launch TUI with React Ink render)
- [ ] T047 [US1] Create version command in `packages/cli/src/commands/version.ts` (--version flag)
- [ ] T048 [US1] Create root App component in `packages/tui/src/app.tsx` (screen router: wizard vs main)
- [ ] T049 [US1] Create ProviderSelector component in `packages/tui/src/components/ProviderSelector.tsx` (scrollable list of providers)
- [ ] T050 [US1] Create ModelSelector component in `packages/tui/src/components/ModelSelector.tsx` (scrollable list with keyboard navigation)
- [ ] T051 [US1] Create ScrollableList generic component in `packages/tui/src/components/ScrollableList.tsx` (up/down/space/enter/esc)
- [ ] T052 [US1] Create ConfirmDialog component in `packages/tui/src/components/ConfirmDialog.tsx` (y/n prompt)
- [ ] T053 [US1] Create SetupWizard screen in `packages/tui/src/screens/SetupWizard.tsx` (multi-step: provider → credentials → model → optional Org/Contact)
- [ ] T054 [US1] Implement ProviderInterface in `packages/engine/src/providers/ProviderInterface.ts`
- [ ] T055 [US1] Implement OpenAIProvider in `packages/engine/src/providers/OpenAIProvider.ts` (validate, listModels, complete with streaming + reasoning token extraction)
- [ ] T056 [US1] Implement ProviderRegistry in `packages/engine/src/providers/ProviderRegistry.ts` (register, get, list providers)
- [ ] T057 [US1] Create credential storage utility (secure API key storage using keytar or fallback encryption)
- [ ] T058 [US1] Wire up wizard completion → config persistence → screen transition to main TUI
- [ ] T058.1 [US1] Implement `/config` command in `packages/engine/src/commands/builtin/config.ts` (view/set Org name, Contact, UI preferences post-setup)

**Checkpoint**: Running `agentx` with no config shows wizard, completing wizard shows main TUI shell

---

## Phase 4: User Story 2 - Main TUI Interaction & Messaging (Priority: P1) 🎯 MVP

**Goal**: User types message → sees animated loading → receives formatted response → token counter updates

**Independent Test**: Send message → verify loading animation → verify response display → verify token bar

### Tests for User Story 2

- [ ] T059 [P] [US2] Unit test: Agent.sendMessage streams events correctly in `packages/engine/tests/agent/Agent.test.ts`
- [ ] T060 [P] [US2] Unit test: TokenTracker updates counts in `packages/engine/tests/session/TokenTracker.test.ts`
- [ ] T061 [P] [US2] Component test: InputField handles text entry in `packages/tui/tests/components/InputField.test.tsx`
- [ ] T062 [P] [US2] Component test: LoadingIndicator renders animation frames in `packages/tui/tests/components/LoadingIndicator.test.tsx`
- [ ] T063 [P] [US2] Component test: MessageArea renders messages in `packages/tui/tests/components/MessageArea.test.tsx`

### Implementation for User Story 2

- [ ] T064 [US2] Create Banner component in `packages/tui/src/components/Banner.tsx` (ASCII art with gradient, version, provider/model info, Org name & contact if configured)
- [ ] T065 [US2] Create InputField component in `packages/tui/src/components/InputField.tsx` (text input with focus, submit on Enter)
- [ ] T066 [US2] Create TokenBar component in `packages/tui/src/components/TokenBar.tsx` (animated progress bar: used/available/percentage, smooth transition animation, color-coded green→amber→red as usage grows, updates on every model interaction)
- [ ] T066.1 [US2] Create ProcessTimer component in `packages/tui/src/components/ProcessTimer.tsx` (per-tool/per-agent elapsed time counter, updates every 100ms while active)
- [ ] T066.2 [US2] Create ConsolidatedTimer component in `packages/tui/src/components/ConsolidatedTimer.tsx` (total elapsed + per-tool time breakdown shown at task completion)
- [ ] T067 [US2] Create MessageArea component in `packages/tui/src/components/MessageArea.tsx` (scrollable message history with Static)
- [ ] T068 [US2] Create SessionPanel component in `packages/tui/src/components/SessionPanel.tsx` (side panel: session ID, tokens, time, provider, model, background task compact indicators)
- [ ] T069 [US2] Create LoadingIndicator component in `packages/tui/src/components/LoadingIndicator.tsx` (spinner, progress, multi-stage variants)
- [ ] T070 [US2] Create animation definitions in `packages/tui/src/animations/spinners.ts` (multiple spinner frame sets)
- [ ] T071 [P] [US2] Create animation definitions in `packages/tui/src/animations/progress.ts` (progress bar animations)
- [ ] T072 [P] [US2] Create animation definitions in `packages/tui/src/animations/thinking.ts` (multi-stage "Analyzing... Planning... Composing...")
- [ ] T073 [US2] Create Agent orchestrator in `packages/engine/src/agent/Agent.ts` (sendMessage, event emission, streaming)
- [ ] T074 [US2] Create MessageProcessor in `packages/engine/src/agent/MessageProcessor.ts` (build context, call provider, process response)
- [ ] T075 [US2] Create ResponseFormatter in `packages/engine/src/agent/ResponseFormatter.ts` (format AI output for display)
- [ ] T076 [US2] Create TokenTracker in `packages/engine/src/session/TokenTracker.ts` (real-time token accounting, budget management)
- [ ] T076.1 [US2] Create SessionCompactor in `packages/engine/src/session/SessionCompactor.ts` — monitors token usage, triggers compaction at 70% context capacity
- [ ] T076.2 [US2] SessionCompactor: write structured summary to `~/.cache/agentx/content.txt` (key decisions, active tasks, user preferences, file states)
- [ ] T076.3 [US2] SessionCompactor: replace older messages in active context with summary, preserve last N messages verbatim + active tool results
- [ ] T076.4 [US2] SessionCompactor: clear `content.txt` immediately after summary is consumed (truncate to 0 bytes)
- [ ] T076.5 [US2] SessionCompactor: emit `compaction_start` / `compaction_complete` engine events for UI progress
- [ ] T076.6 [US2] TUI: show "Optimizing session memory..." animated indicator during compaction (Pulse/Glow style, non-blocking)
- [ ] T077 [US2] Create SessionManager in `packages/engine/src/session/SessionManager.ts` (create session, update state, auto-save)
- [ ] T078 [US2] Create WelcomeScreen in `packages/tui/src/screens/WelcomeScreen.tsx` (compose Banner + MessageArea + InputField + SessionPanel + TokenBar)
- [ ] T079 [US2] Create useSession hook in `packages/tui/src/hooks/useSession.ts` (session state in React context)
- [ ] T080 [US2] Create useLoadingAnimation hook in `packages/tui/src/hooks/useLoadingAnimation.ts` (multi-variant animation orchestration)
- [ ] T081 [US2] Create useTokenCounter hook in `packages/tui/src/hooks/useTokenCounter.ts` (debounced real-time counting)

**Checkpoint**: User can type a message, see animated loading, receive AI response, and see token counter update

---

## Phase 5: User Story 3 - Slash Commands & Navigation (Priority: P1) 🎯 MVP

**Goal**: User types "/" → command list appears → filters as they type → selects and executes

**Independent Test**: Type "/" → see commands → filter → select → verify execution

### Tests for User Story 3

- [ ] T082 [P] [US3] Unit test: CommandParser detects "/" prefix and extracts command in `packages/engine/tests/commands/CommandParser.test.ts`
- [ ] T083 [P] [US3] Unit test: CommandRegistry filters commands by prefix in `packages/engine/tests/commands/CommandRegistry.test.ts`
- [ ] T084 [P] [US3] Component test: CommandList renders and filters in `packages/tui/tests/components/CommandList.test.tsx`

### Implementation for User Story 3

- [ ] T085 [US3] Create CommandRegistry in `packages/engine/src/commands/CommandRegistry.ts` (register, list, filter, get by name)
- [ ] T086 [US3] Create CommandParser in `packages/engine/src/commands/CommandParser.ts` (detect "/" prefix, parse command + args locally)
- [ ] T087 [US3] Create CommandInterface in `packages/engine/src/commands/CommandInterface.ts` (base interface for all commands)
- [ ] T088 [P] [US3] Implement built-in command: `/help` in `packages/engine/src/commands/builtin/help.ts`
- [ ] T089 [P] [US3] Implement built-in command: `/exit` in `packages/engine/src/commands/builtin/exit.ts`
- [ ] T090 [P] [US3] Implement built-in command: `/clear` in `packages/engine/src/commands/builtin/clear.ts`
- [ ] T091 [P] [US3] Implement built-in command: `/version` in `packages/engine/src/commands/builtin/version.ts`
- [ ] T092 [P] [US3] Implement built-in command: `/model` in `packages/engine/src/commands/builtin/model.ts` (switch model)
- [ ] T093 [P] [US3] Implement built-in command: `/provider` in `packages/engine/src/commands/builtin/provider.ts` (switch provider)
- [ ] T094 [US3] Create CommandList component in `packages/tui/src/components/CommandList.tsx` (dropdown list below input, scrollable, filtered)
- [ ] T095 [US3] Create useSlashCommands hook in `packages/tui/src/hooks/useSlashCommands.ts` (detect "/", filter, navigate, select)
- [ ] T095.1 [US3] Implement Tab autocomplete in useSlashCommands — Tab fills highlighted command into input field without executing
- [ ] T095.2 [US3] Create useKeybindings hook in `packages/tui/src/hooks/useKeybindings.ts` (global keybinding handler)
- [ ] T095.3 [US3] Implement double-Esc detection in useKeybindings (two Esc presses within 500ms = abort trigger)
- [ ] T095.4 [US3] Wire double-Esc to ConfirmDialog ("Abort current task? (y/n)") — on confirm, emit `task_abort` event to engine
- [ ] T095.5 [US3] Engine handles `task_abort`: cancel all active sub-agents, stop tool executions gracefully, emit `task_aborted` event
- [ ] T096 [US3] Integrate command detection into InputField (show/hide CommandList based on "/" prefix)

**Checkpoint**: "/" shows command list, Tab autocompletes without executing, Enter executes, double-Esc aborts running tasks with confirmation

---

## Phase 6: User Story 4 - Profile System (Priority: P2)

**Goal**: User can list, select, and switch profiles; agent behavior adapts to active profile

**Independent Test**: List profiles → select one → verify system prompt changes → behavior reflects profile

### Tests for User Story 4

- [ ] T097 [P] [US4] Unit test: ProfileManager loads and parses PROFILE.md in `packages/engine/tests/secret-sauce/ProfileManager.test.ts`
- [ ] T098 [P] [US4] Unit test: Profile switch updates context builder in `packages/engine/tests/agent/Agent.test.ts`
- [ ] T099 [P] [US4] Component test: ProfileSelector renders and navigates in `packages/tui/tests/components/ProfileSelector.test.tsx`

### Implementation for User Story 4

- [ ] T100 [US4] Create ProfileManager in `packages/engine/src/secret-sauce/ProfileManager.ts` (load, list, get, switch profiles)
- [ ] T101 [US4] Create default profiles in `data/secret-sauce/PROFILE.md` (Software Architect, Finance Head, Creative Writer, General Assistant)
- [ ] T102 [US4] Create ProfileSelector component in `packages/tui/src/components/ProfileSelector.tsx` (scrollable list with descriptions)
- [ ] T103 [US4] Implement `/profile` command (list/switch subcommands) in `packages/engine/src/commands/builtin/profile.ts`
- [ ] T104 [US4] Integrate profile context into MessageProcessor (inject active profile's system prompt)
- [ ] T105 [US4] Add profile tracking to session (persist profile switches in session metadata)
- [ ] T105.1 [US4] Implement profile-based tool filtering in ToolRegistry (profile.enabledTools/disabledTools controls which tools are available to the model in tool descriptions)
- [ ] T105.2 [US4] Implement profile toolPreferences for MessageSanitizer (profile.toolPreferences biases tool hints toward profile-relevant categories)
- [ ] T105.3 [US4] Unit test: Profile with enabledTools restricts available tools in `packages/engine/tests/tools/ProfileToolFilter.test.ts`

**Checkpoint**: User can `/profile list`, select a profile, and agent responds in character

---

## Phase 7: User Story 5 - Tool Execution with Permissions (Priority: P2)

**Goal**: Agent identifies tool need, checks permissions, asks user if needed, executes within scope, shows results

**Independent Test**: Request requiring tool → permission prompt → grant → execute → verify scope boundary

### Tests for User Story 5

- [ ] T106 [P] [US5] Unit test: ScopeGuard blocks paths outside scope in `packages/engine/tests/tools/ScopeGuard.test.ts`
- [ ] T107 [P] [US5] Unit test: PermissionManager checks/grants/denies in `packages/engine/tests/tools/PermissionManager.test.ts`
- [ ] T108 [P] [US5] Unit test: ToolExecutor handles timeout/error in `packages/engine/tests/tools/ToolExecutor.test.ts`
- [ ] T109 [P] [US5] Unit test: file-read tool reads within scope in `packages/engine/tests/tools/builtin/file-read.test.ts`
- [ ] T110 [P] [US5] Component test: PermissionPrompt renders options in `packages/tui/tests/components/PermissionPrompt.test.tsx`

### Implementation for User Story 5

- [ ] T111 [US5] Create ToolRegistry in `packages/engine/src/tools/ToolRegistry.ts` (register, list, get tools by ID, filter by active profile)
- [ ] T112 [US5] Create ToolSchema in `packages/engine/src/tools/ToolSchema.ts` (Zod schemas for tool definitions)
- [ ] T113 [US5] Create ScopeGuard in `packages/engine/src/tools/permissions/ScopeGuard.ts` (validate paths within scope, resolve symlinks)
- [ ] T114 [US5] Create PermissionManager in `packages/engine/src/tools/permissions/PermissionManager.ts` (check, grant, deny, persist)
- [ ] T115 [US5] Create PermissionStore in `packages/engine/src/tools/permissions/PermissionStore.ts` (SQLite persistence for permissions)
- [ ] T116 [US5] Create ToolExecutor in `packages/engine/src/tools/ToolExecutor.ts` (pipeline: permission → scope → execute → format)
- [ ] T117 [P] [US5] Implement tool: file-read in `packages/engine/src/tools/builtin/file-read.ts`
- [ ] T118 [P] [US5] Implement tool: file-write in `packages/engine/src/tools/builtin/file-write.ts`
- [ ] T119 [P] [US5] Implement tool: file-delete in `packages/engine/src/tools/builtin/file-delete.ts`
- [ ] T120 [P] [US5] Implement tool: folder-create in `packages/engine/src/tools/builtin/folder-create.ts`
- [ ] T121 [P] [US5] Implement tool: folder-delete in `packages/engine/src/tools/builtin/folder-delete.ts`
- [ ] T122 [P] [US5] Implement tool: folder-list in `packages/engine/src/tools/builtin/folder-list.ts`
- [ ] T123 [P] [US5] Implement tool: folder-move in `packages/engine/src/tools/builtin/folder-move.ts`
- [ ] T124 [US5] Create PermissionPrompt component in `packages/tui/src/components/PermissionPrompt.tsx` (Allow once/Always/Deny)
- [ ] T125 [US5] Create ToolAction component in `packages/tui/src/components/ToolAction.tsx` (show tool execution with animation)
- [ ] T126 [US5] Integrate tool calling into Agent (detect tool_calls from provider, trigger execution pipeline)
- [ ] T127 [US5] Implement `/tools` command (list available tools) in `packages/engine/src/commands/builtin/tools.ts`
- [ ] T128 [US5] Implement `/permissions` command (view/revoke) in `packages/engine/src/commands/builtin/permissions.ts`

**Checkpoint**: Agent can identify need for tool, ask permission, execute within scope, display results

---

## Phase 7.5: User Story 8 - Sub-Agent Worker System & Message Sanitization (Priority: P2)

**Goal**: Complex tasks are decomposed into sub-agent assignments, messages are sanitized before model, internal errors are shielded from user

**Independent Test**: Complex multi-tool request → sub-agents spawn → parallel execution → aggregated result; user never sees raw errors or internal coordination

### Tests for User Story 8 (Sub-Agents)

- [ ] T128.1 [P] [US8] Unit test: SubAgentManager spawns and tracks workers in `packages/engine/tests/agents/SubAgentManager.test.ts`
- [ ] T128.2 [P] [US8] Unit test: TaskAssigner decomposes complex requests into sub-tasks in `packages/engine/tests/agents/TaskAssigner.test.ts`
- [ ] T128.3 [P] [US8] Unit test: MessageSanitizer transforms raw input into structured prompts in `packages/engine/tests/agents/MessageSanitizer.test.ts`
- [ ] T128.4 [P] [US8] Unit test: ErrorShield catches all internal errors and emits gimmick events in `packages/engine/tests/agents/ErrorShield.test.ts`
- [ ] T128.5 [P] [US8] Integration test: Full delegation flow (complex task → decompose → spawn → execute → aggregate → display) in `packages/engine/tests/agents/delegation-flow.test.ts`
- [ ] T128.6 [P] [US8] Unit test: SubAgent respects scope and permission boundaries in `packages/engine/tests/agents/SubAgent.test.ts`
- [ ] T128.7 [P] [US8] Component test: AgentProgress animation shows multi-stage status in `packages/tui/tests/components/AgentProgress.test.tsx`

### Implementation for User Story 8 (Sub-Agents)

- [ ] T128.8 [US8] Create shared agent types in `packages/shared/src/types/agent.ts` (SubAgent, TaskAssignment, SubAgentResult, MessageIntent, SanitizedMessage)
- [ ] T128.9 [US8] Create MessageSanitizer in `packages/engine/src/agent/MessageSanitizer.ts` (intent extraction, context injection, prompt structuring, tool hinting, safety filtering, output directive)
- [ ] T128.10 [US8] Create TaskAssigner in `packages/engine/src/agent/TaskAssigner.ts` (analyze model response, determine direct vs. delegate, create TaskAssignment objects)
- [ ] T128.11 [US8] Create SubAgent worker in `packages/engine/src/agent/SubAgent.ts` (receives instruction + tools, executes tool pipeline, reports result, respects timeout/scope)
- [ ] T128.12 [US8] Create SubAgentManager in `packages/engine/src/agent/SubAgentManager.ts` (spawn, track, cancel, awaitAll, aggregateResults)
- [ ] T128.13 [US8] Create ErrorShield in `packages/engine/src/agent/ErrorShield.ts` (wrap operations, catch errors, log internally, emit gimmick events, NEVER bubble to user)
- [ ] T128.14 [US8] Create AgentTaskStore in `packages/engine/src/agent/AgentTaskStore.ts` (SQLite persistence for agent_tasks table)
- [ ] T128.15 [US8] Integrate MessageSanitizer into MessageProcessor (sanitize BEFORE every AI model call)
- [ ] T128.16 [US8] Integrate TaskAssigner into Agent.ts (after model response, detect multi-tool calls, decompose if complex)
- [ ] T128.17 [US8] Integrate SubAgentManager into Agent.ts (spawn workers from task assignments, await results, compose response)
- [ ] T128.18 [US8] Integrate ErrorShield wrapping across all public-facing engine operations
- [ ] T128.19 [US8] Create AgentProgress component in `packages/tui/src/components/AgentProgress.tsx` (animated multi-stage progress: "Working on it...", "3 tasks active", tool action descriptions)
- [ ] T128.20 [US8] Create GimmickDisplay component in `packages/tui/src/components/GimmickDisplay.tsx` (error replacement animations: "thinking", "recalculating", "adjusting")
- [ ] T128.21 [US8] Add agent_spawned, agent_progress, agent_complete, reasoning_start, reasoning_glimpse, reasoning_complete events to EngineEvent union type
- [ ] T128.22 [US8] Implement agent timeout and cancellation (if sub-agent exceeds timeout, cancel and retry or fail gracefully)
- [ ] T128.23 [US8] Create internal logging for shielded errors in `~/.local/share/agentx/logs/` (structured JSON, never shown to user)
- [ ] T128.24 [US8] Create ReasoningGlimpse component in `packages/tui/src/components/ReasoningGlimpse.tsx` (ephemeral fade-in/out thought bubbles during model reasoning phase, auto-collapse when reasoning ends)
- [ ] T128.25 [US8] Implement reasoning token extraction in MessageProcessor (parse model's reasoning/thinking tokens into human-readable glimpse summaries without exposing raw content)
- [ ] T128.26 [US8] Implement phase transition logic in Agent.ts (Reasoning Phase → Execution Phase → Response Phase) with corresponding UI state events
- [ ] T128.27 [US8] Unit test: ReasoningGlimpse shows ephemeral text and collapses on reasoning_complete event in `packages/tui/tests/components/ReasoningGlimpse.test.tsx`

### Implementation for Agent TODO List System

- [ ] T128.28 [US8] Create TodoManager in `packages/engine/src/agent/TodoManager.ts` — create/update/complete TODO items for multi-step tasks, track progress, persist to session
- [ ] T128.29 [US8] Create TodoProgress component in `packages/tui/src/components/TodoProgress.tsx` — compact progress indicator showing current step / total steps with labels (e.g., "Step 3/7: Writing tests")
- [ ] T128.29a [US8] Integrate TodoManager into TaskAssigner — when complex task is decomposed, automatically generate a TODO list from sub-tasks
- [ ] T128.29b [US8] Emit `todo_update` engine events (item added, item in-progress, item completed) for UI reactivity
- [ ] T128.29c [US8] Unit test: TodoManager creates, tracks, and completes items; TodoProgress renders correctly

### Implementation for Background Tasks, Steering & Parallel Agents

- [ ] T128.30 [US8] Create TaskContext type and TaskManager in `packages/engine/src/agent/TaskManager.ts` (manage foreground/background tasks, track parallel task groups, allocate token budgets)
- [ ] T128.31 [US8] Implement background task switching: `/bg` command and Ctrl+B keybinding move active foreground task to background mode
- [ ] T128.32 [US8] Implement background task result queuing — when background task completes, queue result and present when user is not mid-input
- [ ] T128.33 [US8] Implement `/tasks` command to list all active/completed background tasks with status and elapsed time
- [ ] T128.34 [US8] Create SteerMessageHandler in `packages/engine/src/agent/SteerMessageHandler.ts` — receives steer messages mid-execution, routes to orchestrator for task redirection
- [ ] T128.35 [US8] Implement steer message routing in Agent.ts: detect user input while task is active, classify as steer (not new task), pass to active sub-agents or adjust task decomposition
- [ ] T128.36 [US8] Implement steer message rate-limiting (max 1 per 3 seconds to prevent flooding)
- [ ] T128.37 [US8] Implement parallel multi-agent orchestration in TaskManager — allow N tasks running simultaneously (1 foreground + N background)
- [ ] T128.38 [US8] Implement token budget sharing across parallel tasks (orchestrator allocates portions, prioritizes foreground)
- [ ] T128.39 [US8] Create BackgroundTaskIndicator component in `packages/tui/src/components/BackgroundTaskIndicator.tsx` (compact status in session panel: task name + timer + spinning dot)
- [ ] T128.40 [US8] Integrate TaskManager with SessionPanel (show background task count and status)
- [ ] T128.41 [US8] Unit test: TaskManager switches foreground→background, queues results, handles steer messages
- [ ] T128.42 [US8] Integration test: Two parallel tasks (foreground + background) running simultaneously with independent progress

**Checkpoint**: Complex requests spawn sub-agents, execute in parallel, aggregate results; user sees only progress animations; internal errors produce gimmicks not stack traces; tasks can be backgrounded; steer messages redirect active work; multiple agents run in parallel

---

## Phase 8: User Story 6 - Session Management (Priority: P2)

**Goal**: Sessions persist, can be listed, and restored with full context

**Independent Test**: Create session → interact → close → restore by ID → verify full context

### Tests for User Story 6

- [ ] T129 [P] [US6] Unit test: SessionStore CRUD operations in `packages/engine/tests/session/SessionStore.test.ts`
- [ ] T130 [P] [US6] Unit test: SessionManager auto-save in `packages/engine/tests/session/SessionManager.test.ts`
- [ ] T131 [P] [US6] Integration test: Session create → persist → restore full flow

### Implementation for User Story 6

- [ ] T132 [US6] Complete SessionStore with full CRUD in `packages/engine/src/session/SessionStore.ts` (create, get, update, close, list, delete)
- [ ] T133 [US6] Create MessageStore in `packages/engine/src/session/MessageStore.ts` (persist messages with token counts)
- [ ] T134 [US6] Implement session auto-save (30s interval + on graceful exit) in SessionManager
- [ ] T135 [US6] Implement session restore logic (load session + messages + permissions from SQLite)
- [ ] T136 [US6] Create `agentx session <id>` command in `packages/cli/src/commands/session.ts`
- [ ] T137 [US6] Implement `/sessions` command (list recent sessions with metadata) in `packages/engine/src/commands/builtin/sessions.ts`
- [ ] T138 [US6] Create SessionRestore screen in `packages/tui/src/screens/SessionRestore.tsx` (loading animation → restored context)
- [ ] T139 [US6] Add session metadata to SessionPanel component (real-time elapsed time, token percentage)

**Checkpoint**: Sessions persist across process restarts and can be fully restored

---

## Phase 9: User Story 7 - Secret Sauce System (Priority: P2)

**Goal**: Agent uses personality files for consistency, updates memories/diary, auto-summarizes

**Independent Test**: Interact → verify MEMORIES.md updates → verify DIARY.md entry → verify summarization → verify no leaks

### Tests for User Story 7

- [ ] T140 [P] [US7] Unit test: SecretSauceManager builds context within budget in `packages/engine/tests/secret-sauce/SecretSauceManager.test.ts`
- [ ] T141 [P] [US7] Unit test: MemoryManager updates and summarizes in `packages/engine/tests/secret-sauce/MemoryManager.test.ts`
- [ ] T142 [P] [US7] Unit test: DiaryManager writes daily entries in `packages/engine/tests/secret-sauce/DiaryManager.test.ts`
- [ ] T143 [P] [US7] Unit test: Summarizer reduces content within token threshold in `packages/engine/tests/secret-sauce/Summarizer.test.ts`
- [ ] T144 [P] [US7] Security test: Verify no Secret Sauce content appears in user-visible output

### Implementation for User Story 7

- [ ] T145 [US7] Create SecretSauceManager in `packages/engine/src/secret-sauce/SecretSauceManager.ts` (orchestrate all MD files, build context)
- [ ] T146 [US7] Create SoulManager in `packages/engine/src/secret-sauce/SoulManager.ts` (load SOUL.md, always-include logic)
- [ ] T147 [US7] Create MemoryManager in `packages/engine/src/secret-sauce/MemoryManager.ts` (load, update, 30-day window, recency sorting)
- [ ] T148 [US7] Create DiaryManager in `packages/engine/src/secret-sauce/DiaryManager.ts` (daily entry creation, session stats)
- [ ] T149 [US7] Create IdentityManager in `packages/engine/src/secret-sauce/IdentityManager.ts` (load identity, evolve over time)
- [ ] T150 [US7] Create Summarizer in `packages/engine/src/secret-sauce/Summarizer.ts` (auto-summarize when exceeding threshold, use AI)
- [ ] T151 [US7] Integrate Secret Sauce context into MessageProcessor (inject before each AI call, respect token budget)
- [ ] T152 [US7] Implement post-session hooks (update memories, write diary entry on session close)
- [ ] T153 [US7] Add output filtering layer (strip any accidental Secret Sauce references from responses)

**Checkpoint**: Agent maintains personality across sessions, memories update, diary tracks activity, no leaks

---

## Phase 10: User Story 9 - Telegram Integration (Priority: P3)

**Goal**: Configure Telegram bot, send/receive messages, share session context

**Independent Test**: Configure bot → send Telegram message → receive response → verify shared context

### Tests for User Story 9

- [ ] T154 [P] [US9] Unit test: TelegramBridge connects and receives messages in `packages/engine/tests/telegram/TelegramBridge.test.ts`
- [ ] T155 [P] [US9] Unit test: Permission prompt sent as inline keyboard in `packages/engine/tests/telegram/TelegramBridge.test.ts`

### Implementation for User Story 9

- [ ] T156 [US9] Create TelegramBridge in `packages/engine/src/telegram/TelegramBridge.ts` (bot setup, message handling, session bridging)
- [ ] T157 [US9] Implement `/telegram setup` command in `packages/engine/src/commands/builtin/telegram.ts` (guided token configuration)
- [ ] T158 [US9] Implement Telegram permission prompts (inline keyboards for Allow/Deny)
- [ ] T159 [US9] Implement `/telegram status` command (connection info, last activity)
- [ ] T160 [US9] Bridge Telegram messages to Engine.sendMessage (shared session context)
- [ ] T161 [US9] Add typing indicator for long-running operations via Telegram API

**Checkpoint**: Messages sent via Telegram are processed by the same engine and session

---

## Phase 11: User Story 10 - Installation & Distribution (Priority: P3)

**Goal**: Three installation channels all produce a working `agentx` CLI (priority: curl > npm > Docker)

**Independent Test**: Install via each method → `agentx --version` → verify TUI launches

### Implementation for User Story 10

**Priority 1: curl install script**
- [ ] T163 [P] [US10] Create install script in `scripts/install.sh` — detect OS (macOS/Linux), arch (x64/arm64), download binary from GitHub Releases, verify SHA-256 checksum, install to PATH
- [ ] T163.1 [US10] Install script: add fallback install to `~/.local/bin/` when no sudo available
- [ ] T163.2 [US10] Install script: add `--version` flag to install specific version
- [ ] T163.3 [US10] Install script: print post-install success message with version and next steps

**Priority 2: npm package**
- [ ] T162 [P] [US10] Create npm package configuration in `packages/cli/package.json` (bin entry, `@agentx/cli` scope, publish config)
- [ ] T168 [US10] Create `tsup.config.ts` for production bundling (single-file CLI output)
- [ ] T168.1 [US10] Add npm postinstall script that prints welcome banner

**Priority 3: Docker image**
- [ ] T164 [P] [US10] Create Dockerfile in `docker/Dockerfile` (multi-stage: build → production alpine image, interactive TTY)
- [ ] T165 [P] [US10] Create docker-compose.yml in `docker/docker-compose.yml` (dev environment with volume mounts for scope folder)
- [ ] T164.1 [US10] Docker: ensure `-it` mode launches TUI correctly, `-v` mounts scope folder
- [ ] T164.2 [US10] Publish to Docker Hub as `agentx/agent-x` (public, auto-tagged with version)

**CI/CD**
- [ ] T166 [US10] Create `.github/workflows/release.yml` — on tag push: build binaries (macOS/Linux x64/arm64), publish to npm, build & push Docker image to Hub, create GitHub Release with binaries + checksums
- [ ] T166.1 [US10] Generate SHA-256 checksums file for all release binaries

**Priority 4: brew (self-managed tap)**
- [ ] T167 [US10] Create Homebrew formula in `Formula/agentx.rb` (points to GitHub Release binary, auto-detect arch)
- [ ] T167.1 [US10] Add brew formula update step to release.yml (auto-bump version + SHA in formula on release)

**Checkpoint**: `curl -fsSL .../install.sh | bash && agentx --version` works; `npm install -g @agentx/cli && agentx` works; `docker run -it agentx/agent-x` shows TUI; `brew install agentx/tap/agentx` works

---

## Phase 12: Additional Providers (Priority: P2, can parallelize with Phase 6-9)

**Goal**: Support all specified AI providers beyond OpenAI

**Independent Test**: Switch to each provider → validate → list models → send message → receive response

### Implementation

- [ ] T169 [P] Implement AnthropicProvider in `packages/engine/src/providers/AnthropicProvider.ts` (validate, listModels, complete with streaming + extended thinking/reasoning token support)
- [ ] T170 [P] Implement GoogleProvider in `packages/engine/src/providers/GoogleProvider.ts` (Gemini API integration + thinking tokens support)
- [ ] T171 [P] Implement OllamaProvider in `packages/engine/src/providers/OllamaProvider.ts` (local REST API on localhost:11434)
- [ ] T172 [P] Implement LMStudioProvider in `packages/engine/src/providers/LMStudioProvider.ts` (OpenAI-compatible API on custom port)
- [ ] T173 [P] Unit test: AnthropicProvider streaming in `packages/engine/tests/providers/AnthropicProvider.test.ts`
- [ ] T174 [P] Unit test: GoogleProvider streaming in `packages/engine/tests/providers/GoogleProvider.test.ts`
- [ ] T175 [P] Unit test: OllamaProvider connectivity in `packages/engine/tests/providers/OllamaProvider.test.ts`
- [ ] T176 [P] Unit test: LMStudioProvider compatibility in `packages/engine/tests/providers/LMStudioProvider.test.ts`
- [ ] T176.1 [P] Implement reasoning token normalization across all providers in `packages/engine/src/providers/ReasoningExtractor.ts` (extract reasoning_delta from provider-specific formats: Anthropic extended_thinking, OpenAI reasoning_content, Gemini thinking → unified reasoning_glimpse events)

**Checkpoint**: All 5 providers can validate, list models, and stream completions

---

## Phase 13: Tool Expansion — Power User Tier (Priority: P2)

**Goal**: Expand beyond basic filesystem to cover code intelligence, git, packages, documents, testing, and data processing tools

**Independent Test**: Use each tool category → verify scope enforcement → verify risk-based permission prompting

### 13A: Tool Infrastructure

- [ ] T177 Create ToolLoader in `packages/engine/src/tools/ToolLoader.ts` (dynamic registration from builtin/ subdirectories + plugins)
- [ ] T178 Create ToolCategories in `packages/engine/src/tools/ToolCategories.ts` (20 category definitions with risk mappings)
- [ ] T179 Create RiskPolicy in `packages/engine/src/tools/permissions/RiskPolicy.ts` (auto-allow Low, prompt Medium, always-prompt High, double-confirm Critical)
- [ ] T180 Create PluginLoader in `packages/engine/src/tools/plugins/PluginLoader.ts` (load custom tools from ~/.config/agentx/plugins/)
- [ ] T181 Create MCPBridge in `packages/engine/src/tools/plugins/MCPBridge.ts` (bridge MCP server tools into ToolRegistry)
- [ ] T182 [P] Unit test: ToolLoader discovers and registers all builtin tools in `packages/engine/tests/tools/ToolLoader.test.ts`
- [ ] T183 [P] Unit test: RiskPolicy auto-allows Low, prompts Medium+ in `packages/engine/tests/tools/RiskPolicy.test.ts`

### 13B: Filesystem Tools (Complete Set)

- [ ] T184 [P] Implement tool: file-edit in `packages/engine/src/tools/builtin/filesystem/file-edit.ts` (surgical string replacement)
- [ ] T185 [P] Implement tool: file-move in `packages/engine/src/tools/builtin/filesystem/file-move.ts`
- [ ] T186 [P] Implement tool: file-copy in `packages/engine/src/tools/builtin/filesystem/file-copy.ts`
- [ ] T187 [P] Implement tool: file-search in `packages/engine/src/tools/builtin/filesystem/file-search.ts` (glob + content search)
- [ ] T188 [P] Implement tool: file-diff in `packages/engine/src/tools/builtin/filesystem/file-diff.ts`
- [ ] T189 [P] Implement tool: file-patch in `packages/engine/src/tools/builtin/filesystem/file-patch.ts`
- [ ] T190 [P] Implement tool: file-metadata in `packages/engine/src/tools/builtin/filesystem/file-metadata.ts`
- [ ] T190.1 [P] Implement tool: file-open in `packages/engine/src/tools/builtin/filesystem/file-open.ts` (open file in system default editor/viewer)
- [ ] T191 [P] Implement tool: folder-tree in `packages/engine/src/tools/builtin/filesystem/folder-tree.ts`
- [ ] T191.1 [P] Implement tool: folder-open in `packages/engine/src/tools/builtin/filesystem/folder-open.ts` (open folder in system file explorer)
- [ ] T192 [P] Implement tool: archive-create in `packages/engine/src/tools/builtin/filesystem/archive-create.ts`
- [ ] T193 [P] Implement tool: archive-extract in `packages/engine/src/tools/builtin/filesystem/archive-extract.ts`

### 13C: Code Intelligence Tools

- [ ] T194 [P] Implement tool: code-search in `packages/engine/src/tools/builtin/code/code-search.ts` (semantic + AST-aware)
- [ ] T195 [P] Implement tool: code-grep in `packages/engine/src/tools/builtin/code/code-grep.ts` (regex across codebase)
- [ ] T196 [P] Implement tool: code-symbols in `packages/engine/src/tools/builtin/code/code-symbols.ts` (list functions/classes/exports)
- [ ] T197 [P] Implement tool: code-references in `packages/engine/src/tools/builtin/code/code-references.ts` (find all usages)
- [ ] T198 [P] Implement tool: code-format in `packages/engine/src/tools/builtin/code/code-format.ts` (run project formatter)
- [ ] T199 [P] Implement tool: code-lint in `packages/engine/src/tools/builtin/code/code-lint.ts` (diagnostics)
- [ ] T200 [P] Implement tool: code-fix in `packages/engine/src/tools/builtin/code/code-fix.ts` (auto-fix lint errors)
- [ ] T201 [P] Implement tool: code-typecheck in `packages/engine/src/tools/builtin/code/code-typecheck.ts`
- [ ] T202 [P] Implement tool: code-analyze in `packages/engine/src/tools/builtin/code/code-analyze.ts` (complexity/deps)

### 13D: Shell & Process Tools

- [ ] T203 [P] Implement tool: shell-exec in `packages/engine/src/tools/builtin/shell/shell-exec.ts` (with timeout + sandbox)
- [ ] T204 [P] Implement tool: shell-exec-streaming in `packages/engine/src/tools/builtin/shell/shell-exec-streaming.ts`
- [ ] T205 [P] Implement tool: shell-background in `packages/engine/src/tools/builtin/shell/shell-background.ts`
- [ ] T206 [P] Implement tool: shell-kill in `packages/engine/src/tools/builtin/shell/shell-kill.ts`
- [ ] T207 [P] Implement tool: shell-status in `packages/engine/src/tools/builtin/shell/shell-status.ts`
- [ ] T208 [P] Implement tool: process-list in `packages/engine/src/tools/builtin/shell/process-list.ts`
- [ ] T209 [P] Implement tool: port-check in `packages/engine/src/tools/builtin/shell/port-check.ts`

### 13E: Git & VCS Tools

- [ ] T210 [P] Implement tool: git-status in `packages/engine/src/tools/builtin/git/git-status.ts`
- [ ] T211 [P] Implement tool: git-diff in `packages/engine/src/tools/builtin/git/git-diff.ts`
- [ ] T212 [P] Implement tool: git-log in `packages/engine/src/tools/builtin/git/git-log.ts`
- [ ] T213 [P] Implement tool: git-add in `packages/engine/src/tools/builtin/git/git-add.ts`
- [ ] T214 [P] Implement tool: git-commit in `packages/engine/src/tools/builtin/git/git-commit.ts`
- [ ] T215 [P] Implement tool: git-branch in `packages/engine/src/tools/builtin/git/git-branch.ts`
- [ ] T216 [P] Implement tool: git-checkout in `packages/engine/src/tools/builtin/git/git-checkout.ts`
- [ ] T217 [P] Implement tool: git-push in `packages/engine/src/tools/builtin/git/git-push.ts`
- [ ] T218 [P] Implement tool: git-pull in `packages/engine/src/tools/builtin/git/git-pull.ts`
- [ ] T219 [P] Implement tool: git-stash in `packages/engine/src/tools/builtin/git/git-stash.ts`
- [ ] T220 [P] Implement tool: git-blame in `packages/engine/src/tools/builtin/git/git-blame.ts`

### 13F: Package Manager Tools

- [ ] T221 [P] Implement tool: pkg-install in `packages/engine/src/tools/builtin/packages/pkg-install.ts` (detect npm/pip/cargo)
- [ ] T222 [P] Implement tool: pkg-uninstall in `packages/engine/src/tools/builtin/packages/pkg-uninstall.ts`
- [ ] T223 [P] Implement tool: pkg-update in `packages/engine/src/tools/builtin/packages/pkg-update.ts`
- [ ] T224 [P] Implement tool: pkg-list in `packages/engine/src/tools/builtin/packages/pkg-list.ts`
- [ ] T225 [P] Implement tool: pkg-outdated in `packages/engine/src/tools/builtin/packages/pkg-outdated.ts`
- [ ] T226 [P] Implement tool: pkg-audit in `packages/engine/src/tools/builtin/packages/pkg-audit.ts`
- [ ] T227 [P] Implement tool: pkg-search in `packages/engine/src/tools/builtin/packages/pkg-search.ts`

### 13G: Document Generation Tools

- [ ] T228 [P] Implement tool: doc-markdown in `packages/engine/src/tools/builtin/documents/doc-markdown.ts`
- [ ] T229 [P] Implement tool: doc-pdf in `packages/engine/src/tools/builtin/documents/doc-pdf.ts` (via pdfkit)
- [ ] T230 [P] Implement tool: doc-html in `packages/engine/src/tools/builtin/documents/doc-html.ts`
- [ ] T231 [P] Implement tool: doc-csv in `packages/engine/src/tools/builtin/documents/doc-csv.ts`
- [ ] T232 [P] Implement tool: doc-json in `packages/engine/src/tools/builtin/documents/doc-json.ts`
- [ ] T233 [P] Implement tool: doc-yaml in `packages/engine/src/tools/builtin/documents/doc-yaml.ts`
- [ ] T234 [P] Implement tool: doc-diagram in `packages/engine/src/tools/builtin/documents/doc-diagram.ts` (Mermaid/D2)
- [ ] T234.1 [P] Implement tool: doc-docx in `packages/engine/src/tools/builtin/documents/doc-docx.ts` (Word documents via docx library — formatting, tables, headers, styles)
- [ ] T234.2 [P] Implement tool: doc-excel in `packages/engine/src/tools/builtin/documents/doc-excel.ts` (Excel spreadsheets via exceljs — sheets, formulas, charts, formatting)
- [ ] T234.3 [P] Implement tool: doc-presentation in `packages/engine/src/tools/builtin/documents/doc-presentation.ts` (Presentations via pptxgenjs — slides, layouts, images, transitions)
- [ ] T234.4 [P] Implement tool: doc-latex in `packages/engine/src/tools/builtin/documents/doc-latex.ts` (LaTeX documents — academic papers, reports, equations)

### 13H: Testing Tools

- [ ] T235 [P] Implement tool: test-run in `packages/engine/src/tools/builtin/testing/test-run.ts` (detect test runner)
- [ ] T236 [P] Implement tool: test-run-single in `packages/engine/src/tools/builtin/testing/test-run-single.ts`
- [ ] T237 [P] Implement tool: test-coverage in `packages/engine/src/tools/builtin/testing/test-coverage.ts`
- [ ] T238 [P] Implement tool: test-generate in `packages/engine/src/tools/builtin/testing/test-generate.ts`
- [ ] T239 [P] Implement tool: benchmark-run in `packages/engine/src/tools/builtin/testing/benchmark-run.ts`

### 13I: Data Processing Tools

- [ ] T240 [P] Implement tool: json-parse in `packages/engine/src/tools/builtin/data/json-parse.ts` (jq-like queries)
- [ ] T241 [P] Implement tool: json-transform in `packages/engine/src/tools/builtin/data/json-transform.ts`
- [ ] T242 [P] Implement tool: csv-parse in `packages/engine/src/tools/builtin/data/csv-parse.ts`
- [ ] T243 [P] Implement tool: regex-match in `packages/engine/src/tools/builtin/data/regex-match.ts`
- [ ] T244 [P] Implement tool: regex-replace in `packages/engine/src/tools/builtin/data/regex-replace.ts`
- [ ] T245 [P] Implement tool: text-diff in `packages/engine/src/tools/builtin/data/text-diff.ts`
- [ ] T246 [P] Implement tool: base64-encode in `packages/engine/src/tools/builtin/data/base64-encode.ts`
- [ ] T247 [P] Implement tool: validate-schema in `packages/engine/src/tools/builtin/data/validate-schema.ts`

**Checkpoint**: All Power User tier tools functional with risk-based permissions and scope enforcement

---

## Phase 14: Tool Expansion — Advanced Tier (Priority: P3)

**Goal**: Web/network, browser automation, database, containers, AI meta-tools, communication

### 14A: Web & Network Tools

- [ ] T248 [P] Implement tool: http-request in `packages/engine/src/tools/builtin/web/http-request.ts`
- [ ] T249 [P] Implement tool: http-download in `packages/engine/src/tools/builtin/web/http-download.ts`
- [ ] T250 [P] Implement tool: web-scrape in `packages/engine/src/tools/builtin/web/web-scrape.ts`
- [ ] T251 [P] Implement tool: web-search in `packages/engine/src/tools/builtin/web/web-search.ts`
- [ ] T252 [P] Implement tool: web-browse in `packages/engine/src/tools/builtin/web/web-browse.ts` (headless Playwright)
- [ ] T253 [P] Implement tool: api-call in `packages/engine/src/tools/builtin/web/api-call.ts`

### 14B: Browser Automation Tools

- [ ] T254 [P] Implement tool: browser-open in `packages/engine/src/tools/builtin/browser/browser-open.ts`
- [ ] T255 [P] Implement tool: browser-click in `packages/engine/src/tools/builtin/browser/browser-click.ts`
- [ ] T256 [P] Implement tool: browser-type in `packages/engine/src/tools/builtin/browser/browser-type.ts`
- [ ] T257 [P] Implement tool: browser-screenshot in `packages/engine/src/tools/builtin/browser/browser-screenshot.ts`
- [ ] T258 [P] Implement tool: browser-extract in `packages/engine/src/tools/builtin/browser/browser-extract.ts`
- [ ] T259 [P] Implement tool: browser-navigate in `packages/engine/src/tools/builtin/browser/browser-navigate.ts`

### 14C: Database Tools

- [ ] T260 [P] Implement tool: db-query in `packages/engine/src/tools/builtin/database/db-query.ts` (SELECT only, Low risk)
- [ ] T261 [P] Implement tool: db-execute in `packages/engine/src/tools/builtin/database/db-execute.ts` (mutations, High risk)
- [ ] T262 [P] Implement tool: db-schema in `packages/engine/src/tools/builtin/database/db-schema.ts`
- [ ] T263 [P] Implement tool: db-migrate in `packages/engine/src/tools/builtin/database/db-migrate.ts`
- [ ] T264 [P] Implement tool: db-backup in `packages/engine/src/tools/builtin/database/db-backup.ts`

### 14D: Container Tools

- [ ] T265 [P] Implement tool: docker-build in `packages/engine/src/tools/builtin/containers/docker-build.ts`
- [ ] T266 [P] Implement tool: docker-run in `packages/engine/src/tools/builtin/containers/docker-run.ts`
- [ ] T267 [P] Implement tool: docker-stop in `packages/engine/src/tools/builtin/containers/docker-stop.ts`
- [ ] T268 [P] Implement tool: docker-logs in `packages/engine/src/tools/builtin/containers/docker-logs.ts`
- [ ] T269 [P] Implement tool: docker-compose-up in `packages/engine/src/tools/builtin/containers/docker-compose-up.ts`
- [ ] T270 [P] Implement tool: docker-compose-down in `packages/engine/src/tools/builtin/containers/docker-compose-down.ts`

### 14E: AI Meta-Tools

- [ ] T271 [P] Implement tool: ai-complete in `packages/engine/src/tools/builtin/ai/ai-complete.ts` (call sub-model for task)
- [ ] T272 [P] Implement tool: ai-embed in `packages/engine/src/tools/builtin/ai/ai-embed.ts`
- [ ] T273 [P] Implement tool: ai-summarize in `packages/engine/src/tools/builtin/ai/ai-summarize.ts`
- [ ] T274 [P] Implement tool: ai-classify in `packages/engine/src/tools/builtin/ai/ai-classify.ts`
- [ ] T275 [P] Implement tool: ai-extract in `packages/engine/src/tools/builtin/ai/ai-extract.ts`
- [ ] T276 [P] Implement tool: memory-store in `packages/engine/src/tools/builtin/ai/memory-store.ts`
- [ ] T277 [P] Implement tool: memory-recall in `packages/engine/src/tools/builtin/ai/memory-recall.ts`

### 14F: Communication & Notification Tools

- [ ] T278 [P] Implement tool: notify-desktop in `packages/engine/src/tools/builtin/communication/notify-desktop.ts`
- [ ] T279 [P] Implement tool: notify-telegram in `packages/engine/src/tools/builtin/communication/notify-telegram.ts`
- [ ] T280 [P] Implement tool: notify-slack in `packages/engine/src/tools/builtin/communication/notify-slack.ts`
- [ ] T281 [P] Implement tool: notify-webhook in `packages/engine/src/tools/builtin/communication/notify-webhook.ts`
- [ ] T282 [P] Implement tool: clipboard-read in `packages/engine/src/tools/builtin/communication/clipboard-read.ts`
- [ ] T283 [P] Implement tool: clipboard-write in `packages/engine/src/tools/builtin/communication/clipboard-write.ts`

**Checkpoint**: All Advanced tier tools functional; agent can browse web, query databases, manage containers, call sub-models

---

## Phase 15: Tool Expansion — Ecosystem & Specialist Tier (Priority: P3)

**Goal**: GitHub/project management, system/OS, security, media, MCP integration

### 15A: GitHub & Project Management Tools

- [ ] T284 [P] Implement tool: github-issue-create in `packages/engine/src/tools/builtin/github/github-issue-create.ts`
- [ ] T285 [P] Implement tool: github-issue-list in `packages/engine/src/tools/builtin/github/github-issue-list.ts`
- [ ] T286 [P] Implement tool: github-pr-create in `packages/engine/src/tools/builtin/github/github-pr-create.ts`
- [ ] T287 [P] Implement tool: github-pr-review in `packages/engine/src/tools/builtin/github/github-pr-review.ts`
- [ ] T288 [P] Implement tool: github-release in `packages/engine/src/tools/builtin/github/github-release.ts`

### 15B: System & OS Tools

- [ ] T289 [P] Implement tool: system-info in `packages/engine/src/tools/builtin/system/system-info.ts`
- [ ] T290 [P] Implement tool: system-monitor in `packages/engine/src/tools/builtin/system/system-monitor.ts`
- [ ] T291 [P] Implement tool: cron-create in `packages/engine/src/tools/builtin/system/cron-create.ts`
- [ ] T292 [P] Implement tool: cron-list in `packages/engine/src/tools/builtin/system/cron-list.ts`
- [ ] T293 [P] Implement tool: open-app in `packages/engine/src/tools/builtin/system/open-app.ts`

### 15C: Security & Crypto Tools

- [ ] T294 [P] Implement tool: hash-generate in `packages/engine/src/tools/builtin/security/hash-generate.ts`
- [ ] T295 [P] Implement tool: encrypt-file in `packages/engine/src/tools/builtin/security/encrypt-file.ts`
- [ ] T296 [P] Implement tool: decrypt-file in `packages/engine/src/tools/builtin/security/decrypt-file.ts`
- [ ] T297 [P] Implement tool: jwt-decode in `packages/engine/src/tools/builtin/security/jwt-decode.ts`
- [ ] T298 [P] Implement tool: secret-generate in `packages/engine/src/tools/builtin/security/secret-generate.ts`

### 15D: Media & Image Tools

- [ ] T299 [P] Implement tool: image-resize in `packages/engine/src/tools/builtin/media/image-resize.ts`
- [ ] T300 [P] Implement tool: image-convert in `packages/engine/src/tools/builtin/media/image-convert.ts`
- [ ] T301 [P] Implement tool: image-compress in `packages/engine/src/tools/builtin/media/image-compress.ts`
- [ ] T302 [P] Implement tool: image-ocr in `packages/engine/src/tools/builtin/media/image-ocr.ts`
- [ ] T303 [P] Implement tool: chart-generate in `packages/engine/src/tools/builtin/media/chart-generate.ts`
- [ ] T304 [P] Implement tool: qr-generate in `packages/engine/src/tools/builtin/media/qr-generate.ts`

### 15E: MCP Integration Tools

- [ ] T305 Implement tool: mcp-server-connect in `packages/engine/src/tools/builtin/mcp/mcp-server-connect.ts`
- [ ] T306 Implement tool: mcp-tool-list in `packages/engine/src/tools/builtin/mcp/mcp-tool-list.ts`
- [ ] T307 Implement tool: mcp-tool-call in `packages/engine/src/tools/builtin/mcp/mcp-tool-call.ts`
- [ ] T308 Implement tool: mcp-resource-read in `packages/engine/src/tools/builtin/mcp/mcp-resource-read.ts`
- [ ] T309 [P] Integration test: MCP server connection + tool discovery + execution in `packages/engine/tests/tools/mcp/mcp-integration.test.ts`

**Checkpoint**: Full 263-tool catalog available; agent is a complete autonomous productivity platform

---

## Phase 16: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T310 [P] Add comprehensive error handling across all providers (retry logic, graceful degradation)
- [ ] T311 [P] Add crash recovery (detect unclean shutdown, offer session restore)
- [ ] T312 [P] Add `--verbose` and `--debug` CLI flags for troubleshooting
- [ ] T313 Performance optimization: profile startup time, optimize hot paths
- [ ] T314 [P] Add screen reader support (ARIA roles on all interactive components)
- [ ] T315 [P] Add responsive layout (adapt to terminal width: 80/120/unlimited columns)
- [ ] T316 Documentation: complete README with installation, usage, configuration guide
- [ ] T317 [P] Documentation: CONTRIBUTING.md with architecture overview and development setup
- [ ] T318 [P] Security audit: verify no credential leaks, scope enforcement, input sanitization
- [ ] T319 [P] Add lock file mechanism (prevent multiple agent instances in same scope folder)
- [ ] T320 Run full E2E test suite: fresh install → configure → interact → persist → restore
- [ ] T321 Run quickstart.md validation (document the golden path experience)
- [ ] T322 [P] Tool documentation: generate model-consumable descriptions for all 263 tools
- [ ] T323 [P] Tool integration tests: verify all 20 categories load, execute, and respect permissions

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 completion — BLOCKS all user stories
- **Phase 3 (US1 - Onboarding)**: Depends on Phase 2
- **Phase 4 (US2 - Messaging)**: Depends on Phase 2 + Phase 3 (needs wizard complete for config)
- **Phase 5 (US3 - Commands)**: Depends on Phase 4 (needs input field to detect "/")
- **Phase 6 (US4 - Profiles)**: Depends on Phase 2, can start after Phase 4
- **Phase 7 (US5 - Tools)**: Depends on Phase 4 (needs messaging working)
- **Phase 7.5 (US8 - Sub-Agents)**: Depends on Phase 7 (needs tool framework for agents to use)
- **Phase 8 (US6 - Sessions)**: Depends on Phase 4 (needs messages to persist)
- **Phase 9 (US7 - Secret Sauce)**: Depends on Phase 4 (needs message processing)
- **Phase 10 (US9 - Telegram)**: Depends on Phase 4 + Phase 7
- **Phase 11 (US10 - Distribution)**: Can start after Phase 5 (MVP complete)
- **Phase 12 (Providers)**: Depends on Phase 3 (needs provider interface)
- **Phase 13 (Power User Tools)**: Depends on Phase 7 (needs tool framework + registry)
- **Phase 14 (Advanced Tools)**: Depends on Phase 13 (needs tool infrastructure + categories)
- **Phase 15 (Ecosystem Tools)**: Depends on Phase 14 (needs web/browser foundations)
- **Phase 16 (Polish)**: Depends on all previous phases

### User Story Dependencies

- **US1 (P1)**: Independent — first to implement
- **US2 (P1)**: Depends on US1 (needs configuration)
- **US3 (P1)**: Depends on US2 (needs input field)
- **US4 (P2)**: Can start after US2
- **US5 (P2)**: Can start after US2
- **US6 (P2)**: Can start after US2
- **US7 (P2)**: Can start after US2
- **US8 (P2)**: Sub-Agent system, depends on US5 (needs tool framework)
- **US9 (P3)**: Telegram, depends on US2 + US5
- **US10 (P3)**: Distribution, independent of user stories (infrastructure)

### Parallel Opportunities

- All Phase 1 setup tasks marked [P] can run in parallel
- All Phase 2 type definitions (T017-T031) can run in parallel
- Phase 6, 7, 7.5, 8, 9 can all proceed in parallel once Phase 4 is complete (7.5 needs 7)
- Phase 12 (providers) can proceed in parallel with Phases 6-9
- Phase 13 (advanced tools) can proceed in parallel with Phase 10-11
- All test tasks marked [P] within a phase can run in parallel

---

## Implementation Strategy

### MVP First (US1 + US2 + US3)

1. Complete Phase 1: Setup → workspace ready
2. Complete Phase 2: Foundational → types and storage ready
3. Complete Phase 3: US1 → wizard works, config persists
4. Complete Phase 4: US2 → messaging works, loading animations visible
5. Complete Phase 5: US3 → slash commands functional
6. **STOP and VALIDATE**: Full MVP is testable — user can install, configure, interact, use commands
7. Deploy alpha release

### Incremental Delivery

1. Phase 1-2 → Foundation ready (internal milestone)
2. Phase 3-5 → MVP Alpha (first external testing)
3. Phase 6-9 → Feature Complete Beta (profiles, tools, sessions, secret sauce)
4. Phase 10-12 → Full Beta (all providers, Telegram, distribution)
5. Phase 13 → Power User Release (code, git, packages, docs, testing, data tools)
6. Phase 14 → Advanced Release (web, browser, database, containers, AI meta-tools)
7. Phase 15 → Ecosystem Release (GitHub, system, security, media, MCP plugins)
8. Phase 16 → Production v1.0 (polish, security audit, full documentation)

---

## Notes

- [P] tasks = different files, no dependencies — safe for parallel implementation
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable after Phase 2
- Verify tests fail before implementing (TDD where specified)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Total tasks: 194
- Estimated phases: 14
- Critical path: Phase 1 → 2 → 3 → 4 → 5 (MVP)
