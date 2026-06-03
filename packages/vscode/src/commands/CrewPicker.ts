import * as vscode from 'vscode';
import type { CrewEmotion } from '@agentx/shared';
import type { CommandDeps } from './registerAllCommands';

export const EMOTION_ICONS: Record<CrewEmotion, string> = {
  professional: '$(briefcase)',
  friendly: '$(smiley)',
  witty: '$(lightbulb)',
  kind: '$(heart)',
  funny: '$(beaker)',
  arrogant: '$(star-full)',
  flirty: '$(symbol-event)',
  happy: '$(squirrel)',
  sad: '$(cloud)',
  sarcastic: '$(comment-discussion)',
};

export const EMOTION_DESCRIPTIONS: Record<CrewEmotion, string> = {
  professional: 'Formal and business-oriented',
  friendly: 'Warm and approachable',
  witty: 'Clever and humorous',
  kind: 'Gentle and supportive',
  funny: 'Playful and entertaining',
  arrogant: 'Confident and assertive',
  flirty: 'Charming and playful',
  happy: 'Cheerful and optimistic',
  sad: 'Melancholic and thoughtful',
  sarcastic: 'Dry and ironic',
};

interface CrewQuickPickItem extends vscode.QuickPickItem {
  crewId: string;
}

export function showCrewPicker(deps: CommandDeps): () => Promise<void> {
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

    const items: CrewQuickPickItem[] = crews.map((c) => {
      const isActive = c.name === activeCrew;
      return {
        label: isActive ? `$(check) ${c.name}` : c.name,
        description: `${c.members?.length || 0} members`,
        detail: c.description || c.id,
        crewId: c.id,
      };
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select active crew',
      title: 'Agent-X: Switch Crew',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!selected) return;

    const crewId = (selected as CrewQuickPickItem).crewId;

    try {
      deps.configBridge.setActiveCrew(crewId);
      await deps.engineLifecycle.switchCrew(crewId);
      deps.statusBarManager.updateCrewIndicator(crewId);

      vscode.window.showInformationMessage(`Agent-X: Switched to crew "${selected.label.replace(/^\$\(check\)\s*/, '')}".`);
    } catch (error) {
      vscode.window.showErrorMessage(`Agent-X: Failed to switch crew — ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}
