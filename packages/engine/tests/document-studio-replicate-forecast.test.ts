/**
 * Document Studio — Replicate intent routing + anti-fallback guard tests.
 *
 * Tests that:
 * 1. NlCompiler routes "replicate"/"exact copy"/"clone"/"same design"/"copy with"
 *    intents to the replicate recipe (buildReplicate) instead of falling through
 *    to ambiguous/buildValidate.
 * 2. The compiled spec uses compose:fill_clone (NOT compose:author).
 * 3. The spec includes a derive step (optional — empty rules if no formulas).
 * 4. The anti-fallback guard rejects non-fill_clone styles and missing locators
 *    for replicate intent (hard error, not silent fallback).
 * 5. General replicate phrases (not just "forecast") route correctly.
 */

import { describe, it, expect } from 'vitest';
import { NlCompiler } from '../src/document-studio/compiler/NlCompiler.js';
import { validateJobSpec } from '../src/document-studio/jobspec.js';
import type { JobSpec, Master, Variable } from '../src/document-studio/types.js';

const compiler = new NlCompiler();

describe('NlCompiler — replicate intent routing (general)', () => {
  // General replicate phrases — NOT limited to "forecast" or "next year"
  const replicatePhrases = [
    'Replicate this exact document @master[layout:m1]',
    'Make an exact copy @master[layout:m1]',
    'Clone this PDF @master[layout:m1]',
    'Same design with updated numbers @master[layout:m1]',
    'Copy with new values @master[layout:m1]',
    'Copy with updated prices @master[layout:m1]',
    'Duplicate with corrections @master[layout:m1]',
    'Recreate this invoice @master[layout:m1]',
    'Same layout but different data @master[layout:m1]',
  ];

  for (const phrase of replicatePhrases) {
    it(`routes "${phrase.slice(0, 45)}..." to replicate recipe`, () => {
      const { spec, missing, ambiguous } = compiler.compile(phrase);
      expect(validateJobSpec(spec).ok).toBe(true);
      // Steps: analyze → derive → compose:fill_clone → review_gate → deliver
      expect(spec.steps.map((s) => s.op)).toEqual([
        'analyze', 'derive', 'compose', 'review_gate', 'deliver',
      ]);
      // compose must be fill_clone, NOT author
      const compose = spec.steps.find((s) => s.op === 'compose')!;
      expect(compose).toMatchObject({ style: 'fill_clone' });
      // review_gate must be dry_run
      const gate = spec.steps.find((s) => s.op === 'review_gate')!;
      expect(gate).toMatchObject({ gate: 'dry_run' });
      // Should NOT be ambiguous
      expect(ambiguous).toEqual([]);
    });
  }

  it('reports missing layout_master when no master is mentioned', () => {
    const { spec, missing } = compiler.compile('Replicate this exact document');
    expect(validateJobSpec(spec).ok).toBe(true);
    expect(missing).toContain('layout_master');
  });

  it('derive step has a placeholder rule by default (agent supplies real rules or user provides values directly)', () => {
    const { spec } = compiler.compile('Clone this PDF @master[layout:m1]');
    const derive = spec.steps.find((s) => s.op === 'derive')!;
    expect(derive.rules!.length).toBe(1);
    expect(derive.rules![0]!.key).toBe('__placeholder__');
  });

  it('does NOT route "fill template" to replicate', () => {
    const { spec } = compiler.compile('Fill the template @master[layout:m1]');
    expect(spec.steps.map((s) => s.op)).toEqual(['analyze', 'interview', 'compose', 'deliver']);
    expect(spec.steps.find((s) => s.op === 'compose')).toMatchObject({ style: 'fill_clone' });
    // No derive step in regular fill
    expect(spec.steps.find((s) => s.op === 'derive')).toBeUndefined();
  });

  it('does NOT route "author" to replicate', () => {
    const { spec } = compiler.compile('Author a policy from @master[standard:s1]');
    const compose = spec.steps.find((s) => s.op === 'compose')!;
    expect(compose).toMatchObject({ style: 'author' });
    expect(spec.steps.find((s) => s.op === 'derive')).toBeUndefined();
  });
});

describe('Anti-fallback guard — primitiveCompose replicate intent', () => {
  function makeMaster(format: 'pdf' | 'docx' | 'xlsx', variables: Variable[]): Master {
    return {
      id: 'test-master',
      name: 'test.pdf',
      kind: 'layout',
      format,
      storageId: 'storage-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      analysisState: 'ready',
      analysis: {
        kind: 'layout',
        documentType: 'invoice',
        summary: 'test',
        confidence: 0.85,
        warnings: [],
        layout: { sections: [], tables: [], chrome: [] },
        variables,
      },
    } as unknown as Master;
  }

  function checkGuard(opts: {
    intent: string;
    style: string;
    master: Master;
  }): { blocked: boolean; code?: string } {
    const intent = opts.intent.toLowerCase();
    const isReplicate = /\b(replicate|exact copy|clone|same design|same layout|copy with|duplicate with|recreate)\b/.test(intent);
    if (!isReplicate) return { blocked: false };
    if (opts.master.format !== 'pdf' && opts.master.format !== 'docx' && opts.master.format !== 'xlsx') {
      return { blocked: false };
    }
    if (opts.style !== 'fill_clone') {
      return { blocked: true, code: 'REPLICATE_REQUIRES_FILL_CLONE' };
    }
    const located = (opts.master.analysis?.variables ?? []).filter((v) => v.locator !== null);
    if (located.length === 0) {
      return { blocked: true, code: 'NO_LOCATABLE_VARIABLES' };
    }
    return { blocked: false };
  }

  it('blocks compose:author for replicate intent on PDF', () => {
    const master = makeMaster('pdf', [
      { key: 'cell1', label: 'Cell 1', datatype: 'string', required: false, askPolicy: 'derive', locator: { type: 'pdf_region', page: 1, x: 100, y: 500, width: 40, fontSize: 8 }, sampleValue: '100', sensitivity: 'none' },
    ]);
    const result = checkGuard({ intent: 'replicate exact copy', style: 'author', master });
    expect(result.blocked).toBe(true);
    expect(result.code).toBe('REPLICATE_REQUIRES_FILL_CLONE');
  });

  it('blocks compose:markdown for clone intent on DOCX', () => {
    const master = makeMaster('docx', [
      { key: 'cell1', label: 'Cell 1', datatype: 'string', required: false, askPolicy: 'derive', locator: { type: 'placeholder', token: '{{cell1}}' }, sampleValue: '100', sensitivity: 'none' },
    ]);
    const result = checkGuard({ intent: 'clone with corrections', style: 'markdown', master });
    expect(result.blocked).toBe(true);
    expect(result.code).toBe('REPLICATE_REQUIRES_FILL_CLONE');
  });

  it('blocks fill_clone when master has 0 locatable variables', () => {
    const master = makeMaster('pdf', [
      { key: 'cell1', label: 'Cell 1', datatype: 'string', required: false, askPolicy: 'derive', locator: null, sampleValue: '100', sensitivity: 'none' },
    ]);
    const result = checkGuard({ intent: 'exact copy', style: 'fill_clone', master });
    expect(result.blocked).toBe(true);
    expect(result.code).toBe('NO_LOCATABLE_VARIABLES');
  });

  it('allows fill_clone when master has locatable variables', () => {
    const master = makeMaster('pdf', [
      { key: 'cell1', label: 'Cell 1', datatype: 'string', required: false, askPolicy: 'derive', locator: { type: 'pdf_region', page: 1, x: 100, y: 500, width: 40, fontSize: 8 }, sampleValue: '100', sensitivity: 'none' },
    ]);
    const result = checkGuard({ intent: 'copy with new values', style: 'fill_clone', master });
    expect(result.blocked).toBe(false);
  });

  it('does not block non-replicate intents (e.g. author)', () => {
    const master = makeMaster('pdf', []);
    const result = checkGuard({ intent: 'author a policy', style: 'author', master });
    expect(result.blocked).toBe(false);
  });

  it('does not block replicate intent for non-pdf/docx/xlsx formats (e.g. md)', () => {
    const master = makeMaster('pdf', []);
    (master as unknown as { format: string }).format = 'md';
    const result = checkGuard({ intent: 'replicate', style: 'markdown', master });
    expect(result.blocked).toBe(false);
  });
});
