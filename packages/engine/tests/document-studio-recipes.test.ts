/**
 * Document Studio — recipe catalog compile tests.
 */

import { describe, it, expect } from 'vitest';
import { compileRecipeToSpec, RECIPE_CATALOG } from '../src/document-studio/recipes/catalog.js';
import { validateJobSpec } from '../src/document-studio/jobspec.js';

describe('Document Studio recipe catalog', () => {
  it('includes R4–R7 recipes', () => {
    const ids = RECIPE_CATALOG.map((r) => r.id);
    for (const id of ['r4', 'r5', 'r6', 'r7']) {
      expect(ids).toContain(id);
    }
  });

  it('R4 skin_author compiles to a valid JobSpec', () => {
    const spec = compileRecipeToSpec('r4', {
      masterIds: { skin_master: 'skin-1', content_master: 'content-1' },
    });
    expect(spec).not.toBeNull();
    const result = validateJobSpec(spec!);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('R5 delta_revise compiles to a valid JobSpec', () => {
    const spec = compileRecipeToSpec('r5', {
      masterIds: { prior_artifact: 'prior-1', new_master: 'new-1' },
    });
    expect(spec).not.toBeNull();
    const result = validateJobSpec(spec!);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('R6 rollup compiles to a valid JobSpec', () => {
    const spec = compileRecipeToSpec('r6', {
      masterIds: { masters: 'm1,m2,m3' },
    });
    expect(spec).not.toBeNull();
    const result = validateJobSpec(spec!);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('R7 validate_only compiles to a valid JobSpec', () => {
    const spec = compileRecipeToSpec('r7');
    expect(spec).not.toBeNull();
    const result = validateJobSpec(spec!);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('R3 standard_author compiles to a valid JobSpec with real-citation steps', () => {
    const spec = compileRecipeToSpec('r3', {
      intent: 'Author an MSA from the playbook standard and deal terms',
      masterIds: {
        standard_master: 'playbook-standard',
        layout_master: 'layout-1',
        kb: 'case-studies,kb-2',
        derived_rules: JSON.stringify([{ key: 'computed_value', formula: 'standard.facts.length' }]),
      },
    });
    expect(spec).not.toBeNull();
    const result = validateJobSpec(spec!);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);

    const ops = spec!.steps.map((s) => s.op);
    expect(ops).toEqual([
      'analyze',
      'analyze',
      'select_evidence',
      'extract_facts',
      'interview',
      'derive',
      'compose',
      'validate',
      'review_gate',
      'review_gate',
      'deliver',
    ]);

    const validate = spec!.steps.find((s) => s.op === 'validate') as { checks: { kind: string }[] } | undefined;
    expect(validate).toBeDefined();
    expect(validate!.checks.map((c) => c.kind)).toEqual(['completeness', 'guideline_sections', 'cite_coverage', 'business_rule']);
  });

  it('R3 standard_author omits layout analysis when no layout master is pinned', () => {
    const spec = compileRecipeToSpec('r3', {
      masterIds: { standard_master: 'playbook-standard', kb: 'kb-1' },
    });
    expect(spec).not.toBeNull();
    const result = validateJobSpec(spec!);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);

    const analyzeSteps = spec!.steps.filter((s) => s.op === 'analyze');
    expect(analyzeSteps).toHaveLength(1);
    expect((analyzeSteps[0] as { masterId: string }).masterId).toBe('playbook-standard');
  });

  it('R2 batch_merge with grouping and master rules compiles to a valid JobSpec', () => {
    const spec = compileRecipeToSpec('r2', {
      intent: 'Batch merge invoices',
      masterIds: {
        data_master: 'csv-invoices',
        layout_master: 'template-default',
        group_by: 'customer_id,region',
        master_rules: JSON.stringify([{ predicate: 'type == "enterprise"', master_id: 'template-enterprise' }]),
        filter: 'exclude: status == "draft"',
        delivery: 'tree+zip',
      },
    });
    expect(spec).not.toBeNull();
    const result = validateJobSpec(spec!);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);

    const analyzeSteps = spec!.steps.filter((s) => s.op === 'analyze');
    expect(analyzeSteps.length).toBeGreaterThanOrEqual(2);
    const analyzeIds = analyzeSteps.map((s) => (s as any).masterId);
    expect(analyzeIds).toContain('csv-invoices');
    expect(analyzeIds).toContain('template-default');
    expect(analyzeIds).toContain('template-enterprise');

    const plan = spec!.steps.find((s) => s.op === 'plan_instances') as any;
    expect(plan).toBeDefined();
    expect(plan.cardinality).toBe('N');
    expect(plan.grouping.map((g: any) => g.key)).toEqual(['customer_id', 'region']);
    expect(plan.masterRules).toHaveLength(1);
    expect(plan.masterRules[0].predicate).toBe('type == "enterprise"');
    expect(plan.masterRules[0].masterId).toBe('template-enterprise');
    expect(plan.filter).toEqual({ kind: 'exclude_predicate', expression: 'status == "draft"' });

    const deliver = spec!.steps.find((s) => s.op === 'deliver') as any;
    expect(deliver.target.kind).toBe('dual');

    const ops = spec!.steps.map((s) => s.op);
    expect(ops).toContain('compose');
    const composeStyles = spec!.steps.filter((s) => s.op === 'compose').map((s: any) => s.style);
    expect(composeStyles).toContain('assemble');
  });

  it('R2 batch_merge skips map_schema when a mapping is pinned', () => {
    const spec = compileRecipeToSpec('r2', {
      masterIds: { data_master: 'csv-1', layout_master: 'tmpl-1', mapping: 'map-1' },
    });
    expect(spec).not.toBeNull();
    const result = validateJobSpec(spec!);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);

    const ops = spec!.steps.map((s) => s.op);
    expect(ops).not.toContain('map_schema');
    expect(spec!.inputs).toContainEqual({ type: 'mapping', mappingId: 'map-1' });
  });

  it('includes R14–R31 extended recipes', () => {
    const ids = RECIPE_CATALOG.map((r) => r.id);
    for (const id of [
      'r14', 'r15', 'r16', 'r17', 'r18', 'r19', 'r20', 'r21', 'r22',
      'r23', 'r24', 'r25', 'r26', 'r27', 'r28', 'r29', 'r30', 'r31',
    ]) {
      expect(ids).toContain(id);
    }
  });

  it('R14–R31 compile to valid JobSpecs', () => {
    const cases: { id: string; params: Record<string, string> }[] = [
      { id: 'r14', params: { data_master: 'csv-1', layout_master: 'tmpl-1', condition: 'amount > 100' } },
      { id: 'r15', params: { data_master: 'csv-1', layout_master: 'tmpl-1', condition: 'status == "active"', group_by: 'region' } },
      { id: 'r16', params: { data_master: 'csv-1', layout_master: 'tmpl-1', master_rules: JSON.stringify([{ predicate: 'type == "enterprise"', master_id: 'tmpl-e' }]) } },
      { id: 'r17', params: { masters: 'm1,m2' } },
      { id: 'r18', params: { masters: 'm1,m2,m3', conflict_strategy: 'union' } },
      { id: 'r19', params: { masters: 'data1,layout1,standard1', conflict_strategy: 'first' } },
      { id: 'r20', params: { prior_artifact: 'source-1', new_master: 'target-1', target_lang: 'es' } },
      { id: 'r21', params: { prior_artifact: 'source-1', redact_terms: 'secret,confidential', watermark_text: 'Draft' } },
      { id: 'r22', params: { prior_artifact: 'source-1', split_marker: '---' } },
      { id: 'r23', params: { target_master: 'target-1' } },
      { id: 'r24', params: { target_master: 'target-1', standard_master: 'std-1' } },
      { id: 'r25', params: { target_master: 'target-1', reference_masters: 'ref-1,ref-2' } },
      { id: 'r26', params: { standard_master: 'std-1', layout_master: 'tmpl-1', approvers: 'alice,bob' } },
      { id: 'r27', params: { data_master: 'csv-1', layout_master: 'tmpl-1', approvers: 'alice,bob' } },
      { id: 'r28', params: { masters: 'm1,m2', approvers: 'alice,bob' } },
      { id: 'r29', params: { kit_masters: 'k1,k2' } },
      { id: 'r30', params: { kit_masters: 'k1,k2,k3' } },
      { id: 'r31', params: { kit_masters: 'k1,k2' } },
    ];
    for (const c of cases) {
      const spec = compileRecipeToSpec(c.id, { masterIds: c.params });
      expect(spec).not.toBeNull();
      const result = validateJobSpec(spec!);
      expect(result.ok).toBe(true);
      expect(result.issues).toEqual([]);
    }
  });
});
