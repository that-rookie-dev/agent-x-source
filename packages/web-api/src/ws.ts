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

function appendContextFile(sessionId: string, role: string, content: string): void {
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
    // Update conversation.json
    let conv: unknown[] = [];
    try { conv = JSON.parse(existsSync(convPath) ? readFileSync(convPath, 'utf-8') : '[]') as unknown[]; } catch { conv = []; }
    conv.push({ timestamp, role, content: content.slice(0, 2000) });
    atomicWriteFileSync(convPath, JSON.stringify(conv, null, 2));
  } catch { /* best-effort */ }
}

let wss: WebSocketServer | null = null;
let subscribedAgent: unknown | null = null;

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

export function subscribeToAgent(agent: { events: { on: (handler: (event: Record<string, unknown>) => void) => () => void } }): void {
  if (subscribedAgent === agent) return;
  subscribedAgent = agent;

  agent.events.on((event: Record<string, unknown>) => {
    const evType = (event as { type?: string }).type ?? 'unknown';
    broadcast({
      type: 'engine_event',
      event: evType,
      data: event,
    });

    // Persist conversation to session context files
    try {
      const eng = getEngine();
      const sess = eng.sessionManager.getActiveSession();
      const sessionId = sess?.id || (event as any).sessionId || '';

      // Auto-fill session title from the first user message (only if still default)
      if (evType === 'message_sent') {
        const rawMsg: any = (event as any).message?.content;
        if (sess && typeof rawMsg === 'string' && sess.title === 'New Session') {
          const firstLine = String(rawMsg).split('\n')[0] || '';
          const title = firstLine.slice(0, 80).trim();
          if (title.length > 0) eng.sessionManager.updateSession({ title });
        }
      }

      // Write to context.txt on user send and assistant response
      if (evType === 'message_sent' || evType === 'message_received') {
        const msg: any = (event as any).message;
        const role = evType === 'message_sent' ? 'user' : 'assistant';
        const text = (msg?.content as string) || (event as any).content as string || '';
        if (sessionId && text) {
          appendContextFile(sessionId, role, text);
        }
      }

      // Write tool execution results to context.txt
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
