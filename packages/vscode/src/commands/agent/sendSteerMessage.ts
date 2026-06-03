import * as vscode from 'vscode';
import type { CommandDeps } from '../registerAllCommands';

export function sendSteerMessageHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    if (!deps.engineLifecycle.isProcessing()) {
      vscode.window.showWarningMessage('Agent-X: Steer messages can only be sent while the agent is processing.');
      return;
    }

    const instruction = await vscode.window.showInputBox({
      prompt: 'Enter steer instruction',
      placeHolder: 'e.g., Focus on error handling first',
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value || value.trim().length === 0) return 'Instruction cannot be empty';
        return undefined;
      },
    });

    if (!instruction) return;

    try {
      await deps.engineLifecycle.sendSteerMessage(instruction.trim());
      vscode.window.showInformationMessage('Agent-X: Steer message sent.');
      deps.outputChannel.appendLine(`[Agent-X] Steer: ${instruction.trim()}`);
    } catch (error) {
      vscode.window.showErrorMessage(`Agent-X: Failed to send steer — ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}
