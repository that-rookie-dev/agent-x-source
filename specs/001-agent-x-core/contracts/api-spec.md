# Internal API Contracts: Agent-X Core Platform

**Date**: 2026-05-22

---

## Overview

Agent-X uses an internal event-driven API between layers. These contracts define how the CLI, TUI, Engine, and Storage layers communicate.

---

## 1. Engine API (Public Interface)

The Engine is the central service that both TUI and Web-UI consume.

### `Engine.initialize(config: EngineInitConfig): Promise<void>`

Initializes the engine with configuration. Must be called before any other method.

```typescript
interface EngineInitConfig {
  configPath: string;       // Path to config.json
  dataPath: string;         // Path to data directory
  scopePath: string;        // Working directory (scope boundary)
}
```

### `Engine.startSession(options?: SessionOptions): Promise<Session>`

Creates a new session or restores an existing one.

```typescript
interface SessionOptions {
  sessionId?: string;       // If provided, restore this session
  profileId?: string;       // Override default profile
  providerId?: string;      // Override configured provider
  modelId?: string;         // Override configured model
}
```

### `Engine.sendMessage(content: string): AsyncGenerator<EngineEvent>`

Sends a user message and yields events as processing occurs.

```typescript
// Usage:
for await (const event of engine.sendMessage("What is the architecture?")) {
  switch (event.type) {
    case 'processing_start': // Show loading animation
    case 'processing_progress': // Update progress
    case 'tool_executing': // Show tool activity
    case 'permission_required': // Prompt user
    case 'processing_complete': // Display response
    case 'token_update': // Update token bar
    case 'error': // Handle error
  }
}
```

### `Engine.executeCommand(command: string, args: string[]): Promise<CommandResult>`

Executes a slash command.

```typescript
interface CommandResult {
  success: boolean;
  output?: string;
  action?: 'navigate' | 'display' | 'configure' | 'exit';
  data?: unknown;
}
```

### `Engine.resolvePermission(requestId: string, decision: PermissionDecision): void`

Resolves a pending permission request from the user.

### `Engine.getSessionInfo(): SessionInfo`

Returns current session metadata for display.

```typescript
interface SessionInfo {
  id: string;
  profile: string | null;
  provider: string;
  model: string;
  tokensUsed: number;
  tokensAvailable: number;
  tokenPercentage: number;
  startedAt: Date;
  elapsed: number; // seconds
}
```

### `Engine.getCommands(): CommandDefinition[]`

Returns all registered slash commands.

```typescript
interface CommandDefinition {
  id: string;
  name: string;           // Without "/"
  description: string;
  category: string;
  aliases: string[];
}
```

### `Engine.getProfiles(): Profile[]`

Returns all available profiles.

### `Engine.switchProfile(profileId: string): Promise<void>`

Switches the active profile.

### `Engine.close(): Promise<void>`

Gracefully closes the session and persists state.

---

## 2. Provider Interface Contract

All AI providers implement this interface.

```typescript
interface AIProvider {
  readonly id: string;
  readonly name: string;
  readonly type: 'cloud' | 'local';

  /**
   * Validate credentials/connectivity.
   * Returns true if provider is ready to use.
   */
  validate(credentials: ProviderCredentials): Promise<ValidationResult>;

  /**
   * Fetch available models from the provider.
   */
  listModels(): Promise<ModelInfo[]>;

  /**
   * Send a completion request and stream results.
   * Must yield chunks as they arrive.
   */
  complete(request: CompletionRequest): AsyncGenerator<CompletionChunk>;

  /**
   * Count tokens for given messages.
   * Used for budget management.
   */
  countTokens(messages: MessageForCounting[]): Promise<number>;

  /**
   * Get the context window size for a model.
   */
  getContextWindow(modelId: string): number;
}

interface ProviderCredentials {
  apiKey?: string;
  endpoint?: string;
  organizationId?: string;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

interface CompletionRequest {
  model: string;
  messages: ProviderMessage[];
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  stream: true; // Always stream
}

interface CompletionChunk {
  type: 'text_delta' | 'reasoning_delta' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_end' | 'done';
  content?: string;
  reasoning?: string;           // Reasoning/thinking tokens (Claude extended thinking, OpenAI reasoning)
  toolCall?: Partial<ToolCall>;
  usage?: { inputTokens: number; outputTokens: number };
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'error';
}

interface ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}
```

---

## 3. Tool Interface Contract

All tools implement this interface for registration and execution.

```typescript
interface Tool {
  readonly definition: ToolDefinition;

  /**
   * Execute the tool with given arguments.
   * Must respect scope boundaries.
   */
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;

  /**
   * Validate arguments before execution.
   */
  validate(args: Record<string, unknown>): ValidationResult;
}

interface ToolContext {
  scopePath: string;          // Boundary for filesystem operations
  sessionId: string;
  workingDirectory: string;   // CWD within scope
  signal: AbortSignal;        // For timeout/cancellation
  agentId?: string;           // Sub-agent executing this tool (if delegated)
  parentToolCallId?: string;  // For chained tool calls
}

interface ToolDefinition {
  id: string;
  name: string;
  description: string;        // Human-readable description
  modelDescription: string;   // Optimized description for AI model consumption
  category: ToolCategory;
  parameters: ZodSchema;      // Zod schema for argument validation
  returns: ZodSchema;         // Zod schema for output validation
  riskLevel: ToolRiskLevel;   // Determines default permission behavior
  requiresPermission: boolean;
  scopeRestricted: boolean;   // Must operate within scope
  timeout: number;            // Max execution time (ms)
  examples: ToolExample[];    // Usage examples for model context
  composable: boolean;        // Can be used by sub-agents in chains
  source: 'builtin' | 'plugin' | 'mcp'; // Where this tool came from
}

type ToolCategory =
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

type ToolRiskLevel = 'low' | 'medium' | 'high' | 'critical';

interface ToolExample {
  description: string;
  args: Record<string, unknown>;
  expectedOutput?: string;
}

/**
 * Risk-based permission policy:
 * - low:      Auto-allow (no prompt)
 * - medium:   Prompt once per session, remember decision
 * - high:     Always prompt (default deny)
 * - critical: Always prompt + confirmation dialog (double-confirm)
 */
interface RiskPolicy {
  riskLevel: ToolRiskLevel;
  defaultDecision: 'allow' | 'prompt' | 'deny';
  requiresConfirmation: boolean;
  canAutoGrant: boolean;
}
```

---

## 4. Storage Interface Contract

### Session Store

```typescript
interface SessionStore {
  create(session: Omit<Session, 'id'>): Session;
  getById(id: string): Session | null;
  getRecent(limit: number): Session[];
  update(id: string, patch: Partial<Session>): void;
  close(id: string): void;
  archive(id: string): void;
  delete(id: string): void;
}
```

### Message Store

```typescript
interface MessageStore {
  create(message: Omit<Message, 'id'>): Message;
  getBySession(sessionId: string, options?: PaginationOptions): Message[];
  getById(id: string): Message | null;
  countBySession(sessionId: string): number;
}

interface PaginationOptions {
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
}
```

### Permission Store

```typescript
interface PermissionStore {
  grant(permission: Omit<Permission, 'id'>): Permission;
  check(sessionId: string, toolId: string, scope: string): PermissionDecision | null;
  revoke(id: string): void;
  revokeAll(sessionId: string): void;
  getBySession(sessionId: string): Permission[];
}
```

---

## 5. Configuration Interface Contract

```typescript
interface ConfigStore {
  /**
   * Get the full configuration.
   */
  getAll(): AgentXConfig;

  /**
   * Get a specific config value by dot-notation path.
   */
  get<T>(key: string): T | undefined;

  /**
   * Set a config value.
   */
  set(key: string, value: unknown): void;

  /**
   * Check if first-run setup is needed.
   */
  isConfigured(): boolean;

  /**
   * Get provider credentials from secure storage.
   */
  getCredentials(providerId: string): Promise<ProviderCredentials>;

  /**
   * Store provider credentials in secure storage.
   */
  setCredentials(providerId: string, credentials: ProviderCredentials): Promise<void>;

  /**
   * Get the path to the data directory.
   */
  getDataPath(): string;

  /**
   * Get the path to the Secret Sauce directory.
   */
  getSecretSaucePath(): string;
}
```

---

## 6. Secret Sauce Interface Contract

```typescript
interface SecretSauceManager {
  /**
   * Load all Secret Sauce content into a context string.
   * Respects token budget.
   */
  buildContext(budget: number, activeProfile: string): Promise<string>;

  /**
   * Update memories after a session interaction.
   */
  updateMemories(sessionSummary: string): Promise<void>;

  /**
   * Write diary entry for the day.
   */
  updateDiary(entry: DiaryEntry): Promise<void>;

  /**
   * Check if summarization is needed and perform it.
   */
  maybeSummarize(): Promise<void>;

  /**
   * Get a specific profile's system prompt.
   */
  getProfilePrompt(profileId: string): Promise<string | null>;

  /**
   * List all available profiles.
   */
  listProfiles(): Promise<Profile[]>;

  /**
   * Update identity based on growth observations.
   */
  evolveIdentity(observations: string[]): Promise<void>;
}

interface DiaryEntry {
  date: string;
  sessionsCount: number;
  totalTokens: number;
  profileUsed: string;
  keyActivities: string[];
  notable: string[];
}
```

---

## 7. TUI ↔ Engine Communication Pattern

```typescript
// The TUI uses React context to access the engine
interface EngineContextValue {
  engine: Engine;
  session: SessionInfo | null;
  isProcessing: boolean;
  messages: Message[];
  commands: CommandDefinition[];
  profiles: Profile[];

  // Actions
  sendMessage: (content: string) => void;
  executeCommand: (command: string, args: string[]) => void;
  resolvePermission: (requestId: string, decision: PermissionDecision) => void;
  switchProfile: (profileId: string) => void;
}

// Engine events are consumed via a custom hook
function useEngineEvents(engine: Engine): {
  currentEvent: EngineEvent | null;
  isProcessing: boolean;
  permissionRequest: PermissionRequiredEvent | null;
}
```

---

## 8. Telegram Bridge Contract

```typescript
interface TelegramBridge {
  /**
   * Start the Telegram bot listener.
   */
  start(config: TelegramConfig): Promise<void>;

  /**
   * Stop the Telegram bot.
   */
  stop(): Promise<void>;

  /**
   * Send a message to the configured chat.
   */
  sendMessage(chatId: string, text: string, options?: TelegramMessageOptions): Promise<void>;

  /**
   * Send a permission request as inline keyboard.
   */
  sendPermissionPrompt(chatId: string, request: PermissionRequest): Promise<void>;

  /**
   * Get connection status.
   */
  getStatus(): TelegramStatus;
}

interface TelegramMessageOptions {
  parseMode?: 'Markdown' | 'HTML';
  replyMarkup?: InlineKeyboard;
}

interface TelegramStatus {
  connected: boolean;
  botUsername: string | null;
  lastActivity: Date | null;
}
```

---

## 9. Sub-Agent Manager Contract

The SubAgentManager is responsible for spawning, tracking, and collecting results from worker agents.

```typescript
interface SubAgentManager {
  /**
   * Spawn one or more sub-agents for a set of task assignments.
   * Returns agent IDs for tracking.
   */
  spawn(assignments: TaskAssignment[]): Promise<string[]>;

  /**
   * Get status of a specific agent.
   */
  getStatus(agentId: string): SubAgentStatus;

  /**
   * Get all active agents for a session.
   */
  getActive(sessionId: string): SubAgent[];

  /**
   * Wait for all agents in a batch to complete.
   * Yields progress events as agents finish.
   */
  awaitAll(agentIds: string[]): AsyncGenerator<AgentProgressEvent>;

  /**
   * Cancel a running agent (timeout or user abort).
   */
  cancel(agentId: string): Promise<void>;

  /**
   * Aggregate results from all agents in a batch.
   * Produces a single coherent response.
   */
  aggregateResults(agentIds: string[]): Promise<AggregatedResult>;
}

interface SubAgentStatus {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  currentTool: string | null;    // Tool currently being executed
  progress: string | null;       // Human-readable progress
  elapsed: number;               // Seconds running
}

interface AgentProgressEvent {
  agentId: string;
  type: 'started' | 'tool_executing' | 'tool_done' | 'completed' | 'failed';
  detail: string;
}

interface AggregatedResult {
  success: boolean;
  summary: string;               // User-facing summary of all work done
  agentResults: SubAgentResult[];
  totalToolsUsed: number;
  totalTokensConsumed: number;
}
```

---

## 10. Task Assigner Contract

The TaskAssigner decomposes complex model responses into executable sub-agent tasks.

```typescript
interface TaskAssigner {
  /**
   * Given a model's tool call response, determine if delegation is needed.
   * Simple single-tool calls execute directly; complex multi-tool or
   * multi-step requests get decomposed into parallel/sequential tasks.
   */
  analyze(modelResponse: CompletionChunk[]): TaskPlan;

  /**
   * Create task assignments from the plan.
   */
  createAssignments(plan: TaskPlan, context: TaskContext): TaskAssignment[];
}

interface TaskPlan {
  strategy: 'direct' | 'delegate_parallel' | 'delegate_sequential' | 'delegate_mixed';
  tasks: PlannedTask[];
  estimatedDuration: number;     // Estimated ms
}

interface PlannedTask {
  instruction: string;
  tools: string[];
  dependencies: string[];        // IDs of tasks that must complete first
  priority: 'high' | 'normal' | 'low';
}

interface TaskContext {
  sessionId: string;
  scope: string;
  availableTools: string[];
  activePermissions: Permission[];
}
```

---

## 11. Message Sanitizer Contract

The MessageSanitizer transforms raw user input into structured, model-optimized prompts.

```typescript
interface MessageSanitizer {
  /**
   * Process raw user input into a sanitized, structured prompt.
   * This is called BEFORE sending any message to the AI model.
   */
  sanitize(input: RawUserInput, context: SanitizationContext): Promise<SanitizedMessage>;

  /**
   * Determine the intent of the user's message without full processing.
   * Used for routing decisions (slash commands vs AI messages).
   */
  classifyIntent(input: string): MessageIntent;
}

interface RawUserInput {
  text: string;                  // What the user typed
  sessionHistory: Message[];     // Recent context
  activeProfile: string;         // Current profile
  currentScope: string;          // Working directory
}

interface SanitizationContext {
  secretSauceContext: string;    // Pre-built Secret Sauce context
  availableTools: ToolDefinition[];
  tokenBudget: number;           // Max tokens for the prompt
  modelCapabilities: ModelCapabilities;
}

interface SanitizedMessage {
  originalInput: string;         // Preserved for session display
  structuredPrompt: string;      // What goes to the model
  intent: MessageIntent;
  toolHints: string[];           // Likely tools needed
  contextAttached: string[];     // Which context sources were injected
}

type MessageIntent =
  | 'conversation'
  | 'task_request'
  | 'question'
  | 'command'
  | 'clarification'
  | 'multi_step_task';
```

---

## 12. Error Shield Contract

The ErrorShield wraps every public-facing operation to ensure internal errors never reach the user.

```typescript
interface ErrorShield {
  /**
   * Wrap an async operation. On failure, log internally and emit
   * a user-friendly fallback event instead of the error.
   */
  wrap<T>(
    operation: () => Promise<T>,
    fallback: ErrorFallback
  ): Promise<T | null>;

  /**
   * Wrap a sync operation.
   */
  wrapSync<T>(
    operation: () => T,
    fallback: ErrorFallback
  ): T | null;

  /**
   * Convert an internal error into a user-friendly gimmick message.
   * Uses the error type to select an appropriate animation/message.
   */
  toGimmick(error: unknown): GimmickEvent;
}

interface ErrorFallback {
  type: 'gimmick' | 'retry' | 'silent';
  gimmickMessage?: string;       // e.g. "Let me try a different approach..."
  maxRetries?: number;
  retryDelayMs?: number;
}

interface GimmickEvent {
  type: 'gimmick';
  animation: 'thinking' | 'recalculating' | 'adjusting' | 'recovering';
  message: string;               // User-friendly message
  recoverable: boolean;
  suggestedAction?: string;      // e.g. "Try again" or "Check connection"
}
```
