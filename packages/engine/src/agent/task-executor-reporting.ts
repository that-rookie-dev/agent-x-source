import { generateText } from 'ai';
import type { AgentXConfig, SessionEvent } from '@agentx/shared';
import { createAiSdkModel } from './AiSdkBridge.js';
import type { Agent } from './Agent.js';
import type { TaskPlan, TaskExecutorResult } from './TaskExecutor.js';
import { tryShellExec } from './task-executor-helpers.js';
import * as gitPipeline from './task-executor-git.js';
import type { GitPipelineContext } from './task-executor-git.js';

/**
 * Context required by the extracted reporting & progress functions.
 */
export interface ReportingContext {
  agent: Agent;
  config: AgentXConfig;
  apiKey?: string;
  sessionId: string;
  /** Mutable sequence counter — incremented on each session event. */
  sequence: { value: number };
  /** Mutable step success count. */
  stepSuccesses: number;
  /** Mutable step failure count. */
  stepFailures: number;
  /** Factory for the git pipeline context (used by commitTaskResult). */
  gitPipelineContext: () => GitPipelineContext;
  /** Optional session event callback. */
  onSessionEvent?: (event: SessionEvent) => void;
}

/**
 * Emit a task event through the agent's event bus.
 */
export function emitEvent(agent: Agent, event: Record<string, unknown>): void {
  agent.emit({ type: 'task_event', ...event });
}

/**
 * Emit a session event with sequence and timestamp.
 * Returns the new sequence value.
 */
export function emitSessionEvent(
  sessionId: string,
  sequence: { value: number },
  onSessionEvent: ((event: SessionEvent) => void) | undefined,
  event: Omit<SessionEvent, 'sessionId' | 'sequence' | 'timestamp'>,
): number {
  const seq = ++sequence.value;
  const fullEvent = { ...event, sessionId, sequence: seq, timestamp: Date.now() } as SessionEvent;
  onSessionEvent?.(fullEvent);
  return seq;
}

/**
 * Emit a progress event for a plan/step.
 */
export function emitProgress(
  agent: Agent,
  sessionId: string,
  sequence: { value: number },
  onSessionEvent: ((event: SessionEvent) => void) | undefined,
  plan: TaskPlan,
  stepIndex: number,
  phase: string,
): void {
  const completed = plan.steps.filter(s => s.status === 'completed').length;
  const total = plan.steps.length;
  emitEvent(agent, { type: 'task_progress', phase, stepIndex, completed, total });
  emitSessionEvent(sessionId, sequence, onSessionEvent, {
    type: 'task_progress',
    payload: {
      taskId: plan.id,
      goal: plan.goal,
      phase,
      stepIndex,
      completedSteps: completed,
      totalSteps: total,
      percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    },
  });
}

/**
 * Compute a quality score (0-100) for a completed plan.
 */
export function computeQualityScore(
  plan: TaskPlan,
  verification: { achieved: boolean; reason: string; gaps?: string[] },
  stepSuccesses: number,
  stepFailures: number,
): number {
  const totalSteps = plan.steps.length;
  if (totalSteps === 0) return 0;

  const completed = plan.steps.filter(s => s.status === 'completed').length;
  const completionRatio = completed / totalSteps;

  const failureRatio = stepFailures / Math.max(1, stepSuccesses + stepFailures);
  const reliabilityScore = Math.max(0, 1 - failureRatio);

  const gapPenalty = (verification.gaps?.length || 0) * 10;
  const achievedBonus = verification.achieved ? 20 : 0;

  const baseScore = Math.round((completionRatio * 40) + (reliabilityScore * 40) + achievedBonus - gapPenalty);
  return Math.max(0, Math.min(100, baseScore));
}

/**
 * Create a TaskExecutorResult object.
 */
export function makeResult(success: boolean, plan: TaskPlan, summary: string): TaskExecutorResult {
  return { success, plan, summary, goalVerified: success };
}

/**
 * Commit a task result via the git pipeline.
 */
export function commitTaskResult(ctx: ReportingContext, plan: TaskPlan, success: boolean, summary: string): void {
  gitPipeline.commitTaskResult(ctx.gitPipelineContext(), plan, success, summary);
}

/**
 * Save cross-session task memory/learnings.
 */
export async function saveTaskMemory(ctx: ReportingContext, plan: TaskPlan): Promise<void> {
  const completedSteps = plan.steps.filter(s => s.status === 'completed').length;
  if (completedSteps === 0) return;

  const model = createAiSdkModel(ctx.config, ctx.apiKey);
  const memoryResult = await generateText({
    model,
    system: `Extract learnings from this completed task. Return JSON:
{
  "projectType": "detected project type",
  "patterns": ["coding patterns used"],
  "painPoints": ["issues encountered"],
  "keyFiles": ["files created or modified"],
  "suggestions": ["what to do differently next time"]
}`,
    prompt: `Goal: ${plan.goal}\n\nSteps:\n${plan.steps.map((s, i) => `${i + 1}. [${s.status}] ${s.description}`).join('\n')}\n\nExtract learnings.`,
    temperature: 0.2,
    maxRetries: 1,
  });

  try {
    const memoryDir = '.agentx';
    await tryShellExec(ctx.agent, `mkdir -p "${memoryDir}"`);
    const existing = await tryShellExec(ctx.agent, `cat "${memoryDir}/memories.json" 2>/dev/null || echo "[]"`);
    let memories: unknown[] = [];
    try { memories = JSON.parse(existing); } catch { memories = []; }
    memories.push(JSON.parse(memoryResult.text));
    if (memories.length > 20) memories = memories.slice(-20);
    await tryShellExec(ctx.agent, `node -e "require('fs').writeFileSync('${memoryDir}/memories.json', ${JSON.stringify(JSON.stringify(memories))})"`);
  } catch {
    // Best-effort
  }
}

/**
 * Safe JSON parse that returns null on failure.
 */
export function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Check if gh CLI is available.
 */
export async function hasGhAvailable(agent: Agent): Promise<boolean> {
  const result = await tryShellExec(agent, 'which gh 2>/dev/null && echo "found" || echo "notfound"');
  return result.trim().includes('found');
}

/**
 * Hard restart: force-save current state for crash recovery.
 */
export function forceSaveState(
  store: { saveTaskSnapshot: (s: Record<string, unknown>) => void } | undefined,
  sessionId: string,
  goal: string,
): boolean {
  try {
    const snapshot = {
      taskId: sessionId,
      goal,
      planState: JSON.stringify({ steps: [], currentStepIndex: 0, goal }),
      stepIndex: 0,
      failureHistory: '[]',
      created_at: new Date().toISOString(),
    };
    store?.saveTaskSnapshot(snapshot);
    return true;
  } catch {
    return false;
  }
}
