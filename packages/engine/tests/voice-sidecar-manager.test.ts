import { describe, it, expect, vi, beforeEach } from 'vitest';

const { healthMock, mockChild, triggerExit } = vi.hoisted(() => {
  const healthMock = vi.fn();
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const mockChild = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    kill: vi.fn(),
    killed: false,
    pid: 4242,
    on(event: string, handler: (...args: unknown[]) => void) {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
    },
    once(event: string, handler: (...args: unknown[]) => void) {
      const wrapper = (...args: unknown[]) => {
        handler(...args);
        const list = listeners.get(event) ?? [];
        listeners.set(event, list.filter((h) => h !== wrapper));
      };
      const list = listeners.get(event) ?? [];
      list.push(wrapper);
      listeners.set(event, list);
    },
    removeAllListeners() {
      listeners.clear();
    },
  };
  const triggerExit = (code: number, signal: unknown = null) => {
    for (const handler of listeners.get('exit') ?? []) handler(code, signal);
  };
  return { healthMock, mockChild, triggerExit };
});

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => mockChild),
}));

vi.mock('node:net', () => ({
  createServer: vi.fn(() => ({
    listen: vi.fn((_port: number, _host: string, cb?: () => void) => cb?.()),
    address: () => ({ port: 55001 }),
    close: vi.fn((cb?: () => void) => cb?.()),
    on: vi.fn(),
    once: vi.fn(),
  })),
}));

vi.mock('../src/voice/sidecar/VoiceSidecarClient.js', () => ({
  VoiceSidecarClient: class MockVoiceSidecarClient {
    constructor(_opts: unknown) {}
    health = healthMock;
  },
}));

import { VoiceSidecarManager } from '../src/voice/sidecar/VoiceSidecarManager.js';

describe('VoiceSidecarManager', () => {
  beforeEach(() => {
    healthMock.mockReset();
    healthMock.mockResolvedValue({ ok: true, state: 'ready' });
    mockChild.removeAllListeners();
    mockChild.killed = false;
  });

  it('starts sidecar and reports ready status', async () => {
    const mgr = new VoiceSidecarManager({ dataDir: '/tmp/voice-test', startupTimeoutMs: 2_000 });
    const client = await mgr.start();
    expect(client).toBeDefined();
    expect(mgr.getStatus().state).toBe('ready');
    await mgr.stop();
  });

  it('marks crashed when child exits unexpectedly', async () => {
    const mgr = new VoiceSidecarManager({ dataDir: '/tmp/voice-test', startupTimeoutMs: 2_000 });
    await mgr.start();
    triggerExit(1, null);
    expect(mgr.getStatus().state).toBe('crashed');
    await mgr.stop();
  });

  it('can restart after crash', async () => {
    const mgr = new VoiceSidecarManager({ dataDir: '/tmp/voice-test', startupTimeoutMs: 2_000 });
    await mgr.start();
    triggerExit(1, null);
    expect(mgr.getStatus().state).toBe('crashed');
    const client = await mgr.start();
    expect(client).toBeDefined();
    expect(mgr.getStatus().state).toBe('ready');
    await mgr.stop();
  });
});
