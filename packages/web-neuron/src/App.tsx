import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D from '3d-force-graph';
import { api, type SessionInfo } from './api.ts';
import { neuronTheme } from './theme.ts';

const CATEGORY_COLORS: Record<string, string> = {
  persona: '#ff4d4d',
  tool: '#4da6ff',
  episodic: '#ffd24d',
  semantic: '#4dff88',
  source_doc: '#d24dff',
  system: '#ffffff',
};

const CATEGORY_NAMES: Record<string, string> = {
  persona: 'Persona',
  tool: 'Tool',
  episodic: 'Episodic',
  semantic: 'Semantic',
  source_doc: 'Source Doc',
  system: 'System',
};

const WS_URL = (import.meta.env.VITE_API_WS_URL as string) || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;

interface NodeEntry {
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

interface EdgeEntry {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  weight: number;
  baseColor: string;
  baseWidth: number;
}

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

const SPACE_SIZE = 4096;
const LAYOUT_SCALE = 200;

function resolvePosition(x: number | null | undefined, y: number | null | undefined): { x: number; y: number; z: number } {
  if (x == null || y == null || (x === 0 && y === 0)) {
    return {
      x: (Math.random() - 0.5) * SPACE_SIZE * 0.5,
      y: (Math.random() - 0.5) * SPACE_SIZE * 0.5,
      z: (Math.random() - 0.5) * SPACE_SIZE * 0.5,
    };
  }
  return {
    x: x * LAYOUT_SCALE + SPACE_SIZE / 2,
    y: y * LAYOUT_SCALE + SPACE_SIZE / 2,
    z: 0,
  };
}

const BASE_NODE_SIZE = 2;
const FIRED_SIZE = 5;

export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<any>(null);

  const nodesRef = useRef<NodeEntry[]>([]);
  const edgesRef = useRef<EdgeEntry[]>([]);
  const idToNodeRef = useRef<Map<string, NodeEntry>>(new Map());
  const nodeSizeMapRef = useRef<Map<string, number>>(new Map());
  const nodeColorMapRef = useRef<Map<string, string>>(new Map());

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dbStatus, setDbStatus] = useState({ connected: false });
  const [distillationStatus, setDistillationStatus] = useState<{ sessionId: string | null; status: 'idle' | 'processing' | 'complete' | 'error'; message?: string; nodesCreated?: number; edgesCreated?: number }>({ sessionId: null, status: 'idle' });

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

  const syncToGraph = () => {
    const g = graphRef.current;
    if (!g) return;

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

    const graphData = {
      nodes: visibleNodes.map((n) => ({
        id: n.id,
        label: n.label,
        category: n.category,
        x: n.x,
        y: n.y,
        z: n.z,
        val: nodeSizeMapRef.current.get(n.id) ?? BASE_NODE_SIZE,
        color: nodeColorMapRef.current.get(n.id) ?? n.baseColor,
      })),
      links: visibleEdges.map((e) => ({
        id: e.id,
        source: e.sourceNodeId,
        target: e.targetNodeId,
        val: e.baseWidth,
        color: e.baseColor,
      })),
    };

    g.graphData(graphData);
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
    syncToGraph();
  };

  const addEdge = (edge: Partial<EdgeEntry> & { id: string; sourceNodeId: string; targetNodeId: string }) => {
    const newEdge: EdgeEntry = {
      id: edge.id,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      weight: edge.weight ?? 0.5,
      baseColor: '#444444',
      baseWidth: (edge.weight ?? 0.5) * 2,
    };
    edgesRef.current.push(newEdge);
    setStats((prev) => ({ nodes: prev.nodes, edges: prev.edges + 1 }));
    syncToGraph();
  };

  const updateNodeSize = (nodeId: string, size: number) => {
    nodeSizeMapRef.current.set(nodeId, size);
    syncToGraph();
  };

  const updateNodeColor = (nodeId: string, color: string) => {
    nodeColorMapRef.current.set(nodeId, color);
    syncToGraph();
  };

  const fitToAll = () => {
    const g = graphRef.current;
    if (!g) return;
    g.zoomToFit();
  };

  const focusNode = (nodeId: string) => {
    const g = graphRef.current;
    if (!g) return;
    const node = idToNodeRef.current.get(nodeId);
    if (!node) return;
    setFocusedNodeId(nodeId);
    // Center camera on the node
    g.cameraPosition({ x: node.x, y: node.y, z: node.z }, node);
  };

  const backToSession = () => {
    setFocusedNodeId(null);
    if (selectedSessionId != null) {
      const sessionNodes = nodesRef.current.filter((n) => n.sessionId === selectedSessionId);
      if (sessionNodes.length > 0) {
        const g = graphRef.current;
        if (!g) return;
        g.zoomToFit(400);
      }
    } else {
      fitToAll();
    }
  };

  const closeSessionCard = () => {
    setSelectedSessionId(null);
    setFocusedNodeId(null);
    setExpandedNodeIds(new Set());
    fitToAll();
  };

  const selectSession = (sessionId: string | null) => {
    setSelectedSessionId(sessionId);
    setSelectedCluster(null);
    setFocusedNodeId(null);
    setExpandedNodeIds(new Set());
    syncToGraph();
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
    syncToGraph();
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
            baseColor: '#444444',
            baseWidth: e.weight * 2,
          };
          edgesRef.current.push(edge);
        }
        setStats({ nodes: g.nodes.length, edges: g.edges.length });
        // Sync to graph after initial load
        setTimeout(() => syncToGraph(), 100);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
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
          syncToGraph();
        }
      } catch (e) {
        // Ignore errors during polling
      }
    }, 30000);
    return () => clearInterval(poll);
  }, []);

  // WebSocket event handling
  useWebSocket((event) => {
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
        syncToGraph();
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

  // Initialize 3D graph
  useEffect(() => {
    if (!containerRef.current) return;

    // @ts-ignore - 3d-force-graph type definitions are incomplete
    const g = ForceGraph3D()(containerRef.current as HTMLElement);
    g.backgroundColor('#000000')
      .nodeColor((n: any) => n.color)
      .nodeVal((n: any) => n.val)
      .nodeLabel((n: any) => n.label)
      .nodeLabelColor(() => '#ffffff')
      .nodeLabelFontSize(10)
      .linkColor((l: any) => l.color)
      .linkWidth((l: any) => l.val)
      .linkOpacity(0.6)
      .onNodeClick((n: any) => {
        const node = idToNodeRef.current.get(n.id);
        if (node) {
          toggleExpand(n.id);
          focusNode(n.id);
        }
      })
      .onNodeDragEnd((n: any) => {
        const node = idToNodeRef.current.get(n.id);
        if (node) {
          node.x = n.x;
          node.y = n.y;
          node.z = n.z;
        }
      });

    graphRef.current = g;

    // Disable rotation on drag for better control
    g.onNodeDrag(() => {
      g.controls().autoRotate = false;
    });

    return () => {
      if (g) {
        g._destructor();
      }
    };
  }, []);

  // Update graph when filters change
  useEffect(() => {
    syncToGraph();
  }, [selectedSessionId, selectedCluster]);

  return (
    <div style={styles.page}>
      <div style={styles.starfield} />
      <div style={styles.gridOverlay} />

      <header style={styles.header}>
        <div style={styles.badge}>AGENT-X // NEURAL BRAIN</div>
        <div style={styles.statusRow}>
          <span style={statusDotStyle(dbStatus.connected)} />
          <span style={styles.statusText}>{dbStatus.connected ? 'POSTGRES ONLINE' : 'POSTGRES OFFLINE'}</span>
          <span style={styles.statPill}>NODES {stats.nodes}</span>
          <span style={styles.statPill}>EDGES {stats.edges}</span>
          <button style={styles.button} onClick={() => fitToAll()}>RESET VIEW</button>
        </div>
        {distillationStatus.status !== 'idle' && (
          <div style={{
            ...styles.statusRow,
            marginTop: '8px',
            padding: '4px 8px',
            backgroundColor: distillationStatus.status === 'error' ? 'rgba(255, 0, 0, 0.2)' : 'rgba(0, 255, 0, 0.1)',
            border: `1px solid ${distillationStatus.status === 'error' ? '#ff0000' : '#00ff00'}`,
            borderRadius: '4px',
          }}>
            <span style={{
              color: distillationStatus.status === 'error' ? '#ff0000' : '#00ff00',
              fontSize: '11px',
              fontFamily: 'monospace',
            }}>
              {distillationStatus.status === 'processing' && '⚡ '}
              {distillationStatus.status === 'error' && '⚠️ '}
              {distillationStatus.message}
            </span>
          </div>
        )}
      </header>

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

            <div style={styles.sidePanel}>
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
                    <span style={{ ...styles.colorDot, background: CATEGORY_COLORS[c] || neuronTheme.accent.amber }} />
                    {CATEGORY_NAMES[c] || c}
                  </button>
                ))}
              </div>
            </div>

            {selectedSessionId != null && (
              <div style={styles.sessionCard}>
                <div style={styles.sessionCardHeader}>
                  <span style={styles.sessionCardTitle}>{selectedSessionName?.toUpperCase()}</span>
                  <div style={styles.sessionCardActions}>
                    {focusedNodeId && (
                      <button style={styles.smallButton} onClick={backToSession}>
                        BACK TO SESSION
                      </button>
                    )}
                    <button style={styles.closeButton} onClick={closeSessionCard}>×</button>
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
          </>
        )}
      </main>

      <footer style={styles.footer}>
        <span style={styles.dim}>3D FORCE GRAPH · SELECT A SESSION TO EXPLORE ITS GALAXY</span>
      </footer>
    </div>
  );
}

function statusDotStyle(online: boolean): React.CSSProperties {
  return {
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: online ? '#00ff00' : '#ff0000',
    marginRight: 8,
    boxShadow: online ? '0 0 8px #00ff00' : '0 0 8px #ff0000',
  };
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    width: '100vw',
    height: '100vh',
    backgroundColor: '#000000',
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
    backgroundImage: 'radial-gradient(white 1px, transparent 1px)',
    backgroundSize: '50px 50px',
    opacity: 0.1,
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
    color: neuronTheme.accent.amber,
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  statusText: {
    fontSize: '11px',
    fontWeight: 'bold',
  },
  statPill: {
    fontSize: '10px',
    padding: '4px 8px',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '2px',
    border: '1px solid rgba(255, 255, 255, 0.2)',
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
    top: '80px',
    left: 0,
    right: 0,
    bottom: '40px',
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
    width: '250px',
    maxHeight: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
    padding: '16px',
    overflowY: 'auto',
    backdropFilter: 'blur(10px)',
  },
  panelTitle: {
    fontSize: '10px',
    fontWeight: 'bold',
    letterSpacing: '1px',
    marginBottom: '8px',
    color: neuronTheme.accent.amber,
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
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    color: neuronTheme.accent.amber,
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '2px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    textAlign: 'left',
  },
  colorDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    marginRight: 8,
  },
  sessionCard: {
    position: 'absolute',
    top: '16px',
    left: '16px',
    width: '300px',
    maxHeight: 'calc(100% - 32px)',
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '4px',
    padding: '12px',
    overflowY: 'auto',
    backdropFilter: 'blur(10px)',
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
    color: neuronTheme.accent.amber,
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
    border: '2px solid rgba(255, 255, 255, 0.1)',
    borderTop: '2px solid neuronTheme.accent.amber',
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
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: '8px 24px',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
    backdropFilter: 'blur(10px)',
    zIndex: 100,
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
