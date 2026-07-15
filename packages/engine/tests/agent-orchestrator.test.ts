import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { AgentXConfig, CompletionMessage, EngineEvent, PermissionDecision } from '@agentx/shared';
import { SessionOrchestrator } from '../src/services/agent/SessionOrchestrator.js';
import { ChannelOrchestrator } from '../src/services/agent/ChannelOrchestrator.js';
import { TurnOrchestrator, deriveLastUserText } from '../src/services/agent/TurnOrchestrator.js';
import { getChannelPermissionBridge, unregisterChannelPermissionBridge } from '../src/channels/channel-permission-bridge.js';
import type { ToolExecutor } from '../src/tools/ToolExecutor.js';
import type { PermissionManager } from '../src/tools/permissions/PermissionManager.js';

const baseConfig = {
  provider: { activeProvider: 'openai', activeModel: 'gpt-4' },
  user: { callsign: 'tester' },
} as unknown as AgentXConfig;

function makeSessionOrchestrator(overrides: {
  sessionId?: string;
  options?: { channelSession?: boolean; contextKind?: 'agent_x' | 'agent_x_core' | 'crew_private' };
  messages?: CompletionMessage[];
  getToolExecutor?: () => ToolExecutor | undefined;
  getPermissionManager?: () => PermissionManager | undefined;
  getActiveInboundChannel?: () => string | null;
  getConfig?: () => AgentXConfig;
  getScopePath?: () => string;
  emit?: (event: EngineEvent) => void;
} = {}) {
  const events: EngineEvent[] = [];
  const host = {
    sessionId: overrides.sessionId ?? 'sess-1',
    options: overrides.options ?? {},
    messages: overrides.messages ?? [],
    getToolExecutor: overrides.getToolExecutor ?? (() => undefined),
    getPermissionManager: overrides.getPermissionManager ?? (() => undefined),
    getActiveInboundChannel: overrides.getActiveInboundChannel ?? (() => null),
    getConfig: overrides.getConfig ?? (() => baseConfig),
    getScopePath: overrides.getScopePath ?? (() => '/tmp'),
    emit: overrides.emit ?? ((event: EngineEvent) => events.push(event)),
  };
  return { orchestrator: new SessionOrchestrator(host), events };
}

function makeChannelOrchestrator(overrides: {
  sessionId?: string;
  options?: { channelSession?: boolean };
  config?: AgentXConfig;
  getToolExecutor?: () => ToolExecutor | undefined;
  getPermissionManager?: () => PermissionManager | undefined;
  getApiKey?: () => string | undefined;
  removeStorePermissions?: (toolName?: string) => void;
  rebuildSystemPrompt?: () => void;
} = {}) {
  const rebuildSpy = vi.fn();
  const host = {
    sessionId: overrides.sessionId ?? 'tg-123',
    options: overrides.options ?? {},
    config: overrides.config ?? baseConfig,
    getToolExecutor: overrides.getToolExecutor ?? (() => undefined),
    getPermissionManager: overrides.getPermissionManager ?? (() => undefined),
    getApiKey: overrides.getApiKey ?? (() => undefined),
    removeStorePermissions: overrides.removeStorePermissions ?? (() => {}),
    rebuildSystemPrompt: overrides.rebuildSystemPrompt ?? rebuildSpy,
  };
  return { orchestrator: new ChannelOrchestrator(host), rebuildSpy };
}

describe('SessionOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getSessionId returns the host session id', () => {
    const { orchestrator } = makeSessionOrchestrator({ sessionId: 'abc-123' });
    expect(orchestrator.getSessionId()).toBe('abc-123');
  });

  it('set/get linked context session id', () => {
    const { orchestrator } = makeSessionOrchestrator();
    orchestrator.setLinkedContextSessionId('  linked-1  ');
    expect(orchestrator.getLinkedContextSessionId()).toBe('linked-1');
    orchestrator.setLinkedContextSessionId(null);
    expect(orchestrator.getLinkedContextSessionId()).toBeNull();
  });

  it('createChildSession records and emits', () => {
    const { orchestrator, events } = makeSessionOrchestrator();
    const sessionManager = {
      createChildSessionRecord: vi.fn(),
    };
    orchestrator.setSessionManager(sessionManager as any);
    orchestrator.createChildSession('child-1', { kind: 'sub_agent', label: 'Background task' });
    expect(sessionManager.createChildSessionRecord).toHaveBeenCalledWith(
      'child-1',
      'sess-1',
      'openai',
      'gpt-4',
      '/tmp',
      { kind: 'sub_agent', label: 'Background task' },
    );
    expect(events[0]).toMatchObject({ type: 'child_session_started', childSessionId: 'child-1' });
  });

  it('saveCrewState delegates to session manager', () => {
    const { orchestrator } = makeSessionOrchestrator();
    const sessionManager = { saveCrewState: vi.fn() };
    orchestrator.setSessionManager(sessionManager as any);
    orchestrator.saveCrewState('crew-1', true, 5);
    expect(sessionManager.saveCrewState).toHaveBeenCalledWith('crew-1', true, 5);
  });

  it('persistSessionFields and syncSessionRuntimeRecord are best-effort', () => {
    const { orchestrator } = makeSessionOrchestrator();
    const sessionManager = {
      persistSessionFields: vi.fn(),
      syncActiveSessionRuntime: vi.fn(),
    };
    orchestrator.setSessionManager(sessionManager as any);
    orchestrator.persistSessionFields({ tokensUsed: 42 });
    expect(sessionManager.persistSessionFields).toHaveBeenCalledWith('sess-1', { tokensUsed: 42 });
    orchestrator.syncSessionRuntimeRecord({ providerId: 'anthropic', modelId: 'claude-3' });
    expect(sessionManager.syncActiveSessionRuntime).toHaveBeenCalledWith({ providerId: 'anthropic', modelId: 'claude-3' });
  });

  it('persistUserMessage writes to the store with channel metadata', () => {
    const { orchestrator } = makeSessionOrchestrator({ sessionId: '__channel__:telegram' });
    const store = { insertMessage: vi.fn() };
    orchestrator.setSessionManager({ getStorageAdapter: () => store } as any);
    orchestrator.persistUserMessage({
      id: 'm-1',
      sessionId: '__channel__:telegram',
      role: 'user',
      content: 'hello',
      tokenCount: 1,
    } as any);
    expect(store.insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', content: 'hello', metadata: { channel: 'telegram' } }),
    );
  });

  it('persistAssistantMessage writes crew metadata when present', () => {
    const { orchestrator } = makeSessionOrchestrator({ sessionId: '__channel__:telegram' });
    const store = { insertMessage: vi.fn() };
    orchestrator.setSessionManager({ getStorageAdapter: () => store } as any);
    orchestrator.persistAssistantMessage({
      id: 'm-2',
      sessionId: '__channel__:telegram',
      role: 'assistant',
      content: 'hi',
      tokenCount: 1,
      crew: { crewId: 'c-1', name: 'Crew', callsign: 'c' },
    } as any);
    expect(store.insertMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          crewId: 'c-1',
          crewName: 'Crew',
          callsign: 'c',
          channel: 'telegram',
        },
      }),
    );
  });

  it('persistPermissionGrant and restoreSessionPermissions round-trip through the store', () => {
    const { orchestrator } = makeSessionOrchestrator();
    const pm = {
      allowAll: vi.fn(),
      grant: vi.fn(),
      deny: vi.fn(),
    };
    const store = {
      addPermission: vi.fn(),
      getPermissions: vi.fn().mockReturnValue([
        { toolName: 'shell', decision: 'allow_always' },
        { toolName: 'delete', decision: 'deny' },
        { toolName: '*', decision: 'allow_always' },
      ]),
    };
    orchestrator.setSessionManager({ getStorageAdapter: () => store } as any);

    orchestrator.persistPermissionGrant('shell', 'allow_always' as PermissionDecision);
    expect(store.addPermission).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({ toolName: 'shell', decision: 'allow_always' }),
    );

    const orchestrator2 = makeSessionOrchestrator({
      getPermissionManager: () => pm as any,
      getToolExecutor: () => ({ getPermissionManager: () => pm as any } as any),
    }).orchestrator;
    orchestrator2.setSessionManager({ getStorageAdapter: () => store } as any);
    expect(pm.allowAll).toHaveBeenCalled();
    expect(pm.grant).toHaveBeenCalledWith('shell', 'allow_always');
    expect(pm.deny).toHaveBeenCalledWith('delete');
  });

  it('removeStorePermissions delegates to the store', () => {
    const { orchestrator } = makeSessionOrchestrator();
    const store = { removePermissions: vi.fn() };
    orchestrator.setSessionManager({ getStorageAdapter: () => store } as any);
    orchestrator.removeStorePermissions('shell');
    expect(store.removePermissions).toHaveBeenCalledWith('sess-1', 'shell');
  });

  it('getLinkedContextBlock returns null when no link is set', () => {
    const { orchestrator } = makeSessionOrchestrator({ options: { channelSession: true } });
    expect(orchestrator.getLinkedContextBlock()).toBeNull();
  });

  it('resolveContinuationInstructionBlock returns null for ordinary input', () => {
    const { orchestrator } = makeSessionOrchestrator();
    expect(orchestrator.resolveContinuationInstructionBlock('just a normal message')).toBeNull();
  });

  it('noteTurnOutcome persists outstanding task on failure content', () => {
    const { orchestrator } = makeSessionOrchestrator({
      messages: [{ role: 'user', content: 'do it' } as CompletionMessage],
    });
    const store = {
      getSessionResumeState: vi.fn().mockReturnValue(null),
      setSessionResumeState: vi.fn(),
    };
    orchestrator.setSessionManager({ getStorageAdapter: () => store } as any);
    orchestrator.noteTurnOutcome('I apologize, I was unable to generate the response.');
    expect(store.setSessionResumeState).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({ kind: 'outstanding_task' }),
    );
  });

  it('noteTurnOutcome clears outstanding task on substantial success', () => {
    const { orchestrator } = makeSessionOrchestrator({
      messages: [{ role: 'user', content: 'do it' } as CompletionMessage],
    });
    const store = {
      getSessionResumeState: vi.fn().mockReturnValue({ kind: 'outstanding_task', payload: '' }),
      clearSessionResumeState: vi.fn(),
    };
    orchestrator.setSessionManager({ getStorageAdapter: () => store } as any);
    orchestrator.noteTurnOutcome('Here is a long, successful response with more than forty characters of content.');
    expect(store.clearSessionResumeState).toHaveBeenCalledWith('sess-1');
  });
});

describe('ChannelOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('setTelegramConnected stores state and rebuilds the system prompt', () => {
    const { orchestrator, rebuildSpy } = makeChannelOrchestrator();
    orchestrator.setTelegramConnected(true, 42);
    expect(orchestrator.getTelegramConnected()).toBe(true);
    expect(rebuildSpy).toHaveBeenCalled();
  });

  it('beginChannelTurn for telegram sets tool executor messaging mode', () => {
    const toolExecutor = {
      setMessagingPermissionMode: vi.fn(),
      setInboundSourceChannel: vi.fn(),
    };
    const { orchestrator } = makeChannelOrchestrator({
      getToolExecutor: () => toolExecutor as any,
    });
    expect(orchestrator.beginChannelTurn('telegram')).toBe(true);
    expect(orchestrator.getActiveInboundChannel()).toBe('telegram');
    expect(toolExecutor.setMessagingPermissionMode).toHaveBeenCalledWith(true);
    expect(toolExecutor.setInboundSourceChannel).toHaveBeenCalledWith('telegram');
  });

  it('beginChannelTurn for non-messaging source clears channel', () => {
    const toolExecutor = {
      setMessagingPermissionMode: vi.fn(),
      setInboundSourceChannel: vi.fn(),
    };
    const { orchestrator } = makeChannelOrchestrator();
    expect(orchestrator.beginChannelTurn('web-ui')).toBe(false);
    expect(orchestrator.getActiveInboundChannel()).toBeNull();
  });

  it('endChannelTurn resets tool executor state', () => {
    const toolExecutor = {
      setMessagingPermissionMode: vi.fn(),
      setInboundSourceChannel: vi.fn(),
    };
    const { orchestrator } = makeChannelOrchestrator({ getToolExecutor: () => toolExecutor as any });
    orchestrator.beginChannelTurn('discord');
    orchestrator.endChannelTurn();
    expect(orchestrator.getActiveInboundChannel()).toBeNull();
    expect(toolExecutor.setMessagingPermissionMode).toHaveBeenLastCalledWith(false);
    expect(toolExecutor.setInboundSourceChannel).toHaveBeenLastCalledWith(null);
  });

  it('isMessagingChannelContext respects options.channelSession and active channel', () => {
    const { orchestrator: a } = makeChannelOrchestrator({ options: { channelSession: true } });
    expect(a.isMessagingChannelContext()).toBe(true);

    const { orchestrator: b } = makeChannelOrchestrator({ options: { channelSession: false } });
    expect(b.isMessagingChannelContext()).toBe(false);
    b.beginChannelTurn('slack');
    expect(b.isMessagingChannelContext()).toBe(true);
  });

  it('formatChannelToolPermissions shows allow-all state', () => {
    const pm = { isAllAllowed: () => true, list: () => [] } as any;
    const { orchestrator } = makeChannelOrchestrator({ getPermissionManager: () => pm });
    const text = orchestrator.formatChannelToolPermissions();
    expect(text).toContain('All tools are always allowed');
  });

  it('formatChannelToolPermissions lists allowed and denied tools', () => {
    const pm = {
      isAllAllowed: () => false,
      list: () => [
        { id: 'p1', toolName: 'shell', decision: 'allow_always' },
        { id: 'p2', toolName: 'delete', decision: 'deny' },
      ],
    } as any;
    const { orchestrator } = makeChannelOrchestrator({ getPermissionManager: () => pm });
    const text = orchestrator.formatChannelToolPermissions();
    expect(text).toContain('shell');
    expect(text).toContain('delete');
  });

  it('revokeChannelToolPermissions revokes and removes store permissions', () => {
    const pm = { revoke: vi.fn(), revokeAll: vi.fn() } as any;
    const removeStorePermissions = vi.fn();
    const { orchestrator } = makeChannelOrchestrator({
      getPermissionManager: () => pm,
      removeStorePermissions,
    });
    orchestrator.revokeChannelToolPermissions(['shell', 'delete']);
    expect(pm.revoke).toHaveBeenCalledWith('shell');
    expect(pm.revoke).toHaveBeenCalledWith('delete');
    expect(removeStorePermissions).toHaveBeenCalledWith('shell');
    expect(removeStorePermissions).toHaveBeenCalledWith('delete');

    orchestrator.revokeChannelToolPermissions(undefined, true);
    expect(pm.revokeAll).toHaveBeenCalled();
    expect(removeStorePermissions).toHaveBeenLastCalledWith();
  });

  it('registerPermissionBridge registers the bridge for the session', () => {
    const { orchestrator } = makeChannelOrchestrator({ sessionId: 'tg-bridge-1' });
    orchestrator.registerPermissionBridge();
    const bridge = getChannelPermissionBridge('tg-bridge-1');
    expect(bridge).not.toBeNull();
    expect(typeof bridge?.list).toBe('function');
    expect(typeof bridge?.revoke).toBe('function');
    unregisterChannelPermissionBridge('tg-bridge-1');
  });
});

describe('TurnOrchestrator', () => {
  it('deriveLastUserText strips TURN marker lines', () => {
    const messages: CompletionMessage[] = [
      { role: 'user', content: 'hello world\n[TURN-123] extra instruction' } as CompletionMessage,
      { role: 'assistant', content: 'hi' } as CompletionMessage,
    ];
    expect(deriveLastUserText(messages)).toBe('hello world');
  });

  it('deriveLastUserText returns empty string when no user message', () => {
    expect(deriveLastUserText([])).toBe('');
  });

  it('runTurn throws when tool registry is missing', async () => {
    const host = {
      toolRegistry: undefined,
      toolService: undefined,
      emit: () => {},
      compactContext: async () => false,
      reconcileSystemPrompt: async () => {},
    } as any;
    const orchestrator = new TurnOrchestrator(host);
    await expect(orchestrator.runTurn('sess-1', 'hello', { startTime: Date.now() })).rejects.toThrow('Tool registry not initialized');
  });
});
