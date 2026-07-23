import { describe, it, expect } from 'vitest';
import { DocumentStudioService } from '../src/document-studio/DocumentStudioService.js';
import { defaultJobPolicies } from '../src/document-studio/jobspec.js';
import type { JobStep, PrimitiveContext } from '../src/document-studio/types.js';

function makeCtx(overrides: Partial<PrimitiveContext> & Record<string, unknown>): PrimitiveContext {
  return { jobId: 'j1', policies: defaultJobPolicies(), ...overrides } as PrimitiveContext;
}

async function derive(
  service: DocumentStudioService,
  ctx: PrimitiveContext,
  rules: { key: string; formula: string }[],
) {
  const step: JobStep = { op: 'derive', rules };
  return (service as any).primitiveDerive(step, ctx);
}

describe('primitiveDerive formulas', () => {
  const service = new DocumentStudioService({ pool: {} as never });

  it('lookup resolves a value from a CSV array in context', async () => {
    const ctx = makeCtx({
      mappedValues: {
        country: 'ca',
        lookupTable: [
          ['country', 'name'],
          ['us', 'United States'],
          ['ca', 'Canada'],
        ],
      },
    });
    const result = await derive(service, ctx, [{ key: 'countryName', formula: 'lookup(country, lookupTable)' }]);
    expect(result.ok).toBe(true);
    expect(result.outputs?.derivedValues['countryName']).toBe('Canada');
  });

  it('lookup resolves a value from an array-of-objects table in context', async () => {
    const ctx = makeCtx({
      mappedValues: {
        code: 'usd',
        rates: [
          { key: 'eur', value: 1.1 },
          { key: 'usd', value: 1.0 },
        ],
      },
    });
    const result = await derive(service, ctx, [{ key: 'rate', formula: 'lookup(code, rates)' }]);
    expect(result.outputs?.derivedValues['rate']).toBe(1.0);
  });

  it('prior.field references prior values', async () => {
    const ctx = makeCtx({ prior: { total: 100 } });
    const result = await derive(service, ctx, [{ key: 'nextTotal', formula: 'prior.total * 1.05' }]);
    expect(result.outputs?.derivedValues['nextTotal']).toBe(105);
  });

  it('prior[\'field\'] references prior values', async () => {
    const ctx = makeCtx({ prior: { total: 100 } });
    const result = await derive(service, ctx, [{ key: 'doubled', formula: "prior['total'] * 2" }]);
    expect(result.outputs?.derivedValues['doubled']).toBe(200);
  });

  it('counter and next derive from ctx.index', async () => {
    const ctx = makeCtx({ index: 3, mappedValues: { base: 100, step: 5 } });
    const result = await derive(service, ctx, [
      { key: 'seq', formula: 'counter(base, step)' },
      { key: 'n', formula: "next('invoice')" },
    ]);
    expect(result.outputs?.derivedValues['seq']).toBe(115);
    expect(result.outputs?.derivedValues['n']).toBe(4);
  });

  it('dateAdd and dateDiff work with ISO date strings', async () => {
    const ctx = makeCtx({ mappedValues: { startDate: '2026-01-15' } });
    const result = await derive(service, ctx, [
      { key: 'endDate', formula: "dateAdd(startDate, 10, 'day')" },
      { key: 'days', formula: "dateDiff('2026-01-25', '2026-01-15', 'day')" },
    ]);
    expect(result.outputs?.derivedValues['endDate']).toEqual(new Date('2026-01-25'));
    expect(result.outputs?.derivedValues['days']).toBe(10);
  });

  it('plain numeric expressions still evaluate', async () => {
    const ctx = makeCtx({ mappedValues: { a: 1, b: 2 } });
    const result = await derive(service, ctx, [{ key: 'sum', formula: 'a + b * 2' }]);
    expect(result.outputs?.derivedValues['sum']).toBe(5);
  });
});

describe('primitiveDerive — forecast formulas (replicate_forecast recipe)', () => {
  const service = new DocumentStudioService({ pool: {} as never });

  it('applies a percentage increment to a prior cell value (e.g. 15% raise)', async () => {
    const ctx = makeCtx({ prior: { basic__april: '93643' } });
    const result = await derive(service, ctx, [
      { key: 'basic__april', formula: "prior['basic__april'] * 1.15" },
    ]);
    expect(result.ok).toBe(true);
    expect(result.outputs?.derivedValues['basic__april']).toBeCloseTo(107689.45, 1);
  });

  it('applies forecast formulas to multiple monthly cells', async () => {
    const ctx = makeCtx({
      prior: {
        basic__april: '93643',
        basic__may: '93643',
        basic__june: '93643',
      },
    });
    const result = await derive(service, ctx, [
      { key: 'basic__april', formula: "prior['basic__april'] * 1.15" },
      { key: 'basic__may', formula: "prior['basic__may'] * 1.15" },
      { key: 'basic__june', formula: "prior['basic__june'] * 1.15" },
    ]);
    expect(result.ok).toBe(true);
    const dv = result.outputs?.derivedValues as Record<string, number>;
    expect(dv['basic__april']).toBeCloseTo(107689.45, 1);
    expect(dv['basic__may']).toBeCloseTo(107689.45, 1);
    expect(dv['basic__june']).toBeCloseTo(107689.45, 1);
  });

  it('computes a TOTAL column as the sum of monthly forecast cells', async () => {
    const ctx = makeCtx({
      prior: {
        basic__april: '93643',
        basic__may: '93643',
        basic__june: '93643',
      },
    });
    const result = await derive(service, ctx, [
      { key: 'basic__april', formula: "prior['basic__april'] * 1.15" },
      { key: 'basic__may', formula: "prior['basic__may'] * 1.15" },
      { key: 'basic__june', formula: "prior['basic__june'] * 1.15" },
      // TOTAL = sum of the 3 forecasted months (referencing the derived values)
      { key: 'basic__total', formula: "prior['basic__april'] * 1.15 + prior['basic__may'] * 1.15 + prior['basic__june'] * 1.15" },
    ]);
    expect(result.ok).toBe(true);
    const dv = result.outputs?.derivedValues as Record<string, number>;
    expect(dv['basic__total']).toBeCloseTo(323068.35, 1);
  });

  it('handles string prior values with commas (e.g. "1,123,716")', async () => {
    const ctx = makeCtx({ prior: { total_earning__total: '1123716' } });
    const result = await derive(service, ctx, [
      { key: 'total_earning__total', formula: "prior['total_earning__total'] * 1.10" },
    ]);
    expect(result.ok).toBe(true);
    expect(result.outputs?.derivedValues['total_earning__total']).toBeCloseTo(1236087.6, 1);
  });

  it('rounds forecast values to whole numbers using Math.round', async () => {
    const ctx = makeCtx({ prior: { basic__april: '93643' } });
    const result = await derive(service, ctx, [
      { key: 'basic__april', formula: "Math.round(prior['basic__april'] * 1.15)" },
    ]);
    expect(result.ok).toBe(true);
    expect(result.outputs?.derivedValues['basic__april']).toBe(107689);
  });
});
