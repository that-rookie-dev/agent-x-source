import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigBridge } from '../../src/adapter/ConfigBridge';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(undefined),
    }),
    onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  },
}));

const mockConfigManager = {
  isConfigured: vi.fn().mockReturnValue(true),
  isSetupComplete: vi.fn().mockReturnValue(true),
  load: vi.fn().mockReturnValue({
    provider: {
      activeProvider: 'anthropic',
      activeModel: 'claude-sonnet-4-20250514',
      providers: {
        anthropic: {
          apiKey: 'sk-ant-test',
          configured: true,
          activeProfile: 'default',
          profiles: { default: { label: 'Default', apiKey: 'sk-ant-test' } },
        },
      },
    },
    ui: { theme: 'dark', showTokenBar: true, showTimers: true, animationSpeed: 'normal' },
    organization: null,
    telemetry: false,
    setupComplete: true,
  }),
  reload: vi.fn().mockReturnValue({
    provider: {
      activeProvider: 'openai',
      activeModel: 'gpt-4o',
      providers: {},
    },
    ui: { theme: 'dark', showTokenBar: true, showTimers: true, animationSpeed: 'normal' },
    organization: null,
    telemetry: false,
    setupComplete: true,
  }),
};

const mockContext = {
  subscriptions: [],
} as unknown as import('vscode').ExtensionContext;

describe('ConfigBridge', () => {
  let bridge: ConfigBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    bridge = new ConfigBridge(mockContext, mockConfigManager as any);
  });

  it('detects configured and setup complete state', () => {
    const state = bridge.initialize();
    expect(state.isConfigured).toBe(true);
    expect(state.isSetupComplete).toBe(true);
    expect(state.firstRun).toBe(false);
    expect(state.config).not.toBeNull();
  });

  it('detects first run when not configured', () => {
    mockConfigManager.isConfigured.mockReturnValueOnce(false);
    const firstRunHandler = vi.fn();
    bridge.onFirstRun(firstRunHandler);
    const state = bridge.initialize();
    expect(state.firstRun).toBe(true);
    expect(firstRunHandler).toHaveBeenCalledTimes(1);
  });

  it('returns active provider and model', () => {
    bridge.initialize();
    expect(bridge.getActiveProvider()).toBe('anthropic');
    expect(bridge.getActiveModel()).toBe('claude-sonnet-4-20250514');
  });

  it('retrieves provider API key from profiles', () => {
    bridge.initialize();
    expect(bridge.getProviderApiKey('anthropic')).toBe('sk-ant-test');
  });

  it('detects provider/model changes on reload', () => {
    bridge.initialize();
    const handler = vi.fn();
    bridge.onProviderChange(handler);
    bridge.reload();
    expect(handler).toHaveBeenCalledWith('openai', 'gpt-4o');
  });

  it('emits config change on reload', () => {
    bridge.initialize();
    const handler = vi.fn();
    bridge.onConfigChange(handler);
    bridge.reload();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('dispose cleans up handlers', () => {
    bridge.initialize();
    const handler = vi.fn();
    const disposable = bridge.onConfigChange(handler);
    disposable.dispose();
    bridge.reload();
    expect(handler).not.toHaveBeenCalled();
  });
});
