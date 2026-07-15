import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { EngineEvent, CompletionMessage, AgentXConfig } from '@agentx/shared';
import type { AgentEventBus } from '../EventBus.js';
import type { ProviderInterface } from '../providers/ProviderInterface.js';
import { generateId } from '@agentx/shared';
import type { Agent } from './Agent.js';
import { SmartSubAgent } from './SmartSubAgent.js';
import { SubAgentCache } from './SubAgentCache.js';
import { Fiber } from '../concurrency/Fiber.js';
import { Scope } from '../concurrency/Scope.js';
import { Deferred } from '../concurrency/Deferred.js';
import { Semaphore } from '../concurrency/Semaphore.js';
import type { SubAgentType } from './subagent-types.js';
import { SUBAGENT_TYPES } from './subagent-types.js';
import { getSubAgentServiceInstance, type SubAgentService } from './SubAgentService.js';

/** Default concurrent sub-agent slots (virtual fibers; queue when full). */
const DEFAULT_MAX_CONCURRENT = 8;

export interface SubAgentTask {
  id: string;
  instruction: string;
  tools: string[];
  timeout: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'queued';
  result?: string;
  startTime?: number;
  endTime?: number;
  abortController?: AbortController;
  workDir?: string;
  deniedTools?: string[];
  parentSessionId?: string;
  childSessionId?: string;
  background?: boolean;
  consumed?: boolean;
  // Resource monitoring
  resourceUsage?: {
    cpuTime?: number; // milliseconds
    memoryPeak?: number; // bytes
    tokenUsage?: { input: number; output: number };
  };
}

export class SubAgentManager {
  private agents: Map<string, SubAgentTask> = new Map();
  private completedAgents: Map<string, SubAgentTask> = new Map();
  private eventBus: AgentEventBus;
  private provider: ProviderInterface | null = null;
  private config: AgentXConfig | null = null;
  private systemPrompt: string = '';
  private sandboxEnabled = true;
  private tempDirs: Set<string> = new Set();
  private parentAgent: Agent | null = null;
  private cache: SubAgentCache = new SubAgentCache();
  private subAgentTypes = SUBAGENT_TYPES;
  private systemPromptHash: string = '';
  private scope: Scope = new Scope();
  private runningCount = 0;
  private idleDeferred: Deferred<void> | null = null;
  private taskCompletions: Map<string, Deferred<void>> = new Map();
  private service: SubAgentService = getSubAgentServiceInstance();
  private parentSessionId: string | null = null;
  /** Virtual concurrency pool — queues when at capacity instead of failing. */
  private concurrencyPool = new Semaphore(DEFAULT_MAX_CONCURRENT);

  constructor(eventBus: AgentEventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Set the parent agent for SmartSubAgent usage.
   */
  setParentAgent(agent: Agent): void {
    this.parentAgent = agent;
    this.parentSessionId = agent.sessionId ?? null;
  }

  setCache(cache: SubAgentCache): void {
    this.cache = cache;
  }

  getCache(): SubAgentCache {
    return this.cache;
  }

  setMaxConcurrent(n: number): void {
    this.concurrencyPool.setPermits(Math.max(1, Math.min(32, n)));
  }

  getConcurrencyStats(): { running: number; pending: number; available: number } {
    return {
      running: this.concurrencyPool.running,
      pending: this.concurrencyPool.pending,
      available: this.concurrencyPool.available,
    };
  }

  /**
   * Run arbitrary async work under the same virtual-concurrency pool as spawn().
   * Use for SmartSubAgent callers that need custom options (crew, research) but
   * must still respect maxConcurrent instead of stampeding.
   */
  runInPool<T>(fn: () => Promise<T>): Promise<T> {
    return this.concurrencyPool.run(fn);
  }

  /**
   * Attach a provider and config so sub-agents can make real LLM calls.
   */
  configure(provider: ProviderInterface, config: AgentXConfig, systemPrompt: string): void {
    this.provider = provider;
    this.config = config;
    this.systemPrompt = systemPrompt;
    this.systemPromptHash = this.hashSystemPrompt(systemPrompt);
  }

  private hashSystemPrompt(prompt: string): string {
    let hash = 0;
    for (let i = 0; i < prompt.length; i++) {
      const chr = prompt.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0;
    }
    return hash.toString(36);
  }

  enableSandbox(enabled: boolean): void {
    this.sandboxEnabled = enabled;
  }

  private createWorkDir(): string | undefined {
    if (!this.sandboxEnabled) return undefined;
    const dir = join(tmpdir(), `agentx-sub-${generateId()}`);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.tempDirs.add(dir);
    return dir;
  }

  private cleanupWorkDir(dir: string): void {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    this.tempDirs.delete(dir);
  }

  getType(id: string): SubAgentType | undefined {
    return this.subAgentTypes.find(t => t.id === id);
  }

  /**
   * Spawn a sub-agent that will actually execute an LLM completion in the background.
   * When at maxConcurrent, the task is queued (virtual concurrency) — never rejected.
   */
  spawn(instruction: string, tools: string[] = [], timeout = 60_000, maxConcurrent = DEFAULT_MAX_CONCURRENT, typeId?: string, background = false): SubAgentTask {
    let effectiveTools = tools;
    let deniedTools: string[] | undefined;
    if (typeId) {
      const type = this.getType(typeId);
      if (type) {
        if (effectiveTools.length === 0) {
          effectiveTools = type.defaultTools;
        }
        deniedTools = type.deniedTools;
      }
    }
    // Check cache for a matching result
    const cacheKey = this.cache.deriveKey(instruction, tools, this.systemPromptHash);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      const task: SubAgentTask = {
        id: generateId(),
        instruction,
        tools,
        timeout,
        status: 'completed',
        result: cached.result,
        startTime: Date.now() - (cached.resourceUsage.cpuTime ?? 0),
        endTime: Date.now(),
        resourceUsage: { ...cached.resourceUsage },
        parentSessionId: this.parentSessionId ?? undefined,
        childSessionId: generateId(),
        background,
        consumed: !background,
      };
      this.completedAgents.set(task.id, task);
      this.service.registerTask(task);
      return task;
    }

    // Align pool size with caller limit (Agent.maxSubAgents)
    this.concurrencyPool.setPermits(Math.max(1, Math.min(32, maxConcurrent)));

    const workDir = this.createWorkDir();
    const task: SubAgentTask = {
      id: generateId(),
      instruction,
      tools: effectiveTools,
      timeout,
      status: 'queued',
      abortController: new AbortController(),
      workDir,
      deniedTools,
      parentSessionId: this.parentSessionId ?? undefined,
      childSessionId: generateId(),
      background,
      consumed: !background,
    };

    this.agents.set(task.id, task);
    this.runningCount++;
    this.taskCompletions.set(task.id, new Deferred<void>());
    this.service.registerTask(task);

    this.eventBus.emit({
      type: 'agent_spawned',
      agentId: task.id,
      task: instruction,
      startTime: Date.now(),
    } as EngineEvent);

    // Fiber + semaphore = virtual threads: start immediately, queue if at capacity
    Fiber.spawn(`subagent-${task.id}`, async (signal) => {
      signal.addEventListener('abort', () => task.abortController?.abort());
      if (task.abortController?.signal.aborted || signal.aborted) {
        this.fail(task.id, 'Cancelled before start');
        return;
      }
      try {
        await this.concurrencyPool.run(async () => {
          if (task.abortController?.signal.aborted || signal.aborted) {
            this.fail(task.id, 'Cancelled while queued');
            return;
          }
          await this.execute(task);
        }, signal);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('aborted') || task.abortController?.signal.aborted) {
          this.fail(task.id, 'Cancelled');
        } else {
          this.fail(task.id, msg);
        }
      }
    }, this.scope);

    return task;
  }

  /**
   * Execute a sub-agent task — uses SmartSubAgent if tools are specified, otherwise raw LLM call.
   * Runs concurrently with other sub-agents (no parent serialLock — that previously
   * forced all sub-agents to run one-at-a-time and defeated spawnParallel).
   */
  private async execute(task: SubAgentTask): Promise<void> {
    task.status = 'running';
    task.startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;

    this.eventBus.emit({
      type: 'agent_progress',
      agentId: task.id,
      status: 'running',
    } as EngineEvent);

    try {
      // Prefer SmartSubAgent whenever parent is available.
      // Empty tools list means "all tools" (SmartSubAgent convention) — not raw LLM.
      if (this.parentAgent) {
        const smartAgent = new SmartSubAgent({
          parentAgent: this.parentAgent,
          instruction: task.instruction,
          tools: task.tools.length > 0 ? task.tools : undefined,
          timeout: task.timeout,
          sessionId: task.id,
        });

        // Set up timeout
        const timeoutId = setTimeout(() => {
          task.abortController?.abort();
        }, task.timeout);

        const result = await smartAgent.execute();
        clearTimeout(timeoutId);

        // Track resource usage
        const endMemory = process.memoryUsage().heapUsed;
        task.resourceUsage = {
          cpuTime: result.elapsed,
          memoryPeak: Math.max(startMemory, endMemory),
          tokenUsage: result.tokenUsage,
        };

        if (task.abortController?.signal.aborted && task.status === 'running') {
          this.fail(task.id, 'Timed out');
        } else if (result.success) {
          this.complete(task.id, result.output);
        } else {
          this.fail(task.id, result.output);
        }
      } else {
        // Fallback to raw LLM call (no tools)
        if (!this.provider || !this.config) {
          this.fail(task.id, 'SubAgent not configured — no provider attached');
          return;
        }

        const messages: CompletionMessage[] = [];
        let systemContent = this.systemPrompt;
        if (task.workDir) {
          systemContent += `\n\nYou are running in an isolated workspace at: ${task.workDir}\nAll file operations are scoped to this directory.`;
        }
        if (systemContent) {
          messages.push({ role: 'system', content: systemContent });
        }
        messages.push({ role: 'user', content: task.instruction });

        const request = {
          messages,
          model: this.config.provider.activeModel,
          stream: true,
          maxTokens: 4096,
        };

        // Set up timeout
        const timeoutId = setTimeout(() => {
          task.abortController?.abort();
        }, task.timeout);

        let result = '';
        const stream = this.provider.complete(request);
        for await (const chunk of stream) {
          if (task.abortController?.signal.aborted) break;
          if (chunk.type === 'text_delta' && chunk.content) {
            result += chunk.content;
          }
        }
        clearTimeout(timeoutId);

        // Track resource usage
        const endMemory = process.memoryUsage().heapUsed;
        const elapsed = Date.now() - (task.startTime ?? Date.now());
        task.resourceUsage = {
          cpuTime: elapsed,
          memoryPeak: Math.max(startMemory, endMemory),
        };

        if (task.abortController?.signal.aborted && task.status === 'running') {
          this.fail(task.id, 'Timed out');
        } else {
          this.complete(task.id, result);
        }
      }
    } catch (error) {
      this.fail(task.id, error instanceof Error ? error.message : 'Sub-agent execution failed');
    }
  }

  /**
   * Run multiple sub-agents in parallel and wait for all to complete.
   * Excess tasks queue behind the concurrency pool (virtual threads).
   */
  spawnParallel(tasks: Array<{ instruction: string; tools?: string[] }>, maxConcurrent = DEFAULT_MAX_CONCURRENT): SubAgentTask[] {
    const spawned: SubAgentTask[] = [];
    for (const t of tasks) {
      const task = this.spawn(t.instruction, t.tools ?? [], 60_000, maxConcurrent, undefined, false);
      if (task) spawned.push(task);
    }
    return spawned;
  }

  complete(agentId: string, result: string): void {
    const task = this.agents.get(agentId);
    if (task) {
      task.status = 'completed';
      task.result = result;
      task.endTime = Date.now();
      const elapsed = task.endTime - (task.startTime ?? task.endTime);
      if (task.workDir) this.cleanupWorkDir(task.workDir);
      // Store in cache
      const cacheKey = this.cache.deriveKey(task.instruction, task.tools, this.systemPromptHash);
      this.cache.set(cacheKey, result, task.resourceUsage ?? {});
      this.service.updateTask(agentId, { status: 'completed', result, endTime: task.endTime, consumed: !task.background });
      this.eventBus.emit({
        type: 'agent_complete',
        agentId,
        summary: result.slice(0, 200),
        elapsed,
      } as EngineEvent);
      if (task.background) {
        const tokensUsed = (task.resourceUsage?.tokenUsage?.input ?? 0) + (task.resourceUsage?.tokenUsage?.output ?? 0);
        this.eventBus.emit({
          type: 'background_task_complete',
          taskId: task.id,
          childSessionId: task.childSessionId ?? task.id,
          tokensUsed,
          elapsedMs: elapsed,
        } as EngineEvent);
      }
      this.finalizeTask(agentId);
    }
  }

  fail(agentId: string, error: string): void {
    const task = this.agents.get(agentId);
    if (task) {
      task.status = 'failed';
      task.result = error;
      task.endTime = Date.now();
      if (task.workDir) this.cleanupWorkDir(task.workDir);
      this.service.updateTask(agentId, { status: 'failed', result: error, endTime: task.endTime, consumed: true });
      this.eventBus.emit({
        type: 'agent_complete',
        agentId,
        summary: `Failed: ${error}`,
        elapsed: Date.now() - (task.startTime ?? Date.now()),
      } as EngineEvent);
      this.finalizeTask(agentId);
    }
  }

  private finalizeTask(agentId: string): void {
    const task = this.agents.get(agentId);
    if (!task) return;
    // Move to completed map so results stay accessible
    this.completedAgents.set(agentId, task);
    this.agents.delete(agentId);
    this.runningCount = Math.max(0, this.runningCount - 1);

    // Resolve per-task completion deferred
    const taskDef = this.taskCompletions.get(agentId);
    if (taskDef) {
      taskDef.resolve();
      this.taskCompletions.delete(agentId);
    }

    // If all agents are done, resolve idle deferred
    if (this.runningCount === 0 && this.idleDeferred) {
      this.idleDeferred.resolve();
      this.idleDeferred = null;
    }
  }

  cancel(agentId: string): void {
    const task = this.agents.get(agentId);
    if (task && (task.status === 'pending' || task.status === 'running' || task.status === 'queued')) {
      task.status = 'cancelled';
      task.endTime = Date.now();
      task.abortController?.abort();
      this.service.updateTask(agentId, { status: 'cancelled', endTime: task.endTime, consumed: true });
    }
  }

  cancelAll(): void {
    this.scope.dispose();
    for (const task of this.agents.values()) {
      if (task.status === 'pending' || task.status === 'running' || task.status === 'queued') {
        task.status = 'cancelled';
        task.endTime = Date.now();
        task.abortController?.abort();
        this.service.updateTask(task.id, { status: 'cancelled', endTime: task.endTime, consumed: true });
      }
    }
  }

  /**
   * Pull any completed background sub-agent results for a session into the
   * current parent agent's history. This lets background tasks outlive the
   * Agent instance that spawned them and report back after navigation.
   */
  ingestBackgroundResultsForSession(sessionId: string): void {
    const results = this.service.consumeResults(sessionId);
    if (!this.parentAgent || results.length === 0) return;

    for (const task of results) {
      const tokensUsed = (task.resourceUsage?.tokenUsage?.input ?? 0) + (task.resourceUsage?.tokenUsage?.output ?? 0);
      const elapsedMs = (task.endTime ?? Date.now()) - (task.startTime ?? Date.now());
      const output = task.result ?? '';
      const syntheticMessage = {
        role: 'assistant' as const,
        content: `[task_result]\ntaskId: ${task.id}\nchildSessionId: ${task.childSessionId ?? task.id}\ntokensUsed: ${tokensUsed}\nelapsedMs: ${elapsedMs}\n[/task_result]\n${output}`,
      };
      (this.parentAgent as unknown as { addToHistory(msg: { role: 'user' | 'assistant'; content: string }): void }).addToHistory(syntheticMessage);
    }
  }

  getRunning(): SubAgentTask[] {
    return [...this.agents.values()].filter((t) => t.status === 'running');
  }

  getAll(): SubAgentTask[] {
    return [...this.agents.values()];
  }

  getAllIncludingCompleted(): SubAgentTask[] {
    return [...this.agents.values(), ...this.completedAgents.values()];
  }

  /**
   * Wait for all currently running agents to finish (event-driven, no polling).
   */
  async awaitAll(): Promise<SubAgentTask[]> {
    if (this.runningCount === 0) return this.getAllIncludingCompleted();
    if (!this.idleDeferred) {
      this.idleDeferred = new Deferred<void>();
    }
    await this.idleDeferred.promise;
    return this.getAllIncludingCompleted();
  }

  /**
   * Wait for a specific task to complete (event-driven).
   */
  async waitFor(agentId: string): Promise<SubAgentTask | undefined> {
    const existing = this.completedAgents.get(agentId) || this.agents.get(agentId);
    if (!existing) return undefined;
    if (existing.status !== 'pending' && existing.status !== 'running' && existing.status !== 'queued') return existing;
    const def = this.taskCompletions.get(agentId);
    if (!def) return existing;
    await def.promise;
    return this.completedAgents.get(agentId) || this.agents.get(agentId);
  }

  /**
   * Get completed tasks (with results).
   */
  getCompleted(): SubAgentTask[] {
    return [...this.completedAgents.values()].filter((t) => t.status === 'completed');
  }

  /**
   * Merge multiple sub-agent results into a single consolidated string.
   * Uses LLM for intelligent merging when provider is available, otherwise
   * falls back to simple concatenation with headers.
   */
  async mergeResults(taskIds?: string[]): Promise<string> {
    const tasks = taskIds
      ? taskIds.map((id) => this.agents.get(id)).filter((t): t is SubAgentTask => t !== undefined)
      : this.getCompleted();

    if (tasks.length === 0) return 'No completed sub-agent results to merge.';
    if (tasks.length === 1) return tasks[0]!.result ?? '(empty result)';

    // Try LLM-based merging
    if (this.provider && this.config) {
      const parts = tasks.map((t, i) => `--- Task ${i + 1}: ${t.instruction} ---\n${t.result ?? '(empty)'}`);
      const mergePrompt = `Consolidate the following parallel research/analysis results into a single coherent summary. Remove redundancy, combine related information, and present it in a well-organized format. Do not include the "--- Task N ---" separators in your output.

${parts.join('\n\n')}

Consolidated summary:`;

      try {
        const messages: CompletionMessage[] = [
          { role: 'user', content: mergePrompt },
        ];
        const stream = this.provider.complete({
          messages,
          model: this.config.provider.activeModel,
          maxTokens: 4096,
          stream: true,
        });
        let merged = '';
        for await (const chunk of stream) {
          if (chunk.type === 'text_delta' && chunk.content) {
            merged += chunk.content;
          }
        }
        return merged.trim() || tasks.map((t, i) =>
          `--- Result ${i + 1}: ${t.instruction} ---\n${t.result ?? '(empty)'}`
        ).join('\n\n');
      } catch {
        // Fall through to concatenation
      }
    }

    // Simple concatenation fallback
    return tasks.map((t, i) =>
      `--- Result ${i + 1}: ${t.instruction} ---\n${t.result ?? '(empty)'}`
    ).join('\n\n');
  }
}
