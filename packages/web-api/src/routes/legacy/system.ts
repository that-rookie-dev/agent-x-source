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
import { getDataDir, getConfigDir, getCacheDir, agentXConfigSchema, voiceConfigSchema, authManager, buildPublicSystemCapabilities, resolvePerformanceSettings, buildPerformanceShowcase, getLogger, normalizeClientSituation, mergeUserConfig, isUserGender } from '@agentx/shared';
import type { AgentXConfig } from '@agentx/shared';
import { getEngine, destroyAgent, clearEngine, applyPerformanceSettings, applyAdoptionSettings, setCurrentClientSituation, getCurrentClientSituation, ensureSiManager } from '../../engine.js';
import { getOrCreateBoundSessionAgent } from '../../engine/agent-lifecycle.js';
import { getResidentSessionManager } from '@agentx/engine';
import { isResidentSessionsEnabled } from '@agentx/shared';
import {
  redactConfigForClient,
  mergeConfigPreservingSecrets,
  scrubPersistedSecretPlaceholders,
  REDACTED_SECRET,
} from '../../config-redaction.js';
import { mergeVoiceConfig, getBackgroundTaskPool, applyWebSearchConfigFromAgentConfig, mergeWebSearchToolsConfig, getLogCollector } from '@agentx/engine';
import { applyChannelsConfig } from '../../channels-sync.js';
import { applyHostConfig } from '../../host/apply-host-config.js';
import { validateProviderConfig, AVAILABLE_PROVIDERS } from './providers.js';
import { validateConfig, DATA_DIR, pathExists } from './shared.js';
import { reconcileVoiceKitState } from '../../voice/setup.js';

export function createSystemRouter(): Router {
  const r = Router();

  // ───── System capabilities ─────
  r.get('/api/system/capabilities', (_req, res) => {
    res.json(buildPublicSystemCapabilities(os.totalmem()));
  });

  r.post('/api/system/app-visibility', async (req, res) => {
    const visible = req.body?.visible !== false;
    let detachedSessionId: string | undefined;
    if (!visible && isResidentSessionsEnabled()) {
      try {
        const eng = getEngine();
        const agent = eng.agent;
        if (agent?.processing) {
          const sessionId = agent.sessionId;
          const session = eng.sessionManager.getSessionById(sessionId);
          if (session) {
            const bound = getOrCreateBoundSessionAgent(session);
            const manager = getResidentSessionManager();
            manager.register(sessionId, bound, 'active');
            if (await manager.detach(sessionId)) {
              detachedSessionId = sessionId;
            }
          }
        }
      } catch (err) {
        getLogger().warn('APP_VISIBILITY', err instanceof Error ? err.message : String(err));
      }
    }
    res.json({ ok: true, detachedSessionId });
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
      const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
      const nested = body.user && typeof body.user === 'object' ? body.user as Record<string, unknown> : body;
      const callsignRaw = typeof nested.callsign === 'string' ? nested.callsign.trim()
        : typeof body.callsign === 'string' ? body.callsign.trim()
          : '';
      const callsign = callsignRaw || existing.user?.callsign?.trim() || '';
      const patch = {
        ...(callsign ? { callsign } : {}),
        ...(Array.isArray(nested.names) ? { names: nested.names as string[] } : {}),
        ...(typeof nested.name === 'string' ? { name: nested.name } : {}),
        ...(typeof nested.prefix === 'string' ? { prefix: nested.prefix } : {}),
        ...(isUserGender(nested.gender) ? { gender: nested.gender } : {}),
        ...(typeof nested.email === 'string' ? { email: nested.email } : {}),
      };
      const merged: AgentXConfig = {
        ...existing,
        setupComplete: true,
        ...(callsign ? { user: mergeUserConfig(existing.user, patch) } : {}),
      };
      eng.configManager.save(merged);
      // Config is now complete; start the SI manager if it wasn't initialized earlier.
      void ensureSiManager().catch((err) => {
        getLogger().warn('SETUP_COMPLETE', err instanceof Error ? err.message : String(err));
      });
      res.json({ ok: true, setupComplete: true });
    } catch (err) {
      getLogger().error('POST_API_SETUP_COMPLETE', err instanceof Error ? err : String(err));
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to mark setup complete',
      });
    }
  });

  r.get('/api/config', async (_req, res) => {
    const eng = getEngine();
    try {
      await reconcileVoiceKitState();
      const raw = eng.configManager.load();
      // Heal keys that were previously persisted as redacted bullet placeholders
      // (invalid in HTTP headers). One-time repair on read.
      const healed = scrubPersistedSecretPlaceholders(raw);
      if (healed) {
        try { eng.configManager.save(healed); } catch { /* best-effort */ }
      }
      const cfg = healed ?? raw;
      // Merge voice config so enabled=true with mode.web='off' (legacy configs)
      // gets upgraded to mode.web='push-to-talk' automatically.
      const withMergedVoice = { ...cfg, voice: mergeVoiceConfig(cfg.voice) };
      res.json(redactConfigForClient(withMergedVoice));
    } catch (e) {
      getLogger().error('GET_API_CONFIG', e instanceof Error ? e : String(e));    res.status(400).json({ error: 'Agent-X is not configured. Configure a provider and model first.' });
    }
  });

  const performanceStatusHandler = (_req: import('express').Request, res: import('express').Response) => {
    try {
      const eng = getEngine();
      const cfg = eng.configManager.load();
      const showcase = buildPerformanceShowcase(cfg.performance);
      const resolved = resolvePerformanceSettings(cfg.performance);
      const pool = getBackgroundTaskPool();
      res.json({
        configured: resolved,
        showcase,
        cpuCores: showcase.host.cpuCores,
        backgroundPool: { running: pool.running, pending: pool.pending },
        /** ONNX / storage hydrate still need process restart; concurrency retunes live on save. */
        restartRequiredForOnnx: true,
        liveConcurrency: true,
        restartRequired: true,
      });
    } catch {
      const showcase = buildPerformanceShowcase(null);
      res.json({
        configured: resolvePerformanceSettings(null),
        showcase,
        cpuCores: showcase.host.cpuCores,
        backgroundPool: { running: 0, pending: 0 },
        restartRequiredForOnnx: true,
        liveConcurrency: true,
        restartRequired: true,
      });
    }
  };
  r.get('/api/performance/status', performanceStatusHandler);
  /** @deprecated Prefer /api/performance/status */
  r.get('/api/runtime/status', performanceStatusHandler);

  r.put('/api/config', (req, res) => {
    const eng = getEngine();
    try {
      const existing = eng.configManager.load();
      const merged = mergeConfigPreservingSecrets(existing, { ...existing, ...req.body });
      if (req.body.user && typeof req.body.user === 'object') {
        const incoming = req.body.user as { callsign?: string; name?: string; names?: string[]; prefix?: string; gender?: string; email?: string };
        merged.user = mergeUserConfig(existing.user, {
          callsign: (incoming.callsign || existing.user?.callsign || '').trim(),
          ...(Array.isArray(incoming.names) ? { names: incoming.names } : {}),
          ...(typeof incoming.name === 'string' ? { name: incoming.name } : {}),
          prefix: incoming.prefix,
          gender: isUserGender(incoming.gender) ? incoming.gender : undefined,
          email: incoming.email,
        });
      }
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
          xai: (() => {
            const inc = req.body.voice?.xai as { apiKey?: string; apiKeyConfigured?: boolean } | undefined;
            const prev = existing.voice?.xai?.apiKey;
            const raw = typeof inc?.apiKey === 'string' ? inc.apiKey.trim() : '';
            const placeholder = !raw || raw === REDACTED_SECRET || raw.includes('•');
            const hasNewKey = Boolean(raw) && !placeholder;
            const explicitlyCleared = inc?.apiKeyConfigured === false;
            let apiKey = prev;
            if (explicitlyCleared && !hasNewKey) {
              apiKey = '';
            } else if (hasNewKey) {
              apiKey = raw;
            }
            const { apiKeyConfigured: _drop, ...incRest } = inc ?? {};
            return {
              ...existing.voice?.xai,
              ...incRest,
              apiKey,
            };
          })(),
          stt: { ...existing.voice?.stt, ...req.body.voice?.stt },
          tts: { ...existing.voice?.tts, ...req.body.voice?.tts },
          sidecar: { ...existing.voice?.sidecar, ...req.body.voice?.sidecar },
          fillers: { ...existing.voice?.fillers, ...req.body.voice?.fillers },
          wakeWord: { ...existing.voice?.wakeWord, ...req.body.voice?.wakeWord },
          provider: { ...existing.voice?.provider, ...req.body.voice?.provider },
          // downloadedAssets is server-managed (registered during voice setup /
          // asset downloads). Never let the client overwrite it — stale UI state
          // used to wipe installed assets here.
          downloadedAssets: existing.voice?.downloadedAssets ?? [],
        };
        // Apply mergeVoiceConfig to fix legacy configs where enabled=true but mode.web='off'.
        merged.voice = mergeVoiceConfig(merged.voice);
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
      applyPerformanceSettings(merged);
      applyAdoptionSettings(merged);
      applyWebSearchConfigFromAgentConfig(merged);
      void applyChannelsConfig(merged).catch((e: unknown) => {
        getLogger().warn('CHANNELS', `Failed to apply channel config: ${e instanceof Error ? e.message : String(e)}`);
      });
      void applyHostConfig(merged).catch((e: unknown) => {
        getLogger().warn('HOST', `Failed to apply host config: ${e instanceof Error ? e.message : String(e)}`);
      });
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

  // Server-side geolocation — returns city-level location resolved from IP.
  // The web-ui uses this to display location in the footer and docking station.
  r.get('/api/geolocation', (_req, res) => {
    try {
      const situation = getCurrentClientSituation();
      const label = situation?.locationLabel?.trim();
      if (!label) {
        res.json({ city: null, fullLabel: null, cityLabel: '', resolved: false });
        return;
      }
      const city = label.split(',')[0]?.trim() || label;
      res.json({
        city,
        fullLabel: label,
        cityLabel: city,
        method: situation?.locationMethod ?? 'user_set',
        vpnSuspected: false,
        resolvedAt: Date.now(),
        resolved: true,
      });
    } catch (e: unknown) {
      getLogger().error('GET_GEOLOCATION', e instanceof Error ? e : String(e));
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'failed' });
    }
  });

  // Force a geolocation refresh (e.g. user clicked "retry").
  r.post('/api/geolocation/refresh', async (_req, res) => {
    try {
      const situation = getCurrentClientSituation();
      const label = situation?.locationLabel?.trim();
      res.json({
        ok: true,
        city: label ? (label.split(',')[0]?.trim() || label) : null,
        fullLabel: label ?? null,
        cityLabel: label ? (label.split(',')[0]?.trim() || label) : '',
        method: situation?.locationMethod ?? 'timezone_only',
        vpnSuspected: false,
        resolvedAt: Date.now(),
        resolved: Boolean(label),
      });
    } catch (e: unknown) {
      getLogger().error('POST_GEOLOCATION_REFRESH', e instanceof Error ? e : String(e));
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'failed' });
    }
  });

  return r;
}

// Re-export for consumers that previously imported these from legacy.ts
export { validateProviderConfig, AVAILABLE_PROVIDERS } from './providers.js';
export { validateConfig };
