/**
 * Document Studio — Job state machine + primitive runner (spec §7).
 *
 * Phase 3: execution loop over primitives. Each step returns an output map
 * stored in stepResults for later steps; gates and interview pause the job.
 */

import type { Job, JobStatus, JobStep } from '../types.js';
import { validateJobSpec } from '../jobspec.js';
import type { PrimitiveRegistry, PrimitiveContext, PrimitiveResult } from './PrimitiveRegistry.js';

/** Legal transitions per spec §7.2. */
const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  draft: ['compiled', 'cancelled'],
  compiled: ['awaiting_input', 'dry_run', 'running', 'cancelled'],
  awaiting_input: ['compiled', 'running', 'dry_run', 'cancelled'],
  dry_run: ['awaiting_input', 'running', 'cancelled', 'failed'],
  running: ['partial', 'completed', 'failed', 'awaiting_input', 'cancelled'],
  partial: ['running', 'cancelled'],
  completed: [],
  failed: ['running'],
  cancelled: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) throw new JobStateError(from, to);
}

export class JobStateError extends Error {
  readonly code = 'ILLEGAL_TRANSITION';
  constructor(readonly from: JobStatus, readonly to: JobStatus) {
    super(`Illegal job transition: ${from} → ${to}`);
  }
}

export class SpecInvalidError extends Error {
  readonly code = 'SPEC_INVALID';
  constructor(detail: string) { super(`JobSpec invalid: ${detail}`); }
}

export class PrimitivesMissingError extends Error {
  readonly code = 'PRIMITIVES_MISSING';
  constructor(public readonly missingOps: string[]) { super(`Missing primitives: ${missingOps.join(', ')}`); }
}

export interface JobRunnerRuntime {
  /** Execute a single primitive step. */
  executePrimitive(step: JobStep, ctx: PrimitiveContext): Promise<PrimitiveResult>;
  workspaceRoot: string;
}

export interface JobRunnerEvents {
  onStatus?: (job: Job, previous: JobStatus) => void;
  onProgress?: (job: Job) => void;
  onGate?: (job: Job, step: JobStep) => void;
}

const DUMMY_RUNTIME: JobRunnerRuntime = {
  executePrimitive: async () => ({ ok: true }),
  workspaceRoot: process.cwd(),
};

/** Durable job executor. */
export class JobRunner {
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(
    private readonly primitives: PrimitiveRegistry,
    private readonly runtime: JobRunnerRuntime = DUMMY_RUNTIME,
    private readonly events: JobRunnerEvents = {},
  ) {}

  compile(job: Job): Job {
    assertTransition(job.status, 'compiled');
    const result = validateJobSpec(job.spec);
    if (!result.ok) throw new SpecInvalidError(result.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
    return this.transition(job, 'compiled');
  }

  async run(
    job: Job,
    seedContext: Record<string, unknown> = {},
    options: { signal?: AbortSignal; resumeFromStep?: number } = {},
  ): Promise<Job> {
    assertTransition(job.status, 'running');

    // I12 — never improvise when primitives are missing.
    const missing = job.spec.steps.map((s) => s.op).filter((op) => !this.primitives.has(op));
    const unique = [...new Set(missing)];
    if (unique.length > 0) throw new PrimitivesMissingError(unique);

    let current = this.transition(job, 'running');

    const controller = new AbortController();
    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    this.abortControllers.set(job.id, controller);

    const persisted = (job.stepResults as Record<string, { ok: boolean; outputs?: Record<string, unknown> }>) ?? {};
    const ctx: Record<string, unknown> = { ...seedContext };

    // Rehydrate context from persisted completed steps.
    for (let i = 0; i < current.spec.steps.length; i++) {
      const prev = persisted[String(i)];
      if (prev?.outputs) Object.assign(ctx, prev.outputs);
    }

    const resumeFromStep = options.resumeFromStep ?? 0;
    const total = current.spec.steps.length;

    try {
      for (let i = 0; i < total; i++) {
        if (controller.signal.aborted) {
          current = this.transition(current, 'cancelled');
          return current;
        }

        if (i < resumeFromStep) continue;

        const step = current.spec.steps[i]!;
        const stepCtx: PrimitiveContext = {
          ...ctx,
          jobId: current.id,
          policies: current.spec.policies,
          intent: current.spec.intent,
          signal: controller.signal,
          __checkpoint: { stepIndex: i, total, stepResults: persisted, spec: current.spec },
        };

        const result = await this.runtime.executePrimitive(step, stepCtx);

        current = { ...current, progress: { ...current.progress, done: i + 1, total } };
        this.events.onProgress?.(current);

        if (result.outputs) {
          Object.assign(ctx, result.outputs);
        }
        persisted[String(i)] = result;

        // Interview / gate pause → awaiting_input
        if (!result.ok && result.error?.code === 'AWAITING_INPUT') {
          current = this.transition(current, 'awaiting_input');
          current = { ...current, progress: { ...current.progress, detail: result.error.message } };
          this.events.onGate?.(current, step);
          return current;
        }

        if (!result.ok) {
          if (result.error?.code === 'CANCELLED') {
            current = this.transition(current, 'cancelled');
            return current;
          }
          current = this.transition(current, 'failed');
          throw new Error(`${step.op} failed: ${result.error?.message ?? 'unknown'}`);
        }
      }

      return this.transition(current, 'completed');
    } finally {
      this.abortControllers.delete(job.id);
    }
  }

  cancel(job: Job): Job;
  cancel(id: string): void;
  cancel(jobOrId: Job | string): Job | void {
    if (typeof jobOrId === 'string') {
      this.abortControllers.get(jobOrId)?.abort();
      return;
    }
    assertTransition(jobOrId.status, 'cancelled');
    return this.transition(jobOrId, 'cancelled');
  }

  private transition(job: Job, to: JobStatus): Job {
    const previous = job.status;
    const next: Job = { ...job, status: to, updatedAt: new Date().toISOString() };
    this.events.onStatus?.(next, previous);
    return next;
  }
}
