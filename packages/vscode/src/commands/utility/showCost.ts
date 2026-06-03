import * as vscode from 'vscode';
import type { CommandDeps } from '../registerAllCommands';

export function showCostHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    if (!deps.engineLifecycle.hasActiveSession()) {
      vscode.window.showInformationMessage('Agent-X: No active session.');
      return;
    }

    const usage = deps.engineLifecycle.getTokenUsage();
    const cost = deps.engineLifecycle.getSessionCost();

    const lines: string[] = [
      'Session Token Usage',
      '',
      `Used:   ${usage.used.toLocaleString()} tokens`,
      `Total:  ${usage.total.toLocaleString()} tokens`,
      `Usage:  ${usage.percentage.toFixed(1)}%`,
      '',
      `Estimated Cost: $${cost.toFixed(4)}`,
      '',
      `Model: ${deps.configBridge.getActiveModel()}`,
      `Provider: ${deps.configBridge.getActiveProvider()}`,
    ];

    const doc = await vscode.workspace.openTextDocument({
      content: lines.join('\n'),
      language: 'plaintext',
    });

    await vscode.window.showTextDocument(doc, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside,
    });
  };
}
