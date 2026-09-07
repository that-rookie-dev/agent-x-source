import { describe, it, expect, beforeEach } from 'vitest';
import { siMetrics } from '../../src/synthetic/si-metrics.js';
import { reviewGeneratedCode } from '../../src/synthetic/review-checklist.js';

describe('siMetrics', () => {
  beforeEach(() => siMetrics.reset());

  it('computes rates and alerts', () => {
    for (let i = 0; i < 6; i++) siMetrics.increment('generation', i < 1);
    for (let i = 0; i < 4; i++) siMetrics.increment('sandbox', false);
    const snap = siMetrics.snapshot();
    expect(snap.generationsTotal).toBe(6);
    expect(snap.generationSuccessRate).toBeLessThan(0.3);
    expect(siMetrics.alerts().some((a) => /Generation success rate/.test(a))).toBe(true);
    expect(siMetrics.alerts().some((a) => /Sandbox failure/.test(a))).toBe(true);
  });
});

describe('reviewGeneratedCode', () => {
  it('flags eval and secrets', () => {
    const bad = reviewGeneratedCode('const api_key = "sk-secret"; eval(code);');
    expect(bad.find((f) => f.id === 'no-eval')?.ok).toBe(false);
    expect(bad.find((f) => f.id === 'no-hardcoded-secrets')?.ok).toBe(false);
    const ok = reviewGeneratedCode('function run(args) { return args.n + 1; }');
    expect(ok.every((f) => f.ok)).toBe(true);
  });
});
