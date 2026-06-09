import type { ToolResult, ToolDefinition } from '@agentx/shared';
import { ToolExecutor } from './ToolExecutor.js';
import { ToolRegistry } from './ToolRegistry.js';
import { ParallelClassifier } from './ParallelClassifier.js';
import { ToolCallRepairer } from './ToolCallRepairer.js';
import { DoomLoopDetector } from './DoomLoopDetector.js';

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

export class EnhancedToolExecutor extends ToolExecutor {
  readonly parallelClassifier = new ParallelClassifier();
  readonly toolCallRepairer = new ToolCallRepairer();
  readonly doomLoopDetector = new DoomLoopDetector();
  private _registry: ToolRegistry;

  constructor(registry: ToolRegistry, scopePath: string) {
    super(registry, scopePath);
    this._registry = registry;
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

    const doom = this.doomLoopDetector.check(sessionId, toolName, args);
    if (doom.shouldBreak) {
      return { toolCallId, toolName, result: { success: false, output: `Doom loop: ${toolName} ×${doom.consecutiveCount}`, error: 'DOOM_LOOP' }, elapsed: 0 };
    }

    try {
      const result = await this.execute(toolName, args, sessionId);
      
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
      return { toolCallId, toolName, result: { success: false, output: err instanceof Error ? err.message : (typeof err === 'object' ? JSON.stringify(err) : String(err)), error: 'EXECUTION_ERROR' }, elapsed: 0 };
    }
  }

  private buildToolMeta(toolName: string): ToolDefinition {
    const t = this._registry.get(toolName);
    return {
      id: toolName,
      name: toolName,
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
