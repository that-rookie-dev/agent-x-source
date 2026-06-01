import { useState } from 'react';
import Box from '@mui/material/Box';
import { Sidebar } from '../components/Sidebar';
import { ChatPanel } from '../components/ChatPanel';
import { SessionsPanel } from '../components/SessionsPanel';
import { ToolsPanel } from '../components/ToolsPanel';
import { PluginsPanel } from '../components/PluginsPanel';
import { MCPPanel } from '../components/MCPPanel';
import { BridgesPanel } from '../components/BridgesPanel';
import { SettingsPanel } from '../components/SettingsPanel';
import { TodoPanel } from '../components/TodoPanel';
import { SchedulerPanel } from '../components/SchedulerPanel';

export type PanelId = 'chat' | 'sessions' | 'tools' | 'plugins' | 'mcp' | 'bridges' | 'settings' | 'todos' | 'scheduler';

export function Console() {
  const [activePanel, setActivePanel] = useState<PanelId>('chat');

  return (
    <Box sx={{ height: '100%', display: 'flex' }}>
      <Sidebar active={activePanel} onNavigate={setActivePanel} />
      <Box sx={{ flex: 1, overflow: 'hidden' }}>
        {activePanel === 'chat' && <ChatPanel />}
        {activePanel === 'sessions' && <SessionsPanel />}
        {activePanel === 'tools' && <ToolsPanel />}
        {activePanel === 'plugins' && <PluginsPanel />}
        {activePanel === 'mcp' && <MCPPanel />}
        {activePanel === 'bridges' && <BridgesPanel />}
        {activePanel === 'settings' && <SettingsPanel />}
        {activePanel === 'todos' && <TodoPanel />}
        {activePanel === 'scheduler' && <SchedulerPanel />}
      </Box>
    </Box>
  );
}
