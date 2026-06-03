import * as vscode from 'vscode';
import type { EngineLifecycle } from './EngineLifecycle';
import type { EventBridge } from './EventBridge';
import type { ChatViewProvider } from '../webview/ChatViewProvider';
import type { SessionTreeProvider } from '../views/SessionTreeProvider';
import type { SessionPersistence } from './SessionPersistence';
import type { ChatMessage } from './types';

export class SessionLifecycle implements vscode.Disposable {
  private currentSessionId: string | null = null;
  private currentMessages: ChatMessage[] = [];
  private disposables: vscode.Disposable[] = [];
  private titleDetectionDone = new Set<string>();

  constructor(
    private readonly engineLifecycle: EngineLifecycle,
    private readonly eventBridge: EventBridge,
    private readonly chatView: ChatViewProvider,
    private readonly treeProvider: SessionTreeProvider,
    private readonly persistence: SessionPersistence,
  ) {
    this.wireEvents();
  }

  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  getCurrentMessages(): ChatMessage[] {
    return [...this.currentMessages];
  }

  async createNewSession(): Promise<string> {
    await this.engineLifecycle.disposeCurrentAgent();
    await this.engineLifecycle.createAgent();

    const engine = this.engineLifecycle.getEngine();
    const state = engine?.getState();

    if (this.currentSessionId) {
      await this.finalizeCurrentSession();
    }

    const sessionId = this.engineLifecycle.getCurrentSessionId() || '';

    this.currentSessionId = sessionId;
    this.currentMessages = [];
    this.titleDetectionDone.clear();

    this.chatView.postToWebview('clearMessages', {});
    this.chatView.postToWebview('sessionCreated', {
      sessionId,
      providerId: state?.providerId || 'openai',
      modelId: state?.modelId || 'gpt-4',
    });

    this.treeProvider.refresh();
    this.persistence.initializeSession(sessionId);

    return sessionId;
  }

  async restoreSession(sessionId: string): Promise<void> {
    if (this.currentSessionId) {
      await this.finalizeCurrentSession();
    }

    try {
      await this.engineLifecycle.disposeCurrentAgent();
      await this.engineLifecycle.restoreSession(sessionId);
    } catch {
      vscode.window.showErrorMessage(`Failed to restore session ${sessionId}.`);
      return;
    }

    this.currentSessionId = sessionId;
    this.currentMessages = [];
    this.titleDetectionDone.clear();

    const messages = this.persistence.loadMessages(sessionId);
    this.currentMessages = messages;

    this.chatView.postToWebview('clearMessages', {});
    this.chatView.postToWebview('sessionRestored', {
      sessionId,
      title: '',
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: new Date(m.createdAt).getTime(),
        tokenCost: m.tokenCost,
      })),
    });

    this.treeProvider.refresh();
    this.persistence.initializeSession(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const sessions = await this.engineLifecycle.listSessions();
    const session = sessions.find((s) => s.id === sessionId);
    const title = session?.title || 'this session';

    const confirm = await vscode.window.showWarningMessage(
      `Delete "${title}"? This cannot be undone.`,
      { modal: true },
      'Delete',
    );

    if (confirm !== 'Delete') {
      return;
    }

    if (this.currentSessionId === sessionId) {
      await this.finalizeCurrentSession();
      this.currentSessionId = null;
      this.currentMessages = [];
      this.chatView.postToWebview('clearMessages', {});
    }

    await this.engineLifecycle.deleteSession(sessionId);
    this.persistence.deleteSessionDirectory(sessionId);
    this.treeProvider.refresh();

    vscode.window.showInformationMessage(`Session "${title}" deleted.`);
  }

  async duplicateSession(sessionId: string): Promise<void> {
    const sessions = await this.engineLifecycle.listSessions();
    const original = sessions.find((s) => s.id === sessionId);
    if (!original) {
      vscode.window.showErrorMessage(`Session ${sessionId} not found.`);
      return;
    }

    const engine = this.engineLifecycle.getEngine();
    const state = engine?.getState();

    if (this.currentSessionId) {
      await this.finalizeCurrentSession();
    }

    await this.engineLifecycle.disposeCurrentAgent();
    await this.engineLifecycle.createAgent();

    const newSessionId = this.engineLifecycle.getCurrentSessionId() || '';

    this.persistence.initializeSession(newSessionId);

    const messages = this.persistence.loadMessages(sessionId);
    for (const msg of messages) {
      this.persistence.saveMessage(newSessionId, msg);
    }

    this.treeProvider.refresh();
    vscode.window.showInformationMessage(`Session duplicated.`);
    void state;
  }

  onMessageSent(message: ChatMessage): void {
    this.currentMessages.push(message);

    if (this.currentSessionId && !this.titleDetectionDone.has(this.currentSessionId)) {
      this.detectAndSetTitle(message);
    }

    if (this.currentSessionId) {
      this.persistence.persistMessage(this.currentSessionId, message);
    }
  }

  onMessageReceived(message: ChatMessage): void {
    this.currentMessages.push(message);

    if (this.currentSessionId) {
      this.persistence.persistMessage(this.currentSessionId, message);
    }
  }

  private detectAndSetTitle(_message: ChatMessage): void {
    if (!this.currentSessionId) return;
    this.titleDetectionDone.add(this.currentSessionId);
  }

  private async finalizeCurrentSession(): Promise<void> {
    if (!this.currentSessionId) return;

    this.persistence.flushSession(this.currentSessionId);
  }

  private wireEvents(): void {
    this.disposables.push(
      this.eventBridge.onMessage((msg) => {
        if (msg.role === 'user') {
          this.onMessageSent(msg);
        } else if (msg.role === 'assistant') {
          this.onMessageReceived(msg);
        }
      }),
    );
  }

  async dispose(): Promise<void> {
    await this.finalizeCurrentSession();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
