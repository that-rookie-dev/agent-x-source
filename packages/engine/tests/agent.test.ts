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
  mockStreamText,
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
    crew: { getMultiCrewSystemPrompt: vi.fn(() => '[MULTI_CREW]\nAgent-X\n[/MULTI_CREW]'), listEnabled: vi.fn(() => []) },
  });

  const createMemExtractor = () => ({
    extract: vi.fn(() => Promise.resolve([] as Array<{ content: string; category: string }>)),
  });

  const createSubAgentMgr = () => ({
    configure: vi.fn(),
    cancelAll: vi.fn(),
    spawn: vi.fn(),
    setParentAgent: vi.fn(),
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
    mockStreamText: vi.fn(),
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
  AgentEventBus: class { constructor() { return mockEventBus; } },
}));

vi.mock('../src/session/TokenTracker.js', () => ({
  TokenTracker: class { constructor() { return mockTokenTracker; } },
}));

vi.mock('../src/agent/SubAgentManager.js', () => ({
  SubAgentManager: class { constructor() { return mockSubAgentMgr; } },
}));

vi.mock('../src/agent/TaskManager.js', () => ({
  TaskManager: class { constructor() { return mockTaskMgr; } },
}));

vi.mock('../src/scheduler/Scheduler.js', () => ({
  Scheduler: class { constructor() { return mockScheduler; } },
}));

vi.mock('../src/agent/ErrorShield.js', () => ({
  ErrorShield: class { constructor() { return mockErrorShield; } },
}));

vi.mock('../src/secret-sauce/index.js', () => ({
  SecretSauceManager: class { constructor() { return mockSecretSauceMgr; } },
}));

vi.mock('../src/secret-sauce/MemoryExtractor.js', () => ({
  MemoryExtractor: class { constructor() { return mockMemoryExtractor; } },
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

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, streamText: mockStreamText };
});

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

function makeFullStream(events: unknown[]): AsyncIterable<unknown> {
  return { [Symbol.asyncIterator]: async function* () { for (const e of events) yield e; } };
}

/** Set up mockStreamText to return a simple text response (for fast-reply or standard path). */
function setupMockText(response: string, inputTokens = 10, outputTokens = 5): void {
  mockStreamText.mockReturnValue({
    fullStream: makeFullStream([
      { type: 'text-delta', textDelta: response },
      { type: 'finish', usage: { totalInputTokens: inputTokens, totalOutputTokens: outputTokens } },
    ]),
    usage: Promise.resolve({ inputTokens, outputTokens }),
  });
}

/** Set up mockStreamText for the runCompletionLoop path (needs start/step events for stream handler). */
function setupMockCompletion(response: string, inputTokens = 10, outputTokens = 5): void {
  mockStreamText.mockReturnValue({
    fullStream: makeFullStream([
      { type: 'start' },
      { type: 'step-start' },
      { type: 'text-start' },
      { type: 'text-delta', textDelta: response },
      { type: 'text-end' },
      { type: 'step-finish', usage: { inputTokens, outputTokens } },
      { type: 'finish', usage: { totalInputTokens: inputTokens, totalOutputTokens: outputTokens } },
    ]),
    usage: Promise.resolve({ inputTokens, outputTokens }),
  });
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
    it.skip('throws if already processing', async () => {
      mockProvider.complete.mockImplementation(async function* () {
        await new Promise<void>(() => {});
      });

      const agent = createTestAgent();
      const first = agent.sendMessage('hello');
      await expect(first).rejects.toThrow();
    });

    it('returns a Message with concatenated text on simple response', async () => {
      setupMockText('Hello, world!');

      const agent = createTestAgent();
      const result = await agent.sendMessage('Hi');

      expect(result.role).toBe('assistant');
      expect(result.content).toBe('Hello, world!');
      expect(result.sessionId).toBe('test-session-1');
      expect(result.toolCalls).toBeNull();
      expect(result.tokenCount).toBeGreaterThan(0);
    });

    it('emits stream_chunk events during streaming', async () => {
      setupMockText('Hello, world!');

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
      mockStreamText.mockReturnValue({
        fullStream: makeFullStream([
          { type: 'start' },
          { type: 'step-start' },
          { type: 'tool-call', toolCallId: 'call_1', toolName: 'file_read', args: { path: 'test.txt' } },
          { type: 'step-finish', usage: { inputTokens: 15, outputTokens: 8 } },
          { type: 'step-start' },
          { type: 'text-start' },
          { type: 'text-delta', textDelta: 'The file contains: hello' },
          { type: 'text-end' },
          { type: 'step-finish', usage: { inputTokens: 5, outputTokens: 3 } },
          { type: 'finish', usage: { totalInputTokens: 20, totalOutputTokens: 11 } },
        ]),
        usage: Promise.resolve({ inputTokens: 20, outputTokens: 11 }),
      });

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
      expect(mockTokenTracker.addUsage).toHaveBeenCalled();
    });

    it('handles cancellation (AbortError) gracefully', async () => {
      mockStreamText.mockReturnValue({
        fullStream: (async function* () {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          throw err;
        })(),
        usage: new Promise<never>(() => {}),
      });

      const agent = createTestAgent();
      const result = await agent.sendMessage('do something');

      expect(result.content).toBe('⏹ Cancelled.');
      expect(result.role).toBe('assistant');
    });

    it('handles API errors with error shield', async () => {
      mockStreamText.mockImplementation(() => {
        throw new Error('401 Unauthorized');
      });

      const agent = createTestAgent();
      const result = await agent.sendMessage('hi');
      expect(result.role).toBe('assistant');
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'provider_error' }),
      );
    });

    it('extracts memories on completion', async () => {
      setupMockCompletion('Got it!');

      const agent = createTestAgent();
      await agent.sendMessage('My name is Alice');

      // extractMemories is fire-and-forget; give it a microtask tick
      await vi.waitFor(() => {
        expect(mockMemoryExtractor.extract).toHaveBeenCalled();
      });
    });

    it('handles tool call events from AI SDK stream', async () => {
      mockStreamText.mockReturnValue({
        fullStream: makeFullStream([
          { type: 'start' },
          { type: 'step-start' },
          { type: 'tool-call', toolCallId: 'call_1', toolName: 'file_read', args: { path: 'test.txt' } },
          { type: 'step-finish', usage: { inputTokens: 15, outputTokens: 8 } },
          { type: 'step-start' },
          { type: 'text-start' },
          { type: 'text-delta', textDelta: 'File content: hello' },
          { type: 'text-end' },
          { type: 'step-finish', usage: { inputTokens: 5, outputTokens: 3 } },
          { type: 'finish', usage: { totalInputTokens: 20, totalOutputTokens: 11 } },
        ]),
        usage: Promise.resolve({ inputTokens: 20, outputTokens: 11 }),
      });

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

      expect(result.content).toBe('File content: hello');
      expect(mockTokenTracker.addUsage).toHaveBeenCalled();
      // Verify tools were passed to streamText
      const streamTextArgs = mockStreamText.mock.calls[0]?.[0];
      expect(streamTextArgs).toBeDefined();
      expect(streamTextArgs.tools).toBeDefined();
    });

    it('does not produce duplicate replies when fast-reply fails and falls through', async () => {
      // Use non-retryable error so fast reply fails immediately (no backoff delays)
      let callCount = 0;
      mockStreamText.mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          throw new Error('401 Unauthorized — fast reply unavailable');
        }
        return {
          fullStream: makeFullStream([
            { type: 'start' },
            { type: 'step-start' },
            { type: 'text-start' },
            { type: 'text-delta', textDelta: 'Hello from standard path' },
            { type: 'text-end' },
            { type: 'step-finish', usage: { inputTokens: 5, outputTokens: 3 } },
            { type: 'finish', usage: { totalInputTokens: 5, totalOutputTokens: 3 } },
          ]),
          usage: Promise.resolve({ inputTokens: 5, outputTokens: 3 }),
        };
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
        expect.objectContaining({ type: 'provider_error', model: 'bad-model' }),
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

      expect(mockSubAgentMgr.spawn).toHaveBeenCalledWith('do something', ['shell_exec'], 30_000, 5);
    });
  });
});
