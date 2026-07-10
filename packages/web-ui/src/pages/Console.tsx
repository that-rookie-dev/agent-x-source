import { Component, type ReactNode, lazy, Suspense, useState, useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Sidebar } from '../components/Sidebar';
import { Footer } from '../components/Footer';
import { LogsPanel } from '../components/LogsPanel';
import { ChatPanel } from '../components/ChatPanel';
import { AgentXCoreChat } from './AgentXCoreChat';
import { NotificationToast } from '../components/NotificationToast';

// Secondary panels are code-split so the initial chunk only carries the chat
// surface — they load on first navigation and stay cached afterwards.
const ToolsPanel = lazy(() => import('../components/ToolsPanel').then(m => ({ default: m.ToolsPanel })));
const PluginsPanel = lazy(() => import('../components/PluginsPanel').then(m => ({ default: m.PluginsPanel })));
const ChannelsPanel = lazy(() => import('../components/ChannelsPanel').then(m => ({ default: m.ChannelsPanel })));
const SettingsPanel = lazy(() => import('../components/SettingsPanel').then(m => ({ default: m.SettingsPanel })));
const AutomationPanel = lazy(() => import('../components/AutomationPanel').then(m => ({ default: m.AutomationPanel })));
const RagStudioPanel = lazy(() => import('../components/RagStudioPanel').then(m => ({ default: m.RagStudioPanel })));
const OrchestratorPanel = lazy(() => import('../components/OrchestratorPanel').then(m => ({ default: m.OrchestratorPanel })));
const CrewsPanel = lazy(() => import('../components/CrewsPanel').then(m => ({ default: m.CrewsPanel })));
const SoulPanel = lazy(() => import('../components/SoulPanel').then(m => ({ default: m.SoulPanel })));
const McpStorePage = lazy(() => import('../components/integrations/McpStorePage').then(m => ({ default: m.McpStorePage })));
const NotificationsPanel = lazy(() => import('../components/NotificationsPanel').then(m => ({ default: m.NotificationsPanel })));
import { colors, alphaColor } from '../theme';
import { useApp } from '../store/AppContext';
import { useNeuralBrainSupported } from '../hooks/useSystemCapabilities';

export type PanelId = 'chat' | 'agent-x' | 'tools' | 'plugins' | 'channels' | 'settings' | 'automation' | 'rag-studio' | 'orchestrator' | 'crews' | 'soul' | 'mcp-store' | 'notifications';

// Error boundary to prevent panel crashes from taking down the app
class PanelErrorBoundary extends Component<{ children: ReactNode }, { error: string | null; stack: string | null }> {
  state = { error: null as string | null, stack: null as string | null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Keep stack in state for the fallback UI; also log for desktop/devtools capture.
    console.error('[PanelErrorBoundary]', error, info.componentStack);
    this.setState({ stack: info.componentStack ?? null });
  }
  render() {
    if (this.state.error) {
      return (
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <Typography sx={{ color: colors.accent.red, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8rem', mb: 1 }}>
            Panel failed to load
          </Typography>
          <Typography sx={{ color: colors.text.dim, fontSize: '0.7rem', mb: 1 }}>{this.state.error}</Typography>
          {this.state.stack && (
            <Typography
              component="pre"
              sx={{
                mt: 1.5, mx: 'auto', maxWidth: 560, textAlign: 'left',
                color: colors.text.dim, fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace",
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', opacity: 0.85,
              }}
            >
              {this.state.stack.trim()}
            </Typography>
          )}
          <Typography
            component="button"
            onClick={() => this.setState({ error: null, stack: null })}
            sx={{
              mt: 2, px: 1.5, py: 0.5, cursor: 'pointer',
              color: colors.text.secondary, fontSize: '0.65rem', fontFamily: "'JetBrains Mono', monospace",
              bgcolor: 'transparent', border: `1px solid ${colors.border.default}`, borderRadius: 1,
              '&:hover': { color: colors.text.primary, borderColor: colors.text.dim },
            }}
          >
            Retry panel
          </Typography>
        </Box>
      );
    }
    return this.props.children;
  }
}

const BOTTOM_PANEL_MIN_HEIGHT = 100;
const BOTTOM_PANEL_DEFAULT_HEIGHT = 200;
const RIGHT_PANEL_MIN_WIDTH = 200;
const RIGHT_PANEL_DEFAULT_WIDTH = 350;

export function Console() {
  const { panel, sessionId } = useParams<{ panel?: string; sessionId?: string }>();
  const navigate = useNavigate();
  const { unreadNotificationCount } = useApp();
  const neuralBrainSupported = useNeuralBrainSupported();
  const activePanel = (sessionId ? 'chat' : (panel || 'agent-x')) as PanelId;
  useEffect(() => {
    if (panel === 'health') navigate('/console/agent-x', { replace: true });
    if (panel === 'rag-studio' && !neuralBrainSupported) navigate('/console/agent-x', { replace: true });
  }, [panel, navigate, neuralBrainSupported]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsPosition, setLogsPosition] = useState<'bottom' | 'right'>('bottom');
  const [panelSize, setPanelSize] = useState(BOTTOM_PANEL_DEFAULT_HEIGHT);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleNavigate = (p: PanelId) => {
    navigate(`/console/${p}`);
  };

  useEffect(() => {
    if (!window.agentx?.onNotificationClick) return;
    return window.agentx.onNotificationClick(() => navigate('/console/notifications'));
  }, [navigate]);

  const toggleLogs = useCallback(() => {
    setLogsOpen((prev) => !prev);
  }, []);

  const togglePosition = useCallback(() => {
    setLogsPosition((prev) => {
      const next = prev === 'bottom' ? 'right' : 'bottom';
      setPanelSize(next === 'bottom' ? BOTTOM_PANEL_DEFAULT_HEIGHT : RIGHT_PANEL_DEFAULT_WIDTH);
      return next;
    });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startPos = logsPosition === 'bottom' ? e.clientY : e.clientX;
    const startSize = panelSize;

    const onMove = (ev: globalThis.MouseEvent) => {
      if (!dragging.current) return;
      const currentPos = logsPosition === 'bottom' ? ev.clientY : ev.clientX;
      const delta = startPos - currentPos;
        const newSize = Math.max(
          logsPosition === 'bottom' ? BOTTOM_PANEL_MIN_HEIGHT : RIGHT_PANEL_MIN_WIDTH,
          startSize + delta
        );
      setPanelSize(newSize);
    };

    const onUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [panelSize, logsPosition]);

  const isVertical = logsPosition === 'right';

  const logsContent = logsOpen ? (
    <Box sx={{
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      ...(isVertical
        ? { width: panelSize, borderLeft: `1px solid ${colors.border.default}` }
        : { height: panelSize, borderTop: `1px solid ${colors.border.default}` }
      ),
    }}>
      {/* Drag handle */}
      <Box
        onMouseDown={handleMouseDown}
        sx={{
          position: 'absolute',
          ...(isVertical
            ? { left: -3, top: 0, bottom: 0, width: 6, cursor: 'col-resize' }
            : { top: -3, left: 0, right: 0, height: 6, cursor: 'row-resize' }
          ),
          zIndex: 10,
          '&:hover': { bgcolor: alphaColor(colors.accent.blue, '30') },
          transition: 'background-color 0.15s',
        }}
      />
      <LogsPanel onClose={() => setLogsOpen(false)} onTogglePosition={togglePosition} position={logsPosition} />
    </Box>
  ) : null;

  return (
    <Box ref={containerRef} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Main content + right-side logs */}
      <Box sx={{ flex: 1, display: 'flex', minHeight: 0, minWidth: 0 }}>
        <Sidebar active={activePanel} onNavigate={handleNavigate} highlightCrews={false} unreadNotificationCount={unreadNotificationCount} />
        <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden', flexDirection: isVertical ? 'row' : 'column' }}>
          <Box sx={{ flex: 1, overflow: 'hidden' }}>
            <PanelErrorBoundary key={activePanel}>
              <Suspense fallback={null}>
                {activePanel === 'chat' && <ChatPanel sessionId={sessionId} />}
                {activePanel === 'agent-x' && <AgentXCoreChat />}
                {activePanel === 'tools' && <ToolsPanel />}
                {activePanel === 'plugins' && <PluginsPanel />}
                {activePanel === 'channels' && <ChannelsPanel />}
                {activePanel === 'settings' && <SettingsPanel />}
                {activePanel === 'automation' && <AutomationPanel />}
                {activePanel === 'rag-studio' && <RagStudioPanel />}
                {activePanel === 'orchestrator' && <OrchestratorPanel />}
                {activePanel === 'crews' && <CrewsPanel />}
                {activePanel === 'soul' && <SoulPanel />}
                {activePanel === 'mcp-store' && <McpStorePage />}
                {activePanel === 'notifications' && <NotificationsPanel />}
              </Suspense>
            </PanelErrorBoundary>
          </Box>
          {isVertical && logsContent}
        </Box>
      </Box>

      {/* Bottom logs (below main content, above footer) */}
      {!isVertical && logsContent}

      <Footer onToggleLogs={toggleLogs} logsOpen={logsOpen} />
      <NotificationToast />
    </Box>
  );
}
