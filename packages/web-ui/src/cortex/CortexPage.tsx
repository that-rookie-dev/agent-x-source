/**
 * /cortex — the living-brain window.
 *
 * Fullscreen WebGL canvas (CortexRenderer) + glass HUD chrome. This page owns
 * the data policy: snapshot for small brains, viewport tiles for large ones,
 * SSE for live growth, and focus-mode neighborhood fetches.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import { setAuthToken } from '../api';
import { AGENTX_AUTH_TOKEN_KEY } from '../utils/client-storage';
import { cortexApi, type CortexMeta, type CortexNode, type CortexNodeDetail, type BrainEvent } from './api';
import { CortexRenderer } from './renderer/CortexRenderer';
import { CORTEX_BG_CSS } from './palette';
import { StatsBar } from './hud/StatsBar';
import { SearchBox } from './hud/SearchBox';
import { Legend } from './hud/Legend';
import { Inspector } from './hud/Inspector';
import { Controls } from './hud/Controls';
import { MONO, glassPanel } from './hud/hudStyles';

const SNAPSHOT_MAX = 3000;

/**
 * Restore the Bearer token on hard reloads of this window. The initial
 * `#tk=` hash handoff from the opener is consumed in main.tsx before React
 * mounts; this covers the in-memory token being lost on refresh.
 */
function restoreStoredToken(): void {
  const stored = sessionStorage.getItem(AGENTX_AUTH_TOKEN_KEY);
  if (stored) setAuthToken(stored);
}

export function CortexPage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<CortexRenderer | null>(null);
  const viewportModeRef = useRef(false);
  const viewportBusyRef = useRef(false);

  const [meta, setMeta] = useState<CortexMeta | null>(null);
  const [liveNodeDelta, setLiveNodeDelta] = useState(0);
  const [live, setLive] = useState(false);
  const [detail, setDetail] = useState<CortexNodeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [relayoutBusy, setRelayoutBusy] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectNode = useCallback(async (nodeId: string | null) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setSelected(nodeId);
    if (!nodeId) {
      setDetail(null);
      renderer.setFocus(null);
      return;
    }
    setDetailLoading(true);
    try {
      const [nodeDetail, neighborhood] = await Promise.all([
        cortexApi.node(nodeId),
        cortexApi.neighborhood(nodeId, 2),
      ]);
      setDetail(nodeDetail);
      renderer.setFocus([nodeId, ...neighborhood.nodes.map((n) => n.id)]);
      renderer.igniteNode(nodeId);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const hopToNode = useCallback(async (nodeId: string) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (!renderer.hasNode(nodeId)) {
      // Off-screen in viewport mode — pull its neighborhood in first.
      try {
        const hood = await cortexApi.neighborhood(nodeId, 1);
        renderer.applyEvents(hood.nodes.map((n) => ({
          event: 'NODE_CREATED' as const,
          nodeId: n.id, label: n.label, category: n.category,
          x: n.x, y: n.y, communityId: n.communityId,
          sourceId: n.sourceId, sessionId: n.sessionId,
          timestamp: n.createdAt,
        })));
      } catch { /* hop degrades to a no-op */ }
    }
    renderer.flyToNode(nodeId);
    void selectNode(nodeId);
  }, [selectNode]);

  const pickSearchResult = useCallback((node: CortexNode) => {
    void hopToNode(node.id);
  }, [hopToNode]);

  const relayout = useCallback(async () => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    setRelayoutBusy(true);
    try {
      await cortexApi.relayout();
      const snap = await cortexApi.snapshot({ limit: SNAPSHOT_MAX });
      renderer.setGraph(snap.nodes, snap.edges, { animate: true });
      const m = await cortexApi.meta();
      setMeta(m);
      setLiveNodeDelta(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Re-map failed');
    } finally {
      setRelayoutBusy(false);
    }
  }, []);

  useEffect(() => {
    restoreStoredToken();
    document.title = 'Agent-X — Neural Cortex';

    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let unsubscribeSse: (() => void) | null = null;

    const renderer = new CortexRenderer({
      onSelect: (id) => { void selectNode(id); },
      onHover: () => {},
      onViewportSettled: (bounds, zoom) => {
        if (!viewportModeRef.current || viewportBusyRef.current || disposed) return;
        viewportBusyRef.current = true;
        cortexApi.viewport(bounds, zoom)
          .then((vp) => {
            if (!disposed) rendererRef.current?.setGraph(vp.nodes, vp.edges);
          })
          .catch(() => {})
          .finally(() => { viewportBusyRef.current = false; });
      },
    });
    rendererRef.current = renderer;

    (async () => {
      try {
        await renderer.init(host);
        if (disposed) return;

        const m = await cortexApi.meta();
        if (disposed) return;
        setMeta(m);
        setEmpty(m.nodeCount === 0);
        viewportModeRef.current = m.nodeCount > SNAPSHOT_MAX;

        const snap = await cortexApi.snapshot({ limit: SNAPSHOT_MAX });
        if (disposed) return;
        renderer.setGraph(snap.nodes, snap.edges, { fit: true });

        unsubscribeSse = cortexApi.subscribeEvents((events: BrainEvent[]) => {
          if (disposed) return;
          renderer.applyEvents(events);
          const created = events.filter((e) => e.event === 'NODE_CREATED').length;
          if (created > 0) {
            setLiveNodeDelta((d) => d + created);
            setEmpty(false);
          }
        });
        setLive(true);
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : 'Failed to load cortex');
      }
    })();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void selectNode(null);
    };
    window.addEventListener('keydown', onKey);

    return () => {
      disposed = true;
      window.removeEventListener('keydown', onKey);
      unsubscribeSse?.();
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [selectNode]);

  return (
    <Box sx={{ position: 'fixed', inset: 0, bgcolor: CORTEX_BG_CSS, overflow: 'hidden' }}>
      <Box ref={hostRef} sx={{ position: 'absolute', inset: 0, '& canvas': { display: 'block' } }} />

      {/* HUD overlay — pointer events only on the panels themselves. */}
      <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <StatsBar meta={meta} liveNodeDelta={liveNodeDelta} live={live} />
        <SearchBox onPick={pickSearchResult} />
        <Legend meta={meta} />
        <Inspector
          detail={detail}
          loading={detailLoading}
          onClose={() => { void selectNode(null); }}
          onHop={(id) => { void hopToNode(id); }}
        />
        <Controls
          onZoomIn={() => rendererRef.current?.zoomIn()}
          onZoomOut={() => rendererRef.current?.zoomOut()}
          onFit={() => rendererRef.current?.fitAll()}
          onRelayout={() => { void relayout(); }}
          relayoutBusy={relayoutBusy}
        />

        {empty && (
          <Box sx={{
            ...glassPanel,
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            px: 4, py: 3, textAlign: 'center', maxWidth: 380, pointerEvents: 'auto',
          }}>
            <Box sx={{
              width: 14, height: 14, borderRadius: '50%', mx: 'auto', mb: 2,
              bgcolor: '#a78bfa', boxShadow: '0 0 24px #a78bfa',
              animation: 'cortex-seed-pulse 2.4s ease-in-out infinite',
              '@keyframes cortex-seed-pulse': {
                '0%, 100%': { transform: 'scale(0.8)', opacity: 0.6 },
                '50%': { transform: 'scale(1.15)', opacity: 1 },
              },
            }} />
            <Box sx={{ fontFamily: MONO, fontSize: '0.8rem', fontWeight: 600, color: '#e6ecff', letterSpacing: '0.12em', mb: 1 }}>
              CORTEX FORMING
            </Box>
            <Box sx={{ fontFamily: MONO, fontSize: '0.64rem', lineHeight: 1.7, color: 'rgba(148,163,216,0.85)' }}>
              Your agent's brain is empty — for now. Every conversation, document,
              and skill it learns will appear here as a living neuron. Come back
              and watch it grow.
            </Box>
          </Box>
        )}

        {error && (
          <Box sx={{
            ...glassPanel,
            position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
            px: 2, py: 1, fontFamily: MONO, fontSize: '0.64rem', color: '#fb7185', pointerEvents: 'auto',
          }}>
            {error}
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default CortexPage;
