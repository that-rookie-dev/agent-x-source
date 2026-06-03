# Phase 2: Engine Adapter Layer

> **Status**: ⬜ Not Started
> **Depends on**: Phase 1 (01-SCAFFOLDING.md)
> **Estimated effort**: 4 days
> **Goal**: Create the adapter layer that wraps `@agentx/engine` for use inside VS Code's extension host, WITHOUT modifying any existing engine code. Provides workspace-aware initialization, typed event bridging, config synchronization, storage adaptation, and full lifecycle management.

---

## Task Index

| Task ID | Title | Status | Dependencies |
|---------|-------|--------|-------------|
| T2.1.1 | Create `adapter/` directory | ⬜ | Phase 1 |
| T2.1.2 | Write `VSCodeEngine.ts` — core wrapper class | ⬜ | T2.1.1, T2.2.1 |
| T2.1.3 | Implement singleton lifecycle management | ⬜ | T2.1.2 |
| T2.1.4 | Implement `dispose()` and `restart()` | ⬜ | T2.1.2 |
| T2.2.1 | Write `VSCodeToolkitFactory.ts` | ⬜ | T2.1.1 |
| T2.2.2 | Implement `createVSCodeToolkit()` | ⬜ | T2.2.1 |
| T2.3.1 | Write `EngineLifecycle.ts` | ⬜ | T2.1.2 |
| T2.3.2 | Implement lazy initialization | ⬜ | T2.3.1 |
| T2.3.3 | Implement workspace folder change handling | ⬜ | T2.3.1 |
| T2.3.4 | Implement crash recovery (stuck processing detection) | ⬜ | T2.3.1 |
| T2.3.5 | Implement config change watching | ⬜ | T2.3.1 |
| T2.4.1 | Write `EventBridge.ts` | ⬜ | T2.1.1 |
| T2.4.2 | Map all 55+ EngineEvent types to typed subscriptions | ⬜ | T2.4.1 |
| T2.4.3 | Implement stream throttling at 16ms (60fps) | ⬜ | T2.4.1 |
| T2.5.1 | Write `ConfigBridge.ts` | ⬜ | T2.1.1 |
| T2.5.2 | Implement first-run detection | ⬜ | T2.5.1 |
| T2.5.3 | Implement VS Code ↔ engine config sync | ⬜ | T2.5.1 |
| T2.5.4 | Implement provider/model change handling | ⬜ | T2.5.1 |
| T2.6.1 | Write `VSCodeStorageAdapter.ts` | ⬜ | T2.1.1 |
| T2.6.2 | Implement all CRUD methods for sessions | ⬜ | T2.6.1 |
| T2.6.3 | Implement message persistence | ⬜ | T2.6.1 |
| T2.6.4 | Implement token log and permission persistence | ⬜ | T2.6.1 |
| T2.7.1 | Write `types.ts` — all adapter type definitions | ⬜ | T2.1.1 |
| T2.8.1 | Write unit tests for VSCodeEngine | ⬜ | T2.1.2 |
| T2.8.2 | Write unit tests for EventBridge | ⬜ | T2.4.1 |
| T2.8.3 | Write unit tests for ConfigBridge | ⬜ | T2.5.1 |
| T2.8.4 | Write unit tests for VSCodeStorageAdapter | ⬜ | T2.6.1 |
| T2.8.5 | Write integration test: create engine → send message → receive response | ⬜ | T2.1.2, T2.4.1 |
| T2.8.6 | Verify zero modifications to existing engine files | ⬜ | All above |

---

## T2.7: Type Definitions

### T2.7.1 — Write `packages/vscode/src/adapter/types.ts`

- **Status**: ⬜
- **Dependencies**: T2.1.1
- **File to create**: `packages/vscode/src/adapter/types.ts`
- **Action**: Write the complete type definitions used across the adapter layer.

```typescript
import type * as vscode from 'vscode';
import type {
  Message,
  EngineEvent,
  Plan,
  PlanStep,
  ToolResult,
  ModelInfo,
  ProviderId,
  AgentXConfig,
  RemediationAction,
  TodoItem,
  ToolCardProps,
  ThinkingPanelState,
  SpinnerConfig,
  VisualUpdate,
  Session,
  SessionStatus,
} from '@agentx/shared';

// ─── Engine State ───

export type EngineStatus =
  | 'uninitialized'
  | 'initializing'
  | 'ready'
  | 'processing'
  | 'error'
  | 'disposed';

export interface EngineState {
  status: EngineStatus;
  workspaceRoot: string | null;
  sessionId: string | null;
  providerId: ProviderId | null;
  modelId: string | null;
  toolCount: number;
  watcherCount: number;
  schedulerCount: number;
  planModeEnabled: boolean;
  processing: boolean;
  error: string | null;
}

// ─── Chat Messages ───

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls: ChatToolCall[] | null;
  tokenCount: number;
  tokenCost?: number;
  createdAt: string;
  elapsed?: number;
  turnId?: string;
  reasoning?: string;
  metadata?: ChatMessageMetadata;
}

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: string;
  result?: string;
}

export interface ChatMessageMetadata {
  rawTurnId?: string;
  channel?: string;
  normalizationWarnings?: number;
  providerRequestId?: string;
}

// ─── Tool Execution ───

export interface ToolExecution {
  toolCallId: string;
  toolName: string;
  description: string;
  status: 'pending' | 'executing' | 'completed' | 'error' | 'denied';
  startTime: number;
  endTime?: number;
  elapsed?: number;
  result?: ToolResult;
  args?: Record<string, unknown>;
}

// ─── Permission Request ───

export interface PermissionRequest {
  tool: string;
  path: string;
  riskLevel: string;
  timestamp: number;
}

export type PermissionChoice = 'allow_once' | 'allow_always' | 'deny';

// ─── Plan State ───

export interface PlanState {
  plan: Plan | null;
  userRequest: string | null;
  currentStepId: string | null;
  awaitingApproval: boolean;
  awaitingStepApproval: string | null;
}

// ─── Sub-Agent State ───

export interface SubAgentState {
  agentId: string;
  task: string;
  status: 'spawning' | 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: number;
  endTime?: number;
  elapsed?: number;
  summary?: string;
}

// ─── Session Info ───

export interface SessionInfo {
  id: string;
  title: string;
  status: SessionStatus;
  providerId: string;
  modelId: string;
  scopePath: string;
  tokenUsed: number;
  tokenAvailable: number;
  crewId: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

// ─── Status Bar State ───

export interface StatusBarState {
  providerId: ProviderId | null;
  modelId: string | null;
  tokenUsed: number;
  tokenTotal: number;
  tokenPercentage: number;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  isProcessing: boolean;
  isNearLimit: boolean;
  isAtLimit: boolean;
  planMode: boolean;
  watcherCount: number;
  schedulerCount: number;
  subAgentCount: number;
}

// ─── Token State ───

export interface TokenState {
  used: number;
  total: number;
  remaining: number;
  percentage: number;
  isNearLimit: boolean;
  isAtLimit: boolean;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  inputCost: number;
  outputCost: number;
}

// ─── Stream State ───

export interface StreamState {
  isActive: boolean;
  content: string;
  fullContent: string;
}

// ─── Reasoning State ───

export interface ReasoningState {
  isActive: boolean;
  glimpses: string[];
}

// ─── Indexing State ───

export interface IndexingState {
  isActive: boolean;
  indexed: number;
  total: number;
  currentFile: string | null;
  chunks: number | null;
}

// ─── Research State ───

export interface ResearchState {
  isActive: boolean;
  question: string | null;
  queries: ResearchQuery[];
  synthesisResultCount: number | null;
  report: string | null;
}

export interface ResearchQuery {
  queryId: string;
  question: string;
  sources: string;
  completed: boolean;
  result?: {
    answer: string;
    sources: string[];
    elapsed: number;
  };
}

// ─── Config State ───

export interface ConfigState {
  isConfigured: boolean;
  isSetupComplete: boolean;
  config: AgentXConfig | null;
  firstRun: boolean;
}

// ─── Event Callbacks ───

export type MessageCallback = (message: ChatMessage) => void;
export type StreamCallback = (chunk: { content: string; fullContent: string }) => void;
export type ToolEventCallback = (execution: ToolExecution) => void;
export type PermissionCallback = (request: PermissionRequest) => void;
export type ErrorCallback = (error: { code: string; message: string; recoverable: boolean; actions?: RemediationAction[] }) => void;
export type PlanEventCallback = (event: EngineEvent) => void;
export type SubAgentEventCallback = (state: SubAgentState) => void;
export type ReasoningCallback = (state: ReasoningState) => void;
export type MetaCallback = (event: EngineEvent) => void;
export type VisualCallback = (update: VisualUpdate) => void;
export type TokenUpdateCallback = (state: TokenState) => void;
export type TodoCallback = (items: TodoItem[]) => void;
export type IndexingCallback = (state: IndexingState) => void;
export type ResearchCallback = (state: ResearchState) => void;
export type LoadingCallback = (stage: string | null) => void;
export type ProcessingCallback = (state: { taskDescription: string; stage: string; progress: number } | null) => void;
export type DiffPreviewCallback = (preview: { tool: string; filePath: string; diff: string; oldContent?: string; newContent?: string }) => void;
export type ClarificationCallback = (request: { question: string; options: string[]; allowFreeform: boolean }) => void;
export type CompactionCallback = (event: { type: 'start' | 'complete'; currentTokens?: number; threshold?: number; saved?: number }) => void;
export type WatchEventCallback = (event: { event: string; filePath: string; command: string; timestamp: number }) => void;
export type BackgroundTaskCallback = (event: { taskId: string; summary?: string }) => void;
export type ReminderCallback = (event: { taskId: string; name: string; message: string }) => void;

// ─── Disposable ───

export interface Disposable {
  dispose(): void;
}

// ─── Engine Adapter Options ───

export interface EngineAdapterOptions {
  workspaceRoot: string;
  context: vscode.ExtensionContext;
  autoInitialize?: boolean;
  crashRecoveryTimeout?: number;
  streamThrottleMs?: number;
}

// ─── Lifecycle Events ───

export type LifecycleEvent =
  | { type: 'initializing' }
  | { type: 'ready'; sessionId: string }
  | { type: 'error'; error: string }
  | { type: 'workspace_changed'; newRoot: string }
  | { type: 'restarting' }
  | { type: 'disposed' }
  | { type: 'crash_detected'; stuckFor: number }
  | { type: 'crash_recovered' };

export type LifecycleCallback = (event: LifecycleEvent) => void;
```

- **Acceptance criteria**:
  - All types compile without errors.
  - Types reference `@agentx/shared` types correctly.
  - Every callback type is exported.
  - `EngineStatus` covers all lifecycle states.

---

## T2.2: Workspace-Aware Toolkit Factory

### T2.2.1 — Create `packages/vscode/src/adapter/VSCodeToolkitFactory.ts`

- **Status**: ⬜
- **Dependencies**: T2.1.1
- **File to create**: `packages/vscode/src/adapter/VSCodeToolkitFactory.ts`

### T2.2.2 — Implement `createVSCodeToolkit()`

- **Status**: ⬜
- **Dependencies**: T2.2.1
- **Action**: Write the toolkit factory that pre-creates the toolkit with the workspace root as scope, avoiding `process.cwd()` dependency.

```typescript
import { createDefaultToolkit } from '@agentx/engine/tools/toolkit';
import { EnhancedToolExecutor } from '@agentx/engine/tools/EnhancedToolExecutor';
import type { ToolRegistry } from '@agentx/engine/tools/ToolRegistry';
import type { ToolExecutor } from '@agentx/engine/tools/ToolExecutor';

export interface VSCodeToolkit {
  registry: ToolRegistry;
  executor: EnhancedToolExecutor;
  factoryExecutor: ToolExecutor;
}

export function createVSCodeToolkit(workspaceRoot: string): VSCodeToolkit {
  const toolkit = createDefaultToolkit(workspaceRoot);

  const executor = new EnhancedToolExecutor(toolkit.registry, workspaceRoot);

  const handlersMap = (toolkit.executor as unknown as Record<string, unknown>)['handlers'] as
    | Map<
        string,
        (
          args: Record<string, unknown>,
          ctx: import('@agentx/shared').ToolExecutionContext,
        ) => Promise<import('@agentx/shared').ToolResult>
      >
    | undefined;

  if (handlersMap) {
    for (const [name, handler] of handlersMap) {
      executor.registerHandler(name, handler);
    }
  }

  return {
    registry: toolkit.registry,
    executor,
    factoryExecutor: toolkit.executor,
  };
}
```

- **Acceptance criteria**:
  - `createVSCodeToolkit('/some/workspace')` returns a registry and an `EnhancedToolExecutor` scoped to `/some/workspace`.
  - All 165 tool handlers from `createDefaultToolkit` are copied to the `EnhancedToolExecutor`.
  - No call to `process.cwd()` occurs within this module.
  - The returned executor's scope path is set to `workspaceRoot`.

---

## T2.1: VSCodeEngine Wrapper

### T2.1.1 — Create `adapter/` directory

- **Status**: ⬜
- **Dependencies**: Phase 1
- **Action**:

```bash
mkdir -p /source/packages/vscode/src/adapter
```

- **Acceptance criteria**:
  - Directory `packages/vscode/src/adapter/` exists.

### T2.1.2 — Write `packages/vscode/src/adapter/VSCodeEngine.ts`

- **Status**: ⬜
- **Dependencies**: T2.1.1, T2.2.1
- **File to create**: `packages/vscode/src/adapter/VSCodeEngine.ts`
- **Action**: Write the core wrapper class that creates and manages the `Agent` instance with workspace root as scope.

```typescript
import type * as vscode from 'vscode';
import { Agent } from '@agentx/engine/agent/Agent';
import type { AgentOptions } from '@agentx/engine/agent/Agent';
import { ConfigManager } from '@agentx/engine/config/ConfigManager';
import type { AgentXConfig } from '@agentx/shared';
import { generateSessionId } from '@agentx/shared';
import { createVSCodeToolkit } from './VSCodeToolkitFactory';
import type { VSCodeToolkit } from './VSCodeToolkitFactory';
import type { EngineState, EngineStatus } from './types';

export class VSCodeEngine {
  private agent: Agent | null = null;
  private toolkit: VSCodeToolkit | null = null;
  private configManager: ConfigManager;
  private config: AgentXConfig | null = null;
  private sessionId: string | null = null;
  private workspaceRoot: string;
  private context: vscode.ExtensionContext;
  private status: EngineStatus = 'uninitialized';
  private error: string | null = null;
  private initPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(workspaceRoot: string, context: vscode.ExtensionContext) {
    this.workspaceRoot = workspaceRoot;
    this.context = context;
    this.configManager = new ConfigManager();
  }

  async initialize(): Promise<void> {
    if (this.disposed) {
      throw new Error('VSCodeEngine has been disposed');
    }

    if (this.status === 'ready' && this.agent) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._doInitialize();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async _doInitialize(): Promise<void> {
    this.status = 'initializing';
    this.error = null;

    try {
      this.config = this.configManager.load();
    } catch (err) {
      this.status = 'error';
      this.error = `Failed to load config: ${err instanceof Error ? err.message : String(err)}`;
      throw new Error(this.error);
    }

    this.sessionId = generateSessionId();

    this.toolkit = createVSCodeToolkit(this.workspaceRoot);

    const agentOptions: AgentOptions = {
      config: this.config,
      sessionId: this.sessionId,
      toolExecutor: this.toolkit.executor,
      toolRegistry: this.toolkit.registry,
      gitAutoCommit: false,
      gitAware: true,
    };

    try {
      this.agent = new Agent(agentOptions);
    } catch (err) {
      this.status = 'error';
      this.error = `Failed to create Agent: ${err instanceof Error ? err.message : String(err)}`;
      throw new Error(this.error);
    }

    this.status = 'ready';
  }

  getAgent(): Agent | null {
    return this.agent;
  }

  isInitialized(): boolean {
    return this.status === 'ready' && this.agent !== null;
  }

  getState(): EngineState {
    return {
      status: this.status,
      workspaceRoot: this.workspaceRoot,
      sessionId: this.sessionId,
      providerId: this.config?.provider.activeProvider ?? null,
      modelId: this.config?.provider.activeModel ?? null,
      toolCount: this.agent?.toolCount ?? 0,
      watcherCount: this.agent?.watcherCount ?? 0,
      schedulerCount: this.agent?.schedulerCount ?? 0,
      planModeEnabled: this.agent?.planModeEnabled ?? false,
      processing: this.agent?.processing ?? false,
      error: this.error,
    };
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  getConfig(): AgentXConfig | null {
    return this.config;
  }

  getConfigManager(): ConfigManager {
    return this.configManager;
  }

  async restart(newWorkspaceRoot?: string): Promise<void> {
    if (this.disposed) {
      throw new Error('VSCodeEngine has been disposed');
    }

    const root = newWorkspaceRoot ?? this.workspaceRoot;

    await this.teardown();

    this.workspaceRoot = root;
    this.agent = null;
    this.toolkit = null;
    this.config = null;
    this.sessionId = null;
    this.status = 'uninitialized';
    this.error = null;

    await this.initialize();
  }

  private async teardown(): Promise<void> {
    if (this.agent) {
      try {
        this.agent.cancel();
      } catch {
        // Ignore cancel errors during teardown
      }

      try {
        this.agent.endSession();
      } catch {
        // Ignore endSession errors during teardown
      }
    }

    this.agent = null;
    this.toolkit = null;
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    if (this.initPromise) {
      try {
        await this.initPromise;
      } catch {
        // Ignore initialization errors during dispose
      }
    }

    await this.teardown();

    this.status = 'disposed';
    this.config = null;
    this.sessionId = null;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  resetProcessingState(): void {
    if (this.agent && this.agent.processing) {
      this.agent.cancel();
    }
  }
}
```

- **Acceptance criteria**:
  - `VSCodeEngine` accepts `workspaceRoot: string` and `context: vscode.ExtensionContext`.
  - `initialize()` creates an `Agent` with the workspace root as scope — `process.cwd()` is never called by the adapter.
  - Toolkit is pre-created via `createVSCodeToolkit(workspaceRoot)` and passed to the Agent via `toolExecutor` and `toolRegistry` options.
  - Concurrent calls to `initialize()` are de-duplicated via `initPromise`.
  - `getAgent()` returns the `Agent` instance or `null`.
  - `isInitialized()` returns `true` only when status is `'ready'` and agent is non-null.
  - `restart()` tears down the existing agent and re-initializes with the new workspace root.
  - `dispose()` cancels any in-progress work, calls `endSession()`, and marks the engine as disposed.
  - All 12 singleton setters in the Agent constructor run correctly (they are internal to the Agent).

### T2.1.3 — Singleton lifecycle management

- **Status**: ⬜
- **Dependencies**: T2.1.2
- **Note**: The singleton lifecycle is managed by the `EngineLifecycle` class (T2.3), which holds a single `VSCodeEngine` instance and ensures clean state on re-init.

### T2.1.4 — `dispose()` and `restart()`

- **Status**: ⬜
- **Dependencies**: T2.1.2
- **Note**: Both are implemented inline in `VSCodeEngine.ts` above. `dispose()` is idempotent and waits for any pending initialization. `restart()` tears down then re-initializes.

---

## T2.3: Engine Lifecycle Manager

### T2.3.1 — Write `packages/vscode/src/adapter/EngineLifecycle.ts`

- **Status**: ⬜
- **Dependencies**: T2.1.2
- **File to create**: `packages/vscode/src/adapter/EngineLifecycle.ts`

### T2.3.2 — Implement lazy initialization

### T2.3.3 — Implement workspace folder change handling

### T2.3.4 — Implement crash recovery (stuck processing detection)

### T2.3.5 — Implement config change watching

- **Action**: Write the full lifecycle manager class.

```typescript
import * as vscode from 'vscode';
import { VSCodeEngine } from './VSCodeEngine';
import type { LifecycleEvent, LifecycleCallback, Disposable } from './types';

const CRASH_RECOVERY_TIMEOUT_MS = 60_000;
const CRASH_CHECK_INTERVAL_MS = 10_000;
const CONFIG_WATCH_DEBOUNCE_MS = 2_000;

export class EngineLifecycle implements vscode.Disposable {
  private engine: VSCodeEngine | null = null;
  private context: vscode.ExtensionContext;
  private lifecycleHandlers = new Set<LifecycleCallback>();
  private crashCheckTimer: ReturnType<typeof setInterval> | null = null;
  private configWatcher: vscode.FileSystemWatcher | null = null;
  private configDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private workspaceWatcher: vscode.Disposable | null = null;
  private disposed = false;
  private crashRecoveryTimeout: number;

  constructor(context: vscode.ExtensionContext, crashRecoveryTimeout?: number) {
    this.context = context;
    this.crashRecoveryTimeout = crashRecoveryTimeout ?? CRASH_RECOVERY_TIMEOUT_MS;
  }

  getEngine(): VSCodeEngine | null {
    return this.engine;
  }

  async ensureReady(): Promise<VSCodeEngine> {
    if (this.disposed) {
      throw new Error('EngineLifecycle has been disposed');
    }

    if (this.engine && this.engine.isInitialized()) {
      return this.engine;
    }

    const workspaceRoot = this.resolveWorkspaceRoot();
    if (!workspaceRoot) {
      throw new Error('No workspace folder open. Open a folder to use Agent-X.');
    }

    if (!this.engine) {
      this.engine = new VSCodeEngine(workspaceRoot, this.context);
    }

    await this.engine.initialize();

    this.startCrashRecovery();
    this.startConfigWatcher();
    this.startWorkspaceWatcher();

    this.emit({ type: 'ready', sessionId: this.engine.getSessionId()! });

    return this.engine;
  }

  onLifecycle(handler: LifecycleCallback): Disposable {
    this.lifecycleHandlers.add(handler);
    return {
      dispose: () => {
        this.lifecycleHandlers.delete(handler);
      },
    };
  }

  private resolveWorkspaceRoot(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return null;
    }
    return folders[0].uri.fsPath;
  }

  private startWorkspaceWatcher(): void {
    if (this.workspaceWatcher) {
      this.workspaceWatcher.dispose();
    }

    this.workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(
      async (event) => {
        if (this.disposed) return;

        const newRoot = this.resolveWorkspaceRoot();
        if (!newRoot) {
          return;
        }

        const currentRoot = this.engine?.getWorkspaceRoot();
        if (currentRoot === newRoot) {
          return;
        }

        this.emit({ type: 'workspace_changed', newRoot });
        this.emit({ type: 'restarting' });

        try {
          if (this.engine) {
            await this.engine.restart(newRoot);
            this.emit({ type: 'ready', sessionId: this.engine.getSessionId()! });
          }
        } catch (err) {
          this.emit({
            type: 'error',
            error: `Workspace change restart failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      },
    );

    this.context.subscriptions.push(this.workspaceWatcher);
  }

  private startCrashRecovery(): void {
    if (this.crashCheckTimer) {
      clearInterval(this.crashCheckTimer);
    }

    this.crashCheckTimer = setInterval(() => {
      if (this.disposed || !this.engine) return;

      const agent = this.engine.getAgent();
      if (!agent) return;

      if (agent.processing) {
        const state = this.engine.getState();
        if (state.status === 'processing') {
          this.emit({
            type: 'crash_detected',
            stuckFor: this.crashRecoveryTimeout,
          });

          this.engine.resetProcessingState();

          this.emit({ type: 'crash_recovered' });
        }
      }
    }, CRASH_CHECK_INTERVAL_MS);

    this.context.subscriptions.push({
      dispose: () => {
        if (this.crashCheckTimer) {
          clearInterval(this.crashCheckTimer);
          this.crashCheckTimer = null;
        }
      },
    });
  }

  private startConfigWatcher(): void {
    if (this.configWatcher) {
      this.configWatcher.dispose();
    }

    const homeDir = process.env['HOME'] || process.env['USERPROFILE'] || '';
    if (!homeDir) return;

    const configPattern = new vscode.RelativePattern(
      vscode.Uri.file(`${homeDir}/.config/agentx`),
      'config.json',
    );

    this.configWatcher = vscode.workspace.createFileSystemWatcher(configPattern);

    const handleChange = () => {
      if (this.configDebounceTimer) {
        clearTimeout(this.configDebounceTimer);
      }

      this.configDebounceTimer = setTimeout(async () => {
        if (this.disposed || !this.engine) return;

        try {
          const configManager = this.engine.getConfigManager();
          const newConfig = configManager.reload();

          const agent = this.engine.getAgent();
          if (agent && newConfig.provider.activeModel !== agent.getMessageHistory()[0]?.content) {
            // Model or provider may have changed — notify via event
          }
        } catch {
          // Config reload failed — non-critical
        }
      }, CONFIG_WATCH_DEBOUNCE_MS);
    };

    this.configWatcher.onDidChange(handleChange);
    this.configWatcher.onDidCreate(handleChange);

    this.context.subscriptions.push(this.configWatcher);
    this.context.subscriptions.push({
      dispose: () => {
        if (this.configDebounceTimer) {
          clearTimeout(this.configDebounceTimer);
          this.configDebounceTimer = null;
        }
      },
    });
  }

  private emit(event: LifecycleEvent): void {
    for (const handler of this.lifecycleHandlers) {
      try {
        handler(event);
      } catch {
        // Swallow handler errors
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    if (this.crashCheckTimer) {
      clearInterval(this.crashCheckTimer);
      this.crashCheckTimer = null;
    }

    if (this.configDebounceTimer) {
      clearTimeout(this.configDebounceTimer);
      this.configDebounceTimer = null;
    }

    if (this.configWatcher) {
      this.configWatcher.dispose();
      this.configWatcher = null;
    }

    if (this.workspaceWatcher) {
      this.workspaceWatcher.dispose();
      this.workspaceWatcher = null;
    }

    if (this.engine) {
      await this.engine.dispose();
      this.engine = null;
    }

    this.lifecycleHandlers.clear();

    this.emit({ type: 'disposed' });
  }
}
```

- **Acceptance criteria**:
  - `ensureReady()` lazily creates and initializes the engine on first call; subsequent calls return the existing engine.
  - If no workspace folder is open, `ensureReady()` throws a descriptive error.
  - Workspace folder changes trigger `restart()` on the engine with the new root.
  - Crash recovery checks run every 10 seconds; if the agent has been `processing` for > 60 seconds, it auto-resets via `cancel()`.
  - Config file at `~/.config/agentx/config.json` is watched; changes are debounced at 2 seconds and trigger a `ConfigManager.reload()`.
  - `dispose()` cleans up all timers, watchers, and the engine.
  - Lifecycle events are emitted to all registered handlers.

---

## T2.4: Event Bridge

### T2.4.1 — Write `packages/vscode/src/adapter/EventBridge.ts`

- **Status**: ⬜
- **Dependencies**: T2.1.1
- **File to create**: `packages/vscode/src/adapter/EventBridge.ts`

### T2.4.2 — Map all 55+ EngineEvent types to typed subscriptions

### T2.4.3 — Implement stream throttling at 16ms (60fps)

- **Action**: Write the full event bridge that subscribes to `AgentEventBus` and re-emits typed events.

```typescript
import type { AgentEventBus } from '@agentx/engine/EventBus';
import type {
  EngineEvent,
  Message,
  ToolResult,
  ModelInfo,
  RemediationAction,
  Plan,
  PlanStep,
  TodoItem,
  VisualUpdate,
} from '@agentx/shared';
import type {
  ChatMessage,
  ChatToolCall,
  ToolExecution,
  PermissionRequest,
  SubAgentState,
  ReasoningState,
  TokenState,
  IndexingState,
  ResearchState,
  ResearchQuery,
  StreamState,
  Disposable,
  MessageCallback,
  StreamCallback,
  ToolEventCallback,
  PermissionCallback,
  ErrorCallback,
  PlanEventCallback,
  SubAgentEventCallback,
  ReasoningCallback,
  MetaCallback,
  VisualCallback,
  TokenUpdateCallback,
  TodoCallback,
  IndexingCallback,
  ResearchCallback,
  LoadingCallback,
  ProcessingCallback,
  DiffPreviewCallback,
  ClarificationCallback,
  CompactionCallback,
  WatchEventCallback,
  BackgroundTaskCallback,
  ReminderCallback,
} from './types';

const STREAM_THROTTLE_MS = 16;

export class EventBridge {
  private unsubscribe: (() => void) | null = null;
  private eventBus: AgentEventBus;

  private messageHandlers = new Set<MessageCallback>();
  private streamHandlers = new Set<StreamCallback>();
  private toolHandlers = new Set<ToolEventCallback>();
  private permissionHandlers = new Set<PermissionCallback>();
  private errorHandlers = new Set<ErrorCallback>();
  private planHandlers = new Set<PlanEventCallback>();
  private subAgentHandlers = new Set<SubAgentEventCallback>();
  private reasoningHandlers = new Set<ReasoningCallback>();
  private metaHandlers = new Set<MetaCallback>();
  private visualHandlers = new Set<VisualCallback>();
  private tokenHandlers = new Set<TokenUpdateCallback>();
  private todoHandlers = new Set<TodoCallback>();
  private indexingHandlers = new Set<IndexingCallback>();
  private researchHandlers = new Set<ResearchCallback>();
  private loadingHandlers = new Set<LoadingCallback>();
  private processingHandlers = new Set<ProcessingCallback>();
  private diffPreviewHandlers = new Set<DiffPreviewCallback>();
  private clarificationHandlers = new Set<ClarificationCallback>();
  private compactionHandlers = new Set<CompactionCallback>();
  private watchEventHandlers = new Set<WatchEventCallback>();
  private backgroundTaskHandlers = new Set<BackgroundTaskCallback>();
  private reminderHandlers = new Set<ReminderCallback>();

  private lastStreamEmit = 0;
  private pendingStreamChunk: { content: string; fullContent: string } | null = null;
  private streamThrottleTimer: ReturnType<typeof setTimeout> | null = null;
  private streamThrottleMs: number;

  private reasoningState: ReasoningState = { isActive: false, glimpses: [] };
  private indexingState: IndexingState = { isActive: false, indexed: 0, total: 0, currentFile: null, chunks: null };
  private researchState: ResearchState = { isActive: false, question: null, queries: [], synthesisResultCount: null, report: null };
  private streamState: StreamState = { isActive: false, content: '', fullContent: '' };

  private toolExecutions = new Map<string, ToolExecution>();
  private subAgentStates = new Map<string, SubAgentState>();

  constructor(eventBus: AgentEventBus, streamThrottleMs?: number) {
    this.eventBus = eventBus;
    this.streamThrottleMs = streamThrottleMs ?? STREAM_THROTTLE_MS;
    this.subscribe();
  }

  private subscribe(): void {
    this.unsubscribe = this.eventBus.on((event: EngineEvent) => {
      this.dispatch(event);
    });
  }

  private dispatch(event: EngineEvent): void {
    this.emitMeta(event);

    switch (event.type) {
      case 'message_sent':
        this.handleMessageSent(event.message);
        break;

      case 'message_received':
        this.handleMessageReceived(event.message, event.elapsed);
        break;

      case 'stream_chunk':
        this.handleStreamChunk(event.content, event.fullContent);
        break;

      case 'loading_start':
        this.emitAll(this.loadingHandlers, event.stage);
        break;

      case 'loading_end':
        this.emitAll(this.loadingHandlers, null);
        break;

      case 'processing_start':
        this.emitAll(this.processingHandlers, {
          taskDescription: event.taskDescription,
          stage: event.taskDescription,
          progress: 0,
        });
        break;

      case 'processing_progress':
        this.emitAll(this.processingHandlers, {
          taskDescription: event.stage,
          stage: event.stage,
          progress: event.progress,
        });
        break;

      case 'processing_complete':
        this.emitAll(this.processingHandlers, null);
        break;

      case 'permission_required':
        this.handlePermissionRequired(event.tool, event.path, event.riskLevel);
        break;

      case 'token_update':
        this.handleTokenUpdate(event.used, event.available);
        break;

      case 'token_usage':
        this.handleTokenUsage(event.totalTokens, event.contextWindow);
        break;

      case 'error':
        this.emitAll(this.errorHandlers, {
          code: event.code,
          message: event.message,
          recoverable: event.recoverable,
          actions: event.actions,
        });
        break;

      case 'tool_executing':
        this.handleToolExecuting(event.tool, event.description, event.startTime);
        break;

      case 'tool_complete':
        this.handleToolComplete(event.tool, event.result, event.elapsed);
        break;

      case 'agent_spawned':
        this.handleAgentSpawned(event.agentId, event.task, event.startTime);
        break;

      case 'agent_progress':
        this.handleAgentProgress(event.agentId, event.status);
        break;

      case 'agent_complete':
        this.handleAgentComplete(event.agentId, event.summary, event.elapsed);
        break;

      case 'reasoning_start':
        this.reasoningState = { isActive: true, glimpses: [] };
        this.emitAll(this.reasoningHandlers, { ...this.reasoningState });
        break;

      case 'reasoning_glimpse':
        this.reasoningState.glimpses.push(event.text);
        this.emitAll(this.reasoningHandlers, { ...this.reasoningState });
        break;

      case 'reasoning_complete':
        this.reasoningState.isActive = false;
        this.emitAll(this.reasoningHandlers, { ...this.reasoningState });
        break;

      case 'plan_generated':
      case 'plan_step_approved':
      case 'plan_step_rejected':
      case 'plan_step_pending':
      case 'plan_step_skipped':
      case 'plan_step_executing':
      case 'plan_step_complete':
      case 'plan_step_failed':
      case 'plan_approved':
      case 'plan_rejected':
      case 'plan_cancelled':
      case 'plan_mode_entered':
      case 'plan_mode_exited':
        this.emitAll(this.planHandlers, event);
        break;

      case 'todo_update':
        this.emitAll(this.todoHandlers, event.items);
        break;

      case 'indexing_start':
        this.indexingState = {
          isActive: true,
          indexed: 0,
          total: event.totalFiles,
          currentFile: null,
          chunks: null,
        };
        this.emitAll(this.indexingHandlers, { ...this.indexingState });
        break;

      case 'indexing_progress':
        this.indexingState.indexed = event.indexed;
        this.indexingState.total = event.total;
        this.indexingState.currentFile = event.currentFile ?? null;
        this.emitAll(this.indexingHandlers, { ...this.indexingState });
        break;

      case 'indexing_complete':
        this.indexingState.isActive = false;
        this.indexingState.indexed = event.indexed;
        this.indexingState.total = event.total;
        this.indexingState.chunks = event.chunks;
        this.emitAll(this.indexingHandlers, { ...this.indexingState });
        break;

      case 'diff_preview':
        this.emitAll(this.diffPreviewHandlers, {
          tool: event.tool,
          filePath: event.filePath,
          diff: event.diff,
          oldContent: event.oldContent,
          newContent: event.newContent,
        });
        break;

      case 'clarification_required':
        this.emitAll(this.clarificationHandlers, {
          question: event.question,
          options: event.options,
          allowFreeform: event.allowFreeform,
        });
        break;

      case 'compaction_start':
        this.emitAll(this.compactionHandlers, {
          type: 'start',
          currentTokens: event.currentTokens,
          threshold: event.threshold,
        });
        break;

      case 'compaction_complete':
        this.emitAll(this.compactionHandlers, {
          type: 'complete',
          saved: event.saved,
        });
        break;

      case 'context_compacted':
        this.emitAll(this.compactionHandlers, {
          type: 'complete',
          saved: event.saved,
        });
        break;

      case 'watch_event':
        this.emitAll(this.watchEventHandlers, {
          event: event.event,
          filePath: event.filePath,
          command: event.command,
          timestamp: event.timestamp,
        });
        break;

      case 'background_task_complete':
        this.emitAll(this.backgroundTaskHandlers, {
          taskId: event.taskId,
          summary: event.summary,
        });
        break;

      case 'task_backgrounded':
        this.emitAll(this.backgroundTaskHandlers, {
          taskId: event.taskId,
        });
        break;

      case 'reminder_fired':
        this.emitAll(this.reminderHandlers, {
          taskId: event.taskId,
          name: event.name,
          message: event.message,
        });
        break;

      case 'research_start':
        this.researchState = {
          isActive: true,
          question: event.question,
          queries: [],
          synthesisResultCount: null,
          report: null,
        };
        this.emitAll(this.researchHandlers, { ...this.researchState });
        break;

      case 'research_query':
        this.researchState.queries.push({
          queryId: event.queryId,
          question: event.question,
          sources: event.sources,
          completed: false,
        });
        this.emitAll(this.researchHandlers, { ...this.researchState });
        break;

      case 'research_subagent_complete':
        {
          const q = this.researchState.queries.find((q) => q.queryId === event.queryId);
          if (q) {
            q.completed = true;
            q.result = {
              answer: event.result.answer,
              sources: event.result.sources,
              elapsed: event.result.elapsed,
            };
          }
          this.emitAll(this.researchHandlers, { ...this.researchState });
        }
        break;

      case 'research_synthesis':
        this.researchState.synthesisResultCount = event.resultCount;
        this.emitAll(this.researchHandlers, { ...this.researchState });
        break;

      case 'research_complete':
        this.researchState.isActive = false;
        this.researchState.report = event.report;
        this.emitAll(this.researchHandlers, { ...this.researchState });
        break;

      case 'subagent_event':
        this.emitAll(this.subAgentHandlers, {
          agentId: event.subagentId,
          task: '',
          status: 'running',
          startTime: Date.now(),
        });
        break;

      case 'command_action':
        this.emitAll(this.metaHandlers, event);
        break;

      case 'intent_detected':
      case 'rag_queried':
      case 'decision_made':
      case 'reflection_complete':
      case 'skill_generated':
      case 'decomposition_start':
      case 'decomposition_ready':
      case 'decomposition_complete':
      case 'decomposition_fallback':
      case 'agent_message':
      case 'tot_start':
      case 'tot_thought_generated':
      case 'tot_evaluation':
      case 'tot_complete':
      case 'task_consolidated_time':
      case 'steer_message':
      case 'task_abort_requested':
      case 'task_aborted':
      case 'discord_connected':
      case 'discord_message':
      case 'discord_error':
        this.emitAll(this.metaHandlers, event);
        break;
    }
  }

  private handleMessageSent(message: Message): void {
    const chatMsg = this.toChatMessage(message);
    this.emitAll(this.messageHandlers, chatMsg);
  }

  private handleMessageReceived(message: Message, elapsed: number): void {
    this.flushPendingStream();
    this.streamState = { isActive: false, content: '', fullContent: '' };
    const chatMsg = this.toChatMessage(message);
    this.emitAll(this.messageHandlers, chatMsg);
  }

  private handleStreamChunk(content: string, fullContent: string): void {
    this.streamState = { isActive: true, content, fullContent };

    const now = Date.now();
    if (now - this.lastStreamEmit >= this.streamThrottleMs) {
      this.lastStreamEmit = now;
      this.pendingStreamChunk = null;
      this.emitAll(this.streamHandlers, { content, fullContent });
    } else {
      this.pendingStreamChunk = { content, fullContent };
      if (!this.streamThrottleTimer) {
        this.streamThrottleTimer = setTimeout(() => {
          this.streamThrottleTimer = null;
          if (this.pendingStreamChunk) {
            this.lastStreamEmit = Date.now();
            this.emitAll(this.streamHandlers, this.pendingStreamChunk);
            this.pendingStreamChunk = null;
          }
        }, this.streamThrottleMs - (now - this.lastStreamEmit));
      }
    }
  }

  private flushPendingStream(): void {
    if (this.streamThrottleTimer) {
      clearTimeout(this.streamThrottleTimer);
      this.streamThrottleTimer = null;
    }
    if (this.pendingStreamChunk) {
      this.emitAll(this.streamHandlers, this.pendingStreamChunk);
      this.pendingStreamChunk = null;
    }
  }

  private handlePermissionRequired(tool: string, path: string, riskLevel: string): void {
    this.emitAll(this.permissionHandlers, {
      tool,
      path,
      riskLevel,
      timestamp: Date.now(),
    });
  }

  private handleTokenUpdate(used: number, available: number): void {
    const total = used + available;
    this.emitAll(this.tokenHandlers, {
      used,
      total,
      remaining: available,
      percentage: total > 0 ? used / total : 0,
      isNearLimit: total > 0 && used / total >= 0.7,
      isAtLimit: total > 0 && used / total >= 0.95,
      inputTokens: 0,
      outputTokens: 0,
      totalCost: 0,
      inputCost: 0,
      outputCost: 0,
    });
  }

  private handleTokenUsage(totalTokens: number, contextWindow: number): void {
    this.emitAll(this.tokenHandlers, {
      used: totalTokens,
      total: contextWindow,
      remaining: Math.max(0, contextWindow - totalTokens),
      percentage: contextWindow > 0 ? totalTokens / contextWindow : 0,
      isNearLimit: contextWindow > 0 && totalTokens / contextWindow >= 0.7,
      isAtLimit: contextWindow > 0 && totalTokens / contextWindow >= 0.95,
      inputTokens: 0,
      outputTokens: 0,
      totalCost: 0,
      inputCost: 0,
      outputCost: 0,
    });
  }

  private handleToolExecuting(tool: string, description: string, startTime: number): void {
    const execution: ToolExecution = {
      toolCallId: `${tool}-${startTime}`,
      toolName: tool,
      description,
      status: 'executing',
      startTime,
    };
    this.toolExecutions.set(execution.toolCallId, execution);
    this.emitAll(this.toolHandlers, execution);
  }

  private handleToolComplete(tool: string, result: ToolResult, elapsed: number): void {
    let found: ToolExecution | undefined;
    for (const [id, exec] of this.toolExecutions) {
      if (exec.toolName === tool && exec.status === 'executing') {
        found = exec;
        break;
      }
    }

    if (found) {
      found.status = result.success ? 'completed' : 'error';
      found.endTime = Date.now();
      found.elapsed = elapsed;
      found.result = result;
      this.emitAll(this.toolHandlers, found);
      this.toolExecutions.delete(found.toolCallId);
    } else {
      const execution: ToolExecution = {
        toolCallId: `${tool}-complete-${Date.now()}`,
        toolName: tool,
        description: tool,
        status: result.success ? 'completed' : 'error',
        startTime: Date.now() - elapsed,
        endTime: Date.now(),
        elapsed,
        result,
      };
      this.emitAll(this.toolHandlers, execution);
    }
  }

  private handleAgentSpawned(agentId: string, task: string, startTime: number): void {
    const state: SubAgentState = {
      agentId,
      task,
      status: 'spawning',
      startTime,
    };
    this.subAgentStates.set(agentId, state);
    this.emitAll(this.subAgentHandlers, state);
  }

  private handleAgentProgress(agentId: string, status: string): void {
    const state = this.subAgentStates.get(agentId);
    if (state) {
      state.status = status === 'running' ? 'running' : (status as SubAgentState['status']);
      this.emitAll(this.subAgentHandlers, { ...state });
    }
  }

  private handleAgentComplete(agentId: string, summary: string, elapsed: number): void {
    const state = this.subAgentStates.get(agentId);
    if (state) {
      state.status = 'completed';
      state.endTime = Date.now();
      state.elapsed = elapsed;
      state.summary = summary;
      this.emitAll(this.subAgentHandlers, { ...state });
      this.subAgentStates.delete(agentId);
    }
  }

  private emitMeta(event: EngineEvent): void {
    if (this.metaHandlers.size > 0) {
      for (const handler of this.metaHandlers) {
        try {
          handler(event);
        } catch {
          // Swallow handler errors
        }
      }
    }
  }

  private toChatMessage(message: Message): ChatMessage {
    return {
      id: message.id,
      sessionId: message.sessionId,
      role: message.role as ChatMessage['role'],
      content: message.content,
      toolCalls: message.toolCalls
        ? message.toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
            result: tc.result,
          }))
        : null,
      tokenCount: message.tokenCount,
      tokenCost: message.tokenCost,
      createdAt: message.createdAt,
      elapsed: message.elapsed,
      turnId: message.turnId,
      reasoning: message.reasoning,
    };
  }

  private emitAll<T>(handlers: Set<(value: T) => void>, value: T): void {
    for (const handler of handlers) {
      try {
        handler(value);
      } catch {
        // Swallow handler errors
      }
    }
  }

  onMessage(handler: MessageCallback): Disposable {
    this.messageHandlers.add(handler);
    return { dispose: () => { this.messageHandlers.delete(handler); } };
  }

  onStream(handler: StreamCallback): Disposable {
    this.streamHandlers.add(handler);
    return { dispose: () => { this.streamHandlers.delete(handler); } };
  }

  onToolEvent(handler: ToolEventCallback): Disposable {
    this.toolHandlers.add(handler);
    return { dispose: () => { this.toolHandlers.delete(handler); } };
  }

  onPermission(handler: PermissionCallback): Disposable {
    this.permissionHandlers.add(handler);
    return { dispose: () => { this.permissionHandlers.delete(handler); } };
  }

  onError(handler: ErrorCallback): Disposable {
    this.errorHandlers.add(handler);
    return { dispose: () => { this.errorHandlers.delete(handler); } };
  }

  onPlanEvent(handler: PlanEventCallback): Disposable {
    this.planHandlers.add(handler);
    return { dispose: () => { this.planHandlers.delete(handler); } };
  }

  onSubAgentEvent(handler: SubAgentEventCallback): Disposable {
    this.subAgentHandlers.add(handler);
    return { dispose: () => { this.subAgentHandlers.delete(handler); } };
  }

  onReasoning(handler: ReasoningCallback): Disposable {
    this.reasoningHandlers.add(handler);
    return { dispose: () => { this.reasoningHandlers.delete(handler); } };
  }

  onMeta(handler: MetaCallback): Disposable {
    this.metaHandlers.add(handler);
    return { dispose: () => { this.metaHandlers.delete(handler); } };
  }

  onVisual(handler: VisualCallback): Disposable {
    this.visualHandlers.add(handler);
    return { dispose: () => { this.visualHandlers.delete(handler); } };
  }

  onTokenUpdate(handler: TokenUpdateCallback): Disposable {
    this.tokenHandlers.add(handler);
    return { dispose: () => { this.tokenHandlers.delete(handler); } };
  }

  onTodo(handler: TodoCallback): Disposable {
    this.todoHandlers.add(handler);
    return { dispose: () => { this.todoHandlers.delete(handler); } };
  }

  onIndexing(handler: IndexingCallback): Disposable {
    this.indexingHandlers.add(handler);
    return { dispose: () => { this.indexingHandlers.delete(handler); } };
  }

  onResearch(handler: ResearchCallback): Disposable {
    this.researchHandlers.add(handler);
    return { dispose: () => { this.researchHandlers.delete(handler); } };
  }

  onLoading(handler: LoadingCallback): Disposable {
    this.loadingHandlers.add(handler);
    return { dispose: () => { this.loadingHandlers.delete(handler); } };
  }

  onProcessing(handler: ProcessingCallback): Disposable {
    this.processingHandlers.add(handler);
    return { dispose: () => { this.processingHandlers.delete(handler); } };
  }

  onDiffPreview(handler: DiffPreviewCallback): Disposable {
    this.diffPreviewHandlers.add(handler);
    return { dispose: () => { this.diffPreviewHandlers.delete(handler); } };
  }

  onClarification(handler: ClarificationCallback): Disposable {
    this.clarificationHandlers.add(handler);
    return { dispose: () => { this.clarificationHandlers.delete(handler); } };
  }

  onCompaction(handler: CompactionCallback): Disposable {
    this.compactionHandlers.add(handler);
    return { dispose: () => { this.compactionHandlers.delete(handler); } };
  }

  onWatchEvent(handler: WatchEventCallback): Disposable {
    this.watchEventHandlers.add(handler);
    return { dispose: () => { this.watchEventHandlers.delete(handler); } };
  }

  onBackgroundTask(handler: BackgroundTaskCallback): Disposable {
    this.backgroundTaskHandlers.add(handler);
    return { dispose: () => { this.backgroundTaskHandlers.delete(handler); } };
  }

  onReminder(handler: ReminderCallback): Disposable {
    this.reminderHandlers.add(handler);
    return { dispose: () => { this.reminderHandlers.delete(handler); } };
  }

  getStreamState(): StreamState {
    return { ...this.streamState };
  }

  getReasoningState(): ReasoningState {
    return { ...this.reasoningState };
  }

  getIndexingState(): IndexingState {
    return { ...this.indexingState };
  }

  getResearchState(): ResearchState {
    return { ...this.researchState };
  }

  getActiveToolExecutions(): ToolExecution[] {
    return Array.from(this.toolExecutions.values());
  }

  getActiveSubAgents(): SubAgentState[] {
    return Array.from(this.subAgentStates.values());
  }

  dispose(): void {
    this.flushPendingStream();

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    this.messageHandlers.clear();
    this.streamHandlers.clear();
    this.toolHandlers.clear();
    this.permissionHandlers.clear();
    this.errorHandlers.clear();
    this.planHandlers.clear();
    this.subAgentHandlers.clear();
    this.reasoningHandlers.clear();
    this.metaHandlers.clear();
    this.visualHandlers.clear();
    this.tokenHandlers.clear();
    this.todoHandlers.clear();
    this.indexingHandlers.clear();
    this.researchHandlers.clear();
    this.loadingHandlers.clear();
    this.processingHandlers.clear();
    this.diffPreviewHandlers.clear();
    this.clarificationHandlers.clear();
    this.compactionHandlers.clear();
    this.watchEventHandlers.clear();
    this.backgroundTaskHandlers.clear();
    this.reminderHandlers.clear();

    this.toolExecutions.clear();
    this.subAgentStates.clear();
  }
}
```

- **Acceptance criteria**:
  - Subscribes to `AgentEventBus` via `on(handler)` on construction.
  - All 55+ `EngineEvent` types from `@agentx/shared` are mapped to the correct typed subscription method.
  - `onMessage()` fires for `message_sent` and `message_received` events with `ChatMessage` payloads.
  - `onStream()` fires for `stream_chunk` events, throttled at 16ms (60fps). Pending chunks are flushed on `message_received`.
  - `onToolEvent()` fires for `tool_executing` and `tool_complete` with `ToolExecution` state tracking.
  - `onPermission()` fires for `permission_required` with `PermissionRequest`.
  - `onError()` fires for `error` events with code, message, recoverable, and actions.
  - `onPlanEvent()` fires for all 12 plan-related events.
  - `onSubAgentEvent()` fires for `agent_spawned`, `agent_progress`, `agent_complete`, and `subagent_event`.
  - `onReasoning()` fires for `reasoning_start`, `reasoning_glimpse`, `reasoning_complete` with accumulated state.
  - `onMeta()` fires for ALL events (catch-all for debugging/logging).
  - `onVisual()` is provided for visual update subscriptions.
  - `onTokenUpdate()`, `onTodo()`, `onIndexing()`, `onResearch()`, `onLoading()`, `onProcessing()`, `onDiffPreview()`, `onClarification()`, `onCompaction()`, `onWatchEvent()`, `onBackgroundTask()`, `onReminder()` all work correctly.
  - All `on*()` methods return `Disposable` objects.
  - `dispose()` unsubbes from the event bus and clears all handler sets.

---

## T2.5: Config Bridge

### T2.5.1 — Write `packages/vscode/src/adapter/ConfigBridge.ts`

- **Status**: ⬜
- **Dependencies**: T2.1.1
- **File to create**: `packages/vscode/src/adapter/ConfigBridge.ts`

### T2.5.2 — Implement first-run detection

### T2.5.3 — Implement VS Code ↔ engine config sync

### T2.5.4 — Implement provider/model change handling

- **Action**: Write the full config bridge.

```typescript
import * as vscode from 'vscode';
import { ConfigManager } from '@agentx/engine/config/ConfigManager';
import type { AgentXConfig, ProviderId } from '@agentx/shared';
import type { ConfigState, Disposable } from './types';

const VSCODE_SECTION = 'agentx';

type ConfigChangeHandler = (config: AgentXConfig) => void;
type ProviderChangeHandler = (providerId: ProviderId, modelId: string) => void;
type FirstRunHandler = () => void;

export class ConfigBridge {
  private configManager: ConfigManager;
  private config: AgentXConfig | null = null;
  private configChangeHandlers = new Set<ConfigChangeHandler>();
  private providerChangeHandlers = new Set<ProviderChangeHandler>();
  private firstRunHandlers = new Set<FirstRunHandler>();
  private settingsWatcher: vscode.Disposable | null = null;
  private lastProviderId: ProviderId | null = null;
  private lastModelId: string | null = null;
  private context: vscode.ExtensionContext;
  private firstRunDetected = false;

  constructor(context: vscode.ExtensionContext, configManager?: ConfigManager) {
    this.context = context;
    this.configManager = configManager ?? new ConfigManager();
  }

  initialize(): ConfigState {
    const isConfigured = this.configManager.isConfigured();
    const isSetupComplete = isConfigured ? this.configManager.isSetupComplete() : false;

    if (!isConfigured || !isSetupComplete) {
      this.firstRunDetected = true;
      this.emitFirstRun();
      return {
        isConfigured: false,
        isSetupComplete: false,
        config: null,
        firstRun: true,
      };
    }

    try {
      this.config = this.configManager.load();
      this.lastProviderId = this.config.provider.activeProvider;
      this.lastModelId = this.config.provider.activeModel;
    } catch {
      return {
        isConfigured: true,
        isSetupComplete: false,
        config: null,
        firstRun: false,
      };
    }

    this.syncFromVSCodeSettings();
    this.startSettingsWatcher();

    return {
      isConfigured: true,
      isSetupComplete: true,
      config: this.config,
      firstRun: false,
    };
  }

  getConfig(): AgentXConfig | null {
    return this.config;
  }

  isConfigured(): boolean {
    return this.configManager.isConfigured();
  }

  isSetupComplete(): boolean {
    return this.configManager.isSetupComplete();
  }

  isFirstRun(): boolean {
    return this.firstRunDetected;
  }

  reload(): AgentXConfig | null {
    try {
      this.config = this.configManager.reload();
      this.detectProviderModelChange();
      this.emitConfigChange();
      return this.config;
    } catch {
      return this.config;
    }
  }

  getActiveProvider(): ProviderId | null {
    return this.config?.provider.activeProvider ?? null;
  }

  getActiveModel(): string | null {
    return this.config?.provider.activeModel ?? null;
  }

  getProviderApiKey(providerId: ProviderId): string | undefined {
    if (!this.config) return undefined;
    const creds = this.config.provider.providers[providerId];
    if (!creds) return undefined;

    if (creds.activeProfile && creds.profiles) {
      return creds.profiles[creds.activeProfile]?.apiKey;
    }
    return creds.apiKey;
  }

  getProviderBaseUrl(providerId: ProviderId): string | undefined {
    if (!this.config) return undefined;
    const creds = this.config.provider.providers[providerId];
    if (!creds) return undefined;

    if (creds.activeProfile && creds.profiles) {
      return creds.profiles[creds.activeProfile]?.baseUrl;
    }
    return creds.baseUrl;
  }

  isToolDisabled(toolId: string): boolean {
    return this.config?.ui.disabledTools?.includes(toolId) ?? false;
  }

  getDisabledTools(): string[] {
    return this.config?.ui.disabledTools ?? [];
  }

  onConfigChange(handler: ConfigChangeHandler): Disposable {
    this.configChangeHandlers.add(handler);
    return { dispose: () => { this.configChangeHandlers.delete(handler); } };
  }

  onProviderChange(handler: ProviderChangeHandler): Disposable {
    this.providerChangeHandlers.add(handler);
    return { dispose: () => { this.providerChangeHandlers.delete(handler); } };
  }

  onFirstRun(handler: FirstRunHandler): Disposable {
    this.firstRunHandlers.add(handler);
    return { dispose: () => { this.firstRunHandlers.delete(handler); } };
  }

  private syncFromVSCodeSettings(): void {
    if (!this.config) return;

    const vsConfig = vscode.workspace.getConfiguration(VSCODE_SECTION);

    const provider = vsConfig.get<string>('provider');
    if (provider && provider !== this.config.provider.activeProvider) {
      this.config.provider.activeProvider = provider as ProviderId;
    }

    const model = vsConfig.get<string>('model');
    if (model && model !== this.config.provider.activeModel) {
      this.config.provider.activeModel = model;
    }

    const theme = vsConfig.get<'dark' | 'light'>('theme');
    if (theme) {
      this.config.ui.theme = theme;
    }

    const showTokenBar = vsConfig.get<boolean>('showTokenBar');
    if (typeof showTokenBar === 'boolean') {
      this.config.ui.showTokenBar = showTokenBar;
    }

    const showTimers = vsConfig.get<boolean>('showTimers');
    if (typeof showTimers === 'boolean') {
      this.config.ui.showTimers = showTimers;
    }

    const animationSpeed = vsConfig.get<'normal' | 'fast' | 'reduced'>('animationSpeed');
    if (animationSpeed) {
      this.config.ui.animationSpeed = animationSpeed;
    }

    const disabledTools = vsConfig.get<string[]>('disabledTools');
    if (Array.isArray(disabledTools)) {
      this.config.ui.disabledTools = disabledTools;
    }

    this.detectProviderModelChange();
  }

  private startSettingsWatcher(): void {
    this.settingsWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(VSCODE_SECTION)) {
        this.syncFromVSCodeSettings();
        this.emitConfigChange();
      }
    });

    this.context.subscriptions.push(this.settingsWatcher);
  }

  private detectProviderModelChange(): void {
    if (!this.config) return;

    const newProvider = this.config.provider.activeProvider;
    const newModel = this.config.provider.activeModel;

    if (
      this.lastProviderId !== null &&
      (this.lastProviderId !== newProvider || this.lastModelId !== newModel)
    ) {
      for (const handler of this.providerChangeHandlers) {
        try {
          handler(newProvider, newModel);
        } catch {
          // Swallow handler errors
        }
      }
    }

    this.lastProviderId = newProvider;
    this.lastModelId = newModel;
  }

  private emitConfigChange(): void {
    if (!this.config) return;
    for (const handler of this.configChangeHandlers) {
      try {
        handler(this.config);
      } catch {
        // Swallow handler errors
      }
    }
  }

  private emitFirstRun(): void {
    for (const handler of this.firstRunHandlers) {
      try {
        handler();
      } catch {
        // Swallow handler errors
      }
    }
  }

  getState(): ConfigState {
    return {
      isConfigured: this.configManager.isConfigured(),
      isSetupComplete: this.configManager.isSetupComplete(),
      config: this.config,
      firstRun: this.firstRunDetected,
    };
  }

  dispose(): void {
    if (this.settingsWatcher) {
      this.settingsWatcher.dispose();
      this.settingsWatcher = null;
    }

    this.configChangeHandlers.clear();
    this.providerChangeHandlers.clear();
    this.firstRunHandlers.clear();
  }
}
```

- **Acceptance criteria**:
  - `initialize()` reads `~/.config/agentx/config.json` via `ConfigManager`.
  - First-run is detected when `isConfigured()` or `isSetupComplete()` returns `false`.
  - VS Code settings under `agentx.*` are synced into the engine config on initialization and on change.
  - Provider/model changes are detected and emitted via `onProviderChange()`.
  - `reload()` re-reads config from disk and emits changes.
  - `getProviderApiKey()` and `getProviderBaseUrl()` support both legacy and multi-profile credential formats.
  - `dispose()` cleans up the settings watcher and handler sets.

---

## T2.6: VS Code Storage Adapter

### T2.6.1 — Write `packages/vscode/src/adapter/VSCodeStorageAdapter.ts`

- **Status**: ⬜
- **Dependencies**: T2.1.1
- **File to create**: `packages/vscode/src/adapter/VSCodeStorageAdapter.ts`

### T2.6.2 — Implement all CRUD methods for sessions

### T2.6.3 — Implement message persistence

### T2.6.4 — Implement token log and permission persistence

- **Action**: Write the full storage adapter implementing `StorageAdapter` from `@agentx/shared`, backed by JSON files in VS Code's `globalStorageUri`.

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  StorageAdapter,
  StorableSession,
  StorableMessage,
  StorableTokenLog,
  StorablePermission,
  RecordMeta,
} from '@agentx/shared';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

interface SessionsFile {
  sessions: StorableSession[];
}

interface MessagesFile {
  messages: StorableMessage[];
}

interface TokenLogsFile {
  logs: StorableTokenLog[];
}

interface PermissionsFile {
  permissions: StorablePermission[];
}

export class VSCodeStorageAdapter implements StorageAdapter {
  private storageDir: string;
  private connected = false;

  private sessionsPath: string;
  private messagesPath: string;
  private tokenLogsPath: string;
  private permissionsPath: string;

  constructor(globalStoragePath: string) {
    this.storageDir = path.join(globalStoragePath, 'agentx-data');
    this.sessionsPath = path.join(this.storageDir, 'sessions.json');
    this.messagesPath = path.join(this.storageDir, 'messages.json');
    this.tokenLogsPath = path.join(this.storageDir, 'token-logs.json');
    this.permissionsPath = path.join(this.storageDir, 'permissions.json');
  }

  connect(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    if (!fs.existsSync(this.sessionsPath)) {
      this.writeJSON(this.sessionsPath, { sessions: [] });
    }
    if (!fs.existsSync(this.messagesPath)) {
      this.writeJSON(this.messagesPath, { messages: [] });
    }
    if (!fs.existsSync(this.tokenLogsPath)) {
      this.writeJSON(this.tokenLogsPath, { logs: [] });
    }
    if (!fs.existsSync(this.permissionsPath)) {
      this.writeJSON(this.permissionsPath, { permissions: [] });
    }

    this.connected = true;
  }

  disconnect(): void {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ─── Sessions ───

  createSession(input: Omit<StorableSession, keyof RecordMeta>): StorableSession {
    const data = this.readSessions();
    const session: StorableSession = {
      id: generateId(),
      createdAt: nowISO(),
      updatedAt: nowISO(),
      ...input,
    };
    data.sessions.push(session);
    this.writeSessions(data);
    return session;
  }

  getSession(id: string): StorableSession | null {
    const data = this.readSessions();
    return data.sessions.find((s) => s.id === id) ?? null;
  }

  updateSession(id: string, updates: Partial<StorableSession>): void {
    const data = this.readSessions();
    const idx = data.sessions.findIndex((s) => s.id === id);
    if (idx === -1) return;
    data.sessions[idx] = {
      ...data.sessions[idx],
      ...updates,
      id: data.sessions[idx].id,
      createdAt: data.sessions[idx].createdAt,
      updatedAt: nowISO(),
    };
    this.writeSessions(data);
  }

  deleteSession(id: string): void {
    const data = this.readSessions();
    data.sessions = data.sessions.filter((s) => s.id !== id);
    this.writeSessions(data);

    this.deleteMessages(id);
  }

  listSessions(limit?: number): StorableSession[] {
    const data = this.readSessions();
    const sorted = data.sessions.sort(
      (a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime(),
    );
    return limit ? sorted.slice(0, limit) : sorted;
  }

  // ─── Messages ───

  addMessage(sessionId: string, message: Omit<StorableMessage, 'id' | 'createdAt'>): StorableMessage {
    const data = this.readMessages();
    const record: StorableMessage = {
      id: generateId(),
      createdAt: nowISO(),
      sessionId,
      ...message,
    };
    data.messages.push(record);
    this.writeMessages(data);
    return record;
  }

  getMessages(sessionId: string): StorableMessage[] {
    const data = this.readMessages();
    return data.messages
      .filter((m) => m.sessionId === sessionId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  deleteMessages(sessionId: string): void {
    const data = this.readMessages();
    data.messages = data.messages.filter((m) => m.sessionId !== sessionId);
    this.writeMessages(data);
  }

  getMessageCount(sessionId: string): number {
    const data = this.readMessages();
    return data.messages.filter((m) => m.sessionId === sessionId).length;
  }

  // ─── Token Logs ───

  addTokenLog(sessionId: string, log: Omit<StorableTokenLog, 'id' | 'createdAt'>): void {
    const data = this.readTokenLogs();
    const record: StorableTokenLog = {
      id: generateId(),
      createdAt: nowISO(),
      sessionId,
      ...log,
    };
    data.logs.push(record);
    this.writeTokenLogs(data);
  }

  getTokenLogs(sessionId: string): StorableTokenLog[] {
    const data = this.readTokenLogs();
    return data.logs
      .filter((l) => l.sessionId === sessionId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  // ─── Permissions ───

  addPermission(sessionId: string, perm: Omit<StorablePermission, 'id' | 'createdAt'>): void {
    const data = this.readPermissions();
    const record: StorablePermission = {
      id: generateId(),
      createdAt: nowISO(),
      sessionId,
      ...perm,
    };
    data.permissions.push(record);
    this.writePermissions(data);
  }

  getPermissions(sessionId: string): StorablePermission[] {
    const data = this.readPermissions();
    return data.permissions
      .filter((p) => p.sessionId === sessionId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  // ─── Bulk Operations ───

  clearAll(): void {
    this.writeSessions({ sessions: [] });
    this.writeMessages({ messages: [] });
    this.writeTokenLogs({ logs: [] });
    this.writePermissions({ permissions: [] });
  }

  close(): void {
    this.disconnect();
  }

  // ─── Private I/O ───

  private readJSON<T>(filePath: string): T {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    } catch {
      return {} as T;
    }
  }

  private writeJSON(filePath: string, data: unknown): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private readSessions(): SessionsFile {
    const data = this.readJSON<SessionsFile>(this.sessionsPath);
    if (!data.sessions) data.sessions = [];
    return data;
  }

  private writeSessions(data: SessionsFile): void {
    this.writeJSON(this.sessionsPath, data);
  }

  private readMessages(): MessagesFile {
    const data = this.readJSON<MessagesFile>(this.messagesPath);
    if (!data.messages) data.messages = [];
    return data;
  }

  private writeMessages(data: MessagesFile): void {
    this.writeJSON(this.messagesPath, data);
  }

  private readTokenLogs(): TokenLogsFile {
    const data = this.readJSON<TokenLogsFile>(this.tokenLogsPath);
    if (!data.logs) data.logs = [];
    return data;
  }

  private writeTokenLogs(data: TokenLogsFile): void {
    this.writeJSON(this.tokenLogsPath, data);
  }

  private readPermissions(): PermissionsFile {
    const data = this.readJSON<PermissionsFile>(this.permissionsPath);
    if (!data.permissions) data.permissions = [];
    return data;
  }

  private writePermissions(data: PermissionsFile): void {
    this.writeJSON(this.permissionsPath, data);
  }
}
```

- **Acceptance criteria**:
  - Implements all methods of the `StorageAdapter` interface from `@agentx/shared`.
  - Uses JSON files stored under `context.globalStorageUri.fsPath/agentx-data/`.
  - `connect()` creates the storage directory and initializes empty JSON files if they don't exist.
  - `createSession()` generates a unique ID and timestamps.
  - `getSession()`, `updateSession()`, `deleteSession()`, `listSessions()` all work correctly.
  - `deleteSession()` cascades to delete associated messages.
  - `addMessage()`, `getMessages()`, `deleteMessages()`, `getMessageCount()` all work correctly.
  - `addTokenLog()` and `getTokenLogs()` work correctly.
  - `addPermission()` and `getPermissions()` work correctly.
  - `clearAll()` resets all data files.
  - `close()` calls `disconnect()`.
  - All reads are tolerant of corrupted/missing files (return empty collections).
  - No dependency on `better-sqlite3` — pure JSON file storage.

---

## T2.8: Verification

### T2.8.1 — Unit tests for VSCodeEngine

- **Status**: ⬜
- **Dependencies**: T2.1.2
- **File to create**: `packages/vscode/test/adapter/VSCodeEngine.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VSCodeEngine } from '../../src/adapter/VSCodeEngine';

vi.mock('@agentx/engine/agent/Agent', () => {
  return {
    Agent: vi.fn().mockImplementation(() => ({
      events: { on: vi.fn().mockReturnValue(vi.fn()), emit: vi.fn() },
      tokens: { tokensUsed: 0, tokensTotal: 128000, percentage: 0, totalCost: 0, inputTokenCount: 0, outputTokenCount: 0 },
      processing: false,
      toolCount: 165,
      watcherCount: 0,
      schedulerCount: 0,
      planModeEnabled: false,
      cancel: vi.fn(),
      endSession: vi.fn(),
      sendMessage: vi.fn(),
      getToolExecutor: vi.fn(),
    })),
  };
});

vi.mock('@agentx/engine/config/ConfigManager', () => {
  return {
    ConfigManager: vi.fn().mockImplementation(() => ({
      load: vi.fn().mockReturnValue({
        provider: { activeProvider: 'openai', activeModel: 'gpt-4o', providers: {} },
        ui: { theme: 'dark', showTokenBar: true, showTimers: true, animationSpeed: 'normal' },
        organization: null,
        telemetry: false,
        setupComplete: true,
      }),
      isConfigured: vi.fn().mockReturnValue(true),
      isSetupComplete: vi.fn().mockReturnValue(true),
      reload: vi.fn(),
    })),
  };
});

vi.mock('../../src/adapter/VSCodeToolkitFactory', () => {
  const mockRegistry = { list: vi.fn().mockReturnValue([]) };
  const mockExecutor = {};
  return {
    createVSCodeToolkit: vi.fn().mockReturnValue({
      registry: mockRegistry,
      executor: mockExecutor,
      factoryExecutor: {},
    }),
  };
});

vi.mock('@agentx/shared', async () => {
  const actual = await vi.importActual<typeof import('@agentx/shared')>('@agentx/shared');
  return {
    ...actual,
    generateSessionId: vi.fn().mockReturnValue('test-session-id'),
  };
});

const mockContext = {
  subscriptions: [],
  globalStorageUri: { fsPath: '/tmp/test-storage' },
  extensionUri: { fsPath: '/tmp/test-ext' },
} as unknown as import('vscode').ExtensionContext;

describe('VSCodeEngine', () => {
  let engine: VSCodeEngine;

  beforeEach(() => {
    engine = new VSCodeEngine('/workspace/project', mockContext);
  });

  afterEach(async () => {
    if (!engine.isDisposed()) {
      await engine.dispose();
    }
  });

  it('starts in uninitialized state', () => {
    expect(engine.isInitialized()).toBe(false);
    expect(engine.getAgent()).toBeNull();
    expect(engine.getStatus()).toBe('uninitialized');
  });

  it('initializes successfully', async () => {
    await engine.initialize();
    expect(engine.isInitialized()).toBe(true);
    expect(engine.getAgent()).not.toBeNull();
    expect(engine.getStatus()).toBe('ready');
    expect(engine.getSessionId()).toBe('test-session-id');
  });

  it('de-duplicates concurrent initialize calls', async () => {
    const p1 = engine.initialize();
    const p2 = engine.initialize();
    await Promise.all([p1, p2]);
    expect(engine.isInitialized()).toBe(true);
  });

  it('returns correct state after initialization', async () => {
    await engine.initialize();
    const state = engine.getState();
    expect(state.status).toBe('ready');
    expect(state.workspaceRoot).toBe('/workspace/project');
    expect(state.sessionId).toBe('test-session-id');
    expect(state.providerId).toBe('openai');
    expect(state.modelId).toBe('gpt-4o');
    expect(state.toolCount).toBe(165);
  });

  it('disposes cleanly', async () => {
    await engine.initialize();
    await engine.dispose();
    expect(engine.isDisposed()).toBe(true);
    expect(engine.getStatus()).toBe('disposed');
    expect(engine.getAgent()).toBeNull();
  });

  it('throws on initialize after dispose', async () => {
    await engine.dispose();
    await expect(engine.initialize()).rejects.toThrow('disposed');
  });

  it('restarts with new workspace root', async () => {
    await engine.initialize();
    await engine.restart('/workspace/other');
    expect(engine.isInitialized()).toBe(true);
    expect(engine.getWorkspaceRoot()).toBe('/workspace/other');
  });

  it('resetProcessingState calls cancel on agent', async () => {
    await engine.initialize();
    const agent = engine.getAgent()!;
    Object.defineProperty(agent, 'processing', { value: true, writable: true });
    engine.resetProcessingState();
    expect(agent.cancel).toHaveBeenCalled();
  });
});
```

- **Acceptance criteria**:
  - All tests pass.
  - Agent, ConfigManager, and ToolkitFactory are mocked.
  - Tests cover: uninitialized state, initialization, de-duplication, state correctness, disposal, post-dispose errors, restart, and processing reset.

### T2.8.2 — Unit tests for EventBridge

- **Status**: ⬜
- **Dependencies**: T2.4.1
- **File to create**: `packages/vscode/test/adapter/EventBridge.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBridge } from '../../src/adapter/EventBridge';
import type { AgentEventBus } from '@agentx/engine/EventBus';
import type { EngineEvent, EventHandler } from '@agentx/shared';

function createMockEventBus(): { bus: AgentEventBus; emit: (event: EngineEvent) => void } {
  let handler: EventHandler | null = null;
  const bus: AgentEventBus = {
    emit: (event: EngineEvent) => {
      if (handler) handler(event);
    },
    on: (h: EventHandler) => {
      handler = h;
      return () => { handler = null; };
    },
    off: () => { handler = null; },
  };
  return {
    bus,
    emit: (event: EngineEvent) => bus.emit(event),
  };
}

describe('EventBridge', () => {
  let mockBus: ReturnType<typeof createMockEventBus>;
  let bridge: EventBridge;

  beforeEach(() => {
    mockBus = createMockEventBus();
    bridge = new EventBridge(mockBus.bus, 0);
  });

  afterEach(() => {
    bridge.dispose();
  });

  it('emits message events on onMessage', () => {
    const handler = vi.fn();
    bridge.onMessage(handler);

    mockBus.emit({
      type: 'message_received',
      message: {
        id: 'msg-1',
        sessionId: 'sess-1',
        role: 'assistant',
        content: 'Hello!',
        toolCalls: null,
        tokenCount: 10,
        createdAt: new Date().toISOString(),
      },
      elapsed: 500,
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].content).toBe('Hello!');
    expect(handler.mock.calls[0][0].role).toBe('assistant');
  });

  it('emits stream chunks on onStream', () => {
    const handler = vi.fn();
    bridge.onStream(handler);

    mockBus.emit({ type: 'stream_chunk', content: 'Hel', fullContent: 'Hel' });
    mockBus.emit({ type: 'stream_chunk', content: 'lo', fullContent: 'Hello' });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[1][0].fullContent).toBe('Hello');
  });

  it('emits tool events on onToolEvent', () => {
    const handler = vi.fn();
    bridge.onToolEvent(handler);

    mockBus.emit({ type: 'tool_executing', tool: 'file_read', description: 'Reading file', startTime: Date.now() });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].toolName).toBe('file_read');
    expect(handler.mock.calls[0][0].status).toBe('executing');
  });

  it('emits permission events on onPermission', () => {
    const handler = vi.fn();
    bridge.onPermission(handler);

    mockBus.emit({ type: 'permission_required', tool: 'shell_exec', path: '/tmp', riskLevel: 'high' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].tool).toBe('shell_exec');
    expect(handler.mock.calls[0][0].riskLevel).toBe('high');
  });

  it('emits error events on onError', () => {
    const handler = vi.fn();
    bridge.onError(handler);

    mockBus.emit({
      type: 'error',
      code: 'AUTH_FAILED',
      message: 'Invalid API key',
      recoverable: true,
      actions: [{ type: 'reconfigure_key', label: 'Fix Key' }],
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].code).toBe('AUTH_FAILED');
    expect(handler.mock.calls[0][0].actions).toHaveLength(1);
  });

  it('emits plan events on onPlanEvent', () => {
    const handler = vi.fn();
    bridge.onPlanEvent(handler);

    mockBus.emit({ type: 'plan_mode_entered' });
    mockBus.emit({ type: 'plan_mode_exited' });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('emits reasoning events with accumulated glimpses', () => {
    const handler = vi.fn();
    bridge.onReasoning(handler);

    mockBus.emit({ type: 'reasoning_start' });
    mockBus.emit({ type: 'reasoning_glimpse', text: 'thinking step 1' });
    mockBus.emit({ type: 'reasoning_glimpse', text: 'thinking step 2' });
    mockBus.emit({ type: 'reasoning_complete' });

    expect(handler).toHaveBeenCalledTimes(4);
    expect(handler.mock.calls[2][0].glimpses).toEqual(['thinking step 1', 'thinking step 2']);
    expect(handler.mock.calls[3][0].isActive).toBe(false);
  });

  it('emits all events on onMeta', () => {
    const handler = vi.fn();
    bridge.onMeta(handler);

    mockBus.emit({ type: 'loading_start', stage: 'init' });
    mockBus.emit({ type: 'loading_end' });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('disposable removes handler', () => {
    const handler = vi.fn();
    const disposable = bridge.onMessage(handler);

    mockBus.emit({
      type: 'message_received',
      message: {
        id: 'msg-1',
        sessionId: 'sess-1',
        role: 'assistant',
        content: 'First',
        toolCalls: null,
        tokenCount: 5,
        createdAt: new Date().toISOString(),
      },
      elapsed: 100,
    });

    disposable.dispose();

    mockBus.emit({
      type: 'message_received',
      message: {
        id: 'msg-2',
        sessionId: 'sess-1',
        role: 'assistant',
        content: 'Second',
        toolCalls: null,
        tokenCount: 5,
        createdAt: new Date().toISOString(),
      },
      elapsed: 100,
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('tracks indexing state', () => {
    const handler = vi.fn();
    bridge.onIndexing(handler);

    mockBus.emit({ type: 'indexing_start', totalFiles: 100 });
    mockBus.emit({ type: 'indexing_progress', indexed: 50, total: 100, currentFile: 'src/foo.ts' });
    mockBus.emit({ type: 'indexing_complete', indexed: 100, total: 100, chunks: 500 });

    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler.mock.calls[0][0].isActive).toBe(true);
    expect(handler.mock.calls[1][0].indexed).toBe(50);
    expect(handler.mock.calls[2][0].isActive).toBe(false);
    expect(handler.mock.calls[2][0].chunks).toBe(500);
  });

  it('tracks research state', () => {
    const handler = vi.fn();
    bridge.onResearch(handler);

    mockBus.emit({ type: 'research_start', question: 'What is X?' });
    mockBus.emit({ type: 'research_query', queryId: 'q1', question: 'Sub-question', sources: 'web' });
    mockBus.emit({
      type: 'research_subagent_complete',
      queryId: 'q1',
      result: { queryId: 'q1', question: 'Sub-question', answer: 'Answer', sources: ['url1'], elapsed: 1000 },
    });
    mockBus.emit({ type: 'research_synthesis', resultCount: 1 });
    mockBus.emit({ type: 'research_complete', report: 'Final report' });

    expect(handler).toHaveBeenCalledTimes(5);
    expect(handler.mock.calls[4][0].isActive).toBe(false);
    expect(handler.mock.calls[4][0].report).toBe('Final report');
  });

  it('dispose unsubscribes from event bus', () => {
    const handler = vi.fn();
    bridge.onMessage(handler);
    bridge.dispose();

    mockBus.emit({
      type: 'message_received',
      message: {
        id: 'msg-1',
        sessionId: 'sess-1',
        role: 'assistant',
        content: 'After dispose',
        toolCalls: null,
        tokenCount: 5,
        createdAt: new Date().toISOString(),
      },
      elapsed: 100,
    });

    expect(handler).not.toHaveBeenCalled();
  });
});
```

- **Acceptance criteria**:
  - All tests pass.
  - Tests cover: message, stream, tool, permission, error, plan, reasoning, meta, indexing, research events.
  - Disposable removal is tested.
  - Dispose unsubscribes from the bus.

### T2.8.3 — Unit tests for ConfigBridge

- **Status**: ⬜
- **Dependencies**: T2.5.1
- **File to create**: `packages/vscode/test/adapter/ConfigBridge.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigBridge } from '../../src/adapter/ConfigBridge';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(undefined),
    }),
    onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  },
}));

const mockConfigManager = {
  isConfigured: vi.fn().mockReturnValue(true),
  isSetupComplete: vi.fn().mockReturnValue(true),
  load: vi.fn().mockReturnValue({
    provider: {
      activeProvider: 'anthropic',
      activeModel: 'claude-sonnet-4-20250514',
      providers: {
        anthropic: {
          apiKey: 'sk-ant-test',
          configured: true,
          activeProfile: 'default',
          profiles: { default: { label: 'Default', apiKey: 'sk-ant-test' } },
        },
      },
    },
    ui: { theme: 'dark', showTokenBar: true, showTimers: true, animationSpeed: 'normal' },
    organization: null,
    telemetry: false,
    setupComplete: true,
  }),
  reload: vi.fn().mockReturnValue({
    provider: {
      activeProvider: 'openai',
      activeModel: 'gpt-4o',
      providers: {},
    },
    ui: { theme: 'dark', showTokenBar: true, showTimers: true, animationSpeed: 'normal' },
    organization: null,
    telemetry: false,
    setupComplete: true,
  }),
};

const mockContext = {
  subscriptions: [],
} as unknown as import('vscode').ExtensionContext;

describe('ConfigBridge', () => {
  let bridge: ConfigBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    bridge = new ConfigBridge(mockContext, mockConfigManager as any);
  });

  it('detects configured and setup complete state', () => {
    const state = bridge.initialize();
    expect(state.isConfigured).toBe(true);
    expect(state.isSetupComplete).toBe(true);
    expect(state.firstRun).toBe(false);
    expect(state.config).not.toBeNull();
  });

  it('detects first run when not configured', () => {
    mockConfigManager.isConfigured.mockReturnValueOnce(false);
    const firstRunHandler = vi.fn();
    bridge.onFirstRun(firstRunHandler);
    const state = bridge.initialize();
    expect(state.firstRun).toBe(true);
    expect(firstRunHandler).toHaveBeenCalledTimes(1);
  });

  it('returns active provider and model', () => {
    bridge.initialize();
    expect(bridge.getActiveProvider()).toBe('anthropic');
    expect(bridge.getActiveModel()).toBe('claude-sonnet-4-20250514');
  });

  it('retrieves provider API key from profiles', () => {
    bridge.initialize();
    expect(bridge.getProviderApiKey('anthropic')).toBe('sk-ant-test');
  });

  it('detects provider/model changes on reload', () => {
    bridge.initialize();
    const handler = vi.fn();
    bridge.onProviderChange(handler);
    bridge.reload();
    expect(handler).toHaveBeenCalledWith('openai', 'gpt-4o');
  });

  it('emits config change on reload', () => {
    bridge.initialize();
    const handler = vi.fn();
    bridge.onConfigChange(handler);
    bridge.reload();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('dispose cleans up handlers', () => {
    bridge.initialize();
    const handler = vi.fn();
    const disposable = bridge.onConfigChange(handler);
    disposable.dispose();
    bridge.reload();
    expect(handler).not.toHaveBeenCalled();
  });
});
```

- **Acceptance criteria**:
  - All tests pass.
  - Tests cover: initialization, first-run detection, provider/model access, reload with change detection, disposable cleanup.

### T2.8.4 — Unit tests for VSCodeStorageAdapter

- **Status**: ⬜
- **Dependencies**: T2.6.1
- **File to create**: `packages/vscode/test/adapter/VSCodeStorageAdapter.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VSCodeStorageAdapter } from '../../src/adapter/VSCodeStorageAdapter';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('VSCodeStorageAdapter', () => {
  let tmpDir: string;
  let adapter: VSCodeStorageAdapter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentx-test-'));
    adapter = new VSCodeStorageAdapter(tmpDir);
    adapter.connect();
  });

  afterEach(() => {
    adapter.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('connects and creates storage directory', () => {
    expect(adapter.isConnected()).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'agentx-data'))).toBe(true);
  });

  it('creates and retrieves sessions', () => {
    const session = adapter.createSession({
      title: 'Test Session',
      status: 'active',
      providerId: 'openai',
      modelId: 'gpt-4o',
      crewId: null,
      scopePath: '/workspace',
      tokenUsed: 0,
      tokenAvailable: 128000,
    });

    expect(session.id).toBeTruthy();
    expect(session.title).toBe('Test Session');
    expect(session.createdAt).toBeTruthy();

    const retrieved = adapter.getSession(session.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.title).toBe('Test Session');
  });

  it('updates sessions', () => {
    const session = adapter.createSession({
      title: 'Original',
      status: 'active',
      providerId: 'openai',
      modelId: 'gpt-4o',
      crewId: null,
      scopePath: '/workspace',
      tokenUsed: 0,
      tokenAvailable: 128000,
    });

    adapter.updateSession(session.id, { title: 'Updated', tokenUsed: 500 });

    const updated = adapter.getSession(session.id);
    expect(updated!.title).toBe('Updated');
    expect(updated!.tokenUsed).toBe(500);
    expect(updated!.id).toBe(session.id);
  });

  it('deletes sessions and cascades to messages', () => {
    const session = adapter.createSession({
      title: 'ToDelete',
      status: 'active',
      providerId: 'openai',
      modelId: 'gpt-4o',
      crewId: null,
      scopePath: '/workspace',
      tokenUsed: 0,
      tokenAvailable: 128000,
    });

    adapter.addMessage(session.id, {
      sessionId: session.id,
      role: 'user',
      content: 'Hello',
      tokenCount: 5,
    });

    adapter.deleteSession(session.id);

    expect(adapter.getSession(session.id)).toBeNull();
    expect(adapter.getMessages(session.id)).toHaveLength(0);
  });

  it('lists sessions sorted by updatedAt descending', () => {
    adapter.createSession({
      title: 'First',
      status: 'active',
      providerId: 'openai',
      modelId: 'gpt-4o',
      crewId: null,
      scopePath: '/workspace',
      tokenUsed: 0,
      tokenAvailable: 128000,
    });

    adapter.createSession({
      title: 'Second',
      status: 'active',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-20250514',
      crewId: null,
      scopePath: '/workspace',
      tokenUsed: 0,
      tokenAvailable: 200000,
    });

    const sessions = adapter.listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions[0].title).toBe('Second');
  });

  it('adds and retrieves messages', () => {
    const session = adapter.createSession({
      title: 'MsgTest',
      status: 'active',
      providerId: 'openai',
      modelId: 'gpt-4o',
      crewId: null,
      scopePath: '/workspace',
      tokenUsed: 0,
      tokenAvailable: 128000,
    });

    adapter.addMessage(session.id, {
      sessionId: session.id,
      role: 'user',
      content: 'Hello',
      tokenCount: 5,
    });

    adapter.addMessage(session.id, {
      sessionId: session.id,
      role: 'assistant',
      content: 'Hi there!',
      tokenCount: 10,
    });

    const messages = adapter.getMessages(session.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(adapter.getMessageCount(session.id)).toBe(2);
  });

  it('adds and retrieves token logs', () => {
    const session = adapter.createSession({
      title: 'TokenTest',
      status: 'active',
      providerId: 'openai',
      modelId: 'gpt-4o',
      crewId: null,
      scopePath: '/workspace',
      tokenUsed: 0,
      tokenAvailable: 128000,
    });

    adapter.addTokenLog(session.id, {
      sessionId: session.id,
      inputTokens: 100,
      outputTokens: 50,
      model: 'gpt-4o',
    });

    const logs = adapter.getTokenLogs(session.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].inputTokens).toBe(100);
  });

  it('adds and retrieves permissions', () => {
    const session = adapter.createSession({
      title: 'PermTest',
      status: 'active',
      providerId: 'openai',
      modelId: 'gpt-4o',
      crewId: null,
      scopePath: '/workspace',
      tokenUsed: 0,
      tokenAvailable: 128000,
    });

    adapter.addPermission(session.id, {
      sessionId: session.id,
      toolName: 'shell_exec',
      targetPath: '/tmp',
      decision: 'allow_once',
    });

    const perms = adapter.getPermissions(session.id);
    expect(perms).toHaveLength(1);
    expect(perms[0].toolName).toBe('shell_exec');
  });

  it('clearAll resets all data', () => {
    adapter.createSession({
      title: 'ClearTest',
      status: 'active',
      providerId: 'openai',
      modelId: 'gpt-4o',
      crewId: null,
      scopePath: '/workspace',
      tokenUsed: 0,
      tokenAvailable: 128000,
    });

    adapter.clearAll();

    expect(adapter.listSessions()).toHaveLength(0);
  });

  it('handles corrupted JSON gracefully', () => {
    const sessionsPath = path.join(tmpDir, 'agentx-data', 'sessions.json');
    fs.writeFileSync(sessionsPath, 'NOT VALID JSON', 'utf-8');

    expect(adapter.listSessions()).toHaveLength(0);
  });
});
```

- **Acceptance criteria**:
  - All tests pass.
  - Tests cover: connect, session CRUD, message CRUD, token logs, permissions, cascading delete, sort order, clearAll, corrupted JSON tolerance.

### T2.8.5 — Integration test: create engine → send message → receive response

- **Status**: ⬜
- **Dependencies**: T2.1.2, T2.4.1
- **File to create**: `packages/vscode/test/adapter/integration.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VSCodeEngine } from '../../src/adapter/VSCodeEngine';
import { EventBridge } from '../../src/adapter/EventBridge';

let capturedEmit: ((event: any) => void) | null = null;

vi.mock('@agentx/engine/agent/Agent', () => {
  return {
    Agent: vi.fn().mockImplementation(() => {
      const handlers = new Set<(event: any) => void>();
      const eventBus = {
        emit: (event: any) => {
          for (const h of handlers) h(event);
        },
        on: (h: (event: any) => void) => {
          handlers.add(h);
          capturedEmit = (event: any) => {
            for (const handler of handlers) handler(event);
          };
          return () => { handlers.delete(h); };
        },
        off: (h: (event: any) => void) => { handlers.delete(h); },
      };

      return {
        events: eventBus,
        tokens: {
          tokensUsed: 0,
          tokensTotal: 128000,
          percentage: 0,
          totalCost: 0,
          inputTokenCount: 0,
          outputTokenCount: 0,
        },
        processing: false,
        toolCount: 165,
        watcherCount: 0,
        schedulerCount: 0,
        planModeEnabled: false,
        cancel: vi.fn(),
        endSession: vi.fn(),
        sendMessage: vi.fn().mockImplementation(async (content: string) => {
          eventBus.emit({
            type: 'message_sent',
            message: {
              id: 'msg-sent-1',
              sessionId: 'test-session',
              role: 'user',
              content,
              toolCalls: null,
              tokenCount: 10,
              createdAt: new Date().toISOString(),
            },
          });

          eventBus.emit({ type: 'stream_chunk', content: 'Hel', fullContent: 'Hel' });
          eventBus.emit({ type: 'stream_chunk', content: 'lo!', fullContent: 'Hello!' });

          const response = {
            id: 'msg-recv-1',
            sessionId: 'test-session',
            role: 'assistant',
            content: 'Hello!',
            toolCalls: null,
            tokenCount: 15,
            createdAt: new Date().toISOString(),
          };

          eventBus.emit({ type: 'message_received', message: response, elapsed: 250 });

          return response;
        }),
        getToolExecutor: vi.fn(),
      };
    }),
  };
});

vi.mock('@agentx/engine/config/ConfigManager', () => {
  return {
    ConfigManager: vi.fn().mockImplementation(() => ({
      load: vi.fn().mockReturnValue({
        provider: { activeProvider: 'openai', activeModel: 'gpt-4o', providers: {} },
        ui: { theme: 'dark', showTokenBar: true, showTimers: true, animationSpeed: 'normal' },
        organization: null,
        telemetry: false,
        setupComplete: true,
      }),
      isConfigured: vi.fn().mockReturnValue(true),
      isSetupComplete: vi.fn().mockReturnValue(true),
      reload: vi.fn(),
    })),
  };
});

vi.mock('../../src/adapter/VSCodeToolkitFactory', () => {
  return {
    createVSCodeToolkit: vi.fn().mockReturnValue({
      registry: { list: vi.fn().mockReturnValue([]) },
      executor: {},
      factoryExecutor: {},
    }),
  };
});

vi.mock('@agentx/shared', async () => {
  const actual = await vi.importActual<typeof import('@agentx/shared')>('@agentx/shared');
  return {
    ...actual,
    generateSessionId: vi.fn().mockReturnValue('integration-test-session'),
  };
});

const mockContext = {
  subscriptions: [],
  globalStorageUri: { fsPath: '/tmp/test-storage' },
  extensionUri: { fsPath: '/tmp/test-ext' },
} as unknown as import('vscode').ExtensionContext;

describe('Integration: Engine → EventBridge → Message Flow', () => {
  let engine: VSCodeEngine;
  let bridge: EventBridge;

  beforeEach(async () => {
    capturedEmit = null;
    engine = new VSCodeEngine('/workspace/project', mockContext);
    await engine.initialize();
    const agent = engine.getAgent()!;
    bridge = new EventBridge(agent.events, 0);
  });

  afterEach(async () => {
    bridge.dispose();
    await engine.dispose();
  });

  it('sends a message and receives streamed response via event bridge', async () => {
    const messages: any[] = [];
    const streamChunks: any[] = [];

    bridge.onMessage((msg) => messages.push(msg));
    bridge.onStream((chunk) => streamChunks.push(chunk));

    const agent = engine.getAgent()!;
    const response = await agent.sendMessage('Hi there');

    expect(response.content).toBe('Hello!');

    expect(messages.length).toBeGreaterThanOrEqual(2);
    const sentMsg = messages.find((m) => m.role === 'user');
    const receivedMsg = messages.find((m) => m.role === 'assistant');
    expect(sentMsg).toBeDefined();
    expect(sentMsg.content).toBe('Hi there');
    expect(receivedMsg).toBeDefined();
    expect(receivedMsg.content).toBe('Hello!');

    expect(streamChunks.length).toBeGreaterThanOrEqual(2);
    expect(streamChunks[streamChunks.length - 1].fullContent).toBe('Hello!');
  });

  it('engine state is correct after initialization', () => {
    const state = engine.getState();
    expect(state.status).toBe('ready');
    expect(state.workspaceRoot).toBe('/workspace/project');
    expect(state.sessionId).toBe('integration-test-session');
    expect(state.providerId).toBe('openai');
    expect(state.modelId).toBe('gpt-4o');
    expect(state.toolCount).toBe(165);
    expect(state.processing).toBe(false);
  });

  it('event bridge tracks tool execution events', async () => {
    const toolEvents: any[] = [];
    bridge.onToolEvent((e) => toolEvents.push(e));

    capturedEmit!({
      type: 'tool_executing',
      tool: 'file_read',
      description: 'Reading config',
      startTime: Date.now(),
    });

    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0].toolName).toBe('file_read');
    expect(toolEvents[0].status).toBe('executing');
  });

  it('event bridge tracks permission requests', async () => {
    const permissions: any[] = [];
    bridge.onPermission((p) => permissions.push(p));

    capturedEmit!({
      type: 'permission_required',
      tool: 'shell_exec',
      path: '/workspace/project',
      riskLevel: 'high',
    });

    expect(permissions).toHaveLength(1);
    expect(permissions[0].tool).toBe('shell_exec');
    expect(permissions[0].riskLevel).toBe('high');
  });
});
```

- **Acceptance criteria**:
  - All tests pass.
  - Full flow: engine created → agent initialized → event bridge subscribed → `sendMessage()` called → stream chunks received → message received → all via the event bridge.
  - Engine state is verified after initialization.
  - Tool execution and permission events flow through the bridge.

### T2.8.6 — Verify zero modifications to existing engine files

- **Status**: ⬜
- **Dependencies**: All above
- **Action**: Run verification commands.

```bash
# Verify no changes to engine package
git diff --name-only source/packages/engine/

# Verify no changes to shared package
git diff --name-only source/packages/shared/

# List only new files in vscode adapter
find source/packages/vscode/src/adapter -type f -name '*.ts' | sort
```

- **Acceptance criteria**:
  - `git diff --name-only source/packages/engine/` returns empty (no engine files modified).
  - `git diff --name-only source/packages/shared/` returns empty (no shared files modified).
  - All new files are under `packages/vscode/src/adapter/` and `packages/vscode/test/adapter/`.
  - Expected new files:
    - `packages/vscode/src/adapter/types.ts`
    - `packages/vscode/src/adapter/VSCodeEngine.ts`
    - `packages/vscode/src/adapter/VSCodeToolkitFactory.ts`
    - `packages/vscode/src/adapter/EngineLifecycle.ts`
    - `packages/vscode/src/adapter/EventBridge.ts`
    - `packages/vscode/src/adapter/ConfigBridge.ts`
    - `packages/vscode/src/adapter/VSCodeStorageAdapter.ts`
    - `packages/vscode/test/adapter/VSCodeEngine.test.ts`
    - `packages/vscode/test/adapter/EventBridge.test.ts`
    - `packages/vscode/test/adapter/ConfigBridge.test.ts`
    - `packages/vscode/test/adapter/VSCodeStorageAdapter.test.ts`
    - `packages/vscode/test/adapter/integration.test.ts`

---

## Summary: File Manifest

| File | Purpose | Lines (approx) |
|------|---------|----------------|
| `packages/vscode/src/adapter/types.ts` | All type definitions for the adapter layer | ~220 |
| `packages/vscode/src/adapter/VSCodeToolkitFactory.ts` | Workspace-aware toolkit creation | ~45 |
| `packages/vscode/src/adapter/VSCodeEngine.ts` | Core Agent wrapper class | ~200 |
| `packages/vscode/src/adapter/EngineLifecycle.ts` | Lazy init, workspace changes, crash recovery | ~220 |
| `packages/vscode/src/adapter/EventBridge.ts` | Typed event subscription bridge | ~550 |
| `packages/vscode/src/adapter/ConfigBridge.ts` | Config sync between VS Code and engine | ~260 |
| `packages/vscode/src/adapter/VSCodeStorageAdapter.ts` | JSON-file StorageAdapter implementation | ~260 |
| `packages/vscode/test/adapter/VSCodeEngine.test.ts` | Engine wrapper unit tests | ~120 |
| `packages/vscode/test/adapter/EventBridge.test.ts` | Event bridge unit tests | ~200 |
| `packages/vscode/test/adapter/ConfigBridge.test.ts` | Config bridge unit tests | ~90 |
| `packages/vscode/test/adapter/VSCodeStorageAdapter.test.ts` | Storage adapter unit tests | ~170 |
| `packages/vscode/test/adapter/integration.test.ts` | End-to-end adapter integration test | ~170 |

**Total**: ~2,505 lines of new code, 0 lines of existing code modified.
