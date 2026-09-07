import { describe, it, expect } from 'vitest';
import { DefaultCapabilityObserver } from '../../src/synthetic/CapabilityObserver.js';
import { InMemoryCapabilityStore } from '../../src/synthetic/InMemoryCapabilityStore.js';

describe('DefaultCapabilityObserver', () => {
  it('creates a user-prompt observation at confidence 1', async () => {
    const store = new InMemoryCapabilityStore();
    const observer = new DefaultCapabilityObserver(store);
    const pattern = await observer.reportUserPromptObservation('build a csv converter');
    expect(pattern.origin).toBe('user-prompt');
    expect(pattern.confidence).toBe(1);
  });

  it('records repeated tools in a turn after start()', async () => {
    const store = new InMemoryCapabilityStore();
    const observer = new DefaultCapabilityObserver(store, 3);
    await observer.start();
    const created = await observer.observeTurn({
      sessionId: 's1',
      userText: 'format these logs',
      tools: [
        { name: 'shell_exec', success: true },
        { name: 'shell_exec', success: true },
      ],
    });
    expect(created.some((p) => p.pattern.includes('shell_exec'))).toBe(true);
  });

  it('mines tool_executions aggregates', async () => {
    const store = new InMemoryCapabilityStore();
    store.toolAggregates = [{ toolName: 'file_read', frequency: 5, lastAt: Date.now() }];
    const observer = new DefaultCapabilityObserver(store, 3);
    await observer.start();
    const created = await observer.observeTurn({ sessionId: 's', userText: 'x', tools: [] });
    expect(created.some((p) => p.pattern.includes('file_read'))).toBe(true);
  });

  it('skips ignored patterns', async () => {
    const store = new InMemoryCapabilityStore();
    const observer = new DefaultCapabilityObserver(store, 3);
    await observer.start();
    const first = await observer.observeTurn({
      sessionId: 's',
      userText: 'x',
      tools: [{ name: 'shell_exec', success: true }, { name: 'shell_exec', success: true }],
    });
    const id = first[0]?.id;
    expect(id).toBeTruthy();
    await observer.ignorePattern(id!);
    const again = await observer.observeTurn({
      sessionId: 's',
      userText: 'x',
      tools: [{ name: 'shell_exec', success: true }, { name: 'shell_exec', success: true }],
    });
    expect(again.some((p) => p.pattern.includes('shell_exec'))).toBe(false);
  });

  it('merges similar phrasing via n-grams', async () => {
    const store = new InMemoryCapabilityStore();
    const observer = new DefaultCapabilityObserver(store, { minFrequency: 1, sweepIntervalMs: 0 });
    await observer.start();
    await observer.observeTurn({
      sessionId: 's',
      userText: 'please format these application logs now',
      tools: [],
    });
    await observer.observeTurn({
      sessionId: 's',
      userText: 'please format these application logs now',
      tools: [],
    });
    const rows = await observer.getPatterns();
    const phrasing = rows.filter((p) => p.pattern.startsWith('phrasing:'));
    expect(phrasing.length).toBe(1);
    expect(phrasing[0]?.frequency).toBeGreaterThanOrEqual(2);
    await observer.stop();
  });

  it('mines ordered tool workflows', async () => {
    const store = new InMemoryCapabilityStore();
    const observer = new DefaultCapabilityObserver(store, { minFrequency: 1, sweepIntervalMs: 0 });
    await observer.start();
    const created = await observer.observeTurn({
      sessionId: 's',
      userText: 'do the pipeline',
      tools: [
        { name: 'file_read', success: true },
        { name: 'shell_exec', success: true },
        { name: 'file_write', success: true },
      ],
    });
    expect(created.some((p) => p.pattern.includes('workflow') && p.pattern.includes('→'))).toBe(true);
    await observer.stop();
  });

  it('sweeps every N turns and start/stop the interval timer', async () => {
    const store = new InMemoryCapabilityStore();
    store.toolAggregates = [{ toolName: 'grep', frequency: 4, lastAt: Date.now() }];
    const observer = new DefaultCapabilityObserver(store, {
      minFrequency: 3,
      sweepEveryTurns: 2,
      sweepIntervalMs: 25,
    });
    await observer.start();
    await observer.observeTurn({ sessionId: 's', userText: 'one', tools: [] });
    const afterTwo = await observer.observeTurn({ sessionId: 's', userText: 'two', tools: [] });
    expect(afterTwo.some((p) => p.pattern.includes('grep'))).toBe(true);
    await new Promise((r) => setTimeout(r, 40));
    await observer.stop();
    const before = (await observer.getPatterns()).length;
    await new Promise((r) => setTimeout(r, 40));
    expect((await observer.getPatterns()).length).toBe(before);
  });
});
