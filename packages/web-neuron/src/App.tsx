import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type SessionInfo } from './api.ts';
import {
  BASE_NODE_SIZE,
  FIRED_SIZE,
  resolvePosition,
  type EdgeEntry,
  type NodeEntry,
  type RenderEdge,
  type RenderNode,
  type GraphRenderer,
  type RendererId,
} from './renderers/types.ts';
import { CATEGORY_COLORS, CATEGORY_NAMES, NEON } from './renderers/palette.ts';
import {
  createRenderer,
  listRenderers,
  resolveRendererId,
  DEFAULT_RENDERER_ID,
  type RendererDescriptor,
} from './renderers/index.ts';
import { getCapabilities, type CapabilityReport } from './renderers/capability.ts';
import { RendererSwitcher, FOOTER_HEIGHT } from './components/RendererSwitcher.tsx';

const WS_URL = (import.meta.env.VITE_API_WS_URL as string) || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;

const PANEL_WIDTH = 300;
const LS_RENDERER_KEY = 'agx:renderer';

type BrainActivityEvent =
  | { type: 'neuron_created'; nodeId: string; label: string; category: string; content: string; x: number | null; y: number | null; timestamp: string }
  | { type: 'synapse_bound'; edgeId: string; sourceNodeId: string; targetNodeId: string; relationshipType: string; weight: number; timestamp: string }
  | { type: 'neuron_fired'; nodeId: string; timestamp: string }
  | { type: 'neuron_decayed'; nodeId: string; status: string; timestamp: string }
  | { type: 'cluster_layout_updated'; epoch: number; count: number; timestamp: string }
  | { type: 'distillation_started'; sessionId: string; timestamp: string }
  | { type: 'distillation_complete'; sessionId: string; nodesCreated: number; edgesCreated: number; timestamp: string }
  | { type: 'distillation_error'; sessionId: string; error: string; timestamp: string };

function useWebSocket(onEvent: (event: BrainActivityEvent) => void) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let ws: WebSocket | null = new WebSocket(WS_URL);
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => console.log('web-neuron ws connected');
      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data.type === 'brain_activity' && data.event) {
            onEventRef.current(data.event as BrainActivityEvent);
          } else if (data.type === 'brain_activity_batch' && Array.isArray(data.events)) {
            for (const event of data.events as BrainActivityEvent[]) {
              onEventRef.current(event);
            }
          }
        } catch {
          // ignore malformed
        }
      };
      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      ws = null;
    };
  }, []);
}

export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<GraphRenderer | null>(null);

  const nodesRef = useRef<NodeEntry[]>([]);
  const edgesRef = useRef<EdgeEntry[]>([]);
  const idToNodeRef = useRef<Map<string, NodeEntry>>(new Map());
  const nodeSizeMapRef = useRef<Map<string, number>>(new Map());
  const nodeColorMapRef = useRef<Map<string, string>>(new Map());
  const edgeColorMapRef = useRef<Map<string, string>>(new Map());
  const edgeWidthMapRef = useRef<Map<string, number>>(new Map());

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [booting, setBooting] = useState(true);
  const [fps, setFps] = useState(60);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());
  const [nodeListOpen, setNodeListOpen] = useState(true);
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dbStatus, setDbStatus] = useState({ connected: false });
  const [distillationStatus, setDistillationStatus] = useState<{ sessionId: string | null; status: 'idle' | 'processing' | 'complete' | 'error'; message?: string; nodesCreated?: number; edgesCreated?: number }>({ sessionId: null, status: 'idle' });

  // --- Renderer state -----------------------------------------------------
  const [caps, setCaps] = useState<CapabilityReport>(() => getCapabilities());
  const [rendererList, setRendererList] = useState<RendererDescriptor[]>(() => listRenderers(caps));
  const [activeRendererId, setActiveRendererId] = useState<RendererId>(() => {
    const saved = typeof localStorage !== 'undefined'
      ? (localStorage.getItem(LS_RENDERER_KEY) as RendererId | null)
      : null;
    return resolveRendererId(saved, caps);
  });

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of nodesRef.current) {
      counts.set(n.category, (counts.get(n.category) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([category]) => category);
  }, [stats.nodes]);

  const selectedSessionNodes = useMemo(() => {
    if (selectedSessionId == null) return [];
    return nodesRef.current
      .filter((n) => n.sessionId === selectedSessionId)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [selectedSessionId, stats.nodes]);

  const selectedSessionName = useMemo(() => {
    if (selectedSessionId == null) return null;
    const s = sessions.find((x) => x.id === selectedSessionId);
    return s?.title || `Session ${selectedSessionId.slice(0, 8)}`;
  }, [selectedSessionId, sessions]);

  // Build render-ready data from the current node/edge refs + override maps,
  // then hand it to the active renderer. Each renderer decides whether to
  // apply immediately (force3d) or debounce (Cosmograph).
  const syncToRenderer = () => {
    const r = rendererRef.current;
    if (!r) return;

    const visibleNodes = selectedSessionId == null && selectedCluster == null
      ? nodesRef.current
      : nodesRef.current.filter((n) => {
          if (selectedSessionId != null && n.sessionId !== selectedSessionId) return false;
          if (selectedCluster != null && n.category !== selectedCluster) return false;
          return true;
        });

    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
    const visibleEdges = edgesRef.current.filter((e) =>
      visibleNodeIds.has(e.sourceNodeId) && visibleNodeIds.has(e.targetNodeId)
    );

    const renderNodes: RenderNode[] = visibleNodes.map((n) => ({
      id: n.id,
      label: n.label,
      category: n.category,
      x: n.x,
      y: n.y,
      z: n.z,
      color: nodeColorMapRef.current.get(n.id) ?? n.baseColor,
      size: nodeSizeMapRef.current.get(n.id) ?? n.baseSize,
    }));

    const renderEdges: RenderEdge[] = visibleEdges.map((e) => ({
      id: e.id,
      source: e.sourceNodeId,
      target: e.targetNodeId,
      color: edgeColorMapRef.current.get(e.id) ?? e.baseColor,
      width: edgeWidthMapRef.current.get(e.id) ?? e.baseWidth,
    }));

    r.setData(renderNodes, renderEdges);
  };

  const addNode = (node: Partial<NodeEntry> & { id: string; label: string; category: string; content: string } | any) => {
    const pos = resolvePosition(node.x || null, node.y || null);
    const newNode: NodeEntry = {
      id: node.id,
      label: node.label,
      category: node.category,
      content: node.content,
      sourceId: node.sourceId ?? null,
      sessionId: node.sessionId ?? null,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      baseColor: CATEGORY_COLORS[node.category] || '#ffffff',
      baseSize: BASE_NODE_SIZE,
    };
    nodesRef.current.push(newNode);
    idToNodeRef.current.set(newNode.id, newNode);
    nodeSizeMapRef.current.set(newNode.id, BASE_NODE_SIZE);
    nodeColorMapRef.current.set(newNode.id, newNode.baseColor);
    setStats((prev) => ({ nodes: prev.nodes + 1, edges: prev.edges }));
    syncToRenderer();
  };

  const addEdge = (edge: Partial<EdgeEntry> & { id: string; sourceNodeId: string; targetNodeId: string }) => {
    const newEdge: EdgeEntry = {
      id: edge.id,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      weight: edge.weight ?? 0.5,
      baseColor: NEON.edge,
      baseWidth: Math.max(0.8, (edge.weight ?? 0.5) * 3),
    };
    edgesRef.current.push(newEdge);
    edgeColorMapRef.current.set(newEdge.id, newEdge.baseColor);
    edgeWidthMapRef.current.set(newEdge.id, newEdge.baseWidth);
    setStats((prev) => ({ nodes: prev.nodes, edges: prev.edges + 1 }));
    syncToRenderer();
  };

  const updateEdgeColor = (edgeId: string, color: string) => {
    edgeColorMapRef.current.set(edgeId, color);
    syncToRenderer();
  };

  const updateEdgeWidth = (edgeId: string, width: number) => {
    edgeWidthMapRef.current.set(edgeId, width);
    syncToRenderer();
  };

  const flashEdge = (edgeId: string) => {
    const edge = edgesRef.current.find(e => e.id === edgeId);
    if (!edge) return;

    // Lightning flash: bright cyan with increased width, then fade back.
    updateEdgeColor(edgeId, NEON.brightCyan);
    updateEdgeWidth(edgeId, edge.baseWidth * 3);
    rendererRef.current?.emitParticle(edgeId);

    setTimeout(() => {
      updateEdgeColor(edgeId, edge.baseColor);
      updateEdgeWidth(edgeId, edge.baseWidth);
    }, 400);
  };

  const updateNodeSize = (nodeId: string, size: number) => {
    nodeSizeMapRef.current.set(nodeId, size);
    syncToRenderer();
  };

  const updateNodeColor = (nodeId: string, color: string) => {
    nodeColorMapRef.current.set(nodeId, color);
    syncToRenderer();
  };

  const fitToAll = () => {
    rendererRef.current?.fitToAll();
  };

  const focusNode = (nodeId: string) => {
    rendererRef.current?.focusNode(nodeId);
  };

  const backToSession = () => {
    setFocusedNodeId(null);
    if (selectedSessionId != null) {
      const sessionNodes = nodesRef.current.filter((n) => n.sessionId === selectedSessionId);
      if (sessionNodes.length > 0) {
        fitToAll();
      }
    } else {
      fitToAll();
    }
  };

  // Closes only the bottom node-list panel (keeps the session selected).
  const closeNodeList = () => {
    setNodeListOpen(false);
    setFocusedNodeId(null);
  };

  const selectSession = (sessionId: string | null) => {
    setSelectedSessionId(sessionId);
    setSelectedCluster(null);
    setFocusedNodeId(null);
    setExpandedNodeIds(new Set());
    setNodeListOpen(sessionId != null);
    syncToRenderer();
    if (sessionId == null) {
      fitToAll();
    } else {
      setTimeout(() => fitToAll(), 100);
    }
  };

  const selectCluster = (category: string | null) => {
    setSelectedCluster(category);
    setSelectedSessionId(null);
    setFocusedNodeId(null);
    setExpandedNodeIds(new Set());
    syncToRenderer();
    if (category == null) {
      fitToAll();
    } else {
      setTimeout(() => fitToAll(), 100);
    }
  };

  const toggleExpand = (nodeId: string) => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  // --- Renderer switching -------------------------------------------------

  const handleSelectRenderer = (id: RendererId) => {
    if (id === activeRendererId) return;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LS_RENDERER_KEY, id);
    }
    setActiveRendererId(id);
  };

  const handleCapsChanged = (next: CapabilityReport) => {
    setCaps(next);
    const list = listRenderers(next);
    setRendererList(list);
    // If the active renderer is no longer available, fall back to default.
    const stillAvailable = list.find((r) => r.id === activeRendererId)?.available;
    if (!stillAvailable) {
      setActiveRendererId(DEFAULT_RENDERER_ID);
    }
  };

  // Initial load
  useEffect(() => {
    const load = async () => {
      try {
        const [sess, db] = await Promise.all([
          api.sessions(),
          api.dbStatus(),
        ]);
        setSessions(sess);
        setDbStatus(db);
        setLoading(false);

        const g = await api.graph(5000);
        for (const n of g.nodes) {
          const pos = resolvePosition(n.x, n.y);
          const node: NodeEntry = {
            id: n.id,
            label: n.label,
            category: n.category,
            content: n.content,
            sourceId: n.sourceId,
            sessionId: n.sessionId,
            x: pos.x,
            y: pos.y,
            z: pos.z,
            baseColor: CATEGORY_COLORS[n.category] || '#ffffff',
            baseSize: BASE_NODE_SIZE,
          };
          nodesRef.current.push(node);
          idToNodeRef.current.set(node.id, node);
          nodeSizeMapRef.current.set(node.id, BASE_NODE_SIZE);
          nodeColorMapRef.current.set(node.id, node.baseColor);
        }
        for (const e of g.edges) {
          const edge: EdgeEntry = {
            id: e.id,
            sourceNodeId: e.sourceNodeId,
            targetNodeId: e.targetNodeId,
            weight: e.weight,
            baseColor: NEON.edge,
            baseWidth: Math.max(0.8, e.weight * 3),
          };
          edgesRef.current.push(edge);
          edgeColorMapRef.current.set(edge.id, edge.baseColor);
          edgeWidthMapRef.current.set(edge.id, edge.baseWidth);
        }
        setStats({ nodes: g.nodes.length, edges: g.edges.length });
        // Sync to graph after initial load and fit camera so clusters are visible.
        setTimeout(() => {
          syncToRenderer();
          fitToAll();
        }, 100);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load neural data');
        setLoading(false);
      }
    };
    load();
  }, []);

  // Layout epoch polling
  useEffect(() => {
    let lastEpoch = 0;
    const poll = setInterval(async () => {
      try {
        const { epoch } = await api.layoutEpoch();
        if (epoch !== lastEpoch) {
          lastEpoch = epoch;
          const g = await api.graph(5000);
          for (const n of g.nodes) {
            const node = idToNodeRef.current.get(n.id);
            if (node) {
              const pos = resolvePosition(n.x, n.y);
              node.x = pos.x;
              node.y = pos.y;
              node.z = pos.z;
            }
          }
          syncToRenderer();
        }
      } catch (e) {
        // Ignore errors during polling
      }
    }, 30000);
    return () => clearInterval(poll);
  }, []);

  // WebSocket event handling
  useWebSocket((event) => {
    // Handle new Neural Brain event format
    if ('event' in event && typeof event.event === 'string') {
      if (event.event === 'NODE_CREATED' && 'node_id' in event && 'label' in event) {
        // Particle effect: scale from 0 to full size with opacity pulse
        const nodeId = (event as any).node_id;
        const label = (event as any).label;
        const type = (event as any).type || 'concept';
        const content = (event as any).content || '';
        const clusterId = (event as any).cluster_id || null;
        const x = (event as any).x;
        const y = (event as any).y;
        const sourceColor = (event as any).sourceColor;
        const color = sourceColor || CATEGORY_COLORS[type.toLowerCase()] || '#ffffff';

        addNode({
          id: nodeId,
          label,
          category: type.toLowerCase(),
          content,
          sourceId: null,
          sessionId: clusterId,
          x: x || undefined,
          y: y || undefined,
        });
        // Animate birth: pulse from 0 to full size
        updateNodeSize(nodeId, 0);
        updateNodeColor(nodeId, color);
        setTimeout(() => updateNodeSize(nodeId, BASE_NODE_SIZE * 1.5), 50);
        setTimeout(() => updateNodeSize(nodeId, BASE_NODE_SIZE), 300);
      } else if (event.event === 'SYNAPSE_CONNECTED' && 'source_id' in event && 'target_id' in event) {
        // Lightning-bolt effect: flash the edge
        const sourceId = (event as any).source_id;
        const targetId = (event as any).target_id;
        const edgeType = (event as any).edge_type || 'RELATED_TO';
        const weight = (event as any).weight || 0.5;
        const edgeId = `${sourceId}-${targetId}-${edgeType}`;

        addEdge({
          id: edgeId,
          sourceNodeId: sourceId,
          targetNodeId: targetId,
          weight,
        });

        // Flash the edge with lightning effect
        setTimeout(() => flashEdge(edgeId), 100);
      } else if (event.event === 'NEURON_ACTIVATED' && 'node_ids' in event) {
        // Glow effect: intense luminescence with radiating ripples
        const nodeIds = (event as any).node_ids as string[];
        const intensity = (event as any).intensity || 1.0;

        for (const nodeId of nodeIds) {
          const node = idToNodeRef.current.get(nodeId);
          if (!node) continue;
          const base = node.baseColor;
          // Glow: white-hot flash with intensity-based size increase (blooms hard).
          updateNodeSize(nodeId, BASE_NODE_SIZE * (1 + intensity));
          updateNodeColor(nodeId, NEON.hot);
          // Radiate travelling signals out through connected synapses.
          rendererRef.current?.emitFromNode(nodeId);
          // Fade back to base over 600ms
          setTimeout(() => {
            updateNodeSize(nodeId, BASE_NODE_SIZE);
            updateNodeColor(nodeId, base);
          }, 600);
        }
      }
      return;
    }

    // Handle legacy event format
    if (event.type === 'neuron_created') {
      addNode({
        id: event.nodeId,
        label: event.label,
        category: event.category,
        content: event.content,
        sourceId: null,
        sessionId: null,
        x: event.x || undefined,
        y: event.y || undefined,
      });
    } else if (event.type === 'synapse_bound') {
      addEdge({
        id: event.edgeId,
        sourceNodeId: event.sourceNodeId,
        targetNodeId: event.targetNodeId,
        weight: event.weight,
      });
    } else if (event.type === 'neuron_fired') {
      const node = idToNodeRef.current.get(event.nodeId);
      if (!node) return;
      const base = node.baseColor;
      updateNodeSize(event.nodeId, FIRED_SIZE);
      updateNodeColor(event.nodeId, '#ffffff');
      setTimeout(() => {
        updateNodeSize(event.nodeId, BASE_NODE_SIZE);
        updateNodeColor(event.nodeId, base);
      }, 400);
    } else if (event.type === 'neuron_decayed') {
      const node = idToNodeRef.current.get(event.nodeId);
      if (!node) return;
      updateNodeColor(event.nodeId, '#ff0000');
      updateNodeSize(event.nodeId, 1);
    } else if (event.type === 'cluster_layout_updated') {
      api.graph(5000).then((g) => {
        for (const n of g.nodes) {
          const node = idToNodeRef.current.get(n.id);
          if (node) {
            const pos = resolvePosition(n.x, n.y);
            node.x = pos.x;
            node.y = pos.y;
            node.z = pos.z;
          } else {
            addNode({
              id: n.id,
              label: n.label,
              category: n.category,
              content: n.content,
              sourceId: n.sourceId,
              sessionId: n.sessionId,
              x: n.x || undefined,
              y: n.y || undefined,
            });
          }
        }
        syncToRenderer();
        fitToAll();
      }).catch(() => {});
    } else if (event.type === 'distillation_started') {
      setDistillationStatus({ sessionId: event.sessionId, status: 'processing', message: 'Processing conversation memory...' });
    } else if (event.type === 'distillation_complete') {
      setDistillationStatus({
        sessionId: event.sessionId,
        status: 'complete',
        message: `Memory distilled: ${event.nodesCreated} nodes, ${event.edgesCreated} edges`,
        nodesCreated: event.nodesCreated,
        edgesCreated: event.edgesCreated,
      });
      setTimeout(() => setDistillationStatus({ sessionId: null, status: 'idle' }), 5000);
    } else if (event.type === 'distillation_error') {
      setDistillationStatus({
        sessionId: event.sessionId,
        status: 'error',
        message: `Distillation error: ${event.error}`,
      });
      setTimeout(() => setDistillationStatus({ sessionId: null, status: 'idle' }), 5000);
    }
  });

  // Mount / re-mount the active renderer into the canvas container.
  // Re-runs when loading/error clear (first mount) or when the user switches
  // renderer via the footer switcher. The cleanup destroys the previous
  // renderer and clears the container so the new one gets a fresh DOM node.
  useEffect(() => {
    if (loading || error) return;
    if (!containerRef.current) return;

    // Destroy any previous renderer (async destroy is fire-and-forget; the
    // innerHTML clear is the synchronous safety net).
    if (rendererRef.current) {
      void rendererRef.current.destroy?.();
      rendererRef.current = null;
    }
    if (containerRef.current) {
      containerRef.current.innerHTML = '';
    }

    const r = createRenderer(activeRendererId, caps);
    rendererRef.current = r;

    try {
      r.mount(containerRef.current);
    } catch {
      // If mount fails, fall back to force3d on the next tick.
      rendererRef.current = null;
      if (activeRendererId !== DEFAULT_RENDERER_ID) {
        setActiveRendererId(DEFAULT_RENDERER_ID);
      }
      return;
    }

    // Wire interaction callbacks through the renderer interface.
    r.onNodeClick?.((id) => {
      toggleExpand(id);
      focusNode(id);
      r.emitFromNode(id);
    });
    r.onNodeDragEnd?.((id, x, y, z) => {
      const node = idToNodeRef.current.get(id);
      if (node) {
        node.x = x;
        node.y = y;
        node.z = z;
      }
    });

    // Sync current data into the freshly mounted renderer + frame it.
    syncToRenderer();
    setTimeout(() => fitToAll(), 100);

    return () => {
      void r.destroy?.();
      if (rendererRef.current === r) {
        rendererRef.current = null;
      }
    };
  }, [loading, error, activeRendererId]);

  // Lightweight FPS telemetry for the HUD.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let frames = 0;
    const tick = () => {
      frames++;
      const now = performance.now();
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Boot sequence overlay fades after the uplink is established.
  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 2600);
    return () => clearTimeout(t);
  }, []);

  // Update graph when filters change OR when new data arrives (stats change).
  // The stats dep is critical: the initial load calls setLoading(false) BEFORE
  // fetching graph data, so the mount effect runs with empty nodesRef. When
  // the graph data arrives and setStats() fires, this effect re-runs and
  // syncs the actual data into the already-mounted renderer.
  useEffect(() => {
    syncToRenderer();
  }, [selectedSessionId, selectedCluster, stats]);

  return (
    <div style={styles.page}>
      <div style={styles.starfield} />
      <div style={styles.gridOverlay} />

      <main style={styles.main}>
        {loading && (
          <div style={styles.center}>
            <div style={styles.spinner} />
            <p style={styles.hudText}>ESTABLISHING UPLINK...</p>
          </div>
        )}

        {!loading && error && (
          <div style={styles.panel}>
            <p style={styles.alert}>COMMS FAILURE: {error}</p>
          </div>
        )}

        {!loading && !error && (
          <>
            <div ref={containerRef} style={styles.canvas} />

            <NeuralHud
              nodes={stats.nodes}
              edges={stats.edges}
              fps={fps}
              connected={dbStatus.connected}
              booting={booting}
              panelWidth={PANEL_WIDTH}
              footerHeight={FOOTER_HEIGHT}
            />

            {/* Distillation toast (replaces the old header status) */}
            {distillationStatus.status !== 'idle' && (
              <div
                style={{
                  position: 'absolute',
                  top: 20,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  padding: '6px 14px',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  letterSpacing: 1,
                  color: distillationStatus.status === 'error' ? '#ff6b6b' : NEON.cyan,
                  background: 'rgba(2,6,15,0.85)',
                  border: `1px solid ${distillationStatus.status === 'error' ? '#ff6b6b' : 'rgba(125,249,255,0.4)'}`,
                  borderRadius: 4,
                  zIndex: 60,
                }}
              >
                {distillationStatus.status === 'processing' && '⚡ '}
                {distillationStatus.status === 'error' && '⚠ '}
                {distillationStatus.message}
              </div>
            )}

            <div style={styles.sidePanel}>
              {/* TOP HALF — navigation controls */}
              <div style={nodeListOpen && selectedSessionId != null ? styles.panelHalf : styles.panelFull}>
                <div style={styles.panelRow}>
                  <span style={styles.panelTitle}>CONTROLS</span>
                  <button style={styles.button} onClick={() => fitToAll()}>RESET VIEW</button>
                </div>

                <div style={styles.panelTitle}>SESSIONS</div>
                <div style={styles.list}>
                  <button
                    style={selectedSessionId === null ? styles.activeItem : styles.item}
                    onClick={() => selectSession(null)}
                  >
                    ALL SESSIONS
                  </button>
                  {sessions.map((s) => (
                    <button
                      key={s.id}
                      style={selectedSessionId === s.id ? styles.activeItem : styles.item}
                      onClick={() => selectSession(s.id)}
                    >
                      {s.title || `Session ${s.id.slice(0, 8)}`}
                    </button>
                  ))}
                </div>

                <div style={styles.panelTitle}>CLUSTERS</div>
                <div style={styles.list}>
                  <button
                    style={selectedCluster === null ? styles.activeItem : styles.item}
                    onClick={() => selectCluster(null)}
                  >
                    ALL CLUSTERS
                  </button>
                  {categories.map((c) => (
                    <button
                      key={c}
                      style={selectedCluster === c ? styles.activeItem : styles.item}
                      onClick={() => selectCluster(c)}
                    >
                      <span style={{ ...styles.colorDot, background: CATEGORY_COLORS[c] || NEON.cyan }} />
                      {CATEGORY_NAMES[c] || c}
                    </button>
                  ))}
                </div>
              </div>

              {/* BOTTOM HALF — node list for the selected session (closable, 50:50) */}
              {selectedSessionId != null && nodeListOpen && (
                <div style={styles.panelHalfBottom}>
                  <div style={styles.sessionCardHeader}>
                    <span style={styles.sessionCardTitle}>{selectedSessionName?.toUpperCase()}</span>
                    <div style={styles.sessionCardActions}>
                      {focusedNodeId && (
                        <button style={styles.smallButton} onClick={backToSession}>BACK</button>
                      )}
                      <button style={styles.closeButton} onClick={closeNodeList}>×</button>
                    </div>
                  </div>
                  <div style={styles.sessionCardList}>
                    {selectedSessionNodes.length === 0 && (
                      <p style={styles.dim}>No neurons in this session.</p>
                    )}
                    {selectedSessionNodes.map((n) => {
                      const expanded = expandedNodeIds.has(n.id);
                      return (
                        <div
                          key={n.id}
                          style={styles.nodeLine}
                          onClick={() => {
                            toggleExpand(n.id);
                            focusNode(n.id);
                          }}
                        >
                          <div style={styles.nodeLineTop}>
                            <span style={{ ...styles.colorDot, background: n.baseColor }} />
                            <span style={expanded ? styles.nodeLineExpanded : styles.nodeLineCollapsed}>
                              {n.content || n.label}
                            </span>
                          </div>
                          {expanded && (
                            <div style={styles.nodeLineMeta}>
                              ID {n.id.slice(0, 8)} · {CATEGORY_NAMES[n.category] || n.category}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {!loading && !error && (
        <RendererSwitcher
          renderers={rendererList}
          activeId={activeRendererId}
          caps={caps}
          onSelect={handleSelectRenderer}
          onCapabilitiesChanged={handleCapsChanged}
          panelWidth={PANEL_WIDTH}
        />
      )}
    </div>
  );
}

const HUD_KEYFRAMES = `
@keyframes agxFlicker { 0%,100% { opacity: 0.9; } 50% { opacity: 0.6; } }
@keyframes agxBootOut { 0% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; visibility: hidden; } }
@keyframes agxTyping { from { width: 0; } to { width: 100%; } }
`;

const C = NEON.cyan;

function NeuralHud({
  nodes,
  edges,
  fps,
  connected,
  booting,
  panelWidth,
  footerHeight,
}: {
  nodes: number;
  edges: number;
  fps: number;
  connected: boolean;
  booting: boolean;
  panelWidth: number;
  footerHeight: number;
}) {
  const overlay: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    right: panelWidth,
    pointerEvents: 'none',
    zIndex: 40,
    fontFamily: "'JetBrains Mono', monospace",
    color: C,
  };
  return (
    <div style={overlay}>
      <style>{HUD_KEYFRAMES}</style>

      {/* Soft vignette to deepen the void around the brain */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,4,12,0.5) 100%)' }} />

      {/* Top-left brand + neural link status */}
      <div style={{ position: 'absolute', top: 24, left: 28 }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 3, color: C, textShadow: `0 0 12px ${C}` }}>
          AGENT-X <span style={{ opacity: 0.5 }}>// NEURAL BRAIN</span>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, letterSpacing: 2, color: connected ? C : '#ff5d5d', animation: 'agxFlicker 4s ease-in-out infinite' }}>
          {connected ? '◈ NEURAL LINK ACTIVE' : '◈ LINK STANDBY'}
        </div>
      </div>

      {/* Bottom-left telemetry (nudged up to clear the renderer footer) */}
      <div style={{ position: 'absolute', bottom: 24 + footerHeight, left: 28, fontSize: 11, lineHeight: 1.9, letterSpacing: 1.5, textShadow: `0 0 6px ${C}` }}>
        <div>NEURONS&nbsp;&nbsp;<span style={{ color: '#fff' }}>{nodes.toLocaleString()}</span></div>
        <div>SYNAPSES&nbsp;<span style={{ color: '#fff' }}>{edges.toLocaleString()}</span></div>
        <div>RENDER&nbsp;&nbsp;&nbsp;<span style={{ color: fps >= 45 ? C : '#ffb454' }}>{fps} FPS</span></div>
      </div>

      {/* Boot sequence */}
      {booting && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(2,6,15,0.82)',
            animation: 'agxBootOut 2.6s ease-in forwards',
          }}
        >
          <div style={{ fontSize: 24, letterSpacing: 10, color: C, textShadow: `0 0 18px ${C}`, marginBottom: 20 }}>AGENT-X</div>
          {['INITIALIZING NEURAL FABRIC', 'CALIBRATING SYNAPTIC TOPOLOGY', 'CHARGING BLOOM CORES', 'UPLINK ESTABLISHED'].map((line, i) => (
            <div
              key={line}
              style={{
                fontSize: 11,
                letterSpacing: 2,
                color: C,
                opacity: 0.85,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                width: '100%',
                maxWidth: 320,
                textAlign: 'left',
                margin: '2px auto',
                animation: `agxTyping 0.5s steps(28) ${i * 0.5}s both`,
              }}
            >
              › {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    width: '100vw',
    height: '100vh',
    backgroundColor: NEON.void,
    color: '#ffffff',
    fontFamily: 'monospace',
    overflow: 'hidden',
    position: 'relative',
  },
  starfield: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundImage: 'radial-gradient(rgba(174,246,255,0.9) 1px, transparent 1px)',
    backgroundSize: '54px 54px',
    opacity: 0.08,
    pointerEvents: 'none',
  },
  gridOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundImage: `
      linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)
    `,
    backgroundSize: '100px 100px',
    pointerEvents: 'none',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    padding: '16px 24px',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
    backdropFilter: 'blur(10px)',
    zIndex: 100,
  },
  badge: {
    fontSize: '12px',
    fontWeight: 'bold',
    letterSpacing: '2px',
    marginBottom: '8px',
    color: NEON.cyan,
    textShadow: `0 0 10px ${NEON.cyan}`,
  },
  button: {
    fontSize: '10px',
    padding: '4px 12px',
    backgroundColor: 'transparent',
    color: '#ffffff',
    border: '1px solid rgba(255, 255, 255, 0.3)',
    borderRadius: '2px',
    cursor: 'pointer',
    fontFamily: 'monospace',
  },
  main: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: FOOTER_HEIGHT,
    display: 'flex',
  },
  canvas: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  sidePanel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: FOOTER_HEIGHT,
    width: `${PANEL_WIDTH}px`,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'rgba(2, 6, 15, 0.82)',
    borderLeft: '1px solid rgba(125, 249, 255, 0.18)',
    backdropFilter: 'blur(10px)',
    zIndex: 50,
  },
  // Top control section when the bottom node-list is open (50% height).
  panelHalf: {
    flex: '1 1 50%',
    minHeight: 0,
    overflowY: 'auto',
    padding: '16px',
    borderBottom: '1px solid rgba(125, 249, 255, 0.18)',
  },
  // Top control section when the bottom panel is closed (full height).
  panelFull: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '16px',
  },
  // Bottom node-list section (50% height).
  panelHalfBottom: {
    flex: '1 1 50%',
    minHeight: 0,
    overflowY: 'auto',
    padding: '16px',
  },
  panelRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '12px',
  },
  panelTitle: {
    fontSize: '10px',
    fontWeight: 'bold',
    letterSpacing: '1px',
    marginBottom: '8px',
    color: NEON.cyan,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    marginBottom: '16px',
  },
  item: {
    fontSize: '10px',
    padding: '6px 8px',
    backgroundColor: 'transparent',
    color: '#ffffff',
    border: '1px solid transparent',
    borderRadius: '2px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    textAlign: 'left',
  },
  activeItem: {
    fontSize: '10px',
    padding: '6px 8px',
    backgroundColor: 'rgba(125, 249, 255, 0.12)',
    color: NEON.cyan,
    border: '1px solid rgba(125, 249, 255, 0.55)',
    borderRadius: '2px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    textAlign: 'left',
    boxShadow: '0 0 10px rgba(125, 249, 255, 0.25)',
  },
  colorDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    marginRight: 8,
  },
  sessionCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
    paddingBottom: '8px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
  },
  sessionCardTitle: {
    fontSize: '10px',
    fontWeight: 'bold',
    letterSpacing: '1px',
    color: NEON.cyan,
    textShadow: `0 0 8px ${NEON.cyan}`,
  },
  sessionCardActions: {
    display: 'flex',
    gap: '8px',
  },
  smallButton: {
    fontSize: '9px',
    padding: '2px 6px',
    backgroundColor: 'transparent',
    color: '#ffffff',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '2px',
    cursor: 'pointer',
    fontFamily: 'monospace',
  },
  closeButton: {
    fontSize: '14px',
    width: '20px',
    height: '20px',
    backgroundColor: 'transparent',
    color: '#ffffff',
    border: 'none',
    borderRadius: '2px',
    cursor: 'pointer',
    fontFamily: 'monospace',
  },
  sessionCardList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  nodeLine: {
    padding: '6px 8px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '2px',
    cursor: 'pointer',
  },
  nodeLineTop: {
    display: 'flex',
    alignItems: 'center',
  },
  nodeLineCollapsed: {
    fontSize: '10px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '200px',
  },
  nodeLineExpanded: {
    fontSize: '10px',
    wordBreak: 'break-word',
  },
  nodeLineMeta: {
    fontSize: '9px',
    color: '#888888',
    marginTop: '4px',
  },
  center: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    textAlign: 'center',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '2px solid rgba(125, 249, 255, 0.2)',
    borderTop: `2px solid ${NEON.cyan}`,
    boxShadow: `0 0 10px ${NEON.cyan}`,
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    margin: '0 auto 16px',
  },
  hudText: {
    fontSize: '12px',
    color: '#888888',
  },
  panel: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    padding: '16px 24px',
    backgroundColor: 'rgba(255, 0, 0, 0.1)',
    border: '1px solid #ff0000',
    borderRadius: '4px',
  },
  alert: {
    fontSize: '12px',
    color: '#ff0000',
    fontFamily: 'monospace',
  },
  dim: {
    fontSize: '10px',
    color: '#666666',
  },
};

// Add spinner animation
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;
document.head.appendChild(styleSheet);
