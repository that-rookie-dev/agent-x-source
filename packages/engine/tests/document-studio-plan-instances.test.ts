import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentStudioService } from '../src/document-studio/DocumentStudioService.js';
import { defaultJobPolicies } from '../src/document-studio/jobspec.js';
import type { JobStep, PrimitiveContext, Master } from '../src/document-studio/types.js';

const mocks = vi.hoisted(() => ({
  getBuffer: vi.fn(),
}));

vi.mock('../src/attachments/index.js', () => ({
  getAttachmentService: () => ({ getBuffer: mocks.getBuffer }),
}));

function makeCtx(overrides: Partial<PrimitiveContext> & Record<string, unknown> = {}): PrimitiveContext {
  return { jobId: 'j1', policies: defaultJobPolicies(), ...overrides } as PrimitiveContext;
}

function makeDataMaster(): Master {
  return {
    id: 'dm1',
    name: 'data.csv',
    kind: 'data',
    format: 'csv',
    mimeType: 'text/csv',
    storageId: 's1',
    checksum: 'c1',
    version: 1,
    analysis: null,
    analysisState: 'ready',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as Master;
}

function makeLayoutMaster(id = 'lm1'): Master {
  return {
    id,
    name: 'template.docx',
    kind: 'layout',
    format: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    storageId: 's2',
    checksum: 'c2',
    version: 1,
    analysis: null,
    analysisState: 'ready',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as Master;
}

function planStep(overrides: Partial<JobStep> = {}): JobStep {
  return { op: 'plan_instances', cardinality: 'N', naming: 'out/{{index}}.pdf', ...overrides } as JobStep;
}

async function planInstances(service: DocumentStudioService, ctx: PrimitiveContext, step?: JobStep) {
  return (service as any).primitivePlanInstances(step ?? planStep(), ctx);
}

describe('primitivePlanInstances', () => {
  let service: DocumentStudioService;

  beforeEach(() => {
    service = new DocumentStudioService({ pool: {} as never });
    (service as any).instances = { create: vi.fn().mockResolvedValue({ id: 'i1' }) };
    mocks.getBuffer.mockReset();
  });

  it('plans one instance per CSV row', async () => {
    const csv = 'name,amount\nAlice,100\nBob,200\n';
    mocks.getBuffer.mockResolvedValue(Buffer.from(csv));
    const ctx = makeCtx({ dataMaster: makeDataMaster(), master: makeLayoutMaster() });
    const result = await planInstances(service, ctx);
    expect(result.ok).toBe(true);
    const instances = (result.outputs as any).instances;
    expect(instances).toHaveLength(2);
    expect(instances[0]).toMatchObject({ index: 0, masterId: 'lm1', path: 'out/0.pdf' });
    expect(instances[1]).toMatchObject({ index: 1, masterId: 'lm1', path: 'out/1.pdf' });
    expect((service as any).instances.create).toHaveBeenCalledTimes(2);
    expect((service as any).instances.create).toHaveBeenLastCalledWith(
      'j1',
      1,
      expect.objectContaining({ status: 'planned' }),
    );
  });

  it('groups rows by grouping keys and emits one instance per group', async () => {
    const csv = 'customer_id,region,amount\n1,US,100\n1,US,200\n2,EU,300\n';
    mocks.getBuffer.mockResolvedValue(Buffer.from(csv));
    const ctx = makeCtx({ dataMaster: makeDataMaster(), master: makeLayoutMaster() });
    const step = planStep({
      grouping: [
        { key: 'customer_id', as: 'customer' },
        { key: 'region', as: 'region' },
      ],
      naming: 'out/{{customer}}/{{region}}/{{index}}.pdf',
    });
    const result = await planInstances(service, ctx, step);
    expect(result.ok).toBe(true);
    const instances = (result.outputs as any).instances;
    expect(instances).toHaveLength(2);
    expect(instances[0].path).toBe('out/1/US/0.pdf');
    expect(instances[1].path).toBe('out/2/EU/1.pdf');
    expect(instances[0].values).toMatchObject({ customer: '1', region: 'US', amount: '100', customer_id: '1' });
    expect(instances[1].values).toMatchObject({ customer: '2', region: 'EU', amount: '300' });
    expect((service as any).instances.create).toHaveBeenCalledWith(
      'j1',
      0,
      expect.objectContaining({ status: 'grouped' }),
    );
  });

  it('applies masterRules to choose conditional layout masters', async () => {
    const csv = 'type,amount\nenterprise,100\nbasic,200\n';
    mocks.getBuffer.mockResolvedValue(Buffer.from(csv));
    const ctx = makeCtx({ dataMaster: makeDataMaster(), master: makeLayoutMaster('default') });
    const step = planStep({ masterRules: [{ predicate: 'type == "enterprise"', masterId: 'enterprise' }] });
    const result = await planInstances(service, ctx, step);
    expect(result.ok).toBe(true);
    const instances = (result.outputs as any).instances;
    expect(instances[0].masterId).toBe('enterprise');
    expect(instances[1].masterId).toBe('default');
  });

  it('filters rows with exclude_predicate and persists filtered rows', async () => {
    const csv = 'status,amount\ndraft,100\nfinal,200\n';
    mocks.getBuffer.mockResolvedValue(Buffer.from(csv));
    const ctx = makeCtx({ dataMaster: makeDataMaster(), master: makeLayoutMaster() });
    const step = planStep({ filter: { kind: 'exclude_predicate', expression: 'status == "draft"' } });
    const result = await planInstances(service, ctx, step);
    expect(result.ok).toBe(true);
    const instances = (result.outputs as any).instances;
    expect(instances).toHaveLength(1);
    expect(instances[0].values.status).toBe('final');
    const createCalls = (service as any).instances.create.mock.calls;
    expect(createCalls).toHaveLength(2);
    expect(createCalls[0][2]).toMatchObject({ status: 'filtered' });
    expect(createCalls[1][2]).toMatchObject({ status: 'planned' });
  });

  it('warns on payroll/person tables when pii policy is allow and still proceeds', async () => {
    const lines = ['name,ssn,salary,department'];
    for (let i = 0; i < 12; i++) lines.push(`Person ${i},123-45-${1000 + i},${50000 + i},Engineering`);
    mocks.getBuffer.mockResolvedValue(Buffer.from(lines.join('\n') + '\n'));
    const ctx = makeCtx({ dataMaster: makeDataMaster(), master: makeLayoutMaster() });
    const result = await planInstances(service, ctx);
    expect(result.ok).toBe(true);
    expect((result.outputs as any).piiWarning).toContain('payroll');
    expect((result.outputs as any).instanceCount).toBe(12);
  });

  it('refuses to plan instances when pii policy is refuse_export and table looks like payroll', async () => {
    const lines = ['name,ssn,salary,department'];
    for (let i = 0; i < 12; i++) lines.push(`Person ${i},123-45-${1000 + i},${50000 + i},Engineering`);
    mocks.getBuffer.mockResolvedValue(Buffer.from(lines.join('\n') + '\n'));
    const policies = defaultJobPolicies();
    policies.pii = 'refuse_export';
    const ctx = makeCtx({ dataMaster: makeDataMaster(), master: makeLayoutMaster(), policies });
    const result = await planInstances(service, ctx);
    expect(result.ok).toBe(false);
    expect((result.error as any).code).toBe('PII_REFUSED');
  });
});
