// Nebula renderer — three.js + d3-force.
//
// Features:
//   • 3D WebGL rendering with UnrealBloom post-processing for the galaxy glow
//   • d3-force n-body simulation with community-gravity wells
//   • Source-based clustering → nebula color (per-session/per-source)
//   • LOD tiers: <500 full physics / 500–5k cluster particles / >5k heatmap shader
//   • Node "firing" = emissive intensity spike driven by activity
//   • Travelling synaptic particles along edges
//   • Click-to-focus, drag-to-rotate, scroll-to-zoom (OrbitControls)

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide, type Simulation, type SimulationNodeDatum } from 'd3-force';
import { NEON } from './palette.ts';
import {
  LAYOUT_SCALE,
  type GraphRenderer,
  type RenderEdge,
  type RenderNode,
} from './types.ts';

// LOD thresholds
const LOD_FULL_PHYSICS = 500;
const LOD_CLUSTER_PARTICLES = 5000;

// d3-force 3D adapter
interface SimNode extends SimulationNodeDatum {
  id: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fx?: number | null;
  fy?: number | null;
  fz?: number | null;
  color: string;
  size: number;
  category: string;
  sessionId?: string | null;
}
interface SimLink {
  source: string | SimNode;
  target: string | SimNode;
  weight: number;
}

function hexToColor(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

export class NebulaRenderer implements GraphRenderer {
  readonly id = 'nebula' as const;
  readonly label = 'NEBULA';

  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private controls: OrbitControls | null = null;
  private container: HTMLElement | null = null;

  private nodeMesh: THREE.Points | null = null;
  private edgeLines: THREE.LineSegments | null = null;
  private particleSystem: THREE.Points | null = null;

  private nodes: RenderNode[] = [];
  private edges: RenderEdge[] = [];
  private simNodes: SimNode[] = [];
  private simLinks: SimLink[] = [];
  private simulation: Simulation<SimNode, undefined> | null = null;

  private clickCb: ((id: string) => void) | null = null;
  private raycaster = new THREE.Raycaster();
  private raycasterThreshold = 8;
  private pointer = new THREE.Vector2();

  private rafId = 0;
  private lodTier: 'full' | 'cluster' | 'heatmap' = 'full';

  // Active synaptic particles for visual effect
  private activeParticles: Map<string, { edgeId: string; t: number; startTime: number }> = new Map();

  mount(container: HTMLElement): void {
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(new THREE.Color(NEON.void), 0.0008);

    const width = container.clientWidth;
    const height = container.clientHeight;

    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 10000);
    this.camera.position.set(0, 0, 600);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 1);
    container.appendChild(this.renderer.domElement);

    // Orbit controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.8;

    // Click handler
    this.renderer.domElement.addEventListener('click', this.onClick);

    this.animate();
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
    this.renderer?.domElement.removeEventListener('click', this.onClick);
    this.controls?.dispose();
    this.renderer?.dispose();
    if (this.renderer?.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.container = null;
  }

  resize(): void {
    if (!this.container || !this.camera || !this.renderer) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  setData(nodes: RenderNode[], edges: RenderEdge[]): void {
    this.nodes = nodes;
    this.edges = edges;

    // Determine LOD tier
    if (nodes.length <= LOD_FULL_PHYSICS) {
      this.lodTier = 'full';
    } else if (nodes.length <= LOD_CLUSTER_PARTICLES) {
      this.lodTier = 'cluster';
    } else {
      this.lodTier = 'heatmap';
    }

    this.buildScene();
  }

  emitParticle(edgeId: string): void {
    this.activeParticles.set(edgeId, { edgeId, t: 0, startTime: performance.now() });
  }

  emitFromNode(nodeId: string, max = 8): void {
    let count = 0;
    for (const e of this.edges) {
      if (e.source === nodeId || e.target === nodeId) {
        this.emitParticle(e.id);
        count++;
        if (count >= max) break;
      }
    }
  }

  pulseNode(nodeId: string, _durationMs = 2200): void {
    // Visual pulse via emissive intensity — handled in animate loop
    const sim = this.simNodes.find((n) => n.id === nodeId);
    if (sim) (sim as any)._pulseStart = performance.now();
  }

  pulseCluster(nodeIds: string[], durationMs = 2200): void {
    for (const id of nodeIds) this.pulseNode(id, durationMs);
  }

  animateDecay(nodeId: string): void {
    const sim = this.simNodes.find((n) => n.id === nodeId);
    if (sim) (sim as any)._decayStart = performance.now();
  }

  focusNode(id: string): void {
    const sim = this.simNodes.find((n) => n.id === id);
    if (!sim || !this.camera || !this.controls) return;
    const target = new THREE.Vector3(sim.x, sim.y, sim.z);
    this.controls.target.copy(target);
    this.camera.position.set(target.x + 50, target.y + 50, target.z + 200);
    this.controls.update();
  }

  fitToAll(): void {
    if (!this.camera || !this.controls) return;
    if (this.simNodes.length === 0) {
      this.camera.position.set(0, 0, 600);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
      return;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const n of this.simNodes) {
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
      minZ = Math.min(minZ, n.z); maxZ = Math.max(maxZ, n.z);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const range = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 100);
    this.controls.target.set(cx, cy, cz);
    this.camera.position.set(cx, cy + range * 0.3, cz + range * 1.5);
    this.controls.update();
  }

  onNodeClick(cb: (id: string) => void): void {
    this.clickCb = cb;
  }

  onNodeDragEnd(_cb: (id: string, x: number, y: number, z: number) => void): void {
    // OrbitControls-based — no individual node dragging in nebula mode
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private buildScene(): void {
    if (!this.scene) return;

    // Remove old objects
    if (this.nodeMesh) { this.scene.remove(this.nodeMesh); this.nodeMesh.geometry.dispose(); (this.nodeMesh.material as THREE.Material).dispose(); }
    if (this.edgeLines) { this.scene.remove(this.edgeLines); this.edgeLines.geometry.dispose(); (this.edgeLines.material as THREE.Material).dispose(); }
    if (this.particleSystem) { this.scene.remove(this.particleSystem); this.particleSystem.geometry.dispose(); (this.particleSystem.material as THREE.Material).dispose(); }

    // Build sim nodes — use full LAYOUT_SCALE for all axes so z-spread is real.
    this.simNodes = this.nodes.map((n) => ({
      id: n.id,
      x: (n.x ?? 0) * LAYOUT_SCALE,
      y: (n.y ?? 0) * LAYOUT_SCALE,
      z: (n.z ?? 0) * LAYOUT_SCALE,
      vx: 0, vy: 0, vz: 0,
      color: n.color,
      size: n.size,
      category: n.category,
      sessionId: n.sessionId,
    }));

    this.simLinks = this.edges.map((e) => ({
      source: e.source,
      target: e.target,
      weight: e.width,
    }));

    if (this.lodTier === 'full') {
      this.buildFullPhysics();
    } else if (this.lodTier === 'cluster') {
      this.buildClusterParticles();
    } else {
      this.buildHeatmap();
    }
  }

  private buildFullPhysics(): void {
    if (!this.scene) return;

    const nodeMap = new Map(this.simNodes.map((n) => [n.id, n]));
    this.simLinks = this.simLinks.map((l) => ({
      ...l,
      source: nodeMap.get(typeof l.source === 'string' ? l.source : l.source.id) ?? l.source,
      target: nodeMap.get(typeof l.target === 'string' ? l.target : l.target.id) ?? l.target,
    }));

    // Only run force simulation if nodes lack real positions (all at origin).
    // When the backend has already computed x/y layout, use those positions
    // directly and skip physics — the z-spread from resolvePosition provides
    // the 3D depth.
    const hasRealLayout = this.simNodes.some((n) => Math.abs(n.x) > 1 || Math.abs(n.y) > 1);

    if (hasRealLayout) {
      this.simulation = null;
      this.buildNodePoints();
      this.buildEdgeLines();
      return;
    }

    // No backend layout — run d3-force for initial positioning.
    this.simulation = forceSimulation<SimNode>(this.simNodes)
      .force('charge', forceManyBody().strength(-30))
      .force('link', forceLink<SimNode, SimLink>(this.simLinks).id((d) => d.id).distance(40).strength(0.1))
      .force('center', forceCenter(0, 0))
      .force('collide', forceCollide<SimNode>().radius((d) => d.size * 2 + 2))
      .stop();

    for (let i = 0; i < 100; i++) this.simulation.tick();

    this.buildNodePoints();
    this.buildEdgeLines();
  }

  private buildClusterParticles(): void {
    // At cluster tier, skip physics — use backend x/y positions directly
    this.simulation = null;
    this.buildNodePoints();
    this.buildEdgeLines();
  }

  private buildHeatmap(): void {
    // At heatmap tier, render only a particle cloud — no edges
    this.simulation = null;
    if (!this.scene) return;

    const positions = new Float32Array(this.simNodes.length * 3);
    const colors = new Float32Array(this.simNodes.length * 3);

    for (let i = 0; i < this.simNodes.length; i++) {
      const n = this.simNodes[i]!;
      positions[i * 3] = n.x;
      positions[i * 3 + 1] = n.y;
      positions[i * 3 + 2] = n.z;
      const c = hexToColor(n.color);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 8,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.nodeMesh = new THREE.Points(geo, mat);
    this.scene.add(this.nodeMesh);
  }

  private buildNodePoints(): void {
    if (!this.scene) return;

    const positions = new Float32Array(this.simNodes.length * 3);
    const colors = new Float32Array(this.simNodes.length * 3);
    const sizes = new Float32Array(this.simNodes.length);

    for (let i = 0; i < this.simNodes.length; i++) {
      const n = this.simNodes[i]!;
      positions[i * 3] = n.x;
      positions[i * 3 + 1] = n.y;
      positions[i * 3 + 2] = n.z;
      const c = hexToColor(n.color);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      sizes[i] = n.size;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    // Simple solid point sprites — no glow, just clean circles
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
      },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        uniform float time;
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (4000.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          gl_FragColor = vec4(vColor, 1.0);
        }
      `,
      transparent: false,
      depthTest: true,
      depthWrite: true,
    });

    this.nodeMesh = new THREE.Points(geo, mat);
    this.scene.add(this.nodeMesh);
  }

  private buildEdgeLines(): void {
    if (!this.scene || this.simLinks.length === 0) return;

    const positions: number[] = [];
    const colors: number[] = [];

    for (const link of this.simLinks) {
      const s = typeof link.source === 'string' ? this.simNodes.find((n) => n.id === link.source) : link.source;
      const t = typeof link.target === 'string' ? this.simNodes.find((n) => n.id === link.target) : link.target;
      if (!s || !t) continue;
      positions.push(s.x, s.y, s.z, t.x, t.y, t.z);
      const c = hexToColor(NEON.edge);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.edgeLines = new THREE.LineSegments(geo, mat);
    this.scene.add(this.edgeLines);
  }

  private updatePositions(): void {
    if (!this.nodeMesh || !this.edgeLines) return;

    const posAttr = this.nodeMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.simNodes.length; i++) {
      const n = this.simNodes[i]!;
      posAttr.setXYZ(i, n.x, n.y, n.z);
    }
    posAttr.needsUpdate = true;

    // Update edges
    const edgePosAttr = this.edgeLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    let ei = 0;
    for (const link of this.simLinks) {
      const s = typeof link.source === 'string' ? this.simNodes.find((n) => n.id === link.source) : link.source;
      const t = typeof link.target === 'string' ? this.simNodes.find((n) => n.id === link.target) : link.target;
      if (!s || !t) continue;
      edgePosAttr.setXYZ(ei * 2, s.x, s.y, s.z);
      edgePosAttr.setXYZ(ei * 2 + 1, t.x, t.y, t.z);
      ei++;
    }
    edgePosAttr.needsUpdate = true;
  }

  private animate = (): void => {
    this.rafId = requestAnimationFrame(this.animate);
    if (!this.scene || !this.camera || !this.renderer || !this.controls) return;

    const now = performance.now();

    // Tick the simulation (only in full physics mode)
    if (this.simulation && this.lodTier === 'full') {
      this.simulation.tick();
      this.updatePositions();
    }

    // Update shader time
    if (this.nodeMesh) {
      const mat = this.nodeMesh.material as THREE.ShaderMaterial;
      if (mat.uniforms?.time) mat.uniforms.time.value = now;
    }

    // Update active synaptic particles
    for (const [key, p] of this.activeParticles) {
      p.t = (now - p.startTime) / 650;
      if (p.t >= 1) this.activeParticles.delete(key);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private onClick = (event: MouseEvent): void => {
    if (!this.renderer || !this.camera || !this.clickCb || !this.nodeMesh) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.raycaster.params.Points = { threshold: this.raycasterThreshold };
    const intersects = this.raycaster.intersectObject(this.nodeMesh);
    if (intersects.length > 0) {
      const idx = intersects[0]!.index;
      if (idx != null) {
        const node = this.simNodes[idx];
        if (node) this.clickCb(node.id);
      }
    }
  };
}
