import { Component, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { Sidebar } from '../components/Sidebar';
import { Footer } from '../components/Footer';
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

export function Console() {
  const { panel, sessionId } = useParams<{ panel?: string; sessionId?: string }>();
  const navigate = useNavigate();
  const activePanel = (panel || 'chat') as PanelId;

  const handleNavigate = (p: PanelId) => {
    navigate(`/console/${p}`);
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Sidebar active={activePanel} onNavigate={handleNavigate} />
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
      </Box>
      <Footer />
    </Box>
  );
}
