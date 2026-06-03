# Phase 6: Permissions & Scope — Permission System UI, Scope Guard Integration, Diff Preview

> **Status**: ⬜ Not Started
> **Depends on**: Phase 2 (Engine Adapter), Phase 4 (Chat Webview)
> **Estimated Effort**: 4–5 days
> **Files Created**: `packages/vscode/src/adapter/PermissionHandler.ts`, `packages/vscode/src/adapter/PermissionSettings.ts`, `packages/vscode/src/providers/PermissionTreeProvider.ts`, `packages/vscode/src/adapter/ScopeGuardAdapter.ts`, `packages/vscode/src/adapter/DiffPreviewHandler.ts`

---

## Overview

Phase 6 implements the permission system UI and scope guard integration for the VS Code extension. The engine already provides `PermissionManager` (persistent allow/deny decisions stored in `~/.local/share/agentx/secret-sauce/PERMISSIONS.md`) and `ScopeGuard` (path validation with symlink resolution and dangerous-path blocklists). The `Agent` class emits `permission_required` events and pauses tool execution until the UI resolves via `agent.respondToPermission(choice)`. Similarly, `diff_preview` events are emitted before file-modifying tools execute, giving the UI a chance to show a diff and let the user accept or reject the change.

This phase bridges those engine events to native VS Code UI:

1. **PermissionHandler** — listens for `permission_required` events from EventBridge, shows VS Code modals/notifications based on risk level, handles timeouts, and resolves back to the engine.
2. **PermissionSettings** — VS Code settings that control auto-approve behavior, timeout duration, and default decisions.
3. **PermissionTreeProvider** — a TreeDataProvider showing all permissions granted/denied, with actions to revoke or export.
4. **ScopeGuardAdapter** — wraps the engine's ScopeGuard with multi-root workspace awareness and user-facing notifications.
5. **DiffPreviewHandler** — opens VS Code's native diff editor for file-modifying tools, with accept/reject toolbar buttons.

### Architecture Flow

```
Engine (ToolExecutor)
  │
  ├── permission_required event ──► EventBridge.onPermission()
  │                                    │
  │                                    ▼
  │                              PermissionHandler
  │                                ├── Check PermissionSettings (auto-approve?)
  │                                ├── Show VS Code modal/notification
  │                                ├── Timeout after N seconds
  │                                └── agent.respondToPermission(choice)
  │
  ├── diff_preview event ────────► EventBridge.onDiffPreview()
  │                                    │
  │                                    ▼
  │                              DiffPreviewHandler
  │                                ├── Create virtual documents
  │                                ├── Open vscode.diff editor
  │                                ├── Accept/Reject toolbar buttons
  │                                └── Resolve permission based on user action
  │
  └── scope validation ──────────► ScopeGuardAdapter
                                     ├── Multi-root workspace support
                                     ├── Path validation
                                     └── Blocked-path notifications
```

---

## Task Index

| Task ID | Title | Status | Priority |
|---------|-------|--------|----------|
| T6.1 | Permission Handler Bridge | ⬜ | Core |
| T6.2 | Permission Settings | ⬜ | Core |
| T6.3 | Permission Audit View | ⬜ | P1 |
| T6.4 | Scope Guard Integration | ⬜ | Core |
| T6.5 | Diff Preview Integration | ⬜ | P1 |
| T6.6 | Verification & Testing | ⬜ | Core |

---

## T6.1: Permission Handler Bridge

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/PermissionHandler.ts`
**Estimated Effort**: 6 hours

### T6.1.1: Class Skeleton and Constructor

The `PermissionHandler` bridges engine permission events to VS Code's native UI. It subscribes to `EventBridge.onPermission()`, evaluates settings for auto-approve, and shows the appropriate VS Code modal or notification based on risk level.

```typescript
// packages/vscode/src/adapter/PermissionHandler.ts

import * as vscode from 'vscode';
import type { EventBridge, Disposable } from './types';
import type { PermissionRequest, PermissionChoice } from './types';
import type { PermissionSettings } from './PermissionSettings';
import type { Agent } from '@agentx/engine';

interface PendingPermission {
  request: PermissionRequest;
  resolve: (choice: PermissionChoice) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
  responded: boolean;
}

export class PermissionHandler implements vscode.Disposable {
  private disposables: Disposable[] = [];
  private pendingQueue: PendingPermission[] = [];
  private currentPending: PendingPermission | null = null;
  private outputChannel: vscode.OutputChannel;

  constructor(
    private readonly eventBridge: EventBridge,
    private readonly settings: PermissionSettings,
    private readonly outputChannelRef: vscode.OutputChannel,
  ) {
    this.outputChannel = outputChannelRef;
    this.disposables.push(
      this.eventBridge.onPermission((request) => this.handlePermissionRequest(request)),
    );
  }

  setAgent(agent: Agent): void {
    this.agent = agent;
  }

  private agent: Agent | null = null;
```

**Acceptance Criteria**:
- Class implements `vscode.Disposable`
- Constructor accepts `EventBridge`, `PermissionSettings`, and `vscode.OutputChannel`
- Subscribes to `eventBridge.onPermission()` on construction
- `setAgent()` stores the agent reference for calling `respondToPermission()`
- `PendingPermission` interface tracks request, resolve callback, timeout, and response state
- Queue system handles multiple concurrent permission requests

---

### T6.1.2: Core Permission Request Handler

```typescript
  private handlePermissionRequest(request: PermissionRequest): void {
    this.outputChannel.appendLine(
      `[Permission] Request: ${request.tool} on ${request.path} (risk: ${request.riskLevel})`,
    );

    const autoDecision = this.evaluateAutoApprove(request);
    if (autoDecision) {
      this.outputChannel.appendLine(
        `[Permission] Auto-approved: ${request.tool} (${autoDecision})`,
      );
      this.resolveToEngine(request, autoDecision);
      return;
    }

    const defaultDecision = this.settings.getDefaultDecision();
    if (defaultDecision === 'allow') {
      this.resolveToEngine(request, 'allow_once');
      return;
    }
    if (defaultDecision === 'deny') {
      this.resolveToEngine(request, 'deny');
      return;
    }

    this.enqueueRequest(request);
  }

  private evaluateAutoApprove(request: PermissionRequest): PermissionChoice | null {
    if (this.settings.getAutoApproveReadOnly() && isReadOnlyTool(request.tool)) {
      return 'allow_once';
    }

    if (this.settings.getAutoApproveLowRisk() && request.riskLevel === 'low') {
      return 'allow_once';
    }

    return null;
  }

  private enqueueRequest(request: PermissionRequest): void {
    const pending: PendingPermission = {
      request,
      resolve: (choice: PermissionChoice) => {
        if (pending.responded) return;
        pending.responded = true;
        clearTimeout(pending.timeoutHandle);
        this.resolveToEngine(request, choice);
        this.removeFromQueue(pending);
        this.processNext();
      },
      timeoutHandle: null as unknown as ReturnType<typeof setTimeout>,
      responded: false,
    };

    const timeoutMs = this.settings.getTimeout() * 1000;
    pending.timeoutHandle = setTimeout(() => {
      if (!pending.responded) {
        this.outputChannel.appendLine(
          `[Permission] Timeout: ${request.tool} — auto-denying after ${this.settings.getTimeout()}s`,
        );
        vscode.window.showWarningMessage(
          `Agent-X: Permission request for "${request.tool}" timed out and was denied.`,
        );
        pending.resolve('deny');
      }
    }, timeoutMs);

    this.pendingQueue.push(pending);

    if (!this.currentPending) {
      this.processNext();
    }
  }

  private processNext(): void {
    if (this.pendingQueue.length === 0) {
      this.currentPending = null;
      return;
    }

    const next = this.pendingQueue[0];
    if (!next || next.responded) {
      this.pendingQueue.shift();
      this.processNext();
      return;
    }

    this.currentPending = next;
    this.showUIForRequest(next);
  }

  private removeFromQueue(pending: PendingPermission): void {
    const index = this.pendingQueue.indexOf(pending);
    if (index !== -1) {
      this.pendingQueue.splice(index, 1);
    }
    if (this.currentPending === pending) {
      this.currentPending = null;
    }
  }

  private resolveToEngine(request: PermissionRequest, choice: PermissionChoice): void {
    if (this.agent) {
      this.agent.respondToPermission(choice);
    }
  }
```

**Acceptance Criteria**:
- `handlePermissionRequest()` checks auto-approve settings before showing UI
- Read-only tools are auto-approved when `autoApproveReadOnly` is enabled
- Low-risk tools are auto-approved when `autoApproveLowRisk` is enabled
- Default decision setting (`ask`, `allow`, `deny`) is respected
- Requests are queued and processed sequentially
- Timeout fires after configured seconds and auto-denies with notification
- `resolveToEngine()` calls `agent.respondToPermission(choice)` to unblock execution
- Double-response protection via `responded` flag

---

### T6.1.3: Risk-Level-Based UI Presentation

```typescript
  private async showUIForRequest(pending: PendingPermission): Promise<void> {
    const { request } = pending;
    const riskLevel = request.riskLevel.toLowerCase();

    switch (riskLevel) {
      case 'critical':
        await this.showCriticalModal(pending);
        break;
      case 'high':
        await this.showHighRiskNotification(pending);
        break;
      case 'medium':
        await this.showMediumRiskNotification(pending);
        break;
      case 'low':
        await this.showLowRiskNotification(pending);
        break;
      default:
        await this.showMediumRiskNotification(pending);
        break;
    }
  }

  private async showCriticalModal(pending: PendingPermission): Promise<void> {
    const { request } = pending;
    const message = `Agent-X wants to run "${request.tool}" on:\n${request.path}\n\nThis is a CRITICAL risk operation.`;

    const choice = await vscode.window.showWarningMessage(
      message,
      { modal: true, detail: 'This action may cause irreversible changes. Please review carefully.' },
      'Allow Once',
      'Allow Always',
      'Deny',
    );

    if (pending.responded) return;

    switch (choice) {
      case 'Allow Once':
        pending.resolve('allow_once');
        break;
      case 'Allow Always':
        pending.resolve('allow_always');
        break;
      case 'Deny':
      default:
        pending.resolve('deny');
        break;
    }
  }

  private async showHighRiskNotification(pending: PendingPermission): Promise<void> {
    const { request } = pending;
    const message = `Agent-X: "${request.tool}" wants to access ${request.path} (High Risk)`;

    const choice = await vscode.window.showWarningMessage(
      message,
      'Allow Once',
      'Allow Always',
      'Deny',
    );

    if (pending.responded) return;

    switch (choice) {
      case 'Allow Once':
        pending.resolve('allow_once');
        break;
      case 'Allow Always':
        pending.resolve('allow_always');
        break;
      case 'Deny':
      default:
        pending.resolve('deny');
        break;
    }
  }

  private async showMediumRiskNotification(pending: PendingPermission): Promise<void> {
    const { request } = pending;
    const message = `Agent-X: "${request.tool}" on ${request.path}`;

    const choice = await vscode.window.showInformationMessage(
      message,
      'Allow Once',
      'Allow Always',
      'Deny',
    );

    if (pending.responded) return;

    switch (choice) {
      case 'Allow Once':
        pending.resolve('allow_once');
        break;
      case 'Allow Always':
        pending.resolve('allow_always');
        break;
      case 'Deny':
      default:
        pending.resolve('deny');
        break;
    }
  }

  private async showLowRiskNotification(pending: PendingPermission): Promise<void> {
    const { request } = pending;
    const message = `Agent-X: "${request.tool}" on ${request.path} (Low Risk)`;

    const choice = await vscode.window.showInformationMessage(
      message,
      'Allow Once',
      'Allow Always',
      'Deny',
    );

    if (pending.responded) return;

    switch (choice) {
      case 'Allow Once':
        pending.resolve('allow_once');
        break;
      case 'Allow Always':
        pending.resolve('allow_always');
        break;
      case 'Deny':
      default:
        pending.resolve('deny');
        break;
    }
  }
```

**Acceptance Criteria**:
- `Critical` risk: uses `showWarningMessage` with `{ modal: true }` — blocking dialog with detail text
- `High` risk: uses `showWarningMessage` — non-blocking warning notification with action buttons
- `Medium` risk: uses `showInformationMessage` — information notification with action buttons
- `Low` risk: uses `showInformationMessage` — information notification (only reached if auto-approve is disabled)
- All three choices (Allow Once, Allow Always, Deny) are presented
- If user dismisses notification without choosing (choice is `undefined`), it defaults to deny
- `pending.responded` guard prevents double-resolution if timeout and UI response race

---

### T6.1.4: Read-Only Tool Detection

```typescript
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'file_read',
  'file_list',
  'file_search',
  'file_info',
  'code_search',
  'code_definition',
  'code_references',
  'code_diagnostics',
  'code_symbols',
  'code_hover',
  'code_completion',
  'git_status',
  'git_log',
  'git_diff',
  'git_branch_list',
  'git_remote_list',
  'git_show',
  'git_blame',
  'web_fetch',
  'web_search',
  'package_list',
  'package_info',
  'system_info',
  'system_env',
  'ai_summarize',
  'ai_classify',
  'data_parse',
  'data_transform',
  'data_validate',
]);

export function isReadOnlyTool(toolId: string): boolean {
  return READ_ONLY_TOOLS.has(toolId);
}
```

**Acceptance Criteria**:
- `READ_ONLY_TOOLS` set contains all tools that only read data without modifying anything
- `isReadOnlyTool()` returns `true` for read-only tools, `false` otherwise
- Covers filesystem reads, code intelligence reads, git reads, web reads, and data processing reads
- Exported for use by `PermissionSettings` and tests

---

### T6.1.5: Dispose and Cancel All Pending

```typescript
  cancelAllPending(): void {
    for (const pending of this.pendingQueue) {
      if (!pending.responded) {
        clearTimeout(pending.timeoutHandle);
        pending.responded = true;
        pending.resolve('deny');
      }
    }
    this.pendingQueue = [];
    this.currentPending = null;
  }

  getPendingCount(): number {
    return this.pendingQueue.filter((p) => !p.responded).length;
  }

  dispose(): void {
    this.cancelAllPending();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
```

**Acceptance Criteria**:
- `cancelAllPending()` denies all queued requests and clears timeouts
- `getPendingCount()` returns the number of unresolved requests
- `dispose()` cancels all pending, unsubscribes from EventBridge
- Safe to call `dispose()` multiple times

---

## T6.2: Permission Settings

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/PermissionSettings.ts`
**Estimated Effort**: 2 hours

### T6.2.1: Settings Class Implementation

```typescript
// packages/vscode/src/adapter/PermissionSettings.ts

import * as vscode from 'vscode';

export type DefaultDecision = 'ask' | 'allow' | 'deny';

export class PermissionSettings implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  constructor() {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('agentx.permissions')) {
          this.changeEmitter.fire();
        }
      }),
    );
  }

  getAutoApproveLowRisk(): boolean {
    return vscode.workspace
      .getConfiguration('agentx.permissions')
      .get<boolean>('autoApproveLowRisk', false);
  }

  getAutoApproveReadOnly(): boolean {
    return vscode.workspace
      .getConfiguration('agentx.permissions')
      .get<boolean>('autoApproveReadOnly', true);
  }

  getTimeout(): number {
    const value = vscode.workspace
      .getConfiguration('agentx.permissions')
      .get<number>('timeout', 60);
    return Math.max(5, Math.min(600, value));
  }

  getDefaultDecision(): DefaultDecision {
    return vscode.workspace
      .getConfiguration('agentx.permissions')
      .get<DefaultDecision>('defaultDecision', 'ask');
  }

  async setAutoApproveLowRisk(value: boolean): Promise<void> {
    await vscode.workspace
      .getConfiguration('agentx.permissions')
      .update('autoApproveLowRisk', value, vscode.ConfigurationTarget.Global);
  }

  async setAutoApproveReadOnly(value: boolean): Promise<void> {
    await vscode.workspace
      .getConfiguration('agentx.permissions')
      .update('autoApproveReadOnly', value, vscode.ConfigurationTarget.Global);
  }

  async setTimeout(seconds: number): Promise<void> {
    await vscode.workspace
      .getConfiguration('agentx.permissions')
      .update('timeout', seconds, vscode.ConfigurationTarget.Global);
  }

  async setDefaultDecision(value: DefaultDecision): Promise<void> {
    await vscode.workspace
      .getConfiguration('agentx.permissions')
      .update('defaultDecision', value, vscode.ConfigurationTarget.Global);
  }

  dispose(): void {
    this.changeEmitter.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
```

**Acceptance Criteria**:
- Reads from `agentx.permissions.*` VS Code configuration namespace
- `autoApproveLowRisk` defaults to `false`
- `autoApproveReadOnly` defaults to `true`
- `timeout` defaults to `60` seconds, clamped between 5 and 600
- `defaultDecision` defaults to `'ask'`, accepts `'ask' | 'allow' | 'deny'`
- `onDidChange` event fires when any permission setting changes
- Setter methods write to `ConfigurationTarget.Global`
- `dispose()` cleans up event emitter and configuration listener

---

### T6.2.2: Package.json Configuration Contribution

Add to `packages/vscode/package.json` under `contributes.configuration.properties`:

```json
{
  "agentx.permissions.autoApproveLowRisk": {
    "type": "boolean",
    "default": false,
    "description": "Automatically approve low-risk tool operations without prompting."
  },
  "agentx.permissions.autoApproveReadOnly": {
    "type": "boolean",
    "default": true,
    "description": "Automatically approve read-only tool operations (file reads, code search, git status, etc.)."
  },
  "agentx.permissions.timeout": {
    "type": "number",
    "default": 60,
    "minimum": 5,
    "maximum": 600,
    "description": "Seconds to wait for user response before auto-denying a permission request."
  },
  "agentx.permissions.defaultDecision": {
    "type": "string",
    "enum": ["ask", "allow", "deny"],
    "default": "ask",
    "enumDescriptions": [
      "Prompt the user for each permission request",
      "Automatically allow all tool operations",
      "Automatically deny all tool operations"
    ],
    "description": "Default action when a tool requests permission."
  }
}
```

**Acceptance Criteria**:
- All four settings are registered under `agentx.permissions` namespace
- Types, defaults, and constraints match the TypeScript class
- `timeout` has `minimum: 5` and `maximum: 600`
- `defaultDecision` has enum with descriptions
- Settings appear in VS Code Settings UI under Extensions > Agent-X

---

## T6.3: Permission Audit View

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/providers/PermissionTreeProvider.ts`
**Estimated Effort**: 4 hours

### T6.3.1: TreeDataProvider Implementation

```typescript
// packages/vscode/src/providers/PermissionTreeProvider.ts

import * as vscode from 'vscode';
import type { Permission, PermissionDecision } from '@agentx/shared';
import type { PermissionManager } from '@agentx/engine';

interface PermissionAuditEntry {
  id: string;
  toolName: string;
  targetPath: string | null;
  decision: PermissionDecision;
  createdAt: string;
  riskLevel: string;
}

type PermissionTreeItem = PermissionGroupItem | PermissionEntryItem;

class PermissionGroupItem extends vscode.TreeItem {
  constructor(
    public readonly groupLabel: string,
    public readonly entries: PermissionAuditEntry[],
  ) {
    super(groupLabel, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'permissionGroup';
    this.iconPath = new vscode.ThemeIcon(
      groupLabel === 'Allowed' ? 'check-all' : 'close-all',
      groupLabel === 'Allowed'
        ? new vscode.ThemeColor('testing.iconPassed')
        : new vscode.ThemeColor('testing.iconFailed'),
    );
    this.description = `${entries.length} permission${entries.length !== 1 ? 's' : ''}`;
  }
}

class PermissionEntryItem extends vscode.TreeItem {
  constructor(public readonly entry: PermissionAuditEntry) {
    super(entry.toolName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'permissionEntry';
    this.description = entry.targetPath ?? '*';
    this.tooltip = new vscode.MarkdownString(
      `**${entry.toolName}**\n\n` +
      `Path: \`${entry.targetPath ?? '*'}\`\n\n` +
      `Decision: **${entry.decision}**\n\n` +
      `Risk: ${entry.riskLevel}\n\n` +
      `Time: ${new Date(entry.createdAt).toLocaleString()}`,
    );

    const iconMap: Record<PermissionDecision, string> = {
      allow_once: 'check',
      allow_always: 'pass-filled',
      deny: 'circle-slash',
    };
    const colorMap: Record<PermissionDecision, string> = {
      allow_once: 'testing.iconPassed',
      allow_always: 'testing.iconPassed',
      deny: 'testing.iconFailed',
    };
    this.iconPath = new vscode.ThemeIcon(
      iconMap[entry.decision],
      new vscode.ThemeColor(colorMap[entry.decision]),
    );

    if (entry.targetPath) {
      this.command = {
        command: 'agentx.openFile',
        title: 'Open File',
        arguments: [vscode.Uri.file(entry.targetPath)],
      };
    }
  }
}

export class PermissionTreeProvider implements vscode.TreeDataProvider<PermissionTreeItem>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<PermissionTreeItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private auditLog: PermissionAuditEntry[] = [];
  private disposables: vscode.Disposable[] = [];
  private permissionManager: PermissionManager | null = null;

  constructor() {}

  setPermissionManager(manager: PermissionManager): void {
    this.permissionManager = manager;
    this.syncFromManager();
  }

  recordDecision(toolName: string, targetPath: string | null, decision: PermissionDecision, riskLevel: string): void {
    const entry: PermissionAuditEntry = {
      id: `${toolName}:${targetPath ?? '*'}:${Date.now()}`,
      toolName,
      targetPath,
      decision,
      createdAt: new Date().toISOString(),
      riskLevel,
    };
    this.auditLog.push(entry);
    this._onDidChangeTreeData.fire(undefined);
  }

  private syncFromManager(): void {
    if (!this.permissionManager) return;
    const permissions = this.permissionManager.list();
    for (const perm of permissions) {
      const exists = this.auditLog.some((e) => e.id === perm.id);
      if (!exists) {
        this.auditLog.push({
          id: perm.id,
          toolName: perm.toolName,
          targetPath: perm.targetPath,
          decision: perm.decision,
          createdAt: perm.createdAt,
          riskLevel: 'unknown',
        });
      }
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: PermissionTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: PermissionTreeItem): PermissionTreeItem[] {
    if (!element) {
      return this.getRootItems();
    }
    if (element instanceof PermissionGroupItem) {
      return element.entries.map((entry) => new PermissionEntryItem(entry));
    }
    return [];
  }

  private getRootItems(): PermissionTreeItem[] {
    if (this.auditLog.length === 0) {
      return [];
    }

    const allowed = this.auditLog.filter(
      (e) => e.decision === 'allow_once' || e.decision === 'allow_always',
    );
    const denied = this.auditLog.filter((e) => e.decision === 'deny');

    const items: PermissionTreeItem[] = [];
    if (allowed.length > 0) {
      items.push(new PermissionGroupItem('Allowed', allowed));
    }
    if (denied.length > 0) {
      items.push(new PermissionGroupItem('Denied', denied));
    }
    return items;
  }

  refresh(): void {
    this.syncFromManager();
    this._onDidChangeTreeData.fire(undefined);
  }

  async exportAuditLog(): Promise<void> {
    if (this.auditLog.length === 0) {
      vscode.window.showInformationMessage('Agent-X: No permission entries to export.');
      return;
    }

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`agentx-permissions-${Date.now()}.json`),
      filters: { 'JSON Files': ['json'], 'All Files': ['*'] },
    });

    if (!uri) return;

    const content = JSON.stringify(this.auditLog, null, 2);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
    vscode.window.showInformationMessage(`Agent-X: Audit log exported to ${uri.fsPath}`);
  }

  async revokeEntry(entry: PermissionAuditEntry): Promise<void> {
    if (this.permissionManager) {
      this.permissionManager.revoke(entry.toolName, entry.targetPath ?? undefined);
    }
    this.auditLog = this.auditLog.filter((e) => e.id !== entry.id);
    this._onDidChangeTreeData.fire(undefined);
    vscode.window.showInformationMessage(
      `Agent-X: Permission for "${entry.toolName}" revoked.`,
    );
  }

  async clearAll(): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      'Agent-X: Clear all permission decisions? This will reset all tool permissions to default.',
      { modal: true },
      'Clear All',
    );

    if (confirm !== 'Clear All') return;

    if (this.permissionManager) {
      this.permissionManager.revokeAll();
    }
    this.auditLog = [];
    this._onDidChangeTreeData.fire(undefined);
    vscode.window.showInformationMessage('Agent-X: All permissions cleared.');
  }

  getAuditLog(): ReadonlyArray<PermissionAuditEntry> {
    return this.auditLog;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
```

**Acceptance Criteria**:
- Implements `vscode.TreeDataProvider<PermissionTreeItem>`
- Root level shows two groups: "Allowed" and "Denied"
- Each group is collapsible and shows count in description
- Leaf items show tool name as label, path as description
- Icons: check/pass-filled for allowed, circle-slash for denied
- Color-coded: green for allowed, red for denied
- Tooltip shows full details: tool, path, decision, risk level, timestamp
- Clicking an item with a path opens the file
- `recordDecision()` adds entries from the PermissionHandler
- `syncFromManager()` pulls persisted permissions from PermissionManager
- `exportAuditLog()` saves JSON via save dialog
- `revokeEntry()` removes from PermissionManager and audit log
- `clearAll()` shows confirmation modal before clearing
- `refresh()` re-syncs from PermissionManager and fires tree data change

---

### T6.3.2: Tree View Registration and Commands

Register in `extension.ts` during activation:

```typescript
// In extension.ts activate():

import { PermissionTreeProvider } from './providers/PermissionTreeProvider';

const permissionTreeProvider = new PermissionTreeProvider();
const permissionTreeView = vscode.window.createTreeView('agentx.permissionsView', {
  treeDataProvider: permissionTreeProvider,
  showCollapseAll: true,
});
context.subscriptions.push(permissionTreeView, permissionTreeProvider);

context.subscriptions.push(
  vscode.commands.registerCommand('agentx.revokePermission', (item: PermissionEntryItem) => {
    permissionTreeProvider.revokeEntry(item.entry);
  }),
  vscode.commands.registerCommand('agentx.clearPermissions', () => {
    permissionTreeProvider.clearAll();
  }),
  vscode.commands.registerCommand('agentx.exportPermissionLog', () => {
    permissionTreeProvider.exportAuditLog();
  }),
  vscode.commands.registerCommand('agentx.refreshPermissions', () => {
    permissionTreeProvider.refresh();
  }),
);
```

Add to `package.json` under `contributes.views["agentx-explorer"]`:

```json
{
  "id": "agentx.permissionsView",
  "name": "Permissions",
  "when": "agentx.initialized"
}
```

Add to `package.json` under `contributes.menus["view/title"]`:

```json
[
  {
    "command": "agentx.refreshPermissions",
    "when": "view == agentx.permissionsView",
    "group": "navigation"
  },
  {
    "command": "agentx.clearPermissions",
    "when": "view == agentx.permissionsView"
  },
  {
    "command": "agentx.exportPermissionLog",
    "when": "view == agentx.permissionsView"
  }
]
```

Add to `package.json` under `contributes.menus["view/item/context"]`:

```json
[
  {
    "command": "agentx.revokePermission",
    "when": "view == agentx.permissionsView && viewItem == permissionEntry",
    "group": "inline"
  }
]
```

**Acceptance Criteria**:
- Tree view registered under `agentx-explorer` container as "Permissions"
- Only visible when `agentx.initialized` context key is set
- `showCollapseAll` enabled for expanding/collapsing groups
- Four commands registered: revoke, clear, export, refresh
- View title menu: refresh (navigation group), clear, export
- Item context menu: revoke (inline for quick access)

---

## T6.4: Scope Guard Integration

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/ScopeGuardAdapter.ts`
**Estimated Effort**: 3 hours

### T6.4.1: Multi-Root Workspace Scope Guard

```typescript
// packages/vscode/src/adapter/ScopeGuardAdapter.ts

import * as vscode from 'vscode';
import { ScopeGuard } from '@agentx/engine';
import type { EventBridge, Disposable } from './types';

export interface ScopeValidationResult {
  valid: boolean;
  resolved: string;
  error?: string;
  workspaceFolder?: vscode.WorkspaceFolder;
}

export class ScopeGuardAdapter implements vscode.Disposable {
  private scopeGuards: Map<string, ScopeGuard> = new Map();
  private disposables: vscode.Disposable[] = [];
  private outputChannel: vscode.OutputChannel;

  constructor(
    private readonly eventBridge: EventBridge,
    outputChannel: vscode.OutputChannel,
  ) {
    this.outputChannel = outputChannel;
    this.initializeGuards();

    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders((e) => {
        for (const removed of e.removed) {
          this.scopeGuards.delete(removed.uri.fsPath);
        }
        for (const added of e.added) {
          this.createGuard(added);
        }
        this.outputChannel.appendLine(
          `[ScopeGuard] Workspace folders changed. Active scopes: ${this.getScopeRoots().join(', ')}`,
        );
      }),
    );
  }

  private initializeGuards(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return;
    for (const folder of folders) {
      this.createGuard(folder);
    }
  }

  private createGuard(folder: vscode.WorkspaceFolder): void {
    const guard = new ScopeGuard(folder.uri.fsPath, true);
    this.scopeGuards.set(folder.uri.fsPath, guard);
    this.outputChannel.appendLine(
      `[ScopeGuard] Initialized scope: ${folder.uri.fsPath} (git-aware)`,
    );
  }

  validatePath(targetPath: string): ScopeValidationResult {
    for (const [root, guard] of this.scopeGuards) {
      const result = guard.validatePath(targetPath);
      if (result.valid) {
        const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(targetPath));
        return {
          valid: true,
          resolved: result.resolved,
          workspaceFolder: folder,
        };
      }
    }

    const primaryGuard = this.getPrimaryGuard();
    if (primaryGuard) {
      const result = primaryGuard.validatePath(targetPath);
      return {
        valid: false,
        resolved: result.resolved,
        error: result.error ?? `Path is outside all workspace folders: ${targetPath}`,
      };
    }

    return {
      valid: false,
      resolved: targetPath,
      error: 'No workspace folder is open',
    };
  }

  isWithinScope(targetPath: string): boolean {
    for (const guard of this.scopeGuards.values()) {
      if (guard.isWithinScope(targetPath)) return true;
    }
    return false;
  }

  showBlockedNotification(targetPath: string, error: string): void {
    const message = `Agent-X: Operation blocked — ${error}`;
    vscode.window.showErrorMessage(message, 'Show Scope').then((action) => {
      if (action === 'Show Scope') {
        const roots = this.getScopeRoots();
        if (roots.length > 0) {
          vscode.window.showInformationMessage(
            `Allowed workspace folders:\n${roots.map((r) => `  • ${r}`).join('\n')}`,
          );
        }
      }
    });
    this.outputChannel.appendLine(`[ScopeGuard] BLOCKED: ${targetPath} — ${error}`);
  }

  getPrimaryGuard(): ScopeGuard | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;
    return this.scopeGuards.get(folders[0].uri.fsPath) ?? null;
  }

  getScopeRoots(): string[] {
    return Array.from(this.scopeGuards.keys());
  }

  getPrimaryScopeRoot(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;
    return folders[0].uri.fsPath;
  }

  updateScopePath(newRoot: string): void {
    const existingGuard = this.scopeGuards.get(newRoot);
    if (!existingGuard) {
      const guard = new ScopeGuard(newRoot, true);
      this.scopeGuards.set(newRoot, guard);
      this.outputChannel.appendLine(`[ScopeGuard] Added scope: ${newRoot}`);
    }
  }

  getGuardForPath(targetPath: string): ScopeGuard | null {
    for (const [root, guard] of this.scopeGuards) {
      if (targetPath.startsWith(root)) return guard;
    }
    return this.getPrimaryGuard();
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
    this.scopeGuards.clear();
  }
}
```

**Acceptance Criteria**:
- Creates one `ScopeGuard` per workspace folder, all git-aware
- Listens for `onDidChangeWorkspaceFolders` to add/remove guards dynamically
- `validatePath()` checks against all workspace folders, returns first match
- `isWithinScope()` returns `true` if path is within any workspace folder
- `showBlockedNotification()` shows error with "Show Scope" action that lists allowed roots
- `getPrimaryGuard()` returns the guard for the first workspace folder
- `getScopeRoots()` returns all workspace folder paths
- `getGuardForPath()` returns the guard whose root is a prefix of the target path
- `updateScopePath()` adds a new scope if not already tracked
- Output channel logs all scope changes and blocked operations

---

### T6.4.2: Scope Guard Integration with Engine

Wire the ScopeGuardAdapter into the engine's ToolExecutor during extension activation:

```typescript
// In extension.ts, after engine initialization:

import { ScopeGuardAdapter } from './adapter/ScopeGuardAdapter';

const scopeGuardAdapter = new ScopeGuardAdapter(eventBridge, outputChannel);
context.subscriptions.push(scopeGuardAdapter);

// After engine is ready, sync scope:
eventBridge.onMeta((event) => {
  if (event.type === 'tool_executing') {
    // Scope validation is handled by engine's ToolExecutor internally,
    // but we override the scope path for VS Code workspace awareness
  }
});

// When workspace folders change, update the engine's scope:
vscode.workspace.onDidChangeWorkspaceFolders(() => {
  const primaryRoot = scopeGuardAdapter.getPrimaryScopeRoot();
  if (primaryRoot) {
    const engine = engineLifecycle.getAgent();
    if (engine) {
      engine.getToolExecutor().setScopePath(primaryRoot);
    }
  }
});
```

**Acceptance Criteria**:
- ScopeGuardAdapter is created and disposed with the extension
- Engine's ToolExecutor scope path is synced to the primary workspace folder
- Workspace folder changes trigger scope path updates on the engine
- No modifications to engine code — uses existing `setScopePath()` API

---

## T6.5: Diff Preview Integration

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/adapter/DiffPreviewHandler.ts`
**Estimated Effort**: 5 hours

### T6.5.1: Virtual Document Provider

```typescript
// packages/vscode/src/adapter/DiffPreviewHandler.ts

import * as vscode from 'vscode';
import type { EventBridge, Disposable } from './types';

const AGENTX_DIFF_SCHEME = 'agentx-diff';

interface DiffPreviewRequest {
  tool: string;
  filePath: string;
  diff: string;
  oldContent?: string;
  newContent?: string;
}

class DiffDocumentProvider implements vscode.TextDocumentContentProvider {
  private documents = new Map<string, string>();
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  setContent(uri: vscode.Uri, content: string): void {
    this.documents.set(uri.toString(), content);
    this._onDidChange.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.documents.get(uri.toString()) ?? '';
  }

  remove(uri: vscode.Uri): void {
    this.documents.delete(uri.toString());
  }

  dispose(): void {
    this._onDidChange.dispose();
    this.documents.clear();
  }
}
```

**Acceptance Criteria**:
- Implements `vscode.TextDocumentContentProvider`
- Uses custom URI scheme `agentx-diff`
- `setContent()` stores content and fires change event
- `provideTextDocumentContent()` returns stored content for a URI
- `remove()` cleans up stored documents
- Properly disposable

---

### T6.5.2: DiffPreviewHandler Class

```typescript
export class DiffPreviewHandler implements vscode.Disposable {
  private disposables: Disposable[] = [];
  private documentProvider: DiffDocumentProvider;
  private documentProviderRegistration: vscode.Disposable | null = null;
  private activeDiffEditors = new Map<string, DiffPreviewRequest>();
  private pendingResolves = new Map<string, (accepted: boolean) => void>();
  private outputChannel: vscode.OutputChannel;

  constructor(
    private readonly eventBridge: EventBridge,
    outputChannel: vscode.OutputChannel,
  ) {
    this.outputChannel = outputChannel;
    this.documentProvider = new DiffDocumentProvider();

    this.documentProviderRegistration = vscode.workspace.registerTextDocumentContentProvider(
      AGENTX_DIFF_SCHEME,
      this.documentProvider,
    );

    this.disposables.push(
      this.eventBridge.onDiffPreview((preview) => this.handleDiffPreview(preview)),
    );

    this.disposables.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        if (doc.uri.scheme === AGENTX_DIFF_SCHEME) {
          this.documentProvider.remove(doc.uri);
        }
      }),
    );

    this.disposables.push(
      vscode.commands.registerCommand('agentx.diffAccept', () => this.acceptCurrentDiff()),
      vscode.commands.registerCommand('agentx.diffReject', () => this.rejectCurrentDiff()),
    );
  }

  private async handleDiffPreview(preview: DiffPreviewRequest): Promise<void> {
    this.outputChannel.appendLine(
      `[DiffPreview] Showing diff for ${preview.filePath} (tool: ${preview.tool})`,
    );

    const oldContent = preview.oldContent ?? '';
    const newContent = preview.newContent ?? '';

    const encodedPath = encodeURIComponent(preview.filePath);
    const timestamp = Date.now();
    const oldUri = vscode.Uri.parse(
      `${AGENTX_DIFF_SCHEME}:original/${encodedPath}?t=${timestamp}`,
    );
    const newUri = vscode.Uri.parse(
      `${AGENTX_DIFF_SCHEME}:modified/${encodedPath}?t=${timestamp}`,
    );

    this.documentProvider.setContent(oldUri, oldContent);
    this.documentProvider.setContent(newUri, newContent);

    const fileName = preview.filePath.split('/').pop() ?? preview.filePath;
    const title = `${fileName} (Original ↔ Modified by ${preview.tool})`;

    this.activeDiffEditors.set(preview.filePath, preview);

    try {
      await vscode.commands.executeCommand('vscode.diff', oldUri, newUri, title, {
        preview: true,
        preserveFocus: false,
      });
    } catch (error) {
      this.outputChannel.appendLine(
        `[DiffPreview] Failed to open diff editor: ${error}`,
      );
    }
  }

  registerDiffResolve(filePath: string, resolve: (accepted: boolean) => void): void {
    this.pendingResolves.set(filePath, resolve);
  }

  private acceptCurrentDiff(): void {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) return;

    for (const [filePath, resolve] of this.pendingResolves) {
      resolve(true);
      this.pendingResolves.delete(filePath);
      this.activeDiffEditors.delete(filePath);
      this.outputChannel.appendLine(`[DiffPreview] Accepted: ${filePath}`);
      vscode.window.showInformationMessage(`Agent-X: Changes to ${filePath} accepted.`);
      this.closeDiffEditor();
      return;
    }

    vscode.window.showInformationMessage('Agent-X: No pending diff to accept.');
  }

  private rejectCurrentDiff(): void {
    for (const [filePath, resolve] of this.pendingResolves) {
      resolve(false);
      this.pendingResolves.delete(filePath);
      this.activeDiffEditors.delete(filePath);
      this.outputChannel.appendLine(`[DiffPreview] Rejected: ${filePath}`);
      vscode.window.showInformationMessage(`Agent-X: Changes to ${filePath} rejected.`);
      this.closeDiffEditor();
      return;
    }

    vscode.window.showInformationMessage('Agent-X: No pending diff to reject.');
  }

  private closeDiffEditor(): void {
    vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  }

  getActiveDiffs(): string[] {
    return Array.from(this.activeDiffEditors.keys());
  }

  dispose(): void {
    for (const resolve of this.pendingResolves.values()) {
      resolve(false);
    }
    this.pendingResolves.clear();
    this.activeDiffEditors.clear();

    if (this.documentProviderRegistration) {
      this.documentProviderRegistration.dispose();
    }
    this.documentProvider.dispose();

    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
```

**Acceptance Criteria**:
- Registers `DiffDocumentProvider` for the `agentx-diff` URI scheme
- Subscribes to `eventBridge.onDiffPreview()`
- Creates two virtual URIs (original and modified) with timestamp to avoid caching
- Opens VS Code's native diff editor via `vscode.commands.executeCommand('vscode.diff', ...)`
- Diff title shows filename and tool name
- `agentx.diffAccept` command resolves the pending diff as accepted
- `agentx.diffReject` command resolves the pending diff as rejected
- Closes the diff editor tab after accept/reject
- On dispose, all pending diffs are rejected
- Cleans up virtual documents when text documents are closed
- Output channel logs all diff operations

---

### T6.5.3: Diff Toolbar Commands

Add to `package.json` under `contributes.commands`:

```json
[
  {
    "command": "agentx.diffAccept",
    "title": "Agent-X: Accept Changes",
    "icon": "$(check)"
  },
  {
    "command": "agentx.diffReject",
    "title": "Agent-X: Reject Changes",
    "icon": "$(close)"
  }
]
```

Add to `package.json` under `contributes.menus["editor/title"]`:

```json
[
  {
    "command": "agentx.diffAccept",
    "when": "resourceScheme == agentx-diff",
    "group": "navigation@1"
  },
  {
    "command": "agentx.diffReject",
    "when": "resourceScheme == agentx-diff",
    "group": "navigation@2"
  }
]
```

**Acceptance Criteria**:
- Accept button (checkmark icon) appears in diff editor toolbar
- Reject button (close icon) appears in diff editor toolbar
- Buttons only visible when the active editor's resource scheme is `agentx-diff`
- Accept is first in navigation group, Reject is second

---

## T6.6: Verification & Testing

**Status**: ⬜ Not Started
**File**: `packages/vscode/test/adapter/PermissionHandler.test.ts`, `packages/vscode/test/adapter/PermissionSettings.test.ts`, `packages/vscode/test/providers/PermissionTreeProvider.test.ts`, `packages/vscode/test/adapter/ScopeGuardAdapter.test.ts`, `packages/vscode/test/adapter/DiffPreviewHandler.test.ts`
**Estimated Effort**: 5 hours

### T6.6.1: PermissionHandler Tests

```typescript
// packages/vscode/test/adapter/PermissionHandler.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PermissionHandler, isReadOnlyTool } from '../../src/adapter/PermissionHandler';
import type { PermissionRequest, PermissionChoice } from '../../src/adapter/types';

const mockVSCode = {
  window: {
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
  },
};

vi.mock('vscode', () => mockVSCode);

function createMockEventBridge() {
  const handlers: Array<(req: PermissionRequest) => void> = [];
  return {
    onPermission: (handler: (req: PermissionRequest) => void) => {
      handlers.push(handler);
      return { dispose: () => {} };
    },
    fire: (req: PermissionRequest) => {
      for (const h of handlers) h(req);
    },
  };
}

function createMockSettings(overrides: Record<string, unknown> = {}) {
  return {
    getAutoApproveLowRisk: () => (overrides['autoApproveLowRisk'] as boolean) ?? false,
    getAutoApproveReadOnly: () => (overrides['autoApproveReadOnly'] as boolean) ?? true,
    getTimeout: () => (overrides['timeout'] as number) ?? 60,
    getDefaultDecision: () => (overrides['defaultDecision'] as string) ?? 'ask',
    onDidChange: { event: vi.fn() },
    dispose: vi.fn(),
  };
}

function createMockOutputChannel() {
  return {
    appendLine: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  } as unknown as import('vscode').OutputChannel;
}

function createMockAgent() {
  return {
    respondToPermission: vi.fn(),
  };
}

describe('PermissionHandler', () => {
  let bridge: ReturnType<typeof createMockEventBridge>;
  let handler: PermissionHandler;
  let agent: ReturnType<typeof createMockAgent>;

  beforeEach(() => {
    bridge = createMockEventBridge();
    agent = createMockAgent();
    vi.useFakeTimers();
  });

  afterEach(() => {
    handler?.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('auto-approves read-only tools when autoApproveReadOnly is true', () => {
    const settings = createMockSettings({ autoApproveReadOnly: true });
    handler = new PermissionHandler(bridge as any, settings as any, createMockOutputChannel());
    handler.setAgent(agent as any);

    bridge.fire({ tool: 'file_read', path: '/test.ts', riskLevel: 'low', timestamp: Date.now() });

    expect(agent.respondToPermission).toHaveBeenCalledWith('allow_once');
  });

  it('auto-approves low-risk tools when autoApproveLowRisk is true', () => {
    const settings = createMockSettings({ autoApproveLowRisk: true, autoApproveReadOnly: false });
    handler = new PermissionHandler(bridge as any, settings as any, createMockOutputChannel());
    handler.setAgent(agent as any);

    bridge.fire({ tool: 'shell_exec', path: '*', riskLevel: 'low', timestamp: Date.now() });

    expect(agent.respondToPermission).toHaveBeenCalledWith('allow_once');
  });

  it('shows critical modal for critical risk', async () => {
    const settings = createMockSettings({ autoApproveReadOnly: false });
    handler = new PermissionHandler(bridge as any, settings as any, createMockOutputChannel());
    handler.setAgent(agent as any);

    mockVSCode.window.showWarningMessage.mockResolvedValue('Allow Once');

    bridge.fire({ tool: 'shell_exec', path: '/dangerous', riskLevel: 'critical', timestamp: Date.now() });

    await vi.waitFor(() => {
      expect(mockVSCode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('CRITICAL'),
        expect.objectContaining({ modal: true }),
        'Allow Once',
        'Allow Always',
        'Deny',
      );
    });
  });

  it('auto-denies on timeout', () => {
    const settings = createMockSettings({ timeout: 10, autoApproveReadOnly: false });
    handler = new PermissionHandler(bridge as any, settings as any, createMockOutputChannel());
    handler.setAgent(agent as any);

    mockVSCode.window.showWarningMessage.mockReturnValue(new Promise(() => {}));

    bridge.fire({ tool: 'file_write', path: '/test.ts', riskLevel: 'high', timestamp: Date.now() });

    vi.advanceTimersByTime(10_000);

    expect(agent.respondToPermission).toHaveBeenCalledWith('deny');
  });

  it('respects defaultDecision=allow', () => {
    const settings = createMockSettings({ defaultDecision: 'allow', autoApproveReadOnly: false });
    handler = new PermissionHandler(bridge as any, settings as any, createMockOutputChannel());
    handler.setAgent(agent as any);

    bridge.fire({ tool: 'file_write', path: '/test.ts', riskLevel: 'high', timestamp: Date.now() });

    expect(agent.respondToPermission).toHaveBeenCalledWith('allow_once');
  });

  it('respects defaultDecision=deny', () => {
    const settings = createMockSettings({ defaultDecision: 'deny', autoApproveReadOnly: false });
    handler = new PermissionHandler(bridge as any, settings as any, createMockOutputChannel());
    handler.setAgent(agent as any);

    bridge.fire({ tool: 'file_write', path: '/test.ts', riskLevel: 'high', timestamp: Date.now() });

    expect(agent.respondToPermission).toHaveBeenCalledWith('deny');
  });

  it('queues multiple requests and processes sequentially', async () => {
    const settings = createMockSettings({ autoApproveReadOnly: false });
    handler = new PermissionHandler(bridge as any, settings as any, createMockOutputChannel());
    handler.setAgent(agent as any);

    let resolveFirst: ((val: string | undefined) => void) | undefined;
    mockVSCode.window.showWarningMessage.mockImplementation(() => {
      return new Promise<string | undefined>((resolve) => {
        if (!resolveFirst) resolveFirst = resolve;
      });
    });

    bridge.fire({ tool: 'file_write', path: '/a.ts', riskLevel: 'high', timestamp: Date.now() });
    bridge.fire({ tool: 'file_write', path: '/b.ts', riskLevel: 'high', timestamp: Date.now() });

    expect(handler.getPendingCount()).toBe(2);

    resolveFirst!('Deny');
    await vi.waitFor(() => {
      expect(agent.respondToPermission).toHaveBeenCalledWith('deny');
    });
  });
});

describe('isReadOnlyTool', () => {
  it('returns true for read-only tools', () => {
    expect(isReadOnlyTool('file_read')).toBe(true);
    expect(isReadOnlyTool('code_search')).toBe(true);
    expect(isReadOnlyTool('git_status')).toBe(true);
    expect(isReadOnlyTool('git_log')).toBe(true);
    expect(isReadOnlyTool('web_fetch')).toBe(true);
  });

  it('returns false for write tools', () => {
    expect(isReadOnlyTool('file_write')).toBe(false);
    expect(isReadOnlyTool('shell_exec')).toBe(false);
    expect(isReadOnlyTool('code_replace')).toBe(false);
    expect(isReadOnlyTool('git_commit')).toBe(false);
  });
});
```

---

### T6.6.2: PermissionSettings Tests

```typescript
// packages/vscode/test/adapter/PermissionSettings.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermissionSettings } from '../../src/adapter/PermissionSettings';

const mockConfig: Record<string, unknown> = {};

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: (section: string) => ({
      get: (key: string, defaultValue: unknown) => {
        const fullKey = `${section}.${key}`;
        return mockConfig[fullKey] ?? defaultValue;
      },
      update: vi.fn(async (key: string, value: unknown) => {
        mockConfig[`${section}.${key}`] = value;
      }),
    }),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: () => {} })),
  },
  EventEmitter: class {
    event = vi.fn();
    fire = vi.fn();
    dispose = vi.fn();
  },
  ConfigurationTarget: { Global: 1 },
}));

describe('PermissionSettings', () => {
  let settings: PermissionSettings;

  beforeEach(() => {
    for (const key of Object.keys(mockConfig)) delete mockConfig[key];
    settings = new PermissionSettings();
  });

  it('returns default values', () => {
    expect(settings.getAutoApproveLowRisk()).toBe(false);
    expect(settings.getAutoApproveReadOnly()).toBe(true);
    expect(settings.getTimeout()).toBe(60);
    expect(settings.getDefaultDecision()).toBe('ask');
  });

  it('reads configured values', () => {
    mockConfig['agentx.permissions.autoApproveLowRisk'] = true;
    mockConfig['agentx.permissions.timeout'] = 120;
    mockConfig['agentx.permissions.defaultDecision'] = 'deny';

    expect(settings.getAutoApproveLowRisk()).toBe(true);
    expect(settings.getTimeout()).toBe(120);
    expect(settings.getDefaultDecision()).toBe('deny');
  });

  it('clamps timeout between 5 and 600', () => {
    mockConfig['agentx.permissions.timeout'] = 2;
    expect(settings.getTimeout()).toBe(5);

    mockConfig['agentx.permissions.timeout'] = 1000;
    expect(settings.getTimeout()).toBe(600);
  });
});
```

---

### T6.6.3: PermissionTreeProvider Tests

```typescript
// packages/vscode/test/providers/PermissionTreeProvider.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermissionTreeProvider } from '../../src/providers/PermissionTreeProvider';

vi.mock('vscode', () => ({
  TreeItem: class {
    label: string;
    collapsibleState: number;
    contextValue?: string;
    description?: string;
    tooltip?: unknown;
    iconPath?: unknown;
    command?: unknown;
    constructor(label: string, collapsibleState: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class {
    constructor(public id: string, public color?: unknown) {}
  },
  ThemeColor: class {
    constructor(public id: string) {}
  },
  EventEmitter: class {
    event = vi.fn();
    fire = vi.fn();
    dispose = vi.fn();
  },
  Uri: { file: (p: string) => ({ fsPath: p, toString: () => p }) },
  window: {
    showWarningMessage: vi.fn().mockResolvedValue('Clear All'),
    showInformationMessage: vi.fn(),
    showSaveDialog: vi.fn(),
  },
  workspace: {
    fs: { writeFile: vi.fn() },
  },
  MarkdownString: class {
    value: string;
    constructor(value: string) { this.value = value; }
  },
}));

describe('PermissionTreeProvider', () => {
  let provider: PermissionTreeProvider;

  beforeEach(() => {
    provider = new PermissionTreeProvider();
  });

  it('returns empty array when no entries', () => {
    const children = provider.getChildren();
    expect(children).toEqual([]);
  });

  it('groups entries into Allowed and Denied', () => {
    provider.recordDecision('file_read', '/test.ts', 'allow_once', 'low');
    provider.recordDecision('file_write', '/test.ts', 'deny', 'high');

    const roots = provider.getChildren();
    expect(roots.length).toBe(2);
    expect((roots[0] as any).groupLabel).toBe('Allowed');
    expect((roots[1] as any).groupLabel).toBe('Denied');
  });

  it('returns entry items as children of groups', () => {
    provider.recordDecision('file_read', '/a.ts', 'allow_once', 'low');
    provider.recordDecision('file_read', '/b.ts', 'allow_always', 'low');

    const roots = provider.getChildren();
    const children = provider.getChildren(roots[0]);
    expect(children.length).toBe(2);
  });

  it('records and retrieves audit log', () => {
    provider.recordDecision('file_write', '/test.ts', 'allow_once', 'high');
    const log = provider.getAuditLog();
    expect(log.length).toBe(1);
    expect(log[0].toolName).toBe('file_write');
    expect(log[0].decision).toBe('allow_once');
  });

  it('revokes entry from audit log', async () => {
    provider.recordDecision('file_write', '/test.ts', 'allow_always', 'high');
    const log = provider.getAuditLog();
    await provider.revokeEntry(log[0]);
    expect(provider.getAuditLog().length).toBe(0);
  });
});
```

---

### T6.6.4: ScopeGuardAdapter Tests

```typescript
// packages/vscode/test/adapter/ScopeGuardAdapter.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScopeGuardAdapter } from '../../src/adapter/ScopeGuardAdapter';

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [
      { uri: { fsPath: '/workspace/project-a' }, name: 'project-a', index: 0 },
      { uri: { fsPath: '/workspace/project-b' }, name: 'project-b', index: 1 },
    ],
    onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: () => {} })),
    getWorkspaceFolder: vi.fn(),
  },
  Uri: { file: (p: string) => ({ fsPath: p }) },
  window: {
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
  },
  EventEmitter: class {
    event = vi.fn();
    fire = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock('@agentx/engine', () => ({
  ScopeGuard: class {
    constructor(private root: string) {}
    isWithinScope(path: string): boolean {
      return path.startsWith(this.root);
    }
    validatePath(path: string) {
      if (path.startsWith(this.root)) {
        return { valid: true, resolved: path };
      }
      return { valid: false, resolved: path, error: `Path outside scope: ${path}` };
    }
    getScopePath(): string {
      return this.root;
    }
  },
}));

describe('ScopeGuardAdapter', () => {
  let adapter: ScopeGuardAdapter;
  const mockBridge = { onDiffPreview: vi.fn(() => ({ dispose: () => {} })) } as any;
  const mockOutput = { appendLine: vi.fn() } as any;

  beforeEach(() => {
    adapter = new ScopeGuardAdapter(mockBridge, mockOutput);
  });

  it('validates paths within workspace', () => {
    const result = adapter.validatePath('/workspace/project-a/src/index.ts');
    expect(result.valid).toBe(true);
  });

  it('rejects paths outside workspace', () => {
    const result = adapter.validatePath('/etc/passwd');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('supports multi-root workspaces', () => {
    expect(adapter.isWithinScope('/workspace/project-a/file.ts')).toBe(true);
    expect(adapter.isWithinScope('/workspace/project-b/file.ts')).toBe(true);
    expect(adapter.isWithinScope('/other/path')).toBe(false);
  });

  it('returns all scope roots', () => {
    const roots = adapter.getScopeRoots();
    expect(roots).toContain('/workspace/project-a');
    expect(roots).toContain('/workspace/project-b');
  });

  it('returns primary scope root', () => {
    expect(adapter.getPrimaryScopeRoot()).toBe('/workspace/project-a');
  });
});
```

---

### T6.6.5: DiffPreviewHandler Tests

```typescript
// packages/vscode/test/adapter/DiffPreviewHandler.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiffPreviewHandler } from '../../src/adapter/DiffPreviewHandler';

const mockExecuteCommand = vi.fn();
const mockRegisterProvider = vi.fn(() => ({ dispose: () => {} }));

vi.mock('vscode', () => ({
  workspace: {
    registerTextDocumentContentProvider: (scheme: string, provider: unknown) => {
      mockRegisterProvider(scheme, provider);
      return { dispose: () => {} };
    },
    onDidCloseTextDocument: vi.fn(() => ({ dispose: () => {} })),
  },
  commands: {
    executeCommand: (...args: unknown[]) => mockExecuteCommand(...args),
    registerCommand: vi.fn(() => ({ dispose: () => {} })),
  },
  Uri: {
    parse: (s: string) => ({ toString: () => s, scheme: s.split(':')[0] }),
  },
  window: {
    activeTextEditor: undefined,
    showInformationMessage: vi.fn(),
  },
  EventEmitter: class {
    event = vi.fn();
    fire = vi.fn();
    dispose = vi.fn();
  },
}));

describe('DiffPreviewHandler', () => {
  let handler: DiffPreviewHandler;
  let diffPreviewHandlers: Array<(preview: any) => void>;

  beforeEach(() => {
    diffPreviewHandlers = [];
    const mockBridge = {
      onDiffPreview: (h: (preview: any) => void) => {
        diffPreviewHandlers.push(h);
        return { dispose: () => {} };
      },
    };
    handler = new DiffPreviewHandler(mockBridge as any, { appendLine: vi.fn() } as any);
    mockExecuteCommand.mockClear();
  });

  it('opens diff editor on diff_preview event', async () => {
    for (const h of diffPreviewHandlers) {
      h({
        tool: 'file_write',
        filePath: '/test.ts',
        diff: '--- a\n+++ b',
        oldContent: 'old',
        newContent: 'new',
      });
    }

    await vi.waitFor(() => {
      expect(mockExecuteCommand).toHaveBeenCalledWith(
        'vscode.diff',
        expect.anything(),
        expect.anything(),
        expect.stringContaining('test.ts'),
        expect.objectContaining({ preview: true }),
      );
    });
  });

  it('tracks active diffs', () => {
    for (const h of diffPreviewHandlers) {
      h({
        tool: 'file_write',
        filePath: '/test.ts',
        diff: '--- a\n+++ b',
        oldContent: 'old',
        newContent: 'new',
      });
    }

    expect(handler.getActiveDiffs()).toContain('/test.ts');
  });

  it('cleans up on dispose', () => {
    handler.dispose();
    expect(handler.getActiveDiffs()).toEqual([]);
  });
});
```

---

### T6.6.6: Integration Test — Full Permission Flow

```typescript
// packages/vscode/test/integration/permission-flow.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Permission Flow Integration', () => {
  it('read-only tool is auto-approved without user interaction', async () => {
    // 1. Create PermissionSettings with autoApproveReadOnly=true
    // 2. Create PermissionHandler with settings
    // 3. Fire permission_required event for file_read
    // 4. Assert agent.respondToPermission called with 'allow_once'
    // 5. Assert no VS Code modal was shown
  });

  it('critical tool shows modal and resolves on user choice', async () => {
    // 1. Create PermissionHandler with default settings
    // 2. Fire permission_required event for shell_exec with critical risk
    // 3. Mock showWarningMessage to return 'Allow Once'
    // 4. Assert agent.respondToPermission called with 'allow_once'
  });

  it('timeout auto-denies when user does not respond', async () => {
    // 1. Create PermissionHandler with timeout=5
    // 2. Fire permission_required event
    // 3. Advance timers by 5000ms
    // 4. Assert agent.respondToPermission called with 'deny'
    // 5. Assert warning notification shown about timeout
  });

  it('Allow Always persists via PermissionManager', async () => {
    // 1. Create PermissionHandler with mock PermissionManager
    // 2. Fire permission_required event
    // 3. Mock user choosing 'Allow Always'
    // 4. Assert PermissionManager.grant called with 'allow_always'
    // 5. Assert subsequent requests for same tool are auto-approved
  });

  it('scope guard blocks operations outside workspace', async () => {
    // 1. Create ScopeGuardAdapter with workspace at /project
    // 2. Validate path /etc/passwd
    // 3. Assert validation returns invalid
    // 4. Call showBlockedNotification
    // 5. Assert error notification shown
  });

  it('diff preview opens editor and resolves on accept', async () => {
    // 1. Create DiffPreviewHandler
    // 2. Fire diff_preview event
    // 3. Assert vscode.diff command executed
    // 4. Trigger accept command
    // 5. Assert resolve callback called with true
  });

  it('diff preview resolves on reject', async () => {
    // 1. Create DiffPreviewHandler
    // 2. Fire diff_preview event
    // 3. Trigger reject command
    // 4. Assert resolve callback called with false
  });

  it('permission audit view reflects all decisions', async () => {
    // 1. Create PermissionTreeProvider
    // 2. Record multiple decisions (allow, deny, allow_always)
    // 3. Assert tree has Allowed and Denied groups
    // 4. Assert correct number of children in each group
    // 5. Revoke one entry
    // 6. Assert tree updates
  });
});
```

---

## Summary — Files Created

| File | Description | Est. Lines |
|------|-------------|------------|
| `packages/vscode/src/adapter/PermissionHandler.ts` | Permission event bridge to VS Code UI | ~280 |
| `packages/vscode/src/adapter/PermissionSettings.ts` | VS Code settings for permission behavior | ~100 |
| `packages/vscode/src/providers/PermissionTreeProvider.ts` | TreeDataProvider for permission audit | ~260 |
| `packages/vscode/src/adapter/ScopeGuardAdapter.ts` | Multi-root workspace scope guard | ~170 |
| `packages/vscode/src/adapter/DiffPreviewHandler.ts` | Diff editor integration with accept/reject | ~220 |
| `packages/vscode/test/adapter/PermissionHandler.test.ts` | Permission handler unit tests | ~180 |
| `packages/vscode/test/adapter/PermissionSettings.test.ts` | Permission settings unit tests | ~60 |
| `packages/vscode/test/providers/PermissionTreeProvider.test.ts` | Tree provider unit tests | ~80 |
| `packages/vscode/test/adapter/ScopeGuardAdapter.test.ts` | Scope guard adapter unit tests | ~70 |
| `packages/vscode/test/adapter/DiffPreviewHandler.test.ts` | Diff preview handler unit tests | ~70 |
| `packages/vscode/test/integration/permission-flow.test.ts` | Integration test scenarios | ~80 |

**Total estimated**: ~1,570 lines of implementation + tests

---

## package.json Changes Summary

### New Commands

| Command | Title |
|---------|-------|
| `agentx.diffAccept` | Agent-X: Accept Changes |
| `agentx.diffReject` | Agent-X: Reject Changes |
| `agentx.revokePermission` | Agent-X: Revoke Permission |
| `agentx.clearPermissions` | Agent-X: Clear All Permissions |
| `agentx.exportPermissionLog` | Agent-X: Export Permission Audit Log |
| `agentx.refreshPermissions` | Agent-X: Refresh Permissions View |

### New Settings

| Setting | Type | Default |
|---------|------|---------|
| `agentx.permissions.autoApproveLowRisk` | boolean | `false` |
| `agentx.permissions.autoApproveReadOnly` | boolean | `true` |
| `agentx.permissions.timeout` | number | `60` |
| `agentx.permissions.defaultDecision` | string (enum) | `"ask"` |

### New Views

| View ID | Container | Name |
|---------|-----------|------|
| `agentx.permissionsView` | `agentx-explorer` | Permissions |

### New Menus

- **editor/title**: `agentx.diffAccept` and `agentx.diffReject` (when `resourceScheme == agentx-diff`)
- **view/title**: refresh, clear, export (when `view == agentx.permissionsView`)
- **view/item/context**: revoke (when `viewItem == permissionEntry`)
