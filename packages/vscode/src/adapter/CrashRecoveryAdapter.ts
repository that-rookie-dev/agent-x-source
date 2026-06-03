import * as vscode from 'vscode';
import { CrashRecovery } from '@agentx/engine';
import type { SessionLifecycle } from './SessionLifecycle';

const AUTO_SAVE_INTERVAL_MS = 30_000;

interface CrashState {
  sessionId: string;
  timestamp: string;
  provider: string;
  model: string;
  messageCount: number;
  lastUserMessage?: string;
  error?: string;
}

export class CrashRecoveryAdapter implements vscode.Disposable {
  private crashRecovery: CrashRecovery;
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly sessionLifecycle: SessionLifecycle,
  ) {
    this.crashRecovery = new CrashRecovery();
  }

  async checkAndOfferRestore(): Promise<void> {
    if (!this.crashRecovery.hasRecoveryState()) {
      return;
    }

    const state = this.crashRecovery.getRecoveryState();
    if (!state) {
      return;
    }

    const sessionTitle = state.lastUserMessage
      ? state.lastUserMessage.substring(0, 50) + (state.lastUserMessage.length > 50 ? '...' : '')
      : state.sessionId;

    const action = await vscode.window.showInformationMessage(
      `Agent-X crashed during session "${sessionTitle}" (${state.messageCount} messages). Restore?`,
      'Restore Session',
      'Dismiss',
    );

    if (action === 'Restore Session') {
      try {
        await this.sessionLifecycle.restoreSession(state.sessionId);
        vscode.window.showInformationMessage('Session restored successfully.');
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to restore session: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.crashRecovery.clearRecovery();
  }

  startAutoSave(): void {
    this.stopAutoSave();

    this.autoSaveTimer = setInterval(() => {
      this.saveCurrentState();
    }, AUTO_SAVE_INTERVAL_MS);
  }

  stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  private saveCurrentState(): void {
    const sessionId = this.sessionLifecycle.getCurrentSessionId();
    if (!sessionId) return;

    const messages = this.sessionLifecycle.getCurrentMessages();
    if (messages.length === 0) return;

    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');

    const state: CrashState = {
      sessionId,
      timestamp: new Date().toISOString(),
      provider: '',
      model: '',
      messageCount: messages.length,
      lastUserMessage: lastUserMsg?.content,
    };

    this.crashRecovery.register(() => state);
  }

  registerCrashHandlers(getState: () => CrashState): void {
    this.crashRecovery.register(getState);
  }

  hasRecoveryState(): boolean {
    return this.crashRecovery.hasRecoveryState();
  }

  clearRecovery(): void {
    this.crashRecovery.clearRecovery();
  }

  dispose(): void {
    this.stopAutoSave();
  }
}
