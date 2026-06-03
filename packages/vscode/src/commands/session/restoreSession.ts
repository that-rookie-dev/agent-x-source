import * as vscode from 'vscode';
import type { CommandDeps } from '../registerAllCommands';

export function restoreSessionHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const sessions = await deps.engineLifecycle.listSessions();

    if (sessions.length === 0) {
      vscode.window.showInformationMessage('Agent-X: No saved sessions found.');
      return;
    }

    interface SessionQuickPickItem extends vscode.QuickPickItem {
      sessionId: string;
    }

    const items: SessionQuickPickItem[] = sessions.map((s) => ({
      label: `$(history) ${s.title || 'Untitled Session'}`,
      description: `${s.messageCount} messages · ${formatDate(s.updatedAt)}`,
      detail: `ID: ${s.id} · Model: ${s.modelId || 'unknown'}`,
      sessionId: s.id,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a session to restore',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!selected) return;

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
        },
      );

      deps.statusBarManager.updateSessionIndicator(selected.sessionId);
      deps.contextKeyManager.set('agentx.hasSession', true);

      vscode.window.showInformationMessage(`Agent-X: Session "${selected.label}" restored.`);
    } catch (error) {
      vscode.window.showErrorMessage(`Agent-X: Failed to restore session — ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}

function formatDate(timestamp: number | string): string {
  const date = typeof timestamp === 'number' ? new Date(timestamp) : new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
