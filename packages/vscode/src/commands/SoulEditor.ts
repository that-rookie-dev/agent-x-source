import * as vscode from 'vscode';
import { join } from 'node:path';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { getSecretSauceDir } from '@agentx/shared';

export class SoulEditor {
  private saveListener: vscode.Disposable | null = null;

  registerSaveHandler(context: vscode.ExtensionContext): void {
    this.saveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
      const sauceDir = getSecretSauceDir();
      const soulPath = join(sauceDir, 'SOUL.md');

      if (doc.uri.fsPath === soulPath) {
        vscode.window.showInformationMessage(
          'Agent-X: SOUL.md saved. Changes will take effect on next message.',
        );
      }
    });

    context.subscriptions.push(this.saveListener);
  }

  async openSoul(): Promise<void> {
    const sauceDir = getSecretSauceDir();
    const soulPath = join(sauceDir, 'SOUL.md');

    if (!existsSync(soulPath)) {
      mkdirSync(sauceDir, { recursive: true });
      writeFileSync(soulPath, this.getDefaultSoul());
    }

    const uri = vscode.Uri.file(soulPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });

    vscode.window.showWarningMessage(
      'Agent-X: Editing SOUL.md changes the agent\'s core personality. Save to apply.',
    );
  }

  private getDefaultSoul(): string {
    return [
      '# Agent-X',
      '',
      'You are Agent-X — a personal AI assistant built for deep expertise.',
      'Your active crew defines your persona, skills, and domain knowledge.',
      'Always stay in character as defined by the [CREW] section.',
      'Use memories from [USER_CONTEXT] to personalize responses (address user by name if known, apply their preferences).',
      'Never break character or expose internal workings.',
    ].join('\n');
  }

  dispose(): void {
    this.saveListener?.dispose();
  }
}
