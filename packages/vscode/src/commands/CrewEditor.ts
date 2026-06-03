import * as vscode from 'vscode';
import type { CommandDeps } from './registerAllCommands';

interface CrewEditItem extends vscode.QuickPickItem {
  crewId: string;
}

export function showCrewEditor(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const crews = deps.configBridge.getAvailableCrews();

    if (crews.length === 0) {
      vscode.window.showInformationMessage('Agent-X: No crews to edit.');
      return;
    }

    const items: CrewEditItem[] = crews.map((c) => ({
      label: c.name,
      description: `${c.members?.length || 0} members`,
      detail: c.description || c.id,
      crewId: c.id,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select crew to edit',
      title: 'Agent-X: Edit Crew',
      matchOnDescription: true,
    });

    if (!selected) return;

    const crewId = (selected as CrewEditItem).crewId;

    interface ActionItem extends vscode.QuickPickItem {
      action: 'rename' | 'open_file' | 'delete';
    }

    const actionItems: ActionItem[] = [
      { label: '$(edit) Rename Crew', description: 'Change the crew name', action: 'rename' },
      { label: '$(go-to-file) Open Crew File', description: 'Edit JSON directly', action: 'open_file' },
      { label: '$(trash) Delete Crew', description: 'Permanently remove this crew', action: 'delete' },
    ];

    const action = await vscode.window.showQuickPick(actionItems, {
      placeHolder: `Editing: ${selected.label}`,
      title: `Agent-X: Edit "${selected.label}"`,
    });

    if (!action) return;

    switch ((action as ActionItem).action) {
      case 'rename': {
        const newName = await vscode.window.showInputBox({
          prompt: 'Enter new crew name',
          value: selected.label,
          ignoreFocusOut: true,
          validateInput: (value) => {
            if (!value || value.trim().length === 0) return 'Name is required';
            if (value.trim().length > 60) return 'Name must be 60 characters or less';
            return undefined;
          },
        });
        if (!newName) return;

        deps.configBridge.setActiveCrew(newName.trim());
        deps.configBridge.refreshCrews();
        deps.statusBarManager.updateCrewIndicator(newName.trim());
        vscode.window.showInformationMessage(`Agent-X: Crew renamed to "${newName.trim()}".`);
        break;
      }
      case 'open_file': {
        const crewFilePath = deps.configBridge.getCrewFilePath(crewId);
        if (!crewFilePath) {
          vscode.window.showErrorMessage('Agent-X: Crew file not found.');
          return;
        }
        const uri = vscode.Uri.file(crewFilePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
        break;
      }
      case 'delete': {
        const confirm = await vscode.window.showWarningMessage(
          `Delete crew "${selected.label}"? This cannot be undone.`,
          { modal: true },
          'Delete',
        );
        if (confirm !== 'Delete') return;

        const crewFilePath = deps.configBridge.getCrewFilePath(crewId);
        if (crewFilePath) {
          try {
            const fs = await import('fs');
            fs.unlinkSync(crewFilePath);
            deps.configBridge.refreshCrews();
            vscode.window.showInformationMessage(`Agent-X: Crew "${selected.label}" deleted.`);
          } catch {
            vscode.window.showErrorMessage('Agent-X: Failed to delete crew file.');
          }
        }
        break;
      }
    }
  };
}
