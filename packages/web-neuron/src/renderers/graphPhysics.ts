import type Graph from 'graphology';
import type { RenderEdge } from './types.ts';

interface Velocity {
  x: number;
  y: number;
}

/**
 * Lightweight spring physics so dragged nodes pull their neighbours along edges.
 */
export class GraphPhysics {
  private velocities = new Map<string, Velocity>();
  private restLengths = new Map<string, number>();
  private anchors = new Map<string, { x: number; y: number }>();

  /** Pin a node to a screen/graph position (while dragging). */
  draggedNode: string | null = null;

  reset(): void {
    this.velocities.clear();
    this.restLengths.clear();
    this.anchors.clear();
    this.draggedNode = null;
  }

  captureRestState(graph: Graph, edges: RenderEdge[]): void {
    this.restLengths.clear();
    this.anchors.clear();
    graph.forEachNode((id, attrs) => {
      this.anchors.set(id, { x: attrs.x, y: attrs.y });
      if (!this.velocities.has(id)) this.velocities.set(id, { x: 0, y: 0 });
    });
    for (const e of edges) {
      if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
      const s = graph.getNodeAttributes(e.source);
      const t = graph.getNodeAttributes(e.target);
      this.restLengths.set(e.id, Math.hypot(t.x - s.x, t.y - s.y));
    }
  }

  /** Spring step — call each animation frame. */
  step(graph: Graph, edges: RenderEdge[]): void {
    if (!graph.order) return;

    const SPRING = 0.045;
    const DAMPING = 0.78;
    const ANCHOR = 0.012;

    for (const e of edges) {
      if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
      const s = graph.getNodeAttributes(e.source);
      const t = graph.getNodeAttributes(e.target);
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      const rest = this.restLengths.get(e.id) ?? dist;
      const force = (dist - rest) * SPRING;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      const apply = (id: string, sx: number, sy: number) => {
        if (id === this.draggedNode) return;
        const v = this.velocities.get(id) ?? { x: 0, y: 0 };
        v.x += sx;
        v.y += sy;
        this.velocities.set(id, v);
      };

      apply(e.source, fx, fy);
      apply(e.target, -fx, -fy);
    }

    graph.forEachNode((id, attrs) => {
      if (id === this.draggedNode) return;
      const v = this.velocities.get(id) ?? { x: 0, y: 0 };
      const anchor = this.anchors.get(id);
      if (anchor) {
        v.x += (anchor.x - attrs.x) * ANCHOR;
        v.y += (anchor.y - attrs.y) * ANCHOR;
      }
      const nx = attrs.x + v.x;
      const ny = attrs.y + v.y;
      graph.mergeNodeAttributes(id, { x: nx, y: ny });
      v.x *= DAMPING;
      v.y *= DAMPING;
      this.velocities.set(id, v);
    });
  }

  setDraggedPosition(graph: Graph, id: string, x: number, y: number): void {
    graph.mergeNodeAttributes(id, { x, y });
    this.anchors.set(id, { x, y });
    this.velocities.set(id, { x: 0, y: 0 });
  }

  releaseDrag(id: string): void {
    const anchor = this.anchors.get(id);
    if (anchor) this.anchors.set(id, { ...anchor });
    this.velocities.set(id, { x: 0, y: 0 });
  }
}
