import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigManager } from '@agentx/engine';
import type { AgentXConfig, ProviderId } from '@agentx/shared';
import type { ConfigState, Disposable } from './types';

const VSCODE_SECTION = 'agentx';

type ConfigChangeHandler = (_config: AgentXConfig) => void;
type ProviderChangeHandler = (_providerId: ProviderId, _modelId: string) => void;
type FirstRunHandler = () => void;

export class ConfigBridge {
  private configManager: ConfigManager;
  private config: AgentXConfig | null = null;
  private configChangeHandlers = new Set<ConfigChangeHandler>();
  private providerChangeHandlers = new Set<ProviderChangeHandler>();
  private firstRunHandlers = new Set<FirstRunHandler>();
  private settingsWatcher: vscode.Disposable | null = null;
  private lastProviderId: ProviderId | null = null;
  private lastModelId: string | null = null;
  private context: vscode.ExtensionContext;
  private firstRunDetected = false;
  private syncing = false;

  constructor(context: vscode.ExtensionContext, configManager?: ConfigManager) {
    this.context = context;
    this.configManager = configManager ?? new ConfigManager();
  }

  initialize(): ConfigState {
    const isConfigured = this.configManager.isConfigured();
    const isSetupComplete = isConfigured ? this.configManager.isSetupComplete() : false;

    if (!isConfigured || !isSetupComplete) {
      this.firstRunDetected = true;
      this.emitFirstRun();
      return {
        isConfigured: false,
        isSetupComplete: false,
        config: null,
        firstRun: true,
      };
    }

    try {
      this.config = this.configManager.load();
      this.lastProviderId = this.config.provider.activeProvider;
      this.lastModelId = this.config.provider.activeModel;
    } catch {
      return {
        isConfigured: true,
        isSetupComplete: false,
        config: null,
        firstRun: false,
      };
    }

    this.syncFromVSCodeSettings();
    this.startSettingsWatcher();

    return {
      isConfigured: true,
      isSetupComplete: true,
      config: this.config,
      firstRun: false,
    };
  }

  getConfig(): AgentXConfig | null {
    return this.config;
  }

  isConfigured(): boolean {
    return this.configManager.isConfigured();
  }

  isSetupComplete(): boolean {
    return this.configManager.isSetupComplete();
  }

  isFirstRun(): boolean {
    return this.firstRunDetected;
  }

  reload(): AgentXConfig | null {
    if (this.syncing) return this.config;
    this.syncing = true;
    try {
      this.config = this.configManager.reload();
      this.detectProviderModelChange();
      this.emitConfigChange();
      return this.config;
    } catch {
      return this.config;
    } finally {
      this.syncing = false;
    }
  }

  getActiveProvider(): ProviderId | null {
    return this.config?.provider.activeProvider ?? null;
  }

  getActiveModel(): string | null {
    return this.config?.provider.activeModel ?? null;
  }

  getProviderApiKey(providerId: ProviderId): string | undefined {
    if (!this.config) return undefined;
    const creds = this.config.provider.providers[providerId];
    if (!creds) return undefined;

    if (creds.activeProfile && creds.profiles) {
      return creds.profiles[creds.activeProfile]?.apiKey;
    }
    return creds.apiKey;
  }

  getProviderBaseUrl(providerId: ProviderId): string | undefined {
    if (!this.config) return undefined;
    const creds = this.config.provider.providers[providerId];
    if (!creds) return undefined;

    if (creds.activeProfile && creds.profiles) {
      return creds.profiles[creds.activeProfile]?.baseUrl;
    }
    return creds.baseUrl;
  }

  isToolDisabled(toolId: string): boolean {
    return this.config?.ui.disabledTools?.includes(toolId) ?? false;
  }

  getDisabledTools(): string[] {
    return this.config?.ui.disabledTools ?? [];
  }

  onConfigChange(handler: ConfigChangeHandler): Disposable {
    this.configChangeHandlers.add(handler);
    return { dispose: () => { this.configChangeHandlers.delete(handler); } };
  }

  onProviderChange(handler: ProviderChangeHandler): Disposable {
    this.providerChangeHandlers.add(handler);
    return { dispose: () => { this.providerChangeHandlers.delete(handler); } };
  }

  onFirstRun(handler: FirstRunHandler): Disposable {
    this.firstRunHandlers.add(handler);
    return { dispose: () => { this.firstRunHandlers.delete(handler); } };
  }

  private syncFromVSCodeSettings(): void {
    if (!this.config) return;

    const vsConfig = vscode.workspace.getConfiguration(VSCODE_SECTION);

    const provider = vsConfig.get<string>('provider');
    if (provider && provider !== this.config.provider.activeProvider) {
      this.config.provider.activeProvider = provider as ProviderId;
    }

    const model = vsConfig.get<string>('model');
    if (model && model !== this.config.provider.activeModel) {
      this.config.provider.activeModel = model;
    }

    const theme = vsConfig.get<'dark' | 'light'>('theme');
    if (theme) {
      this.config.ui.theme = theme;
    }

    const showTokenBar = vsConfig.get<boolean>('showTokenBar');
    if (typeof showTokenBar === 'boolean') {
      this.config.ui.showTokenBar = showTokenBar;
    }

    const showTimers = vsConfig.get<boolean>('showTimers');
    if (typeof showTimers === 'boolean') {
      this.config.ui.showTimers = showTimers;
    }

    const animationSpeed = vsConfig.get<'normal' | 'fast' | 'reduced'>('animationSpeed');
    if (animationSpeed) {
      this.config.ui.animationSpeed = animationSpeed;
    }

    const disabledTools = vsConfig.get<string[]>('disabledTools');
    if (Array.isArray(disabledTools)) {
      this.config.ui.disabledTools = disabledTools;
    }

    this.detectProviderModelChange();
  }

  private startSettingsWatcher(): void {
    this.settingsWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(VSCODE_SECTION)) {
        if (this.syncing) return;
        this.syncing = true;
        try {
          this.syncFromVSCodeSettings();
          this.emitConfigChange();
        } finally {
          this.syncing = false;
        }
      }
    });

    this.context.subscriptions.push(this.settingsWatcher);
  }

  private detectProviderModelChange(): void {
    if (!this.config) return;

    const newProvider = this.config.provider.activeProvider;
    const newModel = this.config.provider.activeModel;

    if (
      this.lastProviderId !== null &&
      (this.lastProviderId !== newProvider || this.lastModelId !== newModel)
    ) {
      for (const handler of this.providerChangeHandlers) {
        try {
          handler(newProvider, newModel);
        } catch {
          // Swallow handler errors
        }
      }
    }

    this.lastProviderId = newProvider;
    this.lastModelId = newModel;
  }

  private emitConfigChange(): void {
    if (!this.config) return;
    if (this.syncing) return;
    for (const handler of this.configChangeHandlers) {
      try {
        handler(this.config);
      } catch {
        // Swallow handler errors
      }
    }
  }

  private emitFirstRun(): void {
    for (const handler of this.firstRunHandlers) {
      try {
        handler();
      } catch {
        // Swallow handler errors
      }
    }
  }

  private activeCrewName: string | undefined;
  private planMode = false;

  getState(): ConfigState {
    return {
      isConfigured: this.configManager.isConfigured(),
      isSetupComplete: this.configManager.isSetupComplete(),
      config: this.config,
      firstRun: this.firstRunDetected,
    };
  }

  getAvailableProviders(): Array<{ id: string; name: string; configured: boolean; description?: string }> {
    return Object.entries(this.config?.provider?.providers ?? {}).map(([id, creds]) => ({
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      configured: creds.configured || !!creds.apiKey,
      description: this.getProviderDescription(id),
    }));
  }

  getProviderMeta(id: string): { name: string; defaultBaseUrl?: string; supportsCustomUrl: boolean } | null {
    const known: Record<string, { name: string; defaultBaseUrl?: string; supportsCustomUrl: boolean }> = {
      openai: { name: 'OpenAI', supportsCustomUrl: true },
      anthropic: { name: 'Anthropic', defaultBaseUrl: 'https://api.anthropic.com', supportsCustomUrl: true },
      google: { name: 'Google', defaultBaseUrl: 'https://generativelanguage.googleapis.com', supportsCustomUrl: true },
      ollama: { name: 'Ollama', defaultBaseUrl: 'http://localhost:11434', supportsCustomUrl: true },
      lmstudio: { name: 'LM Studio', defaultBaseUrl: 'http://localhost:1234/v1', supportsCustomUrl: true },
    };
    return known[id] ?? null;
  }

  setActiveProvider(id: string): void {
    if (this.config) {
      this.config.provider.activeProvider = id as ProviderId;
      this.detectProviderModelChange();
    }
  }

  setActiveModel(id: string): void {
    if (this.config) {
      this.config.provider.activeModel = id;
      this.detectProviderModelChange();
    }
  }

  setActiveCrew(id: string): void {
    this.activeCrewName = id;
  }

  async saveConfig(): Promise<void> {
    if (this.config) {
      this.configManager.save(this.config);
    }
  }

  getActiveCrewName(): string | undefined {
    return this.activeCrewName;
  }

  getAvailableCrews(): Array<{ id: string; name: string; description?: string; members?: Array<{ name: string; role: string }> }> {
    const homeDir = process.env['HOME'] || process.env['USERPROFILE'] || '';
    if (!homeDir) return [];
    try {
      const crewsDir = path.join(homeDir, '.config', 'agentx', 'crews');
      if (!fs.existsSync(crewsDir)) return [];
      return fs.readdirSync(crewsDir)
        .filter((f: string) => f.endsWith('.json'))
        .map((f: string) => {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(crewsDir, f), 'utf-8'));
            return { id: f.replace('.json', ''), ...data };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  refreshCrews(): void {
    this.emitConfigChange();
  }

  getCrewFilePath(id: string): string | undefined {
    const homeDir = process.env['HOME'] || process.env['USERPROFILE'] || '';
    if (!homeDir) return undefined;
    return path.join(homeDir, '.config', 'agentx', 'crews', `${id}.json`);
  }

  setProviderApiKey(providerId: string | ProviderId, key: string): void {
    if (!this.config) return;
    const pid = typeof providerId === 'string' ? providerId : providerId;
    const creds = this.config.provider.providers[pid];
    if (creds) {
      if (creds.activeProfile && creds.profiles) {
        creds.profiles[creds.activeProfile]!.apiKey = key;
      }
      creds.apiKey = key;
      creds.configured = true;
    }
  }

  setProviderBaseUrl(providerId: string | ProviderId, url: string): void {
    if (!this.config) return;
    const pid = typeof providerId === 'string' ? providerId : providerId;
    const creds = this.config.provider.providers[pid];
    if (creds) {
      if (creds.activeProfile && creds.profiles) {
        creds.profiles[creds.activeProfile]!.baseUrl = url;
      }
      creds.baseUrl = url;
      creds.configured = true;
    }
  }

  hasValidConfig(): boolean {
    return this.isConfigured() && this.isSetupComplete() && this.config !== null;
  }

  isPlanModeActive(): boolean {
    return this.planMode;
  }

  setPlanMode(active: boolean): void {
    this.planMode = active;
  }

  setAutoApproveCategories(_cats: string[]): void {
  }

  setWebviewTheme(theme: string): void {
    if (this.config) {
      this.config.ui.theme = theme as 'dark' | 'light';
    }
  }

  setMaxBudget(_budget: number): void {
  }

  async reloadFromDisk(): Promise<void> {
    try {
      this.config = this.configManager.reload();
      this.emitConfigChange();
    } catch {
      // Reload failed — keep current config
    }
  }

  async fetchModelsForProvider(provider: string, _apiKey?: string, _baseUrl?: string): Promise<Array<{ id: string; name: string; description?: string; contextWindow?: number }>> {
    // In a full implementation, this would call Agent.trialModel or fetch from provider API
    // For now, return well-known models for common providers
    const knownModels: Record<string, Array<{ id: string; name: string; description?: string; contextWindow?: number }>> = {
      openai: [
        { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128_000 },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128_000 },
        { id: 'o3-mini', name: 'o3 Mini', contextWindow: 200_000 },
      ],
      anthropic: [
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', contextWindow: 200_000 },
        { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet', contextWindow: 200_000 },
      ],
      google: [
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1_000_000 },
        { id: 'gemini-2.5-pro-exp-03-25', name: 'Gemini 2.5 Pro (experimental)', contextWindow: 1_000_000 },
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', contextWindow: 1_000_000 },
        { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite', contextWindow: 1_000_000 },
        { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', contextWindow: 2_000_000 },
        { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', contextWindow: 1_000_000 },
      ],
    };
    return knownModels[provider] ?? [];
  }

  private getProviderDescription(id: string): string {
    const descriptions: Record<string, string> = {
      openai: 'GPT-4o, GPT-4, o1, etc.',
      anthropic: 'Claude 3.5 Sonnet, Claude 3 Opus, etc.',
      google: 'Gemini Pro, Gemini Ultra, etc.',
      ollama: 'Local models via Ollama',
      lmstudio: 'Local models via LM Studio',
    };
    return descriptions[id] || '';
  }

  dispose(): void {
    if (this.settingsWatcher) {
      this.settingsWatcher.dispose();
      this.settingsWatcher = null;
    }

    this.configChangeHandlers.clear();
    this.providerChangeHandlers.clear();
    this.firstRunHandlers.clear();
  }
}
