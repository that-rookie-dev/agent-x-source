import type { ProviderId } from '@agentx/shared';

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

export class ModelRouter {
  private routes: Map<TaskType, ModelRoute[]> = new Map();
  private defaultProvider: ProviderId;
  private defaultModel: string;

  constructor(config?: Partial<ModelRoutingConfig>) {
    const resolvedConfig: ModelRoutingConfig = {
      routes: config?.routes ?? DEFAULT_ROUTES,
      defaultProvider: config?.defaultProvider ?? 'openai',
      defaultModel: config?.defaultModel ?? 'gpt-4.1-nano',
    };
    this.defaultProvider = resolvedConfig.defaultProvider;
    this.defaultModel = resolvedConfig.defaultModel;
    for (const route of resolvedConfig.routes) {
      const existing = this.routes.get(route.taskType) ?? [];
      existing.push(route);
      this.routes.set(route.taskType, existing.sort((a, b) => a.priority - b.priority));
    }
  }

  selectModel(taskType: TaskType): { provider: ProviderId; model: string } {
    const candidates = this.routes.get(taskType);
    if (!candidates || candidates.length === 0) {
      return { provider: this.defaultProvider, model: this.defaultModel };
    }
    const best = candidates[0];
    return { provider: best!.provider, model: best!.model };
  }

  getRoutes(): Map<TaskType, ModelRoute[]> {
    return new Map(this.routes);
  }

  setRoute(taskType: TaskType, provider: ProviderId, model: string, priority = 0): void {
    const existing = this.routes.get(taskType) ?? [];
    existing.push({ taskType, provider, model, priority });
    this.routes.set(taskType, existing.sort((a, b) => a.priority - b.priority));
  }

  removeRoute(taskType: TaskType, model: string): void {
    const existing = this.routes.get(taskType) ?? [];
    this.routes.set(taskType, existing.filter((r) => r.model !== model));
  }
}
