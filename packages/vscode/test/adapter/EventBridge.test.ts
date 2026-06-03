import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBridge } from '../../src/adapter/EventBridge';
import type { AgentEventBus } from '@agentx/engine';
import type { EngineEvent, EventHandler } from '@agentx/shared';

function createMockEventBus(): { bus: AgentEventBus; emit: (event: EngineEvent) => void } {
  let handler: EventHandler | null = null;
  const bus: AgentEventBus = {
    emit: (event: EngineEvent) => {
      if (handler) handler(event);
    },
    on: (h: EventHandler) => {
      handler = h;
      return () => { handler = null; };
    },
    off: () => { handler = null; },
  };
  return {
    bus,
    emit: (event: EngineEvent) => bus.emit(event),
  };
}

describe('EventBridge', () => {
  let mockBus: ReturnType<typeof createMockEventBus>;
  let bridge: EventBridge;

  beforeEach(() => {
    mockBus = createMockEventBus();
    bridge = new EventBridge(mockBus.bus, 0);
  });

  afterEach(() => {
    bridge.dispose();
  });

  it('emits message events on onMessage', () => {
    const handler = vi.fn();
    bridge.onMessage(handler);

    mockBus.emit({
      type: 'message_received',
      message: {
        id: 'msg-1',
        sessionId: 'sess-1',
        role: 'assistant',
        content: 'Hello!',
        toolCalls: null,
        tokenCount: 10,
        createdAt: new Date().toISOString(),
      },
      elapsed: 500,
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].content).toBe('Hello!');
    expect(handler.mock.calls[0][0].role).toBe('assistant');
  });

  it('emits stream chunks on onStream', () => {
    const handler = vi.fn();
    bridge.onStream(handler);

    mockBus.emit({ type: 'stream_chunk', content: 'Hel', fullContent: 'Hel' });
    mockBus.emit({ type: 'stream_chunk', content: 'lo', fullContent: 'Hello' });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[1][0].fullContent).toBe('Hello');
  });

  it('emits tool events on onToolEvent', () => {
    const handler = vi.fn();
    bridge.onToolEvent(handler);

    mockBus.emit({ type: 'tool_executing', tool: 'file_read', description: 'Reading file', startTime: Date.now() });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].toolName).toBe('file_read');
    expect(handler.mock.calls[0][0].status).toBe('executing');
  });

  it('emits permission events on onPermission', () => {
    const handler = vi.fn();
    bridge.onPermission(handler);

    mockBus.emit({ type: 'permission_required', tool: 'shell_exec', path: '/tmp', riskLevel: 'high' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].tool).toBe('shell_exec');
    expect(handler.mock.calls[0][0].riskLevel).toBe('high');
  });

  it('emits error events on onError', () => {
    const handler = vi.fn();
    bridge.onError(handler);

    mockBus.emit({
      type: 'error',
      code: 'AUTH_FAILED',
      message: 'Invalid API key',
      recoverable: true,
      actions: [{ type: 'reconfigure_key' as const, label: 'Fix Key' }],
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].code).toBe('AUTH_FAILED');
    expect(handler.mock.calls[0][0].actions).toHaveLength(1);
  });

  it('emits plan events on onPlanEvent', () => {
    const handler = vi.fn();
    bridge.onPlanEvent(handler);

    mockBus.emit({ type: 'plan_mode_entered' });
    mockBus.emit({ type: 'plan_mode_exited' });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('emits reasoning events with accumulated glimpses', () => {
    const handler = vi.fn();
    bridge.onReasoning(handler);

    mockBus.emit({ type: 'reasoning_start' });
    mockBus.emit({ type: 'reasoning_glimpse', text: 'thinking step 1' });
    mockBus.emit({ type: 'reasoning_glimpse', text: 'thinking step 2' });
    mockBus.emit({ type: 'reasoning_complete' });

    expect(handler).toHaveBeenCalledTimes(4);
    expect(handler.mock.calls[2][0].glimpses).toEqual(['thinking step 1', 'thinking step 2']);
    expect(handler.mock.calls[3][0].isActive).toBe(false);
  });

  it('emits all events on onMeta', () => {
    const handler = vi.fn();
    bridge.onMeta(handler);

    mockBus.emit({ type: 'loading_start', stage: 'init' });
    mockBus.emit({ type: 'loading_end' });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('disposable removes handler', () => {
    const handler = vi.fn();
    const disposable = bridge.onMessage(handler);

    mockBus.emit({
      type: 'message_received',
      message: {
        id: 'msg-1',
        sessionId: 'sess-1',
        role: 'assistant',
        content: 'First',
        toolCalls: null,
        tokenCount: 5,
        createdAt: new Date().toISOString(),
      },
      elapsed: 100,
    });

    disposable.dispose();

    mockBus.emit({
      type: 'message_received',
      message: {
        id: 'msg-2',
        sessionId: 'sess-1',
        role: 'assistant',
        content: 'Second',
        toolCalls: null,
        tokenCount: 5,
        createdAt: new Date().toISOString(),
      },
      elapsed: 100,
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('tracks indexing state', () => {
    const handler = vi.fn();
    bridge.onIndexing(handler);

    mockBus.emit({ type: 'indexing_start', totalFiles: 100 });
    mockBus.emit({ type: 'indexing_progress', indexed: 50, total: 100, currentFile: 'src/foo.ts' });
    mockBus.emit({ type: 'indexing_complete', indexed: 100, total: 100, chunks: 500 });

    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler.mock.calls[0][0].isActive).toBe(true);
    expect(handler.mock.calls[1][0].indexed).toBe(50);
    expect(handler.mock.calls[2][0].isActive).toBe(false);
    expect(handler.mock.calls[2][0].chunks).toBe(500);
  });

  it('tracks research state', () => {
    const handler = vi.fn();
    bridge.onResearch(handler);

    mockBus.emit({ type: 'research_start', question: 'What is X?' });
    mockBus.emit({ type: 'research_query', queryId: 'q1', question: 'Sub-question', sources: 'web' });
    mockBus.emit({
      type: 'research_subagent_complete',
      queryId: 'q1',
      result: { queryId: 'q1', question: 'Sub-question', answer: 'Answer', sources: ['url1'], elapsed: 1000 },
    });
    mockBus.emit({ type: 'research_synthesis', resultCount: 1 });
    mockBus.emit({ type: 'research_complete', report: 'Final report' });

    expect(handler).toHaveBeenCalledTimes(5);
    expect(handler.mock.calls[4][0].isActive).toBe(false);
    expect(handler.mock.calls[4][0].report).toBe('Final report');
  });

  it('dispose unsubscribes from event bus', () => {
    const handler = vi.fn();
    bridge.onMessage(handler);
    bridge.dispose();

    mockBus.emit({
      type: 'message_received',
      message: {
        id: 'msg-1',
        sessionId: 'sess-1',
        role: 'assistant',
        content: 'After dispose',
        toolCalls: null,
        tokenCount: 5,
        createdAt: new Date().toISOString(),
      },
      elapsed: 100,
    });

    expect(handler).not.toHaveBeenCalled();
  });
});
