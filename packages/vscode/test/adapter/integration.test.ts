import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VSCodeEngine } from '../../src/adapter/VSCodeEngine';
import { EventBridge } from '../../src/adapter/EventBridge';

let capturedEmit: ((event: any) => void) | null = null;

vi.mock('@agentx/engine', () => {
  const handlers = new Set<(event: any) => void>();
  const eventBus = {
    emit: (event: any) => {
      for (const h of handlers) h(event);
    },
    on: (h: (event: any) => void) => {
      handlers.add(h);
      capturedEmit = (event: any) => {
        for (const handler of handlers) handler(event);
      };
      return () => { handlers.delete(h); };
    },
    off: (h: (event: any) => void) => { handlers.delete(h); },
  };

  const MockAgent = vi.fn().mockImplementation(() => ({
    events: eventBus,
    tokens: {
      tokensUsed: 0,
      tokensTotal: 128000,
      percentage: 0,
      totalCost: 0,
      inputTokenCount: 0,
      outputTokenCount: 0,
    },
    processing: false,
    toolCount: 165,
    watcherCount: 0,
    schedulerCount: 0,
    planModeEnabled: false,
    cancel: vi.fn(),
    endSession: vi.fn(),
    sendMessage: vi.fn().mockImplementation(async (content: string) => {
      eventBus.emit({
        type: 'message_sent',
        message: {
          id: 'msg-sent-1',
          sessionId: 'test-session',
          role: 'user',
          content,
          toolCalls: null,
          tokenCount: 10,
          createdAt: new Date().toISOString(),
        },
      });

      eventBus.emit({ type: 'stream_chunk', content: 'Hel', fullContent: 'Hel' });
      eventBus.emit({ type: 'stream_chunk', content: 'lo!', fullContent: 'Hello!' });

      const response = {
        id: 'msg-recv-1',
        sessionId: 'test-session',
        role: 'assistant',
        content: 'Hello!',
        toolCalls: null,
        tokenCount: 15,
        createdAt: new Date().toISOString(),
      };

      eventBus.emit({ type: 'message_received', message: response, elapsed: 250 });

      return response;
    }),
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
  return {
    createVSCodeToolkit: vi.fn().mockReturnValue({
      registry: { list: vi.fn().mockReturnValue([]) },
      executor: {},
      factoryExecutor: {},
    }),
  };
});

vi.mock('@agentx/shared', async () => {
  const actual = await vi.importActual<typeof import('@agentx/shared')>('@agentx/shared');
  return {
    ...actual,
    generateSessionId: vi.fn().mockReturnValue('integration-test-session'),
  };
});

const mockContext = {
  subscriptions: [],
  globalStorageUri: { fsPath: '/tmp/test-storage' },
  extensionUri: { fsPath: '/tmp/test-ext' },
} as unknown as import('vscode').ExtensionContext;

describe('Integration: Engine → EventBridge → Message Flow', () => {
  let engine: VSCodeEngine;
  let bridge: EventBridge;

  beforeEach(async () => {
    capturedEmit = null;
    engine = new VSCodeEngine('/workspace/project', mockContext);
    await engine.initialize();
    const agent = engine.getAgent()!;
    bridge = new EventBridge(agent.events, 0);
  });

  afterEach(async () => {
    bridge.dispose();
    await engine.dispose();
  });

  it('sends a message and receives streamed response via event bridge', async () => {
    const messages: any[] = [];
    const streamChunks: any[] = [];

    bridge.onMessage((msg) => messages.push(msg));
    bridge.onStream((chunk) => streamChunks.push(chunk));

    const agent = engine.getAgent()!;
    const response = await agent.sendMessage('Hi there');

    expect(response.content).toBe('Hello!');

    expect(messages.length).toBeGreaterThanOrEqual(2);
    const sentMsg = messages.find((m) => m.role === 'user');
    const receivedMsg = messages.find((m) => m.role === 'assistant');
    expect(sentMsg).toBeDefined();
    expect(sentMsg.content).toBe('Hi there');
    expect(receivedMsg).toBeDefined();
    expect(receivedMsg.content).toBe('Hello!');

    expect(streamChunks.length).toBeGreaterThanOrEqual(2);
    expect(streamChunks[streamChunks.length - 1].fullContent).toBe('Hello!');
  });

  it('engine state is correct after initialization', () => {
    const state = engine.getState();
    expect(state.status).toBe('ready');
    expect(state.workspaceRoot).toBe('/workspace/project');
    expect(state.sessionId).toBe('integration-test-session');
    expect(state.providerId).toBe('openai');
    expect(state.modelId).toBe('gpt-4o');
    expect(state.toolCount).toBe(165);
    expect(state.processing).toBe(false);
  });

  it('event bridge tracks tool execution events', async () => {
    const toolEvents: any[] = [];
    bridge.onToolEvent((e) => toolEvents.push(e));

    capturedEmit!({
      type: 'tool_executing',
      tool: 'file_read',
      description: 'Reading config',
      startTime: Date.now(),
    });

    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0].toolName).toBe('file_read');
    expect(toolEvents[0].status).toBe('executing');
  });

  it('event bridge tracks permission requests', async () => {
    const permissions: any[] = [];
    bridge.onPermission((p) => permissions.push(p));

    capturedEmit!({
      type: 'permission_required',
      tool: 'shell_exec',
      path: '/workspace/project',
      riskLevel: 'high',
    });

    expect(permissions).toHaveLength(1);
    expect(permissions[0].tool).toBe('shell_exec');
    expect(permissions[0].riskLevel).toBe('high');
  });
});
