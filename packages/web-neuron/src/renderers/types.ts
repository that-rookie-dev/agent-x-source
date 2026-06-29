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

export type RendererId = 'force3d' | 'cosmograph';

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

  focusNode(id: string): void;
  fitToAll(): void;

  onNodeClick?(cb: (id: string) => void): void;
  onNodeDragEnd?(cb: (id: string, x: number, y: number, z: number) => void): void;
}

/** Layout constants shared between App and the adapters. */
export const LAYOUT_SCALE = 5;
export const RANDOM_SPREAD = 600; // matches the backend's ~[-200,200] * LAYOUT_SCALE
export const BASE_NODE_SIZE = 6;
export const FIRED_SIZE = 12;

export function resolvePosition(
  x: number | null | undefined,
  y: number | null | undefined,
): { x: number; y: number; z: number } {
  if (x == null || y == null || (x === 0 && y === 0)) {
    return {
      x: (Math.random() - 0.5) * RANDOM_SPREAD,
      y: (Math.random() - 0.5) * RANDOM_SPREAD,
      z: (Math.random() - 0.5) * RANDOM_SPREAD * 0.3,
    };
  }
  return {
    x: x * LAYOUT_SCALE,
    y: y * LAYOUT_SCALE,
    z: (Math.random() - 0.5) * 40, // small z-jitter so the graph isn't flat
  };
}
