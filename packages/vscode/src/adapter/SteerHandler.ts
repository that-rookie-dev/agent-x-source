import * as vscode from 'vscode';
import type { Agent } from '@agentx/engine';

export class SteerHandler {
  private engine: Agent | null = null;
  private engineSteerHandler: { handleSteer: (taskId: string, text: string) => boolean; canSteer: () => boolean } | null = null;
  private isProcessing = false;
  private pendingSteerNotification: vscode.Disposable | null = null;

  attach(engine: Agent): void {
    this.engine = engine;
    const internal = engine as unknown as { steerHandler?: { handleSteer: (taskId: string, text: string) => boolean; canSteer: () => boolean } };
    this.engineSteerHandler = internal.steerHandler ?? null;
  }

  setIsProcessing(value: boolean): void {
    this.isProcessing = value;
  }

  canSteer(): boolean {
    if (!this.isProcessing || !this.engine) return false;
    if (this.engineSteerHandler) {
      return this.engineSteerHandler.canSteer();
    }
    return true;
  }

  async handleUserInput(text: string, webviewPostMessage: (msg: { type: string; [key: string]: unknown }) => void): Promise<boolean> {
    if (!this.canSteer()) return false;

    if (this.isProcessing) {
      const choice = await vscode.window.showQuickPick(
        [
          { label: 'Send as steer message', description: 'Inject guidance into current execution', value: 'steer' },
          { label: 'Queue as next message', description: 'Wait until current task finishes', value: 'queue' },
          { label: 'Cancel', value: 'cancel' },
        ],
        { placeHolder: 'Agent is processing. How would you like to send this message?' },
      );

      if (!choice || choice.value === 'cancel') return true;
      if (choice.value === 'queue') return false;

      this.sendSteer(text, webviewPostMessage);
      return true;
    }

    return false;
  }

  autoSteer(text: string, webviewPostMessage: (msg: { type: string; [key: string]: unknown }) => void): void {
    if (this.canSteer()) {
      this.sendSteer(text, webviewPostMessage);
    }
  }

  private sendSteer(
    text: string,
    webviewPostMessage: (msg: { type: string; [key: string]: unknown }) => void,
  ): void {
    if (!this.engine || !this.engineSteerHandler) return;

    const taskId = (this.engine as unknown as { sessionId: string }).sessionId;
    const accepted = this.engineSteerHandler.handleSteer(taskId, text);

    if (accepted) {
      webviewPostMessage({
        type: 'steer-sent',
        instruction: text,
      });

      if (this.pendingSteerNotification) {
        this.pendingSteerNotification.dispose();
      }

      const preview = text.length > 60 ? text.slice(0, 57) + '...' : text;
      vscode.window.setStatusBarMessage(`$(megaphone) Steering: ${preview}`, 5000);
    } else {
      vscode.window.showWarningMessage('Steer rate-limited. Wait a few seconds before sending another steer message.');
    }
  }

  dispose(): void {
    this.pendingSteerNotification?.dispose();
  }
}
