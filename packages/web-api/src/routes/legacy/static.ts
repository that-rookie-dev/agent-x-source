import { Router } from 'express';
import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { getLogger } from '@agentx/shared';
import { UI_DIST, pathExists } from './shared.js';

const UI_PROXY_URL = process.env['AGENTX_UI_PROXY_URL'] || 'http://localhost:5173';

export function createStaticRouter(): Router {
  const r = Router();

  // Serve static UI assets
  r.get('*', async (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) { next(); return; }

    // Dev mode: proxy to Vite dev server
    if (process.env['AGENTX_SERVE_UI'] === 'proxy') {
      try {
        const upstream = `${UI_PROXY_URL}${req.path}`;
        const upstreamRes = await fetch(upstream);
        const buf = Buffer.from(await upstreamRes.arrayBuffer());
        const headers: Record<string, string> = {};
        upstreamRes.headers.forEach((v, k) => { headers[k] = v; });
        delete headers['transfer-encoding'];
        res.writeHead(upstreamRes.status, headers);
        res.end(buf);
      } catch (e) {
        getLogger().error('GET_', e instanceof Error ? e : String(e));      res.status(502).json({ error: 'ui-proxy-failed' });
      }
      return;
    }

    // Production: serve static files from web-ui/dist
    const filePath = req.path === '/' ? 'index.html' : req.path.slice(1);
    const fullPath = resolve(UI_DIST, filePath);
    const safeRoot = resolve(UI_DIST);
    if (!fullPath.startsWith(safeRoot) && fullPath !== safeRoot) { res.status(403).end(); return; }
    if ((await pathExists(fullPath)) && !(await stat(fullPath)).isDirectory()) {
      res.sendFile(fullPath);
    } else {
      // SPA fallback
      const index = resolve(UI_DIST, 'index.html');
      if (await pathExists(index) && index.startsWith(safeRoot)) {
        res.sendFile(index);
      } else {
        next();
      }
    }
  });

  return r;
}
