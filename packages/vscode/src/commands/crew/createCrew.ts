import * as vscode from 'vscode';
import type { CommandDeps } from '../registerAllCommands';

export function createCrewHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const name = await vscode.window.showInputBox({
      prompt: 'Enter crew name',
      placeHolder: 'e.g., Full Stack Team',
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value || value.trim().length === 0) return 'Name is required';
        if (value.trim().length > 50) return 'Name must be 50 characters or less';
        return undefined;
      },
    });

    if (!name) return;

    const description = await vscode.window.showInputBox({
      prompt: 'Enter crew description (optional)',
      placeHolder: 'e.g., A team for full-stack web development',
      ignoreFocusOut: true,
    });

    const memberCountStr = await vscode.window.showInputBox({
      prompt: 'How many members in this crew?',
      placeHolder: '1-5',
      ignoreFocusOut: true,
      validateInput: (value) => {
        const n = parseInt(value, 10);
        if (isNaN(n) || n < 1 || n > 5) return 'Enter a number between 1 and 5';
        return undefined;
      },
    });

    if (!memberCountStr) return;
    const memberCount = parseInt(memberCountStr, 10);

    const members: Array<{ name: string; role: string; personality: string }> = [];

    for (let i = 0; i < memberCount; i++) {
      const memberName = await vscode.window.showInputBox({
        prompt: `Member ${i + 1} name`,
        placeHolder: 'e.g., Architect',
        ignoreFocusOut: true,
        validateInput: (v) => (!v || v.trim().length === 0 ? 'Required' : undefined),
      });
      if (!memberName) return;

      const role = await vscode.window.showInputBox({
        prompt: `${memberName}'s role`,
        placeHolder: 'e.g., System architecture and design',
        ignoreFocusOut: true,
      });
      if (!role) return;

      const personality = await vscode.window.showQuickPick(
        [
          { label: 'Analytical', description: 'Methodical and detail-oriented' },
          { label: 'Creative', description: 'Innovative and out-of-the-box' },
          { label: 'Pragmatic', description: 'Practical and results-focused' },
          { label: 'Thorough', description: 'Comprehensive and careful' },
          { label: 'Bold', description: 'Confident and decisive' },
        ],
        { placeHolder: `${memberName}'s personality` },
      );

      members.push({
        name: memberName.trim(),
        role: role.trim(),
        personality: personality?.label || 'Pragmatic',
      });
    }

    try {
      await deps.engineLifecycle.createCrew({
        name: name.trim(),
        description: description?.trim() || '',
        members,
      });

      deps.configBridge.refreshCrews();
      deps.statusBarManager.updateCrewIndicator(name.trim());

      vscode.window.showInformationMessage(`Agent-X: Crew "${name}" created with ${memberCount} member(s).`);
    } catch (error) {
      vscode.window.showErrorMessage(`Agent-X: Failed to create crew — ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}
