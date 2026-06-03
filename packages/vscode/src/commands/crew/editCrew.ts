import * as vscode from 'vscode';
import type { CommandDeps } from '../registerAllCommands';

export function editCrewHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const crews = deps.configBridge.getAvailableCrews();

    if (crews.length === 0) {
      vscode.window.showInformationMessage('Agent-X: No crews to edit.');
      return;
    }

    interface CrewQuickPickItem extends vscode.QuickPickItem {
      crewId: string;
    }

    const items: CrewQuickPickItem[] = crews.map((c) => ({
      label: c.name,
      description: `${c.members?.length || 0} members`,
      crewId: c.id,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select crew to edit',
    });

    if (!selected) return;

    const crewId = (selected as CrewQuickPickItem).crewId;
    const crewFilePath = deps.configBridge.getCrewFilePath(crewId);

    if (!crewFilePath) {
      vscode.window.showErrorMessage('Agent-X: Crew file not found.');
      return;
    }

    const uri = vscode.Uri.file(crewFilePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
  };
}
