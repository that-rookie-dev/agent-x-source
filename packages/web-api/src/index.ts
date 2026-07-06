import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import helmet from 'helmet';
import { createServer } from 'node:http';
import os from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, createReadStream, renameSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateId, VERSION, getDataDir, getConfigDir, getCacheDir, getHomeDir, getDefaultWorkspaceDir, isUserFacingSession, isAutomationSessionId, authManager, getLogger, closeLogger, agentXConfigSchema, voiceConfigSchema, normalizeMessageForUi, buildPublicSystemCapabilities, isNeuralBrainSupported, resolveRuntimeSettings } from '@agentx/shared';
import { getEngine, createAgent, destroyAgent, clearEngine, getOrCreateAgent, ensureChannelAgent, getVitals, getAutonomyStatus, awaitEngineStorageReady, applyRuntimeSettings } from './engine.js';
import { applyChannelsConfig, discoverTelegramBot, getTelegramInboundStatus, getTelegramRuntimeHints, restartTelegramInbound, saveVerifiedTelegram, sendTelegramGreeting } from './channels-sync.js';
import { buildGraphRagSummarizer } from './distillation-generator.js';
import { setupWebSocket, ensureSubscribed, persistMessageDirect, broadcastBrainActivity } from './ws.js';
import { setupVoiceWebSocket, shutdownVoiceWebSocket } from './voice-ws.js';
import { attachWebSocketUpgradeRouter } from './ws-upgrade-router.js';
import { turnRegistry } from './turn-registry.js';
import {
  sessionSettings,
  applySessionModeToAgent,
  buildFullText,
  buildInstructionForMode,
  runAgentTurnAsync,
  isCrewPrivateSessionRecord,
  loadTurnFeedbackForSession,
  recordTurnFeedback,
  loadSessionMessagesPage,
  getForceWebSearchError,
} from './chat-helpers.js';
import { enrichSessionMessagesForUi, mergeNormalizedMessageForApi } from './message-enrich.js';
import { authMiddleware, createAuthRouter } from './auth.js';
import { redactConfigForClient, mergeConfigPreservingSecrets, redactProvidersForClient, REDACTED_SECRET } from './config-redaction.js';
import { setIngestionWorkerRef, refreshIngestionWorkerGenerator } from './ingestion-worker-ref.js';
import {
  bindIngestionWorker,
  setIngestionAppVisible,
  setIngestionNeuralBrainEnabled,
  refreshIngestionRagSourceCount,
  evaluateIngestionWorker,
  getIngestionGovernorState,
} from './ingestion-governor.js';
import { createRateLimiter, startGlobalRateLimitCleanup, stopGlobalRateLimitCleanup } from './rate-limit.js';
import { validate, chatMessageSchema, chatSteerSchema, permissionRespondSchema, permissionRespondBatchSchema, createSessionSchema, createCheckpointSchema, generateTitleSchema, crewSuggestionEvaluateSchema, crewSuggestionResolveSchema, crewChatSessionSchema, turnFeedbackSchema, clarificationRespondSchema, crewRosterPickerOfferSchema, crewRosterPickerUpdateSchema, sessionMessagesQuerySchema } from './validation.js';
import { ProviderFactory, DiscordBridge, DiscordStore, SlackBridge, SlackStore, EmailBridge, Agent, getLogCollector, initLogCollector, healDatabaseStore, applyWebSearchConfigFromAgentConfig, mergeWebSearchToolsConfig, validateWebSearchProvider, isWebSearchAvailableForChat, PostgresStorageAdapter, MemoryFabric, IngestionQueue, IngestionWorker, OnnxEmbeddingProvider, setDeepSearchStageResult, ensureLoginShellPath, getBackgroundTaskPool, setMemoryFabricInstance, setEmbedderInstance, backfillChatMemoryFromSessions } from '@agentx/engine';
import type { ProviderId, AgentXConfig, CompletionRequest, Crew } from '@agentx/shared';
import crypto from 'node:crypto';
import {
  postCrewSuggestionEvaluate,
  postCrewSuggestionResolve,
  postCrewSuggestionClearDismiss,
  getCatalogEntry,
  getCatalogSeedStatusHandler,
  listCatalogCategories,
  listCatalogByCategory,
  searchCatalogEntries,
  emitCrewSuggestionTelemetry,
  blockForCrewSuggestionIfNeeded,
} from './crew-suggestions.js';
import { persistCrewRosterPickerOffer, updateCrewRosterPickerStatus } from './crew-roster-picker-api.js';
import { handleClarificationRespond } from './clarification-resume.js';
import { loadSessionResumeState } from './session-resume-state.js';
import { postCrewChatSession } from './crew-chat.js';
import { postAgentXCoreSession } from './agent-x-core.js';
import { resolveHostCrewDisplay, resolveCrewPrivateHostForSession, syncHostCrewHonorificToSession } from './host-crew-session.js';
import { memoryRouter } from './memory-api.js';
import localModelRouter from './local-model-api.js';
import embeddingModelRouter from './embedding-model-api.js';
import modelBenchmarkRouter from './model-benchmark-api.js';
import voiceRouter from './voice-api.js';
import { integrationsRouter } from './integrations-api.js';
import { registerAutomationRoutes, bootstrapAutomationFromEngine, shutdownAutomation } from './automation/index.js';
import { initAgentXOverviewBridge, shutdownAgentXOverviewBridge } from './agent-x-overview-bridge.js';
import { setDefaultEmbeddingCacheDir } from '@agentx/engine';

const PORT = Number(process.env['AGENTX_PORT'] || process.env['PORT']) || 3333;
const HOST = process.env['AGENTX_HOST'] ?? '127.0.0.1';
const __dirname = dirname(fileURLToPath(import.meta.url));

// Embedding models are downloaded at runtime (during the setup wizard) to the
// user's data directory. The embedding-model-api router sets the cache dir via
// setDefaultEmbeddingCacheDir() on import. This bundled-dir fallback is kept
// for backward compatibility with existing installs that bundled the models.
const BUNDLED_EMBEDDING_MODEL_DIR = join(__dirname, 'models');
if (existsSync(join(BUNDLED_EMBEDDING_MODEL_DIR, 'Xenova', 'all-MiniLM-L6-v2')) ||
    existsSync(join(BUNDLED_EMBEDDING_MODEL_DIR, 'Xenova', 'bge-m3'))) {
  // Only use bundled dir if the runtime-downloaded models aren't present yet.
  const runtimeModelDir = join(getDataDir(), 'models');
  if (!existsSync(join(runtimeModelDir, 'Xenova', 'bge-m3')) &&
      !existsSync(join(runtimeModelDir, 'Xenova', 'all-MiniLM-L6-v2'))) {
    setDefaultEmbeddingCacheDir(BUNDLED_EMBEDDING_MODEL_DIR);
  }
}

const UI_DIST = process.env['AGENTX_UI_DIR'] || join(__dirname, '..', '..', 'web-ui', 'dist');
const NEURON_DIST = process.env['AGENTX_NEURON_DIR'] || join(__dirname, '..', '..', 'web-neuron', 'dist');



const DATA_DIR = getDataDir();
const SESSIONS_DIR = join(DATA_DIR, 'sessions');

function getSessionDir(sessionId: string): string {
  return join(SESSIONS_DIR, sessionId);
}

function ensureSessionDir(sessionId: string): string {
  const dir = getSessionDir(sessionId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    const files = ['context.txt', 'memories.txt', 'pending.txt', 'completed.txt', 'suggestions.txt'];
    for (const f of files) {
      const fp = join(dir, f);
      if (!existsSync(fp)) {
        writeFileSync(fp, '', 'utf-8');
      }
    }
  }
  return dir;
}

const UPLOADS_DIR = join(DATA_DIR, 'uploads');

// Map plan objects to their creating orchestrator without mutating the plan
// Use a WeakMap so entries are eligible for GC when the plan object is no longer referenced
const planOrchestratorMap = new WeakMap<object, unknown>();
// Also keep a Map from plan id -> orchestrator to allow execution by plan id
const planOrchestratorById = new Map<string, unknown>();

// Atomic file write — write to temp file, then rename to prevent partial writes
function atomicWriteFileSync(filePath: string, content: string): void {
  const tmpPath = filePath + '.tmp.' + Date.now();
  writeFileSync(tmpPath, content, 'utf-8');
  renameSync(tmpPath, filePath);
}

const app: Express = express();
app.use(express.json({ limit: '50mb' }));

// Hook the shared logger into the in-memory LogCollector so /api/logs shows everything
initLogCollector();

// ─── Startup Configuration Validation ───
const startupErrors: string[] = [];

// Validate critical data directories
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

// Validate uploads directory
try {
  if (!existsSync(UPLOADS_DIR)) {
    mkdirSync(UPLOADS_DIR, { recursive: true });
  }
} catch (e) {
  startupErrors.push(`Cannot create uploads directory (${UPLOADS_DIR}): ${e instanceof Error ? e.message : String(e)}`);
}

// Validate sessions directory
try {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
} catch (e) {
  startupErrors.push(`Cannot create sessions directory (${SESSIONS_DIR}): ${e instanceof Error ? e.message : String(e)}`);
}

// Validate UI dist directory (non-fatal warning only)
if (!existsSync(UI_DIST)) {
  startupErrors.push(`UI dist directory not found at ${UI_DIST}. The web UI will not be served. Set AGENTX_UI_DIR or build the web-ui package.`);
}
if (!existsSync(NEURON_DIST)) {
  startupErrors.push(`Neuron dist directory not found at ${NEURON_DIST}. The brain visualization will not be served. Set AGENTX_NEURON_DIR or build the web-neuron package.`);
}

// Validate port availability
if (PORT < 1 || PORT > 65535) {
  startupErrors.push(`Invalid port ${PORT}. Must be between 1 and 65535.`);
}

// Validate json body size limit
if (!isNaN(Number(process.env['AGENTX_MAX_BODY_SIZE']))) {
  const customLimit = Number(process.env['AGENTX_MAX_BODY_SIZE']);
  if (customLimit < 1024) {
    startupErrors.push(`AGENTX_MAX_BODY_SIZE (${customLimit}) is too small. Minimum is 1024 bytes.`);
  }
}

// Log all startup errors
if (startupErrors.length > 0) {
  for (const err of startupErrors) {
    if (err.includes('UI dist')) {
      getLogger().warn('STARTUP', err);
    } else {
      getLogger().error('STARTUP', err);
    }
  }
  // Fatal errors prevent startup
  const fatalErrors = startupErrors.filter(e => !e.includes('UI dist'));
  if (fatalErrors.length > 0) {
    console.error('\n\u274c Fatal startup errors:');
    for (const err of fatalErrors) {
      console.error('   -', err);
    }
    console.error('\nAgent-X cannot start. Please fix the above errors and restart.\n');
    process.exit(1);
  }
} else {
  getLogger().info('STARTUP', `All startup checks passed. Port: ${PORT}, Data: ${DATA_DIR}`);
}
// ─── End Startup Validation ───

// ─── Runtime Config Validation ───
// Validate config file against Zod schema when loaded — catches corruption early.
export function validateConfig(config: unknown): { valid: boolean; errors: string[] } {
  const result = agentXConfigSchema.safeParse(config);
  if (!result.success) {
    const errors = result.error.issues.map((i: { path: (string | number)[]; message: string }) => `${i.path.join('.')}: ${i.message}`);
    return { valid: false, errors };
  }
  return { valid: true, errors: [] };
}
// ─── End Config Validation ───

/**
 * Content-based file type detection.
 * Reads the first bytes of a file to determine its actual MIME type,
 * preventing MIME-type spoofing attacks from user-supplied Content-Type headers.
 */
const FILE_MAGIC_BYTES: Record<string, { offset: number; bytes: number[]; mime: string }[]> = {
  'image': [
    { offset: 0, bytes: [0xFF, 0xD8, 0xFF], mime: 'image/jpeg' },
    { offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47], mime: 'image/png' },
    { offset: 0, bytes: [0x47, 0x49, 0x46], mime: 'image/gif' },
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46], mime: 'image/webp' },
    { offset: 0, bytes: [0x42, 0x4D], mime: 'image/bmp' },
  ],
  'document': [
    { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46], mime: 'application/pdf' },
    { offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04], mime: 'application/zip' },
    { offset: 0, bytes: [0x7B, 0x5C, 0x72, 0x74], mime: 'application/rtf' },
  ],
  'text': [
    { offset: 0, bytes: [0xEF, 0xBB, 0xBF], mime: 'text/plain; charset=utf-8-bom' },
  ],
};

function detectFileType(filePath: string): string {
  try {
    const fd = readFileSync(filePath);
    if (fd.length === 0) return 'application/octet-stream';

    // Check all known magic byte signatures
    for (const [, sigs] of Object.entries(FILE_MAGIC_BYTES)) {
      for (const sig of sigs) {
        if (fd.length < sig.offset + sig.bytes.length) continue;
        const matches = sig.bytes.every((b, i) => fd[sig.offset + i] === b);
        if (matches) return sig.mime;
      }
    }

    // Check if it's valid UTF-8 text
    try {
      const text = fd.toString('utf-8');
      // If >90% printable ASCII, treat as text
      const printable = Array.from(text).filter(c => c >= ' ' || c === '\n' || c === '\r' || c === '\t').length;
      if (printable > text.length * 0.9 && text.length > 0) {
        return 'text/plain';
      }
    } catch {
      // Binary
    }

    return 'application/octet-stream';
  } catch {
    return 'application/octet-stream';
  }
}

/**
 * Allowed MIME types for upload. Block executable formats, scripts, etc.
 */
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
  'application/pdf', 'application/zip',
  'text/plain', 'text/csv', 'text/markdown', 'text/html',
  'application/json', 'application/xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
]);

const BLOCKED_MIME_TYPES = new Set([
  'application/x-executable', 'application/x-sharedlib', 'application/x-dosexec',
  'application/x-msdownload', 'application/x-msdos-program',
  'application/java-archive', 'application/x-java-applet',
  'application/x-sh', 'application/x-csh', 'application/x-bash',
  'text/x-script.python', 'text/x-python',
  'application/x-httpd-php',
]);

/**
 * Validate uploaded file: check magic bytes, enforce allow list, block executables.
 */
function validateUploadedFile(filePath: string, originalName: string): { valid: boolean; detectedType: string; error?: string } {
  const detectedType = detectFileType(filePath);

  // Block known dangerous types
  if (BLOCKED_MIME_TYPES.has(detectedType)) {
    return { valid: false, detectedType, error: `File type '${detectedType}' is not allowed (executable/script detected)` };
  }

  // Allow known safe types
  if (ALLOWED_MIME_TYPES.has(detectedType)) {
    return { valid: true, detectedType };
  }

  // For unknown types, allow only if they're clearly binary (not executable)
  if (detectedType === 'application/octet-stream') {
    // Check file extension for additional safety
    const ext = originalName.split('.').pop()?.toLowerCase() ?? '';
    const dangerousExtensions = new Set(['exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'jar', 'class', 'wasm', 'dll', 'so', 'dylib', 'app', 'deb', 'rpm']);
    if (dangerousExtensions.has(ext)) {
      return { valid: false, detectedType, error: `File extension '.${ext}' is not allowed` };
    }
    return { valid: true, detectedType };
  }

  return { valid: true, detectedType };
}

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // Quick extension-based pre-filter for obviously dangerous types
    const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
    const blockedExtensions = new Set(['exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'jar', 'wasm', 'dll', 'so', 'dylib']);
    if (blockedExtensions.has(ext)) {
      cb(new Error(`File extension '.${ext}' is not allowed`));
      return;
    }
    cb(null, true);
  },
});

// Auth routes (must be before auth middleware)
// Mount under /api so endpoints are /api/auth/*, matching web-ui calls
app.use('/api', createAuthRouter());

// Auth middleware — protects all /api/* routes except auth endpoints
app.use(authMiddleware);

// Unified memory fabric API — routes inside the router already have /memory/ prefix
app.use('/api', memoryRouter);

// Local model management API
app.use('/api', localModelRouter);
app.use('/api', embeddingModelRouter);
app.use('/api', modelBenchmarkRouter);
app.use('/api', voiceRouter);
app.use('/api', integrationsRouter);
registerAutomationRoutes(app);

// Security headers (content-type sniffing, XSS, clickjacking protection)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));

// Request ID — attach a unique ID to every request for log correlation
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  (req as any).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});

// CORS — set AGENTX_CORS_ORIGIN for cross-origin clients; same-origin needs no header
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

// ───── Health ─────
app.get('/api/health', (_req, res) => {
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
      const tgPlugin = eng.pluginRegistry.getPlugin('telegram');
      telegramConnected = !!tgPlugin?.enabled && !!tgPlugin?.config?.['botToken'] && !!eng.telegramBridge?.isRunning();
    } catch (e) { /* ignore */ }
    telegramBot = eng.telegramBridge?.isRunning() ? eng.telegramBridge.getStatus().botUsername ?? null : null;
  }
  res.json({
    status: 'ok',
    version: VERSION,
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

// ───── System capabilities ─────
app.get('/api/system/capabilities', (_req, res) => {
  res.json(buildPublicSystemCapabilities(os.totalmem()));
});

app.post('/api/system/app-visibility', (req, res) => {
  const visible = req.body?.visible === true;
  setIngestionAppVisible(visible);
  res.json({ ok: true, ...getIngestionGovernorState() });
});

app.get('/api/system/ingestion-governor', (_req, res) => {
  res.json(getIngestionGovernorState());
});

// ───── Setup / Config ─────
app.get('/api/setup/status', (_req, res) => {
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

app.post('/api/setup/complete', (req, res) => {
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

app.get('/api/config', (_req, res) => {
  const eng = getEngine();
  try {
    res.json(redactConfigForClient(eng.configManager.load()));
  } catch (e) {
    getLogger().error('GET_API_CONFIG', e instanceof Error ? e : String(e));    res.status(400).json({ error: 'Agent-X is not configured. Configure a provider and model first.' });
  }
});

app.get('/api/runtime/status', (_req, res) => {
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

app.put('/api/config', (req, res) => {
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

// ───── Agent Persona ─────
app.get('/api/agent/persona', (_req, res) => {
  const eng = getEngine();
  try {
    const store = (eng.sessionManager as any).store;
    if (store && typeof store.getPersona === 'function') {
      const persona = store.getPersona();
      res.json(persona ?? {});
    } else {
      res.json({});
    }
  } catch (e) {
    res.json({});
  }
});

app.put('/api/agent/persona', async (req, res) => {
  const eng = getEngine();
  try {
    await awaitEngineStorageReady();
    const store = (eng.sessionManager as any).store;
    if (store && typeof store.setPersona === 'function') {
      store.setPersona({
        name: req.body.name ?? 'Agent-X',
        description: req.body.description ?? '',
        communicationStyle: req.body.communicationStyle ?? 'direct',
        decisionMaking: req.body.decisionMaking ?? 'balanced',
        domainContext: req.body.domainContext ?? 'general',
        traits: req.body.traits ?? [],
      });
    }
    // If there's a running agent, update its persona in-memory
    if (eng.agent) {
      const personaData = {
        name: req.body.name ?? 'Agent-X',
        description: req.body.description ?? '',
        communicationStyle: req.body.communicationStyle ?? 'direct',
        decisionMaking: req.body.decisionMaking ?? 'balanced',
        domainContext: req.body.domainContext ?? 'general',
        traits: req.body.traits ?? [],
      };
      (eng.agent as any).persona = personaData;
      // Re-seed identity manager so evolution overlay is in sync
      try { (eng.agent as any).secretSauce?.identity?.seedFromPersona(personaData); } catch (e) {}
      // Force a system prompt rebuild on next turn
      (eng.agent as any).lastContextEpoch = -1;
    }
    res.json({ ok: true });
  } catch (err) {
    getLogger().error('PUT_API_AGENT_PERSONA', err instanceof Error ? err : String(err));
    res.status(500).json({ ok: false, error: 'Failed to save persona.' });
  }
});

// ───── Providers ─────
const AVAILABLE_PROVIDERS = [
  { id: 'openai', name: 'OpenAI', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', name: 'Anthropic', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.anthropic.com' },
  { id: 'google', name: 'Google', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'moonshot', name: 'Moonshot AI', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.moonshot.ai/v1' },
  { id: 'deepseek', name: 'DeepSeek', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.deepseek.com' },
  { id: 'groq', name: 'Groq', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'mistral', name: 'Mistral AI', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.mistral.ai/v1' },
  { id: 'together', name: 'Together AI', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.together.xyz/v1' },
  { id: 'xai', name: 'xAI (Grok)', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.x.ai/v1' },
  { id: 'fireworks', name: 'Fireworks AI', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.fireworks.ai/inference/v1' },
  { id: 'perplexity', name: 'Perplexity', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.perplexity.ai' },
  { id: 'azure', name: 'Azure OpenAI', type: 'cloud', requiresApiKey: true, defaultBaseUrl: '' },
  { id: 'cohere', name: 'Cohere', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.cohere.com/compatibility/v1' },
  { id: 'commandcode', name: 'CommandCode', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.commandcode.ai/provider/v1' },
  { id: 'opencode', name: 'OpenCode Go', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://opencode.ai/zen/go/v1' },
  { id: 'opencode-zen', name: 'OpenCode Zen', type: 'cloud', requiresApiKey: false, defaultBaseUrl: 'https://opencode.ai/zen/v1' },
  { id: 'ollama', name: 'Ollama', type: 'local', requiresApiKey: false, defaultBaseUrl: 'http://localhost:11434' },
  { id: 'lmstudio', name: 'LM Studio', type: 'local', requiresApiKey: false, defaultBaseUrl: 'http://localhost:1234/v1' },
];

/**
 * Validate that a config has at least one usable provider with an API key
 * (or a local provider that doesn't require one) and that activeProvider
 * points to a configured provider. Returns an error message string if
 * invalid, or null if valid.
 */
function validateProviderConfig(cfg: AgentXConfig): string | null {
  if (!cfg.provider) return 'Missing provider configuration';
  const providers = cfg.provider.providers ?? {};
  // Local providers that don't require an API key
  const LOCAL_PROVIDER_IDS = new Set(AVAILABLE_PROVIDERS.filter(p => p.type === 'local' || !p.requiresApiKey).map(p => p.id));
  // Count configured providers (have apiKey or are local/no-key providers)
  const configuredProviders = Object.entries(providers).filter(([id, p]) => {
    if (!p?.configured) return false;
    if (LOCAL_PROVIDER_IDS.has(id as ProviderId)) return true;
    // Has direct apiKey, or has at least one profile with an apiKey
    return !!p.apiKey || (!!p.profiles && Object.values(p.profiles).some(prof => !!prof.apiKey));
  });
  if (configuredProviders.length === 0) {
    return 'Cannot save configuration with no configured providers. At least one provider with a valid API key is required.';
  }
  // Check that activeProvider is configured
  const activeId = cfg.provider.activeProvider;
  if (!activeId || !providers[activeId]?.configured) {
    return `Active provider "${activeId ?? 'none'}" is not configured. Set activeProvider to a configured provider.`;
  }
  // If the active provider has profiles, check it has at least one
  const activeProv = providers[activeId];
  if (activeProv.profiles) {
    const profileCount = Object.keys(activeProv.profiles).length;
    if (profileCount === 0) {
      return `Active provider "${activeId}" has no profiles. Add at least one profile before removing others.`;
    }
  }
  return null;
}

app.get('/api/providers/available', (_req, res) => {
  res.json({ providers: AVAILABLE_PROVIDERS });
});

app.post('/api/provider/validate', async (req, res) => {
  try {
    const { provider, baseUrl } = req.body as { provider: string; apiKey?: string; baseUrl?: string };
    let apiKey = req.body?.apiKey as string | undefined;
    if (!apiKey || apiKey === REDACTED_SECRET) {
      try {
        const eng = getEngine();
        const cfg = eng.configManager.load();
        const creds = cfg.provider.providers[provider as ProviderId];
        if (creds?.activeProfile && creds.profiles?.[creds.activeProfile]) {
          apiKey = creds.profiles[creds.activeProfile]?.apiKey;
        }
        if (!apiKey) apiKey = creds?.apiKey;
      } catch {
        apiKey = undefined;
      }
    }
    const prov = ProviderFactory.create(provider as ProviderId, apiKey, baseUrl);
    const valid = await prov.validate();
    if (valid) {
      res.json({ valid: true, provider: prov.id, name: prov.name });
    } else {
      res.status(400).json({ valid: false, error: 'provider-unreachable' });
    }
  } catch (e: unknown) {
    getLogger().error('POST_API_PROVIDER_VALIDATE', e instanceof Error ? e : String(e));    res.status(400).json({ valid: false, error: e instanceof Error ? e.message : 'unknown-error' });
  }
});

app.get('/api/provider/models', async (req, res) => {
  try {
    if (req.query['apiKey']) {
      return res.status(400).json({ error: 'apiKey query parameter is not allowed — configure keys in Settings' });
    }
    let providerId = (req.query['provider'] as string) || '';
    let apiKey: string | undefined;
    let baseUrl = (req.query['baseUrl'] as string) || undefined;
    if (!apiKey && !baseUrl) {
      try {
        const eng = getEngine();
        const cfg = eng.configManager.load();
        // Resolve profile label → actual provider type (e.g. "OCZ-Personal" → "openai")
        if (!cfg.provider.providers[providerId]) {
          for (const [pid, pcfg] of Object.entries(cfg.provider.providers)) {
            if (pcfg.profiles?.[providerId] || pcfg.activeProfile === providerId) {
              providerId = pid;
              break;
            }
          }
        }
        const creds = cfg.provider.providers[providerId];
        if (creds?.activeProfile && creds.profiles?.[creds.activeProfile]) {
          const active = creds.profiles[creds.activeProfile] as { apiKey?: string; baseUrl?: string } | undefined;
          if (active) {
            apiKey = active.apiKey;
            baseUrl = active.baseUrl;
          }
        }
        // Fallback: use flat apiKey/baseUrl on the provider creds if no profile matched
        if (!apiKey && creds?.apiKey) apiKey = creds.apiKey;
        if (!baseUrl && creds?.baseUrl) baseUrl = creds.baseUrl;
      } catch (e) { /* use provided values */ }
    }
    const prov = ProviderFactory.create(providerId as ProviderId, apiKey, baseUrl);
    const models = await prov.listModels();
    res.json(models);
  } catch (e: unknown) {
    getLogger().error('GET_API_PROVIDER_MODELS', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'failed-to-list-models' });
  }
});

app.post('/api/provider/configure', (req, res) => {
  try {
    const { provider, apiKey, baseUrl, profileName } = req.body as { provider: string; apiKey?: string; baseUrl?: string; profileName?: string };
    if (!profileName || typeof profileName !== 'string' || !profileName.trim()) {
      res.status(400).json({ error: 'profileName is required. Provide a name for your provider profile (e.g. "My OpenAI Key" or "Work Account").' });
      return;
    }
    const profileId = profileName.trim();
    destroyAgent();
    const eng = getEngine();

    let config: AgentXConfig;
    try {
      config = eng.configManager.load();
    } catch (e) {
      config = { provider: { activeProvider: provider as ProviderId, activeModel: '', providers: {} }, ui: { theme: 'dark', showTokenBar: true, showTimers: true, animationSpeed: 'normal' }, organization: null, telemetry: false };
    }

    config.provider.activeProvider = provider as ProviderId;
    const providerCfg = config.provider.providers[provider] ?? { configured: false };
    const availableProv = AVAILABLE_PROVIDERS.find(p => p.id === provider);
    if (apiKey) {
      providerCfg.apiKey = apiKey;
    } else if (availableProv && !availableProv.requiresApiKey) {
      providerCfg.apiKey = '';
    }
    if (baseUrl) providerCfg.baseUrl = baseUrl;
    providerCfg.configured = true;
    config.provider.providers[provider] = providerCfg;

    eng.configManager.save(config);

    // Create a profile for this provider configuration
    eng.configManager.addProviderProfile(provider, profileId, {
      label: profileId,
      apiKey,
      baseUrl,
      createdAt: new Date().toISOString(),
    }, true);
    const cfg = eng.configManager.load();
    cfg.provider.activeProvider = provider as ProviderId;
    eng.configManager.save(cfg);

    res.json({ ok: true, provider, profileId });
  } catch (e: unknown) {
    getLogger().error('POST_API_PROVIDER_CONFIGURE', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'save-failed' });
  }
});

app.get('/api/providers', (_req, res) => {
  const eng = getEngine();
  try {
    const config = eng.configManager.load();
    const configured = redactProvidersForClient(
      config.provider.providers as unknown as Record<string, Record<string, unknown>>,
    ).filter((p) => p['configured']);
    res.json({ active: config.provider.activeProvider, providers: configured });
  } catch (e) {
    res.json({ active: '', providers: [] });
  }
});

app.post('/api/provider/profile', (req, res) => {
  try {
    const { provider, profileId, label, apiKey, baseUrl, setActive } = req.body as {
      provider: string; profileId: string; label?: string; apiKey?: string; baseUrl?: string; setActive?: boolean;
    };
    if (!label || typeof label !== 'string' || !label.trim()) {
      res.status(400).json({ error: 'label is required. Provide a name for your profile (e.g. "My OpenAI Key" or "Work Account").' });
      return;
    }
    const eng = getEngine();
    eng.configManager.addProviderProfile(provider, profileId, {
      label: label.trim(),
      apiKey,
      baseUrl,
      createdAt: new Date().toISOString(),
    }, setActive !== false);
    if (setActive !== false) {
      destroyAgent();
      const cfg = eng.configManager.load();
      cfg.provider.activeProvider = provider as ProviderId;
      eng.configManager.save(cfg);
    }
    res.json({ ok: true, provider, profileId });
  } catch (e: unknown) {
    getLogger().error('POST_API_PROVIDER_PROFILE', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'profile-add-failed' });
  }
});

app.post('/api/provider/profile/switch', (req, res) => {
  try {
    const { providerId, profileId } = req.body as { providerId?: string; profileId: string };
    const eng = getEngine();
    // The provider to switch to is determined by which provider owns this profile
    const cfg = eng.configManager.load();
    let targetProvider = providerId;
    if (!targetProvider) {
      // Find which provider config contains this profile
      for (const [pid, pcfg] of Object.entries(cfg.provider.providers)) {
        if (pcfg.profiles && pcfg.profiles[profileId]) {
          targetProvider = pid;
          break;
        }
      }
    }
    if (!targetProvider) { res.status(400).json({ error: 'Unable to determine provider for profile' }); return; }
    eng.configManager.setActiveProviderProfile(targetProvider, profileId);
    destroyAgent();
    const sess = eng.sessionManager.getActiveSession();
    if (sess) createAgent(undefined, sess);
    res.json({ ok: true, provider: targetProvider, profileId });
  } catch (e: unknown) {
    getLogger().error('POST_API_PROVIDER_PROFILE_SWITCH', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'switch-failed' });
  }
});

// ───── Rename Provider Profile ─────
app.post('/api/provider/profile/rename', (req, res) => {
  try {
    const { provider, profileId, label } = req.body as { provider: string; profileId: string; label: string };
    if (!label) { res.status(400).json({ error: 'label required' }); return; }
    const eng = getEngine();
    eng.configManager.renameProviderProfile(provider, profileId, label);
    res.json({ ok: true });
  } catch (e: unknown) {
    getLogger().error('POST_API_PROVIDER_PROFILE_RENAME', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'rename-failed' });
  }
});

/**
 * DELETE /api/provider/:providerId/profile/:profileId
 * Delete a provider profile with guards:
 * - Cannot delete the last remaining profile across ALL providers
 * - Cannot delete the active profile if it's the only profile for the active provider
 */
app.delete('/api/provider/:providerId/profile/:profileId', (req, res) => {
  try {
    const { providerId, profileId } = req.params;
    const eng = getEngine();
    const cfg = eng.configManager.load();

    // Count total configured profiles across all providers
    const allProviders = cfg.provider.providers ?? {};
    let totalProfiles = 0;
    let providerProfileCount = 0;
    for (const [id, p] of Object.entries(allProviders)) {
      if (p?.profiles) {
        const count = Object.keys(p.profiles).length;
        totalProfiles += count;
        if (id === providerId) providerProfileCount = count;
      } else if (p?.configured && p?.apiKey) {
        // Legacy single-key provider (no profiles) counts as 1
        totalProfiles += 1;
        if (id === providerId) providerProfileCount += 1;
      }
    }

    // Guard 1: Cannot delete if this is the last profile overall
    if (totalProfiles <= 1) {
      res.status(400).json({
        error: 'last-profile',
        message: 'Cannot delete the last remaining provider profile. At least one provider must be configured at all times.',
      });
      return;
    }

    // Guard 2: Cannot delete the last profile for the active provider
    const isActiveProvider = cfg.provider.activeProvider === providerId;
    if (isActiveProvider && providerProfileCount <= 1) {
      res.status(400).json({
        error: 'last-active-profile',
        message: 'Cannot delete the last profile for the active provider. Switch to another provider first or add another profile.',
      });
      return;
    }

    eng.configManager.removeProviderProfile(providerId, profileId);
    // Rebuild ingestion worker generator in case provider config changed
    void refreshIngestionWorkerGenerator();
    res.json({ ok: true });
  } catch (e: unknown) {
    getLogger().error('DELETE_API_PROVIDER_PROFILE', e instanceof Error ? e : String(e));
    res.status(400).json({ error: e instanceof Error ? e.message : 'delete-failed' });
  }
});

// ───── Provider Switch (clears active model) ─────
app.post('/api/provider/switch', (req, res) => {
  try {
    const { provider } = req.body as { provider: string };
    if (!provider) { res.status(400).json({ error: 'provider-required' }); return; }
    const eng = getEngine();
    const config = eng.configManager.load();
    config.provider.activeProvider = provider as ProviderId;
    config.provider.activeModel = ''; // Clear model on provider change
    eng.configManager.save(config);
    destroyAgent();
    res.json({ ok: true, provider, model: '' });
  } catch (e: unknown) {
    getLogger().error('POST_API_PROVIDER_SWITCH', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'switch-failed' });
  }
});

// ───── Models ─────
app.post('/api/model/switch', (req, res) => {
  try {
    const { modelId, providerId, contextWindow, reasoningEffort } = req.body as {
      modelId: string;
      providerId?: string;
      contextWindow?: number;
      reasoningEffort?: string;
    };
    const eng = getEngine();
    const config = eng.configManager.load();

    if (providerId && providerId !== config.provider.activeProvider) {
      config.provider.activeProvider = providerId as ProviderId;
      config.provider.activeModel = modelId;
      if (reasoningEffort) config.provider.activeReasoningEffort = reasoningEffort as import('@agentx/shared').ReasoningEffortLevel;
      eng.configManager.save(config);
      destroyAgent();
      const sess = eng.sessionManager.getActiveSession();
      if (sess) {
        createAgent(undefined, sess);
      }
      ensureSubscribed();
    } else {
      config.provider.activeModel = modelId;
      if (reasoningEffort !== undefined) {
        config.provider.activeReasoningEffort = reasoningEffort
          ? (reasoningEffort as import('@agentx/shared').ReasoningEffortLevel)
          : undefined;
      }
      eng.configManager.save(config);
      if (eng.agent) {
        eng.agent.switchModel(modelId, contextWindow);
      }
    }

    res.json({
      ok: true,
      model: modelId,
      provider: providerId ?? config.provider.activeProvider,
      reasoningEffort: config.provider.activeReasoningEffort,
    });
  } catch (e: unknown) {
    getLogger().error('POST_API_MODEL_SWITCH', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'switch-failed' });
  }
});

app.post('/api/model/trial', async (req, res) => {
  try {
    const { modelId } = req.body as { modelId: string };
    const eng = getEngine();
    const cfg = eng.configManager.load();
    const providerCfg = cfg.provider.providers?.[cfg.provider.activeProvider];
    const provider = ProviderFactory.create(
      cfg.provider.activeProvider,
      providerCfg?.apiKey,
      providerCfg?.baseUrl,
    );
    const request = {
      model: modelId,
      messages: [{ role: 'user' as const, content: 'hi' }],
      maxTokens: 1,
      temperature: 0,
    };
    for await (const _chunk of provider.complete(request)) {
      break;
    }
    res.json({ ok: true, model: modelId });
  } catch (e: unknown) {
    getLogger().error('POST_API_MODEL_TRIAL', e instanceof Error ? e : String(e));    res.status(400).json({ ok: false, error: e instanceof Error ? e.message : 'trial-failed' });
  }
});

app.get('/api/models', async (_req, res) => {
  try {
    const eng = getEngine();
    const config = eng.configManager.load();
    // Try to list models via agent if it exists, but don't fail if no agent
    if (eng.agent) {
      try { await eng.agent.listModels(); } catch (e) { /* ignore */ }
    }
    const activeProfile = config.provider.providers[config.provider.activeProvider]?.activeProfile;
    res.json({ model: config.provider.activeModel, provider: config.provider.activeProvider, providerId: config.provider.activeProvider, activeProfile, currentModel: config.provider.activeModel });
  } catch (e: unknown) {
    getLogger().error('GET_API_MODELS', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'failed' });
  }
});

app.get('/api/cwd', (_req, res) => {
  const eng = getEngine();
  const sess = eng.sessionManager.getActiveSession();
  const scopePath = sess?.scopePath ?? null;
  res.json({ cwd: scopePath });
});

app.get('/api/cwd/default', (_req, res) => {
  res.json({ path: getDefaultWorkspaceDir() });
});

app.post('/api/cwd', (req, res) => {
  try {
    const { path } = req.body as { path: string };
    if (!path || typeof path !== 'string') { res.status(400).json({ error: 'path-required' }); return; }
    const resolved = resolve(path);
    const eng = getEngine();
    const sess = eng.sessionManager.getActiveSession();
    if (sess) {
      eng.sessionManager.updateSession({ scopePath: resolved });
      const ctxPath = join(getSessionDir(sess.id), 'context.json');
      try {
        let ctx: Record<string, unknown> = {};
        if (existsSync(ctxPath)) {
          ctx = JSON.parse(readFileSync(ctxPath, 'utf-8'));
        }
        ctx['scopePath'] = resolved;
        mkdirSync(dirname(ctxPath), { recursive: true });
        writeFileSync(ctxPath, JSON.stringify(ctx, null, 2));
      } catch (e) { /* best-effort */ }
    }
    const agent = (eng as any).agent;
    if (agent && typeof agent.setScopePath === 'function') agent.setScopePath(resolved);
    res.json({ cwd: resolved });
  } catch (e: unknown) {
    getLogger().error('POST_API_CWD', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'scope-update-failed' });
  }
});

// Folder picker: list directories at a path
app.get('/api/filesystem/dirs', (req, res) => {
  try {
    const requestedPath = (req.query['path'] as string) || getHomeDir();
    const absPath = resolve(requestedPath);
    const entries = readdirSync(absPath, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, path: join(absPath, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const parent = dirname(absPath);
    const hasParent = absPath !== parent && absPath !== '/';
    res.json({ current: absPath, parent: hasParent ? parent : null, dirs });
  } catch (e) {
    getLogger().error('GET_API_FILESYSTEM_DIRS', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'dir-read-failed' });
  }
});

// ───── Session Mode & Approval ─────
// Agent: full autonomy with tool execution; Plan: generates plans, no write access
// sessionSettings lives in chat-helpers.ts (synced from per-session DB record)

app.get('/api/session/settings', (_req, res) => {
  res.json(sessionSettings);
});

app.post('/api/session/mode', (req, res) => {
  try {
    const { mode } = req.body as { mode: 'agent' | 'plan' };
    if (!['agent', 'plan'].includes(mode)) { res.status(400).json({ error: 'invalid-mode' }); return; }
    const previousMode = sessionSettings.mode;
    if (previousMode === mode) {
      res.json({ ok: true, mode });
      return;
    }
    const eng = getEngine();
    if (eng.agent?.hyperdriveMode && mode === 'plan') {
      res.status(409).json({ error: 'hyperdrive-active', message: 'Exit Hyperdrive before switching to Plan mode' });
      return;
    }
    sessionSettings.mode = mode;
    if (eng.agent) {
      eng.agent.setPlanMode(mode === 'plan');
    }
    // Sync mode to toolkit executor for Plan mode tool restriction
    try {
      (eng as any).toolkit?.executor?.setMode?.(mode);
    } catch (e) { /* best-effort */ }
    // Persist mode to session store so it survives restores
    try {
      const sess = eng.sessionManager.getActiveSession();
      if (sess) {
        eng.sessionManager.updateSession({ mode } as any);
      }
    } catch (e) { /* best-effort */ }
    res.json({ ok: true, mode });
  } catch (e: unknown) {
    getLogger().error('SESSION_MODE', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'mode-failed' });
  }
});

app.post('/api/clarification/respond', validate(clarificationRespondSchema), async (req, res) => {
  try {
    const { response, sessionId } = req.body as { response: string; sessionId?: string };
    const result = await handleClarificationRespond(response, sessionId);
    if (!result.ok) {
      res.status(result.status ?? 500).json({ error: result.error ?? 'clarification-respond-failed' });
      return;
    }
    res.json({ ok: true, resumed: result.resumed ?? false });
  } catch (e) {
    getLogger().error('CLARIFICATION_RESPOND', e instanceof Error ? e : String(e));
    res.status(500).json({ error: 'clarification-respond-failed' });
  }
});

app.post('/api/agent/mode-escalation', (req, res) => {
  try {
    const { accepted } = req.body as { accepted: boolean };
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
    (agent as unknown as { respondToModeEscalation: (a: boolean) => void }).respondToModeEscalation(!!accepted);
    res.json({ ok: true, accepted: !!accepted });
  } catch (e) {
    getLogger().error('MODE_ESCALATION', e instanceof Error ? e : String(e));
    res.status(500).json({ error: 'mode-escalation-failed' });
  }
});

app.post('/api/agent/step-cap/respond', (req, res) => {
  try {
    const { continueRun } = req.body as { continueRun: boolean };
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
    (agent as unknown as { respondToStepCap: (c: boolean) => void }).respondToStepCap(!!continueRun);
    res.json({ ok: true, continueRun: !!continueRun });
  } catch (e) {
    getLogger().error('STEP_CAP', e instanceof Error ? e : String(e));
    res.status(500).json({ error: 'step-cap-failed' });
  }
});

app.get('/api/agent/turn-state', (_req, res) => {
  try {
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) { res.json({ phase: 'idle' }); return; }
    const snap = (agent as unknown as { getTurnStateSnapshot?: () => unknown }).getTurnStateSnapshot?.();
    res.json(snap ?? { phase: 'idle' });
  } catch (e) {
    res.status(500).json({ error: 'turn-state-failed' });
  }
});

app.get('/api/chat/turn/:turnId', (req, res) => {
  const record = turnRegistry.get(req.params.turnId);
  if (!record) { res.status(404).json({ error: 'turn-not-found' }); return; }
  res.json(record);
});

// ───── Agent State Sync (for Web-UI reconnect) ─────
app.get('/api/agent/state', (_req, res) => {
  const eng = getEngine();
  const agent = eng.agent;
  if (!agent) {
    res.json({ active: false, session: null, crew: null, model: null, processing: false });
    return;
  }
  const session = eng.sessionManager.getActiveSession();
  const crewStates = eng.sessionManager.getCrewStates();
  res.json({
    active: true,
    session: session ? { id: session.id, title: session.title, status: session.status, scopePath: session.scopePath } : null,
    crew: { crewStates },
    model: { provider: session?.providerId, model: session?.modelId },
    processing: (agent as unknown as { isProcessing?: boolean }).isProcessing ?? false,
    planMode: (agent as unknown as { planMode?: boolean }).planMode ?? false,
    sessionSettings,
  });
});

// ───── Agent Vitals (Age, Level, Wisdom, Mood, etc.) ─────
app.get('/api/agent/vitals', async (_req, res) => {
  try {
    const vitals = await getVitals();
    res.json(vitals);
  } catch (e) {
    getLogger().error('GET_API_AGENT_VITALS', e instanceof Error ? e : String(e));
    res.status(500).json({ status: 'uninitialized', error: e instanceof Error ? e.message : 'vitals-error' });
  }
});

app.get('/api/agent/autonomy-status', (_req, res) => {
  try {
    const status = getAutonomyStatus();
    res.json(status);
  } catch (e) {
    getLogger().error('GET_API_AUTONOMY_STATUS', e instanceof Error ? e : String(e));
    res.status(500).json({ available: false, error: e instanceof Error ? e.message : 'autonomy-error' });
  }
});

app.post('/api/agent/circuit-breaker/reset', (req, res) => {
  try {
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) { res.status(400).json({ error: 'No active agent' }); return; }
    const executor = agent.getToolExecutor();
    const toolName = req.body?.tool;
    if (toolName && executor && typeof (executor as any).resetCircuitBreaker === 'function') {
      (executor as any).resetCircuitBreaker(toolName);
      res.json({ ok: true, tool: toolName });
    } else if (!toolName && executor && typeof (executor as any).resetAllCircuitBreakers === 'function') {
      (executor as any).resetAllCircuitBreakers();
      res.json({ ok: true, all: true });
    } else {
      res.status(400).json({ error: 'Missing tool name or executor unavailable' });
    }
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'reset-failed' });
  }
});

app.get('/api/sessions/analytics', (_req, res) => {
  try {
    const eng = getEngine();
    const sessions = eng.sessionManager.listSessions(100);
    const total = sessions.length;
    const active = sessions.filter((s: any) => s.status === 'active').length;
    const tokens = sessions.reduce((sum: number, s: any) => sum + (s.tokenUsed || 0), 0);
    const byProvider: Record<string, number> = {};
    for (const s of sessions) {
      const p = (s as any).providerId || 'unknown';
      byProvider[p] = (byProvider[p] || 0) + 1;
    }
    res.json({
      total, active, totalTokens: tokens,
      avgTokens: total > 0 ? Math.round(tokens / total) : 0,
      byProvider,
      recent: sessions.slice(0, 5).map((s: any) => ({
        id: s.id, title: s.title, tokenUsed: s.tokenUsed, createdAt: s.createdAt,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'analytics-failed' });
  }
});

// ───── Crews ─────
app.get('/api/crews', (_req, res) => {
  const eng = getEngine();
  const crews = eng.crewManager.list().map((c) => ({ ...c, tone: c.emotion }));
  res.json({ crews });
});



app.post('/api/crew/toggle', (req, res) => {
  try {
    const { crewId, enabled } = req.body as { crewId: string; enabled: boolean };
    const eng = getEngine();
    
    // Update crew in CrewManager
    if (enabled) {
      eng.crewManager.enable(crewId);
    } else {
      eng.crewManager.disable(crewId);
    }
    
    // Update agent
    if (eng.agent) {
      eng.agent.setCrewEnabled(crewId, enabled);
    }
    
    // Save to session store
    if (eng.sessionManager) {
      eng.sessionManager.saveCrewState(crewId, enabled);
    }
    
    res.json({ ok: true, crewId, enabled });
  } catch (e: unknown) {
    getLogger().error('POST_API_CREW_TOGGLE', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'toggle-failed' });
  }
});

app.post('/api/crews', (req, res) => {
  try {
    const body = req.body as {
      id: string; name: string; title?: string; callsign?: string; systemPrompt: string; description?: string;
      emotion?: string; tone?: string; isDefault?: boolean; expertise?: string[]; traits?: string[]; tools?: string[];
      color?: string; icon?: string; source?: string; catalogId?: string;
    };
    const emotion = body.emotion ?? body.tone;
    const { id, name, title, callsign, systemPrompt, description, isDefault, expertise, traits, tools, color, icon, source, catalogId } = body;
    const eng = getEngine();
    const crew = eng.crewManager.create({
      id: id || crypto.randomUUID(),
      name,
      title,
      callsign: callsign || name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
      systemPrompt,
      description,
      emotion: emotion as 'professional' | 'friendly' | 'witty' | 'kind' | 'funny' | 'arrogant' | 'flirty' | 'happy' | 'sad' | 'sarcastic' | undefined,
      isDefault,
      expertise,
      traits,
      tools,
      color,
      icon,
      source: (source as 'custom' | 'hub' | undefined) ?? (catalogId ? 'hub' : 'custom'),
      catalogId,
    });
    if (eng.agent && crew.enabled) {
      eng.agent.addCrewMember(crew);
      eng.agent.setCrewEnabled(crew.id, true);
    }
    res.json(crew);
  } catch (e: unknown) {
    getLogger().error('POST_API_CREWS', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'create-failed' });
  }
});

app.put('/api/crews/:id', (req, res) => {
  try {
    const eng = getEngine();
    const body = req.body as Record<string, unknown>;
    const updates = {
      ...body,
      emotion: (body['emotion'] ?? body['tone']) as string | undefined,
    };
    delete (updates as Record<string, unknown>)['tone'];
    const crew = eng.crewManager.update(req.params['id']!, updates as Parameters<typeof eng.crewManager.update>[1]);
    if (!crew) { res.status(404).json({ error: 'crew-not-found' }); return; }
    if (eng.agent) {
      eng.agent.removeCrewMember(crew.id);
      if (crew.enabled) {
        eng.agent.addCrewMember(crew);
        eng.agent.setCrewEnabled(crew.id, true);
      } else {
        eng.agent.setCrewEnabled(crew.id, false);
      }
    }
    res.json(crew);
  } catch (e: unknown) {
    getLogger().error('PUT_API_CREWS_ID', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'update-failed' });
  }
});

app.delete('/api/crews/:id', (req, res) => {
  try {
    const eng = getEngine();
    const ok = eng.crewManager.delete(req.params['id']!);
    if (!ok) { res.status(400).json({ error: 'cannot-delete' }); return; }
    if (eng.agent) {
      eng.agent.removeCrewMember(req.params['id']!);
      eng.agent.setCrewEnabled(req.params['id']!, false);
    }
    res.json({ ok: true });
  } catch (e: unknown) {
    getLogger().error('DELETE_API_CREWS_ID', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'delete-failed' });
  }
});

// ───── Crew suggestions (catalog match + deploy) ─────
app.post('/api/crew-suggestions/evaluate', validate(crewSuggestionEvaluateSchema), postCrewSuggestionEvaluate);
app.post('/api/crew-suggestions/resolve', validate(crewSuggestionResolveSchema), postCrewSuggestionResolve);
app.post('/api/crew-suggestions/clear-dismiss', postCrewSuggestionClearDismiss);

app.post('/api/sessions/:id/crew-roster-picker', validate(crewRosterPickerOfferSchema), (req, res) => {
  try {
    const sessionId = req.params['id']!;
    const { userText, evaluation, attachments, userMessageId } = req.body as {
      userText: string;
      evaluation: import('@agentx/shared').CrewSuggestionEvaluation;
      attachments?: Array<{ name: string }>;
      userMessageId?: string;
    };
    const eng = getEngine();
    if (!eng.sessionManager.getSessionById(sessionId)) {
      res.status(404).json({ error: 'not-found' });
      return;
    }
    const ids = persistCrewRosterPickerOffer({ sessionId, userText, evaluation, attachments, userMessageId });
    res.json({ ok: true, ...ids });
  } catch (e: unknown) {
    getLogger().error('CREW_ROSTER_PICKER_OFFER', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'offer-failed' });
  }
});

app.patch('/api/sessions/:id/crew-roster-picker', validate(crewRosterPickerUpdateSchema), (req, res) => {
  try {
    const sessionId = req.params['id']!;
    const body = req.body as {
      pickerMessageId: string;
      status: 'answered' | 'skipped';
      selectedCandidateIds?: string[];
      evaluation: import('@agentx/shared').CrewSuggestionEvaluation;
      pendingUserText: string;
      pickerPartId?: string;
    };
    updateCrewRosterPickerStatus({
      sessionId,
      pickerMessageId: body.pickerMessageId,
      status: body.status,
      selectedCandidateIds: body.selectedCandidateIds,
      evaluation: body.evaluation,
      pendingUserText: body.pendingUserText,
      pickerPartId: body.pickerPartId,
    });
    res.json({ ok: true });
  } catch (e: unknown) {
    getLogger().error('CREW_ROSTER_PICKER_UPDATE', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'update-failed' });
  }
});

// ───── Crew private session bootstrap (chat uses /api/sessions + /api/chat) ─────
const crewChatRateLimiter = createRateLimiter({ prefix: 'CREW_CHAT', label: 'CrewChat' });
app.use('/api/crew-chat', crewChatRateLimiter.middleware);
app.post('/api/crew-chat/sessions', validate(crewChatSessionSchema), postCrewChatSession);
app.post('/api/agent-x-core/session', postAgentXCoreSession);

app.get('/api/crew-catalog/categories', listCatalogCategories);
app.get('/api/crew-catalog/seed-status', getCatalogSeedStatusHandler);
app.get('/api/crew-catalog/search', searchCatalogEntries);
app.get('/api/crew-catalog/by-category/:categoryId', listCatalogByCategory);
app.get('/api/crew-catalog/:id', getCatalogEntry);

app.get('/api/crew/:id', (_req, res) => {
  const eng = getEngine();
  const crew = eng.crewManager.list().find(c => c.id === _req.params.id);
  if (!crew) return res.status(404).json({ error: 'Crew not found' });
  res.json(crew);
});

app.post('/api/crew/:id/feedback', (req, res) => {
  try {
    const eng = getEngine();
    const crewId = req.params['id']!;
    const { positive, comment } = req.body as { positive: boolean; comment?: string };
    if (typeof positive !== 'boolean') { res.status(400).json({ error: 'positive must be a boolean' }); return; }
    const store = (eng.sessionManager as unknown as { store?: {
      addCrewFeedback?: (f: Record<string, unknown>) => void;
    } }).store;
    const sessionId = (eng.agent as unknown as { sessionId?: string })?.sessionId ?? 'unknown';
    if (store?.addCrewFeedback) {
      store.addCrewFeedback({
        id: crypto.randomUUID(),
        sessionId,
        crewId,
        positive,
        comment: comment ?? null,
        createdAt: new Date().toISOString(),
      });
      const agentInst = eng.agent as Agent & { recordCrewFeedback?: (crewId: string, positive: boolean) => void } | null;
      agentInst?.recordCrewFeedback?.(crewId, positive);
      res.json({ ok: true });
    } else {
      res.status(500).json({ error: 'store-unavailable' });
    }
  } catch (e: unknown) {
    getLogger().error('POST_API_CREW_ID_FEEDBACK', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'feedback-failed' });
  }
});

app.get('/api/crew/:id/feedback', (req, res) => {
  try {
    const eng = getEngine();
    const crewId = req.params['id']!;
    const store = (eng.sessionManager as unknown as { store?: {
      getCrewFeedback?: (id: string) => Array<Record<string, unknown>>;
    } }).store;
    const feedback = store?.getCrewFeedback?.(crewId) ?? [];
    res.json({ feedback });
  } catch (e: unknown) {
    getLogger().error('GET_API_CREW_ID_FEEDBACK', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'feedback-load-failed' });
  }
});

app.post('/api/crew/generate-metadata', async (req, res) => {
  try {
    const { systemPrompt, title, name, description } = req.body as { systemPrompt?: string; title?: string; name?: string; description?: string };

    const eng = getEngine();
    const cfg = eng.configManager.load();
    const providerId = cfg.provider.activeProvider;
    if (!providerId) { res.json({ expertise: [], traits: [], revisedPrompt: '' }); return; }
    const providerCfg = cfg.provider.providers[providerId];
    const apiKey = providerCfg?.apiKey || providerCfg?.profiles?.[providerCfg?.activeProfile ?? '']?.apiKey;

    if (!apiKey) { res.json({ expertise: [], traits: [], revisedPrompt: '' }); return; }

    const { ProviderFactory } = await import('@agentx/engine');
    const provider = ProviderFactory.create(providerId as any, apiKey, providerCfg?.baseUrl);

    const genPrompt = systemPrompt
      ? `Analyze this AI crew member's role and improve it.${title ? `\nRole/Title: ${title}` : ''}
System prompt to improve:
"""
${systemPrompt}
"""
Return ONLY this exact JSON format (no markdown, no explanation):
{"revisedPrompt":"improved concise system prompt","expertise":["skill1","skill2","skill3","skill4","skill5"],"traits":["trait1","trait2","trait3"]}`
      : `Create an AI crew member profile from this info:
Name: ${name || 'Assistant'}
Title: ${title || 'General Assistant'}
Description: ${description || 'A helpful AI crew member'}
Return ONLY this exact JSON format (no markdown, no explanation):
{"revisedPrompt":"a detailed 2-3 paragraph system prompt defining personality, behavior, domain expertise, communication style, and working methods","expertise":["skill1","skill2","skill3","skill4","skill5"],"traits":["trait1","trait2","trait3"]}`;

    const chunks: string[] = [];
    const modelId = cfg.provider.activeModel || 'gpt-4o-mini';
    for await (const chunk of provider.complete({
      messages: [{ role: 'user', content: genPrompt }],
      model: modelId,
      stream: true,
      maxTokens: 2000,
      temperature: 0.3,
    })) {
      if (chunk.type === 'text_delta' && chunk.content) chunks.push(chunk.content);
    }

    const text = chunks.join('');
    let jsonText = text.match(/\{[\s\S]*\}/)?.[0] || '';
    // Strip markdown code fences if present
    jsonText = jsonText.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '');
    jsonText = (jsonText.match(/\{[\s\S]*\}/) || [''])[0] || '';
    if (!jsonText) { res.json({ expertise: [], traits: [], revisedPrompt: '' }); return; }

    const parsed = JSON.parse(jsonText);
    res.json({
      revisedPrompt: typeof parsed.revisedPrompt === 'string' ? parsed.revisedPrompt : '',
      expertise: Array.isArray(parsed.expertise) ? parsed.expertise.slice(0, 8) : [],
      traits: Array.isArray(parsed.traits) ? parsed.traits.slice(0, 8) : [],
    });
  } catch (e: unknown) {
    res.json({ expertise: [], traits: [], revisedPrompt: '' });
  }
});

// ───── Chat ─────
const chatRateLimiter = createRateLimiter({ prefix: 'CHAT', label: 'Chat' });
app.use('/api/chat', chatRateLimiter.middleware);

// NEW: Streaming SSE endpoint for real-time progress visualization
app.post('/api/chat/message-stream', validate(chatMessageSchema), async (req, res) => {
  try {
    const { text, attachments, retry, delegateCrewIds, crewSuggestionResolved, priorUserMessages, crewIntakeFromPicker, primaryCrewId, forceWebSearch } = req.body as {
      text: string;
      attachments?: { name: string; content: string }[];
      retry?: boolean;
      delegateCrewIds?: string[];
      crewSuggestionResolved?: boolean;
      priorUserMessages?: string[];
      crewIntakeFromPicker?: boolean;
      primaryCrewId?: string;
      forceWebSearch?: boolean;
    };
    const eng = getEngine();
    
    // Auto-create agent if none exists
    if (!eng.agent) {
      getOrCreateAgent();
    }
    const agent = eng.agent;
    if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
    ensureSubscribed();

    // ─── Safety: reset stuck agent ───
    if (agent.processing) {
      try { agent.cancel(); } catch (e) { /* ignore */ }
      await new Promise(r => setTimeout(r, 250));
      if (agent.processing) {
        res.status(503).json({ error: 'Agent is busy. Please try again in a moment.' });
        return;
      }
    }

    // Setup SSE response headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let eventId = 0;
    const sendEvent = (event: string, data: unknown) => {
      try {
        res.write(`id: ${eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        eventId++;
      } catch (e) { /* connection closed */ }
    };

    // Send initial "connected" event
    sendEvent('connected', { timestamp: new Date().toISOString() });

    // Apply session mode from active session record
    const mode = applySessionModeToAgent(agent);

    // ─── Retry: remove only the assistant reply being regenerated (keep user turn in DB) ───
    if (retry) {
      try {
        const store = (eng.sessionManager as any).store;
        if (store?.deleteLastMessages) {
          const sid = (agent as unknown as { sessionId: string }).sessionId;
          if (sid) store.deleteLastMessages(sid, 1, ['assistant']);
        }
      } catch (e) { /* best-effort */ }
    }

    const fullText = buildFullText(text, attachments);
    const activeSess = eng.sessionManager.getActiveSession?.();
    const crewPrivateChat = isCrewPrivateSessionRecord(activeSess);
    const instruction = buildInstructionForMode(mode, { crewPrivate: crewPrivateChat });

    // Auto-checkpoint
    try {
      const store = (eng.sessionManager as any).store;
      if (store?.createCheckpoint) {
        const sid = (agent as unknown as { sessionId: string }).sessionId;
        if (sid) {
          const label = `Auto · ${new Date().toLocaleTimeString()}`;
          store.createCheckpoint(sid, label);
        }
      }
    } catch (e) { /* best-effort */ }

    const unsub = eng.telemetry.onEvent((ev) => {
      sendEvent('progress', ev);
    });

    const heartbeat = setInterval(() => {
      try {
        res.write(':heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
        unsub();
      }
    }, 25000);

    const sid = (agent as unknown as { sessionId: string }).sessionId;

    const crewGate = sid
      ? await blockForCrewSuggestionIfNeeded({
          text: fullText,
          sessionId: sid,
          priorUserMessages,
          crewPrivateChat,
          delegateCrewIds,
          crewSuggestionResolved,
        })
      : { block: false as const };

    if (crewGate.block) {
      emitCrewSuggestionTelemetry(eng, crewGate.evaluation, crewGate.message);
      sendEvent('crew_suggestion', { evaluation: crewGate.evaluation, message: crewGate.message });
      sendEvent('crew_suggestion_required', { evaluation: crewGate.evaluation, message: crewGate.message });
      clearInterval(heartbeat);
      unsub();
      res.end();
      return;
    }

    const forceErr = getForceWebSearchError(eng.configManager.load(), forceWebSearch);
    if (forceErr) {
      sendEvent('error', { error: forceErr, code: 'WEB_SEARCH_UNAVAILABLE' });
      clearInterval(heartbeat);
      unsub();
      res.end();
      return;
    }

    const turn = turnRegistry.create(sid);
    let finished = false;

    const finishTurn = (record: ReturnType<typeof turnRegistry.get>) => {
      if (finished || !record) return;
      if (record.status === 'complete') {
        finished = true;
        if ((record.message as Record<string, unknown> | undefined)?.id === '__clarify__') {
          sendEvent('clarification', { ok: true });
        } else {
          sendEvent('complete', { ok: true, message: record.message, turnId: turn.turnId });
        }
        clearInterval(heartbeat);
        unsubTurn();
        unsub();
        res.end();
      } else if (record.status === 'error' || record.status === 'cancelled') {
        finished = true;
        sendEvent('error', { error: record.error ?? 'chat-failed', code: 'PROCESSING_FAILED', partialContent: record.partialContent });
        clearInterval(heartbeat);
        unsubTurn();
        unsub();
        res.end();
      }
    };

    const unsubTurn = turnRegistry.subscribe(turn.turnId, finishTurn);

    req.on('close', () => {
      finished = true;
      unsubTurn();
      clearInterval(heartbeat);
      unsub();
      try { agent.cancel(); } catch { /* ignore */ }
    });

    runAgentTurnAsync(agent, fullText, instruction, retry, turn.turnId, sid, undefined, undefined, delegateCrewIds, crewSuggestionResolved, crewIntakeFromPicker, primaryCrewId, forceWebSearch ? { forceWebSearch: true } : undefined);
    sendEvent('started', { turnId: turn.turnId, async: true });
    return;
  } catch (e: unknown) {
    getLogger().error('CHAT_MESSAGE_STREAM_SETUP', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'stream-setup-failed' });
  }
});

// LEGACY comment removed — async turn endpoint used by ChatPanel (SSE uses message-stream).
app.post('/api/chat/message', validate(chatMessageSchema), async (req, res) => {
  try {
    const { text, attachments, retry, delegateCrewIds, crewSuggestionResolved, priorUserMessages, crewIntakeFromPicker, primaryCrewId, forceWebSearch } = req.body as {
      text: string;
      attachments?: { name: string; content: string }[];
      retry?: boolean;
      delegateCrewIds?: string[];
      crewSuggestionResolved?: boolean;
      priorUserMessages?: string[];
      crewIntakeFromPicker?: boolean;
      primaryCrewId?: string;
      forceWebSearch?: boolean;
    };
    const eng = getEngine();
    // Auto-create agent if none exists (first message in session)
    if (!eng.agent) {
      getOrCreateAgent();
    }
    const agent = eng.agent;
    if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
    ensureSubscribed();

    // ─── Safety: reset stuck agent if processing flag leaked from previous call ───
    if (agent.processing) {
      try { agent.cancel(); } catch (e) { /* ignore */ }
      await new Promise(r => setTimeout(r, 250));
      if (agent.processing) {
        res.status(503).json({ error: 'Agent is busy. Please try again in a moment.' });
        return;
      }
    }

    const mode = applySessionModeToAgent(agent);

    // ─── Retry: remove only the assistant reply being regenerated (keep user turn in DB) ───
    if (retry) {
      try {
        const store = (eng.sessionManager as any).store;
        if (store?.deleteLastMessages) {
          const sid = (agent as unknown as { sessionId: string }).sessionId;
          if (sid) store.deleteLastMessages(sid, 1, ['assistant']);
        }
      } catch (e) { /* best-effort */ }
    }

    const fullText = buildFullText(text, attachments);
    const activeSess = eng.sessionManager.getActiveSession?.();
    const crewPrivateChat = isCrewPrivateSessionRecord(activeSess);
    const instruction = buildInstructionForMode(mode, { crewPrivate: crewPrivateChat });

    // Auto-checkpoint before each user turn — enables /undo to roll back this turn
    try {
      const store = (eng.sessionManager as any).store;
      if (store?.createCheckpoint) {
        const sid = (agent as unknown as { sessionId: string }).sessionId;
        if (sid) {
          const label = `Auto · ${new Date().toLocaleTimeString()}`;
          store.createCheckpoint(sid, label);
        }
      }
    } catch (e) { /* checkpoint failure shouldn't block the message */ }

    const sid = (agent as unknown as { sessionId: string }).sessionId;

    const crewGate = sid
      ? await blockForCrewSuggestionIfNeeded({
          text: fullText,
          sessionId: sid,
          priorUserMessages,
          crewPrivateChat,
          delegateCrewIds,
          crewSuggestionResolved,
        })
      : { block: false as const };

    if (crewGate.block) {
      emitCrewSuggestionTelemetry(eng, crewGate.evaluation, crewGate.message);
      res.status(200).json({
        ok: false,
        crewSuggestionRequired: true,
        evaluation: crewGate.evaluation,
        message: crewGate.message,
      });
      return;
    }

    const forceErr = getForceWebSearchError(eng.configManager.load(), forceWebSearch);
    if (forceErr) {
      res.status(400).json({ error: forceErr });
      return;
    }

    const turn = turnRegistry.create(sid);
    runAgentTurnAsync(agent, fullText, instruction, retry, turn.turnId, sid, undefined, undefined, delegateCrewIds, crewSuggestionResolved, crewIntakeFromPicker, primaryCrewId, forceWebSearch ? { forceWebSearch: true } : undefined);

    res.status(202).json({ ok: true, turnId: turn.turnId, async: true, status: 'running' });
  } catch (e: unknown) {
    getLogger().error('CHAT_MESSAGE', e instanceof Error ? e : String(e));
    try {
      const eng = getEngine();
      const agent = eng.agent;
      if (agent) {
        const sid = (agent as unknown as { sessionId: string }).sessionId;
        if (sid) {
          persistMessageDirect(sid, 'user', (req.body as any).text || '');
        }
      }
    } catch (e) { /* best-effort */ }
    res.status(500).json({ error: e instanceof Error ? e.message : 'chat-failed' });
  }
});

app.post('/api/chat/cancel', (_req, res) => {
  try {
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
    agent.cancel();
    res.json({ ok: true });
  } catch (e) {
    getLogger().error('POST_API_CHAT_CANCEL', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'cancel-failed' });
  }
});

// ───── Message Queue & Steer ─────
// Queue: messages waiting to be sent after current task completes
// Helper: wait for agent to finish processing (max 3s) after a cancel
async function waitForIdle(agent: { processing: boolean }, maxWait = 3000): Promise<void> {
  const start = Date.now();
  while (agent.processing && (Date.now() - start) < maxWait) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

const messageQueue: Array<{
  text: string;
  attachments?: { name: string; content: string }[];
  delegateCrewIds?: string[];
  crewSuggestionResolved?: boolean;
  crewIntakeFromPicker?: boolean;
  primaryCrewId?: string;
}> = [];

app.post('/api/chat/queue', validate(chatMessageSchema), (req, res) => {
  try {
    const { text, attachments, delegateCrewIds, crewSuggestionResolved, crewIntakeFromPicker, primaryCrewId } = req.body as {
      text: string;
      attachments?: { name: string; content: string }[];
      delegateCrewIds?: string[];
      crewSuggestionResolved?: boolean;
      crewIntakeFromPicker?: boolean;
      primaryCrewId?: string;
    };
    messageQueue.push({ text, attachments, delegateCrewIds, crewSuggestionResolved, crewIntakeFromPicker, primaryCrewId });
    res.json({ ok: true, queueLength: messageQueue.length });
  } catch (e) {
    getLogger().error('POST_API_CHAT_QUEUE', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'queue-failed' });
  }
});

app.get('/api/chat/queue', (_req, res) => {
  res.json({ queue: messageQueue, length: messageQueue.length });
});

app.delete('/api/chat/queue', (_req, res) => {
  messageQueue.length = 0;
  res.json({ ok: true });
});

// Steer: cancel current task, then immediately send a new message
app.post('/api/chat/steer', validate(chatSteerSchema), async (req, res) => {
  try {
    const { text, attachments, delegateCrewIds, crewSuggestionResolved, crewIntakeFromPicker, primaryCrewId } = req.body as {
      text: string;
      attachments?: { name: string; content: string }[];
      delegateCrewIds?: string[];
      crewSuggestionResolved?: boolean;
      crewIntakeFromPicker?: boolean;
      primaryCrewId?: string;
    };
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
    agent.cancel();
    await waitForIdle(agent);
    ensureSubscribed();
    const mode = applySessionModeToAgent(agent);
    const fullText = buildFullText(text, attachments);
    const activeSess = eng.sessionManager.getActiveSession?.();
    const crewPrivateChat = isCrewPrivateSessionRecord(activeSess);
    const instruction = buildInstructionForMode(mode, { crewPrivate: crewPrivateChat });
    const sid = (agent as unknown as { sessionId: string }).sessionId;
    const turn = turnRegistry.create(sid);
    runAgentTurnAsync(agent, fullText, instruction, false, turn.turnId, sid, undefined, undefined, delegateCrewIds, crewSuggestionResolved, crewIntakeFromPicker, primaryCrewId);
    res.status(202).json({ ok: true, turnId: turn.turnId, async: true, status: 'running' });
  } catch (e: unknown) {
    getLogger().error('POST_API_CHAT_STEER', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'steer-failed' });
  }
});

// Stop and Send: cancel current task, then send a new message fresh
app.post('/api/chat/checkpoint-respond', async (req, res) => {
  try {
    const { checkpointId, action } = req.body as { checkpointId: string; action: string };
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
    const resolved = agent.resolveCheckpoint(checkpointId, action);
    if (!resolved) {
      res.status(404).json({ error: 'checkpoint-not-found' });
      return;
    }
    res.json({ ok: true });
  } catch (e: unknown) {
    getLogger().error('CHECKPOINT_RESPOND', e instanceof Error ? e : String(e));
    res.status(500).json({ error: 'checkpoint-respond-failed' });
  }
});

app.post('/api/chat/stop-and-send', validate(chatSteerSchema), async (req, res) => {
  try {
    const { text, attachments, delegateCrewIds, crewSuggestionResolved, crewIntakeFromPicker, primaryCrewId } = req.body as {
      text: string;
      attachments?: { name: string; content: string }[];
      delegateCrewIds?: string[];
      crewSuggestionResolved?: boolean;
      crewIntakeFromPicker?: boolean;
      primaryCrewId?: string;
    };
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
    agent.cancel();
    await waitForIdle(agent);
    ensureSubscribed();
    const mode = applySessionModeToAgent(agent);
    const fullText = buildFullText(text, attachments);
    const activeSess = eng.sessionManager.getActiveSession?.();
    const crewPrivateChat = isCrewPrivateSessionRecord(activeSess);
    const instruction = crewPrivateChat
      ? buildInstructionForMode(mode, { crewPrivate: true })
      : (mode === 'plan'
        ? 'Generate a detailed plan for this request. Do NOT execute the plan yet — only outline the steps.'
        : buildInstructionForMode(mode));
    const sid = (agent as unknown as { sessionId: string }).sessionId;
    const turn = turnRegistry.create(sid);
    runAgentTurnAsync(agent, fullText, instruction, false, turn.turnId, sid, undefined, undefined, delegateCrewIds, crewSuggestionResolved, crewIntakeFromPicker, primaryCrewId);
    res.status(202).json({ ok: true, turnId: turn.turnId, async: true, status: 'running' });
  } catch (e: unknown) {
    getLogger().error('POST_API_CHAT_STOP_AND_SEND', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'stop-and-send-failed' });
  }
});

app.get('/api/chat/history', (_req, res) => {
  try {
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) { res.json([]); return; }
    const history = agent.getMessageHistory();
    // Ensure each message has an id for the UI (CompletionMessage doesn't guarantee id)
    const formatted = history.map((m, i) => ({
      id: (m as unknown as Record<string, unknown>).id || `hist-${i}`,
      role: m.role,
      content: m.content || '',
      tokenCount: Math.ceil((m.content?.length ?? 0) / 4),
    }));
    res.json(formatted);
  } catch (e) {
    res.json([]);
  }
});

app.post('/api/chat/clear', (_req, res) => {
  try {
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
    agent.clearHistory();
    res.json({ ok: true });
  } catch (e) {
    getLogger().error('POST_API_CHAT_CLEAR', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'clear-failed' });
  }
});

// ───── SSE Chat Stream ─────
app.get('/api/chat/stream', (req, res) => {
  const eng = getEngine();
  let eventId = 0;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Tell the client to retry connection after 3 seconds on drop
  res.write('retry: 3000\n\n');

  const sendEvent = (event: string, data: unknown) => {
    try {
      res.write(`id: ${eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      eventId++;
    } catch (e) { /* connection closed */ }
  };

  sendEvent('connected', { timestamp: new Date().toISOString() });

  // Subscribe to telemetry bus ONLY — agent events are already bridged to telemetry
  // in createAgent(). Subscribing to both would cause duplicate events.
  const unsub = eng.telemetry.onEvent((ev) => {
    sendEvent('telemetry', ev);
  });

  // Heartbeat to detect dead connections (every 25s)
  const heartbeat = setInterval(() => {
    sendEvent('ping', { ts: Date.now() });
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsub();
    res.end();
  });
});

// ───── Prometheus Metrics ─────
app.get('/api/metrics', (_req, res) => {
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
app.get('/api/logs', (req, res) => {
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

app.get('/api/logs/stream', (req, res) => {
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

app.delete('/api/logs', (_req, res) => {
  try {
    getLogCollector().clear();
    res.json({ ok: true });
  } catch (e: unknown) {
    getLogger().error('DELETE_API_LOGS', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'clear-failed' });
  }
});

// ───── Permissions ─────
app.post('/api/permission/respond', validate(permissionRespondSchema), (req, res) => {
  try {
    const { requestId, choice } = req.body as { requestId: string; choice: 'allow_once' | 'allow_always' | 'deny' };
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
    agent.respondToPermission(requestId, choice);
    res.json({ ok: true });
  } catch (e: unknown) {
    getLogger().error('POST_API_PERMISSION_RESPOND', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'respond-failed' });
  }
});

app.post('/api/permission/respond-batch', validate(permissionRespondBatchSchema), (req, res) => {
  try {
    const { choice } = req.body as { choice: 'allow_once' | 'allow_always' | 'deny' };
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
    agent.respondToPermissionBatch(choice);
    res.json({ ok: true });
  } catch (e: unknown) {
    getLogger().error('POST_API_PERMISSION_RESPOND_BATCH', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'respond-batch-failed' });
  }
});

// ───── Hyperdrive Mode ─────
let _preHyperdriveMode: 'agent' | 'plan' = 'plan';

app.post('/api/mode/hyperdrive', (_req, res) => {
  try {
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
    const activeSess = eng.sessionManager.getActiveSession?.();
    if (isCrewPrivateSessionRecord(activeSess)) {
      res.status(409).json({
        error: 'crew-private-no-hyperdrive',
        message: 'Hyperdrive is not available in crew private chats.',
      });
      return;
    }
    const enabled = agent.toggleHyperdriveMode();
    if (enabled) {
      _preHyperdriveMode = sessionSettings.mode;
      sessionSettings.mode = 'agent';
    } else {
      sessionSettings.mode = _preHyperdriveMode;
    }
    // Persist hyperdrive state to DB (mode unchanged — hyperdrive is an overlay)
    try {
      const sess = eng.sessionManager.getActiveSession();
      if (sess) {
        eng.sessionManager.updateSession({ hyperdrive: enabled } as any);
      }
    } catch (e) { /* best-effort */ }
    res.json({ ok: true, hyperdriveMode: enabled, mode: sessionSettings.mode });
  } catch (e: unknown) {
    getLogger().error('HYPERDRIVE_TOGGLE', e instanceof Error ? e : String(e));
    res.status(400).json({ error: e instanceof Error ? e.message : 'toggle-failed' });
  }
});

app.get('/api/mode/hyperdrive', (_req, res) => {
  try {
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) { res.json({ hyperdriveMode: false, mode: sessionSettings.mode }); return; }
    res.json({ hyperdriveMode: agent.hyperdriveMode, mode: sessionSettings.mode });
  } catch (e) {
    res.json({ hyperdriveMode: false, mode: sessionSettings.mode });
  }
});

// ───── Sessions ─────
app.get('/api/sessions/db-status', async (_req, res) => {
  try {
    const eng = getEngine();
    const store = (eng.sessionManager as unknown as { store: { getInfo?: () => { dbMode: string; sessionCount: number; filesystemRecovered: number; schemaVersion: number } } }).store;
    const info = store?.getInfo?.() ?? { dbMode: 'postgres', sessionCount: 0, filesystemRecovered: 0, schemaVersion: 0 };
    res.json({ ...info, dbMode: 'postgres' });
  } catch (e) {
    res.json({ dbMode: 'postgres', sessionCount: 0, filesystemRecovered: 0, schemaVersion: 0 });
  }
});

// ───── Settings DB ─────
function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let s = bytes;
  while (s >= 1024 && i < units.length - 1) { s /= 1024; i++; }
  return `${s.toFixed(1)} ${units[i]}`;
}

let dbStatusCache: { at: number; data: Record<string, unknown> } | null = null;
const DB_STATUS_CACHE_MS = 60_000;

async function buildDbStatus(eng: ReturnType<typeof getEngine>): Promise<Record<string, unknown>> {
  const now = Date.now();
  if (dbStatusCache && now - dbStatusCache.at < DB_STATUS_CACHE_MS) {
    return dbStatusCache.data;
  }
  const store = (eng.sessionManager as any)?.store;
  const pgConnected = !!(store && typeof store.isConnected === 'function' && store.isConnected());
  let dbSizeBytes = 0;
  let tableCount = 0;
  const tables: Record<string, number> = {};
  let healthStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  const checks: Array<{ table: string; rows: number; ok: boolean }> = [];
  let connectionString = '';

  try {
    const pgPool: any = (store as any).pool ?? eng.pgPool;
    if (pgPool && typeof pgPool.query === 'function') {
      const tabRows = await pgPool.query(
        "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename"
      );
      tableCount = tabRows.rows.length;
      for (const r of tabRows.rows) {
        try {
          const cnt = await pgPool.query(`SELECT COUNT(*)::int as cnt FROM "${r.tablename}"`);
          tables[r.tablename] = cnt.rows[0].cnt;
          checks.push({ table: r.tablename, rows: cnt.rows[0].cnt, ok: true });
        } catch (e) {
          tables[r.tablename] = -1;
          checks.push({ table: r.tablename, rows: -1, ok: false });
          healthStatus = 'degraded';
        }
      }
      try {
        const sizeRes = await pgPool.query("SELECT pg_database_size(current_database()) as size");
        dbSizeBytes = sizeRes.rows[0].size;
      } catch (e) { /* db size not available */ }
      if (tableCount > 0) healthStatus = 'healthy';
      try {
        const connRes = await pgPool.query('SELECT current_database() as db, inet_server_addr() as host');
        connectionString = `postgresql://${connRes.rows[0]?.['host'] ?? 'localhost'}/${connRes.rows[0]?.['db'] ?? 'agentx'}`;
      } catch { /* */ }
    }
  } catch (e) {
    healthStatus = 'unhealthy';
  }

  const dataDir = getDataDir();
  const configDir = getConfigDir();
  const cacheDir = getCacheDir();

  function dirInfo(dir: string): { path: string; sizeBytes: number; sizeFormatted: string } {
    let sizeBytes = 0;
    try {
      if (existsSync(dir)) {
        for (const f of readdirSync(dir, { withFileTypes: true })) {
          const fp = join(dir, f.name);
          try { if (f.isFile()) sizeBytes += statSync(fp).size; } catch (e) { /* skip */ }
        }
      }
    } catch (e) { /* skip */ }
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let s = sizeBytes;
    while (s >= 1024 && i < units.length - 1) { s /= 1024; i++; }
    return { path: dir, sizeBytes, sizeFormatted: `${s.toFixed(1)} ${units[i]}` };
  }

  const result = {
    backend: 'postgres',
    connected: pgConnected,
    stats: {
      dbSizeBytes,
      dbSizeFormatted: dbSizeBytes > 0 ? formatSize(dbSizeBytes) : `${tableCount} tables`,
      tableCount,
      tables,
    },
    health: { status: healthStatus, checks },
    fileStorage: {
      config: dirInfo(configDir),
      data: dirInfo(dataDir),
      cache: dirInfo(cacheDir),
    },
    postgres: {
      configured: true,
      connectionString,
    },
  };
  dbStatusCache = { at: Date.now(), data: result };
  return result;
}

app.get('/api/settings/db', async (_req, res) => {
  try {
    const eng = getEngine();
    res.json(await buildDbStatus(eng));
  } catch (e: unknown) {
    getLogger().error('GET_API_SETTINGS_DB', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'settings-db-failed' });
  }
});

app.get('/api/settings/web-search/status', async (_req, res) => {
  try {
    const eng = getEngine();
    const cfg = eng.configManager.load();
    applyWebSearchConfigFromAgentConfig(cfg);
    const status = isWebSearchAvailableForChat(cfg);
    res.json(status);
  } catch (e: unknown) {
    getLogger().error('GET_API_SETTINGS_WEB_SEARCH_STATUS', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'web-search-status-failed' });
  }
});

app.post('/api/settings/web-search/test', async (req, res) => {
  try {
    const provider = req.body?.provider as string;
    if (provider !== 'brave' && provider !== 'exa' && provider !== 'tavily') {
      res.status(400).json({ ok: false, error: 'provider must be brave, exa, or tavily' });
      return;
    }
    let apiKey = String(req.body?.apiKey ?? '').trim();
    if (!apiKey || apiKey === REDACTED_SECRET) {
      try {
        const cfg = getEngine().configManager.load();
        apiKey = cfg.tools?.webSearch?.[provider]?.apiKey?.trim() ?? '';
      } catch {
        apiKey = '';
      }
    }
    if (!apiKey) {
      res.status(400).json({ ok: false, error: 'No API key configured for this search provider' });
      return;
    }
    const result = await validateWebSearchProvider(provider, apiKey);
    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : 'web-search-test-failed',
    });
  }
});

app.put('/api/settings/db', async (req, res) => {
  try {
    const { backend, postgres } = req.body || {};
    getLogger().info('SETTINGS_DB_UPDATE', `PostgreSQL connection update requested (backend=${backend ?? 'postgres'})`);

    let connectionString = postgres?.connectionString as string | undefined;

    if (backend === 'embedded-postgres') {
      // The desktop main process starts the bundled native PostgreSQL and sets this env var.
      connectionString = process.env['AGENTX_POSTGRES_CONNECTION_STRING'];
      if (!connectionString) {
        res.status(400).json({ ok: false, error: 'Embedded PostgreSQL is not running. Start the Agent-X desktop app to use the bundled database.' });
        return;
      }
    }

    if (connectionString) {
      const { PostgresStorageAdapter } = await import('@agentx/engine');
      const test = await PostgresStorageAdapter.testConnection(connectionString);
      if (!test.ok) {
        res.status(400).json({ ok: false, error: test.error ?? 'PostgreSQL connection failed' });
        return;
      }

      const eng = getEngine();
      const { getBuiltinPlugin } = await import('@agentx/engine');

      if (!eng.pluginRegistry.isInstalled('postgresql')) {
        const entry = getBuiltinPlugin('postgresql');
        if (entry) eng.pluginRegistry.install(entry);
      }
      if (!eng.pluginRegistry.isEnabled('postgresql')) {
        eng.pluginRegistry.enable('postgresql');
      }
      eng.pluginRegistry.updateConfig('postgresql', {
        connectionString,
        autoMigrate: true,
        poolSize: 5,
      });

      clearEngine();
    }

    res.json({ ok: true, backend: 'postgres' });
  } catch (e: unknown) {
    getLogger().error('PUT_API_SETTINGS_DB', e instanceof Error ? e : String(e));
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'settings-db-update-failed' });
  }
});

app.post('/api/settings/db/test', async (req, res) => {
  try {
    const { connectionString } = req.body || {};
    if (!connectionString) {
      res.json({ ok: false, error: 'No connection string provided' });
      return;
    }
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString, max: 1 });
    const client = await pool.connect();
    const result = await client.query('SELECT version() as version');
    const pgVersion = result.rows[0]?.['version'] as string;
    let ageAvailable = false;
    let ageError: string | undefined;
    let extensionsCreated = false;
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      try { await client.query('CREATE EXTENSION IF NOT EXISTS age'); } catch (ageErr) {
        ageError = ageErr instanceof Error ? ageErr.message : 'AGE not available';
      }
      extensionsCreated = true;
      const { rows } = await client.query(`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'age') AS available`);
      ageAvailable = rows[0]?.available === true;
    } catch (extErr) {
      ageError = extErr instanceof Error ? extErr.message : 'Failed to install extensions';
    }
    client.release();
    await pool.end();
    getLogger().info('SETTINGS_DB_TEST', `PostgreSQL connection successful: ${pgVersion}`);
    res.json({ ok: true, version: pgVersion || 'connected', ageAvailable, ageError, extensionsCreated });
  } catch (e: unknown) {
    getLogger().error('POST_API_SETTINGS_DB_TEST', e instanceof Error ? e : String(e));
    res.status(400).json({ ok: false, error: e instanceof Error ? e.message : 'connection-failed' });
  }
});

app.post('/api/settings/db/migrate', async (_req, res) => {
  try {
    const eng = getEngine();
    const store = (eng.sessionManager as any)?.store as PostgresStorageAdapter | undefined;
    if (!store || typeof store.connect !== 'function') {
      res.status(500).json({ ok: false, error: 'PostgreSQL storage not initialized' });
      return;
    }
    const started = Date.now();
    await store.connect();
    const durationMs = Date.now() - started;
    res.json({ ok: true, migrated: {}, durationMs });
  } catch (e: unknown) {
    getLogger().error('POST_API_SETTINGS_DB_MIGRATE', e instanceof Error ? e : String(e));
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'settings-db-migrate-failed' });
  }
});

app.get('/api/settings/db/health', async (_req, res) => {
  try {
    const eng = getEngine();
    const store = (eng.sessionManager as unknown as { store?: unknown }).store;
    if (store) {
      try {
        await healDatabaseStore(store);
      } catch (healErr) {
        getLogger().warn('DB_HEALTH_HEAL', healErr instanceof Error ? healErr.message : String(healErr));
      }
    }
    const status = await buildDbStatus(eng);
    res.json(status.health);
  } catch (e: unknown) {
    getLogger().error('GET_API_SETTINGS_DB_HEALTH', e instanceof Error ? e : String(e));
    res.status(500).json({ status: 'unhealthy', checks: [] });
  }
});

app.post('/api/settings/db/clear', async (_req, res) => {
  try {
    const eng = getEngine();
    const store = (eng.sessionManager as any)?.store as PostgresStorageAdapter | undefined;
    if (store && typeof store.clearAll === 'function') {
      await store.clearAll();
    }
    getLogger().info('SETTINGS_DB_CLEAR', 'All session data cleared');
    res.json({ ok: true });
  } catch (e: unknown) {
    getLogger().error('POST_API_SETTINGS_DB_CLEAR', e instanceof Error ? e : String(e));
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'settings-db-clear-failed' });
  }
});

app.post('/api/settings/db/clear-cache', (_req, res) => {
  try {
    const cacheDir = getCacheDir();
    let freed = 0;
    if (existsSync(cacheDir)) {
      for (const f of readdirSync(cacheDir)) {
        const fp = join(cacheDir, f);
        try {
          const s = statSync(fp);
          if (s.isFile()) { freed += s.size; rmSync(fp); }
        } catch (e) { /* skip */ }
      }
    }
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let v = freed;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    const freedFormatted = `${v.toFixed(1)} ${units[i]}`;
    getLogger().info('SETTINGS_DB_CLEAR_CACHE', `Cache cleared: ${freedFormatted}`);
    res.json({ ok: true, freedFormatted });
  } catch (e: unknown) {
    getLogger().error('POST_API_SETTINGS_DB_CLEAR_CACHE', e instanceof Error ? e : String(e));
    res.status(500).json({ ok: false, freedFormatted: '0 B', error: e instanceof Error ? e.message : 'settings-db-clear-cache-failed' });
  }
});

app.get('/api/sessions', (_req, res) => {
  try {
    const eng = getEngine();
    const listFn = (eng.sessionManager as { listRootSessions?: (n: number) => unknown[] }).listRootSessions;
    const all = (listFn ? listFn.call(eng.sessionManager, 100) : eng.sessionManager.listSessions(100)) as unknown as Array<Record<string, unknown>>;
    const sessions = all.filter((s) => isUserFacingSession({
      id: String(s['id'] ?? ''),
      parentId: (s['parentId'] as string | null | undefined) ?? null,
      contextKind: (s['contextKind'] as string | undefined) ?? 'agent_x',
    }));
    const store = (eng.sessionManager as unknown as { store?: { getSessionListKpis?: (id: string, base?: Record<string, unknown>) => Record<string, unknown>; getMessageCount?: (id: string) => number } }).store;
    const getKpis = (eng.sessionManager as unknown as { getSessionListKpis?: (id: string, base?: Record<string, unknown>) => Record<string, unknown> }).getSessionListKpis;
    const crewManager = eng.crewManager as { get?: (id: string) => { callsign?: string; name?: string } | undefined };

    const enriched = sessions.map((s) => {
      const id = s['id'] as string;
      let kpis: Record<string, unknown> = {};
      try {
        if (getKpis) {
          kpis = getKpis.call(eng.sessionManager, id, s);
        } else if (store?.getSessionListKpis) {
          kpis = store.getSessionListKpis(id, s);
        } else if (store?.getMessageCount) {
          kpis = { messageCount: store.getMessageCount(id) };
        }
      } catch { kpis = { messageCount: 0 }; }

      const rawCallsigns = (kpis['crewCallsigns'] as string[] | undefined) ?? [];
      const crewCallsigns = rawCallsigns.map((crewId) => {
        const crew = crewManager?.get?.(crewId);
        return crew?.callsign ?? crew?.name ?? crewId;
      });

      const tokensUsed = Number(kpis['tokensUsed'] ?? s['tokensUsed'] ?? s['tokenUsed'] ?? 0);
      const tokenAvailable = Number(kpis['tokenAvailable'] ?? s['tokenAvailable'] ?? s['token_available'] ?? 128_000);
      const contextKind = (s['contextKind'] as string | undefined) ?? 'agent_x';
      const hostCrewId = (s['hostCrewId'] as string | null | undefined) ?? null;
      const hostCrew = hostCrewId ? crewManager?.get?.(hostCrewId) : undefined;
      const hostDisplay = contextKind === 'crew_private'
        ? resolveHostCrewDisplay(s, hostCrew as Crew | undefined)
        : null;

      const rawTitle = s['title'];
      const displayTitle = contextKind === 'crew_private' && hostDisplay?.hostCrewName && (
        !rawTitle
        || rawTitle === s['hostCrewName']
        || rawTitle === (hostCrew as Crew | undefined)?.name
      ) ? hostDisplay.hostCrewName : rawTitle;

      return {
        id: s['id'],
        title: displayTitle,
        status: s['status'],
        provider: s['provider'] ?? s['providerId'],
        model: s['model'] ?? s['modelId'],
        mode: s['mode'] ?? 'plan',
        scopePath: s['scopePath'],
        hyperdrive: !!s['hyperdrive'],
        parentId: s['parentId'] ?? null,
        createdAt: s['createdAt'] ?? s['created_at'],
        updatedAt: s['updatedAt'] ?? s['updated_at'],
        tokensUsed,
        tokenAvailable,
        tokenUsagePct: kpis['tokenUsagePct'] ?? (tokenAvailable > 0 ? Math.min(100, Math.round((tokensUsed / tokenAvailable) * 100)) : 0),
        messageCount: kpis['messageCount'] ?? 0,
        childSessionCount: kpis['childSessionCount'] ?? 0,
        crewCount: crewCallsigns.length,
        crewCallsigns,
        totalCostUsd: kpis['totalCostUsd'] ?? 0,
        compactionCount: kpis['compactionCount'] ?? 0,
        contextKind,
        hostCrewId,
        hostCrewName: hostDisplay?.hostCrewName ?? null,
        hostCrewCallsign: hostDisplay?.hostCrewCallsign ?? null,
        hostCrewTitle: hostDisplay?.hostCrewTitle ?? null,
        hostCrewColor: hostDisplay?.hostCrewColor ?? null,
        hostCrewCatalogId: hostDisplay?.hostCrewCatalogId ?? null,
        hostCrewCategoryId: hostDisplay?.hostCrewCategoryId ?? null,
        crewId: hostCrewId,
      };
    });

    enriched.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
    res.json(enriched);
  } catch (e: unknown) {
    getLogger().error('GET_API_SESSIONS', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'failed-to-list-sessions' });
  }
});

app.get('/api/sessions/:id/children', (req, res) => {
  try {
    const eng = getEngine();
    const parentId = req.params['id']!;
    const mgr = eng.sessionManager as unknown as { getChildSessions?: (id: string) => Array<Record<string, unknown>> };
    const children = mgr.getChildSessions?.(parentId) ?? [];
    res.json({ children });
  } catch (e: unknown) {
    getLogger().error('GET_API_SESSION_CHILDREN', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'failed-to-list-children' });
  }
});

app.get('/api/sessions/:id/preview', (req, res) => {
  try {
    const sessionId = req.params['id']!;
    const eng = getEngine();
    const store = (eng.sessionManager as unknown as { store?: { getMessages?: (id: string) => unknown[]; getParts?: (id: string) => unknown[] } }).store;
    if (!store?.getMessages) {
      res.status(404).json({ error: 'not-found' });
      return;
    }
    const rawMessages = store.getMessages(sessionId) as Array<Record<string, unknown>>;
    const messages = rawMessages
      .filter((m) => m['role'] !== 'part' && m['role'] !== 'system')
      .map((msg) => {
        const normalized = normalizeMessageForUi(msg, []);
        return {
          id: msg['id'],
          role: msg['role'],
          content: normalized.content,
          parts: normalized.parts,
          createdAt: msg['created_at'] ?? msg['createdAt'],
        };
      });
    const session = eng.sessionManager.listSessions(9999).find((s) => s.id === sessionId);
    res.json({
      session: session ?? { id: sessionId, title: 'Background work', parentId: null },
      messages,
      parts: [],
    });
  } catch (e: unknown) {
    getLogger().error('GET_API_SESSION_PREVIEW', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'preview-failed' });
  }
});

app.post('/api/sessions/:id/generate-title', validate(generateTitleSchema), async (req, res) => {
  try {
    const sessionId = req.params['id']!;
    const eng = getEngine();
    const cfg = eng.configManager.load();
    const providerId = cfg.provider.activeProvider;
    if (!providerId) { res.json({ title: '' }); return; }
    const providerCfg = cfg.provider.providers[providerId];
    const apiKey = providerCfg?.apiKey || providerCfg?.profiles?.[providerCfg?.activeProfile ?? '']?.apiKey;
    if (!apiKey) { res.json({ title: '' }); return; }

    const store = (eng.sessionManager as any).store;
    if (!store?.getMessages) { res.json({ title: '' }); return; }
    const messages = store.getMessages(sessionId) as Array<{ role: string; content: string }>;
    const firstUser = messages.find((m) => m.role === 'user');
    if (!firstUser) { res.json({ title: '' }); return; }

    const { ProviderFactory } = await import('@agentx/engine');
    const provider = ProviderFactory.create(providerId as any, apiKey, providerCfg?.baseUrl);
    const modelId = cfg.provider.activeModel || 'gpt-4o-mini';

    const titlePrompt = `Generate a brief, natural title for this conversation based on the user's first message. Rules:
- ≤60 characters
- Grammatically correct, no word salad
- Focus on the main topic or question
- Use the same language as the user
- No tool names, no "analyzing" or "generating" prefixes
- Output ONLY the title, nothing else

User message: "${firstUser.content.slice(0, 500)}"`;

    const chunks: string[] = [];
    for await (const chunk of provider.complete({
      messages: [{ role: 'user', content: titlePrompt }],
      model: modelId,
      stream: true,
      maxTokens: 50,
      temperature: 0.5,
    })) {
      if (chunk.type === 'text_delta' && chunk.content) chunks.push(chunk.content);
    }
    const title = chunks.join('').trim().replace(/^["']|["']$/g, '').slice(0, 60);

    if (title) {
      eng.sessionManager.updateSession({ title } as any);
    }
    res.json({ title });
  } catch {
    res.json({ title: '' });
  }
});

// Cross-session full-text search. Queries the messages table via PostgreSQL.
app.get('/api/sessions/search', (req, res) => {
  try {
    const q = String(req.query['q'] ?? '').trim();
    if (!q) { res.json({ results: [] }); return; }
    const needle = q.toLowerCase();
    const eng = getEngine();
    const listFn = (eng.sessionManager as { listRootSessions?: (n: number) => unknown[] }).listRootSessions;
    const sessions = listFn
      ? listFn.call(eng.sessionManager, 200)
      : eng.sessionManager.listSessions(200).filter((s: { parentId?: string | null }) => !s.parentId);
    const store = (eng.sessionManager as any).store;
    const results: Array<{ sessionId: string; title?: string; createdAt?: string; snippet: string; matchCount: number }> = [];
    for (const s of sessions) {
      const sid = (s as unknown as { id?: string; sessionId?: string }).id ?? (s as unknown as { sessionId?: string }).sessionId;
      if (!sid || !isUserFacingSession({
        id: sid,
        parentId: (s as { parentId?: string | null }).parentId ?? null,
        contextKind: (s as { contextKind?: string }).contextKind ?? 'agent_x',
      })) continue;

      let messages: Array<{ role?: string; content?: string }> = [];
      try {
        if (store?.getMessages) {
          messages = store.getMessages(sid) as Array<{ role?: string; content?: string }>;
        }
      } catch (e) { continue; }

      let matchCount = 0;
      let snippet = '';
      for (const m of messages) {
        const c = String(m.content ?? '');
        const lc = c.toLowerCase();
        if (lc.includes(needle)) {
          matchCount++;
          if (!snippet) {
            const idx = lc.indexOf(needle);
            const start = Math.max(0, idx - 40);
            const end = Math.min(c.length, idx + needle.length + 80);
            snippet = (start > 0 ? '…' : '') + c.slice(start, end) + (end < c.length ? '…' : '');
          }
        }
      }
      if (matchCount > 0) {
        results.push({
          sessionId: sid,
          title: (s as unknown as { title?: string; name?: string }).title ?? (s as unknown as { name?: string }).name,
          createdAt: (s as unknown as { createdAt?: string }).createdAt,
          snippet,
          matchCount,
        });
      }
    }
    results.sort((a, b) => b.matchCount - a.matchCount);
    res.json({ results: results.slice(0, 50) });
  } catch (e: unknown) {
    getLogger().error('GET_API_SESSIONS_SEARCH', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'search-failed' });
  }
});

// Force-reload config from disk — used when TUI changes config while web-api is running
app.post('/api/config/reload', (_req, res) => {
  const eng = getEngine();
  try {
    eng.configManager.reload();
    const config = eng.configManager.load();
    res.json({ ok: true, setupComplete: config.setupComplete });
  } catch (err) {
    getLogger().error('POST_API_CONFIG_RELOAD', err instanceof Error ? err : String(err));    res.status(500).json({
      ok: false,
      error: `Failed to reload config: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

// Export full session trajectory (conversation + context files + checkpoint list)
app.get('/api/sessions/:id/export', (req, res) => {
  try {
    const sid = req.params['id']!;
    const eng = getEngine();
    const dir = getSessionDir(sid);
    if (!existsSync(dir)) { res.status(404).json({ error: 'not-found' }); return; }
    let messages: unknown[] = [];
    try {
      const store = (eng.sessionManager as any).store;
      if (store?.getMessages) {
        messages = store.getMessages(sid) as unknown[];
      }
    } catch (e) { /* empty */ }
    const ctxFiles = ['context.txt', 'memories.txt', 'pending.txt', 'completed.txt', 'suggestions.txt'];
    const contextFiles: Record<string, string> = {};
    for (const f of ctxFiles) {
      try { contextFiles[f.replace('.txt', '')] = readFileSync(join(dir, f), 'utf-8'); } catch (e) { /* skip */ }
    }
    const checkpoints: Array<{ id: string; label?: string; createdAt?: string; messageCount?: number }> = [];
    try {
      const store = (eng.sessionManager as any).store;
      if (store?.listCheckpoints) {
        checkpoints.push(...(store.listCheckpoints(sid) as Array<{ id: string; label: string; createdAt: string; messageCount: number }>));
      }
    } catch (e) { /* skip */ }
    const exportData = {
      sessionId: sid,
      exportedAt: new Date().toISOString(),
      version: '1.0',
      messageCount: messages.length,
      messages,
      contextFiles,
      checkpoints,
    };
    res.setHeader('Content-Disposition', `attachment; filename="agentx-session-${sid.slice(0, 8)}-${Date.now()}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(exportData, null, 2));
  } catch (e: unknown) {
    getLogger().error('GET_API_SESSIONS_ID_EXPORT', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'export-failed' });
  }
});

app.post('/api/sessions', validate(createSessionSchema), (req, res) => {
  try {
    const body = req.body as { scopePath?: string } | undefined;
    if (!body?.scopePath) {
      res.status(400).json({ error: 'scopePath is required to create a session' });
      return;
    }
    destroyAgent();
    const eng = getEngine();
    const cfg = eng.configManager.load();
    const session = eng.sessionManager.createSession(
      cfg.provider.activeProvider as any,
      cfg.provider.activeModel,
      resolve(body.scopePath),
    );
    // Ensure new sessions start in Plan mode
    sessionSettings.mode = 'plan';
    createAgent(undefined, session);
    ensureSubscribed();
    // Broadcast session creation to the neural frontend.
    broadcastBrainActivity({
      type: 'session_created',
      sessionId: session.id,
      title: session.title || `Session ${session.id.slice(0, 8)}`,
      timestamp: new Date().toISOString(),
    });
    res.json({ sessionId: session.id });
  } catch (e: unknown) {
    getLogger().error('POST_API_SESSIONS', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'create-failed' });
  }
});

app.get('/api/sessions/:id', (req, res) => {
  const eng = getEngine();
  const session = eng.sessionManager.getSessionById(req.params['id']!);
  if (!session) { res.status(404).json({ error: 'not-found' }); return; }
  if ((session.contextKind ?? 'agent_x') === 'crew_private' && session.hostCrewId) {
    const hostCrew = eng.crewManager.get(session.hostCrewId);
    const display = resolveHostCrewDisplay(session as unknown as Record<string, unknown>, hostCrew);
    res.json({
      ...session,
      ...display,
      title: display.hostCrewName && (
        !session.title || session.title === session.hostCrewName || session.title === hostCrew?.name
      ) ? display.hostCrewName : session.title,
    });
    return;
  }
  res.json(session);
});

app.delete('/api/sessions/:id', (req, res) => {
  try {
    const sessionId = req.params['id']!;
    const eng = getEngine();
    const peek = eng.sessionManager.getSessionById(sessionId);
    if (peek?.contextKind === 'agent_x_core') {
      res.status(403).json({ error: 'core-session-protected' });
      return;
    }
    const store = (eng.sessionManager as unknown as { store: { deleteSession: (id: string) => void } }).store;
    store.deleteSession(sessionId);
    // Clean up session folder on disk
    const dir = getSessionDir(req.params['id']!);
    if (existsSync(dir)) {
      try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best-effort */ }
    }
    res.json({ ok: true });
  } catch (e) {
    getLogger().error('DELETE_API_SESSIONS_ID', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'delete-failed' });
  }
});

app.post('/api/sessions/:id/restore', async (req, res) => {
  try {
    const sessionId = req.params['id']!;
    const perRoleRaw = (req.body as { perRole?: number } | undefined)?.perRole;
    const perRole = typeof perRoleRaw === 'number'
      ? Math.min(50, Math.max(1, Math.floor(perRoleRaw)))
      : undefined;
    if (sessionId === '__channel__' || isAutomationSessionId(sessionId)) {
      res.status(403).json({ error: 'internal-session' });
      return;
    }
    const eng = getEngine();
    const peek = eng.sessionManager.getSessionById(sessionId);
    if (!peek) { res.status(404).json({ error: 'not-found' }); return; }
    const existingAgent = eng.agent;
    const keepAgent = !!existingAgent
      && (existingAgent as unknown as { sessionId: string }).sessionId === sessionId
      && !existingAgent.processing;
    if (!keepAgent) {
      destroyAgent();
    }
    const session = eng.sessionManager.restoreSession(sessionId);
    if (!session) { res.status(404).json({ error: 'not-found' }); return; }
    // Restore saved session mode (defaults to 'plan')
    sessionSettings.mode = session.mode || 'plan';
    if (isCrewPrivateSessionRecord(session) && session.hyperdrive) {
      try {
        eng.sessionManager.updateSession({ hyperdrive: false } as never);
        session.hyperdrive = false;
      } catch { /* best-effort */ }
    }
    if (isCrewPrivateSessionRecord(session) && session.hostCrewId) {
      const store = (eng.sessionManager as unknown as { store?: unknown }).store;
      const crew = await resolveCrewPrivateHostForSession(eng.crewManager, session, store);
      if (crew) {
        const patch = syncHostCrewHonorificToSession(session, crew);
        if (patch) {
          eng.sessionManager.patchSession(session.id, patch);
          Object.assign(session, patch);
        }
      }
    }
    if (!keepAgent) {
      createAgent(undefined, session);
    }
    const resumeState = loadSessionResumeState(sessionId);
    // Restore hyperdrive overlay from DB (Agent-X sessions only — not crew private)
    if (!isCrewPrivateSessionRecord(session) && session.hyperdrive) {
      try {
        _preHyperdriveMode = session.mode || 'plan';
        sessionSettings.mode = 'agent';
        const agent = (eng as unknown as { agent?: { hyperdriveMode?: boolean; toggleHyperdriveMode?: () => boolean } }).agent;
        if (agent?.toggleHyperdriveMode && !agent.hyperdriveMode) {
          agent.toggleHyperdriveMode();
        }
      } catch (e) { /* best-effort */ }
    }
    ensureSubscribed();
    // Check for interrupted task (task_started without task_completed)
    let interruptedTask: Record<string, unknown> | null = null;
    try {
      const store = (eng.sessionManager as any).store;
      if (store?.getSessionEvents) {
        const events = store.getSessionEvents(sessionId) as Array<Record<string, unknown>>;
        let lastTaskStarted: Record<string, unknown> | null = null;
        let taskCompleted = false;
        for (const ev of events) {
          if (ev['type'] === 'task_started') lastTaskStarted = ev;
          if (ev['type'] === 'task_completed' && lastTaskStarted && (ev as any).payload?.taskId === (lastTaskStarted as any).payload?.taskId) {
            taskCompleted = true;
          }
        }
        if (lastTaskStarted && !taskCompleted) {
          getLogger().info('RESTORE', `Session ${sessionId.slice(0, 12)} has interrupted task: ${(lastTaskStarted as any).payload?.goal?.slice(0, 60)}`);
          // Also check for persisted task snapshot
          try {
            const snapshot = store.getTaskSnapshot?.(sessionId);
            if (snapshot) {
              interruptedTask = {
                goal: (lastTaskStarted as any).payload?.goal || snapshot.goal,
                taskId: snapshot.task_id,
                stepIndex: snapshot.step_index,
                hasPersistedState: true,
              };
            }
          } catch { /* best-effort */ }
        }
      }
    } catch { /* best-effort */ }
    // Restore crew states from session store
    const crewStates = eng.sessionManager.getCrewStates();
    for (const state of crewStates) {
      const agent = (eng as unknown as { agent?: { setCrewEnabled?: (id: string, enabled: boolean) => boolean } }).agent;
      if (agent?.setCrewEnabled) {
        agent.setCrewEnabled(state.crewId, state.enabled);
      }
    }
    // Read messages from DB using pagination so we never load the whole session history on restore.
    let messages: Array<Record<string, unknown>> = [];
    let parts: Array<Record<string, unknown>> = [];
    let messageTotal = 0;
    let messagesTruncated = false;
    try {
      const page = await loadSessionMessagesPage(sessionId, { limit: perRole != null ? perRole * 2 : 50 });
      messages = page.messages;
      messageTotal = page.total;
      messagesTruncated = page.hasMore;
      const store = (eng.sessionManager as any).store;
      if (store?.getPartsForMessages) {
        parts = await store.getPartsForMessages(sessionId, messages) as Array<Record<string, unknown>>;
      }
    } catch (e) { getLogger().warn('RESTORE_MESSAGES', e instanceof Error ? e.message : String(e)); }

    enrichSessionMessagesForUi(eng, messages, parts);

    res.json({
      session,
      messages,
      parts: [],
      crewStates,
      scopePath: session.scopePath,
      interruptedTask,
      turnFeedback: loadTurnFeedbackForSession(eng, sessionId),
      resumeState,
      messagesMeta: perRole != null ? { total: messageTotal, truncated: messagesTruncated, perRole } : undefined,
    });
  } catch (e: unknown) {
    getLogger().error('RESTORE_SESSION', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'restore-failed' });
  }
});
app.get('/api/sessions/:id/feedback', (req, res) => {
  try {
    const sessionId = req.params['id']!;
    const eng = getEngine();
    const session = eng.sessionManager.getSessionById(sessionId);
    if (!session) { res.status(404).json({ error: 'not-found' }); return; }
    res.json({ feedback: loadTurnFeedbackForSession(eng, sessionId) });
  } catch (e: unknown) {
    getLogger().error('GET_SESSION_FEEDBACK', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'feedback-load-failed' });
  }
});

app.get('/api/sessions/:id/messages', async (req, res) => {
  try {
    const sessionId = req.params['id']!;
    const parsed = sessionMessagesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid-query', details: parsed.error.flatten() });
      return;
    }
    const eng = getEngine();
    const session = eng.sessionManager.getSessionById(sessionId);
    if (!session) { res.status(404).json({ error: 'not-found' }); return; }

    const { limit, before } = parsed.data;
    const page = await loadSessionMessagesPage(sessionId, { limit, before });
    let parts: Array<Record<string, unknown>> = [];
    try {
      const store = (eng.sessionManager as unknown as { store?: { getPartsForMessages?: (sessionId: string, messages: Array<Record<string, unknown>>) => Promise<Array<Record<string, unknown>>> } }).store;
      parts = await store?.getPartsForMessages?.(sessionId, page.messages) ?? [];
    } catch { /* best-effort */ }
    const enriched = enrichSessionMessagesForUi(eng, [...page.messages], parts);
    const messages = enriched.map((m) => mergeNormalizedMessageForApi(m));
    res.json({ messages, total: page.total, hasMore: page.hasMore });
  } catch (e: unknown) {
    getLogger().error('GET_SESSION_MESSAGES', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'messages-load-failed' });
  }
});

app.post('/api/sessions/:id/feedback', validate(turnFeedbackSchema), (req, res) => {
  try {
    const sessionId = req.params['id']!;
    const eng = getEngine();
    const session = eng.sessionManager.getSessionById(sessionId);
    if (!session) { res.status(404).json({ error: 'not-found' }); return; }

    const { messageId, rating, turnSummary, metadata } = req.body as {
      messageId: string;
      rating: 'positive' | 'negative' | 'skipped';
      turnSummary?: string;
      metadata?: Record<string, unknown>;
    };

    const contextKind = (session.contextKind ?? 'agent_x') as 'agent_x' | 'crew_private';
    const crewId = contextKind === 'crew_private'
      ? ((session as { hostCrewId?: string }).hostCrewId ?? (metadata?.crewId as string | undefined) ?? null)
      : ((metadata?.crewId as string | undefined) ?? null);

    const result = recordTurnFeedback({
      sessionId,
      messageId,
      rating,
      contextKind,
      crewId,
      turnSummary: turnSummary ?? null,
      metadata: metadata ?? null,
    });

    if (!result.ok) {
      res.status(500).json({ error: result.error });
      return;
    }
    res.json({ ok: true, messageId, rating });
  } catch (e: unknown) {
    getLogger().error('POST_SESSION_FEEDBACK', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'feedback-failed' });
  }
});

// ───── Session Context Files ─────
app.post('/api/sessions/:id/context/rebuild', (_req, res) => {
  try {
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
    const count = agent.rebuildContext();
    agent.rebuildSystemPrompt();
    res.json({ ok: true, rebuilt: count });
  } catch (e: unknown) {
    getLogger().error('POST_API_SESSIONS_ID_CONTEXT_REBUILD', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'rebuild-failed' });
  }
});

app.post('/api/sessions/:id/context/limits', (req, res) => {
  try {
    const eng = getEngine();
    const agent = eng.agent as { setContextMemoryLimits?: (opts: Record<string, number>) => void } | undefined;
    if (!agent?.setContextMemoryLimits) { res.status(400).json({ error: 'no-session' }); return; }
    const { maxHistoryMessages, maxHistoryChars, maxBlockChars } = req.body as {
      maxHistoryMessages?: number;
      maxHistoryChars?: number;
      maxBlockChars?: number;
    };
    const limits: Record<string, number> = {};
    if (maxHistoryMessages != null) limits.maxHistoryMessages = maxHistoryMessages;
    if (maxHistoryChars != null) limits.maxHistoryChars = maxHistoryChars;
    if (maxBlockChars != null) limits.maxBlockChars = maxBlockChars;
    agent.setContextMemoryLimits(limits);
    res.json({ ok: true, ...limits });
  } catch (e: unknown) {
    getLogger().error('POST_API_SESSIONS_ID_CONTEXT_LIMITS', e instanceof Error ? e : String(e));
    res.status(500).json({ error: e instanceof Error ? e.message : 'limits-failed' });
  }
});

app.get('/api/sessions/:id/context', (req, res) => {
  try {
    const sessionId = req.params['id']!;
    const dir = getSessionDir(sessionId);
    const result: Record<string, string> = { context: '', memories: '', pending: '', completed: '', suggestions: '', compaction: '' };
    if (existsSync(dir)) {
      const files = ['context.txt', 'memories.txt', 'pending.txt', 'completed.txt', 'suggestions.txt'];
      for (const f of files) {
        const fp = join(dir, f);
        try { result[f.replace('.txt', '')] = readFileSync(fp, 'utf-8'); } catch { result[f.replace('.txt', '')] = ''; }
      }
    }
    const eng = getEngine();
    const store = (eng.sessionManager as unknown as { store?: { getMessages?: (id: string) => Array<{ role?: string; content?: string }> } }).store;
    if (store?.getMessages) {
      const msgs = store.getMessages(sessionId);
      const compactionMsgs = msgs.filter((m) => m.role === 'system' && String(m.content ?? '').includes('[COMPACTION SUMMARY'));
      const compactionText = compactionMsgs.map((m) => String(m.content ?? '').trim()).filter(Boolean).join('\n\n---\n\n');
      if (compactionText) result['compaction'] = compactionText;

      if (!result['context']) {
        const conversation = msgs
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => `[${m.role}]\n${m.content ?? ''}`)
          .join('\n\n');
        result['context'] = conversation;
      }
    }
    res.json(result);
  } catch (e) {
    getLogger().error('GET_API_SESSIONS_ID_CONTEXT', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'context-read-failed' });
  }
});

app.post('/api/sessions/:id/context/write', (req, res) => {
  try {
    const dir = ensureSessionDir(req.params['id']!);
    const updates = req.body as Record<string, string>;
    for (const [key, content] of Object.entries(updates)) {
      const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '');
      if (['context', 'memories', 'pending', 'completed', 'suggestions'].includes(safeKey)) {
        atomicWriteFileSync(join(dir, `${safeKey}.txt`), content);
      }
    }
    res.json({ ok: true });
  } catch (e) {
    getLogger().error('POST_API_SESSIONS_ID_CONTEXT_WRITE', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'context-write-failed' });
  }
});

app.post('/api/sessions/:id/compact', async (req, res) => {
  try {
    const dir = getSessionDir(req.params['id']!);
    if (!existsSync(dir)) { res.status(404).json({ error: 'session-dir-not-found' }); return; }
    const contextPath = join(dir, 'context.txt');
    const existingContent = existsSync(contextPath) ? readFileSync(contextPath, 'utf-8') : '';
    let summary = '';
    if (existingContent.length > 100) {
      try {
        const eng = getEngine();
        const cfg = eng.configManager.load();
        const providerId = cfg.provider.activeProvider;
        const providerCfg = cfg.provider.providers[providerId];
        if (providerCfg?.configured && providerCfg?.apiKey) {
          const provider = ProviderFactory.create(providerId, providerCfg.apiKey, providerCfg.baseUrl);
          const prompt = `Summarize the following conversation into a concise condensed version preserving all key decisions, code changes, and user intent. Keep the summary under 2000 characters:\n\n${existingContent.slice(-5000)}`;
          const request: CompletionRequest = {
            model: cfg.provider.activeModel,
            messages: [
              { role: 'system', content: 'You are a conversation summarizer. Produce concise summaries preserving key facts, decisions, and intent.' },
              { role: 'user', content: prompt },
            ],
            stream: false,
          };
          let fullText = '';
          for await (const chunk of provider.complete(request)) {
            if (chunk.type === 'text_delta' && chunk.content) {
              fullText += chunk.content;
            }
            if (chunk.type === 'done') break;
          }
          summary = fullText || '[summariser returned empty response]';
        } else {
          summary = `[provider ${providerId} not fully configured]`;
        }
      } catch (e) {
        summary = `[automatic compaction unavailable — content was ${existingContent.length} chars]`;
      }
    }
    const compacted = `[session compacted at ${new Date().toISOString()}]\n\n${summary || `Original content (${existingContent.length} chars) preserved.`}`;
    atomicWriteFileSync(contextPath, compacted);

    // Archive original to conversation.json
    const convPath = join(dir, 'conversation.json');
    try {
      const existing = JSON.parse(readFileSync(convPath, 'utf-8') || '[]') as unknown[];
      existing.push({ timestamp: new Date().toISOString(), type: 'compaction', snapshot: existingContent });
      atomicWriteFileSync(convPath, JSON.stringify(existing, null, 2));
    } catch (e) { /* ignore */ }

    res.json({ ok: true, summary });
  } catch (e: unknown) {
    getLogger().error('POST_API_SESSIONS_ID_COMPACT', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'compact-failed' });
  }
});

// ───── Checkpoints (Message Branching) ─────
app.post('/api/sessions/:id/checkpoint', validate(createCheckpointSchema), (req, res) => {
  try {
    const eng = getEngine();
    const store = (eng.sessionManager as any).store;
    if (!store?.createCheckpoint) { res.status(500).json({ error: 'store-unavailable' }); return; }
    const label = (req.body as Record<string, string>)['label'] || new Date().toLocaleTimeString();
    const result = store.createCheckpoint(req.params['id']!, label);
    if (!result) { res.status(400).json({ error: 'no-messages' }); return; }
    res.json({ checkpointId: result.id, label });
  } catch (e: unknown) {
    getLogger().error('POST_API_SESSIONS_ID_CHECKPOINT', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'checkpoint-failed' });
  }
});

app.get('/api/sessions/:id/checkpoints', (req, res) => {
  try {
    const eng = getEngine();
    const store = (eng.sessionManager as any).store;
    if (!store?.listCheckpoints) { res.json({ checkpoints: [] }); return; }
    const checkpoints = store.listCheckpoints(req.params['id']!);
    res.json({ checkpoints });
  } catch (e: unknown) {
    getLogger().error('GET_API_SESSIONS_ID_CHECKPOINTS', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'list-failed' });
  }
});

app.post('/api/sessions/:id/checkpoint/:checkpointId/restore', (req, res) => {
  try {
    const eng = getEngine();
    const store = (eng.sessionManager as any).store;
    if (!store?.restoreCheckpoint) { res.status(500).json({ error: 'store-unavailable' }); return; }
    const ok = store.restoreCheckpoint(req.params['id']!, req.params['checkpointId']!);
    if (!ok) { res.status(404).json({ error: 'checkpoint-not-found' }); return; }
    res.json({ ok: true });
  } catch (e: unknown) {
    getLogger().error('POST_API_SESSIONS_ID_CHECKPOINT_CHECKPOINTID_RESTO', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'restore-failed' });
  }
});

app.delete('/api/sessions/:id/checkpoint/:checkpointId', (req, res) => {
  try {
    const eng = getEngine();
    const store = (eng.sessionManager as any).store;
    if (!store?.deleteCheckpoint) { res.status(500).json({ error: 'store-unavailable' }); return; }
    const ok = store.deleteCheckpoint(req.params['id']!, req.params['checkpointId']!);
    if (!ok) { res.status(404).json({ error: 'checkpoint-not-found' }); return; }
    res.json({ ok: true });
  } catch (e: unknown) {
    getLogger().error('DELETE_API_SESSIONS_ID_CHECKPOINT_CHECKPOINTID', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'delete-failed' });
  }
});

// ───── Session Compaction ─────
app.post('/api/sessions/:id/compact', async (req, res) => {
  try {
    const dir = getSessionDir(req.params['id']!);
    const contextPath = join(dir, 'context.txt');
    let existingContent = '';
    try { existingContent = readFileSync(contextPath, 'utf-8'); } catch (e) { /* no context */ }

    // Ask the agent to summarize current context
    let summary = '';
    const eng = getEngine();
    if (eng.agent) {
      try {
        summary = await (eng.agent as any).compactContext?.() || '';
      } catch (e) { /* agent may not support compaction */ }
    }

    if (!summary && existingContent) {
      summary = `[session compacted at ${new Date().toISOString()}]\n\nOriginal content (${existingContent.length} chars) preserved.`;
    }
    if (summary) {
      writeFileSync(contextPath, summary, 'utf-8');
    }

    res.json({ ok: true, summary });
  } catch (e: unknown) {
    getLogger().error('POST_API_SESSIONS_ID_COMPACT', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'compact-failed' });
  }
});

// ───── TODO List ─────
app.get('/api/todos', (req, res) => {
  try {
    const sessionId = (req.query['sessionId'] as string) || '';
    const dir = sessionId ? getSessionDir(sessionId) : getSessionDir('default');
    const todoPath = join(dir, 'todos.json');
    const todos = existsSync(todoPath) ? JSON.parse(readFileSync(todoPath, 'utf-8') || '[]') : [];
    res.json({ todos });
  } catch (e: unknown) {
    getLogger().error('GET_API_TODOS', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'list-failed' });
  }
});

app.post('/api/todos', (req, res) => {
  try {
    const sessionId = (req.body as Record<string, string>)['sessionId'] || '';
    const todos = (req.body as Record<string, unknown>)['todos'] as Array<{ id: string; title: string; status: string }>;
    const dir = sessionId ? getSessionDir(sessionId) : getSessionDir('default');
    const todoPath = join(dir, 'todos.json');
    atomicWriteFileSync(todoPath, JSON.stringify(todos || [], null, 2));
    res.json({ ok: true });
  } catch (e: unknown) {
    getLogger().error('POST_API_TODOS', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'save-failed' });
  }
});

app.put('/api/todos/:itemId', (req, res) => {
  try {
    const sessionId = (req.body as Record<string, string>)['sessionId'] || '';
    const dir = sessionId ? getSessionDir(sessionId) : getSessionDir('default');
    const todoPath = join(dir, 'todos.json');
    const todos: Array<{ id: string; title: string; status: string }> = existsSync(todoPath)
      ? JSON.parse(readFileSync(todoPath, 'utf-8') || '[]') : [];
    const idx = todos.findIndex((t) => t.id === req.params['itemId']);
    if (idx >= 0) {
      const todo = todos[idx]!;
      todo.status = (req.body as Record<string, string>)['status'] || todo.status;
      todo.title = (req.body as Record<string, string>)['title'] || todo.title;
    }
    atomicWriteFileSync(todoPath, JSON.stringify(todos, null, 2));
    res.json({ ok: true });
  } catch (e: unknown) {
    getLogger().error('PUT_API_TODOS_ITEMID', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'update-failed' });
  }
});

// ───── Telegram ─────
app.post('/api/channels/telegram/discover', async (req, res) => {
  try {
    const { botToken, chatId: hintChatId } = req.body as { botToken?: string; chatId?: string };
    if (!botToken?.trim()) {
      res.status(400).json({ ok: false, error: 'botToken is required' });
      return;
    }
    const savedChatId = getEngine().configManager.load().channels?.telegram?.chatId?.trim();
    const runtimeChatId = getTelegramRuntimeHints().telegramChatId?.trim();
    const result = await discoverTelegramBot(botToken, {
      knownChatIds: [
        hintChatId,
        savedChatId,
        runtimeChatId ?? undefined,
      ].filter((id): id is string => Boolean(id?.trim())),
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    if (result.chats?.length) {
      const chatId = result.chats[0]!.id;
      const saved = await saveVerifiedTelegram(botToken, chatId);
      res.json({ ...result, ...saved, chatId, saved: true });
      return;
    }
    res.json(result);
  } catch (e: unknown) {
    getLogger().error('POST_CHANNELS_TELEGRAM_DISCOVER', e instanceof Error ? e : String(e));
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'discover-failed' });
  }
});

app.post('/api/channels/telegram/greeting', async (req, res) => {
  try {
    const { botToken, chatId } = req.body as { botToken?: string; chatId?: string };
    const result = await sendTelegramGreeting({ botToken, chatId });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (e: unknown) {
    getLogger().error('POST_CHANNELS_TELEGRAM_GREETING', e instanceof Error ? e : String(e));
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'greeting-failed' });
  }
});

app.get('/api/channels/telegram/status', async (_req, res) => {
  try {
    const status = getTelegramInboundStatus();
    if (status.inboundReady && !status.bridgeRunning) {
      const restarted = await restartTelegramInbound();
      res.json({ ok: true, ...restarted.status, selfHealAttempted: true, selfHealOk: restarted.ok, selfHealError: restarted.error });
      return;
    }
    res.json({ ok: true, ...status });
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'status-failed' });
  }
});

app.post('/api/channels/telegram/restart', async (_req, res) => {
  try {
    const result = await restartTelegramInbound();
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'restart-failed' });
  }
});

app.post('/api/telegram/start', async (req, res) => {
  try {
    const { token } = req.body as { token: string };
    const eng = getEngine();
    const existing = eng.pluginRegistry.getPlugin('telegram');
    if (existing) {
      eng.pluginRegistry.updateConfig('telegram', { botToken: token });
    } else {
      const { getBuiltinPlugin } = await import('@agentx/engine');
      const entry = getBuiltinPlugin('telegram');
      if (entry) {
        eng.pluginRegistry.install(entry);
        eng.pluginRegistry.updateConfig('telegram', { botToken: token });
      }
    }
    // Auto-enable the plugin
    eng.pluginRegistry.enable('telegram');
    // Start Telegram bridge immediately if not already running
    if (!eng.telegramBridge && !process.env['AGENTX_DAEMON_HANDLES_TG']) {
      // If gateway exists but bridge is dead, clean up stale state
      if (eng.gateway) {
        try { eng.gateway.stopChannel('telegram'); } catch (e) { /* ignore */ }
        eng.gateway = null;
      }
      const { Gateway } = await import('@agentx/engine');
      eng.gateway = new Gateway();
      try {
        const tgPlugin = eng.gateway.registerTelegram(token);
        tgPlugin.setAgent(ensureChannelAgent());
        await eng.gateway.startChannel('telegram');
        eng.telegramBridge = eng.gateway.getTelegramBridge();
        res.json({ ok: true, message: 'Telegram bot started and listening.' });
        return;
      } catch (e) {
        res.json({ ok: true, message: 'Token saved but bridge start failed. Will retry on next session.' });
        return;
      }
    }
    res.json({ ok: true, message: 'Token saved. Telegram plugin configured and enabled.' });
  } catch (e: unknown) {
    getLogger().error('POST_API_TELEGRAM_START', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'save-failed' });
  }
});

app.post('/api/telegram/stop', (_req, res) => {
  try {
    const eng = getEngine();
    // Stop running bridge
    if (eng.telegramBridge) {
      try { eng.telegramBridge.stop(); } catch (e) { /* ignore */ }
      eng.telegramBridge = null;
    }
    if (eng.gateway) {
      try { eng.gateway.stopChannel('telegram'); } catch (e) { /* ignore */ }
    }
    // Disable plugin but keep config so it auto-starts on next launch
    if (eng.pluginRegistry.isInstalled('telegram')) {
      eng.pluginRegistry.disable('telegram');
    }
    res.json({ ok: true, message: 'Telegram bot stopped. Config preserved for next launch.' });
  } catch (e) {
    getLogger().error('POST_API_TELEGRAM_STOP', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'clear-failed' });
  }
});

app.get('/api/telegram/status', (_req, res) => {
  const eng = getEngine();
  const plugin = eng.pluginRegistry.getPlugin('telegram');
  const configured = !!plugin?.enabled && !!plugin?.config?.['botToken'];
  const connected = configured && !!eng.telegramBridge?.isRunning();
  res.json({ configured, connected, botToken: configured ? '***configured***' : null });
});

// ───── TUI Active Check ─────
const TUI_ACTIVE_PATH = join(DATA_DIR, 'tui-active.mark');

app.get('/api/tui-active', (_req, res) => {
  if (existsSync(TUI_ACTIVE_PATH)) {
    try {
      const pid = parseInt(readFileSync(TUI_ACTIVE_PATH, 'utf-8').trim(), 10);
      // Verify process is still alive
      try { process.kill(pid, 0); } catch (e) { unlinkSync(TUI_ACTIVE_PATH); res.json({ active: false }); return; }
      res.json({ active: true, pid });
    } catch (e) {
      res.json({ active: false });
    }
  } else {
    res.json({ active: false });
  }
});

// ───── Web-UI Active Check ─────
const WEBUI_ACTIVE_PATH = join(DATA_DIR, 'webui-active.mark');

app.get('/api/webui-active', (_req, res) => {
  if (existsSync(WEBUI_ACTIVE_PATH)) {
    try {
      const data = JSON.parse(readFileSync(WEBUI_ACTIVE_PATH, 'utf-8'));
      const { pid, timestamp } = data;
      // Check if marker is recent (within last 30 seconds)
      const age = Date.now() - timestamp;
      if (age > 30000) {
        unlinkSync(WEBUI_ACTIVE_PATH);
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

app.post('/api/webui-active', (req, res) => {
  try {
    const pid = req.body?.pid ?? process.pid;
    writeFileSync(WEBUI_ACTIVE_PATH, JSON.stringify({ pid, timestamp: Date.now() }));
    res.json({ ok: true });
  } catch (err) {
    getLogger().error('POST_API_WEBUI_ACTIVE', err instanceof Error ? err : String(err));    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete('/api/webui-active', (_req, res) => {
  try {
    if (existsSync(WEBUI_ACTIVE_PATH)) {
      unlinkSync(WEBUI_ACTIVE_PATH);
    }
    res.json({ ok: true });
  } catch (err) {
    getLogger().error('DELETE_API_WEBUI_ACTIVE', err instanceof Error ? err : String(err));    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ───── Gateway / Focus ─────
app.get('/api/gateway/status', (_req, res) => {
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

app.post('/api/gateway/focus', (req, res) => {
  const eng = getEngine();
  const { channel } = req.body as { channel: string };
  if (!eng.gateway) {
    res.status(400).json({ error: 'Gateway not active' });
    return;
  }
  eng.gateway.focus.setFocus(channel);
  res.json({ ok: true, focus: channel });
});

app.get('/api/gateway/focus', (_req, res) => {
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

// ───── Discord Bridge ─────
app.post('/api/discord/start', async (req, res) => {
  try {
    const { token, channelId } = req.body as { token: string; channelId?: string };
    const eng = getEngine();
    const existing = eng.pluginRegistry.getPlugin('discord');
    if (existing) {
      eng.pluginRegistry.updateConfig('discord', { botToken: token, channelId });
    } else {
      const { getBuiltinPlugin } = await import('@agentx/engine');
      const entry = getBuiltinPlugin('discord');
      if (entry) {
        eng.pluginRegistry.install(entry);
        eng.pluginRegistry.updateConfig('discord', { botToken: token, channelId });
      }
    }

    // Persist to disk
    if (!eng.pgPool) throw new Error('PostgreSQL pool not available');
    const discordStore = new DiscordStore(eng.pgPool, eng.dek!);
    await discordStore.save({ botToken: token, channelId });

    // Stop existing bridge if any
    if (eng.discordBridge) {
      eng.discordBridge.stop();
      eng.discordBridge = null;
    }

    // Start the actual bridge
    const bridge = new DiscordBridge();
    bridge.setAgentFactory(async () => {
      const userCfg = eng.configManager.load();
      const userProvider = userCfg.provider.activeProvider as ProviderId;
      const userSession = eng.sessionManager.createSession(
        userProvider,
        userCfg.provider.activeModel,
        process.cwd(),
      );
      return new Agent({
        config: userCfg,
        sessionId: userSession.id,
        systemPrompt: '',
        toolExecutor: eng.toolkit.executor,
        toolRegistry: eng.toolkit.registry,
        pgPool: eng.pgPool ?? undefined,
      });
    });
    await bridge.start(token, channelId);
    eng.discordBridge = bridge;

    res.json({ ok: true, message: 'Discord bot connected.', status: bridge.getStatus() });
  } catch (e: unknown) {
    getLogger().error('POST_API_DISCORD_START', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'save-failed' });
  }
});

app.post('/api/discord/stop', async (_req, res) => {
  try {
    const eng = getEngine();
    if (eng.discordBridge) {
      eng.discordBridge.stop();
      eng.discordBridge = null;
    }
    if (eng.pluginRegistry.isInstalled('discord')) {
      eng.pluginRegistry.uninstall('discord');
    }
    if (eng.pgPool) {
      const discordStore = new DiscordStore(eng.pgPool, eng.dek!);
      await discordStore.clear();
    }
    res.json({ ok: true });
  } catch (e) {
    getLogger().error('POST_API_DISCORD_STOP', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'clear-failed' });
  }
});

app.get('/api/discord/status', (_req, res) => {
  const eng = getEngine();
  const plugin = eng.pluginRegistry.getPlugin('discord');
  const configured = !!plugin?.enabled && !!plugin?.config?.['botToken'];
  const bridge = eng.discordBridge;
  const connected = bridge?.getStatus().connected ?? false;
  const guilds = bridge?.getStatus().guilds ?? 0;
  res.json({ configured, connected, guilds });
});

// ───── Slack Bridge ─────
app.post('/api/slack/start', async (req, res) => {
  try {
    const { botToken, appToken } = req.body as { botToken: string; appToken: string };
    if (!botToken || !appToken) {
      res.status(400).json({ error: 'botToken and appToken are required' });
      return;
    }
    const eng = getEngine();
    if (eng.slackBridge) {
      eng.slackBridge.stop();
      eng.slackBridge = null;
    }
    const bridge = new SlackBridge({ botToken, appToken });
    bridge.setAgentFactory((_userId) => {
      const cfg = eng.configManager.load();
      const session = eng.sessionManager.createSession(
        cfg.provider.activeProvider,
        cfg.provider.activeModel,
        process.cwd(),
      );
      return new Agent({
        config: cfg,
        sessionId: session.id,
        systemPrompt: '',
        toolExecutor: eng.toolkit.executor,
        toolRegistry: eng.toolkit.registry,
        pgPool: eng.pgPool ?? undefined,
      });
    });
    if (!eng.pgPool) throw new Error('PostgreSQL pool not available');
    await bridge.start();
    eng.slackBridge = bridge;
    const slackStore = new SlackStore(eng.pgPool, eng.dek!);
    await slackStore.save({ botToken, appToken });
    res.json({ ok: true, message: 'Slack bridge started.', status: bridge.getStatus() });
  } catch (e: unknown) {
    getLogger().error('POST_API_SLACK_START', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'start-failed' });
  }
});

app.post('/api/slack/stop', async (_req, res) => {
  try {
    const eng = getEngine();
    if (eng.slackBridge) {
      eng.slackBridge.stop();
      eng.slackBridge = null;
    }
    if (eng.pgPool) {
      const slackStore = new SlackStore(eng.pgPool, eng.dek!);
      await slackStore.clear();
    }
    res.json({ ok: true });
  } catch (e) {
    getLogger().error('POST_API_SLACK_STOP', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'stop-failed' });
  }
});

app.get('/api/slack/status', async (_req, res) => {
  try {
    const eng = getEngine();
    if (!eng.pgPool) throw new Error('PostgreSQL pool not available');
    const slackStore = new SlackStore(eng.pgPool, eng.dek!);
    const cfg = await slackStore.load();
    const bridge = eng.slackBridge;
    const configured = !!cfg?.botToken && !!cfg?.appToken;
    const status = bridge?.getStatus();
    res.json({
      configured,
      connected: status?.connected ?? false,
      team: status?.team ?? '',
    });
  } catch (e) {
    res.json({ configured: false, connected: false, team: '' });
  }
});

// ───── Email Bridge ─────
app.post('/api/email/start', async (req, res) => {
  try {
    const body = req.body as Record<string, string | undefined>;
    const smtpHost = body['smtpHost'] ?? '';
    const smtpPort = body['smtpPort'] ?? '';
    const smtpUser = body['smtpUser'] ?? '';
    const smtpPass = body['smtpPass'] ?? '';
    const fromAddress = body['fromAddress'] ?? '';
    const imapHost = body['imapHost'];
    const imapPort = body['imapPort'];
    const eng = getEngine();
    const existing = eng.pluginRegistry.getPlugin('email');
    const config = { smtpHost, smtpPort, smtpUser, smtpPass, fromAddress, imapHost, imapPort };
    if (existing) {
      eng.pluginRegistry.updateConfig('email', config);
    } else {
      const { getBuiltinPlugin } = await import('@agentx/engine');
      const entry = getBuiltinPlugin('email');
      if (entry) {
        eng.pluginRegistry.install(entry);
        eng.pluginRegistry.updateConfig('email', config);
      }
    }

    // Stop existing bridge if any
    if (eng.emailBridge) {
      eng.emailBridge.stop();
      eng.emailBridge = null;
    }

    // Start the real bridge
    const cfg = eng.configManager.load();
    const bridge = new EmailBridge();
    bridge.setAgentDeps({
      config: cfg,
      systemPrompt: '',
      toolExecutor: eng.toolkit.executor,
      toolRegistry: eng.toolkit.registry,
    });
    await bridge.start({
      smtpHost: smtpHost.trim(),
      smtpPort: Number(smtpPort) || 587,
      smtpUser: smtpUser.trim(),
      smtpPass: smtpPass.trim(),
      fromAddress: (fromAddress || smtpUser).trim(),
      imapHost: imapHost?.trim() || undefined,
      imapPort: imapPort ? Number(imapPort) : undefined,
    });
    eng.emailBridge = bridge;

    res.json({ ok: true, message: 'Email bridge configured and started.' });
  } catch (e: unknown) {
    getLogger().error('POST_API_EMAIL_START', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'save-failed' });
  }
});

app.post('/api/email/stop', (_req, res) => {
  try {
    const eng = getEngine();
    if (eng.emailBridge) {
      eng.emailBridge.stop();
      eng.emailBridge = null;
    }
    if (eng.pluginRegistry.isInstalled('email')) {
      eng.pluginRegistry.uninstall('email');
    }
    res.json({ ok: true });
  } catch (e) {
    getLogger().error('POST_API_EMAIL_STOP', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'clear-failed' });
  }
});

app.get('/api/email/status', (_req, res) => {
  try {
    const eng = getEngine();
    const plugin = eng.pluginRegistry.getPlugin('email');
    const configured = !!plugin?.enabled && !!plugin?.config?.['smtpHost'];
    const bridge = eng.emailBridge;
    const status = bridge?.getStatus();
    res.json({
      configured,
      connected: status?.connected ?? false,
      unreadCount: status?.unreadCount ?? 0,
    });
  } catch (e) {
    res.json({ configured: false, connected: false, unreadCount: 0 });
  }
});

// ───── Tools ─────
app.get('/api/tools', (_req, res) => {
  const eng = getEngine();
  const cfg = eng.configManager.load();
  const disabled = cfg.ui?.disabledTools || [];
  let tools = eng.toolkit.registry.list();
  const enabledParam = (_req.query['enabled'] as string);
  if (enabledParam === 'true') {
    tools = tools.filter((t) => !disabled.includes(t.id));
  } else if (enabledParam === 'false') {
    tools = tools.filter((t) => disabled.includes(t.id));
  }
  // Always include enabled status
  res.json(tools.map((t) => ({ ...t, enabled: !disabled.includes(t.id) })));
});

app.post('/api/tools/bulk-toggle', (req, res) => {
  try {
    const eng = getEngine();
    const { ids, enabled } = req.body as { ids?: string[]; enabled: boolean; category?: string };
    const cfg = eng.configManager.load();
    const disabledSet = new Set(cfg.ui?.disabledTools || []);

    let targetIds = ids;
    if (!targetIds) {
      // If no ids but category provided, toggle all in category
      const category = req.body.category as string | undefined;
      const allTools = eng.toolkit.registry.list();
      targetIds = category
        ? allTools.filter((t) => t.category === category).map((t) => t.id)
        : allTools.map((t) => t.id);
    }

    for (const id of targetIds) {
      if (enabled) disabledSet.delete(id);
      else disabledSet.add(id);
    }

    cfg.ui = cfg.ui || {};
    cfg.ui.disabledTools = [...disabledSet];
    eng.configManager.save(cfg);
    res.json({ ok: true, toggled: targetIds.length, enabled });
  } catch (e) {
    getLogger().error('POST_API_TOOLS_BULK_TOGGLE', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'bulk-toggle-failed' });
  }
});

app.get('/api/tools/categories', (_req, res) => {
  const eng = getEngine();
  const tools = eng.toolkit.registry.list();
  const catMap: Record<string, { category: string; count: number; riskLevels: string[] }> = {};
  for (const t of tools) {
    if (!catMap[t.category]) catMap[t.category] = { category: t.category, count: 0, riskLevels: [] };
    const entry = catMap[t.category]!;
    entry.count++;
    if (!entry.riskLevels.includes(t.riskLevel)) entry.riskLevels.push(t.riskLevel);
  }
  res.json(Object.values(catMap));
});

app.get('/api/tools/:id', (req, res) => {
  const eng = getEngine();
  const tool = eng.toolkit.registry.get(req.params['id']!);
  if (!tool) { res.status(404).json({ error: 'tool-not-found' }); return; }
  const cfg = eng.configManager.load();
  const disabled = cfg.ui?.disabledTools || [];
  res.json({ ...tool, enabled: !disabled.includes(tool.id) });
});

app.put('/api/tools/:id', (req, res) => {
  try {
    const eng = getEngine();
    const tool = eng.toolkit.registry.get(req.params['id']!);
    if (!tool) { res.status(404).json({ error: 'tool-not-found' }); return; }
    const { enabled } = req.body as { enabled: boolean };
    const cfg = eng.configManager.load();
    const disabled = new Set(cfg.ui?.disabledTools || []);
    if (enabled) {
      disabled.delete(tool.id);
    } else {
      disabled.add(tool.id);
    }
    cfg.ui.disabledTools = [...disabled];
    eng.configManager.save(cfg);
    res.json({ id: tool.id, enabled });
  } catch (e) {
    getLogger().error('PUT_API_TOOLS_ID', e instanceof Error ? e : String(e));    res.status(500).json({ error: 'tool-update-failed' });
  }
});

// ───── RAG / Vector Search ─────
app.get('/api/rag/status', (_req, res) => {
  const eng = getEngine();
  if (!eng.rag) {
    res.json({ enabled: false, indexedChunks: 0 });
    return;
  }
  eng.rag.chunkCount().then((count) => {
    res.json({ enabled: true, indexedChunks: count });
  }).catch(() => {
    res.json({ enabled: true, indexedChunks: 0 });
  });
});

app.post('/api/rag/index', async (req, res) => {
  const eng = getEngine();
  if (!eng.rag) {
    res.status(400).json({ error: 'RAG is not enabled' });
    return;
  }
  const { content, metadata, id } = req.body as { content?: string; metadata?: Record<string, unknown>; id?: string };
  if (!content) {
    res.status(400).json({ error: 'content is required' });
    return;
  }
  try {
    const docId = await eng.rag.indexDocument({ id, content, metadata });
    res.json({ docId });
  } catch (e: unknown) {
    getLogger().error('POST_API_RAG_INDEX', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'index-failed' });
  }
});

app.post('/api/rag/search', async (req, res) => {
  const eng = getEngine();
  if (!eng.rag) {
    res.status(400).json({ error: 'RAG is not enabled' });
    return;
  }
  const { query, topK } = req.body as { query?: string; topK?: number };
  if (!query) {
    res.status(400).json({ error: 'query is required' });
    return;
  }
  try {
    const results = await eng.rag.search(query, topK);
    res.json({ results });
  } catch (e: unknown) {
    getLogger().error('POST_API_RAG_SEARCH', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'search-failed' });
  }
});

app.delete('/api/rag/documents/:id', async (req, res) => {
  const eng = getEngine();
  if (!eng.rag) {
    res.status(400).json({ error: 'RAG is not enabled' });
    return;
  }
  try {
    await eng.rag.deleteDocument(req.params['id']!);
    res.json({ ok: true });
  } catch (e: unknown) {
    getLogger().error('DELETE_API_RAG_DOCUMENTS_ID', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'delete-failed' });
  }
});

app.post('/api/rag/clear', async (_req, res) => {
  const eng = getEngine();
  if (!eng.rag) {
    res.status(400).json({ error: 'RAG is not enabled' });
    return;
  }
  try {
    await eng.rag.clearAll();
    res.json({ ok: true });
  } catch (e: unknown) {
    getLogger().error('POST_API_RAG_CLEAR', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'clear-failed' });
  }
});

// ───── File Upload ─────
app.post('/api/files/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  // Content-based file type validation (magic bytes, not user-supplied mime)
  const validation = validateUploadedFile(req.file.path, req.file.originalname);
  if (!validation.valid) {
    // Clean up the rejected file
    try { unlinkSync(req.file.path); } catch { /* ignore */ }
    getLogger().warn('FILE_UPLOAD', `Rejected file '${req.file.originalname}': ${validation.error}`);
    res.status(400).json({ error: validation.error, detectedType: validation.detectedType });
    return;
  }

  const fileId = generateId('file_');
  const ext = basename(req.file.originalname).split('.').pop() ?? '';
  const destName = `${fileId}.${ext}`;
  const destPath = join(UPLOADS_DIR, destName);
  if (existsSync(req.file.path)) {
    renameSync(req.file.path, destPath);
  }
  // Save metadata including detected MIME type
  try {
    writeFileSync(destPath + '.meta.json', JSON.stringify({
      originalName: req.file.originalname,
      mimeType: validation.detectedType,
      userMimeType: req.file.mimetype,
      size: req.file.size,
      uploadedAt: new Date().toISOString(),
    }), 'utf-8');
  } catch { /* best-effort */ }
  res.json({
    id: fileId,
    originalName: req.file.originalname,
    size: req.file.size,
    mimeType: validation.detectedType,
    path: `/api/files/${fileId}`,
  });
});

app.get('/api/files', (_req, res) => {
  try {
    if (!existsSync(UPLOADS_DIR)) {
      res.json({ files: [] });
      return;
    }
    const entries = readdirSync(UPLOADS_DIR);
    const files = entries
      .filter((e) => e !== '.gitkeep')
      .map((e) => {
        const fullPath = join(UPLOADS_DIR, e);
        try {
          const st = statSync(fullPath);
          if (!st.isFile()) return null;
          const metaPath = fullPath + '.meta.json';
          let meta: Record<string, unknown> = {};
          if (existsSync(metaPath)) {
            try { meta = JSON.parse(readFileSync(metaPath, 'utf-8')); } catch (e) { /* skip */ }
          }
          return {
            id: e.replace(/\.[^.]+$/, ''),
            name: (meta['originalName'] as string) ?? e,
            size: st.size,
            createdAt: st.birthtime.toISOString(),
          };
        } catch (e) { return null; }
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);
    res.json({ files });
  } catch (e: unknown) {
    getLogger().error('GET_API_FILES', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'list-files-failed' });
  }
});

app.get('/api/files/:id', (req, res) => {
  const fileId = req.params['id']!;
  const entries = existsSync(UPLOADS_DIR) ? readdirSync(UPLOADS_DIR) : [];
  const match = entries.find((e) => e.startsWith(fileId));
  if (!match) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  const filePath = join(UPLOADS_DIR, match);
  if (!existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  const st = statSync(filePath);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', st.size);
  res.setHeader('Content-Disposition', `inline; filename="${match}"`);
  createReadStream(filePath).pipe(res);
});

app.delete('/api/files/:id', (req, res) => {
  const fileId = req.params['id']!;
  const entries = existsSync(UPLOADS_DIR) ? readdirSync(UPLOADS_DIR) : [];
  const match = entries.find((e) => e.startsWith(fileId));
  if (!match) {
    res.json({ ok: true });
    return;
  }
  const filePath = join(UPLOADS_DIR, match);
  const metaPath = filePath + '.meta.json';
  try {
    if (existsSync(filePath)) rmSync(filePath);
    if (existsSync(metaPath)) rmSync(metaPath);
    res.json({ ok: true });
  } catch (e: unknown) {
    getLogger().error('DELETE_API_FILES_ID', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'delete-failed' });
  }
});

// ───── Secret Sauce (Soul / Identity / Diary / Memories / Permission / Crew docs) ─────
const SECRET_SAUCE_FILES = ['SOUL', 'IDENTITY', 'DIARY', 'MEMORIES', 'PERMISSION', 'CREW'] as const;
type SecretSauceFile = typeof SECRET_SAUCE_FILES[number];
function secretSaucePath(file: string): string | null {
  const upper = file.toUpperCase();
  if (!(SECRET_SAUCE_FILES as readonly string[]).includes(upper)) return null;
  return join(process.cwd(), 'data', 'secret-sauce', `${upper}.md`);
}

app.get('/api/secret-sauce', (_req, res) => {
  const files: Array<{ file: SecretSauceFile; size: number; exists: boolean }> = [];
  for (const f of SECRET_SAUCE_FILES) {
    const p = join(process.cwd(), 'data', 'secret-sauce', `${f}.md`);
    if (existsSync(p)) {
      try {
        const stat = readFileSync(p, 'utf-8');
        files.push({ file: f, size: stat.length, exists: true });
      } catch (e) { files.push({ file: f, size: 0, exists: true }); }
    } else {
      files.push({ file: f, size: 0, exists: false });
    }
  }
  res.json({ files });
});

app.get('/api/secret-sauce/:file', (req, res) => {
  const p = secretSaucePath(req.params['file']!);
  if (!p) { res.status(400).json({ error: 'invalid-file' }); return; }
  if (!existsSync(p)) { res.json({ content: '', exists: false }); return; }
  try {
    const content = readFileSync(p, 'utf-8');
    res.json({ content, exists: true });
  } catch (e: unknown) {
    getLogger().error('GET_API_SECRET_SAUCE_FILE', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'read-failed' });
  }
});

app.put('/api/secret-sauce/:file', (req, res) => {
  const p = secretSaucePath(req.params['file']!);
  if (!p) { res.status(400).json({ error: 'invalid-file' }); return; }
  const { content } = req.body as { content?: string };
  if (typeof content !== 'string') { res.status(400).json({ error: 'content-required' }); return; }
  try {
    const dir = join(process.cwd(), 'data', 'secret-sauce');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(p, content, 'utf-8');
    res.json({ ok: true, size: content.length });
  } catch (e: unknown) {
    getLogger().error('PUT_API_SECRET_SAUCE_FILE', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'write-failed' });
  }
});

// ───── Agent Orchestrator ─────
app.post('/api/orchestrator/plan', async (req, res) => {
  const eng = getEngine();
  if (!eng.agent) {
    res.status(400).json({ error: 'No active agent' });
    return;
  }
  const { goal, steps } = req.body as { goal?: string; steps?: Array<{ description: string; instruction: string; tools: string[]; dependsOn: string[] }> };
  if (!goal) {
    res.status(400).json({ error: 'goal is required' });
    return;
  }

  try {
    const { AgentOrchestrator } = await import('@agentx/engine');
    const orchestrator = new AgentOrchestrator(eng.agent.agents, eng.agent.events);
    const plan = await orchestrator.createPlan(goal);

    if (steps) {
      for (const step of steps) {
        orchestrator.addStep(plan.id, step.description, step.instruction, step.tools, step.dependsOn);
      }
    }

    // Store for later execution — store orchestrator in a WeakMap keyed by the plan
    planOrchestratorMap.set(plan as object, orchestrator);
    // Also map by plan id for lookup during execute endpoint
    planOrchestratorById.set(plan.id, orchestrator);

    res.json({ plan: { id: plan.id, goal: plan.goal, steps: plan.steps, status: plan.status, createdAt: plan.createdAt } });
  } catch (e: unknown) {
    getLogger().error('POST_API_ORCHESTRATOR_PLAN', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'create-plan-failed' });
  }
});

app.post('/api/orchestrator/plan/:id/execute', async (req, res) => {
  const eng = getEngine();
  if (!eng.agent) {
    res.status(400).json({ error: 'No active agent' });
    return;
  }
  try {
    // If an orchestrator was stored earlier for this plan id, use it. Otherwise fall back
    // to creating a fresh orchestrator and running a dynamic plan from the request body.
    const stored = planOrchestratorById.get(req.params['id']!);
    if (stored) {
      // We stored the orchestrator instance; assume it exposes execute and getPlan methods
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const orches = stored as any;
        const result = await orches.execute(req.params['id']!);
        // Cleanup stored orchestrator for this plan id now that execution finished
        try { planOrchestratorById.delete(req.params['id']!); } catch (e) { /* ignore */ }
        res.json({ plan: result });
        return;
      } catch (e) {
        // If stored orchestrator failed, continue to fallback creation
        try { planOrchestratorById.delete(req.params['id']!); } catch (e) { /* ignore */ }
      }
    }

    const { AgentOrchestrator } = await import('@agentx/engine');
    const orchestrator = new AgentOrchestrator(eng.agent.agents, eng.agent.events);
    // Re-build the plan from agent orchestrator state using provided steps (if any)
    const plan = await orchestrator.createPlan('dynamic');
    if (req.body?.['steps']) {
      for (const step of (req.body as { steps: Array<{ description: string; instruction: string; tools: string[]; dependsOn: string[] }> }).steps) {
        orchestrator.addStep(plan.id, step.description, step.instruction, step.tools, step.dependsOn);
      }
    }
    const result = await orchestrator.execute(plan.id);
    res.json({ plan: result });
  } catch (e: unknown) {
    getLogger().error('POST_API_ORCHESTRATOR_PLAN_ID_EXECUTE', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'execute-plan-failed' });
  }
});

// ───── Plugin Hub ─────
app.get('/api/plugins', (_req, res) => {
  const eng = getEngine();
  const plugins = eng.pluginRegistry.getInstalled();
  res.json({ plugins });
});

app.get('/api/plugins/categories', (_req, res) => {
  const eng = getEngine();
  const categories = eng.pluginRegistry.getCategories();
  const installed = eng.pluginRegistry.getInstalledByCategoryGrouped();
  const available = eng.pluginRegistry.getAvailableByCategory();
  res.json({ categories, installed, available });
});

app.get('/api/plugins/available', (_req, res) => {
  const eng = getEngine();
  const plugins = eng.pluginRegistry.getAvailable();
  res.json({ plugins });
});

app.get('/api/plugins/installed', (_req, res) => {
  const eng = getEngine();
  const plugins = eng.pluginRegistry.getInstalled();
  res.json({ plugins });
});

app.post('/api/plugins/:id/install', async (req, res) => {
  const eng = getEngine();
  const { id } = req.params;
  const { getBuiltinPlugin } = await import('@agentx/engine');
  const entry = getBuiltinPlugin(id!);
  if (!entry) {
    res.status(404).json({ error: `Plugin "${id}" not found in catalog` });
    return;
  }
  try {
    const plugin = eng.pluginRegistry.install(entry);
    res.json({ plugin });
  } catch (e: unknown) {
    getLogger().error('POST_API_PLUGINS_ID_INSTALL', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'install-failed' });
  }
});

app.post('/api/plugins/:id/uninstall', (req, res) => {
  const eng = getEngine();
  try {
    eng.pluginRegistry.uninstall(req.params['id']!);
    res.json({ ok: true });
  } catch (e: unknown) {
    getLogger().error('POST_API_PLUGINS_ID_UNINSTALL', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'uninstall-failed' });
  }
});

app.post('/api/plugins/:id/toggle', (req, res) => {
  const eng = getEngine();
  try {
    const enabled = eng.pluginRegistry.toggle(req.params['id']!);
    res.json({ enabled });
  } catch (e: unknown) {
    getLogger().error('POST_API_PLUGINS_ID_TOGGLE', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'toggle-failed' });
  }
});

app.get('/api/plugins/:id', (req, res) => {
  const eng = getEngine();
  const plugin = eng.pluginRegistry.getPlugin(req.params['id']!);
  if (!plugin) {
    res.status(404).json({ error: 'Plugin not installed' });
    return;
  }
  res.json({ plugin });
});

app.put('/api/plugins/:id/config', (req, res) => {
  const eng = getEngine();
  const { config } = req.body as { config?: Record<string, unknown> };
  if (!config) {
    res.status(400).json({ error: 'config object required' });
    return;
  }
  try {
    const plugin = eng.pluginRegistry.updateConfig(req.params['id']!, config);
    res.json({ plugin });
  } catch (e: unknown) {
    getLogger().error('PUT_API_PLUGINS_ID_CONFIG', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'config-failed' });
  }
});

// ───── PostgreSQL Plugin ─────
app.post('/api/plugins/postgresql/test-connection', async (req, res) => {
  const { connectionString } = req.body as { connectionString?: string };
  if (!connectionString) {
    res.status(400).json({ error: 'connectionString required' });
    return;
  }
  try {
    // Dynamically import pg to avoid requiring it during typecheck in environments
    // where pg is not installed. This will throw at runtime if pg is missing.
     
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString, max: 1 });
    const client = await pool.connect();
    const result = await client.query('SELECT version() as version');
    const pgVersion = result.rows[0]?.['version'] as string;
    client.release();
    await pool.end();
    res.json({ ok: true, version: pgVersion || 'connected' });
  } catch (e: unknown) {
    getLogger().error('POST_API_PLUGINS_POSTGRESQL_TEST_CONNECTION', e instanceof Error ? e : String(e));    res.status(400).json({ error: e instanceof Error ? e.message : 'connection-failed' });
  }
});

app.get('/api/plugins/postgresql/comparison', (_req, res) => {
  res.json({
    comparison: [
      {
        feature: 'Setup',
        sqlite: 'Zero-config, embedded in app data directory',
        postgresql: 'Requires external PostgreSQL server, connection string',
      },
      {
        feature: 'Concurrency',
        sqlite: 'Single-writer, limited concurrent reads',
        postgresql: 'Full concurrent read/write with connection pooling',
      },
      {
        feature: 'Storage Limit',
        sqlite: '~140TB theoretical, but degrades past ~100GB',
        postgresql: 'Petabyte-scale, enterprise-grade',
      },
      {
        feature: 'Performance',
        sqlite: 'Fast for local single-user use',
        postgresql: 'Optimized for multi-user, parallel queries',
      },
      {
        feature: 'User Management',
        sqlite: 'File-system permissions only',
        postgresql: 'Role-based access control, SSL, auth methods',
      },
      {
        feature: 'Replication',
        sqlite: 'None (file copy backup)',
        postgresql: 'Streaming replication, logical replication, hot standby',
      },
      {
        feature: 'Cloud Deployment',
        sqlite: 'Not suitable (file-locking issues)',
        postgresql: 'Native support on AWS RDS, Azure DB, GCP Cloud SQL',
      },
      {
        feature: 'Backup & Restore',
        sqlite: 'File-level copy',
        postgresql: 'pg_dump, pg_backrest, WAL archiving, point-in-time recovery',
      },
      {
        feature: 'Migration',
        sqlite: 'N/A (default storage)',
        postgresql: 'Automatic schema migration on connect',
      },
    ],
  });
});

// ───── Danger zone ─────
app.delete('/api/sessions', (_req, res) => {
  try {
    const eng = getEngine();
    const store = (eng.sessionManager as unknown as { store: { clearAll: () => void } }).store;
    store.clearAll();
    res.json({ ok: true });
  } catch (e: unknown) {
    getLogger().error('DELETE_API_SESSIONS', e instanceof Error ? e : String(e));    res.status(500).json({ error: e instanceof Error ? e.message : 'clear-failed' });
  }
});

app.post('/api/reset', (_req, res) => {
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
      try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ok */ }
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

// ───── Global Error Handler ─────
// Must be registered after all routes. Catches any unhandled errors from API routes
// and returns a consistent JSON error envelope instead of an HTML 500.
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const requestId = (req as any).requestId ?? 'unknown';
  getLogger().error('UNHANDLED_ERROR', err, { requestId, path: req.path, method: req.method });
  // Don't send error details in production to avoid leaking internals
  res.status(500).json({
    status: 'error',
    code: 'INTERNAL_ERROR',
    message: process.env['NODE_ENV'] === 'production' ? 'An unexpected error occurred' : err.message,
    requestId,
  });
});

// ─── Debug Log Endpoint ────────────────────────────────────────────
// Accept frontend-side parse errors so developers can see raw API output
app.post('/api/debug/log', (req, res) => {
  try {
    const DATA_DIR = getDataDir();
    const DEBUG_DIR = join(DATA_DIR, 'debug-logs');
    if (!existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(join(DEBUG_DIR, `frontend_${ts}.json`), JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: 'invalid-log-entry' });
  }
});

// ───── Static file serve ─────
const UI_PROXY_URL = process.env['AGENTX_UI_PROXY_URL'] || 'http://localhost:5173';

// Serve web-neuron brain visualization from /neuron
app.get('/neuron*', (req, res, next) => {
  const subPath = req.path === '/neuron' || req.path === '/neuron/' ? 'index.html' : req.path.slice('/neuron/'.length);
  const fullPath = join(NEURON_DIST, subPath);
  if (existsSync(fullPath)) {
    res.sendFile(fullPath);
  } else {
    const index = join(NEURON_DIST, 'index.html');
    if (existsSync(index)) {
      res.sendFile(index);
    } else {
      next();
    }
  }
});

app.get('*', async (req, res, next) => {
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
  const fullPath = join(UI_DIST, filePath);
  if (existsSync(fullPath)) {
    res.sendFile(fullPath);
  } else {
    // SPA fallback
    const index = join(UI_DIST, 'index.html');
    if (existsSync(index)) {
      res.sendFile(index);
    } else {
      next();
    }
  }
});

// ───── Server ─────
const server = createServer(app);
setupWebSocket(server);
setupVoiceWebSocket(server);
attachWebSocketUpgradeRouter(server);

export { app, server };

export function startServer(port = PORT): ReturnType<typeof server.listen> {
  const publicUrl = (process.env['AGENTX_PUBLIC_URL'] ?? `http://localhost:${port}`).replace(/\/$/, '');
  getEngine().integrationHub.setRedirectBaseUrl(publicUrl);

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Is another Agent-X instance running?`);
    } else {
      console.error('Server error:', err.message);
    }
  });

  let shuttingDown = false;
  const shutdownHandlers: Array<() => void> = [];

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    const log = getLogger();
    log.info('SHUTDOWN', `Received ${signal}. Starting graceful shutdown...`);

    // 1. Stop accepting new connections immediately
    server.close(() => {
      log.info('SHUTDOWN', 'HTTP server closed.');
    });

    // 2. Drain active SSE and WebSocket connections with timeout
    const forceExit = setTimeout(() => {
      log.warn('SHUTDOWN', 'Forced exit after drain timeout (30s).');
      closeLogger();
      process.exit(1);
    }, 30000);
    forceExit.unref();

    // 3. Close session manager (flushes DB, checkpoints WAL)
    try {
      const eng = getEngine();
      if (eng?.sessionManager) {
        eng.sessionManager.close();
        log.info('SHUTDOWN', 'Session manager closed.');
      }
      if (eng?.integrationHub) {
        void eng.integrationHub.dispose().catch(() => {});
        log.info('SHUTDOWN', 'Integration hub disposed.');
      }
      // Stop bridge connections
      if (eng?.telegramBridge) { try { eng.telegramBridge.stop(); } catch {} }
      if (eng?.discordBridge) { try { eng.discordBridge.stop(); } catch {} }
      if (eng?.slackBridge) { try { eng.slackBridge.stop(); } catch {} }
      if (eng?.emailBridge) { try { eng.emailBridge.stop(); } catch {} }
      log.info('SHUTDOWN', 'Bridges stopped.');
    } catch (e) { /* best-effort */ }

    // 4. Stop background ingestion worker and periodic handlers
    for (const handler of shutdownHandlers) { try { handler(); } catch {} }
    ingestionWorker?.stop();
    void shutdownAutomation().catch(() => {});
    void shutdownVoiceWebSocket().catch(() => {});
    shutdownAgentXOverviewBridge();
    // 5. Flush log buffer and exit
    stopGlobalRateLimitCleanup();
    closeLogger();
    clearTimeout(forceExit);
    process.exit(0);
  };

  // Start periodic cleanup of rate limit stores
  startGlobalRateLimitCleanup();

  // Start background ingestion job worker (Group 3 + 4 + C3): uses ingestion_jobs queue with FOR UPDATE SKIP LOCKED
  let ingestionWorker: IngestionWorker | null = null;
  setIngestionWorkerRef(null);
  bindIngestionWorker(null);
  try {
    const eng = getEngine();
    const pgPool = (eng as any).pgPool ?? (eng as any).pool;
    const ramGb = os.totalmem() / (1024 ** 3);
    const hardwareSupportsNeural = isNeuralBrainSupported(ramGb);
    let neuralBrainDisabled = !hardwareSupportsNeural;
    try {
      const cfg = eng.configManager.load();
      if (cfg.neuralBrain === false) neuralBrainDisabled = true;
    } catch { /* config not ready — proceed as normal */ }
    setIngestionNeuralBrainEnabled(!neuralBrainDisabled);
    if (pgPool && !neuralBrainDisabled) {
      getLogger().info('INGESTION_WORKER', 'Neural brain enabled — ingestion worker registered (governor controls run/pause).');
      const fabric = new MemoryFabric(pgPool as any);
      const embedder = new OnnxEmbeddingProvider();
      setMemoryFabricInstance(fabric);
      setEmbedderInstance(embedder);
      void backfillChatMemoryFromSessions(pgPool as any, fabric, embedder).catch(() => { /* best-effort */ });
      ingestionWorker = new IngestionWorker(pgPool as any, fabric, {
        concurrency: 1,
        pollIntervalMs: 10000,
        embed: (text) => embedder.embed(text),
        generate: null,
        embedder,
      });
      setIngestionWorkerRef(ingestionWorker);
      bindIngestionWorker(ingestionWorker);
      ingestionWorker.start();
      ingestionWorker.pause();

      const queue = new IngestionQueue(pgPool as any);
      let graphRagAvailable = false;
      void (async () => {
        try {
          await eng.storageReady;
        } catch { /* storage may have failed — proceed best-effort */ }
        try {
          const graphRagGenerate = await buildGraphRagSummarizer();
          if (graphRagGenerate && ingestionWorker) {
            ingestionWorker.setGenerate(graphRagGenerate);
            graphRagAvailable = true;
          }
        } catch { /* best-effort — will retry after user login */ }
        await refreshIngestionRagSourceCount(pgPool as any);
        evaluateIngestionWorker();
        if (!getIngestionGovernorState().shouldRun) {
          getLogger().info('INGESTION_WORKER', 'Worker idle — waiting for app visibility and RAG sources');
          return;
        }
        try {
          await queue.enqueue({ kind: 'web_distill', priority: 1 });
          await queue.enqueue({ kind: 'memory_consolidate', priority: 1 });
          await queue.enqueue({ kind: 'louvain_layout', priority: 0 });
          if (graphRagAvailable) {
            await queue.enqueue({ kind: 'community_summarize', priority: 0 });
          }
          await fabric.cleanupExpiredWebStaging();
        } catch (e: unknown) {
          getLogger().warn('INGESTION_SEED', e instanceof Error ? e.message : String(e));
        }
      })();

      const periodicInterval = setInterval(async () => {
        if (!getIngestionGovernorState().shouldRun) return;
        try {
          await refreshIngestionRagSourceCount(pgPool as any);
          if (!getIngestionGovernorState().shouldRun) return;
          if (!await queue.hasActiveJob('web_distill')) {
            await queue.enqueue({ kind: 'web_distill', priority: 1 });
          }
          if (!await queue.hasActiveJob('memory_consolidate')) {
            await queue.enqueue({ kind: 'memory_consolidate', priority: 1 });
          }
          if (!await queue.hasActiveJob('louvain_layout')) {
            await queue.enqueue({ kind: 'louvain_layout', priority: 0 });
          }
          if (graphRagAvailable && !await queue.hasActiveJob('community_summarize')) {
            await queue.enqueue({ kind: 'community_summarize', priority: 0 });
          }
          await fabric.cleanupExpiredWebStaging();
        } catch (e: unknown) {
          getLogger().warn('INGESTION_SEED', e instanceof Error ? e.message : String(e));
        }
      }, 120_000);
      shutdownHandlers.push(() => clearInterval(periodicInterval));

      // Wire web search results into the two-tier web staging table (Group 3)
      setDeepSearchStageResult(async (result) => {
        try {
          await fabric.stageWebPayload(
            result.url,
            result.domain,
            result.contentType,
            result,
          );
          await queue.enqueue({ kind: 'web_distill', priority: 2 });
        } catch (e: unknown) {
          getLogger().warn('WEB_STAGING', e instanceof Error ? e.message : String(e));
        }
      });
    } else if (neuralBrainDisabled) {
      getLogger().info('INGESTION_WORKER', 'Neural brain disabled — skipping ingestion worker startup.');
    }
  } catch (e: unknown) {
    getLogger().warn('INGESTION_WORKER', e instanceof Error ? e.message : String(e));
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGQUIT', () => shutdown('SIGQUIT'));

  return server.listen(port, HOST, () => {
    console.log(`Agent-X web API listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${port}`);
    initAgentXOverviewBridge();
    void bootstrapAutomationFromEngine().catch((e: unknown) => {
      getLogger().warn('AUTOMATION', e instanceof Error ? e.message : String(e));
    });
    // Channel bridges need decrypted config (DEK) — started from setEngineDEK after sign-in.
    // If DEK is already available (e.g. resumed session), bootstrap once storage is ready.
    void (async () => {
      try {
        await awaitEngineStorageReady();
        const eng = getEngine();
        if (eng.dek && eng.configured) {
          await applyChannelsConfig();
        }
      } catch (e: unknown) {
        getLogger().warn('CHANNELS', e instanceof Error ? e.message : String(e));
      }
    })();
  });
}

// Auto-start if this is the main module
if (process.env['AGENTX_TEST'] !== 'true') {
  ensureLoginShellPath();
  startServer();
}
