import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { getEngine } from './engine.js';

let wss: WebSocketServer | null = null;
let subscribed = false;

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

function handleWsMessage(msg: { type: string; [key: string]: unknown }): void {
  switch (msg.type) {
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
  if (subscribed) return;
  subscribed = true;

  agent.events.on((event: Record<string, unknown>) => {
    const evType = (event as { type?: string }).type ?? 'unknown';
    broadcast({
      type: 'engine_event',
      event: evType,
      data: event,
    });

    // Auto-fill session title from the first user message (only if still default)
    try {
      if (evType === 'message_sent') {
        const eng = getEngine();
        const sess = eng.sessionManager.getActiveSession();
        const rawMsg: any = (event as any).message?.content;
        if (sess && typeof rawMsg === 'string' && sess.title === 'New Session') {
          const firstLine = String(rawMsg).split('\n')[0] || '';
          const title = firstLine.slice(0, 80).trim();
          if (title.length > 0) eng.sessionManager.updateSession({ title });
        }
      }
    } catch {
      // ignore failures here — title auto-fill is best-effort
    }
  });
}

export function ensureSubscribed(): void {
  if (subscribed) return;
  const eng = getEngine();
  const agent = eng.agent;
  if (!agent) return;
  subscribeToAgent(agent as unknown as { events: { on: (handler: (event: Record<string, unknown>) => void) => () => void } });
}
