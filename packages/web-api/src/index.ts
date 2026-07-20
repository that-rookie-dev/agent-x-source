import express from 'express';
import type { Express } from 'express';
import { createServer } from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLogger, getDataDir, VERSION } from '@agentx/shared';
import { getEngine, awaitEngineStorageReady } from './engine.js';
import { ensureLoginShellPath, configureHttpKeepAlive } from '@agentx/engine';
import { authMiddleware, createAuthRouter } from './auth.js';
import { errorHandler } from './middleware/error.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { requestLogger } from './middleware/request-logger.js';
import { requestMetrics } from './middleware/request-metrics.js';
import { setDefaultEmbeddingCacheDir } from '@agentx/engine';
import { setupWebSocket, shutdownWebSocket } from './ws.js';
import { setupVoiceWebSocket } from './voice-ws.js';
import { attachWebSocketUpgradeRouter } from './ws-upgrade-router.js';
import { applyChannelsConfig } from './channels-sync.js';
import { registerEmbeddedPostgresController } from './pg-lifecycle-bridge.js';
import { registerAutomationRoutes, bootstrapAutomationFromEngine, shutdownAutomation } from './automation/index.js';
import { registerMarkdownRoutes } from './markdown-api.js';
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
const app: Express = express();
app.use(express.json({ limit: '50mb' }));

// Auth routes (must be before auth middleware)
app.use('/api', createAuthRouter());

// Gmail MCP OAuth callback
app.get('/oauth2callback', (req, res) => { void handleMcpStdioOAuthCallback(req, res); });

// Auth middleware
app.use(authMiddleware);

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

// Structured request logging
app.use(requestLogger);

// HTTP request metrics
app.use(requestMetrics);

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Existing service routers
app.use('/api', neuralCortexRouter());
app.use('/api', localModelRouter);
app.use('/api', modelBenchmarkRouter);
app.use('/api', voiceRouter);
app.use('/api', integrationsRouter);
registerAutomationRoutes(app);
registerMarkdownRoutes(app);

// New route modules
app.use('/', healthRouter({ api }));
app.use('/api/jobs', jobsRouter({ api }));
app.use('/', metricsRouter({ api }));
app.use('/', legacyRouter({ api }));
app.use('/api', knowledgeBaseRouter({ api }));

// Global error handler
app.use(errorHandler);

const server = createServer(app);
setupWebSocket(server);
setupVoiceWebSocket(server);
attachWebSocketUpgradeRouter(server);

export { app, server, registerEmbeddedPostgresController };

export function startServer(port = PORT): ReturnType<typeof server.listen> {
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
        void shutdownAutomation();
        void shutdownAgentXOverviewBridge();
        try { void getEngine().serviceContext?.channelService?.stop(); } catch { /* ignore */ }
        log.info('SHUTDOWN', 'Server closed.');
      })();
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server.listen(port, HOST, async () => {
    // Each bootstrap step is independent so a failure in one (e.g. channels
    // config not ready during deferred first-run setup) doesn't skip the
    // others (e.g. automation service initialization).
    try {
      await awaitEngineStorageReady();
    } catch (e) {
      getLogger().warn('STARTUP', `Engine storage ready failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      await applyChannelsConfig();
    } catch (e) {
      getLogger().warn('STARTUP', `Channels config apply failed: ${e instanceof Error ? e.message : String(e)}`);
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
    getLogger().info('SERVER', `Agent-X web API listening on ${HOST}:${port} (v${VERSION})`);
  });
}

if (process.env['AGENTX_TEST'] !== 'true') {
  ensureLoginShellPath();
  startServer();
}
