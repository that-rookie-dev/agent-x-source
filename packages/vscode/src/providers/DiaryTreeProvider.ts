import * as vscode from 'vscode';
import type { SecretSauceManager } from '@agentx/engine';

export interface DiaryEntry {
  date: string;
  summary: string;
  sessionsCount: number;
  highlights: string[];
  insights: string[];
}

type DiaryNodeKind = 'entry' | 'empty';

export interface DiaryTreeItem {
  kind: DiaryNodeKind;
  label: string;
  description?: string;
  tooltip?: string;
  entry?: DiaryEntry;
}

export class DiaryTreeProvider implements vscode.TreeDataProvider<DiaryTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<DiaryTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private secretSauce: SecretSauceManager | null = null;

  setSecretSauce(sauce: SecretSauceManager): void {
    this.secretSauce = sauce;
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DiaryTreeItem): vscode.TreeItem {
    if (element.kind === 'empty') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('info');
      return item;
    }

    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
    item.description = element.description;
    item.tooltip = element.tooltip;
    item.iconPath = new vscode.ThemeIcon('book');
    item.contextValue = 'diary-entry';

    return item;
  }

  getChildren(element?: DiaryTreeItem): DiaryTreeItem[] {
    if (!this.secretSauce) {
      return [{ kind: 'empty', label: 'No agent active' }];
    }

    if (!element) {
      return this.getEntries();
    }

    if (element.kind === 'entry' && element.entry) {
      return this.getEntryDetails(element.entry);
    }

    return [];
  }

  private getEntries(): DiaryTreeItem[] {
    if (!this.secretSauce) return [];

    const entries = this.secretSauce.diary.getRecent(90);

    if (entries.length === 0) {
      return [{ kind: 'empty', label: 'No diary entries yet' }];
    }

    return entries
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((entry) => {
        const preview = entry.summary.length > 60
          ? entry.summary.slice(0, 57) + '...'
          : entry.summary;

        const sessionLabel = entry.sessionsCount === 1 ? '1 session' : `${entry.sessionsCount} sessions`;

        return {
          kind: 'entry' as const,
          label: entry.date,
          description: `${sessionLabel} — ${preview}`,
          tooltip: `${entry.date}\n${entry.summary}\n\nSessions: ${entry.sessionsCount}`,
          entry,
        };
      });
  }

  private getEntryDetails(entry: DiaryEntry): DiaryTreeItem[] {
    const items: DiaryTreeItem[] = [];

    items.push({
      kind: 'entry',
      label: 'Summary',
      description: entry.summary,
    });

    if (entry.highlights.length > 0) {
      items.push({
        kind: 'entry',
        label: 'Highlights',
        description: entry.highlights.join(', '),
      });
    }

    if (entry.insights.length > 0) {
      items.push({
        kind: 'entry',
        label: 'Insights',
        description: entry.insights.join(', '),
      });
    }

    items.push({
      kind: 'entry',
      label: 'Sessions',
      description: `${entry.sessionsCount}`,
    });

    return items;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
