# Phase 3: Extension Core — Activation, Commands, Status Bar, Configuration

> **Status**: ⬜ Not Started
> **Depends on**: Phase 2 (Engine Adapter)
> **Estimated Effort**: 3 days
> **Files Modified/Created**: `packages/vscode/src/extension.ts`, `packages/vscode/src/commands/`, `packages/vscode/src/statusbar/`, `packages/vscode/src/config/`, `packages/vscode/src/context/`, `packages/vscode/src/wizard/`

---

## Overview

Phase 3 implements the VS Code extension's activation entry point, all command palette commands, status bar indicators, configuration synchronization, workspace folder handling, first-run setup wizard, and context key management. By the end of this phase, the extension will be fully wired to the engine adapter layer from Phase 2 and all UI touchpoints (commands, status bar, context keys) will be functional.

---

## T3.1: Extension Activation (`extension.ts`)

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/extension.ts`
**Estimated Effort**: 4 hours

### T3.1.1: Global Context Storage

Store the `ExtensionContext` in a module-level variable so other modules can access it without prop-drilling.

```typescript
// packages/vscode/src/extension.ts

import * as vscode from "vscode";
import { EngineLifecycle } from "./adapter/EngineLifecycle";
import { ConfigBridge } from "./adapter/ConfigBridge";
import { EventBridge } from "./adapter/EventBridge";
import { VSCodeEngine } from "./adapter/VSCodeEngine";
import { StatusBarManager } from "./statusbar/StatusBarManager";
import { ContextKeyManager } from "./context/ContextKeyManager";
import { registerAllCommands } from "./commands/registerAllCommands";
import { SessionTreeProvider } from "./views/SessionTreeProvider";
import { ChatViewProvider } from "./views/ChatViewProvider";
import { ConfigurationWatcher } from "./config/ConfigurationWatcher";
import { WorkspaceWatcher } from "./config/WorkspaceWatcher";
import { ConfigFileWatcher } from "./config/ConfigFileWatcher";
import { FirstRunWizard } from "./wizard/FirstRunWizard";
import { ConfigManager } from "@agentx/engine";

let extensionContext: vscode.ExtensionContext;
let engineLifecycle: EngineLifecycle;
let configBridge: ConfigBridge;
let eventBridge: EventBridge;
let statusBarManager: StatusBarManager;
let contextKeyManager: ContextKeyManager;

export function getExtensionContext(): vscode.ExtensionContext {
  return extensionContext;
}

export function getEngineLifecycle(): EngineLifecycle {
  return engineLifecycle;
}

export function getConfigBridge(): ConfigBridge {
  return configBridge;
}

export function getEventBridge(): EventBridge {
  return eventBridge;
}

export function getStatusBarManager(): StatusBarManager {
  return statusBarManager;
}

export function getContextKeyManager(): ContextKeyManager {
  return contextKeyManager;
}
```

**Acceptance Criteria**:
- Module-level variables declared for all core managers
- Getter functions exported for cross-module access
- No circular dependency warnings at import time

---

### T3.1.2: `activate()` Function — Full Implementation

```typescript
export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  extensionContext = context;

  const outputChannel = vscode.window.createOutputChannel("Agent-X");
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine("[Agent-X] Extension activating...");

  // ── Step 1: Initialize ConfigBridge (reads ~/.config/agentx/config.json) ──
  configBridge = new ConfigBridge();
  await configBridge.initialize();

  // ── Step 2: Initialize ContextKeyManager ──
  contextKeyManager = new ContextKeyManager();
  context.subscriptions.push(contextKeyManager);

  const isConfigured = configBridge.hasValidConfig();
  contextKeyManager.set("agentx.isConfigured", isConfigured);

  // ── Step 3: First-run wizard if no config exists ──
  if (!isConfigured) {
    const wizard = new FirstRunWizard(configBridge);
    const completed = await wizard.run();
    if (!completed) {
      outputChannel.appendLine(
        "[Agent-X] First-run wizard cancelled. Extension partially active."
      );
      contextKeyManager.set("agentx.isConfigured", false);
    } else {
      contextKeyManager.set("agentx.isConfigured", true);
    }
  }

  // ── Step 4: Initialize EngineLifecycle (lazy — no Agent created yet) ──
  engineLifecycle = new EngineLifecycle(configBridge, outputChannel);
  context.subscriptions.push(engineLifecycle);

  // ── Step 5: Initialize EventBridge ──
  eventBridge = new EventBridge(engineLifecycle);
  context.subscriptions.push(eventBridge);

  // ── Step 6: Initialize StatusBarManager ──
  statusBarManager = new StatusBarManager(configBridge, engineLifecycle);
  context.subscriptions.push(statusBarManager);

  // ── Step 7: Register all commands ──
  registerAllCommands(context, {
    engineLifecycle,
    configBridge,
    eventBridge,
    statusBarManager,
    contextKeyManager,
    outputChannel,
  });

  // ── Step 8: Register TreeDataProviders ──
  const sessionTreeProvider = new SessionTreeProvider(engineLifecycle);
  const sessionTreeView = vscode.window.createTreeView("agentx.sessions", {
    treeDataProvider: sessionTreeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(sessionTreeView);

  // ── Step 9: Register WebviewViewProvider for chat sidebar ──
  const chatViewProvider = new ChatViewProvider(
    context.extensionUri,
    engineLifecycle,
    eventBridge,
    configBridge
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "agentx.chatView",
      chatViewProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // ── Step 10: Wire EventBridge to update UI components ──
  eventBridge.onStatusChange((status) => {
    statusBarManager.updateProcessingStatus(status);
    contextKeyManager.set("agentx.isProcessing", status === "processing");
  });

  eventBridge.onSessionChange(() => {
    sessionTreeProvider.refresh();
    contextKeyManager.set("agentx.hasSession", engineLifecycle.hasActiveSession());
    statusBarManager.updateSessionIndicator(engineLifecycle.getCurrentSessionId());
  });

  eventBridge.onTokenUsage((usage) => {
    statusBarManager.updateTokenUsage(usage);
  });

  eventBridge.onProviderChange((provider) => {
    statusBarManager.updateProviderIndicator(provider);
  });

  eventBridge.onModelChange((model) => {
    statusBarManager.updateModelIndicator(model);
  });

  eventBridge.onPlanModeChange((active) => {
    statusBarManager.updatePlanModeIndicator(active);
    contextKeyManager.set("agentx.planMode", active);
  });

  eventBridge.onPermissionRequest(() => {
    contextKeyManager.set("agentx.hasPermissionRequest", true);
  });

  eventBridge.onPermissionResolved(() => {
    contextKeyManager.set("agentx.hasPermissionRequest", false);
  });

  // ── Step 11: Configuration change listener ──
  const configWatcher = new ConfigurationWatcher(configBridge, engineLifecycle, statusBarManager);
  context.subscriptions.push(configWatcher);

  // ── Step 12: Workspace folder change listener ──
  const workspaceWatcher = new WorkspaceWatcher(engineLifecycle, statusBarManager, chatViewProvider);
  context.subscriptions.push(workspaceWatcher);

  // ── Step 13: File system watcher for ~/.config/agentx/config.json ──
  const configFileWatcher = new ConfigFileWatcher(configBridge, statusBarManager, engineLifecycle);
  context.subscriptions.push(configFileWatcher);

  // ── Step 14: Set initial status bar state ──
  statusBarManager.initializeFromConfig(configBridge.getConfig());
  statusBarManager.updateCrewIndicator(configBridge.getActiveCrewName());

  outputChannel.appendLine("[Agent-X] Extension activated successfully.");
}
```

**Acceptance Criteria**:
- `activate()` completes in under 500ms when config exists (engine not created)
- All disposables pushed to `context.subscriptions`
- No unhandled promise rejections during activation
- Output channel logs activation progress
- First-run wizard triggers when no config file exists
- All event bridge callbacks are wired to status bar, context keys, and tree view

---

### T3.1.3: `deactivate()` Function — Full Implementation

```typescript
export async function deactivate(): Promise<void> {
  if (engineLifecycle) {
    await engineLifecycle.dispose();
  }
  if (statusBarManager) {
    statusBarManager.dispose();
  }
  if (contextKeyManager) {
    contextKeyManager.dispose();
  }
  if (eventBridge) {
    eventBridge.dispose();
  }
  if (configBridge) {
    configBridge.dispose();
  }
}
```

**Acceptance Criteria**:
- Engine process fully terminated on deactivation
- All status bar items removed
- All context keys cleared
- No memory leaks (verified via VS Code Developer Tools heap snapshot)
- `deactivate()` completes within 3 seconds

---

## T3.2: Command Palette Commands

**Status**: ⬜ Not Started
**Files**: `packages/vscode/src/commands/`
**Estimated Effort**: 8 hours

### T3.2.1: Command Registration Hub

**File**: `packages/vscode/src/commands/registerAllCommands.ts`

```typescript
import * as vscode from "vscode";
import { EngineLifecycle } from "../adapter/EngineLifecycle";
import { ConfigBridge } from "../adapter/ConfigBridge";
import { EventBridge } from "../adapter/EventBridge";
import { StatusBarManager } from "../statusbar/StatusBarManager";
import { ContextKeyManager } from "../context/ContextKeyManager";

import { openChatHandler } from "./session/openChat";
import { newSessionHandler } from "./session/newSession";
import { restoreSessionHandler } from "./session/restoreSession";
import { deleteSessionHandler } from "./session/deleteSession";
import { exportSessionHandler } from "./session/exportSession";
import { clearHistoryHandler } from "./session/clearHistory";
import { compactSessionHandler } from "./session/compactSession";
import { searchSessionsHandler } from "./session/searchSessions";

import { switchModelHandler } from "./provider/switchModel";
import { switchProviderHandler } from "./provider/switchProvider";
import { configureProviderHandler } from "./provider/configureProvider";

import { switchCrewHandler } from "./crew/switchCrew";
import { createCrewHandler } from "./crew/createCrew";
import { editCrewHandler } from "./crew/editCrew";

import { cancelTaskHandler } from "./agent/cancelTask";
import { sendSteerMessageHandler } from "./agent/sendSteerMessage";
import { togglePlanModeHandler } from "./agent/togglePlanMode";
import { showPermissionsHandler } from "./agent/showPermissions";

import { showCostHandler } from "./utility/showCost";
import { openConfigHandler } from "./utility/openConfig";
import { openSecretSauceHandler } from "./utility/openSecretSauce";
import { showAboutHandler } from "./utility/showAbout";

export interface CommandDeps {
  engineLifecycle: EngineLifecycle;
  configBridge: ConfigBridge;
  eventBridge: EventBridge;
  statusBarManager: StatusBarManager;
  contextKeyManager: ContextKeyManager;
  outputChannel: vscode.OutputChannel;
}

export function registerAllCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  const commands: Array<[string, (...args: unknown[]) => unknown]> = [
    // Session commands
    ["agentx.openChat", openChatHandler(deps)],
    ["agentx.newSession", newSessionHandler(deps)],
    ["agentx.restoreSession", restoreSessionHandler(deps)],
    ["agentx.deleteSession", deleteSessionHandler(deps)],
    ["agentx.exportSession", exportSessionHandler(deps)],
    ["agentx.clearHistory", clearHistoryHandler(deps)],
    ["agentx.compactSession", compactSessionHandler(deps)],
    ["agentx.searchSessions", searchSessionsHandler(deps)],

    // Model/Provider commands
    ["agentx.switchModel", switchModelHandler(deps)],
    ["agentx.switchProvider", switchProviderHandler(deps)],
    ["agentx.configureProvider", configureProviderHandler(deps)],

    // Crew/Profile commands
    ["agentx.switchCrew", switchCrewHandler(deps)],
    ["agentx.createCrew", createCrewHandler(deps)],
    ["agentx.editCrew", editCrewHandler(deps)],

    // Agent commands
    ["agentx.cancelTask", cancelTaskHandler(deps)],
    ["agentx.sendSteerMessage", sendSteerMessageHandler(deps)],
    ["agentx.togglePlanMode", togglePlanModeHandler(deps)],
    ["agentx.showPermissions", showPermissionsHandler(deps)],

    // Utility commands
    ["agentx.showCost", showCostHandler(deps)],
    ["agentx.openConfig", openConfigHandler(deps)],
    ["agentx.openSecretSauce", openSecretSauceHandler(deps)],
    ["agentx.showAbout", showAboutHandler(deps)],
  ];

  for (const [id, handler] of commands) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, handler)
    );
  }
}
```

**Acceptance Criteria**:
- All 22 commands registered
- Each command ID matches the `contributes.commands` entries in `package.json`
- No duplicate registrations
- All commands discoverable via command palette (`Ctrl+Shift+P`)

---

### T3.2.2: Session Commands

#### T3.2.2.1: `agentx.openChat`

**File**: `packages/vscode/src/commands/session/openChat.ts`

```typescript
import * as vscode from "vscode";
import { CommandDeps } from "../registerAllCommands";

export function openChatHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    await vscode.commands.executeCommand("agentx.chatView.focus");
    deps.outputChannel.appendLine("[Agent-X] Chat view focused.");
  };
}
```

**Acceptance Criteria**:
- Executing the command focuses the chat sidebar webview panel
- If the sidebar is collapsed, it expands
- No errors if chat view is already focused

---

#### T3.2.2.2: `agentx.newSession`

**File**: `packages/vscode/src/commands/session/newSession.ts`

```typescript
import * as vscode from "vscode";
import { CommandDeps } from "../registerAllCommands";

export function newSessionHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const confirm = await vscode.window.showWarningMessage(
      "Start a new session? The current session will be saved and a new one created.",
      "New Session",
      "Cancel"
    );

    if (confirm !== "New Session") {
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Creating new session...",
          cancellable: false,
        },
        async () => {
          await deps.engineLifecycle.disposeCurrentAgent();
          await deps.engineLifecycle.createAgent();
        }
      );

      deps.statusBarManager.updateSessionIndicator(
        deps.engineLifecycle.getCurrentSessionId()
      );
      deps.contextKeyManager.set("agentx.hasSession", true);

      vscode.window.showInformationMessage("Agent-X: New session created.");
      deps.outputChannel.appendLine("[Agent-X] New session created.");
    } catch (error) {
      vscode.window.showErrorMessage(
        `Agent-X: Failed to create session — ${error instanceof Error ? error.message : String(error)}`
      );
      deps.outputChannel.appendLine(`[Agent-X] Session creation error: ${error}`);
    }
  };
}
```

**Acceptance Criteria**:
- Confirmation dialog shown before creating new session
- Current agent disposed before new one created
- Progress notification shown during creation
- Status bar session indicator updated
- Error shown if creation fails
- Context key `agentx.hasSession` updated

---

#### T3.2.2.3: `agentx.restoreSession`

**File**: `packages/vscode/src/commands/session/restoreSession.ts`

```typescript
import * as vscode from "vscode";
import { CommandDeps } from "../registerAllCommands";

export function restoreSessionHandler(
  deps: CommandDeps
): () => Promise<void> {
  return async () => {
    const sessions = await deps.engineLifecycle.listSessions();

    if (sessions.length === 0) {
      vscode.window.showInformationMessage("Agent-X: No saved sessions found.");
      return;
    }

    interface SessionQuickPickItem extends vscode.QuickPickItem {
      sessionId: string;
    }

    const items: SessionQuickPickItem[] = sessions.map((s) => ({
      label: `$(history) ${s.title || "Untitled Session"}`,
      description: `${s.messageCount} messages · ${formatDate(s.lastActive)}`,
      detail: `ID: ${s.id} · Model: ${s.model || "unknown"}`,
      sessionId: s.id,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a session to restore",
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!selected) {
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Restoring session: ${selected.label}...`,
          cancellable: false,
        },
        async () => {
          await deps.engineLifecycle.disposeCurrentAgent();
          await deps.engineLifecycle.restoreSession(selected.sessionId);
        }
      );

      deps.statusBarManager.updateSessionIndicator(selected.sessionId);
      deps.contextKeyManager.set("agentx.hasSession", true);

      vscode.window.showInformationMessage(
        `Agent-X: Session "${selected.label}" restored.`
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Agent-X: Failed to restore session — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}

function formatDate(timestamp: number | string): string {
  const date = typeof timestamp === "number" ? new Date(timestamp) : new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
```

**Acceptance Criteria**:
- QuickPick shows all saved sessions with title, message count, date, model
- Sessions sorted by last active (most recent first)
- Selecting a session disposes current agent and restores selected
- Progress notification shown during restore
- Status bar and context keys updated after restore
- Empty state handled with informational message

---

#### T3.2.2.4: `agentx.deleteSession`

**File**: `packages/vscode/src/commands/session/deleteSession.ts`

```typescript
import * as vscode from "vscode";
import { CommandDeps } from "../registerAllCommands";

export function deleteSessionHandler(
  deps: CommandDeps
): () => Promise<void> {
  return async () => {
    const sessions = await deps.engineLifecycle.listSessions();

    if (sessions.length === 0) {
      vscode.window.showInformationMessage("Agent-X: No saved sessions to delete.");
      return;
    }

    interface SessionQuickPickItem extends vscode.QuickPickItem {
      sessionId: string;
    }

    const items: SessionQuickPickItem[] = sessions.map((s) => ({
      label: `$(trash) ${s.title || "Untitled Session"}`,
      description: `${s.messageCount} messages · ${s.id.slice(0, 8)}`,
      detail: `Last active: ${new Date(s.lastActive).toLocaleString()}`,
      sessionId: s.id,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a session to delete",
      matchOnDescription: true,
    });

    if (!selected) {
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Delete session "${selected.label}"? This cannot be undone.`,
      { modal: true },
      "Delete"
    );

    if (confirm !== "Delete") {
      return;
    }

    try {
      await deps.engineLifecycle.deleteSession(selected.sessionId);

      if (selected.sessionId === deps.engineLifecycle.getCurrentSessionId()) {
        await deps.engineLifecycle.disposeCurrentAgent();
        deps.contextKeyManager.set("agentx.hasSession", false);
        deps.statusBarManager.updateSessionIndicator(undefined);
      }

      vscode.window.showInformationMessage(
        `Agent-X: Session deleted.`
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Agent-X: Failed to delete session — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}
```

**Acceptance Criteria**:
- QuickPick lists all sessions for deletion
- Modal confirmation dialog with "cannot be undone" warning
- Session deleted from storage
- If deleted session is the active one, agent disposed and context keys reset
- Error handling with user-facing message

---

#### T3.2.2.5: `agentx.exportSession`

**File**: `packages/vscode/src/commands/session/exportSession.ts`

```typescript
import * as vscode from "vscode";
import * as path from "path";
import { CommandDeps } from "../registerAllCommands";

export function exportSessionHandler(
  deps: CommandDeps
): () => Promise<void> {
  return async () => {
    if (!deps.engineLifecycle.hasActiveSession()) {
      vscode.window.showWarningMessage("Agent-X: No active session to export.");
      return;
    }

    const formatChoice = await vscode.window.showQuickPick(
      [
        { label: "$(json) JSON", description: "Full session data as JSON", format: "json" },
        { label: "$(markdown) Markdown", description: "Human-readable conversation", format: "markdown" },
      ],
      { placeHolder: "Select export format" }
    );

    if (!formatChoice) {
      return;
    }

    const sessionId = deps.engineLifecycle.getCurrentSessionId();
    const session = await deps.engineLifecycle.getSessionData(sessionId);

    const format = (formatChoice as { format: string }).format;
    const defaultName = `agentx-session-${sessionId?.slice(0, 8)}.${format}`;

    const saveUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(
        path.join(
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.env.HOME || ".",
          defaultName
        )
      ),
      filters:
        format === "json"
          ? { "JSON Files": ["json"] }
          : { "Markdown Files": ["md"] },
    });

    if (!saveUri) {
      return;
    }

    try {
      let content: string;

      if (format === "json") {
        content = JSON.stringify(session, null, 2);
      } else {
        content = formatSessionAsMarkdown(session);
      }

      await vscode.workspace.fs.writeFile(
        saveUri,
        Buffer.from(content, "utf-8")
      );

      const openChoice = await vscode.window.showInformationMessage(
        `Agent-X: Session exported to ${path.basename(saveUri.fsPath)}`,
        "Open File",
        "Reveal in Explorer"
      );

      if (openChoice === "Open File") {
        const doc = await vscode.workspace.openTextDocument(saveUri);
        await vscode.window.showTextDocument(doc);
      } else if (openChoice === "Reveal in Explorer") {
        await vscode.commands.executeCommand("revealFileInOS", saveUri);
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `Agent-X: Export failed — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}

function formatSessionAsMarkdown(session: {
  messages: Array<{ role: string; content: string; timestamp?: string }>;
  title?: string;
  model?: string;
}): string {
  const lines: string[] = [];
  lines.push(`# ${session.title || "Agent-X Session"}`);
  lines.push("");
  lines.push(`**Model**: ${session.model || "unknown"}`);
  lines.push(`**Exported**: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const msg of session.messages) {
    const roleLabel = msg.role === "user" ? "**User**" : "**Assistant**";
    const timestamp = msg.timestamp ? ` _${msg.timestamp}_` : "";
    lines.push(`### ${roleLabel}${timestamp}`);
    lines.push("");
    lines.push(msg.content);
    lines.push("");
  }

  return lines.join("\n");
}
```

**Acceptance Criteria**:
- Format selection QuickPick (JSON / Markdown)
- Save dialog with sensible default filename
- JSON export includes full session data (messages, metadata, tool results)
- Markdown export formats conversation as readable document
- Post-export options: open file or reveal in explorer
- Error handling for write failures

---

#### T3.2.2.6: `agentx.clearHistory`

**File**: `packages/vscode/src/commands/session/clearHistory.ts`

```typescript
import * as vscode from "vscode";
import { CommandDeps } from "../registerAllCommands";

export function clearHistoryHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    if (!deps.engineLifecycle.hasActiveSession()) {
      vscode.window.showWarningMessage("Agent-X: No active session.");
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      "Clear all messages in the current session? The session will be reset but preserved.",
      { modal: true },
      "Clear"
    );

    if (confirm !== "Clear") {
      return;
    }

    try {
      await deps.engineLifecycle.clearCurrentSessionMessages();
      deps.eventBridge.notifySessionCleared();
      vscode.window.showInformationMessage("Agent-X: Session history cleared.");
    } catch (error) {
      vscode.window.showErrorMessage(
        `Agent-X: Failed to clear history — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}
```

**Acceptance Criteria**:
- Modal confirmation before clearing
- Messages cleared from active session
- Webview notified to clear its display
- Session itself preserved (not deleted)

---

#### T3.2.2.7: `agentx.compactSession`

**File**: `packages/vscode/src/commands/session/compactSession.ts`

```typescript
import * as vscode from "vscode";
import { CommandDeps } from "../registerAllCommands";

export function compactSessionHandler(
  deps: CommandDeps
): () => Promise<void> {
  return async () => {
    if (!deps.engineLifecycle.hasActiveSession()) {
      vscode.window.showWarningMessage("Agent-X: No active session to compact.");
      return;
    }

    if (deps.engineLifecycle.isProcessing()) {
      vscode.window.showWarningMessage(
        "Agent-X: Cannot compact while processing. Cancel the current task first."
      );
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Compacting session context...",
          cancellable: false,
        },
        async (progress) => {
          progress.report({ increment: 0 });
          await deps.engineLifecycle.compactCurrentSession();
          progress.report({ increment: 100 });
        }
      );

      vscode.window.showInformationMessage(
        "Agent-X: Session context compacted successfully."
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Agent-X: Compaction failed — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}
```

**Acceptance Criteria**:
- Cannot compact while agent is processing (guarded)
- Progress notification shown during compaction
- Engine's context compaction invoked
- Success/error messages shown

---

#### T3.2.2.8: `agentx.searchSessions`

**File**: `packages/vscode/src/commands/session/searchSessions.ts`

```typescript
import * as vscode from "vscode";
import { CommandDeps } from "../registerAllCommands";

export function searchSessionsHandler(
  deps: CommandDeps
): () => Promise<void> {
  return async () => {
    const query = await vscode.window.showInputBox({
      prompt: "Search across all sessions",
      placeHolder: "Enter search term...",
      validateInput: (value) => {
        if (!value || value.trim().length < 2) {
          return "Enter at least 2 characters";
        }
        return undefined;
      },
    });

    if (!query) {
      return;
    }

    try {
      const results = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Searching sessions for "${query}"...`,
          cancellable: true,
        },
        async (_progress, token) => {
          return deps.engineLifecycle.searchSessions(query, token);
        }
      );

      if (!results || results.length === 0) {
        vscode.window.showInformationMessage(
          `Agent-X: No sessions found matching "${query}".`
        );
        return;
      }

      interface SearchResultItem extends vscode.QuickPickItem {
        sessionId: string;
      }

      const items: SearchResultItem[] = results.map((r) => ({
        label: `$(search) ${r.sessionTitle || "Untitled"}`,
        description: `Match in ${r.role} message`,
        detail: truncate(r.matchSnippet, 120),
        sessionId: r.sessionId,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `${results.length} result(s) found — select to restore session`,
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (selected) {
        await deps.engineLifecycle.disposeCurrentAgent();
        await deps.engineLifecycle.restoreSession(
          (selected as SearchResultItem).sessionId
        );
        deps.statusBarManager.updateSessionIndicator(
          (selected as SearchResultItem).sessionId
        );
      }
    } catch (error) {
      if ((error as Error).name !== "CancellationError") {
        vscode.window.showErrorMessage(
          `Agent-X: Search failed — ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  };
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}
```

**Acceptance Criteria**:
- Input box with minimum 2-character validation
- Progress notification with cancellation support
- Results shown in QuickPick with session title, role, and match snippet
- Selecting a result restores that session
- Empty results handled with informational message
- Cancellation handled gracefully (no error shown)

---

### T3.2.3: Model/Provider Commands

#### T3.2.3.1: `agentx.switchModel`

**File**: `packages/vscode/src/commands/provider/switchModel.ts`

```typescript
import * as vscode from "vscode";
import { CommandDeps } from "../registerAllCommands";

export function switchModelHandler(
  deps: CommandDeps
): () => Promise<void> {
  return async () => {
    const currentProvider = deps.configBridge.getActiveProvider();
    const models = await deps.engineLifecycle.getAvailableModels(currentProvider);

    if (models.length === 0) {
      vscode.window.showWarningMessage(
        `Agent-X: No models available for provider "${currentProvider}". Check your API key or provider configuration.`
      );
      return;
    }

    interface ModelQuickPickItem extends vscode.QuickPickItem {
      modelId: string;
    }

    const activeModel = deps.configBridge.getActiveModel();

    const items: ModelQuickPickItem[] = models.map((m) => ({
      label: m.id === activeModel ? `$(check) ${m.name}` : m.name,
      description: m.contextWindow
        ? `${formatNumber(m.contextWindow)} tokens`
        : undefined,
      detail: m.description || m.id,
      modelId: m.id,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `Select model for ${currentProvider}`,
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!selected) {
      return;
    }

    const modelId = (selected as ModelQuickPickItem).modelId;

    try {
      deps.configBridge.setActiveModel(modelId);
      await deps.engineLifecycle.switchModel(modelId);
      deps.statusBarManager.updateModelIndicator(modelId);

      vscode.window.showInformationMessage(
        `Agent-X: Switched to model "${selected.label}".`
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Agent-X: Failed to switch model — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
```

**Acceptance Criteria**:
- QuickPick shows all models for the active provider
- Current model marked with check icon
- Context window size shown in description
- Model switch updates config, engine, and status bar
- Error handling for providers with no available models

---

#### T3.2.3.2: `agentx.switchProvider`

**File**: `packages/vscode/src/commands/provider/switchProvider.ts`

```typescript
import * as vscode from "vscode";
import { CommandDeps } from "../registerAllCommands";

export function switchProviderHandler(
  deps: CommandDeps
): () => Promise<void> {
  return async () => {
    const providers = deps.configBridge.getAvailableProviders();
    const activeProvider = deps.configBridge.getActiveProvider();

    interface ProviderQuickPickItem extends vscode.QuickPickItem {
      providerId: string;
    }

    const items: ProviderQuickPickItem[] = providers.map((p) => ({
      label: p.id === activeProvider ? `$(check) ${p.name}` : p.name,
      description: p.configured ? "$(pass-filled) Configured" : "$(warning) Not configured",
      detail: p.description || p.id,
      providerId: p.id,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select AI provider",
      matchOnDescription: true,
    });

    if (!selected) {
      return;
    }

    const providerId = (selected as ProviderQuickPickItem).providerId;
    const providerInfo = providers.find((p) => p.id === providerId);

    if (!providerInfo?.configured) {
      const configure = await vscode.window.showWarningMessage(
        `Provider "${selected.label}" is not configured. Would you like to configure it?`,
        "Configure",
        "Cancel"
      );
      if (configure === "Configure") {
        await vscode.commands.executeCommand("agentx.configureProvider", providerId);
      }
      return;
    }

    try {
      deps.configBridge.setActiveProvider(providerId);
      await deps.engineLifecycle.switchProvider(providerId);
      deps.statusBarManager.updateProviderIndicator(providerId);

      const models = await deps.engineLifecycle.getAvailableModels(providerId);
      if (models.length > 0) {
        deps.configBridge.setActiveModel(models[0].id);
        deps.statusBarManager.updateModelIndicator(models[0].id);
      }

      vscode.window.showInformationMessage(
        `Agent-X: Switched to provider "${selected.label}".`
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Agent-X: Failed to switch provider — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}
```

**Acceptance Criteria**:
- QuickPick shows all known providers with configured/not-configured status
- Active provider marked with check icon
- Selecting unconfigured provider prompts to configure
- Provider switch updates config, engine, and status bar
- Default model selected from new provider's model list

---

#### T3.2.3.3: `agentx.configureProvider`

**File**: `packages/vscode/src/commands/provider/configureProvider.ts`

```typescript
import * as vscode from "vscode";
import { CommandDeps } from "../registerAllCommands";

export function configureProviderHandler(
  deps: CommandDeps
): (providerId?: string) => Promise<void> {
  return async (providerId?: string) => {
    if (!providerId) {
      const providers = deps.configBridge.getAvailableProviders();
      interface ProviderQuickPickItem extends vscode.QuickPickItem {
        providerId: string;
      }

      const items: ProviderQuickPickItem[] = providers.map((p) => ({
        label: p.name,
        description: p.configured ? "Configured" : "Not configured",
        providerId: p.id,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Select provider to configure",
      });

      if (!selected) return;
      providerId = (selected as ProviderQuickPickItem).providerId;
    }

    const providerMeta = deps.configBridge.getProviderMeta(providerId);
    if (!providerMeta) {
      vscode.window.showErrorMessage(`Agent-X: Unknown provider "${providerId}".`);
      return;
    }

    const isLocal = ["ollama", "lmstudio"].includes(providerId);

    if (!isLocal) {
      const apiKey = await vscode.window.showInputBox({
        prompt: `Enter API key for ${providerMeta.name}`,
        placeHolder: "sk-...",
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return "API key cannot be empty";
          }
          return undefined;
        },
      });

      if (!apiKey) return;

      deps.configBridge.setProviderApiKey(providerId, apiKey.trim());
    }

    if (isLocal || providerMeta.supportsCustomUrl) {
      const defaultUrl = providerMeta.defaultBaseUrl || "";
      const baseUrl = await vscode.window.showInputBox({
        prompt: `Enter base URL for ${providerMeta.name}`,
        placeHolder: defaultUrl,
        value: deps.configBridge.getProviderBaseUrl(providerId) || defaultUrl,
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (value && value.trim().length > 0) {
            try {
              new URL(value);
            } catch {
              return "Must be a valid URL";
            }
          }
          return undefined;
        },
      });

      if (baseUrl) {
        deps.configBridge.setProviderBaseUrl(providerId, baseUrl.trim());
      }
    }

    try {
      await deps.configBridge.saveConfig();
      await deps.engineLifecycle.reloadProvider(providerId);

      vscode.window.showInformationMessage(
        `Agent-X: Provider "${providerMeta.name}" configured successfully.`
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Agent-X: Failed to save provider config — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}
```

**Acceptance Criteria**:
- Optional `providerId` argument (can be invoked from command palette or programmatically)
- Provider selection QuickPick if no ID provided
- API key input with password masking for cloud providers
- Base URL input for local providers (Ollama, LM Studio) and custom-URL providers
- URL validation
- Config saved to disk after changes
- Provider reloaded in engine after config change

---

### T3.2.4: Crew/Profile Commands

#### T3.2.4.1: `agentx.switchCrew`

**File**: `packages/vscode/src/commands/crew/switchCrew.ts`

```typescript
import * as vscode from "vscode";
import { CommandDeps } from "../registerAllCommands";

export function switchCrewHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const crews = deps.configBridge.getAvailableCrews();
    const activeCrew = deps.configBridge.getActiveCrewName();

    if (crews.length === 0) {
      const create = await vscode.window.showInformationMessage(
        "Agent-X: No crews configured. Would you like to create one?",
        "Create Crew",
        "Cancel"
      );
      if (create === "Create Crew") {
        await vscode.commands.executeCommand("agentx.createCrew");
      }
      return;
    }

    interface CrewQuickPickItem extends vscode.QuickPickItem {
      crewId: string;
    }

    const items: CrewQuickPickItem[] = crews.map((c) => ({
      label: c.name === activeCrew ? `$(check) ${c.name}` : c.name,
      description: `${c.members?.length || 0} members`,
      detail: c.description || c.id,
      crewId: c.id,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select active crew",
      matchOnDescription: true,
    });

    if (!selected) return;

    const crewId = (selected as CrewQuickPickItem).crewId;

    try {
      deps.configBridge.setActiveCrew(crewId);
      await deps.engineLifecycle.switchCrew(crewId);
      deps.statusBarManager.updateCrewIndicator(
        (selected as CrewQuickPickItem).label.replace("$(check) ", "")
      );

      vscode.window.showInformationMessage(
        `Agent-X: Switched to crew "${selected.label}".`
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Agent-X: Failed to switch crew — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}
```

**Acceptance Criteria**:
- QuickPick lists all crews with member count
- Active crew marked with check icon
- Empty state prompts to create a crew
- Crew switch updates config, engine, and status bar

---

#### T3.2.4.2: `agentx.createCrew`

**File**: `packages/vscode/src/commands/crew/createCrew.ts`

```typescript
import * as vscode from "vscode";
import { CommandDeps } from "../registerAllCommands";

export function createCrewHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const name = await vscode.window.showInputBox({
      prompt: "Enter crew name",
      placeHolder: "e.g., Full Stack Team",
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value || value.trim().length === 0) return "Name is required";
        if (value.trim().length > 50) return "Name must be 50 characters or less";
        return undefined;
      },
    });

    if (!name) return;

    const description = await vscode.window.showInputBox({
      prompt: "Enter crew description (optional)",
      placeHolder: "e.g., A team for full-stack web development",
      ignoreFocusOut: true,
    });

    const memberCountStr = await vscode.window.showInputBox({
      prompt: "How many members in this crew?",
      placeHolder: "1-5",
      ignoreFocusOut: true,
      validateInput: (value) => {
        const n = parseInt(value, 10);
        if (isNaN(n) || n < 1 || n > 5) return "Enter a number between 1 and 5";
        return undefined;
      },
    });

    if (!memberCountStr) return;
    const memberCount = parseInt(memberCountStr, 10);

    const members: Array<{ name: string; role: string; personality: string }> = [];

    for (let i = 0; i < memberCount; i++) {
      const memberName = await vscode.window.showInputBox({
        prompt: `Member ${i + 1} name`,
        placeHolder: "e.g., Architect",
        ignoreFocusOut: true,
        validateInput: (v) => (!v || v.trim().length === 0 ? "Required" : undefined),
      });
      if (!memberName) return;

      const role = await vscode.window.showInputBox({
        prompt: `${memberName}'s role`,
        placeHolder: "e.g., System architecture and design",
        ignoreFocusOut: true,
      });
      if (!role) return;

      const personality = await vscode.window.showQuickPick(
        [
          { label: "Analytical", description: "Methodical and detail-oriented" },
          { label: "Creative", description: "Innovative and out-of-the-box" },
          { label: "Pragmatic", description: "Practical and results-focused" },
          { label: "Thorough", description: "Comprehensive and careful" },
          { label: "Bold", description: "Confident and decisive" },
        ],
        { placeHolder: `${memberName}'s personality` }
      );

      members.push({
        name: memberName.trim(),
        role: role.trim(),
        personality: personality?.label || "Pragmatic",
      });
    }

    try {
      await deps.engineLifecycle.createCrew({
        name: name.trim(),
        description: description?.trim() || "",
        members,
      });

      deps.configBridge.refreshCrews();
      deps.statusBarManager.updateCrewIndicator(name.trim());

      vscode.window.showInformationMessage(
        `Agent-X: Crew "${name}" created with ${memberCount} member(s).`
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Agent-X: Failed to create crew — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}
```

**Acceptance Criteria**:
- Multi-step input wizard: name → description → member count → member details
- Validation on all inputs
- Member personality selected via QuickPick
- Crew created via engine and config updated
- Status bar updated to show new crew

---

#### T3.2.4.3: `agentx.editCrew`

**File**: `packages/vscode/src/commands/crew/editCrew.ts`

```typescript
import * as vscode from "vscode";
import * as path from "path";
import { CommandDeps } from "../registerAllCommands";

export function editCrewHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const crews = deps.configBridge.getAvailableCrews();

    if (crews.length === 0) {
      vscode.window.showInformationMessage("Agent-X: No crews to edit.");
      return;
    }

    interface CrewQuickPickItem extends vscode.QuickPickItem {
      crewId: string;
    }

    const items: CrewQuickPickItem[] = crews.map((c) => ({
      label: c.name,
      description: `${c.members?.length || 0} members`,
      crewId: c.id,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select crew to edit",
    });

    if (!selected) return;

    const crewId = (selected as CrewQuickPickItem).crewId;
    const crewFilePath = deps.configBridge.getCrewFilePath(crewId);

    if (!crewFilePath) {
      vscode.window.showErrorMessage("Agent-X: Crew file not found.");
      return;
    }

    const uri = vscode.Uri.file(crewFilePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
  };
}
```

**Acceptance Criteria**:
- QuickPick to select crew
- Opens crew JSON file in VS Code editor
- User can edit and save directly
- Error if crew file doesn't exist

---

### T3.2.5: Agent Commands

#### T3.2.5.1: `agentx.cancelTask`

**File**: `packages/vscode/src/commands/agent/cancelTask.ts`

```typescript
import * as vscode from "vscode";
import { CommandDeps } from "../registerAllCommands";

export function cancelTaskHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    if (!deps.engineLifecycle.isProcessing()) {
      vscode.window.showInformationMessage("Agent-X: No task is currently running.");
      return;
    }

    try {
      await deps.engineLifecycle.cancelCurrentTask();
      deps.statusBarManager.updateProcessingStatus("idle");
      deps.contextKeyManager.set("agentx.isProcessing", false);
      vscode.window.showInformationMessage("Agent-X: Task cancelled.");
    } catch (error) {
      vscode.window.showErrorMessage(
        `Agent-X: Failed to cancel task — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}
```

**Acceptance Criteria**:
- Guard: no-op with message if not processing
- Cancels the current completion loop
- Status bar and context keys updated immediately
- Webview shows cancellation indicator

---

#### T3.2.5.2: `agentx.sendSteerMessage`

**File**: `packages/vscode/src/commands/agent/sendSteerMessage.ts`

```typescript
import * as vscode from "vscode";
import { CommandDeps } from "../registerAllCommands";

export function sendSteerMessageHandler(
  deps: CommandDeps
): () => Promise<void> {
  return async () => {
    if (!deps.engineLifecycle.isProcessing()) {
      vscode.window.showWarningMessage(
        "Agent-X: Steer messages can only be sent while the agent is processing."
      );
      return;
    }

    const instruction = await vscode.window.showInputBox({
      prompt: "Enter steer instruction",
      placeHolder: "e.g., Focus on error handling first",
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value || value.trim().length === 0) return "Instruction cannot be empty";
        return undefined;
      },
    });

    if (!instruction) return;

    try {
      await deps.engineLifecycle.sendSteerMessage(instruction.trim());
      vscode.window.showInformationMessage("Agent-X: Steer message sent.");
      deps.outputChannel.appendLine(`[Agent-X] Steer: ${instruction.trim()}`);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Agent-X: Failed to send steer — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}
```

**Acceptance Criteria**:
- Guard: only available while agent is processing
- InputBox for steer instruction
- Steer message delivered to engine's SteerMessageHandler
- Logged to output channel

---

#### T3.2.5.3: `agentx.togglePlanMode`

**File**: `packages/vscode/src/commands/agent/togglePlanMode.ts`

```typescript
import * as vscode from "vscode";
import { CommandDeps } from "../registerAllCommands";

export function togglePlanModeHandler(
  deps: CommandDeps
): () => Promise<void> {
  return async () => {
    const currentMode = deps.configBridge.isPlanModeActive();
    const newMode = !currentMode;

    try {
      deps.configBridge.setPlanMode(newMode);
      await deps.engineLifecycle.setPlanMode(newMode);

      deps.statusBarManager.updatePlanModeIndicator(newMode);
      deps.contextKeyManager.set("agentx.planMode", newMode);

      vscode.window.showInformationMessage(
        `Agent-X: Plan mode ${newMode ? "enabled" : "disabled"}.`
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Agent-X: Failed to toggle plan mode — ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
}
```

**Acceptance Criteria**:
- Toggles plan mode on/off
- Config, engine, status bar, and context keys all updated
- Information message confirms new state

---

#### T3.2.5.4: `agentx.showPermissions`

**File**: `packages/vscode/src/commands/agent/showPermissions.ts`

```typescript
import * as vscode from "vscode";
import { CommandDeps } from "../registerAllCommands";

export function showPermissionsHandler(
  deps: CommandDeps
): () => Promise<void> {
  return async () => {
    const permissions = await deps.engineLifecycle.getPermissionAuditLog();

    if (permissions.length === 0) {
      vscode.window.showInformationMessage("Agent-X: No permission decisions recorded.");
      return;
    }

    interface PermissionQuickPickItem extends vscode.QuickPickItem {
      permissionId: string;
    }

    const items: PermissionQuickPickItem[] = permissions.map((p) => {
      const icon =
        p.decision === "approved"
          ? "$(pass-filled)"
          : p.decision === "denied"
            ? "$(error)"
            : "$(question)";
      return {
        label: `${icon} ${p.tool}`,
        description: p.decision,
        detail: `${p.path || "N/A"} · Risk: ${p.riskLevel} · ${new Date(p.timestamp).toLocaleString()}`,
        permissionId: p.id,
      };
    });

    await vscode.window.showQuickPick(items, {
      placeHolder: "Permission audit log",
      matchOnDescription: true,
      matchOnDetail: true,
    });
  };
}
```

**Acceptance Criteria**:
- QuickPick shows full permission audit log
- Each entry shows tool name, decision (approved/denied/pending), path, risk level, timestamp
- Icons differentiate decision types
- Empty state handled

---

### T3.2.6: Utility Commands

#### T3.2.6.1: `agentx.showCost`

**File**: `packages/vscode/src/commands/utility/showCost.ts`

```typescript
import * as vscode from "vscode";
import { CommandDeps } from "../registerAllCommands";

export function showCostHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    if (!deps.engineLifecycle.hasActiveSession()) {
      vscode.window.showInformationMessage("Agent-X: No active session.");
      return;
    }

    const usage = deps.engineLifecycle.getTokenUsage();
    const cost = deps.engineLifecycle.getSessionCost();

    const lines: string[] = [
      `Session Token Usage`,
      ``,
      `Used:   ${usage.used.toLocaleString()} tokens`,
      `Total:  ${usage.total.toLocaleString()} tokens`,
      `Usage:  ${usage.percentage.toFixed(1)}%`,
      ``,
      `Estimated Cost: $${cost.toFixed(4)}`,
      ``,
      `Model: ${deps.configBridge.getActiveModel()}`,
      `Provider: ${deps.configBridge.getActiveProvider()}`,
    ];

    const doc = await vscode.workspace.openTextDocument({
      content: lines.join("\n"),
      language: "plaintext",
    });

    await vscode.window.showTextDocument(doc, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside,
    });
  };
}
```

**Acceptance Criteria**:
- Shows token usage breakdown (used, total, percentage)
- Shows estimated cost
- Shows current model and provider
- Opens as untitled document beside current editor

---

#### T3.2.6.2: `agentx.openConfig`

**File**: `packages/vscode/src/commands/utility/openConfig.ts`

```typescript
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { CommandDeps } from "../registerAllCommands";
import { getConfigDir } from "@agentx/engine";

export function openConfigHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const configDir = getConfigDir();
    const configPath = path.join(configDir, "config.json");

    if (!fs.existsSync(configPath)) {
      const create = await vscode.window.showWarningMessage(
        `Agent-X config file not found at ${configPath}. Create it?`,
        "Create",
        "Cancel"
      );
      if (create !== "Create") return;

      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({}, null, 2), "utf-8");
    }

    const uri = vscode.Uri.file(configPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
  };
}
```

**Acceptance Criteria**:
- Opens `~/.config/agentx/config.json` in editor
- Creates file if it doesn't exist (with confirmation)
- Creates directory structure if needed

---

#### T3.2.6.3: `agentx.openSecretSauce`

**File**: `packages/vscode/src/commands/utility/openSecretSauce.ts`

```typescript
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { CommandDeps } from "../registerAllCommands";
import { getConfigDir } from "@agentx/engine";

export function openSecretSauceHandler(
  deps: CommandDeps
): () => Promise<void> {
  return async () => {
    const secretSauceDir = path.join(getConfigDir(), "secret-sauce");

    if (!fs.existsSync(secretSauceDir)) {
      fs.mkdirSync(secretSauceDir, { recursive: true });
    }

    const uri = vscode.Uri.file(secretSauceDir);
    await vscode.commands.executeCommand("revealInExplorer", uri);
  };
}
```

**Acceptance Criteria**:
- Opens secret sauce directory in VS Code explorer
- Creates directory if it doesn't exist

---

#### T3.2.6.4: `agentx.showAbout`

**File**: `packages/vscode/src/commands/utility/showAbout.ts`

```typescript
import * as vscode from "vscode";
import { CommandDeps } from "../registerAllCommands";

export function showAboutHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const ext = vscode.extensions.getExtension("agentx.agent-x");
    const version = ext?.packageJSON?.version || "unknown";
    const provider = deps.configBridge.getActiveProvider();
    const model = deps.configBridge.getActiveModel();
    const crew = deps.configBridge.getActiveCrewName() || "None";
    const engineVersion = deps.engineLifecycle.getEngineVersion();

    const lines = [
      `Agent-X VS Code Extension`,
      ``,
      `Extension Version: ${version}`,
      `Engine Version: ${engineVersion}`,
      ``,
      `Provider: ${provider}`,
      `Model: ${model}`,
      `Crew: ${crew}`,
      ``,
      `Config: ${deps.configBridge.hasValidConfig() ? "Valid" : "Missing"}`,
      `Sessions: ${await deps.engineLifecycle.getSessionCount()}`,
    ];

    const doc = await vscode.workspace.openTextDocument({
      content: lines.join("\n"),
      language: "plaintext",
    });

    await vscode.window.showTextDocument(doc, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside,
    });
  };
}
```

**Acceptance Criteria**:
- Shows extension version, engine version, provider, model, crew, config status, session count
- Opens as untitled document

---

## T3.3: Status Bar Items

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/statusbar/StatusBarManager.ts`
**Estimated Effort**: 4 hours

### T3.3.1: StatusBarManager Class

```typescript
import * as vscode from "vscode";
import { ConfigBridge } from "../adapter/ConfigBridge";
import { EngineLifecycle } from "../adapter/EngineLifecycle";

interface TokenUsage {
  used: number;
  total: number;
  percentage: number;
  cost: number;
}

export class StatusBarManager implements vscode.Disposable {
  private providerItem: vscode.StatusBarItem;
  private modelItem: vscode.StatusBarItem;
  private tokenItem: vscode.StatusBarItem;
  private sessionItem: vscode.StatusBarItem;
  private processingItem: vscode.StatusBarItem;
  private crewItem: vscode.StatusBarItem;
  private planModeItem: vscode.StatusBarItem;

  private spinnerInterval: ReturnType<typeof setInterval> | undefined;
  private spinnerFrame = 0;
  private readonly spinnerFrames = ["$(sync~spin)", "$(loading~spin)"];

  private disposables: vscode.Disposable[] = [];

  constructor(
    private configBridge: ConfigBridge,
    private engineLifecycle: EngineLifecycle
  ) {
    // T3.3.2: Provider indicator
    this.providerItem = vscode.window.createStatusBarItem(
      "agentx.provider",
      vscode.StatusBarAlignment.Left,
      100
    );
    this.providerItem.name = "Agent-X Provider";
    this.providerItem.command = "agentx.switchProvider";
    this.providerItem.tooltip = "Click to switch AI provider";
    this.disposables.push(this.providerItem);

    // T3.3.3: Model indicator
    this.modelItem = vscode.window.createStatusBarItem(
      "agentx.model",
      vscode.StatusBarAlignment.Left,
      99
    );
    this.modelItem.name = "Agent-X Model";
    this.modelItem.command = "agentx.switchModel";
    this.modelItem.tooltip = "Click to switch model";
    this.disposables.push(this.modelItem);

    // T3.3.4: Token usage
    this.tokenItem = vscode.window.createStatusBarItem(
      "agentx.tokens",
      vscode.StatusBarAlignment.Left,
      98
    );
    this.tokenItem.name = "Agent-X Token Usage";
    this.tokenItem.command = "agentx.showCost";
    this.tokenItem.tooltip = "Click to view detailed token usage";
    this.disposables.push(this.tokenItem);

    // T3.3.5: Session indicator
    this.sessionItem = vscode.window.createStatusBarItem(
      "agentx.session",
      vscode.StatusBarAlignment.Left,
      97
    );
    this.sessionItem.name = "Agent-X Session";
    this.sessionItem.command = "agentx.restoreSession";
    this.sessionItem.tooltip = "Click to restore a session";
    this.disposables.push(this.sessionItem);

    // T3.3.6: Processing indicator
    this.processingItem = vscode.window.createStatusBarItem(
      "agentx.processing",
      vscode.StatusBarAlignment.Left,
      96
    );
    this.processingItem.name = "Agent-X Processing";
    this.processingItem.command = "agentx.cancelTask";
    this.processingItem.tooltip = "Click to cancel current task";
    this.processingItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground"
    );
    this.disposables.push(this.processingItem);

    // T3.3.7: Crew indicator
    this.crewItem = vscode.window.createStatusBarItem(
      "agentx.crew",
      vscode.StatusBarAlignment.Left,
      95
    );
    this.crewItem.name = "Agent-X Crew";
    this.crewItem.command = "agentx.switchCrew";
    this.crewItem.tooltip = "Click to switch crew";
    this.disposables.push(this.crewItem);

    // T3.3.8: Plan mode indicator
    this.planModeItem = vscode.window.createStatusBarItem(
      "agentx.planMode",
      vscode.StatusBarAlignment.Left,
      94
    );
    this.planModeItem.name = "Agent-X Plan Mode";
    this.planModeItem.command = "agentx.togglePlanMode";
    this.planModeItem.tooltip = "Click to toggle plan approval mode";
    this.disposables.push(this.planModeItem);
  }

  // ── Initialization ──

  initializeFromConfig(config: Record<string, unknown>): void {
    this.updateProviderIndicator(
      (config as { provider?: { activeProvider?: string } }).provider?.activeProvider || "unknown"
    );
    this.updateModelIndicator(
      (config as { provider?: { activeModel?: string } }).provider?.activeModel || "unknown"
    );
    this.tokenItem.hide();
    this.sessionItem.hide();
    this.processingItem.hide();
    this.planModeItem.hide();
  }

  // ── T3.3.2: Provider Indicator ──

  updateProviderIndicator(providerId: string): void {
    const iconMap: Record<string, string> = {
      openai: "$(sparkle)",
      anthropic: "$(brain)",
      google: "$(globe)",
      ollama: "$(server)",
      lmstudio: "$(server)",
    };
    const icon = iconMap[providerId] || "$(circuit-board)";
    this.providerItem.text = `${icon} ${providerId}`;
    this.providerItem.show();
  }

  // ── T3.3.3: Model Indicator ──

  updateModelIndicator(modelId: string): void {
    const shortName = modelId.length > 25 ? modelId.slice(0, 22) + "..." : modelId;
    this.modelItem.text = `$(symbol-misc) ${shortName}`;
    this.modelItem.tooltip = `Model: ${modelId}\nClick to switch`;
    this.modelItem.show();
  }

  // ── T3.3.4: Token Usage ──

  updateTokenUsage(usage: TokenUsage): void {
    const pct = usage.percentage;
    this.tokenItem.text = `$(pulse) ${formatTokenCount(usage.used)}/${formatTokenCount(usage.total)} (${pct.toFixed(0)}%)`;
    this.tokenItem.tooltip = `Tokens: ${usage.used.toLocaleString()} / ${usage.total.toLocaleString()}\nCost: $${usage.cost.toFixed(4)}\nClick for details`;

    if (pct < 50) {
      this.tokenItem.color = undefined;
      this.tokenItem.backgroundColor = undefined;
    } else if (pct < 80) {
      this.tokenItem.color = new vscode.ThemeColor("charts.yellow");
      this.tokenItem.backgroundColor = undefined;
    } else {
      this.tokenItem.color = new vscode.ThemeColor("errorForeground");
      this.tokenItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.errorBackground"
      );
    }

    this.tokenItem.show();
  }

  // ── T3.3.5: Session Indicator ──

  updateSessionIndicator(sessionId: string | undefined): void {
    if (!sessionId) {
      this.sessionItem.hide();
      return;
    }
    const truncated = sessionId.length > 12 ? sessionId.slice(0, 12) + "…" : sessionId;
    this.sessionItem.text = `$(bookmark) ${truncated}`;
    this.sessionItem.tooltip = `Session: ${sessionId}\nClick to restore`;
    this.sessionItem.show();
  }

  // ── T3.3.6: Processing Indicator ──

  updateProcessingStatus(status: "idle" | "processing" | "error"): void {
    if (status === "processing") {
      this.processingItem.text = "$(sync~spin) Processing...";
      this.processingItem.show();
    } else {
      this.processingItem.hide();
      if (this.spinnerInterval) {
        clearInterval(this.spinnerInterval);
        this.spinnerInterval = undefined;
      }
    }
  }

  // ── T3.3.7: Crew Indicator ──

  updateCrewIndicator(crewName: string | undefined): void {
    if (!crewName) {
      this.crewItem.hide();
      return;
    }
    this.crewItem.text = `$(organization) ${crewName}`;
    this.crewItem.tooltip = `Crew: ${crewName}\nClick to switch`;
    this.crewItem.show();
  }

  // ── T3.3.8: Plan Mode Indicator ──

  updatePlanModeIndicator(active: boolean): void {
    if (active) {
      this.planModeItem.text = "$(checklist) Plan";
      this.planModeItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.prominentBackground"
      );
      this.planModeItem.show();
    } else {
      this.planModeItem.hide();
    }
  }

  // ── Disposal ──

  dispose(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
```

### T3.3.2: Provider Indicator — Acceptance Criteria

- Shows `$(sparkle) openai` (or appropriate icon) on left side at priority 100
- Clicking executes `agentx.switchProvider`
- Updates immediately when provider changes
- Tooltip shows full provider name
- Hidden if no provider configured

### T3.3.3: Model Indicator — Acceptance Criteria

- Shows `$(symbol-misc) gpt-4o` on left side at priority 99
- Long model names truncated at 25 characters with ellipsis
- Clicking executes `agentx.switchModel`
- Tooltip shows full model ID
- Updates immediately when model changes

### T3.3.4: Token Usage — Acceptance Criteria

- Shows `$(pulse) 12.5K/128K (10%)` on left side at priority 98
- Color coding: default/green <50%, yellow 50-80%, red >80%
- Red background when >80%
- Clicking executes `agentx.showCost`
- Hidden until first token usage event received
- Tooltip shows exact numbers and cost

### T3.3.5: Session Indicator — Acceptance Criteria

- Shows `$(bookmark) abc123def456…` on left side at priority 97
- Session ID truncated to 12 characters
- Clicking executes `agentx.restoreSession`
- Hidden when no active session
- Tooltip shows full session ID

### T3.3.6: Processing Indicator — Acceptance Criteria

- Shows `$(sync~spin) Processing...` on left side at priority 96
- Uses VS Code's built-in spinning icon animation
- Warning background color
- Clicking executes `agentx.cancelTask`
- Hidden when idle
- Tooltip explains click-to-cancel

### T3.3.7: Crew Indicator — Acceptance Criteria

- Shows `$(organization) Full Stack Team` on left side at priority 95
- Clicking executes `agentx.switchCrew`
- Hidden when no crew is active
- Tooltip shows full crew name

### T3.3.8: Plan Mode Indicator — Acceptance Criteria

- Shows `$(checklist) Plan` on left side at priority 94
- Prominent background color when active
- Clicking executes `agentx.togglePlanMode`
- Hidden when plan mode is off
- Tooltip explains plan approval mode

---

## T3.4: Configuration Change Handling

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/config/ConfigurationWatcher.ts`
**Estimated Effort**: 2 hours

### T3.4.1: ConfigurationWatcher Class

```typescript
import * as vscode from "vscode";
import { ConfigBridge } from "../adapter/ConfigBridge";
import { EngineLifecycle } from "../adapter/EngineLifecycle";
import { StatusBarManager } from "../statusbar/StatusBarManager";

export class ConfigurationWatcher implements vscode.Disposable {
  private disposable: vscode.Disposable;

  constructor(
    private configBridge: ConfigBridge,
    private engineLifecycle: EngineLifecycle,
    private statusBarManager: StatusBarManager
  ) {
    this.disposable = vscode.workspace.onDidChangeConfiguration(
      (event) => this.onConfigurationChanged(event)
    );
  }

  private async onConfigurationChanged(
    event: vscode.ConfigurationChangeEvent
  ): Promise<void> {
    if (!event.affectsConfiguration("agentx")) {
      return;
    }

    const config = vscode.workspace.getConfiguration("agentx");

    // T3.4.2: Provider setting
    if (event.affectsConfiguration("agentx.provider")) {
      const provider = config.get<string>("provider");
      if (provider) {
        this.configBridge.setActiveProvider(provider);
        await this.engineLifecycle.switchProvider(provider);
        this.statusBarManager.updateProviderIndicator(provider);
      }
    }

    // T3.4.3: Model setting
    if (event.affectsConfiguration("agentx.model")) {
      const model = config.get<string>("model");
      if (model) {
        this.configBridge.setActiveModel(model);
        await this.engineLifecycle.switchModel(model);
        this.statusBarManager.updateModelIndicator(model);
      }
    }

    // T3.4.4: Auto-approve setting
    if (event.affectsConfiguration("agentx.autoApprove")) {
      const autoApprove = config.get<string[]>("autoApprove") || [];
      this.configBridge.setAutoApproveCategories(autoApprove);
      await this.engineLifecycle.updatePermissionConfig(autoApprove);
    }

    // T3.4.5: Theme setting
    if (event.affectsConfiguration("agentx.theme")) {
      const theme = config.get<string>("theme") || "auto";
      this.configBridge.setWebviewTheme(theme);
      await vscode.commands.executeCommand("agentx.chatView.refreshTheme");
    }

    // T3.4.6: Budget setting
    if (event.affectsConfiguration("agentx.maxBudget")) {
      const maxBudget = config.get<number>("maxBudget") || 0;
      this.configBridge.setMaxBudget(maxBudget);
      await this.engineLifecycle.updateBudgetLimit(maxBudget);
    }

    // T3.4.7: Plan mode setting
    if (event.affectsConfiguration("agentx.planMode")) {
      const planMode = config.get<boolean>("planMode") || false;
      this.configBridge.setPlanMode(planMode);
      await this.engineLifecycle.setPlanMode(planMode);
      this.statusBarManager.updatePlanModeIndicator(planMode);
    }

    // T3.4.8: Determine if engine restart is needed
    if (
      event.affectsConfiguration("agentx.provider") ||
      event.affectsConfiguration("agentx.model")
    ) {
      const needsRestart = this.engineLifecycle.requiresRestartForConfigChange();
      if (needsRestart && this.engineLifecycle.hasActiveAgent()) {
        const restart = await vscode.window.showWarningMessage(
          "Agent-X: Provider/model change requires an engine restart. Restart now?",
          "Restart",
          "Later"
        );
        if (restart === "Restart") {
          await this.engineLifecycle.disposeCurrentAgent();
          await this.engineLifecycle.createAgent();
        }
      }
    }
  }

  dispose(): void {
    this.disposable.dispose();
  }
}
```

### T3.4.2–T3.4.7: Settings Mapping — Acceptance Criteria

| VS Code Setting | Config Path | Engine Update | Restart Required? |
|---|---|---|---|
| `agentx.provider` | `config.provider.activeProvider` | `switchProvider()` | Yes |
| `agentx.model` | `config.provider.activeModel` | `switchModel()` | Yes |
| `agentx.autoApprove` | `config.permissions.autoApprove` | `updatePermissionConfig()` | No |
| `agentx.theme` | `config.ui.theme` | Webview refresh | No |
| `agentx.maxBudget` | `config.budget.maxBudget` | `updateBudgetLimit()` | No |
| `agentx.planMode` | `config.planMode` | `setPlanMode()` | No |

### T3.4.8: Engine Restart Logic — Acceptance Criteria

- Only prompts for restart when provider or model changes
- Checks if engine is actually running before prompting
- Restart disposes current agent and creates new one
- "Later" option defers restart to next session creation

---

## T3.5: Workspace Folder Handling

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/config/WorkspaceWatcher.ts`
**Estimated Effort**: 1 hour

### T3.5.1: WorkspaceWatcher Class

```typescript
import * as vscode from "vscode";
import { EngineLifecycle } from "../adapter/EngineLifecycle";
import { StatusBarManager } from "../statusbar/StatusBarManager";
import { ChatViewProvider } from "../views/ChatViewProvider";

export class WorkspaceWatcher implements vscode.Disposable {
  private disposable: vscode.Disposable;

  constructor(
    private engineLifecycle: EngineLifecycle,
    private statusBarManager: StatusBarManager,
    private chatViewProvider: ChatViewProvider
  ) {
    this.disposable = vscode.workspace.onDidChangeWorkspaceFolders(
      (event) => this.onWorkspaceFoldersChanged(event)
    );
  }

  private async onWorkspaceFoldersChanged(
    event: vscode.WorkspaceFoldersChangeEvent
  ): Promise<void> {
    const added = event.added;
    const removed = event.removed;

    if (removed.length > 0 && added.length === 0) {
      // All workspace folders removed
      if (this.engineLifecycle.hasActiveAgent()) {
        await this.engineLifecycle.disposeCurrentAgent();
        this.statusBarManager.updateSessionIndicator(undefined);
        this.chatViewProvider.notifyWorkspaceRemoved();
      }
      return;
    }

    if (added.length > 0) {
      // New workspace folder added — re-initialize engine
      const newRoot =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      if (!newRoot) return;

      const wasRunning = this.engineLifecycle.hasActiveAgent();

      if (wasRunning) {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Agent-X: Workspace changed. Re-initializing engine...",
            cancellable: false,
          },
          async () => {
            await this.engineLifecycle.disposeCurrentAgent();
            this.engineLifecycle.setWorkspaceRoot(newRoot!);
            await this.engineLifecycle.createAgent();
          }
        );
      } else {
        this.engineLifecycle.setWorkspaceRoot(newRoot);
      }

      this.statusBarManager.updateSessionIndicator(
        this.engineLifecycle.getCurrentSessionId()
      );

      this.chatViewProvider.notifyWorkspaceChanged(newRoot);

      vscode.window.showInformationMessage(
        `Agent-X: Workspace changed to ${newRoot}. Engine ${wasRunning ? "re-initialized" : "root updated"}.`
      );
    }
  }

  dispose(): void {
    this.disposable.dispose();
  }
}
```

### T3.5.2: Workspace Change Handling — Acceptance Criteria

- When all workspace folders removed: engine disposed, session indicator hidden, webview notified
- When new workspace folder added: engine re-initialized with new root
- Progress notification shown during re-initialization
- Status bar updated with new session ID
- Webview notified to update workspace context
- If engine wasn't running, only the root path is updated (no agent creation)

---

## T3.6: First-Run Setup Wizard

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/wizard/FirstRunWizard.ts`
**Estimated Effort**: 3 hours

### T3.6.1: FirstRunWizard Class

```typescript
import * as vscode from "vscode";
import { ConfigBridge } from "../adapter/ConfigBridge";

interface WizardResult {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  crew: string;
}

export class FirstRunWizard {
  constructor(private configBridge: ConfigBridge) {}

  async run(): Promise<boolean> {
    // T3.6.2: Step 1 — Welcome
    const welcome = await vscode.window.showInformationMessage(
      "Welcome to Agent-X! Let's set up your AI assistant. This will only take a minute.",
      "Get Started",
      "Skip (configure later)"
    );

    if (welcome !== "Get Started") {
      return false;
    }

    try {
      // T3.6.3: Step 2 — Provider Selection
      const provider = await this.selectProvider();
      if (!provider) return false;

      // T3.6.4: Step 3 — API Key (cloud providers)
      let apiKey: string | undefined;
      const isLocal = ["ollama", "lmstudio"].includes(provider);

      if (!isLocal) {
        apiKey = await this.enterApiKey(provider);
        if (apiKey === undefined) return false;
      }

      // T3.6.5: Step 4 — Base URL (local providers or custom)
      let baseUrl: string | undefined;
      if (isLocal) {
        baseUrl = await this.enterBaseUrl(provider);
      }

      // T3.6.6: Step 5 — Model Selection
      const model = await this.selectModel(provider, apiKey, baseUrl);
      if (!model) return false;

      // T3.6.7: Step 6 — Crew Selection
      const crew = await this.selectCrew();

      // T3.6.8: Step 7 — Save Configuration
      await this.saveConfig({
        provider,
        apiKey,
        baseUrl,
        model,
        crew,
      });

      vscode.window.showInformationMessage(
        `Agent-X: Setup complete! Using ${provider}/${model}. You can change settings anytime via the command palette.`
      );

      return true;
    } catch (error) {
      vscode.window.showErrorMessage(
        `Agent-X: Setup failed — ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  // T3.6.3: Provider Selection
  private async selectProvider(): Promise<string | undefined> {
    interface ProviderItem extends vscode.QuickPickItem {
      providerId: string;
    }

    const items: ProviderItem[] = [
      {
        label: "$(sparkle) OpenAI",
        description: "GPT-4o, GPT-4, o1, etc.",
        detail: "Requires OPENAI_API_KEY",
        providerId: "openai",
      },
      {
        label: "$(brain) Anthropic",
        description: "Claude 3.5 Sonnet, Claude 3 Opus, etc.",
        detail: "Requires ANTHROPIC_API_KEY",
        providerId: "anthropic",
      },
      {
        label: "$(globe) Google",
        description: "Gemini Pro, Gemini Ultra, etc.",
        detail: "Requires GOOGLE_API_KEY",
        providerId: "google",
      },
      {
        label: "$(server) Ollama",
        description: "Local models via Ollama",
        detail: "Runs locally — no API key needed",
        providerId: "ollama",
      },
      {
        label: "$(server) LM Studio",
        description: "Local models via LM Studio",
        detail: "Runs locally — no API key needed",
        providerId: "lmstudio",
      },
    ];

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select your AI provider",
      title: "Agent-X Setup — Step 1/4: Provider",
      ignoreFocusOut: true,
    });

    return selected?.providerId;
  }

  // T3.6.4: API Key Input
  private async enterApiKey(provider: string): Promise<string | undefined> {
    const envVarMap: Record<string, string> = {
      openai: "OPENAI_API_KEY",
      anthropic: "ANTHROPIC_API_KEY",
      google: "GOOGLE_API_KEY",
    };

    const envVar = envVarMap[provider] || "API_KEY";

    const key = await vscode.window.showInputBox({
      prompt: `Enter your ${provider} API key`,
      placeHolder: `Paste your ${envVar} here`,
      password: true,
      ignoreFocusOut: true,
      title: "Agent-X Setup — Step 2/4: API Key",
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return "API key is required";
        }
        return undefined;
      },
    });

    return key?.trim();
  }

  // T3.6.5: Base URL Input
  private async enterBaseUrl(provider: string): Promise<string | undefined> {
    const defaultUrls: Record<string, string> = {
      ollama: "http://localhost:11434",
      lmstudio: "http://localhost:1234/v1",
    };

    const url = await vscode.window.showInputBox({
      prompt: `Enter the base URL for ${provider}`,
      placeHolder: defaultUrls[provider] || "http://localhost:8080",
      value: defaultUrls[provider] || "",
      ignoreFocusOut: true,
      title: "Agent-X Setup — Step 2/4: Base URL",
      validateInput: (value) => {
        if (value && value.trim().length > 0) {
          try {
            new URL(value);
          } catch {
            return "Must be a valid URL";
          }
        }
        return undefined;
      },
    });

    return url?.trim() || defaultUrls[provider];
  }

  // T3.6.6: Model Selection
  private async selectModel(
    provider: string,
    apiKey?: string,
    baseUrl?: string
  ): Promise<string | undefined> {
    let models: Array<{ id: string; name: string; description?: string }> = [];

    try {
      models = await this.configBridge.fetchModelsForProvider(
        provider,
        apiKey,
        baseUrl
      );
    } catch {
      // Fallback: show manual input
    }

    if (models.length > 0) {
      interface ModelItem extends vscode.QuickPickItem {
        modelId: string;
      }

      const items: ModelItem[] = models.map((m) => ({
        label: m.name || m.id,
        description: m.description,
        modelId: m.id,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Select a model",
        title: "Agent-X Setup — Step 3/4: Model",
        ignoreFocusOut: true,
        matchOnDescription: true,
      });

      return selected?.modelId;
    }

    // Fallback: manual model ID input
    const manualModel = await vscode.window.showInputBox({
      prompt: "Enter model ID",
      placeHolder: this.getDefaultModelForProvider(provider),
      value: this.getDefaultModelForProvider(provider),
      ignoreFocusOut: true,
      title: "Agent-X Setup — Step 3/4: Model (manual entry)",
      validateInput: (v) =>
        !v || v.trim().length === 0 ? "Model ID required" : undefined,
    });

    return manualModel?.trim();
  }

  // T3.6.7: Crew Selection
  private async selectCrew(): Promise<string> {
    const crews = this.configBridge.getAvailableCrews();

    if (crews.length === 0) {
      return "default";
    }

    interface CrewItem extends vscode.QuickPickItem {
      crewId: string;
    }

    const items: CrewItem[] = [
      {
        label: "$(person) Solo (no crew)",
        description: "Single agent, no crew orchestration",
        crewId: "default",
      },
      ...crews.map((c) => ({
        label: `$(organization) ${c.name}`,
        description: `${c.members?.length || 0} members`,
        crewId: c.id,
      })),
    ];

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a crew (or solo mode)",
      title: "Agent-X Setup — Step 4/4: Crew",
      ignoreFocusOut: true,
    });

    return selected?.crewId || "default";
  }

  // T3.6.8: Save Configuration
  private async saveConfig(result: WizardResult): Promise<void> {
    this.configBridge.setActiveProvider(result.provider);

    if (result.apiKey) {
      this.configBridge.setProviderApiKey(result.provider, result.apiKey);
    }

    if (result.baseUrl) {
      this.configBridge.setProviderBaseUrl(result.provider, result.baseUrl);
    }

    this.configBridge.setActiveModel(result.model);
    this.configBridge.setActiveCrew(result.crew);

    await this.configBridge.saveConfig();
  }

  private getDefaultModelForProvider(provider: string): string {
    const defaults: Record<string, string> = {
      openai: "gpt-4o",
      anthropic: "claude-sonnet-4-20250514",
      google: "gemini-2.0-flash",
      ollama: "llama3",
      lmstudio: "local-model",
    };
    return defaults[provider] || "default";
  }
}
```

### T3.6.2–T3.6.8: Wizard Steps — Acceptance Criteria

| Step | Input Type | Validation | Cancellation |
|---|---|---|---|
| Welcome | InformationMessage | N/A | "Skip" returns false |
| Provider | QuickPick (5 options) | Must select | Escape returns false |
| API Key | InputBox (password) | Non-empty | Escape returns false |
| Base URL | InputBox | Valid URL | Uses default if empty |
| Model | QuickPick (fetched) or InputBox | Must select/enter | Escape returns false |
| Crew | QuickPick (existing + solo) | Defaults to "default" | Escape uses "default" |
| Save | Automatic | N/A | N/A |

- Each step has `ignoreFocusOut: true` to prevent accidental dismissal
- Step titles show progress (e.g., "Step 2/4")
- API key input uses `password: true`
- Model list fetched from provider API when possible, falls back to manual input
- Config saved atomically at the end
- Success message shows provider/model combination

---

## T3.7: Context Keys

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/context/ContextKeyManager.ts`
**Estimated Effort**: 1 hour

### T3.7.1: ContextKeyManager Class

```typescript
import * as vscode from "vscode";

export class ContextKeyManager implements vscode.Disposable {
  private keys: Map<string, boolean> = new Map();
  private static readonly KNOWN_KEYS = [
    "agentx.isProcessing",
    "agentx.hasSession",
    "agentx.isConfigured",
    "agentx.planMode",
    "agentx.hasPermissionRequest",
  ] as const;

  constructor() {
    for (const key of ContextKeyManager.KNOWN_KEYS) {
      this.keys.set(key, false);
      vscode.commands.executeCommand("setContext", key, false);
    }
  }

  set(key: string, value: boolean): void {
    const currentValue = this.keys.get(key);
    if (currentValue === value) return;

    this.keys.set(key, value);
    vscode.commands.executeCommand("setContext", key, value);
  }

  get(key: string): boolean {
    return this.keys.get(key) || false;
  }

  resetAll(): void {
    for (const key of this.keys.keys()) {
      this.keys.set(key, false);
      vscode.commands.executeCommand("setContext", key, false);
    }
  }

  dispose(): void {
    this.resetAll();
  }
}
```

### T3.7.2: Context Key Definitions

| Context Key | Type | Set When | Used By |
|---|---|---|---|
| `agentx.isProcessing` | boolean | Agent is executing a completion loop | Hide/show cancel button, disable send button in webview, conditional menu items |
| `agentx.hasSession` | boolean | An active session exists | Enable/disable session-dependent commands, show/hide session status bar |
| `agentx.isConfigured` | boolean | Valid config exists at `~/.config/agentx/config.json` | Show setup wizard vs. main UI, enable/disable all commands |
| `agentx.planMode` | boolean | Plan approval mode is active | Show plan approval UI elements, conditional status bar coloring |
| `agentx.hasPermissionRequest` | boolean | A permission modal is waiting for response | Highlight permission UI, prevent duplicate modals |

### T3.7.3: Context Key Update Points

```typescript
// In extension.ts activate(), context keys are updated at these points:

// After config check:
contextKeyManager.set("agentx.isConfigured", configBridge.hasValidConfig());

// On engine status change:
eventBridge.onStatusChange((status) => {
  contextKeyManager.set("agentx.isProcessing", status === "processing");
});

// On session change:
eventBridge.onSessionChange(() => {
  contextKeyManager.set("agentx.hasSession", engineLifecycle.hasActiveSession());
});

// On plan mode toggle:
eventBridge.onPlanModeChange((active) => {
  contextKeyManager.set("agentx.planMode", active);
});

// On permission events:
eventBridge.onPermissionRequest(() => {
  contextKeyManager.set("agentx.hasPermissionRequest", true);
});
eventBridge.onPermissionResolved(() => {
  contextKeyManager.set("agentx.hasPermissionRequest", false);
});
```

### T3.7.4: Context Keys in package.json

The `package.json` `contributes` section uses context keys for conditional UI:

```jsonc
{
  "contributes": {
    "menus": {
      "commandPalette": [
        {
          "command": "agentx.cancelTask",
          "when": "agentx.isProcessing"
        },
        {
          "command": "agentx.sendSteerMessage",
          "when": "agentx.isProcessing"
        },
        {
          "command": "agentx.exportSession",
          "when": "agentx.hasSession"
        },
        {
          "command": "agentx.clearHistory",
          "when": "agentx.hasSession"
        },
        {
          "command": "agentx.compactSession",
          "when": "agentx.hasSession && !agentx.isProcessing"
        }
      ]
    }
  }
}
```

### T3.7.5: Context Key Acceptance Criteria

- All 5 context keys initialized to `false` on activation
- Keys only updated when value actually changes (no redundant `setContext` calls)
- All keys reset to `false` on disposal
- `agentx.isProcessing` correctly reflects engine processing state
- `agentx.hasSession` correctly reflects session existence
- `agentx.isConfigured` correctly reflects config file validity
- `agentx.planMode` correctly reflects plan mode state
- `agentx.hasPermissionRequest` correctly reflects pending permission state
- Command palette conditionally shows/hides commands based on context keys

---

## T3.8: ConfigFileWatcher

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/config/ConfigFileWatcher.ts`
**Estimated Effort**: 1 hour

### T3.8.1: ConfigFileWatcher Class

```typescript
import * as vscode from "vscode";
import * as path from "path";
import { ConfigBridge } from "../adapter/ConfigBridge";
import { StatusBarManager } from "../statusbar/StatusBarManager";
import { EngineLifecycle } from "../adapter/EngineLifecycle";
import { getConfigDir } from "@agentx/engine";

export class ConfigFileWatcher implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private configBridge: ConfigBridge,
    private statusBarManager: StatusBarManager,
    private engineLifecycle: EngineLifecycle
  ) {
    const configDir = getConfigDir();
    const configPattern = new vscode.RelativePattern(
      configDir,
      "config.json"
    );

    this.watcher = vscode.workspace.createFileSystemWatcher(configPattern);

    this.watcher.onDidChange(() => this.onConfigFileChanged());
    this.watcher.onDidCreate(() => this.onConfigFileChanged());
    this.watcher.onDidDelete(() => this.onConfigFileDeleted());
  }

  private onConfigFileChanged(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      try {
        await this.configBridge.reloadFromDisk();
        this.statusBarManager.initializeFromConfig(this.configBridge.getConfig());
        this.statusBarManager.updateCrewIndicator(
          this.configBridge.getActiveCrewName()
        );
      } catch (error) {
        vscode.window.showWarningMessage(
          `Agent-X: Config file changed but reload failed — ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }, 500);
  }

  private async onConfigFileDeleted(): Promise<void> {
    vscode.window.showWarningMessage(
      "Agent-X: Config file was deleted. Extension may not work correctly."
    );
    this.statusBarManager.updateProviderIndicator("none");
    this.statusBarManager.updateModelIndicator("none");
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.watcher?.dispose();
  }
}
```

### T3.8.2: ConfigFileWatcher Acceptance Criteria

- Watches `~/.config/agentx/config.json` for changes, creation, and deletion
- 500ms debounce to avoid rapid reloads
- On change: reloads config from disk, updates status bar
- On delete: warns user, resets status bar indicators
- Properly disposed (watcher + timer)

---

## T3.9: Verification

**Status**: ⬜ Not Started
**Estimated Effort**: 2 hours

### T3.9.1: Command Palette Verification

| Test | Steps | Expected Result |
|---|---|---|
| All commands registered | Open command palette, type "Agent-X" | All 22 commands appear |
| `agentx.openChat` | Execute command | Chat sidebar focuses |
| `agentx.newSession` | Execute command | Confirmation shown, new session created |
| `agentx.restoreSession` | Execute with existing sessions | QuickPick shows sessions, selection restores |
| `agentx.deleteSession` | Execute with existing sessions | QuickPick, confirmation, session deleted |
| `agentx.exportSession` | Execute with active session | Format picker, save dialog, file written |
| `agentx.clearHistory` | Execute with active session | Confirmation, messages cleared |
| `agentx.compactSession` | Execute with active session | Progress shown, context compacted |
| `agentx.searchSessions` | Execute, enter query | Results shown, selection restores session |
| `agentx.switchModel` | Execute | Model QuickPick, model switched |
| `agentx.switchProvider` | Execute | Provider QuickPick, provider switched |
| `agentx.configureProvider` | Execute | API key / URL inputs shown |
| `agentx.switchCrew` | Execute | Crew QuickPick, crew switched |
| `agentx.createCrew` | Execute | Multi-step wizard completes |
| `agentx.editCrew` | Execute | Crew file opens in editor |
| `agentx.cancelTask` | Execute while processing | Task cancelled |
| `agentx.sendSteerMessage` | Execute while processing | Input box, steer sent |
| `agentx.togglePlanMode` | Execute | Plan mode toggled |
| `agentx.showPermissions` | Execute | Permission audit shown |
| `agentx.showCost` | Execute with session | Token usage document shown |
| `agentx.openConfig` | Execute | Config file opened in editor |
| `agentx.openSecretSauce` | Execute | Directory revealed in explorer |
| `agentx.showAbout` | Execute | About document shown |

### T3.9.2: Status Bar Verification

| Test | Expected Result |
|---|---|
| Provider indicator visible | Shows provider name with icon |
| Provider click | Opens provider QuickPick |
| Model indicator visible | Shows model name |
| Model click | Opens model QuickPick |
| Token usage updates | Colors change at 50% and 80% thresholds |
| Session indicator | Shows truncated ID, hides when no session |
| Processing indicator | Shows spinner during execution, hides when idle |
| Crew indicator | Shows crew name, hides when no crew |
| Plan mode indicator | Shows "Plan" when active, hides when inactive |

### T3.9.3: First-Run Wizard Verification

| Test | Expected Result |
|---|---|
| No config file | Wizard shown on activation |
| Skip button | Extension activates with limited functionality |
| Full wizard flow | All 4 steps completed, config saved |
| Cancel at any step | Wizard aborts, no partial config written |
| Invalid API key | Validation error shown |
| Invalid URL | Validation error shown |

### T3.9.4: Workspace Change Verification

| Test | Expected Result |
|---|---|
| Add workspace folder | Engine re-initialized with new root |
| Remove all folders | Engine disposed |
| Switch workspace | Progress shown, engine re-initialized |

### T3.9.5: Configuration Sync Verification

| Test | Expected Result |
|---|---|
| Change `agentx.provider` in settings | Provider switches, restart prompted |
| Change `agentx.model` in settings | Model switches, restart prompted |
| Change `agentx.autoApprove` in settings | Permission config updated |
| Change `agentx.theme` in settings | Webview theme refreshed |
| Change `agentx.maxBudget` in settings | Budget limit updated |
| Change `agentx.planMode` in settings | Plan mode toggled |

### T3.9.6: Context Key Verification

| Test | Expected Result |
|---|---|
| `agentx.cancelTask` in palette | Only visible when `agentx.isProcessing` is true |
| `agentx.exportSession` in palette | Only visible when `agentx.hasSession` is true |
| `agentx.compactSession` in palette | Only visible when session exists and not processing |

### T3.9.7: Lint and Type Check

```bash
pnpm --filter @agentx/vscode run typecheck
pnpm --filter @agentx/vscode run lint
```

Both must pass with zero errors.

---

## File Summary

| File | Purpose | Created In |
|---|---|---|
| `packages/vscode/src/extension.ts` | Extension entry point, activate/deactivate | T3.1 |
| `packages/vscode/src/commands/registerAllCommands.ts` | Command registration hub | T3.2.1 |
| `packages/vscode/src/commands/session/openChat.ts` | Focus chat sidebar | T3.2.2.1 |
| `packages/vscode/src/commands/session/newSession.ts` | Create new session | T3.2.2.2 |
| `packages/vscode/src/commands/session/restoreSession.ts` | Restore saved session | T3.2.2.3 |
| `packages/vscode/src/commands/session/deleteSession.ts` | Delete session | T3.2.2.4 |
| `packages/vscode/src/commands/session/exportSession.ts` | Export session | T3.2.2.5 |
| `packages/vscode/src/commands/session/clearHistory.ts` | Clear messages | T3.2.2.6 |
| `packages/vscode/src/commands/session/compactSession.ts` | Compact context | T3.2.2.7 |
| `packages/vscode/src/commands/session/searchSessions.ts` | Search sessions | T3.2.2.8 |
| `packages/vscode/src/commands/provider/switchModel.ts` | Switch model | T3.2.3.1 |
| `packages/vscode/src/commands/provider/switchProvider.ts` | Switch provider | T3.2.3.2 |
| `packages/vscode/src/commands/provider/configureProvider.ts` | Configure provider | T3.2.3.3 |
| `packages/vscode/src/commands/crew/switchCrew.ts` | Switch crew | T3.2.4.1 |
| `packages/vscode/src/commands/crew/createCrew.ts` | Create crew | T3.2.4.2 |
| `packages/vscode/src/commands/crew/editCrew.ts` | Edit crew | T3.2.4.3 |
| `packages/vscode/src/commands/agent/cancelTask.ts` | Cancel task | T3.2.5.1 |
| `packages/vscode/src/commands/agent/sendSteerMessage.ts` | Steer message | T3.2.5.2 |
| `packages/vscode/src/commands/agent/togglePlanMode.ts` | Toggle plan mode | T3.2.5.3 |
| `packages/vscode/src/commands/agent/showPermissions.ts` | Permission audit | T3.2.5.4 |
| `packages/vscode/src/commands/utility/showCost.ts` | Show cost/usage | T3.2.6.1 |
| `packages/vscode/src/commands/utility/openConfig.ts` | Open config file | T3.2.6.2 |
| `packages/vscode/src/commands/utility/openSecretSauce.ts` | Open secret sauce | T3.2.6.3 |
| `packages/vscode/src/commands/utility/showAbout.ts` | Show about info | T3.2.6.4 |
| `packages/vscode/src/statusbar/StatusBarManager.ts` | All status bar items | T3.3 |
| `packages/vscode/src/config/ConfigurationWatcher.ts` | VS Code settings sync | T3.4 |
| `packages/vscode/src/config/WorkspaceWatcher.ts` | Workspace folder changes | T3.5 |
| `packages/vscode/src/config/ConfigFileWatcher.ts` | Config file watcher | T3.8 |
| `packages/vscode/src/wizard/FirstRunWizard.ts` | First-run setup | T3.6 |
| `packages/vscode/src/context/ContextKeyManager.ts` | Context key management | T3.7 |
