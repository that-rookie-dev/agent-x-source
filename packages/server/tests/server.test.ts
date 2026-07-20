import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockStart, mockStop, mockGetPort, MockAgentRuntime, mockCreateServerRuntimeOptions } = vi.hoisted(() => {
  const mockStart = vi.fn().mockResolvedValue(undefined);
  const mockStop = vi.fn().mockResolvedValue(undefined);
  const mockGetPort = vi.fn().mockReturnValue(3333);
  const MockAgentRuntime = vi.fn(function MockAgentRuntimeImpl(this: any) {
    this.start = mockStart;
    this.stop = mockStop;
    this.getPort = mockGetPort;
  });
  const mockCreateServerRuntimeOptions = vi.fn(() => ({
    mode: 'server',
    isDev: false,
    port: 3333,
    getResourcesPath: () => '/resources',
    getDataDir: () => '/data',
    listenHost: '127.0.0.1',
  }));
  return { mockStart, mockStop, mockGetPort, MockAgentRuntime, mockCreateServerRuntimeOptions };
});

vi.mock('@agentx/runtime', () => ({
  AgentRuntime: MockAgentRuntime,
  createServerRuntimeOptions: mockCreateServerRuntimeOptions,
  createDesktopRuntimeOptions: vi.fn(),
  resolveRuntimePaths: vi.fn(),
  resolvePublicUrl: vi.fn(),
}));

import { createServer, start } from '../src/index.js';
import { AgentRuntime, createServerRuntimeOptions } from '@agentx/runtime';

describe('server index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStart.mockResolvedValue(undefined);
    mockStop.mockResolvedValue(undefined);
    mockGetPort.mockReturnValue(3333);
  });

  afterEach(() => {
    delete process.env['AGENTX_SERVER_MODE'];
    delete process.env['AGENTX_HOST'];
  });

  describe('createServer', () => {
    it('sets AGENTX_SERVER_MODE env var', () => {
      createServer();
      expect(process.env['AGENTX_SERVER_MODE']).toBe('1');
    });

    it('creates runtime with server options', () => {
      createServer();
      expect(createServerRuntimeOptions).toHaveBeenCalledWith(expect.objectContaining({ isDev: expect.any(Boolean) }));
      expect(AgentRuntime).toHaveBeenCalledTimes(1);
    });

    it('returns an AgentRuntime instance', () => {
      const rt = createServer();
      expect(rt).toBeDefined();
      expect(typeof rt.start).toBe('function');
      expect(typeof rt.stop).toBe('function');
    });
  });

  describe('start', () => {
    it('calls runtime.start and returns the runtime', async () => {
      const rt = await start();
      expect(mockStart).toHaveBeenCalledTimes(1);
      expect(rt).toBeDefined();
      expect(rt.getPort).toBeDefined();
    });

    it('registers SIGTERM and SIGINT handlers', async () => {
      const onSpy = vi.spyOn(process, 'on');
      await start();
      expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      onSpy.mockRestore();
    });

    it('calls runtime.stop on shutdown signal', async () => {
      const onSpy = vi.spyOn(process, 'on');
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      await start();

      const sigtermHandler = onSpy.mock.calls.find((c) => c[0] === 'SIGTERM')?.[1] as (signal: string) => Promise<void>;
      await sigtermHandler('SIGTERM');
      expect(mockStop).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(0);

      onSpy.mockRestore();
      exitSpy.mockRestore();
    });

    it('only shuts down once on repeated signals', async () => {
      const onSpy = vi.spyOn(process, 'on');
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      await start();

      const sigtermHandler = onSpy.mock.calls.find((c) => c[0] === 'SIGTERM')?.[1] as (signal: string) => Promise<void>;
      await sigtermHandler('SIGTERM');
      await sigtermHandler('SIGTERM');
      expect(mockStop).toHaveBeenCalledTimes(1);

      onSpy.mockRestore();
      exitSpy.mockRestore();
    });
  });
});

describe('start-server.mjs', () => {
  it('is a script that requires and calls start from dist', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const scriptPath = path.join(__dirname, '..', 'scripts', 'start-server.mjs');
    const content = fs.readFileSync(scriptPath, 'utf-8');
    expect(content).toContain("require('../dist/index.js')");
    expect(content).toContain('start()');
    expect(content).toContain('process.exit(1)');
  });
});
