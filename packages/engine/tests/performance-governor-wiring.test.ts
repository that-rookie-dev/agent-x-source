import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentEventBus } from '../src/EventBus.js';
import { SubAgentManager } from '../src/agent/SubAgentManager.js';
import { CommandQueue } from '../src/communication/CommandQueue.js';
import { Semaphore } from '../src/concurrency/Semaphore.js';
import {
  applyPerformanceGovernor,
  getPerformanceLanes,
} from '../src/performance/PerformanceGovernor.js';
import { getBackgroundTaskPool } from '../src/runtime/BackgroundTaskPool.js';
import type { InternalUserTurn } from '@agentx/shared';

function turn(sessionId: string): InternalUserTurn {
  return {
    turnId: `t-${sessionId}`,
    sessionId,
    channel: 'web',
    userId: 'u1',
    receivedAt: Date.now(),
    text: 'hello',
    attachments: [],
    metadata: {},
  };
}

describe('Performance governor wiring', () => {
  beforeEach(() => {
    applyPerformanceGovernor({ preset: 'balanced' }, 8);
  });

  it('does not let SubAgentManager.spawn() resize the concurrency pool', () => {
    applyPerformanceGovernor({ preset: 'quiet' }, 8);
    const quietSub = getPerformanceLanes().subAgents;
    expect(quietSub).toBeLessThan(8);

    const mgr = new SubAgentManager(new AgentEventBus());
    mgr.setMaxConcurrent(quietSub);

    const spy = vi.spyOn(Semaphore.prototype, 'setPermits');
    spy.mockClear();

    // Historical bug: spawn(..., maxConcurrent=8) called setPermits(8) and defeated Quiet.
    const task = mgr.spawn('concurrency wiring probe', [], 50, 8);
    expect(spy).not.toHaveBeenCalled();
    expect(mgr.getConcurrencyStats().available + mgr.getConcurrencyStats().running).toBe(quietSub);

    task.abortController?.abort();
    spy.mockRestore();
  });

  it('retunes background pool when governor applies', async () => {
    applyPerformanceGovernor({ preset: 'quiet' }, 8);
    const quietBg = getPerformanceLanes().backgroundConcurrency;

    applyPerformanceGovernor({ preset: 'ultimate' }, 16);
    const maxBg = getPerformanceLanes().backgroundConcurrency;
    expect(maxBg).toBeGreaterThanOrEqual(quietBg);

    // Pool completes work (queues under pressure — never drops).
    const value = await getBackgroundTaskPool().run(async () => 42);
    expect(value).toBe(42);
  });

  it('CommandQueue.setMaxConcurrent wakes waiters when capacity rises', async () => {
    const q = new CommandQueue();
    q.setMaxConcurrent(1);

    await q.enqueue('s1', turn('s1'));
    expect(q.getActiveCount()).toBe(1);

    let secondReady = false;
    const p2 = q.enqueue('s2', turn('s2')).then(() => {
      secondReady = true;
    });
    expect(q.getQueueLength()).toBe(1);
    expect(secondReady).toBe(false);

    q.setMaxConcurrent(2);
    await p2;
    expect(secondReady).toBe(true);
    expect(q.getActiveCount()).toBe(2);
  });
});
