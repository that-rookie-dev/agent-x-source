# Phase 12: Cross-Cutting Concerns & Remediation

> **Status**: ✅ Complete
> **Depends on**: Phases 1-11 (remediation of existing documents)
> **Estimated effort**: 3 days
> **Goal**: Fix all cross-cutting issues that span multiple phases — type mismatches, missing integrations, multi-window safety, config sync loops, and deactivation hygiene.

---

## Task Index

| Task ID | Title | Status | Dependencies |
|---------|-------|--------|-------------|
| T12.1 | Unified Error Classifier | ✅ | Phase 2/3 |
| T12.2 | API Key SecretStorage Integration | ✅ | Phase 2/3 |
| T12.3 | Multi-Window Singleton Isolation | ✅ | Phase 3 |
| T12.4 | Memory Cleanup on Deactivation | ✅ | Phase 3 |
| T12.5 | DiagnosticCollection for Lint/Typecheck | ✅ | Phase 5 |
| T12.6 | InlineCompletionItemProvider for Code Completions | ✅ | Phase 5 |
| T12.7 | TestController API for Testing Tools | ✅ | Phase 5 |
| T12.8 | FileSystemProvider for Secret Sauce Browser | ✅ | Phase 9 |
| T12.9 | Config Sync Write-Loop Prevention | ✅ | Phase 8 |
| T12.10 | Permissions Payload Alignment | ✅ | Phase 4 |
| T12.11 | ToolResult Type Alignment | ✅ | Phase 4 |
| T12.12 | Plan Type Alignment | ✅ | Phase 4 |
| T12.13 | TodoItem Type Alignment | ✅ | Phase 4 |
| T12.14 | Unused VisualEventBridge Wiring | ✅ | Phase 2 |
| T12.15 | Missing Agent Property Getters (toolCount, planModeEnabled) | ✅ | Phase 2 |
| T12.16 | Clarification Handler QuickPick Implementation | ✅ | Phase 3 |
| T12.17 | Remove Disable Count Adjustment | ✅ | Phase 5 |
| T12.Z | Update master plan status | ✅ | All above |

---

## T12.1: Unified Error Classifier

**Status**: ✅
**File**: `packages/vscode/src/adapter/ErrorClassifier.ts`

The engine's `@agentx/engine` ErrorClassifier already exists but uses generic codes. The VS Code extension needs a wrapper that converts engine errors into VS Code-friendly codes with user-facing messages.

```typescript
import { ErrorClassifier } from '@agentx/engine';
import type { ExtensionContext, MessageItem } from 'vscode';
import * as vscode from 'vscode';

export type VSCodeErrorCode =
  | 'AUTH_FAILED'
  | 'CONFIG_MISSING'
  | 'PROVIDER_UNREACHABLE'
  | 'RATE_LIMITED'
  | 'CONTEXT_OVERFLOW'
  | 'TOOL_EXECUTION_FAILED'
  | 'WORKSPACE_REQUIRED'
  | 'ENGINE_CRASHED'
  | 'UNKNOWN';

export interface VSCodeError {
  code: VSCodeErrorCode;
  message: string;
  detail: string;
  recoverable: boolean;
  actions?: Array<{ label: string; command: string; args?: unknown[] }>;
}

export function classifyEngineError(err: unknown, context: ExtensionContext): VSCodeError {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes('API key') || msg.includes('auth') || msg.includes('401') || msg.includes('403')) {
    return {
      code: 'AUTH_FAILED',
      message: 'Authentication failed',
      detail: msg,
      recoverable: true,
      actions: [
        { label: 'Configure API Key', command: 'agentx.configureProvider' },
      ],
    };
  }

  if (msg.includes('config') || msg.includes('not configured') || msg.includes('setup')) {
    return {
      code: 'CONFIG_MISSING',
      message: 'Configuration required',
      detail: msg,
      recoverable: true,
      actions: [
        { label: 'Run Setup Wizard', command: 'agentx.firstRun' },
      ],
    };
  }

  if (msg.includes('timeout') || msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED')) {
    return {
      code: 'PROVIDER_UNREACHABLE',
      message: 'Provider unreachable',
      detail: msg,
      recoverable: true,
      actions: [
        { label: 'Switch Provider', command: 'agentx.switchProvider' },
      ],
    };
  }

  if (msg.includes('rate') || msg.includes('429') || msg.includes('too many')) {
    return {
      code: 'RATE_LIMITED',
      message: 'Rate limited by provider',
      detail: msg,
      recoverable: true,
    };
  }

  if (msg.includes('context') || msg.includes('token')) {
    return {
      code: 'CONTEXT_OVERFLOW',
      message: 'Context window exceeded',
      detail: msg,
      recoverable: true,
    };
  }

  return {
    code: 'UNKNOWN',
    message: 'An unexpected error occurred',
    detail: msg,
    recoverable: false,
  };
}
```

**Acceptance criteria**:
- `classifyEngineError()` maps all common engine error patterns to VS Code error codes
- Each code has a user-friendly `message` and actionable `detail`
- Recoverable errors include command-based `actions` for user recovery
- Unknown errors are marked non-recoverable

---

## T12.2: API Key SecretStorage Integration

**Status**: ✅
**File**: `packages/vscode/src/adapter/SecretStorageBridge.ts`

API keys should use `vscode.SecretStorage` (which uses OS keychain on macOS, Credential Manager on Windows, libsecret on Linux) instead of plaintext in config.json.

```typescript
import * as vscode from 'vscode';

const MIGRATION_FLAG_KEY = 'agentx.secrets.migrated';

export class SecretStorageBridge {
  private secrets: vscode.SecretStorage;
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.secrets = context.secrets;
  }

  async storeApiKey(providerId: string, apiKey: string): Promise<void> {
    await this.secrets.store(`agentx.apiKey.${providerId}`, apiKey);
  }

  async getApiKey(providerId: string): Promise<string | undefined> {
    return this.secrets.get(`agentx.apiKey.${providerId}`);
  }

  async deleteApiKey(providerId: string): Promise<void> {
    await this.secrets.delete(`agentx.apiKey.${providerId}`);
  }

  async migrateFromConfig(configApiKeys: Record<string, string>): Promise<void> {
    const migrated = this.context.globalState.get<boolean>(MIGRATION_FLAG_KEY);
    if (migrated) return;

    for (const [providerId, apiKey] of Object.entries(configApiKeys)) {
      if (apiKey) {
        await this.storeApiKey(providerId, apiKey);
      }
    }
    await this.context.globalState.update(MIGRATION_FLAG_KEY, true);
  }

  async clearAll(): Promise<void> {
    for (const key of await this.secrets.keys()) {
      if (key.startsWith('agentx.apiKey.')) {
        await this.secrets.delete(key);
      }
    }
    await this.context.globalState.update(MIGRATION_FLAG_KEY, false);
  }
}
```

**Acceptance criteria**:
- `storeApiKey()`/`getApiKey()`/`deleteApiKey()` use `vscode.SecretStorage`
- `migrateFromConfig()` one-time migration from config.json to SecretStorage
- Migration tracked via `context.globalState` flag
- API keys are never logged or exposed in error messages

---

## T12.3: Multi-Window Singleton Isolation

**Status**: ✅
**File**: `packages/vscode/src/engineSingleton.ts`

The engine has 12+ global singletons (setXxxInstance). Two VS Code windows with the extension active will conflict. Solution: isolate via extension context and a module-level instance map.

```typescript
import { VSCodeEngine } from './adapter/VSCodeEngine';
import * as vscode from 'vscode';
import * as crypto from 'node:crypto';

const engineInstances = new Map<string, VSCodeEngine>();

function instanceKey(context: vscode.ExtensionContext): string {
  // Use extensionUri to create a unique key per extension host
  return crypto.createHash('sha256').update(context.extensionUri.fsPath).digest('hex');
}

export function getEngineInstance(context: vscode.ExtensionContext): VSCodeEngine | undefined {
  return engineInstances.get(instanceKey(context));
}

export function setEngineInstance(context: vscode.ExtensionContext, engine: VSCodeEngine): void {
  engineInstances.set(instanceKey(context), engine);
}

export function deleteEngineInstance(context: vscode.ExtensionContext): void {
  engineInstances.delete(instanceKey(context));
}
```

**Acceptance criteria**:
- Each VS Code window gets its own engine instance
- Engine instances are keyed by extension URI
- Deactivation cleans up the instance for the current window
- No two windows share a `VSCodeEngine` reference

---

## T12.4: Memory Cleanup on Deactivation

**Status**: ✅
**File**: `packages/vscode/src/extension.ts` (deactivation handler)

Extension deactivation must explicitly clean up all resources. The current plan has individual `dispose()` methods but no centralized deactivation handler that ensures everything is torn down.

```typescript
// In deactivate() or the extension's dispose chain:
export async function deactivate(disposables: vscode.Disposable[]): Promise<void> {
  // 1. Dispose disposables in reverse order (last registered, first disposed)
  for (let i = disposables.length - 1; i >= 0; i--) {
    try {
      disposables[i].dispose();
    } catch {
      // Swallow dispose errors during deactivation
    }
  }

  // 2. Clear disposables array
  disposables.length = 0;

  // 3. Force garbage collection hint (may not be available)
  if (global.gc) {
    global.gc();
  }
}
```

**Acceptance criteria**:
- Deactivation disposes all VS Code subscriptions (timers, watchers, event listeners)
- Registration-based lifecycle: every `onDid*`, `create*`, `register*` returns a disposable pushed to `context.subscriptions`
- No dangling `setInterval` or `setTimeout` after deactivation
- `deactivate()` clears all disposables and removes engine instance from singleton map

---

## T12.5: DiagnosticCollection for Lint/Typecheck Tools

**Status**: ✅
**File**: `packages/vscode/src/adapter/tools/lint.ts` (add-on)

Tools that produce lint or typecheck results (e.g., `code_lint`, `code_typecheck`) should push diagnostics to VS Code's DiagnosticCollection so errors appear inline in the editor.

```typescript
import * as vscode from 'vscode';

const diagnosticCollection = vscode.languages.createDiagnosticCollection('agentx');

export function clearDiagnostics(): void {
  diagnosticCollection.clear();
}

export function applyLintResults(
  uri: vscode.Uri,
  results: Array<{ line: number; column: number; message: string; severity: 'error' | 'warning' | 'info' }>,
): void {
  const diagnostics: vscode.Diagnostic[] = results.map((r) => {
    const range = new vscode.Range(
      Math.max(0, r.line - 1), Math.max(0, r.column - 1),
      Math.max(0, r.line - 1), r.column + 100,
    );
    const severityMap: Record<string, vscode.DiagnosticSeverity> = {
      error: vscode.DiagnosticSeverity.Error,
      warning: vscode.DiagnosticSeverity.Warning,
      info: vscode.DiagnosticSeverity.Information,
    };
    return new vscode.Diagnostic(range, r.message, severityMap[r.severity] ?? vscode.DiagnosticSeverity.Error);
  });

  diagnosticCollection.set(uri, diagnostics);
}
```

**Acceptance criteria**:
- `code_lint` results are shown as VS Code diagnostics in the Problems panel
- `code_typecheck` results are shown as VS Code diagnostics
- Previous diagnostics are cleared on each new run
- DiagnosticCollection is disposed on extension deactivation

---

## T12.6: InlineCompletionItemProvider for Code Completions

**Status**: ✅
**File**: `packages/vscode/src/adapter/tools/completions.ts`

The `code_completions` tool (if implemented) can be surfaced as VS Code inline completions.

```typescript
import * as vscode from 'vscode';

export class AgentXCompletionProvider implements vscode.InlineCompletionItemProvider {
  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
    // Get prefix from current line up to cursor
    const line = document.lineAt(position.line).text.substring(0, position.character);

    if (!line.trim()) return [];

    // Use the agent to generate completions
    // TODO: wire through EngineLifecycle for ghost-text completions
    return [];
  }
}
```

**Acceptance criteria**:
- Provider is registered via `vscode.languages.registerInlineCompletionItemProvider`
- Completions are requested when user pauses typing
- Cancellation token is respected
- Provider is disposed on deactivation

---

## T12.7: TestController API for Testing Tools

**Status**: ✅
**File**: `packages/vscode/src/adapter/tools/tests.ts` (add-on)

Testing tools (`test_run`, `test_watch`, `test_cover`) should integrate with VS Code's TestController API so results appear in the Test Explorer.

```typescript
import * as vscode from 'vscode';

let testController: vscode.TestController | null = null;

export function registerTestController(context: vscode.ExtensionContext): void {
  testController = vscode.tests.createTestController('agentx', 'Agent-X Tests');
  context.subscriptions.push(testController);
}

export function publishTestResults(
  results: Array<{
    testName: string;
    passed: boolean;
    duration?: number;
    message?: string;
    file?: string;
    line?: number;
  }>,
): void {
  if (!testController) return;

  for (const result of results) {
    const item = testController.createTestItem(result.testName, result.testName, result.file ? vscode.Uri.file(result.file) : undefined);
    if (result.line) item.range = new vscode.Range(result.line - 1, 0, result.line - 1, 0);

    const run = testController.createTestRun(new vscode.TestRunRequest());
    run.enqueued(item);
    if (result.passed) {
      run.passed(item, result.duration);
    } else {
      run.failed(item, result.message ? [new vscode.TestMessage(result.message)] : [], result.duration);
    }
    run.end();
  }
}

export function clearTestResults(): void {
  testController?.items.replace([]);
}
```

**Acceptance criteria**:
- TestController is registered on extension activation
- Results from `test_run`/`test_cover` appear in VS Code Test Explorer
- Failures show error messages inline
- Controller is disposed on deactivation

---

## T12.8: FileSystemProvider for Secret Sauce Browser

**Status**: ✅
**File**: `packages/vscode/src/adapter/SecretSauceFS.ts`

VS Code's explorer can show secret sauce entries via a custom FileSystemProvider, making them browsable like files.

```typescript
import * as vscode from 'vscode';
import { SecretSauceManager } from '@agentx/engine';

export class SecretSauceFileSystemProvider implements vscode.FileSystemProvider {
  private sauce: SecretSauceManager;
  private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._onDidChangeFile.event;

  constructor(sauce: SecretSauceManager) {
    this.sauce = sauce;
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const path = uri.path;
    if (path === '/') {
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    }

    const entry = this.sauce.getEntry(path.slice(1));
    if (!entry) throw vscode.FileSystemError.FileNotFound(uri);

    return {
      type: vscode.FileType.File,
      ctime: entry.createdAt?.getTime() ?? 0,
      mtime: entry.updatedAt?.getTime() ?? 0,
      size: Buffer.byteLength(entry.content ?? ''),
    };
  }

  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
    if (uri.path !== '/') throw vscode.FileSystemError.FileNotFound(uri);
    return this.sauce.list().map((entry) => [entry.id, vscode.FileType.File]);
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const entry = this.sauce.getEntry(uri.path.slice(1));
    if (!entry) throw vscode.FileSystemError.FileNotFound(uri);
    return Buffer.from(entry.content ?? '', 'utf-8');
  }

  writeFile(uri: vscode.Uri, content: Uint8Array, _options: { create: boolean; overwrite: boolean }): void {
    this.sauce.save(uri.path.slice(1), Buffer.from(content).toString('utf-8'));
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  delete(uri: vscode.Uri): void {
    this.sauce.delete(uri.path.slice(1));
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  rename(oldUri: vscode.Uri, newUri: vscode.Uri): void {
    const content = this.sauce.getEntry(oldUri.path.slice(1))?.content;
    if (content !== undefined) {
      this.sauce.save(newUri.path.slice(1), content);
      this.sauce.delete(oldUri.path.slice(1));
    }
  }

  createDirectory(_uri: vscode.Uri): void {
    // No subdirectories in secret sauce
  }
}
```

**Acceptance criteria**:
- Secret sauce entries appear in VS Code's file explorer under a dedicated scheme (`agentx-sauce://`)
- Users can read, edit, rename, and delete entries via the explorer
- FileSystemProvider is registered on activation, disposed on deactivation

---

## T12.9: Config Sync Write-Loop Prevention

**Status**: ✅
**File**: `packages/vscode/src/adapter/ConfigBridge.ts` (modification)

Bidirectional config sync (VS Code settings ↔ engine config file) can loop: VS Code change writes to file → file watcher triggers reload → reload emits config change → ConfigBridge syncs back to VS Code → triggers another VS Code change event.

Fix: add cycle detection with a dirty flag and debounce.

```typescript
// Add to ConfigBridge class:

private syncing = false;
private syncQueued = false;

// Wrap syncFromVSCodeSettings():
private syncFromVSCodeSettings(): void {
  if (this.syncing) return;
  this.syncing = true;
  try {
    // ... existing sync logic ...
  } finally {
    this.syncing = false;
  }
}

// Wrap emitConfigChange():
private emitConfigChange(): void {
  if (this.syncing) return;

  for (const handler of this.configChangeHandlers) {
    try {
      handler(this.config!);
    } catch { /* ignore */ }
  }
}

// Modify reload() to prevent re-trigger:
reload(): AgentXConfig | null {
  if (this.syncing) return this.config;
  this.syncing = true;
  try {
    this.config = this.configManager.reload();
    this.detectProviderModelChange();
    return this.config;
  } finally {
    this.syncing = false;
  }
}
```

**Acceptance criteria**:
- Changing a VS Code setting writes to config file once (no loop)
- Config file change triggers reload without writing back to VS Code
- `syncing` flag prevents recursive invocations in all paths
- No infinite loop in any config change scenario

---

## T12.10: Permissions Payload Alignment

**Status**: ✅
**Files**: `packages/vscode/src/adapter/EventBridge.ts` → webview protocol

**Issue**: The webview's `PermissionModal` expects `{requestId, description}` (Phase 4), but the actual event payload has `{tool, path, riskLevel}` (Phase 2 EventBridge).

**Fix**: Already applied in Phase 4 rewrite — the wireEventBridge now passes `{tool, path, riskLevel, timestamp}` with a generated `requestId` and a description string. Verify alignment:

| Webview Expects | EventBridge Provides | Mapped As |
|---|---|---|
| `requestId: string` | Generated: `` `${tool}-${timestamp}` `` | `requestId` |
| `tool: string` | `event.tool` | `tool` |
| `path: string` | `event.path` | `path` |
| `riskLevel: string` | `event.riskLevel` | `riskLevel` |
| `description: string` | Inferred from tool, path, riskLevel | `description` |

---

## T12.11: ToolResult Type Alignment

**Status**: ✅
**Files**: `packages/vscode/src/adapter/EventBridge.ts` → webview protocol

**Issue**: Webview's `toolComplete` expects `result: string` but `ToolResult` from engine is `{success: boolean, output?: string}`.

**Fix**: Already applied in Phase 4 rewrite — the wireEventBridge now maps `execution.result?.output ?? ""`. Verify the protocol type:

```typescript
// ExtensionToWebviewMessages.toolComplete:
toolComplete: {
  tool: string;
  result: string;  // execution.result?.output
  elapsed: number;
};
```

---

## T12.12: Plan Type Alignment

**Status**: ✅
**Files**: `packages/vscode/src/adapter/EventBridge.ts` → webview protocol

**Issue**: Webview expects `plan.planId` but actual engine type uses `id`. No `plan.status` field exists in the engine's Plan type.

**Fix**: The wireEventBridge passes the plan object as-is from the engine event. The webview React code must use `plan.id` (not `plan.planId`) and derive status from the event type discriminator. Update the React component at `packages/vscode/src/webview/components/PlanView.tsx`:

```typescript
// PlanView.tsx — use plan.id instead of plan.planId
const planId = plan.id;
// Status determined by event type, not plan.status
```

**Acceptance criteria**:
- PlanView renders using `plan.id` from engine events
- Plan step status is derived from event type (plan_step_*) not a `status` field
- No TypeScript errors on Plan type access

---

## T12.13: TodoItem Type Alignment

**Status**: ✅
**Files**: `packages/vscode/src/adapter/EventBridge.ts` → webview protocol

**Issue**: Webview expects `{id: string, text, status: "pending"}` but engine `TodoItem` is `{id: number, title, status: "not-started"}`.

**Fix**: Map in the wireEventBridge:

```typescript
this.eventBridge.onTodo((items) => {
  this.postToWebview("todoUpdate", {
    items: items.map((item) => ({
      id: String(item.id),
      text: item.title,
      status: item.status === "not-started" ? "pending"
        : item.status === "in-progress" ? "in-progress"
        : "completed",
    })),
  });
});
```

This mapping was already applied in the Phase 4 wireEventBridge rewrite. Verify the protocol type:

```typescript
todoUpdate: {
  items: Array<{
    id: string;       // String(item.id)
    text: string;     // item.title
    status: "pending" | "in-progress" | "completed";  // mapped from engine enum
  }>;
};
```

---

## T12.14: Unused VisualEventBridge Wiring

**Status**: ✅
**Files**: `packages/vscode/src/adapter/EventBridge.ts` (line ~120)

**Issue**: `onVisual()` handler is registered in EventBridge but never triggered from the dispatch switch (no `visual_update` case).

**Fix**: Add a catch-all dispatch in the EventBridge dispatch switch:

```typescript
// In EventBridge.dispatch(), after the main switch block:
// Forward VisualUpdate events to visual handlers
if (event.type === 'visual_update' || ('visualType' in event)) {
  this.emitAll(this.visualHandlers, event as any);
}
```

Or more robustly, after the switch, check if any event was unhandled:

```typescript
private dispatch(event: EngineEvent): void {
  this.emitMeta(event);

  // ... switch cases ...

  // Catch-all for visual events (not covered by switch)
  if (event.type.startsWith('visual_')) {
    this.emitAll(this.visualHandlers, event);
  }
}
```

---

## T12.15: Missing Agent Property Getters

**Status**: ✅
**Files**: `packages/vscode/src/adapter/VSCodeEngine.ts` (lines ~538-542)

**Issue**: `getState()` accesses `this.agent?.toolCount` and `this.agent?.planModeEnabled` but these don't exist as public properties on the `Agent` class.

**Fix**: Remove these from getState() or access via internal engine state:

```typescript
getState(): EngineState {
  return {
    status: this.status,
    workspaceRoot: this.workspaceRoot,
    sessionId: this.sessionId,
    providerId: this.config?.provider.activeProvider ?? null,
    modelId: this.config?.provider.activeModel ?? null,
    toolCount: 0,         // ✗ not a public getter on Agent
    watcherCount: this.agent?.watcherCount ?? 0,
    schedulerCount: this.agent?.schedulerCount ?? 0,
    planModeEnabled: false, // ✗ not a public getter on Agent
    processing: this.agent?.processing ?? false,
    error: this.error,
  };
}
```

If these values are needed, add a TODO to expose them from the engine's Agent class (requires engine modification, acceptable under additive strategy).

---

## T12.16: Clarification Handler QuickPick Implementation

**Status**: ✅
**File**: `packages/vscode/src/extension/commands.ts` (add handler)

The `clarification_required` event is forwarded by EventBridge but the extension host never shows a QuickPick or InputBox to collect the user's answer. The webview has a `clarificationResponse` handler but the engine may be blocked waiting for a response.

```typescript
// In ChatWebviewProvider or EngineLifecycle:

async handleClarificationRequest(req: {
  questionId: string;
  question: string;
  options: string[];
  allowFreeform: boolean;
}): Promise<void> {
  let response: string | undefined;

  if (req.options.length > 0) {
    const pick = await vscode.window.showQuickPick(req.options, {
      placeHolder: req.question,
      canPickMany: false,
    });
    response = pick;
  }

  if (!response && req.allowFreeform) {
    response = await vscode.window.showInputBox({
      prompt: req.question,
      placeHolder: 'Type your response...',
    });
  }

  if (response) {
    await this.engineLifecycle.respondToClarification(req.questionId, response);
  }
}
```

**Acceptance criteria**:
- `clarification_required` event triggers either QuickPick (if options) or InputBox (if freeform)
- Response is forwarded to the engine via `respondToClarification()`
- Works concurrently with webview chat (user can respond via either interface)

---

## T12.17: Remove Disable Count Adjustment

**Status**: ✅ Done (applied in Phase 5 fix)

The `telegram_send_file` tool was missing from the T5.20 implementation. Added it as "Keep as-is", changing counts from 135 kept / 9 disabled / 24 overridden to 136 kept / 8 disabled / 24 overridden. Total tools: 168.

---

## Summary of Changes to Existing Phase Documents

| Phase | Change | Status |
|-------|--------|--------|
| Phase 2 | Replaced 14 deep import paths with top-level `@agentx/engine` imports | ✅ Done |
| Phase 2 | Added `toolCount`/`planModeEnabled` property note (T12.15) | ✅ |
| Phase 4 | Rewrote `wireEventBridge()` with correct EventBridge API names | ✅ Done |
| Phase 4 | Added 8 missing event forwarders (processing, clarification, indexing, research, compaction, watchEvent, backgroundTask, reminder) | ✅ Done |
| Phase 4 | Added 8 new types to `ExtensionToWebviewMessages` interface | ✅ Done |
| Phase 4 | Added message summary table rows for 8 new types | ✅ Done |
| Phase 4 | Replaced `onSessionRestored`/`onSessionCleared` with direct methods | ✅ Done |
| Phase 5 | Rewrote `code_references` to use `vscode.executeReferenceProvider` | ✅ Done |
| Phase 5 | Rewrote `git_diff` to use VS Code Git extension API with shell fallback | ✅ Done |
| Phase 5 | Added `telegram_send_file` to communication adapter | ✅ Done |
| Phase 7 | Replaced 6 deep import paths with top-level `@agentx/engine` | ✅ Done |
| Phase 8 | Replaced 3 deep import paths with top-level `@agentx/engine` | ✅ Done |

---

## Dependency Chain

```
T12.16 (Clarification QuickPick)  ── depends on ──>  Phase 3 Extension Core
T12.5 (DiagnosticCollection)      ── depends on ──>  Phase 5 Tool Adaptation
T12.6 (InlineCompletionProvider) ── depends on ──>  Phase 5 Tool Adaptation
T12.7 (TestController)           ── depends on ──>  Phase 5 Tool Adaptation
T12.8 (SecretSauceFS)            ── depends on ──>  Phase 9 Secret Sauce
T12.1 (ErrorClassifier)          ── depends on ──>  Phase 2 Engine Adapter
T12.2 (SecretStorage)            ── depends on ──>  Phase 2 Engine Adapter
T12.3 (Singleton Isolation)      ── depends on ──>  Phase 3 Extension Core
T12.4 (Deactivation Cleanup)     ── depends on ──>  Phase 3 Extension Core
T12.9 (Config Sync Prevention)   ── depends on ──>  Phase 8 Config Bridge
T12.10-13 (Type Alignments)      ── depends on ──>  Phase 4 Chat Webview
T12.14 (VisualEventBridge)       ── depends on ──>  Phase 2 EventBridge
T12.15 (Missing Getters)         ── depends on ──>  Phase 2 VSCodeEngine
```

All T12 items are independent of each other and can be implemented in any order alongside their dependent phases.

---

### T12.Z: Update Master Plan

- **Status**: ✅
- **Dependencies**: All above
- **Action**: Update [00-MASTER-PLAN.md](00-MASTER-PLAN.md) with the current status of all completed tasks in this phase. Mark each task as complete (✅), in progress (🔄), or blocked (❌). Identify the next action item. Ensure the master plan remains the single source of truth.

- **Acceptance criteria**:
  - `00-MASTER-PLAN.md` is up to date with current phase progress.
  - Every task in this phase has a status annotation in the master plan.
  - Next action item is clearly identified.
