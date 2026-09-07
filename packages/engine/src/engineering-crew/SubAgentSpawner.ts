import type { SubAgentManager } from '../agent/SubAgentManager.js';

/**
 * Token usage returned by a spawnAndWait call. Used for budget enforcement (#1)
 * and cost tracking (#8).
 */
export interface SpawnTokenUsage {
  input: number;
  output: number;
}

export interface SpawnResult {
  success: boolean;
  output: string;
  /** Token usage from the sub-agent's LLM call(s), if available. */
  tokenUsage?: SpawnTokenUsage;
}

/**
 * Narrow interface for "run an LLM-backed sub-agent and wait for its result", so
 * `CrewRole` subclasses (and their tests) don't depend on the full `SubAgentManager`/`Agent`
 * surface — just this one capability. Production code uses `SubAgentManagerSpawner`; tests can
 * inject a fake.
 */
export interface SubAgentSpawner {
  spawnAndWait(
    instruction: string,
    tools: string[],
    typeId: string,
    timeoutMs?: number,
  ): Promise<SpawnResult>;
}

/** Production adapter over the engine's real `SubAgentManager` (Fiber/Semaphore concurrency,
 *  admission control, cost tracking — see docs/engineering-crew/DESIGN.md Section 4.2). */
export class SubAgentManagerSpawner implements SubAgentSpawner {
  constructor(private readonly manager: SubAgentManager) {}

  async spawnAndWait(
    instruction: string,
    tools: string[],
    typeId: string,
    timeoutMs = 300_000,
  ): Promise<SpawnResult> {
    const task = this.manager.spawn(instruction, tools, timeoutMs, undefined, typeId, false);
    const completed = await this.manager.waitFor(task.id);
    const tokenUsage = completed?.resourceUsage?.tokenUsage;
    return {
      success: completed?.status === 'completed',
      output: completed?.result ?? completed?.status ?? '',
      tokenUsage: tokenUsage ? { input: tokenUsage.input ?? 0, output: tokenUsage.output ?? 0 } : undefined,
    };
  }
}

/**
 * Wraps any `SubAgentSpawner` to prepend a session-context prefix to every instruction.
 * This gives every role's LLM the full conversation history and prior plan state so it
 * can semantically understand what the user is asking for — not just match keywords.
 *
 * Used when resuming a prior crew run: the `EngineeringCrew` sets a context prefix
 * (built from `SessionContext`) on this wrapper, and every role's `spawnAndWait` call
 * automatically includes it.
 *
 * Also tracks cumulative token usage across all spawns for budget enforcement (#1)
 * and cost tracking (#8).
 */
export class ContextAwareSpawner implements SubAgentSpawner {
  private contextPrefix = '';
  private cumulativeTokens = { input: 0, output: 0 };

  constructor(private readonly inner: SubAgentSpawner) {}

  /** Set the context prefix to prepend to every instruction. Empty string = no prefix. */
  setContextPrefix(prefix: string): void {
    this.contextPrefix = prefix;
  }

  /** Get cumulative token usage across all spawns — used for budget enforcement and cost tracking. */
  getCumulativeTokenUsage(): SpawnTokenUsage {
    return { ...this.cumulativeTokens };
  }

  async spawnAndWait(
    instruction: string,
    tools: string[],
    typeId: string,
    timeoutMs?: number,
  ): Promise<SpawnResult> {
    const fullInstruction = this.contextPrefix
      ? `${this.contextPrefix}\n\n---\n\n${instruction}`
      : instruction;
    const result = await this.inner.spawnAndWait(fullInstruction, tools, typeId, timeoutMs);
    if (result.tokenUsage) {
      this.cumulativeTokens.input += result.tokenUsage.input;
      this.cumulativeTokens.output += result.tokenUsage.output;
    }
    return result;
  }
}
