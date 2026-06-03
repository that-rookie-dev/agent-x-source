import * as vscode from 'vscode';
import type { MCPBridge } from '@agentx/engine';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from '@agentx/shared';

interface MCPTreeItem {
  kind: 'server' | 'tool' | 'empty';
  label: string;
  description?: string;
  tooltip?: string;
  serverName?: string;
  toolName?: string;
  toolCount?: number;
  running?: boolean;
}

export class MCPManager implements vscode.TreeDataProvider<MCPTreeItem>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<MCPTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private bridge: MCPBridge | null = null;
  private cache = new Map<string, Array<{ name: string; description: string }>>();

  attach(bridge: MCPBridge): void {
    this.bridge = bridge;
    this.discoverTools();
    this.refresh();
  }

  refresh(): void {
    this.discoverTools();
    this._onDidChangeTreeData.fire();
  }

  private discoverTools(): void {
    if (!this.bridge) return;

    for (const name of this.bridge.getServerNames()) {
      this.bridge.listTools(name).then(tools => {
        this.cache.set(name, tools.map(t => ({
          name: t.name,
          description: t.description ?? '',
        })));
        this._onDidChangeTreeData.fire();
      }).catch(() => {
        this.cache.set(name, []);
      });
    }
  }

  getTreeItem(element: MCPTreeItem): vscode.TreeItem {
    if (element.kind === 'empty') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('info');
      return item;
    }

    if (element.kind === 'server') {
      const item = new vscode.TreeItem(
        element.label,
        element.toolCount && element.toolCount > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      );

      item.description = element.description;
      item.tooltip = element.tooltip;
      item.iconPath = new vscode.ThemeIcon(
        element.running ? 'plug' : 'debug-disconnect',
      );
      item.contextValue = element.running ? 'mcp-server-running' : 'mcp-server-stopped';
      return item;
    }

    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.description = element.description;
    item.iconPath = new vscode.ThemeIcon('tools');
    item.contextValue = 'mcp-tool';
    item.command = {
      command: 'agentx.mcp.testTool',
      title: 'Test MCP Tool',
      arguments: [element.serverName, element.toolName],
    };
    return item;
  }

  getChildren(element?: MCPTreeItem): MCPTreeItem[] {
    if (!this.bridge) {
      return [{ kind: 'empty', label: 'No agent active' }];
    }

    if (!element) {
      const statuses = this.bridge.getServerStatus();
      if (statuses.length === 0) {
        return [{ kind: 'empty', label: 'No MCP servers configured' }];
      }
      return statuses.map(s => ({
        kind: 'server' as const,
        label: s.name,
        description: `${s.toolCount} tool${s.toolCount !== 1 ? 's' : ''}`,
        tooltip: [
          `Server: ${s.name}`,
          `Running: ${s.running}`,
          `Tools: ${s.toolCount}`,
          s.error ? `Error: ${s.error}` : '',
        ].filter(Boolean).join('\n'),
        serverName: s.name,
        toolCount: s.toolCount,
        running: s.running,
      }));
    }

    if (element.kind === 'server' && element.serverName) {
      const tools = this.cache.get(element.serverName) ?? [];
      if (tools.length === 0) {
        return [{ kind: 'tool', label: 'No tools discovered yet', serverName: element.serverName }];
      }
      return tools.map(t => ({
        kind: 'tool' as const,
        label: t.name,
        description: t.description.length > 50 ? t.description.slice(0, 47) + '...' : t.description,
        tooltip: `${t.name}\n${t.description}`,
        serverName: element.serverName,
        toolName: t.name,
      }));
    }

    return [];
  }

  async connectServer(name?: string): Promise<void> {
    if (!this.bridge) return;

    if (!name) {
      const manifests = await this.bridge.discover();
      const disconnected = manifests.filter(m => {
        const n = m.id.replace(/^mcp:/, '');
        return !this.bridge!.getServerNames().includes(n);
      });

      if (disconnected.length === 0) {
        vscode.window.showInformationMessage('All configured MCP servers are already connected.');
        return;
      }

      const selected = await vscode.window.showQuickPick(
        disconnected.map(m => ({
          label: m.name,
          description: m.description,
          name: m.id.replace(/^mcp:/, ''),
        })),
        { placeHolder: 'Select MCP server to connect' },
      );

      if (!selected) return;
      name = selected.name;
    }

    try {
      const manifest = { id: `mcp:${name}`, name: `MCP:${name}`, version: '0.1.0', description: '', source: 'mcp', tools: [] };
      await this.bridge.load(manifest as any);
      this.refresh();
      vscode.window.showInformationMessage(`MCP server "${name}" connected.`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to connect "${name}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnectServer(item: MCPTreeItem): Promise<void> {
    if (!this.bridge || !item.serverName) return;

    const confirmed = await vscode.window.showWarningMessage(
      `Disconnect MCP server "${item.serverName}"?`,
      { modal: true },
      'Disconnect',
    );

    if (confirmed === 'Disconnect') {
      await this.bridge.unload(item.serverName);
      this.cache.delete(item.serverName);
      this.refresh();
      vscode.window.showInformationMessage(`MCP server "${item.serverName}" disconnected.`);
    }
  }

  async testTool(serverName?: string, toolName?: string): Promise<void> {
    if (!serverName || !toolName) {
      serverName = await vscode.window.showInputBox({ prompt: 'MCP Server Name' });
      if (!serverName) return;
      toolName = await vscode.window.showInputBox({ prompt: 'Tool Name' });
      if (!toolName) return;
    }

    const argsJson = await vscode.window.showInputBox({
      prompt: `Arguments for ${toolName} (JSON)`,
      placeHolder: '{"key": "value"}',
      value: '{}',
    });
    if (argsJson === undefined) return;

    try {
      const args = JSON.parse(argsJson);
      const result = await this.bridge!.callTool(serverName, toolName, args);
      const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

      const doc = await vscode.workspace.openTextDocument({
        content: output,
        language: 'json',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch (error) {
      vscode.window.showErrorMessage(`Tool call failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async openConfig(): Promise<void> {
    const configPath = join(getConfigDir(), 'mcp.json');
    if (!existsSync(configPath)) {
      vscode.window.showWarningMessage('MCP config file does not exist yet. Connect a server first.');
      return;
    }
    const uri = vscode.Uri.file(configPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
