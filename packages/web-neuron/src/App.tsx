import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type SessionInfo } from './api.ts';
import {
  BASE_NODE_SIZE,
  EDGE_WIDTH,
  resolvePosition,
  type EdgeEntry,
  type NodeEntry,
  type RenderEdge,
  type RenderNode,
  type GraphRenderer,
} from './renderers/types.ts';
import { CATEGORY_COLORS, CATEGORY_NAMES, NEON } from './renderers/palette.ts';
import { createRenderer, type RendererId } from './renderers/index.ts';

const WS_URL =
  (import.meta.env.VITE_API_WS_URL as string) ||
  `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;

const PANEL_WIDTH = 240;

type BrainActivityEvent =
  | { type: 'neuron_created'; nodeId: string; label: string; category: string; content: string; sessionId?: string | null; x: number | null; y: number | null; sourceColor?: string; timestamp: string }
  | { type: 'synapse_bound'; edgeId: string; sourceNodeId: string; targetNodeId: string; relationshipType: string; weight: number; timestamp: string }
  | { type: 'neuron_fired'; nodeId: string; timestamp: string }
  | { type: 'neuron_decayed'; nodeId: string; status: string; timestamp: string }
  | { type: 'cluster_layout_updated'; epoch: number; count: number; timestamp: string }
  | { type: 'distillation_started'; sessionId: string; timestamp: string }
  | { type: 'distillation_complete'; sessionId: string; nodesCreated: number; edgesCreated: number; timestamp: string }
  | { type: 'distillation_error'; sessionId: string; error: string; timestamp: string }
  | { type: 'session_created'; sessionId: string; title: string; timestamp: string }
  | { type: 'message_activity'; sessionId: string; role: 'user' | 'assistant'; textLength: number; timestamp: string };

// Graph visualization events delivered over WebSocket with a string `event`
// discriminator and snake_case payload fields (distinct from BrainActivityEvent).
type GraphWsEvent =
  | { event: 'NODE_CREATED'; node_id: string; label: string; type?: string; content?: string; cluster_id?: string | null; x?: number | null; y?: number | null; sourceColor?: string }
  | { event: 'SYNAPSE_CONNECTED'; source_id: string; target_id: string; edge_type?: string; weight?: number }
  | { event: 'NEURON_ACTIVATED'; node_ids: string[] };

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
  const nodeLineRefs = useRef<Map<string, HTMLDivElement>>(new Map());

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
  /** Session shown in the node list — independent of graph colour filter. */
  const [panelSessionId, setPanelSessionId] = useState<string | null>(null);
  const selectedSessionIdRef = useRef<string | null>(null);
  selectedSessionIdRef.current = selectedSessionId;
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());
  const [nodeListOpen, setNodeListOpen] = useState(true);
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dbStatus, setDbStatus] = useState({ connected: false });
  const [distillationStatus, setDistillationStatus] = useState<{
    sessionId: string | null;
    status: 'idle' | 'processing' | 'complete' | 'error';
    message?: string;
    nodesCreated?: number;
    edgesCreated?: number;
  }>({ sessionId: null, status: 'idle' });
  const [messageActivity, setMessageActivity] = useState<{
    sessionId: string | null;
    role: 'user' | 'assistant';
    textLength: number;
  } | null>(null);
  const rendererId: RendererId = 'force3d';

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of nodesRef.current) {
      counts.set(n.category, (counts.get(n.category) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([category]) => category);
  }, [stats.nodes]);

  const listSessionId = panelSessionId ?? selectedSessionId;

  const selectedSessionNodes = useMemo(() => {
    if (listSessionId == null) return [];
    return nodesRef.current
      .filter((n) => n.sessionId === listSessionId)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [listSessionId, stats.nodes]);

  const nodeDegreeMap = useMemo(() => {
    const deg = new Map<string, number>();
    for (const n of nodesRef.current) deg.set(n.id, 0);
    for (const e of edgesRef.current) {
      deg.set(e.sourceNodeId, (deg.get(e.sourceNodeId) ?? 0) + 1);
      deg.set(e.targetNodeId, (deg.get(e.targetNodeId) ?? 0) + 1);
    }
    return deg;
  }, [stats.nodes, stats.edges]);

  const getNodeDegree = (nodeId: string): number => {
    let d = 0;
    for (const e of edgesRef.current) {
      if (e.sourceNodeId === nodeId || e.targetNodeId === nodeId) d++;
    }
    return d;
  };

  const selectedSessionOrphans = useMemo(() => {
    if (listSessionId == null) return 0;
    return selectedSessionNodes.filter((n) => (nodeDegreeMap.get(n.id) ?? 0) === 0).length;
  }, [listSessionId, selectedSessionNodes, nodeDegreeMap]);

  const selectedSessionName = useMemo(() => {
    if (listSessionId == null) return null;
    const s = sessions.find((x) => x.id === listSessionId);
    return s?.title || `Session ${listSessionId.slice(0, 8)}`;
  }, [listSessionId, sessions]);

  // ── Renderer sync ──────────────────────────────────────────────────────────
  // Always passes EVERY node and edge — no filtering.
  // When a session/cluster is selected, the selected cluster glows orange and
  // everything else fades to near-black.
  const syncToRenderer = () => {
    const r = rendererRef.current;
    if (!r) return;

    const hasFilter = selectedSessionId != null || selectedCluster != null;

    const highlightedNodeIds: Set<string> | null = hasFilter
      ? new Set(
          nodesRef.current
            .filter((n) => {
              if (selectedSessionId != null && n.sessionId !== selectedSessionId) return false;
              if (selectedCluster != null && n.category !== selectedCluster) return false;
              return true;
            })
            .map((n) => n.id),
        )
      : null;

    const renderNodes: RenderNode[] = nodesRef.current.map((n) => {
      const degree = getNodeDegree(n.id);
      let color: string;
      if (!hasFilter) {
        color = nodeColorMapRef.current.get(n.id) ?? n.baseColor;
        if (degree === 0) color = NEON.dimNode;
      } else if (highlightedNodeIds!.has(n.id)) {
        color = NEON.orange;
      } else {
        color = NEON.dimNode;
      }
      return {
        id: n.id,
        label: n.label,
        category: n.category,
        sessionId: n.sessionId,
        x: n.x,
        y: n.y,
        z: n.z,
        color,
        size: nodeSizeMapRef.current.get(n.id) ?? n.baseSize,
      };
    });

    const renderEdges: RenderEdge[] = edgesRef.current.map((e) => {
      let color: string;
      if (!hasFilter) {
        color = edgeColorMapRef.current.get(e.id) ?? e.baseColor;
      } else if (
        highlightedNodeIds!.has(e.sourceNodeId) &&
        highlightedNodeIds!.has(e.targetNodeId)
      ) {
        color = NEON.orange;
      } else {
        color = NEON.dimEdge;
      }
      return {
        id: e.id,
        source: e.sourceNodeId,
        target: e.targetNodeId,
        color,
        width: edgeWidthMapRef.current.get(e.id) ?? e.baseWidth,
      };
    });

    r.setData(renderNodes, renderEdges);
  };

  const addNode = (
    node: Partial<NodeEntry> & { id: string; label: string; category: string; content: string } | any,
  ) => {
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

  const addEdge = (
    edge: Partial<EdgeEntry> & { id: string; sourceNodeId: string; targetNodeId: string },
  ) => {
    const newEdge: EdgeEntry = {
      id: edge.id,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      weight: edge.weight ?? 0.5,
      baseColor: NEON.edgeBright,
      baseWidth: EDGE_WIDTH,
    };
    edgesRef.current.push(newEdge);
    edgeColorMapRef.current.set(newEdge.id, newEdge.baseColor);
    edgeWidthMapRef.current.set(newEdge.id, newEdge.baseWidth);
    setStats((prev) => ({ nodes: prev.nodes, edges: prev.edges + 1 }));
    syncToRenderer();
  };

  const flashEdge = (edgeId: string) => {
    rendererRef.current?.emitParticle(edgeId);
  };

  const updateNodeColor = (nodeId: string, color: string) => {
    nodeColorMapRef.current.set(nodeId, color);
    syncToRenderer();
  };

  const fitToAll = () => {
    rendererRef.current?.fitToAll();
  };

  const focusNodeInPanel = (nodeId: string) => {
    setFocusedNodeId(nodeId);
  };

  const selectNodeFromGraph = (nodeId: string) => {
    const node = idToNodeRef.current.get(nodeId);
    if (node?.sessionId) {
      setPanelSessionId(node.sessionId);
      setNodeListOpen(true);
    }
    setFocusedNodeId(nodeId);
    setExpandedNodeIds((prev) => new Set(prev).add(nodeId));
    requestAnimationFrame(() => {
      nodeLineRefs.current.get(nodeId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  };

  const backToSession = () => {
    setFocusedNodeId(null);
  };

  const closeNodeList = () => {
    setNodeListOpen(false);
    setFocusedNodeId(null);
  };

  const selectSession = (sessionId: string | null) => {
    setSelectedSessionId(sessionId);
    setPanelSessionId(sessionId);
    setSelectedCluster(null);
    setFocusedNodeId(null);
    setExpandedNodeIds(new Set());
    setNodeListOpen(sessionId != null);
  };

  const selectCluster = (category: string | null) => {
    setSelectedCluster(category);
    setSelectedSessionId(null);
    setPanelSessionId(null);
    setFocusedNodeId(null);
    setExpandedNodeIds(new Set());
  };

  const toggleExpand = (nodeId: string) => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  // ── Renderer mount / remount ───────────────────────────────────────────────
  // Re-mounts when rendererId changes. Default is 'force3d' (3d-force-graph).
  useEffect(() => {
    if (loading || error) return;
    if (!containerRef.current) return;

    // Destroy any previous renderer instance.
    if (rendererRef.current) {
      void rendererRef.current.destroy?.();
      rendererRef.current = null;
    }
    if (containerRef.current) {
      containerRef.current.innerHTML = '';
    }

    const r = createRenderer(rendererId);
    rendererRef.current = r;

    try {
      r.mount(containerRef.current);
    } catch {
      rendererRef.current = null;
      return;
    }

    r.onNodeClick?.((id) => {
      selectNodeFromGraph(id);
    });
    r.onNodeDragEnd?.((id, x, y, z) => {
      const node = idToNodeRef.current.get(id);
      if (node) {
        node.x = x;
        node.y = y;
        node.z = z;
      }
    });

    syncToRenderer();
    setTimeout(() => fitToAll(), 100);

    return () => {
      void r.destroy?.();
      if (rendererRef.current === r) rendererRef.current = null;
    };
  }, [loading, error, rendererId]);

  // ── Initial data load ─────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const [sess, db] = await Promise.all([api.sessions(), api.dbStatus()]);
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
            baseColor: NEON.edgeBright,
            baseWidth: EDGE_WIDTH,
          };
          edgesRef.current.push(edge);
          edgeColorMapRef.current.set(edge.id, edge.baseColor);
          edgeWidthMapRef.current.set(edge.id, edge.baseWidth);
        }
        setStats({ nodes: g.nodes.length, edges: g.edges.length });
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

  // ── Layout epoch polling ───────────────────────────────────────────────────
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
      } catch {
        // ignore polling errors
      }
    }, 30000);
    return () => clearInterval(poll);
  }, []);

  // ── WebSocket events ───────────────────────────────────────────────────────
  useWebSocket((event) => {
    if ('event' in event && typeof event.event === 'string') {
      const e = event as unknown as GraphWsEvent;
      if (e.event === 'NODE_CREATED' && 'node_id' in e && 'label' in e) {
        const nodeId = e.node_id;
        const label = e.label;
        const type = e.type || 'concept';
        const content = e.content || '';
        const clusterId = e.cluster_id || null;
        const x = e.x;
        const y = e.y;
        const sourceColor = e.sourceColor;
        const color = sourceColor || CATEGORY_COLORS[type.toLowerCase()] || '#ffffff';
        addNode({ id: nodeId, label, category: type.toLowerCase(), content, sourceId: null, sessionId: clusterId, x: x || undefined, y: y || undefined });
        updateNodeColor(nodeId, color);
      } else if (e.event === 'SYNAPSE_CONNECTED' && 'source_id' in e && 'target_id' in e) {
        const sourceId = e.source_id;
        const targetId = e.target_id;
        const edgeType = e.edge_type || 'RELATED_TO';
        const weight = e.weight || 0.5;
        const edgeId = `${sourceId}-${targetId}-${edgeType}`;
        addEdge({ id: edgeId, sourceNodeId: sourceId, targetNodeId: targetId, weight });
        setTimeout(() => flashEdge(edgeId), 100);
      } else if (e.event === 'NEURON_ACTIVATED' && 'node_ids' in e) {
        const nodeIds = e.node_ids;
        for (const nodeId of nodeIds) {
          rendererRef.current?.emitFromNode(nodeId);
        }
      }
      return;
    }

    if (event.type === 'neuron_created') {
      addNode({ id: event.nodeId, label: event.label, category: event.category, content: event.content, sourceId: null, sessionId: event.sessionId ?? null, x: event.x || undefined, y: event.y || undefined });
    } else if (event.type === 'synapse_bound') {
      addEdge({ id: event.edgeId, sourceNodeId: event.sourceNodeId, targetNodeId: event.targetNodeId, weight: event.weight });
      setTimeout(() => flashEdge(event.edgeId), 80);
    } else if (event.type === 'neuron_fired') {
      rendererRef.current?.emitFromNode(event.nodeId);
    } else if (event.type === 'neuron_decayed') {
      updateNodeColor(event.nodeId, '#ff4444');
      rendererRef.current?.animateDecay?.(event.nodeId);
    } else if (event.type === 'cluster_layout_updated') {
      api.graph(5000).then((g) => {
        for (const n of g.nodes) {
          const node = idToNodeRef.current.get(n.id);
          if (node) {
            const pos = resolvePosition(n.x, n.y);
            node.x = pos.x; node.y = pos.y; node.z = pos.z;
          } else {
            addNode({ id: n.id, label: n.label, category: n.category, content: n.content, sourceId: n.sourceId, sessionId: n.sessionId, x: n.x || undefined, y: n.y || undefined });
          }
        }
        syncToRenderer();
        fitToAll();
      }).catch(() => {});
    } else if (event.type === 'distillation_started') {
      setDistillationStatus({ sessionId: event.sessionId, status: 'processing', message: 'Processing conversation memory...' });
    } else if (event.type === 'distillation_complete') {
      setDistillationStatus({ sessionId: event.sessionId, status: 'complete', message: `Memory distilled: ${event.nodesCreated} nodes, ${event.edgesCreated} edges`, nodesCreated: event.nodesCreated, edgesCreated: event.edgesCreated });
      setTimeout(() => setDistillationStatus({ sessionId: null, status: 'idle' }), 5000);
    } else if (event.type === 'distillation_error') {
      setDistillationStatus({ sessionId: event.sessionId, status: 'error', message: `Distillation error: ${event.error}` });
      setTimeout(() => setDistillationStatus({ sessionId: null, status: 'idle' }), 5000);
    } else if (event.type === 'session_created') {
      // Add new session to the sessions list.
      setSessions((prev) => {
        if (prev.some((s) => s.id === event.sessionId)) return prev;
        return [...prev, {
          id: event.sessionId,
          title: event.title,
          status: 'active',
          provider: '',
          model: '',
          scopePath: '',
          createdAt: event.timestamp,
          updatedAt: event.timestamp,
          messageCount: 0,
        }];
      });
    } else if (event.type === 'message_activity') {
      setMessageActivity({ sessionId: event.sessionId, role: event.role, textLength: event.textLength });
      // Clear message activity indicator after 3 seconds.
      setTimeout(() => setMessageActivity((prev) => (prev?.sessionId === event.sessionId ? null : prev)), 3000);
    }
  });

  // ── Recolour graph when filter changes ────────────────────────────────────
  useEffect(() => {
    syncToRenderer();
  }, [selectedSessionId, selectedCluster, stats]);

  // ── Window resize ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onResize = () => rendererRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── FPS telemetry ─────────────────────────────────────────────────────────
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

  // ── Boot overlay ──────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 2600);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={styles.page}>
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
            />

            {distillationStatus.status !== 'idle' && (
              <div style={{ position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)', padding: '6px 14px', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: 1, color: distillationStatus.status === 'error' ? '#ff6b6b' : NEON.cyan, background: 'rgba(2,6,15,0.85)', border: `1px solid ${distillationStatus.status === 'error' ? '#ff6b6b' : 'rgba(125,249,255,0.4)'}`, borderRadius: 4, zIndex: 60 }}>
                {distillationStatus.status === 'processing' && '⚡ '}
                {distillationStatus.status === 'error' && '⚠ '}
                {distillationStatus.message}
              </div>
            )}

            {messageActivity && distillationStatus.status === 'idle' && (
              <div style={{ position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)', padding: '4px 12px', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: 1, color: messageActivity.role === 'user' ? NEON.cyan : NEON.blue, background: 'rgba(2,6,15,0.7)', border: `1px solid ${messageActivity.role === 'user' ? 'rgba(125,249,255,0.3)' : 'rgba(30,144,255,0.3)'}`, borderRadius: 4, zIndex: 55 }}>
                {messageActivity.role === 'user' ? '💬 ' : '🤖 '}
                {messageActivity.role === 'user' ? 'USER' : 'ASSISTANT'} · {messageActivity.textLength} chars
              </div>
            )}

            <div style={styles.sidePanel}>
              <div style={nodeListOpen && listSessionId != null ? styles.panelHalf : styles.panelFull}>
                <div style={styles.panelRow}>
                  <span style={styles.panelTitle}>CONTROLS</span>
                  <button style={styles.button} onClick={() => fitToAll()}>RESET VIEW</button>
                </div>

                <div style={styles.panelTitle}>SESSIONS</div>
                <div style={styles.list}>
                  <button style={selectedSessionId === null ? styles.activeItem : styles.item} onClick={() => selectSession(null)}>
                    ALL SESSIONS
                  </button>
                  {sessions.map((s) => (
                    <button key={s.id} style={selectedSessionId === s.id ? styles.activeItem : styles.item} onClick={() => selectSession(s.id)}>
                      {s.title || `Session ${s.id.slice(0, 8)}`}
                    </button>
                  ))}
                </div>

                <div style={styles.panelTitle}>CLUSTERS</div>
                <div style={styles.list}>
                  <button style={selectedCluster === null ? styles.activeItem : styles.item} onClick={() => selectCluster(null)}>
                    ALL CLUSTERS
                  </button>
                  {categories.map((c) => (
                    <button key={c} style={selectedCluster === c ? styles.activeItem : styles.item} onClick={() => selectCluster(c)}>
                      <span style={{ ...styles.colorDot, background: CATEGORY_COLORS[c] || NEON.cyan }} />
                      {CATEGORY_NAMES[c] || c}
                    </button>
                  ))}
                </div>
              </div>

              {listSessionId != null && nodeListOpen && (
                <div style={styles.panelHalfBottom}>
                  <div style={styles.sessionCardHeader}>
                    <span style={styles.sessionCardTitle}>
                      {selectedSessionName?.toUpperCase()}
                      {selectedSessionOrphans > 0 && (
                        <span style={styles.orphanBadge}> · {selectedSessionOrphans} orphan{selectedSessionOrphans === 1 ? '' : 's'}</span>
                      )}
                    </span>
                    <div style={styles.sessionCardActions}>
                      {focusedNodeId && <button style={styles.smallButton} onClick={backToSession}>BACK</button>}
                      <button style={styles.closeButton} onClick={closeNodeList}>×</button>
                    </div>
                  </div>
                  <div style={styles.sessionCardList}>
                    {selectedSessionNodes.length === 0 && <p style={styles.dim}>No neurons in this session.</p>}
                    {selectedSessionNodes.map((n) => {
                      const expanded = expandedNodeIds.has(n.id);
                      const focused = focusedNodeId === n.id;
                      const degree = nodeDegreeMap.get(n.id) ?? 0;
                      const isOrphan = degree === 0;
                      return (
                        <div
                          key={n.id}
                          ref={(el) => {
                            if (el) nodeLineRefs.current.set(n.id, el);
                            else nodeLineRefs.current.delete(n.id);
                          }}
                          style={focused ? styles.nodeLineFocused : isOrphan ? styles.nodeLineOrphan : styles.nodeLine}
                          onClick={() => { toggleExpand(n.id); focusNodeInPanel(n.id); }}
                        >
                          <div style={styles.nodeLineTop}>
                            <span style={{ ...styles.colorDot, background: isOrphan ? NEON.dimNode : n.baseColor }} />
                            <span style={expanded ? styles.nodeLineExpanded : styles.nodeLineCollapsed}>{n.content || n.label}</span>
                          </div>
                          {expanded && (
                            <div style={styles.nodeLineMeta}>
                              ID {n.id.slice(0, 8)} · {CATEGORY_NAMES[n.category] || n.category}
                              {isOrphan ? ' · no synapses in graph' : ` · ${degree} synapse${degree === 1 ? '' : 's'}`}
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
    </div>
  );
}

// ── HUD overlay ──────────────────────────────────────────────────────────────

const HUD_KEYFRAMES = `
@keyframes agxFlicker { 0%,100% { opacity: 0.9; } 50% { opacity: 0.6; } }
@keyframes agxBootOut { 0% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; visibility: hidden; } }
@keyframes agxTyping { from { width: 0; } to { width: 100%; } }
`;

const C = NEON.cyan;

function NeuralHud({ nodes, edges, fps, connected, booting, panelWidth }: {
  nodes: number; edges: number; fps: number; connected: boolean; booting: boolean; panelWidth: number;
}) {
  const overlay: React.CSSProperties = {
    position: 'absolute', inset: 0, right: panelWidth, pointerEvents: 'none', zIndex: 40,
    fontFamily: "'JetBrains Mono', monospace", color: C,
  };
  return (
    <div style={overlay}>
      <style>{HUD_KEYFRAMES}</style>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,4,12,0.5) 100%)' }} />

      <div style={{ position: 'absolute', top: 24, left: 28 }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 3, color: C, textShadow: `0 0 12px ${C}` }}>
          AGENT-X <span style={{ opacity: 0.5 }}>// NEURAL BRAIN</span>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, letterSpacing: 2, color: connected ? C : '#ff5d5d', animation: 'agxFlicker 4s ease-in-out infinite' }}>
          {connected ? '◈ NEURAL LINK ACTIVE' : '◈ LINK STANDBY'}
        </div>
      </div>

      <div style={{ position: 'absolute', bottom: 24, left: 28, fontSize: 11, lineHeight: 1.9, letterSpacing: 1.5, textShadow: `0 0 6px ${C}` }}>
        <div>NEURONS&nbsp;&nbsp;<span style={{ color: '#fff' }}>{nodes.toLocaleString()}</span></div>
        <div>SYNAPSES&nbsp;<span style={{ color: '#fff' }}>{edges.toLocaleString()}</span></div>
        <div>RENDER&nbsp;&nbsp;&nbsp;<span style={{ color: fps >= 45 ? C : '#ffb454' }}>{fps} FPS</span></div>
        <div style={{ marginTop: 4, opacity: 0.4, fontSize: 9, letterSpacing: 2 }}>SIGMA 2D · MIT</div>
      </div>

      {booting && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(2,6,15,0.82)', animation: 'agxBootOut 2.6s ease-in forwards' }}>
          <div style={{ fontSize: 24, letterSpacing: 10, color: C, textShadow: `0 0 18px ${C}`, marginBottom: 20 }}>AGENT-X</div>
          {['INITIALIZING NEURAL FABRIC', 'CALIBRATING SYNAPTIC TOPOLOGY', 'SIGMA 2D ENGINE READY', 'UPLINK ESTABLISHED'].map((line, i) => (
            <div key={line} style={{ fontSize: 11, letterSpacing: 2, color: C, opacity: 0.85, overflow: 'hidden', whiteSpace: 'nowrap', width: '100%', maxWidth: 320, textAlign: 'left', margin: '2px auto', animation: `agxTyping 0.5s steps(28) ${i * 0.5}s both` }}>
              › {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: { width: '100vw', height: '100vh', backgroundColor: NEON.void, color: '#ffffff', fontFamily: 'monospace', overflow: 'hidden', position: 'relative' },
  starfield: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundImage: 'radial-gradient(rgba(174,246,255,0.9) 1px, transparent 1px)', backgroundSize: '54px 54px', opacity: 0.08, pointerEvents: 'none' },
  gridOverlay: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`, backgroundSize: '100px 100px', pointerEvents: 'none' },
  main: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  canvas: { position: 'absolute', top: 0, left: 0, right: `${PANEL_WIDTH}px`, bottom: 0, width: 'auto', height: '100%' },
  sidePanel: { position: 'absolute', top: 0, right: 0, bottom: 0, width: `${PANEL_WIDTH}px`, display: 'flex', flexDirection: 'column', backgroundColor: 'rgba(2,6,15,0.82)', borderLeft: '1px solid rgba(125,249,255,0.18)', backdropFilter: 'blur(10px)', zIndex: 50 },
  panelHalf: { flex: '1 1 50%', minHeight: 0, overflowY: 'auto', padding: '16px', borderBottom: '1px solid rgba(125,249,255,0.18)' },
  panelFull: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px' },
  panelHalfBottom: { flex: '1 1 50%', minHeight: 0, overflowY: 'auto', padding: '16px' },
  panelRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' },
  panelTitle: { fontSize: '10px', fontWeight: 'bold', letterSpacing: '1px', marginBottom: '8px', color: NEON.cyan },
  list: { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' },
  item: { fontSize: '10px', padding: '6px 8px', backgroundColor: 'transparent', color: '#ffffff', border: '1px solid transparent', borderRadius: '2px', cursor: 'pointer', fontFamily: 'monospace', textAlign: 'left' },
  activeItem: { fontSize: '10px', padding: '6px 8px', backgroundColor: 'rgba(125,249,255,0.12)', color: NEON.cyan, border: '1px solid rgba(125,249,255,0.55)', borderRadius: '2px', cursor: 'pointer', fontFamily: 'monospace', textAlign: 'left', boxShadow: '0 0 10px rgba(125,249,255,0.25)' },
  colorDot: { width: 8, height: 8, borderRadius: '50%', marginRight: 8 },
  button: { fontSize: '10px', padding: '4px 12px', backgroundColor: 'transparent', color: '#ffffff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '2px', cursor: 'pointer', fontFamily: 'monospace' },
  sessionCardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.1)' },
  sessionCardTitle: { fontSize: '10px', fontWeight: 'bold', letterSpacing: '1px', color: NEON.cyan, textShadow: `0 0 8px ${NEON.cyan}` },
  sessionCardActions: { display: 'flex', gap: '8px' },
  smallButton: { fontSize: '9px', padding: '2px 6px', backgroundColor: 'transparent', color: '#ffffff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '2px', cursor: 'pointer', fontFamily: 'monospace' },
  closeButton: { fontSize: '14px', width: '20px', height: '20px', backgroundColor: 'transparent', color: '#ffffff', border: 'none', borderRadius: '2px', cursor: 'pointer', fontFamily: 'monospace' },
  sessionCardList: { display: 'flex', flexDirection: 'column', gap: '4px' },
  nodeLine: { padding: '6px 8px', backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '2px', cursor: 'pointer' },
  nodeLineOrphan: { padding: '6px 8px', backgroundColor: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.18)', borderRadius: '2px', cursor: 'pointer', opacity: 0.75 },
  nodeLineFocused: { padding: '6px 8px', backgroundColor: 'rgba(255,115,0,0.22)', border: '1px solid rgba(255,115,0,0.65)', borderRadius: '2px', cursor: 'pointer', boxShadow: '0 0 10px rgba(255,115,0,0.28)' },
  orphanBadge: { fontSize: '9px', color: '#888888', letterSpacing: '0.5px' },
  nodeLineTop: { display: 'flex', alignItems: 'center' },
  nodeLineCollapsed: { fontSize: '10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' },
  nodeLineExpanded: { fontSize: '10px', wordBreak: 'break-word' },
  nodeLineMeta: { fontSize: '9px', color: '#888888', marginTop: '4px' },
  center: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center' },
  spinner: { width: '40px', height: '40px', border: '2px solid rgba(125,249,255,0.2)', borderTop: `2px solid ${NEON.cyan}`, boxShadow: `0 0 10px ${NEON.cyan}`, borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' },
  hudText: { fontSize: '12px', color: '#888888' },
  panel: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', padding: '16px 24px', backgroundColor: 'rgba(255,0,0,0.1)', border: '1px solid #ff0000', borderRadius: '4px' },
  alert: { fontSize: '12px', color: '#ff0000', fontFamily: 'monospace' },
  dim: { fontSize: '10px', color: '#666666' },
};

const styleSheet = document.createElement('style');
styleSheet.textContent = `@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`;
document.head.appendChild(styleSheet);
