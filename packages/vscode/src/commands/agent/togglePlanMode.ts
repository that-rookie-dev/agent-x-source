import * as vscode from 'vscode';
import type { CommandDeps } from '../registerAllCommands';

export function togglePlanModeHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const currentMode = deps.configBridge.isPlanModeActive();
    const newMode = !currentMode;

    try {
      deps.configBridge.setPlanMode(newMode);
      await deps.engineLifecycle.setPlanMode(newMode);

      deps.statusBarManager.updatePlanModeIndicator(newMode);
      deps.contextKeyManager.set('agentx.planMode', newMode);

      vscode.window.showInformationMessage(`Agent-X: Plan mode ${newMode ? 'enabled' : 'disabled'}.`);
    } catch (error) {
      vscode.window.showErrorMessage(`Agent-X: Failed to toggle plan mode — ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}
