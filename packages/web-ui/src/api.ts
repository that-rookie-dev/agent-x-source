// Centralized API client for all web-api endpoints

import type { ClientSituation } from '@agentx/shared';
import { AGENTX_AUTH_TOKEN_KEY } from './utils/client-storage';
import { notifyVoiceConfigUpdated } from './voice/support';

const BASE = '/api';

// Auth token management — avoids cookie dependency since Electron's cookie
// store may not persist cookies across navigations within the same session.
let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
  if (token) {
    sessionStorage.setItem(AGENTX_AUTH_TOKEN_KEY, token);
  } else {
    sessionStorage.removeItem(AGENTX_AUTH_TOKEN_KEY);
  }
}

export function getAuthToken(): string | null {
  return authToken;
}

/** Refresh in-memory token from the active session cookie (needed for WebSocket ?token= auth). */
export async function syncAuthTokenFromSession(): Promise<string | null> {
  try {
    const status = await auth.status();
    if (status.sessionToken) {
      setAuthToken(status.sessionToken);
      return status.sessionToken;
    }
    if (!status.isAuthenticated) {
      setAuthToken(null);
      return null;
    }
  } catch {
    /* fall through */
  }
  return getAuthToken();
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

async function request<T>(path: string, opts: RequestInit = {}, timeoutMs = 60_000): Promise<T> {
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
    signal: opts.signal ?? AbortSignal.timeout(timeoutMs),
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
  status: () => request<{ isAuthenticated: boolean; username?: string | null; sessionToken?: string }>('/auth/status'),
  setup: (username: string, password: string) => request<{ ok: boolean; username: string; token: string }>('/auth/setup', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login: (username: string, password: string) => request<{ ok: boolean; username: string; token: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
};

// ─── Setup & Config ───
export const config = {
  getSetupStatus: () => request<{ setupComplete: boolean; configured: boolean }>('/setup/status'),
  completeSetup: (callsign?: string) =>
    request<{ ok: boolean; setupComplete: boolean }>('/setup/complete', {
      method: 'POST',
      body: JSON.stringify({ callsign }),
    }),
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
  deleteProfile: (providerId: string, profileId: string) => request<{ ok: boolean }>(`/provider/${providerId}/profile/${profileId}`, { method: 'DELETE' }),
};

// ─── Models ───
export const models = {
  switch: (modelId: string, opts?: { contextWindow?: number; providerId?: string; reasoningEffort?: string }) =>
    request<{ ok: boolean }>('/model/switch', {
      method: 'POST',
      body: JSON.stringify({
        modelId,
        contextWindow: opts?.contextWindow,
        providerId: opts?.providerId,
        reasoningEffort: opts?.reasoningEffort,
      }),
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
  contextKind?: 'agent_x' | 'agent_x_core' | 'crew_private' | 'automation';
  hostCrewId?: string;
  crewId?: string;
  crewName?: string;
  crewCallsign?: string;
  scopePath?: string;
  createdAt?: string;
  updatedAt?: string;
}

export const crewChat = {
  /** Create or return the crew-private session; open via `/console/chat/{sessionId}`. */
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
      categoryId?: string;
      color?: string;
    };
  }) => request<{
    sessionId: string;
    created: boolean;
    crew: CrewChatCrewInfo;
    session: CrewChatSessionInfo;
  }>('/crew-chat/sessions', { method: 'POST', body: JSON.stringify(body) }),
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
  }) => request<{ ok: boolean; deployedCrewIds: string[]; deployedPrimaryCrewId?: string }>('/crew-suggestions/resolve', {
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
  offerRosterPicker: (sessionId: string, body: {
    userText: string;
    evaluation: CrewSuggestionEvaluation;
    attachments?: Array<{ name: string }>;
    userMessageId?: string;
  }) => request<{ ok: boolean; userMessageId: string; pickerMessageId: string; pickerPartId: string }>(
    `/sessions/${sessionId}/crew-roster-picker`,
    { method: 'POST', body: JSON.stringify(body) },
  ),
  updateRosterPicker: (sessionId: string, body: {
    pickerMessageId: string;
    status: 'answered' | 'skipped';
    selectedCandidateIds?: string[];
    evaluation: CrewSuggestionEvaluation;
    pendingUserText: string;
    pickerPartId?: string;
  }) => request<{ ok: boolean }>(`/sessions/${sessionId}/crew-roster-picker`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }),
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
  const data = await response.json().catch(() => ({})) as {
    ok?: boolean;
    message?: ChatMessage;
    turnId?: string;
    async?: boolean;
    error?: string;
    clarification?: boolean;
    crewSuggestionRequired?: boolean;
    evaluation?: CrewSuggestionEvaluation;
  };
  if (!response.ok && response.status !== 202) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export const chat = {
  send: (
    text: string,
    attachments?: { name: string; content: string }[],
    retry?: boolean,
    delegateCrewIds?: string[],
    crewSuggestionResolved?: boolean,
    priorUserMessages?: string[],
    crewIntakeFromPicker?: boolean,
    primaryCrewId?: string,
    forceWebSearch?: boolean,
    userMessagePersisted?: boolean,
    clientSituation?: ClientSituation,
    crewSuggestionRequested?: boolean,
  ) =>
    postChatAsync('/chat/message', {
      text,
      attachments,
      retry,
      delegateCrewIds,
      crewSuggestionResolved,
      priorUserMessages,
      crewIntakeFromPicker,
      primaryCrewId,
      forceWebSearch,
      userMessagePersisted,
      clientSituation,
      crewSuggestionRequested,
    }),

  getTurn: (turnId: string) => request<{ turnId: string; status: string; message?: ChatMessage; error?: string; partialContent?: string }>(`/chat/turn/${turnId}`),
  
  // NEW: Streaming version with real-time progress events
  sendStream: async (
    text: string,
    onProgress: (event: { type: string; data: unknown }) => void,
    attachments?: { name: string; content: string }[],
    retry?: boolean,
    delegateCrewIds?: string[],
    crewSuggestionResolved?: boolean,
    crewIntakeFromPicker?: boolean,
    primaryCrewId?: string,
    clientSituation?: ClientSituation,
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
        body: JSON.stringify({ text, attachments, retry, delegateCrewIds, crewSuggestionResolved, crewIntakeFromPicker, primaryCrewId, clientSituation }),
      });

      if (response.status === 401) {
        onUnauthorized?.();
        throw new Error('Unauthorized');
      }

      if (!response.ok) {
        const error: { error?: string } = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || `HTTP ${response.status}`);
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

export interface SessionDbStatus {
  dbMode: 'postgres' | 'unknown' | 'error';
  backend: 'postgres' | 'unknown' | 'error';
  connected: boolean;
  sessionCount: number;
  filesystemRecovered: number;
  schemaVersion: number;
}

export const sessions = {
  dbStatus: () => request<SessionDbStatus>('/sessions/db-status'),
  list: () => request<SessionInfo[]>('/sessions'),
  children: (parentId: string) => request<{ children: ChildSessionInfo[] }>(`/sessions/${parentId}/children`).then((r) => r.children ?? []),
  preview: (id: string) => request<{ session: SessionInfo; messages: ChatMessage[] }>(`/sessions/${id}/preview`),
  create: (scopePath?: string) => request<{ sessionId: string }>('/sessions', { method: 'POST', body: scopePath ? JSON.stringify({ scopePath }) : undefined }),
  get: (id: string) => request<SessionInfo>(`/sessions/${id}`),
  delete: (id: string) => request<{ ok: boolean }>(`/sessions/${id}`, { method: 'DELETE' }),
  // Soft-archive: hides messages from the UI without deleting DB rows or memory embeddings
  archiveMessages: (id: string) => request<{ ok: boolean }>(`/sessions/${id}/archive-messages`, { method: 'POST' }),
  // Hard-delete super-session messages + memory fabric (irreversible clean slate)
  purgeContent: (id: string) => request<{ ok: boolean; memoryWiped?: { deletedNodes: number; deletedEdges: number } }>(
    `/sessions/${id}/purge-content`,
    { method: 'POST' },
  ),
  restore: (id: string, opts?: { perRole?: number }) =>
    request<{
      session: SessionInfo;
      messages: ChatMessage[];
      parts?: Array<Record<string, unknown>>;
      crewStates?: Array<{ crewId: string; enabled: boolean }>;
      scopePath?: string;
      turnFeedback?: Array<Record<string, unknown>>;
      resumeState?: Record<string, unknown> | null;
      messagesMeta?: { total: number; truncated: boolean; perRole: number };
      turnState?: { phase: string; stage?: string; step?: number; turnId?: string | null; startedAt?: number | null } | null;
    }>(`/sessions/${id}/restore`, {
      method: 'POST',
      body: JSON.stringify(opts?.perRole ? { perRole: opts.perRole } : {}),
    }),
  submitTurnFeedback: (id: string, body: { messageId: string; rating: 'positive' | 'negative' | 'skipped'; turnSummary?: string; metadata?: Record<string, unknown> }) =>
    request<{ ok: boolean; messageId: string; rating: string }>(`/sessions/${id}/feedback`, { method: 'POST', body: JSON.stringify(body) }),
  listTurnFeedback: (id: string) => request<{ feedback: Array<Record<string, unknown>> }>(`/sessions/${id}/feedback`),
  getMessagesPage: (id: string, opts?: { limit?: number; before?: string }) => {
    const params = new URLSearchParams();
    if (opts?.limit != null) params.set('limit', String(opts.limit));
    if (opts?.before) params.set('before', opts.before);
    const qs = params.toString();
    return request<{ messages: ChatMessage[]; total: number; hasMore: boolean }>(
      `/sessions/${id}/messages${qs ? `?${qs}` : ''}`,
    );
  },
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
  respond: (requestId: string, choice: 'allow_once' | 'allow_always' | 'deny') =>
    request<{ ok: boolean }>('/permission/respond', { method: 'POST', body: JSON.stringify({ requestId, choice }) }),
  instruct: (requestId: string, instruction: string) =>
    request<{ ok: boolean }>('/permission/instruct', { method: 'POST', body: JSON.stringify({ requestId, instruction }) }),
  respondBatch: (choice: 'allow_once' | 'allow_always' | 'deny') =>
    request<{ ok: boolean }>('/permission/respond-batch', { method: 'POST', body: JSON.stringify({ choice }) }),
};

export interface SessionPermissionDecision {
  toolName: string;
  targetPath: string | null;
  decision: string;
}

export interface SessionPermissions {
  bypassPermissions: boolean;
  decisions: SessionPermissionDecision[];
}

export const sessionPermissions = {
  get: (sessionId: string) => request<SessionPermissions>(`/sessions/${sessionId}/permissions`),
  setBypass: (sessionId: string, enabled: boolean) =>
    request<{ bypassPermissions: boolean }>(`/sessions/${sessionId}/permissions/bypass`, { method: 'POST', body: JSON.stringify({ enabled }) }),
  revoke: (sessionId: string) =>
    request<{ bypassPermissions: boolean; ok: boolean }>(`/sessions/${sessionId}/permissions/revoke`, { method: 'POST' }),
  setTool: (sessionId: string, toolName: string, decision: 'allow_always' | 'deny' | 'revoke') =>
    request<{ ok: boolean }>(`/sessions/${sessionId}/permissions/tool`, { method: 'POST', body: JSON.stringify({ toolName, decision }) }),
};

export const settingsPermissions = {
  get: () => request<{ permissions: Record<string, 'allow' | 'deny' | 'ask'> }>('/settings/permissions'),
  update: (permissions: Record<string, 'allow' | 'deny' | 'ask'>) =>
    request<{ ok: boolean }>('/settings/permissions', { method: 'POST', body: JSON.stringify({ permissions }) }),
};

export interface PermissionToolEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  riskLevel: string;
  defaultDecision: 'allow' | 'deny' | 'ask';
  currentDecision: 'allow' | 'deny' | 'ask';
  overridden: boolean;
  source: 'native' | 'mcp';
  providerId?: string;
  providerName?: string;
}

export const settingsPermissionTools = {
  list: () => request<{ tools: PermissionToolEntry[]; permissions: Record<string, 'allow' | 'deny' | 'ask'> }>('/settings/permissions/tools'),
};

// ─── System ───
export const system = {
  cwd: () => request<{ cwd: string | null }>('/cwd'),
  defaultWorkspace: () => request<{ path: string }>('/cwd/default'),
  setCwd: (path: string) => request<{ cwd: string }>('/cwd', { method: 'POST', body: JSON.stringify({ path }) }),
  dirs: (path?: string) => request<{ current: string; parent: string | null; dirs: Array<{ name: string; path: string }> }>(`/filesystem/dirs${path ? `?path=${encodeURIComponent(path)}` : ''}`),
};

// ─── Client Situation (location + timezone) ───
export const clientSituation = {
  set: (situation: ClientSituation) => request<{ ok: boolean; situation: ClientSituation | null }>('/client-situation', { method: 'POST', body: JSON.stringify({ situation }) }),
  get: () => request<{ situation: ClientSituation | null }>('/client-situation'),
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

// ─── RAG ───
export const rag = {
  status: () => request<{ enabled: boolean; indexedChunks: number }>('/rag/status').then(r => ({ enabled: r.enabled, chunkCount: r.indexedChunks ?? 0 })),
  index: (content: string, metadata?: Record<string, string>) => request<{ ok: boolean }>('/rag/index', { method: 'POST', body: JSON.stringify({ content, metadata }) }),
  search: (query: string, topK?: number) => request<RAGResult[]>('/rag/search', { method: 'POST', body: JSON.stringify({ query, topK }) }),
  clear: () => request<{ ok: boolean }>('/rag/clear', { method: 'POST' }),
};

// ─── RAG Studio (async document ingestion + job tracking) ───

/** Atomic stage detail persisted alongside job progress. */
export interface StageDetail {
  stage: string;
  detail?: string;
  chunkIndex?: number;
  chunkCount?: number;
  batchIndex?: number;
  batchCount?: number;
}

export interface IngestionJob {
  id: string;
  kind: string;
  payload: unknown;
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  priority: number;
  attemptCount: number;
  maxAttempts: number;
  error?: string;
  progress: number;
  result?: unknown;
  stageDetail?: StageDetail | null;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Full atomic event delivered via the SSE stream. */
export interface IngestStreamEvent {
  jobId: string;
  stage: string;
  progress: number;
  status: string;
  detail?: string;
  chunkIndex?: number;
  chunkCount?: number;
  batchIndex?: number;
  batchCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  error?: string;
  updatedAt?: string;
}

export interface IngestAsyncResult {
  jobId: string;
  status: string;
  name: string;
  kind: string;
}

export const ragStudio = {
  /** Enqueue a file for async ingestion. Returns the job ID. */
  ingestFile: async (file: File, opts?: { chunkSize?: number; chunkOverlap?: number }): Promise<IngestAsyncResult> => {
    const form = new FormData();
    form.append('file', file);
    if (opts?.chunkSize) form.append('chunkSize', String(opts.chunkSize));
    if (opts?.chunkOverlap) form.append('chunkOverlap', String(opts.chunkOverlap));
    const headers: Record<string, string> = {};
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res = await fetch(`${BASE}/memory/ingest-async`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: form,
    });
    if (!res.ok) throw new Error(`Failed to enqueue file: ${res.statusText}`);
    return res.json();
  },

  /** Enqueue a web URL for async ingestion. */
  ingestUrl: async (url: string, name?: string): Promise<IngestAsyncResult> => {
    return request<IngestAsyncResult>('/memory/ingest-async', {
      method: 'POST',
      body: JSON.stringify({ url, name }),
    });
  },

  /** Enqueue raw text content for async ingestion. */
  ingestText: async (content: string, name: string, kind: 'text' | 'markdown' | 'json' = 'text'): Promise<IngestAsyncResult> => {
    return request<IngestAsyncResult>('/memory/ingest-async', {
      method: 'POST',
      body: JSON.stringify({ content, name, kind }),
    });
  },

  /** List recent ingestion jobs (filtered to document_ingest only by default). */
  jobs: (limit = 50, kind = 'document_ingest') => request<{ jobs: IngestionJob[] }>(`/memory/jobs?limit=${limit}&kind=${kind}`),

  /** Get a single job by ID. */
  job: (id: string) => request<IngestionJob>(`/memory/jobs/${id}`),

  /** Fetch the full event log for a job (for populating the log on selection). */
  jobEvents: (id: string) => request<{ events: IngestStreamEvent[] }>(`/memory/jobs/${id}/events`),

  /** Cancel a running or pending job. */
  cancelJob: (id: string) => request<{ ok: boolean }>(`/memory/jobs/${id}/cancel`, { method: 'POST' }),

  /** Delete a job and all its events. */
  deleteJob: (id: string) => request<{ ok: boolean }>(`/memory/jobs/${id}`, { method: 'DELETE' }),

  /** Open an SSE stream that polls job progress until terminal state. */
  streamJob: (jobId: string, onEvent: (data: IngestStreamEvent) => void): (() => void) => {
    const url = authToken
      ? `${BASE}/memory/jobs/${jobId}/stream?token=${encodeURIComponent(authToken)}`
      : `${BASE}/memory/jobs/${jobId}/stream`;
    const es = new EventSource(url, { withCredentials: true });
    es.onmessage = (e) => {
      try { onEvent(JSON.parse(e.data)); } catch { /* ignore parse errors */ }
    };
    return () => es.close();
  },
};

// ─── Knowledge Base (memory browsing) ───

export interface MemorySource {
  id: string;
  name: string;
  kind: string;
  colorHex: string;
  createdAt: string;
  filePath?: string | null;
  fileSize?: number | null;
  fileMime?: string | null;
}

export type MemoryNodeCategory = 'persona' | 'tool' | 'episodic' | 'semantic' | 'source_doc' | 'system';

export interface MemoryNode {
  id: string;
  label: string;
  category: MemoryNodeCategory;
  content: string;
  status: string;
  x: number | null;
  y: number | null;
  layoutEpoch: number;
  tag?: string;
  isBenchmark: boolean;
  sourceId?: string;
  sessionId?: string;
  agentId?: string;
  confidence?: number;
  createdAt: string;
  updatedAt: string;
  accessCount: number;
  lastAccessedAt: string | null;
}

export interface MemoryEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationshipType: string;
  weight: number;
  createdAt: string;
  updatedAt: string;
}

export interface GraphSnapshot {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
}

export interface SourceNodesResult {
  nodes: MemoryNode[];
  total: number;
}

export const knowledge = {
  /** List all knowledge sources. */
  sources: () => request<MemorySource[]>('/memory/sources'),

  /** Get all nodes for a specific source (paginated). */
  sourceNodes: (sourceId: string, opts?: { limit?: number; offset?: number; category?: MemoryNodeCategory }) => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));
    if (opts?.category) params.set('category', opts.category);
    const qs = params.toString();
    return request<SourceNodesResult>(`/memory/sources/${sourceId}/nodes${qs ? `?${qs}` : ''}`);
  },

  /** Get a graph snapshot of recent nodes (optionally filtered). */
  graph: (opts?: { limit?: number; category?: MemoryNodeCategory; sourceId?: string; tag?: string }) => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.category) params.set('category', opts.category);
    if (opts?.sourceId) params.set('sourceId', opts.sourceId);
    if (opts?.tag) params.set('tag', opts.tag);
    const qs = params.toString();
    return request<GraphSnapshot>(`/memory/graph${qs ? `?${qs}` : ''}`);
  },

  /** Get a single node by ID. */
  node: (id: string) => request<MemoryNode>(`/memory/nodes/${id}`),

  /** Download the original file for a source (returns a URL for an anchor click). */
  sourceFileUrl: (sourceId: string) => `${BASE}/memory/sources/${sourceId}/file`,

  /** Get RAG Studio storage stats (file count, total size). */
  storageStats: () => request<{ fileCount: number; totalBytes: number; path: string }>('/memory/rag-studio/storage'),

  /** Clear all persisted RAG Studio files (does NOT delete knowledge nodes). */
  clearStorage: () => request<{ ok: boolean; deletedFiles: number; freedBytes: number }>('/memory/rag-studio/storage', { method: 'DELETE' }),
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
  clearConversation: (channelId: string) =>
    request<{ success: boolean; message: string }>(`/channels/${channelId}/clear`, { method: 'POST' }),
};

export interface TelegramDiscoverResponse {
  ok: boolean;
  error?: string;
  botUsername?: string;
  botName?: string;
  chats?: Array<{ id: string; title: string; type: string; userId?: string }>;
  saved?: boolean;
  chatId?: string;
  allowedUserId?: string;
}

export interface TelegramGreetingResponse {
  ok: boolean;
  message?: string;
  error?: string;
}

export const channels = {
  discoverTelegram: (botToken: string, chatId?: string) =>
    request<TelegramDiscoverResponse>('/channels/telegram/discover', {
      method: 'POST',
      body: JSON.stringify({ botToken, chatId }),
    }),
  sendTelegramGreeting: (botToken?: string, chatId?: string) =>
    request<TelegramGreetingResponse>('/channels/telegram/greeting', {
      method: 'POST',
      body: JSON.stringify({ botToken, chatId }),
    }),
};

// ─── Automation & Notifications ───
export type AutomationNotifyChannel = 'in_app' | 'desktop' | 'telegram' | 'slack' | 'email' | 'discord';
export type AutomationTaskStatus = 'active' | 'paused' | 'cancelled' | 'completed';
export type NotificationKind = 'automation_success' | 'automation_failure' | 'automation_scheduled' | 'background_task_complete' | 'background_task_failed';

export interface AutomationTaskRecord {
  id: string;
  displayId: string;
  taskKey: string | null;
  title: string;
  instruction: string;
  scheduleType: 'once' | 'recurring';
  cronExpression: string | null;
  runAt: string | null;
  timezone: string;
  status: AutomationTaskStatus;
  sourceChannel: string;
  sourceSessionId: string | null;
  notifyChannels: AutomationNotifyChannel[];
  lastRunAt: string | null;
  lastRunStatus: string | null;
  nextRunAt: string | null;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationRecord {
  id: string;
  taskId: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  payload: Record<string, unknown> | null;
  channels: AutomationNotifyChannel[];
  deliveryStatus: Record<string, unknown>;
  readAt: string | null;
  dismissedAt?: string | null;
  createdAt: string;
}

export interface AutomationRunLogEntry {
  id: string;
  taskId: string;
  runId: string;
  ts: string;
  level: 'info' | 'tool' | 'think' | 'ok' | 'err' | 'sys';
  label: string;
  detail?: string | null;
  eventType?: string | null;
}

export const automation = {
  tasks: () => request<{ tasks: AutomationTaskRecord[] }>('/automation/tasks').then(r => r.tasks ?? []),
  getTask: (id: string) => request<{ task: AutomationTaskRecord }>(`/automation/tasks/${id}`).then(r => r.task),
  getLogs: (id: string, opts?: { limit?: number }) => {
    const q = opts?.limit ? `?limit=${opts.limit}` : '';
    return request<{ logs: AutomationRunLogEntry[] }>(`/automation/tasks/${id}/logs${q}`).then(r => r.logs ?? []);
  },
  cancelTask: (id: string) => request<{ ok: boolean }>(`/automation/tasks/${id}`, { method: 'DELETE' }),
  deleteTask: (id: string) => request<{ ok: boolean }>(`/automation/tasks/${id}`, { method: 'DELETE' }),
  pauseTask: (id: string) => request<{ ok: boolean }>(`/automation/tasks/${id}/pause`, { method: 'POST' }),
  resumeTask: (id: string) => request<{ ok: boolean }>(`/automation/tasks/${id}/resume`, { method: 'POST' }),
  runNow: (id: string) => request<{ ok: boolean }>(`/automation/tasks/${id}/run`, { method: 'POST' }),
};

export const notifications = {
  list: (opts?: { unread?: boolean; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.unread) params.set('unread', '1');
    if (opts?.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return request<{ notifications: NotificationRecord[]; unreadCount: number }>(
      `/notifications${qs ? `?${qs}` : ''}`,
    );
  },
  markRead: (id: string) => request<{ ok: boolean }>(`/notifications/${id}/read`, { method: 'POST' }),
  dismiss: (id: string) => request<{ ok: boolean }>(`/notifications/${id}/dismiss`, { method: 'POST' }),
  dismissAll: () => request<{ ok: boolean; count: number }>('/notifications/dismiss-all', { method: 'POST' }),
};

export type MarkdownDocumentRecord = import('@agentx/shared').MarkdownDocumentRecord;

export const markdownDocuments = {
  list: (opts?: { sessionId?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.sessionId) params.set('session_id', opts.sessionId);
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return request<{ documents: MarkdownDocumentRecord[] }>(`/markdown${qs ? `?${qs}` : ''}`);
  },
  get: (id: string) => request<{
    document: MarkdownDocumentRecord;
    contentMarkdown?: string;
  }>(`/markdown/${id}`),
  create: (body: {
    sessionId: string;
    contentMarkdown?: string;
    contentTsx?: string;
    title?: string;
    messageId?: string;
    sourceRole?: 'user' | 'assistant' | 'system';
  }) => request<{ document: MarkdownDocumentRecord }>('/markdown', { method: 'POST', body: JSON.stringify(body) }),
  delete: (id: string) => request<{ ok: boolean }>(`/markdown/${id}`, { method: 'DELETE' }),
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
  provider: { activeProvider: string; activeModel: string; activeReasoningEffort?: string; providers: Record<string, ProviderSettings> };
  ui: { theme: string; showTokenBar: boolean; showTimers: boolean; animationSpeed: string; disabledTools?: string[] };
  organization: { name: string; contact?: string } | null;
  telemetry: boolean;
  timezone?: string;
  user?: { callsign: string };
  setupComplete?: boolean;
  rag?: { enabled: boolean; embeddingModel: string; chunkSize: number; topK: number };
  localModel?: { enabled?: boolean; modelId?: string; modelName?: string; displayName?: string };
  tools?: {
    webSearch?: {
      duckduckgo?: { enabled?: boolean };
      brave?: { enabled: boolean; apiKey?: string };
      exa?: { enabled: boolean; apiKey?: string };
      tavily?: { enabled: boolean; apiKey?: string };
    };
  };
  /** Neural brain module enabled (default: true). Set to false if embedding models fail to download. */
  neuralBrain?: boolean;
  runtime?: {
    cpuBudgetPercent?: number;
    lazyStorageCache?: boolean;
    backgroundConcurrency?: number;
  };
  permissions?: Record<string, 'allow' | 'deny' | 'ask'>;
  channels?: {
    telegram?: { enabled?: boolean; inbound?: boolean; outbound?: boolean; botToken?: string; chatId?: string };
    slack?: { enabled?: boolean; inbound?: boolean; outbound?: boolean; webhookUrl?: string; botToken?: string; appToken?: string };
    email?: {
      enabled?: boolean;
      inbound?: boolean;
      outbound?: boolean;
      smtpHost?: string;
      smtpPort?: number;
      smtpUser?: string;
      smtpPassword?: string;
      fromAddress?: string;
      toAddress?: string;
      useTls?: boolean;
    };
    discord?: { enabled?: boolean; inbound?: boolean; outbound?: boolean; webhookUrl?: string; botToken?: string; channelId?: string };
  };
  voice?: VoiceConfig;
}

export type TtsEngine = 'kokoro';

export interface VoiceConfig {
  enabled?: boolean;
  mode?: {
    web?: 'off' | 'push-to-talk' | 'duplex';
    channels?: 'off' | 'voice-notes';
  };
  /** Active voice engine. */
  engine?: 'stt_llm_tts' | 'realtime_xai';
  /** xAI realtime settings. */
  xai?: {
    apiKey?: string;
    model?: string;
    voice?: string;
  };
  stt?: {
    engine?: 'faster-whisper';
    modelId?: string;
    computeType?: 'auto' | 'int8' | 'int8_float16' | 'float16' | 'float32';
    device?: 'auto' | 'cpu' | 'cuda';
  };
  tts?: {
    engine?: TtsEngine;
    voiceId?: string;
    style?: {
      emotion?: string;
      expressiveness?: number;
    };
    fillerEngine?: 'kokoro';
  };
  sidecar?: { autoStart?: boolean; idleUnloadMinutes?: number };
  fillers?: { enabled?: boolean; speakToolProgress?: boolean };
  wakeWord?: {
    enabled?: boolean;
    phrase?: string;
  };
  downloadedAssets?: VoiceDownloadedAsset[];
  /** Separate provider/model for voice sessions. Falls back to default provider config. */
  provider?: {
    activeProvider?: string;
    activeModel?: string;
    activeProfile?: string;
  };
}

export type VoiceTtsStyleConfig = NonNullable<NonNullable<VoiceConfig['tts']>['style']>;

export interface VoiceDownloadedAsset {
  assetId: string;
  kind: string;
  engine?: string;
  version?: string;
  installedAt: string;
  sizeBytes?: number;
  sha256?: string;
}

export interface VoiceAssetCatalogEntry {
  id: string;
  kind: string;
  engine?: string;
  displayName: string;
  description: string;
  sizeMB: number;
  platform?: string;
  architecture?: string;
  downloadUrl?: string;
  sha256?: string;
  license?: string;
  recommended?: boolean;
}

export interface VoiceCapabilityStatus {
  os: string;
  arch: string;
  pythonAvailable: boolean;
  ffmpegAvailable: boolean;
  sidecar: { state: string; version?: string; error?: string };
  stt: { engine: 'faster-whisper'; selectedModelId?: string; selectedModelInstalled: boolean };
  tts: {
    selectedEngine: TtsEngine;
    selectedVoiceId?: string;
    selectedVoiceInstalled: boolean;
    kokoroInstalled: boolean;
  };
  vadInstalled: boolean;
  gpuAvailable?: boolean;
  canRunWeb: boolean;
  canRunChannels: boolean;
  engine?: string;
  realtimeXai?: { configured: boolean };
}

export interface VoiceSetupStatus {
  phase: 'idle' | 'runtime' | 'download' | 'complete' | 'error';
  message: string;
  progress: number;
  step?: string;
  stepIndex?: number;
  totalSteps?: number;
  detail?: string;
  currentAsset?: string;
  currentAssetName?: string;
  assetIndex?: number;
  totalAssets?: number;
  assetProgress?: number;
  error?: string;
}

export interface VoiceSidecarHealth {
  ok: boolean;
  state: 'starting' | 'ready' | 'error';
  version?: string;
  models?: {
    sttLoaded?: boolean;
    ttsEngine?: TtsEngine;
    ttsLoaded?: boolean;
    vadLoaded?: boolean;
  };
  device?: string;
  error?: string;
}

export interface VoiceSidecarStatusResponse {
  ok?: boolean;
  error?: string;
  sidecar: {
    state: string;
    baseUrl?: string;
    pid?: number;
    version?: string;
    error?: string;
    health?: VoiceSidecarHealth;
  };
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
  outputTokenLimit?: number;
  capabilities?: string[];
  reasoning?: {
    supported: boolean;
    effortLevels?: string[];
    defaultEffort?: string;
    control?: string;
  };
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
  honorsDoctorate?: boolean;
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
  tags?: string[];
  requiresMedicalDisclaimer?: boolean;
  honorsDoctorate?: boolean;
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
  tags?: string[];
  searchText: string;
  hubRevision: number;
  active: boolean;
  requiresMedicalDisclaimer?: boolean;
  honorsDoctorate?: boolean;
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
  tools?: string[];
  tags?: string[];
  requiresMedicalDisclaimer?: boolean;
  honorsDoctorate?: boolean;
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
  role: 'user' | 'assistant' | 'system' | 'tool' | 'part';
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
}

export interface SessionInfo {
  id: string;
  provider: string;
  model: string;
  crewId?: string;
  contextKind?: 'agent_x' | 'agent_x_core' | 'crew_private' | 'automation';
  hostCrewId?: string;
  hostCrewName?: string;
  hostCrewCallsign?: string;
  hostCrewTitle?: string;
  hostCrewColor?: string;
  hostCrewCatalogId?: string;
  hostCrewCategoryId?: string;
  bypassPermissions?: boolean;
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
  createdAt: string;
  updatedAt?: string;
  title?: string;
  scopePath?: string;
  parentId?: string;
  /** Lightweight turn status from the turn registry (null if no recent turn). */
  turnStatus?: { status: 'running' | 'complete' | 'error' | 'cancelled'; turnId: string; startedAt: number } | null;
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
  cpu?: number;
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
    bypassPermissions?: boolean;
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
export type DbExtensionCheckStatus = 'ok' | 'warn' | 'fail';

export interface DbExtensionCheck {
  id: 'pgvector' | 'age';
  label: string;
  status: DbExtensionCheckStatus;
  message: string;
  remediation?: string;
}

export interface DbConnectionTestResult {
  ok: boolean;
  version?: string;
  tablesCreated?: number;
  latencyMs?: number;
  error?: string;
  checks?: DbExtensionCheck[];
  vectorAvailable?: boolean;
  vectorError?: string;
  ageAvailable?: boolean;
  ageError?: string;
  extensionsCreated?: boolean;
}

export interface DbStatus {
  backend: 'postgres';
  connected: boolean;
  stats: {
    dbSizeBytes: number;
    dbSizeFormatted: string;
    tableCount: number;
    tables: Record<string, number>;
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

export const localModel = {
  capabilities: () =>
    request<{ capabilities: any; localModelSupported?: boolean }>('/local-model/capabilities'),
  catalog: () =>
    request<{ catalog: any; compatible: string[]; recommended: string | null }>('/local-model/catalog'),
  download: (modelId: string) =>
    request<{ ok: boolean; modelId: string; sizeGB: number; message: string }>('/local-model/download', {
      method: 'POST',
      body: JSON.stringify({ modelId }),
    }),
  downloadStatus: (modelId: string) =>
    request<{ status: string; progress?: number; error?: string }>(`/local-model/download-status/${modelId}`),
  installed: () =>
    request<{ models: Array<{ modelId: string; modelName: string; displayName?: string; downloadedAt: string; dtype?: string; isActive: boolean }> }>('/local-model/installed'),
  activate: (modelId: string) =>
    request<{ ok: boolean; modelId: string; message: string }>(`/local-model/activate/${modelId}`, { method: 'POST' }),
  delete: (modelId: string) =>
    request<{ ok: boolean; message: string }>(`/local-model/${modelId}`, { method: 'DELETE' }),
  switchToPrimary: () =>
    request<{ ok: boolean; message: string }>('/local-model/switch-to-primary', { method: 'POST' }),
  status: () =>
    request<{ installed: string | null; activeModelId: string | null; enabled: boolean; model: { id: string; displayName: string; huggingFaceId: string; sizeGB: number; downloadedAt: string | null } | null }>(
      '/local-model/status',
    ),
};

// ─── Schema Migrations ───
export interface AppliedMigrationInfo {
  version: number;
  name: string;
  appliedAt: string;
}

export interface PendingMigrationInfo {
  version: number;
  name: string;
}

export interface MigrationStatus {
  applied: AppliedMigrationInfo[];
  pending: PendingMigrationInfo[];
  currentVersion: number;
  appliedVersion: number;
  totalMigrations: number;
  upToDate: boolean;
}

export interface MigrationRunResult {
  ok: boolean;
  applied: number;
  skipped: number;
  currentVersion: number;
  appliedMigrations: AppliedMigrationInfo[];
  error?: string;
}

export const migrations = {
  status: () => request<MigrationStatus>('/migrations/status'),
  run: () => request<MigrationRunResult>('/migrations/run', { method: 'POST' }),
};

export const voice = {
  getConfig: () =>
    request<{ voice?: VoiceConfig }>('/config').then((cfg) => cfg.voice ?? {}),
  capabilities: () =>
    request<{ capabilities: VoiceCapabilityStatus }>('/voice/capabilities'),
  catalog: () =>
    request<{ catalog: VoiceAssetCatalogEntry[]; installed: VoiceDownloadedAsset[]; recommended: Record<string, string> }>('/voice/assets'),
  installedAssets: () =>
    request<{ assets: VoiceDownloadedAsset[] }>('/voice/assets/installed'),
  downloadAsset: (assetId: string) =>
    request<{ ok: boolean; assetId: string }>('/voice/assets/download', {
      method: 'POST',
      body: JSON.stringify({ assetId }),
    }),
  downloadStatus: (assetId: string) =>
    request<{ status: string; progress?: number; error?: string; detail?: string; downloadedMB?: number; totalMB?: number }>(`/voice/assets/download-status/${assetId}`),
  cancelDownload: (assetId: string) =>
    request<{ ok: boolean }>(`/voice/assets/download/${assetId}/cancel`, { method: 'POST' }),
  deleteAsset: (assetId: string) =>
    request<{ ok: boolean }>(`/voice/assets/${assetId}`, { method: 'DELETE' }),
  installSidecar: () =>
    request<{ ok: boolean }>('/voice/install-sidecar', { method: 'POST' }),
  setup: () =>
    request<{ ok: boolean; status: VoiceSetupStatus }>('/voice/setup', { method: 'POST' }),
  setupStatus: () =>
    request<{ status: VoiceSetupStatus }>('/voice/setup/status'),
  sidecarStatus: () =>
    request<{ sidecar: VoiceSidecarStatusResponse['sidecar'] }>('/voice/sidecar/status'),
  ensureSidecar: () =>
    request<VoiceSidecarStatusResponse>('/voice/sidecar/ensure', { method: 'POST' }, 5 * 60_000),
  releaseSidecar: (opts?: { force?: boolean }) =>
    request<{ ok: boolean; skipped?: string; scheduled?: boolean; stopped?: boolean }>(
      '/voice/sidecar/release',
      { method: 'POST', body: JSON.stringify({ force: opts?.force === true }) },
    ),
  preview: (text: string, engine: string, voiceId?: string, style?: VoiceTtsStyleConfig) =>
    request<{ audioBase64: string; mimeType: string; durationMs?: number }>(
      '/voice/preview',
      {
        method: 'POST',
        body: JSON.stringify({ text, engine, voiceId, style }),
      },
      60_000,
    ),
  validateXai: (apiKey?: string) =>
    request<{ valid: boolean; error?: string }>('/voice/xai/validate', {
      method: 'POST',
      body: JSON.stringify({ apiKey }),
    }),
  xaiVoices: () =>
    request<{ voices: Array<{ id: string; name: string; language?: string }> }>('/voice/xai/voices'),
  greeting: () =>
    request<{ text: string; fallback?: boolean }>(
      '/voice/greeting',
      { method: 'POST' },
      30_000,
    ),
  generateGreeting: (callsign: string) =>
    request<{ text: string }>('/voice/greeting', {
      method: 'POST',
      body: JSON.stringify({ callsign }),
    }, 30_000),
  updateConfig: async (patch: VoiceConfig) => {
    // downloadedAssets is server-managed; sending a stale copy would wipe
    // assets registered during deployment.
    const { downloadedAssets: _ignored, ...safePatch } = patch;
    const result = await request<{ ok: boolean }>('/config', {
      method: 'PUT',
      body: JSON.stringify({ voice: safePatch }),
    });
    notifyVoiceConfigUpdated(patch);
    return result;
  },
};

export interface EmbeddingModelStatus {
  id: string;
  displayName: string;
  huggingfaceId: string;
  approxSizeMB: number;
  downloaded: boolean;
  sizeOnDiskMB: number;
  downloadStatus: 'not_started' | 'pending' | 'downloading' | 'complete' | 'error';
  percentage: number;
}

export interface EmbeddingModelProgress {
  id: string;
  displayName: string;
  status: 'not_started' | 'pending' | 'downloading' | 'complete' | 'error';
  downloadedMB: number;
  totalMB: number;
  percentage: number;
  error?: string;
}

export const embeddingModels = {
  status: () =>
    request<{ models: EmbeddingModelStatus[]; allDownloaded: boolean; neuralBrainSupported: boolean }>('/embedding-models/status'),
  download: (opts?: { force?: boolean }) =>
    request<{ ok: boolean; message: string; models: Array<{ id: string; displayName: string; approxSizeMB: number }> }>('/embedding-models/download', {
      method: 'POST',
      body: JSON.stringify({ force: opts?.force === true }),
    }),
  purge: () =>
    request<{ ok: boolean; message: string; freedMB: number }>('/embedding-models', { method: 'DELETE' }),
  /**
   * Opens an SSE connection for download progress. Returns a cleanup function.
   */
  progressStream: (onProgress: (data: { type: string; models?: EmbeddingModelProgress[]; allComplete?: boolean; hasError?: boolean }) => void): (() => void) => {
    const url = `${BASE}/embedding-models/progress`;
    const es = new EventSource(url);
    es.onmessage = (ev) => {
      try { onProgress(JSON.parse(ev.data)); } catch {}
    };
    es.onerror = () => { /* SSE will auto-reconnect; ignore */ };
    return () => es.close();
  },
};

export type BenchmarkGrade = 'STANDBY' | 'LIMITED' | 'CLEARED' | 'ELITE';

export interface BenchmarkTestResult {
  id: string;
  label: string;
  category: string;
  score: number;
  maxScore: number;
  passed: boolean;
  latencyMs: number;
  critical: boolean;
  details?: string;
  error?: string;
}

export interface ModalityProbeResult {
  id: string;
  label: string;
  detected: boolean;
  source: string;
  tested: boolean;
  probeStatus?: 'passed' | 'failed' | 'skipped' | 'unsupported';
  note?: string;
  details?: string;
}

export interface BenchmarkRunResult {
  runId: string;
  providerId: string;
  modelId: string;
  profileId?: string;
  grade: BenchmarkGrade;
  overallScore: number;
  maxScore: number;
  percent: number;
  tests: BenchmarkTestResult[];
  modalities: ModalityProbeResult[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  logFile?: string;
  fromCache?: boolean;
}

export type BenchmarkProgressEvent =
  | { type: 'started'; runId: string; modelId: string; providerId: string; totalTests: number }
  | { type: 'phase'; phase: string; message: string }
  | { type: 'test_start'; testId: string; label: string; index: number; total: number }
  | { type: 'test_complete'; result: BenchmarkTestResult; index: number; total: number }
  | { type: 'modality'; result: ModalityProbeResult }
  | { type: 'complete'; result: BenchmarkRunResult }
  | { type: 'error'; error: string };

export const modelBenchmark = {
  start: (body: {
    providerId: string;
    modelId: string;
    profileId?: string;
    apiKey?: string;
    baseUrl?: string;
    modelCapabilities?: string[];
    force?: boolean;
  }) => request<{
    runId: string;
    cached?: boolean;
    logFile?: string;
    finishedAt?: string;
  }>('/model-benchmark/start', { method: 'POST', body: JSON.stringify(body) }),

  latest: (providerId: string, modelId: string) =>
    request<{ result: BenchmarkRunResult | null }>(`/model-benchmark/latest?providerId=${encodeURIComponent(providerId)}&modelId=${encodeURIComponent(modelId)}`),

  logPath: (providerId: string, modelId: string) =>
    request<{ logFile: string; logPath: string; exists: boolean }>(
      `/model-benchmark/log-path?providerId=${encodeURIComponent(providerId)}&modelId=${encodeURIComponent(modelId)}`,
    ),

  downloadLog: async (providerId: string, modelId: string): Promise<Blob> => {
    const token = getAuthToken();
    const url = `${BASE}/model-benchmark/log?providerId=${encodeURIComponent(providerId)}&modelId=${encodeURIComponent(modelId)}`;
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('Failed to download benchmark log');
    return res.blob();
  },

  stream: (runId: string, onEvent: (event: BenchmarkProgressEvent) => void): (() => void) => {
    const url = `${BASE}/model-benchmark/stream/${encodeURIComponent(runId)}`;
    const es = new EventSource(url);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      es.close();
    };
    es.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data) as BenchmarkProgressEvent;
        onEvent(event);
        // The server ends the HTTP stream after the terminal event. Close the
        // EventSource ourselves so it does NOT auto-reconnect and replay the
        // full buffered event history (which would duplicate matrix rows).
        if (event.type === 'complete' || event.type === 'error') close();
      } catch { /* ignore malformed chunk */ }
    };
    es.onerror = () => {
      // A normal end-of-stream surfaces as an error on the EventSource. Once the
      // server has closed the connection, prevent the browser's automatic
      // reconnect (which replays buffered events and duplicates results).
      if (es.readyState === EventSource.CLOSED) close();
    };
    return close;
  },
};

export type DbProvisionEvent =
  | { type: 'log'; line: string; ts?: string }
  | { type: 'status'; phase: string; backend?: string }
  | { type: 'complete'; ok: boolean; backend?: string }
  | { type: 'error'; error: string };

export const settings = {
  db: {
    get: () => request<DbStatus>('/settings/db'),
    update: (config: { backend: string; postgres?: { connectionString: string } }) =>
      request<{ ok: boolean; backend?: string; tablesCreated?: number }>('/settings/db', { method: 'PUT', body: JSON.stringify(config) }),
    /**
     * Stream Postgres provision progress (embedded start or cloud connect).
     * Uses fetch + SSE parsing so the auth cookie/token from request() helpers is not required
     * beyond the same-origin session cookie / Authorization header we attach here.
     */
    provision: (
      config: { backend: string; postgres?: { connectionString: string } },
      onEvent: (event: DbProvisionEvent) => void,
      options?: { signal?: AbortSignal },
    ): Promise<{ ok: boolean; backend?: string; error?: string }> => {
      return (async () => {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        let res: Response;
        try {
          res = await fetch(`${BASE}/settings/db/provision`, {
            method: 'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify(config),
            signal: options?.signal,
          });
        } catch (e) {
          if (options?.signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
            return { ok: false, error: 'Cancelled' };
          }
          throw e;
        }
        if (res.status === 401) {
          onUnauthorized?.();
          return { ok: false, error: 'Unauthorized' };
        }
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => '');
          return { ok: false, error: text || `Provision failed (${res.status})` };
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let result: { ok: boolean; backend?: string; error?: string } = { ok: false, error: 'Provision ended unexpectedly' };
        let eventName = 'message';
        let dataLines: string[] = [];

        const flush = () => {
          if (dataLines.length === 0) {
            eventName = 'message';
            return;
          }
          const raw = dataLines.join('\n');
          dataLines = [];
          const name = eventName;
          eventName = 'message';
          try {
            const data = JSON.parse(raw) as Record<string, unknown>;
            if (name === 'log') {
              onEvent({ type: 'log', line: String(data.line ?? ''), ts: data.ts as string | undefined });
            } else if (name === 'status') {
              onEvent({ type: 'status', phase: String(data.phase ?? ''), backend: data.backend as string | undefined });
            } else if (name === 'complete') {
              result = { ok: true, backend: data.backend as string | undefined };
              onEvent({ type: 'complete', ok: true, backend: data.backend as string | undefined });
            } else if (name === 'error') {
              result = { ok: false, error: String(data.error ?? 'Provision failed') };
              onEvent({ type: 'error', error: String(data.error ?? 'Provision failed') });
            }
          } catch { /* ignore malformed */ }
        };

        while (true) {
          if (options?.signal?.aborted) {
            try { await reader.cancel(); } catch { /* ignore */ }
            return { ok: false, error: 'Cancelled' };
          }
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n');
          buffer = parts.pop() ?? '';
          for (const line of parts) {
            if (line.startsWith('event:')) {
              eventName = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trim());
            } else if (line === '') {
              flush();
            }
          }
        }
        flush();
        return result;
      })();
    },
    test: (connectionString: string) =>
      request<DbConnectionTestResult>(
        '/settings/db/test', { method: 'POST', body: JSON.stringify({ connectionString, ssh: undefined }) }
      ),
    testAdvanced: (connectionString: string, ssh?: { host: string; port: number; username: string; password?: string; privateKey?: string } | null) =>
      request<DbConnectionTestResult>(
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
    provisionStatus: () =>
      request<{ postgres: boolean; schemaVersion: number; migrationsApplied: number; age: { available: boolean; error?: string | null }; timestamp: string }>('/memory/storage-status'),
    systemInit: () =>
      request<{ ok: boolean; nodeId: string }>('/memory/system-init', { method: 'POST' }),
  },
  webSearch: {
    status: () =>
      request<{
        available: boolean;
        providers: string[];
        tools: { deep_web_search: boolean; web_search: boolean };
        forcedTool: 'deep_web_search' | 'web_search' | null;
      }>('/settings/web-search/status'),
    test: (provider: 'brave' | 'exa' | 'tavily', apiKey?: string) =>
      request<{ ok: boolean; provider: string; latencyMs?: number; error?: string }>(
        '/settings/web-search/test',
        { method: 'POST', body: JSON.stringify({ provider, apiKey: apiKey ?? '' }) },
      ),
  },
};

// ─── Integrations Hub ───
export interface IntegrationProvider {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  website?: string;
  trust: 'official' | 'verified' | 'community';
  catalogStatus?: 'active' | 'candidate' | 'testing' | 'deprecated';
  npmPackage?: string;
  evaluationNotes?: string;
  server: {
    type: 'stdio' | 'remote';
    package?: string;
    command?: string;
    args?: string[];
    url?: string;
  };
  auth: {
    primary: string;
    developer?: string[];
    connectGuide?: Array<{ title: string; body: string; link?: string }>;
    fields?: Array<{ key: string; label: string; placeholder?: string; secret?: boolean; required?: boolean }>;
    oauth?: {
      discoveryUrl?: string;
      authorizationUrl?: string;
      tokenUrl?: string;
      clientId?: string;
      clientIdEnv?: string;
      scopes?: string[];
      resource?: string;
    };
    packageSignIn?: {
      loginTool: string;
      statusTool?: string;
      progressTool?: string;
      label?: string;
    };
    mcpStdioAuth?: {
      authArg: string;
      oauthPathEnv: string;
      credentialsPathEnv: string;
      credentialsFileName?: string;
      oauthKeysFormat?: 'installed' | 'web';
      webRedirectUris?: string[];
      clientIdField: string;
      clientSecretField: string;
      clientIdEnv?: string;
      clientSecretEnv?: string;
    };
  };
  setupWizard?: {
    template: string;
    preflight: string[];
    osPermissions?: string[];
    hideDeveloperTab?: boolean;
  };
  capabilities: { search: boolean; read: boolean; write: boolean; transact: boolean };
  highlights?: string[];
  tools?: { autoExecute?: string[]; alwaysConfirm?: string[] };
}

export interface IntegrationConnection {
  id: string;
  providerId: string;
  displayName: string;
  status: 'connected' | 'disconnected' | 'error' | 'syncing';
  authMode: string;
  connectedAt: string;
  lastSyncAt?: string;
  error?: string;
  accountLabel?: string;
  toolCount?: number;
  enabled: boolean;
  stdio?: {
    command: string;
    args: string[];
    cwd?: string;
  };
  remote?: {
    url: string;
  };
}

export interface IntegrationActionPreview {
  providerId: string;
  providerName: string;
  toolId: string;
  toolName: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  summary: string;
  impact: string;
  parameters: Array<{ key: string; value: string; sensitive?: boolean }>;
  resultType?: 'generic' | 'issue' | 'calendar' | 'hotel' | 'message';
}

export interface IntegrationAnalytics {
  totalCalls: number;
  successRate: number;
  readonlyCalls: number;
  writeCalls: number;
  byProvider: Record<string, { calls: number; success: number; failures: number }>;
  recentErrors: Array<{ timestamp: string; providerId: string; toolName: string; error: string }>;
}

export interface SetupPreflightResult {
  id: string;
  ok: boolean;
  message: string;
  fixHint?: string;
}

export interface ConnectIntegrationRequest {
  authMode?: string;
  env?: Record<string, string>;
  displayName?: string;
  stdio?: { command: string; args?: string[]; cwd?: string };
  remote?: { url: string };
}

export interface IntegrationHubSettings {
  allowedProviderIds?: string[];
  healthPollingEnabled?: boolean;
  healthPollIntervalMs?: number;
  catalogRemoteUrl?: string;
  oauthClientIds?: Record<string, string>;
  oauthClientRedirectUris?: Record<string, string>;
  showCandidateProviders?: boolean;
}

export const integrations = {
  catalog: (includeCandidates?: boolean) =>
    request<{
      providers: IntegrationProvider[];
      settings?: IntegrationHubSettings;
      stats?: Record<'active' | 'candidate' | 'testing' | 'deprecated', number>;
    }>(`/integrations/catalog${includeCandidates ? '?includeCandidates=true' : ''}`),
  connections: () => request<{ connections: IntegrationConnection[] }>('/integrations/connections'),
  analytics: () => request<{ analytics: IntegrationAnalytics }>('/integrations/analytics'),
  settings: () => request<{ settings: IntegrationHubSettings }>('/integrations/settings'),
  updateSettings: (body: IntegrationHubSettings) =>
    request<{ settings: IntegrationHubSettings }>('/integrations/settings', { method: 'POST', body: JSON.stringify(body) }),
  importMcp: (body: { mcpServers: Record<string, { command?: string; args?: string[]; env?: Record<string, string>; url?: string }> }) =>
    request<{ imported: IntegrationConnection[]; errors: Array<{ name: string; error: string }> }>('/integrations/import', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  connect: (providerId: string, body: ConnectIntegrationRequest) =>
    request<{ connection: IntegrationConnection }>(`/integrations/${providerId}/connect`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  preflight: (
    providerId: string,
    checks?: string[],
    context?: { env?: Record<string, string>; folderPath?: string; remoteUrl?: string },
  ) =>
    request<{ results: SetupPreflightResult[] }>('/integrations/preflight', {
      method: 'POST',
      body: JSON.stringify({ providerId, checks, ...context }),
    }),
  connectTest: (providerId: string, body: ConnectIntegrationRequest) =>
    request<{ ok: boolean; toolCount: number; toolNames: string[]; error?: string }>(
      `/integrations/${providerId}/connect-test`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  disconnect: (connectionId: string) =>
    request<{ ok: boolean }>(`/integrations/${connectionId}`, { method: 'DELETE' }),
  sync: (connectionId: string) =>
    request<{ connection: IntegrationConnection }>(`/integrations/${connectionId}/sync`, { method: 'POST' }),
  runTool: (connectionId: string, toolName: string, args?: Record<string, unknown>) =>
    request<{ result: { success: boolean; output: string; error?: string } }>(`/integrations/${connectionId}/run-tool`, {
      method: 'POST',
      body: JSON.stringify({ toolName, args }),
    }),
  health: (connectionId: string) =>
    request<{ health: { status: string; toolCount: number; error?: string; lastSyncAt?: string } }>(
      `/integrations/${connectionId}/health`,
    ),
  tools: (connectionId: string) =>
    request<{ tools: Array<{ mcpName: string; name: string; description: string; riskLevel: string; defaultDecision: 'allow' | 'deny' | 'ask' }> }>(
      `/integrations/${connectionId}/tools`,
    ),
  startOAuth: (providerId: string, remoteUrl?: string) =>
    request<{ authUrl: string; state: string; redirectUri?: string }>(`/integrations/${providerId}/oauth/start`, {
      method: 'POST',
      body: JSON.stringify(remoteUrl ? { remoteUrl } : {}),
    }),
  oauthRedirectUri: () =>
    request<{ redirectUri: string }>('/integrations/oauth/redirect-uri'),
  runMcpAuth: (connectionId: string) =>
    request<{ success: boolean; output: string }>(`/integrations/${connectionId}/mcp-auth`, { method: 'POST' }),
  startMcpAuth: (connectionId: string) =>
    request<{ authUrl: string; state: string; redirectUri: string }>(`/integrations/${connectionId}/mcp-auth/start`, { method: 'POST' }),
  mcpAuthResult: (state: string) =>
    request<{ result: { status: 'pending' | 'completed' | 'failed' | 'expired'; message?: string } }>(
      `/integrations/mcp-auth/result?state=${encodeURIComponent(state)}`,
    ),
  mcpAuthRedirectUri: (providerId = 'gmail') =>
    request<{ redirectUri: string }>(`/integrations/mcp-auth/redirect-uri?providerId=${encodeURIComponent(providerId)}`),
  mcpAuthStatus: (connectionId: string) =>
    request<{ signedIn: boolean; message?: string }>(`/integrations/${connectionId}/mcp-auth/status`),
  oauthResult: (state: string) =>
    request<{ result: { status: 'pending' | 'completed' | 'failed' | 'expired'; connection?: IntegrationConnection; message?: string } }>(
      `/integrations/oauth/result?state=${encodeURIComponent(state)}`,
    ),
  audit: (limit = 100) =>
    request<{ entries: Array<{
      id: string;
      timestamp: string;
      providerId: string;
      toolName: string;
      readonly: boolean;
      success: boolean;
      error?: string;
      argsSummary?: string;
    }> }>(`/integrations/audit?limit=${limit}`),
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

export interface SubAgentTaskInfo {
  id: string;
  parentSessionId?: string;
  childSessionId?: string;
  instruction: string;
  status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  background?: boolean;
  startTime?: number;
  endTime?: number;
  result?: string;
  error?: string;
}

export interface SystemMetrics {
  timestamp: string;
  uptime: number;
  cpu: { process: number; system: number };
  memory: { used: number; total: number; percent: number; rss: number; heapUsed: number; heapTotal: number; external: number };
}

export interface SystemTime {
  timestamp: string;
  date: string;
  time: string;
  timezone: string;
  utcOffset: number;
}

export interface WeatherConditions {
  temperature: number;
  windSpeed: number;
  windDirection: number;
  weatherCode: number;
  isDay: boolean;
  time: string;
}

export interface Weather {
  location: { latitude: number; longitude: number };
  current: WeatherConditions;
  url: string;
}

export const agent = {
  vitals: () => request<AgentVitals>('/agent/vitals'),
  autonomyStatus: () => request<AutonomyStatus>('/agent/autonomy-status'),
  resetCircuitBreaker: (tool?: string) =>
    request<{ ok: boolean }>('/agent/circuit-breaker/reset', { method: 'POST', body: JSON.stringify(tool ? { tool } : {}) }),
  respondToClarification: (response: string, sessionId?: string) =>
    request<{ ok: boolean; resumed?: boolean }>('/clarification/respond', {
      method: 'POST',
      body: JSON.stringify({ response, ...(sessionId ? { sessionId } : {}) }),
    }),
  respondToStepCap: (continueRun: boolean) =>
    request<{ ok: boolean }>('/agent/step-cap/respond', { method: 'POST', body: JSON.stringify({ continueRun }) }),
  getTurnState: () => request<{ phase: string; stage?: string; step?: number }>('/agent/turn-state'),
};

export const subagents = {
  list: () => request<{ tasks: SubAgentTaskInfo[] }>('/subagents').then((r) => r.tasks),
  get: (id: string) => request<{ task: SubAgentTaskInfo }>(`/subagents/${id}`).then((r) => r.task),
  bySession: (sessionId: string) => request<{ tasks: SubAgentTaskInfo[] }>(`/subagents/session/${sessionId}`).then((r) => r.tasks),
  cancel: (id: string) => request<{ ok: boolean }>(`/subagents/${id}/cancel`, { method: 'POST' }),
};

export const runtime = {
  metrics: () => request<SystemMetrics>('/system/metrics'),
  time: () => request<SystemTime>('/system/time'),
  weather: (lat: number, lon: number) => request<Weather>(`/weather?lat=${lat}&lon=${lon}`),
};

// ─── Factory Reset ───
export const factoryReset = {
  reset: () => request<{ ok: boolean; message: string }>('/reset', { method: 'POST' }),
};
