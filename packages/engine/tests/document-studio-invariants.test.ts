/**
 * Document Studio — constitutional invariant tests (spec §2, Phase 0).
 *
 * Violating any of these is a P0 bug. Phase 0 covers the invariants that are
 * enforceable before primitives exist: spec validation (I1 shape, I5),
 * state machine legality (§7.2), and runner refusal to run without primitives.
 */

import { describe, it, expect } from 'vitest';
import { validateJobSpec, defaultJobPolicies, DEFAULT_BATCH_WARNING_THRESHOLD } from '../src/document-studio/jobspec.js';
import { JOB_SPEC_VERSION, type Job, type JobSpec, type JobStatus } from '../src/document-studio/types.js';
import {
  JobRunner,
  canTransition,
  assertTransition,
  JobStateError,
  SpecInvalidError,
  PrimitivesMissingError,
} from '../src/document-studio/runner/JobRunner.js';
import { PrimitiveRegistry, ComposeRegistry } from '../src/document-studio/runner/PrimitiveRegistry.js';
import { analyzeDataBuffer } from '../src/document-studio/masters/analyzers.js';

function validSpec(overrides: Partial<JobSpec> = {}): JobSpec {
  return {
    version: JOB_SPEC_VERSION,
    intent: 'Fill the year-end tax form from an interview',
    inputs: [{ type: 'master', masterId: 'm1', role: 'layout' }],
    steps: [
      { op: 'analyze', masterId: 'm1' },
      { op: 'interview', schema: 'variables', only: 'unresolved_required' },
      { op: 'compose', style: 'fill_clone' },
      { op: 'deliver', target: { kind: 'single', path: 'out/tax-form.pdf' } },
    ],
    policies: defaultJobPolicies(),
    ...overrides,
  };
}

function job(spec: JobSpec, status: JobStatus = 'draft'): Job {
  return {
    id: 'j1',
    title: 't',
    status,
    spec,
    progress: { done: 0, total: 0 },
    artifacts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('JobSpec validation', () => {
  it('accepts a canonical P_fill spec', () => {
    const result = validateJobSpec(validSpec());
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('I5 — inventFacts can never be enabled', () => {
    const spec = validSpec();
    (spec.policies as Record<string, unknown>)['inventFacts'] = true;
    const result = validateJobSpec(spec);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'INVENT_FACTS_FORBIDDEN')).toBe(true);
  });

  it('I5 — defaultJobPolicies cannot override inventFacts (type-level) and defaults are safe', () => {
    const policies = defaultJobPolicies();
    expect(policies.inventFacts).toBe(false);
    expect(policies.missingRequired).toBe('ask');
    expect(policies.overwrite).toBe('fail');
    expect(policies.batchWarningThreshold).toBe(DEFAULT_BATCH_WARNING_THRESHOLD);
  });

  it('I1 — deliver without compose is rejected', () => {
    const spec = validSpec({
      steps: [
        { op: 'analyze', masterId: 'm1' },
        { op: 'deliver', target: { kind: 'single', path: 'out/x.pdf' } },
      ],
    });
    const result = validateJobSpec(spec);
    expect(result.issues.some((i) => i.code === 'DELIVER_WITHOUT_COMPOSE')).toBe(true);
  });

  it('I1 — deliver before compose is rejected', () => {
    const spec = validSpec({
      steps: [
        { op: 'deliver', target: { kind: 'single', path: 'out/x.pdf' } },
        { op: 'compose', style: 'fill_clone' },
      ],
    });
    const result = validateJobSpec(spec);
    expect(result.issues.some((i) => i.code === 'DELIVER_BEFORE_COMPOSE')).toBe(true);
  });

  it('transform compose requires a transformOp; non-transform forbids it', () => {
    const missing = validateJobSpec(validSpec({ steps: [{ op: 'compose', style: 'transform' }] }));
    expect(missing.issues.some((i) => i.path.endsWith('transformOp'))).toBe(true);

    const stray = validateJobSpec(
      validSpec({ steps: [{ op: 'compose', style: 'fill_clone', transformOp: 'redact' }] }),
    );
    expect(stray.issues.some((i) => i.path.endsWith('transformOp'))).toBe(true);
  });

  it('rejects unknown versions, empty intent, and empty steps', () => {
    expect(validateJobSpec({ ...validSpec(), version: 2 }).ok).toBe(false);
    expect(validateJobSpec(validSpec({ intent: ' ' })).ok).toBe(false);
    expect(validateJobSpec(validSpec({ steps: [] })).ok).toBe(false);
    expect(validateJobSpec(null).ok).toBe(false);
  });

  it('collects all issues instead of stopping at the first', () => {
    const spec = validSpec({ intent: '', steps: [{ op: 'compose', style: 'transform' }] });
    (spec.policies as Record<string, unknown>)['inventFacts'] = true;
    const result = validateJobSpec(spec);
    expect(result.issues.length).toBeGreaterThanOrEqual(3);
  });
});

describe('Job state machine (§7.2)', () => {
  it('allows the documented happy paths', () => {
    expect(canTransition('draft', 'compiled')).toBe(true);
    expect(canTransition('compiled', 'awaiting_input')).toBe(true);
    expect(canTransition('awaiting_input', 'compiled')).toBe(true);
    expect(canTransition('compiled', 'dry_run')).toBe(true);
    expect(canTransition('dry_run', 'running')).toBe(true);
    expect(canTransition('running', 'partial')).toBe(true);
    expect(canTransition('running', 'completed')).toBe(true);
    expect(canTransition('partial', 'running')).toBe(true);
    expect(canTransition('compiled', 'cancelled')).toBe(true);
  });

  it('forbids illegal jumps', () => {
    expect(canTransition('draft', 'running')).toBe(false);
    expect(canTransition('draft', 'completed')).toBe(false);
    expect(canTransition('completed', 'running')).toBe(false);
    expect(canTransition('cancelled', 'running')).toBe(false);
    expect(() => assertTransition('completed', 'running')).toThrow(JobStateError);
  });
});

describe('JobRunner (Phase 0 shell)', () => {
  const runner = new JobRunner(new PrimitiveRegistry());

  it('compile validates the spec and transitions draft → compiled', () => {
    const compiled = runner.compile(job(validSpec()));
    expect(compiled.status).toBe('compiled');
  });

  it('compile rejects an invalid spec (never persists a broken compiled job)', () => {
    const spec = validSpec();
    (spec.policies as Record<string, unknown>)['inventFacts'] = true;
    expect(() => runner.compile(job(spec))).toThrow(SpecInvalidError);
  });

  it('I12 — run refuses when primitives are missing instead of improvising', async () => {
    const compiled = runner.compile(job(validSpec()));
    await expect(runner.run(compiled)).rejects.toThrow(PrimitivesMissingError);
    await expect(runner.run(compiled)).rejects.toMatchObject({
      missingOps: expect.arrayContaining(['analyze', 'interview', 'compose', 'deliver']),
    });
  });

  it('cancel only from legal states', () => {
    expect(runner.cancel(job(validSpec(), 'running')).status).toBe('cancelled');
    expect(() => runner.cancel(job(validSpec(), 'completed'))).toThrow(JobStateError);
  });
});

describe('ComposeRegistry (compile-time adapter rejection §7.4)', () => {
  it('reports unsupported style+format combinations', () => {
    const registry = new ComposeRegistry();
    expect(registry.supports('fill_clone', 'docx')).toBe(false);
    registry.register({
      style: 'fill_clone',
      formats: ['docx', 'pdf', 'xlsx'],
      compose: async () => ({ bytes: new Uint8Array(), format: 'docx', warnings: [] }),
    });
    expect(registry.supports('fill_clone', 'docx')).toBe(true);
    expect(registry.supports('fill_clone', 'pptx')).toBe(false);
    expect(registry.supports('author', 'docx')).toBe(false);
  });
});

describe('I9 — PII payroll/table misclassification guardrails', () => {
  it('flags PII/payroll columns by header during data profiling', () => {
    const csv = 'name,ssn,dob,salary,bank_account,active\nAlice,123-45-6789,1990-01-01,85000,12345678,true\nBob,987-65-4321,1985-06-15,92000,87654321,false\n';
    const outcome = analyzeDataBuffer(Buffer.from(csv), 'payroll.csv');
    expect(outcome.state).toBe('ready');
    const byName = Object.fromEntries((outcome.analysis?.dataProfile?.columns ?? []).map((c) => [c.name, c]));
    expect(byName['ssn']?.sensitivity).toBe('pii');
    expect(byName['dob']?.sensitivity).toBe('pii');
    expect(byName['salary']?.sensitivity).toBe('financial');
    expect(byName['bank_account']?.sensitivity).toBe('financial');
    expect(byName['name']?.sensitivity).toBeUndefined();
  });
});
