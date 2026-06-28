const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

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

export interface MemoryNode {
  id: string;
  label: string;
  category: string;
  content: string;
  status: string;
  x: number | null;
  y: number | null;
  sourceId: string | null;
  sessionId: string | null;
  agentId: string | null;
  confidence: number;
  createdAt: string;
  updatedAt: string;
  accessCount: number;
  lastAccessedAt: string | null;
  tag: string | null;
  isBenchmark: boolean;
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

export interface MemorySource {
  id: string;
  name: string;
  kind: string;
  colorHex: string;
  createdAt: string;
}

export type BrainActivityEvent =
  | { type: 'neuron_created'; nodeId: string; label: string; category: string; content: string; x: number | null; y: number | null; timestamp: string }
  | { type: 'synapse_bound'; edgeId: string; sourceNodeId: string; targetNodeId: string; relationshipType: string; weight: number; timestamp: string }
  | { type: 'neuron_fired'; nodeId: string; timestamp: string }
  | { type: 'neuron_decayed'; nodeId: string; status: string; timestamp: string }
  | { type: 'cluster_layout_updated'; epoch: number; count: number; timestamp: string };

export interface TestResult {
  score: number;
  maxScore: number;
  passed: boolean;
  latencyMs: number;
  error?: string;
}

export interface Scorecard {
  id: string;
  runId: string;
  model: string;
  provider: string;
  startedAt: string;
  finishedAt?: string;
  totalScore: number;
  maxScore: number;
  ragTriad?: Record<string, number>;
  testResults: Record<string, TestResult>;
  metadata?: Record<string, unknown>;
}

export interface LayoutResult {
  epoch: number;
  count: number;
  communities: number;
}

export interface ViewportResult {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  epoch: number;
  band: 'A' | 'B' | 'C';
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
  graph: (limit = 1000, category?: string, tag?: string, isBenchmark?: boolean) =>
    request<{ nodes: MemoryNode[]; edges: MemoryEdge[] }>(
      `/api/memory/graph?limit=${limit}${category ? `&category=${category}` : ''}${tag ? `&tag=${tag}` : ''}${isBenchmark != null ? `&isBenchmark=${isBenchmark}` : ''}`
    ),
  viewport: (xMin: number, yMin: number, xMax: number, yMax: number, zoom = 1, limit = 2000) =>
    request<ViewportResult>(`/api/memory/graph/viewport?xMin=${xMin}&yMin=${yMin}&xMax=${xMax}&yMax=${yMax}&zoom=${zoom}&limit=${limit}`),
  layout: () => request<LayoutResult>('/api/memory/graph/layout'),
  layoutEpoch: () => request<{ epoch: number }>('/api/memory/graph/layout-epoch'),
  sources: () => request<MemorySource[]>('/api/memory/sources'),
  wipeBenchmark: () => request<{ deletedNodes: number; deletedEdges: number }>('/api/memory/wipe-benchmark', { method: 'POST' }),
  runBenchmark: (model: string, provider: string, tag?: string) =>
    request<{ runId: string }>('/api/memory/benchmark', {
      method: 'POST',
      body: JSON.stringify({ model, provider, tag }),
    }),
  scorecards: () => request<{ scorecards: Scorecard[] }>('/api/memory/benchmark/scorecards'),
};
