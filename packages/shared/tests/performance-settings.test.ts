import { describe, it, expect } from 'vitest';
import {
  resolvePerformanceSettings,
  projectPerformanceLanes,
  projectPresetLanes,
  projectDistinctPresetLanes,
  laneDominanceScore,
  inferPerformancePreset,
  buildPerformanceShowcase,
  normalizePerformancePreset,
  PERFORMANCE_PRESET_BUDGET,
  PERFORMANCE_PRESETS,
} from '../src/performance-settings.js';

describe('resolvePerformanceSettings', () => {
  it('defaults to balanced preset and lazy cache', () => {
    const r = resolvePerformanceSettings(undefined, 4);
    expect(r.preset).toBe('balanced');
    expect(r.budgetPercent).toBe(40);
    expect(r.lazyStorageCache).toBe(true);
    expect(r.backgroundConcurrency).toBeGreaterThanOrEqual(1);
  });

  it('honors explicit preset over raw percent', () => {
    const r = resolvePerformanceSettings({ preset: 'moderate', budgetPercent: 25 }, 8);
    expect(r.preset).toBe('moderate');
    expect(r.budgetPercent).toBe(PERFORMANCE_PRESET_BUDGET.moderate);
    expect(r.subAgents).toBeGreaterThan(resolvePerformanceSettings({ preset: 'quiet' }, 8).subAgents);
  });

  it('normalizes legacy preset ids performance→moderate and max→ultimate', () => {
    expect(normalizePerformancePreset('performance')).toBe('moderate');
    expect(normalizePerformancePreset('max')).toBe('ultimate');
    const r = resolvePerformanceSettings({ preset: 'performance', budgetPercent: 25 }, 8);
    expect(r.preset).toBe('moderate');
    expect(r.budgetPercent).toBe(PERFORMANCE_PRESET_BUDGET.moderate);
    expect(resolvePerformanceSettings({ preset: 'max' }, 8).preset).toBe('ultimate');
  });

  it('infers preset from legacy budgetPercent', () => {
    expect(inferPerformancePreset(25)).toBe('quiet');
    expect(inferPerformancePreset(40)).toBe('balanced');
    expect(inferPerformancePreset(70)).toBe('moderate');
    expect(inferPerformancePreset(80)).toBe('ultimate');
  });

  it('scales lanes continuously with budget on more cores', () => {
    const quiet = projectPerformanceLanes(18, 25, 'quiet');
    const ultimate = projectPerformanceLanes(18, 80, 'ultimate');
    expect(ultimate.effectiveCores).toBeGreaterThan(quiet.effectiveCores);
    expect(ultimate.toolParallel).toBeGreaterThan(quiet.toolParallel);
    expect(ultimate.llmGlobal).toBeLessThanOrEqual(8);
    expect(ultimate.attachmentWorkers).toBeLessThanOrEqual(3);
  });

  it('keeps Moderate and Ultimate distinct on 8-core hosts (former collision)', () => {
    const moderate = projectPresetLanes(8, 'moderate');
    const ultimate = projectPresetLanes(8, 'ultimate');
    expect(laneDominanceScore(ultimate)).toBeGreaterThan(laneDominanceScore(moderate));
    expect(ultimate.subAgents).toBeGreaterThan(moderate.subAgents);
    expect(ultimate.toolParallel).toBeGreaterThan(moderate.toolParallel);
  });

  it('projectDistinctPresetLanes strictly steps Quiet→Ultimate across common core counts', () => {
    for (const cores of [1, 2, 4, 8, 10, 12, 16, 18]) {
      const lanes = projectDistinctPresetLanes(cores);
      let prev = -1;
      for (const preset of PERFORMANCE_PRESETS) {
        const score = laneDominanceScore(lanes[preset]);
        expect(score, `${cores} cores · ${preset}`).toBeGreaterThan(prev);
        prev = score;
      }
    }
  });

  it('buildPerformanceShowcase projects four distinct presets for an 8GB / 8-core host', () => {
    const show = buildPerformanceShowcase({ preset: 'balanced' }, 8, 8 * 1024 ** 3, 2 * 1024 ** 3);
    expect(show.host.cpuCores).toBe(8);
    expect(show.host.totalMemoryGB).toBe(8);
    expect(show.host.cortexTier).toBe('minilm');
    expect(show.host.localModelReady).toBe(false);
    expect(show.presets).toHaveLength(4);
    expect(show.activePreset).toBe('balanced');
    expect(show.presets.map((p) => p.preset)).toEqual(['quiet', 'balanced', 'moderate', 'ultimate']);

    const scores = show.presets.map((p) => laneDominanceScore(p.lanes));
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeGreaterThan(scores[i - 1]!);
    }
  });
});
