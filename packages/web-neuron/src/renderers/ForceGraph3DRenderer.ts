// ForceGraph3D renderer — react-force-graph-3d (3d-force-graph + three.js).
//
// Matches the vasturiano "large-graph" example: 3D force-directed layout
// with d3-force-3d, auto-color by category, pure black background, small
// star-like nodes, thin faint constellation links, zoom/pan/orbit, node drag.
//
// react-force-graph-3d is a React component, so this adapter creates a
// React root inside the container element and renders the component there.

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ForceGraph3D, { type ForceGraphMethods, type GraphData } from 'react-force-graph-3d';
import {
  type GraphRenderer,
  type RenderEdge,
  type RenderNode,
  type RendererId,
} from './types.ts';

interface FGNode {
  id: string;
  name: string;
  category: string;
  sessionId?: string | null;
  val: number;
  color: string;
  x?: number;
  y?: number;
  z?: number;
}

interface FGLink {
  source: string;
  target: string;
  color: string;
  width: number;
}

export class ForceGraph3DRenderer implements GraphRenderer {
  readonly id: RendererId = 'force3d';
  readonly label = 'FORCE3D';

  private root: Root | null = null;
  private fgRef: { current: ForceGraphMethods | undefined } = { current: undefined };

  private nodes: RenderNode[] = [];
  private edges: RenderEdge[] = [];

  private clickCb: ((id: string) => void) | null = null;
  private dragEndCb: ((id: string, x: number, y: number, z: number) => void) | null = null;

  mount(container: HTMLElement): void {
    if (this.root) return;
    this.root = createRoot(container);
    this.renderGraph();
  }

  destroy(): void {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }

  resize(): void {
    // react-force-graph-3d auto-resizes to container dimensions.
  }

  setData(nodes: RenderNode[], edges: RenderEdge[]): void {
    this.nodes = nodes;
    this.edges = edges;
    this.renderGraph();
    this.applyForceTuning();
  }

  private buildGraphData(): GraphData<FGNode, FGLink> {
    const fgNodes: FGNode[] = this.nodes.map((n) => ({
      id: n.id,
      name: n.label,
      category: n.category,
      sessionId: n.sessionId,
      // val controls node size in react-force-graph-3d; scale up for visibility
      val: n.size * 0.8,
      color: n.color,
      x: n.x,
      y: n.y,
      z: n.z,
    }));

    const fgLinks: FGLink[] = this.edges.map((e) => ({
      source: e.source,
      target: e.target,
      color: e.color,
      width: e.width,
    }));

    return { nodes: fgNodes, links: fgLinks };
  }

  private renderGraph(): void {
    if (!this.root) return;
    const graphData = this.buildGraphData();

    this.root.render(
      React.createElement(ForceGraph3D, {
        graphData,
        nodeId: 'id',
        linkSource: 'source',
        linkTarget: 'target',

        // Pure black background — matches the large-graph example's void
        backgroundColor: '#000000',

        // Node styling — small, slightly transparent for a star-like glow
        nodeRelSize: 4,
        nodeColor: 'color',
        nodeLabel: 'name',
        nodeOpacity: 0.75,

        // Link styling — thin, faint constellation lines (no flowing particles)
        linkColor: 'color',
        linkWidth: 'width',
        linkOpacity: 0.3,
        linkDirectionalParticles: 0,

        // Controls
        showNavInfo: false,
        enableNodeDrag: true,
        enablePointerInteraction: true,

        // Force simulation — let it run naturally for wide, organic clustering
        d3AlphaDecay: 0.0228,
        d3VelocityDecay: 0.4,

        // Event handlers
        onNodeClick: (node: any) => {
          if (this.clickCb && node.id) this.clickCb(node.id as string);
        },
        onNodeDragEnd: (node: any) => {
          if (this.dragEndCb && node.id) {
            this.dragEndCb(
              node.id as string,
              node.x ?? 0,
              node.y ?? 0,
              node.z ?? 0,
            );
          }
        },

        // Ref to access imperative API (zoomToFit, cameraPosition, force tuning)
        ref: this.fgRef,
      }),
    );
  }

  /** Tune d3-force parameters for a spacious, universe-like spread. */
  private applyForceTuning(): void {
    const fg = this.fgRef.current;
    if (!fg) return;
    // Wider charge repulsion — nodes drift apart like stars in space
    const charge = (fg as any).d3Force('charge');
    if (charge) charge.strength(-30);
    // Shorter link distance — tighter constellation clusters
    const link = (fg as any).d3Force('link');
    if (link) link.distance(30);
    // Reheat so the new forces take effect
    (fg as any).d3ReheatSimulation();
  }

  emitParticle(_edgeId: string): void {
    // react-force-graph-3d handles particles automatically via linkDirectionalParticles.
    // For on-demand emission, we'd need to find the link object and call emitParticle.
    // Best-effort: no-op since particles are already flowing.
  }

  emitFromNode(_nodeId: string, _max?: number): void {
    // Same as above — particles are continuous, no need for manual emission.
  }

  pulseNode(nodeId: string, _durationMs?: number): void {
    // Highlight a node by briefly increasing its val. We do this by
    // patching the node in graphData and refreshing.
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    // Simple approach: re-render with a size boost for the pulsed node
    // (react-force-graph-3d will animate the transition)
    const originalSize = node.size;
    node.size = originalSize * 2.5;
    this.renderGraph();
    setTimeout(() => {
      node.size = originalSize;
      this.renderGraph();
    }, 800);
  }

  pulseCluster(nodeIds: string[], durationMs = 1500): void {
    const originals = new Map<string, number>();
    for (const id of nodeIds) {
      const node = this.nodes.find((n) => n.id === id);
      if (node) {
        originals.set(id, node.size);
        node.size = node.size * 2;
      }
    }
    this.renderGraph();
    setTimeout(() => {
      for (const [id, size] of originals) {
        const node = this.nodes.find((n) => n.id === id);
        if (node) node.size = size;
      }
      this.renderGraph();
    }, durationMs);
  }

  animateDecay(_nodeId: string): void {
    // No-op — react-force-graph-3d doesn't have a built-in decay animation.
  }

  focusNode(id: string): void {
    const fg = this.fgRef.current;
    if (!fg) return;
    const node = this.nodes.find((n) => n.id === id);
    if (!node) return;
    (fg as any).cameraPosition(
      { x: node.x ?? 0, y: node.y ?? 0, z: (node.z ?? 0) + 200 },
      { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 },
      800,
    );
  }

  fitToAll(): void {
    const fg = this.fgRef.current;
    if (!fg) return;
    (fg as any).zoomToFit(800, 60);
  }

  onNodeClick(cb: (id: string) => void): void {
    this.clickCb = cb;
  }

  onNodeDragEnd(cb: (id: string, x: number, y: number, z: number) => void): void {
    this.dragEndCb = cb;
  }
}
