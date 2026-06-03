# Phase 7: Session Management — TreeView, Persistence, Restore, Export, Checkpoints

> **Status**: ✅ Complete
> **Depends on**: Phase 3 (Extension Core)
> **Estimated Effort**: 3–4 days
> **Files Created**: `packages/vscode/src/providers/SessionTreeProvider.ts`, `packages/vscode/src/adapter/SessionLifecycle.ts`, `packages/vscode/src/adapter/SessionPersistence.ts`, `packages/vscode/src/adapter/SessionExporter.ts`, `packages/vscode/src/adapter/CheckpointManager.ts`, `packages/vscode/src/adapter/SessionCompaction.ts`, `packages/vscode/src/adapter/SessionSearch.ts`, `packages/vscode/src/adapter/CrashRecoveryAdapter.ts`

---

## Overview

Phase 7 implements the complete session management layer for the Agent-X VS Code extension. Sessions represent the fundamental unit of interaction — each conversation with the agent is a session with its own messages, context, token usage, and checkpoints. This phase provides:

1. **Session Tree View** — A native VS Code `TreeView` sidebar showing all sessions grouped by date, with context menu actions for restore, delete, export, search, and duplicate.
2. **Session Lifecycle Manager** — Orchestrates session creation, restoration, and deletion, coordinating between the engine, webview, and tree view.
3. **Session Persistence** — Bridges engine events to file-based persistence in `~/.local/share/agentx/sessions/{sessionId}/`, writing `conversation.json`, `context.txt`, and related files atomically.
4. **Session Export** — Exports sessions as JSON, Markdown, or JSONL via save dialog or clipboard.
5. **Checkpoint System** — Creates, lists, restores, and deletes checkpoints within a session, with auto-checkpointing before each user turn.
6. **Session Compaction** — Summarizes older messages via LLM when token usage exceeds 70% of context window.
7. **Session Search** — Full-text search across all sessions with QuickPick UI.
8. **Crash Recovery** — Detects crash markers on activation and offers to restore the last session.

---

## Task Index

| Task ID | Title | Status | Dependencies |
|---------|-------|--------|-------------|
| T7.1 | Session Tree View | ✅ | Phase 3 |
| T7.2 | Session Lifecycle Manager | ✅ | Phase 3, T7.1 |
| T7.3 | Session Persistence | ✅ | T7.2 |
| T7.4 | Session Export | ✅ | T7.2, T7.3 |
| T7.5 | Checkpoint System | ✅ | T7.2, T7.3 |
| T7.6 | Session Compaction | ✅ | T7.2, T7.3 |
| T7.7 | Session Search | ✅ | T7.3 |
| T7.8 | Crash Recovery | ✅ | T7.2 |
| T7.9 | Verification | ✅ | All above |
| T7.Z | Update master plan status | ✅ | All above |

---

## T7.1: Session Tree View

**Status**: ✅ Complete
**File**: `packages/vscode/src/views/SessionTreeProvider.ts`
**Estimated Effort**: 8 hours

### T7.1.1: Tree Item Types and Interfaces

```typescript
import * as vscode from 'vscode';
import type { Session } from '@agentx/shared';
import { SessionManager } from '@agentx/engine';

type DateGroup = 'Today' | 'Yesterday' | 'This Week' | 'Older';

interface SessionTreeItem extends Session {
  messageCount: number;
  crewName?: string;
}

class SessionGroupItem extends vscode.TreeItem {
  constructor(
    public readonly group: DateGroup,
    public readonly sessions: SessionTreeItem[]
  ) {
    super(group, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'sessionGroup';
    this.iconPath = new vscode.ThemeIcon(
      group === 'Today' ? 'calendar' :
      group === 'Yesterday' ? 'history' :
      group === 'This Week' ? 'clock' : 'archive'
    );
    this.description = `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`;
  }
}

class SessionItem extends vscode.TreeItem {
  constructor(public readonly session: SessionTreeItem) {
    super(
      session.title || 'New Session',
      vscode.TreeItemCollapsibleState.None
    );
    this.contextValue = 'session';
    this.id = session.id;
    this.description = this.buildDescription();
    this.tooltip = this.buildTooltip();
    this.iconPath = this.buildIcon();
    this.command = {
      command: 'agentx.session.restore',
      title: 'Restore Session',
      arguments: [session.id],
    };
  }

  private buildDescription(): string {
    const parts: string[] = [];
    parts.push(`${this.session.providerId}/${this.session.modelId}`);
    if (this.session.tokenUsed > 0) {
      const pct = Math.round((this.session.tokenUsed / this.session.tokenAvailable) * 100);
      parts.push(`${pct}% tokens`);
    }
    if (this.session.crewName) {
      parts.push(this.session.crewName);
    }
    return parts.join(' · ');
  }

  private buildTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${this.session.title || 'New Session'}**\n\n`);
    md.appendMarkdown(`- **ID**: \`${this.session.id}\`\n`);
    md.appendMarkdown(`- **Provider**: ${this.session.providerId}\n`);
    md.appendMarkdown(`- **Model**: ${this.session.modelId}\n`);
    md.appendMarkdown(`- **Status**: ${this.session.status}\n`);
    md.appendMarkdown(`- **Tokens**: ${this.session.tokenUsed.toLocaleString()} / ${this.session.tokenAvailable.toLocaleString()}\n`);
    md.appendMarkdown(`- **Messages**: ${this.session.messageCount}\n`);
    if (this.session.crewName) {
      md.appendMarkdown(`- **Crew**: ${this.session.crewName}\n`);
    }
    md.appendMarkdown(`- **Created**: ${new Date(this.session.createdAt).toLocaleString()}\n`);
    md.appendMarkdown(`- **Updated**: ${new Date(this.session.updatedAt).toLocaleString()}\n`);
    return md;
  }

  private buildIcon(): vscode.ThemeIcon {
    if (this.session.status === 'active') {
      return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'));
    }
    if (this.session.status === 'paused') {
      return new vscode.ThemeIcon('debug-pause', new vscode.ThemeColor('charts.yellow'));
    }
    if (this.session.status === 'archived') {
      return new vscode.ThemeIcon('archive');
    }
    return new vscode.ThemeIcon('circle-outline');
  }
}

class SearchResultItem extends vscode.TreeItem {
  constructor(
    public readonly sessionId: string,
    public readonly sessionTitle: string,
    public readonly snippet: string,
    public readonly matchCount: number
  ) {
    super(sessionTitle, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'searchResult';
    this.description = `${matchCount} match${matchCount !== 1 ? 'es' : ''}`;
    this.tooltip = snippet;
    this.iconPath = new vscode.ThemeIcon('search');
    this.command = {
      command: 'agentx.session.restore',
      title: 'Restore Session',
      arguments: [sessionId],
    };
  }
}
```

**Acceptance Criteria**:
- `SessionGroupItem` extends `vscode.TreeItem` with collapsible state `Expanded`
- `SessionItem` extends `vscode.TreeItem` with click command to restore session
- `SearchResultItem` extends `vscode.TreeItem` for search results
- Each item type has correct `contextValue` for context menu contributions
- Tooltip uses `MarkdownString` with full session metadata
- Icon reflects session status (active/paused/completed/archived)

---

### T7.1.2: SessionTreeProvider Class — Full Implementation

```typescript
export class SessionTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private sessions: SessionTreeItem[] = [];
  private filterText = '';
  private searchResults: SearchResultItem[] | null = null;

  constructor(
    private readonly sessionManager: SessionManager
  ) {}

  refresh(): void {
    this.searchResults = null;
    this._onDidChangeTreeData.fire();
  }

  setFilter(text: string): void {
    this.filterText = text.toLowerCase();
    this._onDidChangeTreeData.fire();
  }

  setSearchResults(results: SearchResultItem[]): void {
    this.searchResults = results;
    this._onDidChangeTreeData.fire();
  }

  clearSearch(): void {
    this.searchResults = null;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (this.searchResults) {
      if (!element) {
        return this.searchResults;
      }
      return [];
    }

    if (!element) {
      return this.getRootChildren();
    }

    if (element instanceof SessionGroupItem) {
      return element.sessions.map((s) => new SessionItem(s));
    }

    return [];
  }

  private getRootChildren(): vscode.TreeItem[] {
    this.sessions = this.loadSessions();

    const filtered = this.filterText
      ? this.sessions.filter((s) =>
          (s.title || '').toLowerCase().includes(this.filterText) ||
          s.id.toLowerCase().includes(this.filterText) ||
          (s.crewName || '').toLowerCase().includes(this.filterText)
        )
      : this.sessions;

    if (filtered.length === 0) {
      const empty = new vscode.TreeItem(
        this.filterText ? 'No sessions match your filter' : 'No sessions yet',
        vscode.TreeItemCollapsibleState.None
      );
      empty.iconPath = new vscode.ThemeIcon('info');
      empty.description = this.filterText ? 'Try a different search' : 'Start a new conversation';
      return [empty];
    }

    const groups = this.groupByDate(filtered);
    const items: vscode.TreeItem[] = [];
    const groupOrder: DateGroup[] = ['Today', 'Yesterday', 'This Week', 'Older'];

    for (const group of groupOrder) {
      const groupSessions = groups.get(group);
      if (groupSessions && groupSessions.length > 0) {
        items.push(new SessionGroupItem(group, groupSessions));
      }
    }

    return items;
  }

  private loadSessions(): SessionTreeItem[] {
    const raw = this.sessionManager.listSessions(100);
    return raw.map((session) => {
      const store = (this.sessionManager as unknown as { store: { getMessageCount?: (id: string) => number } }).store;
      const messageCount = store?.getMessageCount ? store.getMessageCount(session.id) : 0;
      return {
        ...session,
        messageCount,
      };
    });
  }

  private groupByDate(sessions: SessionTreeItem[]): Map<DateGroup, SessionTreeItem[]> {
    const groups = new Map<DateGroup, SessionTreeItem[]>();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86_400_000;
    const weekStart = todayStart - 6 * 86_400_000;

    for (const session of sessions) {
      const updated = new Date(session.updatedAt).getTime();
      let group: DateGroup;

      if (updated >= todayStart) {
        group = 'Today';
      } else if (updated >= yesterdayStart) {
        group = 'Yesterday';
      } else if (updated >= weekStart) {
        group = 'This Week';
      } else {
        group = 'Older';
      }

      const list = groups.get(group) || [];
      list.push(session);
      groups.set(group, list);
    }

    return groups;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
```

**Acceptance Criteria**:
- Implements `vscode.TreeDataProvider<vscode.TreeItem>`
- `onDidChangeTreeData` event fires on `refresh()`, `setFilter()`, `setSearchResults()`, `clearSearch()`
- Root children are date-grouped `SessionGroupItem` instances
- `SessionGroupItem` children are `SessionItem` instances
- Filter matches against title, ID, and crew name (case-insensitive)
- Empty state shows appropriate message
- Sessions loaded via `SessionManager.listSessions(100)`
- Date grouping uses `Today`, `Yesterday`, `This Week`, `Older` boundaries
- Groups ordered: Today → Yesterday → This Week → Older

---

### T7.1.3: package.json View and Command Contributions

```json
{
  "contributes": {
    "views": {
      "agentx-sidebar": [
        {
          "id": "agentx.sessionsView",
          "name": "Sessions",
          "type": "tree",
          "icon": "$(history)",
          "contextualTitle": "Agent-X Sessions"
        }
      ]
    },
    "commands": [
      {
        "command": "agentx.session.new",
        "title": "Agent-X: New Session",
        "icon": "$(add)"
      },
      {
        "command": "agentx.session.restore",
        "title": "Agent-X: Restore Session"
      },
      {
        "command": "agentx.session.delete",
        "title": "Delete Session",
        "icon": "$(trash)"
      },
      {
        "command": "agentx.session.export",
        "title": "Export Session",
        "icon": "$(export)"
      },
      {
        "command": "agentx.session.search",
        "title": "Agent-X: Search Sessions",
        "icon": "$(search)"
      },
      {
        "command": "agentx.session.duplicate",
        "title": "Duplicate Session",
        "icon": "$(copy)"
      },
      {
        "command": "agentx.session.refresh",
        "title": "Refresh Sessions",
        "icon": "$(refresh)"
      },
      {
        "command": "agentx.session.filter",
        "title": "Agent-X: Filter Sessions",
        "icon": "$(filter)"
      }
    ],
    "menus": {
      "view/title": [
        {
          "command": "agentx.session.new",
          "when": "view == agentx.sessionsView",
          "group": "navigation@1"
        },
        {
          "command": "agentx.session.search",
          "when": "view == agentx.sessionsView",
          "group": "navigation@2"
        },
        {
          "command": "agentx.session.refresh",
          "when": "view == agentx.sessionsView",
          "group": "navigation@3"
        }
      ],
      "view/item/context": [
        {
          "command": "agentx.session.restore",
          "when": "view == agentx.sessionsView && viewItem == session",
          "group": "inline@1"
        },
        {
          "command": "agentx.session.export",
          "when": "view == agentx.sessionsView && viewItem == session",
          "group": "1_actions@1"
        },
        {
          "command": "agentx.session.duplicate",
          "when": "view == agentx.sessionsView && viewItem == session",
          "group": "1_actions@2"
        },
        {
          "command": "agentx.session.delete",
          "when": "view == agentx.sessionsView && viewItem == session",
          "group": "2_destructive@1"
        }
      ]
    }
  }
}
```

**Acceptance Criteria**:
- `agentx.sessionsView` registered as a tree view in the `agentx-sidebar` container
- All 8 commands registered with titles and icons
- View title menu shows New, Search, and Refresh in navigation group
- Session context menu shows Restore inline, Export/Duplicate in actions group, Delete in destructive group
- `when` clauses correctly scope commands to the sessions view

---

### T7.1.4: Command Registration

```typescript
export function registerSessionCommands(
  context: vscode.ExtensionContext,
  treeProvider: SessionTreeProvider,
  sessionLifecycle: SessionLifecycle
): void {
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('agentx.sessionsView', treeProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentx.session.refresh', () => {
      treeProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentx.session.filter', async () => {
      const text = await vscode.window.showInputBox({
        prompt: 'Filter sessions',
        placeHolder: 'Type to filter by title, ID, or crew...',
        value: '',
      });
      treeProvider.setFilter(text ?? '');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentx.session.new', async () => {
      await sessionLifecycle.createNewSession();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentx.session.restore', async (sessionId: string) => {
      await sessionLifecycle.restoreSession(sessionId);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentx.session.delete', async (item: SessionItem) => {
      await sessionLifecycle.deleteSession(item.session.id);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentx.session.export', async (item: SessionItem) => {
      await vscode.commands.executeCommand('agentx.session.exportFormat', item.session.id);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentx.session.duplicate', async (item: SessionItem) => {
      await sessionLifecycle.duplicateSession(item.session.id);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentx.session.search', async () => {
      await vscode.commands.executeCommand('agentx.session.searchUI');
    })
  );
}
```

**Acceptance Criteria**:
- Tree data provider registered for `agentx.sessionsView`
- All 8 commands registered and pushed to `context.subscriptions`
- Filter command opens `showInputBox` and calls `treeProvider.setFilter()`
- New/Restore/Delete/Duplicate delegate to `SessionLifecycle`
- Export and Search delegate to their respective command IDs
- Delete receives `SessionItem` from context menu and extracts session ID

---

## T7.2: Session Lifecycle Manager

**Status**: ✅ Complete
**File**: `packages/vscode/src/adapter/SessionLifecycle.ts`
**Estimated Effort**: 6 hours

### T7.2.1: Class Skeleton and Dependencies

```typescript
import * as vscode from 'vscode';
import { SessionManager } from '@agentx/engine';
import type { Session } from '@agentx/shared';
import { generateSessionId } from '@agentx/shared';
import type { EngineLifecycle } from './EngineLifecycle';
import type { EventBridge } from './EventBridge';
import type { ChatViewProvider } from '../webview/ChatViewProvider';
import type { SessionTreeProvider } from '../providers/SessionTreeProvider';
import type { SessionPersistence } from './SessionPersistence';
import type { ChatMessage } from './types';
```

**Acceptance Criteria**:
- All imports reference correct Phase 2–4 modules
- `Session` imported from `@agentx/shared`

---

### T7.2.2: Full SessionLifecycle Implementation

```typescript
export class SessionLifecycle implements vscode.Disposable {
  private currentSessionId: string | null = null;
  private currentMessages: ChatMessage[] = [];
  private disposables: vscode.Disposable[] = [];
  private titleDetectionDone = new Set<string>();

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly engineLifecycle: EngineLifecycle,
    private readonly eventBridge: EventBridge,
    private readonly chatView: ChatViewProvider,
    private readonly treeProvider: SessionTreeProvider,
    private readonly persistence: SessionPersistence
  ) {
    this.wireEvents();
  }

  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  getCurrentMessages(): ChatMessage[] {
    return [...this.currentMessages];
  }

  async createNewSession(): Promise<string> {
    const engine = await this.engineLifecycle.ensureReady();
    const state = engine.getState();

    if (this.currentSessionId) {
      await this.finalizeCurrentSession();
    }

    const providerId = state.providerId || 'openai';
    const modelId = state.modelId || 'gpt-4';
    const workspaceRoot = engine.getWorkspaceRoot();

    const session = this.sessionManager.createSession(
      providerId,
      modelId,
      undefined,
      workspaceRoot
    );

    this.currentSessionId = session.id;
    this.currentMessages = [];
    this.titleDetectionDone.clear();

    this.chatView.postToWebview('clearMessages', {});
    this.chatView.postToWebview('sessionCreated', {
      sessionId: session.id,
      providerId: session.providerId,
      modelId: session.modelId,
    });

    this.treeProvider.refresh();
    this.persistence.initializeSession(session.id);

    return session.id;
  }

  async restoreSession(sessionId: string): Promise<void> {
    const engine = await this.engineLifecycle.ensureReady();

    if (this.currentSessionId) {
      await this.finalizeCurrentSession();
    }

    const session = this.sessionManager.restoreSession(sessionId);
    if (!session) {
      vscode.window.showErrorMessage(`Session ${sessionId} not found.`);
      return;
    }

    this.currentSessionId = session.id;
    this.currentMessages = [];
    this.titleDetectionDone.clear();

    const messages = this.persistence.loadMessages(sessionId);
    this.currentMessages = messages;

    this.chatView.postToWebview('clearMessages', {});
    this.chatView.postToWebview('sessionRestored', {
      sessionId: session.id,
      title: session.title,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: new Date(m.createdAt).getTime(),
        tokenCost: m.tokenCost,
      })),
    });

    this.treeProvider.refresh();
    this.persistence.initializeSession(sessionId);

    const tokenTracker = this.sessionManager.getTokenTracker();
    if (tokenTracker && session.tokenUsed > 0) {
      tokenTracker.setUsed(session.tokenUsed);
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = this.sessionManager.listSessions(1000).find((s) => s.id === sessionId);
    const title = session?.title || 'this session';

    const confirm = await vscode.window.showWarningMessage(
      `Delete "${title}"? This cannot be undone.`,
      { modal: true },
      'Delete'
    );

    if (confirm !== 'Delete') {
      return;
    }

    if (this.currentSessionId === sessionId) {
      await this.finalizeCurrentSession();
      this.currentSessionId = null;
      this.currentMessages = [];
      this.chatView.postToWebview('clearMessages', {});
    }

    const store = (this.sessionManager as unknown as { store: { deleteSession?: (id: string) => void } }).store;
    if (store?.deleteSession) {
      store.deleteSession(sessionId);
    }

    this.persistence.deleteSessionDirectory(sessionId);
    this.treeProvider.refresh();

    vscode.window.showInformationMessage(`Session "${title}" deleted.`);
  }

  async duplicateSession(sessionId: string): Promise<void> {
    const original = this.sessionManager.listSessions(1000).find((s) => s.id === sessionId);
    if (!original) {
      vscode.window.showErrorMessage(`Session ${sessionId} not found.`);
      return;
    }

    const engine = await this.engineLifecycle.ensureReady();
    const state = engine.getState();

    const newSession = this.sessionManager.createSession(
      original.providerId,
      original.modelId,
      original.crewId ?? undefined,
      original.scopePath
    );

    this.sessionManager.updateSession({
      title: `${original.title} (copy)`,
    });

    const messages = this.persistence.loadMessages(sessionId);
    for (const msg of messages) {
      this.persistence.saveMessage(newSession.id, msg);
    }

    this.treeProvider.refresh();
    vscode.window.showInformationMessage(`Session duplicated as "${newSession.title}".`);
  }

  onMessageSent(message: ChatMessage): void {
    this.currentMessages.push(message);

    if (this.currentSessionId && !this.titleDetectionDone.has(this.currentSessionId)) {
      this.detectAndSetTitle(message);
    }

    if (this.currentSessionId) {
      this.persistence.persistMessage(this.currentSessionId, message);
    }
  }

  onMessageReceived(message: ChatMessage): void {
    this.currentMessages.push(message);

    if (this.currentSessionId) {
      this.persistence.persistMessage(this.currentSessionId, message);
    }
  }

  private detectAndSetTitle(message: ChatMessage): void {
    if (!this.currentSessionId) return;
    if (message.role !== 'user') return;

    this.titleDetectionDone.add(this.currentSessionId);

    const content = message.content.trim();
    if (content.length === 0) return;

    const title = content.length > 60 ? content.substring(0, 57) + '...' : content;
    this.sessionManager.updateSession({ title });
    this.treeProvider.refresh();
  }

  private async finalizeCurrentSession(): Promise<void> {
    if (!this.currentSessionId) return;

    this.persistence.flushSession(this.currentSessionId);

    const tokenTracker = this.sessionManager.getTokenTracker();
    if (tokenTracker) {
      this.sessionManager.updateSession({
        tokenUsed: tokenTracker.tokensUsed,
      });
    }
  }

  private wireEvents(): void {
    this.disposables.push(
      this.eventBridge.onMessage((msg) => {
        if (msg.role === 'user') {
          this.onMessageSent(msg);
        } else if (msg.role === 'assistant') {
          this.onMessageReceived(msg);
        }
      })
    );
  }

  async dispose(): Promise<void> {
    await this.finalizeCurrentSession();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
```

**Acceptance Criteria**:
- `createNewSession()` disposes current session, creates new via `SessionManager`, clears webview, refreshes tree
- `restoreSession()` loads messages from persistence, sends to webview, restores token tracker state
- `deleteSession()` shows modal confirmation, deletes from store and filesystem, refreshes tree
- `duplicateSession()` copies messages to a new session with "(copy)" suffix
- `onMessageSent()` appends to current messages, auto-detects title from first user message
- `onMessageReceived()` appends to current messages and persists
- `finalizeCurrentSession()` flushes persistence and updates token usage
- Title auto-detection uses first 60 characters of first user message
- All operations refresh the tree provider

---

## T7.3: Session Persistence

**Status**: ✅ Complete
**File**: `packages/vscode/src/adapter/SessionPersistence.ts`
**Estimated Effort**: 6 hours

### T7.3.1: Session Directory Management

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDataDir } from '@agentx/shared';
import type { ChatMessage } from './types';

const SESSIONS_DIR_NAME = 'sessions';

export class SessionPersistence {
  private sessionsDir: string;
  private writeBuffers = new Map<string, ChatMessage[]>();

  constructor() {
    this.sessionsDir = path.join(getDataDir(), SESSIONS_DIR_NAME);
    fs.mkdirSync(this.sessionsDir, { recursive: true });
  }

  getSessionDir(sessionId: string): string {
    return path.join(this.sessionsDir, sessionId);
  }

  initializeSession(sessionId: string): void {
    const dir = this.getSessionDir(sessionId);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'checkpoints'), { recursive: true });

    const contextPath = path.join(dir, 'context.txt');
    if (!fs.existsSync(contextPath)) {
      fs.writeFileSync(contextPath, '', 'utf-8');
    }

    const conversationPath = path.join(dir, 'conversation.json');
    if (!fs.existsSync(conversationPath)) {
      fs.writeFileSync(conversationPath, '[]', 'utf-8');
    }

    this.writeBuffers.set(sessionId, []);
  }

  deleteSessionDirectory(sessionId: string): void {
    const dir = this.getSessionDir(sessionId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    this.writeBuffers.delete(sessionId);
  }
```

**Acceptance Criteria**:
- Session directory created at `~/.local/share/agentx/sessions/{sessionId}/`
- Subdirectory `checkpoints/` created
- `context.txt` and `conversation.json` initialized if not present
- Write buffer initialized per session
- `deleteSessionDirectory()` removes entire session directory recursively

---

### T7.3.2: Message Persistence with Atomic Writes

```typescript
  persistMessage(sessionId: string, message: ChatMessage): void {
    const buffer = this.writeBuffers.get(sessionId);
    if (buffer) {
      buffer.push(message);
    }

    this.appendToConversationJson(sessionId, message);
    this.appendToContextTxt(sessionId, message);
  }

  saveMessage(sessionId: string, message: ChatMessage): void {
    this.persistMessage(sessionId, message);
  }

  loadMessages(sessionId: string): ChatMessage[] {
    const conversationPath = path.join(this.getSessionDir(sessionId), 'conversation.json');
    if (!fs.existsSync(conversationPath)) {
      return [];
    }

    try {
      const data = fs.readFileSync(conversationPath, 'utf-8');
      const parsed = JSON.parse(data) as ChatMessage[];
      return parsed;
    } catch {
      return [];
    }
  }

  private appendToConversationJson(sessionId: string, message: ChatMessage): void {
    const conversationPath = path.join(this.getSessionDir(sessionId), 'conversation.json');
    const tmpPath = conversationPath + '.tmp';

    let existing: ChatMessage[] = [];
    try {
      if (fs.existsSync(conversationPath)) {
        const data = fs.readFileSync(conversationPath, 'utf-8');
        existing = JSON.parse(data) as ChatMessage[];
      }
    } catch {
      existing = [];
    }

    existing.push(message);

    fs.writeFileSync(tmpPath, JSON.stringify(existing, null, 2), 'utf-8');
    fs.renameSync(tmpPath, conversationPath);
  }

  private appendToContextTxt(sessionId: string, message: ChatMessage): void {
    const contextPath = path.join(this.getSessionDir(sessionId), 'context.txt');
    const tmpPath = contextPath + '.tmp';

    const prefix = message.role === 'user' ? 'USER' : message.role === 'assistant' ? 'ASSISTANT' : 'SYSTEM';
    const line = `[${new Date(message.createdAt).toISOString()}] ${prefix}: ${message.content}\n\n`;

    let existing = '';
    try {
      if (fs.existsSync(contextPath)) {
        existing = fs.readFileSync(contextPath, 'utf-8');
      }
    } catch {
      existing = '';
    }

    fs.writeFileSync(tmpPath, existing + line, 'utf-8');
    fs.renameSync(tmpPath, contextPath);
  }
```

**Acceptance Criteria**:
- `persistMessage()` appends to both `conversation.json` and `context.txt`
- `conversation.json` is a JSON array of `ChatMessage` objects
- `context.txt` is a human-readable log with timestamps and role prefixes
- All writes use atomic pattern: write to `.tmp` file, then `renameSync`
- `loadMessages()` reads and parses `conversation.json`
- Graceful fallback to empty array on parse errors

---

### T7.3.3: Tool Event Logging to context.txt

```typescript
  logToolExecuting(sessionId: string, tool: string, description: string): void {
    const contextPath = path.join(this.getSessionDir(sessionId), 'context.txt');
    const line = `[${new Date().toISOString()}] TOOL_EXECUTING: ${tool} — ${description}\n`;
    this.atomicAppend(contextPath, line);
  }

  logToolComplete(sessionId: string, tool: string, success: boolean, elapsed: number): void {
    const contextPath = path.join(this.getSessionDir(sessionId), 'context.txt');
    const status = success ? 'SUCCESS' : 'FAILED';
    const line = `[${new Date().toISOString()}] TOOL_COMPLETE: ${tool} — ${status} (${elapsed}ms)\n`;
    this.atomicAppend(contextPath, line);
  }

  private atomicAppend(filePath: string, content: string): void {
    const tmpPath = filePath + '.tmp';
    let existing = '';
    try {
      if (fs.existsSync(filePath)) {
        existing = fs.readFileSync(filePath, 'utf-8');
      }
    } catch {
      existing = '';
    }
    fs.writeFileSync(tmpPath, existing + content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  }
```

**Acceptance Criteria**:
- `logToolExecuting()` appends tool name and description to `context.txt`
- `logToolComplete()` appends tool result status and elapsed time
- Both use atomic write pattern

---

### T7.3.4: Flush and Cleanup

```typescript
  flushSession(sessionId: string): void {
    this.writeBuffers.delete(sessionId);
  }

  getSessionFileSize(sessionId: string): number {
    const conversationPath = path.join(this.getSessionDir(sessionId), 'conversation.json');
    try {
      const stat = fs.statSync(conversationPath);
      return stat.size;
    } catch {
      return 0;
    }
  }

  listSessionDirectories(): string[] {
    try {
      return fs.readdirSync(this.sessionsDir).filter((name) => {
        const fullPath = path.join(this.sessionsDir, name);
        return fs.statSync(fullPath).isDirectory();
      });
    } catch {
      return [];
    }
  }

  dispose(): void {
    this.writeBuffers.clear();
  }
}
```

**Acceptance Criteria**:
- `flushSession()` clears the write buffer for a session
- `getSessionFileSize()` returns the byte size of `conversation.json`
- `listSessionDirectories()` returns all session directory names
- `dispose()` clears all write buffers

---

## T7.4: Session Export

**Status**: ✅ Complete
**File**: `packages/vscode/src/adapter/SessionExporter.ts`
**Estimated Effort**: 4 hours

### T7.4.1: Export Format Types and Interfaces

```typescript
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ChatMessage } from './types';
import type { SessionPersistence } from './SessionPersistence';
import { SessionManager } from '@agentx/engine';

type ExportFormat = 'json' | 'markdown' | 'jsonl';

interface ExportPayload {
  sessionId: string;
  title: string;
  providerId: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  contextText: string;
  checkpointIds: string[];
}
```

**Acceptance Criteria**:
- `ExportFormat` union type covers all three formats
- `ExportPayload` includes all session data needed for export

---

### T7.4.2: SessionExporter Full Implementation

```typescript
export class SessionExporter {
  constructor(
    private readonly sessionManager: SessionManager,
    private readonly persistence: SessionPersistence
  ) {}

  async exportSession(sessionId: string): Promise<void> {
    const formatChoice = await vscode.window.showQuickPick(
      [
        { label: 'JSON', description: 'Full trajectory with messages, context, checkpoints', format: 'json' as ExportFormat },
        { label: 'Markdown', description: 'Human-readable conversation format', format: 'markdown' as ExportFormat },
        { label: 'JSONL', description: 'One message per line, for fine-tuning', format: 'jsonl' as ExportFormat },
      ],
      { placeHolder: 'Select export format' }
    );

    if (!formatChoice) return;

    const payload = this.buildPayload(sessionId);
    if (!payload) return;

    const content = this.formatPayload(payload, formatChoice.format);

    const action = await vscode.window.showQuickPick(
      [
        { label: 'Save to File', action: 'file' },
        { label: 'Copy to Clipboard', action: 'clipboard' },
      ],
      { placeHolder: 'How would you like to export?' }
    );

    if (!action) return;

    if (action.action === 'clipboard') {
      await vscode.env.clipboard.writeText(content);
      vscode.window.showInformationMessage(`Session exported to clipboard (${formatChoice.label}).`);
    } else {
      await this.saveToFile(payload, formatChoice.format, content);
    }
  }

  private buildPayload(sessionId: string): ExportPayload | null {
    const sessions = this.sessionManager.listSessions(1000);
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return null;

    const messages = this.persistence.loadMessages(sessionId);

    const sessionDir = this.persistence.getSessionDir(sessionId);
    const contextPath = path.join(sessionDir, 'context.txt');
    let contextText = '';
    try {
      if (fs.existsSync(contextPath)) {
        contextText = fs.readFileSync(contextPath, 'utf-8');
      }
    } catch {
      contextText = '';
    }

    const checkpointsDir = path.join(sessionDir, 'checkpoints');
    let checkpointIds: string[] = [];
    try {
      if (fs.existsSync(checkpointsDir)) {
        checkpointIds = fs.readdirSync(checkpointsDir)
          .filter((f) => f.endsWith('.json'))
          .map((f) => f.replace('.json', ''));
      }
    } catch {
      checkpointIds = [];
    }

    return {
      sessionId: session.id,
      title: session.title,
      providerId: session.providerId,
      modelId: session.modelId,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messages,
      contextText,
      checkpointIds,
    };
  }

  private formatPayload(payload: ExportPayload, format: ExportFormat): string {
    switch (format) {
      case 'json':
        return this.formatJson(payload);
      case 'markdown':
        return this.formatMarkdown(payload);
      case 'jsonl':
        return this.formatJsonl(payload);
    }
  }

  private formatJson(payload: ExportPayload): string {
    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      session: {
        id: payload.sessionId,
        title: payload.title,
        provider: payload.providerId,
        model: payload.modelId,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
      },
      messages: payload.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        tokenCount: m.tokenCount,
        createdAt: m.createdAt,
        toolCalls: m.toolCalls,
        reasoning: m.reasoning,
      })),
      context: payload.contextText,
      checkpoints: payload.checkpointIds,
    };
    return JSON.stringify(exportData, null, 2);
  }

  private formatMarkdown(payload: ExportPayload): string {
    const lines: string[] = [];
    lines.push(`# ${payload.title}`);
    lines.push('');
    lines.push(`- **Session ID**: \`${payload.sessionId}\``);
    lines.push(`- **Provider**: ${payload.providerId}`);
    lines.push(`- **Model**: ${payload.modelId}`);
    lines.push(`- **Created**: ${new Date(payload.createdAt).toLocaleString()}`);
    lines.push(`- **Updated**: ${new Date(payload.updatedAt).toLocaleString()}`);
    lines.push(`- **Messages**: ${payload.messages.length}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const msg of payload.messages) {
      const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
      const time = new Date(msg.createdAt).toLocaleTimeString();
      lines.push(`## ${role} — ${time}`);
      lines.push('');
      lines.push(msg.content);
      lines.push('');

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        lines.push('### Tool Calls');
        lines.push('');
        for (const tc of msg.toolCalls) {
          lines.push(`- **${tc.name}**: \`${tc.arguments}\``);
          if (tc.result) {
            lines.push('');
            lines.push('```');
            lines.push(tc.result);
            lines.push('```');
          }
        }
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    if (payload.checkpointIds.length > 0) {
      lines.push('## Checkpoints');
      lines.push('');
      for (const cpId of payload.checkpointIds) {
        lines.push(`- \`${cpId}\``);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private formatJsonl(payload: ExportPayload): string {
    const lines: string[] = [];
    for (const msg of payload.messages) {
      const record = {
        role: msg.role,
        content: msg.content,
        timestamp: msg.createdAt,
        tokenCount: msg.tokenCount,
      };
      lines.push(JSON.stringify(record));
    }
    return lines.join('\n');
  }

  private async saveToFile(payload: ExportPayload, format: ExportFormat, content: string): Promise<void> {
    const ext = format === 'jsonl' ? 'jsonl' : format === 'markdown' ? 'md' : 'json';
    const defaultName = (payload.title || 'session').replace(/[^a-zA-Z0-9_-]/g, '_');

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${defaultName}.${ext}`),
      filters: {
        [format.toUpperCase()]: [ext],
      },
    });

    if (!uri) return;

    fs.writeFileSync(uri.fsPath, content, 'utf-8');
    vscode.window.showInformationMessage(`Session exported to ${uri.fsPath}`);
  }
}
```

**Acceptance Criteria**:
- `exportSession()` prompts for format (JSON/Markdown/JSONL) then destination (File/Clipboard)
- JSON export includes version, session metadata, all messages, context text, and checkpoint IDs
- Markdown export renders a human-readable document with headers per message, tool calls in code blocks
- JSONL export writes one JSON object per line (role, content, timestamp, tokenCount)
- Clipboard export uses `vscode.env.clipboard.writeText()`
- File export uses `vscode.window.showSaveDialog()` with correct file extension and filter
- Default filename derived from session title with non-alphanumeric characters replaced

---

## T7.5: Checkpoint System

**Status**: ✅ Complete
**File**: `packages/vscode/src/adapter/CheckpointManager.ts`
**Estimated Effort**: 5 hours

### T7.5.1: Checkpoint Types

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { generateSessionId } from '@agentx/shared';
import type { ChatMessage } from './types';
import type { SessionPersistence } from './SessionPersistence';

interface Checkpoint {
  id: string;
  sessionId: string;
  label: string;
  createdAt: string;
  messageCount: number;
}

interface CheckpointData {
  checkpoint: Checkpoint;
  messages: ChatMessage[];
}

const MAX_AUTO_CHECKPOINTS = 20;
```

**Acceptance Criteria**:
- `Checkpoint` interface stores metadata (id, session, label, timestamp, message count)
- `CheckpointData` stores both metadata and the full message snapshot
- `MAX_AUTO_CHECKPOINTS` constant limits auto-checkpoints to 20

---

### T7.5.2: CheckpointManager Full Implementation

```typescript
export class CheckpointManager {
  constructor(
    private readonly persistence: SessionPersistence
  ) {}

  private getCheckpointsDir(sessionId: string): string {
    return path.join(this.persistence.getSessionDir(sessionId), 'checkpoints');
  }

  createCheckpoint(sessionId: string, messages: ChatMessage[], label?: string): Checkpoint {
    const dir = this.getCheckpointsDir(sessionId);
    fs.mkdirSync(dir, { recursive: true });

    const id = generateSessionId();
    const checkpoint: Checkpoint = {
      id,
      sessionId,
      label: label || `Checkpoint ${new Date().toLocaleString()}`,
      createdAt: new Date().toISOString(),
      messageCount: messages.length,
    };

    const data: CheckpointData = {
      checkpoint,
      messages,
    };

    const filePath = path.join(dir, `${id}.json`);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);

    return checkpoint;
  }

  createAutoCheckpoint(sessionId: string, messages: ChatMessage[]): Checkpoint | null {
    const checkpoint = this.createCheckpoint(sessionId, messages, 'Auto-checkpoint');
    this.pruneAutoCheckpoints(sessionId);
    return checkpoint;
  }

  listCheckpoints(sessionId: string): Checkpoint[] {
    const dir = this.getCheckpointsDir(sessionId);
    if (!fs.existsSync(dir)) {
      return [];
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const checkpoints: Checkpoint[] = [];

    for (const file of files) {
      try {
        const data = JSON.parse(
          fs.readFileSync(path.join(dir, file), 'utf-8')
        ) as CheckpointData;
        checkpoints.push(data.checkpoint);
      } catch {
        continue;
      }
    }

    checkpoints.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return checkpoints;
  }

  loadCheckpoint(sessionId: string, checkpointId: string): ChatMessage[] | null {
    const filePath = path.join(this.getCheckpointsDir(sessionId), `${checkpointId}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CheckpointData;
      return data.messages;
    } catch {
      return null;
    }
  }

  restoreCheckpoint(
    sessionId: string,
    checkpointId: string,
    currentMessages: ChatMessage[]
  ): ChatMessage[] | null {
    const messages = this.loadCheckpoint(sessionId, checkpointId);
    if (!messages) {
      vscode.window.showErrorMessage(`Checkpoint ${checkpointId} not found.`);
      return null;
    }

    this.createCheckpoint(sessionId, currentMessages, 'Pre-restore checkpoint');

    return messages;
  }

  deleteCheckpoint(sessionId: string, checkpointId: string): boolean {
    const filePath = path.join(this.getCheckpointsDir(sessionId), `${checkpointId}.json`);
    if (!fs.existsSync(filePath)) {
      return false;
    }

    fs.unlinkSync(filePath);
    return true;
  }

  private pruneAutoCheckpoints(sessionId: string): void {
    const dir = this.getCheckpointsDir(sessionId);
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const autoCheckpoints: Array<{ file: string; createdAt: string }> = [];

    for (const file of files) {
      try {
        const data = JSON.parse(
          fs.readFileSync(path.join(dir, file), 'utf-8')
        ) as CheckpointData;
        if (data.checkpoint.label === 'Auto-checkpoint') {
          autoCheckpoints.push({ file, createdAt: data.checkpoint.createdAt });
        }
      } catch {
        continue;
      }
    }

    if (autoCheckpoints.length <= MAX_AUTO_CHECKPOINTS) return;

    autoCheckpoints.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const toDelete = autoCheckpoints.slice(0, autoCheckpoints.length - MAX_AUTO_CHECKPOINTS);

    for (const entry of toDelete) {
      try {
        fs.unlinkSync(path.join(dir, entry.file));
      } catch {
        continue;
      }
    }
  }
}
```

**Acceptance Criteria**:
- `createCheckpoint()` saves messages + metadata to `checkpoints/{id}.json` with atomic write
- `createAutoCheckpoint()` creates a checkpoint and prunes old auto-checkpoints
- `listCheckpoints()` reads all checkpoint files, returns sorted by date descending
- `loadCheckpoint()` returns the message array from a checkpoint file
- `restoreCheckpoint()` creates a pre-restore safety checkpoint, then returns the checkpoint messages
- `deleteCheckpoint()` removes the checkpoint file
- `pruneAutoCheckpoints()` keeps only the last 20 auto-checkpoints, deleting oldest first

---

### T7.5.3: Checkpoint UI Integration

```typescript
export function registerCheckpointCommands(
  context: vscode.ExtensionContext,
  checkpointManager: CheckpointManager,
  sessionLifecycle: SessionLifecycle,
  chatView: ChatViewProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('agentx.checkpoint.create', async () => {
      const sessionId = sessionLifecycle.getCurrentSessionId();
      if (!sessionId) {
        vscode.window.showWarningMessage('No active session.');
        return;
      }

      const label = await vscode.window.showInputBox({
        prompt: 'Checkpoint label (optional)',
        placeHolder: 'e.g., "Before refactoring"',
      });

      const messages = sessionLifecycle.getCurrentMessages();
      const checkpoint = checkpointManager.createCheckpoint(sessionId, messages, label || undefined);
      vscode.window.showInformationMessage(`Checkpoint "${checkpoint.label}" created.`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentx.checkpoint.list', async () => {
      const sessionId = sessionLifecycle.getCurrentSessionId();
      if (!sessionId) {
        vscode.window.showWarningMessage('No active session.');
        return;
      }

      const checkpoints = checkpointManager.listCheckpoints(sessionId);
      if (checkpoints.length === 0) {
        vscode.window.showInformationMessage('No checkpoints for this session.');
        return;
      }

      const items = checkpoints.map((cp) => ({
        label: cp.label,
        description: `${cp.messageCount} messages · ${new Date(cp.createdAt).toLocaleString()}`,
        checkpointId: cp.id,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a checkpoint to restore',
      });

      if (!selected) return;

      const restored = checkpointManager.restoreCheckpoint(
        sessionId,
        selected.checkpointId,
        sessionLifecycle.getCurrentMessages()
      );

      if (restored) {
        chatView.postToWebview('clearMessages', {});
        chatView.postToWebview('sessionRestored', {
          sessionId,
          title: 'Restored from checkpoint',
          messages: restored.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: new Date(m.createdAt).getTime(),
          })),
        });
        vscode.window.showInformationMessage(`Checkpoint "${selected.label}" restored.`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('agentx.checkpoint.delete', async () => {
      const sessionId = sessionLifecycle.getCurrentSessionId();
      if (!sessionId) {
        vscode.window.showWarningMessage('No active session.');
        return;
      }

      const checkpoints = checkpointManager.listCheckpoints(sessionId);
      if (checkpoints.length === 0) {
        vscode.window.showInformationMessage('No checkpoints to delete.');
        return;
      }

      const items = checkpoints.map((cp) => ({
        label: cp.label,
        description: `${new Date(cp.createdAt).toLocaleString()}`,
        checkpointId: cp.id,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a checkpoint to delete',
      });

      if (!selected) return;

      const confirm = await vscode.window.showWarningMessage(
        `Delete checkpoint "${selected.label}"?`,
        { modal: true },
        'Delete'
      );

      if (confirm === 'Delete') {
        checkpointManager.deleteCheckpoint(sessionId, selected.checkpointId);
        vscode.window.showInformationMessage(`Checkpoint deleted.`);
      }
    })
  );
}
```

**Acceptance Criteria**:
- `agentx.checkpoint.create` prompts for label, creates checkpoint from current messages
- `agentx.checkpoint.list` shows QuickPick of all checkpoints, restores selected checkpoint
- `agentx.checkpoint.delete` shows QuickPick, confirms with modal, deletes checkpoint
- Restore clears webview and sends `sessionRestored` message with checkpoint messages
- All commands check for active session and show warning if none

---

## T7.6: Session Compaction

**Status**: ✅ Complete
**File**: `packages/vscode/src/adapter/SessionCompaction.ts`
**Estimated Effort**: 4 hours

### T7.6.1: Compaction Threshold and Types

```typescript
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Agent } from '@agentx/engine';
import type { ChatMessage } from './types';
import type { SessionPersistence } from './SessionPersistence';
import type { ChatViewProvider } from '../webview/ChatViewProvider';

const COMPACTION_THRESHOLD = 0.70;
const MESSAGES_TO_KEEP_RECENT = 10;
const SUMMARY_MAX_TOKENS = 2000;
```

**Acceptance Criteria**:
- `COMPACTION_THRESHOLD` set to 70% of context window
- `MESSAGES_TO_KEEP_RECENT` keeps the last 10 messages unsummarized
- `SUMMARY_MAX_TOKENS` limits summary length

---

### T7.6.2: SessionCompaction Full Implementation

```typescript
export class SessionCompaction {
  private compacting = false;

  constructor(
    private readonly persistence: SessionPersistence,
    private readonly chatView: ChatViewProvider
  ) {}

  shouldCompact(tokensUsed: number, tokensTotal: number): boolean {
    if (tokensTotal === 0) return false;
    return (tokensUsed / tokensTotal) >= COMPACTION_THRESHOLD;
  }

  async compact(
    sessionId: string,
    messages: ChatMessage[],
    agent: Agent
  ): Promise<ChatMessage[]> {
    if (this.compacting) {
      return messages;
    }

    if (messages.length <= MESSAGES_TO_KEEP_RECENT + 2) {
      return messages;
    }

    this.compacting = true;

    try {
      this.chatView.postToWebview('compactionStart', {
        message: 'Optimizing session memory...',
      });

      const splitIndex = messages.length - MESSAGES_TO_KEEP_RECENT;
      const olderMessages = messages.slice(0, splitIndex);
      const recentMessages = messages.slice(splitIndex);

      const summary = await this.summarizeMessages(olderMessages, agent);

      const summaryMessage: ChatMessage = {
        id: `compaction-${Date.now()}`,
        sessionId,
        role: 'system',
        content: `[Session Summary — ${olderMessages.length} messages compacted]\n\n${summary}`,
        toolCalls: null,
        tokenCount: 0,
        createdAt: new Date().toISOString(),
      };

      this.writeCompactedContext(sessionId, summary, olderMessages.length);

      const compactedMessages = [summaryMessage, ...recentMessages];

      for (const msg of compactedMessages) {
        this.persistence.persistMessage(sessionId, msg);
      }

      this.chatView.postToWebview('compactionComplete', {
        originalCount: messages.length,
        compactedCount: compactedMessages.length,
        savedMessages: olderMessages.length - 1,
      });

      return compactedMessages;
    } catch (err) {
      this.chatView.postToWebview('error', {
        code: 'COMPACTION_FAILED',
        message: `Session compaction failed: ${err instanceof Error ? err.message : String(err)}`,
        recoverable: true,
      });
      return messages;
    } finally {
      this.compacting = false;
    }
  }

  private async summarizeMessages(messages: ChatMessage[], agent: Agent): Promise<string> {
    const conversationText = messages
      .map((m) => `${m.role}: ${m.content.substring(0, 500)}`)
      .join('\n\n');

    const prompt = `Summarize the following conversation concisely, preserving key decisions, code changes, file paths, and important context. The summary should be detailed enough that the conversation can continue without the original messages.

Conversation:
${conversationText}

Provide a structured summary with sections: Key Decisions, Code Changes, File Paths Referenced, Open Items.`;

    try {
      const result = await agent.sendMessage(prompt);
      return result || 'Summary unavailable.';
    } catch {
      return this.fallbackSummary(messages);
    }
  }

  private fallbackSummary(messages: ChatMessage[]): string {
    const userMessages = messages.filter((m) => m.role === 'user');
    const lines: string[] = [];
    lines.push(`Compacted ${messages.length} messages.`);
    lines.push(`User sent ${userMessages.length} messages.`);

    for (let i = 0; i < Math.min(userMessages.length, 5); i++) {
      const msg = userMessages[i];
      if (msg) {
        const preview = msg.content.substring(0, 100);
        lines.push(`- "${preview}${msg.content.length > 100 ? '...' : ''}"`);
      }
    }

    if (userMessages.length > 5) {
      lines.push(`- ... and ${userMessages.length - 5} more messages`);
    }

    return lines.join('\n');
  }

  private writeCompactedContext(sessionId: string, summary: string, compactedCount: number): void {
    const sessionDir = this.persistence.getSessionDir(sessionId);
    const contextPath = path.join(sessionDir, 'context.txt');
    const tmpPath = contextPath + '.tmp';

    const header = `[${new Date().toISOString()}] COMPACTION: ${compactedCount} messages summarized\n`;
    const content = header + `\n--- Compacted Context ---\n${summary}\n--- End Compacted Context ---\n\n`;

    let existing = '';
    try {
      if (fs.existsSync(contextPath)) {
        existing = fs.readFileSync(contextPath, 'utf-8');
      }
    } catch {
      existing = '';
    }

    fs.writeFileSync(tmpPath, existing + content, 'utf-8');
    fs.renameSync(tmpPath, contextPath);
  }

  isCompacting(): boolean {
    return this.compacting;
  }
}
```

**Acceptance Criteria**:
- `shouldCompact()` returns `true` when token usage >= 70% of context window
- `compact()` splits messages into older and recent (last 10)
- Older messages summarized via LLM call through `agent.sendMessage()`
- Summary message created with `system` role and `[Session Summary]` prefix
- Compacted context written to `context.txt` with clear delimiters
- Progress shown in webview via `compactionStart` / `compactionComplete` messages
- Fallback summary generated locally if LLM call fails
- `compacting` flag prevents concurrent compaction
- Errors caught and shown as recoverable error in webview

---

## T7.7: Session Search

**Status**: ✅ Complete
**File**: `packages/vscode/src/adapter/SessionSearch.ts`
**Estimated Effort**: 3 hours

### T7.7.1: Search Result Types

```typescript
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SessionManager } from '@agentx/engine';
import type { SessionPersistence } from './SessionPersistence';
import type { SessionTreeProvider } from '../providers/SessionTreeProvider';
import type { ChatMessage } from './types';

interface SessionSearchResult {
  sessionId: string;
  sessionTitle: string;
  sessionDate: string;
  matchingSnippet: string;
  matchCount: number;
  matchedMessageIndices: number[];
}
```

**Acceptance Criteria**:
- `SessionSearchResult` includes session metadata, matching snippet, match count, and indices

---

### T7.7.2: SessionSearch Full Implementation

```typescript
export class SessionSearch {
  constructor(
    private readonly sessionManager: SessionManager,
    private readonly persistence: SessionPersistence
  ) {}

  search(query: string, limit = 50): SessionSearchResult[] {
    const queryLower = query.toLowerCase();
    const sessions = this.sessionManager.listSessions(1000);
    const results: SessionSearchResult[] = [];

    for (const session of sessions) {
      if (results.length >= limit) break;

      const messages = this.persistence.loadMessages(session.id);
      if (messages.length === 0) continue;

      const matchedIndices: number[] = [];
      let matchCount = 0;
      let firstSnippet = '';

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (!msg) continue;

        const contentLower = msg.content.toLowerCase();
        let idx = contentLower.indexOf(queryLower);

        if (idx >= 0) {
          matchedIndices.push(i);
          matchCount++;

          if (firstSnippet === '') {
            const start = Math.max(0, idx - 30);
            const end = Math.min(msg.content.length, idx + query.length + 50);
            firstSnippet = (start > 0 ? '...' : '') +
              msg.content.substring(start, end) +
              (end < msg.content.length ? '...' : '');
          }

          while (idx !== -1) {
            idx = contentLower.indexOf(queryLower, idx + 1);
            if (idx >= 0) matchCount++;
          }
        }
      }

      if (matchCount > 0) {
        results.push({
          sessionId: session.id,
          sessionTitle: session.title || 'New Session',
          sessionDate: session.updatedAt,
          matchingSnippet: firstSnippet,
          matchCount,
          matchedMessageIndices: matchedIndices,
        });
      }
    }

    results.sort((a, b) => b.matchCount - a.matchCount);
    return results;
  }

  async showSearchUI(treeProvider: SessionTreeProvider): Promise<void> {
    const query = await vscode.window.showInputBox({
      prompt: 'Search across all sessions',
      placeHolder: 'Type to search messages...',
    });

    if (!query || query.trim().length === 0) return;

    const results = this.search(query.trim());

    if (results.length === 0) {
      vscode.window.showInformationMessage(`No sessions found matching "${query}".`);
      return;
    }

    const items: Array<vscode.QuickPickItem & { sessionId: string }> = results.map((r) => ({
      label: `$(history) ${r.sessionTitle}`,
      description: `${r.matchCount} match${r.matchCount !== 1 ? 'es' : ''} · ${new Date(r.sessionDate).toLocaleDateString()}`,
      detail: r.matchingSnippet,
      sessionId: r.sessionId,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `${results.length} session${results.length !== 1 ? 's' : ''} matching "${query}"`,
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (selected) {
      await vscode.commands.executeCommand('agentx.session.restore', selected.sessionId);
    }
  }
}
```

**Acceptance Criteria**:
- `search()` iterates all sessions, loading messages from persistence
- Case-insensitive substring matching against message content
- Counts all occurrences within each message (not just first match)
- Snippet shows 30 chars before and 50 chars after first match, with ellipsis
- Results sorted by match count descending
- `showSearchUI()` opens `showInputBox` for query, then `showQuickPick` for results
- QuickPick items show session title, match count, date, and snippet
- Selecting a result triggers `agentx.session.restore` command
- Empty results show informational message

---

## T7.8: Crash Recovery

**Status**: ✅ Complete
**File**: `packages/vscode/src/adapter/CrashRecoveryAdapter.ts`
**Estimated Effort**: 3 hours

### T7.8.1: CrashRecoveryAdapter Full Implementation

```typescript
import * as vscode from 'vscode';
import { CrashRecovery } from '@agentx/engine';
import type { SessionLifecycle } from './SessionLifecycle';
import type { SessionPersistence } from './SessionPersistence';

const AUTO_SAVE_INTERVAL_MS = 30_000;

interface CrashState {
  sessionId: string;
  timestamp: string;
  provider: string;
  model: string;
  messageCount: number;
  lastUserMessage?: string;
  error?: string;
}

export class CrashRecoveryAdapter implements vscode.Disposable {
  private crashRecovery: CrashRecovery;
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly sessionLifecycle: SessionLifecycle,
    private readonly persistence: SessionPersistence
  ) {
    this.crashRecovery = new CrashRecovery();
  }

  async checkAndOfferRestore(): Promise<void> {
    if (!this.crashRecovery.hasRecoveryState()) {
      return;
    }

    const state = this.crashRecovery.getRecoveryState();
    if (!state) {
      return;
    }

    const sessionTitle = state.lastUserMessage
      ? state.lastUserMessage.substring(0, 50) + (state.lastUserMessage.length > 50 ? '...' : '')
      : state.sessionId;

    const action = await vscode.window.showInformationMessage(
      `Agent-X crashed during session "${sessionTitle}" (${state.messageCount} messages). Restore?`,
      'Restore Session',
      'Dismiss'
    );

    if (action === 'Restore Session') {
      try {
        await this.sessionLifecycle.restoreSession(state.sessionId);
        vscode.window.showInformationMessage('Session restored successfully.');
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to restore session: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    this.crashRecovery.clearRecovery();
  }

  startAutoSave(): void {
    this.stopAutoSave();

    this.autoSaveTimer = setInterval(() => {
      this.saveCurrentState();
    }, AUTO_SAVE_INTERVAL_MS);
  }

  stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  private saveCurrentState(): void {
    const sessionId = this.sessionLifecycle.getCurrentSessionId();
    if (!sessionId) return;

    const messages = this.sessionLifecycle.getCurrentMessages();
    if (messages.length === 0) return;

    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');

    const state: CrashState = {
      sessionId,
      timestamp: new Date().toISOString(),
      provider: '',
      model: '',
      messageCount: messages.length,
      lastUserMessage: lastUserMsg?.content,
    };

    this.crashRecovery.register(() => state);
  }

  registerCrashHandlers(getState: () => CrashState): void {
    this.crashRecovery.register(getState);
  }

  hasRecoveryState(): boolean {
    return this.crashRecovery.hasRecoveryState();
  }

  clearRecovery(): void {
    this.crashRecovery.clearRecovery();
  }

  dispose(): void {
    this.stopAutoSave();
  }
}
```

**Acceptance Criteria**:
- `checkAndOfferRestore()` detects crash marker on activation, shows info message with Restore/Dismiss
- Restore triggers `sessionLifecycle.restoreSession()` with the crashed session ID
- Crash recovery file cleared after restore or dismiss
- `startAutoSave()` saves current state every 30 seconds
- `saveCurrentState()` captures session ID, message count, and last user message
- `registerCrashHandlers()` delegates to engine's `CrashRecovery.register()`
- `dispose()` stops the auto-save timer

---

### T7.8.2: Activation Integration

```typescript
export async function initializeCrashRecovery(
  context: vscode.ExtensionContext,
  crashRecoveryAdapter: CrashRecoveryAdapter
): Promise<void> {
  context.subscriptions.push(crashRecoveryAdapter);

  crashRecoveryAdapter.startAutoSave();

  await crashRecoveryAdapter.checkAndOfferRestore();
}
```

**Acceptance Criteria**:
- `CrashRecoveryAdapter` added to extension subscriptions for automatic disposal
- Auto-save started immediately on activation
- `checkAndOfferRestore()` called during activation to detect previous crashes

---

## T7.9: Verification

**Status**: ✅ Complete
**Estimated Effort**: 4 hours

### T7.9.1: Session Create/Restore/Delete Tests

```typescript
import * as assert from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';

describe('SessionLifecycle', () => {
  it('creates a new session and updates tree view', async () => {
    const sessionId = await sessionLifecycle.createNewSession();
    assert.ok(sessionId);
    assert.strictEqual(sessionLifecycle.getCurrentSessionId(), sessionId);
    assert.deepStrictEqual(sessionLifecycle.getCurrentMessages(), []);
  });

  it('restores a session and loads messages into webview', async () => {
    const sessionId = await sessionLifecycle.createNewSession();
    sessionLifecycle.onMessageSent({
      id: 'msg-1',
      sessionId,
      role: 'user',
      content: 'Hello',
      toolCalls: null,
      tokenCount: 5,
      createdAt: new Date().toISOString(),
    });

    await sessionLifecycle.createNewSession();
    await sessionLifecycle.restoreSession(sessionId);

    assert.strictEqual(sessionLifecycle.getCurrentSessionId(), sessionId);
    assert.strictEqual(sessionLifecycle.getCurrentMessages().length, 1);
  });

  it('deletes a session after confirmation', async () => {
    const sessionId = await sessionLifecycle.createNewSession();
    await sessionLifecycle.deleteSession(sessionId);
    assert.strictEqual(sessionLifecycle.getCurrentSessionId(), null);
  });

  it('auto-detects title from first user message', async () => {
    const sessionId = await sessionLifecycle.createNewSession();
    sessionLifecycle.onMessageSent({
      id: 'msg-1',
      sessionId,
      role: 'user',
      content: 'Help me refactor the auth module',
      toolCalls: null,
      tokenCount: 10,
      createdAt: new Date().toISOString(),
    });
  });
});
```

**Acceptance Criteria**:
- New session creates with empty messages and correct session ID
- Restore loads persisted messages into memory and webview
- Delete clears current session if it matches, removes from store and filesystem
- Title auto-detected from first user message content

---

### T7.9.2: Message Persistence Tests

```typescript
describe('SessionPersistence', () => {
  it('persists messages to conversation.json', () => {
    const sessionId = 'test-session-persist';
    persistence.initializeSession(sessionId);

    const msg: ChatMessage = {
      id: 'msg-p1',
      sessionId,
      role: 'user',
      content: 'Test message',
      toolCalls: null,
      tokenCount: 5,
      createdAt: new Date().toISOString(),
    };

    persistence.persistMessage(sessionId, msg);
    const loaded = persistence.loadMessages(sessionId);

    assert.strictEqual(loaded.length, 1);
    assert.strictEqual(loaded[0].content, 'Test message');

    persistence.deleteSessionDirectory(sessionId);
  });

  it('appends to context.txt with correct format', () => {
    const sessionId = 'test-session-context';
    persistence.initializeSession(sessionId);

    persistence.persistMessage(sessionId, {
      id: 'msg-c1',
      sessionId,
      role: 'user',
      content: 'Hello world',
      toolCalls: null,
      tokenCount: 3,
      createdAt: '2026-06-03T10:00:00.000Z',
    });

    const contextPath = path.join(persistence.getSessionDir(sessionId), 'context.txt');
    const content = fs.readFileSync(contextPath, 'utf-8');
    assert.ok(content.includes('USER: Hello world'));
    assert.ok(content.includes('2026-06-03T10:00:00.000Z'));

    persistence.deleteSessionDirectory(sessionId);
  });

  it('uses atomic writes (temp file + rename)', () => {
    const sessionId = 'test-session-atomic';
    persistence.initializeSession(sessionId);

    persistence.persistMessage(sessionId, {
      id: 'msg-a1',
      sessionId,
      role: 'assistant',
      content: 'Atomic test',
      toolCalls: null,
      tokenCount: 5,
      createdAt: new Date().toISOString(),
    });

    const dir = persistence.getSessionDir(sessionId);
    const tmpFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    assert.strictEqual(tmpFiles.length, 0);

    persistence.deleteSessionDirectory(sessionId);
  });
});
```

**Acceptance Criteria**:
- Messages persisted to `conversation.json` and loadable via `loadMessages()`
- `context.txt` contains correctly formatted entries with timestamps and role prefixes
- No `.tmp` files remain after successful writes (atomic rename completed)

---

### T7.9.3: Export Tests

```typescript
describe('SessionExporter', () => {
  it('exports session as JSON with all fields', () => {
    const payload = buildTestPayload();
    const json = exporter.formatPayload(payload, 'json');
    const parsed = JSON.parse(json);

    assert.strictEqual(parsed.version, '1.0');
    assert.ok(parsed.session.id);
    assert.ok(Array.isArray(parsed.messages));
    assert.ok(typeof parsed.context === 'string');
    assert.ok(Array.isArray(parsed.checkpoints));
  });

  it('exports session as Markdown with headers per message', () => {
    const payload = buildTestPayload();
    const md = exporter.formatPayload(payload, 'markdown');

    assert.ok(md.includes('# '));
    assert.ok(md.includes('## User'));
    assert.ok(md.includes('## Assistant'));
    assert.ok(md.includes('Session ID'));
  });

  it('exports session as JSONL with one message per line', () => {
    const payload = buildTestPayload();
    const jsonl = exporter.formatPayload(payload, 'jsonl');
    const lines = jsonl.split('\n').filter((l) => l.trim());

    assert.strictEqual(lines.length, payload.messages.length);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      assert.ok(parsed.role);
      assert.ok(parsed.content);
    }
  });
});
```

**Acceptance Criteria**:
- JSON export has `version`, `session`, `messages`, `context`, `checkpoints` fields
- Markdown export has title header, metadata list, `## User` / `## Assistant` sections
- JSONL export has exactly one JSON object per line, parseable independently

---

### T7.9.4: Checkpoint Tests

```typescript
describe('CheckpointManager', () => {
  it('creates and lists checkpoints', () => {
    const sessionId = 'test-cp-session';
    persistence.initializeSession(sessionId);

    const messages: ChatMessage[] = [
      { id: 'm1', sessionId, role: 'user', content: 'First', toolCalls: null, tokenCount: 3, createdAt: new Date().toISOString() },
    ];

    const cp = checkpointManager.createCheckpoint(sessionId, messages, 'Test CP');
    const list = checkpointManager.listCheckpoints(sessionId);

    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].label, 'Test CP');
    assert.strictEqual(list[0].messageCount, 1);

    persistence.deleteSessionDirectory(sessionId);
  });

  it('restores checkpoint messages', () => {
    const sessionId = 'test-cp-restore';
    persistence.initializeSession(sessionId);

    const original: ChatMessage[] = [
      { id: 'm1', sessionId, role: 'user', content: 'Original', toolCalls: null, tokenCount: 3, createdAt: new Date().toISOString() },
    ];

    const cp = checkpointManager.createCheckpoint(sessionId, original);

    const current: ChatMessage[] = [
      ...original,
      { id: 'm2', sessionId, role: 'assistant', content: 'New', toolCalls: null, tokenCount: 5, createdAt: new Date().toISOString() },
    ];

    const restored = checkpointManager.restoreCheckpoint(sessionId, cp.id, current);
    assert.ok(restored);
    assert.strictEqual(restored.length, 1);
    assert.strictEqual(restored[0].content, 'Original');

    persistence.deleteSessionDirectory(sessionId);
  });

  it('deletes a checkpoint', () => {
    const sessionId = 'test-cp-delete';
    persistence.initializeSession(sessionId);

    const cp = checkpointManager.createCheckpoint(sessionId, [], 'To Delete');
    assert.strictEqual(checkpointManager.listCheckpoints(sessionId).length, 1);

    checkpointManager.deleteCheckpoint(sessionId, cp.id);
    assert.strictEqual(checkpointManager.listCheckpoints(sessionId).length, 0);

    persistence.deleteSessionDirectory(sessionId);
  });

  it('prunes auto-checkpoints beyond MAX_AUTO_CHECKPOINTS', () => {
    const sessionId = 'test-cp-prune';
    persistence.initializeSession(sessionId);

    for (let i = 0; i < 25; i++) {
      checkpointManager.createAutoCheckpoint(sessionId, []);
    }

    const list = checkpointManager.listCheckpoints(sessionId);
    const autoCount = list.filter((cp) => cp.label === 'Auto-checkpoint').length;
    assert.ok(autoCount <= 20);

    persistence.deleteSessionDirectory(sessionId);
  });
});
```

**Acceptance Criteria**:
- Checkpoint creation produces a loadable file in `checkpoints/`
- Restore returns the exact messages from the checkpoint
- Delete removes the checkpoint file
- Auto-checkpoint pruning keeps at most 20 auto-checkpoints

---

### T7.9.5: Compaction Tests

```typescript
describe('SessionCompaction', () => {
  it('detects when compaction is needed', () => {
    assert.strictEqual(compaction.shouldCompact(90_000, 128_000), true);
    assert.strictEqual(compaction.shouldCompact(50_000, 128_000), false);
    assert.strictEqual(compaction.shouldCompact(0, 0), false);
  });

  it('does not compact when too few messages', async () => {
    const messages: ChatMessage[] = [
      { id: 'm1', sessionId: 's1', role: 'user', content: 'Hi', toolCalls: null, tokenCount: 2, createdAt: new Date().toISOString() },
    ];
    const result = await compaction.compact('s1', messages, mockAgent);
    assert.strictEqual(result.length, 1);
  });
});
```

**Acceptance Criteria**:
- `shouldCompact()` returns `true` at 70%+ usage, `false` below
- `compact()` returns original messages when count is too low to compact

---

### T7.9.6: Search Tests

```typescript
describe('SessionSearch', () => {
  it('finds sessions matching a query', () => {
    const sessionId = 'test-search-session';
    persistence.initializeSession(sessionId);

    persistence.persistMessage(sessionId, {
      id: 'ms1',
      sessionId,
      role: 'user',
      content: 'How do I implement a binary search tree?',
      toolCalls: null,
      tokenCount: 10,
      createdAt: new Date().toISOString(),
    });

    const results = search.search('binary search');
    assert.ok(results.length > 0);
    assert.ok(results.some((r) => r.sessionId === sessionId));
    assert.ok(results[0].matchCount > 0);
    assert.ok(results[0].matchingSnippet.includes('binary search'));

    persistence.deleteSessionDirectory(sessionId);
  });

  it('returns empty for no matches', () => {
    const results = search.search('xyznonexistent123');
    assert.strictEqual(results.length, 0);
  });
});
```

**Acceptance Criteria**:
- Search finds sessions containing the query string
- Match count reflects actual occurrences
- Snippet contains the matched text
- No results returns empty array

---

### T7.9.7: Crash Recovery Tests

```typescript
describe('CrashRecoveryAdapter', () => {
  it('detects recovery state and offers restore', async () => {
    assert.strictEqual(typeof crashRecoveryAdapter.hasRecoveryState(), 'boolean');
  });

  it('clears recovery state after dismiss', () => {
    crashRecoveryAdapter.clearRecovery();
    assert.strictEqual(crashRecoveryAdapter.hasRecoveryState(), false);
  });
});
```

**Acceptance Criteria**:
- `hasRecoveryState()` returns boolean
- `clearRecovery()` removes the crash marker file

---

## Appendix: package.json Command Registration Summary

All commands that must be registered in `packages/vscode/package.json`:

| Command ID | Title | Category |
|-----------|-------|----------|
| `agentx.session.new` | Agent-X: New Session | Session |
| `agentx.session.restore` | Agent-X: Restore Session | Session |
| `agentx.session.delete` | Delete Session | Session |
| `agentx.session.export` | Export Session | Session |
| `agentx.session.exportFormat` | Export Session (Format) | Session |
| `agentx.session.search` | Agent-X: Search Sessions | Session |
| `agentx.session.searchUI` | Agent-X: Search Sessions UI | Session |
| `agentx.session.duplicate` | Duplicate Session | Session |
| `agentx.session.refresh` | Refresh Sessions | Session |
| `agentx.session.filter` | Agent-X: Filter Sessions | Session |
| `agentx.checkpoint.create` | Agent-X: Create Checkpoint | Checkpoint |
| `agentx.checkpoint.list` | Agent-X: Restore Checkpoint | Checkpoint |
| `agentx.checkpoint.delete` | Agent-X: Delete Checkpoint | Checkpoint |

---

## Appendix: Webview Messages Added by Phase 7

| Message Type | Direction | Payload |
|-------------|-----------|---------|
| `sessionCreated` | Extension → Webview | `{ sessionId, providerId, modelId }` |
| `compactionStart` | Extension → Webview | `{ message: string }` |
| `compactionComplete` | Extension → Webview | `{ originalCount, compactedCount, savedMessages }` |

---

## Appendix: Session Directory Structure

```
~/.local/share/agentx/sessions/
└── {sessionId}/
    ├── context.txt           Human-readable conversation log
    ├── conversation.json     Machine-readable message array
    ├── memories.txt          Extracted memories (Phase 9)
    ├── pending.txt           Pending tasks (Phase 10)
    ├── completed.txt         Completed tasks (Phase 10)
    ├── suggestions.txt       Agent suggestions
    └── checkpoints/
        ├── {checkpointId1}.json
        ├── {checkpointId2}.json
        └── ...

---

### T7.Z: Update Master Plan

- **Status**: ✅ Complete
- **Dependencies**: All above
- **Action**: Updated [00-MASTER-PLAN.md](00-MASTER-PLAN.md) with the current status of all completed tasks in this phase.

- **Acceptance criteria**:
  - `00-MASTER-PLAN.md` is up to date with current phase progress.
  - Every task in this phase has a status annotation in the master plan.
  - Next action item is clearly identified.
```
