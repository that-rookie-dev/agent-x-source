import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RenderScheduler, classifyEventPriority } from '../src/perf/render-scheduler';
import type { TelemetryEvent } from '../src/api';

describe('render-scheduler', () => {
  let rafQueue: FrameRequestCallback[] = [];

  beforeEach(() => {
    rafQueue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
  });

  const flushRaf = () => {
    const queue = [...rafQueue];
    rafQueue = [];
    queue.forEach((cb) => cb(0));
  };

  it('classifies priorities', () => {
    expect(classifyEventPriority('message_received')).toBe('p0');
    expect(classifyEventPriority('stream_chunk')).toBe('p1');
    expect(classifyEventPriority('token_usage')).toBe('p2');
    expect(classifyEventPriority('crew_worker_progress')).toBe('p3');
  });

  it('coalesces token_usage fields', () => {
    const delivered: TelemetryEvent[] = [];
    const scheduler = new RenderScheduler((ev) => delivered.push(ev), { tokenMinMs: 0 });

    scheduler.enqueue({ type: 'token_usage', inputTokens: 10 } as TelemetryEvent);
    scheduler.enqueue({ type: 'token_usage', outputTokens: 5 } as TelemetryEvent);
    flushRaf();

    expect(delivered).toHaveLength(1);
    expect((delivered[0] as { inputTokens?: number }).inputTokens).toBe(10);
    expect((delivered[0] as { outputTokens?: number }).outputTokens).toBe(5);
  });
});
