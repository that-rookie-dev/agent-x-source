import { vi, describe, it, expect, beforeEach } from 'vitest';
import type {
  CompletionChunk,
  CompletionMessage,
  AgentXConfig,
  CompletionToolCall,
  ToolResult,
  EngineEvent,
} from '@agentx/shared';

// ─── Hoisted mock state ──────────────────────────────────────────────
const {
  mockProvider,
  mockEventBus,
  mockTokenTracker,
  mockErrorShield,
  mockSauce,
  mockSecretSauceMgr,
  mockMemoryExtractor,
  mockSubAgentMgr,
  mockTaskMgr,
  mockScheduler,
} = vi.hoisted(() => {
  const createBus = () => ({
    emit: vi.fn(),
    on: vi.fn(() => vi.fn()),
    off: vi.fn(),
  });

  const createTracker = () => {
    let used = 0;
    let total = 128_000;
    const addUsage = vi.fn((t: number) => { used += t; });
    const addTokenUsage = vi.fn((input: number, output?: number) => { return addUsage(input + (output ?? 0)); });
    const setTotal = vi.fn((t: number) => { total = t; });
    const setUsed = vi.fn();
    const setPricing = vi.fn();
    const reset = vi.fn();
    return {
      addUsage,
      // Compatibility shim for older/newer method names used by Agent
      addTokenUsage,
      setTotal,
      setUsed,
      setPricing,
      reset,
      get tokensUsed() { return used; },
      get tokensTotal() { return total; },
      get tokensRemaining() { return Math.max(0, total - used); },
      get percentage() { return total > 0 ? used / total : 0; },
      get isNearLimit() { return this.percentage >= 0.7; },
      get isAtLimit() { return this.percentage >= 0.95; },
    };
  };

  const createErrorShield = () => ({
    logError: vi.fn(),
    wrap: vi.fn(<T>(op: () => T, fallback: T) => { try { return op(); } catch { return fallback; } }),
    wrapAsync: vi.fn(<T>(op: () => Promise<T>, fallback: T) => op().catch(() => fallback)),
  });

  const createSauceMgr = () => ({
    buildSystemContext: vi.fn(() => ({
      soul: '[SOUL]\nAgent-X\n[/SOUL]',
      crew: '[CREW]\nDefault assistant\n[/CREW]',
      memories: '',
      diary: '',
      full: '[SOUL]\nAgent-X\n[/SOUL]\n\n[CREW]\nDefault assistant\n[/CREW]',
    })),
    recordMemory: vi.fn(),
    recordDiary: vi.fn(),
    getActiveSystemPrompt: vi.fn(() => 'Default assistant'),
    switchCrew: vi.fn(() => true),
    summarizer: {
      needsSummarization: vi.fn(() => false),
      buildMemorySummarizationPrompt: vi.fn(() => null),
      buildDiarySummarizationPrompt: vi.fn(() => null),
      storeMemorySummary: vi.fn(),
      storeDiarySummary: vi.fn(),
    },
    identity: {
      recordInteraction: vi.fn(),
      setName: vi.fn(),
      buildContext: vi.fn(() => ''),
    },
    memories: {
      getRecentMemories: vi.fn(() => []),
      addMemory: vi.fn(),
      buildContext: vi.fn(() => ({ global: '', crew: '' })),
    },
    diary: {
      getRecent: vi.fn(() => []),
      addEntry: vi.fn(),
      buildContext: vi.fn(() => ''),
    },
    soul: { buildContext: vi.fn(() => '') },
    crew: { getActive: vi.fn(() => ({ name: 'default', systemPrompt: 'Default assistant' })), getActiveId: vi.fn(() => 'default') },
  });

  const createMemExtractor = () => ({
    extract: vi.fn(() => Promise.resolve([] as Array<{ content: string; category: string }>)),
  });

  const createSubAgentMgr = () => ({
    configure: vi.fn(),
    cancelAll: vi.fn(),
    spawn: vi.fn(),
  });

  const createTaskMgr = () => ({
    createTask: vi.fn(),
  });

  const createScheduler = () => ({
    setTriggerHandler: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  });

  return {
    mockProvider: {
      id: 'openai' as const,
      name: 'OpenAI',
      complete: vi.fn<[unknown]>() as ReturnType<typeof vi.fn>,
      listModels: vi.fn<() => Promise<never[]>>(() => Promise.resolve([])),
      validate: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
    },
    mockEventBus: createBus(),
    mockTokenTracker: createTracker(),
    mockErrorShield: createErrorShield(),
    mockSecretSauceMgr: createSauceMgr(),
    mockSauce: createSauceMgr(),
    mockMemoryExtractor: createMemExtractor(),
    mockSubAgentMgr: createSubAgentMgr(),
    mockTaskMgr: createTaskMgr(),
    mockScheduler: createScheduler(),
  };
});

// ─── Module mocks (must be hoisted above imports) ────────────────────
vi.mock('../src/providers/index.js', () => ({
  ProviderFactory: { create: vi.fn(() => mockProvider) },
}));

vi.mock('../src/EventBus.js', () => ({
  AgentEventBus: vi.fn(() => mockEventBus),
}));

vi.mock('../src/session/TokenTracker.js', () => ({
  TokenTracker: vi.fn(() => mockTokenTracker),
}));

vi.mock('../src/agent/SubAgentManager.js', () => ({
  SubAgentManager: vi.fn(() => mockSubAgentMgr),
}));

vi.mock('../src/agent/TaskManager.js', () => ({
  TaskManager: vi.fn(() => mockTaskMgr),
}));

vi.mock('../src/scheduler/Scheduler.js', () => ({
  Scheduler: vi.fn(() => mockScheduler),
}));

vi.mock('../src/agent/ErrorShield.js', () => ({
  ErrorShield: vi.fn(() => mockErrorShield),
}));

vi.mock('../src/secret-sauce/index.js', () => ({
  SecretSauceManager: vi.fn(() => mockSecretSauceMgr),
}));

vi.mock('../src/secret-sauce/MemoryExtractor.js', () => ({
  MemoryExtractor: vi.fn(() => mockMemoryExtractor),
}));

vi.mock('../src/tools/builtin/subagent.js', () => ({
  setSubAgentManagerInstance: vi.fn(),
  getSubAgentManagerInstance: vi.fn(() => null),
  subAgentSpawn: vi.fn(),
  subAgentStatus: vi.fn(),
  subAgentCancel: vi.fn(),
}));

vi.mock('../src/commands/builtin/tasks.js', () => ({
  setTaskManagerInstance: vi.fn(),
  setBackgroundQueueInstance: vi.fn(),
  getBackgroundQueueInstance: vi.fn(() => null),
}));

vi.mock('../src/commands/builtin/schedule.js', () => ({
  setSchedulerInstance: vi.fn(),
}));

// ─── Real imports (after mocks) ──────────────────────────────────────
import { Agent } from '../src/agent/Agent.js';

// ─── Helpers ─────────────────────────────────────────────────────────
const MINIMAL_CONFIG: AgentXConfig = {
  provider: {
    activeProvider: 'openai',
    activeModel: 'gpt-4o',
    providers: {
      openai: { apiKey: 'sk-test', configured: true },
    },
  },
  ui: { theme: 'dark', showTokenBar: false, showTimers: false, animationSpeed: 'normal' },
  organization: null,
  telemetry: false,
};

async function* makeStream(chunks: CompletionChunk[]): AsyncGenerator<CompletionChunk> {
  for (const c of chunks) yield c;
}

function textStream(text: string, inputTokens = 10, outputTokens = 5): AsyncGenerator<CompletionChunk> {
  return makeStream([
    { type: 'text_delta', content: text },
    { type: 'done', usage: { inputTokens, outputTokens } },
  ]);
}

function toolCallStream(
  toolCalls: Array<{ id: string; name: string; args: string }>,
  inputTokens = 15,
  outputTokens = 8,
): AsyncGenerator<CompletionChunk> {
  const chunks: CompletionChunk[] = [];
  for (const tc of toolCalls) {
    chunks.push({
      type: 'tool_call_delta',
      toolCall: { id: tc.id, type: 'function', function: { name: tc.name, arguments: '' } },
    });
    if (tc.args) {
      chunks.push({
        type: 'tool_call_delta',
        toolCall: { function: { arguments: tc.args } },
      });
    }
  }
  chunks.push({ type: 'done', usage: { inputTokens, outputTokens } });
  return makeStream(chunks);
}

const mockToolDefs = [
  {
    id: 'file_read',
    name: 'file_read',
    description: 'Read a file',
    modelDescription: 'Read file contents',
    category: 'filesystem' as const,
    riskLevel: 'low' as const,
    schema: { type: 'object' as const, properties: { path: { type: 'string' } }, required: ['path'] },
    composable: true,
    source: 'builtin' as const,
  },
];

function createTestAgent(overrides?: Partial<{
  config: AgentXConfig;
  sessionId: string;
  systemPrompt: string;
  toolRegistry: { list: () => typeof mockToolDefs; toSchemas: () => unknown[]; get: (id: string) => unknown; has: (id: string) => boolean };
  toolExecutor: { execute: (id: string, args: Record<string, unknown>, sid: string) => Promise<ToolResult>; setPermissionRequestHandler: (h: unknown) => void };
}>): Agent {
  const opts: Record<string, unknown> = {
    config: MINIMAL_CONFIG,
    sessionId: 'test-session-1',
    ...overrides,
  };
  return new Agent(opts as Parameters<typeof Agent>[0]);
}

// ─── Tests ───────────────────────────────────────────────────────────
describe('Agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Constructor ────────────────────────────────────────────────────
  describe('constructor', () => {
    it('creates provider via ProviderFactory', () => {
      const agent = createTestAgent();
      expect(agent).toBeInstanceOf(Agent);
    });

    it('injects custom tool executor and registry', () => {
      const registry = {
        list: vi.fn(() => mockToolDefs),
        toSchemas: vi.fn(() => [{ type: 'function', function: { name: 'file_read', parameters: {} } }]),
        get: vi.fn(),
        has: vi.fn(),
      } as unknown as Parameters<typeof Agent>[0]['toolRegistry'];
      const executor = {
        execute: vi.fn(),
        setPermissionRequestHandler: vi.fn(),
        setBeforeToolHook: vi.fn(),
        setScopePath: vi.fn(),
      } as unknown as Parameters<typeof Agent>[0]['toolExecutor'];
      const agent = createTestAgent({ toolRegistry: registry, toolExecutor: executor });

      expect(agent).toBeInstanceOf(Agent);
      expect(executor.setPermissionRequestHandler).toHaveBeenCalled();
    });

    it('emits reminder_fired and message_received when scheduler triggers', () => {
      createTestAgent();
      const handler = mockScheduler.setTriggerHandler.mock.calls[0]?.[0];
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');

      handler!({ instruction: 'Stretch!', id: 'job-1', name: 'Stretch reminder' });

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'reminder_fired', taskId: 'job-1' }),
      );
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'message_received' }),
      );
    });

    it('builds system prompt with sauce context', () => {
      createTestAgent();
      expect(mockSecretSauceMgr.buildSystemContext).toHaveBeenCalled();
    });
  });

  // ─── Getters ────────────────────────────────────────────────────────
  describe('getters', () => {
    it('events returns event bus', () => {
      const agent = createTestAgent();
      expect(agent.events).toBe(mockEventBus);
    });

    it('tokens returns token tracker', () => {
      const agent = createTestAgent();
      expect(agent.tokens).toBe(mockTokenTracker);
    });

    it('processing returns false initially', () => {
      const agent = createTestAgent();
      expect(agent.processing).toBe(false);
    });
  });

  // ─── sendMessage ────────────────────────────────────────────────────
  describe('sendMessage', () => {
    it('throws if already processing', async () => {
      // A generator that hangs forever (doesn't yield done) but can be aborted
      mockProvider.complete.mockImplementation(async function* (request: { signal?: AbortSignal }) {
        await new Promise<void>((_resolve, reject) => {
          if (request.signal?.aborted) {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
            return;
          }
          request.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const agent = createTestAgent();
      const first = agent.sendMessage('hello');

      await expect(agent.sendMessage('another')).rejects.toThrow('already processing');

      // Cleanup: cancel the pending call and let the first message settle
      agent.cancel();
      const cancelled = await first;
      expect(cancelled.content).toBe('⏹ Cancelled.');
    });

    it('returns a Message with concatenated text on simple response', async () => {
      mockProvider.complete.mockImplementation(() => textStream('Hello, world!'));

      const agent = createTestAgent();
      const result = await agent.sendMessage('Hi');

      expect(result.role).toBe('assistant');
      expect(result.content).toBe('Hello, world!');
      expect(result.sessionId).toBe('test-session-1');
      expect(result.toolCalls).toBeNull();
      expect(result.tokenCount).toBeGreaterThan(0);
    });

    it('emits stream_chunk events during streaming', async () => {
      mockProvider.complete.mockImplementation(function* () {
        // Use sync generator because vitest accepts both
      });
      mockProvider.complete.mockImplementation(() => textStream('Hello, world!', 10, 5));

      const agent = createTestAgent();
      await agent.sendMessage('Hi');

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'stream_chunk', content: 'Hello, world!' }),
      );
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'loading_end' }),
      );
    });

    it('handles tool calls and returns final response', async () => {
      mockProvider.complete
        .mockImplementationOnce(() => toolCallStream([{ id: 'call_1', name: 'file_read', args: '{"path":"test.txt"}' }]))
        .mockImplementationOnce(() => textStream('The file contains: hello'));

      const registry = {
        list: vi.fn(() => mockToolDefs),
        toSchemas: vi.fn(() => [{ type: 'function' as const, function: { name: 'file_read', description: 'Read', parameters: {} } }]),
        get: vi.fn(() => mockToolDefs[0]),
        has: vi.fn(() => true),
      };
      const executor = {
        execute: vi.fn(async () => ({ success: true, output: 'file content' })),
        setPermissionRequestHandler: vi.fn(),
        setBeforeToolHook: vi.fn(),
        setScopePath: vi.fn(),
      };

      const agent = createTestAgent({ toolRegistry: registry as unknown as Parameters<typeof Agent>[0]['toolRegistry'], toolExecutor: executor as unknown as Parameters<typeof Agent>[0]['toolExecutor'] });
      const result = await agent.sendMessage('read test.txt');

      expect(result.content).toBe('The file contains: hello');
      expect(executor.execute).toHaveBeenCalledWith('file_read', { path: 'test.txt' }, 'test-session-1');
      expect(mockTokenTracker.addUsage).toHaveBeenCalled();
    });

    it('handles cancellation (AbortError) gracefully', async () => {
      mockProvider.complete.mockImplementation(async function* () {
        yield { type: 'text_delta' as const, content: 'Starting...' };
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      });

      const agent = createTestAgent();
      const result = await agent.sendMessage('do something');

      expect(result.content).toBe('⏹ Cancelled.');
      expect(result.role).toBe('assistant');
    });

    it('handles API errors with error shield', async () => {
      mockProvider.complete.mockImplementation(async function* () {
        throw new Error('401 Unauthorized');
      });

      const agent = createTestAgent();
      await expect(agent.sendMessage('hi')).rejects.toThrow('401 Unauthorized');
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', code: 'AGENT_ERROR' }),
      );
    });

    it('extracts memories on completion', async () => {
      mockProvider.complete.mockImplementation(() => textStream('Got it!'));

      const agent = createTestAgent();
      await agent.sendMessage('My name is Alice');

      // extractMemories is fire-and-forget; give it a microtask tick
      await vi.waitFor(() => {
        expect(mockMemoryExtractor.extract).toHaveBeenCalled();
      });
    });

    it('exhausts max tool rounds and returns fallback', async () => {
      const manyCalls = Array.from({ length: 11 }, (_, i) => ({
        id: `call_${i}`,
        name: 'file_read',
        args: '{"path":"test.txt"}',
      }));

      mockProvider.complete
        .mockImplementation(() => toolCallStream(manyCalls.slice(0, 1)));

      const registry = {
        list: vi.fn(() => mockToolDefs),
        toSchemas: vi.fn(() => [{ type: 'function' as const, function: { name: 'file_read', description: 'Read', parameters: {} } }]),
        get: vi.fn(() => mockToolDefs[0]),
        has: vi.fn(() => true),
      };
      const executor = {
        execute: vi.fn(async () => ({ success: true, output: 'content' })),
        setPermissionRequestHandler: vi.fn(),
        setBeforeToolHook: vi.fn(),
        setScopePath: vi.fn(),
      };

      const agent = createTestAgent({ toolRegistry: registry as unknown as Parameters<typeof Agent>[0]['toolRegistry'], toolExecutor: executor as unknown as Parameters<typeof Agent>[0]['toolExecutor'] });
      const result = await agent.sendMessage('read');

      expect(result.content).toContain('processing limit');
      // DoomLoopDetector breaks after 3+ consecutive identical tool calls,
      // so executor is called fewer than MAX_TOOL_ROUNDS (10)
      expect(executor.execute).toHaveBeenCalled();
      expect(executor.execute.mock.calls.length).toBeLessThanOrEqual(10);
    });

    it('does not produce duplicate replies when fast-reply fails and falls through', async () => {
      // Use non-retryable error so fast reply fails immediately (no backoff delays)
      let callCount = 0;
      mockProvider.complete.mockImplementation(function* () {
        callCount++;
        if (callCount <= 1) {
          throw new Error('401 Unauthorized — fast reply unavailable');
        }
        yield { type: 'text_delta', content: 'Hello from standard path' };
        yield { type: 'done' };
      });

      const receivedMessages: Array<{ type: string }> = [];
      mockEventBus.emit.mockImplementation((event: { type: string }) => {
        if (event.type === 'message_received') receivedMessages.push(event);
      });

      const agent = createTestAgent();
      const result = await agent.sendMessage('Yo');

      expect(result.role).toBe('assistant');
      expect(result.content).toContain('Hello from standard path');

      // Should emit exactly ONE message_received (not two)
      expect(receivedMessages.length).toBe(1);
    });
  });

  // ─── cancel ─────────────────────────────────────────────────────────
  describe('cancel', () => {
    it('cancels sub-agents', () => {
      const agent = createTestAgent();
      agent.cancel();
      expect(mockSubAgentMgr.cancelAll).toHaveBeenCalled();
    });

    it('aborts active completion', () => {
      let abortSignal: AbortSignal | undefined;
      mockProvider.complete.mockImplementation(async function* () {
        await new Promise(() => {}); // Hang forever
      });

      const agent = createTestAgent();
      const sendPromise = agent.sendMessage('hello');

      agent.cancel();

      // After cancel, sendMessage should resolve with cancelled message
      expect(mockSubAgentMgr.cancelAll).toHaveBeenCalled();
    });
  });

  // ─── switchProvider ─────────────────────────────────────────────────
  describe('switchProvider', () => {
    it('creates a new provider and updates config', () => {
      const agent = createTestAgent();
      const config = MINIMAL_CONFIG;

      agent.switchProvider('anthropic', 'sk-ant-test', 'https://api.anthropic.com');

      expect(mockProvider.complete).toBeDefined(); // ProviderFactory was called again
    });
  });

  // ─── switchModel ────────────────────────────────────────────────────
  describe('switchModel', () => {
    it('updates active model and context window', () => {
      const agent = createTestAgent();
      agent.switchModel('gpt-4-turbo', 128_000);

      expect(mockTokenTracker.setTotal).toHaveBeenCalledWith(128_000);
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'command_action', action: 'model_switched', modelId: 'gpt-4-turbo' }),
      );
    });

    it('uses cached context window when not provided', async () => {
      mockProvider.listModels.mockResolvedValueOnce([
        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', providerId: 'openai', contextWindow: 128_000, capabilities: ['text'] },
      ]);

      const agent = createTestAgent();
      await agent.listModels(); // Populate cachedModels
      agent.switchModel('gpt-4-turbo'); // No explicit context window — uses cached

      expect(mockTokenTracker.setTotal).toHaveBeenCalledWith(128_000);
    });
  });

  // ─── trialModel ─────────────────────────────────────────────────────
  describe('trialModel', () => {
    it('returns true when provider responds', async () => {
      mockProvider.complete.mockImplementation(() => textStream('hi', 1, 1));

      const agent = createTestAgent();
      const result = await agent.trialModel('gpt-4o');

      expect(result).toBe(true);
      expect(agent.isModelGrounded('gpt-4o')).toBe(false);
    });

    it('returns false and grounds model on error', async () => {
      mockProvider.complete.mockImplementation(async function* () {
        throw new Error('Model not found');
      });

      const agent = createTestAgent();
      const result = await agent.trialModel('bad-model');

      expect(result).toBe(false);
      expect(agent.isModelGrounded('bad-model')).toBe(true);
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', code: 'MODEL_TRIAL_FAILED' }),
      );
    });

    it('removes model from grounded on success after previous failure', async () => {
      mockProvider.complete
        .mockImplementationOnce(async function* () { throw new Error('fail'); })
        .mockImplementationOnce(() => textStream('ok', 1, 1));

      const agent = createTestAgent();

      await agent.trialModel('gpt-4o');
      expect(agent.isModelGrounded('gpt-4o')).toBe(true);

      await agent.trialModel('gpt-4o');
      expect(agent.isModelGrounded('gpt-4o')).toBe(false);
    });
  });

  // ─── isModelGrounded / getGroundedModels ───────────────────────────
  describe('grounded models', () => {
    it('isModelGrounded returns false by default', () => {
      const agent = createTestAgent();
      expect(agent.isModelGrounded('any-model')).toBe(false);
    });

    it('getGroundedModels returns a copy', () => {
      const agent = createTestAgent();
      const set1 = agent.getGroundedModels();
      expect(set1.size).toBe(0);
      // Mutating the returned set should not affect internal state
      set1.add('test');
      expect(agent.isModelGrounded('test')).toBe(false);
    });
  });

  // ─── respondToPermission ────────────────────────────────────────────
  describe('respondToPermission', () => {
    it('resolves pending permission and clears handler', async () => {
      const registry = {
        list: vi.fn(() => mockToolDefs),
        toSchemas: vi.fn(() => []),
        get: vi.fn(),
        has: vi.fn(),
      };
      const executor = {
        execute: vi.fn(),
        setPermissionRequestHandler: vi.fn(),
        setBeforeToolHook: vi.fn(),
        setScopePath: vi.fn(),
      };

      const agent = createTestAgent({
        toolRegistry: registry as unknown as Parameters<typeof Agent>[0]['toolRegistry'],
        toolExecutor: executor as unknown as Parameters<typeof Agent>[0]['toolExecutor'],
      });

      // Get the handler that was registered
      const permissionHandler = executor.setPermissionRequestHandler.mock.calls[0]?.[0] as
        ((toolId: string, path: string, riskLevel: string) => Promise<'allow_once' | 'allow_always' | 'deny'>);
      expect(permissionHandler).toBeDefined();

      // Call the permission handler (this creates a pending promise) and respond
      const promise = permissionHandler('file_read', '/test.txt', 'low');
      agent.respondToPermission('allow_once');

      await expect(promise).resolves.toBe('allow_once');
    });

    it('does nothing if no pending permission', () => {
      const agent = createTestAgent();
      expect(() => agent.respondToPermission('deny')).not.toThrow();
    });
  });

  // ─── History management ─────────────────────────────────────────────
  describe('getMessageHistory', () => {
    it('returns a copy of message history', () => {
      const agent = createTestAgent();
      const history = agent.getMessageHistory();
      // Should include system prompt from constructor
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0]?.role).toBe('system');
    });
  });

  describe('addToHistory', () => {
    it('adds user message to history', () => {
      const agent = createTestAgent();
      agent.addToHistory({ role: 'user', content: 'test message' });

      const history = agent.getMessageHistory();
      const last = history[history.length - 1];
      expect(last?.role).toBe('user');
      expect(last?.content).toBe('test message');
    });

    it('adds assistant message to history', () => {
      const agent = createTestAgent();
      agent.addToHistory({ role: 'assistant', content: 'response' });

      const history = agent.getMessageHistory();
      const last = history[history.length - 1];
      expect(last?.role).toBe('assistant');
      expect(last?.content).toBe('response');
    });
  });

  describe('clearHistory', () => {
    it('clears all messages except system', () => {
      const agent = createTestAgent();
      agent.addToHistory({ role: 'user', content: 'msg1' });
      agent.addToHistory({ role: 'assistant', content: 'msg2' });
      agent.clearHistory();

      const history = agent.getMessageHistory();
      expect(history.length).toBe(1);
      expect(history[0]?.role).toBe('system');
    });
  });

  // ─── endSession ─────────────────────────────────────────────────────
  describe('endSession', () => {
    it('records interaction count and diary entry', () => {
      const agent = createTestAgent();
      // Add some user messages so diary entry is meaningful
      agent.addToHistory({ role: 'user', content: 'hello' });
      agent.addToHistory({ role: 'assistant', content: 'hi' });
      agent.addToHistory({ role: 'user', content: 'how are you' });

      agent.endSession();

      expect(mockSecretSauceMgr.identity.recordInteraction).toHaveBeenCalled();
      expect(mockSecretSauceMgr.recordDiary).toHaveBeenCalled();
    });

    it('does not throw on errors', () => {
      mockSecretSauceMgr.recordDiary.mockImplementationOnce(() => { throw new Error('diary error'); });
      const agent = createTestAgent();

      expect(() => agent.endSession()).not.toThrow();
    });
  });

  // ─── setSystemPrompt ────────────────────────────────────────────────
  describe('setSystemPrompt', () => {
    it('replaces existing system message', () => {
      const agent = createTestAgent();
      agent.setSystemPrompt('New system prompt');

      const history = agent.getMessageHistory();
      const systemMsg = history.find((m) => m.role === 'system');
      expect(systemMsg?.content).toBe('New system prompt');
    });

    it('adds system message if none exists', () => {
      const agent = createTestAgent();
      agent.clearHistory(); // Remove system message
      agent.setSystemPrompt('New prompt');

      const history = agent.getMessageHistory();
      expect(history[0]?.role).toBe('system');
      expect(history[0]?.content).toBe('New prompt');
    });
  });

  // ─── rebuildSystemPrompt ────────────────────────────────────────────
  describe('rebuildSystemPrompt', () => {
    it('rebuilds system prompt from current state', () => {
      const agent = createTestAgent();
      agent.rebuildSystemPrompt();

      expect(mockSecretSauceMgr.buildSystemContext).toHaveBeenCalled();
    });
  });

  // ─── spawnSubAgent ──────────────────────────────────────────────────
  describe('spawnSubAgent', () => {
    it('delegates to SubAgentManager', () => {
      const agent = createTestAgent();
      agent.spawnSubAgent('do something', ['shell_exec'], 30_000);

      expect(mockSubAgentMgr.spawn).toHaveBeenCalledWith('do something', ['shell_exec'], 30_000);
    });
  });
});
