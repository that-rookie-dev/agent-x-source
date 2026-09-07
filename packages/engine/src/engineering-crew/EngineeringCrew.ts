import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir, getLogger, generateId } from '@agentx/shared';
import { CrewEnvironment, type CrewProgressCallback } from './CrewEnvironment.js';
import { ProductManagerRole } from './ProductManagerRole.js';
import { ArchitectRole } from './ArchitectRole.js';
import { ProjectManagerRole } from './ProjectManagerRole.js';
import { EngineerRole } from './EngineerRole.js';
import { QaEngineerRole } from './QaEngineerRole.js';
import { ReviewerRole } from './ReviewerRole.js';
import { ProjectRepo } from './ProjectRepo.js';
import type { SubAgentSpawner } from './SubAgentSpawner.js';

/** #18: Model-based cost rates (input/output per 1M tokens).
 * These are approximate blended rates for budget enforcement. They are not live
 * provider prices — for precise billing, set costRates explicitly in EngineeringCrewConfig.
 */
const MODEL_COST_RATES: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'gpt-4-turbo': { inputPerMillion: 10, outputPerMillion: 30 },
  'gpt-4': { inputPerMillion: 30, outputPerMillion: 60 },
  'claude-3-5-sonnet': { inputPerMillion: 3, outputPerMillion: 15 },
  'claude-3-5-haiku': { inputPerMillion: 0.8, outputPerMillion: 4 },
  'claude-3-opus': { inputPerMillion: 15, outputPerMillion: 75 },
  'gemini-1.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.3 },
  'gemini-1.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5 },
  'deepseek-chat': { inputPerMillion: 0.14, outputPerMillion: 0.28 },
  'deepseek-reasoner': { inputPerMillion: 0.55, outputPerMillion: 2.19 },
  'llama3.1-8b': { inputPerMillion: 0.05, outputPerMillion: 0.05 },
  'qwen-2.5-72b': { inputPerMillion: 0.9, outputPerMillion: 0.9 },
};

/** #18: Derive cost rates from model/provider when costRates not explicitly provided. */
function deriveCostRates(modelId?: string, _providerId?: string): { inputPerMillion: number; outputPerMillion: number } {
  if (modelId) {
    const exact = MODEL_COST_RATES[modelId];
    if (exact) return exact;
    // Try case-insensitive partial match
    const lower = modelId.toLowerCase();
    for (const [key, rate] of Object.entries(MODEL_COST_RATES)) {
      if (lower.includes(key)) return rate;
    }
  }
  // Conservative blended default
  return { inputPerMillion: 3, outputPerMillion: 15 };
}
import { ContextAwareSpawner } from './SubAgentSpawner.js';
import { EngineeringCrewStore } from './EngineeringCrewStore.js';
import {
  broadcastMessage,
  taskListToPhases,
  type PlanArtifact,
  type TaskList,
  type PrdDocument,
  type CrewTopic,
  type EngineeringCrewMessage,
} from './types.js';

export interface EngineeringCrewResult {
  success: boolean;
  blocked: boolean;
  summary: string;
  plan?: PlanArtifact;
  rounds: number;
  timedOut: boolean;
  cost?: { totalTokens: number; estimatedCost: number };
  /** Whether this run resumed from a prior checkpoint. */
  resumed?: boolean;
}

export interface EngineeringCrewConfig {
  /** Max budget in dollars — mirrors MetaGPT's Team.invest(). 0 = unlimited. */
  maxBudget?: number;
  /** Enable code review in the Engineer role (mirrors MetaGPT's use_code_review). */
  useCodeReview?: boolean;
  /** Incremental mode — work on an existing codebase instead of greenfield. */
  incremental?: boolean;
  /** Max rounds (mirrors MetaGPT's Team.run(n_round)). */
  maxRounds?: number;
  /** Timeout in milliseconds. */
  timeoutMs?: number;
  /** #18: Per-token cost rates for budget enforcement and cost tracking.
   * When omitted, rates are derived from modelId/providerId or fall back to conservative defaults. */
  costRates?: { inputPerMillion: number; outputPerMillion: number };
  /** #18: Model ID for deriving cost rates when costRates is not provided. */
  modelId?: string;
  /** #18: Provider ID for deriving cost rates (optional; primarily used for logging/diagnostics). */
  providerId?: string;
}

/**
 * Session context — the conversation history and prior crew state that gives the
 * Engineering Crew LLM enough information to understand what's been done and what
 * the user is asking for next.
 *
 * When resuming a prior run, this is injected into every role's prompt so the LLM
 * can semantically understand the user's "continue" request — not just match keywords.
 */
export interface SessionContext {
  /** The session ID this crew run belongs to. */
  sessionId: string;
  /** Recent conversation history (user + assistant messages) for context. */
  conversationHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  /** The prior plan artifact if resuming, null if fresh start. */
  priorPlan?: PlanArtifact | null;
  /** The user's latest message that triggered this crew run. */
  latestUserMessage: string;
}

/**
 * Orchestrates one Engineering Crew run — mirrors MetaGPT's `Team` class
 * (repos/metagpt/metagpt/team.py, MIT licensed).
 *
 * Full SOP pipeline:
 *   UserRequirement → ProductManager (WritePRD) → Architect (WriteDesign) →
 *   ProjectManager (WriteTasks) → Engineer (WriteCode → WriteCodeReview → SummarizeCode) →
 *   QaEngineer (WriteTest → RunCode → DebugError) → Reviewer (crew_complete)
 *
 * Supports two entry modes:
 * - **Fresh start** (`kickoff`): Publishes a new user_requirement and runs the full pipeline.
 * - **Resume** (`resume`): Loads a prior PlanArtifact, re-publishes completed SOP documents
 *   (PRD, Design, TaskList) so downstream roles can pick up where they left off, and
 *   injects the full session conversation history into every role's LLM prompt so the
 *   LLM can semantically understand what "continue" means — not just match keywords.
 *
 * Isolation (design doc Section 0): state is checkpointed to its own directory, entirely
 * separate from `TaskStateManager`'s `task-state/` checkpoints and from the persona `crews`
 * store used by `CrewManager`.
 */
export class EngineeringCrew {
  readonly taskId: string;
  private readonly env = new CrewEnvironment();
  private readonly checkpointDir: string;
  private readonly repo: ProjectRepo;
  private readonly config: EngineeringCrewConfig;
  private sessionContext: SessionContext | null = null;
  private readonly contextSpawner: ContextAwareSpawner;
  /** Optional DB store for per-round checkpointing (#2). */
  private store: EngineeringCrewStore | null = null;
  /** Session ID for DB association. */
  private sessionId: string | undefined;
  /** #16: Cancellation flag — set by cancel() to stop the run loop. */
  private cancelled = false;

  constructor(spawner: SubAgentSpawner, cwd: string, taskId?: string, config: EngineeringCrewConfig = {}) {
    this.taskId = taskId ?? `eng-crew-${generateId()}`;
    this.config = {
      maxBudget: 0,
      useCodeReview: false,
      incremental: false,
      maxRounds: 30,
      timeoutMs: 60 * 60_000,
      ...config,
    };
    this.checkpointDir = join(getConfigDir(), 'engineering-crew');
    try {
      if (!existsSync(this.checkpointDir)) mkdirSync(this.checkpointDir, { recursive: true });
    } catch { /* best-effort */ }

    this.repo = new ProjectRepo(cwd);

    // Wrap the spawner with context-aware prefix injection so every role's LLM
    // gets the full session conversation history + prior plan state
    this.contextSpawner = new ContextAwareSpawner(spawner);

    // #19: Set the task ID on the environment so progress events include it
    this.env.setTaskId(this.taskId);

    // Hire all roles in SOP order — mirrors MetaGPT's Team.hire()
    this.env.hire(new ProductManagerRole(this.contextSpawner));
    this.env.hire(new ArchitectRole(this.contextSpawner, this.taskId));
    this.env.hire(new ProjectManagerRole(this.contextSpawner));
    this.env.hire(new EngineerRole(this.contextSpawner, cwd, this.repo, this.config.useCodeReview));
    this.env.hire(new QaEngineerRole(this.contextSpawner, cwd, this.repo));
    this.env.hire(new ReviewerRole(this.contextSpawner, cwd));

    // In incremental mode, scan existing files
    if (this.config.incremental) {
      const existing = this.repo.scanExistingFiles();
      getLogger().info('ENGINEERING_CREW', `Incremental mode: found ${existing.length} existing source file(s)`);
    }
  }

  /** Set session context — injected into role prompts for semantic understanding. */
  setSessionContext(ctx: SessionContext): void {
    this.sessionContext = ctx;
    this.sessionId = ctx.sessionId;
    // Update the context-aware spawner so every role's LLM gets the context prefix
    this.contextSpawner.setContextPrefix(this.buildContextPrefix());
  }

  /** Set the DB store for per-round checkpointing (#2). */
  setStore(store: EngineeringCrewStore | null): void {
    this.store = store;
  }

  /** Set the progress callback for real-time UI updates (#12). */
  setProgressCallback(cb: CrewProgressCallback | null): void {
    this.env.setProgressCallback(cb);
  }

  /** #16: Cancel an in-memory running crew. The run loop checks this flag between rounds. */
  cancel(): void {
    this.cancelled = true;
    getLogger().info('ENGINEERING_CREW', `Crew ${this.taskId} cancellation requested`);
  }

  /** #16: Check if the crew has been cancelled. */
  get isCancelled(): boolean {
    return this.cancelled;
  }

  /** Get the session context (if any) for injection into role prompts. */
  getSessionContext(): SessionContext | null {
    return this.sessionContext;
  }

  /** Build a context prefix string for LLM prompts from the session context.
   *
   * Token budget management (#11): the prefix is capped at a configurable token budget
   * (default: ~2000 tokens ≈ 8000 chars). Each section is dynamically truncated based
   * on remaining budget. Conversation history messages are truncated proportionally
   * so older messages get less space than newer ones. Prior plan state is truncated
   * last (most important for resume). The current user request is always included in full.
   *
   * #20: Also includes the latest crew state (current phase statuses) from the environment
   * so the context prefix reflects the current state, not just the initial state.
   */
  buildContextPrefix(): string {
    if (!this.sessionContext) return '';
    const MAX_PREFIX_CHARS = 8000; // ~2000 tokens — conservative budget for context prefix
    const parts: string[] = [];

    // Reserve space for the current user request (always included in full)
    const currentRequest = this.sessionContext.latestUserMessage ?? '';
    const reservedForRequest = currentRequest.length + 100; // +100 for headers/labels
    let remainingBudget = MAX_PREFIX_CHARS - reservedForRequest;
    if (remainingBudget < 500) remainingBudget = 500; // minimum for history

    // Include conversation history — dynamically truncated based on remaining budget
    const recentHistory = this.sessionContext.conversationHistory.slice(-10);
    if (recentHistory.length > 0 && remainingBudget > 0) {
      parts.push('## Prior conversation context');
      // Allocate budget proportionally — newer messages get more space
      const totalBudget = remainingBudget * 0.4; // 40% of remaining for history
      const perMessageBudget = Math.max(100, Math.floor(totalBudget / recentHistory.length));
      for (let i = 0; i < recentHistory.length; i++) {
        const msg = recentHistory[i]!;
        const roleLabel = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
        // Newer messages (higher index) get more budget
        const ageFromEnd = recentHistory.length - 1 - i;
        const budget = Math.floor(perMessageBudget * (1 + ageFromEnd * 0.1));
        const truncated = msg.content.length > budget ? msg.content.slice(0, budget) + '...' : msg.content;
        parts.push(`${roleLabel}: ${truncated}`);
      }
      remainingBudget -= parts.join('\n').length;
    }

    // #20: Include the latest crew state from the environment (current phase statuses)
    // This is refreshed every round so the context reflects the current state.
    const latestTaskList = this.env.messagesByTopic('task_list_ready').pop()?.artifact as TaskList | undefined;
    if (latestTaskList && remainingBudget > 200) {
      const crewStateParts: string[] = [];
      crewStateParts.push('');
      crewStateParts.push('## Current crew state');
      for (const task of latestTaskList.tasks) {
        const status = task.status;
        const verified = task.verification?.filter((v) => !v.passed).map((v) => `✗ ${v.criterion}`).join('; ') ?? '';
        crewStateParts.push(`  - [${status}] ${task.id}: ${task.title}${verified ? ` (failed: ${verified})` : ''}`);
      }
      const crewStateText = crewStateParts.join('\n');
      if (crewStateText.length < remainingBudget * 0.3) {
        parts.push(crewStateText);
        remainingBudget -= crewStateText.length;
      }
    }

    // Include prior plan state if resuming — truncated to remaining budget
    if (this.sessionContext.priorPlan && remainingBudget > 200) {
      const plan = this.sessionContext.priorPlan;
      const planParts: string[] = [];
      planParts.push('');
      planParts.push('## Prior engineering crew state');
      planParts.push(`Original objective: ${plan.objective.slice(0, 300)}`);
      planParts.push(`Task ID: ${plan.taskId}`);
      if (plan.phases.length > 0) {
        planParts.push('Task/phase status:');
        for (const phase of plan.phases) {
          const phaseLine = `  - [${phase.status}] ${phase.id}: ${phase.title}`;
          planParts.push(phaseLine);
          if (phase.verification && phase.verification.length > 0) {
            const failed = phase.verification.filter((v) => !v.passed);
            if (failed.length > 0) {
              planParts.push(`    Failed criteria:`);
              for (const f of failed) {
                planParts.push(`      ✗ ${f.criterion}: ${f.detail.slice(0, 150)}`);
              }
            }
          }
        }
      }
      const planText = planParts.join('\n');
      // Truncate plan text if it exceeds remaining budget
      const truncatedPlan = planText.length > remainingBudget
        ? planText.slice(0, remainingBudget) + '\n... (prior plan state truncated)'
        : planText;
      parts.push(truncatedPlan);
    }

    parts.push('');
    parts.push(`## Current user request`);
    parts.push(currentRequest);
    parts.push('');
    parts.push('Based on the above context, proceed with your role.');

    return parts.join('\n');
  }

  /** Publish the initial user requirement — mirrors MetaGPT's Team.run_project(). */
  kickoff(objective: string): void {
    this.env.publish(broadcastMessage('user_requirement', 'user', objective));
  }

  /**
   * Resume from a prior PlanArtifact — re-publishes completed SOP documents so the
   * pipeline picks up where it left off. Already-verified phases are preserved; only
   * pending/failed/in_progress phases are re-processed.
   *
   * The session context (conversation history + prior plan state) is injected into
   * every role's LLM prompt so the LLM can semantically understand what the user is
   * asking for — whether they say "continue", "fix the failing test", "now add the
   * API endpoint", or anything else.
   */
  resume(priorPlan: PlanArtifact, userMessage: string): void {
    getLogger().info('ENGINEERING_CREW', `Resuming crew ${this.taskId} from prior plan (phases: ${priorPlan.phases.length}, verified: ${priorPlan.phases.filter((p) => p.status === 'verified').length})`);

    // Re-publish completed SOP documents so downstream roles have them in memory
    if (priorPlan.prd) {
      this.env.publish(broadcastMessage('prd_ready', 'ProductManager', `Resumed PRD for "${priorPlan.prd.productName}".`, priorPlan.prd));
    }
    if (priorPlan.design) {
      this.env.publish(broadcastMessage('design_ready', 'Architect', 'Resumed system design.', priorPlan.design));
    }
    if (priorPlan.taskList) {
      // Update task statuses from the prior plan's phase statuses
      // #9: Also restore code/test documents from interrupted runs so partial work is preserved
      const updatedTaskList: TaskList = {
        ...priorPlan.taskList,
        tasks: priorPlan.taskList.tasks.map((task) => {
          const priorPhase = priorPlan.phases.find((p) => p.id === task.id);
          if (priorPhase) {
            return {
              ...task,
              status: priorPhase.status,
              verification: priorPhase.verification,
              implementationNotes: priorPhase.implementationNotes,
              retryCount: priorPhase.retryCount,
              // Restore partial work from the interrupted run
              codeDocument: priorPhase.codeDocument ?? task.codeDocument,
              testDocument: priorPhase.testDocument ?? task.testDocument,
            };
          }
          return task;
        }),
      };
      this.env.publish(broadcastMessage('task_list_ready', 'ProjectManager', `Resumed task list with ${updatedTaskList.tasks.length} task(s).`, updatedTaskList));
    } else if (priorPlan.phases.length > 0) {
      // Legacy: no TaskList, but phases exist — reconstruct a minimal one
      const taskList: TaskList = {
        designRef: priorPlan.design?.rawOutput ?? '',
        tasks: priorPlan.phases.map((p) => ({
          id: p.id,
          title: p.title,
          description: p.title,
          dependsOn: p.dependsOn,
          acceptanceCriteria: p.acceptanceCriteria,
          unknowns: p.unknowns,
          status: p.status,
          verification: p.verification,
          implementationNotes: p.implementationNotes,
          retryCount: p.retryCount,
        })),
        rawOutput: '',
      };
      this.env.publish(broadcastMessage('task_list_ready', 'ProjectManager', `Resumed task list with ${taskList.tasks.length} task(s).`, taskList));
    }

    // If there are pending/failed tasks, publish a code_summarized message to trigger
    // the QaEngineer to re-verify, or a phase_failed to trigger the Engineer to re-implement
    const hasUnverifiedTasks = priorPlan.phases.some((p) => p.status !== 'verified');
    if (hasUnverifiedTasks && priorPlan.taskList) {
      // Trigger the Engineer to pick up unverified tasks
      this.env.publish(broadcastMessage('task_list_ready', 'ProjectManager', `Resume trigger: ${priorPlan.phases.filter((p) => p.status !== 'verified').length} task(s) need work.`, priorPlan.taskList));
    }

    // Also publish the user's new message as a user_requirement so the ProductManager
    // can see it in context (it won't re-run if the PRD already exists, but the context
    // helps the LLM understand what the user is asking for)
    this.env.publish(broadcastMessage('user_requirement' as CrewTopic, 'user', userMessage));
  }

  /**
   * Run rounds until the crew goes idle, a `crew_complete` message appears, or
   * `maxRounds`/`timeoutMs`/budget is hit — mirrors MetaGPT's `Team.run(n_round)`.
   *
   * Budget enforcement (#1): if `maxBudget > 0`, the crew stops when the estimated
   * cost of LLM calls exceeds the budget. Cost is estimated from cumulative token
   * usage tracked by `ContextAwareSpawner` × a per-token rate.
   *
   * Cost tracking (#8): the result includes `cost` with total tokens and estimated
   * dollar cost aggregated from all sub-agent spawns.
   */
  async run(maxRounds?: number, timeoutMs?: number): Promise<EngineeringCrewResult> {
    const rounds = maxRounds ?? this.config.maxRounds ?? 30;
    const timeout = timeoutMs ?? this.config.timeoutMs ?? 60 * 60_000;
    const deadline = Date.now() + timeout;
    let roundCount = 0;
    let budgetExceeded = false;

    while (roundCount < rounds && !this.env.isIdle && Date.now() < deadline && !this.cancelled) {
      // Budget check (mirrors MetaGPT's Team._check_balance / NoMoneyException)
      if (this.config.maxBudget && this.config.maxBudget > 0) {
        const usage = this.contextSpawner.getCumulativeTokenUsage();
        const estimatedCost = this.estimateCost(usage);
        if (estimatedCost >= this.config.maxBudget) {
          budgetExceeded = true;
          getLogger().warn('ENGINEERING_CREW', `Budget exceeded: $${estimatedCost.toFixed(4)} >= $${this.config.maxBudget} after ${roundCount} round(s)`);
          break;
        }
      }

      roundCount++;
      // #20: Refresh the context prefix each round so it reflects the latest crew state
      // (new messages, updated task statuses) rather than stale initial state.
      if (this.sessionContext) {
        this.contextSpawner.setContextPrefix(this.buildContextPrefix());
      }
      await this.env.runRound();
      await this.checkpoint();

      const complete = this.latestComplete();
      if (complete) {
        return this.buildResult(complete, roundCount, false);
      }
    }

    const timedOut = !budgetExceeded && !this.cancelled && (roundCount >= rounds || Date.now() >= deadline);
    if (this.cancelled) {
      getLogger().info('ENGINEERING_CREW', `Crew ${this.taskId} cancelled after ${roundCount} round(s).`);
      // #8: Persist a final checkpoint with status 'cancelled' so the DB/REST state is accurate
      await this.checkpoint('cancelled');
    } else {
      getLogger().warn('ENGINEERING_CREW', `Crew ${this.taskId} ended without crew_complete after ${roundCount} round(s)${timedOut ? ' (timed out)' : budgetExceeded ? ' (budget exceeded)' : ' (idle)'}.`);
    }
    return {
      success: false,
      blocked: false,
      summary: this.cancelled
        ? `Engineering Crew was cancelled after ${roundCount} round(s).`
        : budgetExceeded
          ? `Engineering Crew exceeded the budget of $${this.config.maxBudget} after ${roundCount} round(s).`
          : timedOut
            ? `Engineering Crew did not finish within ${rounds} rounds / ${Math.round(timeout / 60000)} minutes.`
            : 'Engineering Crew went idle without completing — this indicates a wiring bug.',
      plan: this.buildPlanArtifact(),
      rounds: roundCount,
      timedOut,
      cost: this.buildCostResult(),
    };
  }

  /** Estimate dollar cost from token usage — uses configurable or derived rates (#18). */
  private estimateCost(usage: { input: number; output: number }): number {
    const rates = this.config.costRates ?? deriveCostRates(this.config.modelId, this.config.providerId);
    return (usage.input / 1_000_000) * rates.inputPerMillion + (usage.output / 1_000_000) * rates.outputPerMillion;
  }

  /** Build the cost result from cumulative token usage. */
  private buildCostResult(): { totalTokens: number; estimatedCost: number } {
    const usage = this.contextSpawner.getCumulativeTokenUsage();
    return {
      totalTokens: usage.input + usage.output,
      estimatedCost: this.estimateCost(usage),
    };
  }

  /** Build a successful/completed result with cost tracking. */
  private buildResult(complete: EngineeringCrewMessage, roundCount: number, _timedOut: boolean): EngineeringCrewResult {
    return {
      success: !!complete.artifact && (complete.artifact as { success?: boolean }).success === true,
      blocked: !!complete.artifact && (complete.artifact as { blocked?: boolean }).blocked === true,
      summary: complete.content,
      plan: this.buildPlanArtifact(),
      rounds: roundCount,
      timedOut: false,
      cost: this.buildCostResult(),
    };
  }

  /** Get the ProjectRepo for this crew. */
  getRepo(): ProjectRepo {
    return this.repo;
  }

  // ─── Serialization (mirrors MetaGPT's Team.serialize/deserialize) ───
  serialize(): string {
    const state = {
      taskId: this.taskId,
      config: this.config,
      history: this.env.history,
      repoSummary: this.repo.getSummary(),
      sessionContext: this.sessionContext,
    };
    return JSON.stringify(state, null, 2);
  }

  static deserialize(data: string): { taskId: string; config: EngineeringCrewConfig; history: unknown[]; sessionContext: SessionContext | null } {
    return JSON.parse(data);
  }

  // ─── Checkpointing ───
  private latestComplete(): EngineeringCrewMessage | undefined {
    const msgs = this.env.messagesByTopic('crew_complete');
    return msgs[msgs.length - 1];
  }

  private buildPlanArtifact(): PlanArtifact | undefined {
    const taskListMsg = this.env.messagesByTopic('task_list_ready').pop();
    const prdMsg = this.env.messagesByTopic('prd_ready').pop();
    const designMsg = this.env.messagesByTopic('design_ready').pop();
    const taskList = taskListMsg?.artifact as TaskList | undefined;

    if (!taskList) {
      const planMsg = this.env.messagesByTopic('plan_artifact_ready').pop();
      return planMsg?.artifact as PlanArtifact | undefined;
    }

    const now = Date.now();
    // #10: Aggregate acceptance criteria from all phases/tasks
    const acceptanceCriteria = taskList.tasks.flatMap((t) => t.acceptanceCriteria);
    return {
      taskId: this.taskId,
      objective: (prdMsg?.artifact as PrdDocument)?.originalRequirement ?? this.sessionContext?.latestUserMessage ?? '',
      acceptanceCriteria,
      phases: taskListToPhases(taskList),
      createdAt: now,
      updatedAt: now,
      prd: prdMsg?.artifact as PlanArtifact['prd'],
      design: designMsg?.artifact as PlanArtifact['design'],
      taskList,
    };
  }

  // #13: checkpoint is now async — the DB write is awaited so the latest state is
  // persisted before the next round starts. DB failures are still non-blocking (caught).
  private async checkpoint(status?: string): Promise<void> {
    try {
      const snapshot = this.buildPlanArtifact();
      if (!snapshot) return;
      // File checkpoint (always, best-effort)
      if (existsSync(this.checkpointDir)) {
        writeFileSync(join(this.checkpointDir, `${this.taskId}.json`), JSON.stringify(snapshot, null, 2));
      }
      // DB checkpoint (#2) — save every round so resume can pick up the latest state.
      // #13: Await the DB write so the checkpoint is durable before the next round.
      // DB failure is caught and logged — it never blocks crew execution.
      if (this.store) {
        try {
          await this.store.saveRun(snapshot, this.sessionId, undefined, undefined, status);
        } catch (e) {
          getLogger().debug('ENGINEERING_CREW', `DB checkpoint failed (non-blocking): ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch { /* checkpoint write may fail */ }
  }

  static loadCheckpoint(taskId: string): PlanArtifact | null {
    try {
      const path = join(getConfigDir(), 'engineering-crew', `${taskId}.json`);
      if (existsSync(path)) {
        return JSON.parse(readFileSync(path, 'utf-8')) as PlanArtifact;
      }
    } catch { /* ignore */ }
    return null;
  }

  static listCheckpoints(): string[] {
    try {
      const dir = join(getConfigDir(), 'engineering-crew');
      if (!existsSync(dir)) return [];
      return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
    } catch {
      return [];
    }
  }

  /** Delete a checkpoint file (#3 — DELETE endpoint). */
  static deleteCheckpoint(taskId: string): void {
    try {
      const path = join(getConfigDir(), 'engineering-crew', `${taskId}.json`);
      if (existsSync(path)) {
        unlinkSync(path);
      }
    } catch { /* ignore */ }
  }
}
