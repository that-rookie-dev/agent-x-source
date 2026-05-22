import { describe, it, expect } from 'vitest';
import { AgentEventBus } from '../src/EventBus.js';
import type { EngineEvent } from '@agentx/shared';

describe('AgentEventBus', () => {
  it('emits and receives events', () => {
    const bus = new AgentEventBus();
    const received: EngineEvent[] = [];

    bus.on((event) => {
      received.push(event);
    });

    const event: EngineEvent = {
      type: 'message_received',
      sessionId: 'sess_1',
      message: { id: 'msg_1', sessionId: 'sess_1', role: 'assistant', content: 'hello', toolCalls: null, tokenCount: 5, createdAt: new Date().toISOString() },
    };

    bus.emit(event);
    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe('message_received');
  });

  it('supports multiple listeners', () => {
    const bus = new AgentEventBus();
    let count = 0;

    bus.on(() => { count++; });
    bus.on(() => { count++; });

    bus.emit({ type: 'loading_start', sessionId: 'sess_1' } as EngineEvent);
    expect(count).toBe(2);
  });

  it('removes listeners with off', () => {
    const bus = new AgentEventBus();
    let count = 0;
    const listener = () => { count++; };

    bus.on(listener);
    bus.emit({ type: 'loading_end', sessionId: 'sess_1' } as EngineEvent);
    expect(count).toBe(1);

    bus.off(listener);
    bus.emit({ type: 'loading_end', sessionId: 'sess_1' } as EngineEvent);
    expect(count).toBe(1); // didn't increment
  });

  it('on() returns unsubscribe function', () => {
    const bus = new AgentEventBus();
    let count = 0;

    const unsub = bus.on(() => { count++; });
    bus.emit({ type: 'loading_start', sessionId: 'sess_1' } as EngineEvent);
    expect(count).toBe(1);

    unsub();
    bus.emit({ type: 'loading_start', sessionId: 'sess_1' } as EngineEvent);
    expect(count).toBe(1);
  });
});
