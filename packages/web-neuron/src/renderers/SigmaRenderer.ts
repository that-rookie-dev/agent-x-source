// Single WebGL-2D renderer using sigma.js + graphology.
//
// Features:
//   • Fibonacci-sphere layout with collision separation
//   • Spring physics while dragging nodes (neighbours follow edges)
//   • Pulse / birth / decay / synapse-fire animations via GraphAnimator
//   • Travelling pulse dots drawn on a canvas overlay

import Graph from 'graphology';
import Sigma from 'sigma';
import { GraphAnimator, mixTowardWhite, withAlpha } from './graphAnimator.ts';
import { GraphPhysics } from './graphPhysics.ts';
import { NEON } from './palette.ts';
import { computeSphereLayout, placeNewNode } from './sphereLayout.ts';
import {
  EDGE_WIDTH,
  BASE_NODE_SIZE,
  type GraphRenderer,
  type RenderEdge,
  type RenderNode,
} from './types.ts';

function nodeTwinkle(id: string): { sizeMul: number; alpha: number } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const bucket = Math.abs(hash) % 100;
  return {
    sizeMul: 0.85 + (bucket % 30) / 100,
    alpha: 0.72 + (bucket % 28) / 100,
  };
}

export class SigmaRenderer implements GraphRenderer {
  readonly id = 'sigma' as const;
  readonly label = 'SIGMA';

  private graph: Graph | null = null;
  private sigma: Sigma | null = null;
  private particleCanvas: HTMLCanvasElement | null = null;

  private clickCb: ((id: string) => void) | null = null;
  private dragEndCb: ((id: string, x: number, y: number, z: number) => void) | null = null;

  private hasRenderedData = false;
  private layoutApplied = false;
  private positionCache = new Map<string, { x: number; y: number }>();
  private knownNodeIds = new Set<string>();
  private edgeList: RenderEdge[] = [];
  private edgeById = new Map<string, RenderEdge>();

  private animator = new GraphAnimator();
  private physics = new GraphPhysics();
  private rafId = 0;
  private isDragging = false;

  mount(container: HTMLElement): void {
    if (this.sigma) return;

    this.particleCanvas = document.createElement('canvas');
    this.particleCanvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:10';
    container.style.position = 'relative';
    container.appendChild(this.particleCanvas);

    this.graph = new Graph({ multi: false, allowSelfLoops: false });

    const animator = this.animator;
    const refresh = () => this.sigma?.refresh();

    this.sigma = new Sigma(this.graph, container, {
      autoRescale: true,
      autoCenter: true,
      renderEdgeLabels: false,
      renderLabels: false,
      defaultNodeColor: NEON.cyan,
      defaultEdgeColor: NEON.brightCyan,
      defaultEdgeType: 'line',
      defaultNodeType: 'circle',
      itemSizesReference: 'screen',
      minEdgeThickness: 0.48,
      zoomToSizeRatioFunction: Math.sqrt,
      enableCameraPanning: true,
      enableCameraZooming: true,

      nodeReducer: (node, data) => {
        const tw = nodeTwinkle(node);
        const fx = animator.getNodeEffect(node);
        const color = mixTowardWhite(data.color, fx.whiteMix);
        return {
          ...data,
          size: data.size * tw.sizeMul * fx.sizeMul,
          color: withAlpha(color, tw.alpha * fx.alphaMul),
        };
      },
      edgeReducer: (edge, data) => {
        const fx = animator.getEdgeEffect(edge);
        const color = mixTowardWhite(data.color, fx.whiteMix);
        return {
          ...data,
          size: Math.max(data.size * fx.sizeMul, 0.48),
          color: withAlpha(color, 0.62 + fx.whiteMix * 0.35),
        };
      },
    });

    this.animator.subscribe(refresh);

    this.sigma.on('clickNode', ({ node }: { node: string }) => {
      if (!this.isDragging && this.clickCb) this.clickCb(node);
    });

    this.sigma.on('downNode', (e: { node: string; event: { original: MouseEvent | TouchEvent } }) => {
      this.isDragging = false;
      this.physics.draggedNode = e.node;
      e.event.original.preventDefault();
    });

    this.sigma.getMouseCaptor().on('mousemovebody', (e: { x: number; y: number; preventSigmaDefault: () => void }) => {
      if (!this.physics.draggedNode || !this.graph || !this.sigma) return;
      this.isDragging = true;
      const pos = this.sigma.viewportToGraph({ x: e.x, y: e.y });
      this.physics.setDraggedPosition(this.graph, this.physics.draggedNode, pos.x, pos.y);
      this.positionCache.set(this.physics.draggedNode, { x: pos.x, y: pos.y });
      e.preventSigmaDefault();
    });

    this.sigma.getMouseCaptor().on('mouseup', () => this.endDrag());
    this.sigma.on('upNode', () => this.endDrag());

    this.startLoop();
  }

  private endDrag(): void {
    if (!this.physics.draggedNode) return;
    const id = this.physics.draggedNode;
    if (this.graph?.hasNode(id)) {
      const { x, y } = this.graph.getNodeAttributes(id);
      this.physics.releaseDrag(id);
      this.positionCache.set(id, { x, y });
      this.dragEndCb?.(id, x, y, 0);
    }
    this.physics.draggedNode = null;
    this.isDragging = false;
  }

  private startLoop(): void {
    const tick = () => {
      this.rafId = requestAnimationFrame(tick);
      if (!this.graph || !this.sigma) return;

      const active =
        this.physics.draggedNode != null ||
        this.animator.hasActiveEffects() ||
        this.animator.getActiveEdgeParticles().length > 0;

      if (this.physics.draggedNode || this.edgeList.length) {
        this.physics.step(this.graph, this.edgeList);
      }

      this.drawParticles();
      this.animator.prune();

      if (active) {
        this.sigma.refresh();
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private drawParticles(): void {
    const canvas = this.particleCanvas;
    const sigma = this.sigma;
    const graph = this.graph;
    if (!canvas || !sigma || !graph) return;

    const rect = canvas.parentElement?.getBoundingClientRect();
    if (!rect) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    for (const { edgeId, t } of this.animator.getActiveEdgeParticles()) {
      const edge = this.edgeById.get(edgeId);
      if (!edge || !graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
      const s = graph.getNodeAttributes(edge.source);
      const tgt = graph.getNodeAttributes(edge.target);
      const gx = s.x + (tgt.x - s.x) * t;
      const gy = s.y + (tgt.y - s.y) * t;
      const vp = sigma.graphToViewport({ x: gx, y: gy });
      const glow = ctx.createRadialGradient(vp.x, vp.y, 0, vp.x, vp.y, 10);
      glow.addColorStop(0, 'rgba(255,255,255,0.95)');
      glow.addColorStop(0.35, 'rgba(125,249,255,0.65)');
      glow.addColorStop(1, 'rgba(125,249,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(vp.x, vp.y, 10, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  async destroy(): Promise<void> {
    cancelAnimationFrame(this.rafId);
    if (this.sigma) {
      try {
        this.sigma.kill();
      } catch {
        // ignore
      }
      this.sigma = null;
    }
    this.particleCanvas?.remove();
    this.particleCanvas = null;
    this.graph = null;
    this.hasRenderedData = false;
    this.layoutApplied = false;
    this.positionCache.clear();
    this.knownNodeIds.clear();
    this.physics.reset();
  }

  resize(): void {}

  private runInitialLayout(nodes: RenderNode[]): void {
    if (this.layoutApplied) return;
    this.layoutApplied = true;
    const layout = computeSphereLayout(nodes);
    for (const [id, pos] of layout) {
      this.positionCache.set(id, pos);
      if (this.graph?.hasNode(id)) {
        this.graph.mergeNodeAttributes(id, { x: pos.x, y: pos.y });
      }
    }
    if (this.graph) this.physics.captureRestState(this.graph, this.edgeList);
  }

  setData(nodes: RenderNode[], edges: RenderEdge[]): void {
    if (!this.graph || !this.sigma) return;

    this.edgeList = edges;
    this.edgeById = new Map(edges.map((e) => [e.id, e]));

    const incomingIds = new Set(nodes.map((n) => n.id));
    for (const id of this.knownNodeIds) {
      if (!incomingIds.has(id)) this.animator.animateDecay(id);
    }

    const keepNodes = incomingIds;
    for (const id of this.graph.nodes()) {
      if (!keepNodes.has(id)) {
        this.graph.dropNode(id);
        this.positionCache.delete(id);
      }
    }

    const stagingLayout = !this.layoutApplied;

    for (const n of nodes) {
      const isNew = !this.knownNodeIds.has(n.id);
      let pos = this.positionCache.get(n.id);
      if (!pos) {
        if (this.layoutApplied) {
          pos = placeNewNode(n, this.positionCache, nodes, edges);
          this.positionCache.set(n.id, pos);
        } else {
          pos = { x: n.x ?? 0, y: n.y ?? 0 };
        }
      }

      if (this.graph.hasNode(n.id)) {
        this.graph.mergeNodeAttributes(n.id, {
          x: pos.x,
          y: pos.y,
          size: n.size,
          color: n.color,
          label: n.label,
        });
      } else {
        this.graph.addNode(n.id, {
          x: pos.x,
          y: pos.y,
          size: isNew ? 0.01 : n.size,
          color: n.color,
          label: n.label,
        });
        if (isNew) this.animator.animateBirth(n.id);
      }
    }

    for (const n of nodes) this.knownNodeIds.add(n.id);

    const keepEdges = new Set(edges.map((e) => e.id));
    for (const key of this.graph.edges()) {
      if (!keepEdges.has(key)) this.graph.dropEdge(key);
    }

    for (const e of edges) {
      if (!this.graph.hasNode(e.source) || !this.graph.hasNode(e.target)) continue;
      const attrs = { size: e.width, color: e.color };
      if (this.graph.hasEdge(e.id)) {
        this.graph.mergeEdgeAttributes(e.id, attrs);
      } else {
        try {
          this.graph.addEdgeWithKey(e.id, e.source, e.target, attrs);
        } catch {
          // skip
        }
      }
    }

    if (stagingLayout && nodes.length > 0) {
      this.runInitialLayout(nodes);
    } else if (this.graph) {
      this.physics.captureRestState(this.graph, this.edgeList);
    }

    if (nodes.length > 0 && !this.hasRenderedData) {
      this.hasRenderedData = true;
      this.fitToAll();
    }
  }

  emitParticle(edgeId: string): void {
    this.animator.fireEdge(edgeId);
  }

  emitFromNode(nodeId: string, max = 12): void {
    const edgeIds = this.edgeList
      .filter((e) => e.source === nodeId || e.target === nodeId)
      .slice(0, max)
      .map((e) => e.id);
    this.animator.fireFromNode(nodeId, edgeIds);
  }

  pulseNode(nodeId: string, durationMs = 2200): void {
    this.animator.pulseNode(nodeId, 'blink', durationMs);
  }

  pulseCluster(nodeIds: string[], durationMs = 2200): void {
    this.animator.pulseCluster(nodeIds, durationMs);
  }

  animateDecay(nodeId: string): void {
    this.animator.animateDecay(nodeId);
  }

  focusNode(id: string): void {
    // No camera movement — selection is shown in the side panel only.
    void id;
  }

  fitToAll(): void {
    if (!this.sigma) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.sigma?.getCamera().animatedReset({ duration: 500 });
      });
    });
  }

  onNodeClick(cb: (id: string) => void): void {
    this.clickCb = cb;
  }

  onNodeDragEnd(cb: (id: string, x: number, y: number, z: number) => void): void {
    this.dragEndCb = cb;
  }
}

export { EDGE_WIDTH, BASE_NODE_SIZE };
