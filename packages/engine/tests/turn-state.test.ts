import { describe, expect, it, vi, afterEach } from 'vitest';
import { TurnStateManager } from '../src/agent/TurnStateManager.js';

describe('TurnStateManager', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('excludes user-wait phases from elapsed time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T10:00:00.000Z'));

    const mgr = new TurnStateManager();
    mgr.start('turn-1', 'receiving');

    vi.advanceTimersByTime(5000);
    expect(mgr.getElapsedMs()).toBe(5000);

    mgr.setPhase('awaiting_permission', 'clarification');
    vi.advanceTimersByTime(60_000);
    expect(mgr.getElapsedMs()).toBe(5000);

    mgr.setPhase('running', 'resuming');
    vi.advanceTimersByTime(3000);
    expect(mgr.getElapsedMs()).toBe(8000);
  });
});
