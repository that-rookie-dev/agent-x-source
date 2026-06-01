import { useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import { Sidebar } from './components/Sidebar';
import { ChatPanel } from './components/ChatPanel';
import { Header } from './components/Header';

export function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {sidebarOpen && <Sidebar />}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Header onToggleSidebar={toggleSidebar} sidebarOpen={sidebarOpen} />
        <ChatPanel />
      </Box>
    </Box>
  );
}
