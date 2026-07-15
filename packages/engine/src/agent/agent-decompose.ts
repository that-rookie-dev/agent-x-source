/**
 * Task decomposition and specialist delegation extracted from Agent.ts (REFACTOR-2).
 */
import { getLogger, type EngineEvent } from '@agentx/shared';
import type { SpecialistType } from './SpecialistRegistry.js';

export interface DecomposeContext {
  emit(event: EngineEvent): void;
  provider: { complete(request: unknown): AsyncIterable<{ type: string; content?: string }> };
  config: { provider: { activeModel: string } };
  subAgents: {
    spawn(task: string, tools: string[], timeout: number, max: number): { id: string };
    waitFor(id: string): Promise<{ result?: string; startTime?: number; endTime?: number } | null>;
  };
  maxSubAgents: number;
  specialistRegistry: {
    getByType(type: SpecialistType): { name: string; agentId: string; preferredTools?: string[] } | null;
  };
  agentBus: { publish(sessionId: string, agentId: string, type: string, payload: unknown): void };
  sessionId: string;
}

/**
 * Decompose a complex task into subtasks and delegate to specialist sub-agents in parallel.
 */
export async function decomposeAndDelegate(
  ctx: DecomposeContext,
  task: string,
): Promise<{
  subResults: Array<{ specialist: SpecialistType; output: string; elapsed: number }>;
  synthesized: string;
  totalElapsed: number;
}> {
  const start = Date.now();
  ctx.emit({ type: 'decomposition_start', task } as EngineEvent);

  // LLM-driven decomposition: break task into subtasks per specialist
  const decompositionPrompt = `Break this complex task into subtasks that can be handled by specialist agents:
"${task.slice(0, 500)}"

Available specialists: coder, reviewer, tester, researcher, devops, docs_writer, architect, debugger

For each specialist that is relevant, write a SUBTASK in one line.
Format:
CODER: <subtask>
REVIEWER: <subtask>
... etc.

Only include specialists that are actually needed for this task.`;

  const prov = ctx.provider;
  let decomposition = '';
  try {
    const stream = prov.complete({
      messages: [{ role: 'user', content: decompositionPrompt }],
      model: ctx.config.provider.activeModel,
      maxTokens: 500,
      stream: true,
    });
    for await (const chunk of stream) {
      if (chunk.type === 'text_delta' && chunk.content) decomposition += chunk.content;
    }
  } catch {
    // Fallback: single sub-agent via concurrency pool
    ctx.emit({ type: 'decomposition_fallback', task } as EngineEvent);
    const spawned = ctx.subAgents.spawn(task, [], 120_000, ctx.maxSubAgents);
    const completed = await ctx.subAgents.waitFor(spawned.id);
    const output = completed?.result ?? '';
    const elapsed = (completed?.endTime ?? Date.now()) - (completed?.startTime ?? Date.now());
    return {
      subResults: [{ specialist: 'coder' as SpecialistType, output, elapsed }],
      synthesized: output,
      totalElapsed: Date.now() - start,
    };
  }

  // Parse decomposition into specialist tasks
  const subtasks: Array<{ specialist: SpecialistType; instruction: string }> = [];
  const lines = decomposition.split('\n');
  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.+)/);
    if (match && match[1] && match[2]) {
      const spec = match[1].toLowerCase() as SpecialistType;
      const instruction = match[2];
      if (ctx.specialistRegistry.getByType(spec)) {
        subtasks.push({ specialist: spec, instruction });
      }
    }
  }

  if (subtasks.length === 0) {
    getLogger().warn('DECOMPOSE', 'No matching specialist found for task decomposition. Skipping sub-agent spawn.');
    ctx.emit({ type: 'decomposition_ready', subtaskCount: 0 } as EngineEvent);
    return { subResults: [], synthesized: '', totalElapsed: Date.now() - start };
  }

  ctx.emit({ type: 'decomposition_ready', subtaskCount: subtasks.length } as EngineEvent);

  // Spawn parallel sub-agents through SubAgentManager (Fiber + semaphore)
  const subPromises = subtasks.map(async ({ specialist, instruction }) => {
    const spec = ctx.specialistRegistry.getByType(specialist);
    if (!spec) return null;

    ctx.agentBus.publish(ctx.sessionId, spec.agentId, 'subtask', {
      instruction,
      parentTask: task,
    });

    const spawned = ctx.subAgents.spawn(
      `[SPECIALIST: ${spec.name}]\n${instruction}`,
      spec.preferredTools ?? [],
      120_000,
      ctx.maxSubAgents,
    );
    const completed = await ctx.subAgents.waitFor(spawned.id);
    return {
      specialist,
      output: completed?.result ?? '',
      elapsed: (completed?.endTime ?? Date.now()) - (completed?.startTime ?? Date.now()),
    };
  });

  const rawResults = await Promise.all(subPromises);
  const subResults = rawResults.filter((r): r is { specialist: SpecialistType; output: string; elapsed: number } => r !== null);

  // Synthesize results
  const parts = subResults.map((r) =>
    `--- ${r.specialist.toUpperCase()} (${r.elapsed}ms) ---\n${r.output.slice(0, 2000)}`
  );
  const synthesisPrompt = `Synthesize these specialist reports into a single coherent response:\n\n${parts.join('\n\n')}\n\nConsolidated response:`;

  let synthesized = '';
  try {
    const synthStream = prov.complete({
      messages: [{ role: 'user', content: synthesisPrompt }],
      model: ctx.config.provider.activeModel,
      maxTokens: 2000,
      stream: true,
    });
    for await (const chunk of synthStream) {
      if (chunk.type === 'text_delta' && chunk.content) synthesized += chunk.content;
    }
  } catch {
    synthesized = subResults.map((r) => `${r.specialist}: ${r.output}`).join('\n\n');
  }

  const totalElapsed = Date.now() - start;
  ctx.emit({ type: 'decomposition_complete', subResultCount: subResults.length, totalElapsed } as EngineEvent);

  return { subResults, synthesized, totalElapsed };
}
