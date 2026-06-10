// Centralized API client for all web-api endpoints

const BASE = '/api';

// Debug logger — writes parse errors to ~/.local/share/agentx/debug-logs/
// so developers can see raw API responses without guessing the data format.
async function writeDebugLog(entry: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${BASE}/debug/log`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
  } catch { /* best effort */ }
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers as Record<string, string> ?? {}) },
    ...opts,
  });
  if (res.status === 401) {
    // Redirect to login
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const rawBody = await res.text().catch(() => '');
    let parsed: Record<string, unknown> = { error: res.statusText };
    try { parsed = JSON.parse(rawBody) as Record<string, unknown>; } catch { /* not JSON */ }
    writeDebugLog({
      type: 'api-error',
      path,
      method: opts.method ?? 'GET',
      status: res.status,
      body: rawBody.slice(0, 5000),
    });
    throw new Error((parsed as { error?: string; message?: string }).message ?? (parsed as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  // Read the response body once
  const rawBody = await res.text();
  
  // For model-list endpoints, log raw response format to help debug parse errors
  if (path.startsWith('/provider/models')) {
    try {
      const parsed = JSON.parse(rawBody);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const keys = Object.keys(parsed as Record<string, unknown>);
        const hasArray = keys.some((k) => Array.isArray((parsed as Record<string, unknown>)[k]));
        if (!hasArray) {
          writeDebugLog({
            type: 'models-unexpected-format',
            provider: path.split('=')[1] ?? 'unknown',
            keys,
            sample: JSON.stringify(parsed).slice(0, 3000),
          });
        }
      }
    } catch { /* not JSON — log it */
      writeDebugLog({ type: 'models-non-json', provider: path.split('=')[1] ?? 'unknown', body: rawBody.slice(0, 3000) });
    }
  }
  return JSON.parse(rawBody) as T;
}

// ─── Auth ───
export const auth = {
  check: () => request<{ hasRootUser: boolean }>('/auth/check'),
  status: () => request<{ isAuthenticated: boolean; username?: string | null }>('/auth/status'),
  setup: (username: string, password: string) => request<{ ok: boolean }>('/auth/setup', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) => request<{ ok: boolean; username: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
};

// ─── Setup & Config ───
export const config = {
  getSetupStatus: () => request<{ setupComplete: boolean; configured: boolean }>('/setup/status'),
  get: () => request<AgentXConfig>('/config'),
  update: (data: Partial<AgentXConfig>) => request<{ ok: boolean }>('/config', { method: 'PUT', body: JSON.stringify(data) }),
};

// ─── Health ───
export const health = {
  check: () => request<HealthStatus>('/health'),
};

// ─── Providers ───
export const providers = {
  available: () => request<{ providers: ProviderInfo[] }>('/providers/available').then(r => r.providers),
  configured: () => request<{ active: string; providers: ConfiguredProvider[] }>('/providers').then(r => r.providers),
  active: () => request<{ active: string; providers: ConfiguredProvider[] }>('/providers').then(r => r.active),
  validate: (provider: string, apiKey?: string, baseUrl?: string) => request<{ valid: boolean; error?: string }>('/provider/validate', { method: 'POST', body: JSON.stringify({ provider, apiKey, baseUrl }) }),
  configure: (provider: string, apiKey?: string, baseUrl?: string) => request<{ ok: boolean }>('/provider/configure', { method: 'POST', body: JSON.stringify({ provider, apiKey, baseUrl }) }),
  models: (provider: string) => request<ModelInfo[]>('/provider/models?provider=' + provider),
  switch: (provider: string) => request<{ ok: boolean; provider: string; model: string }>('/provider/switch', { method: 'POST', body: JSON.stringify({ provider }) }),
  createProfile: (provider: string, label: string, apiKey: string, baseUrl?: string, setActive?: boolean) => request<{ ok: boolean; provider: string; profileId: string }>('/provider/profile', { method: 'POST', body: JSON.stringify({ provider, profileId: label, label, apiKey, baseUrl, setActive }) }),
  switchProfile: (providerId: string, profileId: string) => request<{ ok: boolean }>('/provider/profile/switch', { method: 'POST', body: JSON.stringify({ providerId, profileId }) }),
};

// ─── Models ───
export const models = {
  switch: (modelId: string) => request<{ ok: boolean }>('/model/switch', { method: 'POST', body: JSON.stringify({ modelId }) }),
  current: () => request<{ model: string; provider: string; activeProfile?: string }>('/models'),
};

// ─── Crews ───
export const crews = {
  list: () => request<{ crews: Crew[]; activeId?: string }>('/crews').then(r => r.crews ?? []),
  create: (data: CrewInput) => request<{ ok: boolean; crew: Crew }>('/crews', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<CrewInput>) => request<{ ok: boolean }>(`/crews/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => request<{ ok: boolean }>(`/crews/${id}`, { method: 'DELETE' }),
  toggle: (id: string, enabled: boolean) => request<{ ok: boolean }>('/crew/toggle', { method: 'POST', body: JSON.stringify({ crewId: id, enabled }) }),
  generateMetadata: (systemPrompt: string, title?: string) => request<{ expertise: string[]; traits: string[]; revisedPrompt: string }>('/crew/generate-metadata', { method: 'POST', body: JSON.stringify({ systemPrompt, title }) }),
};

// ─── Chat ───
export const chat = {
  send: (text: string, attachments?: { name: string; content: string }[]) => request<{ ok: boolean; message: ChatMessage }>('/chat/message', { method: 'POST', body: JSON.stringify({ text, attachments }) }),
  cancel: () => request<{ ok: boolean }>('/chat/cancel', { method: 'POST' }),
  history: () => request<ChatMessage[]>('/chat/history'),
  clear: () => request<{ ok: boolean }>('/chat/clear', { method: 'POST' }),
  queue: (text: string, attachments?: { name: string; content: string }[]) => request<{ ok: boolean; queueLength: number }>('/chat/queue', { method: 'POST', body: JSON.stringify({ text, attachments }) }),
  getQueue: () => request<{ queue: Array<{ text: string }>; length: number }>('/chat/queue'),
  clearQueue: () => request<{ ok: boolean }>('/chat/queue', { method: 'DELETE' }),
  steer: (text: string, attachments?: { name: string; content: string }[]) => request<{ ok: boolean; message: ChatMessage }>('/chat/steer', { method: 'POST', body: JSON.stringify({ text, attachments }) }),
  stopAndSend: (text: string, attachments?: { name: string; content: string }[]) => request<{ ok: boolean; message: ChatMessage }>('/chat/stop-and-send', { method: 'POST', body: JSON.stringify({ text, attachments }) }),
};

// ─── Sessions ───
export interface Checkpoint {
  id: string;
  label: string;
  createdAt: string;
  messageCount: number;
}

export const sessions = {
  list: () => request<SessionInfo[]>('/sessions'),
  create: () => request<{ sessionId: string }>('/sessions', { method: 'POST' }),
  get: (id: string) => request<SessionInfo>(`/sessions/${id}`),
  delete: (id: string) => request<{ ok: boolean }>(`/sessions/${id}`, { method: 'DELETE' }),
  restore: (id: string) => request<{ session: SessionInfo; messages: ChatMessage[]; crewStates?: Array<{ crewId: string; enabled: boolean }> }>(`/sessions/${id}/restore`, { method: 'POST' }),
  context: (id: string) => request<SessionContext>(`/sessions/${id}/context`),
  compact: (id: string) => request<{ ok: boolean; summary: string }>(`/sessions/${id}/compact`, { method: 'POST' }),
  checkpoint: (id: string, label?: string) => request<{ checkpointId: string; label: string }>(`/sessions/${id}/checkpoint`, { method: 'POST', body: JSON.stringify({ label }) }),
  checkpoints: (id: string) => request<{ checkpoints: Checkpoint[] }>(`/sessions/${id}/checkpoints`).then(r => r.checkpoints ?? []),
  restoreCheckpoint: (id: string, checkpointId: string) => request<{ ok: boolean; label: string; messageCount: number }>(`/sessions/${id}/checkpoint/${checkpointId}/restore`, { method: 'POST' }),
  deleteCheckpoint: (id: string, checkpointId: string) => request<{ ok: boolean }>(`/sessions/${id}/checkpoint/${checkpointId}`, { method: 'DELETE' }),
  // Trigger a browser download of the full trajectory JSON
  exportTrajectory: (id: string): void => {
    const a = document.createElement('a');
    a.href = `/api/sessions/${id}/export`;
    a.download = `agentx-session-${id.slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },
  // Cross-session search — uses server-side scan endpoint, falls back to client-side
  search: async (query: string): Promise<Array<{ sessionId: string; sessionTitle: string; matches: Array<{ role: string; content: string; snippet: string }> }>> => {
    const q = query.trim();
    if (!q) return [];
    try {
      const r = await request<{ results: Array<{ sessionId: string; title?: string; snippet: string; matchCount: number }> }>(`/sessions/search?q=${encodeURIComponent(q)}`);
      if (r && Array.isArray(r.results)) {
        return r.results.map(x => ({
          sessionId: x.sessionId,
          sessionTitle: x.title ?? `Session ${x.sessionId.slice(0, 8)}`,
          matches: [{ role: 'mixed', content: x.snippet, snippet: x.snippet }],
        }));
      }
    } catch { /* fall back to client-side */ }
    const list = await request<SessionInfo[]>('/sessions');
    const needle = q.toLowerCase();
    const results: Array<{ sessionId: string; sessionTitle: string; matches: Array<{ role: string; content: string; snippet: string }> }> = [];
    for (const s of list) {
      try {
        const ctx = await request<SessionContext>(`/sessions/${s.id}/context`);
        const text = (ctx as { content?: string }).content ?? '';
        if (text.toLowerCase().includes(needle)) {
          const lines = text.split('\n').filter(l => l.toLowerCase().includes(needle)).slice(0, 3);
          results.push({
            sessionId: s.id,
            sessionTitle: s.title ?? `Session ${s.id.slice(0, 8)}`,
            matches: lines.map(line => ({ role: 'mixed', content: line, snippet: line.slice(0, 200) })),
          });
        }
      } catch { /* skip */ }
    }
    return results;
  },
};

// ─── Permissions ───
export const permissions = {
  respond: (choice: 'allow_once' | 'allow_always' | 'deny') => request<{ ok: boolean }>('/permission/respond', { method: 'POST', body: JSON.stringify({ choice }) }),
};

// ─── System ───
export const system = {
  cwd: () => request<{ cwd: string }>('/cwd'),
  setCwd: (path: string) => request<{ cwd: string }>('/cwd', { method: 'POST', body: JSON.stringify({ path }) }),
  dirs: (path?: string) => request<{ current: string; parent: string | null; dirs: Array<{ name: string; path: string }> }>(`/filesystem/dirs${path ? `?path=${encodeURIComponent(path)}` : ''}`),
};

// ─── Session Settings ───
export type AgentMode = 'agent' | 'ask' | 'plan';

export const sessionSettings = {
  get: () => request<{ mode: AgentMode }>('/session/settings'),
  setMode: (mode: AgentMode) => request<{ ok: boolean; mode: AgentMode }>('/session/mode', { method: 'POST', body: JSON.stringify({ mode }) }),
};

// ─── Tools ───
export const tools = {
  list: () => request<ToolInfo[]>('/tools'),
  categories: () => request<ToolCategory[]>('/tools/categories'),
  get: (id: string) => request<ToolInfo>(`/tools/${id}`),
  toggle: (id: string, enabled: boolean) => request<{ ok: boolean }>(`/tools/${id}`, { method: 'PUT', body: JSON.stringify({ enabled }) }),
  bulkToggle: (opts: { ids?: string[]; category?: string; enabled: boolean }) => request<{ ok: boolean; toggled: number }>('/tools/bulk-toggle', { method: 'POST', body: JSON.stringify(opts) }),
};

// ─── Plugins ───
export const plugins = {
  list: () => request<{ plugins: PluginInfo[] }>('/plugins').then(r => r.plugins ?? []),
  available: () => request<{ plugins: PluginInfo[] }>('/plugins/available').then(r => r.plugins ?? []),
  installed: () => request<{ plugins: PluginInfo[] }>('/plugins/installed').then(r => r.plugins ?? []),
  install: (id: string) => request<{ ok: boolean }>(`/plugins/${id}/install`, { method: 'POST' }),
  uninstall: (id: string) => request<{ ok: boolean }>(`/plugins/${id}/uninstall`, { method: 'POST' }),
  toggle: (id: string) => request<{ ok: boolean }>(`/plugins/${id}/toggle`, { method: 'POST' }),
  getConfig: (id: string) => request<PluginInfo>(`/plugins/${id}`),
  updateConfig: (id: string, cfg: Record<string, unknown>) => request<{ ok: boolean }>(`/plugins/${id}/config`, { method: 'PUT', body: JSON.stringify(cfg) }),
};

// ─── MCP ───
export const mcp = {
  servers: () => request<{ servers: MCPServer[] }>('/mcp/servers').then(r => r.servers ?? []),
  add: (data: MCPServerInput) => request<{ ok: boolean }>('/mcp/servers', { method: 'POST', body: JSON.stringify(data) }),
  restart: (id: string) => request<{ ok: boolean }>(`/mcp/servers/${id}/restart`, { method: 'POST' }),
  status: (id: string) => request<MCPServerStatus>(`/mcp/servers/${id}/status`),
  remove: (id: string) => request<{ ok: boolean }>(`/mcp/servers/${id}`, { method: 'DELETE' }),
};

// ─── RAG ───
export const rag = {
  status: () => request<{ enabled: boolean; indexedChunks: number }>('/rag/status').then(r => ({ enabled: r.enabled, chunkCount: r.indexedChunks ?? 0 })),
  index: (content: string, metadata?: Record<string, string>) => request<{ ok: boolean }>('/rag/index', { method: 'POST', body: JSON.stringify({ content, metadata }) }),
  search: (query: string, topK?: number) => request<RAGResult[]>('/rag/search', { method: 'POST', body: JSON.stringify({ query, topK }) }),
  clear: () => request<{ ok: boolean }>('/rag/clear', { method: 'POST' }),
};

// ─── Bridges ───
export const bridges = {
  telegram: {
    start: (token: string, chatId?: string) => request<{ ok: boolean }>('/telegram/start', { method: 'POST', body: JSON.stringify({ token, chatId }) }),
    stop: () => request<{ ok: boolean }>('/telegram/stop', { method: 'POST' }),
    status: () => request<BridgeStatus>('/telegram/status'),
  },
  discord: {
    start: (botToken: string, channelId?: string) => request<{ ok: boolean }>('/discord/start', { method: 'POST', body: JSON.stringify({ botToken, channelId }) }),
    stop: () => request<{ ok: boolean }>('/discord/stop', { method: 'POST' }),
    status: () => request<BridgeStatus>('/discord/status'),
  },
  slack: {
    start: (botToken: string, appToken: string) => request<{ ok: boolean }>('/slack/start', { method: 'POST', body: JSON.stringify({ botToken, appToken }) }),
    stop: () => request<{ ok: boolean }>('/slack/stop', { method: 'POST' }),
    status: () => request<BridgeStatus>('/slack/status'),
  },
  email: {
    start: (cfg: EmailConfig) => request<{ ok: boolean }>('/email/start', { method: 'POST', body: JSON.stringify(cfg) }),
    stop: () => request<{ ok: boolean }>('/email/stop', { method: 'POST' }),
    status: () => request<BridgeStatus>('/email/status'),
  },
};

// ─── Scheduler ───
export const scheduler = {
  jobs: () => request<{ jobs: SchedulerJob[] }>('/scheduler/jobs').then(r => r.jobs ?? []),
  create: (name: string, cron: string, instruction: string) => request<{ ok: boolean }>('/scheduler/jobs', { method: 'POST', body: JSON.stringify({ name, cron, instruction }) }),
  delete: (id: string) => request<{ ok: boolean }>(`/scheduler/jobs/${id}`, { method: 'DELETE' }),
  run: (id: string) => request<{ ok: boolean }>(`/scheduler/jobs/${id}/run`, { method: 'POST' }),
  parseCron: (text: string) => request<{ cron: string; original: string }>('/scheduler/parse-cron', { method: 'POST', body: JSON.stringify({ text }) }),
};

// ─── Secret Sauce (Soul / Identity / Diary / Memories / Permission / Crew) ───
export type SecretSauceFile = 'SOUL' | 'IDENTITY' | 'DIARY' | 'MEMORIES' | 'PERMISSION' | 'CREW';
export const secretSauce = {
  list: () => request<{ files: Array<{ file: SecretSauceFile; size: number; exists: boolean }> }>('/secret-sauce').then(r => r.files),
  get: (file: SecretSauceFile) => request<{ content: string; exists: boolean }>(`/secret-sauce/${file}`),
  save: (file: SecretSauceFile, content: string) => request<{ ok: boolean; size: number }>(`/secret-sauce/${file}`, { method: 'PUT', body: JSON.stringify({ content }) }),
};

// ─── Orchestrator ───
export interface OrchestratorStep { id: string; description: string; status: 'pending' | 'executing' | 'done' | 'failed'; result?: string; dependsOn?: string[]; }
export interface OrchestratorPlan { id: string; goal: string; steps: OrchestratorStep[]; status: 'created' | 'executing' | 'complete' | 'failed'; }
export const orchestrator = {
  createPlan: (goal: string) => request<{ plan: OrchestratorPlan }>('/orchestrator/plan', { method: 'POST', body: JSON.stringify({ goal }) }).then(r => r.plan),
  execute: (planId: string) => request<{ plan: OrchestratorPlan }>(`/orchestrator/plan/${planId}/execute`, { method: 'POST' }).then(r => r.plan),
};

// ─── Todos ───
export const todos = {
  list: (sessionId?: string) => request<{ todos: TodoItem[] }>(`/todos${sessionId ? '?sessionId=' + sessionId : ''}`).then(r => r.todos ?? []),
  save: (todos: TodoItem[], sessionId?: string) => request<{ ok: boolean }>('/todos', { method: 'POST', body: JSON.stringify({ todos, sessionId }) }),
  update: (itemId: string, data: Partial<TodoItem>) => request<{ ok: boolean }>(`/todos/${itemId}`, { method: 'PUT', body: JSON.stringify(data) }),
};

// ─── SSE Stream Connection ───
export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface SSEHandlers {
  onEvent: (event: TelemetryEvent) => void;
  onState?: (state: ConnectionState, info?: { retryIn?: number; attempt?: number }) => void;
}

export function connectSSE(
  arg: ((event: TelemetryEvent) => void) | SSEHandlers,
): () => void {
  const handlers: SSEHandlers = typeof arg === 'function' ? { onEvent: arg } : arg;
  let es: EventSource | null = null;
  let closed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryCount = 0;

  function setState(state: ConnectionState, info?: { retryIn?: number; attempt?: number }) {
    handlers.onState?.(state, info);
  }

  function connect() {
    if (closed) return;
    setState(retryCount === 0 ? 'connecting' : 'reconnecting', { attempt: retryCount });
    es = new EventSource(`${BASE}/chat/stream`, { withCredentials: true });

    es.addEventListener('telemetry', (e) => {
      try {
        retryCount = 0; // Reset on successful message
        const data = JSON.parse(e.data) as TelemetryEvent;
        handlers.onEvent(data);
      } catch { /* ignore parse errors */ }
    });

    es.onopen = () => { retryCount = 0; setState('open'); };

    es.onerror = () => {
      es?.close();
      if (!closed) {
        retryCount++;
        const delay = Math.min(3000 * Math.pow(2, retryCount - 1), 30000); // Exponential backoff, max 30s
        setState('reconnecting', { retryIn: delay, attempt: retryCount });
        retryTimer = setTimeout(connect, delay);
      }
    };
  }

  connect();

  return () => {
    closed = true;
    setState('closed');
    if (retryTimer) clearTimeout(retryTimer);
    es?.close();
  };
}

// ─── Types ───
export interface AgentXConfig {
  provider: { activeProvider: string; activeModel: string; providers: Record<string, ProviderSettings> };
  ui: { theme: string; showTokenBar: boolean; showTimers: boolean; animationSpeed: string; disabledTools?: string[] };
  organization: { name: string; contact?: string } | null;
  telemetry: boolean;
  timezone?: string;
  user?: { callsign: string };
  setupComplete?: boolean;
  rag?: { enabled: boolean; embeddingModel: string; chunkSize: number; topK: number };
}

export interface ProviderSettings {
  apiKey?: string;
  baseUrl?: string;
  configured?: boolean;
  activeProfile?: string;
  profiles?: Record<string, { label: string; apiKey: string; baseUrl?: string }>;
}

export interface ProviderInfo {
  id: string;
  name: string;
  description?: string;
  type: 'cloud' | 'local';
  requiresApiKey?: boolean;
  defaultBaseUrl?: string;
  models?: ModelInfo[];
}

export interface ConfiguredProvider {
  id: string;
  name: string;
  configured: boolean;
  activeProfile?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  providerId?: string;
  contextWindow?: number;
  capabilities?: string[];
  pricing?: { input: number; output: number };
}

export interface Crew {
  id: string;
  name: string;
  title?: string;
  callsign: string;
  systemPrompt: string;
  tone?: string;
  isDefault?: boolean;
  enabled?: boolean;
  expertise?: string[];
  traits?: string[];
}

export interface CrewInput {
  name: string;
  title?: string;
  callsign: string;
  systemPrompt: string;
  tone?: string;
  expertise?: string[];
  traits?: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: string;
  tokenCount?: number;
  crew?: { crewId: string; name: string; callsign: string };
  thinking?: string;
  thinkingStartedAt?: number;
  thinkingDoneAt?: number;
  toolCalls?: Array<{ id: string; name: string; args?: string; result?: string; status: 'running' | 'done' | 'error'; elapsed?: number }>;
  subAgents?: Array<{ id: string; name: string; task: string; status: 'running' | 'done' | 'error'; result?: string }>;
  plan?: string[];
  turnTokens?: number;
  turnCostUsd?: number;
}

export interface SessionInfo {
  id: string;
  provider: string;
  model: string;
  crewId?: string;
  messageCount: number;
  status?: string;
  tokensUsed: number;
  createdAt: string;
  title?: string;
}

export interface SessionContext {
  context: string;
  memories: string;
  pending: string;
  completed: string;
  suggestions: string;
}

export interface ToolInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  riskLevel?: string;
}

export interface ToolCategory {
  category: string;
  count: number;
  tools: ToolInfo[];
}

export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  installed: boolean;
  category?: string;
  config?: Record<string, unknown>;
  configFields?: PluginConfigField[];
}

export interface PluginConfigField {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  placeholder?: string;
}

export interface MCPServer {
  id: string;
  name: string;
  command?: string;
  host?: string;
  port?: number;
  status: 'running' | 'stopped' | 'error';
  toolCount?: number;
}

export interface MCPServerInput {
  name: string;
  command?: string;
  args?: string[];
  host?: string;
  port?: number;
}

export interface MCPServerStatus {
  running: boolean;
  toolCount: number;
  error?: string;
}

export interface RAGResult {
  content: string;
  score: number;
  metadata?: Record<string, string>;
}

export interface BridgeStatus {
  configured: boolean;
  connected: boolean;
  error?: string;
  token?: string;
  chatId?: string;
  [key: string]: unknown;
}

export interface EmailConfig {
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPass: string;
  fromAddress?: string;
  imapHost?: string;
  imapPort?: string;
}

export interface SchedulerJob {
  id: string;
  name: string;
  cron: string;
  instruction: string;
  lastRun?: string | number;
  nextRun?: string | number;
  runCount?: number;
  enabled?: boolean;
}

export interface TodoItem {
  id: string;
  title: string;
  status: 'not-started' | 'in-progress' | 'completed';
}

export interface HealthStatus {
  status: string;
  version: string;
  uptime: number;
  sessionCount: number;
  crewCount: number;
  agentActive: boolean;
  telegramConnected: boolean;
  telegramBot?: string | null;
  memory: { rss: number; heapUsed: number };
  config?: { provider?: string; model?: string; user?: string };
}

export interface TelemetryEvent {
  type: string;
  [key: string]: unknown;
}

// ─── Gateway / Focus ───
export interface GatewayStatus {
  active: boolean;
  focus?: string | null;
  channels?: string[];
  channelStats?: Record<string, unknown>;
}

export interface FocusStatus {
  focus: string | null;
  channels: string[];
  activeChannels: string[];
}

export interface TuiActiveStatus {
  active: boolean;
  pid?: number;
}

export const gateway = {
  status: () => request<GatewayStatus>('/gateway/status'),
  focus: () => request<FocusStatus>('/gateway/focus'),
  setFocus: (channel: string) => request<{ ok: boolean; focus: string }>('/gateway/focus', { method: 'POST', body: JSON.stringify({ channel }) }),
};

export const tuiActive = {
  check: () => request<TuiActiveStatus>('/tui-active'),
};

// ─── Web-UI Active ───
export interface WebuiActiveStatus {
  active: boolean;
  pid?: number;
  timestamp?: number;
}

export const webuiActive = {
  check: () => request<WebuiActiveStatus>('/webui-active'),
  register: (pid?: number) => request<{ ok: boolean }>('/webui-active', { 
    method: 'POST', 
    body: JSON.stringify({ pid: pid ?? Date.now() }) 
  }),
  unregister: () => request<{ ok: boolean }>('/webui-active', { method: 'DELETE' }),
};
