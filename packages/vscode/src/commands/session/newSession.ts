import * as vscode from 'vscode';
import type { CommandDeps } from '../registerAllCommands';

export function newSessionHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const confirm = await vscode.window.showWarningMessage(
      'Start a new session? The current session will be saved and a new one created.',
      'New Session',
      'Cancel',
    );

    if (confirm !== 'New Session') return;

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Creating new session...',
          cancellable: false,
        },
        async () => {
          await deps.engineLifecycle.disposeCurrentAgent();
          await deps.engineLifecycle.createAgent();
        },
      );

      deps.statusBarManager.updateSessionIndicator(deps.engineLifecycle.getCurrentSessionId());
      deps.contextKeyManager.set('agentx.hasSession', true);

      vscode.window.showInformationMessage('Agent-X: New session created.');
      deps.outputChannel.appendLine('[Agent-X] New session created.');
    } catch (error) {
      vscode.window.showErrorMessage(`Agent-X: Failed to create session — ${error instanceof Error ? error.message : String(error)}`);
      deps.outputChannel.appendLine(`[Agent-X] Session creation error: ${error}`);
    }
  };
}
