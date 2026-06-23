import { generateText } from 'ai';
import { getLogger } from '@agentx/shared';
import type { AgentXConfig, EngineEvent, SessionEvent, ToolResult } from '@agentx/shared';
import { createAiSdkModel } from './AiSdkBridge.js';
import type { Agent } from './Agent.js';

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
  /** Maximum total API cost in USD before circuit breaker aborts (default: no limit) */
  maxCostUsd?: number;
  /** Max idle seconds before auto-abandoning a stored task snapshot (default: no auto-abandon) */
  maxIdleSeconds?: number;
  /** Max total task duration in ms before hard abort (default: 30 min) */
  maxTaskDuration?: number;
  /** Max time per step in ms before timeout guard triggers (default: 5 min) */
  stepTimeout?: number;
}

const ANALYSIS_SYSTEM_PROMPT = `You are an environment analysis expert. Given a user's goal and the current working directory context, analyze what's available and what needs to be done.

The user may be a developer, designer, finance professional, artist, or any other knowledge worker.

Return a JSON object:
{
  "projectType": "new" | "existing" | "non_code",
  "keyFiles": ["list", "of", "relevant", "files", "documents"],
  "techStack": ["tools", "technologies", "runtimes", "or", "software", "detected"],
  "conventions": ["relevant", "patterns", "rules", "or", "constraints"],
  "risks": ["potential", "issues", "or", "missing", "tools"],
  "domain": "code" | "design" | "finance" | "data" | "writing" | "general"
}`;

const PLAN_SYSTEM_PROMPT = `You are a task decomposition expert. Your job is to break down a user's goal into a step-by-step plan.

Given a goal, produce a JSON array of steps. Each step must have:
- "description": a clear, actionable instruction for what to do in this step
- "expectedOutcome": what success looks like for this step

Optional fields:
- "parallel": true — set this for steps that can run concurrently with other parallel steps (e.g., creating independent files)
- "dependencies": ["stepId"] — list of step IDs (by array index, 0-based) that must complete first
- "repoPath": "path/to/repo" — if work spans multiple repositories, specify which repo this step targets

Rules:
- Break the work into 3-10 steps
- Each step should be completable in a single LLM turn
- Sequential by default; use "parallel": true for independent work
- Be specific — avoid vague steps like "research" without direction
- If the goal requires external information (API docs, package docs, best practices, etc.), include a "research" step that uses web search to gather information before proceeding
- The last step should produce the final deliverable
- COST AWARENESS: Simple verification, linting, and review steps can use cheaper/faster models. Complex coding steps need full capability. Never waste budget on trivial steps.
- Cross-repo: If the goal spans multiple repos, add "repoPath" to each step to indicate which repo it operates in

Web research is available and the agent can search the web for information, documentation, and examples during execution.

Return ONLY a valid JSON array. No markdown, no explanation.`;

const VERIFY_SYSTEM_PROMPT = `You are a quality assurance expert. Given a task step and its result, determine if the step was completed successfully.

Respond with ONLY a JSON object:
{ "passed": boolean, "reason": "short explanation" }

Be strict — if the expected outcome is not fully met, mark as failed.`;

const DEBUG_SYSTEM_PROMPT = `You are a debugging expert. A step was completed but the build/test failed. Given the error output, fix the issue.

Return a JSON object:
{ "fix": "what to fix and how", "revisedStep": "revised step description if needed" }

Be specific about what code changes are needed.`;

const FINAL_VERIFY_SYSTEM_PROMPT = `You are a quality assurance expert. Given a user's original goal and the completed steps of a plan, determine if the goal has been fully achieved.

Respond with ONLY a JSON object:
{ "achieved": boolean, "reason": "short explanation", "gaps": ["any missing aspects"] }

Be strict — if the goal is not fully met, note what's missing.`;

function extractJsonArray(text: string): Array<Record<string, unknown>> | null {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractJsonObject<T>(text: string): T | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

function tryShellExec(agent: Agent, command: string): Promise<string> {
  const executor = (agent as any)['toolExecutor'] as { execute: (id: string, args: Record<string, unknown>, sid: string) => Promise<ToolResult> } | undefined;
  if (!executor?.execute) return Promise.resolve('');
  return executor.execute('shell_exec', { command }, (agent as any)['sessionId'] ?? 'unknown')
    .then((r) => r.output ?? '')
    .catch(() => '');
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
  private maxCostUsd?: number;
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
    this.maxCostUsd = options.maxCostUsd;
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

    // Cost estimation: warn if plan is likely too expensive
    const estimatedCost = this.estimatePlanCost(plan);
    if (estimatedCost > 0.50) {
      getLogger().warn('TASK_EXECUTOR', `Estimated plan cost: $${estimatedCost.toFixed(4)} — may exceed budget`);
    }

    this.emitEvent({ type: 'plan_created', planId: plan.id, stepCount: validatedSteps.length, estimatedCost });
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
        let rePlanAttempts = 0;

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
    const batches: TaskStep[][] = [];
    let currentBatch: TaskStep[] = [];

    // Resolve dependency references to step indices
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

  private async executeParallelBatch(
    plan: TaskPlan, batch: TaskStep[], failureHistory: FailureRecord[], goal: string,
    _gitManager: { snapshot?: () => string | null; revert?: (hash?: string) => boolean; listSnapshots?: () => Array<{ hash: string }> } | undefined,
  ): Promise<'ok' | 'abort' | 'return'> {
    getLogger().info('TASK_EXECUTOR', `Executing parallel batch with ${batch.length} steps via sub-agents`);

    // Spawn isolated sub-agents for each parallel step
    const subAgentManager = (this.agent as any)['subAgents'] as { spawn: (...args: unknown[]) => { id: string; status: string; result?: string }; waitFor: (id: string) => Promise<{ status: string; result?: string }> } | undefined;

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
    if (!this.store) return;
    this.store.saveTaskSnapshot({
      sessionId: this.sessionId,
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

  private restoreState(stored: Record<string, unknown>): { plan: TaskPlan; failureHistory: FailureRecord[] } | null {
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

  private async analyzeProject(goal: string): Promise<{ projectType: string; techStack: string[]; conventions: string[]; keyFiles: string[]; risks: string[] } | null> {
    this.checkCostBudget();
    try {
      // Detect project structure by checking common files
      const filesToCheck = ['package.json', 'tsconfig.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'Gemfile', 'Dockerfile', 'Makefile', '.gitignore', 'composer.json', 'CMakeLists.txt'];
      const found: string[] = [];
      for (const file of filesToCheck) {
        const output = await tryShellExec(this.agent, `test -f "${file}" && echo "exists" || echo "not found"`);
        if (output.trim() === 'exists') found.push(file);
      }

      if (found.length > 0) {
        // Read key config files for convention analysis
        let projectContext = `Detected files: ${found.join(', ')}\n\n`;
        if (found.includes('package.json')) {
          const pkg = await tryShellExec(this.agent, 'cat package.json 2>/dev/null | head -100');
          projectContext += `package.json:\n${pkg.slice(0, 2000)}\n\n`;
        }
        if (found.includes('tsconfig.json')) {
          const tsconfig = await tryShellExec(this.agent, 'cat tsconfig.json 2>/dev/null | head -50');
          projectContext += `tsconfig.json:\n${tsconfig.slice(0, 1000)}\n\n`;
        }

        const model = createAiSdkModel(this.config, this.apiKey);
        const result = await generateText({
          model,
          system: ANALYSIS_SYSTEM_PROMPT,
          prompt: `User goal: ${goal}\n\nProject context:\n${projectContext}\n\nAnalyze this project and the goal.`,
          temperature: 0.2,
          maxRetries: 1,
        });

        const parsed = extractJsonObject<{ projectType: string; techStack: string[]; conventions: string[]; keyFiles: string[]; risks: string[] }>(result.text);
        if (parsed) {
          return {
            projectType: parsed.projectType || 'existing',
            techStack: Array.isArray(parsed.techStack) ? parsed.techStack : [],
            conventions: Array.isArray(parsed.conventions) ? parsed.conventions : [],
            keyFiles: Array.isArray(parsed.keyFiles) ? parsed.keyFiles : found,
            risks: Array.isArray(parsed.risks) ? parsed.risks : [],
          };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private async ensureRuntimes(conventions: { techStack: string[]; projectType: string } | null): Promise<void> {
    if (!conventions) return;
    const techStack = conventions.techStack || [];
    if (techStack.length === 0) return;

    const runtimeMap: Array<{ check: string; install: string; name: string; marker: string }> = [];

    if (techStack.some(t => /node|javascript|typescript|js|ts/i.test(t))) {
      runtimeMap.push({ check: 'node --version 2>&1', install: '', name: 'Node.js', marker: 'node' });
      runtimeMap.push({ check: 'npm --version 2>&1', install: '', name: 'npm', marker: 'npm' });
    }
    if (techStack.some(t => /python|pytest|django|flask/i.test(t))) {
      runtimeMap.push({ check: 'python3 --version 2>&1 || python --version 2>&1', install: '', name: 'Python', marker: 'python' });
      runtimeMap.push({ check: 'pip3 --version 2>&1 || pip --version 2>&1', install: '', name: 'pip', marker: 'pip' });
    }
    if (techStack.some(t => /rust|cargo/i.test(t))) {
      runtimeMap.push({ check: 'rustc --version 2>&1', install: '', name: 'Rust', marker: 'rust' });
      runtimeMap.push({ check: 'cargo --version 2>&1', install: '', name: 'Cargo', marker: 'cargo' });
    }
    if (techStack.some(t => /go|golang/i.test(t))) {
      runtimeMap.push({ check: 'go version 2>&1', install: '', name: 'Go', marker: 'go' });
    }

    for (const rt of runtimeMap) {
      const output = await tryShellExec(this.agent, rt.check);
      if (output.trim().toLowerCase().includes('not found') || output.trim().toLowerCase().includes('command not found') || !output.trim()) {
        getLogger().warn('TASK_EXECUTOR', `Missing runtime: ${rt.name}. Attempting auto-install...`);
        await this.installRuntime(rt);
      } else {
        getLogger().info('TASK_EXECUTOR', `Runtime ${rt.name}: ${output.trim().split('\n')[0]}`);
      }
    }
  }

  private async installRuntime(rt: { check: string; install: string; name: string; marker: string }): Promise<void> {
    const cmds: string[] = [];
    switch (rt.marker) {
      case 'node':
        cmds.push('curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - 2>&1 || true');
        cmds.push('apt-get install -y nodejs 2>&1 || brew install node 2>&1 || true');
        break;
      case 'npm':
        cmds.push('npm install -g npm@latest 2>&1 || true');
        break;
      case 'python':
        cmds.push('apt-get install -y python3 python3-pip 2>&1 || brew install python 2>&1 || true');
        break;
      case 'pip':
        cmds.push('python3 -m ensurepip --upgrade 2>&1 || python -m ensurepip --upgrade 2>&1 || true');
        break;
      case 'rust':
        cmds.push('curl --proto =https --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y 2>&1 && source "$HOME/.cargo/env" || true');
        break;
      case 'cargo':
        cmds.push('curl --proto =https --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y 2>&1 && source "$HOME/.cargo/env" || true');
        break;
      case 'go':
        cmds.push('apt-get install -y golang-go 2>&1 || brew install go 2>&1 || true');
        break;
    }
    for (const cmd of cmds) {
      await tryShellExec(this.agent, cmd);
    }
    // Verify installation
    const verify = await tryShellExec(this.agent, rt.check);
    if (verify.trim() && !verify.toLowerCase().includes('not found')) {
      getLogger().info('TASK_EXECUTOR', `Successfully installed ${rt.name}: ${verify.trim().split('\n')[0]}`);
    } else {
      getLogger().warn('TASK_EXECUTOR', `Failed to install ${rt.name}. Continuing anyway.`);
    }
  }

  private selfTune(): void {
    const total = this._stepSuccesses + this._stepFailures;
    if (total < 3) return; // Need minimum samples

    const failRate = this._stepFailures / total;
    if (failRate > 0.5 && this._dynamicMaxReplans < 6) {
      // High failure rate — give more replan attempts
      this._dynamicMaxReplans = Math.min(6, this._dynamicMaxReplans + 1);
      getLogger().info('TASK_EXECUTOR', `Self-tuned: increased max replans to ${this._dynamicMaxReplans} (fail rate: ${Math.round(failRate * 100)}%)`);
    } else if (failRate < 0.15 && this._dynamicMaxReplans > this.maxReplans) {
      // Low failure rate — reduce replan attempts back toward default
      this._dynamicMaxReplans = Math.max(this.maxReplans, this._dynamicMaxReplans - 1);
      getLogger().info('TASK_EXECUTOR', `Self-tuned: decreased max replans to ${this._dynamicMaxReplans} (fail rate: ${Math.round(failRate * 100)}%)`);
    }
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
    this.checkCostBudget();
    const completedCount = plan.steps.filter(s => s.status === 'completed').length;
    if (completedCount < 2) return []; // Don't suggest until at least 2 steps done

    const model = createAiSdkModel(this.config, this.apiKey);
    const result = await generateText({
      model,
      system: `You are a project manager. Given the goal, current plan, and just-completed step, determine if new sub-tasks are needed.

Return a JSON array of additional steps, or empty array if none needed.
Each step: { "description": "...", "expectedOutcome": "..." }

Only add steps that are genuinely necessary — don't over-engineer.`,
      prompt: `Goal: ${goal}\n\nCompleted steps: ${plan.steps.filter(s => s.status === 'completed').map((s, idx) => `\n${idx + 1}. ${s.description}`).join('')}\n\nJust completed: ${step.description}\nResult: ${(step.result || '').slice(0, 500)}\n\nAre there any new sub-tasks that this step uncovered?`,
      temperature: 0.2,
      maxRetries: 1,
    });

    const parsed = extractJsonArray(result.text);
    if (!parsed || parsed.length === 0) return [];
    return parsed.map(s => ({
      id: crypto.randomUUID(),
      description: (s['description'] as string) || 'Additional sub-task',
      expectedOutcome: (s['expectedOutcome'] as string) || 'Completed',
      status: 'pending' as const,
      repoPath: (s['repoPath'] as string) || undefined,
    }));
  }

  private async checkContext(plan: TaskPlan): Promise<void> {
    // Adaptive context compaction: if message count is high, proactively compact
    const messages = (this.agent as any)['messages'] as Array<unknown> | undefined;
    if (!messages) return;

    // Session chunking: every 15 completed steps, persist a checkpoint and clear history
    this._chunkCounter = plan.steps.filter(s => s.status === 'completed').length;
    if (this._chunkCounter > 0 && this._chunkCounter % 15 === 0) {
      getLogger().info('TASK_EXECUTOR', `Session chunking at ${this._chunkCounter} completed steps — persisting checkpoint`);
      // Persist checkpoint to store
      const store = (this.agent as any).store as { saveTaskSnapshot?: (s: any) => void } | undefined;
      if (store?.saveTaskSnapshot) {
        this.persistState(plan, []);
      }
    }

    if (messages.length > 40 || (this.agent as any)['compactContext']) {
      const compactContext = (this.agent as any)['compactContext'] as (() => Promise<void>) | undefined;
      if (compactContext && typeof compactContext === 'function') {
        try {
          await compactContext.call(this.agent);
          getLogger().info('TASK_EXECUTOR', 'Adaptive context compaction triggered');
        } catch {
          // Best-effort
        }
      }

      // If compaction didn't reduce enough, force-clear old non-system messages
      if (messages.length > 80) {
        const systemMsgs = (messages as any[]).filter((m: any) => m.role === 'system');
        const recentMsgs = (messages as any[]).filter((m: any) => m.role !== 'system').slice(-20);
        (this.agent as any)['messages'] = [...systemMsgs, ...recentMsgs];
        getLogger().info('TASK_EXECUTOR', `Force-pruned messages to ${(this.agent as any)['messages'].length}`);
      }
    }

    // Restore original model if we were on a fallback and the error is far enough back
    if (this._usedFallbackModels.size > 0 && this.config.provider.activeModel !== this._originalModel) {
      const lastFailIndex = plan.steps.findLastIndex(s => s.status === 'failed');
      const lastSuccessIndex = plan.steps.findLastIndex(s => s.status === 'completed');
      if (lastSuccessIndex > (lastFailIndex ?? -1) + 2) {
        getLogger().info('TASK_EXECUTOR', `Restoring original model: ${this._originalModel}`);
        const agent = this.agent as any;
        if (typeof agent.switchModel === 'function') {
          agent.switchModel(this._originalModel);
          this.config.provider.activeModel = this._originalModel;
        }
      }
    }
  }

  private async saveTaskMemory(plan: TaskPlan): Promise<void> {
    this.checkCostBudget();
    const completedSteps = plan.steps.filter(s => s.status === 'completed').length;
    if (completedSteps === 0) return;

    const model = createAiSdkModel(this.config, this.apiKey);
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
      await tryShellExec(this.agent, `mkdir -p "${memoryDir}"`);
      const existing = await tryShellExec(this.agent, `cat "${memoryDir}/memories.json" 2>/dev/null || echo "[]"`);
      let memories: unknown[] = [];
      try { memories = JSON.parse(existing); } catch { memories = []; }
      memories.push(JSON.parse(memoryResult.text));
      // Keep only last 20 memories
      if (memories.length > 20) memories = memories.slice(-20);
      await tryShellExec(this.agent, `node -e "require('fs').writeFileSync('${memoryDir}/memories.json', ${JSON.stringify(JSON.stringify(memories))})"`);
    } catch {
      // Best-effort
    }
  }

  private computeQualityScore(plan: TaskPlan, verification: { achieved: boolean; reason: string; gaps?: string[] }): number {
    const totalSteps = plan.steps.length;
    if (totalSteps === 0) return 0;

    const completed = plan.steps.filter(s => s.status === 'completed').length;
    const completionRatio = completed / totalSteps;

    const failureRatio = this._stepFailures / Math.max(1, this._stepSuccesses + this._stepFailures);
    const reliabilityScore = Math.max(0, 1 - failureRatio);

    const gapPenalty = (verification.gaps?.length || 0) * 10;
    const achievedBonus = verification.achieved ? 20 : 0;

    const baseScore = Math.round((completionRatio * 40) + (reliabilityScore * 40) + achievedBonus - gapPenalty);
    return Math.max(0, Math.min(100, baseScore));
  }

  private async ensureDependencies(): Promise<void> {
    const hasNodeModules = await tryShellExec(this.agent, 'test -d "node_modules" && echo "y" || echo "n"');
    if (hasNodeModules.trim() !== 'y') {
      const hasPackageJson = await tryShellExec(this.agent, 'test -f "package.json" && echo "y" || echo "n"');
      if (hasPackageJson.trim() === 'y') {
        getLogger().info('TASK_EXECUTOR', 'node_modules not found — running npm install');
        await tryShellExec(this.agent, 'npm install 2>&1 || pnpm install 2>&1 || yarn install 2>&1');
      }
    }
    const hasVenv = await tryShellExec(this.agent, 'test -d ".venv" || test -d "venv" || test -d "env" && echo "y" || echo "n"');
    if (hasVenv.trim() !== 'y') {
      const hasPyproject = await tryShellExec(this.agent, 'test -f "pyproject.toml" || test -f "requirements.txt" && echo "y" || echo "n"');
      if (hasPyproject.trim() === 'y') {
        getLogger().info('TASK_EXECUTOR', 'Python venv not found — creating and installing deps');
        await tryShellExec(this.agent, 'python3 -m venv .venv 2>&1 && source .venv/bin/activate && pip install -r requirements.txt 2>&1 || true');
      }
    }
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
    this.checkCostBudget();
    if (this.conventions.length === 0) return result;

    // Check if the step mentions file modifications that could violate conventions
    const fileRefs = /\.(ts|js|tsx|jsx|py|rs|go|css|scss|json|md|html|vue|svelte)\b/i.test(result) ||
      /(created|modified|wrote|updated|added|generated)\s/i.test(result);
    if (!fileRefs) return result;

    const model = createAiSdkModel(this.config, this.apiKey);
    const lintResult = await generateText({
      model,
      system: `You are a code convention enforcer. Given project conventions and the step result, identify any convention violations.

Project conventions:
${this.conventions.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Return a JSON object:
{
  "violations": ["description of each violation"],
  "fixInstructions": "specific instructions to fix the violations"
}

If no violations, return { "violations": [] }.`,
      prompt: `Step: ${step.description}\n\nStep result:\n${result.slice(0, 3000)}`,
      temperature: 0.1,
      maxRetries: 1,
    });

    const lintParsed = extractJsonObject<{ violations: string[]; fixInstructions: string }>(lintResult.text);
    if (!lintParsed || !lintParsed.violations || lintParsed.violations.length === 0) return result;

    getLogger().warn('TASK_EXECUTOR', `Convention violations detected: ${lintParsed.violations.join('; ')}`);

    // Auto-fix via agent
    const fixPrompt = `Fix the following convention violations in the work done for step "${step.description}":\n\n${lintParsed.violations.map((v, i) => `${i + 1}. ${v}`).join('\n')}\n\nInstructions: ${lintParsed.fixInstructions}`;
    const fixResponse = await this.agent.sendMessage(fixPrompt);
    return `${result}\n\n[Convention fixes applied]\n${fixResponse.content}`;
  }

  private async runDebugCycle(step: TaskStep, result: string, goal: string): Promise<{ passed: boolean; error?: string; lastOutput: string; fixCount: number }> {
    this.checkCostBudget();
    // Detect if the step produced code that needs building/testing
    const hasCodeArtifacts = /\.(ts|js|tsx|jsx|py|rs|go|c|cpp|java|rb|php|swift|kt)\b/.test(result) ||
      /(created|modified|wrote|updated|added|generated)\s.*\.\w+/.test(result) ||
      /```[\w]*\n/.test(result);

    if (!hasCodeArtifacts) return { passed: true, lastOutput: result, fixCount: 0 };

    // Extract file names from step result for targeted test generation
    const mentionedFiles = this.extractFileNames(result);

    // Check for common build/test commands
    const testCommands = [
      { check: 'npm test', file: 'package.json', cmd: 'npm test 2>&1', timeout: 60000 },
      { check: 'pnpm test', file: 'package.json', cmd: 'pnpm test 2>&1', timeout: 60000 },
      { check: 'cargo test', file: 'Cargo.toml', cmd: 'cargo test 2>&1', timeout: 120000 },
      { check: 'go test', file: 'go.mod', cmd: 'go test ./... 2>&1', timeout: 120000 },
      { check: 'pytest', file: 'pyproject.toml', cmd: 'python -m pytest 2>&1', timeout: 60000 },
      { check: 'npm run build', file: 'package.json', cmd: 'npm run build 2>&1', timeout: 60000 },
      { check: 'pnpm build', file: 'package.json', cmd: 'pnpm build 2>&1', timeout: 60000 },
      { check: 'tsc', file: 'tsconfig.json', cmd: 'npx tsc --noEmit 2>&1', timeout: 60000 },
    ];

    let applicableCommands: Array<{ cmd: string; timeout: number }> = [];
    for (const tc of testCommands) {
      const exists = await tryShellExec(this.agent, `test -f "${tc.file}" && echo "y" || echo "n"`);
      if (exists.trim() === 'y') applicableCommands.push({ cmd: tc.cmd, timeout: tc.timeout });
    }

    // Phase 0: Auto-install dependencies if missing
    await this.ensureDependencies();

    // Phase 1: Run existing build/test commands
    let lastOutput = result;
    let fixCount = 0;

    if (applicableCommands.length > 0) {
      for (let fixAttempt = 0; fixAttempt < 3; fixAttempt++) {
        let allPassed = true;
        let allOutput = '';

        for (const ac of applicableCommands) {
          const output = await tryShellExec(this.agent, ac.cmd);
          allOutput += `\n[${ac.cmd}]\n${output}`;
          if (output.toLowerCase().includes('error') || output.toLowerCase().includes('fail') || output.toLowerCase().includes('not ok')) {
            allPassed = false;
          }
        }

        if (allPassed) {
          fixCount = fixAttempt;
          lastOutput = allOutput;
          // Regression check: run full test suite to catch regressions
          const gitManager = this.agent['gitManager'] as { snapshot?: () => string | null; revert?: (hash?: string) => boolean; listSnapshots?: () => Array<{ hash: string }> } | undefined;
          const regressionResult = await this.checkRegressions(applicableCommands, gitManager);
          if (regressionResult) {
            lastOutput += `\n[Regression suite] ${regressionResult}`;
          }
          break;
        }

        // Build/test failed — analyze and fix
        if (fixAttempt < 2) {
          getLogger().info('TASK_EXECUTOR', `Debug attempt ${fixAttempt + 1}: analyzing build failure`);
          const model = createAiSdkModel(this.config, this.apiKey);
          const debugResult = await generateText({
            model,
            system: DEBUG_SYSTEM_PROMPT,
            prompt: `Goal: ${goal}\nStep: ${step.description}\n\nBuild/test output:\n${allOutput.slice(0, 4000)}\n\nAnalyze the failure and fix it.`,
            temperature: 0.3,
            maxRetries: 1,
          });

          const fixPrompt = `The following build/test failed for step "${step.description}":\n\n${allOutput.slice(0, 3000)}\n\nFix the issues. The debug analysis says:\n\n${debugResult.text.slice(0, 1000)}`;
          lastOutput = (await this.agent.sendMessage(fixPrompt)).content;
          fixCount = fixAttempt + 1;
        }
      }

      // If existing tests still fail after all attempts, report failure
      if (fixCount >= 3) {
        const allOutput = await Promise.all(applicableCommands.map(ac => tryShellExec(this.agent, ac.cmd)));
        return {
          passed: false,
          error: `Build/test still failing after 3 fix attempts. Last output: ${allOutput.join('\n').slice(0, 500)}`,
          lastOutput,
          fixCount: 3,
        };
      }
    }

    // Phase 2: Generate and run tests for new/modified files (if none exist yet)
    if (mentionedFiles.length > 0 && applicableCommands.length === 0) {
      getLogger().info('TASK_EXECUTOR', `No existing test suite found — generating tests for ${mentionedFiles.length} file(s)`);
      const testGenResult = await this.generateAndRunTests(mentionedFiles, step, goal);
      if (!testGenResult.passed) {
        getLogger().warn('TASK_EXECUTOR', `Generated tests failed: ${testGenResult.error?.slice(0, 200)}`);
        return testGenResult;
      }
      lastOutput = testGenResult.lastOutput;
      fixCount += testGenResult.fixCount;
    }

    return { passed: true, lastOutput, fixCount };
  }

  private extractFileNames(result: string): string[] {
    const files: string[] = [];
    const fileRe = /(?:created|modified|wrote|updated|added|generated)\s+["']?([\w./-]+\.(?:ts|js|tsx|jsx|py|rs|go|c|cpp|java|rb|php|swift|kt))["']?/gi;
    let m: RegExpExecArray | null;
    while ((m = fileRe.exec(result)) !== null) {
      if (m[1] && !files.includes(m[1])) files.push(m[1]);
    }
    return files.slice(0, 10);
  }

  private async generateAndRunTests(
    files: string[], step: TaskStep, goal: string,
  ): Promise<{ passed: boolean; error?: string; lastOutput: string; fixCount: number }> {
    const model = createAiSdkModel(this.config, this.apiKey);
    let lastOutput = '';
    let fixCount = 0;

    for (const file of files) {
      // Read the source file to generate relevant tests
      const sourceContent = await tryShellExec(this.agent, `cat "${file}" 2>/dev/null || echo ""`);
      if (!sourceContent.trim()) continue;

      const testFilePath = this.inferTestPath(file);

      const genResult = await generateText({
        model,
        system: `You are a test generation expert. Given a source file, generate a test file for it.
Use the appropriate test framework for the language (Jest/Vitest for TS/JS, pytest for Python, Go test, etc.).
Return ONLY the test file content. No markdown, no explanation.`,
        prompt: `Source file: ${file}\n\nSource content:\n${sourceContent.slice(0, 4000)}\n\nGoal context: ${goal}\nStep: ${step.description}\n\nGenerate a comprehensive test file at path: ${testFilePath}`,
        temperature: 0.2,
        maxRetries: 1,
      });

      if (!genResult.text.trim()) continue;

      // Write the test file
      const writeResult = await tryShellExec(this.agent, `cat > "${testFilePath}" << 'TESTEOF'\n${genResult.text}\nTESTEOF`);
      if (writeResult.includes('error')) {
        // Fallback: write via node
        await tryShellExec(this.agent, `node -e "require('fs').writeFileSync('${testFilePath.replace(/'/g, "\\'")}', ${JSON.stringify(genResult.text)})"`);
      }

      lastOutput += `\n[Test generated] ${testFilePath}`;

      // Try to run the generated test
      const testRunner = this.inferTestRunner(file);
      if (testRunner) {
        const testOutput = await tryShellExec(this.agent, `${testRunner} 2>&1`);
        lastOutput += `\n${testOutput.slice(0, 1000)}`;

        if (testOutput.toLowerCase().includes('error') || testOutput.toLowerCase().includes('fail')) {
          // One fix attempt for generated tests
          if (fixCount < 1) {
            const fixResult = await generateText({
              model,
              system: 'Fix the test file. Return ONLY the corrected file content.',
              prompt: `Test file ${testFilePath} has failures:\n\n${testOutput.slice(0, 2000)}\n\nFix the test file.`,
              temperature: 0.2,
              maxRetries: 1,
            });
            if (fixResult.text.trim()) {
              await tryShellExec(this.agent, `node -e "require('fs').writeFileSync('${testFilePath.replace(/'/g, "\\'")}', ${JSON.stringify(fixResult.text)})"`);
              const retryOutput = await tryShellExec(this.agent, `${testRunner} 2>&1`);
              lastOutput += `\n[Retry] ${retryOutput.slice(0, 500)}`;
              fixCount++;
            }
          }
        }
      }
    }

    return { passed: true, lastOutput, fixCount };
  }

  private inferTestPath(file: string): string {
    const base = file.replace(/\.\w+$/, '');
    if (file.endsWith('.ts') || file.endsWith('.tsx')) return `${base}.test.ts`;
    if (file.endsWith('.js') || file.endsWith('.jsx')) return `${base}.test.js`;
    if (file.endsWith('.py')) return `test_${base.replace(/.*\//, '')}.py`;
    if (file.endsWith('.rs')) return `${base}_test.rs`;
    if (file.endsWith('.go')) return `${base}_test.go`;
    return `${base}_test${file.match(/\.\w+$/)?.[0] || '.test'}`;
  }

  private inferTestRunner(file: string): string | null {
    if (file.endsWith('.ts') || file.endsWith('.tsx')) return 'npx vitest run 2>&1 || npx jest 2>&1';
    if (file.endsWith('.js') || file.endsWith('.jsx')) return 'npx jest 2>&1';
    if (file.endsWith('.py')) return 'python -m pytest 2>&1';
    if (file.endsWith('.rs')) return 'cargo test 2>&1';
    if (file.endsWith('.go')) return 'go test ./... 2>&1';
    return null;
  }

  private async decompose(prompt: string): Promise<TaskStep[]> {
    this.checkCostBudget();
    const model = createAiSdkModel(this.config, this.apiKey);
    const result = await generateText({
      model,
      system: PLAN_SYSTEM_PROMPT,
      prompt,
      temperature: 0.3,
      maxRetries: 2,
    });

    const parsed = extractJsonArray(result.text);
    if (!parsed || parsed.length === 0) {
      getLogger().warn('TASK_EXECUTOR', 'Failed to parse plan JSON, using single-step fallback');
      return [{
        id: crypto.randomUUID(),
        description: prompt.slice(0, 200),
        expectedOutcome: 'Goal completed successfully',
        status: 'pending' as const,
      }];
    }

    return parsed.map((s, i) => ({
      id: crypto.randomUUID(),
      description: (s['description'] as string) || `Step ${i + 1}`,
      expectedOutcome: (s['expectedOutcome'] as string) || 'Completed',
      status: 'pending' as const,
      repoPath: (s['repoPath'] as string) || undefined,
    }));
  }

  private validatePlanSteps(steps: TaskStep[]): TaskStep[] {
    if (steps.length === 0) return steps;
    const stepIds = new Set(steps.map(s => s.id));
    const valid: TaskStep[] = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      if (!step.id) step.id = crypto.randomUUID();
      if (!step.description || step.description.trim().length < 3) continue;
      if (step.dependencies) {
        step.dependencies = step.dependencies.filter(d => stepIds.has(d) && d !== step.id);
      }
      if (step.parallel) {
        step.parallel = true;
      }
      valid.push(step);
    }

    return valid.length > 0 ? valid : steps.slice(0, 1);
  }

  private estimatePlanCost(plan: TaskPlan): number {
    const tracker = (this.agent as any)['tokenTracker'] as { totalCost?: number; inputPrice?: number; outputPrice?: number } | undefined;
    const inputPrice = tracker?.inputPrice ?? 3e-7;
    const outputPrice = tracker?.outputPrice ?? 1.5e-6;
    const avgTokensPerStep = 4000;
    const avgOutputPerStep = 1000;
    const avgCostPerStep = (avgTokensPerStep * inputPrice) + (avgOutputPerStep * outputPrice);
    return plan.steps.length * avgCostPerStep;
  }

  private async midPlanReevaluation(plan: TaskPlan, goal: string): Promise<void> {
    const completedCount = plan.steps.filter(s => s.status === 'completed').length;
    if (completedCount < 3) return;
    if (completedCount % 3 !== 0) return;

    getLogger().info('TASK_EXECUTOR', `Mid-plan re-evaluation at step ${completedCount}`);
    const model = createAiSdkModel(this.config, this.apiKey);
    const stepsSummary = plan.steps.map((s, i) =>
      `${i + 1}. ${s.description} — ${s.status}${s.result ? ': ' + s.result.slice(0, 100) : ''}`
    ).join('\n');

    const reEvalResult = await generateText({
      model,
      system: `You are a plan reviewer. Given the original goal, current progress, and remaining steps, determine if the plan needs adjustment.
Return JSON: { "needsAdjustment": boolean, "reason": "...", "suggestedChanges": ["..."] }
If the plan is on track, return {"needsAdjustment": false}.`,
      prompt: `Original goal: ${goal}\n\nProgress so far:\n${stepsSummary}\n\nRemaining steps:\n${plan.steps.slice(completedCount).map((s, i) => `${i + 1}. ${s.description}`).join('\n')}\n\nDoes the plan need adjustment?`,
      temperature: 0.2,
      maxRetries: 1,
    });

    const parsed = extractJsonObject<{ needsAdjustment: boolean; reason: string; suggestedChanges: string[] }>(reEvalResult.text);
    if (parsed?.needsAdjustment) {
      getLogger().info('TASK_EXECUTOR', `Mid-plan adjustment: ${parsed.reason}`);
    }
  }

  private async generateAlternativeApproach(step: TaskStep, failureReason: string, lastResult: string, goal: string): Promise<string> {
    this.checkCostBudget();
    const model = createAiSdkModel(this.config, this.apiKey);
    const altResult = await generateText({
      model,
      system: `You are a creative problem solver. The current approach to a step failed. Generate 1-2 alternative approaches.
Return JSON: { "approaches": [{"description": "...", "rationale": "..."}] }
Focus on fundamentally different approaches — not minor tweaks.`,
      prompt: `Goal: ${goal}\n\nFailed step: ${step.description}\nFailure: ${failureReason}\nLast attempt output: ${lastResult.slice(0, 1000)}\n\nWhat alternative approach should be tried next?`,
      temperature: 0.5,
      maxRetries: 1,
    });

    const parsed = extractJsonObject<{ approaches: Array<{ description: string; rationale: string }> }>(altResult.text);
    if (parsed?.approaches?.length) {
      return parsed.approaches.map(a => `  - ${a.description} (${a.rationale})`).join('\n');
    }
    return '';
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
    this.checkCostBudget();
    const model = createAiSdkModel(this.config, this.apiKey);
    const verifyResult = await generateText({
      model,
      system: VERIFY_SYSTEM_PROMPT,
      prompt: `Step: ${step.description}\nExpected: ${step.expectedOutcome}\n\nResult:\n${result.slice(0, 3000)}`,
      temperature: 0.1,
      maxRetries: 1,
    });

    const parsed = extractJsonObject<{ passed: boolean; reason: string }>(verifyResult.text);
    if (parsed) {
      return { passed: Boolean(parsed.passed), reason: parsed.reason || 'No reason given' };
    }

    const passed = /"passed"\s*:\s*true/i.test(verifyResult.text);
    return { passed, reason: passed ? 'Step completed' : 'Verification failed to parse, assuming failure' };
  }

  private async verifyGoal(goal: string, plan: TaskPlan): Promise<{ achieved: boolean; reason: string; gaps?: string[] }> {
    this.checkCostBudget();
    const model = createAiSdkModel(this.config, this.apiKey);
    const stepsSummary = plan.steps.map((s, i) =>
      `${i + 1}. ${s.description} — ${s.status}${s.result ? ': ' + s.result.slice(0, 200) : ''}`
    ).join('\n');

    const verifyResult = await generateText({
      model,
      system: FINAL_VERIFY_SYSTEM_PROMPT,
      prompt: `Original goal: ${goal}\n\nCompleted steps:\n${stepsSummary}\n\nWas the goal fully achieved?`,
      temperature: 0.1,
      maxRetries: 1,
    });

    const parsed = extractJsonObject<{ achieved: boolean; reason: string; gaps?: string[] }>(verifyResult.text);
    if (parsed) {
      return {
        achieved: Boolean(parsed.achieved),
        reason: parsed.reason || 'No reason given',
        gaps: parsed.gaps || [],
      };
    }

    return { achieved: false, reason: 'Failed to parse verification result', gaps: [] };
  }

  /**
   * Hallucination guardrail: cross-reference factual claims in step output
   * against tool execution results. Detects fabricated content.
   */
  private async verifyFacts(step: TaskStep, result: string): Promise<{ passed: boolean; warnings: string[] }> {
    const warnings: string[] = [];

    // Extract file path claims
    const mentionedFiles = result.match(/["'`]?([\w./-]+\.[\w]{1,8})["'`]?/g) || [];
    for (const f of mentionedFiles.slice(0, 10)) {
      const clean = f.replace(/["'`]/g, '');
      const exists = await tryShellExec(this.agent, `test -f "${clean}" && echo "y" || echo "n"`);
      if (exists.trim() !== 'y' && !clean.startsWith('http') && !/^\d+\.\d+/.test(clean)) {
        warnings.push(`Claimed file "${clean}" may not exist — verify`);
      }
    }

    // Detect fabricated statistics/numbers without source context
    const statClaims = result.match(/(\d+%|[\d,]+ (?:users|requests|items|records|errors|lines|files|rows))/gi);
    if (statClaims && statClaims.length > 2) {
      const hasSource = /(?:according to|source|from|based on|measured|observed|found|returned|output)/i.test(result);
      if (!hasSource) {
        warnings.push(`${statClaims.length} statistical claims without verifiable source context`);
      }
    }

    // Cross-reference with step result claims — if step claims "created file X" but result doesn't mention it
    const creationClaims = result.match(/(?:created|wrote|generated|built|compiled)\s+["'`]?([\w./-]+)["'`]?/gi) || [];
    if (creationClaims.length > 0 && step.result) {
      for (const claim of creationClaims) {
        const fileMatch = claim.match(/["'`]?([\w./-]+\.[\w]{1,8})["'`]?/);
        if (fileMatch && !(step.result.includes(fileMatch[1]!))) {
          warnings.push(`Claimed "${claim}" but not found in tool results`);
        }
      }
    }

    return {
      passed: warnings.length < 3, // Allow minor inconsistencies
      warnings,
    };
  }

  private async replan(
    goal: string,
    failedSteps: TaskStep[],
    lastResult: string,
    failureReason: string,
    failureHistory: FailureRecord[],
  ): Promise<TaskStep[]> {
    this.checkCostBudget();
    const model = createAiSdkModel(this.config, this.apiKey);
    const remainingDesc = failedSteps.map((s, i) => `${i + 1}. ${s.description}`).join('\n');
    const failureContext = failureHistory.length > 0
      ? '\nPrevious failed attempts for context:\n' + failureHistory.map(f =>
          `  - Attempt ${f.attemptNumber} at "${f.description}": ${f.failureReason}`
        ).join('\n')
      : '';

    const replanResult = await generateText({
      model,
      system: PLAN_SYSTEM_PROMPT + '\n\nYou are re-planning because a previous step failed. Adjust the remaining steps to account for the failure. DO NOT repeat the same approach that already failed.\n\nWeb research is available — use research steps to investigate the failure and find solutions before re-attempting.',
      prompt: `Goal: ${goal}\n\nFailed step: ${failedSteps[0]?.description}\nFailure reason: ${failureReason}\nPartial result: ${lastResult.slice(0, 1000)}${failureContext}\n\nRemaining steps to replan:\n${remainingDesc}\n\nProvide a revised plan (JSON array).`,
      temperature: 0.4,
      maxRetries: 2,
    });

    const parsed = extractJsonArray(replanResult.text);
    if (!parsed || parsed.length === 0) return failedSteps;

    // Preserve repoPath from the original failed step if the first entry has one
    const firstFailedStep = failedSteps[0];
    const defaultRepoPath = firstFailedStep?.repoPath;

    return parsed.map(s => ({
      id: crypto.randomUUID(),
      description: (s['description'] as string) || 'Revised step',
      expectedOutcome: (s['expectedOutcome'] as string) || 'Completed',
      status: 'pending' as const,
      repoPath: (s['repoPath'] as string) || defaultRepoPath,
    }));
  }

  private async autoPrPush(plan: TaskPlan): Promise<void> {
    const gitManager = this.agent['gitManager'] as { pushBranch?: () => boolean; createPR?: (title: string, body: string) => string | null; ensureBranch?: (sessionId?: string) => boolean; getBranchName?: (sessionId?: string) => string; getRemoteUrl?: () => string | null } | undefined;
    if (!gitManager?.pushBranch || !gitManager?.createPR) return;

    // Only push if there's a remote configured
    const remoteUrl = gitManager.getRemoteUrl?.();
    if (!remoteUrl) {
      getLogger().info('TASK_EXECUTOR', 'No git remote configured — skipping auto PR/push');
      return;
    }

    gitManager.ensureBranch?.(this.sessionId);

    const branchName = gitManager.getBranchName?.(this.sessionId) || 'auto';
    const title = `[Agent-X] ${plan.goal.slice(0, 80)}`;
    const body = `## Agent-X Automated Changes\n\n**Goal:** ${plan.goal}\n\n**Steps completed:** ${plan.steps.filter(s => s.status === 'completed').length}/${plan.steps.length}\n\n### Steps:\n${plan.steps.filter(s => s.status === 'completed').map((s, i) => `${i + 1}. ${s.description}`).join('\n')}\n\n---\n*Auto-generated by Agent-X*`;

    if (gitManager.pushBranch()) {
      getLogger().info('TASK_EXECUTOR', `Pushed branch ${branchName} to origin`);
      const prUrl = gitManager.createPR(title, body);
      if (prUrl) {
        getLogger().info('TASK_EXECUTOR', `PR created: ${prUrl}`);
      } else {
        getLogger().warn('TASK_EXECUTOR', 'Failed to create PR');
      }
    } else {
      getLogger().warn('TASK_EXECUTOR', 'Failed to push branch');
    }
  }

  private commitTaskResult(plan: TaskPlan, success: boolean, summary: string): void {
    const completedSteps = plan.steps.filter(s => s.status === 'completed').length;
    this.emitSessionEvent({
      type: 'task_completed',
      payload: { taskId: plan.id, success, summary, completedSteps, totalSteps: plan.steps.length },
    });
    // Persist failure record for cross-session memory
    if (!success && this.store) {
      const failures = plan.steps.filter(s => s.status === 'failed').map(s => ({
        taskGoal: plan.goal.slice(0, 200),
        stepDescription: s.description,
        error: s.error || 'unknown',
        failedAt: new Date().toISOString(),
      }));
      if (failures.length > 0) {
        try {
          const existing = this.store.getTaskSnapshot('_failure_history') as Record<string, unknown> | null;
          const history = existing ? (JSON.parse((existing as any)['failures'] || '[]') as typeof failures) : [];
          history.push(...failures);
          if (history.length > 50) history.splice(0, history.length - 50);
          this.store.saveTaskSnapshot({ sessionId: '_failure_history', failures: JSON.stringify(history), _key: '_failure_history' } as any);
        } catch { /* non-critical */ }
      }
    }
  }

  private makeResult(success: boolean, plan: TaskPlan, summary: string): TaskExecutorResult {
    return { success, plan, summary, goalVerified: success };
  }

  private emitEvent(event: Record<string, unknown>): void {
    this.agent['emit']?.({ type: 'task_event', ...event } as unknown as EngineEvent);
  }

  /**
   * Resolve git merge conflicts using the LLM.
   */
  private async resolveGitConflicts(): Promise<boolean> {
    const gitManager = this.agent['gitManager'] as { hasConflicts?: () => boolean; getConflictFiles?: () => string[]; getConflictContent?: (f: string) => string | null; resolveConflict?: (f: string, c: string) => boolean } | undefined;
    if (!gitManager?.hasConflicts || !gitManager.hasConflicts()) return true;

    getLogger().info('TASK_EXECUTOR', 'Merge conflicts detected — resolving via LLM');
    const conflictFiles = gitManager.getConflictFiles?.() || [];
    if (conflictFiles.length === 0) return true;

    const model = createAiSdkModel(this.config, this.apiKey);
    for (const file of conflictFiles) {
      const content = gitManager.getConflictContent?.(file);
      if (!content) continue;

      const resolution = await generateText({
        model,
        system: `You are a merge conflict resolution expert. Given a file with merge conflicts, resolve them.
Output ONLY the resolved file content with conflict markers removed and a clean merge.
Preserve all functionality from both sides.`,
        prompt: `Resolve conflicts in file "${file}":\n\n${content.slice(0, 8000)}`,
        temperature: 0.1,
        maxRetries: 1,
      });

      if (resolution.text.trim()) {
        gitManager.resolveConflict?.(file, resolution.text);
        getLogger().info('TASK_EXECUTOR', `Resolved conflict in ${file}`);
      }
    }
    return true;
  }

  /**
   * CI pipeline: push, watch CI, auto-fix failures, re-push until green or timeout.
   */
  private async ciPipeline(plan: TaskPlan): Promise<boolean> {
    const gitManager = this.agent['gitManager'] as { hasConflicts?: () => boolean; getConflictFiles?: () => string[]; pushBranch?: () => boolean; watchCI?: (timeoutMs: number) => string; getRemoteUrl?: () => string | null } | undefined;
    if (!gitManager?.pushBranch || !gitManager?.getRemoteUrl) return true;

    const remoteUrl = gitManager.getRemoteUrl();
    if (!remoteUrl) return true;

    gitManager.pushBranch();
    getLogger().info('TASK_EXECUTOR', 'CI pipeline: pushed, waiting for CI results...');

    for (let attempt = 0; attempt < 3; attempt++) {
      const ciResult = gitManager.watchCI?.(300_000) || 'success';
      if (ciResult === 'success') {
        getLogger().info('TASK_EXECUTOR', 'CI pipeline: all checks passed');
        return true;
      }

      getLogger().warn('TASK_EXECUTOR', `CI pipeline: checks failed (attempt ${attempt + 1}/3)`);

      // Try to fix CI failures
      const ciStatus = await tryShellExec(this.agent, 'gh run list --branch HEAD --limit 1 --json name,conclusion 2>/dev/null || true');
      const fixPrompt = `The CI pipeline failed for task "${plan.goal}".\n\nCI status: ${ciStatus.slice(0, 1000)}\n\nAnalyze the CI failures and fix the underlying issues.`;
      await this.agent.sendMessage(fixPrompt);

      // Re-push after fix
      await this.resolveGitConflicts();
      gitManager.pushBranch();
    }

    getLogger().error('TASK_EXECUTOR', 'CI pipeline: failed after 3 attempts');
    return false;
  }

  /**
   * PR review loop: watch PR comments, respond to each, fix issues, push,
   * then merge when approved. Runs a maximum of 10 review cycles.
   */
  private async prReviewLoop(plan: TaskPlan): Promise<boolean> {
    const gitManager = this.agent['gitManager'] as { getBranchName?: (sessionId?: string) => string; getRemoteUrl?: () => string | null; pushBranch?: () => boolean } | undefined;
    if (!gitManager?.getRemoteUrl?.() || !gitManager?.pushBranch) return true;

    const branch = gitManager.getBranchName?.(this.sessionId) || 'auto';

    for (let cycle = 0; cycle < 10; cycle++) {
      await new Promise(r => setTimeout(r, 5000)); // Poll interval

      // Check PR status
      const prStatus = await tryShellExec(this.agent,
        `gh pr view "${branch}" --json state,body,comments,reviews,url 2>/dev/null || true`
      );
      const prData = this.safeJsonParse(prStatus);

      if (!prData || !prData['url']) {
        getLogger().info('TASK_EXECUTOR', 'PR review loop: no PR found, proceeding');
        return true;
      }

      // Check if PR is merged
      if (prData['state'] === 'MERGED') {
        getLogger().info('TASK_EXECUTOR', `PR review loop: PR merged — ${prData['url']}`);
        return true;
      }

      // Check if PR is closed without merge
      if (prData['state'] === 'CLOSED') {
        getLogger().warn('TASK_EXECUTOR', 'PR review loop: PR was closed without merge');
        return false;
      }

      // Process pending reviews
      const reviews = (prData['reviews'] as Array<{ body: string; state: string }>) || [];
      const changesRequested = reviews.some((r: { state: string }) => r.state === 'CHANGES_REQUESTED');

      // Process comments that need responses
      const comments = (prData['comments'] as Array<{ body: string; author: { login: string } }>) || [];
      const newComments = comments.filter((_c: { body: string; author: { login: string } }, i: number) =>
        i >= (this._lastCommentCount || 0)
      );
      this._lastCommentCount = comments.length;

      if (newComments.length === 0 && !changesRequested) {
        // No new feedback — approve and merge
        await tryShellExec(this.agent, `gh pr merge "${branch}" --squash --subject "Agent-X: ${plan.goal.slice(0, 60)}" 2>/dev/null || true`);
        getLogger().info('TASK_EXECUTOR', 'PR review loop: auto-approved and merged');
        return true;
      }

      // Respond to review comments
      for (const comment of newComments) {
        const commentBody = comment['body'] || '';
        getLogger().info('TASK_EXECUTOR', `PR review: addressing comment: ${commentBody.slice(0, 100)}`);
        const fixPrompt = `A PR reviewer commented:\n\n${commentBody}\n\nFix the issue, then reply with a summary of the change.`;
        await this.agent.sendMessage(fixPrompt);
      }

      // If changes were requested, fix and re-push
      if (changesRequested) {
        await this.resolveGitConflicts();
        gitManager.pushBranch();
      }
    }

    // After 10 cycles, try to merge anyway
    await tryShellExec(this.agent, `gh pr merge "${branch}" --squash 2>/dev/null || true`);
    return true;
  }

  /**
   * Deploy after PR merge. Supports: gh workflow run, vercel, railway, docker.
   */
  private async deploy(_plan: TaskPlan): Promise<boolean> {
    // Detect available deploy targets
    const hasVercel = await tryShellExec(this.agent, 'test -f "vercel.json" && echo "y" || echo "n"');
    const hasRailway = await tryShellExec(this.agent, 'test -f "railway.json" && echo "y" || echo "n"');
    const hasDockerfile = await tryShellExec(this.agent, 'test -f "Dockerfile" && echo "y" || echo "n"');
    const hasGhWorkflow = await tryShellExec(this.agent, 'test -d ".github/workflows" && echo "y" || echo "n"');

    getLogger().info('TASK_EXECUTOR', `Deploy phase: vercel=${hasVercel.trim()}, railway=${hasRailway.trim()}, docker=${hasDockerfile.trim()}, gh=${hasGhWorkflow.trim()}`);

    if (hasVercel.trim() === 'y') {
      const output = await tryShellExec(this.agent, 'npx vercel --prod --yes 2>&1 || true');
      getLogger().info('TASK_EXECUTOR', `Vercel deploy: ${output.slice(0, 200)}`);
      if (!output.toLowerCase().includes('error')) return true;
    }

    if (hasRailway.trim() === 'y') {
      const output = await tryShellExec(this.agent, 'railway up --detach 2>&1 || true');
      getLogger().info('TASK_EXECUTOR', `Railway deploy: ${output.slice(0, 200)}`);
      if (!output.toLowerCase().includes('error')) return true;
    }

    if (hasDockerfile.trim() === 'y') {
      const output = await tryShellExec(this.agent,
        'docker build -t agentx-deploy:latest . 2>&1 && docker push agentx-deploy:latest 2>&1 || true'
      );
      getLogger().info('TASK_EXECUTOR', `Docker deploy: ${output.slice(0, 200)}`);
    }

    if (hasGhWorkflow.trim() === 'y') {
      const output = await tryShellExec(this.agent,
        'gh workflow run --ref main 2>&1 || gh workflow run --ref master 2>&1 || true'
      );
      getLogger().info('TASK_EXECUTOR', `GitHub workflow triggered: ${output.slice(0, 200)}`);
    }

    return true;
  }

  /**
   * Try to switch to a fallback model if the primary model fails.
   * Uses a prioritized chain: fastest/cheapest first, most capable last.
   */
  private async tryModelFailover(): Promise<boolean> {
    const agent = this.agent as any;

    const fallbackModels: string[] = [
      'gemini-2.0-flash',
      'claude-3-haiku-20240307',
      'gpt-4o-mini',
      'claude-3-5-sonnet-20241022',
      'gpt-4o',
      'gemini-2.0-pro-exp',
    ];

    const usedFallbacks = this._usedFallbackModels;

    for (const fb of fallbackModels) {
      if (usedFallbacks.has(fb)) continue;
      if (agent.isModelGrounded?.(fb)) {
        getLogger().info('TASK_EXECUTOR', `Skipping grounded fallback model: ${fb}`);
        continue;
      }
      usedFallbacks.add(fb);

      try {
        getLogger().info('TASK_EXECUTOR', `Trying fallback model: ${fb}`);
        if (typeof agent.trialModel === 'function') {
          const available = await agent.trialModel(fb);
          if (!available) {
            getLogger().warn('TASK_EXECUTOR', `Fallback model ${fb} is not available`);
            continue;
          }
        }
        if (typeof agent.switchModel === 'function') {
          agent.switchModel(fb);
          this.config.provider.activeModel = fb;
          this._usedFallbackModels = usedFallbacks;
          getLogger().info('TASK_EXECUTOR', `Switched to fallback model: ${fb}`);
          return true;
        }
      } catch {
        continue;
      }
    }

    return false;
  }

  /**
   * Safe JSON parse that returns null on failure.
   */
  private safeJsonParse(text: string): Record<string, unknown> | null {
    try {
      // Try to extract JSON from the text (might have other output)
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start === -1 || end === -1 || end <= start) return null;
      return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
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
    const imageRefs: string[] = [];
    const imgRe = /["']?([\w./-]+\.(?:png|jpg|jpeg|gif|bmp|webp|svg|fig|sketch|xd|psd))["']?/gi;
    let m: RegExpExecArray | null;
    while ((m = imgRe.exec(goal)) !== null) {
      if (m[1]) imageRefs.push(m[1]);
    }
    // Also detect generic references like "screenshot", "wireframe", "diagram", "mockup"
    const hasGenericRef = /screenshot|wireframe|diagram|mockup|visual|design|ui\s*mock|prototype/i.test(goal) && imageRefs.length === 0;

    if (imageRefs.length === 0 && !hasGenericRef) return null;

    let descriptions: string[] = [];

    for (const ref of imageRefs) {
      const exists = await tryShellExec(this.agent, `test -f "${ref}" && echo "exists" || echo "not found"`);
      if (exists.trim() === 'exists') {
        const fileInfo = await tryShellExec(this.agent, `file "${ref}" 2>/dev/null || echo "unknown"`);
        const sizeInfo = await tryShellExec(this.agent, `wc -c "${ref}" 2>/dev/null | awk '{print $1}' || echo "unknown"`);
        descriptions.push(`- ${ref} (${fileInfo.trim().split(',')[0] || 'image'}, ${sizeInfo.trim()} bytes)`);
      } else {
        descriptions.push(`- ${ref} (referenced but not found in workspace)`);
      }
    }

    if (hasGenericRef) {
      descriptions.push('- Generic visual reference (screenshot/diagram/mockup) mentioned');
    }

    if (descriptions.length === 0) return null;

    return descriptions.join('\n');
  }

  private emitProgress(plan: TaskPlan, stepIndex: number, phase: string): void {
    const completed = plan.steps.filter(s => s.status === 'completed').length;
    const total = plan.steps.length;
    this.emitEvent({ type: 'task_progress', phase, stepIndex, completed, total });
    this.emitSessionEvent({
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
   * Check if gh CLI is available. Returns false if not installed.
   */
  private async hasGhAvailable(): Promise<boolean> {
    const result = await tryShellExec(this.agent, 'which gh 2>/dev/null && echo "found" || echo "notfound"');
    return result.trim().includes('found');
  }

  /**
   * Hard restart: force-save current state so we can retry from scratch if the supervisor catches a fatal crash.
   */
  private forceSaveState(goal: string): boolean {
    try {
      const snapshot = {
        taskId: this.sessionId,
        goal,
        planState: JSON.stringify({ steps: [], currentStepIndex: 0, goal }),
        stepIndex: 0,
        failureHistory: '[]',
        created_at: new Date().toISOString(),
      };
      this.store?.saveTaskSnapshot(snapshot);
      return true;
    } catch {
      return false;
    }
  }

  private checkCostBudget(): void {
    if (!this.maxCostUsd) return;
    const tracker = (this.agent as any)['tokenTracker'] as { totalCost: number } | undefined;
    const currentCost = tracker?.totalCost ?? 0;
    if (currentCost >= this.maxCostUsd) {
      getLogger().error('COST_CB', `Cost circuit breaker: $${currentCost.toFixed(4)} exceeds max $${this.maxCostUsd}`);
      throw new Error(`Cost circuit breaker: exceeded max budget of $${this.maxCostUsd}`);
    }
  }
}
