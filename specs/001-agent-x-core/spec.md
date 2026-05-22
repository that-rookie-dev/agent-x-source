# Feature Specification: Agent-X Core Platform

**Feature Branch**: `001-agent-x-core`

**Created**: 2026-05-22

**Status**: Draft

**Input**: User description from `docs/INITIAL_IDEA.txt` and reference UI (Hermes Agent)

---

## Overview

Agent-X is a TUI-first AI-powered personal assistant that operates via a React Ink terminal interface. It is not "just another chat agent" — it is a deeply personalized, profile-driven, memory-rich, tool-executing autonomous agent that can become anyone's enterprise-grade personal assistant.

The agent maintains its own identity, memories, and behavioral profiles through a proprietary "Secret Sauce" system of markdown files. Users interact through a beautifully animated terminal UI with slash commands, session management, and a comprehensive permission system.

---

## User Scenarios & Testing

### User Story 1 - First-Time Setup & Onboarding (Priority: P1)

A new user installs Agent-X and runs `agentx` for the first time. They are guided through a polished setup wizard that configures their AI model provider, validates credentials, and selects a model. Upon completion, they land in the main TUI ready to interact.

**Why this priority**: Without onboarding, no user can use the product. This is the absolute first impression and must be flawless.

**Independent Test**: Run `agentx` with no existing config → complete wizard → verify config is persisted and main TUI loads.

**Acceptance Scenarios**:

1. **Given** no configuration exists, **When** user runs `agentx`, **Then** the setup wizard launches with animated welcome screen
2. **Given** wizard is active, **When** user selects a model provider (OpenAI/Anthropic/Google/Local), **Then** the appropriate configuration form appears (API key for cloud, localhost URL for local)
3. **Given** API key is entered, **When** user presses Enter, **Then** system validates the key by fetching available models
4. **Given** models are fetched, **When** model list appears, **Then** user can navigate with up/down arrows, select with spacebar, and confirm with Enter
5. **Given** user presses Escape during wizard, **Then** a confirmation dialog asks "Cancel setup? (y/n)" — if confirmed, TUI exits cleanly
6. **Given** wizard is complete, **When** configuration is saved, **Then** the main TUI loads with welcome banner, version, and input field

---

### User Story 2 - Main TUI Interaction & Messaging (Priority: P1)

A configured user runs `agentx` and sees the main TUI with a welcome banner, session info panel, and input field. They type a message, the agent processes it with animated loading indicators, and a formatted response appears.

**Why this priority**: This is the core product loop — input → processing → output. Must work before anything else.

**Independent Test**: Launch configured agent → type message → receive response → verify token counter updates.

**Acceptance Scenarios**:

1. **Given** agent is configured, **When** user runs `agentx`, **Then** TUI shows: ASCII art banner, version, provider/model info, session ID, and input field
2. **Given** TUI is active, **When** user types a message, **Then** input field shows text with real-time token counter (available/used/percentage as animated progress bar)
3. **Given** user submits a message, **When** agent is processing, **Then** animated loading indicators appear (spinner, progress, activity bars) — NEVER raw model output
4. **Given** multiple AI calls are needed, **When** processing is complex, **Then** multiple distinct loading animations communicate serious computation is happening
5. **Given** response is ready, **When** agent replies, **Then** response appears formatted with proper line wrapping, no internal system data visible
6. **Given** session is active, **When** user checks side panel, **Then** session ID, token status, time elapsed, provider, and model are visible

---

### User Story 3 - Slash Commands & Navigation (Priority: P1)

A user types "/" in the input field and a scrollable command list appears. As they type characters after "/", the list filters in real-time. They select a command and it executes.

**Why this priority**: Slash commands are the primary power-user interface and enable all advanced functionality.

**Independent Test**: Type "/" → see full command list → type characters → verify filtering → select command → verify execution.

**Acceptance Scenarios**:

1. **Given** input is focused, **When** user types "/", **Then** a scrollable list of all available commands appears below the input
2. **Given** command list is visible, **When** user types characters after "/", **Then** list filters to matching commands in real-time
3. **Given** filtered list is showing, **When** user presses up/down arrows, **Then** selection moves through the list with visual highlighting
4. **Given** a command is highlighted, **When** user presses Tab, **Then** the command name is autocompleted into the input field (does NOT execute)
5. **Given** a command is autocompleted or highlighted, **When** user presses Enter, **Then** the command executes
6. **Given** command list is visible, **When** user presses Escape, **Then** the command list closes and "/" is cleared
7. **Given** no commands match the filter, **When** user has typed invalid command, **Then** list shows "No matching commands" indicator
8. **Given** a tool/task is in progress, **When** user presses Escape twice (double-Esc), **Then** a confirmation dialog appears asking "Abort current task? (y/n)"
9. **Given** abort confirmation is showing, **When** user confirms with "y", **Then** all active sub-agents and tool executions are cancelled gracefully

---

### User Story 4 - Profile System (Priority: P2)

A user switches the agent's profile to "Software Architect" and the agent's behavior, responses, and thinking pattern change to match that persona for the rest of the session.

**Why this priority**: Profiles are what make Agent-X fundamentally different from generic chatbots. They enable domain-specific expertise.

**Independent Test**: Set profile → ask domain question → verify response matches profile expertise → switch profile → verify behavior change.

**Acceptance Scenarios**:

1. **Given** agent is running, **When** user executes `/profile list`, **Then** all available profiles are shown in a scrollable list
2. **Given** profile list is showing, **When** user selects "Software Architect", **Then** agent confirms profile switch with animated transition
3. **Given** profile is set, **When** user asks a technical question, **Then** agent responds with the depth and perspective of a seasoned software architect
4. **Given** profile is active, **When** user executes `/profile switch`, **Then** they can select a different profile without ending the session
5. **Given** session has profile set, **When** user checks session info, **Then** current profile name is displayed in the session panel
6. **Given** multiple profiles used in session, **When** session is reviewed, **Then** profile switches are tracked in session history

---

### User Story 5 - Tool Execution with Permissions (Priority: P2)

A user asks the agent to read a file. The agent identifies the tool needed, checks permissions, asks for approval if needed, executes the tool, and presents results — all within the scope folder.

**Why this priority**: Tools are what make Agent-X actionable beyond conversation. Without tools, it's just a chatbot.

**Independent Test**: Request file read → permission prompt appears → grant permission → file content displayed → verify scope restriction.

**Acceptance Scenarios**:

1. **Given** user requests a file operation, **When** agent determines tool is needed, **Then** agent shows intent (e.g., "I need to read `./src/index.ts`")
2. **Given** tool requires permission, **When** permission not yet granted, **Then** permission prompt appears with options: "Allow once" | "Allow always" | "Deny"
3. **Given** user selects "Allow always", **When** same tool is needed later, **Then** it executes without asking again (for this session)
4. **Given** tool targets path outside scope folder, **When** agent attempts execution, **Then** operation is blocked with clear error: "Outside agent scope"
5. **Given** tool executes successfully, **When** result is available, **Then** formatted output appears (not raw file dump) with appropriate syntax highlighting
6. **Given** tool execution fails, **When** error occurs, **Then** user sees friendly error message with suggested next steps

---

### User Story 6 - Session Management (Priority: P2)

A user ends their session, comes back later, and resumes the previous session by ID. All context, permissions, and conversation history are restored.

**Why this priority**: Sessions enable continuity — without them, every interaction is stateless and the agent loses its memory advantage.

**Independent Test**: Start session → interact → exit → resume with `agentx session <id>` → verify full context restoration.

**Acceptance Scenarios**:

1. **Given** agent is running, **When** a new session starts, **Then** a unique session ID is generated and displayed in the side panel
2. **Given** session is active, **When** user interacts and then exits (Ctrl+C or `/exit`), **Then** session state is persisted (conversation, permissions, profile, tokens used)
3. **Given** previous session exists, **When** user runs `agentx session <session_id>`, **Then** full session context is restored (history, permissions, profile)
4. **Given** restored session, **When** user continues conversation, **Then** agent has full context of previous interactions
5. **Given** multiple sessions exist, **When** user runs `/sessions`, **Then** a list of recent sessions with metadata (date, profile, token usage) appears
6. **Given** session panel is visible, **When** session is active, **Then** real-time metrics update: session ID, tokens used/available, time elapsed, provider, model

---

### User Story 7 - Secret Sauce System (Priority: P2)

The agent uses its internal MD files (SOUL, PROFILE, MEMORIES, DIARY, IDENTITY) to maintain personality consistency, learn from interactions, and evolve over time — all invisible to the user.

**Why this priority**: This is the differentiator. Without the Secret Sauce, Agent-X is just another wrapper around an AI API.

**Independent Test**: Interact over multiple sessions → verify MEMORIES.MD updates → verify DIARY.MD tracks daily activity → verify personality consistency.

**Acceptance Scenarios**:

1. **Given** agent starts a session, **When** SOUL.MD and IDENTITY.MD exist, **Then** agent's behavior reflects its configured identity (invisible to user)
2. **Given** session ends, **When** meaningful interactions occurred, **Then** MEMORIES.MD is updated with summarized key takeaways (within 30-day window)
3. **Given** daily usage occurs, **When** day ends or session closes, **Then** DIARY.MD receives a daily summary entry
4. **Given** MD files grow large, **When** summarization threshold is reached, **Then** agent auto-summarizes older entries to keep files efficient
5. **Given** user asks about internal workings, **When** response is generated, **Then** NO reference to MD files, system prompts, or internal architecture is revealed
6. **Given** agent has memories from previous sessions, **When** relevant topic comes up, **Then** agent naturally references learned information without disclosing the mechanism

---

### User Story 8 - Sub-Agent Worker System (Priority: P2)

The AI model determines that a complex task requires multiple tool executions or parallel work. It spawns sub-agents (workers) that each receive specific instructions and execute tools independently, reporting results back to the orchestrator. The user sees elegant progress animations — never internal agent coordination details.

**Why this priority**: Sub-agents are what make Agent-X truly autonomous. Without delegation, the agent is limited to sequential single-tool execution which is slow and fragile for complex tasks.

**Independent Test**: Request complex task (e.g., "refactor all files in src/") → verify sub-agents spawn → verify parallel execution → verify aggregated result → verify user only sees progress animations.

**Acceptance Scenarios**:

1. **Given** a complex user request, **When** the model determines multiple tools are needed, **Then** the orchestrator spawns sub-agents with specific task instructions
2. **Given** sub-agents are working, **When** progress occurs, **Then** user sees tool names and action descriptions ("Reading package.json", "Running lint on src/", "Writing report.md") — but NEVER the input/output between model and agents
3. **Given** a sub-agent encounters an error, **When** the error is internal, **Then** the orchestrator handles it silently or retries — user sees only a progress gimmick, never the error
3a. **Given** a long-running task is in progress, **When** the user is waiting, **Then** the UI shows which tools are active and what they're doing in human-readable form — but never discloses model prompts, model responses, structured agent instructions, or raw data exchanged between orchestrator and workers
3b. **Given** the user sends a complex request, **When** the model begins reasoning about approach, **Then** the UI shows ephemeral reasoning glimpses ("Analyzing...", "Considering approaches...", "Planning changes...") that fade in/out to build trust
3c. **Given** reasoning is complete, **When** execution begins, **Then** reasoning glimpses collapse and the UI transitions to showing tool actions in progress
4. **Given** sub-agents complete their tasks, **When** results are aggregated, **Then** the orchestrator composes a clean user-facing response from all agent results
5. **Given** a tool is assigned to a sub-agent, **When** permission is needed, **Then** permission request bubbles up to the user via the main UI (not internal agent chatter)
6. **Given** multiple sub-agents are active, **When** user checks session panel, **Then** they see an activity indicator (e.g., "3 workers active") but NO internal details
7. **Given** a task is running, **When** user sends a steer message, **Then** the orchestrator incorporates the new instruction into active sub-agent tasks without cancelling ongoing work
8. **Given** a task is running, **When** user invokes background mode (e.g., `/bg` or Ctrl+B), **Then** the task moves to background execution and the input becomes available for new conversations/tasks
9. **Given** multiple tasks are running in parallel, **When** any task completes, **Then** the result is queued and presented when user is not mid-input
10. **Given** each sub-agent/tool is executing, **When** it starts, **Then** a per-process timer begins counting and is visible in the progress UI; on completion the final elapsed time is shown

---

### User Story 9 - Telegram Bot Integration (Priority: P3)

A user configures Telegram integration via the TUI and can then interact with Agent-X through a Telegram bot, maintaining the same session context.

**Why this priority**: Multi-channel communication extends Agent-X's utility beyond the terminal, but core TUI must work first.

**Independent Test**: Configure Telegram → send message via Telegram → verify agent responds → verify same session context.

**Acceptance Scenarios**:

1. **Given** agent is running, **When** user executes `/telegram setup`, **Then** guided configuration appears (Bot token from @BotFather)
2. **Given** Telegram is configured, **When** user sends message to bot, **Then** agent processes and responds via Telegram
3. **Given** Telegram session is active, **When** user also uses TUI, **Then** both channels share the same session context
4. **Given** tool execution is requested via Telegram, **When** permission is needed, **Then** permission prompt is sent via Telegram message
5. **Given** Telegram is configured, **When** user runs `/telegram status`, **Then** connection status and bot info are displayed

---

### User Story 10 - Installation & Distribution (Priority: P3)

A user installs Agent-X via their preferred method and the agent is immediately available as the `agentx` command.

**Why this priority**: Distribution enables adoption but is not needed for core functionality development.

**Installation Priority Order**:
1. **curl** — `curl -fsSL https://github.com/agentx/install.sh | bash` (recommended, zero dependencies)
2. **npm** — `npm install -g @agentx/cli` (for Node.js users)
3. **Docker** — `docker run -it agentx/agent-x` (public Docker Hub image)

**Independent Test**: Install via each method → run `agentx --version` → verify version output → run `agentx` → verify TUI launches.

**Acceptance Scenarios**:

1. **Given** user runs `curl -fsSL https://github.com/agentx/install.sh | bash`, **When** install completes, **Then** `agentx` command is available in PATH and correct version is installed
2. **Given** user runs `npm install -g @agentx/cli`, **When** install completes, **Then** `agentx` command works globally
3. **Given** user runs `docker run -it agentx/agent-x`, **When** container starts, **Then** agent TUI launches within interactive container
4. **Given** any installation method, **When** `agentx --version` is run, **Then** current SemVer version is displayed
5. **Given** install script is run, **When** OS is macOS/Linux, **Then** script auto-detects platform/arch and downloads correct binary

---

### Edge Cases

- What happens when API key becomes invalid mid-session? → Graceful error, offer to reconfigure
- What happens when network drops during AI call? → Retry with backoff, show "Reconnecting..." animation
- What happens when terminal is resized during operation? → React Ink handles reflow; verify layout integrity
- What happens when user pastes 10,000+ characters? → Input truncation with warning, or chunked processing
- What happens when token limit is reached mid-response? → Inform user, offer to start new session or switch model
- What happens when context approaches 70% capacity? → Session compaction triggers automatically between turns, summarizes history into content.txt, replaces old context, clears file
- What happens when scope folder is deleted while agent runs? → Detect, warn, prevent further operations
- What happens when two agent instances run in same folder? → Lock file prevents conflict, clear error message
- What happens when local model (LM Studio) is not running? → Connection error with helpful setup instructions
- What happens when MEMORIES.MD exceeds size threshold? → Auto-summarize, archive old entries
- What happens when user attempts to view Secret Sauce files via tools? → Block with generic denial, no disclosure

---

## Requirements

### Functional Requirements

- **FR-001**: System MUST launch via single `agentx` command
- **FR-002**: System MUST detect first-run state and launch setup wizard
- **FR-003**: System MUST support model providers: OpenAI, Anthropic, Google, Llama (local), LM Studio (local)
- **FR-003a**: All providers MUST support reasoning/thinking token extraction (Anthropic extended_thinking, OpenAI reasoning_content, Gemini thinking) and normalize them into unified reasoning_glimpse events for the UI
- **FR-004**: System MUST validate provider credentials before completing setup
- **FR-005**: System MUST fetch and display available models from configured provider
- **FR-006**: System MUST render a full-screen TUI with React Ink including: banner, session panel, message area, input field
- **FR-006a**: Welcome banner MUST display: version, configured Org name (if set), contact info (if set), active provider/model
- **FR-007**: System MUST animate all loading/processing states — never show raw AI output
- **FR-008**: System MUST support slash commands with "/" prefix detection and real-time filtering
- **FR-008a**: Tab key MUST autocomplete the highlighted command into the input field without executing it; Enter executes
- **FR-008b**: Double-Escape (pressing Esc twice within 500ms) MUST trigger a task abort confirmation dialog when a tool/task is in progress; on confirm, all active sub-agents and tool executions are cancelled gracefully
- **FR-009**: System MUST implement scrollable lists for all navigable content (up/down arrows)
- **FR-010**: System MUST display real-time token usage (available, used, percentage) as animated progress bar — updates on every model interaction, shows smooth transition animations between states, color-coded (green→amber→red as usage grows)
- **FR-010a**: System MUST show a running timer for each active process/tool execution and a consolidated total elapsed time at task completion
- **FR-010b**: System MUST support moving a running task to background (user can continue chatting while task runs), with background tasks showing in session panel as compact status indicators
- **FR-010c**: System MUST support "steer messages" — user can send a follow-up message while the agent is mid-execution to redirect, refine, or add constraints to the current task without cancelling it
- **FR-010d**: System MUST support running multiple agents in parallel (e.g., one researching, one coding, one testing) — each with independent progress tracking, timers, and result aggregation
- **FR-011**: System MUST maintain session state with unique session IDs
- **FR-012**: System MUST persist sessions and allow restoration via `agentx session <id>`
- **FR-013**: System MUST implement permission system ("allow once", "allow always", "deny") per tool per session
- **FR-014**: System MUST restrict all tool operations to the scope folder where agent was launched
- **FR-015**: System MUST maintain Secret Sauce files (SOUL, PROFILE, MEMORIES, DIARY, IDENTITY, PERMISSION)
- **FR-016**: System MUST never expose internal MD files, system prompts, or AI processing details to users
- **FR-017**: System MUST support multiple agent profiles that can be switched mid-session
- **FR-017a**: Profiles MUST be able to define tool preferences (preferred categories) and optionally enable/disable specific tools — a Chef profile should not offer `code-lint`, a Data Scientist should prioritize `doc-excel` and `data-*` tools
- **FR-017b**: Active profile MUST influence which tools are presented to the AI model in tool descriptions, ensuring the agent behaves authentically within its persona
- **FR-018**: System MUST implement Telegram bot integration for remote interaction
- **FR-019**: System MUST support tool execution across 20 tool categories: filesystem, code intelligence, shell/process, git/VCS, package managers, web/network, database, document generation, testing, containers/infra, communication/notification, AI meta-tools, browser automation, system/OS, security/crypto, data processing, project management, media/image, MCP integration, and workspace/IDE tools
- **FR-019a**: Tools MUST be organized by category with standardized risk levels (Low/Medium/High/Critical) determining default permission behavior
- **FR-019b**: System MUST support a plugin architecture allowing users to register custom tools via MCP servers or local plugin files
- **FR-019c**: Tools MUST be implemented in priority tiers: Core (ship with MVP), Power User (Phase 2), Advanced (Phase 3), Ecosystem (Phase 4), Specialist (Phase 5)
- **FR-019d**: Each tool MUST have: Zod-validated schema, risk classification, scope enforcement, timeout, observable events, documentation for model consumption, and composability with sub-agents
- **FR-020**: System MUST display version on startup and support `--version` flag
- **FR-025**: System MUST implement a sub-agent (worker) system where tools are executed by worker agents that receive instructions from the model
- **FR-026**: System MUST sanitize user messages before sending to AI model — extract intent, structure for optimal model output that agents can execute
- **FR-027**: System MUST support task delegation from the orchestrator to one or more sub-agents for parallel/sequential tool execution
- **FR-028**: System MUST never show internal errors, agent coordination messages, or raw model failures to the user — always show animated gimmicks
- **FR-028a**: System MUST show tool names and human-readable action descriptions during long-running tasks (e.g., "Reading files", "Running tests") so the user knows what's happening
- **FR-028b**: System MUST never disclose model input/output, structured prompts, agent instructions, or raw data exchanged between orchestrator and sub-agents to the user
- **FR-028c**: System MUST show reasoning glimpses during the model's thinking phase — short, human-readable summaries of what the agent is considering (e.g., "Analyzing project structure...", "Planning 3-step approach...") displayed as ephemeral animated text
- **FR-028d**: Reasoning glimpses MUST collapse/fade once reasoning completes and transition to tool execution progress display
- **FR-028e**: Reasoning glimpses MUST only show high-level thinking summaries, NEVER raw model tokens, full reasoning chains, or internal structured data
- **FR-029**: Sub-agents MUST respect the same permission and scope boundaries as the main agent
- **FR-030**: System MUST aggregate sub-agent results into a coherent user-facing response
- **FR-031**: Agent MUST maintain an internal TODO list for complex multi-step tasks — decomposing user requests into trackable steps, marking progress, and following the list to ensure completeness. The TODO state is visible to the user as a compact progress indicator in the UI
- **FR-021**: System MUST auto-summarize Secret Sauce MD files when they grow too large
- **FR-022**: System MUST differentiate between commands and conversation messages locally (no AI call needed)
- **FR-023**: System MUST support installation via (in priority order): 1) curl install script (`curl | bash`), 2) npm global install (`@agentx/cli`), 3) Docker Hub public image, 4) brew (self-managed tap, no external approval needed)
- **FR-023a**: System MUST perform session compaction when token usage exceeds 70% of model context window — summarize older messages into `content.txt` scratch file, replace in-context, then clear the file immediately after use
- **FR-023b**: Session compaction MUST show animated progress in UI ("Optimizing session memory...") and MUST NOT interrupt or block user input between turns
- **FR-024**: System MUST implement a Web-UI that shares the same backend as the TUI

### Non-Functional Requirements

- **NFR-001**: TUI startup < 500ms to first interactive frame
- **NFR-002**: Input responsiveness < 16ms
- **NFR-003**: Animation frame rate ≥ 30fps
- **NFR-004**: Memory usage < 150MB idle
- **NFR-005**: Session restore < 1s
- **NFR-006**: Graceful degradation on API failures (no crashes)
- **NFR-007**: Works in terminals with minimum 80 columns width
- **NFR-008**: Supports macOS, Linux, and Windows (via WSL for TUI features)
- **NFR-009**: All user data stored locally (no telemetry without consent)
- **NFR-010**: TypeScript strict mode with zero type errors

### Key Entities

- **Session**: A bounded conversation instance with unique ID, timestamp, profile, token usage, permissions, and message history
- **Profile**: A persona definition (name, description, system prompt, expertise areas, behavioral traits)
- **Tool**: An executable capability (schema, handler, permission requirements, scope constraints)
- **Message**: A conversation turn (role, content, timestamp, token count, tool calls)
- **Provider**: An AI model backend (type, credentials, endpoint, available models)
- **Model**: A specific AI model (provider, name, context window, capabilities, pricing)
- **Permission**: A tool-session-scope permission grant (tool_id, session_id, scope, decision, timestamp)
- **SecretSauce**: The collection of personality/memory files (SOUL, PROFILE, MEMORIES, DIARY, IDENTITY, PERMISSION)
- **SubAgent (Worker)**: A lightweight executor that receives a specific task instruction from the orchestrator, uses tools to complete it, and reports results back
- **TaskAssignment**: A unit of work delegated to a sub-agent (instruction, tools allowed, scope, timeout, parent reference)
- **MessageSanitizer**: The preprocessing layer that transforms raw user input into structured, model-optimized prompts

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: User can go from `curl install` to first AI conversation in under 3 minutes
- **SC-002**: TUI renders at consistent 30fps+ during animations with no visible frame drops
- **SC-003**: Session restoration maintains 100% context fidelity (no lost messages or permissions)
- **SC-004**: Agent personality remains consistent across sessions (verifiable via test scenarios)
- **SC-005**: Zero internal system information leaks to user-visible output (tested via adversarial prompts)
- **SC-006**: 95% of user inputs receive first visual feedback within 200ms
- **SC-007**: Tool execution completes within scope boundaries 100% of the time (no escapes)
- **SC-008**: Setup wizard has 0 unrecoverable error states (always possible to go back or cancel)

---

## Assumptions

- Users have a terminal that supports ANSI escape sequences and at least 256 colors
- Users have Node.js 20+ installed (or will install via package manager)
- Cloud AI providers (OpenAI, Anthropic, Google) require internet connectivity
- Local providers (Llama, LM Studio) are already running when agent connects
- Users understand basic terminal navigation (typing, arrow keys, Enter, Escape)
- The scope folder exists and user has read/write permissions to it
- Terminal width is at least 80 columns (responsive layout adapts beyond this)
- Users accept that AI responses may have latency depending on provider and model
