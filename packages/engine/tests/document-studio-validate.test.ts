import { describe, it, expect } from 'vitest';
import { DocumentStudioService } from '../src/document-studio/DocumentStudioService.js';
import { defaultJobPolicies } from '../src/document-studio/jobspec.js';
import type { JobStep, PrimitiveContext } from '../src/document-studio/types.js';

function makeCtx(overrides: Partial<PrimitiveContext> & Record<string, unknown>): PrimitiveContext {
  return { jobId: 'j1', policies: defaultJobPolicies(), ...overrides } as PrimitiveContext;
}

async function validate(
  service: DocumentStudioService,
  ctx: PrimitiveContext,
  checks: { kind: string; spec?: Record<string, unknown> }[],
) {
  const step: JobStep = { op: 'validate', checks } as any;
  return (service as any).primitiveValidate(step, ctx);
}

describe('primitiveValidate deep checks', () => {
  const service = new DocumentStudioService({ pool: {} as never });

  describe('cite_coverage', () => {
    it('passes when claims have inline citation markers', async () => {
      const ctx = makeCtx({
        draft: 'Revenue grew 12% this quarter [earnings]. Operating margin improved [report].',
        facts: [],
        evidence: [],
        policies: { ...defaultJobPolicies(), citations: 'required' },
      });
      const result = await validate(service, ctx, [{ kind: 'cite_coverage' }]);
      expect(result.ok).toBe(true);
      expect(result.outputs.validationErrors).toEqual([]);
    });

    it('flags claims with no citation and no evidence overlap', async () => {
      const ctx = makeCtx({
        draft: 'Mars is the fourth planet from the Sun. It has two moons named Phobos and Deimos.',
        facts: [{ text: 'Company revenue hit 5 million in 2025' }],
        policies: { ...defaultJobPolicies(), citations: 'required' },
      });
      const result = await validate(service, ctx, [{ kind: 'cite_coverage' }]);
      expect(result.ok).toBe(false);
      expect(result.outputs.validationErrors.some((e: string) => e.includes('Uncited claim'))).toBe(true);
    });

    it('accepts claims supported by fact phrase overlap', async () => {
      const ctx = makeCtx({
        draft: 'Company revenue hit 5 million in 2025. This remains a highlight.',
        facts: [{ text: 'Company revenue hit 5 million in 2025' }],
        policies: { ...defaultJobPolicies(), citations: 'required' },
      });
      const result = await validate(service, ctx, [{ kind: 'cite_coverage' }]);
      expect(result.ok).toBe(true);
      expect(result.outputs.validationErrors).toEqual([]);
    });
  });

  describe('guideline_sections', () => {
    it('reports missing required sections', async () => {
      const ctx = makeCtx({
        draft: '# Introduction\n# Scope',
        master: { analysis: { requiredSections: [{ title: 'Introduction' }, { title: 'Scope' }, { title: 'Conclusion' }] } },
      });
      const result = await validate(service, ctx, [{ kind: 'guideline_sections' }]);
      expect(result.ok).toBe(false);
      expect(result.outputs.validationErrors).toContain('Missing required section: Conclusion');
    });

    it('reports unexpected extra sections as warnings', async () => {
      const ctx = makeCtx({
        draft: '# Introduction\n# Scope\n# Appendix',
        master: { analysis: { requiredSections: [{ title: 'Introduction' }, { title: 'Scope' }] } },
      });
      const result = await validate(service, ctx, [{ kind: 'guideline_sections' }]);
      expect(result.ok).toBe(true);
      expect(result.outputs.validationWarnings).toContain('Unexpected extra section: Appendix');
    });

    it('fuzzy matches required section titles', async () => {
      const ctx = makeCtx({
        draft: '# Intro\n# Scope of Work',
        master: { analysis: { requiredSections: [{ title: 'Introduction' }, { title: 'Scope' }] } },
      });
      const result = await validate(service, ctx, [{ kind: 'guideline_sections' }]);
      expect(result.ok).toBe(true);
      expect(result.outputs.validationErrors).toEqual([]);
    });
  });

  describe('cross_doc', () => {
    it('passes when shared keys are consistent across instances', async () => {
      const ctx = makeCtx({
        instances: [
          { values: { total: 100, date: '2025-01-01' } },
          { values: { total: 100, date: '2025-01-01' } },
        ],
      });
      const result = await validate(service, ctx, [{ kind: 'cross_doc' }]);
      expect(result.ok).toBe(true);
    });

    it('flags contradictions across instances', async () => {
      const ctx = makeCtx({
        instances: [
          { values: { total: 100, date: '2025-01-01' } },
          { values: { total: 200, date: '2025-01-01' } },
        ],
      });
      const result = await validate(service, ctx, [{ kind: 'cross_doc' }]);
      expect(result.ok).toBe(false);
      expect(result.outputs.validationErrors.some((e: string) => e.startsWith('Cross-doc mismatch on total'))).toBe(true);
    });

    it('respects keys spec', async () => {
      const ctx = makeCtx({
        instances: [
          { values: { total: 100, date: '2025-01-01' } },
          { values: { total: 200, date: '2025-01-01' } },
        ],
      });
      const result = await validate(service, ctx, [{ kind: 'cross_doc', spec: { keys: ['total'] } }]);
      expect(result.ok).toBe(false);
      expect(result.outputs.validationErrors.some((e: string) => e.includes('total'))).toBe(true);
    });
  });

  describe('business_rule', () => {
    it('evaluates arithmetic and comparison rules', async () => {
      const ctx = makeCtx({ mappedValues: { a: 10, b: 20 } });
      const result = await validate(service, ctx, [{ kind: 'business_rule', spec: { rule: 'a + b * 2 > 25' } }]);
      expect(result.ok).toBe(true);
    });

    it('supports object rules with custom message', async () => {
      const ctx = makeCtx({ mappedValues: { a: 5 } });
      const result = await validate(service, ctx, [
        { kind: 'business_rule', spec: { rule: { expression: 'a > 10', message: 'a is too small' } } },
      ]);
      expect(result.ok).toBe(false);
      expect(result.outputs.validationErrors).toContain('a is too small');
    });

    it('supports and/or/not logic', async () => {
      const ctx = makeCtx({ mappedValues: { a: 5, b: 100 } });
      const result = await validate(service, ctx, [
        { kind: 'business_rule', spec: { rule: 'a > 0 and (b < 50 or not b > 200)' } },
      ]);
      expect(result.ok).toBe(true);
    });

    it('compares strings', async () => {
      const ctx = makeCtx({ mappedValues: { status: 'active' } });
      const result = await validate(service, ctx, [{ kind: 'business_rule', spec: { rule: 'status == "active"' } }]);
      expect(result.ok).toBe(true);
    });
  });
});
