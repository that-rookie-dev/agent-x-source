/**
 * Terminal WebSocket — streams live terminal output to the UI.
 *
 * Connection: ws://localhost:3333/ws/terminal?tid=<terminalId>
 *
 * Messages from server:
 *   { type: 'data', data: '...', offset: N }
 *   { type: 'exit', exitCode: N }
 *   { type: 'error', message: '...' }
 *
 * Messages from client:
 *   { type: 'input', text: '...' }
 *   { type: 'resize', cols: N, rows: N }
 */
import { WebSocketServer, type WebSocket } from 'ws';
import { TerminalManager } from '@agentx/engine';
import { registerWebSocketRoute } from './ws-upgrade-router.js';
import { validateWebSocketConnection } from './auth.js';

let bootstrapped = false;

export function setupTerminalWebSocket(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  const wss = new WebSocketServer({
    noServer: true,
    verifyClient: (info, cb) => {
      if (validateWebSocketConnection(info.req)) {
        cb(true);
      } else {
        cb(false, 401, 'Unauthorized');
      }
    },
  });

  registerWebSocketRoute('/ws/terminal', wss);

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const tid = url.searchParams.get('tid');
    if (!tid) {
      ws.send(JSON.stringify({ type: 'error', message: 'Missing tid parameter' }));
      ws.close();
      return;
    }

    const session = TerminalManager.getInstance().get(tid);
    if (!session) {
      ws.send(JSON.stringify({ type: 'error', message: 'Terminal not found' }));
      ws.close();
      return;
    }

    // Send initial output
    const initial = session.getFullOutput(500_000);
    if (initial) {
      ws.send(JSON.stringify({ type: 'data', data: initial, offset: 0, totalLength: session.toInfo().outputLength }));
    }

    // Stream new output
    const offData = session.onData((chunk) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'data', data: chunk.data, offset: chunk.offset }));
      }
    });

    // Stream exit
    const offExit = session.onExit((info) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', exitCode: info.exitCode }));
        ws.close();
      }
    });

    // Handle client messages
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'input' && session.isAlive()) {
          session.sendInput(msg.text);
        } else if (msg.type === 'resize' && session.isAlive()) {
          session.resize(msg.cols ?? 120, msg.rows ?? 30);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      offData();
      offExit();
    });
  });
}
