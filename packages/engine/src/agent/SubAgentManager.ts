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
import type { SubAgentType } from './subagent-types.js';
import { SUBAGENT_TYPES } from './subagent-types.js';

export interface SubAgentTask {
  id: string;
  instruction: string;
  tools: string[];
  timeout: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: string;
  startTime?: number;
  endTime?: number;
  abortController?: AbortController;
  workDir?: string;
  deniedTools?: string[];
  // Resource monitoring
  resourceUsage?: {
    cpuTime?: number; // milliseconds
    memoryPeak?: number; // bytes
    tokenUsage?: { input: number; output: number };
  };
}

export class SubAgentManager {
  private agents: Map<string, SubAgentTask> = new Map();
  private eventBus: AgentEventBus;
  private provider: ProviderInterface | null = null;
  private config: AgentXConfig | null = null;
  private systemPrompt: string = '';
  private sandboxEnabled = false;
  private tempDirs: Set<string> = new Set();
  private parentAgent: Agent | null = null;
  private cache: SubAgentCache = new SubAgentCache();
  private subAgentTypes = SUBAGENT_TYPES;
  private systemPromptHash: string = '';
  private scope: Scope = new Scope();

  constructor(eventBus: AgentEventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Set the parent agent for SmartSubAgent usage.
   */
  setParentAgent(agent: Agent): void {
    this.parentAgent = agent;
  }

  setCache(cache: SubAgentCache): void {
    this.cache = cache;
  }

  getCache(): SubAgentCache {
    return this.cache;
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
   */
  spawn(instruction: string, tools: string[] = [], timeout = 60_000, maxConcurrent = 5, typeId?: string): SubAgentTask | null {
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
      };
      this.agents.set(task.id, task);
      return task;
    }

    // Enforce concurrent sub-agent limit
    const runningCount = Array.from(this.agents.values()).filter((a) => a.status === 'running' || a.status === 'pending').length;
    if (runningCount >= maxConcurrent) {
      const task: SubAgentTask = {
        id: generateId(),
        instruction,
        tools,
        timeout,
        status: 'failed',
        startTime: Date.now(),
        endTime: Date.now(),
      };
      this.fail(task.id, `Sub-agent limit reached (${runningCount}/${maxConcurrent}). Wait for existing sub-agents to complete.`);
      return null;
    }

    const workDir = this.createWorkDir();
    const task: SubAgentTask = {
      id: generateId(),
      instruction,
      tools: effectiveTools,
      timeout,
      status: 'pending',
      abortController: new AbortController(),
      workDir,
      deniedTools,
    };

    this.agents.set(task.id, task);
    this.eventBus.emit({
      type: 'agent_spawned',
      agentId: task.id,
      task: instruction,
      startTime: Date.now(),
    } as EngineEvent);

    // Start execution immediately in the background via a fiber
    Fiber.spawn(`subagent-${task.id}`, async (signal) => {
      signal.addEventListener('abort', () => task.abortController?.abort());
      await this.execute(task);
    }, this.scope);

    return task;
  }

  /**
   * Execute a sub-agent task — uses SmartSubAgent if tools are specified, otherwise raw LLM call.
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
      // Use SmartSubAgent if tools are specified and parent agent is available
      if (task.tools.length > 0 && this.parentAgent) {
        const smartAgent = new SmartSubAgent({
          parentAgent: this.parentAgent,
          instruction: task.instruction,
          tools: task.tools,
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
   */
  spawnParallel(tasks: Array<{ instruction: string; tools?: string[] }>, maxConcurrent = 5): SubAgentTask[] {
    const spawned: SubAgentTask[] = [];
    for (const t of tasks) {
      const task = this.spawn(t.instruction, t.tools ?? [], 60_000, maxConcurrent);
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
      this.eventBus.emit({
        type: 'agent_complete',
        agentId,
        summary: result.slice(0, 200),
        elapsed,
      } as EngineEvent);
      // Remove from active agents to prevent memory growth
      this.agents.delete(agentId);
    }
  }

  fail(agentId: string, error: string): void {
    const task = this.agents.get(agentId);
    if (task) {
      task.status = 'failed';
      task.result = error;
      task.endTime = Date.now();
      if (task.workDir) this.cleanupWorkDir(task.workDir);
      this.eventBus.emit({
        type: 'agent_complete',
        agentId,
        summary: `Failed: ${error}`,
        elapsed: Date.now() - (task.startTime ?? Date.now()),
      } as EngineEvent);
      // Remove from active agents to prevent memory growth
      this.agents.delete(agentId);
    }
  }

  cancel(agentId: string): void {
    const task = this.agents.get(agentId);
    if (task && (task.status === 'pending' || task.status === 'running')) {
      task.status = 'cancelled';
      task.endTime = Date.now();
      task.abortController?.abort();
    }
  }

  cancelAll(): void {
    this.scope.dispose();
    for (const task of this.agents.values()) {
      if (task.status === 'pending' || task.status === 'running') {
        task.status = 'cancelled';
        task.endTime = Date.now();
        task.abortController?.abort();
      }
    }
  }

  promoteResult(subAgentId: string, result: string): void {
    const task = this.agents.get(subAgentId);
    if (!task) return;

    const tokensUsed = (task.resourceUsage?.tokenUsage?.input ?? 0) + (task.resourceUsage?.tokenUsage?.output ?? 0);
    const elapsedMs = (task.endTime ?? Date.now()) - (task.startTime ?? Date.now());

    const syntheticMessage = {
      role: 'assistant' as const,
      content: `[task_result]\ntaskId: ${task.id}\nchildSessionId: ${task.id}\ntokensUsed: ${tokensUsed}\nelapsedMs: ${elapsedMs}\n[/task_result]\n${result}`,
    };

    if (this.parentAgent) {
      (this.parentAgent as unknown as { addToHistory(msg: { role: 'user' | 'assistant'; content: string }): void }).addToHistory(syntheticMessage);
    }

    this.eventBus.emit({
      type: 'background_task_complete',
      taskId: task.id,
      childSessionId: task.id,
      tokensUsed,
      elapsedMs,
    } as EngineEvent);
  }

  getRunning(): SubAgentTask[] {
    return [...this.agents.values()].filter((t) => t.status === 'running');
  }

  getAll(): SubAgentTask[] {
    return [...this.agents.values()];
  }

  /**
   * Wait for all currently running agents to finish.
   */
  awaitAll(): Promise<SubAgentTask[]> {
    return new Promise((resolve) => {
      const check = () => {
        const running = this.getRunning();
        if (running.length === 0) {
          resolve(this.getAll());
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  /**
   * Get completed tasks (with results).
   */
  getCompleted(): SubAgentTask[] {
    return [...this.agents.values()].filter((t) => t.status === 'completed');
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
