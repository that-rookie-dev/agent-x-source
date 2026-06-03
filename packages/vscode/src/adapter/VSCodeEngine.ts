import type * as vscode from 'vscode';
import { Agent, ConfigManager } from '@agentx/engine';
import type { AgentOptions } from '@agentx/engine';
import type { AgentXConfig } from '@agentx/shared';
import { generateSessionId } from '@agentx/shared';
import { createVSCodeToolkit } from './VSCodeToolkitFactory';
import type { VSCodeToolkit } from './VSCodeToolkitFactory';
import type { EngineState, EngineStatus } from './types';

export class VSCodeEngine {
  private agent: Agent | null = null;
  private toolkit: VSCodeToolkit | null = null;
  private configManager: ConfigManager;
  private config: AgentXConfig | null = null;
  private sessionId: string | null = null;
  private workspaceRoot: string;
  private status: EngineStatus = 'uninitialized';
  private error: string | null = null;
  private initPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(workspaceRoot: string, _context: vscode.ExtensionContext) {
    this.workspaceRoot = workspaceRoot;
    this.configManager = new ConfigManager();
  }

  async initialize(): Promise<void> {
    if (this.disposed) {
      throw new Error('VSCodeEngine has been disposed');
    }

    if (this.status === 'ready' && this.agent) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._doInitialize();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async _doInitialize(): Promise<void> {
    this.status = 'initializing';
    this.error = null;

    try {
      this.config = this.configManager.load();
    } catch (err) {
      this.status = 'error';
      this.error = `Failed to load config: ${err instanceof Error ? err.message : String(err)}`;
      throw new Error(this.error);
    }

    this.sessionId = generateSessionId();

    this.toolkit = createVSCodeToolkit(this.workspaceRoot);

    const agentOptions: AgentOptions = {
      config: this.config,
      sessionId: this.sessionId,
      toolExecutor: this.toolkit.executor,
      toolRegistry: this.toolkit.registry,
      gitAutoCommit: false,
      gitAware: true,
    };

    try {
      this.agent = new Agent(agentOptions);
    } catch (err) {
      this.status = 'error';
      this.error = `Failed to create Agent: ${err instanceof Error ? err.message : String(err)}`;
      throw new Error(this.error);
    }

    this.status = 'ready';
  }

  getAgent(): Agent | null {
    return this.agent;
  }

  isInitialized(): boolean {
    return this.status === 'ready' && this.agent !== null;
  }

  getState(): EngineState {
    return {
      status: this.status,
      workspaceRoot: this.workspaceRoot,
      sessionId: this.sessionId,
      providerId: this.config?.provider.activeProvider ?? null,
      modelId: this.config?.provider.activeModel ?? null,
      toolCount: 0,
      watcherCount: 0,
      schedulerCount: 0,
      planModeEnabled: false,
      processing: false,
      error: this.error,
    };
  }

  getStatus(): EngineStatus {
    return this.status;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  getConfig(): AgentXConfig | null {
    return this.config;
  }

  getConfigManager(): ConfigManager {
    return this.configManager;
  }

  async resetAgent(sessionId?: string): Promise<void> {
    if (this.disposed) {
      throw new Error('VSCodeEngine has been disposed');
    }

    if (!this.config || !this.toolkit) {
      throw new Error('Engine must be initialized before resetting agent');
    }

    if (this.agent) {
      try { this.agent.cancel(); } catch {}
      try { this.agent.endSession(); } catch {}
    }

    this.sessionId = sessionId ?? generateSessionId();

    const agentOptions: AgentOptions = {
      config: this.config,
      sessionId: this.sessionId,
      toolExecutor: this.toolkit.executor,
      toolRegistry: this.toolkit.registry,
      gitAutoCommit: false,
      gitAware: true,
    };

    this.agent = new Agent(agentOptions);
    this.status = 'ready';
  }

  async restart(newWorkspaceRoot?: string): Promise<void> {
    if (this.disposed) {
      throw new Error('VSCodeEngine has been disposed');
    }

    const root = newWorkspaceRoot ?? this.workspaceRoot;

    await this.teardown();

    this.workspaceRoot = root;
    this.agent = null;
    this.toolkit = null;
    this.config = null;
    this.sessionId = null;
    this.status = 'uninitialized';
    this.error = null;

    await this.initialize();
  }

  private async teardown(): Promise<void> {
    if (this.agent) {
      try {
        this.agent.cancel();
      } catch {
        // Ignore cancel errors during teardown
      }

      try {
        this.agent.endSession();
      } catch {
        // Ignore endSession errors during teardown
      }
    }

    this.agent = null;
    this.toolkit = null;
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    if (this.initPromise) {
      try {
        await this.initPromise;
      } catch {
        // Ignore initialization errors during dispose
      }
    }

    await this.teardown();

    this.status = 'disposed';
    this.config = null;
    this.sessionId = null;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  resetProcessingState(): void {
    if (this.agent && this.agent.processing) {
      this.agent.cancel();
    }
  }
}
