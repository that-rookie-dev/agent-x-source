import { describe, it, expect, vi } from 'vitest';
import { DocumentStudioService } from '../src/document-studio/DocumentStudioService.js';
import { JobRunner } from '../src/document-studio/runner/JobRunner.js';
import { PrimitiveRegistry } from '../src/document-studio/runner/PrimitiveRegistry.js';
import { defaultJobPolicies } from '../src/document-studio/jobspec.js';
import { JOB_SPEC_VERSION, type Job, type JobSpec, type JobStep, type Master, type PrimitiveContext } from '../src/document-studio/types.js';

function makeSpec(overrides: Partial<JobSpec> = {}): JobSpec {
  return {
    version: JOB_SPEC_VERSION,
    intent: 'test job',
    inputs: [],
    steps: [],
    policies: defaultJobPolicies(),
    ...overrides,
  };
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'j1',
    title: 'test',
    status: 'partial',
    spec: makeSpec(),
    progress: { done: 0, total: 0 },
    artifacts: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('executePrimitive checkpoint persistence', () => {
  it('updates doc_jobs with status/progress/spec/stepResults/artifacts/error after each primitive', async () => {
    const service = new DocumentStudioService({ pool: {} as never });
    const update = vi.fn().mockResolvedValue({ id: 'j1' });
    (service as any).jobs = { update };

    const spec = makeSpec();
    const step: JobStep = { op: 'derive', rules: [{ key: 'b', formula: 'a + 1' }] };
    const ctx = {
      jobId: 'j1',
      policies: defaultJobPolicies(),
      answers: { a: 1 },
      __checkpoint: { stepIndex: 0, total: 2, stepResults: { '1': { ok: true } } as any, spec },
    } as unknown as PrimitiveContext;

    const result = await service.executePrimitive(step, ctx);
    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledTimes(2);

    // Before-step checkpoint.
    expect(update.mock.calls[0]![0]).toBe('j1');
    expect(update.mock.calls[0]![1]).toMatchObject({
      status: 'running',
      progress: { done: 0, total: 2 },
      spec,
    });

    // After-step checkpoint.
    expect(update.mock.calls[1]![0]).toBe('j1');
    expect(update.mock.calls[1]![1]).toMatchObject({
      status: 'running',
      progress: { done: 1, total: 2 },
      spec,
    });
    const persisted = (update.mock.calls[1]![1] as { stepResults: Record<string, unknown> }).stepResults;
    expect(persisted).toHaveProperty('0');
    expect((persisted as any)['0'].ok).toBe(true);
    expect((persisted as any)['0'].outputs.derivedValues).toEqual({ a: 1, b: 2 });
  });
});

describe('JobRunner resume', () => {
  it('skips completed steps when resumeFromStep is set and resumes context', async () => {
    const executed: number[] = [];
    const runtime = {
      workspaceRoot: '/tmp',
      executePrimitive: async (_step: JobStep, ctx: PrimitiveContext) => {
        executed.push(Number((ctx as Record<string, unknown>)['__checkpoint']?.['stepIndex']));
        return { ok: true, outputs: { finished: true } } as any;
      },
    };
    const registry = new PrimitiveRegistry();
    registry.register('analyze', async () => ({ ok: true, outputs: {} }) as any);
    registry.register('derive', runtime.executePrimitive as any);
    const runner = new JobRunner(registry, runtime);

    const spec = makeSpec({
      steps: [
        { op: 'analyze', masterId: 'm1' },
        { op: 'derive', rules: [{ key: 'c', formula: 'b + 1' }] },
      ],
    });
    const job = makeJob({
      status: 'partial',
      spec,
      progress: { done: 0, total: 2 },
      stepResults: {
        '0': { ok: true, outputs: { master: { id: 'm1' } as any, b: 1 } },
      } as any,
    });

    const ran = await runner.run(job, {}, { resumeFromStep: 1 });
    expect(executed).toEqual([1]);
    expect(ran.status).toBe('completed');
  });
});

describe('cooperative cancel', () => {
  it('stops processing and sets job status to CANCELLED when aborted', async () => {
    const runtime = {
      workspaceRoot: '/tmp',
      executePrimitive: async (_step: JobStep, ctx: PrimitiveContext) => {
        if (ctx.signal?.aborted) {
          return { ok: false, error: { code: 'CANCELLED', message: 'aborted' } };
        }
        return { ok: true };
      },
    };
    const registry = new PrimitiveRegistry();
    registry.register('derive', runtime.executePrimitive as any);
    const runner = new JobRunner(registry, runtime);
    const controller = new AbortController();
    controller.abort();

    const spec = makeSpec({ steps: [{ op: 'derive', rules: [{ key: 'x', formula: '1' }] }] });
    const job = makeJob({ status: 'partial', spec, progress: { done: 0, total: 1 } });

    const ran = await runner.run(job, {}, { signal: controller.signal });
    expect(ran.status).toBe('cancelled');
  });

  it('cancelJob sets cancelled flag and cancelledAt in JobStore', async () => {
    const service = new DocumentStudioService({ pool: {} as never });
    const update = vi.fn().mockResolvedValue({ id: 'j1' });
    (service as any).jobs = {
      get: vi.fn().mockResolvedValue(makeJob({ status: 'partial' })),
      update,
    };

    await service.cancelJob('j1');
    expect(update).toHaveBeenCalledWith(
      'j1',
      expect.objectContaining({
        status: 'cancelled',
        cancelled: true,
        cancelledAt: expect.any(String),
        error: 'Cancelled by user',
      }),
    );
  });
});

describe('batch compose concurrency', () => {
  it('limits concurrent workers and tracks instance statuses', async () => {
    const service = new DocumentStudioService({ pool: {} as never });
    let running = 0;
    let maxRunning = 0;
    const composeFn = vi.fn(async (_input: any) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 25));
      running--;
      return { bytes: new Uint8Array([1]), format: 'json', warnings: [] };
    });
    service.composeAdapters.register({ style: '__test__' as any, formats: ['__test__' as any], compose: composeFn } as any);

    const instances = Array.from({ length: 5 }, (_, i) => ({
      id: `i${i}`,
      index: i,
      status: 'planned',
    }));
    const updateStatus = vi.fn().mockResolvedValue({});
    (service as any).instances = { getByJob: vi.fn().mockResolvedValue(instances), updateStatus };

    const master = { id: 'm1', format: '__test__' as any, analysis: { variables: [] } } as Master;
    const step: JobStep = { op: 'compose', style: '__test__' as any };
    const ctx = {
      jobId: 'j1',
      policies: { ...defaultJobPolicies(), maxInstances: 2, pii: 'allow' },
      master,
      instances: Array.from({ length: 5 }, (_, i) => ({ index: i, values: { x: i }, path: `out/${i}.json` })),
    } as any;

    const result = await (service as any).primitiveCompose(step, ctx);
    expect(result.ok).toBe(true);
    expect(composeFn).toHaveBeenCalledTimes(5);
    expect(maxRunning).toBeLessThanOrEqual(2);

    const calls = updateStatus.mock.calls as [string, string][];
    const pending = calls.filter(([, s]) => s === 'pending').length;
    const runningCalls = calls.filter(([, s]) => s === 'running').length;
    const completed = calls.filter(([, s]) => s === 'completed').length;
    expect(pending).toBe(5);
    expect(runningCalls).toBe(5);
    expect(completed).toBe(5);
  });

  it('resumes by skipping completed or delivered instances', async () => {
    const service = new DocumentStudioService({ pool: {} as never });
    const composeFn = vi.fn().mockResolvedValue({ bytes: new Uint8Array([1]), format: 'json', warnings: [] });
    service.composeAdapters.register({ style: '__test__' as any, formats: ['__test__' as any], compose: composeFn } as any);

    const instances = [
      { id: 'i0', index: 0, status: 'completed' },
      { id: 'i1', index: 1, status: 'delivered' },
      { id: 'i2', index: 2, status: 'planned' },
      { id: 'i3', index: 3, status: 'failed' },
    ];
    const updateStatus = vi.fn().mockResolvedValue({});
    (service as any).instances = { getByJob: vi.fn().mockResolvedValue(instances), updateStatus };

    const master = { id: 'm1', format: '__test__' as any, analysis: { variables: [] } } as Master;
    const step: JobStep = { op: 'compose', style: '__test__' as any };
    const ctx = {
      jobId: 'j1',
      policies: { ...defaultJobPolicies(), maxInstances: 5, pii: 'allow' },
      master,
      instances: Array.from({ length: 4 }, (_, i) => ({ index: i, values: { x: i }, path: `out/${i}.json` })),
    } as any;

    const result = await (service as any).primitiveCompose(step, ctx);
    expect(result.ok).toBe(true);
    expect(composeFn).toHaveBeenCalledTimes(2);
  });
});
