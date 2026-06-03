import * as vscode from 'vscode';
import type { CommandDeps } from '../registerAllCommands';

export function switchCrewHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const crews = deps.configBridge.getAvailableCrews();
    const activeCrew = deps.configBridge.getActiveCrewName();

    if (crews.length === 0) {
      const create = await vscode.window.showInformationMessage(
        'Agent-X: No crews configured. Would you like to create one?',
        'Create Crew',
        'Cancel',
      );
      if (create === 'Create Crew') {
        await vscode.commands.executeCommand('agentx.createCrew');
      }
      return;
    }

    interface CrewQuickPickItem extends vscode.QuickPickItem {
      crewId: string;
    }

    const items: CrewQuickPickItem[] = crews.map((c) => ({
      label: c.name === activeCrew ? `$(check) ${c.name}` : c.name,
      description: `${c.members?.length || 0} members`,
      detail: c.description || c.id,
      crewId: c.id,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select active crew',
      matchOnDescription: true,
    });

    if (!selected) return;

    const crewId = (selected as CrewQuickPickItem).crewId;

    try {
      deps.configBridge.setActiveCrew(crewId);
      await deps.engineLifecycle.switchCrew(crewId);
      deps.statusBarManager.updateCrewIndicator((selected as CrewQuickPickItem).label.replace('$(check) ', ''));

      vscode.window.showInformationMessage(`Agent-X: Switched to crew "${selected.label}".`);
    } catch (error) {
      vscode.window.showErrorMessage(`Agent-X: Failed to switch crew — ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}
