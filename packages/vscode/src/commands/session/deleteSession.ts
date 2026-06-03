import * as vscode from 'vscode';
import type { CommandDeps } from '../registerAllCommands';

export function deleteSessionHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const sessions = await deps.engineLifecycle.listSessions();

    if (sessions.length === 0) {
      vscode.window.showInformationMessage('Agent-X: No saved sessions to delete.');
      return;
    }

    interface SessionQuickPickItem extends vscode.QuickPickItem {
      sessionId: string;
    }

    const items: SessionQuickPickItem[] = sessions.map((s) => ({
      label: `$(trash) ${s.title || 'Untitled Session'}`,
      description: `${s.messageCount} messages · ${s.id.slice(0, 8)}`,
      detail: `Last active: ${new Date(s.updatedAt).toLocaleString()}`,
      sessionId: s.id,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a session to delete',
      matchOnDescription: true,
    });

    if (!selected) return;

    const confirm = await vscode.window.showWarningMessage(
      `Delete session "${selected.label}"? This cannot be undone.`,
      { modal: true },
      'Delete',
    );

    if (confirm !== 'Delete') return;

    try {
      await deps.engineLifecycle.deleteSession(selected.sessionId);

      if (selected.sessionId === deps.engineLifecycle.getCurrentSessionId()) {
        await deps.engineLifecycle.disposeCurrentAgent();
        deps.contextKeyManager.set('agentx.hasSession', false);
        deps.statusBarManager.updateSessionIndicator(undefined);
      }

      vscode.window.showInformationMessage('Agent-X: Session deleted.');
    } catch (error) {
      vscode.window.showErrorMessage(`Agent-X: Failed to delete session — ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}
