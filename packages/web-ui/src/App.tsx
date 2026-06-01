import { useEffect } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { useApp } from './store/AppContext';
import { DockingStation } from './pages/DockingStation';
import { SetupAuth } from './pages/SetupAuth';
import { SetupWizard } from './pages/SetupWizard';
import { Login } from './pages/Login';
import { Console } from './pages/Console';

export function App() {
  const { view, initialize } = useApp();

  useEffect(() => { initialize(); }, [initialize]);

  switch (view) {
    case 'loading':
      return (
        <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CircularProgress size={32} sx={{ color: '#fff' }} />
        </Box>
      );
    case 'docking':
      return <DockingStation />;
    case 'setup-auth':
      return <SetupAuth />;
    case 'setup-wizard':
      return <SetupWizard />;
    case 'login':
      return <Login />;
    case 'console':
      return <Console />;
    default:
      return null;
  }
}
