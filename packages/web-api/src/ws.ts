import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { getOrCreateAgent } from './engine.js';

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
      const agent = getOrCreateAgent();
      agent.cancel();
      break;
    }
    case 'permission_respond': {
      const agent = getOrCreateAgent();
      const choice = msg.choice as 'allow_once' | 'allow_always' | 'deny';
      agent.respondToPermission(choice);
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
    broadcast({
      type: 'engine_event',
      event: (event as { type?: string }).type ?? 'unknown',
      data: event,
    });
  });
}

export function ensureSubscribed(): void {
  if (subscribed) return;
  const agent = getOrCreateAgent();
  subscribeToAgent(agent as unknown as { events: { on: (handler: (event: Record<string, unknown>) => void) => () => void } });
}
