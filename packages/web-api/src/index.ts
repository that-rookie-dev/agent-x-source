import express from 'express';
import type { Express } from 'express';
import multer from 'multer';
import { createServer } from 'node:http';
import { join, dirname, basename } from 'node:path';
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, createReadStream, renameSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { generateId, VERSION } from '@agentx/shared';
import { getEngine, createAgent, destroyAgent, clearEngine, getOrCreateAgent } from './engine.js';
import { setupWebSocket, ensureSubscribed } from './ws.js';
import { authMiddleware, createAuthRouter } from './auth.js';
import { ProviderFactory, DiscordBridge, DiscordStore, SlackBridge, SlackStore, EmailBridge, Agent } from '@agentx/engine';
import type { ProviderId, AgentXConfig, CompletionRequest } from '@agentx/shared';

const PORT = Number(process.env['AGENTX_PORT'] || process.env['PORT']) || 3333;
const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_DIST = join(__dirname, '..', '..', 'web-ui', 'dist');



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

// Auth routes (must be before auth middleware)
// Mount under /api so endpoints are /api/auth/*, matching web-ui calls
app.use('/api', createAuthRouter());

// Auth middleware — protects all /api/* routes except auth endpoints
app.use(authMiddleware);

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
  let activeCrew: string | null = null;
  let telegramConnected = false;
  if (eng) {
    try {
      const sessions = eng.sessionManager.listSessions(9999);
      sessionCount = sessions.length;
    } catch { /* ignore */ }
    try {
      const crews = eng.crewManager.list();
      crewCount = crews.length;
      const active = eng.crewManager.getActive();
      activeCrew = active?.name || null;
    } catch { /* ignore */ }
    try {
      const cfg = eng.configManager.load();
      configInfo = { provider: cfg.provider.activeProvider, model: cfg.provider.activeModel, user: cfg.user?.callsign || null };
    } catch { /* ignore */ }
    agentActive = !!eng.agent;
    try {
      const tgPlugin = eng.pluginRegistry.getPlugin('telegram');
      telegramConnected = !!tgPlugin?.enabled && !!tgPlugin?.config?.['botToken'];
    } catch { /* ignore */ }
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
    activeCrew,
    agentActive,
    telegramConnected,
    gateway: eng?.gateway ? {
      focus: eng.gateway.focus.getFocus(),
      channels: eng.gateway.registry.listChannels(),
    } : null,
  });
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
    res.status(500).json({
      setupComplete: false,
      configured: false,
      reason: `Config read error: ${err instanceof Error ? err.message : String(err)}`,
    });
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
  } catch (err) {
    // If load failed (e.g. DEK mismatch from different auth), save raw body as new config
    try {
      eng.configManager.save(req.body);
      res.json({ ok: true });
    } catch (saveErr) {
      res.status(500).json({
        ok: false,
        error: 'Failed to save config. Auth and config DEK may be out of sync. Re-create root user or ensure auth.json is shared between host and container.',
      });
    }
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
        // Fallback: use flat apiKey/baseUrl on the provider creds if no profile matched
        if (!apiKey && creds?.apiKey) apiKey = creds.apiKey;
        if (!baseUrl && creds?.baseUrl) baseUrl = creds.baseUrl;
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
    res.status(400).json({ error: e instanceof Error ? e.message : 'switch-failed' });
  }
});

// ───── Models ─────
app.post('/api/model/switch', (req, res) => {
  try {
    const { modelId, contextWindow } = req.body as { modelId: string; contextWindow?: number };
    const eng = getEngine();
    const agent = eng.agent ?? getOrCreateAgent();
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
    const agent = getOrCreateAgent();
    const ok = await agent.trialModel(modelId);
    res.json({ ok, model: modelId });
  } catch (e: unknown) {
    res.status(400).json({ ok: false, error: e instanceof Error ? e.message : 'trial-failed' });
  }
});

app.get('/api/models', async (_req, res) => {
  try {
    const eng = getEngine();
    const config = eng.configManager.load();
    // Try to list models via agent if it exists, but don't fail if no agent
    if (eng.agent) {
      try { await eng.agent.listModels(); } catch { /* ignore */ }
    }
    res.json({ model: config.provider.activeModel, provider: config.provider.activeProvider, currentModel: config.provider.activeModel });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'failed' });
  }
});

app.get('/api/cwd', (_req, res) => {
  res.json({ cwd: process.cwd() });
});

// ───── Session Mode & Approval ─────
// Agent mode: 'agent' (full), 'ask' (answer only), 'plan' (plan only)
// Approval: 'default' (deny-first), 'moderate' (tools allowed), 'auto' (full access)
const sessionSettings: { mode: 'agent' | 'ask' | 'plan'; approval: 'default' | 'moderate' | 'auto' } = {
  mode: 'ask',
  approval: 'default',
};

app.get('/api/session/settings', (_req, res) => {
  res.json(sessionSettings);
});

app.post('/api/session/mode', (req, res) => {
  const { mode } = req.body as { mode: 'agent' | 'ask' | 'plan' };
  if (!['agent', 'ask', 'plan'].includes(mode)) { res.status(400).json({ error: 'invalid-mode' }); return; }
  sessionSettings.mode = mode;
  // Apply mode to agent if exists
  const eng = getEngine();
  if (eng.agent) {
    eng.agent.setPlanMode(mode === 'plan');
  }
  res.json({ ok: true, mode });
});

app.post('/api/session/approval', (req, res) => {
  const { approval } = req.body as { approval: 'default' | 'moderate' | 'auto' };
  if (!['default', 'moderate', 'auto'].includes(approval)) { res.status(400).json({ error: 'invalid-approval' }); return; }
  sessionSettings.approval = approval;
  // Apply to agent if exists — auto means auto-approve all tool calls
  const eng = getEngine();
  if (eng.agent) {
    (eng.agent as unknown as { autoApproveTools: boolean }).autoApproveTools = (approval === 'auto' || approval === 'moderate');
  }
  res.json({ ok: true, approval });
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
    session: session ? { id: session.id, title: session.title, status: session.status } : null,
    crew: { activeId: eng.crewManager.getActiveId(), crewStates },
    model: { provider: session?.providerId, model: session?.modelId },
    processing: (agent as unknown as { isProcessing?: boolean }).isProcessing ?? false,
    planMode: (agent as unknown as { planMode?: boolean }).planMode ?? false,
    sessionSettings,
  });
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

app.post('/api/crew/toggle', (req, res) => {
  try {
    const { crewId, enabled } = req.body as { crewId: string; enabled: boolean };
    const eng = getEngine();
    
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
    res.status(400).json({ error: e instanceof Error ? e.message : 'toggle-failed' });
  }
});

app.post('/api/crews', (req, res) => {
  try {
    const { id, name, title, callsign, systemPrompt, emotion, isDefault, expertise, traits } = req.body as {
      id: string; name: string; title?: string; callsign?: string; systemPrompt: string; emotion?: string; isDefault?: boolean; expertise?: string[]; traits?: string[];
    };
    const eng = getEngine();
    const crew = eng.crewManager.create({
      id: id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      name,
      title,
      callsign: callsign || id || name,
      systemPrompt,
      emotion: emotion as 'professional' | 'friendly' | 'witty' | 'kind' | 'funny' | 'arrogant' | 'flirty' | 'happy' | 'sad' | 'sarcastic' | undefined,
      isDefault,
      expertise,
      traits,
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

app.post('/api/crew/generate-metadata', async (req, res) => {
  try {
    const { systemPrompt } = req.body as { systemPrompt: string };
    if (!systemPrompt) { res.status(400).json({ error: 'systemPrompt required' }); return; }

    const eng = getEngine();
    const cfg = eng.configManager.load();
    const providerId = cfg.provider.activeProvider;
    const providerCfg = cfg.provider.providers[providerId];
    const apiKey = providerCfg?.apiKey || providerCfg?.profiles?.[providerCfg?.activeProfile ?? '']?.apiKey;

    if (!apiKey) { res.json({ expertise: [], traits: [] }); return; }

    const { ProviderFactory } = await import('@agentx/engine');
    const provider = ProviderFactory.create(providerId as any, apiKey, providerCfg?.baseUrl);

    const genPrompt = `Analyze this AI agent's system prompt and extract:
1. expertise: 3-6 specific technical/domain skills (e.g. "React", "API Design", "Security Auditing")
2. traits: 3-5 personality/behavioral traits (e.g. "concise", "practical", "pragmatic")

System prompt:
"${systemPrompt}"

Return ONLY valid JSON: {"expertise":["skill1","skill2"],"traits":["trait1","trait2"]}`;

    const chunks: string[] = [];
    const modelId = cfg.provider.activeModel || 'gpt-4o-mini';
    for await (const chunk of provider.complete({
      messages: [{ role: 'user', content: genPrompt }],
      model: modelId,
      stream: true,
      maxTokens: 200,
      temperature: 0.3,
    })) {
      if (chunk.type === 'text_delta' && chunk.content) chunks.push(chunk.content);
    }

    const text = chunks.join('');
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) { res.json({ expertise: [], traits: [] }); return; }

    const parsed = JSON.parse(jsonMatch[0]);
    res.json({
      expertise: Array.isArray(parsed.expertise) ? parsed.expertise.slice(0, 8) : [],
      traits: Array.isArray(parsed.traits) ? parsed.traits.slice(0, 8) : [],
    });
  } catch (e: unknown) {
    res.json({ expertise: [], traits: [] });
  }
});

// ───── Chat ─────
app.post('/api/chat/message', async (req, res) => {
  try {
    const { text, attachments } = req.body as { text: string; attachments?: { name: string; content: string }[] };
    if (!text || typeof text !== 'string') { res.status(400).json({ error: 'text-required' }); return; }
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
      try { agent.cancel(); } catch { /* ignore */ }
      await new Promise(r => setTimeout(r, 100));
      if (agent.processing) {
        res.status(503).json({ error: 'Agent is busy. Please try again in a moment.' });
        return;
      }
    }

    // Apply session mode to agent
    agent.setPlanMode(sessionSettings.mode === 'plan');
    (agent as unknown as { autoApproveTools: boolean }).autoApproveTools = (sessionSettings.approval === 'auto' || sessionSettings.approval === 'moderate');

    // Build the full message content with attachments if provided
    let fullText = text;
    if (attachments && attachments.length > 0) {
      const attachmentSection = attachments.map(a => `\n\n--- File: ${a.name} ---\n${a.content}`).join('');
      fullText = text + attachmentSection;
    }

    // Build instruction based on mode (kept separate from user content)
    const instruction = sessionSettings.mode === 'ask'
      ? 'Only provide an answer/explanation. Do NOT execute any tools, make changes, or take actions. Just reply with knowledge.'
      : sessionSettings.mode === 'plan'
        ? 'Generate a detailed plan for this request. Do NOT execute the plan yet — only outline the steps.'
        : undefined;

    // Auto-checkpoint before each user turn — enables /undo to roll back this turn
    try {
      const sid = (agent as unknown as { sessionId: string }).sessionId;
      if (sid) {
        const dir = getSessionDir(sid);
        if (existsSync(dir)) {
          const convPath = join(dir, 'conversation.json');
          const messages = existsSync(convPath) ? JSON.parse(readFileSync(convPath, 'utf-8') || '[]') : [];
          const checkpointsDir = join(dir, 'checkpoints');
          if (!existsSync(checkpointsDir)) mkdirSync(checkpointsDir, { recursive: true });
          // Keep only most recent 20 auto-checkpoints to avoid unbounded growth
          try {
            const autos = readdirSync(checkpointsDir).filter(f => f.startsWith('auto-')).sort();
            while (autos.length > 19) {
              const oldest = autos.shift();
              if (oldest) { try { unlinkSync(join(checkpointsDir, oldest)); } catch { /* ignore */ } }
            }
          } catch { /* ignore */ }
          const ckptId = `auto-${Date.now()}`;
          const label = `Auto · ${new Date().toLocaleTimeString()}`;
          writeFileSync(join(checkpointsDir, `${ckptId}.json`), JSON.stringify({ id: ckptId, label, messages, createdAt: new Date().toISOString() }, null, 2));
        }
      }
    } catch { /* checkpoint failure shouldn't block the message */ }

    const message = await agent.sendMessage(fullText, instruction ? { instruction } : undefined);
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

// ───── Message Queue & Steer ─────
// Queue: messages waiting to be sent after current task completes
// Helper: wait for agent to finish processing (max 3s) after a cancel
async function waitForIdle(agent: { processing: boolean }, maxWait = 3000): Promise<void> {
  const start = Date.now();
  while (agent.processing && (Date.now() - start) < maxWait) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

const messageQueue: Array<{ text: string; attachments?: { name: string; content: string }[] }> = [];

app.post('/api/chat/queue', (req, res) => {
  try {
    const { text, attachments } = req.body as { text: string; attachments?: { name: string; content: string }[] };
    if (!text || typeof text !== 'string') { res.status(400).json({ error: 'text-required' }); return; }
    messageQueue.push({ text, attachments });
    res.json({ ok: true, queueLength: messageQueue.length });
  } catch {
    res.status(500).json({ error: 'queue-failed' });
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
app.post('/api/chat/steer', async (req, res) => {
  try {
    const { text, attachments } = req.body as { text: string; attachments?: { name: string; content: string }[] };
    if (!text || typeof text !== 'string') { res.status(400).json({ error: 'text-required' }); return; }
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
    // Cancel current execution and wait for it to finish
    agent.cancel();
    await waitForIdle(agent);
    // Send the steer message
    let fullText = text;
    if (attachments && attachments.length > 0) {
      const attachmentSection = attachments.map(a => `\n\n--- File: ${a.name} ---\n${a.content}`).join('');
      fullText = text + attachmentSection;
    }
    const instruction = sessionSettings.mode === 'ask'
      ? 'Only provide an answer/explanation. Do NOT execute any tools, make changes, or take actions. Just reply with knowledge.'
      : undefined;
    const message = await agent.sendMessage(fullText, instruction ? { instruction } : undefined);
    res.json({ ok: true, message });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'steer-failed' });
  }
});

// Stop and Send: cancel current task, then send a new message fresh
app.post('/api/chat/stop-and-send', async (req, res) => {
  try {
    const { text, attachments } = req.body as { text: string; attachments?: { name: string; content: string }[] };
    if (!text || typeof text !== 'string') { res.status(400).json({ error: 'text-required' }); return; }
    const eng = getEngine();
    const agent = eng.agent;
    if (!agent) { res.status(400).json({ error: 'no-session' }); return; }
    // Cancel current execution and wait for it to finish
    agent.cancel();
    await waitForIdle(agent);
    ensureSubscribed();
    agent.setPlanMode(sessionSettings.mode === 'plan');
    (agent as unknown as { autoApproveTools: boolean }).autoApproveTools = (sessionSettings.approval === 'auto' || sessionSettings.approval === 'moderate');
    let fullText = text;
    if (attachments && attachments.length > 0) {
      const attachmentSection = attachments.map(a => `\n\n--- File: ${a.name} ---\n${a.content}`).join('');
      fullText = text + attachmentSection;
    }
    const instruction = sessionSettings.mode === 'ask'
      ? 'Only provide an answer/explanation. Do NOT execute any tools, make changes, or take actions. Just reply with knowledge.'
      : sessionSettings.mode === 'plan'
        ? 'Generate a detailed plan for this request. Do NOT execute the plan yet — only outline the steps.'
        : undefined;
    const message = await agent.sendMessage(fullText, instruction ? { instruction } : undefined);
    res.json({ ok: true, message });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'stop-and-send-failed' });
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

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendEvent = (event: string, data: unknown) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* connection closed */ }
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

// Cross-session full-text search. Scans each session's conversation.json.
app.get('/api/sessions/search', (req, res) => {
  try {
    const q = String(req.query['q'] ?? '').trim();
    if (!q) { res.json({ results: [] }); return; }
    const needle = q.toLowerCase();
    const eng = getEngine();
    const sessions = eng.sessionManager.listSessions(200);
    const results: Array<{ sessionId: string; title?: string; createdAt?: string; snippet: string; matchCount: number }> = [];
    for (const s of sessions) {
      const sid = (s as unknown as { id?: string; sessionId?: string }).id ?? (s as unknown as { sessionId?: string }).sessionId;
      if (!sid) continue;
      const conv = join(getSessionDir(sid), 'conversation.json');
      if (!existsSync(conv)) continue;
      let messages: Array<{ role?: string; content?: string }> = [];
      try { messages = JSON.parse(readFileSync(conv, 'utf-8')) as Array<{ role?: string; content?: string }>; } catch { continue; }
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
    res.status(500).json({ error: e instanceof Error ? e.message : 'search-failed' });
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
    res.status(500).json({
      ok: false,
      error: `Failed to reload config: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

// Export full session trajectory (conversation + context files + checkpoint list)
app.get('/api/sessions/:id/export', (req, res) => {
  try {
    const sid = req.params['id']!;
    const dir = getSessionDir(sid);
    if (!existsSync(dir)) { res.status(404).json({ error: 'not-found' }); return; }
    let messages: unknown[] = [];
    try { messages = JSON.parse(readFileSync(join(dir, 'conversation.json'), 'utf-8')) as unknown[]; } catch { /* empty */ }
    const ctxFiles = ['context.txt', 'memories.txt', 'pending.txt', 'completed.txt', 'suggestions.txt'];
    const contextFiles: Record<string, string> = {};
    for (const f of ctxFiles) {
      try { contextFiles[f.replace('.txt', '')] = readFileSync(join(dir, f), 'utf-8'); } catch { /* skip */ }
    }
    const cpDir = join(dir, 'checkpoints');
    const checkpoints: Array<{ id: string; label?: string; createdAt?: string; messageCount?: number }> = [];
    if (existsSync(cpDir)) {
      try {
        const files = readdirSync(cpDir).filter((f: string) => f.endsWith('.json'));
        for (const f of files) {
          try {
            const cp = JSON.parse(readFileSync(join(cpDir, f), 'utf-8')) as { id?: string; label?: string; createdAt?: string; messages?: unknown[] };
            checkpoints.push({ id: cp.id ?? f.replace('.json', ''), label: cp.label, createdAt: cp.createdAt, messageCount: Array.isArray(cp.messages) ? cp.messages.length : 0 });
          } catch { /* skip bad cp */ }
        }
      } catch { /* skip */ }
    }
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
    res.status(500).json({ error: e instanceof Error ? e.message : 'export-failed' });
  }
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
    createAgent(undefined, req.params['id']!);
    // Restore crew states from session store
    const crewStates = eng.sessionManager.getCrewStates();
    for (const state of crewStates) {
      const agent = (eng as unknown as { agent?: { setCrewEnabled?: (id: string, enabled: boolean) => boolean } }).agent;
      if (agent?.setCrewEnabled) {
        agent.setCrewEnabled(state.crewId, state.enabled);
      }
    }
    // Read messages from conversation.json (where ws.ts persists them)
    const convPath = join(getSessionDir(req.params['id']!), 'conversation.json');
    let messages: Array<Record<string, unknown>> = [];
    try {
      messages = JSON.parse(readFileSync(convPath, 'utf-8')) as Array<Record<string, unknown>>;
    } catch {
      messages = [];
    }
    res.json({ session, messages, crewStates });
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

// ───── Checkpoints (Message Branching) ─────
app.post('/api/sessions/:id/checkpoint', (req, res) => {
  try {
    const dir = getSessionDir(req.params['id']!);
    if (!existsSync(dir)) { res.status(404).json({ error: 'session-not-found' }); return; }
    const label = (req.body as Record<string, string>)['label'] || new Date().toLocaleTimeString();
    const convPath = join(dir, 'conversation.json');
    const messages = existsSync(convPath) ? JSON.parse(readFileSync(convPath, 'utf-8') || '[]') : [];
    const checkpointId = `ckpt-${Date.now()}`;
    const checkpointsDir = join(dir, 'checkpoints');
    if (!existsSync(checkpointsDir)) mkdirSync(checkpointsDir, { recursive: true });
    writeFileSync(join(checkpointsDir, `${checkpointId}.json`), JSON.stringify({ id: checkpointId, label, messages, createdAt: new Date().toISOString() }, null, 2));
    res.json({ checkpointId, label });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'checkpoint-failed' });
  }
});

app.get('/api/sessions/:id/checkpoints', (req, res) => {
  try {
    const dir = getSessionDir(req.params['id']!);
    const checkpointsDir = join(dir, 'checkpoints');
    if (!existsSync(checkpointsDir)) { res.json({ checkpoints: [] }); return; }
    const files = readdirSync(checkpointsDir).filter((f) => f.endsWith('.json'));
    const checkpoints = files.map((f) => {
      const data = JSON.parse(readFileSync(join(checkpointsDir, f), 'utf-8'));
      return { id: data.id, label: data.label, createdAt: data.createdAt, messageCount: (data.messages || []).length };
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ checkpoints });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'list-failed' });
  }
});

app.post('/api/sessions/:id/checkpoint/:checkpointId/restore', (req, res) => {
  try {
    const dir = getSessionDir(req.params['id']!);
    const checkpointId = req.params['checkpointId']!;
    const checkpointPath = join(dir, 'checkpoints', `${checkpointId}.json`);
    if (!existsSync(checkpointPath)) { res.status(404).json({ error: 'checkpoint-not-found' }); return; }
    const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf-8'));
    // Write messages back to conversation.json
    const convPath = join(dir, 'conversation.json');
    atomicWriteFileSync(convPath, JSON.stringify(checkpoint.messages || [], null, 2));
    res.json({ ok: true, label: checkpoint.label, messageCount: (checkpoint.messages || []).length });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'restore-failed' });
  }
});

app.delete('/api/sessions/:id/checkpoint/:checkpointId', (req, res) => {
  try {
    const dir = getSessionDir(req.params['id']!);
    const checkpointId = req.params['checkpointId']!;
    const checkpointPath = join(dir, 'checkpoints', `${checkpointId}.json`);
    if (!existsSync(checkpointPath)) { res.status(404).json({ error: 'checkpoint-not-found' }); return; }
    rmSync(checkpointPath);
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'delete-failed' });
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
    res.status(500).json({ error: e instanceof Error ? e.message : 'list-failed' });
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
    res.status(500).json({ error: e instanceof Error ? e.message : 'save-failed' });
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
    res.status(500).json({ error: e instanceof Error ? e.message : 'update-failed' });
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
    // Auto-enable the plugin
    eng.pluginRegistry.enable('telegram');
    res.json({ ok: true, message: 'Token saved. Telegram plugin configured and enabled.' });
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
  res.json({ configured, connected: configured, botToken: configured ? '***configured***' : null });
});

// ───── TUI Active Check ─────
const TUI_ACTIVE_PATH = join(DATA_DIR, 'tui-active.mark');

app.get('/api/tui-active', (_req, res) => {
  if (existsSync(TUI_ACTIVE_PATH)) {
    try {
      const pid = parseInt(readFileSync(TUI_ACTIVE_PATH, 'utf-8').trim(), 10);
      // Verify process is still alive
      try { process.kill(pid, 0); } catch { unlinkSync(TUI_ACTIVE_PATH); res.json({ active: false }); return; }
      res.json({ active: true, pid });
    } catch {
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
    } catch {
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
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete('/api/webui-active', (_req, res) => {
  try {
    if (existsSync(WEBUI_ACTIVE_PATH)) {
      unlinkSync(WEBUI_ACTIVE_PATH);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
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
    const store = new DiscordStore();
    store.save({ botToken: token, channelId });

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
      const userCrew = eng.crewManager.getActive()!;
      const userSession = eng.sessionManager.createSession(
        userProvider,
        userCfg.provider.activeModel,
        userCrew.id,
        process.cwd(),
      );
      return new Agent({
        config: userCfg,
        sessionId: userSession.id,
        systemPrompt: userCrew.systemPrompt,
        toolExecutor: eng.toolkit.executor,
        toolRegistry: eng.toolkit.registry,
      });
    });
    await bridge.start(token, channelId);
    eng.discordBridge = bridge;

    res.json({ ok: true, message: 'Discord bot connected.', status: bridge.getStatus() });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'save-failed' });
  }
});

app.post('/api/discord/stop', (_req, res) => {
  try {
    const eng = getEngine();
    if (eng.discordBridge) {
      eng.discordBridge.stop();
      eng.discordBridge = null;
    }
    if (eng.pluginRegistry.isInstalled('discord')) {
      eng.pluginRegistry.uninstall('discord');
    }
    const store = new DiscordStore();
    store.clear();
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'clear-failed' });
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
      const activeCrew = eng.crewManager.getActive()!;
      const session = eng.sessionManager.createSession(
        cfg.provider.activeProvider,
        cfg.provider.activeModel,
        activeCrew.id,
        process.cwd(),
      );
      return new Agent({
        config: cfg,
        sessionId: session.id,
        systemPrompt: activeCrew.systemPrompt,
        toolExecutor: eng.toolkit.executor,
        toolRegistry: eng.toolkit.registry,
      });
    });
    await bridge.start();
    eng.slackBridge = bridge;
    new SlackStore().save({ botToken, appToken });
    res.json({ ok: true, message: 'Slack bridge started.', status: bridge.getStatus() });
  } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'start-failed' });
  }
});

app.post('/api/slack/stop', (_req, res) => {
  try {
    const eng = getEngine();
    if (eng.slackBridge) {
      eng.slackBridge.stop();
      eng.slackBridge = null;
    }
    new SlackStore().clear();
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'stop-failed' });
  }
});

app.get('/api/slack/status', (_req, res) => {
  try {
    const store = new SlackStore();
    const cfg = store.load();
    const eng = getEngine();
    const bridge = eng.slackBridge;
    const configured = !!cfg?.botToken && !!cfg?.appToken;
    const status = bridge?.getStatus();
    res.json({
      configured,
      connected: status?.connected ?? false,
      team: status?.team ?? '',
    });
  } catch {
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
    const activeCrew = eng.crewManager.getActive()!;
    const bridge = new EmailBridge();
    bridge.setAgentDeps({
      config: cfg,
      systemPrompt: activeCrew.systemPrompt,
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
    res.status(400).json({ error: e instanceof Error ? e.message : 'save-failed' });
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
  } catch {
    res.status(500).json({ error: 'clear-failed' });
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
  } catch {
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
  } catch {
    res.status(500).json({ error: 'bulk-toggle-failed' });
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

// ───── Natural Language Cron ─────
app.post('/api/scheduler/parse-cron', async (req, res) => {
  const { text } = req.body as { text?: string };
  if (!text) {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  try {
    const eng = getEngine();
    getOrCreateAgent();
    const prompt = `Convert the following natural language schedule to a standard 5-field cron expression (minute hour day-of-month month day-of-week).

Examples:
- "every morning at 9am" → 0 9 * * *
- "every 15 minutes" → */15 * * * *
- "every Monday at 10am" → 0 10 * * 1
- "first day of every month at midnight" → 0 0 1 * *
- "every weekday at 5pm" → 0 17 * * 1-5
- "every hour" → 0 * * * *
- "at midnight" → 0 0 * * *
- "every Sunday at 8am" → 0 8 * * 0

User input: "${text}"

Return ONLY the cron expression, nothing else.`;
    const provider = eng.agent ? (eng.agent as any).provider : ProviderFactory.create('openai', undefined, undefined);
    const result = await provider.complete({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    });
    let cronExpr = '';
    for await (const chunk of result) {
      if (chunk.type === 'text_delta' && chunk.content) {
        cronExpr += chunk.content;
      }
    }
    cronExpr = cronExpr.trim().replace(/`/g, '').replace(/^cron\s+/i, '');
    // Basic validation: must have 5 fields
    const parts = cronExpr.split(/\s+/);
    if (parts.length === 5) {
      res.json({ cron: cronExpr, original: text });
    } else {
      res.status(400).json({ error: 'Could not parse schedule', attempted: cronExpr });
    }
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'parse-failed' });
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

app.post('/api/scheduler/jobs/:id/run', (req, res) => {
  const eng = getEngine();
  if (!eng.agent) { res.status(400).json({ error: 'No active agent' }); return; }
  try {
    const ok = eng.agent.cron.runJob(req.params['id']!);
    if (!ok) { res.status(404).json({ error: 'job-not-found' }); return; }
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'run-job-failed' });
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
      } catch { files.push({ file: f, size: 0, exists: true }); }
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
    res.status(500).json({ error: e instanceof Error ? e.message : 'read-failed' });
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
    res.status(500).json({ error: e instanceof Error ? e.message : 'write-failed' });
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

  // ─── Debug Log Endpoint ────────────────────────────────────────────
  // Accept frontend-side parse errors so developers can see raw API output
  if (req.path === '/api/debug/log' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk: string) => { body += chunk; });
    req.on('end', () => {
      try {
        const DEBUG_DIR = join(DATA_DIR, 'debug-logs');
        if (!existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const entry = JSON.parse(body);
        writeFileSync(join(DEBUG_DIR, `frontend_${ts}.json`), JSON.stringify(entry, null, 2));
        res.json({ ok: true });
      } catch {
        res.status(400).json({ error: 'invalid-log-entry' });
      }
    });
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
