import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { CommandDeps } from '../registerAllCommands';
import { getConfigDir } from '@agentx/engine';

export function openConfigHandler(_deps: CommandDeps): () => Promise<void> {
  return async () => {
    const configDir = getConfigDir();
    const configPath = path.join(configDir, 'config.json');

    if (!fs.existsSync(configPath)) {
      const create = await vscode.window.showWarningMessage(
        `Agent-X config file not found at ${configPath}. Create it?`,
        'Create',
        'Cancel',
      );
      if (create !== 'Create') return;

      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify({}, null, 2), 'utf-8');
    }

    const uri = vscode.Uri.file(configPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
  };
}
