import { useEffect, useState, useCallback } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { apiGet, connectWs, getAuthStatus, checkAuthRequired } from './api';
import Layout from './Layout';
import HealthCheck from './pages/HealthCheck';
import Wizard from './pages/Wizard';
import Chat from './pages/Chat';
import Dashboard from './pages/Dashboard';
import Crews from './pages/Crews';
import Sessions from './pages/Sessions';
import Settings from './pages/Settings';
import PluginHub from './pages/PluginHub';
import PluginDetail from './pages/PluginDetail';
import MCPHub from './pages/MCPHub';
import SubAgentDashboard from './pages/SubAgentDashboard';
import RAGAdmin from './pages/RAGAdmin';
import Scheduler from './pages/Scheduler';
import FileManager from './pages/FileManager';
import Login from './pages/Login';
import SetupAuth from './pages/SetupAuth';

type AuthPhase = 'checking' | 'setup-auth' | 'login' | 'authenticated' | 'error';

export default function App() {
  const [health, setHealth] = useState<'checking' | 'ok' | 'down'>('checking');
  const [setupComplete, setSetupComplete] = useState(false);
  const [authPhase, setAuthPhase] = useState<AuthPhase>('checking');
  const [authError, setAuthError] = useState<string>('');
  const navigate = useNavigate();

  useEffect(() => {
    connectWs();
    checkHealth();
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const urls = ['http://127.0.0.1:3333/api/health', 'http://localhost:3333/api/health', '/api/health'];
      for (const u of urls) {
        try {
          const r = await fetch(u, { cache: 'no-store', credentials: 'include' });
          if (r.ok) {
            setHealth('ok');
            // After health is ok, check auth state
            checkAuthState();
            return;
          }
        } catch {
          // try next url
        }
      }
      setHealth('down');
    } catch {
      setHealth('down');
    }
  }, []);

  const checkAuthState = useCallback(async () => {
    try {
      // First check if a root user exists
      const authCheck = await checkAuthRequired();

      if (!authCheck.hasRootUser) {
        // No root user yet — show auth setup
        setAuthPhase('setup-auth');
        setAuthError('');
        return;
      }

      // Root user exists — check if we're already authenticated
      const status = await getAuthStatus();
      if (status.isAuthenticated) {
        setAuthPhase('authenticated');
        setAuthError('');
        // Also check setup status
        try {
          const setupStatus = await apiGet<{ setupComplete: boolean }>('/api/setup/status');
          setSetupComplete(setupStatus.setupComplete);
        } catch {
          setSetupComplete(false);
        }
      } else {
        setAuthPhase('login');
        setAuthError('');
      }
    } catch (err: any) {
      // Auth endpoint unreachable — show a retryable error screen
      const msg = err instanceof Error ? err.message : 'Unable to reach Agent-X server';
      setAuthError(msg);
      setAuthPhase('error');
    }
  }, []);

  const onAuthComplete = useCallback(() => {
    setAuthPhase('authenticated');
    checkAuthState();
  }, [checkAuthState]);

  const onWizardComplete = useCallback(() => {
    setSetupComplete(true);
    navigate('/');
  }, [navigate]);

  if (health === 'checking') {
    return (
      <div className="health-screen">
        <div className="health-card">
          <div className="health-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
            </svg>
          </div>
          <div className="health-title">Connecting to Agent-X</div>
          <div className="health-desc">Checking for local agent&hellip;</div>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  // Agent down → always show portal with offline state
  if (health === 'down') {
    return <HealthCheck onRetry={checkHealth} />;
  }

  // Auth service error — allow retry
  if (authPhase === 'error') {
    return (
      <div className="wizard" style={{ maxWidth: 420, paddingTop: '20vh', textAlign: 'center' }}>
        <div style={{ fontSize: '2rem', marginBottom: 16, opacity: 0.6 }}>
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 8v4M12 16h.01"/>
          </svg>
        </div>
        <div className="wizard-title" style={{ fontSize: '1.3rem' }}>Connection Issue</div>
        <div className="wizard-desc" style={{ marginBottom: 24 }}>{authError}</div>
        <button className="btn btn-primary" onClick={checkAuthState}>Retry</button>
      </div>
    );
  }

  // Auth required but no root user yet
  if (authPhase === 'setup-auth') {
    return (
      <Routes>
        <Route path="*" element={<SetupAuth onComplete={onAuthComplete} />} />
      </Routes>
    );
  }

  // Root user exists but not logged in
  if (authPhase === 'login') {
    return (
      <Routes>
        <Route path="*" element={<Login onLogin={onAuthComplete} />} />
      </Routes>
    );
  }

  // Authenticated but setup not complete
  if (!setupComplete) {
    return (
      <Routes>
        <Route path="*" element={<Wizard onComplete={onWizardComplete} />} />
      </Routes>
    );
  }

  // Fully authenticated and setup complete
  return (
    <Routes>
      <Route path="/" element={<HealthCheck onRetry={checkHealth} />} />
      <Route path="/wizard" element={<Wizard onComplete={onWizardComplete} />} />
      <Route element={<Layout />}>
        <Route path="/chat" element={<Chat />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/crews" element={<Crews />} />
        <Route path="/sessions" element={<Sessions />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/plugins" element={<PluginHub />} />
        <Route path="/plugins/:id" element={<PluginDetail />} />
        <Route path="/mcp" element={<MCPHub />} />
        <Route path="/subagents" element={<SubAgentDashboard />} />
        <Route path="/rag" element={<RAGAdmin />} />
        <Route path="/scheduler" element={<Scheduler />} />
        <Route path="/files" element={<FileManager />} />
      </Route>
    </Routes>
  );
}
