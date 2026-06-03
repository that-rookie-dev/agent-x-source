import * as vscode from 'vscode';
import { VERSION } from '@agentx/shared';
import type { CommandDeps } from '../registerAllCommands';

export function showAboutHandler(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const version = VERSION;
    const provider = deps.configBridge.getActiveProvider();
    const model = deps.configBridge.getActiveModel();
    const crew = deps.configBridge.getActiveCrewName() || 'None';
    const engineVersion = deps.engineLifecycle.getEngineVersion();

    const lines = [
      'Agent-X VS Code Extension',
      '',
      `Extension Version: ${version}`,
      `Engine Version: ${engineVersion}`,
      '',
      `Provider: ${provider}`,
      `Model: ${model}`,
      `Crew: ${crew}`,
      '',
      `Config: ${deps.configBridge.hasValidConfig() ? 'Valid' : 'Missing'}`,
      `Sessions: ${await deps.engineLifecycle.getSessionCount()}`,
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
