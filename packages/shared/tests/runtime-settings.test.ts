import { describe, it, expect } from 'vitest';
import { resolveRuntimeSettings } from '../src/runtime-settings.js';

describe('resolveRuntimeSettings', () => {
  it('defaults to 40% CPU budget and lazy cache', () => {
    const r = resolveRuntimeSettings(undefined, 4);
    expect(r.cpuBudgetPercent).toBe(40);
    expect(r.lazyStorageCache).toBe(true);
    expect(r.onnxIntraOpThreads).toBe(1);
    expect(r.backgroundConcurrency).toBeGreaterThanOrEqual(1);
  });

  it('scales threads above 50% budget', () => {
    const r = resolveRuntimeSettings({ cpuBudgetPercent: 60 }, 8);
    expect(r.onnxIntraOpThreads).toBeGreaterThanOrEqual(1);
    expect(r.backgroundConcurrency).toBeLessThanOrEqual(4);
  });
});
