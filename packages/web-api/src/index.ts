import express from 'express';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getEngine, createAgent, getOrCreateAgent, destroyAgent } from './engine.js';
import { setupWebSocket, ensureSubscribed } from './ws.js';
import { ProviderFactory, TelegramStore, ConfigManager } from '@agentx/engine';
import type { ProviderId, AgentXConfig } from '@agentx/shared';

const PORT = Number(process.env['PORT']) || 3333;
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..', '..');
const UI_DIST = join(ROOT, 'web-ui', 'dist');

const app = express();
app.use(express.json());

// CORS
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

// ───── Health ─────
app.get('/api/health', (_req, res) => {
  const eng = getEngine();
  let sessionCount = 0;
  let crewCount = 0;
  try {
    const sessions = eng.sessionManager.listSessions(9999);
    sessionCount = sessions.length;
  } catch { /* ignore */ }
  try {
    const crews = eng.crewManager.list();
    crewCount = crews.length;
  } catch { /* ignore */ }
  let configInfo: Record<string, unknown> = {};
  try {
    const cfg = eng.configManager.load();
    configInfo = { provider: cfg.provider.activeProvider, model: cfg.provider.activeModel, user: cfg.user?.callsign || null };
  } catch { /* ignore */ }
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
    agentActive: !!eng.agent,
  });
});

// ───── Setup / Config ─────
app.get('/api/setup/status', (_req, res) => {
  const eng = getEngine();
  const complete = eng.configManager.isSetupComplete();
  const configured = eng.configManager.isConfigured();
  res.json({ setupComplete: complete, configured });
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
    const apiKey = (req.query['apiKey'] as string) || undefined;
    const baseUrl = (req.query['baseUrl'] as string) || undefined;
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
    const agent = getOrCreateAgent();
    agent.switchModel(modelId, contextWindow);
    const eng = getEngine();
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
    const agent = getOrCreateAgent();
    const ok = await agent.trialModel(modelId);
    res.json({ ok, model: modelId });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: e instanceof Error ? e.message : 'trial-failed' });
  }
});

app.get('/api/models', async (_req, res) => {
  try {
    const agent = getOrCreateAgent();
    await agent.listModels();
    const eng = getEngine();
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

    const agent = getOrCreateAgent();
    ensureSubscribed();
    const message = await agent.sendMessage(text);
    res.json({ ok: true, message });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'chat-failed' });
  }
});

app.post('/api/chat/cancel', (_req, res) => {
  try {
    const agent = getOrCreateAgent();
    agent.cancel();
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'cancel-failed' });
  }
});

app.get('/api/chat/history', (_req, res) => {
  try {
    const agent = getOrCreateAgent();
    const history = agent.getMessageHistory();
    res.json(history);
  } catch {
    res.json([]);
  }
});

app.post('/api/chat/clear', (_req, res) => {
  try {
    const agent = getOrCreateAgent();
    agent.clearHistory();
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'clear-failed' });
  }
});

// ───── Permissions ─────
app.post('/api/permission/respond', (req, res) => {
  try {
    const { choice } = req.body as { choice: 'allow_once' | 'allow_always' | 'deny' };
    const agent = getOrCreateAgent();
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
    res.json({ sessionId: (agent as unknown as { sessionId: string }).sessionId });
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

// ───── Telegram ─────
app.post('/api/telegram/start', (req, res) => {
  try {
    const { token } = req.body as { token: string };
    const store = new TelegramStore();
    store.save({ botToken: token });
    res.json({ ok: true, message: 'Token saved. Restart daemon with: agentx start' });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'save-failed' });
  }
});

app.post('/api/telegram/stop', (_req, res) => {
  try {
    const store = new TelegramStore();
    store.clear();
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'clear-failed' });
  }
});

app.get('/api/telegram/status', (_req, res) => {
  const store = new TelegramStore();
  const cfg = store.load();
  res.json({ configured: !!cfg?.botToken, botToken: cfg?.botToken ? '***configured***' : null });
});

// ───── Tools ─────
app.get('/api/tools', (_req, res) => {
  const eng = getEngine();
  const tools = eng.toolkit.registry.list();
  res.json(tools);
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
    // Delete config file
    const cm = new ConfigManager();
    try { rmSync((cm as unknown as { configPath: string }).configPath); } catch { /* ok */ }
    // Delete sessions DB
    try {
      const dbPath = join(process.env['HOME'] || '/tmp', '.config', 'agentx', 'agentx.db');
      rmSync(dbPath);
    } catch { /* ok */ }
    // Reset engine state
    const eng = getEngine();
    (eng as unknown as { configured: boolean }).configured = false;
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

// ───── Start ─────
const server = createServer(app);
setupWebSocket(server);
server.listen(PORT, () => {
  console.log(`Agent-X web API listening on http://localhost:${PORT}`);
});
