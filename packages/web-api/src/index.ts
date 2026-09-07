import express from 'express';
import type { Express } from 'express';
import { createServer } from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLogger, getDataDir, VERSION } from '@agentx/shared';
import { getEngine, awaitEngineStorageReady, setAgentMetricsApi } from './engine.js';
import { getObservabilityHandle } from '@agentx/engine';
import { ensureLoginShellPath, configureHttpKeepAlive, startAppSpan } from '@agentx/engine';
import { authMiddleware, createAuthRouter, isTelephonyWebhookPath } from './auth.js';
import { errorHandler } from './middleware/error.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { requestLogger } from './middleware/request-logger.js';
import { requestMetrics } from './middleware/request-metrics.js';
import { requestObservabilityMiddleware } from './middleware/request-observability.js';
import { setDefaultEmbeddingCacheDir } from '@agentx/engine';
import { drainForShutdown } from './shutdown-coordinator.js';
import { markEngineShuttingDown } from '@agentx/engine';
import { setupVoiceWebSocket } from './voice-ws.js';
import { setupWebSocket, shutdownWebSocket } from './ws.js';
import { attachWebSocketUpgradeRouter } from './ws-upgrade-router.js';
import { applyChannelsConfig } from './channels-sync.js';
import {
  createHostRouter,
  ensureHostAndTelephonyBootstrapped,
  applyHostConfig,
  publicEdgeGuard,
  csrfOriginGuard,
  loginRateLimit,
  publicApiRateLimit,
  accountRateLimit,
  webhookRateLimit,
  writeHostCleanShutdownMarker,
} from './host/index.js';
import { createTelephonyRouter } from './telephony/index.js';
import { setupTelephonyMediaWebSocket } from './telephony/media-bridge.js';
import { setupTerminalWebSocket } from './terminal-ws.js';
import { startVoiceCallRetentionScheduler, stopVoiceCallRetentionScheduler } from './telephony/retention.js';
import { registerEmbeddedPostgresController } from './pg-lifecycle-bridge.js';
import { registerAutomationRoutes, bootstrapAutomationFromEngine, shutdownAutomation } from './automation/index.js';
import { registerArticleRoutes } from './articles-api.js';
import { registerCapabilityRoutes } from './capabilities-api.js';
import { initAgentXOverviewBridge, shutdownAgentXOverviewBridge } from './agent-x-overview-bridge.js';
import { createApiService } from './services/ApiService.js';
import { getKnowledgeBaseService } from './services/knowledge-base.js';
import { neuralCortexRouter } from './routes/neural-cortex/index.js';
import { integrationsRouter, handleMcpStdioOAuthCallback } from './integrations-api.js';
import localModelRouter from './local-model-api.js';
import modelBenchmarkRouter from './model-benchmark-api.js';
import voiceRouter from './voice-api.js';
import { router as jobsRouter } from './routes/jobs.js';
import { router as healthRouter } from './routes/health.js';
import { router as metricsRouter } from './routes/metrics.js';
import { router as legacyRouter } from './routes/legacy.js';
import { router as knowledgeBaseRouter } from './routes/knowledge-base.js';
import { observabilityRouter } from './routes/observability/index.js';
import { devRouter } from './routes/observability/dev.js';
import { loadGlobalDevMode } from './middleware/dev-mode.js';
import { createPromptBenchmarkRouter } from './routes/prompt-benchmark.js';
import { createStaticRouter } from './routes/legacy/static.js';
import { registerInternalUiInvoker } from './internal-ui.js';
import { DATA_DIR, SESSIONS_DIR, UPLOADS_DIR, UI_DIST } from './api-helpers.js';

const PORT = Number(process.env['AGENTX_PORT'] || process.env['PORT']) || 3333;
const HOST = process.env['AGENTX_HOST'] ?? '127.0.0.1';
const __dirname = dirname(fileURLToPath(import.meta.url));

const BUNDLED_EMBEDDING_MODEL_DIR = join(__dirname, 'models');
if (existsSync(join(BUNDLED_EMBEDDING_MODEL_DIR, 'Xenova', 'all-MiniLM-L6-v2')) ||
    existsSync(join(BUNDLED_EMBEDDING_MODEL_DIR, 'Xenova', 'bge-m3'))) {
  const runtimeModelDir = join(getDataDir(), 'models');
  if (!existsSync(join(runtimeModelDir, 'Xenova', 'bge-m3')) &&
      !existsSync(join(runtimeModelDir, 'Xenova', 'all-MiniLM-L6-v2'))) {
    setDefaultEmbeddingCacheDir(BUNDLED_EMBEDDING_MODEL_DIR);
  }
}

const startupErrors: string[] = [];

if (!DATA_DIR) {
  startupErrors.push('DATA_DIR is empty or undefined. Check filesystem permissions and XDG_DATA_HOME.');
}

try {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {
  startupErrors.push(`Cannot create data directory (${DATA_DIR}): ${e instanceof Error ? e.message : String(e)}`);
}

try {
  if (!existsSync(UPLOADS_DIR)) {
    mkdirSync(UPLOADS_DIR, { recursive: true });
  }
} catch (e) {
  startupErrors.push(`Cannot create uploads directory (${UPLOADS_DIR}): ${e instanceof Error ? e.message : String(e)}`);
}

try {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
} catch (e) {
  startupErrors.push(`Cannot create sessions directory (${SESSIONS_DIR}): ${e instanceof Error ? e.message : String(e)}`);
}

if (!existsSync(UI_DIST)) {
  startupErrors.push(`UI dist directory not found at ${UI_DIST}. The web UI will not be served. Set AGENTX_UI_DIR or build the web-ui package.`);
}

if (PORT < 1 || PORT > 65535) {
  startupErrors.push(`Invalid port ${PORT}. Must be between 1 and 65535.`);
}

if (startupErrors.length > 0) {
  for (const err of startupErrors) {
    if (err.includes('UI dist')) {
      getLogger().warn('STARTUP', err);
    } else {
      getLogger().error('STARTUP', err);
    }
  }
  const fatalErrors = startupErrors.filter(e => !e.includes('UI dist'));
  if (fatalErrors.length > 0) {
    getLogger().error('STARTUP', '\n\u274c Fatal startup errors:');
    for (const err of fatalErrors) {
      getLogger().error('STARTUP', `   - ${err}`);
    }
    getLogger().error('STARTUP', '\nAgent-X cannot start. Please fix the above errors and restart.\n');
    process.exit(1);
  }
} else {
  getLogger().info('STARTUP', `All startup checks passed. Port: ${PORT}, Data: ${DATA_DIR}`);
}

const api = createApiService();
// Expose the ApiService's agent metrics to the observability MetricsSampler as
// an AgentMetricsApi adapter (§8.2). Set before `storageReady` resolves so the
// agent metric source is wired when `initObservability` runs in state.ts.
setAgentMetricsApi({
  getAgentMetrics: () => {
    const m = api.getAgentMetrics();
    return {
      turnsTotal: m.turnsTotal,
      toolLatencyAvgMs: m.toolLatencyAvg * 1000,
      toolLatencyP95Ms: m.toolLatencyP95 * 1000,
      toolCallCount: m.toolLatencyCount,
      queueDepth: m.queueDepth,
      memoryCacheHitRate: m.memoryCacheHitRate,
    };
  },
});
const app: Express = express();
app.use(express.json({ limit: '50mb' }));

// Global middleware
const corsOrigin = process.env.AGENTX_CORS_ORIGIN;
app.use((_req, res, next) => {
  if (corsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Content-Disposition, X-Request-Id');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

// Request ID
app.use(requestIdMiddleware);

// Public-edge hardening (Phase H3): deny-by-default allowlist for tunnel/public
// traffic + baseline hardening headers (Referrer-Policy, Permissions-Policy,
// HSTS when appropriate). Runs as early as possible so disallowed paths never
// reach observability, auth, or route handlers.
app.use(publicEdgeGuard);

// Per-IP request budget for all API traffic. Placed before auth so it also
// protects unauthenticated endpoints (login/setup) from floods. Webhook paths
// get their own, separate per-IP budget instead of the general API one.
app.use('/api', (req, res, next) => {
  if (isTelephonyWebhookPath(req.path)) {
    webhookRateLimit.middleware(req, res, next);
    return;
  }
  publicApiRateLimit.middleware(req, res, next);
});

// Login attempts get a tighter, longer-window budget with a lockout-style message.
app.use('/api/auth/login', loginRateLimit.middleware);

// HTTP request observability (metrics + spans). This is placed BEFORE auth so
// auth spans (middleware, session_validate, login, status, ...) become children of
// the HTTP root span instead of creating separate root traces that flood the list.
app.use(requestObservabilityMiddleware);

// Auth middleware (runs after HTTP observability is active; sets req.agentxSession).
app.use(authMiddleware);

// Per-account request budget, once a session is attached by authMiddleware.
app.use('/api', accountRateLimit.middleware);

// CSRF/Origin guard for cookie-authenticated, state-changing public-edge
// requests. Runs after auth so cookie/session context is available.
app.use(csrfOriginGuard);

// Structured request logging (after auth so the session is available for logs).
app.use(requestLogger);

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Auth routes (after request observability so auth operations are children of the HTTP span).
app.use('/api', createAuthRouter());

// Gmail MCP OAuth callback
app.get('/oauth2callback', (req, res) => { void handleMcpStdioOAuthCallback(req, res); });

// Existing service routers
app.use('/api', neuralCortexRouter());
app.use('/api', localModelRouter);
app.use('/api', modelBenchmarkRouter);
app.use('/api', voiceRouter);
app.use('/api', integrationsRouter);
app.use('/api', createHostRouter());
app.use('/api', createTelephonyRouter());
registerAutomationRoutes(app);
registerArticleRoutes(app);
registerCapabilityRoutes(app);

// New route modules
app.use('/', healthRouter({ api }));
app.use('/api', createPromptBenchmarkRouter());
app.use('/api/jobs', jobsRouter({ api }));
app.use('/', metricsRouter({ api }));
app.use('/', legacyRouter({ api }));
app.use('/api', knowledgeBaseRouter({ api }));

// ── Observability API + UI (Phase 5) ────────────────────────────────────────
// The data endpoints are gated by authMiddleware (above) + requireDeveloperMode
// (inside the router). The dev-mode status/verify endpoints are NOT gated by
// dev mode (they're needed to unlock it).
//
// NOTE: `initObservability` runs asynchronously inside the engine bootstrap
// (after `storageReady` resolves in state.ts), so `getObservabilityHandle()`
// returns undefined at module-eval time when these routes are mounted. We
// therefore resolve the handle **lazily on each request** and build the
// observability router on first hit after the handle is available. This lets
// the dev-mode endpoints (status/verify/enable/disable — which don't touch the
// store) work immediately, and the data endpoints light up once observability
// finishes initializing. If observability never initializes (e.g. storage
// deferred), data endpoints return 503 but dev endpoints still work.
let obsRouter: express.Router | undefined;
let obsRouterHandle: unknown = null;
// Dev-only router used before observability initializes. devRouter ignores the
// store/handle (it only touches authManager + session flags), so a stub context
// is safe. Built once and cached.
let devOnlyRouterCache: express.Router | undefined;
app.use('/api/observability', (req, res, next) => {
  const handle = getObservabilityHandle();
  if (handle) {
    if (!obsRouter || obsRouterHandle !== handle) {
      obsRouter = observabilityRouter({ api, store: handle.store, handle });
      obsRouterHandle = handle;
    }
    return obsRouter(req, res, next);
  }
  // Observability not initialized yet. The dev-mode endpoints don't need the
  // store, so serve /dev/* from the dev-only router instead of returning 503.
  if (req.path === '/dev' || req.path.startsWith('/dev/')) {
    if (!devOnlyRouterCache) {
      // devRouter ignores ctx (store/handle) — only authManager + session flags.
      devOnlyRouterCache = devRouter({ api } as never);
    }
    return devOnlyRouterCache(req, res, next);
  }
  res.status(503).json({ error: 'observability-not-initialized', message: 'Observability is not initialized.' });
});

// Static-serve the observability UI at /observability (SPA fallback for deep links).
// The build:observability script emits dist/observability/observability.html.
const OBS_UI_DIST = join(UI_DIST, 'observability');
const OBS_UI_HTML = join(OBS_UI_DIST, 'observability.html');
if (existsSync(OBS_UI_DIST)) {
  // Serve static assets; do not auto-serve index.html for directory requests.
  app.use('/observability', express.static(OBS_UI_DIST, { index: false }));
  // SPA fallback for /observability, /observability/, and all deep links.
  app.get(/^\/observability(?:\/(.*))?$/, (_req, res) => {
    res.sendFile(OBS_UI_HTML);
  });
}

// Main web UI SPA fallback/static assets. Must be after API/ws/observability routes.
app.use(createStaticRouter());

// Global error handler
app.use(errorHandler);

const server = createServer(app);
setupWebSocket(server);
setupVoiceWebSocket(server);
setupTelephonyMediaWebSocket();
setupTerminalWebSocket();
attachWebSocketUpgradeRouter(server);

export { app, server, registerEmbeddedPostgresController };

export function startServer(port = PORT): ReturnType<typeof server.listen> {
  const { span: startupSpan, withContext } = startAppSpan('app.startup', 'automation', 'startup', {
    'startup.component': 'web-api',
    'server.port': port,
    'server.host': HOST,
  });
  return withContext(() => {
    // Enable keep-alive for all provider HTTP/HTTPS clients.
    if (process.env['HTTP_KEEP_ALIVE'] !== '0') {
      configureHttpKeepAlive();
    }

  const publicUrl = (process.env['AGENTX_PUBLIC_URL'] ?? `http://localhost:${port}`).replace(/\/$/, '');
  getEngine().integrationHub.setRedirectBaseUrl(publicUrl);

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      getLogger().error('SERVER', `Port ${port} is already in use. Is another Agent-X instance running?`);
    } else {
      getLogger().error('SERVER', `Server error: ${err.message}`);
    }
  });

  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    const log = getLogger();
    log.info('SHUTDOWN', `Received ${signal}. Starting graceful shutdown...`);
    markEngineShuttingDown();
    // Mark this as a clean shutdown so the next startup's fail-closed check
    // trusts a persisted `publicAccess: true` again (see host/apply-host-config.ts).
    writeHostCleanShutdownMarker();

    void drainForShutdown(30_000).finally(() => {
      server.close(() => {
        void (async () => {
          try {
            const eng = getEngine();
            await eng.crewManager.flushPersist();
            await eng.storageAdapter.flushWrites?.();
          } catch (e) {
            log.warn('SHUTDOWN', `Durable flush failed: ${e instanceof Error ? e.message : e}`);
          }
          shutdownWebSocket();
          stopVoiceCallRetentionScheduler();
          void shutdownAutomation();
          void shutdownAgentXOverviewBridge();
          try { void getEngine().serviceContext?.channelService?.stop(); } catch { /* ignore */ }
          log.info('SHUTDOWN', 'Server closed.');
        })();
      });
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  ensureHostAndTelephonyBootstrapped({ bindHost: HOST, bindPort: port });
  startVoiceCallRetentionScheduler();

  return server.listen(port, HOST, async () => {
    // Each bootstrap step is independent so a failure in one (e.g. channels
    // config not ready during deferred first-run setup) doesn't skip the
    // others (e.g. automation service initialization).
    try {
      await awaitEngineStorageReady();
      loadGlobalDevMode(api.getConfigManager().load().developer?.devMode ?? false);
    } catch (e) {
      getLogger().warn('STARTUP', `Engine storage ready failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      await applyChannelsConfig();
    } catch (e) {
      getLogger().warn('STARTUP', `Channels config apply failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      await applyHostConfig(api.getConfigManager().load());
    } catch (e) {
      getLogger().warn('STARTUP', `Host config apply failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      await bootstrapAutomationFromEngine();
    } catch (e) {
      getLogger().warn('STARTUP', `Automation bootstrap failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      initAgentXOverviewBridge();
    } catch (e) {
      getLogger().warn('STARTUP', `Agent-X overview bridge init failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      const kb = await getKnowledgeBaseService();
      if (kb) {
        getLogger().info('STARTUP', 'Knowledge base manager initialized');
      } else {
        getLogger().warn('STARTUP', 'Knowledge base manager unavailable');
      }
    } catch (e) {
      getLogger().warn('STARTUP', `Knowledge base manager init failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    void import('./voice/setup.js').then(({ reconcileVoiceKitState }) =>
      reconcileVoiceKitState().catch((e: unknown) => {
        getLogger().warn(
          'STARTUP',
          `Voice kit reconcile failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }),
    );
    registerInternalUiInvoker();
    getLogger().info('SERVER', `Agent-X web API listening on ${HOST}:${port} (v${VERSION})`);
    startupSpan.end();
  });
  });
}

if (process.env['AGENTX_TEST'] !== 'true') {
  ensureLoginShellPath();
  startServer();
}
