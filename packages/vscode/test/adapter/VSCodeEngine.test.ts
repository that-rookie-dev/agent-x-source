import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VSCodeEngine } from '../../src/adapter/VSCodeEngine';

vi.mock('@agentx/engine', () => {
  const MockAgent = vi.fn().mockImplementation(() => ({
    events: { on: vi.fn().mockReturnValue(vi.fn()), emit: vi.fn() },
    tokens: { tokensUsed: 0, tokensTotal: 128000, percentage: 0, totalCost: 0, inputTokenCount: 0, outputTokenCount: 0 },
    processing: false,
    toolCount: 165,
    watcherCount: 0,
    schedulerCount: 0,
    planModeEnabled: false,
    cancel: vi.fn(),
    endSession: vi.fn(),
    sendMessage: vi.fn(),
    getToolExecutor: vi.fn(),
  }));
  const MockConfigManager = vi.fn().mockImplementation(() => ({
    load: vi.fn().mockReturnValue({
      provider: { activeProvider: 'openai', activeModel: 'gpt-4o', providers: {} },
      ui: { theme: 'dark', showTokenBar: true, showTimers: true, animationSpeed: 'normal' },
      organization: null,
      telemetry: false,
      setupComplete: true,
    }),
    isConfigured: vi.fn().mockReturnValue(true),
    isSetupComplete: vi.fn().mockReturnValue(true),
    reload: vi.fn(),
  }));
  return { Agent: MockAgent, ConfigManager: MockConfigManager };
});

vi.mock('../../src/adapter/VSCodeToolkitFactory', () => {
  const mockRegistry = { list: vi.fn().mockReturnValue([]) };
  const mockExecutor = {};
  return {
    createVSCodeToolkit: vi.fn().mockReturnValue({
      registry: mockRegistry,
      executor: mockExecutor,
      factoryExecutor: {},
    }),
  };
});

vi.mock('@agentx/shared', async () => {
  const actual = await vi.importActual<typeof import('@agentx/shared')>('@agentx/shared');
  return {
    ...actual,
    generateSessionId: vi.fn().mockReturnValue('test-session-id'),
  };
});

const mockContext = {
  subscriptions: [],
  globalStorageUri: { fsPath: '/tmp/test-storage' },
  extensionUri: { fsPath: '/tmp/test-ext' },
} as unknown as import('vscode').ExtensionContext;

describe('VSCodeEngine', () => {
  let engine: VSCodeEngine;

  beforeEach(() => {
    engine = new VSCodeEngine('/workspace/project', mockContext);
  });

  afterEach(async () => {
    if (!engine.isDisposed()) {
      await engine.dispose();
    }
  });

  it('starts in uninitialized state', () => {
    expect(engine.isInitialized()).toBe(false);
    expect(engine.getAgent()).toBeNull();
    expect(engine.getStatus()).toBe('uninitialized');
  });

  it('initializes successfully', async () => {
    await engine.initialize();
    expect(engine.isInitialized()).toBe(true);
    expect(engine.getAgent()).not.toBeNull();
    expect(engine.getStatus()).toBe('ready');
    expect(engine.getSessionId()).toBe('test-session-id');
  });

  it('de-duplicates concurrent initialize calls', async () => {
    const p1 = engine.initialize();
    const p2 = engine.initialize();
    await Promise.all([p1, p2]);
    expect(engine.isInitialized()).toBe(true);
  });

  it('returns correct state after initialization', async () => {
    await engine.initialize();
    const state = engine.getState();
    expect(state.status).toBe('ready');
    expect(state.workspaceRoot).toBe('/workspace/project');
    expect(state.sessionId).toBe('test-session-id');
    expect(state.providerId).toBe('openai');
    expect(state.modelId).toBe('gpt-4o');
    expect(state.toolCount).toBe(165);
  });

  it('disposes cleanly', async () => {
    await engine.initialize();
    await engine.dispose();
    expect(engine.isDisposed()).toBe(true);
    expect(engine.getStatus()).toBe('disposed');
    expect(engine.getAgent()).toBeNull();
  });

  it('throws on initialize after dispose', async () => {
    await engine.dispose();
    await expect(engine.initialize()).rejects.toThrow('disposed');
  });

  it('restarts with new workspace root', async () => {
    await engine.initialize();
    await engine.restart('/workspace/other');
    expect(engine.isInitialized()).toBe(true);
    expect(engine.getWorkspaceRoot()).toBe('/workspace/other');
  });

  it('resetProcessingState calls cancel on agent', async () => {
    await engine.initialize();
    const agent = engine.getAgent()!;
    Object.defineProperty(agent, 'processing', { value: true, writable: true });
    engine.resetProcessingState();
    expect(agent.cancel).toHaveBeenCalled();
  });
});
