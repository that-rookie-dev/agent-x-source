import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { useApp } from './store/AppContext';
import { ErrorBandProvider } from './components/ErrorBand';
import { DockingStation } from './pages/DockingStation';
import { SetupAuth } from './pages/SetupAuth';
import { SetupWizard } from './pages/SetupWizard';
import { Login } from './pages/Login';
import { Console } from './pages/Console';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { authState } = useApp();
  const loc = useLocation();
  if (authState === 'loading') {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={32} sx={{ color: '#fff' }} />
      </Box>
    );
  }
  if (authState === 'no-root-user') return <Navigate to="/setup" replace />;
  if (authState === 'unauthenticated') return <Navigate to="/login" replace />;
  if (authState === 'needs-setup') {
    if (loc.pathname !== '/setup/wizard') return <Navigate to="/setup/wizard" replace />;
    return <>{children}</>;
  }
  return <>{children}</>;
}

function GuestGuard({ children }: { children: React.ReactNode }) {
  const { authState } = useApp();
  const loc = useLocation();
  if (authState === 'loading') {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={32} sx={{ color: '#fff' }} />
      </Box>
    );
  }
  if (authState === 'no-root-user') {
    if (loc.pathname !== '/setup') return <Navigate to="/setup" replace />;
    return <>{children}</>;
  }
  if (authState === 'needs-setup') return <Navigate to="/setup/wizard" replace />;
  if (authState === 'authenticated') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  const { initialize, authState } = useApp();

  useEffect(() => { initialize(); }, [initialize]);

  if (authState === 'loading') {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={32} sx={{ color: '#fff' }} />
      </Box>
    );
  }

  return (
    <ErrorBandProvider>
      <Routes>
        <Route path="/login" element={<GuestGuard><Login /></GuestGuard>} />
        <Route path="/setup" element={<GuestGuard><SetupAuth /></GuestGuard>} />
        <Route path="/setup/wizard" element={<AuthGuard><SetupWizard /></AuthGuard>} />
        <Route path="/" element={<AuthGuard><DockingStation /></AuthGuard>} />
        <Route path="/console" element={<Navigate to="/console/chat" replace />} />
        <Route path="/console/:panel" element={<AuthGuard><Console /></AuthGuard>} />
        <Route path="/console/chat/:sessionId" element={<AuthGuard><Console /></AuthGuard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBandProvider>
  );
}
