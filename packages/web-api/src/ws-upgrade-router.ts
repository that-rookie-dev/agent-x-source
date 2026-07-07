import type { Server, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { WebSocketServer } from 'ws';

interface UpgradeRoute {
  path: string;
  wss: WebSocketServer;
}

const routes: UpgradeRoute[] = [];
let attached = false;

export function registerWebSocketRoute(path: string, wss: WebSocketServer): void {
  routes.push({ path, wss });
}

function pathnameOf(url: string | undefined): string {
  if (!url) return '';
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

/**
 * Route HTTP upgrades to the correct WebSocketServer by pathname.
 * Required when multiple ws servers share one HTTP server — attaching each
 * with `{ server }` causes non-matching paths to receive 400 from the first listener.
 */
export function attachWebSocketUpgradeRouter(server: Server): void {
  if (attached) return;
  attached = true;

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = pathnameOf(req.url);
    const route = routes.find((entry) => entry.path === pathname);
    if (!route) {
      socket.destroy();
      return;
    }
    route.wss.handleUpgrade(req, socket, head, (ws) => {
      route.wss.emit('connection', ws, req);
    });
  });
}
