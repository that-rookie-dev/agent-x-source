import * as vscode from 'vscode';
import * as path from 'path';
import { VERSION } from '@agentx/shared';
import { VSCodeEngine } from './VSCodeEngine';
import { VSCodeStorageAdapter } from './VSCodeStorageAdapter';
import type { LifecycleEvent, LifecycleCallback, Disposable, SessionInfo } from './types';

const CRASH_RECOVERY_TIMEOUT_MS = 60_000;
const CRASH_CHECK_INTERVAL_MS = 10_000;
const CONFIG_WATCH_DEBOUNCE_MS = 2_000;

export class EngineLifecycle implements vscode.Disposable {
  private engine: VSCodeEngine | null = null;
  private context: vscode.ExtensionContext;
  private lifecycleHandlers = new Set<LifecycleCallback>();
  private crashCheckTimer: ReturnType<typeof setInterval> | null = null;
  private configWatcher: vscode.FileSystemWatcher | null = null;
  private configDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private workspaceWatcher: vscode.Disposable | null = null;
  private disposed = false;
  private crashRecoveryTimeout: number;

  constructor(context: vscode.ExtensionContext, crashRecoveryTimeout?: number) {
    this.context = context;
    this.crashRecoveryTimeout = crashRecoveryTimeout ?? CRASH_RECOVERY_TIMEOUT_MS;
  }

  getEngine(): VSCodeEngine | null {
    return this.engine;
  }

  async ensureReady(): Promise<VSCodeEngine> {
    if (this.disposed) {
      throw new Error('EngineLifecycle has been disposed');
    }

    if (this.engine && this.engine.isInitialized()) {
      return this.engine;
    }

    const workspaceRoot = this.resolveWorkspaceRoot();
    if (!workspaceRoot) {
      throw new Error('No workspace folder open. Open a folder to use Agent-X.');
    }

    if (!this.engine) {
      this.engine = new VSCodeEngine(workspaceRoot, this.context);
    }

    await this.engine.initialize();
    const engine = this.engine;

    this.startCrashRecovery();
    this.startConfigWatcher();
    this.startWorkspaceWatcher();

    this.emit({ type: 'ready', sessionId: engine.getSessionId()! });

    return engine;
  }

  onLifecycle(handler: LifecycleCallback): Disposable {
    this.lifecycleHandlers.add(handler);
    return {
      dispose: () => {
        this.lifecycleHandlers.delete(handler);
      },
    };
  }

  private resolveWorkspaceRoot(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return null;
    }
    return folders[0]!.uri.fsPath;
  }

  private startWorkspaceWatcher(): void {
    if (this.workspaceWatcher) {
      this.workspaceWatcher.dispose();
    }

    this.workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(
      async () => {
        if (this.disposed) return;

        const newRoot = this.resolveWorkspaceRoot();
        if (!newRoot) {
          return;
        }

        const currentRoot = this.engine?.getWorkspaceRoot();
        if (currentRoot === newRoot) {
          return;
        }

        this.emit({ type: 'workspace_changed', newRoot });
        this.emit({ type: 'restarting' });

        try {
          if (this.engine) {
            await this.engine.restart(newRoot);
            this.emit({ type: 'ready', sessionId: this.engine.getSessionId()! });
          }
        } catch (err) {
          this.emit({
            type: 'error',
            error: `Workspace change restart failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      },
    );

    this.context.subscriptions.push(this.workspaceWatcher);
  }

  private startCrashRecovery(): void {
    if (this.crashCheckTimer) {
      clearInterval(this.crashCheckTimer);
    }

    this.crashCheckTimer = setInterval(() => {
      if (this.disposed || !this.engine) return;

      const agent = this.engine.getAgent();
      if (!agent) return;

      if (agent.processing) {
        const state = this.engine.getState();
        if (state.status === 'processing') {
          this.emit({
            type: 'crash_detected',
            stuckFor: this.crashRecoveryTimeout,
          });

          this.engine.resetProcessingState();

          this.emit({ type: 'crash_recovered' });
        }
      }
    }, CRASH_CHECK_INTERVAL_MS);

    this.context.subscriptions.push({
      dispose: () => {
        if (this.crashCheckTimer) {
          clearInterval(this.crashCheckTimer);
          this.crashCheckTimer = null;
        }
      },
    });
  }

  private startConfigWatcher(): void {
    if (this.configWatcher) {
      this.configWatcher.dispose();
    }

    const homeDir = process.env['HOME'] || process.env['USERPROFILE'] || '';
    if (!homeDir) return;

    const configPattern = new vscode.RelativePattern(
      vscode.Uri.file(`${homeDir}/.config/agentx`),
      'config.json',
    );

    this.configWatcher = vscode.workspace.createFileSystemWatcher(configPattern);

    const handleChange = () => {
      if (this.configDebounceTimer) {
        clearTimeout(this.configDebounceTimer);
      }

      this.configDebounceTimer = setTimeout(async () => {
        if (this.disposed || !this.engine) return;

        try {
          const configManager = this.engine.getConfigManager();
          configManager.reload();
        } catch {
          // Config reload failed — non-critical
        }
      }, CONFIG_WATCH_DEBOUNCE_MS);
    };

    this.configWatcher.onDidChange(handleChange);
    this.configWatcher.onDidCreate(handleChange);

    this.context.subscriptions.push(this.configWatcher);
    this.context.subscriptions.push({
      dispose: () => {
        if (this.configDebounceTimer) {
          clearTimeout(this.configDebounceTimer);
          this.configDebounceTimer = null;
        }
      },
    });
  }

  private emit(event: LifecycleEvent): void {
    for (const handler of this.lifecycleHandlers) {
      try {
        handler(event);
      } catch {
        // Swallow handler errors
      }
    }
  }

  hasActiveSession(): boolean {
    return this.engine?.getSessionId() !== null && this.engine?.isInitialized() === true;
  }

  hasActiveAgent(): boolean {
    return this.engine?.getAgent() !== null;
  }

  async disposeCurrentAgent(): Promise<void> {
    const agent = this.engine?.getAgent();
    if (agent) {
      try { agent.cancel(); } catch {}
      try { agent.endSession(); } catch {}
    }
  }

  async createAgent(): Promise<void> {
    const engine = await this.ensureReady();
    if (engine) {
      await engine.resetAgent();
    }
  }

  getCurrentSessionId(): string | undefined {
    return this.engine?.getSessionId() ?? undefined;
  }

  async listSessions(): Promise<SessionInfo[]> {
    const sessions = await this.readSessionsFromStorage();
    return sessions.map((s: any) => ({
      id: s.id,
      title: s.title || 'Untitled Session',
      status: s.status || 'active',
      providerId: s.providerId || '',
      modelId: s.modelId || '',
      scopePath: s.scopePath || '',
      tokenUsed: s.tokenUsed ?? 0,
      tokenAvailable: s.tokenAvailable ?? 0,
      crewId: s.crewId ?? null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt || s.createdAt,
      messageCount: 0,
    }));
  }

  async restoreSession(id: string): Promise<void> {
    const engine = await this.ensureReady();
    const agent = engine.getAgent();
    if (agent) {
      try { agent.cancel(); } catch {}
      try { agent.endSession(); } catch {}
    }
    await engine.resetAgent(id);
  }

  async deleteSession(id: string): Promise<void> {
    const storageDir = this.context.globalStorageUri?.fsPath;
    if (!storageDir) return;
    const adapter = new VSCodeStorageAdapter(storageDir);
    adapter.connect();
    adapter.deleteSession(id);
    adapter.disconnect();
  }

  async getSessionData(id: string | undefined): Promise<any> {
    if (!id) return { messages: [] };
    const storageDir = this.context.globalStorageUri?.fsPath;
    if (!storageDir) return { messages: [] };
    const adapter = new VSCodeStorageAdapter(storageDir);
    adapter.connect();
    const session = adapter.getSession(id);
    const messages = adapter.getMessages(id);
    adapter.disconnect();
    return {
      ...session,
      messages: messages.map((m: any) => ({
        role: m.role,
        content: m.content,
        timestamp: m.createdAt,
      })),
      title: session?.title || 'Untitled Session',
      model: session?.modelId || 'unknown',
    };
  }

  async clearCurrentSessionMessages(): Promise<void> {
    const agent = this.engine?.getAgent();
    if (agent) {
      agent.clearHistory();
    }
  }

  async compactCurrentSession(): Promise<void> {
    const agent = this.engine?.getAgent();
    if (agent) {
      try { agent.cancel(); } catch {}
    }
  }

  async searchSessions(query: string, _token: any): Promise<any[]> {
    const sessions = await this.readSessionsFromStorage();
    return sessions
      .filter((s: any) => {
        const searchStr = `${s.title || ''} ${s.id || ''} ${s.providerId || ''}`.toLowerCase();
        return searchStr.includes(query.toLowerCase());
      })
      .map((s: any) => ({
        sessionId: s.id,
        sessionTitle: s.title || 'Untitled Session',
        role: 'assistant',
        matchSnippet: `Session: ${s.title || 'Untitled'} - ${s.providerId || ''} ${s.modelId || ''}`,
      }));
  }

  isProcessing(): boolean {
    return this.engine?.getAgent()?.processing ?? false;
  }

  async cancelCurrentTask(): Promise<void> {
    const agent = this.engine?.getAgent();
    if (agent) {
      agent.cancel();
    }
  }

  async sendSteerMessage(msg: string): Promise<void> {
    const engine = await this.ensureReady();
    const agent = engine.getAgent();
    if (agent) {
      agent.sendMessage(msg);
    }
  }

  async setPlanMode(active: boolean): Promise<void> {
    const agent = this.engine?.getAgent();
    if (agent) {
      agent.setPlanMode(active);
    }
  }

  async getPermissionAuditLog(): Promise<any[]> {
    const storageDir = this.context.globalStorageUri?.fsPath;
    if (!storageDir) return [];
    const adapter = new VSCodeStorageAdapter(storageDir);
    adapter.connect();
    const sessionId = this.engine?.getSessionId();
    const permissions = sessionId ? adapter.getPermissions(sessionId) : [];
    adapter.disconnect();
    return permissions.map((p: any) => ({
      id: p.id,
      tool: p.toolName || p.tool,
      path: p.targetPath || '',
      riskLevel: p.riskLevel || 'medium',
      decision: p.decision,
      timestamp: new Date(p.createdAt).getTime(),
    }));
  }

  getTokenUsage(): { used: number; total: number; percentage: number } {
    const agent = this.engine?.getAgent();
    if (agent?.tokens) {
      const used = agent.tokens.tokensUsed;
      const total = agent.tokens.tokensTotal;
      return { used, total, percentage: total > 0 ? used / total : 0 };
    }
    return { used: 0, total: 128000, percentage: 0 };
  }

  getSessionCost(): number {
    const agent = this.engine?.getAgent();
    if (agent?.tokens) {
      return agent.tokens.totalCost;
    }
    return 0;
  }

  getEngineVersion(): string {
    return VERSION;
  }

  async getSessionCount(): Promise<number> {
    const sessions = await this.readSessionsFromStorage();
    return sessions.length;
  }

  requiresRestartForConfigChange(): boolean {
    return true;
  }

  setWorkspaceRoot(root: string): void {
    // Will be picked up on next engine restart
    if (this.engine) {
      Object.defineProperty(this.engine, 'workspaceRoot', {
        value: root,
        writable: true,
      });
    }
  }

  async switchProvider(id: string): Promise<void> {
    const agent = this.engine?.getAgent();
    if (agent) {
      (agent as any).switchProvider(id);
    }
  }

  async switchModel(id: string): Promise<void> {
    const agent = this.engine?.getAgent();
    if (agent) {
      (agent as any).switchModel(id);
    }
  }

  async switchCrew(id: string): Promise<void> {
    // Crew switching logic will be implemented in a later phase
    void id;
  }

  async reloadProvider(id: string): Promise<void> {
    const agent = this.engine?.getAgent();
    if (agent) {
      (agent as any).switchProvider(id);
    }
  }

  async updatePermissionConfig(_config: string[]): Promise<void> {
    // Will be implemented in a later phase
  }

  async updateBudgetLimit(_limit: number): Promise<void> {
    // Will be implemented in a later phase
  }

  async getAvailableModels(_provider: string): Promise<any[]> {
    const agent = this.engine?.getAgent();
    if (agent && typeof (agent as any).listModels === 'function') {
      try {
        return await (agent as any).listModels();
      } catch {
        return [];
      }
    }
    return [];
  }

  async createCrew(config: any): Promise<void> {
    const homeDir = process.env['HOME'] || process.env['USERPROFILE'] || '';
    if (!homeDir) return;
    const crewsDir = path.join(homeDir, '.config', 'agentx', 'crews');
    const { mkdirSync, writeFileSync } = await import('fs');
    mkdirSync(crewsDir, { recursive: true });
    const filePath = path.join(crewsDir, `${config.name.toLowerCase().replace(/\s+/g, '-')}.json`);
    writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
  }

  private async readSessionsFromStorage(): Promise<any[]> {
    const storageDir = this.context.globalStorageUri?.fsPath;
    if (!storageDir) return [];
    const adapter = new VSCodeStorageAdapter(storageDir);
    try {
      adapter.connect();
      return adapter.listSessions(100);
    } finally {
      adapter.disconnect();
    }
  }

  async sendMessage(content: string): Promise<void> {
    const agent = this.engine?.getAgent();
    if (agent) {
      agent.sendMessage(content);
    }
  }

  async respondToPermission(_requestId: string, decision: string): Promise<void> {
    const agent = this.engine?.getAgent();
    if (agent) {
      const mapped = decision.replace(/-/g, '_') as 'allow_once' | 'allow_always' | 'deny';
      agent.respondToPermission(mapped);
    }
  }

  async approvePlan(_planId: string): Promise<void> {
    const agent = this.engine?.getAgent();
    if (agent) {
      agent.respondToPlan(true);
    }
  }

  async rejectPlan(_planId: string): Promise<void> {
    const agent = this.engine?.getAgent();
    if (agent) {
      agent.respondToPlan(false);
    }
  }

  async approvePlanStep(_planId: string, stepId: string): Promise<void> {
    const agent = this.engine?.getAgent();
    if (agent) {
      agent.respondToStep(stepId, true);
    }
  }

  async skipPlanStep(_planId: string, stepId: string): Promise<void> {
    const agent = this.engine?.getAgent();
    if (agent) {
      agent.respondToStep(stepId, false);
    }
  }

  async modifyPlanStep(_planId: string, stepId: string, modification: string): Promise<void> {
    const agent = this.engine?.getAgent();
    if (agent) {
      agent.respondToStep(stepId, false, modification);
    }
  }

  async respondToClarification(_questionId: string, response: string): Promise<void> {
    const agent = this.engine?.getAgent();
    if (agent) {
      agent.sendMessage(response);
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    if (this.crashCheckTimer) {
      clearInterval(this.crashCheckTimer);
      this.crashCheckTimer = null;
    }

    if (this.configDebounceTimer) {
      clearTimeout(this.configDebounceTimer);
      this.configDebounceTimer = null;
    }

    if (this.configWatcher) {
      this.configWatcher.dispose();
      this.configWatcher = null;
    }

    if (this.workspaceWatcher) {
      this.workspaceWatcher.dispose();
      this.workspaceWatcher = null;
    }

    if (this.engine) {
      await this.engine.dispose();
      this.engine = null;
    }

    this.lifecycleHandlers.clear();

    this.emit({ type: 'disposed' });
  }
}
