import { describe, it, expect } from 'vitest';
import { PerfTracker, getPerfTracker } from '../src/benchmark/perf.js';

describe('PerfTracker', () => {
  it('records turn latency and computes stats', () => {
    const tracker = new PerfTracker();
    tracker.reset();

    tracker.turnStart('s1', 0);
    const message = {
      id: 'm1',
      sessionId: 's1',
      role: 'assistant' as const,
      content: 'hi',
      toolCalls: null,
      createdAt: new Date().toISOString(),
      tokenCount: 100,
    };
    tracker.turnEnd('s1', message, 1000);

    const stats = tracker.getStats();
    expect(stats.totalTurns).toBe(1);
    expect(stats.avgLatencyMs).toBe(1000);
    expect(stats.avgTokensPerSecond).toBe(100);
  });

  it('returns zero stats when no turns recorded', () => {
    const tracker = new PerfTracker();
    tracker.reset();
    const stats = tracker.getStats();
    expect(stats.totalTurns).toBe(0);
    expect(stats.avgLatencyMs).toBe(0);
    expect(stats.avgTokensPerSecond).toBe(0);
  });

  it('singleton shares state', () => {
    const a = getPerfTracker();
    const b = getPerfTracker();
    expect(a).toBe(b);
  });
});
