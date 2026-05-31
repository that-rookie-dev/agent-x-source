import express from 'express';
import type { Express } from 'express';
import multer from 'multer';
import { createServer } from 'node:http';
import { join, dirname, basename } from 'node:path';
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, createReadStream, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { generateId } from '@agentx/shared';
import { getEngine, createAgent, destroyAgent, clearEngine } from './engine.js';
import { setupWebSocket, ensureSubscribed } from './ws.js';
import { ProviderFactory } from '@agentx/engine';
import type { ProviderId, AgentXConfig, CompletionRequest } from '@agentx/shared';

const PORT = Number(process.env['PORT']) || 3333;
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..', '..');
const UI_DIST = join(ROOT, 'web-ui', 'dist');

const HOME = homedir();
const DATA_DIR = process.env['XDG_DATA_HOME']
  ? join(process.env['XDG_DATA_HOME'], 'agentx')
  : join(HOME, '.local', 'share', 'agentx');
const SESSIONS_DIR = join(DATA_DIR, 'sessions');

function getSessionDir(sessionId: string): string {
  return join(SESSIONS_DIR, sessionId);
}

function ensureSessionDir(sessionId: string): string {
  const dir = getSessionDir(sessionId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    const files = ['context.txt', 'memories.txt', 'pending.txt', 'completed.txt', 'suggestions.txt', 'conversation.json'];
    for (const f of files) {
      const fp = join(dir, f);
      if (!existsSync(fp)) {
        const initial = f === 'conversation.json' ? '[]' : '';
        writeFileSync(fp, initial, 'utf-8');
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

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 50 * 1024 * 1024 },
});
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });

// CORS + cache prevention
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Content-Disposition');
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
  } catch { /* engine init may fail before setup — still report healthy */ }
  let sessionCount = 0;
  let crewCount = 0;
  let agentActive = false;
  let configInfo: Record<string, unknown> = {};
  if (eng) {
    try {
      const sessions = eng.sessionManager.listSessions(9999);
      sessionCount = sessions.length;
    } catch { /* ignore */ }
    try {
      const crews = eng.crewManager.list();
      crewCount = crews.length;
    } catch { /* ignore */ }
    try {
      const cfg = eng.configManager.load();
      configInfo = { provider: cfg.provider.activeProvider, model: cfg.provider.activeModel, user: cfg.user?.callsign || null };
    } catch { /* ignore */ }
    agentActive = !!eng.agent;
  }
  res.json({
    status: 'ok',
    pid: process.pid,
    node: process.version,
    platform: process.platform,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    config: configInfo,
    sessions: sessionCount,
    crews: crewCount,
    agentActive,
  });
});

// ───── Setup / Config ─────
app.get('/api/setup/status', (_req, res) => {
  try {
    const eng = getEngine();
    const complete = eng.configManager.isSetupComplete();
    const configured = eng.configManager.isConfigured();
    res.json({ setupComplete: complete, configured });
  } catch {
    res.json({ setupComplete: false, configured: false });
  }
});

app.get('/api/config', (_req, res) => {
  const eng = getEngine();
  try {
    res.json(eng.configManager.load());
  } catch {
    res.json({ provider: { activeProvider: 'openai', activeModel: 'gpt-4o-mini', providers: {} }, ui: { theme: 'dark', showTokenBar: true, showTimers: true, animationSpeed: 'normal' }, organization: null, telemetry: false });
  }
});

app.put('/api/config', (req, res) => {
  const eng = getEngine();
  try {
    const existing = eng.configManager.load();
    const merged = { ...existing, ...req.body };
    eng.configManager.save(merged);
    res.json({ ok: true });
  } catch {
    eng.configManager.save(req.body);
    res.json({ ok: true });
  }
});

// ───── Providers ─────
const AVAILABLE_PROVIDERS = [
  { id: 'openai', name: 'OpenAI', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', name: 'Anthropic', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://api.anthropic.com' },
  { id: 'google', name: 'Google', type: 'cloud', requiresApiKey: true, defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'ollama', name: 'Ollama', type: 'local', requiresApiKey: false, defaultBaseUrl: 'http://localhost:11434' },
  { id: 'lmstudio', name: 'LM Studio', type: 'local', requiresApiKey: false, defaultBaseUrl: 'http://localhost:1234/v1' },
];

app.get('/api/providers/available', (_req, res) => {
  res.json({ providers: AVAILABLE_PROVIDERS });
});

app.post('/api/provider/validate', async (req, res) => {
  try {
    const { provider, apiKey, baseUrl } = req.body as { provider: string; apiKey?: string; baseUrl?: string };
    const prov = ProviderFactory.create(provider as ProviderId, apiKey, baseUrl);
    const valid = await prov.validate();
    if (valid) {
      res.json({ valid: true, provider: prov.id, name: prov.name });
    } else {
      res.status(400).json({ valid: false, error: 'provider-unreachable' });
    }
  } catch (e: unknown) {
    res.status(400).json({ valid: false, error: e instanceof Error ? e.message : 'unknown-error' });
  }
});

app.get('/api/provider/models', async (req, res) => {
  try {
    const providerId = (req.query['provider'] as string) || '';
    let apiKey = (req.query['apiKey'] as string) || undefined;
    let baseUrl = (req.query['baseUrl'] as string) || undefined;
    if (!apiKey && !baseUrl) {
      try {
        const eng = getEngine();
        const cfg = eng.configManager.load();
        const creds = cfg.provider.providers[providerId];
        if (creds?.activeProfile && creds.profiles?.[creds.activeProfile]) {
          const active = creds.profiles[creds.activeProfile] as { apiKey?: string; baseUrl?: string } | undefined;
          if (active) {
            apiKey = active.apiKey;
            baseUrl = active.baseUrl;
          }
        }
      } catch { /* use provided values */ }
    }
    const prov = ProviderFactory.create(providerId as ProviderId, apiKey, baseUrl);
    const models = await prov.listModels();
    res.json(models);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'failed-to-list-models' });
  }
});

app.post('/api/provider/configure', (req, res) => {
  try {
    const { provider, apiKey, baseUrl } = req.body as { provider: string; apiKey?: string; baseUrl?: string };
    destroyAgent();
    const eng = getEngine();

    let config: AgentXConfig;
    try {
      config = eng.configManager.load();
    } catch {
      config = { provider: { activeProvider: provider as ProviderId, activeModel: '', providers: {} }, ui: { theme: 'dark', showTokenBar: true, showTimers: true, animationSpeed: 'normal' }, organization: null, telemetry: false };
    }

    config.provider.activeProvider = provider as ProviderId;
    const providerCfg = config.provider.providers[provider] ?? { configured: false };
    if (apiKey) providerCfg.apiKey = apiKey;
    if (baseUrl) providerCfg.baseUrl = baseUrl;
    providerCfg.configured = true;
    config.provider.providers[provider] = providerCfg;

    eng.configManager.save(config);

    // Create a profile for this provider configuration
    const profileId = (req.body as Record<string, string>).profileName || 'default';
    eng.configManager.addProviderProfile(provider, profileId, {
      label: profileId,
      apiKey,
      baseUrl,
      createdAt: new Date().toISOString(),
    }, true);
    const cfg = eng.configManager.load();
    cfg.provider.activeProvider = provider as ProviderId;
    eng.configManager.save(cfg);

    res.json({ ok: true, provider });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'save-failed' });
  }
});

app.get('/api/providers', (_req, res) => {
  const eng = getEngine();
  try {
    const config = eng.configManager.load();
    const configured: Array<{ id: string; configured: boolean; apiKey?: string; baseUrl?: string; profiles?: string[]; activeProfile?: string }> = [];
    for (const [id, creds] of Object.entries(config.provider.providers)) {
      if (creds.configured) {
        const entry: { id: string; configured: boolean; apiKey?: string; baseUrl?: string; profiles?: string[]; activeProfile?: string } = {
          id, configured: true, apiKey: creds.apiKey, baseUrl: creds.baseUrl,
        };
        if (creds.profiles) entry.profiles = Object.keys(creds.profiles);
        if (creds.activeProfile) entry.activeProfile = creds.activeProfile;
        configured.push(entry);
      }
    }
    res.json({ active: config.provider.activeProvider, providers: configured });
  } catch {
    res.json({ active: 'openai', providers: [] });
  }
});

app.post('/api/provider/profile', (req, res) => {
  try {
    const { provider, profileId, label, apiKey, baseUrl, setActive } = req.body as {
      provider: string; profileId: string; label?: string; apiKey?: string; baseUrl?: string; setActive?: boolean;
    };
    const eng = getEngine();
    eng.configManager.addProviderProfile(provider, profileId, {
      label: label || profileId,
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
    res.status(400).json({ error: e instanceof Error ? e.message : 'profile-add-failed' });
  }
});

app.post('/api/provider/profile/switch', (req, res) => {
  try {
    const { provider, profileId } = req.body as { provider: string; profileId: string };
    const eng = getEngine();
    eng.configManager.setActiveProviderProfile(provider, profileId);
    destroyAgent();
    createAgent();
    res.json({ ok: true, provider, profileId });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'switch-failed' });
  }
});

// ───── Models ─────
app.post('/api/model/switch', (req, res) => {
  try {
    const { modelId, contextWindow } = req.body as { modelId: string; contextWindow?: number };
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
    agent.switchModel(modelId, contextWindow);
    try {
      const config = eng.configManager.load();
      config.provider.activeModel = modelId;
      eng.configManager.save(config);
    } catch {
      // config not yet saved, that's fine
    }
    res.json({ ok: true, model: modelId });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'switch-failed' });
  }
});

app.post('/api/model/trial', async (req, res) => {
  try {
    const { modelId } = req.body as { modelId: string };
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) { res.status(400).json({ ok: false, error: 'no-session' }); return; }
    const ok = await agent.trialModel(modelId);
    res.json({ ok, model: modelId });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: e instanceof Error ? e.message : 'trial-failed' });
  }
});

app.get('/api/models', async (_req, res) => {
  try {
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
    await agent.listModels();
    const config = eng.configManager.load();
    res.json({ currentModel: config.provider.activeModel });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'failed' });
  }
});

// ───── Crews ─────
app.get('/api/crews', (_req, res) => {
  const eng = getEngine();
  const crews = eng.crewManager.list();
  const activeId = eng.crewManager.getActiveId();
  res.json({ crews, activeId });
});

app.get('/api/crew/current', (_req, res) => {
  const eng = getEngine();
  res.json(eng.crewManager.getActive());
});

app.post('/api/crew/switch', (req, res) => {
  try {
    const { id } = req.body as { id: string };
    const eng = getEngine();
    const switched = eng.crewManager.switch(id);
    if (!switched) { res.status(404).json({ error: 'crew-not-found' }); return; }
    if (eng.agent) {
      eng.agent.rebuildSystemPrompt();
    }
    res.json({ ok: true, crew: switched });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'switch-failed' });
  }
});

app.post('/api/crews', (req, res) => {
  try {
    const { id, name, systemPrompt, emotion, isDefault } = req.body as {
      id: string; name: string; systemPrompt: string; emotion?: string; isDefault?: boolean;
    };
    const eng = getEngine();
    const crew = eng.crewManager.create({
      id,
      name,
      systemPrompt,
      emotion: emotion as 'professional' | 'friendly' | 'witty' | 'kind' | 'funny' | 'arrogant' | 'flirty' | 'happy' | 'sad' | 'sarcastic' | undefined,
      isDefault,
    });
    res.json(crew);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'create-failed' });
  }
});

app.put('/api/crews/:id', (req, res) => {
  try {
    const eng = getEngine();
    const crew = eng.crewManager.update(req.params['id']!, req.body);
    if (!crew) { res.status(404).json({ error: 'crew-not-found' }); return; }
    res.json(crew);
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'update-failed' });
  }
});

app.delete('/api/crews/:id', (req, res) => {
  try {
    const eng = getEngine();
    const ok = eng.crewManager.delete(req.params['id']!);
    if (!ok) { res.status(400).json({ error: 'cannot-delete' }); return; }
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'delete-failed' });
  }
});

// ───── Chat ─────
app.post('/api/chat/message', async (req, res) => {
  try {
    const { text } = req.body as { text: string };
    if (!text || typeof text !== 'string') { res.status(400).json({ error: 'text-required' }); return; }
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
    ensureSubscribed();
    const message = await agent.sendMessage(text);
    res.json({ ok: true, message });
  } catch (e: unknown) {
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
  } catch {
    res.status(500).json({ error: 'cancel-failed' });
  }
});

app.get('/api/chat/history', (_req, res) => {
  try {
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) { res.json([]); return; }
    const history = agent.getMessageHistory();
    res.json(history);
  } catch {
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
  } catch {
    res.status(500).json({ error: 'clear-failed' });
  }
});

// ───── SSE Chat Stream ─────
app.get('/api/chat/stream', (req, res) => {
  const eng = getEngine();
  const agent = eng.agent;
  if (!agent) { res.status(400).json({ error: 'no-session' }); return; }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent('connected', { timestamp: new Date().toISOString() });

  const unsub = eng.telemetry.onEvent((ev) => {
    sendEvent('telemetry', ev);
  });

  req.on('close', () => {
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

// ───── Permissions ─────
app.post('/api/permission/respond', (req, res) => {
  try {
    const { choice } = req.body as { choice: 'allow_once' | 'allow_always' | 'deny' };
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
    agent.respondToPermission(choice);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'respond-failed' });
  }
});

// ───── Sessions ─────
app.get('/api/sessions', (_req, res) => {
  const eng = getEngine();
  const sessions = eng.sessionManager.listSessions(50);
  res.json(sessions);
});

app.post('/api/sessions', (_req, res) => {
  try {
    destroyAgent();
    const agent = createAgent();
    const sessionId = (agent as unknown as { sessionId: string }).sessionId;
    ensureSessionDir(sessionId);
    res.json({ sessionId });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'create-failed' });
  }
});

app.get('/api/sessions/:id', (req, res) => {
  const eng = getEngine();
  const session = eng.sessionManager.restoreSession(req.params['id']!);
  if (!session) { res.status(404).json({ error: 'not-found' }); return; }
  res.json(session);
});

app.delete('/api/sessions/:id', (req, res) => {
  try {
    const eng = getEngine();
    const store = (eng.sessionManager as unknown as { store: { deleteSession: (id: string) => void } }).store;
    store.deleteSession(req.params['id']!);
    // Clean up session folder on disk
    const dir = getSessionDir(req.params['id']!);
    if (existsSync(dir)) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'delete-failed' });
  }
});

app.post('/api/sessions/:id/restore', (req, res) => {
  try {
    const eng = getEngine();
    destroyAgent();
    const session = eng.sessionManager.restoreSession(req.params['id']!);
    if (!session) { res.status(404).json({ error: 'not-found' }); return; }
    createAgent();
    const store = (eng.sessionManager as unknown as { store: { getMessages: (id: string) => Record<string, unknown>[] } }).store;
    const messages = store.getMessages(req.params['id']!);
    res.json({ session, messages });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'restore-failed' });
  }
});

// ───── Session Context Files ─────
app.get('/api/sessions/:id/context', (req, res) => {
  try {
    const dir = getSessionDir(req.params['id']!);
    if (!existsSync(dir)) { res.json({ context: '', memories: '', pending: '', completed: '', suggestions: '' }); return; }
    const files = ['context.txt', 'memories.txt', 'pending.txt', 'completed.txt', 'suggestions.txt'];
    const result: Record<string, string> = {};
    for (const f of files) {
      const fp = join(dir, f);
      try { result[f.replace('.txt', '')] = readFileSync(fp, 'utf-8'); } catch { result[f.replace('.txt', '')] = ''; }
    }
    res.json(result);
  } catch {
    res.status(500).json({ error: 'context-read-failed' });
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
  } catch {
    res.status(500).json({ error: 'context-write-failed' });
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
      } catch {
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
    } catch { /* ignore */ }

    res.json({ ok: true, summary });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'compact-failed' });
  }
});

// ───── Telegram ─────
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
    res.json({ ok: true, message: 'Token saved. Telegram plugin configured.' });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'save-failed' });
  }
});

app.post('/api/telegram/stop', (_req, res) => {
  try {
    const eng = getEngine();
    if (eng.pluginRegistry.isInstalled('telegram')) {
      eng.pluginRegistry.uninstall('telegram');
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'clear-failed' });
  }
});

app.get('/api/telegram/status', (_req, res) => {
  const eng = getEngine();
  const plugin = eng.pluginRegistry.getPlugin('telegram');
  const configured = !!plugin?.enabled && !!plugin?.config?.['botToken'];
  res.json({ configured, botToken: configured ? '***configured***' : null });
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
  res.json(tools);
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
  } catch {
    res.status(500).json({ error: 'tool-update-failed' });
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
    res.status(500).json({ error: e instanceof Error ? e.message : 'index-failed' });
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
    res.status(500).json({ error: e instanceof Error ? e.message : 'search-failed' });
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
    res.status(500).json({ error: e instanceof Error ? e.message : 'delete-failed' });
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
    res.status(500).json({ error: e instanceof Error ? e.message : 'clear-failed' });
  }
});

// ───── File Upload ─────
app.post('/api/files/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  const fileId = generateId('file_');
  const ext = basename(req.file.originalname).split('.').pop() ?? '';
  const destName = `${fileId}.${ext}`;
  const destPath = join(UPLOADS_DIR, destName);
  if (existsSync(req.file.path)) {
    renameSync(req.file.path, destPath);
  }
  res.json({
    id: fileId,
    originalName: req.file.originalname,
    size: req.file.size,
    mimeType: req.file.mimetype,
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
            try { meta = JSON.parse(readFileSync(metaPath, 'utf-8')); } catch { /* skip */ }
          }
          return {
            id: e.replace(/\.[^.]+$/, ''),
            name: (meta['originalName'] as string) ?? e,
            size: st.size,
            createdAt: st.birthtime.toISOString(),
          };
        } catch { return null; }
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);
    res.json({ files });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'list-files-failed' });
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
    res.status(500).json({ error: e instanceof Error ? e.message : 'delete-failed' });
  }
});

// ───── Scheduler / Reminders ─────
app.get('/api/scheduler/jobs', (_req, res) => {
  const eng = getEngine();
  if (!eng.agent) {
    res.json({ jobs: [] });
    return;
  }
  try {
    const jobs = eng.agent.cron.getJobs();
    res.json({ jobs });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'list-jobs-failed' });
  }
});

app.post('/api/scheduler/jobs', (req, res) => {
  const eng = getEngine();
  if (!eng.agent) {
    res.status(400).json({ error: 'No active agent' });
    return;
  }
  const { name, cron, instruction } = req.body as { name?: string; cron?: string; instruction?: string };
  if (!name || !cron || !instruction) {
    res.status(400).json({ error: 'name, cron, and instruction are required' });
    return;
  }
  try {
    const job = eng.agent.cron.addJob(name, cron, instruction);
    res.json({ job });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'add-job-failed' });
  }
});

app.delete('/api/scheduler/jobs/:id', (req, res) => {
  const eng = getEngine();
  if (!eng.agent) {
    res.status(400).json({ error: 'No active agent' });
    return;
  }
  try {
    eng.agent.cron.removeJob(req.params['id']!);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'remove-job-failed' });
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
    res.status(500).json({ error: e instanceof Error ? e.message : 'create-plan-failed' });
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
        try { planOrchestratorById.delete(req.params['id']!); } catch { /* ignore */ }
        res.json({ plan: result });
        return;
      } catch (e) {
        // If stored orchestrator failed, continue to fallback creation
        try { planOrchestratorById.delete(req.params['id']!); } catch { /* ignore */ }
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
    res.status(500).json({ error: e instanceof Error ? e.message : 'execute-plan-failed' });
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
    res.status(400).json({ error: e instanceof Error ? e.message : 'install-failed' });
  }
});

app.post('/api/plugins/:id/uninstall', (req, res) => {
  const eng = getEngine();
  try {
    eng.pluginRegistry.uninstall(req.params['id']!);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'uninstall-failed' });
  }
});

app.post('/api/plugins/:id/toggle', (req, res) => {
  const eng = getEngine();
  try {
    const enabled = eng.pluginRegistry.toggle(req.params['id']!);
    res.json({ enabled });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'toggle-failed' });
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
    res.status(400).json({ error: e instanceof Error ? e.message : 'config-failed' });
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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString, max: 1 });
    const client = await pool.connect();
    const result = await client.query('SELECT version() as version');
    const pgVersion = result.rows[0]?.['version'] as string;
    client.release();
    await pool.end();
    res.json({ ok: true, version: pgVersion || 'connected' });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'connection-failed' });
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

// ── MCP API routes (3.4.x) ──────────────────────────────────────

app.get('/api/mcp/servers', (_req, res) => {
  try {
    const eng = getEngine();
    const servers = eng.mcpBridge.getServerStatus();
    res.json({ servers });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'mcp-list-failed' });
  }
});

app.post('/api/mcp/servers', (req, res) => {
  try {
    const { name, command, args, env, timeout, permissionLevel, maxOutputSize } = req.body as {
      name: string; command: string; args?: string[]; env?: Record<string, string>;
      timeout?: number; permissionLevel?: string; maxOutputSize?: number;
    };
    if (!name || !command) {
      res.status(400).json({ error: 'name and command are required' });
      return;
    }
    const eng = getEngine();
    eng.mcpBridge.updateServerConfig(name, {
      command,
      args: args ?? [],
      env,
      enabled: true,
      timeout,
      permissionLevel: permissionLevel as 'low' | 'medium' | 'high' | 'critical' | undefined,
      maxOutputSize,
    });
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'mcp-add-failed' });
  }
});

app.post('/api/mcp/servers/:id/restart', async (req, res) => {
  try {
    const eng = getEngine();
    await eng.mcpBridge.unload(req.params.id);
    const manifest = { id: `mcp:${req.params.id}`, name: `MCP:${req.params.id}`, version: '0.1.0', description: '', source: 'mcp' as const, tools: [] };
    await eng.mcpBridge.load(manifest);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'mcp-restart-failed' });
  }
});

app.get('/api/mcp/servers/:id/status', (req, res) => {
  try {
    const eng = getEngine();
    const status = eng.mcpBridge.getServerStatus();
    const server = status.find((s) => s.name === req.params.id);
    if (!server) {
      res.status(404).json({ error: 'MCP server not found' });
      return;
    }
    res.json({ server });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'mcp-status-failed' });
  }
});

app.get('/api/mcp/servers/:id/tools', (req, res) => {
  try {
    const eng = getEngine();
    const status = eng.mcpBridge.getServerStatus();
    const server = status.find((s) => s.name === req.params.id);
    if (!server) {
      res.status(404).json({ error: 'MCP server not found' });
      return;
    }
    res.json({ tools: server.toolCount });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'mcp-tools-failed' });
  }
});

app.delete('/api/mcp/servers/:id', (req, res) => {
  try {
    const eng = getEngine();
    eng.mcpBridge.unload(req.params.id).catch(() => {});
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'mcp-delete-failed' });
  }
});

// ───── Danger zone ─────
app.delete('/api/sessions', (_req, res) => {
  try {
    const eng = getEngine();
    const store = (eng.sessionManager as unknown as { store: { clearAll: () => void } }).store;
    store.clearAll();
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'clear-failed' });
  }
});

app.post('/api/reset', (_req, res) => {
  try {
    destroyAgent();

    const HOME = homedir();
    const configDir = process.env['XDG_CONFIG_HOME']
      ? join(process.env['XDG_CONFIG_HOME'], 'agentx')
      : join(HOME, '.config', 'agentx');
    const dataDir = process.env['XDG_DATA_HOME']
      ? join(process.env['XDG_DATA_HOME'], 'agentx')
      : join(HOME, '.local', 'share', 'agentx');
    const cacheDir = process.env['XDG_CACHE_HOME']
      ? join(process.env['XDG_CACHE_HOME'], 'agentx')
      : join(HOME, '.cache', 'agentx');

    // Delete everything on disk
    const dirs = [configDir, dataDir, cacheDir];
    for (const dir of dirs) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }

    clearEngine();

    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'reset-failed' });
  }
});

// ───── Static file serve ─────
const UI_PROXY_URL = process.env['AGENTX_UI_PROXY_URL'] || 'http://localhost:5173';

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
    } catch {
      res.status(502).json({ error: 'ui-proxy-failed' });
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

export { app, server };

export function startServer(port = PORT): ReturnType<typeof server.listen> {
  return server.listen(port, () => {
    console.log(`Agent-X web API listening on http://localhost:${port}`);
  });
}

// Auto-start if this is the main module
if (process.env['AGENTX_TEST'] !== 'true') {
  startServer();
}
