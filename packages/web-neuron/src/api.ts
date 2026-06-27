const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3333';

export interface SessionInfo {
  id: string;
  title: string;
  status: string;
  provider: string;
  model: string;
  scopePath: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface DbStatus {
  backend: string;
  connected: boolean;
  stats: {
    tableCount: number;
    tables: Record<string, number>;
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  sessions: () => request<SessionInfo[]>('/api/sessions'),
  dbStatus: () => request<DbStatus>('/api/settings/db'),
};
