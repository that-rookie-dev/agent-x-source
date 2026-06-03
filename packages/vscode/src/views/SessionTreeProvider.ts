import * as vscode from 'vscode';
import { EngineLifecycle } from '../adapter/EngineLifecycle';
import type { SessionInfo } from '../adapter/types';
import type { SessionPersistence } from '../adapter/SessionPersistence';

type DateGroup = 'Today' | 'Yesterday' | 'This Week' | 'Older';
const GROUP_ORDER: DateGroup[] = ['Today', 'Yesterday', 'This Week', 'Older'];

interface SessionTreeItem extends SessionInfo {
  crewName?: string;
}

class SessionGroupItem extends vscode.TreeItem {
  constructor(
    public readonly group: DateGroup,
    public readonly sessions: SessionTreeItem[],
  ) {
    super(group, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'sessionGroup';
    this.iconPath = new vscode.ThemeIcon(
      group === 'Today' ? 'calendar' :
      group === 'Yesterday' ? 'history' :
      group === 'This Week' ? 'clock' : 'archive',
    );
    this.description = `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`;
  }
}

class SessionItem extends vscode.TreeItem {
  constructor(public readonly session: SessionTreeItem) {
    super(
      session.title || 'New Session',
      vscode.TreeItemCollapsibleState.None,
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
    parts.push(`${this.session.providerId || '?'}/${this.session.modelId || '?'}`);
    if (this.session.tokenUsed > 0) {
      const pct = Math.round((this.session.tokenUsed / (this.session.tokenAvailable || 128_000)) * 100);
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
    md.appendMarkdown(`- **Tokens**: ${this.session.tokenUsed.toLocaleString()} / ${(this.session.tokenAvailable || 128_000).toLocaleString()}\n`);
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
    public readonly matchCount: number,
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

export class SessionTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private sessions: SessionTreeItem[] = [];
  private filterText = '';
  private searchResults: SearchResultItem[] | null = null;

  constructor(
    private readonly engineLifecycle: EngineLifecycle,
    private readonly persistence?: SessionPersistence,
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

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
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

  private async getRootChildren(): Promise<vscode.TreeItem[]> {
    this.sessions = await this.loadSessions();

    const filtered = this.filterText
      ? this.sessions.filter((s) =>
          (s.title || '').toLowerCase().includes(this.filterText) ||
          s.id.toLowerCase().includes(this.filterText) ||
          (s.crewName || '').toLowerCase().includes(this.filterText),
        )
      : this.sessions;

    if (filtered.length === 0) {
      const empty = new vscode.TreeItem(
        this.filterText ? 'No sessions match your filter' : 'No sessions yet',
        vscode.TreeItemCollapsibleState.None,
      );
      empty.iconPath = new vscode.ThemeIcon('info');
      empty.description = this.filterText ? 'Try a different search' : 'Start a new conversation';
      return [empty];
    }

    const groups = this.groupByDate(filtered);
    const items: vscode.TreeItem[] = [];

    for (const group of GROUP_ORDER) {
      const groupSessions = groups.get(group);
      if (groupSessions && groupSessions.length > 0) {
        items.push(new SessionGroupItem(group, groupSessions));
      }
    }

    return items;
  }

  private async loadSessions(): Promise<SessionTreeItem[]> {
    const raw = await this.engineLifecycle.listSessions();
    return raw.map((session) => {
      let messageCount = session.messageCount;
      if (messageCount === 0 && this.persistence) {
        const messages = this.persistence.loadMessages(session.id);
        messageCount = messages.length;
      }
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
