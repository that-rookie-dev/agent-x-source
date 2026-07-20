import { Router } from 'express';
import { join } from 'node:path';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { getDataDir, getLogger } from '@agentx/shared';
import { getEngine } from '../../engine.js';
import { pathExists } from './shared.js';

const DATA_DIR = getDataDir();
const TUI_ACTIVE_PATH = join(DATA_DIR, 'tui-active.mark');
const WEBUI_ACTIVE_PATH = join(DATA_DIR, 'webui-active.mark');

export function createGatewayRouter(): Router {
  const r = Router();

  r.get('/api/tui-active', async (_req, res) => {
    if (await pathExists(TUI_ACTIVE_PATH)) {
      try {
        const pid = parseInt((await readFile(TUI_ACTIVE_PATH, 'utf-8')).trim(), 10);
        // Verify process is still alive
        try { process.kill(pid, 0); } catch (e) { await unlink(TUI_ACTIVE_PATH); res.json({ active: false }); return; }
        res.json({ active: true, pid });
      } catch (e) {
        res.json({ active: false });
      }
    } else {
      res.json({ active: false });
    }
  });

  r.get('/api/webui-active', async (_req, res) => {
    if (await pathExists(WEBUI_ACTIVE_PATH)) {
      try {
        const data = JSON.parse(await readFile(WEBUI_ACTIVE_PATH, 'utf-8'));
        const { pid, timestamp } = data;
        // Check if marker is recent (within last 30 seconds)
        const age = Date.now() - timestamp;
        if (age > 30000) {
          await unlink(WEBUI_ACTIVE_PATH);
          res.json({ active: false });
          return;
        }
        res.json({ active: true, pid, timestamp });
      } catch (e) {
        res.json({ active: false });
      }
    } else {
      res.json({ active: false });
    }
  });

  r.post('/api/webui-active', async (req, res) => {
    try {
      const pid = req.body?.pid ?? process.pid;
      await writeFile(WEBUI_ACTIVE_PATH, JSON.stringify({ pid, timestamp: Date.now() }));
      res.json({ ok: true });
    } catch (err) {
      getLogger().error('POST_API_WEBUI_ACTIVE', err instanceof Error ? err : String(err));    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  r.delete('/api/webui-active', async (_req, res) => {
    try {
      if (await pathExists(WEBUI_ACTIVE_PATH)) {
        await unlink(WEBUI_ACTIVE_PATH);
      }
      res.json({ ok: true });
    } catch (err) {
      getLogger().error('DELETE_API_WEBUI_ACTIVE', err instanceof Error ? err : String(err));    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  r.get('/api/gateway/status', (_req, res) => {
    const eng = getEngine();
    if (!eng.gateway) {
      res.json({ active: false });
      return;
    }
    res.json({
      active: true,
      focus: eng.gateway.focus.getFocus(),
      channels: eng.gateway.registry.listChannels(),
      channelStats: eng.gateway.registry.getAllStats(),
    });
  });

  r.post('/api/gateway/focus', (req, res) => {
    const eng = getEngine();
    const { channel } = req.body as { channel: string };
    if (!eng.gateway) {
      res.status(400).json({ error: 'Gateway not active' });
      return;
    }
    eng.gateway.focus.setFocus(channel);
    res.json({ ok: true, focus: channel });
  });

  r.get('/api/gateway/focus', (_req, res) => {
    const eng = getEngine();
    if (!eng.gateway) {
      res.json({ focus: null });
      return;
    }
    res.json({
      focus: eng.gateway.focus.getFocus(),
      channels: eng.gateway.focus.getAllChannels(),
      activeChannels: eng.gateway.focus.getActiveChannels(),
    });
  });

  return r;
}
