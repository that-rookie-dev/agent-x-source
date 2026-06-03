import * as vscode from 'vscode';
import type { Agent } from '@agentx/engine';

interface ClarificationPayload {
  question: string;
  options: string[];
  allowFreeform: boolean;
}

export class ClarificationHandler {
  private engine: Agent | null = null;

  attach(engine: Agent): void {
    this.engine = engine;
  }

  async handle(event: ClarificationPayload): Promise<void> {
    if (!this.engine) return;

    let response: string | undefined;

    if (event.options.length > 0) {
      const items: vscode.QuickPickItem[] = event.options.map(opt => ({
        label: opt,
      }));

      if (event.allowFreeform) {
        items.unshift({
          label: '$(edit) Type your own response...',
          description: 'Free-form answer',
        });
      }

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: event.question,
        title: 'Agent-X needs clarification',
        ignoreFocusOut: true,
      });

      if (!picked) {
        this.engine.respondToClarification('skipped');
        return;
      }

      if (picked.label.includes('Type your own')) {
        response = await this.showFreeformInput(event.question);
      } else {
        response = picked.label;
      }
    } else if (event.allowFreeform) {
      response = await this.showFreeformInput(event.question);
    } else {
      vscode.window.showWarningMessage(event.question);
      response = 'acknowledged';
    }

    if (response !== undefined) {
      this.engine.respondToClarification(response);
    }
  }

  private async showFreeformInput(question: string): Promise<string | undefined> {
    return vscode.window.showInputBox({
      prompt: question,
      placeHolder: 'Type your response...',
      ignoreFocusOut: true,
      validateInput: (v) => v.trim().length > 0 ? null : 'Please provide a response',
    });
  }

  dispose(): void {}
}
