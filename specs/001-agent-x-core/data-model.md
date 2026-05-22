# Data Model: Agent-X Core Platform

**Date**: 2026-05-22

---

## Overview

Agent-X uses a hybrid storage strategy:
- **SQLite** (via better-sqlite3) for structured relational data (sessions, messages, permissions, token logs)
- **Filesystem** (Markdown files) for the Secret Sauce personality system
- **JSON config** (via conf) for user preferences and provider settings

---

## SQLite Schema

### Sessions Table

```sql
CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,          -- nanoid (21 chars)
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    last_active TEXT NOT NULL DEFAULT (datetime('now')),
    status      TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'closed' | 'archived'
    profile_id  TEXT,                      -- Current active profile name
    provider_id TEXT NOT NULL,             -- Provider identifier
    model_id    TEXT NOT NULL,             -- Model identifier
    scope_path  TEXT NOT NULL,             -- Absolute path where agent was launched
    total_input_tokens  INTEGER DEFAULT 0,
    total_output_tokens INTEGER DEFAULT 0,
    metadata    TEXT                       -- JSON blob for extensible data
);

CREATE INDEX idx_sessions_created ON sessions(created_at DESC);
CREATE INDEX idx_sessions_status ON sessions(status);
```

### Messages Table

```sql
CREATE TABLE messages (
    id          TEXT PRIMARY KEY,          -- nanoid
    session_id  TEXT NOT NULL,
    role        TEXT NOT NULL,             -- 'user' | 'assistant' | 'system' | 'tool'
    content     TEXT NOT NULL,
    input_tokens  INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    tool_calls  TEXT,                      -- JSON array of tool call objects
    tool_result TEXT,                      -- JSON tool execution result
    profile_id  TEXT,                      -- Profile active when message was sent
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_messages_session ON messages(session_id, created_at);
CREATE INDEX idx_messages_role ON messages(session_id, role);
```

### Permissions Table

```sql
CREATE TABLE permissions (
    id          TEXT PRIMARY KEY,          -- nanoid
    session_id  TEXT NOT NULL,
    tool_id     TEXT NOT NULL,             -- Tool identifier (e.g., 'file-read')
    scope       TEXT NOT NULL,             -- Path or pattern the permission applies to
    decision    TEXT NOT NULL,             -- 'allow_once' | 'allow_always' | 'deny'
    granted_at  TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT,                      -- NULL for session-lifetime, timestamp for timed
    
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_permissions_session_tool ON permissions(session_id, tool_id);
CREATE UNIQUE INDEX idx_permissions_unique ON permissions(session_id, tool_id, scope)
    WHERE decision != 'allow_once';
```

### Token Logs Table

```sql
CREATE TABLE token_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    message_id  TEXT,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    provider_id TEXT NOT NULL,
    model_id    TEXT NOT NULL,
    logged_at   TEXT NOT NULL DEFAULT (datetime('now')),
    
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
);

CREATE INDEX idx_token_logs_session ON token_logs(session_id, logged_at);
```

### Sub-Agent Tasks Table

```sql
CREATE TABLE agent_tasks (
    id              TEXT PRIMARY KEY,          -- nanoid
    session_id      TEXT NOT NULL,
    parent_message_id TEXT,                    -- Message that triggered this task
    instruction     TEXT NOT NULL,             -- What the agent should do
    tools_allowed   TEXT NOT NULL,             -- JSON array of tool IDs
    scope           TEXT NOT NULL,             -- Scope boundary for this task
    status          TEXT NOT NULL DEFAULT 'queued', -- 'queued' | 'running' | 'completed' | 'failed'
    priority        TEXT NOT NULL DEFAULT 'normal', -- 'high' | 'normal' | 'low'
    parallel        INTEGER DEFAULT 1,         -- 1 if can run in parallel
    result          TEXT,                      -- JSON result on completion
    error_internal  TEXT,                      -- Internal error (NEVER shown to user)
    started_at      TEXT,
    completed_at    TEXT,
    timeout_ms      INTEGER DEFAULT 30000,     -- Max execution time
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_agent_tasks_session ON agent_tasks(session_id, status);
CREATE INDEX idx_agent_tasks_parent ON agent_tasks(parent_message_id);
```

### Profiles Table

```sql
CREATE TABLE profiles (
    id          TEXT PRIMARY KEY,          -- Slug identifier (e.g., 'software-architect')
    name        TEXT NOT NULL,             -- Display name
    description TEXT NOT NULL,
    system_prompt TEXT NOT NULL,           -- The persona prompt
    expertise   TEXT,                      -- JSON array of expertise areas
    traits      TEXT,                      -- JSON array of behavioral traits
    tool_preferences TEXT,                 -- JSON array of preferred tool categories (e.g., ["documents", "data"])
    enabled_tools TEXT,                    -- JSON array of specific tool IDs to enable (null = all available)
    disabled_tools TEXT,                   -- JSON array of tool IDs to disable for this profile
    is_default  INTEGER DEFAULT 0,        -- 1 if this is the default profile
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_profiles_default ON profiles(is_default);
```

### Tool Registry Table

```sql
CREATE TABLE tool_registry (
    id              TEXT PRIMARY KEY,          -- Tool identifier (e.g., 'file-read')
    name            TEXT NOT NULL,             -- Display name
    description     TEXT NOT NULL,             -- Human-readable description
    model_description TEXT NOT NULL,           -- AI model optimized description
    category        TEXT NOT NULL,             -- 'filesystem' | 'code' | 'shell' | 'git' | 'packages' | 'web' | 'database' | 'documents' | 'testing' | 'containers' | 'communication' | 'ai' | 'browser' | 'system' | 'security' | 'data' | 'github' | 'media' | 'mcp' | 'workspace'
    risk_level      TEXT NOT NULL,             -- 'low' | 'medium' | 'high' | 'critical'
    source          TEXT NOT NULL DEFAULT 'builtin', -- 'builtin' | 'plugin' | 'mcp'
    handler_path    TEXT NOT NULL,             -- Module path to implementation
    parameters_schema TEXT NOT NULL,           -- JSON Zod schema
    returns_schema  TEXT,                      -- JSON Zod schema for output
    scope_restricted INTEGER DEFAULT 1,        -- Must operate within scope
    timeout_ms      INTEGER DEFAULT 30000,     -- Max execution time
    composable      INTEGER DEFAULT 1,         -- Can be used by sub-agents
    enabled         INTEGER DEFAULT 1,         -- User can disable tools
    examples        TEXT,                      -- JSON array of usage examples
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tool_registry_category ON tool_registry(category);
CREATE INDEX idx_tool_registry_risk ON tool_registry(risk_level);
CREATE INDEX idx_tool_registry_source ON tool_registry(source);
CREATE INDEX idx_tool_registry_enabled ON tool_registry(enabled);
```

### Tool Execution Logs Table

```sql
CREATE TABLE tool_executions (
    id              TEXT PRIMARY KEY,          -- nanoid
    session_id      TEXT NOT NULL,
    agent_task_id   TEXT,                      -- Sub-agent task (if delegated)
    tool_id         TEXT NOT NULL,             -- References tool_registry.id
    arguments       TEXT NOT NULL,             -- JSON input arguments
    result          TEXT,                      -- JSON output
    success         INTEGER NOT NULL,          -- 1 or 0
    error_internal  TEXT,                      -- Internal error (never shown to user)
    duration_ms     INTEGER,                   -- Execution duration
    permission_id   TEXT,                      -- Permission that authorized this
    started_at      TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at    TEXT,
    
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_task_id) REFERENCES agent_tasks(id) ON DELETE SET NULL
);

CREATE INDEX idx_tool_executions_session ON tool_executions(session_id, started_at);
CREATE INDEX idx_tool_executions_tool ON tool_executions(tool_id);
```

### Commands Table (Slash Commands Registry)

```sql
CREATE TABLE commands (
    id          TEXT PRIMARY KEY,          -- Command name without '/' (e.g., 'help')
    description TEXT NOT NULL,
    category    TEXT NOT NULL,             -- 'system' | 'session' | 'tools' | 'config'
    handler     TEXT NOT NULL,             -- Module path to handler
    aliases     TEXT,                      -- JSON array of aliases
    is_builtin  INTEGER DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## TypeScript Type Definitions

### Core Types

```typescript
// packages/shared/src/types/session.ts
export interface Session {
  id: string;
  createdAt: Date;
  lastActive: Date;
  status: 'active' | 'closed' | 'archived';
  profileId: string | null;
  providerId: string;
  modelId: string;
  scopePath: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  metadata: Record<string, unknown>;
}

// packages/shared/src/types/message.ts
export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: ToolCall[] | null;
  toolResult: ToolResult | null;
  profileId: string | null;
  createdAt: Date;
}

export interface ToolCall {
  id: string;
  toolId: string;
  arguments: Record<string, unknown>;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  agentId?: string;          // Sub-agent handling this call (if delegated)
}

// packages/shared/src/types/agent.ts
export interface SubAgent {
  id: string;
  sessionId: string;
  parentMessageId: string | null;
  instruction: string;
  toolsAllowed: string[];
  scope: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  priority: 'high' | 'normal' | 'low';
  parallel: boolean;
  result: SubAgentResult | null;
  errorInternal: string | null; // NEVER exposed to user
  startedAt: Date | null;
  completedAt: Date | null;
  timeoutMs: number;
}

export interface SubAgentResult {
  success: boolean;
  output: string;             // Formatted output for aggregation
  toolsUsed: string[];        // Which tools were actually invoked
  tokensConsumed: number;
}

export interface TaskAssignment {
  id: string;
  instruction: string;        // Structured instruction from model
  tools: string[];            // Tools this agent can use
  scope: string;              // Scope boundary
  timeout: number;            // Max execution time (ms)
  priority: 'high' | 'normal' | 'low';
  parallel: boolean;          // Can run alongside other agents
  context?: string;           // Additional context from the model
}

// packages/shared/src/types/sanitizer.ts
export interface SanitizedMessage {
  originalInput: string;      // Preserved for session history
  structuredPrompt: string;   // What actually goes to the model
  intent: MessageIntent;
  toolHints: string[];        // Likely tools needed
  contextAttached: string[];  // Which context sources were injected
}

export type MessageIntent =
  | 'conversation'           // General chat
  | 'task_request'           // Needs tool execution
  | 'question'              // Information retrieval
  | 'command'               // Slash command (handled locally)
  | 'clarification'         // Follow-up to previous message
  | 'multi_step_task';      // Complex, likely needs sub-agents

export interface ToolResult {
  toolId: string;
  callId: string;
  success: boolean;
  output: string;
  error?: string;
  duration: number; // milliseconds
}

// packages/shared/src/types/provider.ts
export interface ProviderConfig {
  id: string;
  name: string;
  type: 'cloud' | 'local';
  endpoint?: string;      // For local providers
  apiKeyRef?: string;     // Reference to secure storage key
  models: ModelInfo[];
  isConfigured: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: ModelCapability[];
  pricing?: {
    inputPer1k: number;
    outputPer1k: number;
  };
}

export type ModelCapability = 
  | 'text'
  | 'vision'
  | 'function_calling'
  | 'streaming'
  | 'json_mode'
  | 'reasoning';              // Supports reasoning/thinking tokens (Claude extended thinking, OpenAI reasoning)

// packages/shared/src/types/tool.ts
export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  modelDescription: string;        // Optimized description for AI model consumption
  category: ToolCategory;
  parameters: ToolParameter[];
  returns?: ToolParameter[];       // Output schema description
  riskLevel: ToolRiskLevel;
  requiresPermission: boolean;
  scopeRestricted: boolean;
  timeout: number;                 // Max execution time (ms)
  composable: boolean;             // Can be used by sub-agents in chains
  source: ToolSource;
  handler: string;                 // Module path
  examples: ToolExample[];         // Usage examples for model context
  enabled: boolean;                // User can disable specific tools
}

export type ToolCategory = 
  | 'filesystem'
  | 'code'
  | 'shell'
  | 'git'
  | 'packages'
  | 'web'
  | 'database'
  | 'documents'
  | 'testing'
  | 'containers'
  | 'communication'
  | 'ai'
  | 'browser'
  | 'system'
  | 'security'
  | 'data'
  | 'github'
  | 'media'
  | 'mcp'
  | 'workspace';

export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type ToolSource = 'builtin' | 'plugin' | 'mcp';

export interface ToolExample {
  description: string;
  args: Record<string, unknown>;
  expectedOutput?: string;
}

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  default?: unknown;
}

export interface ToolRegistryEntry {
  definition: ToolDefinition;
  handler: ToolHandler;
  loadedAt: Date;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolExecutionContext
) => Promise<ToolExecutionResult>;

export interface ToolExecutionContext {
  scopePath: string;
  sessionId: string;
  workingDirectory: string;
  signal: AbortSignal;
  agentId?: string;
  parentToolCallId?: string;
}

export interface ToolExecutionResult {
  success: boolean;
  output: string;
  data?: unknown;              // Structured data for sub-agent consumption
  duration: number;
  filesModified?: string[];    // Paths affected (for UI display)
}

// packages/shared/src/types/permission.ts
export interface Permission {
  id: string;
  sessionId: string;
  toolId: string;
  scope: string;
  decision: PermissionDecision;
  grantedAt: Date;
  expiresAt: Date | null;
}

export type PermissionDecision = 'allow_once' | 'allow_always' | 'deny';

export interface PermissionRequest {
  toolId: string;
  toolName: string;
  scope: string;
  description: string; // Human-readable "What will this do?"
}

// packages/shared/src/types/profile.ts
export interface Profile {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  expertise: string[];         // Knowledge domains ("finance", "software architecture", etc.)
  traits: string[];            // Behavioral traits ("methodical", "creative", etc.)
  toolPreferences: string[];   // Tool categories this profile excels at ("documents", "code", "data")
  enabledTools: string[] | null; // Specific tool IDs to enable (null = all tools available)
  disabledTools: string[];     // Tool IDs to disable for this profile (e.g., code tools for a chef profile)
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// packages/shared/src/types/config.ts
export interface AgentXConfig {
  version: string;
  activeProvider: string;
  activeModel: string;
  defaultProfile: string | null;
  organization: OrganizationConfig | null;
  telegram: TelegramConfig | null;
  ui: UIConfig;
  engine: EngineConfig;
}

export interface OrganizationConfig {
  name: string;              // Displayed on welcome banner
  contact: string | null;    // Email/URL shown on banner
  logo?: string;             // ASCII art override for banner (optional)
}

export interface TelegramConfig {
  botToken: string; // Stored in secure storage, ref only
  chatId: string;
  enabled: boolean;
}

export interface UIConfig {
  theme: 'dark' | 'light' | 'custom';
  animationSpeed: 'slow' | 'normal' | 'fast';
  showTokenBar: boolean;
  showSessionPanel: boolean;
  maxMessageHistory: number; // Visible in TUI
}

export interface EngineConfig {
  maxRetries: number;
  retryDelay: number;
  tokenBudget: {
    secretSaucePercent: number;  // % of context for Secret Sauce
    historyPercent: number;      // % of context for conversation history
    responsePercent: number;     // % reserved for response
  };
  autoSaveInterval: number; // milliseconds
  summarizationThreshold: number; // Max lines before auto-summarize
}
```

### Engine Event Types

```typescript
// packages/shared/src/types/events.ts
export type EngineEvent =
  | ProcessingStartEvent
  | ProcessingProgressEvent
  | ProcessingCompleteEvent
  | PermissionRequiredEvent
  | TokenUpdateEvent
  | ToolExecutingEvent
  | ToolCompleteEvent
  | ProfileChangedEvent
  | SessionEvent
  | ErrorEvent;

export interface ProcessingStartEvent {
  type: 'processing_start';
  taskDescription: string;
  estimatedStages: number;
}

export interface ProcessingProgressEvent {
  type: 'processing_progress';
  stage: string;
  stageIndex: number;
  totalStages: number;
  progress: number; // 0-100
}

export interface ProcessingCompleteEvent {
  type: 'processing_complete';
  result: {
    content: string;
    toolCalls?: ToolCall[];
    tokensUsed: { input: number; output: number };
  };
}

export interface PermissionRequiredEvent {
  type: 'permission_required';
  request: PermissionRequest;
  resolve: (decision: PermissionDecision) => void;
}

export interface TokenUpdateEvent {
  type: 'token_update';
  used: number;
  available: number;
  percentage: number;
}

export interface ToolExecutingEvent {
  type: 'tool_executing';
  toolId: string;
  toolName: string;
  description: string;
}

export interface ToolCompleteEvent {
  type: 'tool_complete';
  toolId: string;
  result: ToolResult;
}

export interface ProfileChangedEvent {
  type: 'profile_changed';
  previousProfile: string | null;
  newProfile: string;
}

export interface SessionEvent {
  type: 'session_created' | 'session_restored' | 'session_closed';
  sessionId: string;
}

export interface ErrorEvent {
  type: 'error';
  code: string;
  message: string;
  recoverable: boolean;
  suggestedAction?: string;
}
```

---

## Secret Sauce File Schemas

### SOUL.md Structure
```markdown
# Soul of Agent-X

## Core Identity
- Name: [Agent name]
- Created: [Date]
- Purpose: [Primary mission]

## Values
- [Value 1]
- [Value 2]

## Boundaries
- [What the agent will never do]
- [Ethical constraints]

## Voice
- Tone: [Professional/Casual/etc]
- Style: [Concise/Elaborate/etc]
```

### PROFILE.md Structure
```markdown
# Profiles

## [Profile ID: software-architect]
**Name**: Senior Software Architect
**Expertise**: System design, scalability, cloud architecture, design patterns
**Traits**: Methodical, detail-oriented, big-picture thinker
**System Prompt**: You are a seasoned Software Architect with 20+ years...
---

## [Profile ID: finance-head]
**Name**: Chief Financial Officer
**Expertise**: Financial modeling, risk assessment, market analysis
**Traits**: Analytical, conservative, data-driven
**System Prompt**: You are an experienced CFO with deep expertise in...
---
```

### MEMORIES.md Structure
```markdown
# Memories

## [Date: 2026-05-22]
### Key Learnings
- User prefers TypeScript over JavaScript
- Project scope: AI agent with React Ink TUI

### Important Context
- Working in /Users/mitraa/Desktop/Personal/docker/agent-x
- User is building a serious enterprise tool

### Summarized (30-day rolling)
- [Older entries get summarized here]
```

### DIARY.md Structure
```markdown
# Diary

## [Date: 2026-05-22]
**Sessions**: 3
**Total Tokens**: 45,230
**Profile Used**: Software Architect
**Key Activities**:
- Discussed project architecture
- Created implementation plan
- Reviewed technology stack

**Notable**:
- User emphasized animation quality importance
- Project aims to be a trend-setter
```

### IDENTITY.md Structure
```markdown
# Identity

## Personality
- Communication style: Professional yet approachable
- Humor level: Minimal, appropriate
- Confidence: High, but acknowledges uncertainty

## Growth Log
- [Date]: Learned to be more concise in responses
- [Date]: Adapted to user's preference for bullet points

## Capabilities Awareness
- Strong: Code generation, architecture design
- Growing: Creative writing, financial analysis
- Learning: [Areas being developed]
```

### PERMISSION.md Structure
```markdown
# Session Permissions

## Active Session: [session_id]
### Always Allowed
- file-read: ./src/**
- file-write: ./src/**
- folder-list: ./**

### Denied
- shell-exec: *
- file-delete: ./node_modules/**

### Pending
- (none)
```

---

## Entity Relationships

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│   Session   │────<│   Message    │     │   Permission   │
│             │     │              │     │                │
│ id          │     │ id           │     │ id             │
│ profile_id  │──┐  │ session_id   │     │ session_id     │
│ provider_id │  │  │ role         │     │ tool_id        │
│ model_id    │  │  │ content      │     │ scope          │
│ scope_path  │  │  │ tool_calls   │     │ decision       │
│ status      │  │  │ created_at   │     │ granted_at     │
└─────────────┘  │  └──────────────┘     └────────────────┘
                 │
                 │  ┌──────────────┐     ┌────────────────┐
                 └─>│   Profile    │     │  Token Log     │
                    │              │     │                │
                    │ id           │     │ session_id     │
                    │ name         │     │ message_id     │
                    │ system_prompt│     │ input_tokens   │
                    │ expertise    │     │ output_tokens  │
                    │ traits       │     │ logged_at      │
                    └──────────────┘     └────────────────┘

┌─────────────────────────────────────────────────────────┐
│              Secret Sauce (Filesystem)                    │
│                                                          │
│  SOUL.md ← Always loaded (core identity)                 │
│  IDENTITY.md ← Always loaded (personality evolution)     │
│  PROFILE.md ← Active profile loaded per session          │
│  MEMORIES.md ← Relevant entries loaded (30-day window)   │
│  DIARY.md ← Today + recent summaries loaded              │
│  PERMISSION.md ← Live session permissions reference      │
└─────────────────────────────────────────────────────────┘
```

---

## Data Flow: Message Processing

```
User Input
    │
    ▼
┌─────────────────┐
│ Command Parser  │──── Is "/" prefix? ──── Yes ──→ Execute Command
│                 │                                  (local, no AI)
└────────┬────────┘
         │ No (conversation message)
         ▼
┌─────────────────┐
│ Token Counter   │──── Count input tokens
│                 │──── Check budget remaining
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Context Builder │──── Load Secret Sauce (within budget)
│                 │──── Load conversation history (within budget)
│                 │──── Attach available tool definitions
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ AI Provider     │──── Stream completion
│ (via adapter)   │──── Emit progress events
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Response Router │──── Text response? ──→ Format & display
│                 │──── Tool call? ──→ Permission → Execute → Display
│                 │──── Multi-step? ──→ Loop back to Context Builder
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Session Store   │──── Persist message
│                 │──── Update token counts
│                 │──── Update session.last_active
└─────────────────┘
```
