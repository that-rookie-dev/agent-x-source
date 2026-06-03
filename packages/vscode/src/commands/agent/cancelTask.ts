import * as vscode from 'vscode';
import type { CommandDeps } from '../registerAllCommands';

export function cancelTaskHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    if (!deps.engineLifecycle.isProcessing()) {
      vscode.window.showInformationMessage('Agent-X: No task is currently running.');
      return;
    }

    try {
      await deps.engineLifecycle.cancelCurrentTask();
      deps.statusBarManager.updateProcessingStatus('idle');
      deps.contextKeyManager.set('agentx.isProcessing', false);
      vscode.window.showInformationMessage('Agent-X: Task cancelled.');
    } catch (error) {
      vscode.window.showErrorMessage(`Agent-X: Failed to cancel task — ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}
