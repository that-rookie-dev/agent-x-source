/**
 * System / setup / config / metrics / logs / reset / debug route group.
 *
 * Extracted from legacy.ts. Registers handlers on a dedicated Router and
 * exports createSystemRouter() for mounting by the legacy aggregator.
 */
import { Router } from 'express';
import os from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { getDataDir, getConfigDir, getCacheDir, agentXConfigSchema, voiceConfigSchema, authManager, buildPublicSystemCapabilities, resolveRuntimeSettings, getLogger, normalizeClientSituation } from '@agentx/shared';
import type { AgentXConfig } from '@agentx/shared';
import { getEngine, destroyAgent, clearEngine, applyRuntimeSettings, setCurrentClientSituation, getCurrentClientSituation } from '../../engine.js';
import { setIngestionAppVisible, getIngestionGovernorState } from '../../ingestion-governor.js';
import { redactConfigForClient, mergeConfigPreservingSecrets } from '../../config-redaction.js';
import { refreshIngestionWorkerGenerator } from '../../ingestion-worker-ref.js';
import { applyChannelsConfig } from '../../channels-sync.js';
import { getBackgroundTaskPool, applyWebSearchConfigFromAgentConfig, mergeWebSearchToolsConfig, getLogCollector } from '@agentx/engine';
import { validateProviderConfig, AVAILABLE_PROVIDERS } from './providers.js';
import { validateConfig, DATA_DIR, pathExists } from './shared.js';

export function createSystemRouter(): Router {
  const r = Router();

  // ───── System capabilities ─────
  r.get('/api/system/capabilities', (_req, res) => {
    res.json(buildPublicSystemCapabilities(os.totalmem()));
  });

  r.post('/api/system/app-visibility', (req, res) => {
    const visible = req.body?.visible === true;
    setIngestionAppVisible(visible);
    res.json({ ok: true, ...getIngestionGovernorState() });
  });

  r.get('/api/system/ingestion-governor', (_req, res) => {
    res.json(getIngestionGovernorState());
  });

  // ───── Setup / Config ─────
  r.get('/api/setup/status', (_req, res) => {
    try {
      const eng = getEngine();
      const configured = eng.configManager.isConfigured();
      if (!configured) {
        res.json({ setupComplete: false, configured: false, reason: 'No config file found. Run setup wizard first.' });
        return;
      }
      const complete = eng.configManager.isSetupComplete();
      res.json({
        setupComplete: complete,
        configured: true,
        reason: complete ? undefined : 'Config exists but is encrypted. Login with the same credentials used during initial setup (TUI or Web-UI) to unlock.',
      });
    } catch (err) {
      getLogger().error('GET_API_SETUP_STATUS', err instanceof Error ? err : String(err));    res.status(500).json({
        setupComplete: false,
        configured: false,
        reason: `Config read error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  r.post('/api/setup/complete', (req, res) => {
    try {
      const eng = getEngine();
      const existing = eng.configManager.load();
      const callsignRaw = typeof req.body?.callsign === 'string' ? req.body.callsign.trim() : '';
      const callsign = callsignRaw || existing.user?.callsign?.trim() || '';
      const merged: AgentXConfig = {
        ...existing,
        setupComplete: true,
        ...(callsign ? { user: { callsign } } : {}),
      };
      eng.configManager.save(merged);
      res.json({ ok: true, setupComplete: true });
    } catch (err) {
      getLogger().error('POST_API_SETUP_COMPLETE', err instanceof Error ? err : String(err));
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to mark setup complete',
      });
    }
  });

  r.get('/api/config', (_req, res) => {
    const eng = getEngine();
    try {
      res.json(redactConfigForClient(eng.configManager.load()));
    } catch (e) {
      getLogger().error('GET_API_CONFIG', e instanceof Error ? e : String(e));    res.status(400).json({ error: 'Agent-X is not configured. Configure a provider and model first.' });
    }
  });

  r.get('/api/runtime/status', (_req, res) => {
    try {
      const eng = getEngine();
      const cfg = eng.configManager.load();
      const resolved = resolveRuntimeSettings(cfg.runtime);
      const pool = getBackgroundTaskPool();
      res.json({
        configured: resolved,
        cpuCores: os.cpus().length,
        backgroundPool: { running: pool.running, pending: pool.pending },
        restartRequired: true,
      });
    } catch {
      res.json({
        configured: resolveRuntimeSettings(null),
        cpuCores: os.cpus().length,
        backgroundPool: { running: 0, pending: 0 },
        restartRequired: true,
      });
    }
  });

  r.put('/api/config', (req, res) => {
    const eng = getEngine();
    try {
      const existing = eng.configManager.load();
      const merged = mergeConfigPreservingSecrets(existing, { ...existing, ...req.body });
      if (req.body.tools?.webSearch) {
        merged.tools = {
          ...existing.tools,
          ...req.body.tools,
          webSearch: mergeWebSearchToolsConfig(existing.tools?.webSearch, req.body.tools?.webSearch),
        };
      } else if (req.body.tools) {
        merged.tools = { ...existing.tools, ...req.body.tools };
      }
      if (req.body.channels) {
        merged.channels = {
          telegram: { ...existing.channels?.telegram, ...req.body.channels?.telegram },
          slack: { ...existing.channels?.slack, ...req.body.channels?.slack },
          email: { ...existing.channels?.email, ...req.body.channels?.email },
          discord: { ...existing.channels?.discord, ...req.body.channels?.discord },
        };
      }
      if (req.body.voice) {
        merged.voice = {
          ...existing.voice,
          ...req.body.voice,
          mode: { ...existing.voice?.mode, ...req.body.voice?.mode },
          stt: { ...existing.voice?.stt, ...req.body.voice?.stt },
          tts: { ...existing.voice?.tts, ...req.body.voice?.tts },
          sidecar: { ...existing.voice?.sidecar, ...req.body.voice?.sidecar },
          fillers: { ...existing.voice?.fillers, ...req.body.voice?.fillers },
          wakeWord: { ...existing.voice?.wakeWord, ...req.body.voice?.wakeWord },
          // downloadedAssets is server-managed (registered during voice setup /
          // asset downloads). Never let the client overwrite it — stale UI state
          // used to wipe installed assets here.
          downloadedAssets: existing.voice?.downloadedAssets ?? [],
        };
        const voiceParse = voiceConfigSchema.safeParse(merged.voice);
        if (!voiceParse.success) {
          res.status(400).json({
            error: 'invalid-voice-config',
            message: voiceParse.error.issues.map((issue) => issue.message).join('; '),
          });
          return;
        }
        merged.voice = voiceParse.data ?? merged.voice;
      }
      // Validate provider config — reject if it would leave zero configured providers
      // or unset the active provider. This ensures the ingestion worker's LLM
      // generator can always be built after login.
      const providerError = validateProviderConfig(merged);
      if (providerError) {
        res.status(400).json({ error: 'invalid-provider-config', message: providerError });
        return;
      }
      eng.configManager.save(merged);
      applyRuntimeSettings(merged);
      applyWebSearchConfigFromAgentConfig(merged);
      void applyChannelsConfig(merged).catch((e: unknown) => {
        getLogger().warn('CHANNELS', `Failed to apply channel config: ${e instanceof Error ? e.message : String(e)}`);
      });
      // Rebuild the ingestion worker's LLM generator in case provider config changed
      void refreshIngestionWorkerGenerator();
      res.json({ ok: true });
      } catch (err) {
      getLogger().error('PUT_API_CONFIG', err instanceof Error ? err : String(err));
      res.status(500).json({
        ok: false,
        error: 'Failed to save config. Auth and config DEK may be out of sync. Re-create root user or ensure auth.json is shared between host and container.',
      });
    }
  });

  // ───── Prometheus Metrics ─────
  r.get('/api/metrics', (_req, res) => {
    const eng = getEngine();
    const samples = eng.telemetry.snapshot();
    const lines: string[] = [];
    lines.push('# HELP agentx_metrics Agent-X telemetry metrics');
    lines.push('# TYPE agentx_metrics untyped');
    for (const s of samples) {
      const labels = s.labels && Object.keys(s.labels).length > 0
        ? `{${Object.entries(s.labels).map(([k, v]) => `${k}="${v}"`).join(',')}}`
        : '';
      lines.push(`${s.name}${labels} ${s.value} ${s.timestamp || ''}`.trim());
    }
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(lines.join('\n') + '\n');
  });

  // ───── Logs ─────
  r.get('/api/logs', (req, res) => {
    try {
      const collector = getLogCollector();
      const level = req.query['level'] as string | undefined;
      const code = req.query['code'] as string | undefined;
      const search = req.query['search'] as string | undefined;
      const limit = parseInt(req.query['limit'] as string) || 500;
      const since = req.query['since'] ? parseInt(req.query['since'] as string) : undefined;

      const entries = collector.query({ level, code, search, limit, since });
      res.json({ count: collector.count, entries });
    } catch (e: unknown) {
      getLogger().error('GET_API_LOGS', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'logs-failed' });
    }
  });

  r.get('/api/logs/stream', (req, res) => {
    const collector = getLogCollector();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    res.write(`data: ${JSON.stringify({ type: 'connected', count: collector.count })}\n\n`);

    const onEntry = (evt: { entry: Record<string, unknown>; index: number }) => {
      try {
        res.write(`event: log\ndata: ${JSON.stringify(evt)}\n\n`);
      } catch (e) { /* client disconnected */ }
    };

    collector.on('entry', onEntry);

    const heartbeat = setInterval(() => {
      try { res.write(':heartbeat\n\n'); } catch (e) { clearInterval(heartbeat); }
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      collector.off('entry', onEntry);
    });
  });

  r.delete('/api/logs', (_req, res) => {
    try {
      getLogCollector().clear();
      res.json({ ok: true });
    } catch (e: unknown) {
      getLogger().error('DELETE_API_LOGS', e instanceof Error ? e : String(e));
      res.status(500).json({ error: e instanceof Error ? e.message : 'logs-clear-failed' });
    }
  });

  // ───── Reset ─────
  r.post('/api/reset', async (_req, res) => {
    try {
      // 1. Destroy agent and stop all running services
      destroyAgent();

      // 2. Stop Telegram bridge if running
      try {
        const eng = getEngine();
        if (eng.telegramBridge) {
          try { eng.telegramBridge.stop(); } catch (e) { /* ignore */ }
          eng.telegramBridge = null;
        }
        if (eng.gateway) {
          try { eng.gateway.stopAll(); } catch (e) { /* ignore */ }
          eng.gateway = null;
        }
        if (eng.discordBridge) {
          try { eng.discordBridge.stop(); } catch (e) { /* ignore */ }
          eng.discordBridge = null;
        }
        if (eng.slackBridge) {
          try { eng.slackBridge.stop(); } catch (e) { /* ignore */ }
          eng.slackBridge = null;
        }
        if (eng.emailBridge) {
          try { eng.emailBridge.stop(); } catch (e) { /* ignore */ }
          eng.emailBridge = null;
        }
      } catch (e) { /* engine not initialized */ }

      // 3. Delete all data on disk
      const configDir = getConfigDir();
      const dataDir = getDataDir();
      const cacheDir = getCacheDir();

      const dirs = [configDir, dataDir, cacheDir];
      for (const dir of dirs) {
        try { await rm(dir, { recursive: true, force: true }); } catch (e) { /* ok */ }
      }

      // 4. Purge all auth sessions (in-memory + file)
      authManager.purgeSessions();

      // 5. Clear engine state
      clearEngine();

      // 6. Clear auth cookie
      res.clearCookie('agentx_session', { path: '/' });

      res.json({ ok: true, message: 'All data deleted. You will be redirected to setup.' });
    } catch (e: unknown) {
      getLogger().error('POST_API_RESET', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'reset-failed' });
    }
  });

  // ─── Debug Log Endpoint ────────────────────────────────────────────
  // Accept frontend-side parse errors so developers can see raw API output
  r.post('/api/debug/log', async (req, res) => {
    try {
      const DEBUG_DIR = join(DATA_DIR, 'debug-logs');
      if (!(await pathExists(DEBUG_DIR))) await mkdir(DEBUG_DIR, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      await writeFile(join(DEBUG_DIR, `frontend_${ts}.json`), JSON.stringify(req.body, null, 2));
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: 'invalid-log-entry' });
    }
  });

  // ─── Client Situation (location + timezone) ─────────────────────────
  // The UI reports the user's device location/timezone at launch and whenever it changes.
  // Channel agents (Telegram, Slack, Discord, email) use this as the source of truth
  // because they don't receive per-turn clientSituation like the chat UI does.
  r.post('/api/client-situation', (req, res) => {
    try {
      const situation = normalizeClientSituation(req.body?.situation ?? req.body);
      setCurrentClientSituation(situation);
      res.json({ ok: true, situation: getCurrentClientSituation() });
    } catch (e: unknown) {
      getLogger().error('POST_CLIENT_SITUATION', e instanceof Error ? e : String(e));
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'failed' });
    }
  });

  r.get('/api/client-situation', (_req, res) => {
    try {
      res.json({ situation: getCurrentClientSituation() });
    } catch (e: unknown) {
      getLogger().error('GET_CLIENT_SITUATION', e instanceof Error ? e : String(e));
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'failed' });
    }
  });

  return r;
}

// Re-export for consumers that previously imported these from legacy.ts
export { validateProviderConfig, AVAILABLE_PROVIDERS } from './providers.js';
export { validateConfig };
