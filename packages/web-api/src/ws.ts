import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { getEngine } from './engine.js';
import { getLogger, stripToolNoise, appendStreamText, repairStreamTextGlitches, type MessagePart } from '@agentx/shared';

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
 * Incrementally persist each AI SDK part event to SQLite.
 */
export function persistPart(sessionId: string, part: PartRecord): void {
  if (!sessionId) return;
  try {
    const eng = getEngine();
    const store = (eng.sessionManager as any).store;
    if (store?.insertPart) { store.insertPart(sessionId, part); }
  } catch { /* best-effort */ }
}
interface SubAgentRecord { id: string; name: string; task: string; status: 'running' | 'done' | 'error'; result?: string }
interface CrewInfo { crewId: string; name: string; callsign: string; color?: string; icon?: string; confidence?: string; reasons?: string[] }
interface ToolCallRecord { id: string; name: string; args: unknown; status: string; result?: string; elapsed?: number; metadata?: Record<string, unknown> }

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
  }
): void {
  if (!sessionId || !content) return;

  // Skip DB insert for crew messages — already persisted by CrewOrchestrator
  if (crew) return;

  // Primary: messages table
  try {
    const eng = getEngine();
    const store = (eng.sessionManager as any).store;
    if (store?.insertMessage) {
      store.insertMessage({
        sessionId,
        role,
        content,
        toolCalls: extra?.toolCalls,
        tokenCount: extra?.tokenCount,
        thinking: extra?.thinking,
        plan: extra?.plan ? JSON.stringify(extra.plan) : undefined,
        parts: extra?.parts,
      });
    }
  } catch { /* best-effort */ }
}

/**
 * Directly persist a message to SQLite — independent of WebSocket subscription.
 */
export function persistMessageDirect(sessionId: string, role: string, content: string, extra?: { thinking?: string; toolCalls?: ToolCallRecord[] }): void {
  appendContextFile(sessionId, role, content, undefined, extra);
  try {
    const eng = getEngine();
    const store = (eng.sessionManager as any).store;
    if (store?.insertMessage && content) {
      store.insertMessage({ sessionId, role, content, toolCalls: extra?.toolCalls });
    }
  } catch { /* best-effort */ }
}

let wss: WebSocketServer | null = null;
let subscribedAgent: unknown | null = null;
let unsubscribeFromAgent: (() => void) | null = null;
const sessionEventSubscribers = new Map<WebSocket, () => void>();

export function setupWebSocket(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws' });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') return;
    console.error('WebSocket server error:', err.message);
  });

  wss.on('error', (err) => {
    if ((err as any).code === 'EADDRINUSE') return;
    console.error('WebSocket error:', (err as Error).message);
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
        if (agent && typeof (agent as any).lifecycle?.isProcessing === 'function' && (agent as any).lifecycle.isProcessing()) {
          getLogger().info('WS', `Client disconnected while agent was ${(agent as any).lifecycle.getState()}. Events will be persisted for replay.`);
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
      const text = msg.text as string;
      if (!text || typeof text !== 'string') {
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
      const requestId = msg.requestId as string;
      const choice = msg.choice as 'allow_once' | 'allow_always' | 'deny';
      if (agent && requestId) agent.respondToPermission(requestId, choice);
      break;
    }
    case 'permission_respond_batch': {
      const eng = getEngine();
      const agent = eng.agent;
      const choice = msg.choice as 'allow_once' | 'allow_always' | 'deny';
      if (agent) agent.respondToPermissionBatch(choice);
      break;
    }
    case 'clarification_response': {
      const eng = getEngine();
      const agent = eng.agent;
      const response = msg.response as string;
      if (agent && response) agent.respondToClarification(response);
      break;
    }
    case 'checkpoint_response': {
      const eng = getEngine();
      const agent = eng.agent;
      const checkpointId = msg.checkpointId as string;
      const action = msg.action as string;
      if (agent && checkpointId && action) {
        const resolved = agent.resolveCheckpoint(checkpointId, action);
        if (!resolved) {
          getLogger().warn('WS', `Checkpoint ${checkpointId.slice(0, 12)} not found on agent`);
        }
      }
      break;
    }
    case 'subscribe': {
      const sessionId = msg.sessionId as string;
      if (!sessionId) break;
      try {
        const eng = getEngine();
        const store = (eng.sessionManager as any).store;
        if (store?.getSessionEvents) {
          const sinceSeq = typeof msg.sinceSequence === 'number' ? msg.sinceSequence : undefined;
          const events = store.getSessionEvents(sessionId, sinceSeq) as Array<Record<string, unknown>>;
          ws.send(JSON.stringify({ type: 'session_events', data: events, sessionId }));
        }
        const agent = eng.agent;
        if (agent && agent.events && typeof (agent.events as any).onSessionEvent === 'function') {
          const unsubOld = sessionEventSubscribers.get(ws);
          if (unsubOld) unsubOld();
          const unsub = (agent.events as any).onSessionEvent((event: Record<string, unknown>) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'session_event', data: event }));
            }
          });
          sessionEventSubscribers.set(ws, unsub);
        }
        // Send current session state (agent processing status) so client knows if tasks are running
        if (agent && typeof (agent as any).lifecycle?.isProcessing === 'function') {
          ws.send(JSON.stringify({
            type: 'session_state',
            sessionId,
            processing: (agent as any).lifecycle.isProcessing(),
            state: (agent as any).lifecycle.getState(),
          }));
        }
      } catch {
        // best-effort
      }
      break;
    }
    default:
      break;
  }
}

function broadcast(data: Record<string, unknown>): void {
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

export function subscribeToAgent(agent: { events: { on: (handler: (event: Record<string, unknown>) => void) => () => void } }): void {
  // Unsubscribe from previous agent to prevent memory leak
  unsubscribeAgent();
  if (subscribedAgent === agent) return;
  subscribedAgent = agent;

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
  } {
    const toolCalls = Array.from(toolCallMap.values());
    const subAgents = Array.from(subAgentMap.values());
    const parts = accumulatedParts.length > 0 ? [...accumulatedParts] : undefined;
    const extra: ReturnType<typeof buildExtra> = {};
    if (thinkingText) extra.thinking = thinkingText;
    if (thinkingStartedAt != null) extra.thinkingStartedAt = thinkingStartedAt;
    if (thinkingText) extra.thinkingDoneAt = Date.now();
    if (toolCalls.length > 0) extra.toolCalls = toolCalls;
    if (subAgents.length > 0) extra.subAgents = subAgents;
    if (parts) extra.parts = parts as Array<Record<string, unknown>>;
    if (currentPlan && currentPlan.length > 0) extra.plan = currentPlan;
    if (perTurnTokens != null) { extra.turnTokens = perTurnTokens; extra.tokenCount = perTurnTokens; }
    if (perTurnCostUsd != null) extra.turnCostUsd = perTurnCostUsd;
    return extra;
  }

  unsubscribeFromAgent = agent.events.on((event: Record<string, unknown>) => {
    const evType = (event as { type?: string }).type ?? 'unknown';
    broadcast({
      type: 'engine_event',
      event: evType,
      data: event,
    });

    // Accumulate thinking deltas
    // Fetch session ID early for part-level persistence
    let currentSessionId = '';
    try {
      const eng0 = getEngine();
      const sess0 = eng0.sessionManager.getActiveSession();
      currentSessionId = sess0?.id || '';
    } catch { /* ignore */ }

    if (evType === 'thinking_delta' || evType === 'reasoning_delta') {
      if (thinkingStartedAt == null) thinkingStartedAt = Date.now();
      const delta = ((event as any).content as string) ?? ((event as any).text as string) ?? '';
      accumulatedThinking += delta;
    }

    // Track plan steps
    if (evType === 'plan_generated') {
      const plan = (event as any).plan as { steps?: { description: string }[] } | undefined;
      if (plan?.steps) {
        currentPlan = plan.steps.map((s: { description: string }) => s.description);
      }
    }

    // Track per-turn token data
    if (evType === 'token_usage') {
      const t = (event as any).turnTokens as number | undefined;
      const c = (event as any).costUsd as number | undefined;
      if (t != null) perTurnTokens = t;
      if (c != null) perTurnCostUsd = c;
    }

    if (evType === 'stream_chunk') {
      const delta = ((event as any).content as string) ?? '';
      if (delta && !/Calling:|✅ Result:|\[STEP \d+\]/.test(delta)) {
        textBuffer = appendStreamText(textBuffer, delta);
        if (currentSessionId) {
          persistPart(currentSessionId, { type: 'text-delta', content: delta, timestamp: Date.now() });
        }
      }
    }

    // Accumulate tool calls and sub-agents
    if (evType === 'tool_executing') {
      flushTextBuffer();
      const toolName = ((event as any).tool as string) ?? 'unknown';
      const description = ((event as any).description as string) ?? '';
      const eventArgs = ((event as any).args as Record<string, unknown> | undefined) ?? description;
      if (toolName === 'delegate_to_subagent') {
        const id = (event as any).callId as string || (event as any).id as string || `sub-${Date.now()}-${subAgentMap.size}`;
        subAgentMap.set(id, { id, name: 'Sub-Agent', task: description, status: 'running' });
      } else {
        const id = (event as any).callId as string || (event as any).toolCallId as string || (event as any).id as string || `tool-${Date.now()}-${toolCallMap.size}`;
        toolCallMap.set(id, { id, name: toolName, args: eventArgs, status: 'running' });
        accumulatedParts.push({
          type: 'tool',
          id,
          tool: { id, name: toolName, args: eventArgs, status: 'running' },
        });
        // Persist part to SQLite immediately
        persistPart(currentSessionId, { type: 'tool-call', toolName, toolCallId: id, toolArgs: typeof eventArgs === 'object' ? eventArgs as Record<string, unknown> : undefined, timestamp: Date.now() });
      }
    }
    if (evType === 'tool_complete') {
      const toolName = ((event as any).tool as string) ?? '';
      const elapsed = ((event as any).elapsed as number) ?? 0;
      const result = (event as any).result ?? (event as any).output as string ?? '';
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result ?? '');
      const metadata = (event as any).metadata as Record<string, unknown> | undefined;
      if (toolName === 'delegate_to_subagent') {
        const id = (event as any).callId as string || (event as any).id as string;
        if (id && subAgentMap.has(id)) {
          const sa = subAgentMap.get(id)!;
          sa.status = 'done';
          sa.result = resultStr;
        }
      } else {
        const id = (event as any).callId as string || (event as any).toolCallId as string || (event as any).id as string;
        if (id && toolCallMap.has(id)) {
          const tc = toolCallMap.get(id)!;
          tc.status = 'done';
          tc.result = resultStr;
          tc.elapsed = elapsed;
          if (metadata) tc.metadata = metadata as ToolCallRecord['metadata'];
          const partIdx = accumulatedParts.findIndex((p) => p.type === 'tool' && p.tool?.id === id);
          if (partIdx >= 0 && accumulatedParts[partIdx]?.tool) {
            accumulatedParts[partIdx] = {
              ...accumulatedParts[partIdx]!,
              tool: {
                ...accumulatedParts[partIdx]!.tool!,
                status: 'done',
                result: resultStr,
                elapsed,
                metadata: metadata as ToolCallRecord['metadata'],
              },
            };
          }
        }
      }

      // Persist tool result to SQLite parts table immediately
      if (toolName !== 'delegate_to_subagent') {
        const id = (event as any).callId as string || (event as any).toolCallId as string || (event as any).id as string;
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
    if (evType === 'crew_activity') {
      const crewId = (event as any).crewId as string;
      const crewName = (event as any).crewName as string;
      const activity = (event as any).activity as string;
      if (crewId && activity) {
        broadcast({ type: 'crew_activity', crewId, crewName, activity, content: (event as any).content });
      }
    }

    // Persist conversation to session context files
    try {
      const eng = getEngine();
      const sess = eng.sessionManager.getActiveSession();
      const msgObj = (event as any).message as Record<string, unknown> | undefined;
      const sessionId = sess?.id || (msgObj?.sessionId as string) || (event as any).sessionId || '';

      // Auto-fill session title from the first user message
      if (evType === 'message_sent') {
        const rawMsg: any = (event as any).message?.content;
        if (sess && typeof rawMsg === 'string' && sess.title === 'New Session') {
          const firstLine = String(rawMsg).split('\n')[0] || '';
          const title = firstLine.slice(0, 80).trim();
          if (title.length > 0) eng.sessionManager.updateSession({ title });
        }
        // Reset accumulators for the new turn
        resetAccumulators();
      }

      // Persist user messages
      if (evType === 'message_sent') {
        const msg: any = (event as any).message;
        const text = (msg?.content as string) || (event as any).content as string || '';
        const crew = msg?.crew as CrewInfo | undefined;
        if (sessionId && text) {
          appendContextFile(sessionId, 'user', text, crew);
        }
      }

      // Persist assistant messages with ALL accumulated rich metadata
      if (evType === 'message_received') {
        flushTextBuffer();
        const msg: any = (event as any).message;
        const text = repairStreamTextGlitches(stripToolNoise((msg?.content as string) || (event as any).content as string || ''));
        const crew = msg?.crew as CrewInfo | undefined;
        if (sessionId && text) {
          const thinkingText = accumulatedThinking || undefined;
          appendContextFile(sessionId, 'assistant', text, crew, buildExtra(thinkingText));
        }
        resetAccumulators();
      }

      // Also write tool execution system messages for context.txt readability
      // (conversation.json already has structured data in the message_received record)
      if (evType === 'tool_executing') {
        const tool = (event as any).tool as string || '';
        if (sessionId && tool) {
          appendContextFile(sessionId, 'system', `[tool] executing: ${tool}`);
        }
      }
      if (evType === 'tool_complete') {
        const tool = (event as any).tool as string || '';
        const elapsed = (event as any).elapsed as number || 0;
        const resultObj = (event as any).result;
        const result = typeof resultObj === 'string' ? resultObj : (resultObj?.output as string || '');
        if (sessionId && tool) {
          const snippet = result.length > 500 ? result.slice(0, 500) + '...' : result;
          appendContextFile(sessionId, 'system', `[tool] ${tool} completed (${elapsed}ms)\n${snippet}`);
        }
      }

      if (evType === 'compaction_complete') {
        const summary = (event as any).summary as string | undefined;
        if (sessionId && summary?.trim()) {
          appendContextFile(sessionId, 'system', `[COMPACTION SUMMARY — ${new Date().toISOString()}]\n${summary.trim()}`);
        }
      }
    } catch {
      // ignore failures — context file persistence is best-effort
    }
  });
}

export function ensureSubscribed(): void {
  const eng = getEngine();
  const agent = eng.agent;
  if (!agent) return;
  if (subscribedAgent === agent) return;
  subscribeToAgent(agent as unknown as { events: { on: (handler: (event: Record<string, unknown>) => void) => () => void } });
}
