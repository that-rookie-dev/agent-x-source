import { getLogger } from '@agentx/shared';
import type { ToolDefinition, ToolResult, PermissionRule } from '@agentx/shared';
import { getPerfTracker } from '../../benchmark/perf.js';
import type { ICache } from '../../cache/ICache.js';
import type { IJobQueue } from '../../queue/IJobQueue.js';
import { registerToolWorkers } from '../../queue/workers/tool-worker.js';
import { setShellSandbox } from '../../tools/builtin/shell.js';
import { DockerSandbox } from '../../sandbox/DockerSandbox.js';
import { EnhancedToolExecutor } from '../../tools/EnhancedToolExecutor.js';
import { ParallelClassifier } from '../../tools/ParallelClassifier.js';
import type { ParallelClassification } from '../../tools/ParallelClassifier.js';
import type { ToolExecutor } from '../../tools/ToolExecutor.js';
import { ToolRegistry } from '../../tools/ToolRegistry.js';
import { createDefaultToolkit } from '../../tools/toolkit.js';
import {
  shouldDisclose,
  getCoreTools,
  createBridgeTools,
  resolveBridgeToolCall,
} from '../../tools/ProgressiveDisclosure.js';
import type { IToolService, ToolCall } from './IToolService.js';
import { ToolPermissionService, type PermissionResult } from './ToolPermissionService.js';
import { ToolCacheService, type ToolCacheServiceOptions } from './ToolCacheService.js';

export interface ToolServiceOptions {
  registry: ToolRegistry;
  executor: ToolExecutor;
  scopePath: string;
  cacheOptions?: ToolCacheServiceOptions;
  cache?: ICache;
  sandbox?: { enabled?: boolean; projectDir?: string };
}

/**
 * Service facade for tool execution, caching, classification, and permission.
 *
 * Agent no longer talks to ToolExecutor directly; it routes all tool calls
 * through this service. The service wraps the existing ToolExecutor (or
 * EnhancedToolExecutor) and adds caching, job-queue workers, and a permission
 * helper while delegating the actual execution to the executor.
 */
export class ToolService implements IToolService {
  readonly name = 'ToolService';

  private registry: ToolRegistry;
  private executor: ToolExecutor;
  private scopePath: string;
  private cacheService: ToolCacheService;
  private permissionService: ToolPermissionService;

  constructor(options: ToolServiceOptions) {
    this.registry = options.registry;
    this.executor = options.executor;
    this.scopePath = options.scopePath;
    this.cacheService = new ToolCacheService({ ...options.cacheOptions, cache: options.cache });
    this.permissionService = new ToolPermissionService();

    if (options.sandbox?.enabled !== undefined) {
      this.enableSandbox(options.sandbox.enabled, options.sandbox.projectDir);
    }
  }

  static createDefault(scopePath: string, options?: Partial<ToolServiceOptions>): ToolService {
    const toolkit = createDefaultToolkit(scopePath);
    const enhanced = new EnhancedToolExecutor(toolkit.registry, scopePath);

    // Copy registered handlers from the toolkit executor into the new instance.
    const sourceMap = (toolkit.executor as unknown as { handlers: Map<string, unknown> }).handlers;
    if (sourceMap) {
      for (const [name, handler] of sourceMap) {
        enhanced.registerHandler(name, handler as (args: Record<string, unknown>, ctx: unknown) => Promise<ToolResult>);
      }
    }

    return new ToolService({
      registry: toolkit.registry,
      executor: enhanced,
      scopePath,
      ...options,
    });
  }

  listTools(): ToolDefinition[] {
    const cached = this.cacheService.getToolList();
    if (cached) return cached;
    const list = this.registry.list();
    this.cacheService.setToolList(list);
    return list;
  }

  getToolMetadata(toolId: string, version?: string): ToolDefinition | undefined {
    const cached = this.cacheService.getMetadata<ToolDefinition>(toolId, version);
    if (cached) return cached;
    const tool = this.registry.get(toolId);
    if (tool) this.cacheService.setMetadata(toolId, version, tool);
    return tool;
  }

  async execute(
    toolId: string,
    args: Record<string, unknown>,
    sessionId: string,
    ctx?: { signal?: AbortSignal },
  ): Promise<ToolResult> {
    if (ctx?.signal?.aborted) {
      return { success: false, output: 'Tool execution cancelled', error: 'ABORTED' };
    }

    const cacheKey = this.cacheService.computeKey(toolId, args);
    return this.cacheService.compute<ToolResult>(
      cacheKey,
      async () => {
        const start = performance.now();
        const result = await this.executor.execute(toolId, args, sessionId, { signal: ctx?.signal });
        getPerfTracker().recordToolLatency(performance.now() - start);
        return result;
      },
      { shouldCache: (result) => result.success },
    );
  }

  classify(calls: ToolCall[]): ParallelClassification {
    const classifier =
      this.executor instanceof EnhancedToolExecutor
        ? this.executor.parallelClassifier
        : new ParallelClassifier();

    const classified = calls.map((call, i) => ({
      tool: this.getToolMetadata(call.toolId) ?? this.fallbackTool(call.toolId),
      args: call.args,
      toolCallId: call.toolCallId ?? `${call.toolId}-${i}`,
    }));

    return classifier.classify(classified);
  }

  async requestPermission(
    toolId: string,
    args: Record<string, unknown>,
    sessionId: string,
    scopePath?: string,
  ): Promise<PermissionResult> {
    const tool = this.registry.get(toolId);
    if (!tool) {
      return { decision: 'deny', error: 'MODE_RESTRICTED' };
    }

    if (scopePath !== undefined) {
      return this.permissionService.requestPermission(
        this.executor,
        toolId,
        args,
        sessionId,
        scopePath,
        tool,
      );
    }

    const { scopePath: extracted, invalid } = this.extractScopePath(args);
    if (invalid) {
      return { decision: 'deny', error: 'SCOPE_VIOLATION' };
    }

    return this.permissionService.requestPermission(
      this.executor,
      toolId,
      args,
      sessionId,
      extracted,
      tool,
    );
  }

  getToolExecutor(): ToolExecutor {
    return this.executor;
  }

  getRegistry(): ToolRegistry {
    return this.registry;
  }

  getCacheService(): ToolCacheService {
    return this.cacheService;
  }

  getPermissionService(): ToolPermissionService {
    return this.permissionService;
  }

  registerJobWorkers(queue: IJobQueue): void {
    registerToolWorkers(queue, this);
  }

  enableSandbox(enabled: boolean, projectDir?: string): boolean {
    if (!enabled) {
      setShellSandbox(null);
      return false;
    }

    try {
      const sandbox = new DockerSandbox();
      const dir = projectDir ?? this.scopePath;
      if (dir) sandbox.setProjectDir(dir);
      setShellSandbox(sandbox);
      return sandbox.available;
    } catch (err) {
      getLogger().warn(
        'TOOL_SERVICE',
        `Sandbox init failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      setShellSandbox(null);
      return false;
    }
  }

  shouldDisclose(toolCount: number): boolean {
    return shouldDisclose(toolCount);
  }

  getCoreTools(tools: ToolDefinition[]): ToolDefinition[] {
    return getCoreTools(tools);
  }

  createBridgeTools(): ToolDefinition[] {
    return createBridgeTools();
  }

  resolveBridgeToolCall(
    toolName: string,
    args: Record<string, unknown>,
    allTools: ToolDefinition[],
  ): { resolved: ToolDefinition | null; resolvedArgs: Record<string, unknown>; error?: string } {
    return resolveBridgeToolCall(toolName, args, allTools);
  }

  dispose(): void {
    this.cacheService.clear();
  }

  setToolOutputHandler(handler: (output: string) => void): void {
    this.executor.setToolOutputHandler(handler);
  }

  setSessionRules(rules: PermissionRule[]): void {
    this.executor.setSessionRules(rules);
  }

  getSessionRules(): PermissionRule[] {
    return this.executor.getSessionRules();
  }

  isTurnAborted(): boolean {
    return this.executor.isTurnAborted();
  }

  private extractScopePath(args: Record<string, unknown>): { scopePath?: string; invalid: boolean } {
    const pathKeys = [
      'path',
      'filePath',
      'file',
      'target',
      'from',
      'to',
      'cwd',
      'output',
      'source',
      'archive',
      'file1',
      'file2',
      'database',
    ];

    let scopePath: string | undefined;
    const guard = this.executor.getScopeGuard();

    for (const key of pathKeys) {
      const value = args[key];
      if (typeof value === 'string') {
        if (!scopePath) scopePath = value;
        const validation = guard.validatePath(value);
        if (!validation.valid) {
          return { scopePath: undefined, invalid: true };
        }
      }
    }

    return { scopePath, invalid: false };
  }

  private fallbackTool(toolId: string): ToolDefinition {
    return {
      id: toolId,
      name: toolId,
      description: '',
      modelDescription: '',
      category: 'agent_meta',
      riskLevel: 'medium',
      schema: { type: 'object', properties: {} },
      composable: false,
      source: 'builtin',
    };
  }
}
