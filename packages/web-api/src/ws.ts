import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { getEngine } from './engine.js';

const DATA_DIR = process.env['XDG_DATA_HOME']
  ? join(process.env['XDG_DATA_HOME'], 'agentx')
  : join(homedir(), '.local', 'share', 'agentx');
const SESSIONS_DIR = join(DATA_DIR, 'sessions');

function atomicWriteFileSync(filePath: string, content: string): void {
  const tmpPath = filePath + '.tmp.' + Date.now();
  writeFileSync(tmpPath, content, 'utf-8');
  renameSync(tmpPath, filePath);
}

interface ToolCallRecord { id: string; name: string; args?: string; result?: string; status: 'running' | 'done' | 'error'; elapsed?: number }
interface SubAgentRecord { id: string; name: string; task: string; status: 'running' | 'done' | 'error'; result?: string }
interface CrewInfo { crewId: string; name: string; callsign: string }

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
    plan?: string[];
    turnTokens?: number;
    turnCostUsd?: number;
    tokenCount?: number;
  }
): void {
  if (!sessionId || !content) return;
  const dir = join(SESSIONS_DIR, sessionId);
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }); } catch { return; }
  }
  const contextPath = join(dir, 'context.txt');
  const convPath = join(dir, 'conversation.json');
  try {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${role}:\n${content}\n\n`;
    const existing = existsSync(contextPath) ? readFileSync(contextPath, 'utf-8') : '';
    atomicWriteFileSync(contextPath, existing + entry);

    let conv: unknown[] = [];
    if (existsSync(convPath)) {
      try { conv = JSON.parse(readFileSync(convPath, 'utf-8')) as unknown[]; } catch { conv = []; }
    }

    const record: Record<string, unknown> = { timestamp, role, content };
    if (crew) record['crew'] = crew;
    if (extra?.thinking) record['thinking'] = extra.thinking;
    if (extra?.thinkingStartedAt != null) record['thinkingStartedAt'] = extra.thinkingStartedAt;
    if (extra?.thinkingDoneAt != null) record['thinkingDoneAt'] = extra.thinkingDoneAt;
    if (extra?.toolCalls && extra.toolCalls.length > 0) record['toolCalls'] = extra.toolCalls;
    if (extra?.subAgents && extra.subAgents.length > 0) record['subAgents'] = extra.subAgents;
    if (extra?.plan && extra.plan.length > 0) record['plan'] = extra.plan;
    if (extra?.turnTokens != null) record['turnTokens'] = extra.turnTokens;
    if (extra?.turnCostUsd != null) record['turnCostUsd'] = extra.turnCostUsd;
    if (extra?.tokenCount != null) record['tokenCount'] = extra.tokenCount;
    conv.push(record);
    atomicWriteFileSync(convPath, JSON.stringify(conv, null, 2));
  } catch { /* best-effort */ }
}

let wss: WebSocketServer | null = null;
let subscribedAgent: unknown | null = null;
let unsubscribeFromAgent: (() => void) | null = null;

export function setupWebSocket(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    ws.send(JSON.stringify({ type: 'connected' }));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleWsMessage(msg);
      } catch {
        // ignore malformed
      }
    });
  });
}

async function handleWsMessage(msg: { type: string; [key: string]: unknown }): Promise<void> {
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
      const choice = msg.choice as 'allow_once' | 'allow_always' | 'deny';
      if (agent) agent.respondToPermission(choice);
      break;
    }
    case 'clarification_response': {
      const eng = getEngine();
      const agent = eng.agent;
      const response = msg.response as string;
      if (agent && response) agent.respondToClarification(response);
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

  function resetAccumulators(): void {
    accumulatedThinking = '';
    thinkingStartedAt = null;
    toolCallMap.clear();
    subAgentMap.clear();
    currentPlan = null;
    perTurnTokens = undefined;
    perTurnCostUsd = undefined;
  }

  function buildExtra(thinkingText?: string): {
    thinking?: string;
    thinkingStartedAt?: number;
    thinkingDoneAt?: number;
    toolCalls?: ToolCallRecord[];
    subAgents?: SubAgentRecord[];
    plan?: string[];
    turnTokens?: number;
    turnCostUsd?: number;
    tokenCount?: number;
  } {
    const toolCalls = Array.from(toolCallMap.values());
    const subAgents = Array.from(subAgentMap.values());
    const extra: ReturnType<typeof buildExtra> = {};
    if (thinkingText) extra.thinking = thinkingText;
    if (thinkingStartedAt != null) extra.thinkingStartedAt = thinkingStartedAt;
    if (thinkingText) extra.thinkingDoneAt = Date.now();
    if (toolCalls.length > 0) extra.toolCalls = toolCalls;
    if (subAgents.length > 0) extra.subAgents = subAgents;
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

    // Accumulate tool calls and sub-agents
    if (evType === 'tool_executing') {
      const toolName = ((event as any).tool as string) ?? 'unknown';
      const description = ((event as any).description as string) ?? '';
      if (toolName === 'delegate_to_subagent') {
        const id = (event as any).id as string || `sub-${Date.now()}-${subAgentMap.size}`;
        subAgentMap.set(id, { id, name: 'Sub-Agent', task: description, status: 'running' });
      } else {
        const id = (event as any).toolCallId as string || (event as any).id as string || `tool-${Date.now()}-${toolCallMap.size}`;
        toolCallMap.set(id, { id, name: toolName, args: description, status: 'running' });
      }
    }
    if (evType === 'tool_complete') {
      const toolName = ((event as any).tool as string) ?? '';
      const elapsed = ((event as any).elapsed as number) ?? 0;
      const result = (event as any).result;
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result ?? '');
      if (toolName === 'delegate_to_subagent') {
        const id = (event as any).id as string;
        if (id && subAgentMap.has(id)) {
          const sa = subAgentMap.get(id)!;
          sa.status = 'done';
          sa.result = resultStr;
        }
      } else {
        const id = (event as any).toolCallId as string || (event as any).id as string;
        if (id && toolCallMap.has(id)) {
          const tc = toolCallMap.get(id)!;
          tc.status = 'done';
          tc.result = resultStr;
          tc.elapsed = elapsed;
        }
      }
    }

    // Persist conversation to session context files
    try {
      const eng = getEngine();
      const sess = eng.sessionManager.getActiveSession();
      const sessionId = sess?.id || (event as any).sessionId || '';

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
        const msg: any = (event as any).message;
        const text = (msg?.content as string) || (event as any).content as string || '';
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
        const result = (event as any).result as string || (event as any).output as string || '';
        if (sessionId && tool) {
          const snippet = result.length > 500 ? result.slice(0, 500) + '...' : result;
          appendContextFile(sessionId, 'system', `[tool] ${tool} completed (${elapsed}ms)\n${snippet}`);
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
