/**
 * Neural Cortex graph API — data plane for the living-brain visualization.
 *
 * All heavy work (layout, community detection) happens server-side; these
 * routes serve precomputed positions, bounded snapshots, and a coalesced
 * SSE stream of live brain events. The browser never runs physics.
 */
import { Router, type Request, type Response } from 'express';
import type { MemoryNode, MemoryNodeCategory } from '@agentx/engine';
import { getGlobalBrainEventStreamer } from '@agentx/engine';
import { getLogger } from '@agentx/shared';
import { getFabric, handleFabricUnavailable } from '../../memory/shared.js';

const logger = getLogger();

const CONTENT_PREVIEW_CHARS = 180;
const MAX_SNAPSHOT_NODES = 3000;
const MAX_VIEWPORT_NODES = 2500;

/** Trim a MemoryNode down to what the renderer actually needs on the wire. */
function toWireNode(n: MemoryNode) {
  return {
    id: n.id,
    label: n.label,
    category: n.category,
    x: n.x ?? null,
    y: n.y ?? null,
    communityId: n.communityId ?? null,
    sourceId: n.sourceId ?? null,
    sessionId: n.sessionId ?? null,
    tag: n.tag ?? null,
    confidence: n.confidence ?? null,
    accessCount: n.accessCount ?? 0,
    lastAccessedAt: n.lastAccessedAt ?? null,
    createdAt: n.createdAt,
    contentPreview: (n.content ?? '').slice(0, CONTENT_PREVIEW_CHARS),
  };
}

function toWireEdge(e: { id: string; sourceNodeId: string; targetNodeId: string; relationshipType: string; weight: number }) {
  return {
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    type: e.relationshipType,
    weight: e.weight,
  };
}

function parseCategory(value: unknown): MemoryNodeCategory | undefined {
  return typeof value === 'string' && value.length > 0 ? (value as MemoryNodeCategory) : undefined;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

// Layout recomputation is CPU-bound (ForceAtlas2); never run two at once.
let layoutInFlight: Promise<{ epoch: number; count: number; communities: number }> | null = null;

export function cortexGraphRouter(): Router {
  const r = Router();

  r.get('/neural-cortex/graph/meta', async (_req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const meta = await fabric.getCortexMeta();
      res.json(meta);
    } catch (e) {
      logger.error('CORTEX_GRAPH', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to get cortex meta' });
    }
  });

  r.get('/neural-cortex/graph/snapshot', async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const limit = clampInt(req.query['limit'], MAX_SNAPSHOT_NODES, 1, MAX_SNAPSHOT_NODES);
      const { nodes, edges } = await fabric.getGraphSnapshot({
        limit,
        category: parseCategory(req.query['category']),
        sourceId: typeof req.query['sourceId'] === 'string' ? req.query['sourceId'] : undefined,
        tag: typeof req.query['tag'] === 'string' ? req.query['tag'] : undefined,
      });
      const epoch = await fabric.getLayoutEpoch();
      res.json({ nodes: nodes.map(toWireNode), edges: edges.map(toWireEdge), epoch });
    } catch (e) {
      logger.error('CORTEX_GRAPH', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to get graph snapshot' });
    }
  });

  r.get('/neural-cortex/graph/viewport', async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const bounds = {
        xmin: Number(req.query['xmin']),
        xmax: Number(req.query['xmax']),
        ymin: Number(req.query['ymin']),
        ymax: Number(req.query['ymax']),
      };
      if (!Object.values(bounds).every(Number.isFinite)) {
        return res.status(400).json({ error: 'xmin/xmax/ymin/ymax are required numbers' });
      }
      const { nodes, edges, epoch, band } = await fabric.getViewport(bounds, {
        zoom: Number.isFinite(Number(req.query['zoom'])) ? Number(req.query['zoom']) : undefined,
        category: parseCategory(req.query['category']),
        limit: clampInt(req.query['limit'], MAX_VIEWPORT_NODES, 1, MAX_VIEWPORT_NODES),
      });
      res.json({ nodes: nodes.map(toWireNode), edges: edges.map(toWireEdge), epoch, band });
    } catch (e) {
      logger.error('CORTEX_GRAPH', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to get viewport' });
    }
  });

  r.get('/neural-cortex/graph/node/:id', async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const node = await fabric.getNode(req.params['id'] as string);
      if (!node) return res.status(404).json({ error: 'Node not found' });
      const walk = await fabric.walkGraph({ startNodeIds: [node.id], maxDepth: 1, maxFanOut: 50 });
      const neighborIds = walk.nodeIds.filter((id) => id !== node.id);
      const neighbors = await fabric.getNodesByIds(neighborIds);
      const labelById = new Map(neighbors.map((n) => [n.id, n.label]));
      res.json({
        node: { ...toWireNode(node), content: node.content },
        connections: walk.edges.map((e) => ({
          sourceNodeId: e.sourceNodeId,
          targetNodeId: e.targetNodeId,
          relationshipType: e.relationshipType,
          weight: e.weight,
          neighborId: e.sourceNodeId === node.id ? e.targetNodeId : e.sourceNodeId,
          neighborLabel: labelById.get(e.sourceNodeId === node.id ? e.targetNodeId : e.sourceNodeId) ?? null,
        })),
      });
    } catch (e) {
      logger.error('CORTEX_GRAPH', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to get node' });
    }
  });

  r.get('/neural-cortex/graph/neighborhood/:id', async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      const depth = clampInt(req.query['depth'], 2, 1, 3);
      const walk = await fabric.walkGraph({
        startNodeIds: [req.params['id'] as string],
        maxDepth: depth,
        maxFanOut: 25,
      });
      const nodes = await fabric.getNodesByIds(walk.nodeIds);
      res.json({
        nodes: nodes.map(toWireNode),
        edges: walk.edges.map((e, i) => toWireEdge({ id: String(i), sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId, relationshipType: e.relationshipType, weight: e.weight })),
      });
    } catch (e) {
      logger.error('CORTEX_GRAPH', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Failed to get neighborhood' });
    }
  });

  r.get('/neural-cortex/graph/search', async (req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    const q = typeof req.query['q'] === 'string' ? req.query['q'].trim() : '';
    if (q.length < 2) return res.json({ results: [] });
    try {
      const limit = clampInt(req.query['limit'], 12, 1, 50);
      const { rows } = await fabric.getPool().query<MemoryNode>(
        `SELECT n.id, n.label, n.category, n.content, n.x, n.y, n.community_id AS "communityId",
                n.confidence, n.created_at AS "createdAt",
                COALESCE(a.access_count, 0)::integer AS "accessCount"
         FROM memory_nodes n
         LEFT JOIN neuron_activity a ON a.node_id = n.id
         WHERE n.status = 'active' AND (n.label ILIKE $1 OR n.content ILIKE $1)
         ORDER BY (n.label ILIKE $1) DESC, COALESCE(a.access_count, 0) DESC
         LIMIT $2`,
        [`%${q}%`, limit],
      );
      res.json({ results: rows.map(toWireNode) });
    } catch (e) {
      logger.error('CORTEX_GRAPH', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Search failed' });
    }
  });

  r.post('/neural-cortex/graph/layout', async (_req: Request, res: Response) => {
    const fabric = getFabric();
    if (!fabric) return handleFabricUnavailable(res);
    try {
      if (!layoutInFlight) {
        layoutInFlight = fabric.computeLouvainLayout().finally(() => { layoutInFlight = null; });
      }
      const result = await layoutInFlight;
      res.json(result);
    } catch (e) {
      logger.error('CORTEX_GRAPH', e instanceof Error ? e.message : e);
      res.status(500).json({ error: 'Layout computation failed' });
    }
  });

  r.get('/neural-cortex/graph/events', (req: Request, res: Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('data: ' + JSON.stringify({ type: 'connected' }) + '\n\n');

    const streamer = getGlobalBrainEventStreamer();
    const unsubscribe = streamer.on((events) => {
      res.write('data: ' + JSON.stringify({ type: 'batch', events }) + '\n\n');
    });

    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 25_000);

    req.on('close', () => {
      unsubscribe();
      clearInterval(heartbeat);
      res.end();
    });
  });

  return r;
}
