import * as vscode from 'vscode';
import type { CommandDeps } from '../registerAllCommands';

export function showPermissionsHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const permissions = await deps.engineLifecycle.getPermissionAuditLog();

    if (permissions.length === 0) {
      vscode.window.showInformationMessage('Agent-X: No permission decisions recorded.');
      return;
    }

    interface PermissionQuickPickItem extends vscode.QuickPickItem {
      permissionId: string;
    }

    const items: PermissionQuickPickItem[] = permissions.map((p) => {
      const icon = p.decision === 'approved'
        ? '$(pass-filled)'
        : p.decision === 'denied'
          ? '$(error)'
          : '$(question)';
      return {
        label: `${icon} ${p.tool}`,
        description: p.decision,
        detail: `${p.path || 'N/A'} · Risk: ${p.riskLevel} · ${new Date(p.timestamp).toLocaleString()}`,
        permissionId: p.id,
      };
    });

    await vscode.window.showQuickPick(items, {
      placeHolder: 'Permission audit log',
      matchOnDescription: true,
      matchOnDetail: true,
    });
  };
}
