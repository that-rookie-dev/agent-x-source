// 3d-force-graph adapter — the default, always-available renderer.
// This is a faithful extraction of the original web-neuron graph logic:
// self-illuminated holographic nodes, UnrealBloom post-processing, ambient +
// rim lighting, slow cinematic auto-rotation, and event-driven travelling
// synaptic particles. Behaviour is intentionally identical to the pre-refactor
// implementation.
import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { NEON } from './palette.ts';
import { BASE_NODE_SIZE, type GraphRenderer, type RenderEdge, type RenderNode } from './types.ts';

// Shared low-poly sphere reused by every node mesh (one geometry for the whole graph).
const SHARED_NODE_GEOMETRY = new THREE.SphereGeometry(1, 16, 16);
// Cache one MeshBasicMaterial per colour so we don't allocate thousands of materials.
const NODE_MATERIAL_CACHE = new Map<string, THREE.MeshBasicMaterial>();
function getNodeMaterial(color: string): THREE.MeshBasicMaterial {
  let mat = NODE_MATERIAL_CACHE.get(color);
  if (!mat) {
    // Opaque + self-illuminated so nodes are always visible and survive into bloom.
    mat = new THREE.MeshBasicMaterial({ color });
    NODE_MATERIAL_CACHE.set(color, mat);
  }
  return mat;
}

export class ForceGraph3DRenderer implements GraphRenderer {
  readonly id = 'force3d' as const;
  readonly label = 'FORCE-3D';

  private graph: any = null;
  private bloom: UnrealBloomPass | null = null;
  private onResize = () => this.handleResize();

  // Last rendered data, kept for focusNode + emitFromNode lookups.
  private nodePos = new Map<string, { x: number; y: number; z: number }>();
  private linkRefs: any[] = [];

  private clickCb: ((id: string) => void) | null = null;
  private dragEndCb: ((id: string, x: number, y: number, z: number) => void) | null = null;

  mount(container: HTMLElement): void {
    if (this.graph) return;

    // @ts-ignore - 3d-force-graph type definitions are incomplete
    const g = ForceGraph3D()(container);
    g.backgroundColor(NEON.void)
      .showNavInfo(false)
      // Self-illuminated holographic nodes (MeshBasicMaterial ignores lighting, so the
      // exact neon colour survives into the bloom pass and glows reliably).
      .nodeThreeObject((n: any) => {
        const color = n.color || NEON.cyan;
        const mat = getNodeMaterial(color);
        const mesh = new THREE.Mesh(SHARED_NODE_GEOMETRY, mat);
        // Use the raw val as the sphere radius — with BASE_NODE_SIZE=6 this
        // gives clearly visible nodes in a ~1000-unit coordinate space.
        const r = Math.max(0.5, n.val ?? BASE_NODE_SIZE);
        mesh.scale.setScalar(r);
        return mesh;
      })
      .nodeLabel(
        (n: any) =>
          `<div style="font-family:'JetBrains Mono',monospace;color:${NEON.cyan};background:rgba(2,6,15,.85);border:1px solid rgba(125,249,255,.4);padding:3px 7px;border-radius:3px;font-size:11px;letter-spacing:.5px">${n.label ?? ''}</div>`,
      )
      .linkColor((l: any) => l.color)
      .linkWidth((l: any) => Math.max(0.5, l.val ?? 1))
      .linkOpacity(0.85)
      // Travelling synaptic signals — colour/size set here, count stays 0 until we
      // explicitly emitParticle() on activity (keeps it smooth at scale).
      .linkDirectionalParticles(0)
      .linkDirectionalParticleColor(() => NEON.brightCyan)
      .linkDirectionalParticleWidth(2.2)
      .linkDirectionalParticleSpeed(0.012)
      .onNodeClick((n: any) => {
        if (this.clickCb) this.clickCb(n.id);
      })
      .onNodeDragEnd((n: any) => {
        if (this.dragEndCb) this.dragEndCb(n.id, n.x, n.y, n.z);
      });

    g.cooldownTicks(0).d3AlphaMin(0.1).onEngineStop(() => this.fitToAll());

    this.graph = g;

    // --- Bloom post-processing -------------------------------------------
    // UnrealBloom turns every bright neon node/edge into a glowing energy core.
    // NOTE: an OutputPass MUST follow the bloom pass — without it the composer
    // outputs linear colour (three r152+) and the whole scene renders near-black.
    try {
      const renderer = g.renderer();
      const size = new THREE.Vector2(
        renderer?.domElement?.clientWidth || window.innerWidth,
        renderer?.domElement?.clientHeight || window.innerHeight,
      );
      const bloom = new UnrealBloomPass(size, 0.7, 0.5, 0.25);
      this.bloom = bloom;
      const composer = g.postProcessingComposer();
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
    } catch {
      // Bloom is a visual enhancement only — never let it break the graph.
    }

    // Subtle ambient + rim lighting so any lit materials still read against the void.
    // (No scene fog — at this coordinate scale exponential fog hides the entire graph.)
    try {
      const scene = g.scene();
      scene.add(new THREE.AmbientLight(0x335577, 1.4));
      const rim = new THREE.DirectionalLight(0x66ccff, 0.8);
      rim.position.set(1, 1, 1);
      scene.add(rim);
    } catch {
      // ignore
    }

    // Disable rotation on drag for better control
    g.onNodeDrag(() => {
      g.controls().autoRotate = false;
    });

    // Slow cinematic auto-rotation when idle (NEON "scanning" feel).
    try {
      const controls = g.controls();
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.35;
    } catch {
      // ignore
    }

    window.addEventListener('resize', this.onResize);
  }

  async destroy(): Promise<void> {
    window.removeEventListener('resize', this.onResize);
    if (this.graph) {
      try {
        this.graph._destructor();
      } catch {
        // ignore
      }
    }
    this.graph = null;
    this.bloom = null;
    this.nodePos.clear();
    this.linkRefs = [];
  }

  resize(): void {
    this.handleResize();
  }

  private handleResize(): void {
    const r = this.graph?.renderer?.();
    if (r && this.bloom) {
      this.bloom.setSize(r.domElement.clientWidth, r.domElement.clientHeight);
    }
  }

  // --- Data sync ----------------------------------------------------------

  setData(nodes: RenderNode[], edges: RenderEdge[]): void {
    if (!this.graph) return;

    this.nodePos = new Map(
      nodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0, z: n.z ?? 0 }]),
    );

    const graphData = {
      nodes: nodes.map((n) => ({
        id: n.id,
        label: n.label,
        category: n.category,
        x: n.x,
        y: n.y,
        z: n.z,
        fx: n.x ?? undefined,
        fy: n.y ?? undefined,
        fz: n.z ?? undefined,
        val: n.size,
        color: n.color,
      })),
      links: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        val: e.width,
        color: e.color,
      })),
    };

    this.graph.graphData(graphData);
    // Cache link refs (resolved objects) for particle emission after the graph
    // has materialised them.
    this.linkRefs = this.graph.graphData().links as any[];
  }

  // --- Particles ----------------------------------------------------------

  emitParticle(edgeId: string): void {
    if (!this.graph) return;
    const link = this.linkRefs.find((l) => l.id === edgeId);
    if (link) this.graph.emitParticle(link);
  }

  emitFromNode(nodeId: string, max = 6): void {
    if (!this.graph) return;
    const links = this.linkRefs.filter((l) => {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      return s === nodeId || t === nodeId;
    });
    links.slice(0, max).forEach((l) => this.graph.emitParticle(l));
  }

  // --- Camera -------------------------------------------------------------

  focusNode(id: string): void {
    if (!this.graph) return;
    const pos = this.nodePos.get(id);
    if (!pos) return;
    this.graph.cameraPosition({ x: pos.x, y: pos.y, z: pos.z }, pos);
  }

  fitToAll(): void {
    if (!this.graph) return;
    // Allow a short delay for the graph to settle on fixed positions before fitting.
    setTimeout(() => this.graph.zoomToFit(400, 1.6), 50);
  }

  // --- Callbacks ----------------------------------------------------------

  onNodeClick(cb: (id: string) => void): void {
    this.clickCb = cb;
  }

  onNodeDragEnd(cb: (id: string, x: number, y: number, z: number) => void): void {
    this.dragEndCb = cb;
  }
}
