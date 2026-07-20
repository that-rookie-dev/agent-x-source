import { Router } from 'express';
import type { Request, Response } from 'express';
import { VERSION } from '@agentx/shared';
import { isStorageDeferred } from '../engine.js';
import { getEngine } from '../engine.js';
import { getTelegramInboundStatus } from '../channels-sync.js';
import type { ApiContext } from '../services/ApiService.js';
import os from 'node:os';

export function router(ctx: ApiContext): Router {
  const router = Router();

  // ───── Health ─────
  router.get('/api/health', (_req, res) => {
    let eng: ReturnType<typeof getEngine> | null = null;
    try {
      eng = getEngine();
    } catch (e) { /* engine init may fail before setup — still report healthy */ }
    let sessionCount = 0;
    let crewCount = 0;
    let agentActive = false;
    let configInfo: Record<string, unknown> = {};
    let telegramConnected = false;
    let telegramBot: string | null = null;
    let cpuPercent = 0;
    try {
      const metrics = ctx.api.getSystemMetrics();
      cpuPercent = metrics.cpu.process;
    } catch { /* ignore */ }
    if (eng) {
      try {
        const sessions = eng.sessionManager.listSessions(9999);
        sessionCount = sessions.length;
      } catch (e) { /* ignore */ }
      try {
        const crews = eng.crewManager.list();
        crewCount = crews.length;
      } catch (e) { /* ignore */ }
      try {
        const cfg = eng.configManager.load();
        configInfo = { provider: cfg.provider.activeProvider, model: cfg.provider.activeModel, user: cfg.user?.callsign || null };
      } catch (e) { /* ignore */ }
      agentActive = !!eng.agent;
      try {
        const tgStatus = getTelegramInboundStatus();
        telegramConnected = Boolean(tgStatus.inboundReady && tgStatus.bridgeRunning);
        telegramBot = tgStatus.botUsername ?? null;
      } catch (e) { /* ignore */ }
    }
    res.json({
      status: 'ok',
      version: VERSION,
      storageDeferred: (() => {
        try { return isStorageDeferred(); } catch { return false; }
      })(),
      pid: process.pid,
      node: process.version,
      platform: process.platform,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      config: configInfo,
      sessions: sessionCount,
      crews: crewCount,
      sessionCount,
      crewCount,
      agentActive,
      telegramConnected,
      telegramBot,
      gateway: eng?.gateway ? {
        focus: eng.gateway.focus.getFocus(),
        channels: eng.gateway.registry.listChannels(),
      } : null,
      agentHealth: (() => {
        const health = eng?.agent?.getHealth() ?? null;
        if (health && typeof health === 'object') {
          return health;
        }
        return health;
      })(),
      cpu: cpuPercent,
    });
  });

  // ───── Readiness ─────
  router.get('/api/ready', (_req: Request, res: Response) => {
    const readiness = ctx.api.getReadiness();
    const body = {
      ready: readiness.ready,
      checks: readiness.checks,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
    res.status(readiness.ready ? 200 : 503).json(body);
  });

  // ───── System metrics, time, and weather ─────
  router.get('/api/system/metrics', (_req: Request, res: Response) => {
    try {
      const metrics = ctx.api.getSystemMetrics();
      res.json(metrics);
    } catch (e: unknown) {
      res.status(500).json({ error: e instanceof Error ? e.message : 'metrics-failed' });
    }
  });

  router.get('/api/system/time', (_req: Request, res: Response) => {
    const now = new Date();
    res.json({
      timestamp: now.toISOString(),
      date: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      utcOffset: -now.getTimezoneOffset(),
    });
  });

  router.get('/api/weather', async (req: Request, res: Response) => {
    const lat = Number(req.query['lat']);
    const lon = Number(req.query['lon']);
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      res.status(400).json({ error: 'lat and lon are required' });
      return;
    }
    try {
      const weather = await ctx.api.getWeather(lat, lon);
      if (!weather) { res.status(503).json({ error: 'weather-unavailable' }); return; }
      res.json(weather);
    } catch (e: unknown) {
      res.status(500).json({ error: e instanceof Error ? e.message : 'weather-failed' });
    }
  });

  return router;
}
