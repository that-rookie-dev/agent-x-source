import { useEffect, useMemo, useRef, useState } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import { api, type MemoryNode, type MemorySource, type BrainActivityEvent, type Scorecard } from './api.ts';
import { neuronTheme } from './theme.ts';

const CATEGORY_COLORS: Record<string, string> = {
  persona: '#ff4d4d',
  tool: '#4da6ff',
  episodic: '#ffd24d',
  semantic: '#4dff88',
  source_doc: '#d24dff',
  system: '#ffffff',
};

const WS_URL = (import.meta.env.VITE_API_WS_URL as string) || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;

function useWebSocket(
  onEvent: (event: BrainActivityEvent) => void,
  onBenchmarkEvent: (type: string, data: Record<string, unknown>) => void,
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onBenchmarkEventRef = useRef(onBenchmarkEvent);
  onBenchmarkEventRef.current = onBenchmarkEvent;

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
          } else if (data.type === 'benchmark_event' || data.type === 'benchmark_result' || data.type === 'benchmark_error') {
            onBenchmarkEventRef.current(data.type as string, data as Record<string, unknown>);
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

function nodeColor(category: string, sourceColor?: string | null): string {
  return sourceColor || CATEGORY_COLORS[category] || neuronTheme.accent.amber;
}

export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const [selectedNode, setSelectedNode] = useState<MemoryNode | null>(null);
  const [sources, setSources] = useState<MemorySource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [soloMode, setSoloMode] = useState(false);
  const [stats, setStats] = useState({ nodes: 0, edges: 0, communities: 0, epoch: 0 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dbStatus, setDbStatus] = useState({ connected: false });
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [benchmarkMode, setBenchmarkMode] = useState(false);
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [scorecards, setScorecards] = useState<Scorecard[]>([]);
  const [benchmarkEvent, setBenchmarkEvent] = useState<string | null>(null);
  const [lodBand, setLodBand] = useState<'detail' | 'medium' | 'overview'>('detail');
  const lodBandRef = useRef(lodBand);
  useEffect(() => { lodBandRef.current = lodBand; }, [lodBand]);
  const sourceMap = useMemo(() => {
    const map = new Map<string, MemorySource>();
    for (const s of sources) map.set(s.id, s);
    return map;
  }, [sources]);

  const initialGraph = useMemo(() => new Graph(), []);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const [g, status, srcs, sc] = await Promise.all([
          api.graph(500, undefined, benchmarkMode ? 'benchmark' : undefined, benchmarkMode ? true : undefined),
          api.dbStatus(),
          api.sources(),
          api.scorecards(),
        ]);
        if (!mounted) return;
        setDbStatus({ connected: status.connected });
        setSources(srcs);
        setScorecards(sc.scorecards);
        graphRef.current = initialGraph;
        for (const n of g.nodes) {
          if (!initialGraph.hasNode(n.id)) {
            const sourceColor = n.sourceId ? sourceMap.get(n.sourceId)?.colorHex ?? null : null;
            initialGraph.addNode(n.id, {
              label: n.label,
              category: n.category,
              content: n.content,
              sourceId: n.sourceId,
              x: n.x ?? 0,
              y: n.y ?? 0,
              size: 5,
              color: nodeColor(n.category, sourceColor),
              originalColor: nodeColor(n.category, sourceColor),
              degree: 0,
            });
          }
        }
        for (const e of g.edges) {
          if (!initialGraph.hasEdge(e.id) && initialGraph.hasNode(e.sourceNodeId) && initialGraph.hasNode(e.targetNodeId)) {
            initialGraph.addEdgeWithKey(e.id, e.sourceNodeId, e.targetNodeId, {
              weight: e.weight,
              size: 1 + e.weight * 2,
              color: 'rgba(255,255,255,0.25)',
              type: 'line',
            });
          }
        }
        initialGraph.forEachNode((node) => {
          initialGraph.setNodeAttribute(node, 'degree', initialGraph.degree(node));
        });
        setStats((s) => ({ ...s, nodes: initialGraph.order, edges: initialGraph.size }));
        setError(null);
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : 'Failed to load neural data');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [initialGraph, sourceMap]);

  useEffect(() => {
    if (!containerRef.current || !graphRef.current || loading || error) return;
    const sigma = new Sigma(graphRef.current, containerRef.current, {
      renderLabels: true,
      labelSize: 12,
      labelColor: { color: '#ffffff' },
      defaultEdgeType: 'line',
      zIndex: true,
      nodeReducer: (_node, attrs) => applyLodNodeAttributes(attrs, lodBandRef.current),
      edgeReducer: (_edge, attrs) => applyLodEdgeAttributes(attrs, lodBandRef.current),
    });
    sigmaRef.current = sigma;

    const updateLod = () => {
      const ratio = sigma.getCamera().getState().ratio;
      const nextBand = ratio > 2 ? 'overview' : ratio > 0.6 ? 'medium' : 'detail';
      setLodBand((current) => {
        if (current !== nextBand) {
          sigma.refresh();
        }
        return nextBand;
      });
    };
    sigma.getCamera().on('updated', updateLod);
    updateLod();

    sigma.on('clickNode', ({ node }) => {
      const attrs = graphRef.current?.getNodeAttributes(node) as Record<string, unknown> | undefined;
      if (attrs) {
        setSelectedNode({
          id: node,
          label: attrs.label as string,
          category: attrs.category as string,
          content: attrs.content as string,
          status: 'active',
          x: attrs.x as number | null,
          y: attrs.y as number | null,
          sourceId: (attrs.sourceId as string) || null,
          sessionId: null,
          agentId: null,
          confidence: 1,
          createdAt: '',
          updatedAt: '',
          accessCount: 0,
          lastAccessedAt: null,
        } as MemoryNode);
      }
    });

    sigma.on('enterNode', ({ node }) => {
      const graph = graphRef.current;
      if (!graph) return;
      graph.setNodeAttribute(node, 'size', 10);
      graph.setNodeAttribute(node, 'color', '#ffffff');
      graph.forEachNeighbor(node, (neighbor) => {
        graph.setNodeAttribute(neighbor, 'color', '#ffffff');
      });
    });

    sigma.on('leaveNode', ({ node }) => {
      const graph = graphRef.current;
      if (!graph) return;
      graph.setNodeAttribute(node, 'size', 5);
      graph.setNodeAttribute(node, 'color', graph.getNodeAttribute(node, 'originalColor'));
      graph.forEachNeighbor(node, (neighbor) => {
        graph.setNodeAttribute(neighbor, 'color', graph.getNodeAttribute(neighbor, 'originalColor'));
      });
      applySoloFilter(graph, selectedSourceId, soloMode);
    });

    return () => {
      sigma.getCamera().off('updated', updateLod);
      sigma.kill();
      sigmaRef.current = null;
    };
  }, [loading, error, selectedSourceId, soloMode]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    applySoloFilter(graph, selectedSourceId, soloMode);
  }, [selectedSourceId, soloMode]);

  // Active viewport streaming: fetch nodes/edges inside the visible graph bounds as the camera moves.
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma || loading || error) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const streamViewport = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const graph = graphRef.current;
        if (!graph) return;
        const camera = sigma.getCamera();
        const state = camera.getState() as { x: number; y: number; ratio: number; angle: number };
        const container = containerRef.current;
        if (!container) return;
        const width = container.clientWidth * state.ratio;
        const height = container.clientHeight * state.ratio;
        const xMin = state.x - width / 2;
        const xMax = state.x + width / 2;
        const yMin = state.y - height / 2;
        const yMax = state.y + height / 2;
        api
          .viewport(xMin, yMin, xMax, yMax, state.ratio, 2000)
          .then(({ nodes, edges, epoch, band }) => {
            const graph = graphRef.current;
            if (!graph) return;
            const bandName = band === 'A' ? 'detail' : band === 'B' ? 'medium' : 'overview';
            setLodBand((current) => {
              if (current !== bandName) {
                sigma.refresh();
              }
              return bandName;
            });
            for (const n of nodes) {
              if (!graph.hasNode(n.id)) {
                const sourceColor = n.sourceId ? sourceMap.get(n.sourceId)?.colorHex ?? null : null;
                graph.addNode(n.id, {
                  label: n.label,
                  category: n.category,
                  content: n.content,
                  sourceId: n.sourceId,
                  x: n.x ?? 0,
                  y: n.y ?? 0,
                  size: 5,
                  color: nodeColor(n.category, sourceColor),
                  originalColor: nodeColor(n.category, sourceColor),
                  degree: 0,
                });
              }
            }
            for (const e of edges) {
              if (!graph.hasEdge(e.id) && graph.hasNode(e.sourceNodeId) && graph.hasNode(e.targetNodeId)) {
                graph.addEdgeWithKey(e.id, e.sourceNodeId, e.targetNodeId, {
                  weight: e.weight,
                  size: 1 + e.weight * 2,
                  color: 'rgba(255,255,255,0.25)',
                  type: 'line',
                });
              }
            }
            graph.forEachNode((node) => graph.setNodeAttribute(node, 'degree', graph.degree(node)));
            setStats((s) => ({ ...s, nodes: graph.order, edges: graph.size, epoch }));
            sigma.refresh();
          })
          .catch(() => {});
      }, 250);
    };
    sigma.on('afterRender', streamViewport);
    streamViewport();
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      sigma.off('afterRender', streamViewport);
    };
  }, [loading, error, sourceMap]);

  // Layout-epoch polling: if the server bumps the epoch, re-fetch the full graph so coordinates stay valid.
  useEffect(() => {
    let lastEpoch = -1;
    const poll = setInterval(() => {
      api.layoutEpoch()
        .then(({ epoch }) => {
          if (lastEpoch !== -1 && epoch !== lastEpoch) {
            reloadGraph();
          }
          lastEpoch = epoch;
        })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(poll);
  }, []);

  useWebSocket(
    (event) => {
      const graph = graphRef.current;
      if (!graph) return;
      if (event.type === 'neuron_created') {
      if (!graph.hasNode(event.nodeId)) {
        // Neurogenesis animation: spawn from 0 to full size with a bright flash
        const originalColor = nodeColor(event.category, null);
        graph.addNode(event.nodeId, {
          label: event.label,
          category: event.category,
          content: event.content,
          sourceId: null,
          x: event.x ?? 0,
          y: event.y ?? 0,
          size: 0,
          color: '#ffffff',
          originalColor,
          animation: 'neurogenesis',
        });
        setStats((s) => ({ ...s, nodes: s.nodes + 1 }));
        let step = 0;
        const neurogenesis = setInterval(() => {
          step++;
          const targetSize = 5;
          const size = Math.min(targetSize, (step / 10) * targetSize);
          const color = step < 6 ? '#ffffff' : originalColor;
          graph.setNodeAttribute(event.nodeId, 'size', size);
          graph.setNodeAttribute(event.nodeId, 'color', color);
          if (step >= 10) {
            clearInterval(neurogenesis);
            graph.setNodeAttribute(event.nodeId, 'size', targetSize);
            graph.setNodeAttribute(event.nodeId, 'color', originalColor);
          }
        }, 30);
      }
    } else if (event.type === 'synapse_bound') {
      if (!graph.hasEdge(event.edgeId) && graph.hasNode(event.sourceNodeId) && graph.hasNode(event.targetNodeId)) {
        // Synaptogenesis animation: bright beam that fades to the normal edge
        graph.addEdgeWithKey(event.edgeId, event.sourceNodeId, event.targetNodeId, {
          weight: event.weight,
          size: 4,
          color: '#ffffff',
          type: 'line',
          animation: 'synaptogenesis',
        });
        setStats((s) => ({ ...s, edges: s.edges + 1 }));
        setTimeout(() => {
          graph.setEdgeAttribute(event.edgeId, 'size', 1 + event.weight * 2);
          graph.setEdgeAttribute(event.edgeId, 'color', 'rgba(255,255,255,0.25)');
        }, 300);
      }
    } else if (event.type === 'neuron_fired') {
      if (graph.hasNode(event.nodeId)) {
        graph.setNodeAttribute(event.nodeId, 'size', 10);
        graph.setNodeAttribute(event.nodeId, 'color', '#ffffff');
        setTimeout(() => {
          graph.setNodeAttribute(event.nodeId, 'size', 5);
          graph.setNodeAttribute(event.nodeId, 'color', graph.getNodeAttribute(event.nodeId, 'originalColor'));
        }, 400);
      }
    } else if (event.type === 'neuron_decayed') {
      if (graph.hasNode(event.nodeId)) {
        graph.setNodeAttribute(event.nodeId, 'size', 8);
        graph.setNodeAttribute(event.nodeId, 'color', '#ff0000');
        graph.setNodeAttribute(event.nodeId, 'originalColor', '#ff0000');
        let flashes = 0;
        const flash = setInterval(() => {
          const color = flashes % 2 === 0 ? '#ff0000' : (graph.getNodeAttribute(event.nodeId, 'originalColor') as string);
          graph.setNodeAttribute(event.nodeId, 'color', color);
          graph.setNodeAttribute(event.nodeId, 'size', flashes % 2 === 0 ? 12 : 4);
          flashes++;
          if (flashes >= 6) {
            clearInterval(flash);
            graph.setNodeAttribute(event.nodeId, 'color', '#ff0000');
            graph.setNodeAttribute(event.nodeId, 'size', 4);
            graph.setNodeAttribute(event.nodeId, 'originalColor', '#ff0000');
          }
        }, 200);
      }
    } else if (event.type === 'cluster_layout_updated') {
      setStats((s) => ({ ...s, epoch: event.epoch }));
      reloadGraph();
    }
  },
  (type, data) => {
    if (type === 'benchmark_event') {
      const event = data.event as { type: string; progress?: { testName: string; status: string; error?: string }; totalScore?: number; maxScore?: number };
      if (event.progress) {
        setBenchmarkEvent(`${event.progress.testName}: ${event.progress.status}${event.progress.error ? ` — ${event.progress.error}` : ''}`);
      } else if (event.totalScore != null) {
        setBenchmarkEvent(`Benchmark complete: ${event.totalScore}/${event.maxScore}`);
      }
    } else if (type === 'benchmark_result') {
      const result = data.result as { totalScore: number; maxScore: number };
      setBenchmarkEvent(`Benchmark complete: ${result.totalScore}/${result.maxScore}`);
      setBenchmarkRunning(false);
      api.scorecards().then(({ scorecards }) => setScorecards(scorecards)).catch(() => {});
    } else if (type === 'benchmark_error') {
      setBenchmarkEvent(data.error as string);
      setBenchmarkRunning(false);
    }
  },
  );

  async function reloadGraph() {
    try {
      const g = await api.graph(500);
      const graph = graphRef.current;
      if (!graph) return;
      for (const n of g.nodes) {
        if (graph.hasNode(n.id)) {
          graph.setNodeAttribute(n.id, 'x', n.x ?? 0);
          graph.setNodeAttribute(n.id, 'y', n.y ?? 0);
        } else {
          const sourceColor = n.sourceId ? sourceMap.get(n.sourceId)?.colorHex ?? null : null;
          graph.addNode(n.id, {
            label: n.label,
            category: n.category,
            content: n.content,
            sourceId: n.sourceId,
            x: n.x ?? 0,
            y: n.y ?? 0,
            size: 5,
            color: nodeColor(n.category, sourceColor),
            originalColor: nodeColor(n.category, sourceColor),
          });
        }
      }
      setStats((s) => ({ ...s, nodes: graph.order, edges: graph.size }));
      sigmaRef.current?.refresh();
    } catch (e) {
      console.error('reload graph failed', e);
    }
  }

  async function runLouvain() {
    setLayoutBusy(true);
    try {
      const result = await api.layout();
      setStats((s) => ({ ...s, communities: result.communities, epoch: result.epoch }));
      await reloadGraph();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Layout failed');
    } finally {
      setLayoutBusy(false);
    }
  }

  const handleReset = () => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    sigma.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
  };

  const handleRunBenchmark = async () => {
    if (benchmarkRunning) return;
    setBenchmarkRunning(true);
    setBenchmarkEvent('Starting benchmark...');
    try {
      await api.runBenchmark('default', 'local', 'benchmark');
    } catch (e) {
      setBenchmarkEvent(e instanceof Error ? e.message : 'Benchmark failed');
      setBenchmarkRunning(false);
    }
  };

  const handleWipeBenchmark = async () => {
    try {
      await api.wipeBenchmark();
      setBenchmarkEvent('Benchmark data wiped');
      if (benchmarkMode) {
        const graph = graphRef.current;
        if (graph) {
          graph.clear();
          setStats({ nodes: 0, edges: 0, communities: 0, epoch: 0 });
        }
      }
    } catch (e) {
      setBenchmarkEvent(e instanceof Error ? e.message : 'Wipe failed');
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.gridOverlay} />

      <header style={styles.header}>
        <div style={styles.badge}>AGENT-X // NEURAL BRAIN</div>
        <div style={styles.statusRow}>
          <span style={statusDotStyle(dbStatus.connected)} />
          <span style={styles.statusText}>{dbStatus.connected ? 'POSTGRES ONLINE' : 'POSTGRES OFFLINE'}</span>
          <span style={styles.statPill}>NODES {stats.nodes}</span>
          <span style={styles.statPill}>EDGES {stats.edges}</span>
          <span style={styles.statPill}>EPOCH {stats.epoch}</span>
          <span style={styles.statPill}>{lodLabel(lodBand)}</span>
          <button style={styles.button} onClick={runLouvain} disabled={layoutBusy}>
            {layoutBusy ? 'LAYOUT...' : 'RE-LAYOUT'}
          </button>
          <button style={styles.button} onClick={handleReset}>RESET VIEW</button>
          <button
            style={benchmarkMode ? { ...styles.button, ...styles.buttonActive } : styles.button}
            onClick={() => setBenchmarkMode((v) => !v)}
          >
            BENCHMARK
          </button>
          {benchmarkMode && (
            <>
              <button style={styles.button} onClick={handleRunBenchmark} disabled={benchmarkRunning}>
                {benchmarkRunning ? 'RUNNING...' : 'RUN SUITE'}
              </button>
              <button style={styles.button} onClick={handleWipeBenchmark}>WIPE</button>
            </>
          )}
        </div>
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
            <div style={styles.sourcePanel}>
              <div style={styles.panelTitle}>SOURCES</div>
              <div style={styles.sourceList}>
                <button
                  style={selectedSourceId === null ? styles.sourceActive : styles.sourceButton}
                  onClick={() => { setSelectedSourceId(null); setSoloMode(false); }}
                >
                  ALL SOURCES
                </button>
                {sources.map((s) => (
                  <button
                    key={s.id}
                    style={selectedSourceId === s.id ? styles.sourceActive : styles.sourceButton}
                    onClick={() => setSelectedSourceId(s.id)}
                  >
                    <span style={{ ...styles.sourceDot, background: s.colorHex }} />
                    {s.name}
                  </button>
                ))}
              </div>
              <div style={styles.toggleRow}>
                <label style={styles.toggleLabel}>
                  <input
                    type="checkbox"
                    checked={soloMode}
                    onChange={(e) => setSoloMode(e.target.checked)}
                    style={styles.toggleInput}
                  />
                  SOLO / ISOLATE
                </label>
              </div>
              {benchmarkMode && (
                <div style={styles.benchmarkPanel}>
                  <div style={styles.panelTitle}>BENCHMARK</div>
                  <p style={styles.dim}>{benchmarkEvent || 'Ready'}</p>
                  <div style={styles.scorecardList}>
                    {scorecards.slice(0, 5).map((sc) => (
                      <div key={sc.id} style={styles.scorecard}>
                        <span style={styles.scorecardModel}>{sc.model}</span>
                        <span style={styles.scorecardScore}>{sc.totalScore}/{sc.maxScore}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {selectedNode && (
              <div style={styles.inspector}>
                <div style={styles.inspectorHeader}>
                  <span>{selectedNode.label.toUpperCase()}</span>
                  <button style={styles.closeButton} onClick={() => setSelectedNode(null)}>×</button>
                </div>
                <div style={styles.inspectorMeta}>
                  <span style={{ color: nodeColor(selectedNode.category, selectedNode.sourceId ? sourceMap.get(selectedNode.sourceId)?.colorHex ?? null : null) }}>
                    {selectedNode.category.toUpperCase()}
                  </span>
                  <span>ID {selectedNode.id.slice(0, 8)}</span>
                </div>
                <p style={styles.inspectorContent}>{selectedNode.content}</p>
              </div>
            )}
          </>
        )}
      </main>

      <footer style={styles.footer}>
        <span style={styles.dim}>PORT 3334 // BLACK & WHITE + AMBER ACCENT // SPACE+Mil SPEC</span>
      </footer>
    </div>
  );
}

function applySoloFilter(graph: Graph, selectedSourceId: string | null, soloMode: boolean) {
  graph.forEachNode((node, attrs) => {
    const sourceId = (attrs.sourceId as string) || null;
    const isTarget = selectedSourceId === null || sourceId === selectedSourceId;
    if (soloMode && selectedSourceId !== null) {
      graph.setNodeAttribute(node, 'color', isTarget ? (attrs.originalColor as string) : 'rgba(255,255,255,0.05)');
      graph.setNodeAttribute(node, 'hidden', !isTarget);
    } else {
      graph.setNodeAttribute(node, 'color', attrs.originalColor as string);
      graph.setNodeAttribute(node, 'hidden', false);
    }
  });
  graph.forEachEdge((edge, _attrs, source, target) => {
    const sourceVisible = !graph.getNodeAttribute(source, 'hidden');
    const targetVisible = !graph.getNodeAttribute(target, 'hidden');
    graph.setEdgeAttribute(edge, 'hidden', !(sourceVisible && targetVisible));
  });
}

function applyLodNodeAttributes(attrs: Record<string, unknown>, band: 'detail' | 'medium' | 'overview'): Record<string, unknown> {
  const degree = (attrs.degree as number) ?? 0;
  if (band === 'overview') {
    return {
      ...attrs,
      label: '',
      size: 2,
      zIndex: 0,
    };
  }
  if (band === 'medium') {
    return {
      ...attrs,
      label: degree > 3 ? (attrs.label as string) : '',
      size: degree > 3 ? 6 : 4,
      zIndex: degree > 3 ? 1 : 0,
    };
  }
  return {
    ...attrs,
    label: attrs.label as string,
    size: 8,
    zIndex: 2,
  };
}

function applyLodEdgeAttributes(attrs: Record<string, unknown>, band: 'detail' | 'medium' | 'overview'): Record<string, unknown> {
  const weight = (attrs.weight as number) ?? 0;
  if (band === 'overview') {
    return { ...attrs, size: 0.5, hidden: weight < 0.5 };
  }
  if (band === 'medium') {
    return { ...attrs, size: 1 + weight, hidden: false };
  }
  return { ...attrs, size: 1.5 + weight * 2, hidden: false };
}

function lodLabel(band: 'detail' | 'medium' | 'overview'): string {
  if (band === 'detail') return 'LOD // DETAIL';
  if (band === 'medium') return 'LOD // MEDIUM';
  return 'LOD // OVERVIEW';
}

function statusDotStyle(online: boolean): React.CSSProperties {
  return {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: online ? neuronTheme.accent.green : neuronTheme.accent.red,
    boxShadow: online ? `0 0 8px ${neuronTheme.accent.green}` : `0 0 8px ${neuronTheme.accent.red}`,
  };
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: neuronTheme.bg.void,
    color: neuronTheme.text.primary,
    fontFamily: neuronTheme.font,
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  gridOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundImage: `
      linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)
    `,
    backgroundSize: '40px 40px',
    pointerEvents: 'none',
    zIndex: 0,
  },
  header: {
    position: 'relative',
    zIndex: 2,
    padding: '16px 24px',
    borderBottom: `1px solid ${neuronTheme.border.default}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'rgba(0,0,0,0.7)',
    backdropFilter: 'blur(4px)',
  },
  badge: {
    fontSize: '0.85rem',
    fontWeight: 700,
    letterSpacing: '2px',
    color: neuronTheme.text.primary,
    border: `1px solid ${neuronTheme.border.strong}`,
    padding: '6px 12px',
    borderRadius: '4px',
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  statusText: {
    fontSize: '0.65rem',
    letterSpacing: '1.5px',
    color: neuronTheme.text.secondary,
  },
  statPill: {
    fontSize: '0.65rem',
    letterSpacing: '1px',
    color: neuronTheme.text.primary,
    border: `1px solid ${neuronTheme.border.default}`,
    padding: '4px 8px',
    borderRadius: '4px',
  },
  button: {
    background: 'transparent',
    border: `1px solid ${neuronTheme.border.strong}`,
    color: neuronTheme.text.primary,
    fontSize: '0.65rem',
    letterSpacing: '1px',
    padding: '6px 10px',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  buttonActive: {
    background: neuronTheme.border.default,
    color: neuronTheme.accent.amber,
  },
  main: {
    position: 'relative',
    zIndex: 1,
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  center: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: '16px',
  },
  spinner: {
    width: 32,
    height: 32,
    border: `2px solid ${neuronTheme.border.strong}`,
    borderTopColor: neuronTheme.accent.amber,
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  hudText: {
    fontSize: '0.75rem',
    letterSpacing: '2px',
    color: neuronTheme.text.dim,
  },
  canvas: {
    flex: 1,
    position: 'relative',
    background: neuronTheme.bg.void,
  },
  panel: {
    background: neuronTheme.bg.panel,
    border: `1px solid ${neuronTheme.border.default}`,
    borderRadius: '6px',
    padding: '24px',
    margin: '24px',
  },
  alert: {
    color: neuronTheme.accent.red,
    fontSize: '0.85rem',
    margin: 0,
  },
  sourcePanel: {
    position: 'absolute',
    left: 24,
    top: 24,
    bottom: 24,
    width: 220,
    background: 'rgba(0,0,0,0.85)',
    border: `1px solid ${neuronTheme.border.default}`,
    borderRadius: '6px',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    zIndex: 3,
    overflow: 'hidden',
  },
  panelTitle: {
    fontSize: '0.75rem',
    letterSpacing: '2px',
    color: neuronTheme.accent.amber,
    marginBottom: '8px',
  },
  sourceList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    overflowY: 'auto',
  },
  sourceButton: {
    background: 'transparent',
    border: `1px solid ${neuronTheme.border.default}`,
    color: neuronTheme.text.secondary,
    fontSize: '0.7rem',
    textAlign: 'left',
    padding: '8px 10px',
    borderRadius: '4px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  sourceActive: {
    background: neuronTheme.border.default,
    border: `1px solid ${neuronTheme.border.strong}`,
    color: neuronTheme.text.primary,
    fontSize: '0.7rem',
    textAlign: 'left',
    padding: '8px 10px',
    borderRadius: '4px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  sourceDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
  },
  toggleRow: {
    borderTop: `1px solid ${neuronTheme.border.default}`,
    paddingTop: '12px',
  },
  toggleLabel: {
    fontSize: '0.65rem',
    letterSpacing: '1px',
    color: neuronTheme.text.secondary,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
  },
  toggleInput: {
    accentColor: neuronTheme.accent.amber,
  },
  inspector: {
    position: 'absolute',
    right: 24,
    top: 24,
    bottom: 24,
    width: 320,
    background: 'rgba(0,0,0,0.85)',
    border: `1px solid ${neuronTheme.border.default}`,
    borderRadius: '6px',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    zIndex: 3,
  },
  inspectorHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '0.85rem',
    fontWeight: 700,
    letterSpacing: '1px',
  },
  closeButton: {
    background: 'transparent',
    border: 'none',
    color: neuronTheme.text.primary,
    fontSize: '1.2rem',
    cursor: 'pointer',
  },
  inspectorMeta: {
    display: 'flex',
    gap: '12px',
    fontSize: '0.65rem',
    letterSpacing: '1px',
    color: neuronTheme.text.secondary,
  },
  inspectorContent: {
    fontSize: '0.8rem',
    lineHeight: 1.6,
    color: neuronTheme.text.secondary,
    whiteSpace: 'pre-wrap',
  },
  benchmarkPanel: {
    marginTop: 'auto',
    borderTop: `1px solid ${neuronTheme.border.default}`,
    paddingTop: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  scorecardList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  scorecard: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.7rem',
    padding: '6px 8px',
    border: `1px solid ${neuronTheme.border.default}`,
    borderRadius: '4px',
  },
  scorecardModel: {
    color: neuronTheme.text.secondary,
  },
  scorecardScore: {
    color: neuronTheme.accent.amber,
    fontWeight: 700,
  },
  footer: {
    position: 'relative',
    zIndex: 2,
    padding: '12px 24px',
    borderTop: `1px solid ${neuronTheme.border.default}`,
    textAlign: 'center',
  },
  dim: {
    color: neuronTheme.text.dim,
    fontSize: '0.75rem',
  },
};
