import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { CommandDeps } from '../registerAllCommands';
import { getConfigDir } from '@agentx/engine';

export function openSecretSauceHandler(_deps: CommandDeps): () => Promise<void> {
  return async () => {
    const secretSauceDir = path.join(getConfigDir(), 'secret-sauce');

    if (!fs.existsSync(secretSauceDir)) {
      fs.mkdirSync(secretSauceDir, { recursive: true });
    }

    const uri = vscode.Uri.file(secretSauceDir);
    await vscode.commands.executeCommand('revealInExplorer', uri);
  };
}
