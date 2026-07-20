/**
 * CortexRenderer — the living-brain WebGL scene.
 *
 * Imperative PixiJS v8 core: React never touches the hot path. All positions
 * are precomputed server-side; everything animated here is a cheap GPU
 * transform (scale/alpha pulses, pooled particles, camera easing).
 *
 * Layer stack (back → front):
 *   starfield (screen-space, parallax)
 *   world: nebulas → edges → fx → node halos+cores
 */
import { Application, Container, Graphics, Sprite, TilingSprite } from 'pixi.js';
import type { CortexNode, CortexEdge, BrainEvent } from '../api';
import { categoryStyle, communityTint, nodeRadius, CORTEX_BG, type CategoryStyle } from '../palette';
import { Camera } from './camera';
import { getCortexTextures, makeStarfieldTexture, destroyCortexTextures } from './textures';
import { CortexFx } from './fx';

const MAX_NODES = 2500;
const MAX_EDGES = 6000;
const FOCUS_DIM_ALPHA = 0.08;
const RELAYOUT_TRANSITION_S = 1.2;

interface NodeRec {
  id: string;
  x: number;
  y: number;
  /** Transition origin/target for re-layout lerp. */
  fromX: number; fromY: number; toX: number; toY: number;
  radius: number;
  style: CategoryStyle;
  communityId: string | null;
  label: string;
  accessCount: number;
  /** Per-node breathing phase + speed (hashed from id — deterministic). */
  phase: number;
  breathSpeed: number;
  halo: Sprite;
  core: Sprite;
  /** 1 → 0 decay after a firing event. */
  ignite: number;
  /** 0 → 1 grow-in after spawn. */
  spawn: number;
  alpha: number;
  alphaTarget: number;
  neighbors: string[];
}

export interface CortexRendererCallbacks {
  onSelect: (nodeId: string | null) => void;
  onHover: (nodeId: string | null) => void;
  /** Camera settled after movement — page may refetch viewport data. */
  onViewportSettled: (bounds: { xmin: number; xmax: number; ymin: number; ymax: number }, zoom: number) => void;
}

function hash01(id: string, salt: number): number {
  let h = salt;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 10000) / 10000;
}

export class CortexRenderer {
  private app = new Application();
  private camera = new Camera();
  private world = new Container();
  private nebulaLayer = new Container();
  private edgeGraphics = new Graphics();
  private nodeLayer = new Container();
  private fx!: CortexFx;
  private starfield!: TilingSprite;

  private nodes = new Map<string, NodeRec>();
  private edges: CortexEdge[] = [];
  private edgesByNode = new Map<string, CortexEdge[]>();

  private hoveredId: string | null = null;
  private selectedId: string | null = null;
  private focusIds: Set<string> | null = null;

  private time = 0;
  private relayoutT = 1;           // ≥1 = no transition in progress
  private edgesDirty = true;
  private edgeDrawScale = 0;       // camera scale at last edge draw (widths are zoom-dependent)
  private cameraWasMoving = false;

  // Picking grid (rebuilt on data change).
  private grid = new Map<string, NodeRec[]>();
  private gridCell = 32;

  // Drag state.
  private dragging = false;
  private dragMoved = false;
  private lastPointer = { x: 0, y: 0, t: 0 };

  private destroyed = false;
  private callbacks: CortexRendererCallbacks;
  private visibilityHandler = () => {
    if (document.hidden) this.app.ticker.stop();
    else this.app.ticker.start();
  };

  constructor(callbacks: CortexRendererCallbacks) {
    this.callbacks = callbacks;
  }

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: host,
      background: CORTEX_BG,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: 'webgl',
    });
    if (this.destroyed) { this.app.destroy(true); return; }
    host.appendChild(this.app.canvas);

    const textures = getCortexTextures();
    this.fx = new CortexFx(textures.halo, textures.spark);

    this.starfield = new TilingSprite({ texture: makeStarfieldTexture(), width: 4096, height: 4096 });
    this.starfield.alpha = 0.6;
    this.app.stage.addChild(this.starfield);

    this.world.addChild(this.nebulaLayer);
    this.world.addChild(this.edgeGraphics);
    this.world.addChild(this.fx.layer);
    this.world.addChild(this.nodeLayer);
    this.app.stage.addChild(this.world);

    this.camera.resize(this.app.screen.width, this.app.screen.height);
    this.attachInput();
    document.addEventListener('visibilitychange', this.visibilityHandler);
    this.app.ticker.add(() => this.tick(this.app.ticker.deltaMS / 1000));
  }

  // ── Data ────────────────────────────────────────────────────────────

  /** Replace the whole graph. When animate=true, existing nodes glide to new positions. */
  setGraph(nodes: CortexNode[], edges: CortexEdge[], opts: { animate?: boolean; fit?: boolean } = {}): void {
    const capped = nodes.slice(0, MAX_NODES);
    const ids = new Set(capped.map((n) => n.id));
    const keptEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target)).slice(0, MAX_EDGES);

    // Remove nodes that disappeared.
    for (const [id, rec] of this.nodes) {
      if (!ids.has(id)) {
        rec.halo.destroy();
        rec.core.destroy();
        this.nodes.delete(id);
      }
    }

    const textures = getCortexTextures();
    for (const n of capped) {
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      const existing = this.nodes.get(n.id);
      if (existing) {
        existing.fromX = existing.x; existing.fromY = existing.y;
        existing.toX = x; existing.toY = y;
        if (!opts.animate) { existing.x = x; existing.y = y; }
        existing.radius = nodeRadius(n);
        existing.accessCount = n.accessCount;
        existing.communityId = n.communityId;
        existing.label = n.label;
        continue;
      }
      const style = categoryStyle(n.category);
      const halo = new Sprite(textures.halo);
      halo.anchor.set(0.5);
      halo.blendMode = 'add';
      halo.tint = style.hex;
      const core = new Sprite(textures.core);
      core.anchor.set(0.5);
      core.tint = style.coreHex;
      this.nodeLayer.addChild(halo);
      this.nodeLayer.addChild(core);
      this.nodes.set(n.id, {
        id: n.id, x, y, fromX: x, fromY: y, toX: x, toY: y,
        radius: nodeRadius(n), style,
        communityId: n.communityId, label: n.label, accessCount: n.accessCount,
        phase: hash01(n.id, 7) * Math.PI * 2,
        breathSpeed: 0.6 + hash01(n.id, 13) * 0.5,
        halo, core, ignite: 0, spawn: 1, alpha: 1, alphaTarget: 1,
        neighbors: [],
      });
    }

    this.edges = keptEdges;
    this.rebuildEdgeIndex();
    this.rebuildNebulas();
    this.rebuildGrid();
    this.edgesDirty = true;

    if (opts.animate) this.relayoutT = 0;
    if (opts.fit) this.fitAll(false);
    this.applyFocusAlpha();
  }

  /** Incremental SSE events — bloom, link, ignite. No refetch. */
  applyEvents(events: BrainEvent[]): void {
    let structureChanged = false;
    const textures = getCortexTextures();

    for (const ev of events) {
      if (ev.event === 'NODE_CREATED') {
        if (this.nodes.has(ev.nodeId) || this.nodes.size >= MAX_NODES) continue;
        const style = categoryStyle(ev.category);
        const x = ev.x ?? 0;
        const y = ev.y ?? 0;
        const halo = new Sprite(textures.halo);
        halo.anchor.set(0.5);
        halo.blendMode = 'add';
        halo.tint = style.hex;
        const core = new Sprite(textures.core);
        core.anchor.set(0.5);
        core.tint = style.coreHex;
        this.nodeLayer.addChild(halo);
        this.nodeLayer.addChild(core);
        this.nodes.set(ev.nodeId, {
          id: ev.nodeId, x, y, fromX: x, fromY: y, toX: x, toY: y,
          radius: 3.6, style,
          communityId: ev.communityId ?? null, label: ev.label, accessCount: 0,
          phase: hash01(ev.nodeId, 7) * Math.PI * 2,
          breathSpeed: 0.6 + hash01(ev.nodeId, 13) * 0.5,
          halo, core, ignite: 0, spawn: 0, alpha: 1, alphaTarget: this.focusIds ? FOCUS_DIM_ALPHA : 1,
          neighbors: [],
        });
        this.fx.ripple(x, y, style.hex, 8, { duration: 1.2, intensity: 1.4 });
        structureChanged = true;
      } else if (ev.event === 'SYNAPSE_CONNECTED') {
        const a = this.nodes.get(ev.sourceId);
        const b = this.nodes.get(ev.targetId);
        if (!a || !b) continue;
        if (this.edges.length < MAX_EDGES) {
          this.edges.push({ id: `live-${this.edges.length}`, source: ev.sourceId, target: ev.targetId, type: ev.relationshipType, weight: ev.weight });
          structureChanged = true;
        }
        this.fx.signal(a.x, a.y, b.x, b.y, a.style.hex, { duration: 0.7, size: 6 });
      } else if (ev.event === 'NEURON_ACTIVATED') {
        for (const id of ev.nodeIds) {
          const rec = this.nodes.get(id);
          if (!rec) continue;
          rec.ignite = 1;
          this.fx.ripple(rec.x, rec.y, rec.style.hex, rec.radius, { intensity: ev.intensity });
          // Recall propagation: sparks race down this neuron's synapses.
          const connected = this.edgesByNode.get(id) ?? [];
          for (let i = 0; i < Math.min(connected.length, 6); i++) {
            const e = connected[i]!;
            const otherId = e.source === id ? e.target : e.source;
            const other = this.nodes.get(otherId);
            if (other) this.fx.signal(rec.x, rec.y, other.x, other.y, rec.style.hex);
          }
        }
      }
    }

    if (structureChanged) {
      this.rebuildEdgeIndex();
      this.rebuildGrid();
      this.edgesDirty = true;
    }
  }

  /** Focus mode: neighborhood stays lit, the rest of the cortex dims. */
  setFocus(nodeIds: string[] | null): void {
    this.focusIds = nodeIds && nodeIds.length > 0 ? new Set(nodeIds) : null;
    this.applyFocusAlpha();
    this.edgesDirty = true;
  }

  setSelected(nodeId: string | null): void {
    this.selectedId = nodeId;
  }

  igniteNode(nodeId: string): void {
    const rec = this.nodes.get(nodeId);
    if (!rec) return;
    rec.ignite = 1;
    this.fx.ripple(rec.x, rec.y, rec.style.hex, rec.radius, { intensity: 1.5 });
  }

  flyToNode(nodeId: string): void {
    const rec = this.nodes.get(nodeId);
    if (!rec) return;
    this.camera.flyTo(rec.x, rec.y, Math.max(this.camera.scale, 6));
  }

  fitAll(_ease = true): void {
    if (this.nodes.size === 0) return;
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const rec of this.nodes.values()) {
      if (rec.x < xmin) xmin = rec.x;
      if (rec.x > xmax) xmax = rec.x;
      if (rec.y < ymin) ymin = rec.y;
      if (rec.y > ymax) ymax = rec.y;
    }
    this.camera.fitBounds(xmin, ymin, xmax, ymax);
  }

  zoomIn(): void { this.camera.zoomCentered(1.5); }
  zoomOut(): void { this.camera.zoomCentered(1 / 1.5); }

  get nodeCount(): number { return this.nodes.size; }

  hasNode(nodeId: string): boolean { return this.nodes.has(nodeId); }

  destroy(): void {
    this.destroyed = true;
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    if (this.app.renderer) {
      this.app.destroy(true, { children: true, texture: false });
    }
    destroyCortexTextures();
    this.nodes.clear();
    this.grid.clear();
  }

  // ── Internals ───────────────────────────────────────────────────────

  private rebuildEdgeIndex(): void {
    this.edgesByNode.clear();
    for (const e of this.edges) {
      let a = this.edgesByNode.get(e.source);
      if (!a) { a = []; this.edgesByNode.set(e.source, a); }
      a.push(e);
      let b = this.edgesByNode.get(e.target);
      if (!b) { b = []; this.edgesByNode.set(e.target, b); }
      b.push(e);
    }
    for (const rec of this.nodes.values()) {
      rec.neighbors = (this.edgesByNode.get(rec.id) ?? [])
        .map((e) => (e.source === rec.id ? e.target : e.source));
    }
  }

  private rebuildNebulas(): void {
    this.nebulaLayer.removeChildren().forEach((c) => c.destroy());
    const groups = new Map<string, { xs: number; ys: number; n: number; maxR: number }>();
    for (const rec of this.nodes.values()) {
      if (!rec.communityId) continue;
      let g = groups.get(rec.communityId);
      if (!g) { g = { xs: 0, ys: 0, n: 0, maxR: 0 }; groups.set(rec.communityId, g); }
      g.xs += rec.toX; g.ys += rec.toY; g.n += 1;
    }
    // Spread pass — how wide each community sprawls.
    const spread = new Map<string, number>();
    for (const rec of this.nodes.values()) {
      if (!rec.communityId) continue;
      const g = groups.get(rec.communityId)!;
      const cx = g.xs / g.n, cy = g.ys / g.n;
      const d = Math.hypot(rec.toX - cx, rec.toY - cy);
      spread.set(rec.communityId, Math.max(spread.get(rec.communityId) ?? 0, d));
    }
    const textures = getCortexTextures();
    const sorted = [...groups.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 64);
    for (const [communityId, g] of sorted) {
      if (g.n < 3) continue;
      const sprite = new Sprite(textures.nebula) as Sprite & { __communityId?: string };
      sprite.anchor.set(0.5);
      sprite.blendMode = 'add';
      sprite.tint = communityTint(communityId);
      sprite.position.set(g.xs / g.n, g.ys / g.n);
      const r = Math.max(28, (spread.get(communityId) ?? 28) * 1.05);
      sprite.width = sprite.height = r * 2;
      sprite.alpha = 0.055;
      sprite.visible = true;
      sprite.__communityId = communityId;
      this.nebulaLayer.addChild(sprite);
    }
  }

  private rebuildGrid(): void {
    this.grid.clear();
    let xmin = Infinity, xmax = -Infinity;
    for (const rec of this.nodes.values()) {
      if (rec.toX < xmin) xmin = rec.toX;
      if (rec.toX > xmax) xmax = rec.toX;
    }
    this.gridCell = Math.max(16, (xmax - xmin) / 64 || 32);
    for (const rec of this.nodes.values()) {
      const key = `${Math.floor(rec.toX / this.gridCell)},${Math.floor(rec.toY / this.gridCell)}`;
      let cell = this.grid.get(key);
      if (!cell) { cell = []; this.grid.set(key, cell); }
      cell.push(rec);
    }
  }

  private pick(sx: number, sy: number): NodeRec | null {
    const w = this.camera.screenToWorld(sx, sy);
    const cx = Math.floor(w.x / this.gridCell);
    const cy = Math.floor(w.y / this.gridCell);
    let best: NodeRec | null = null;
    let bestD = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = this.grid.get(`${cx + dx},${cy + dy}`);
        if (!cell) continue;
        for (const rec of cell) {
          const d = Math.hypot(rec.x - w.x, rec.y - w.y);
          const hitRadius = rec.radius + 6 / this.camera.scale;
          if (d < hitRadius && d < bestD) { best = rec; bestD = d; }
        }
      }
    }
    return best;
  }

  private applyFocusAlpha(): void {
    for (const rec of this.nodes.values()) {
      rec.alphaTarget = !this.focusIds || this.focusIds.has(rec.id) ? 1 : FOCUS_DIM_ALPHA;
    }
    this.nebulaLayer.alpha = this.focusIds ? 0.25 : 1;
  }

  private attachInput(): void {
    const canvas = this.app.canvas;
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.dragMoved = false;
      this.lastPointer = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.camera.stop();
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (this.dragging) {
        const dx = e.clientX - this.lastPointer.x;
        const dy = e.clientY - this.lastPointer.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) this.dragMoved = true;
        this.camera.panBy(dx, dy);
        const now = performance.now();
        const dt = Math.max(1, now - this.lastPointer.t) / 1000;
        this.camera.setPanVelocity(dx / dt, dy / dt);
        this.lastPointer = { x: e.clientX, y: e.clientY, t: now };
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const hit = this.pick(e.clientX - rect.left, e.clientY - rect.top);
      const id = hit?.id ?? null;
      if (id !== this.hoveredId) {
        this.hoveredId = id;
        canvas.style.cursor = id ? 'pointer' : 'grab';
        this.callbacks.onHover(id);
      }
    });

    const endDrag = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      canvas.releasePointerCapture?.(e.pointerId);
      if (!this.dragMoved) {
        this.camera.stop();
        const rect = canvas.getBoundingClientRect();
        const hit = this.pick(e.clientX - rect.left, e.clientY - rect.top);
        this.callbacks.onSelect(hit?.id ?? null);
      }
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0016);
      this.camera.zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    }, { passive: false });
  }

  private tick(dt: number): void {
    this.time += dt;
    this.camera.resize(this.app.screen.width, this.app.screen.height);
    const moving = this.camera.update(dt);

    if (this.cameraWasMoving && !moving) {
      this.callbacks.onViewportSettled(this.camera.visibleBounds(0.4), this.camera.scale);
    }
    this.cameraWasMoving = moving;

    // World transform.
    this.world.scale.set(this.camera.scale);
    this.world.position.set(
      this.app.screen.width / 2 - this.camera.x * this.camera.scale,
      this.app.screen.height / 2 - this.camera.y * this.camera.scale,
    );

    // Starfield parallax (slow drift + camera-coupled offset).
    this.starfield.width = this.app.screen.width;
    this.starfield.height = this.app.screen.height;
    this.starfield.tilePosition.set(
      -this.camera.x * this.camera.scale * 0.12 + this.time * 1.2,
      -this.camera.y * this.camera.scale * 0.12,
    );

    // Re-layout position transition.
    if (this.relayoutT < 1) {
      this.relayoutT = Math.min(1, this.relayoutT + dt / RELAYOUT_TRANSITION_S);
      const t = this.relayoutT;
      const ease = t * t * (3 - 2 * t);
      for (const rec of this.nodes.values()) {
        rec.x = rec.fromX + (rec.toX - rec.fromX) * ease;
        rec.y = rec.fromY + (rec.toY - rec.fromY) * ease;
      }
      this.edgesDirty = true;
      if (this.relayoutT >= 1) { this.rebuildGrid(); this.rebuildNebulas(); }
    }

    // Glow is intentional, not ambient: idle nodes are crisp cores only.
    // Halos appear for selection / focus neighborhood / community highlight / firing.
    const selectedCommunity = this.selectedId
      ? (this.nodes.get(this.selectedId)?.communityId ?? null)
      : null;
    const focusEase = 1 - Math.exp(-8 * dt);
    for (const rec of this.nodes.values()) {
      if (rec.spawn < 1) rec.spawn = Math.min(1, rec.spawn + dt / 0.7);
      if (rec.ignite > 0) rec.ignite = Math.max(0, rec.ignite - dt / 1.1);
      rec.alpha += (rec.alphaTarget - rec.alpha) * focusEase;

      // Back-out overshoot on spawn (easeOutBack).
      const s = rec.spawn;
      const spawnScale = s >= 1 ? 1 : Math.max(0, 1 + 2.70158 * Math.pow(s - 1, 3) + 1.70158 * Math.pow(s - 1, 2));

      const breath = Math.sin(this.time * rec.breathSpeed + rec.phase);
      const igniteBoost = rec.ignite * rec.ignite;
      const isSelected = rec.id === this.selectedId;
      const isHovered = rec.id === this.hoveredId;
      const inFocus = !!this.focusIds && this.focusIds.has(rec.id);
      const inSelectedCommunity = !!selectedCommunity && rec.communityId === selectedCommunity;
      const highlight = isSelected || isHovered ? 1.3 : inFocus ? 1.12 : 1;

      // Subtle core breathing always; glow (halo) only on interaction / fire.
      let glow = 0;
      if (igniteBoost > 0) glow = 0.55 + 0.45 * igniteBoost;
      else if (isSelected) glow = 0.42;
      else if (isHovered) glow = 0.28;
      else if (inFocus) glow = 0.22;
      else if (inSelectedCommunity) glow = 0.14;

      const haloSize = rec.radius * (2.4 + 1.4 * glow) * (1 + 0.04 * breath * glow) * spawnScale * highlight;
      const coreSize = rec.radius * 2 * (1 + 0.025 * breath + 0.3 * igniteBoost) * spawnScale * highlight;

      rec.halo.position.set(rec.x, rec.y);
      rec.core.position.set(rec.x, rec.y);
      rec.halo.width = rec.halo.height = haloSize;
      rec.core.width = rec.core.height = coreSize;
      rec.halo.alpha = glow * rec.alpha * (s < 1 ? s : 1);
      rec.halo.visible = glow > 0.01;
      rec.core.alpha = (0.9 + 0.1 * igniteBoost) * rec.alpha * (s < 1 ? s : 1);
    }

    // Ambient nebula mist always on (subtle). Selected community breathes brighter.
    for (let i = 0; i < this.nebulaLayer.children.length; i++) {
      const sprite = this.nebulaLayer.children[i] as Sprite & { __communityId?: string };
      const isActive = !!selectedCommunity && sprite.__communityId === selectedCommunity;
      const base = selectedCommunity ? (isActive ? 0.12 : 0.02) : 0.055;
      const shimmer = (isActive ? 0.04 : 0.018) * Math.sin(this.time * 0.22 + i * 1.7);
      sprite.visible = true;
      sprite.alpha = (base + shimmer) * (this.focusIds && !isActive ? 0.45 : 1);
    }

    this.fx.update(dt);

    // Redraw edges when structure changed or zoom drifted enough to matter.
    const scaleDrift = Math.abs(this.camera.scale - this.edgeDrawScale) / (this.edgeDrawScale || 1);
    if (this.edgesDirty || scaleDrift > 0.1) {
      this.drawEdges();
      this.edgesDirty = false;
      this.edgeDrawScale = this.camera.scale;
    }
  }

  private drawEdges(): void {
    const g = this.edgeGraphics;
    g.clear();
    if (this.edges.length === 0) return;

    const focus = this.focusIds;
    // Three passes: dim (out of focus), normal, focus-highlight — one stroke per pass.
    for (let pass = 0; pass < 2; pass++) {
      let any = false;
      for (const e of this.edges) {
        const a = this.nodes.get(e.source);
        const b = this.nodes.get(e.target);
        if (!a || !b) continue;
        const inFocus = !focus || (focus.has(e.source) && focus.has(e.target));
        if ((pass === 1) !== (focus != null && inFocus)) continue;
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        any = true;
      }
      if (!any) continue;
      if (pass === 0) {
        // Edges scale down with zoom so they stay hairline-thin on screen.
        const w = Math.min(0.6, 1.1 / this.camera.scale);
        g.stroke({ width: w, color: 0x5a7ab8, alpha: focus ? 0.04 : 0.28 });
      } else {
        const w = Math.min(1.0, 1.6 / this.camera.scale);
        g.stroke({ width: w, color: 0x9fc0ff, alpha: 0.6 });
      }
    }
  }
}
