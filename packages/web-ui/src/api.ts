// Centralized API client for all web-api endpoints

const BASE = '/api';

// Auth token management — avoids cookie dependency since Electron's cookie
// store may not persist cookies across navigations within the same session.
let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
  if (token) {
    sessionStorage.setItem('agentx_auth_token', token);
  } else {
    sessionStorage.removeItem('agentx_auth_token');
  }
}

export function getAuthToken(): string | null {
  return authToken;
}

export function setOnUnauthorized(cb: (() => void) | null): void {
  onUnauthorized = cb;
}

// Debug logger — writes parse errors to ~/.local/share/agentx/debug-logs/
// so developers can see raw API responses without guessing the data format.
async function writeDebugLog(entry: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${BASE}/debug/log`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
      body: JSON.stringify(entry),
    });
  } catch { /* best effort */ }
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> ?? {}),
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers,
    ...opts,
  });
  if (res.status === 401) {
    onUnauthorized?.();
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
  setup: (username: string, password: string) => request<{ ok: boolean; username: string; token: string }>('/auth/setup', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) => request<{ ok: boolean; username: string; token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
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
  configure: (provider: string, apiKey?: string, baseUrl?: string, profileName?: string) => request<{ ok: boolean }>('/provider/configure', { method: 'POST', body: JSON.stringify({ provider, apiKey, baseUrl, profileName }) }),
  models: (provider: string) => request<ModelInfo[]>('/provider/models?provider=' + provider),
  switch: (provider: string) => request<{ ok: boolean; provider: string; model: string }>('/provider/switch', { method: 'POST', body: JSON.stringify({ provider }) }),
  createProfile: (provider: string, label: string, apiKey: string, baseUrl?: string, setActive?: boolean) => request<{ ok: boolean; provider: string; profileId: string }>('/provider/profile', { method: 'POST', body: JSON.stringify({ provider, profileId: label, label, apiKey, baseUrl, setActive }) }),
  switchProfile: (providerId: string, profileId: string) => request<{ ok: boolean }>('/provider/profile/switch', { method: 'POST', body: JSON.stringify({ providerId, profileId }) }),
};

// ─── Models ───
export const models = {
  switch: (modelId: string, opts?: { contextWindow?: number; providerId?: string }) =>
    request<{ ok: boolean }>('/model/switch', {
      method: 'POST',
      body: JSON.stringify({ modelId, contextWindow: opts?.contextWindow, providerId: opts?.providerId }),
    }),
  current: () => request<{ model: string; provider: string; providerId?: string; activeProfile?: string }>('/models'),
};

// ─── Crews ───
export const crews = {
  list: () => request<{ crews: Crew[]; activeId?: string }>('/crews').then(r => r.crews ?? []),
  create: (data: CrewInput) => request<{ ok: boolean; crew: Crew }>('/crews', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<CrewInput>) => request<{ ok: boolean }>(`/crews/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => request<{ ok: boolean }>(`/crews/${id}`, { method: 'DELETE' }),
  toggle: (id: string, enabled: boolean) => request<{ ok: boolean }>('/crew/toggle', { method: 'POST', body: JSON.stringify({ crewId: id, enabled }) }),
  generateMetadata: (systemPrompt?: string, title?: string, name?: string, description?: string) => request<{ expertise: string[]; traits: string[]; revisedPrompt: string }>('/crew/generate-metadata', { method: 'POST', body: JSON.stringify({ systemPrompt, title, name, description }) }),
};

// ─── Crew private chat (1:1, no Agent-X) ───
export interface CrewChatCrewInfo {
  id: string;
  name: string;
  title?: string;
  callsign: string;
  color?: string;
  icon?: string;
  catalogId?: string;
  categoryId?: string;
  description?: string;
  expertise?: string[];
  traits?: string[];
  emotion?: string;
  tone?: string;
}

export interface CrewChatSessionInfo {
  id: string;
  title?: string;
  contextKind?: 'agent_x' | 'crew_private';
  hostCrewId?: string;
  crewId?: string;
  crewName?: string;
  crewCallsign?: string;
  scopePath?: string;
  createdAt?: string;
  updatedAt?: string;
}

export const crewChat = {
  startSession: (body: {
    crewId?: string;
    scopePath?: string;
    recruit?: {
      id?: string;
      name: string;
      title?: string;
      callsign?: string;
      systemPrompt: string;
      description?: string;
      tone?: string;
      expertise?: string[];
      traits?: string[];
      tools?: string[];
      source?: string;
      catalogId?: string;
    };
  }) => request<{
    sessionId: string;
    created: boolean;
    crew: CrewChatCrewInfo;
    session: CrewChatSessionInfo;
  }>('/crew-chat/sessions', { method: 'POST', body: JSON.stringify(body) }),

  restore: (sessionId: string, opts?: { limit?: number; before?: string }) => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.before) params.set('before', opts.before);
    const qs = params.toString();
    return request<{
      session: CrewChatSessionInfo;
      crew: CrewChatCrewInfo;
      messages: ChatMessage[];
      pagination?: { total: number; hasMore: boolean; limit: number; before: string | null; oldestId: string | null };
      canonicalSessionId?: string;
      redirected?: boolean;
    }>(`/crew-chat/sessions/${sessionId}${qs ? `?${qs}` : ''}`);
  },

  loadOlderMessages: (sessionId: string, before: string, limit = 50) => request<{
    messages: ChatMessage[];
    pagination: { total: number; hasMore: boolean; limit: number; before: string; oldestId: string | null };
  }>(`/crew-chat/sessions/${sessionId}/messages?before=${encodeURIComponent(before)}&limit=${limit}`),

  cancel: (sessionId: string) => request<{ ok: boolean }>(
    `/crew-chat/sessions/${sessionId}/cancel`,
    { method: 'POST', body: JSON.stringify({}) },
  ),

  sendMessage: (sessionId: string, text: string) => request<{
    ok: boolean;
    content: string;
    userMessageId: string;
    assistantMessageId: string;
    elapsed: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    crew: CrewChatCrewInfo;
  }>(`/crew-chat/sessions/${sessionId}/message`, { method: 'POST', body: JSON.stringify({ text }) }),

  retry: (sessionId: string) => request<{ ok: boolean; narrativeEntries: number }>(
    `/crew-chat/sessions/${sessionId}/retry`,
    { method: 'POST', body: JSON.stringify({}) },
  ),

  sendStream: async (
    sessionId: string,
    text: string,
    onProgress: (event: { type: string; data: unknown }) => void,
    retry?: boolean,
  ): Promise<{ ok: boolean; content?: string; error?: string; inputTokens?: number; outputTokens?: number; costUsd?: number }> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    const response = await fetch(`${BASE}/crew-chat/sessions/${sessionId}/message-stream`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ text, retry }),
    });

    if (response.status === 401) {
      onUnauthorized?.();
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((error as { error?: string }).error || `HTTP ${response.status}`);
    }

    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: { ok: boolean; content?: string; error?: string; inputTokens?: number; outputTokens?: number; costUsd?: number } = { ok: false };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let currentEvent = { id: '', event: '', data: '' };

      for (const line of lines) {
        if (line.startsWith('id: ')) {
          currentEvent.id = line.slice(4);
        } else if (line.startsWith('event: ')) {
          currentEvent.event = line.slice(7);
        } else if (line.startsWith('data: ')) {
          currentEvent.data = line.slice(6);
        } else if (line === '' && currentEvent.event) {
          try {
            const data = currentEvent.data ? JSON.parse(currentEvent.data) : null;
            onProgress({ type: currentEvent.event, data });

            if (currentEvent.event === 'complete') {
              result = {
                ok: true,
                content: data?.content,
                inputTokens: data?.inputTokens,
                outputTokens: data?.outputTokens,
                costUsd: data?.costUsd,
              };
            } else if (currentEvent.event === 'error') {
              result = { ok: false, error: data?.error };
            }
          } catch { /* ignore parse errors */ }
          currentEvent = { id: '', event: '', data: '' };
        }
      }
    }

    return result;
  },

  findByCrew: (crewId: string) => request<{
    sessionId: string | null;
    crew: CrewChatCrewInfo | null;
    session?: CrewChatSessionInfo;
  }>(`/crew-chat/by-crew/${crewId}`),
};

export const crewSuggestions = {
  evaluate: (text: string, sessionId: string, priorUserMessages?: string[]) =>
    request<CrewSuggestionEvaluation>('/crew-suggestions/evaluate', {
      method: 'POST',
      body: JSON.stringify({ text, sessionId, priorUserMessages }),
    }),
  resolve: (payload: {
    sessionId: string;
    action: 'deploy' | 'skip' | 'dismiss';
    dismissForSession?: boolean;
    selectedCandidateIds?: string[];
    candidates?: CrewMatchCandidate[];
  }) => request<{ ok: boolean; deployedCrewIds: string[] }>('/crew-suggestions/resolve', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  clearDismiss: (sessionId: string) =>
    request<{ ok: boolean }>('/crew-suggestions/clear-dismiss', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),
  getCatalogEntry: (id: string) =>
    request<{ entry: CatalogEntry }>(`/crew-catalog/${encodeURIComponent(id)}`),
};

export const crewCatalog = {
  seedStatus: () => request<CatalogSeedStatusResponse>('/crew-catalog/seed-status'),
  listCategories: () => request<{ categories: CatalogCategorySummary[] }>('/crew-catalog/categories'),
  listByCategory: (categoryId: string, limit = 500) =>
    request<{ crews: CatalogSummary[] }>(`/crew-catalog/by-category/${encodeURIComponent(categoryId)}?limit=${limit}`),
  search: (q: string, limit = 40) =>
    request<{ crews: CatalogSummary[] }>(`/crew-catalog/search?q=${encodeURIComponent(q)}&limit=${limit}`),
};

// ─── Chat ───
async function postChatAsync(path: string, body: Record<string, unknown>) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const response = await fetch(`${BASE}${path}`, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) });
  if (response.status === 401) { onUnauthorized?.(); throw new Error('Unauthorized'); }
  const data = await response.json().catch(() => ({})) as { ok?: boolean; message?: ChatMessage; turnId?: string; async?: boolean; error?: string; clarification?: boolean };
  if (!response.ok && response.status !== 202) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export const chat = {
  send: (text: string, attachments?: { name: string; content: string }[], retry?: boolean, delegateCrewIds?: string[]) =>
    postChatAsync('/chat/message', { text, attachments, retry, delegateCrewIds }),

  getTurn: (turnId: string) => request<{ turnId: string; status: string; message?: ChatMessage; error?: string; partialContent?: string }>(`/chat/turn/${turnId}`),
  
  // NEW: Streaming version with real-time progress events
  sendStream: async (
    text: string,
    onProgress: (event: { type: string; data: unknown }) => void,
    attachments?: { name: string; content: string }[],
    retry?: boolean,
    delegateCrewIds?: string[],
  ): Promise<{ ok: boolean; message?: ChatMessage; clarification?: boolean; error?: string }> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    try {
      const response = await fetch(`${BASE}/chat/message-stream`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ text, attachments, retry, delegateCrewIds }),
      });

      if (response.status === 401) {
        onUnauthorized?.();
        throw new Error('Unauthorized');
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error((error as any).error || `HTTP ${response.status}`);
      }

      // Handle Server-Sent Events
      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = { id: '', event: '', data: '' };

        for (const line of lines) {
          if (line.startsWith('id: ')) {
            currentEvent.id = line.slice(4);
          } else if (line.startsWith('event: ')) {
            currentEvent.event = line.slice(7);
          } else if (line.startsWith('data: ')) {
            currentEvent.data = line.slice(6);
          } else if (line === '' && currentEvent.event) {
            // Parse event
            try {
              const data = currentEvent.data ? JSON.parse(currentEvent.data) : null;
              onProgress({ type: currentEvent.event, data });

              // Handle completion events
              if (currentEvent.event === 'complete') {
                return { ok: true, message: data?.message };
              } else if (currentEvent.event === 'clarification') {
                return { ok: true, clarification: true };
              } else if (currentEvent.event === 'error') {
                return { ok: false, error: data?.error };
              }
            } catch (e) {
              // Ignore parse errors
            }
            currentEvent = { id: '', event: '', data: '' };
          } else if (line.startsWith(':')) {
            // Heartbeat comment, ignore
          }
        }
      }

      return { ok: false, error: 'Stream ended unexpectedly' };
    } catch (error) {
      throw error;
    }
  },
  
  cancel: () => request<{ ok: boolean }>('/chat/cancel', { method: 'POST' }),
  history: () => request<ChatMessage[]>('/chat/history'),
  clear: () => request<{ ok: boolean }>('/chat/clear', { method: 'POST' }),
  queue: (text: string, attachments?: { name: string; content: string }[]) => request<{ ok: boolean; queueLength: number }>('/chat/queue', { method: 'POST', body: JSON.stringify({ text, attachments }) }),
  getQueue: () => request<{ queue: Array<{ text: string }>; length: number }>('/chat/queue'),
  clearQueue: () => request<{ ok: boolean }>('/chat/queue', { method: 'DELETE' }),
  steer: (text: string, attachments?: { name: string; content: string }[]) =>
    postChatAsync('/chat/steer', { text, attachments }),
  stopAndSend: (text: string, attachments?: { name: string; content: string }[]) =>
    postChatAsync('/chat/stop-and-send', { text, attachments }),
};

// ─── Sessions ───
export interface Checkpoint {
  id: string;
  label: string;
  createdAt: string;
  messageCount: number;
}

export interface DbStatus {
  dbMode: 'sqlite' | 'memory' | 'unknown' | 'error';
  sessionCount: number;
  filesystemRecovered: number;
  schemaVersion: number;
}

export const sessions = {
  dbStatus: () => request<DbStatus>('/sessions/db-status'),
  list: () => request<SessionInfo[]>('/sessions'),
  children: (parentId: string) => request<{ children: ChildSessionInfo[] }>(`/sessions/${parentId}/children`).then((r) => r.children ?? []),
  preview: (id: string) => request<{ session: SessionInfo; messages: ChatMessage[] }>(`/sessions/${id}/preview`),
  create: (scopePath?: string) => request<{ sessionId: string }>('/sessions', { method: 'POST', body: scopePath ? JSON.stringify({ scopePath }) : undefined }),
  get: (id: string) => request<SessionInfo>(`/sessions/${id}`),
  delete: (id: string) => request<{ ok: boolean }>(`/sessions/${id}`, { method: 'DELETE' }),
  restore: (id: string) => request<{ session: SessionInfo; messages: ChatMessage[]; parts?: Array<Record<string, unknown>>; crewStates?: Array<{ crewId: string; enabled: boolean }>; scopePath?: string }>(`/sessions/${id}/restore`, { method: 'POST' }),
  context: (id: string) => request<SessionContext>(`/sessions/${id}/context`),
  compact: (id: string) => request<{ ok: boolean; summary: string }>(`/sessions/${id}/compact`, { method: 'POST' }),
  checkpoint: (id: string, label?: string) => request<{ checkpointId: string; label: string }>(`/sessions/${id}/checkpoint`, { method: 'POST', body: JSON.stringify({ label }) }),
  checkpoints: (id: string) => request<{ checkpoints: Checkpoint[] }>(`/sessions/${id}/checkpoints`).then(r => r.checkpoints ?? []),
  restoreCheckpoint: (id: string, checkpointId: string) => request<{ ok: boolean; label: string; messageCount: number }>(`/sessions/${id}/checkpoint/${checkpointId}/restore`, { method: 'POST' }),
  deleteCheckpoint: (id: string, checkpointId: string) => request<{ ok: boolean }>(`/sessions/${id}/checkpoint/${checkpointId}`, { method: 'DELETE' }),
  generateTitle: (id: string) => request<{ title: string }>(`/sessions/${id}/generate-title`, { method: 'POST' }),
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
export type AgentMode = 'agent' | 'plan';

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
    const streamUrl = authToken
      ? `${BASE}/chat/stream?token=${encodeURIComponent(authToken)}`
      : `${BASE}/chat/stream`;
    es = new EventSource(streamUrl, { withCredentials: true });

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

// ─── Persona API ───
export const personaApi = {
  get: () => request<AgentPersonaConfig | Record<string, never>>('/agent/persona'),
  save: (data: AgentPersonaConfig) =>
    request<{ ok: boolean }>('/agent/persona', { method: 'PUT', body: JSON.stringify(data) }),
};

// ─── Types ───
export type CommunicationStyle = 'formal' | 'casual' | 'direct' | 'empathetic';
export type DecisionMakingStyle = 'conservative' | 'balanced' | 'aggressive';

export interface AgentPersonaConfig {
  name: string;
  description: string;
  communicationStyle: CommunicationStyle;
  decisionMaking: DecisionMakingStyle;
  domainContext: string;
  traits: string[];
}

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
  description?: string;
  tone?: string;
  isDefault?: boolean;
  enabled?: boolean;
  expertise?: string[];
  traits?: string[];
  tools?: string[];
  color?: string;
  icon?: string;
  catalogId?: string;
  categoryId?: string;
  requiresMedicalDisclaimer?: boolean;
}

export interface CrewInput {
  id?: string;
  name: string;
  title?: string;
  callsign: string;
  systemPrompt: string;
  description?: string;
  tone?: string;
  source?: 'custom' | 'hub';
  catalogId?: string;
  expertise?: string[];
  traits?: string[];
  tools?: string[];
  color?: string;
  icon?: string;
}

export interface CatalogSeedStatusResponse {
  status: 'idle' | 'seeding' | 'ready' | 'error';
  table: 'crew_catalog';
  ftsTable: 'crew_catalog_fts' | 'crew_catalog.search_tsv';
  seededCount: number;
  expectedCount: number;
  manifestRevision: number;
  storedRevision: number;
  percent: number;
  processedInRun: number;
  error?: string;
}

export interface CatalogCategorySummary {
  id: string;
  label: string;
  iconId?: string;
  crewCount: number;
}

export interface CatalogSummary {
  id: string;
  callsign: string;
  name: string;
  title: string;
  categoryId: string;
  categoryLabel: string;
  description: string;
  expertise: string[];
  traits: string[];
  tone?: string;
  tools?: string[];
  requiresMedicalDisclaimer?: boolean;
}

export interface CatalogEntry {
  id: string;
  callsign: string;
  name: string;
  title: string;
  categoryId: string;
  categoryLabel: string;
  description: string;
  systemPrompt: string;
  tone?: string;
  expertise: string[];
  traits: string[];
  tools?: string[];
  searchText: string;
  hubRevision: number;
  active: boolean;
  requiresMedicalDisclaimer?: boolean;
}

export interface CrewMatchCandidate {
  id: string;
  origin: 'hub_catalog' | 'custom' | 'hub_roster';
  callsign: string;
  name: string;
  title: string;
  description: string;
  expertise: string[];
  traits: string[];
  matchScore: number;
  reasons: string[];
  onRoster: boolean;
  enabled?: boolean;
  catalogId?: string;
  categoryId?: string;
  categoryLabel?: string;
  tone?: string;
  requiresMedicalDisclaimer?: boolean;
}

export interface CrewSuggestionEvaluation {
  shouldSuggest: boolean;
  dismissed: boolean;
  confidence: number;
  taskSummary: string;
  candidates: CrewMatchCandidate[];
  reasons: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: string;
  tokenCount?: number;
  crew?: { crewId: string; name: string; callsign: string; color?: string; icon?: string; confidence?: string; reasons?: string[] };
  thinking?: string;
  thinkingStartedAt?: number;
  thinkingDoneAt?: number;
  toolCalls?: Array<{ id: string; name: string; args?: string | Record<string, unknown>; result?: string; status: 'running' | 'done' | 'error'; elapsed?: number }>;
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
  contextKind?: 'agent_x' | 'crew_private';
  hostCrewId?: string;
  hostCrewName?: string;
  hostCrewCallsign?: string;
  hostCrewTitle?: string;
  mode?: 'agent' | 'plan';
  messageCount: number;
  status?: string;
  tokensUsed: number;
  tokenAvailable?: number;
  tokenUsagePct?: number;
  compactionCount?: number;
  childSessionCount?: number;
  crewCount?: number;
  crewCallsigns?: string[];
  totalCostUsd?: number;
  hyperdrive?: boolean;
  createdAt: string;
  updatedAt?: string;
  title?: string;
  scopePath?: string;
  parentId?: string;
}

export interface ChildSessionInfo {
  id: string;
  title?: string;
  label?: string;
  kind?: 'sub_agent' | 'crew_worker' | string;
  status?: string;
  parentId?: string;
  createdAt?: string;
  updatedAt?: string;
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
  pid?: number;
  node?: string;
  platform?: string;
  uptime: number;
  sessionCount: number;
  crewCount: number;
  sessions?: number;
  crews?: number;
  agentActive: boolean;
  telegramConnected: boolean;
  telegramBot?: string | null;
  memory: { rss: number; heapUsed: number; heapTotal?: number; external?: number };
  config?: { provider?: string; model?: string; user?: string };
  gateway?: {
    focus?: string | null;
    channels?: string[];
  } | null;
  agentHealth?: {
    sessionId: string;
    uptimeMs: number;
    llmCalls: number;
    toolExecs: number;
    errors: number;
    avgResponseMs: number;
    totalCost: number;
    budgetLimit: number;
    budgetPct: number;
    circuitBreakers: number;
    model: string;
    provider: string;
    activeSubAgents: number;
    contextTokens: number;
    contextWindow: number;
    compactionCount: number;
    planMode: boolean;
    hyperdriveMode: boolean;
    neuralConfidenceAvg: number;
    costHistory?: Array<{ ts: number; cost: number; errors: number }>;
  } | null;
}

export interface AutonomyStatus {
  available: boolean;
  health?: HealthStatus['agentHealth'];
  circuitBreakers?: Array<{ tool: string; failures: number; blacklisted: boolean; remainingMs: number }>;
  neural?: { proven: string; caution: string; growth: string };
  memoryDriven?: string;
  escalation?: {
    activeCheckpoints: number;
    checkpointDetails: Array<{ description: string; checkpointId: string }>;
  };
  offlineFallback?: { available: boolean; provider: string; model: string };
  dbMode?: string;
  compaction?: { count: number; contextTokens: number; contextWindow: number; tokenUsagePct: number };
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

// ─── Settings: Database ───
export interface DbStatus {
  backend: 'sqlite' | 'postgres';
  connected: boolean;
  stats: {
    dbSizeBytes: number;
    dbSizeFormatted: string;
    tableCount: number;
    tables: Record<string, number>;
    walSizeBytes: number;
  };
  health: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: Array<{ table: string; rows: number; ok: boolean }>;
  };
  fileStorage: {
    config: { path: string; sizeBytes: number; sizeFormatted: string };
    data: { path: string; sizeBytes: number; sizeFormatted: string };
    cache: { path: string; sizeBytes: number; sizeFormatted: string };
  };
  postgres: {
    configured: boolean;
    connectionString: string;
  };
}

export const settings = {
  db: {
    get: () => request<DbStatus>('/settings/db'),
    update: (config: { backend: string; postgres?: { connectionString: string } }) =>
      request<{ ok: boolean; backend?: string; tablesCreated?: number }>('/settings/db', { method: 'PUT', body: JSON.stringify(config) }),
    test: (connectionString: string) =>
      request<{ ok: boolean; latencyMs?: number; version?: string; tablesCreated?: number; error?: string }>(
        '/settings/db/test', { method: 'POST', body: JSON.stringify({ connectionString, ssh: undefined }) }
      ),
    testAdvanced: (connectionString: string, ssh?: { host: string; port: number; username: string; password?: string; privateKey?: string } | null) =>
      request<{ ok: boolean; latencyMs?: number; version?: string; tablesCreated?: number; error?: string }>(
        '/settings/db/test', { method: 'POST', body: JSON.stringify({ connectionString, ssh }) }
      ),
    migrate: () =>
      request<{ ok: boolean; migrated?: Record<string, number>; durationMs?: number; error?: string }>(
        '/settings/db/migrate', { method: 'POST' }
      ),
    health: () =>
      request<{ status: 'healthy' | 'degraded' | 'unhealthy'; checks: Array<{ table: string; rows: number; ok: boolean }> }>('/settings/db/health'),
    clear: () =>
      request<{ ok: boolean }>('/settings/db/clear', { method: 'POST' }),
    clearCache: () =>
      request<{ ok: boolean; freedFormatted: string }>('/settings/db/clear-cache', { method: 'POST' }),
  },
};

// ─── Agent Vitals ───
export interface AgentVitals {
  ageDays: number;
  birthDate: string | null;
  level: string;
  wisdomScore: number;
  totalExperiences: number;
  totalInteractions: number;
  totalCorrections: number;
  avgConfidence: number;
  currentMood: string;
  moodIntensity: number;
  memories: { total: number; categories: Record<string, number> };
  diaryEntries: number;
  brainSizeFormatted: string;
  nextMilestoneAt: number | null;
  capabilities: string[];
  status: string;
}

export const agent = {
  vitals: () => request<AgentVitals>('/agent/vitals'),
  autonomyStatus: () => request<AutonomyStatus>('/agent/autonomy-status'),
  resetCircuitBreaker: (tool?: string) =>
    request<{ ok: boolean }>('/agent/circuit-breaker/reset', { method: 'POST', body: JSON.stringify(tool ? { tool } : {}) }),
  respondToPlan: (approved: boolean) =>
    request<{ ok: boolean }>('/plan/respond', { method: 'POST', body: JSON.stringify({ approved }) }),
  respondToClarification: (response: string) =>
    request<{ ok: boolean }>('/clarification/respond', { method: 'POST', body: JSON.stringify({ response }) }),
  respondToModeEscalation: (accepted: boolean) =>
    request<{ ok: boolean }>('/agent/mode-escalation', { method: 'POST', body: JSON.stringify({ accepted }) }),
  respondToStepCap: (continueRun: boolean) =>
    request<{ ok: boolean }>('/agent/step-cap/respond', { method: 'POST', body: JSON.stringify({ continueRun }) }),
  getTurnState: () => request<{ phase: string; stage?: string; step?: number }>('/agent/turn-state'),
};

// ─── Factory Reset ───
export const factoryReset = {
  reset: () => request<{ ok: boolean; message: string }>('/reset', { method: 'POST' }),
};
