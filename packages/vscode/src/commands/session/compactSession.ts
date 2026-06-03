import * as vscode from 'vscode';
import type { CommandDeps } from '../registerAllCommands';

export function compactSessionHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    if (!deps.engineLifecycle.hasActiveSession()) {
      vscode.window.showWarningMessage('Agent-X: No active session to compact.');
      return;
    }

    if (deps.engineLifecycle.isProcessing()) {
      vscode.window.showWarningMessage('Agent-X: Cannot compact while processing. Cancel the current task first.');
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Compacting session context...',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ increment: 0 });
          await deps.engineLifecycle.compactCurrentSession();
          progress.report({ increment: 100 });
        },
      );

      vscode.window.showInformationMessage('Agent-X: Session context compacted successfully.');
    } catch (error) {
      vscode.window.showErrorMessage(`Agent-X: Compaction failed — ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}
