// Cosmograph adapter — GPU (WebGPU/WebGL) force-layout renderer for the
// "galaxy/nebula" look at scale. Per the project decision: use Cosmograph's
// DEFAULT animation, cluster formation and controls; only inject the AGENT-X
// colour palette so categories match across renderers. Live WebSocket mutations
// are applied via a debounced full re-sync (setConfig detects points/links
// changes and rebuilds), keeping Cosmograph's GPU simulation stable.
import { Cosmograph } from '@cosmograph/cosmograph';
import { NEON } from './palette.ts';
import type { CosmographConfig } from '@cosmograph/cosmograph/cosmograph/config/interfaces/index';
import type { GraphRenderer, RenderEdge, RenderNode } from './types.ts';

const FLUSH_DEBOUNCE_MS = 600;

export class CosmographRenderer implements GraphRenderer {
  readonly id = 'cosmograph' as const;
  readonly label = 'COSMOGRAPH';

  private cosmograph: Cosmograph | null = null;

  // Pending render data awaiting a debounced flush.
  private pendingNodes: RenderNode[] = [];
  private pendingEdges: RenderEdge[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private firstFlushDone = false;

  // id → index map from the last flush, for focusNode + click callbacks.
  private idToIndex = new Map<string, number>();

  private clickCb: ((id: string) => void) | null = null;

  mount(container: HTMLElement): void {
    if (this.cosmograph) return;

    const config: CosmographConfig = {
      // Data + accessors — colour/size are pre-baked by App into the records so
      // Cosmograph renders the AGENT-X palette directly (strategy undefined =>
      // values used as-is). pointIndexBy is required by Cosmograph for efficient
      // link→point mapping; we provide a sequential integer index per point.
      points: [],
      pointIdBy: 'id',
      pointIndexBy: 'index',
      pointColorBy: 'color',
      pointSizeBy: 'size',
      links: [],
      linkSourceBy: 'source',
      linkTargetBy: 'target',
      linkColorBy: 'color',
      linkWidthBy: 'width',
      // Match the void background of the force3d scene.
      backgroundColor: NEON.void,
      // Leave enableSimulation undefined => Cosmograph auto-runs its GPU force
      // layout (the default cluster/nebula formation we want).
      fitViewOnInit: true,
      fitViewPadding: 40,
      onPointClick: (index: number | undefined) => {
        if (this.clickCb && index != null) {
          const id = this.idToIndexBack(index);
          if (id) this.clickCb(id);
        }
      },
    };

    try {
      this.cosmograph = new Cosmograph(container, config);
    } catch {
      // If Cosmograph fails to initialise (e.g. WebGPU dropped between detection
      // and mount), leave the adapter inert — App will fall back to force3d.
      this.cosmograph = null;
    }
  }

  async destroy(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.cosmograph) {
      try {
        await this.cosmograph.destroy();
      } catch {
        // ignore
      }
    }
    this.cosmograph = null;
    this.idToIndex.clear();
    this.firstFlushDone = false;
  }

  resize(): void {
    // Cosmograph observes its container size internally; no explicit resize call.
  }

  // --- Data sync (debounced) ---------------------------------------------

  setData(nodes: RenderNode[], edges: RenderEdge[]): void {
    this.pendingNodes = nodes;
    this.pendingEdges = edges;
    if (!this.cosmograph) return;

    // First paint is immediate so the graph appears without a debounce delay.
    if (!this.firstFlushDone) {
      this.flush();
      return;
    }

    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), FLUSH_DEBOUNCE_MS);
  }

  private flush(): void {
    this.flushTimer = null;
    const c = this.cosmograph;
    if (!c) return;

    const points = this.pendingNodes.map((n, i) => ({
      id: n.id,
      index: i,
      color: n.color,
      size: n.size,
      label: n.label,
      category: n.category,
    }));
    const links = this.pendingEdges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      color: e.color,
      width: e.width,
    }));

    // Rebuild the id→index map (points are indexed in array order).
    this.idToIndex = new Map(points.map((p, i) => [p.id as string, i]));

    try {
      c.setConfig({
        points,
        pointIdBy: 'id',
        pointIndexBy: 'index',
        pointColorBy: 'color',
        pointSizeBy: 'size',
        links,
        linkSourceBy: 'source',
        linkTargetBy: 'target',
        linkColorBy: 'color',
        linkWidthBy: 'width',
      } as CosmographConfig);
    } catch {
      // ignore — next flush will retry
    }

    this.firstFlushDone = true;
  }

  private idToIndexBack(index: number): string | undefined {
    for (const [id, idx] of this.idToIndex) {
      if (idx === index) return id;
    }
    return undefined;
  }

  // --- Particles (unsupported — no-op) ------------------------------------

  emitParticle(): void {
    // Cosmograph has no travelling-particle API; the GPU simulation itself
    // provides the visual "life".
  }

  emitFromNode(): void {
    // no-op
  }

  // --- Camera -------------------------------------------------------------

  focusNode(id: string): void {
    if (!this.cosmograph) return;
    const index = this.idToIndex.get(id);
    if (index == null) return;
    try {
      this.cosmograph.zoomToPoint(index, 400);
    } catch {
      // ignore
    }
  }

  fitToAll(): void {
    if (!this.cosmograph) return;
    try {
      this.cosmograph.fitView(400, 40);
    } catch {
      // ignore
    }
  }

  // --- Callbacks ----------------------------------------------------------

  onNodeClick(cb: (id: string) => void): void {
    this.clickCb = cb;
  }
}
