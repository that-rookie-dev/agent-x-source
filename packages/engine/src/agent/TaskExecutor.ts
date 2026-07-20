import { getLogger } from '@agentx/shared';
import type { AgentXConfig, SessionEvent } from '@agentx/shared';
import type { Agent } from './Agent.js';
import { tryShellExec } from './task-executor-helpers.js';
import * as gitPipeline from './task-executor-git.js';
import type { GitPipelineContext } from './task-executor-git.js';
import * as verifyDebug from './task-executor-verify.js';
import type { VerifyDebugContext, VerifyContext } from './task-executor-verify.js';
import {
  analyzeProject as analyzeProjectHelper,
  ensureRuntimes as ensureRuntimesHelper,
  ensureDependencies as ensureDependenciesHelper,
  selfTune as selfTuneHelper,
  suggestNewSubtasks as suggestNewSubtasksHelper,
  checkContext as checkContextHelper,
  saveTaskMemory as saveTaskMemoryHelper,
  computeQualityScore as computeQualityScoreHelper,
  tryModelFailover as tryModelFailoverHelper,
  processGoalVisuals as processGoalVisualsHelper,
  safeJsonParse as safeJsonParseHelper,
  hasGhAvailable as hasGhAvailableHelper,
  forceSaveState as forceSaveStateHelper,
  persistState as persistStateHelper,
  restoreState as restoreStateHelper,
  emitProgress as emitProgressHelper,
  type AnalysisContext,
} from './task-executor-analysis.js';
import {
  decompose as decomposeHelper,
  validatePlanSteps as validatePlanStepsHelper,
  midPlanReevaluation as midPlanReevaluationHelper,
  generateAlternativeApproach as generateAlternativeApproachHelper,
  buildBatches as buildBatchesHelper,
  replan as replanHelper,
  type PlanningContext,
} from './task-executor-planning.js';
import {
  verifyStep as verifyStepHelper,
  verifyGoal as verifyGoalHelper,
  verifyFacts as verifyFactsHelper,
} from './task-executor-verify.js';

export interface TaskStep {
  id: string;
  description: string;
  expectedOutcome: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string;
  error?: string;
  /** If true, this step can be executed in parallel with other parallel steps */
  parallel?: boolean;
  /** IDs of steps that must complete before this step can run */
  dependencies?: string[];
  /** If set, this step targets a specific repo (cross-repo support) */
  repoPath?: string;
}

export interface TaskPlan {
  id: string;
  goal: string;
  steps: TaskStep[];
  currentStepIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskExecutorResult {
  success: boolean;
  plan: TaskPlan;
  summary: string;
  goalVerified: boolean;
}

export interface FailureRecord {
  stepIndex: number;
  description: string;
  failureReason: string;
  attemptNumber: number;
}

export type CheckpointAction = 'continue' | 'abort' | 'skip_step' | string;

export interface TaskSnapshot {
  taskId: string;
  goal: string;
  planState: string;
  stepIndex: number;
  failureHistory: string;
}

export interface TaskExecutorOptions {
  agent: Agent;
  config: AgentXConfig;
  apiKey?: string;
  sessionId?: string;
  onSessionEvent?: (event: SessionEvent) => void;
  /** Max re-plan attempts per step before asking user (default: 3) */
  maxReplans?: number;
  /** Called when maxReplans is hit — lets the user decide how to proceed */
  onCheckpoint?: (step: TaskStep, failures: FailureRecord[]) => Promise<CheckpointAction>;
  /** Optional store for persisting task state across restarts */
  store?: { saveTaskSnapshot: (s: any) => void; getTaskSnapshot: (sessionId: string) => Record<string, unknown> | null; deleteTaskSnapshot: (sessionId: string) => void };
  /** Max idle seconds before auto-abandoning a stored task snapshot (default: no auto-abandon) */
  maxIdleSeconds?: number;
  /** Max total task duration in ms before hard abort (default: 30 min) */
  maxTaskDuration?: number;
  /** Max time per step in ms before timeout guard triggers (default: 5 min) */
  stepTimeout?: number;
}


export class TaskExecutor {
  private agent: Agent;
  private config: AgentXConfig;
  private apiKey?: string;
  private sessionId: string;
  private onSessionEvent?: (event: SessionEvent) => void;
  private maxReplans: number;
  private onCheckpoint?: (step: TaskStep, failures: FailureRecord[]) => Promise<CheckpointAction>;
  private store?: { saveTaskSnapshot: (s: any) => void; getTaskSnapshot: (sessionId: string) => Record<string, unknown> | null; deleteTaskSnapshot: (sessionId: string) => void };
  private maxIdleSeconds?: number;
  private maxTaskDuration: number;
  private stepTimeout: number;
  private conventions: string[] = [];
  private _sequence = 0;
  private _stepTimings: number[] = [];
  private _stepSuccesses = 0;
  private _stepFailures = 0;
  private _dynamicMaxReplans: number;
  private _usedFallbackModels: Set<string>;
  private _lastCommentCount = 0;
  private _originalModel: string;
  private _chunkCounter = 0;


  constructor(options: TaskExecutorOptions) {
    this.agent = options.agent;
    this.config = options.config;
    this.apiKey = options.apiKey;
    this.sessionId = options.sessionId || options.agent['sessionId'] || 'unknown';
    this.onSessionEvent = options.onSessionEvent;
    this.maxReplans = options.maxReplans ?? 3;
    this._dynamicMaxReplans = this.maxReplans;
    this.onCheckpoint = options.onCheckpoint;
    this.store = options.store;
    this.maxIdleSeconds = options.maxIdleSeconds;
    this.maxTaskDuration = options.maxTaskDuration ?? 30 * 60 * 1000;
    this.stepTimeout = options.stepTimeout ?? 5 * 60 * 1000;
    this._originalModel = this.config.provider.activeModel;
    this._usedFallbackModels = new Set<string>([this.config.provider.activeModel]);
  }

  async execute(goal: string): Promise<TaskExecutorResult> {
    getLogger().info('TASK_EXECUTOR', `Starting task execution for: "${goal.slice(0, 80)}..."`);

    const startTime = Date.now();
    const taskTimeout = setTimeout(() => {
      getLogger().error('TASK_EXECUTOR', `Task timed out after ${this.maxTaskDuration}ms — initiating hard abort`);
    }, this.maxTaskDuration);

    // Supervisor loop: retry on crash up to 3 times
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.executeInner(goal);
        clearTimeout(taskTimeout);
        this.store?.deleteTaskSnapshot(this.sessionId);
        return result;
      } catch (err: any) {
        const elapsed = Date.now() - startTime;
        if (elapsed >= this.maxTaskDuration || attempt >= maxRetries) {
          getLogger().error('TASK_EXECUTOR', `Fatal crash after ${attempt} attempt(s): ${err?.message || err}. Elapsed: ${elapsed}ms.`);
          clearTimeout(taskTimeout);
          this.store?.deleteTaskSnapshot(this.sessionId);
          const snapshot = this.forceSaveState(goal);
          if (snapshot) this.store?.deleteTaskSnapshot(this.sessionId);
          return this.makeResult(false, {
            id: 'crash', goal, steps: [], currentStepIndex: 0,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          }, `Fatal error after ${attempt} retries: ${err?.message || err}. Elapsed: ${elapsed}ms.`);
        }
        getLogger().warn('TASK_EXECUTOR', `Crash on attempt ${attempt}/${maxRetries}: ${err?.message || err}. Retrying...`);
        // Brief backoff before retry
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }

    clearTimeout(taskTimeout);
    this.store?.deleteTaskSnapshot(this.sessionId);
    return this.makeResult(false, {
      id: 'crash', goal, steps: [], currentStepIndex: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }, 'Fatal error — all retries exhausted.');
  }

  private async executeInner(goal: string): Promise<TaskExecutorResult> {
    getLogger().info('TASK_EXECUTOR', `Building execution plan for: "${goal.slice(0, 80)}..."`);

    // Check for stored task state (auto-resume after crash/restart)
    const stored = this.store?.getTaskSnapshot(this.sessionId);
    if (stored) {
      // Check idle timeout — if snapshot is older than maxIdleSeconds, abandon it
      if (this.maxIdleSeconds && stored['created_at']) {
        const ageMs = Date.now() - new Date(stored['created_at'] as string).getTime();
        if (ageMs > this.maxIdleSeconds * 1000) {
          getLogger().info('TASK_EXECUTOR', `Stored task snapshot is ${Math.round(ageMs / 1000)}s old — exceeding maxIdleSeconds ${this.maxIdleSeconds}s. Abandoning.`);
          this.store?.deleteTaskSnapshot(this.sessionId);
        } else {
          getLogger().info('TASK_EXECUTOR', 'Found stored task state — attempting auto-resume');
          const restored = this.restoreState(stored);
          if (restored) {
            getLogger().info('TASK_EXECUTOR', `Resuming task "${restored.plan.goal.slice(0, 60)}..." from step ${restored.plan.currentStepIndex + 1}/${restored.plan.steps.length}`);
            return this.executePlan(restored.plan, restored.failureHistory, goal);
          }
          getLogger().warn('TASK_EXECUTOR', 'Stored task state invalid — falling back to fresh execution');
          this.store?.deleteTaskSnapshot(this.sessionId);
        }
      } else {
        getLogger().info('TASK_EXECUTOR', 'Found stored task state — attempting auto-resume');
        const restored = this.restoreState(stored);
        if (restored) {
          getLogger().info('TASK_EXECUTOR', `Resuming task "${restored.plan.goal.slice(0, 60)}..." from step ${restored.plan.currentStepIndex + 1}/${restored.plan.steps.length}`);
          return this.executePlan(restored.plan, restored.failureHistory, goal);
        }
        getLogger().warn('TASK_EXECUTOR', 'Stored task state invalid — falling back to fresh execution');
        this.store?.deleteTaskSnapshot(this.sessionId);
      }
    }

    // Phase 0a: Environment and domain analysis — not just for developers
    const conventions = await this.analyzeProject(goal);
    this.conventions = conventions?.conventions || [];
    const domain = conventions?.projectType || 'unknown';
    getLogger().info('TASK_EXECUTOR', `Domain: ${domain}, Conventions: ${conventions?.techStack?.join(', ') || 'none detected'}`);

    // Phase 0b: Ensure required runtimes are installed (graceful if none needed)
    await this.ensureRuntimes(conventions);

    // Phase 0c: Multi-modal goal processing — detect and analyze image/screenshot references
    const visualAssets = await this.processGoalVisuals(goal);

    // Phase 1: Decompose goal into plan (with conventions context)
    let planPrompt = `Goal: ${goal}\n\nDomain context:\n- Type: ${conventions?.projectType || 'unknown'}\n`;
    if (conventions?.techStack?.length) {
      planPrompt += `- Tools/tech: ${conventions.techStack.join(', ')}\n`;
    }
    if (conventions?.conventions?.length) {
      planPrompt += `- Working directory conventions: ${conventions.conventions.join(', ')}\n`;
    }
    if (conventions?.keyFiles?.length) {
      planPrompt += `- Relevant files/directories: ${conventions.keyFiles.join(', ')}\n`;
    }
    planPrompt += `\nBreak this down into steps (JSON array).`;
    if (visualAssets) {
      planPrompt = `Goal: ${goal}\n\nVisual assets detected:\n${visualAssets}\n\nThese screenshots/diagrams are available. Analyze them during relevant steps.\n\nBreak this down into steps (JSON array).\n\nDomain context:\n- Type: ${conventions?.projectType || 'unknown'}\n- Tools/tech: ${(conventions?.techStack || []).join(', ')}\n- Conventions: ${(conventions?.conventions || []).join(', ')}\n- Relevant files: ${(conventions?.keyFiles || []).join(', ')}`;
    }
    const steps = await this.decompose(planPrompt);
    const validatedSteps = this.validatePlanSteps(steps);
    if (validatedSteps.length !== steps.length) {
      getLogger().warn('TASK_EXECUTOR', `Plan validation corrected ${steps.length - validatedSteps.length} step(s)`);
    }
    const plan: TaskPlan = {
      id: crypto.randomUUID(),
      goal,
      steps: validatedSteps,
      currentStepIndex: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.emitEvent({ type: 'plan_created', planId: plan.id, stepCount: validatedSteps.length });
    this.emitSessionEvent({ type: 'task_started', payload: { taskId: plan.id, goal, stepCount: steps.length } });
    this.emitProgress(plan, 0, 'plan_created');
    getLogger().info('TASK_EXECUTOR', `Plan created with ${steps.length} steps`);

    const failureHistory: FailureRecord[] = [];

    const result = await this.executePlan(plan, failureHistory, goal);
    this.store?.deleteTaskSnapshot(this.sessionId);
    return result;
  }

  private async executePlan(plan: TaskPlan, failureHistory: FailureRecord[], goal: string): Promise<TaskExecutorResult> {
    // Group steps into execution batches (parallel steps together)
    const batches = this.buildBatches(plan);
    const gitManager = this.agent['gitManager'] as { snapshot?: () => string | null; revert?: (hash?: string) => boolean; listSnapshots?: () => Array<{ hash: string }> } | undefined;
    const hasGit = !!gitManager?.snapshot;

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b]!;
      const isParallel = batch.length > 1 && batch.every(s => s.parallel);

      // Auto-save checkpoint before each batch (for crash recovery)
      this.persistState(plan, failureHistory);

      if (isParallel) {
        // Execute parallel batch concurrently
        const batchResult = await this.executeParallelBatch(plan, batch, failureHistory, goal, gitManager);
        if (batchResult === 'abort') return this.makeResult(false, plan, `Aborted at parallel batch ${b + 1}`);
        if (batchResult === 'return') return this.lastResult(plan);
        this.emitProgress(plan, b, 'parallel_batch_done');
        continue;
      }

      // Sequential execution
      for (const step of batch) {
        const i = plan.steps.indexOf(step);
        plan.currentStepIndex = i;
        step.status = 'in_progress';
        const rePlanAttempts = 0;

        this.emitProgress(plan, i, 'step_started');
        getLogger().info('TASK_EXECUTOR', `Executing step ${i + 1}/${plan.steps.length}: ${step.description.slice(0, 60)}`);

        const preSnapshot = gitManager?.snapshot?.() ?? null;

        // Wrap step execution with timeout guard
        const stepPromise = this.executeSequentialStep(plan, step, i, failureHistory, goal, rePlanAttempts, preSnapshot, gitManager);
        const timeoutPromise = new Promise<'timeout'>((_, reject) =>
          setTimeout(() => reject(new Error(`Step ${i + 1} timed out after ${this.stepTimeout}ms`)), this.stepTimeout)
        );
        const seqResult = await Promise.race([stepPromise, timeoutPromise]);
        if (seqResult === 'abort') return this.makeResult(false, plan, `Aborted at step ${i + 1}`);
        if (seqResult === 'return') return this.lastResult(plan);

        // Post-step phases for completed steps
        if (step.status === 'completed' as TaskStep['status']) {
          if (hasGit) await this.autoCommitStep(step);
          const newSubtasks = await this.suggestNewSubtasks(plan, step, goal);
          if (newSubtasks.length > 0) {
            plan.steps.splice(i + 1, 0, ...newSubtasks);
            getLogger().info('TASK_EXECUTOR', `Added ${newSubtasks.length} self-discovered sub-task(s) after step ${i + 1}`);
          }
          await this.checkContext(plan as TaskPlan);
          // Mid-plan re-evaluation every 3 completed steps
          const completedCount = plan.steps.filter(s => s.status === 'completed').length;
          if (completedCount > 0 && completedCount % 3 === 0) {
            await this.midPlanReevaluation(plan, goal);
          }
        }

        plan.updatedAt = new Date().toISOString();
        this.emitProgress(plan, i, 'step_done');
      }
    }

    // Save cross-session memory after task
    await this.saveTaskMemory(plan);

    // Phase 3: Final goal verification
    const goalVerified = await this.verifyGoal(goal, plan);
    const completedSteps = plan.steps.filter(s => s.status === 'completed').length;

    if (!goalVerified.achieved) {
      getLogger().warn('TASK_EXECUTOR', `Goal verification failed: ${goalVerified.reason}. Gaps: ${goalVerified.gaps?.join(', ') || 'none'}`);
      const qualityScore = this.computeQualityScore(plan, goalVerified);
      const summary = `Goal may not be fully achieved. Completed ${completedSteps}/${plan.steps.length} steps. Quality score: ${qualityScore}/100. ${goalVerified.reason}. Gaps: ${goalVerified.gaps?.join('; ') || 'none'}`;
      this.commitTaskResult(plan, false, summary);
      return this.makeResult(false, plan, summary);
    }

    // Phase 4-7: Developer-only workflows — gracefully skip if git/gh not available
    const ghAvailable = await this.hasGhAvailable();

    if (hasGit && ghAvailable) {
      // Phase 4: Auto PR/push on full success
      await this.autoPrPush(plan);

      // Phase 5: CI pipeline — wait for CI, fix if needed
      const ciPassed = await this.ciPipeline(plan);
      if (!ciPassed) {
        const summary = `Goal achieved but CI failed. ${plan.goal.slice(0, 60)}`;
        this.commitTaskResult(plan, true, summary);
        return this.makeResult(true, plan, summary);
      }

      // Phase 6: PR review loop — wait for approval, respond to comments
      const prMerged = await this.prReviewLoop(plan);
      if (prMerged) {
        // Phase 7: Deploy after PR is merged
        await this.deploy(plan);
      }
    } else if (hasGit && !ghAvailable) {
      // Git available but no gh CLI — just push
      try {
        await this.autoPrPush(plan);
      } catch {
        getLogger().info('TASK_EXECUTOR', 'gh CLI not available — skipping CI/deploy/PR pipeline');
      }
    } else {
      getLogger().info('TASK_EXECUTOR', 'Git not available — skipping developer CI/deploy/PR pipeline');
    }

    const qualityScore = this.computeQualityScore(plan, goalVerified);
    const avgStepTime = this._stepTimings.length > 0
      ? Math.round(this._stepTimings.reduce((a, b) => a + b, 0) / this._stepTimings.length / 1000)
      : 0;

    const summary = goalVerified.achieved
      ? `Goal achieved. Completed ${completedSteps}/${plan.steps.length} steps. Quality score: ${qualityScore}/100. Avg step: ${avgStepTime}s.`
      : `Goal may not be fully achieved. Completed ${completedSteps}/${plan.steps.length} steps. Quality score: ${qualityScore}/100. ${goalVerified.reason}. Gaps: ${goalVerified.gaps?.join('; ') || 'none'}`;

    this.commitTaskResult(plan, goalVerified.achieved, summary);
    return this.makeResult(goalVerified.achieved, plan, summary);
  }

  private lastResult(plan: TaskPlan): TaskExecutorResult {
    const completedSteps = plan.steps.filter(s => s.status === 'completed').length;
    const summary = `Completed ${completedSteps}/${plan.steps.length} steps.`;
    this.commitTaskResult(plan, false, summary);
    return this.makeResult(false, plan, summary);
  }

  private buildBatches(plan: TaskPlan): TaskStep[][] {
    return buildBatchesHelper(plan);
  }

  private async executeParallelBatch(
    plan: TaskPlan, batch: TaskStep[], failureHistory: FailureRecord[], goal: string,
    _gitManager: { snapshot?: () => string | null; revert?: (hash?: string) => boolean; listSnapshots?: () => Array<{ hash: string }> } | undefined,
  ): Promise<'ok' | 'abort' | 'return'> {
    getLogger().info('TASK_EXECUTOR', `Executing parallel batch with ${batch.length} steps via sub-agents`);

    // Spawn isolated sub-agents for each parallel step
    const subAgentManager = this.agent.agents;

    const spawnedTasks = batch.map((step) => {
      const i = plan.steps.indexOf(step);
      step.status = 'in_progress';
      this.emitEvent({ type: 'step_started', stepIndex: i, description: step.description });
      const stepPrompt = `Task goal: "${goal}"\n\nStep to execute: ${step.description}\nExpected outcome: ${step.expectedOutcome}\n\nExecute this step completely.`;
      const spawned = subAgentManager?.spawn(stepPrompt, [], 120_000, 5);
      return { step, idx: i, spawned };
    });

    // Wait for all sub-agents to complete
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
      })
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

      const verified = await this.verify(step, result);

      if (verified.passed) {
        step.status = 'completed';
        step.result = await this.lintStepConventions(step, result);

        this.emitEvent({ type: 'step_completed', stepIndex: i, result: (step.result || '').slice(0, 500) });
        this.emitSessionEvent({
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
      // Revert git changes for failed steps (one checkout per batch)
      const firstFailed = plan.steps.indexOf(failedSteps[0]!);
      if (firstFailed >= 0) {
        const gs = this.agent['gitManager'] as { snapshot?: () => string | null; revert?: (hash?: string) => boolean } | undefined;
        gs?.revert?.();
      }

      if (this.onCheckpoint) {
        const action = await this.onCheckpoint(failedSteps[0]!, failureHistory);
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
      const newSteps = await this.replan(goal, remaining, '', `Parallel batch failed: ${desc}`, failureHistory);
      if (newSteps.length > 0) {
        plan.steps.splice(firstFailedIdx, remaining.length, ...newSteps);
        this.persistState(plan, failureHistory);
      }
    }

    return 'ok';
  }

  private async executeSequentialStep(
    plan: TaskPlan, step: TaskStep, i: number, failureHistory: FailureRecord[], goal: string,
    rePlanAttempts: number, preSnapshot: string | null,
    gitManager: { snapshot?: () => string | null; revert?: (hash?: string) => boolean; listSnapshots?: () => Array<{ hash: string }> } | undefined,
  ): Promise<'ok' | 'abort' | 'return'> {
    const stepStart = Date.now();
    const effectiveMaxReplans = this._dynamicMaxReplans;

    while (rePlanAttempts <= effectiveMaxReplans) {
      try {
        const result = await this.executeStep(step, goal);
        const verified = await this.verify(step, result);

        if (verified.passed) {
          this._stepSuccesses++;
          this._stepTimings.push(Date.now() - stepStart);
          step.status = 'completed';
          step.result = result;

          const debugResult = await this.runDebugCycle(step, result, goal);
          if (!debugResult.passed) {
            this._stepFailures++;
            this._stepTimings.push(Date.now() - stepStart);
            this.selfTune();
            step.status = 'failed';
            step.error = debugResult.error || 'Build/test failed';
            step.result = debugResult.lastOutput;
            rePlanAttempts++;

            failureHistory.push({ stepIndex: i, description: step.description, failureReason: debugResult.error || 'Build/test failed', attemptNumber: rePlanAttempts });
            getLogger().warn('TASK_EXECUTOR', `Step ${i + 1} passed verification but build/test failed (attempt ${rePlanAttempts}): ${debugResult.error}`);

            if (rePlanAttempts > effectiveMaxReplans) {
              const action = await this.onCheckpoint?.(step, failureHistory);
              if (action === 'abort') return 'abort';
              if (action === 'skip_step') { step.status = 'completed'; step.result = '(skipped by user after build failure)'; return 'ok'; }
              if (action === 'continue') { rePlanAttempts = 0; continue; }
              this.commitTaskResult(plan, false, `Build/test failed after ${rePlanAttempts} attempts at step ${i + 1}`);
              return 'return';
            }

            const remaining = plan.steps.slice(i);
            const newSteps = await this.replan(goal, remaining, debugResult.lastOutput, debugResult.error || '', failureHistory);
            if (newSteps.length > 0) { plan.steps.splice(i, remaining.length, ...newSteps); i--; this.persistState(plan, failureHistory); }
            return 'ok';
          }

          // Convention enforcement linting
          const lintedResult = await this.lintStepConventions(step, result);
          step.result = lintedResult;

          // Hallucination guardrail: cross-reference factual claims
          const factCheck = await this.verifyFacts(step, lintedResult);
          if (!factCheck.passed) {
            getLogger().warn('TASK_EXECUTOR', `Fact check warnings for step ${i + 1}: ${factCheck.warnings.join('; ')}`);
          }

          this.emitEvent({ type: 'step_completed', stepIndex: i, result: lintedResult.slice(0, 500) });
          this.emitSessionEvent({ type: 'task_step_completed', payload: { taskId: plan.id, stepIndex: i, totalSteps: plan.steps.length, description: step.description, status: 'completed' } });
          getLogger().info('TASK_EXECUTOR', `Step ${i + 1} completed successfully`);
          this.persistState(plan, failureHistory);
          return 'ok';
        }

        if (preSnapshot) gitManager?.revert?.(preSnapshot);
        this._stepFailures++;
        this._stepTimings.push(Date.now() - stepStart);
        // Self-tuning: adjust dynamic limits based on failure rate
        this.selfTune();

        step.status = 'failed';
        step.error = verified.reason;
        step.result = result;
        rePlanAttempts++;

        failureHistory.push({ stepIndex: i, description: step.description, failureReason: verified.reason, attemptNumber: rePlanAttempts });
        this.emitEvent({ type: 'step_failed', stepIndex: i, reason: verified.reason, attempt: rePlanAttempts, maxAttempts: effectiveMaxReplans + 1 });
        getLogger().warn('TASK_EXECUTOR', `Step ${i + 1} failed (attempt ${rePlanAttempts}/${effectiveMaxReplans + 1}): ${verified.reason}`);

        if (rePlanAttempts > effectiveMaxReplans) {
          const action = await this.onCheckpoint?.(step, failureHistory);
          if (action === 'abort') return 'abort';
          if (action === 'skip_step') { step.status = 'completed'; step.result = '(skipped by user)'; return 'ok'; }
          if (action === 'continue') { rePlanAttempts = 0; continue; }
          // Before giving up, try alternative approach
          const altApproach = await this.generateAlternativeApproach(step, verified.reason, result, goal);
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
          this.commitTaskResult(plan, false, `Failed after ${rePlanAttempts} attempts at step ${i + 1}`);
          return 'return';
        }

        const remaining = plan.steps.slice(i);
        const newSteps = await this.replan(goal, remaining, result, verified.reason, failureHistory);
        if (newSteps.length > 0) {
          plan.steps.splice(i, remaining.length, ...newSteps);
          getLogger().info('TASK_EXECUTOR', `Re-planned: ${remaining.length} steps → ${newSteps.length} steps (attempt ${rePlanAttempts})`);
          i--; this.persistState(plan, failureHistory);
        }
        return 'ok';
      } catch (error) {
        this._stepFailures++;
        this._stepTimings.push(Date.now() - stepStart);
        this.selfTune();
        step.status = 'failed';
        step.error = error instanceof Error ? error.message : String(error);
        getLogger().error('TASK_EXECUTOR', `Step ${i + 1} threw: ${step.error}`);

        // Try model failover if the error is provider-related
        const providerErrorPatterns = /401|Unauthorized|403|429|quota|billing|timeout|ETIMEDOUT|ECONNRESET|5\d{2}|overloaded|rate.limit/i;
        if (providerErrorPatterns.test(step.error)) {
          const switched = await this.tryModelFailover();
          if (switched) {
            getLogger().info('TASK_EXECUTOR', `Failover to ${this.config.provider.activeModel}, retrying step ${i + 1}`);
            rePlanAttempts = 0; // Reset attempts with new model
            continue; // Retry with fallback model
          }
        }

        this.commitTaskResult(plan, false, `Failed at step ${i + 1}: ${step.error}`);
        return 'return';
      }
    }
    return 'ok';
  }

  private persistState(plan: TaskPlan, failureHistory: FailureRecord[]): void {
    persistStateHelper(this._analysisContext(), plan, failureHistory);
  }

  private restoreState(stored: Record<string, unknown>): { plan: TaskPlan; failureHistory: FailureRecord[] } | null {
    return restoreStateHelper(stored);
  }

  private async analyzeProject(goal: string): Promise<{ projectType: string; techStack: string[]; conventions: string[]; keyFiles: string[]; risks: string[] } | null> {
    return analyzeProjectHelper(this._analysisContext(), goal);
  }

  private async ensureRuntimes(conventions: { techStack: string[]; projectType: string } | null): Promise<void> {
    return ensureRuntimesHelper(this._analysisContext(), conventions);
  }

  private selfTune(): void {
    selfTuneHelper(this._analysisContext(), this.maxReplans);
    this._dynamicMaxReplans = this._analysisContext().dynamicMaxReplans;
  }

  private async autoCommitStep(_step: TaskStep): Promise<void> {
    const gitManager = this.agent['gitManager'] as { commitAfterEdit?: (path: string, sessionId?: string) => boolean; commitSessionExport?: (sessionId: string, messages: unknown[], msg: string) => boolean } | undefined;
    if (!gitManager?.commitAfterEdit) return;
    try {
      gitManager.commitAfterEdit('.', this.sessionId);
    } catch {
      // Best-effort
    }
  }

  private async suggestNewSubtasks(plan: TaskPlan, step: TaskStep, goal: string): Promise<TaskStep[]> {
    return suggestNewSubtasksHelper(this._analysisContext(), plan, step, goal);
  }

  private async checkContext(plan: TaskPlan): Promise<void> {
    return checkContextHelper(this._analysisContext(), plan);
  }

  private async saveTaskMemory(plan: TaskPlan): Promise<void> {
    return saveTaskMemoryHelper(this._analysisContext(), plan);
  }

  private computeQualityScore(plan: TaskPlan, verification: { achieved: boolean; reason: string; gaps?: string[] }): number {
    return computeQualityScoreHelper(this._analysisContext(), plan, verification);
  }

  private async ensureDependencies(): Promise<void> {
    return ensureDependenciesHelper(this._analysisContext());
  }

  private async checkRegressions(
    commands: Array<{ cmd: string; timeout: number }>,
    gitManager?: { snapshot?: () => string | null; revert?: (hash?: string) => boolean; listSnapshots?: () => Array<{ hash: string }> },
  ): Promise<string | null> {
    const fullTestCommands = commands.filter(c =>
      /test|spec|check/i.test(c.cmd) && !/build/i.test(c.cmd)
    );
    if (fullTestCommands.length === 0) return null;

    for (const tc of fullTestCommands) {
      const output = await tryShellExec(this.agent, tc.cmd);
      if (output.toLowerCase().includes('error') || output.toLowerCase().includes('fail') || output.toLowerCase().includes('not ok')) {
        getLogger().warn('TASK_EXECUTOR', `Regression detected in: ${tc.cmd}`);
        // Auto-rollback: revert each completed step snapshot in reverse order until regression clears
        if (gitManager?.listSnapshots) {
          const snapshots = gitManager.listSnapshots();
          for (let s = snapshots.length - 1; s >= 0; s--) {
            getLogger().info('TASK_EXECUTOR', `Rolling back snapshot ${s}: ${snapshots[s]!.hash.slice(0, 12)}`);
            if (gitManager.revert?.(snapshots[s]!.hash)) {
              // Check if regression is resolved
              const retryOutput = await tryShellExec(this.agent, tc.cmd);
              if (!retryOutput.toLowerCase().includes('error') && !retryOutput.toLowerCase().includes('fail') && !retryOutput.toLowerCase().includes('not ok')) {
                return `Regression resolved by rolling back snapshot ${s}`;
              }
            }
          }
        }
        return `REGRESSION: ${tc.cmd} failed — ${output.slice(0, 200)}`;
      }
    }
    return `All regression checks passed`;
  }

  private async lintStepConventions(step: TaskStep, result: string): Promise<string> {
    return verifyDebug.lintStepConventions(this._verifyDebugContext(), step, result);
  }

  private async runDebugCycle(step: TaskStep, result: string, goal: string): Promise<{ passed: boolean; error?: string; lastOutput: string; fixCount: number }> {
    return verifyDebug.runDebugCycle(this._verifyDebugContext(), step, result, goal);
  }

  private _verifyDebugContext(): VerifyDebugContext {
    return {
      agent: this.agent,
      config: this.config,
      apiKey: this.apiKey,
      conventions: this.conventions,
      ensureDependencies: () => this.ensureDependencies(),
      checkRegressions: (commands, gitManager) => this.checkRegressions(commands, gitManager),
    };
  }

  private _analysisContext(): AnalysisContext {
    return {
      agent: this.agent,
      config: this.config,
      apiKey: this.apiKey,
      sessionId: this.sessionId,
      stepSuccesses: this._stepSuccesses,
      stepFailures: this._stepFailures,
      dynamicMaxReplans: this._dynamicMaxReplans,
      originalModel: this._originalModel,
      usedFallbackModels: this._usedFallbackModels,
      chunkCounter: this._chunkCounter,
      store: this.store,
      persistState: (plan, failureHistory) => this.persistState(plan, failureHistory as FailureRecord[]),
      emitEvent: (event) => this.emitEvent(event),
      emitSessionEvent: (event) => this.emitSessionEvent(event),
    };
  }

  private _planningContext(): PlanningContext {
    return { agent: this.agent, config: this.config, apiKey: this.apiKey };
  }

  private _verifyContext(): VerifyContext {
    return { agent: this.agent, config: this.config, apiKey: this.apiKey };
  }

  private async decompose(prompt: string): Promise<TaskStep[]> {
    return decomposeHelper(this._planningContext(), prompt);
  }

  private validatePlanSteps(steps: TaskStep[]): TaskStep[] {
    return validatePlanStepsHelper(steps);
  }

  private async midPlanReevaluation(plan: TaskPlan, goal: string): Promise<void> {
    return midPlanReevaluationHelper(this._planningContext(), plan, goal);
  }

  private async generateAlternativeApproach(step: TaskStep, failureReason: string, lastResult: string, goal: string): Promise<string> {
    return generateAlternativeApproachHelper(this._planningContext(), step, failureReason, lastResult, goal);
  }

  private async executeStep(step: TaskStep, goal: string): Promise<string> {
    let stepPrompt = `Continuing the task: "${goal}"\n\nCurrent step: ${step.description}\nExpected outcome: ${step.expectedOutcome}\n\nExecute this step now.`;
    // Cross-repo: if step targets a specific repo, prepend context
    if (step.repoPath) {
      const repoContext = await tryShellExec(this.agent,
        `ls "${step.repoPath}/" 2>/dev/null && echo "--- repo exists ---" || echo "--- cloning ---" && git clone "$(git remote get-url origin 2>/dev/null)" "${step.repoPath}" 2>/dev/null && echo "--- done ---" || echo "--- using existing ---"`
      );
      stepPrompt = `Working in repo: ${step.repoPath}\n${repoContext.slice(0, 500)}\n\n${stepPrompt}\n\nEnsure all file operations use the absolute path "${step.repoPath}".`;
    }
    const message = await this.agent.sendMessage(stepPrompt);
    return message.content;
  }

  private async verify(step: TaskStep, result: string): Promise<{ passed: boolean; reason: string }> {
    return verifyStepHelper(this._verifyContext(), step, result);
  }

  private async verifyGoal(goal: string, plan: TaskPlan): Promise<{ achieved: boolean; reason: string; gaps?: string[] }> {
    return verifyGoalHelper(this._verifyContext(), goal, plan);
  }

  /**
   * Hallucination guardrail: cross-reference factual claims in step output
   * against tool execution results. Detects fabricated content.
   */
  private async verifyFacts(step: TaskStep, result: string): Promise<{ passed: boolean; warnings: string[] }> {
    return verifyFactsHelper(this._verifyContext(), step, result);
  }

  private async replan(
    goal: string,
    failedSteps: TaskStep[],
    lastResult: string,
    failureReason: string,
    failureHistory: FailureRecord[],
  ): Promise<TaskStep[]> {
    return replanHelper(this._planningContext(), goal, failedSteps, lastResult, failureReason, failureHistory);
  }

  private async autoPrPush(plan: TaskPlan): Promise<void> {
    return gitPipeline.autoPrPush(this._gitPipelineContext(), plan);
  }

  private commitTaskResult(plan: TaskPlan, success: boolean, summary: string): void {
    gitPipeline.commitTaskResult(this._gitPipelineContext(), plan, success, summary);
  }

  private makeResult(success: boolean, plan: TaskPlan, summary: string): TaskExecutorResult {
    return { success, plan, summary, goalVerified: success };
  }

  private emitEvent(event: Record<string, unknown>): void {
    this.agent.emit({ type: 'task_event', ...event });
  }

  /**
   * CI pipeline: push, watch CI, auto-fix failures, re-push until green or timeout.
   */
  private async ciPipeline(plan: TaskPlan): Promise<boolean> {
    return gitPipeline.ciPipeline(this._gitPipelineContext(), plan);
  }

  /**
   * PR review loop: watch PR comments, respond to each, fix issues, push,
   * then merge when approved. Runs a maximum of 10 review cycles.
   */
  private async prReviewLoop(plan: TaskPlan): Promise<boolean> {
    return gitPipeline.prReviewLoop(this._gitPipelineContext(), plan);
  }

  /**
   * Deploy after PR merge. Supports: gh workflow run, vercel, railway, docker.
   */
  private async deploy(_plan: TaskPlan): Promise<boolean> {
    return gitPipeline.deploy(this._gitPipelineContext(), _plan);
  }

  private _gitPipelineContext(): GitPipelineContext {
    const ctx: GitPipelineContext = {
      agent: this.agent,
      sessionId: this.sessionId,
      config: this.config,
      apiKey: this.apiKey,
      store: this.store,
      lastCommentCount: this._lastCommentCount,
      emitSessionEvent: (event) => this.emitSessionEvent(event),
      safeJsonParse: (text) => this.safeJsonParse(text),
    };
    Object.defineProperty(ctx, 'lastCommentCount', {
      get: () => this._lastCommentCount,
      set: (v: number) => { this._lastCommentCount = v; },
      enumerable: true,
      configurable: true,
    });
    return ctx;
  }

  /**
   * Try to switch to a fallback model if the primary model fails.
   * Uses a prioritized chain: fastest/cheapest first, most capable last.
   */
  private async tryModelFailover(): Promise<boolean> {
    return tryModelFailoverHelper(this._analysisContext());
  }

  /**
   * Safe JSON parse that returns null on failure.
   */
  private safeJsonParse(text: string): Record<string, unknown> | null {
    return safeJsonParseHelper(text);
  }

  private emitSessionEvent(event: Omit<SessionEvent, 'sessionId' | 'sequence' | 'timestamp'>): void {
    const seq = ++this._sequence;
    const fullEvent = { ...event, sessionId: this.sessionId, sequence: seq, timestamp: Date.now() } as SessionEvent;
    this.onSessionEvent?.(fullEvent);
  }

  /**
   * Detect and analyze image/screenshot/visual assets referenced in the goal.
   * Returns a description string to inject into planning context, or null.
   */
  private async processGoalVisuals(goal: string): Promise<string | null> {
    return processGoalVisualsHelper(this._analysisContext(), goal);
  }

  private emitProgress(plan: TaskPlan, stepIndex: number, phase: string): void {
    emitProgressHelper(this._analysisContext(), plan, stepIndex, phase);
  }

  /**
   * Check if gh CLI is available. Returns false if not installed.
   */
  private async hasGhAvailable(): Promise<boolean> {
    return hasGhAvailableHelper(this._analysisContext());
  }

  /**
   * Hard restart: force-save current state so we can retry from scratch if the supervisor catches a fatal crash.
   */
  private forceSaveState(goal: string): boolean {
    return forceSaveStateHelper(this._analysisContext(), goal);
  }

}
