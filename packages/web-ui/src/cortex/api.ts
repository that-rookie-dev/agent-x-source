/**
 * Typed client for the Neural Cortex graph API + SSE brain-event stream.
 */
import { getAuthToken } from '../api';

const BASE = '/api/neural-cortex/graph';

export interface CortexNode {
  id: string;
  label: string;
  category: string;
  x: number | null;
  y: number | null;
  communityId: string | null;
  sourceId: string | null;
  sessionId: string | null;
  tag: string | null;
  confidence: number | null;
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
  contentPreview: string;
}

export interface CortexEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  weight: number;
}

export interface CortexMeta {
  nodeCount: number;
  edgeCount: number;
  communityCount: number;
  layoutEpoch: number;
  categories: Array<{ category: string; count: number }>;
  growth: Array<{ day: string; count: number }>;
  lastNodeAt: string | null;
}

export interface CortexSnapshot {
  nodes: CortexNode[];
  edges: CortexEdge[];
  epoch: number;
}

export interface CortexNodeDetail {
  node: CortexNode & { content: string };
  connections: Array<{
    sourceNodeId: string;
    targetNodeId: string;
    relationshipType: string;
    weight: number;
    neighborId: string;
    neighborLabel: string | null;
  }>;
}

export type BrainEvent =
  | { event: 'NODE_CREATED'; nodeId: string; label: string; category: string; x: number | null; y: number | null; communityId?: string | null; sourceId?: string | null; sessionId?: string | null; timestamp: string }
  | { event: 'SYNAPSE_CONNECTED'; sourceId: string; targetId: string; relationshipType: string; weight: number; timestamp: string }
  | { event: 'NEURON_ACTIVATED'; nodeIds: string[]; intensity: number; timestamp: string };

async function get<T>(path: string): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new Error(`Cortex API ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

export const cortexApi = {
  meta: () => get<CortexMeta>('/meta'),

  snapshot: (opts: { limit?: number; category?: string; sourceId?: string } = {}) => {
    const p = new URLSearchParams();
    if (opts.limit) p.set('limit', String(opts.limit));
    if (opts.category) p.set('category', opts.category);
    if (opts.sourceId) p.set('sourceId', opts.sourceId);
    const qs = p.toString();
    return get<CortexSnapshot>(`/snapshot${qs ? `?${qs}` : ''}`);
  },

  viewport: (bounds: { xmin: number; xmax: number; ymin: number; ymax: number }, zoom: number, limit?: number) => {
    const p = new URLSearchParams({
      xmin: String(bounds.xmin), xmax: String(bounds.xmax),
      ymin: String(bounds.ymin), ymax: String(bounds.ymax),
      zoom: String(zoom),
    });
    if (limit) p.set('limit', String(limit));
    return get<CortexSnapshot & { band: 'A' | 'B' | 'C' }>(`/viewport?${p}`);
  },

  node: (id: string) => get<CortexNodeDetail>(`/node/${encodeURIComponent(id)}`),

  neighborhood: (id: string, depth = 2) =>
    get<{ nodes: CortexNode[]; edges: CortexEdge[] }>(`/neighborhood/${encodeURIComponent(id)}?depth=${depth}`),

  search: (q: string) => get<{ results: CortexNode[] }>(`/search?q=${encodeURIComponent(q)}`),

  relayout: async (): Promise<{ epoch: number; count: number; communities: number }> => {
    const token = getAuthToken();
    const res = await fetch(`${BASE}/layout`, {
      method: 'POST',
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) throw new Error(`Layout failed: ${res.status}`);
    return res.json();
  },

  /**
   * Subscribe to live brain events. Auto-reconnects (EventSource native).
   * Returns an unsubscribe function.
   */
  subscribeEvents: (onBatch: (events: BrainEvent[]) => void): (() => void) => {
    const token = getAuthToken();
    const url = `${BASE}/events${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const es = new EventSource(url, { withCredentials: true });
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as { type: string; events?: BrainEvent[] };
        if (data.type === 'batch' && data.events?.length) onBatch(data.events);
      } catch { /* malformed frame — skip */ }
    };
    return () => es.close();
  },
};
