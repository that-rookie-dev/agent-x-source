import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { getEngine } from './engine.js';
import { validateWebSocketConnection } from './auth.js';
import { registerWebSocketRoute } from './ws-upgrade-router.js';
import { getLogger, stripToolNoise, appendStreamText, repairStreamTextGlitches, type MessagePart, attachDeepSearchPartsFromTools, attachChartPartsFromTools, deepSearchBundleFromMetadata, upsertDeepSearchPart } from '@agentx/shared';
import type { DeepSearchProgress, EngineEvent, EventHandler, Message, MessageMetadata, NormalizedAttachment } from '@agentx/shared';
import { MemoryFabric } from '@agentx/engine';

interface PartRecord {
  type: string;
  content?: string;
  toolName?: string;
  toolCallId?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  toolSuccess?: boolean;
  usage?: { inputTokens: number; outputTokens: number };
  timestamp: number;
}

/**
 * Incrementally persist each AI SDK part event to PostgreSQL.
 */
export function persistPart(sessionId: string, part: PartRecord): void {
  if (!sessionId) return;
  try {
    const eng = getEngine();
    const store = eng.sessionManager.getStorageAdapter();
    if (store?.insertPart) { store.insertPart(sessionId, part); }
  } catch { /* best-effort */ }
}
interface SubAgentRecord { id: string; name: string; task: string; status: 'running' | 'done' | 'error'; result?: string }
interface CrewInfo { crewId: string; name: string; callsign: string; color?: string; icon?: string; confidence?: string; reasons?: string[] }
interface ToolCallRecord { id: string; name: string; args: unknown; status: string; result?: string; elapsed?: number; metadata?: Record<string, unknown> }

function buildPersistMetadata(
  extra?: {
    thinking?: string;
    thinkingStartedAt?: number;
    thinkingDoneAt?: number;
    subAgents?: SubAgentRecord[];
    turnTokens?: number;
    turnCostUsd?: number;
    metadata?: MessageMetadata;
  },
  crew?: CrewInfo,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = { ...(extra?.metadata as Record<string, unknown> | undefined) };
  if (extra?.thinking) metadata['thinking'] = extra.thinking;
  if (extra?.thinkingStartedAt != null) metadata['thinkingStartedAt'] = extra.thinkingStartedAt;
  if (extra?.thinkingDoneAt != null) metadata['thinkingDoneAt'] = extra.thinkingDoneAt;
  if (extra?.subAgents && extra.subAgents.length > 0) metadata['subAgents'] = extra.subAgents;
  if (extra?.turnTokens != null) metadata['turnTokens'] = extra.turnTokens;
  if (extra?.turnCostUsd != null) metadata['turnCostUsd'] = extra.turnCostUsd;
  if (crew) {
    metadata['crewId'] = crew.crewId;
    metadata['crewName'] = crew.name;
    metadata['callsign'] = crew.callsign;
  }
  return metadata;
}

function appendContextFile(
  sessionId: string,
  role: string,
  content: string,
  crew?: CrewInfo,
  extra?: {
    thinking?: string;
    thinkingStartedAt?: number;
    thinkingDoneAt?: number;
    toolCalls?: ToolCallRecord[];
    subAgents?: SubAgentRecord[];
    parts?: Array<Record<string, unknown>>;
    plan?: string[];
    turnTokens?: number;
    turnCostUsd?: number;
    tokenCount?: number;
    metadata?: MessageMetadata;
    attachments?: NormalizedAttachment[];
  },
  messageId?: string,
): void {
  if (!sessionId || !content) return;

  // Crew-attributed messages: persist for crew_private (Agent path); skip for Agent-X delegation (orchestrator persists)
  if (crew) {
    try {
      const eng = getEngine();
      const session = eng.sessionManager.getSessionById(sessionId);
      const isCrewPrivate = (session?.contextKind ?? 'agent_x') === 'crew_private';
      if (!isCrewPrivate) return;

      const store = eng.sessionManager.getStorageAdapter();
      if (store?.insertMessage) {
        store.insertMessage({
          id: messageId,
          sessionId,
          role,
          content,
          toolCalls: extra?.toolCalls,
          tokenCount: extra?.tokenCount,
          thinking: extra?.thinking,
          plan: extra?.plan ? JSON.stringify(extra.plan) : undefined,
          parts: extra?.parts,
          attachments: extra?.attachments,
          metadata: buildPersistMetadata(extra, crew),
        });
      }
    } catch { /* best-effort */ }
    return;
  }

  // Primary: messages table
  try {
    const eng = getEngine();
    const store = eng.sessionManager.getStorageAdapter();
    if (store?.insertMessage) {
      // Augment with the active provider/model if the caller didn't supply them.
      const metadata = buildPersistMetadata(extra);
      if (!metadata['provider'] || !metadata['model']) {
        try {
          const cfg = eng.configManager.load();
          if (!metadata['provider']) metadata['provider'] = cfg.provider.activeProvider;
          if (!metadata['model']) metadata['model'] = cfg.provider.activeModel;
        } catch { /* ignore */ }
      }
      store.insertMessage({
        id: messageId,
        sessionId,
        role,
        content,
        toolCalls: extra?.toolCalls,
        tokenCount: extra?.tokenCount,
        thinking: extra?.thinking,
        plan: extra?.plan ? JSON.stringify(extra.plan) : undefined,
        parts: extra?.parts,
        attachments: extra?.attachments,
        metadata,
      });
    }
  } catch { /* best-effort */ }
}

/**
 * Directly persist a message to PostgreSQL — independent of WebSocket subscription.
 */
export function persistMessageDirect(sessionId: string, role: string, content: string, extra?: { thinking?: string; toolCalls?: ToolCallRecord[]; metadata?: MessageMetadata }): void {
  appendContextFile(sessionId, role, content, undefined, extra);
}

let wss: WebSocketServer | null = null;
let subscribedAgent: unknown | null = null;
let unsubscribeFromAgent: (() => void) | null = null;
const sessionEventSubscribers = new Map<WebSocket, () => void>();

function getMemoryFabric(): MemoryFabric | null {
  const pool = getEngine().pgPool;
  if (!pool) return null;
  return new MemoryFabric(pool);
}

async function ingestConversationMemory(_sessionId: string, _role: 'user' | 'assistant', _text: string): Promise<void> {
  /* Chat memory is handled by ChatTurnMemoryIngester in the Agent — WS distillation removed. */
}

export function setupWebSocket(server: Server): void {
  wss = new WebSocketServer({
    noServer: true,
    verifyClient: (info, cb) => {
      if (validateWebSocketConnection(info.req)) {
        cb(true);
      } else {
        cb(false, 401, 'Unauthorized');
      }
    },
  });
  registerWebSocketRoute('/ws', wss);

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') return;
    console.error('WebSocket server error:', err.message);
  });

  wss.on('error', (err) => {
    if ('code' in err && err.code === 'EADDRINUSE') return;
    console.error('WebSocket error:', err.message);
  });

  // Enable built-in ping/pong on the WebSocket server
  // No custom headers needed

  // Heartbeat interval — ping every 30s, close if no pong within 10s
  const HEARTBEAT_INTERVAL_MS = 30000;
  const HEARTBEAT_TIMEOUT_MS = 10000;

  wss.on('connection', (ws: WebSocket) => {
    let isAlive = true;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;

    ws.send(JSON.stringify({ type: 'connected' }));

    // Start heartbeat for this connection
    heartbeatTimer = setInterval(() => {
      if (!isAlive) {
        // No pong received since last ping — terminate
        ws.terminate();
        return;
      }
      isAlive = false;
      try {
        ws.ping();
      } catch {
        // Connection may already be closed
        clearInterval(heartbeatTimer!);
      }
      // Timeout: if no pong within the window, terminate
      heartbeatTimeout = setTimeout(() => {
        if (!isAlive) {
          ws.terminate();
        }
      }, HEARTBEAT_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);

    // Handle pong responses
    ws.on('pong', () => {
      isAlive = true;
      if (heartbeatTimeout) {
        clearTimeout(heartbeatTimeout);
        heartbeatTimeout = null;
      }
    });

    ws.on('close', () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (heartbeatTimeout) {
        clearTimeout(heartbeatTimeout);
        heartbeatTimeout = null;
      }
      const unsub = sessionEventSubscribers.get(ws);
      if (unsub) {
        unsub();
        sessionEventSubscribers.delete(ws);
      }
      // Check if agent was processing when client disconnected
      try {
        const eng = getEngine();
        const agent = eng.agent;
        if (agent && typeof agent.lifecycle?.isProcessing === 'function' && agent.lifecycle.isProcessing()) {
          getLogger().info('WS', `Client disconnected while agent was ${agent.lifecycle.getState()}. Events will be persisted for replay.`);
        }
      } catch { /* best-effort */ }
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleWsMessage(ws, msg);
      } catch {
        // ignore malformed
      }
    });
  });
}

async function handleWsMessage(ws: WebSocket, msg: { type: string; [key: string]: unknown }): Promise<void> {
  switch (msg.type) {
    case 'chat_message': {
      const text = msg.text;
      if (typeof text !== 'string' || !text) {
        broadcast({ type: 'error', message: 'Invalid message: text is required' });
        return;
      }
      try {
        const eng = getEngine();
        const agent = eng.agent;
        if (!agent) {
          broadcast({ type: 'engine_event', event: 'error', data: { code: 'no-session', message: 'No active session — create a session first' } });
          return;
        }
        ensureSubscribed();
        await agent.sendMessage(text);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Chat failed';
        broadcast({ type: 'engine_event', event: 'error', data: { code: 'AGENT_ERROR', message } });
      }
      break;
    }
    case 'cancel': {
      const eng = getEngine();
      const agent = eng.agent;
      if (agent) agent.cancel();
      break;
    }
    case 'permission_respond': {
      const eng = getEngine();
      const agent = eng.agent;
      const requestId = msg.requestId;
      const choice = msg.choice;
      if (agent && typeof requestId === 'string' && typeof choice === 'string'
        && (choice === 'allow_once' || choice === 'allow_always' || choice === 'deny')) {
        agent.respondToPermission(requestId, choice);
      }
      break;
    }
    case 'permission_respond_batch': {
      const eng = getEngine();
      const agent = eng.agent;
      const choice = msg.choice;
      if (agent && typeof choice === 'string'
        && (choice === 'allow_once' || choice === 'allow_always' || choice === 'deny')) {
        agent.respondToPermissionBatch(choice);
      }
      break;
    }
    case 'clarification_response': {
      const eng = getEngine();
      const agent = eng.agent;
      const response = msg.response;
      if (agent && typeof response === 'string' && response) agent.respondToClarification(response);
      break;
    }
    case 'checkpoint_response': {
      const eng = getEngine();
      const agent = eng.agent;
      const checkpointId = msg.checkpointId;
      const action = msg.action;
      if (agent && typeof checkpointId === 'string' && typeof action === 'string') {
        const resolved = agent.resolveCheckpoint(checkpointId, action);
        if (!resolved) {
          getLogger().warn('WS', `Checkpoint ${checkpointId.slice(0, 12)} not found on agent`);
        }
      }
      break;
    }
    case 'subscribe': {
      const sessionId = msg.sessionId;
      if (typeof sessionId !== 'string' || !sessionId) break;
      try {
        const eng = getEngine();
        const agent = eng.agent;
        if (agent && agent.events && typeof agent.events.onSessionEvent === 'function') {
          const unsubOld = sessionEventSubscribers.get(ws);
          if (unsubOld) unsubOld();
          const unsub = agent.events.onSessionEvent((event: Record<string, unknown>) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'session_event', data: event }));
            }
          });
          sessionEventSubscribers.set(ws, unsub);
        }
        // Send current session state (agent processing status) so client knows if tasks are running
        if (agent && typeof agent.lifecycle?.isProcessing === 'function') {
          ws.send(JSON.stringify({
            type: 'session_state',
            sessionId,
            processing: agent.lifecycle.isProcessing(),
            state: agent.lifecycle.getState(),
          }));
        }
        // Emit any unconsumed completed background task results so the UI
        // sees them immediately on reconnect (the tasks may have completed
        // while the WS client was disconnected).
        try {
          const { getSubAgentServiceInstance } = await import('@agentx/engine');
          const subAgentService = getSubAgentServiceInstance();
          const unconsumed = subAgentService.getUnconsumedResults(sessionId);
          for (const task of unconsumed) {
            const tokensUsed = (task.resourceUsage?.tokenUsage?.input ?? 0) + (task.resourceUsage?.tokenUsage?.output ?? 0);
            const elapsedMs = (task.endTime ?? Date.now()) - (task.startTime ?? Date.now());
            ws.send(JSON.stringify({
              type: 'engine_event',
              event: 'background_task_complete',
              data: {
                type: 'background_task_complete',
                sessionId,
                taskId: task.id,
                childSessionId: task.childSessionId ?? task.id,
                tokensUsed,
                elapsedMs,
                summary: (task.result ?? '').slice(0, 200),
                instruction: task.instruction?.slice(0, 300),
                success: true,
              },
            }));
          }
        } catch { /* best-effort */ }
      } catch {
        // best-effort
      }
      break;
    }
    default:
      break;
  }
}

export function broadcast(data: Record<string, unknown>): void {
  if (!wss) return;
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

export function unsubscribeAgent(): void {
  if (unsubscribeFromAgent) {
    unsubscribeFromAgent();
    unsubscribeFromAgent = null;
  }
  subscribedAgent = null;
}

export function subscribeToAgent(agent: { events: { on: (handler: EventHandler) => () => void }; sessionId?: string }): void {
  // Unsubscribe from previous agent to prevent memory leak
  unsubscribeAgent();
  if (subscribedAgent === agent) return;
  subscribedAgent = agent;

  // Capture the agent's session ID at subscription time — use this for ALL
  // persistence calls instead of getActiveSession(). This prevents message/part
  // writes from going to the wrong session after the user navigates to a
  // different session (which changes the active session pointer).
  const subscribedSessionId = agent.sessionId ?? '';

  // Accumulate rich metadata during a turn so it can be persisted with the message_received record
  let accumulatedThinking = '';
  let thinkingStartedAt: number | null = null;
  const toolCallMap = new Map<string, ToolCallRecord>();
  const subAgentMap = new Map<string, SubAgentRecord>();
  let currentPlan: string[] | null = null;
  let perTurnTokens: number | undefined;
  let perTurnCostUsd: number | undefined;
  const accumulatedParts: MessagePart[] = [];
  let textBuffer = '';
  /** Last assistant message id written this subscription — used to patch late sub-agent completions. */
  let lastPersistedAssistantId: string | undefined;

  function flushTextBuffer(): void {
    const clean = stripToolNoise(textBuffer);
    if (clean) {
      const last = accumulatedParts[accumulatedParts.length - 1];
      if (last?.type === 'text') {
        last.content = (last.content || '') + (last.content ? '\n' : '') + clean;
      } else {
        accumulatedParts.push({ type: 'text', id: crypto.randomUUID(), content: clean });
      }
    }
    textBuffer = '';
  }

  function resetAccumulators(): void {
    accumulatedThinking = '';
    thinkingStartedAt = null;
    toolCallMap.clear();
    subAgentMap.clear();
    currentPlan = null;
    perTurnTokens = undefined;
    perTurnCostUsd = undefined;
    accumulatedParts.length = 0;
    textBuffer = '';
  }

  function buildExtra(thinkingText?: string): {
    thinking?: string;
    thinkingStartedAt?: number;
    thinkingDoneAt?: number;
    toolCalls?: ToolCallRecord[];
    subAgents?: SubAgentRecord[];
    parts?: Array<Record<string, unknown>>;
    plan?: string[];
    turnTokens?: number;
    turnCostUsd?: number;
    tokenCount?: number;
    attachments?: NormalizedAttachment[];
  } {
    const toolCalls = Array.from(toolCallMap.values());
    const subAgents = Array.from(subAgentMap.values());
    // Ensure every sub-agent is represented in parts (chronological cards on restore).
    for (const sa of subAgents) {
      const idx = accumulatedParts.findIndex((p) => p.type === 'subagent' && p.agent?.id === sa.id);
      const agentPart: MessagePart = {
        type: 'subagent',
        id: sa.id,
        agent: {
          id: sa.id,
          name: sa.name,
          task: sa.task,
          status: sa.status,
          result: sa.result,
          kind: 'sub_agent',
        },
      };
      if (idx >= 0) accumulatedParts[idx] = agentPart;
      else accumulatedParts.push(agentPart);
    }
    let parts = accumulatedParts.length > 0
      ? JSON.parse(JSON.stringify(accumulatedParts)) as MessagePart[]
      : undefined;
    if (parts) parts = attachChartPartsFromTools(attachDeepSearchPartsFromTools(parts, toolCalls), toolCalls);
    const extra: ReturnType<typeof buildExtra> = {};
    if (thinkingText) extra.thinking = thinkingText;
    if (thinkingStartedAt != null) extra.thinkingStartedAt = thinkingStartedAt;
    if (thinkingText) extra.thinkingDoneAt = Date.now();
    if (toolCalls.length > 0) extra.toolCalls = toolCalls;
    if (subAgents.length > 0) extra.subAgents = subAgents;
    if (parts) extra.parts = parts;
    if (currentPlan && currentPlan.length > 0) extra.plan = currentPlan;
    if (perTurnTokens != null) { extra.turnTokens = perTurnTokens; extra.tokenCount = perTurnTokens; }
    if (perTurnCostUsd != null) extra.turnCostUsd = perTurnCostUsd;
    return extra;
  }

  function persistAssistantTurnPatch(sessionId: string, messageId: string | undefined, patch: {
    thinking?: string;
    thinkingStartedAt?: number | null;
    thinkingDoneAt?: number;
    subAgents?: SubAgentRecord[];
    parts?: MessagePart[];
    content?: string;
  }): void {
    if (!sessionId || !messageId) return;
    try {
      const eng = getEngine();
      const store = eng.sessionManager.getStorageAdapter();
      const existing = store.getMessages?.(sessionId)?.find((m) => m.id === messageId);
      if (!existing) return;
      const prevMeta = typeof existing.metadata === 'string'
        ? (() => { try { return JSON.parse(existing.metadata) as Record<string, unknown>; } catch { return {}; } })()
        : { ...(existing.metadata as Record<string, unknown> | undefined) };
      const metadata: Record<string, unknown> = { ...prevMeta };
      if (patch.thinking) metadata['thinking'] = patch.thinking;
      if (patch.thinkingStartedAt != null) metadata['thinkingStartedAt'] = patch.thinkingStartedAt;
      if (patch.thinkingDoneAt != null) metadata['thinkingDoneAt'] = patch.thinkingDoneAt;
      if (patch.subAgents) metadata['subAgents'] = patch.subAgents;
      store.updateMessage?.(sessionId, messageId, {
        ...(patch.content != null ? { content: patch.content } : {}),
        ...(patch.parts ? { parts: patch.parts } : {}),
        metadata,
      });
    } catch { /* best-effort */ }
  }

  unsubscribeFromAgent = agent.events.on((event: EngineEvent) => {
    const evType: string = event.type;
    broadcast({
      type: 'engine_event',
      event: evType,
      sessionId: subscribedSessionId || undefined,
      data: {
        ...(event as unknown as Record<string, unknown>),
        // Stamp owning session so clients can isolate mid-turn streams after navigation.
        ...(subscribedSessionId ? { sessionId: subscribedSessionId } : {}),
      },
    });

    // Accumulate thinking deltas
    // Use the session ID captured at subscription time — NOT getActiveSession().
    // This prevents persistence to the wrong session after navigation.
    const currentSessionId = subscribedSessionId;

    if (event.type === 'thinking_delta' || event.type === 'reasoning_delta') {
      if (thinkingStartedAt == null) thinkingStartedAt = Date.now();
      const delta = event.content ?? (event.type === 'thinking_delta' ? event.text : undefined) ?? '';
      // Metadata accumulator only — parts are already persisted via Agent.onPart.
      // Re-persisting here doubled every reasoning token (HTTPHTTP / word word).
      if (delta) accumulatedThinking = appendStreamText(accumulatedThinking, delta);
    }

    // Track plan steps
    if (event.type === 'plan_generated') {
      if (event.plan?.steps) {
        currentPlan = event.plan.steps.map((s) => s.description);
      }
    }

    // Track per-turn token data
    if (event.type === 'token_usage') {
      if (event.turnTokens != null) perTurnTokens = event.turnTokens;
      if (event.costUsd != null) perTurnCostUsd = event.costUsd;
    }

    if (event.type === 'stream_chunk') {
      const delta = event.content ?? '';
      if (delta && !/Calling:|✅ Result:|\[STEP \d+\]/.test(delta)) {
        // Buffer for message_received parts JSON only — text-delta rows come from onPart.
        textBuffer = appendStreamText(textBuffer, delta);
      }
    }

    // Accumulate tool calls and sub-agents
    if (event.type === 'tool_executing') {
      flushTextBuffer();
      const toolName = event.tool ?? 'unknown';
      const description = event.description ?? '';
      const eventArgs = event.args ?? description;
      if (toolName === 'delegate_to_subagent') {
        const id = event.callId ?? `sub-${Date.now()}-${subAgentMap.size}`;
        const sa: SubAgentRecord = { id, name: 'Sub-Agent', task: description, status: 'running' };
        subAgentMap.set(id, sa);
        accumulatedParts.push({
          type: 'subagent',
          id,
          agent: { id, name: sa.name, task: sa.task, status: 'running', kind: 'sub_agent' },
        });
        persistPart(currentSessionId, {
          type: 'subagent',
          toolName: 'delegate_to_subagent',
          toolCallId: id,
          content: description,
          toolArgs: { name: sa.name, task: sa.task, status: 'running', kind: 'sub_agent' },
          timestamp: Date.now(),
        });
      } else {
        const id = event.callId ?? `tool-${Date.now()}-${toolCallMap.size}`;
        toolCallMap.set(id, { id, name: toolName, args: eventArgs, status: 'running' });
        accumulatedParts.push({
          type: 'tool',
          id,
          tool: { id, name: toolName, args: eventArgs, status: 'running' },
        });
        // Persist part to PostgreSQL immediately
        persistPart(currentSessionId, { type: 'tool-call', toolName, toolCallId: id, toolArgs: typeof eventArgs === 'object' ? eventArgs : undefined, timestamp: Date.now() });
      }
    }
    if (event.type === 'tool_complete') {
      const toolName = event.tool ?? '';
      const elapsed = event.elapsed ?? 0;
      const result = event.result;
      const resultStr = typeof result === 'string'
        ? result
        : typeof result?.output === 'string'
          ? result.output
          : JSON.stringify(result ?? '');
      const metadata = event.result?.metadata;
      if (toolName === 'save_to_markdown' && metadata?.['markdownId']) {
        broadcast({ type: 'markdown_created', markdownId: metadata['markdownId'], contentFormat: metadata['contentFormat'] });
      }
      if (toolName === 'delegate_to_subagent') {
        const id = event.callId;
        if (id && subAgentMap.has(id)) {
          const sa = subAgentMap.get(id)!;
          // Background delegates stay running until background_task_complete.
          const looksBackground = /background|running|spawned|child session/i.test(resultStr)
            && !/failed|error/i.test(resultStr.slice(0, 80));
          const successFlag = metadata?.['success'];
          const failed = successFlag === false || /^error\b/i.test(resultStr.trim());
          sa.status = failed ? 'error' : looksBackground ? 'running' : 'done';
          sa.result = resultStr;
          const partIdx = accumulatedParts.findIndex((p) => p.type === 'subagent' && p.agent?.id === id);
          if (partIdx >= 0 && accumulatedParts[partIdx]?.agent) {
            accumulatedParts[partIdx] = {
              ...accumulatedParts[partIdx]!,
              agent: { ...accumulatedParts[partIdx]!.agent!, status: sa.status, result: sa.result },
            };
          }
          persistPart(currentSessionId, {
            type: 'subagent',
            toolName: 'delegate_to_subagent',
            toolCallId: id,
            content: sa.task,
            toolArgs: { name: sa.name, task: sa.task, status: sa.status, kind: 'sub_agent' },
            toolResult: resultStr,
            toolSuccess: sa.status !== 'error',
            timestamp: Date.now(),
          });
        }
      } else {
        const id = event.callId;
        if (id && toolCallMap.has(id)) {
          const tc = toolCallMap.get(id)!;
          tc.status = 'done';
          tc.result = resultStr;
          tc.elapsed = elapsed;
          if (metadata) tc.metadata = metadata;
          const partIdx = accumulatedParts.findIndex((p) => p.type === 'tool' && p.tool?.id === id);
          if (partIdx >= 0 && accumulatedParts[partIdx]?.tool) {
            accumulatedParts[partIdx] = {
              ...accumulatedParts[partIdx]!,
              tool: {
                ...accumulatedParts[partIdx]!.tool!,
                status: 'done',
                result: resultStr,
                elapsed,
                metadata,
              },
            };
          }
          if (toolName === 'deep_web_search' && id) {
            const bundle = deepSearchBundleFromMetadata(metadata);
            const progress = metadata?.deepSearchProgress as DeepSearchProgress | undefined;
            const next = upsertDeepSearchPart([...accumulatedParts], {
              toolCallId: id,
              bundle,
              progress,
              running: !bundle,
            });
            accumulatedParts.length = 0;
            next.forEach((p) => accumulatedParts.push(p));
          }
          if (toolName === 'render_chart' && id && metadata?.chartSpec && typeof metadata.chartSpec === 'object') {
            if (!accumulatedParts.some((p) => p.type === 'chart' && p.id === id)) {
              accumulatedParts.push({
                type: 'chart',
                id,
                chartJson: JSON.stringify(metadata.chartSpec),
              });
            }
          }
        }
      }

      // Persist tool result to PostgreSQL parts table immediately
      if (toolName !== 'delegate_to_subagent') {
        const id = event.callId;
        persistPart(currentSessionId, {
          type: 'tool-result',
          toolName,
          toolCallId: id,
          toolResult: resultStr,
          toolSuccess: true,
          timestamp: Date.now(),
        });
      }
    }

    // Track crew activity for real-time UI updates
    if (event.type === 'crew_activity') {
      const { crewId, crewName, activity, content } = event;
      if (crewId && activity) {
        broadcast({ type: 'crew_activity', crewId, crewName, activity, content });
      }
    }

    // Bind callId → childSessionId so restore opens the right transcript.
    if (event.type === 'child_session_started' && event.kind !== 'crew_worker') {
      const childId = event.childSessionId;
      const label = event.label || 'Sub-Agent';
      let matched: SubAgentRecord | undefined;
      for (const sa of subAgentMap.values()) {
        if (sa.status === 'running' && (!matched || sa.task.includes(label) || label.includes(sa.task.slice(0, 40)))) {
          matched = sa;
        }
      }
      if (!matched) {
        for (const sa of subAgentMap.values()) {
          if (sa.status === 'running') { matched = sa; break; }
        }
      }
      if (matched && childId) {
        const oldId = matched.id;
        subAgentMap.delete(oldId);
        matched.id = childId;
        matched.name = label || matched.name;
        subAgentMap.set(childId, matched);
        const partIdx = accumulatedParts.findIndex((p) => p.type === 'subagent' && p.agent?.id === oldId);
        if (partIdx >= 0 && accumulatedParts[partIdx]?.agent) {
          accumulatedParts[partIdx] = {
            ...accumulatedParts[partIdx]!,
            id: childId,
            agent: { ...accumulatedParts[partIdx]!.agent!, id: childId, name: matched.name },
          };
        }
        if (currentSessionId) {
          persistPart(currentSessionId, {
            type: 'subagent',
            toolName: 'delegate_to_subagent',
            toolCallId: childId,
            content: matched.task,
            toolArgs: { name: matched.name, task: matched.task, status: matched.status, kind: 'sub_agent' },
            timestamp: Date.now(),
          });
        }
      }
    }

    if (event.type === 'child_session_complete' || event.type === 'background_task_complete') {
      const childId = event.type === 'background_task_complete'
        ? (event.childSessionId || event.taskId)
        : event.childSessionId;
      const success = event.type === 'background_task_complete'
        ? event.success !== false
        : event.success;
      const summary = event.type === 'background_task_complete' ? event.summary : undefined;
      const instruction = event.type === 'background_task_complete' ? event.instruction : undefined;
      const taskId = event.type === 'background_task_complete' ? event.taskId : undefined;
      const ids = [childId, taskId].filter(Boolean) as string[];
      let sa: SubAgentRecord | undefined;
      for (const id of ids) {
        if (subAgentMap.has(id)) { sa = subAgentMap.get(id); break; }
      }
      if (!sa) {
        for (const candidate of subAgentMap.values()) {
          if (candidate.status === 'running') { sa = candidate; break; }
        }
      }
      const nextStatus: SubAgentRecord['status'] = success ? 'done' : 'error';
      if (sa) {
        sa.status = nextStatus;
        if (summary) sa.result = summary;
        const partIdx = accumulatedParts.findIndex((p) => p.type === 'subagent' && p.agent?.id === sa!.id);
        if (partIdx >= 0 && accumulatedParts[partIdx]?.agent) {
          accumulatedParts[partIdx] = {
            ...accumulatedParts[partIdx]!,
            agent: { ...accumulatedParts[partIdx]!.agent!, status: sa.status, result: sa.result },
          };
        }
      }
      // Always patch the persisted assistant row (including late completions after resetAccumulators).
      if (currentSessionId && ids.length > 0) {
        try {
          const eng = getEngine();
          const store = eng.sessionManager.getStorageAdapter();
          const allMsgs = store.getMessages?.(currentSessionId) ?? [];
          const targetId = lastPersistedAssistantId
            || [...allMsgs].reverse().find((m) => m.role === 'assistant')?.id;
          const existing = targetId ? allMsgs.find((m) => m.id === targetId) : undefined;
          if (targetId) lastPersistedAssistantId = targetId;
          if (existing) {
            const prevMeta = typeof existing.metadata === 'string'
              ? (() => { try { return JSON.parse(existing.metadata) as Record<string, unknown>; } catch { return {}; } })()
              : { ...(existing.metadata as Record<string, unknown> | undefined) };
            const prevSubs = Array.isArray(prevMeta['subAgents'])
              ? [...(prevMeta['subAgents'] as SubAgentRecord[])]
              : [];
            const subIdx = prevSubs.findIndex((s) => ids.includes(s.id));
            const patched: SubAgentRecord = subIdx >= 0
              ? {
                ...prevSubs[subIdx]!,
                id: childId || prevSubs[subIdx]!.id,
                status: nextStatus,
                ...(summary ? { result: summary } : {}),
              }
              : {
                id: childId || ids[0]!,
                name: 'Sub-Agent',
                task: String(instruction || sa?.task || ''),
                status: nextStatus,
                ...(summary ? { result: summary } : {}),
              };
            if (subIdx >= 0) prevSubs[subIdx] = patched;
            else prevSubs.push(patched);
            const prevParts = Array.isArray(existing.parts) ? [...existing.parts] as MessagePart[] : [];
            const pIdx = prevParts.findIndex((p) => p.type === 'subagent' && p.agent && ids.includes(p.agent.id));
            if (pIdx >= 0 && prevParts[pIdx]?.agent) {
              prevParts[pIdx] = {
                ...prevParts[pIdx]!,
                id: patched.id,
                agent: {
                  ...prevParts[pIdx]!.agent!,
                  id: patched.id,
                  status: patched.status,
                  result: patched.result,
                  task: patched.task || prevParts[pIdx]!.agent!.task,
                },
              };
            }
            persistAssistantTurnPatch(currentSessionId, targetId, {
              subAgents: prevSubs,
              parts: prevParts.length > 0 ? prevParts : undefined,
            });
            persistPart(currentSessionId, {
              type: 'subagent',
              toolName: 'delegate_to_subagent',
              toolCallId: patched.id,
              content: patched.task,
              toolArgs: { name: patched.name, task: patched.task, status: patched.status, kind: 'sub_agent' },
              toolResult: patched.result,
              toolSuccess: patched.status !== 'error',
              timestamp: Date.now(),
            });
          }
        } catch { /* best-effort */ }
      } else if (sa && currentSessionId) {
        persistPart(currentSessionId, {
          type: 'subagent',
          toolName: 'delegate_to_subagent',
          toolCallId: sa.id,
          content: sa.task,
          toolArgs: { name: sa.name, task: sa.task, status: sa.status, kind: 'sub_agent' },
          toolResult: sa.result,
          toolSuccess: sa.status !== 'error',
          timestamp: Date.now(),
        });
      }
    }

    // Persist conversation to session context files
    try {
      const eng = getEngine();
      // Use the subscribed session ID (captured at subscription time) instead of
      // getActiveSession() — the active session may have changed if the user
      // navigated to a different session while this agent's turn was still running.
      const msgObj = event.type === 'message_sent' || event.type === 'message_received' ? event.message : undefined;
      const sessionId = subscribedSessionId || msgObj?.sessionId || '';
      const sess = eng.sessionManager.getActiveSession();
      const isActiveSession = sess?.id === sessionId;

      if (event.type === 'message_sent') {
        // Reset first — new user turn must not inherit prior turn parts
        resetAccumulators();
        const rawMsg = event.message?.content;
        if (isActiveSession && sess && typeof rawMsg === 'string' && sess.title === 'New Session') {
          const firstLine = String(rawMsg).split('\n')[0] || '';
          const title = firstLine.slice(0, 80).trim();
          if (title.length > 0) eng.sessionManager.updateSession({ title });
        }
        const msg: Message | undefined = event.message;
        const text = msg?.content ?? '';
        // User rows are persisted by Agent.persistUserMessage — only ingest memory here.
        if (sessionId && text) {
          ingestConversationMemory(sessionId, 'user', text).catch((e) => getLogger().warn('MEMORY_INGEST', `user message ingest failed: ${e instanceof Error ? e.message : String(e)}`));
        }
      }

      // Persist assistant messages with ALL accumulated rich metadata
      if (event.type === 'message_received') {
        try {
          flushTextBuffer();
          const msg: Message | undefined = event.message;
          const isUpdate = event.isUpdate === true;
          const text = repairStreamTextGlitches(stripToolNoise(msg?.content ?? ''));
          const crew = msg?.crew;
          if (sessionId && text) {
            const thinkingText = accumulatedThinking
              ? repairStreamTextGlitches(accumulatedThinking)
              : undefined;
            const extra = buildExtra(thinkingText);
            extra.attachments = msg?.attachments;
            if (typeof msg?.id === 'string') lastPersistedAssistantId = msg.id;
            if (isUpdate && msg?.id) {
              const store = eng.sessionManager.getStorageAdapter();
              const existing = store.getMessages?.(sessionId)?.find((m) => m.id === msg.id);
              const existingParts = Array.isArray(existing?.parts) ? existing.parts : [];
              const newParts = Array.isArray(extra.parts) ? extra.parts : [];
              // Prefer the richer turn snapshot over naive concat (avoids duplicate tools/subagents).
              const mergedParts = newParts.length > 0 ? newParts : existingParts;
              const prevMeta = typeof existing?.metadata === 'string'
                ? (() => { try { return JSON.parse(existing.metadata as string) as Record<string, unknown>; } catch { return {}; } })()
                : { ...(existing?.metadata as Record<string, unknown> | undefined) };
              const metadata = {
                ...prevMeta,
                ...buildPersistMetadata(extra),
              };
              store.updateMessage?.(sessionId, msg.id, {
                content: text,
                ...(mergedParts.length > 0 ? { parts: mergedParts } : {}),
                metadata,
                ...(msg?.attachments ? { attachments: msg.attachments } : {}),
              });
            } else {
              appendContextFile(sessionId, 'assistant', text, crew, extra, typeof msg?.id === 'string' ? msg.id : undefined);
            }
            ingestConversationMemory(sessionId, 'assistant', text).catch((e) => getLogger().warn('MEMORY_INGEST', `assistant message ingest failed: ${e instanceof Error ? e.message : String(e)}`));
          }
        } finally {
          resetAccumulators();
        }
      }

      // Also write tool execution system messages for context.txt readability
      // (conversation.json already has structured data in the message_received record)
      if (event.type === 'tool_executing') {
        const tool = event.tool;
        if (sessionId && tool) {
          appendContextFile(sessionId, 'system', `[tool] executing: ${tool}`);
        }
      }
      if (event.type === 'tool_complete') {
        const tool = event.tool;
        const elapsed = event.elapsed ?? 0;
        const resultObj = event.result;
        const result = typeof resultObj === 'string' ? resultObj : (resultObj?.output ?? '');
        if (sessionId && tool) {
          const snippet = result.length > 500 ? result.slice(0, 500) + '...' : result;
          appendContextFile(sessionId, 'system', `[tool] ${tool} completed (${elapsed}ms)\n${snippet}`);
        }
      }

      if (event.type === 'compaction_complete') {
        const summary = event.summary;
        if (sessionId && summary?.trim()) {
          appendContextFile(sessionId, 'system', `[COMPACTION SUMMARY — ${new Date().toISOString()}]\n${summary.trim()}`);
        }
      }
    } catch {
      // ignore failures — context file persistence is best-effort
    }
  });
}

export function shutdownWebSocket(): void {
  if (wss) {
    for (const client of wss.clients) {
      client.terminate();
    }
    wss.close();
    wss = null;
  }
  unsubscribeAgent();
}

export function ensureSubscribed(): void {
  const eng = getEngine();
  const agent = eng.agent;
  if (!agent) return;
  if (subscribedAgent === agent) return;
  subscribeToAgent(agent);
}

export function broadcastKnowledgeBaseSourceStatus(payload: {
  sourceId: string;
  status: string;
  progress: number;
  detail?: string;
  error?: string;
}): void {
  broadcast({
    type: 'knowledge_base_source_status',
    ...payload,
    timestamp: new Date().toISOString(),
  });
}

export function broadcastKnowledgeBaseSourceReady(payload: { sourceId: string }): void {
  broadcast({
    type: 'knowledge_base_source_ready',
    ...payload,
    timestamp: new Date().toISOString(),
  });
}

export function broadcastKnowledgeBaseSourceFailed(payload: { sourceId: string; error: string }): void {
  broadcast({
    type: 'knowledge_base_source_failed',
    ...payload,
    timestamp: new Date().toISOString(),
  });
}

/** @deprecated Use broadcastKnowledgeBaseSourceStatus */
export function broadcastKnowledgeSourceStatus(payload: {
  sourceId: string;
  status: string;
  progress: number;
  detail?: string;
  error?: string;
}): void {
  broadcastKnowledgeBaseSourceStatus(payload);
}

/** @deprecated Use broadcastKnowledgeBaseSourceReady */
export function broadcastKnowledgeSourceReady(payload: { sourceId: string }): void {
  broadcastKnowledgeBaseSourceReady(payload);
}

/** @deprecated Use broadcastKnowledgeBaseSourceFailed */
export function broadcastKnowledgeSourceFailed(payload: { sourceId: string; error: string }): void {
  broadcastKnowledgeBaseSourceFailed(payload);
}
