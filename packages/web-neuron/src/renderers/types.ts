// Renderer-agnostic graph data model + adapter interface.
// App.tsx talks only to `GraphRenderer`; each concrete adapter wraps a
// specific visualization library (3d-force-graph, Cosmograph, …) and is
// swappable at runtime via the bottom-footer switcher.
//
// App is the single source of truth for nodes/edges + transient size/colour
// overrides (fired neurons, flashed synapses). It bakes those overrides into
// RenderNode/RenderEdge and hands them to setData(). Each adapter then either
// applies the data immediately (force3d) or debounces a re-sync (Cosmograph).

export interface NodeEntry {
  id: string;
  label: string;
  category: string;
  content: string;
  sourceId: string | null;
  sessionId: string | null;
  x: number | undefined;
  y: number | undefined;
  z: number | undefined;
  baseColor: string;
  baseSize: number;
}

export interface EdgeEntry {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  weight: number;
  baseColor: string;
  baseWidth: number;
}

/** Render-ready node: App has already applied size/colour overrides. */
export interface RenderNode {
  id: string;
  label: string;
  category: string;
  sessionId?: string | null;
  x: number | undefined;
  y: number | undefined;
  z: number | undefined;
  color: string;
  size: number;
}

/** Render-ready edge: App has already applied colour/width overrides. */
export interface RenderEdge {
  id: string;
  source: string;
  target: string;
  color: string;
  width: number;
}

export type RendererId = 'sigma' | 'nebula' | 'force3d';

/**
 * Every renderer adapter implements this. Methods are best-effort: adapters
 * that lack a capability (e.g. travelling particles) implement it as a no-op
 * so the App's event flow never branches on renderer type.
 */
export interface GraphRenderer {
  readonly id: RendererId;
  /** Human-readable label for the footer switcher. */
  readonly label: string;

  mount(container: HTMLElement): Promise<void> | void;
  destroy(): Promise<void> | void;
  resize(): void;

  /** Full sync of the render-ready visible dataset. */
  setData(nodes: RenderNode[], edges: RenderEdge[]): void;

  /** Fire a travelling "synaptic signal" particle down one edge. No-op if unsupported. */
  emitParticle(edgeId: string): void;
  /** Fire signals outward through every synapse touching a node. No-op if unsupported. */
  emitFromNode(nodeId: string, max?: number): void;

  /** Blink a node and its neighbours for ~2 s (e.g. on focus / read). */
  pulseNode?(nodeId: string, durationMs?: number): void;
  pulseCluster?(nodeIds: string[], durationMs?: number): void;
  animateDecay?(nodeId: string): void;

  focusNode(id: string): void;
  fitToAll(): void;

  onNodeClick?(cb: (id: string) => void): void;
  onNodeDragEnd?(cb: (id: string, x: number, y: number, z: number) => void): void;
}

/** Layout constants shared between App and the adapters. */
export const LAYOUT_SCALE = 5;
export const RANDOM_SPREAD = 600; // matches the backend's ~[-200,200] * LAYOUT_SCALE
export const BASE_NODE_SIZE = 8;
export const FIRED_SIZE = 16;
/** Synapse thickness in screen pixels at default zoom (thin for dense graphs). */
export const EDGE_WIDTH = 0.72;

export function resolvePosition(
  x: number | null | undefined,
  y: number | null | undefined,
): { x: number; y: number; z: number } {
  if (x == null || y == null || (x === 0 && y === 0)) {
    return {
      x: (Math.random() - 0.5) * RANDOM_SPREAD,
      y: (Math.random() - 0.5) * RANDOM_SPREAD,
      z: (Math.random() - 0.5) * RANDOM_SPREAD * 0.5,
    };
  }
  // Spread z across a meaningful range so the nebula renderer has true 3D depth.
  // Use a hash of x+y so the same node always gets the same z (stable across refreshes).
  const hash = Math.sin(x! * 12.9898 + y! * 78.233) * 43758.5453;
  const zUnit = (hash - Math.floor(hash)) - 0.5; // -0.5 to 0.5
  return {
    x: x * LAYOUT_SCALE,
    y: y * LAYOUT_SCALE,
    z: zUnit * RANDOM_SPREAD * 0.5, // ±150 units — real depth
  };
}
