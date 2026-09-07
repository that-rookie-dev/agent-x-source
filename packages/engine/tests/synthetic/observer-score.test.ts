import { describe, it, expect } from 'vitest';
import { jaccard, recencyFactor, scoreConfidence, specificityFactor, tokens } from '../../src/synthetic/observer-score.js';

describe('observer-score', () => {
  it('tokenizes and scores recency + specificity', () => {
    expect(tokens('Format these LOGS now')).toEqual(['format', 'these', 'logs', 'now']);
    expect(specificityFactor('x')).toBeLessThan(specificityFactor('format csv json rows'));
    expect(recencyFactor(Date.now(), 3_600_000)).toBeGreaterThan(0.9);
    expect(recencyFactor(Date.now() - 3_600_000, 3_600_000)).toBeLessThan(0.5);
    const high = scoreConfidence({
      frequency: 6,
      minFrequency: 3,
      lastObservedAt: Date.now(),
      pattern: 'repeated tool shell_exec format logs',
      observationWindowMs: 3_600_000,
    });
    const low = scoreConfidence({
      frequency: 1,
      minFrequency: 3,
      lastObservedAt: Date.now() - 3_600_000,
      pattern: 'x',
      observationWindowMs: 3_600_000,
    });
    expect(high).toBeGreaterThan(low);
    expect(jaccard(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3);
  });
});
