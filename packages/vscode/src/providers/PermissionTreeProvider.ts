import * as vscode from 'vscode';
import type { PermissionDecision } from '@agentx/shared';
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
