import * as vscode from 'vscode';
import type { SecretSauceManager } from '@agentx/engine';

export interface MemoryEntry {
  id: string;
  content: string;
  category: string;
  timestamp: string;
  relevance: number;
}

type MemoryNodeKind = 'group-header' | 'global-memory' | 'crew-memory';

export interface MemoryTreeItem {
  kind: MemoryNodeKind;
  label: string;
  description?: string;
  tooltip?: string;
  memory?: MemoryEntry;
  scope?: 'global' | 'crew';
  children?: MemoryTreeItem[];
}

export class MemoryTreeProvider implements vscode.TreeDataProvider<MemoryTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<MemoryTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private secretSauce: SecretSauceManager | null = null;
  setSecretSauce(sauce: SecretSauceManager): void {
    this.secretSauce = sauce;
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: MemoryTreeItem): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      element.children && element.children.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );

    item.description = element.description;
    item.tooltip = element.tooltip;

    if (element.kind === 'group-header') {
      item.iconPath = new vscode.ThemeIcon(element.scope === 'global' ? 'globe' : 'organization');
      item.contextValue = `memory-group-${element.scope}`;
    } else {
      const sourceIcon = element.memory?.category === 'identity'
        ? 'person'
        : element.memory?.category === 'preference'
          ? 'settings-gear'
          : 'note';
      item.iconPath = new vscode.ThemeIcon(sourceIcon);
      item.contextValue = element.scope === 'global' ? 'global-memory' : 'crew-memory';
      item.command = {
        command: 'agentx.memory.viewDetail',
        title: 'View Memory',
        arguments: [element.memory],
      };
    }

    return item;
  }

  getChildren(element?: MemoryTreeItem): MemoryTreeItem[] {
    if (!this.secretSauce) {
      return [{
        kind: 'group-header',
        label: 'No agent active',
      }];
    }

    if (!element) {
      return this.getRootGroups();
    }

    if (element.kind === 'group-header') {
      return element.children ?? [];
    }

    return [];
  }

  private getRootGroups(): MemoryTreeItem[] {
    if (!this.secretSauce) return [];

    const globalMemories = this.secretSauce.memories.getGlobalMemories(100);
    const crewMemories = this.secretSauce.memories.getCrewMemories(100);

    const groups: MemoryTreeItem[] = [];

    groups.push({
      kind: 'group-header',
      label: `Global Memories (${globalMemories.length})`,
      scope: 'global',
      children: globalMemories.map((m) => this.toTreeItem(m, 'global')),
    });

    const activeCrew = this.secretSauce.crew.getActive()!;
    groups.push({
      kind: 'group-header',
      label: `${activeCrew.name} Memories (${crewMemories.length})`,
      scope: 'crew',
      children: crewMemories.map((m) => this.toTreeItem(m, 'crew')),
    });

    return groups;
  }

  private toTreeItem(memory: MemoryEntry, scope: 'global' | 'crew'): MemoryTreeItem {
    const date = new Date(memory.timestamp);
    const dateStr = date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    });
    const timeStr = date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });

    const preview = memory.content.length > 80
      ? memory.content.slice(0, 77) + '...'
      : memory.content;

    return {
      kind: scope === 'global' ? 'global-memory' : 'crew-memory',
      label: preview,
      description: `[${memory.category}] ${dateStr}`,
      tooltip: `${memory.content}\n\nCategory: ${memory.category}\nDate: ${dateStr} ${timeStr}\nID: ${memory.id}`,
      memory,
      scope,
    };
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
