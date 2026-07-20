import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryQueue } from '@agentx/engine';

vi.mock('../src/engine.js', () => ({
  getEngine: vi.fn(),
  awaitEngineStorageReady: vi.fn(),
}));

import { getEngine } from '../src/engine.js';
import { ApiService } from '../src/services/ApiService.js';

describe('ApiService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes engine services', () => {
    const queue = new InMemoryQueue();
    const mockEngine = {
      configManager: { load: () => ({}) },
      sessionManager: { getSessionById: () => null },
      crewManager: { list: () => [] },
      jobQueue: queue,
      agent: null,
      pgPool: null,
    };
    (getEngine as any).mockReturnValue(mockEngine);

    const api = new ApiService();
    expect(api.getEngine()).toBe(mockEngine);
    expect(api.getConfigManager()).toBe(mockEngine.configManager);
    expect(api.getSessionManager()).toBe(mockEngine.sessionManager);
    expect(api.getCrewManager()).toBe(mockEngine.crewManager);
    expect(api.getJobQueue()).toBe(queue);
    expect(api.getAgent()).toBeNull();
  });

  it('requireSession returns 404 when missing', () => {
    const mockEngine = {
      configManager: { load: () => ({}) },
      sessionManager: { getSessionById: () => null },
      crewManager: { list: () => [] },
      jobQueue: new InMemoryQueue(),
      agent: null,
      pgPool: null,
    };
    (getEngine as any).mockReturnValue(mockEngine);

    const api = new ApiService();
    const res = { status: (code: number) => ({ json: (body: unknown) => ({ code, body }) }) };
    const result = api.requireSession('missing', res);
    expect(result).toBeNull();
  });
});
