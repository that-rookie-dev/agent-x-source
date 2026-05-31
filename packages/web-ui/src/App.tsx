import { useEffect, useState, useCallback } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { apiGet, connectWs } from './api';
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

export default function App() {
  const [health, setHealth] = useState<'checking' | 'ok' | 'down'>('checking');
  const [setupComplete, setSetupComplete] = useState(false);
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
          const r = await fetch(u, { cache: 'no-store' });
          if (r.ok) {
            setHealth('ok');
            try {
              const status = await fetch('/api/setup/status').then((r) => r.json());
              setSetupComplete(status.setupComplete);
            } catch {
              // ignore setup status fetch failures
            }
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

  // Agent up, not setup → wizard only
  if (!setupComplete) {
    return (
      <Routes>
        <Route path="*" element={<Wizard onComplete={onWizardComplete} />} />
      </Routes>
    );
  }

  // Agent up + setup complete → portal landing at /, app at /chat/*
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
      </Route>
    </Routes>
  );
}
