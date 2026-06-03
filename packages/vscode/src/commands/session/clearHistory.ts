import * as vscode from 'vscode';
import type { CommandDeps } from '../registerAllCommands';

export function clearHistoryHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    if (!deps.engineLifecycle.hasActiveSession()) {
      vscode.window.showWarningMessage('Agent-X: No active session.');
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      'Clear all messages in the current session? The session will be reset but preserved.',
      { modal: true },
      'Clear',
    );

    if (confirm !== 'Clear') return;

    try {
      await deps.engineLifecycle.clearCurrentSessionMessages();
      deps.eventBridge.notifySessionCleared();
      vscode.window.showInformationMessage('Agent-X: Session history cleared.');
    } catch (error) {
      vscode.window.showErrorMessage(`Agent-X: Failed to clear history — ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}
