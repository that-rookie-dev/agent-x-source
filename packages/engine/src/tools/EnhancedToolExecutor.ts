import type { ToolResult, ToolDefinition } from '@agentx/shared';
import { ToolExecutor } from './ToolExecutor.js';
import { ToolRegistry } from './ToolRegistry.js';
import { ParallelClassifier } from './ParallelClassifier.js';
import { ToolCallRepairer } from './ToolCallRepairer.js';
import { DoomLoopDetector } from './DoomLoopDetector.js';
import { AutonomousDiagnosticsSystem } from '../agent/AutonomousDiagnosticsSystem.js';
import { Semaphore } from '../concurrency/Semaphore.js';
import { getLogger } from '@agentx/shared';
import { getPerformanceLanes } from '../performance/PerformanceGovernor.js';

/** Fallback only if Performance lanes are unavailable at construction. */
const DEFAULT_TOOL_CONCURRENCY = 8;

export interface BatchToolCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  rawArgs?: string;
}

export interface BatchToolResult {
  toolCallId: string;
  toolName: string;
  result: ToolResult;
  elapsed: number;
  wasRepaired?: boolean;
}

interface CircuitBreakerEntry {
  failures: number;
  firstFailureAt: number;
  blacklistedUntil: number;
}

export class EnhancedToolExecutor extends ToolExecutor {
  readonly parallelClassifier = new ParallelClassifier();
  readonly toolCallRepairer = new ToolCallRepairer();
  readonly doomLoopDetector = new DoomLoopDetector();
  private _registry: ToolRegistry;
  private circuitBreakers: Map<string, CircuitBreakerEntry> = new Map();
  private readonly CIRCUIT_BREAKER_THRESHOLD = 3;
  private readonly CIRCUIT_BREAKER_WINDOW_MS = 60000;
  private readonly CIRCUIT_BREAKER_COOLDOWN_MS = 300000;
  private diagnosticsSystem = new AutonomousDiagnosticsSystem();
  private sessionContextCache: Map<string, any> = new Map();
  private _scopePath: string;
  /** Caps concurrent tool executions when the model emits multi-tool batches. */
  private toolConcurrency = new Semaphore(getPerformanceLanes().toolParallel || DEFAULT_TOOL_CONCURRENCY);
  /** Collects concurrent AI SDK tool calls in one microtask for ParallelClassifier. */
  private batchPending: Array<{
    toolId: string;
    args: Record<string, unknown>;
    sessionId: string;
    options?: { signal?: AbortSignal };
    resolve: (r: ToolResult) => void;
    reject: (e: unknown) => void;
  }> = [];
  private batchScheduled = false;
  /** >0 while flushing a classified batch — bypasses re-batching. */
  private batchDepth = 0;

  isCircuitBlacklisted(toolName: string): boolean {
    const entry = this.circuitBreakers.get(toolName);
    if (!entry) return false;
    if (entry.failures >= this.CIRCUIT_BREAKER_THRESHOLD) {
      if (Date.now() < entry.blacklistedUntil) return true;
      this.circuitBreakers.delete(toolName);
    }
    return false;
  }

  recordCircuitFailure(toolName: string): void {
    const now = Date.now();
    let entry = this.circuitBreakers.get(toolName);
    if (!entry) {
      entry = { failures: 1, firstFailureAt: now, blacklistedUntil: 0 };
      this.circuitBreakers.set(toolName, entry);
    } else {
      if (now - entry.firstFailureAt > this.CIRCUIT_BREAKER_WINDOW_MS) {
        entry.failures = 1;
        entry.firstFailureAt = now;
      } else {
        entry.failures++;
      }
    }
    if (entry.failures >= this.CIRCUIT_BREAKER_THRESHOLD) {
      entry.blacklistedUntil = now + this.CIRCUIT_BREAKER_COOLDOWN_MS;
    }
  }

  getCircuitBreakerStatus(): Array<{ tool: string; failures: number; blacklisted: boolean; remainingMs: number }> {
    const now = Date.now();
    const status: Array<{ tool: string; failures: number; blacklisted: boolean; remainingMs: number }> = [];
    for (const [tool, entry] of this.circuitBreakers) {
      status.push({
        tool,
        failures: entry.failures,
        blacklisted: now < entry.blacklistedUntil,
        remainingMs: Math.max(0, entry.blacklistedUntil - now),
      });
    }
    return status;
  }

  resetCircuitBreaker(toolName: string): boolean {
    return this.circuitBreakers.delete(toolName);
  }

  resetAllCircuitBreakers(): void {
    this.circuitBreakers.clear();
  }

  constructor(registry: ToolRegistry, scopePath: string) {
    super(registry, scopePath);
    this._registry = registry;
    this._scopePath = scopePath;
  }

  override setScopePath(scopePath: string): void {
    super.setScopePath(scopePath);
    this._scopePath = scopePath;
  }

  getScopePath(): string {
    return this._scopePath;
  }

  setMaxToolConcurrency(n: number): void {
    this.toolConcurrency.setPermits(Math.max(1, Math.min(32, n)));
  }

  getToolConcurrencyStats(): { running: number; pending: number; available: number } {
    return {
      running: this.toolConcurrency.running,
      pending: this.toolConcurrency.pending,
      available: this.toolConcurrency.available,
    };
  }

  /**
   * Public entry: coalesce concurrent AI SDK tool calls into one classified batch
   * (SAFE parallel / PATH_SCOPED / NEVER sequential), then run through the semaphore.
   */
  override async execute(
    toolId: string,
    args: Record<string, unknown>,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ToolResult> {
    if (this.batchDepth > 0) {
      return this.executeDirect(toolId, args, sessionId, options);
    }
    return new Promise<ToolResult>((resolve, reject) => {
      this.batchPending.push({ toolId, args, sessionId, options, resolve, reject });
      if (!this.batchScheduled) {
        this.batchScheduled = true;
        queueMicrotask(() => {
          void this.flushToolBatch();
        });
      }
    });
  }

  /** Direct execution through the concurrency pool (no batch coalescing). */
  private executeDirect(
    toolId: string,
    args: Record<string, unknown>,
    sessionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ToolResult> {
    return this.toolConcurrency.run(() => super.execute(toolId, args, sessionId, options), options?.signal);
  }

  private async flushToolBatch(): Promise<void> {
    const batch = this.batchPending.splice(0);
    this.batchScheduled = false;
    if (batch.length === 0) return;

    this.batchDepth++;
    try {
      if (batch.length === 1) {
        const b = batch[0]!;
        try {
          b.resolve(await this.executeDirect(b.toolId, b.args, b.sessionId, b.options));
        } catch (e) {
          b.reject(e);
        }
        return;
      }

      const sessionId = batch[0]!.sessionId;
      const results = await this.executeBatch(
        batch.map((b, i) => ({
          toolCallId: `batch-${i}-${b.toolId}`,
          toolName: b.toolId,
          args: b.args,
        })),
        sessionId,
      );

      const byId = new Map(results.map((r) => [r.toolCallId, r]));
      for (let i = 0; i < batch.length; i++) {
        const b = batch[i]!;
        const r = byId.get(`batch-${i}-${b.toolId}`);
        if (r) b.resolve(r.result);
        else b.reject(new Error(`Missing batch result for ${b.toolId}`));
      }
    } catch (e) {
      for (const b of batch) b.reject(e);
    } finally {
      this.batchDepth--;
    }
  }

  resetDoomLoop(sessionId: string): void {
    this.doomLoopDetector.reset(sessionId);
  }

  async executeBatch(
    calls: BatchToolCall[],
    sessionId: string,
    onBefore?: (toolName: string, args: Record<string, unknown>) => void,
    onAfter?: (toolName: string, result: ToolResult, elapsed: number) => void,
  ): Promise<BatchToolResult[]> {
    if (calls.length === 0) return [];

    const classified = this.parallelClassifier.classify(
      calls.map((c) => ({
        toolCallId: c.toolCallId,
        tool: this.buildToolMeta(c.toolName),
        args: c.args,
      })),
    );

    const results: BatchToolResult[] = [];
    const prevDepth = this.batchDepth;
    this.batchDepth = prevDepth + 1;
    try {
      if (classified.parallel.length > 0) {
        const parallelResults = await Promise.all(
          classified.parallel.map((ct) => {
            const call = calls.find((c) => c.toolCallId === ct.toolCallId);
            if (!call) return null;
            return this._execOne(call.toolCallId, call.toolName, call.args, sessionId, onBefore);
          }),
        );
        for (const r of parallelResults) {
          if (r) results.push(r);
        }
      }

      for (const ct of classified.sequential) {
        const call = calls.find((c) => c.toolCallId === ct.toolCallId);
        if (!call) continue;
        const r = await this._execOne(call.toolCallId, call.toolName, call.args, sessionId, onBefore);
        results.push(r);
      }
    } finally {
      this.batchDepth = prevDepth;
    }

    if (onAfter) {
      for (const r of results) {
        onAfter(r.toolName, r.result, r.elapsed);
      }
    }

    return results;
  }

  async checkDoomLoop(
    sessionId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ isDoomLoop: boolean; consecutiveCount: number; shouldBreak: boolean }> {
    return this.doomLoopDetector.check(sessionId, toolName, args);
  }

  getToolNames(): string[] {
    return this._registry.list().map((t) => t.name);
  }

  repairToolName(rawName: string): string {
    return this.toolCallRepairer.repairToolName(rawName, this.getToolNames());
  }

  tryRepairCalls(text: string) {
    return this.toolCallRepairer.repair(text, this.getToolNames());
  }

  private async _execOne(
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
    sessionId: string,
    onBefore?: (toolName: string, args: Record<string, unknown>) => void,
  ): Promise<BatchToolResult> {
    onBefore?.(toolName, args);
    const start = Date.now();

    // Circuit breaker check
    if (this.isCircuitBlacklisted(toolName)) {
      return {
        toolCallId, toolName,
        result: { success: false, output: `Circuit breaker: "${toolName}" temporarily blacklisted after 3+ failures in 60s`, error: 'CIRCUIT_BREAKER' },
        elapsed: 0,
      };
    }

    const doom = this.doomLoopDetector.check(sessionId, toolName, args);
    if (doom.shouldBreak) {
      return { toolCallId, toolName, result: { success: false, output: `Doom loop: ${toolName} ×${doom.consecutiveCount}`, error: 'DOOM_LOOP' }, elapsed: 0 };
    }

    try {
      let result = await this.executeDirect(toolName, args, sessionId);

      // ─── Phase 3: Auto-healing error recovery for PATH_NOT_FOUND ───
      if (!result.success && (result.error === 'PATH_NOT_FOUND' || result.output?.includes('not found'))) {
        const filePath = args['filePath'] as string | undefined;
        
        if (filePath) {
          getLogger().info('AUTO_HEALING', `Attempting to resolve file: ${filePath}`);
          
          try {
            // Get or initialize session context
            let sessionContext = this.sessionContextCache.get(sessionId);
            if (!sessionContext) {
              sessionContext = await this.diagnosticsSystem.performSessionHealthCheck(this._scopePath);
              this.sessionContextCache.set(sessionId, sessionContext);
            }
            
            // Phase 2: Intelligent file resolution via fuzzy search
            const resolutionResult = await this.diagnosticsSystem.resolveFile(filePath, sessionContext);
            
            // Check if resolution is a FileResolution object with fullPath
            if (typeof resolutionResult === 'object' && resolutionResult && 'fullPath' in resolutionResult && resolutionResult.fullPath) {
              const resolvedPath = resolutionResult.fullPath;
              getLogger().info('AUTO_HEALING', `File resolved to: ${resolvedPath}`);
              
              // Update arguments with resolved path and retry
              const updatedArgs = { ...args, filePath: resolvedPath };
              const retryResult = await this.executeDirect(toolName, updatedArgs, sessionId);
              
              if (retryResult.success) {
                getLogger().info('AUTO_HEALING', `Operation succeeded after path resolution`);
                result = {
                  ...retryResult,
                  output: `[🔧 SELF-CORRECTED] ${retryResult.output || 'Operation completed'}\n[Original path: ${filePath} → Resolved to: ${resolvedPath}]`
                };
              } else {
                getLogger().warn('AUTO_HEALING', `Retry failed even with resolved path`);
              }
            }
          } catch (healingErr) {
            getLogger().warn('AUTO_HEALING', `Resolution failed: ${healingErr instanceof Error ? healingErr.message : String(healingErr)}`);
            // Fall through to normal error handling
          }
        }
      }

      // Record circuit breaker success (clear if was failing)
      if (result.success) {
        this.circuitBreakers.delete(toolName);
      } else {
        this.recordCircuitFailure(toolName);
      }
      
      // Record the result and check for post-execution doom loops
      this.doomLoopDetector.recordResult(sessionId, toolName, result);
      const postDoom = this.doomLoopDetector.checkPostExecution(sessionId);
      if (postDoom.shouldBreak) {
        return { 
          toolCallId, 
          toolName, 
          result: { 
            success: false, 
            output: `Doom loop detected: ${toolName} returned same result ${postDoom.consecutiveCount} times`, 
            error: 'DOOM_LOOP' 
          }, 
          elapsed: Date.now() - start 
        };
      }
      
      return { toolCallId, toolName, result, elapsed: Date.now() - start };
    } catch (err) {
      this.recordCircuitFailure(toolName);
      return { toolCallId, toolName, result: { success: false, output: err instanceof Error ? err.message : (typeof err === 'object' ? JSON.stringify(err) : String(err)), error: 'EXECUTION_ERROR' }, elapsed: 0 };
    }
  }

  private buildToolMeta(toolName: string): ToolDefinition {
    const t = this._registry.get(toolName);
    // Prefer registry id for classification; keep toolName as fallback key
    // so SAFE_PARALLEL sets keyed by id (e.g. "glob") still match.
    return {
      id: t?.id ?? toolName,
      name: t?.id ?? toolName,
      description: t?.description ?? '',
      modelDescription: t?.modelDescription ?? '',
      category: t?.category ?? 'ai_meta',
      riskLevel: t?.riskLevel ?? 'medium',
      schema: t?.schema ?? { type: 'object', properties: {} },
      composable: false,
      source: 'builtin',
      parallelMode: t?.parallelMode,
    };
  }
}
