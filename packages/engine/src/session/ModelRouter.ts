import type { ProviderId } from '@agentx/shared';
import type { ICache } from '../cache/ICache.js';

export type TaskType =
  | 'chat'
  | 'code'
  | 'reasoning'
  | 'planning'
  | 'analysis'
  | 'creative'
  | 'fast'
  | 'cheap';

export interface ModelRoute {
  taskType: TaskType;
  provider: ProviderId;
  model: string;
  priority: number;
}

export interface ModelRoutingConfig {
  routes: ModelRoute[];
  defaultProvider: ProviderId;
  defaultModel: string;
}

export interface ModelRouterOptions {
  routes?: ModelRoute[];
  defaultProvider?: ProviderId;
  defaultModel?: string;
  ttlMs?: number;
  /** Optional distributed cache (e.g. RedisCache when REDIS_URL is set). */
  distributedCache?: ICache;
  cachePrefix?: string;
}

const DEFAULT_ROUTES: ModelRoute[] = [
  { taskType: 'chat', provider: 'openai', model: 'gpt-4.1-nano', priority: 0 },
  { taskType: 'code', provider: 'anthropic', model: 'claude-sonnet-4-20250514', priority: 0 },
  { taskType: 'reasoning', provider: 'openai', model: 'o4-mini-2025-07-09', priority: 0 },
  { taskType: 'planning', provider: 'openai', model: 'o4-mini-2025-07-09', priority: 0 },
  { taskType: 'analysis', provider: 'anthropic', model: 'claude-sonnet-4-20250514', priority: 0 },
  { taskType: 'creative', provider: 'anthropic', model: 'claude-sonnet-4-20250514', priority: 0 },
  { taskType: 'fast', provider: 'openai', model: 'gpt-4.1-nano', priority: 0 },
  { taskType: 'cheap', provider: 'openai', model: 'gpt-4.1-nano', priority: 0 },
];

const DEFAULT_TTL_MS = 60_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class ModelRouter {
  private routes: Map<TaskType, ModelRoute[]> = new Map();
  private defaultProvider: ProviderId;
  private defaultModel: string;
  private ttlMs: number;
  private configCache: CacheEntry<ModelRoutingConfig> | undefined;
  private selectModelCache = new Map<TaskType, CacheEntry<{ provider: ProviderId; model: string }>>();
  private readonly distributedCache?: ICache;
  private readonly cachePrefix: string;

  constructor(config?: ModelRouterOptions) {
    const resolvedConfig: ModelRoutingConfig = {
      routes: config?.routes ?? DEFAULT_ROUTES,
      defaultProvider: config?.defaultProvider ?? 'openai',
      defaultModel: config?.defaultModel ?? 'gpt-4.1-nano',
    };
    this.defaultProvider = resolvedConfig.defaultProvider;
    this.defaultModel = resolvedConfig.defaultModel;
    this.ttlMs = config?.ttlMs ?? DEFAULT_TTL_MS;
    this.distributedCache = config?.distributedCache;
    this.cachePrefix = config?.cachePrefix ?? 'model-router:';
    for (const route of resolvedConfig.routes) {
      const existing = this.routes.get(route.taskType) ?? [];
      existing.push(route);
      this.routes.set(route.taskType, existing.sort((a, b) => a.priority - b.priority));
    }
  }

  selectModel(taskType: TaskType): { provider: ProviderId; model: string } {
    const cached = this.selectModelCache.get(taskType);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const candidates = this.routes.get(taskType);
    const result =
      candidates && candidates.length > 0
        ? { provider: candidates[0]!.provider, model: candidates[0]!.model }
        : { provider: this.defaultProvider, model: this.defaultModel };

    this.selectModelCache.set(taskType, { value: result, expiresAt: Date.now() + this.ttlMs });
    void this.distributedCache?.set(`${this.cachePrefix}select:${taskType}`, result, Math.ceil(this.ttlMs / 1000)).catch(() => {});
    return result;
  }

  async selectModelDistributed(taskType: TaskType): Promise<{ provider: ProviderId; model: string }> {
    if (this.distributedCache) {
      try {
        const cached = await this.distributedCache.get<{ provider: ProviderId; model: string }>(`${this.cachePrefix}select:${taskType}`);
        if (cached) return cached;
      } catch { /* fall through to local */ }
    }
    return this.selectModel(taskType);
  }

  getConfig(): ModelRoutingConfig {
    if (this.configCache && this.configCache.expiresAt > Date.now()) {
      return this.configCache.value;
    }
    const routes = Array.from(this.routes.values()).flat();
    const config: ModelRoutingConfig = {
      routes,
      defaultProvider: this.defaultProvider,
      defaultModel: this.defaultModel,
    };
    this.configCache = { value: config, expiresAt: Date.now() + this.ttlMs };
    void this.distributedCache?.set(`${this.cachePrefix}config`, config, Math.ceil(this.ttlMs / 1000)).catch(() => {});
    return config;
  }

  async getConfigDistributed(): Promise<ModelRoutingConfig> {
    if (this.distributedCache) {
      try {
        const cached = await this.distributedCache.get<ModelRoutingConfig>(`${this.cachePrefix}config`);
        if (cached) return cached;
      } catch { /* fall through to local */ }
    }
    return this.getConfig();
  }

  setConfig(config: Partial<ModelRoutingConfig>): void {
    if (config.defaultProvider) this.defaultProvider = config.defaultProvider;
    if (config.defaultModel) this.defaultModel = config.defaultModel;
    if (config.routes) {
      this.routes.clear();
      for (const route of config.routes) {
        const existing = this.routes.get(route.taskType) ?? [];
        existing.push(route);
        this.routes.set(route.taskType, existing.sort((a, b) => a.priority - b.priority));
      }
    }
    this.invalidateCache();
  }

  getRoutes(): Map<TaskType, ModelRoute[]> {
    return new Map(this.routes);
  }

  setRoute(taskType: TaskType, provider: ProviderId, model: string, priority = 0): void {
    const existing = this.routes.get(taskType) ?? [];
    existing.push({ taskType, provider, model, priority });
    this.routes.set(taskType, existing.sort((a, b) => a.priority - b.priority));
    this.invalidateCache();
  }

  removeRoute(taskType: TaskType, model: string): void {
    const existing = this.routes.get(taskType) ?? [];
    this.routes.set(taskType, existing.filter((r) => r.model !== model));
    this.invalidateCache();
  }

  invalidateCache(): void {
    this.configCache = undefined;
    this.selectModelCache.clear();
  }
}
