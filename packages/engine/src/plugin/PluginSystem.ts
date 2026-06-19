import type {
  PluginManifest,
  PluginInstance,
} from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { DefaultPluginLoader } from './PluginLoader.js';
import { PluginRegistry } from './PluginRegistry.js';

const logger = getLogger();

export interface PluginLifecycle {
  id: string;
  name: string;
  manifest: PluginManifest;
  instance: PluginInstance;
  state: 'loaded' | 'active' | 'error' | 'disabled';
  health: PluginHealth;
  hooks: PluginHooks;
  config: Record<string, unknown>;
  startTime?: number;
  errorCount: number;
  lastError?: string;
}

export interface PluginHealth {
  lastCheck: number;
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
}

export interface PluginHooks {
  onLoad?: () => Promise<void>;
  onUnload?: () => Promise<void>;
  onEnable?: () => Promise<void>;
  onDisable?: () => Promise<void>;

  beforeToolCall?: (toolId: string, args: Record<string, unknown>, sessionId: string) => Promise<{ allow: boolean; reason?: string }>;
  afterToolCall?: (toolId: string, args: Record<string, unknown>, result: unknown, sessionId: string) => Promise<void>;
  beforeResponse?: (response: string, sessionId: string) => Promise<string>;
  afterResponse?: (response: string, sessionId: string) => Promise<void>;
  onMessage?: (message: string, sessionId: string) => Promise<{ handled: boolean; response?: string }>;
  onError?: (error: Error, context: Record<string, unknown>) => Promise<void>;

  healthCheck?: () => Promise<PluginHealth>;
}

export interface PluginSystemConfig {
  scanDirs?: string[];
  autoEnable?: boolean;
  healthCheckIntervalMs?: number;
  maxErrorsBeforeDisable?: number;
  db?: any;
}

export class PluginSystem {
  private loader: DefaultPluginLoader;
  private registry: PluginRegistry;
  private plugins = new Map<string, PluginLifecycle>();
  private hookRegistry = new Map<string, PluginHooks>();
  private healthInterval: ReturnType<typeof setInterval> | null = null;
  private config: Required<PluginSystemConfig>;

  constructor(config: PluginSystemConfig = {}) {
    this.loader = new DefaultPluginLoader(config.scanDirs);
    this.registry = new PluginRegistry(config.db);
    this.config = {
      scanDirs: config.scanDirs ?? [],
      autoEnable: config.autoEnable ?? true,
      healthCheckIntervalMs: config.healthCheckIntervalMs ?? 60000,
      maxErrorsBeforeDisable: config.maxErrorsBeforeDisable ?? 5,
      db: undefined as any,
    };
  }

  /** Discover all available plugins */
  async discover(): Promise<PluginManifest[]> {
    return this.loader.discover();
  }

  /** Load a plugin by manifest (doesn't activate yet) */
  async load(manifest: PluginManifest): Promise<PluginLifecycle> {
    if (this.plugins.has(manifest.id)) {
      throw new Error(`Plugin "${manifest.id}" is already loaded`);
    }

    const instance = await this.loader.load(manifest);
    if (!instance) {
      throw new Error(`Failed to load plugin "${manifest.id}"`);
    }

    // Extract hooks from plugin instance
    const hooks = this.extractHooks(instance);

    const lifecycle: PluginLifecycle = {
      id: manifest.id,
      name: manifest.name,
      manifest,
      instance,
      state: 'loaded',
      health: { lastCheck: Date.now(), status: 'healthy' },
      hooks,
      config: manifest.config ?? {},
      errorCount: 0,
    };

    this.plugins.set(manifest.id, lifecycle);
    this.hookRegistry.set(manifest.id, hooks);

    // Run onLoad hook
    if (hooks.onLoad) {
      try {
        await hooks.onLoad();
      } catch (err) {
        lifecycle.state = 'error';
        lifecycle.lastError = String(err);
        logger.error('PLUGIN_LOAD', `onLoad failed for "${manifest.id}": ${err}`);
        return lifecycle;
      }
    }

    logger.info('PLUGIN_LOAD', `Loaded: ${manifest.name} v${manifest.version}`);

    // Auto-enable
    if (this.config.autoEnable) {
      await this.enable(manifest.id);
    }

    return lifecycle;
  }

  /** Enable (activate) a loaded plugin */
  async enable(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new Error(`Plugin "${pluginId}" not found`);
    if (plugin.state === 'active') return;

    if (plugin.state === 'error' && plugin.errorCount >= this.config.maxErrorsBeforeDisable) {
      throw new Error(`Plugin "${pluginId}" has too many errors (${plugin.errorCount}). Fix and reload.`);
    }

    if (plugin.hooks.onEnable) {
      try {
        await plugin.hooks.onEnable();
      } catch (err) {
        plugin.errorCount++;
        plugin.state = 'error';
        plugin.lastError = String(err);
        throw err;
      }
    }

    plugin.state = 'active';
    plugin.startTime = Date.now();
    logger.info('PLUGIN_ENABLE', `Enabled: ${plugin.name}`);
  }

  /** Disable a plugin (stops it but keeps it loaded) */
  async disable(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;
    if (plugin.state === 'disabled') return;

    if (plugin.hooks.onDisable) {
      try { await plugin.hooks.onDisable(); }
      catch (err) { logger.warn('PLUGIN_DISABLE', `${pluginId}: ${err}`); }
    }

    plugin.state = 'disabled';
    logger.info('PLUGIN_DISABLE', `Disabled: ${plugin.name}`);
  }

  /** Unload a plugin completely */
  async unload(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    await this.disable(pluginId);

    if (plugin.hooks.onUnload) {
      try { await plugin.hooks.onUnload(); }
      catch (err) { logger.warn('PLUGIN_UNLOAD', `${pluginId}: ${err}`); }
    }

    this.plugins.delete(pluginId);
    this.hookRegistry.delete(pluginId);
    logger.info('PLUGIN_UNLOAD', `Unloaded: ${plugin.name}`);
  }

  /** Hot-reload a plugin (unload → load fresh → enable) */
  async reload(pluginId: string): Promise<PluginLifecycle> {
    const existing = this.plugins.get(pluginId);
    if (!existing) throw new Error(`Plugin "${pluginId}" not loaded`);

    await this.unload(pluginId);
    return this.load(existing.manifest);
  }

  /** Run health checks on all active plugins */
  async healthCheck(): Promise<Map<string, PluginHealth>> {
    const results = new Map<string, PluginHealth>();

    for (const [id, plugin] of this.plugins) {
      if (plugin.state !== 'active') continue;

      if (plugin.hooks.healthCheck) {
        try {
          plugin.health = await plugin.hooks.healthCheck();
        } catch {
          plugin.health = { lastCheck: Date.now(), status: 'degraded', message: 'Health check failed' };
        }
      } else {
        plugin.health = { lastCheck: Date.now(), status: 'healthy' };
      }

      results.set(id, plugin.health);
    }

    return results;
  }

  /** Start periodic health checks */
  startHealthChecks(): void {
    if (this.healthInterval) return;
    this.healthInterval = setInterval(() => {
      this.healthCheck().catch(() => {});
    }, this.config.healthCheckIntervalMs);
  }

  /** Stop periodic health checks */
  stopHealthChecks(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }

  /** Execute before-tool-call hooks across all active plugins */
  async runBeforeToolCall(toolId: string, args: Record<string, unknown>, sessionId: string): Promise<{ allow: boolean; reason?: string }> {
    for (const [, plugin] of this.plugins) {
      if (plugin.state !== 'active' || !plugin.hooks.beforeToolCall) continue;
      try {
        const result = await plugin.hooks.beforeToolCall(toolId, args, sessionId);
        if (!result.allow) return result;
      } catch (err) {
        logger.warn('PLUGIN_HOOK', `beforeToolCall failed for ${plugin.id}: ${err}`);
      }
    }
    return { allow: true };
  }

  /** Execute after-tool-call hooks across all active plugins */
  async runAfterToolCall(toolId: string, args: Record<string, unknown>, result: unknown, sessionId: string): Promise<void> {
    for (const [, plugin] of this.plugins) {
      if (plugin.state !== 'active' || !plugin.hooks.afterToolCall) continue;
      try { await plugin.hooks.afterToolCall(toolId, args, result, sessionId); }
      catch (err) { logger.warn('PLUGIN_HOOK', `afterToolCall failed for ${plugin.id}: ${err}`); }
    }
  }

  /** Execute on-message hooks */
  async runOnMessage(message: string, sessionId: string): Promise<{ handled: boolean; response?: string }> {
    for (const [, plugin] of this.plugins) {
      if (plugin.state !== 'active' || !plugin.hooks.onMessage) continue;
      try {
        const result = await plugin.hooks.onMessage(message, sessionId);
        if (result.handled) return result;
      } catch (err) {
        logger.warn('PLUGIN_HOOK', `onMessage failed for ${plugin.id}: ${err}`);
      }
    }
    return { handled: false };
  }

  getPlugin(pluginId: string): PluginLifecycle | undefined {
    return this.plugins.get(pluginId);
  }

  listPlugins(): PluginLifecycle[] {
    return Array.from(this.plugins.values());
  }

  getActivePlugins(): PluginLifecycle[] {
    return this.listPlugins().filter((p) => p.state === 'active');
  }

  getLoader(): DefaultPluginLoader {
    return this.loader;
  }

  getRegistry(): PluginRegistry {
    return this.registry;
  }

  /** Destroy — stop health checks and unload all plugins */
  async destroy(): Promise<void> {
    this.stopHealthChecks();
    const ids = Array.from(this.plugins.keys());
    for (const id of ids) {
      await this.unload(id).catch(() => {});
    }
  }

  private extractHooks(instance: PluginInstance): PluginHooks {
    const obj = instance as unknown as Record<string, unknown>;
    return {
      onLoad: typeof obj['onLoad'] === 'function' ? obj['onLoad'] as () => Promise<void> : undefined,
      onUnload: typeof obj['onUnload'] === 'function' ? obj['onUnload'] as () => Promise<void> : undefined,
      onEnable: typeof obj['onEnable'] === 'function' ? obj['onEnable'] as () => Promise<void> : undefined,
      onDisable: typeof obj['onDisable'] === 'function' ? obj['onDisable'] as () => Promise<void> : undefined,
      beforeToolCall: typeof obj['beforeToolCall'] === 'function' ? obj['beforeToolCall'] as PluginHooks['beforeToolCall'] : undefined,
      afterToolCall: typeof obj['afterToolCall'] === 'function' ? obj['afterToolCall'] as PluginHooks['afterToolCall'] : undefined,
      beforeResponse: typeof obj['beforeResponse'] === 'function' ? obj['beforeResponse'] as PluginHooks['beforeResponse'] : undefined,
      afterResponse: typeof obj['afterResponse'] === 'function' ? obj['afterResponse'] as PluginHooks['afterResponse'] : undefined,
      onMessage: typeof obj['onMessage'] === 'function' ? obj['onMessage'] as PluginHooks['onMessage'] : undefined,
      onError: typeof obj['onError'] === 'function' ? obj['onError'] as PluginHooks['onError'] : undefined,
      healthCheck: typeof obj['healthCheck'] === 'function' ? obj['healthCheck'] as () => Promise<PluginHealth> : undefined,
    };
  }
}
