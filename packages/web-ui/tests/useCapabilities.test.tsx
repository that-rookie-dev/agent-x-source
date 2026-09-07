// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCapabilitySSE } from '../src/hooks/useCapabilities.js';

const events: Array<{ type: string; data: string }> = [];

class FakeEventSource {
  public onerror: (() => void) | null = null;
  private listeners = new Map<string, Array<(ev: MessageEvent) => void>>();
  public closed = false;
  constructor(public url: string) {
    events.push({ type: 'open', data: url });
  }
  addEventListener(name: string, handler: (ev: MessageEvent) => void) {
    const list = this.listeners.get(name) ?? [];
    list.push(handler);
    this.listeners.set(name, list);
  }
  close() {
    this.closed = true;
  }
  emit(name: string, data: string) {
    const list = this.listeners.get(name) ?? [];
    for (const h of list) h(new MessageEvent(name, { data }));
  }
  error() {
    if (this.onerror) this.onerror();
  }
}

let fes: FakeEventSource | null = null;

vi.mock('../src/api.js', () => ({
  getAuthToken: () => 'token123',
  capabilities: { list: vi.fn(), observations: vi.fn() },
}));

describe('useCapabilitySSE', () => {
  beforeEach(() => {
    events.length = 0;
    fes = null;
    (globalThis as any).EventSource = class extends FakeEventSource {
      constructor(url: string) {
        super(url);
        fes = this;
      }
    };
  });
  afterEach(() => {
    delete (globalThis as any).EventSource;
  });

  it('reconnects after an error with exponential backoff', async () => {
    const seen: { event: string; payload: unknown }[] = [];
    const { unmount } = renderHook(() => useCapabilitySSE((payload) => { seen.push({ event: payload.event, payload }); }));

    expect(events.length).toBe(1);
    expect(events[0]?.data).toContain('token=token123');

    fes?.emit('capability:proposed', JSON.stringify({ event: 'capability:proposed', capabilityId: 'c1' }));
    expect(seen.length).toBe(1);

    fes?.error();
    expect(fes?.closed).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(events.length).toBe(2);

    unmount();
  });
});
