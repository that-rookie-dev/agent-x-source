import type { RenderEdge, RenderNode } from './types.ts';

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/** Inner shell — session cluster nodes live here. */
const INNER_RADIUS = 150;
/** Outer shell — orphan nodes ring the galaxy border. */
const OUTER_RADIUS = 210;

type LayoutNode = {
  id: string;
  x: number;
  y: number;
  size: number;
  sessionId: string | null;
  anchorX: number;
  anchorY: number;
};

function fibonacciSphere(index: number, total: number, radius: number): { x: number; y: number; z: number } {
  if (total <= 1) return { x: 0, y: 0, z: 0 };
  const y = 1 - (index / (total - 1)) * 2;
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN * index;
  return {
    x: Math.cos(theta) * ring * radius,
    y: y * radius,
    z: Math.sin(theta) * ring * radius,
  };
}

function project(p: { x: number; y: number; z: number }): { x: number; y: number } {
  return { x: p.x, y: p.y * 0.88 + p.z * 0.22 };
}

function minSeparation(a: LayoutNode, b: LayoutNode): number {
  return (a.size + b.size) * 2.8 + 10;
}

function resolveCollisions(nodes: LayoutNode[]): void {
  for (let iter = 0; iter < 48; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const need = minSeparation(a, b);
        if (dist >= need) continue;
        const overlap = need - dist;
        const nx = dx / dist;
        const ny = dy / dist;
        const sameSession = a.sessionId != null && a.sessionId === b.sessionId;
        const push = overlap * (sameSession ? 0.5 : 0.22);
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
      }
    }
    for (const n of nodes) {
      n.x += (n.anchorX - n.x) * 0.05;
      n.y += (n.anchorY - n.y) * 0.05;
    }
  }
}

/**
 * Galaxy layout: one global sphere. Session nodes form compact patches on the
 * inner shell; orphan nodes sit on the outer border shell.
 */
export function computeSphereLayout(nodes: RenderNode[]): Map<string, { x: number; y: number }> {
  const sessions = new Map<string, RenderNode[]>();
  const orphans: RenderNode[] = [];

  for (const n of nodes) {
    if (n.sessionId) {
      const g = sessions.get(n.sessionId) ?? [];
      g.push(n);
      sessions.set(n.sessionId, g);
    } else {
      orphans.push(n);
    }
  }

  const layoutNodes: LayoutNode[] = [];
  const sessionIds = Array.from(sessions.keys());

  // Session centroids evenly on the inner global sphere.
  const sessionCentroids = new Map<string, { x: number; y: number; z: number }>();
  sessionIds.forEach((sid, si) => {
    sessionCentroids.set(sid, fibonacciSphere(si, sessionIds.length, INNER_RADIUS));
  });

  sessionIds.forEach((sessionId) => {
    const group = sessions.get(sessionId)!;
    const centroid = sessionCentroids.get(sessionId)!;

    group.forEach((node, ni) => {
      const angle = (ni / Math.max(group.length, 1)) * Math.PI * 2;
      const ring = 10 + (ni % 4) * 7;
      const world = {
        x: centroid.x + Math.cos(angle) * ring,
        y: centroid.y + Math.sin(angle) * ring * 0.85,
        z: centroid.z,
      };
      const p = project(world);
      layoutNodes.push({
        id: node.id,
        x: p.x,
        y: p.y,
        size: node.size,
        sessionId,
        anchorX: p.x,
        anchorY: p.y,
      });
    });
  });

  orphans.forEach((node, i) => {
    const p = project(fibonacciSphere(i, Math.max(orphans.length, 1), OUTER_RADIUS));
    layoutNodes.push({
      id: node.id,
      x: p.x,
      y: p.y,
      size: node.size,
      sessionId: null,
      anchorX: p.x,
      anchorY: p.y,
    });
  });

  resolveCollisions(layoutNodes);

  const positions = new Map<string, { x: number; y: number }>();
  for (const n of layoutNodes) positions.set(n.id, { x: n.x, y: n.y });
  return positions;
}

/** Place a single incoming node near its session patch or graph neighbour. */
export function placeNewNode(
  node: RenderNode,
  positions: Map<string, { x: number; y: number }>,
  allNodes: RenderNode[],
  edges: RenderEdge[],
): { x: number; y: number } {
  for (const e of edges) {
    const peer = e.source === node.id ? e.target : e.target === node.id ? e.source : null;
    if (!peer) continue;
    const anchor = positions.get(peer);
    if (!anchor) continue;
    const angle = Math.random() * Math.PI * 2;
    const dist = 16 + Math.random() * 10;
    return { x: anchor.x + Math.cos(angle) * dist, y: anchor.y + Math.sin(angle) * dist };
  }

  if (node.sessionId) {
    const peers = allNodes.filter((n) => n.id !== node.id && n.sessionId === node.sessionId);
    const placed = peers.map((n) => positions.get(n.id)).filter(Boolean) as { x: number; y: number }[];
    if (placed.length) {
      const cx = placed.reduce((s, p) => s + p.x, 0) / placed.length;
      const cy = placed.reduce((s, p) => s + p.y, 0) / placed.length;
      const angle = Math.random() * Math.PI * 2;
      return { x: cx + Math.cos(angle) * 14, y: cy + Math.sin(angle) * 14 };
    }
  }

  // Fallback: outer border for orphans, inner random patch for new session.
  const shell = node.sessionId ? INNER_RADIUS * 0.6 : OUTER_RADIUS * 0.9;
  const p = project(fibonacciSphere(Math.floor(Math.random() * 100), 100, shell));
  return p;
}
