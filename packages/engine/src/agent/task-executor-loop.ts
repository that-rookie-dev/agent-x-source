import { getLogger } from '@agentx/shared';
import type { AgentXConfig, SessionEvent, CompletionMessage } from '@agentx/shared';
import type { Agent } from './Agent.js';
import type {
  TaskStep,
  TaskPlan,
  TaskExecutorResult,
  FailureRecord,
  CheckpointAction,
} from './TaskExecutor.js';

/**
 * Git manager shape used by the execution loop (subset of GitManager).
 */
type GitManagerLike = {
  snapshot?: () => string | null;
  revert?: (hash?: string) => boolean;
  listSnapshots?: () => Array<{ hash: string }>;
  commitAfterEdit?: (path: string, sessionId?: string) => boolean;
};

/**
 * Context required by the extracted execution loop functions.
 * Includes all state and delegated methods the loop needs.
 */
export interface TaskLoopContext {
  agent: Agent;
  config: AgentXConfig;
  apiKey?: string;
  sessionId: string;
  conventions: string[];
  store?: { saveTaskSnapshot: (s: Record<string, unknown>) => void; getTaskSnapshot: (sid: string) => Record<string, unknown> | null; deleteTaskSnapshot: (sid: string) => void };
  onCheckpoint?: (step: TaskStep, failures: FailureRecord[]) => Promise<CheckpointAction>;
  onSessionEvent?: (event: SessionEvent) => void;
  stepTimeout: number;
  maxReplans: number;

  // Mutable state (accessed via getters/setters on the context object)
  stepTimings: number[];
  stepSuccesses: number;
  stepFailures: number;
  dynamicMaxReplans: number;
  usedFallbackModels: Set<string>;
  originalModel: string;
  chunkCounter: number;
  sequence: number;
  lastCommentCount: number;

  // Delegated methods
  emitEvent(event: Record<string, unknown>): void;
  emitSessionEvent(event: Omit<SessionEvent, 'sessionId' | 'sequence' | 'timestamp'>): void;
  emitProgress(plan: TaskPlan, stepIndex: number, phase: string): void;
  persistState(plan: TaskPlan, failureHistory: FailureRecord[]): void;
  verify(step: TaskStep, result: string): Promise<{ passed: boolean; reason: string }>;
  executeStep(step: TaskStep, goal: string): Promise<string>;
  runDebugCycle(step: TaskStep, result: string, goal: string): Promise<{ passed: boolean; error?: string; lastOutput: string; fixCount: number }>;
  lintStepConventions(step: TaskStep, result: string): Promise<string>;
  verifyFacts(step: TaskStep, result: string): Promise<{ passed: boolean; warnings: string[] }>;
  suggestNewSubtasks(plan: TaskPlan, step: TaskStep, goal: string): Promise<TaskStep[]>;
  checkContext(plan: TaskPlan): Promise<void>;
  midPlanReevaluation(plan: TaskPlan, goal: string): Promise<void>;
  replan(goal: string, failedSteps: TaskStep[], lastResult: string, failureReason: string, failureHistory: FailureRecord[]): Promise<TaskStep[]>;
  generateAlternativeApproach(step: TaskStep, failureReason: string, lastResult: string, goal: string): Promise<string>;
  tryModelFailover(): Promise<boolean>;
  autoCommitStep(step: TaskStep): Promise<void>;
  selfTune(): void;
  saveTaskMemory(plan: TaskPlan): Promise<void>;
  verifyGoal(goal: string, plan: TaskPlan): Promise<{ achieved: boolean; reason: string; gaps?: string[] }>;
  computeQualityScore(plan: TaskPlan, verification: { achieved: boolean; reason: string; gaps?: string[] }): number;
  commitTaskResult(plan: TaskPlan, success: boolean, summary: string): void;
  makeResult(success: boolean, plan: TaskPlan, summary: string): TaskExecutorResult;
  hasGhAvailable(): Promise<boolean>;
  autoPrPush(plan: TaskPlan): Promise<void>;
  ciPipeline(plan: TaskPlan): Promise<boolean>;
  prReviewLoop(plan: TaskPlan): Promise<boolean>;
  deploy(plan: TaskPlan): Promise<boolean>;
}

/**
 * Get the git manager from the agent (handles private access cleanly).
 */
function getGitManager(agent: Agent): GitManagerLike | undefined {
  return agent['gitManager'] as GitManagerLike | undefined;
}

/**
 * Build execution batches from plan steps (parallel steps grouped together).
 */
export function buildBatches(plan: TaskPlan): TaskStep[][] {
  const batches: TaskStep[][] = [];
  let currentBatch: TaskStep[] = [];

  for (const step of plan.steps) {
    if (step.parallel) {
      currentBatch.push(step);
    } else {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
      }
      batches.push([step]);
    }
  }
  if (currentBatch.length > 0) batches.push(currentBatch);
  return batches;
}

/**
 * Create a "last result" for early termination.
 */
export function lastResult(
  ctx: TaskLoopContext,
  plan: TaskPlan,
): TaskExecutorResult {
  const completedSteps = plan.steps.filter(s => s.status === 'completed').length;
  const summary = `Completed ${completedSteps}/${plan.steps.length} steps.`;
  ctx.commitTaskResult(plan, false, summary);
  return ctx.makeResult(false, plan, summary);
}

/**
 * Self-tuning: adjust dynamic replan limits based on failure rate.
 */
export function selfTune(ctx: TaskLoopContext): void {
  const total = ctx.stepSuccesses + ctx.stepFailures;
  if (total < 3) return;

  const failRate = ctx.stepFailures / total;
  if (failRate > 0.5 && ctx.dynamicMaxReplans < 6) {
    ctx.dynamicMaxReplans = Math.min(6, ctx.dynamicMaxReplans + 1);
    getLogger().info('TASK_EXECUTOR', `Self-tuned: increased max replans to ${ctx.dynamicMaxReplans} (fail rate: ${Math.round(failRate * 100)}%)`);
  } else if (failRate < 0.15 && ctx.dynamicMaxReplans > ctx.maxReplans) {
    ctx.dynamicMaxReplans = Math.max(ctx.maxReplans, ctx.dynamicMaxReplans - 1);
    getLogger().info('TASK_EXECUTOR', `Self-tuned: decreased max replans to ${ctx.dynamicMaxReplans} (fail rate: ${Math.round(failRate * 100)}%)`);
  }
}

/**
 * Auto-commit a completed step via the git manager.
 */
export async function autoCommitStep(ctx: TaskLoopContext, _step: TaskStep): Promise<void> {
  const gitManager = getGitManager(ctx.agent);
  if (!gitManager?.commitAfterEdit) return;
  try {
    gitManager.commitAfterEdit('.', ctx.sessionId);
  } catch {
    // Best-effort
  }
}

/**
 * Adaptive context compaction: compact messages if they grow too large.
 */
export async function checkContext(ctx: TaskLoopContext, plan: TaskPlan): Promise<void> {
  const messages = ctx.agent.messages;
  if (!messages) return;

  // Session chunking: every 15 completed steps, persist a checkpoint
  ctx.chunkCounter = plan.steps.filter(s => s.status === 'completed').length;
  if (ctx.chunkCounter > 0 && ctx.chunkCounter % 15 === 0) {
    getLogger().info('TASK_EXECUTOR', `Session chunking at ${ctx.chunkCounter} completed steps — persisting checkpoint`);
    if (ctx.store?.saveTaskSnapshot) {
      ctx.persistState(plan, []);
    }
  }

  if (messages.length > 40 || ctx.agent.compactContextNow) {
    try {
      await ctx.agent.compactContextNow();
      getLogger().info('TASK_EXECUTOR', 'Adaptive context compaction triggered');
    } catch {
      // Best-effort
    }

    // If compaction didn't reduce enough, force-clear old non-system messages
    if (messages.length > 80) {
      const systemMsgs = messages.filter((m: CompletionMessage) => m.role === 'system');
      const recentMsgs = messages.filter((m: CompletionMessage) => m.role !== 'system').slice(-20);
      ctx.agent.messages = [...systemMsgs, ...recentMsgs];
      getLogger().info('TASK_EXECUTOR', `Force-pruned messages to ${ctx.agent.messages.length}`);
    }
  }

  // Restore original model if we were on a fallback and the error is far enough back
  if (ctx.usedFallbackModels.size > 0 && ctx.config.provider.activeModel !== ctx.originalModel) {
    const lastFailIndex = plan.steps.findLastIndex(s => s.status === 'failed');
    const lastSuccessIndex = plan.steps.findLastIndex(s => s.status === 'completed');
    if (lastSuccessIndex > (lastFailIndex ?? -1) + 2) {
      getLogger().info('TASK_EXECUTOR', `Restoring original model: ${ctx.originalModel}`);
      ctx.agent.switchModel(ctx.originalModel);
      ctx.config.provider.activeModel = ctx.originalModel;
    }
  }
}

/**
 * Persist task state to the store for crash recovery.
 */
export function persistState(
  ctx: TaskLoopContext,
  plan: TaskPlan,
  failureHistory: FailureRecord[],
): void {
  if (!ctx.store) return;
  ctx.store.saveTaskSnapshot({
    sessionId: ctx.sessionId,
    taskId: plan.id,
    stepIndex: plan.currentStepIndex,
    goal: plan.goal,
    planState: JSON.stringify({
      id: plan.id,
      goal: plan.goal,
      steps: plan.steps,
      currentStepIndex: plan.currentStepIndex,
      createdAt: plan.createdAt,
      updatedAt: new Date().toISOString(),
    }),
    failureHistory: JSON.stringify(failureHistory),
  });
}

/**
 * Restore task state from stored snapshot.
 */
export function restoreState(
  stored: Record<string, unknown>,
): { plan: TaskPlan; failureHistory: FailureRecord[] } | null {
  try {
    const planState = JSON.parse(stored['plan_state'] as string);
    if (!planState || !planState.steps) return null;
    const plan: TaskPlan = {
      id: planState.id,
      goal: planState.goal,
      steps: planState.steps,
      currentStepIndex: planState.currentStepIndex || 0,
      createdAt: planState.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const failureHistory: FailureRecord[] = JSON.parse((stored['failure_history'] as string) || '[]');
    return { plan, failureHistory };
  } catch {
    return null;
  }
}

/**
 * Execute a parallel batch of steps via sub-agents.
 */
export async function executeParallelBatch(
  ctx: TaskLoopContext,
  plan: TaskPlan,
  batch: TaskStep[],
  failureHistory: FailureRecord[],
  goal: string,
  _gitManager: GitManagerLike | undefined,
): Promise<'ok' | 'abort' | 'return'> {
  getLogger().info('TASK_EXECUTOR', `Executing parallel batch with ${batch.length} steps via sub-agents`);

  const subAgentManager = ctx.agent.agents;

  const spawnedTasks = batch.map((step) => {
    const i = plan.steps.indexOf(step);
    step.status = 'in_progress';
    ctx.emitEvent({ type: 'step_started', stepIndex: i, description: step.description });
    const stepPrompt = `Task goal: "${goal}"\n\nStep to execute: ${step.description}\nExpected outcome: ${step.expectedOutcome}\n\nExecute this step completely.`;
    const spawned = subAgentManager?.spawn(stepPrompt, [], 120_000, 5);
    return { step, idx: i, spawned };
  });

  const results = await Promise.allSettled(
    spawnedTasks.map(async ({ step, idx: i, spawned }) => {
      if (!spawned || !spawned.id) {
        return { step, i, result: '', error: 'Failed to spawn sub-agent' };
      }
      const completed = await subAgentManager!.waitFor(spawned.id);
      return {
        step, i,
        result: completed?.result || '',
        error: completed?.status === 'failed' ? (completed?.result || 'Sub-agent failed') : undefined,
      };
    }),
  );

  for (const settled of results) {
    if (settled.status === 'rejected') {
      getLogger().error('TASK_EXECUTOR', `Parallel sub-agent threw: ${settled.reason}`);
      continue;
    }
    const { step, i, result, error } = settled.value;

    if (error) {
      step.status = 'failed';
      step.error = error;
      getLogger().error('TASK_EXECUTOR', `Parallel step ${i + 1} failed: ${error}`);
      failureHistory.push({ stepIndex: i, description: step.description, failureReason: error, attemptNumber: 1 });
      continue;
    }

    const verified = await ctx.verify(step, result);

    if (verified.passed) {
      step.status = 'completed';
      step.result = await ctx.lintStepConventions(step, result);

      ctx.emitEvent({ type: 'step_completed', stepIndex: i, result: (step.result || '').slice(0, 500) });
      ctx.emitSessionEvent({
        type: 'task_step_completed',
        payload: { taskId: plan.id, stepIndex: i, totalSteps: plan.steps.length, description: step.description, status: 'completed' },
      });
      getLogger().info('TASK_EXECUTOR', `Parallel step ${i + 1} completed successfully`);
    } else {
      step.status = 'failed';
      step.error = verified.reason;
      step.result = result;
      failureHistory.push({ stepIndex: i, description: step.description, failureReason: verified.reason, attemptNumber: 1 });
      getLogger().warn('TASK_EXECUTOR', `Parallel step ${i + 1} failed: ${verified.reason}`);
    }
  }

  // If any parallel step failed, roll back the entire batch
  const failedSteps = batch.filter(s => s.status === 'failed');
  if (failedSteps.length > 0) {
    getLogger().warn('TASK_EXECUTOR', `${failedSteps.length}/${batch.length} parallel steps failed`);
    const firstFailed = plan.steps.indexOf(failedSteps[0]!);
    if (firstFailed >= 0) {
      const gs = getGitManager(ctx.agent);
      gs?.revert?.();
    }

    if (ctx.onCheckpoint) {
      const action = await ctx.onCheckpoint(failedSteps[0]!, failureHistory);
      if (action === 'abort') return 'abort';
      if (action === 'skip_step') {
        for (const fs of failedSteps) { fs.status = 'completed'; fs.result = '(skipped by user)'; }
        return 'ok';
      }
    }

    // Replan: replace all failed steps
    const firstFailedIdx = plan.steps.indexOf(failedSteps[0]!);
    const remaining = plan.steps.slice(firstFailedIdx);
    const desc = failedSteps.map(s => s.description).join('; ');
    const newSteps = await ctx.replan(goal, remaining, '', `Parallel batch failed: ${desc}`, failureHistory);
    if (newSteps.length > 0) {
      plan.steps.splice(firstFailedIdx, remaining.length, ...newSteps);
      ctx.persistState(plan, failureHistory);
    }
  }

  return 'ok';
}

/**
 * Execute a single sequential step with retry/replan logic.
 */
export async function executeSequentialStep(
  ctx: TaskLoopContext,
  plan: TaskPlan,
  step: TaskStep,
  i: number,
  failureHistory: FailureRecord[],
  goal: string,
  rePlanAttempts: number,
  preSnapshot: string | null,
  gitManager: GitManagerLike | undefined,
): Promise<'ok' | 'abort' | 'return'> {
  const stepStart = Date.now();
  const effectiveMaxReplans = ctx.dynamicMaxReplans;

  while (rePlanAttempts <= effectiveMaxReplans) {
    try {
      const result = await ctx.executeStep(step, goal);
      const verified = await ctx.verify(step, result);

      if (verified.passed) {
        ctx.stepSuccesses++;
        ctx.stepTimings.push(Date.now() - stepStart);
        step.status = 'completed';
        step.result = result;

        const debugResult = await ctx.runDebugCycle(step, result, goal);
        if (!debugResult.passed) {
          ctx.stepFailures++;
          ctx.stepTimings.push(Date.now() - stepStart);
          ctx.selfTune();
          step.status = 'failed';
          step.error = debugResult.error || 'Build/test failed';
          step.result = debugResult.lastOutput;
          rePlanAttempts++;

          failureHistory.push({ stepIndex: i, description: step.description, failureReason: debugResult.error || 'Build/test failed', attemptNumber: rePlanAttempts });
          getLogger().warn('TASK_EXECUTOR', `Step ${i + 1} passed verification but build/test failed (attempt ${rePlanAttempts}): ${debugResult.error}`);

          if (rePlanAttempts > effectiveMaxReplans) {
            const action = await ctx.onCheckpoint?.(step, failureHistory);
            if (action === 'abort') return 'abort';
            if (action === 'skip_step') { step.status = 'completed'; step.result = '(skipped by user after build failure)'; return 'ok'; }
            if (action === 'continue') { rePlanAttempts = 0; continue; }
            ctx.commitTaskResult(plan, false, `Build/test failed after ${rePlanAttempts} attempts at step ${i + 1}`);
            return 'return';
          }

          const remaining = plan.steps.slice(i);
          const newSteps = await ctx.replan(goal, remaining, debugResult.lastOutput, debugResult.error || '', failureHistory);
          if (newSteps.length > 0) { plan.steps.splice(i, remaining.length, ...newSteps); i--; ctx.persistState(plan, failureHistory); }
          return 'ok';
        }

        // Convention enforcement linting
        const lintedResult = await ctx.lintStepConventions(step, result);
        step.result = lintedResult;

        // Hallucination guardrail: cross-reference factual claims
        const factCheck = await ctx.verifyFacts(step, lintedResult);
        if (!factCheck.passed) {
          getLogger().warn('TASK_EXECUTOR', `Fact check warnings for step ${i + 1}: ${factCheck.warnings.join('; ')}`);
        }

        ctx.emitEvent({ type: 'step_completed', stepIndex: i, result: lintedResult.slice(0, 500) });
        ctx.emitSessionEvent({ type: 'task_step_completed', payload: { taskId: plan.id, stepIndex: i, totalSteps: plan.steps.length, description: step.description, status: 'completed' } });
        getLogger().info('TASK_EXECUTOR', `Step ${i + 1} completed successfully`);
        ctx.persistState(plan, failureHistory);
        return 'ok';
      }

      if (preSnapshot) gitManager?.revert?.(preSnapshot);
      ctx.stepFailures++;
      ctx.stepTimings.push(Date.now() - stepStart);
      ctx.selfTune();

      step.status = 'failed';
      step.error = verified.reason;
      step.result = result;
      rePlanAttempts++;

      failureHistory.push({ stepIndex: i, description: step.description, failureReason: verified.reason, attemptNumber: rePlanAttempts });
      ctx.emitEvent({ type: 'step_failed', stepIndex: i, reason: verified.reason, attempt: rePlanAttempts, maxAttempts: effectiveMaxReplans + 1 });
      getLogger().warn('TASK_EXECUTOR', `Step ${i + 1} failed (attempt ${rePlanAttempts}/${effectiveMaxReplans + 1}): ${verified.reason}`);

      if (rePlanAttempts > effectiveMaxReplans) {
        const action = await ctx.onCheckpoint?.(step, failureHistory);
        if (action === 'abort') return 'abort';
        if (action === 'skip_step') { step.status = 'completed'; step.result = '(skipped by user)'; return 'ok'; }
        if (action === 'continue') { rePlanAttempts = 0; continue; }
        // Before giving up, try alternative approach
        const altApproach = await ctx.generateAlternativeApproach(step, verified.reason, result, goal);
        if (altApproach) {
          const altStep: TaskStep = {
            id: crypto.randomUUID(),
            description: `Alternative: ${altApproach.slice(0, 200)}`,
            expectedOutcome: step.expectedOutcome,
            status: 'pending' as const,
          };
          plan.steps.splice(i, 0, altStep);
          getLogger().info('TASK_EXECUTOR', 'Generated alternative approach after exhausting retries');
          rePlanAttempts = 0;
          continue;
        }
        ctx.commitTaskResult(plan, false, `Failed after ${rePlanAttempts} attempts at step ${i + 1}`);
        return 'return';
      }

      const remaining = plan.steps.slice(i);
      const newSteps = await ctx.replan(goal, remaining, result, verified.reason, failureHistory);
      if (newSteps.length > 0) {
        plan.steps.splice(i, remaining.length, ...newSteps);
        getLogger().info('TASK_EXECUTOR', `Re-planned: ${remaining.length} steps → ${newSteps.length} steps (attempt ${rePlanAttempts})`);
        i--; ctx.persistState(plan, failureHistory);
      }
      return 'ok';
    } catch (error) {
      ctx.stepFailures++;
      ctx.stepTimings.push(Date.now() - stepStart);
      ctx.selfTune();
      step.status = 'failed';
      step.error = error instanceof Error ? error.message : String(error);
      getLogger().error('TASK_EXECUTOR', `Step ${i + 1} threw: ${step.error}`);

      // Try model failover if the error is provider-related
      const providerErrorPatterns = /401|Unauthorized|403|429|quota|billing|timeout|ETIMEDOUT|ECONNRESET|5\d{2}|overloaded|rate.limit/i;
      if (providerErrorPatterns.test(step.error)) {
        const switched = await ctx.tryModelFailover();
        if (switched) {
          getLogger().info('TASK_EXECUTOR', `Failover to ${ctx.config.provider.activeModel}, retrying step ${i + 1}`);
          rePlanAttempts = 0;
          continue;
        }
      }

      ctx.commitTaskResult(plan, false, `Failed at step ${i + 1}: ${step.error}`);
      return 'return';
    }
  }
  return 'ok';
}

/**
 * Core execution plan: iterate over batches, execute steps, handle failures.
 */
export async function executePlan(
  ctx: TaskLoopContext,
  plan: TaskPlan,
  failureHistory: FailureRecord[],
  goal: string,
): Promise<TaskExecutorResult> {
  const batches = buildBatches(plan);
  const gitManager = getGitManager(ctx.agent);
  const hasGit = !!gitManager?.snapshot;

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]!;
    const isParallel = batch.length > 1 && batch.every(s => s.parallel);

    // Auto-save checkpoint before each batch
    ctx.persistState(plan, failureHistory);

    if (isParallel) {
      const batchResult = await executeParallelBatch(ctx, plan, batch, failureHistory, goal, gitManager);
      if (batchResult === 'abort') return ctx.makeResult(false, plan, `Aborted at parallel batch ${b + 1}`);
      if (batchResult === 'return') return lastResult(ctx, plan);
      ctx.emitProgress(plan, b, 'parallel_batch_done');
      continue;
    }

    // Sequential execution
    for (const step of batch) {
      const i = plan.steps.indexOf(step);
      plan.currentStepIndex = i;
      step.status = 'in_progress';
      const rePlanAttempts = 0;

      ctx.emitProgress(plan, i, 'step_started');
      getLogger().info('TASK_EXECUTOR', `Executing step ${i + 1}/${plan.steps.length}: ${step.description.slice(0, 60)}`);

      const preSnapshot = gitManager?.snapshot?.() ?? null;

      // Wrap step execution with timeout guard
      const stepPromise = executeSequentialStep(ctx, plan, step, i, failureHistory, goal, rePlanAttempts, preSnapshot, gitManager);
      const timeoutPromise = new Promise<'timeout'>((_, reject) =>
        setTimeout(() => reject(new Error(`Step ${i + 1} timed out after ${ctx.stepTimeout}ms`)), ctx.stepTimeout),
      );
      const seqResult = await Promise.race([stepPromise, timeoutPromise]);
      if (seqResult === 'abort') return ctx.makeResult(false, plan, `Aborted at step ${i + 1}`);
      if (seqResult === 'return') return lastResult(ctx, plan);

      // Post-step phases for completed steps
      if (step.status === 'completed' as TaskStep['status']) {
        if (hasGit) await autoCommitStep(ctx, step);
        const newSubtasks = await ctx.suggestNewSubtasks(plan, step, goal);
        if (newSubtasks.length > 0) {
          plan.steps.splice(i + 1, 0, ...newSubtasks);
          getLogger().info('TASK_EXECUTOR', `Added ${newSubtasks.length} self-discovered sub-task(s) after step ${i + 1}`);
        }
        await ctx.checkContext(plan);
        // Mid-plan re-evaluation every 3 completed steps
        const completedCount = plan.steps.filter(s => s.status === 'completed').length;
        if (completedCount > 0 && completedCount % 3 === 0) {
          await ctx.midPlanReevaluation(plan, goal);
        }
      }

      plan.updatedAt = new Date().toISOString();
      ctx.emitProgress(plan, i, 'step_done');
    }
  }

  // Save cross-session memory after task
  await ctx.saveTaskMemory(plan);

  // Phase 3: Final goal verification
  const goalVerified = await ctx.verifyGoal(goal, plan);
  const completedSteps = plan.steps.filter(s => s.status === 'completed').length;

  if (!goalVerified.achieved) {
    getLogger().warn('TASK_EXECUTOR', `Goal verification failed: ${goalVerified.reason}. Gaps: ${goalVerified.gaps?.join(', ') || 'none'}`);
    const qualityScore = ctx.computeQualityScore(plan, goalVerified);
    const summary = `Goal may not be fully achieved. Completed ${completedSteps}/${plan.steps.length} steps. Quality score: ${qualityScore}/100. ${goalVerified.reason}. Gaps: ${goalVerified.gaps?.join('; ') || 'none'}`;
    ctx.commitTaskResult(plan, false, summary);
    return ctx.makeResult(false, plan, summary);
  }

  // Phase 4-7: Developer-only workflows — gracefully skip if git/gh not available
  const ghAvailable = await ctx.hasGhAvailable();

  if (hasGit && ghAvailable) {
    // Phase 4: Auto PR/push on full success
    await ctx.autoPrPush(plan);

    // Phase 5: CI pipeline — wait for CI, fix if needed
    const ciPassed = await ctx.ciPipeline(plan);
    if (!ciPassed) {
      const summary = `Goal achieved but CI failed. ${plan.goal.slice(0, 60)}`;
      ctx.commitTaskResult(plan, true, summary);
      return ctx.makeResult(true, plan, summary);
    }

    // Phase 6: PR review loop — wait for approval, respond to comments
    const prMerged = await ctx.prReviewLoop(plan);
    if (prMerged) {
      // Phase 7: Deploy after PR is merged
      await ctx.deploy(plan);
    }
  } else if (hasGit && !ghAvailable) {
    // Git available but no gh CLI — just push
    try {
      await ctx.autoPrPush(plan);
    } catch {
      getLogger().info('TASK_EXECUTOR', 'gh CLI not available — skipping CI/deploy/PR pipeline');
    }
  } else {
    getLogger().info('TASK_EXECUTOR', 'Git not available — skipping developer CI/deploy/PR pipeline');
  }

  const qualityScore = ctx.computeQualityScore(plan, goalVerified);
  const avgStepTime = ctx.stepTimings.length > 0
    ? Math.round(ctx.stepTimings.reduce((a, b) => a + b, 0) / ctx.stepTimings.length / 1000)
    : 0;

  const summary = goalVerified.achieved
    ? `Goal achieved. Completed ${completedSteps}/${plan.steps.length} steps. Quality score: ${qualityScore}/100. Avg step: ${avgStepTime}s.`
    : `Goal may not be fully achieved. Completed ${completedSteps}/${plan.steps.length} steps. Quality score: ${qualityScore}/100. ${goalVerified.reason}. Gaps: ${goalVerified.gaps?.join('; ') || 'none'}`;

  ctx.commitTaskResult(plan, goalVerified.achieved, summary);
  return ctx.makeResult(goalVerified.achieved, plan, summary);
}
