// Centralized API client for all web-api endpoints

const BASE = '/api';

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers as Record<string, string> ?? {}) },
    ...opts,
  });
  if (res.status === 401) {
    // Redirect to login
    window.location.hash = '#/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string; message?: string }).message ?? (body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Auth ───
export const auth = {
  check: () => request<{ hasRootUser: boolean }>('/auth/check'),
  status: () => request<{ authenticated: boolean; username?: string }>('/auth/status'),
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
  available: () => request<ProviderInfo[]>('/providers/available'),
  configured: () => request<ConfiguredProvider[]>('/providers'),
  validate: (providerId: string, apiKey: string, baseUrl?: string) => request<{ valid: boolean; error?: string }>('/provider/validate', { method: 'POST', body: JSON.stringify({ providerId, apiKey, baseUrl }) }),
  configure: (providerId: string, apiKey: string, baseUrl?: string) => request<{ ok: boolean }>('/provider/configure', { method: 'POST', body: JSON.stringify({ providerId, apiKey, baseUrl }) }),
  models: (providerId: string) => request<ModelInfo[]>('/provider/models?providerId=' + providerId),
  createProfile: (providerId: string, label: string, apiKey: string, baseUrl?: string) => request<{ ok: boolean }>('/provider/profile', { method: 'POST', body: JSON.stringify({ providerId, label, apiKey, baseUrl }) }),
  switchProfile: (providerId: string, profileId: string) => request<{ ok: boolean }>('/provider/profile/switch', { method: 'POST', body: JSON.stringify({ providerId, profileId }) }),
};

// ─── Models ───
export const models = {
  switch: (model: string) => request<{ ok: boolean }>('/model/switch', { method: 'POST', body: JSON.stringify({ model }) }),
  current: () => request<{ model: string; provider: string }>('/models'),
};

// ─── Crews ───
export const crews = {
  list: () => request<Crew[]>('/crews'),
  current: () => request<Crew>('/crew/current'),
  switch: (crewId: string) => request<{ ok: boolean }>('/crew/switch', { method: 'POST', body: JSON.stringify({ crewId }) }),
  create: (data: CrewInput) => request<{ ok: boolean; crew: Crew }>('/crews', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<CrewInput>) => request<{ ok: boolean }>(`/crews/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => request<{ ok: boolean }>(`/crews/${id}`, { method: 'DELETE' }),
};

// ─── Chat ───
export const chat = {
  send: (text: string) => request<{ ok: boolean; message: ChatMessage }>('/chat/message', { method: 'POST', body: JSON.stringify({ text }) }),
  cancel: () => request<{ ok: boolean }>('/chat/cancel', { method: 'POST' }),
  history: () => request<ChatMessage[]>('/chat/history'),
  clear: () => request<{ ok: boolean }>('/chat/clear', { method: 'POST' }),
};

// ─── Sessions ───
export const sessions = {
  list: () => request<SessionInfo[]>('/sessions'),
  create: () => request<{ sessionId: string }>('/sessions', { method: 'POST' }),
  get: (id: string) => request<SessionInfo>(`/sessions/${id}`),
  delete: (id: string) => request<{ ok: boolean }>(`/sessions/${id}`, { method: 'DELETE' }),
  restore: (id: string) => request<{ ok: boolean }>(`/sessions/${id}/restore`, { method: 'POST' }),
  context: (id: string) => request<SessionContext>(`/sessions/${id}/context`),
};

// ─── Permissions ───
export const permissions = {
  respond: (choice: 'allow_once' | 'allow_always' | 'deny') => request<{ ok: boolean }>('/permission/respond', { method: 'POST', body: JSON.stringify({ choice }) }),
};

// ─── Tools ───
export const tools = {
  list: () => request<ToolInfo[]>('/tools'),
  categories: () => request<ToolCategory[]>('/tools/categories'),
  get: (id: string) => request<ToolInfo>(`/tools/${id}`),
  toggle: (id: string, enabled: boolean) => request<{ ok: boolean }>(`/tools/${id}`, { method: 'PUT', body: JSON.stringify({ enabled }) }),
};

// ─── Plugins ───
export const plugins = {
  list: () => request<PluginInfo[]>('/plugins'),
  available: () => request<PluginInfo[]>('/plugins/available'),
  installed: () => request<PluginInfo[]>('/plugins/installed'),
  install: (id: string) => request<{ ok: boolean }>(`/plugins/${id}/install`, { method: 'POST' }),
  uninstall: (id: string) => request<{ ok: boolean }>(`/plugins/${id}/uninstall`, { method: 'POST' }),
  toggle: (id: string) => request<{ ok: boolean }>(`/plugins/${id}/toggle`, { method: 'POST' }),
  getConfig: (id: string) => request<PluginInfo>(`/plugins/${id}`),
  updateConfig: (id: string, cfg: Record<string, unknown>) => request<{ ok: boolean }>(`/plugins/${id}/config`, { method: 'PUT', body: JSON.stringify(cfg) }),
};

// ─── MCP ───
export const mcp = {
  servers: () => request<MCPServer[]>('/mcp/servers'),
  add: (data: MCPServerInput) => request<{ ok: boolean }>('/mcp/servers', { method: 'POST', body: JSON.stringify(data) }),
  restart: (id: string) => request<{ ok: boolean }>(`/mcp/servers/${id}/restart`, { method: 'POST' }),
  status: (id: string) => request<MCPServerStatus>(`/mcp/servers/${id}/status`),
  remove: (id: string) => request<{ ok: boolean }>(`/mcp/servers/${id}`, { method: 'DELETE' }),
};

// ─── RAG ───
export const rag = {
  status: () => request<{ enabled: boolean; chunkCount: number }>('/rag/status'),
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
  jobs: () => request<SchedulerJob[]>('/scheduler/jobs'),
  create: (name: string, cron: string, instruction: string) => request<{ ok: boolean }>('/scheduler/jobs', { method: 'POST', body: JSON.stringify({ name, cron, instruction }) }),
  delete: (id: string) => request<{ ok: boolean }>(`/scheduler/jobs/${id}`, { method: 'DELETE' }),
  parseCron: (natural: string) => request<{ cron: string; description: string }>('/scheduler/parse-cron', { method: 'POST', body: JSON.stringify({ natural }) }),
};

// ─── Todos ───
export const todos = {
  list: (sessionId?: string) => request<TodoItem[]>(`/todos${sessionId ? '?sessionId=' + sessionId : ''}`),
  save: (items: TodoItem[], sessionId?: string) => request<{ ok: boolean }>('/todos', { method: 'POST', body: JSON.stringify({ items, sessionId }) }),
  update: (itemId: string, data: Partial<TodoItem>) => request<{ ok: boolean }>(`/todos/${itemId}`, { method: 'PUT', body: JSON.stringify(data) }),
};

// ─── SSE Stream Connection ───
export function connectSSE(onEvent: (event: TelemetryEvent) => void): () => void {
  const es = new EventSource(`${BASE}/chat/stream`, { withCredentials: true });

  es.addEventListener('telemetry', (e) => {
    try {
      const data = JSON.parse(e.data) as TelemetryEvent;
      onEvent(data);
    } catch { /* ignore parse errors */ }
  });

  es.onerror = () => {
    // Reconnect handled automatically by EventSource
  };

  return () => es.close();
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
  description: string;
  type: 'cloud' | 'local';
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
  contextWindow?: number;
  pricing?: { input: number; output: number };
}

export interface Crew {
  id: string;
  name: string;
  systemPrompt: string;
  tone?: string;
  isDefault?: boolean;
}

export interface CrewInput {
  name: string;
  systemPrompt: string;
  tone?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: string;
  tokenCount?: number;
}

export interface SessionInfo {
  id: string;
  provider: string;
  model: string;
  crewId?: string;
  messageCount: number;
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
  lastRun?: string;
  nextRun?: string;
}

export interface TodoItem {
  id: string;
  title: string;
  status: 'not-started' | 'in-progress' | 'completed';
}

export interface HealthStatus {
  status: string;
  uptime: number;
  sessionCount: number;
  crewCount: number;
  agentActive: boolean;
  memory: { rss: number; heapUsed: number };
}

export interface TelemetryEvent {
  type: string;
  [key: string]: unknown;
}
