import { Component, type ReactNode, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Sidebar } from '../components/Sidebar';
import { Footer } from '../components/Footer';
import { LogsPanel } from '../components/LogsPanel';
import { ChatPanel } from '../components/ChatPanel';
import { ToolsPanel } from '../components/ToolsPanel';
import { PluginsPanel } from '../components/PluginsPanel';
import { MCPPanel } from '../components/MCPPanel';
import { ChannelsPanel } from '../components/ChannelsPanel';
import { SettingsPanel } from '../components/SettingsPanel';
import { SchedulerPanel } from '../components/SchedulerPanel';
import { KnowledgePanel } from '../components/KnowledgePanel';
import { OrchestratorPanel } from '../components/OrchestratorPanel';
import { CrewsPanel } from '../components/CrewsPanel';
import { SoulPanel } from '../components/SoulPanel';
import { ProvidersPanel } from '../components/ProvidersPanel';
import { colors } from '../theme';

export type PanelId = 'chat' | 'tools' | 'plugins' | 'mcp' | 'channels' | 'settings' | 'scheduler' | 'knowledge' | 'orchestrator' | 'crews' | 'soul' | 'providers';

// Error boundary to prevent panel crashes from taking down the app
class PanelErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) { return { error: e.message }; }
  render() {
    if (this.state.error) {
      return (
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <Typography sx={{ color: colors.accent.red, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8rem', mb: 1 }}>
            Panel failed to load
          </Typography>
          <Typography sx={{ color: colors.text.dim, fontSize: '0.7rem' }}>{this.state.error}</Typography>
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
  const activePanel = (panel || 'chat') as PanelId;
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsPosition, setLogsPosition] = useState<'bottom' | 'right'>('bottom');
  const [panelSize, setPanelSize] = useState(BOTTOM_PANEL_DEFAULT_HEIGHT);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleNavigate = (p: PanelId) => {
    navigate(`/console/${p}`);
  };

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
          '&:hover': { bgcolor: colors.accent.blue + '30' },
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
        <Sidebar active={activePanel} onNavigate={handleNavigate} />
        <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden', flexDirection: isVertical ? 'row' : 'column' }}>
          <Box sx={{ flex: 1, overflow: 'hidden' }}>
            <PanelErrorBoundary key={activePanel}>
              {activePanel === 'chat' && <ChatPanel sessionId={sessionId} />}
              {activePanel === 'tools' && <ToolsPanel />}
              {activePanel === 'plugins' && <PluginsPanel />}
              {activePanel === 'mcp' && <MCPPanel />}
              {activePanel === 'channels' && <ChannelsPanel />}
              {activePanel === 'settings' && <SettingsPanel />}
              {activePanel === 'scheduler' && <SchedulerPanel />}
              {activePanel === 'knowledge' && <KnowledgePanel />}
              {activePanel === 'orchestrator' && <OrchestratorPanel />}
              {activePanel === 'crews' && <CrewsPanel />}
              {activePanel === 'soul' && <SoulPanel />}
              {activePanel === 'providers' && <ProvidersPanel />}
            </PanelErrorBoundary>
          </Box>
          {isVertical && logsContent}
        </Box>
      </Box>

      {/* Bottom logs (below main content, above footer) */}
      {!isVertical && logsContent}

      <Footer onToggleLogs={toggleLogs} logsOpen={logsOpen} />
    </Box>
  );
}
