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
      agentHealth: eng?.agent?.getHealth() ?? null,
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

  return router;
}
