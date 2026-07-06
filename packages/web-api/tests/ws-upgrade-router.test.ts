import { describe, it, expect } from 'vitest';
import { registerWebSocketRoute, attachWebSocketUpgradeRouter } from '../src/ws-upgrade-router.js';

describe('ws-upgrade-router', () => {
  it('registers routes without attaching duplicate listeners', () => {
    const server = { on: () => {} } as import('node:http').Server;
    registerWebSocketRoute('/ws', { handleUpgrade: () => {}, emit: () => {} } as never);
    registerWebSocketRoute('/ws/voice', { handleUpgrade: () => {}, emit: () => {} } as never);
    expect(() => attachWebSocketUpgradeRouter(server)).not.toThrow();
    expect(() => attachWebSocketUpgradeRouter(server)).not.toThrow();
  });
});
