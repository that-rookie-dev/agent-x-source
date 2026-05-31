import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { apiGet } from './api';
import { useToast } from './components/ToastProvider';

interface HealthData {
  status: string;
  pid: number;
  node: string;
  platform: string;
  uptime: number;
  memory?: { heapUsed: number; heapTotal: number; rss: number };
  config?: Record<string, unknown>;
  sessions: number;
  crews: number;
  agentActive: boolean;
}

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [showHealthModal, setShowHealthModal] = useState(false);
  const [cfgLabel, setCfgLabel] = useState('');
  const toast = useToast();
  const [healthToastShown, setHealthToastShown] = useState(false);

  useEffect(() => {
    loadHealth();
    const interval = setInterval(loadHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  async function loadHealth() {
    try {
      const h = await apiGet<HealthData>('/api/health');
      setHealth(h);
      // reset any shown toast when health loads successfully
      setHealthToastShown(false);
      if (h.config) {
        const c = h.config as Record<string, unknown>;
        setCfgLabel([c.provider, c.model].filter(Boolean).join(' / '));
      }
    } catch (e) {
      // Avoid spamming the user with repeated health toasts; only show once until recovery
      if (!healthToastShown) {
        const msg = e instanceof Error ? e.message : 'Failed to load agent health';
        try { toast.push(msg, 'error'); } catch { /* ignore */ }
        setHealthToastShown(true);
      }
    }
  }

  const [pluginCount, setPluginCount] = useState(0);

  useEffect(() => {
    apiGet<{ plugins: unknown[] }>('/api/plugins/installed').then((r) => {
      setPluginCount(r.plugins.length);
    }).catch(() => {});
  }, []);

  const pluginItems = [
    { path: '/plugins', label: 'Plugin Hub', icon: '<path d="M2 3h12v4H2V3zM2 7h12v6H2V7zM5 10h6M8 8v4" strokeWidth="1.2"/><circle cx="8" cy="13.5" r="1.2" fill="currentColor"/>' },
    { path: '/mcp', label: 'MCP Hub', icon: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01" strokeWidth="1.5"/>' },
  ];

  const navItems = [
    { path: '/chat', label: 'Chat', icon: '<rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/>' },
    { path: '/dashboard', label: 'Dashboard', icon: '<path d="M2 4.5L8 2l6 2.5v9L8 16l-6-2.5z"/><path d="M8 2v14"/><path d="M2 4.5l6 2.5M14 4.5l-6 2.5"/>' },
  ];

  const mgmtItems = [
    { path: '/crews', label: 'Crews', icon: '<path d="M5.5 5.5v5M10.5 5.5v5M3 3h10v10H3z"/><circle cx="8" cy="5" r="1"/><circle cx="8" cy="11" r="1"/>' },
    { path: '/sessions', label: 'Sessions', icon: '<circle cx="5.5" cy="5.5" r="1.5"/><circle cx="10.5" cy="5.5" r="1.5"/><circle cx="5.5" cy="10.5" r="1.5"/><circle cx="10.5" cy="10.5" r="1.5"/>' },
    { path: '/subagents', label: 'Sub-Agents', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
    { path: '/files', label: 'Files', icon: '<path d="M3 3h4l1 2h6v8H3V3z"/><path d="M8 8h4v4H8z"/>' },
    { path: '/scheduler', label: 'Scheduler', icon: '<circle cx="8" cy="8" r="6"/><path d="M8 4v4l3 2"/>' },
  ];

  const sysItems = [
    { path: '/rag', label: 'RAG Admin', icon: '<path d="M2 2h8v8H2V2zM10 10h4v4h-4v-4z"/><path d="M10 10l-8-8M14 14l4 4"/>' },
    { path: '/settings', label: 'Settings', icon: '<circle cx="8" cy="8" r="2.8" strokeWidth="1.2" fill="none"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.2 3.2l1 1M11.8 11.8l1 1M3.2 12.8l1-1M11.8 4.2l1-1" strokeWidth="1.5" strokeLinecap="round"/>' },
  ];

  function renderNav(items: Array<{ path: string; label: string; icon: string }>) {
    return items.map((item) => (
      <button
        key={item.path}
        className={`sidebar-item ${location.pathname === item.path ? 'active' : ''}`}
        onClick={() => navigate(item.path)}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" dangerouslySetInnerHTML={{ __html: item.icon }} />
        {item.label}
      </button>
    ));
  }

  return (
    <div className="app-layout">
      <div className="sidebar">
        <div className="sidebar-brand">AGENT-X</div>

        <div className="sidebar-section">Agent</div>
        {renderNav(navItems)}

        <div className="sidebar-section">Management</div>
        {renderNav(mgmtItems)}

        <div className="sidebar-section">Plugins</div>
        {renderNav(pluginItems)}

        <div className="sidebar-section">System</div>
        {renderNav(sysItems)}

        <div className="sidebar-status" onClick={() => setShowHealthModal(true)} style={{ cursor: 'pointer' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={`dot ${health?.status === 'ok' ? 'online' : 'offline'}`} />
            <span style={{ fontSize: '0.7rem' }}>
              {health ? 'Agent Online' : 'Connecting...'}
            </span>
          </div>
          <div className="text-muted" style={{ fontSize: '0.6rem', marginTop: 4 }}>
            {cfgLabel || 'Not configured'}
          </div>
        </div>
      </div>
      <div className="app-main">
        <Outlet />
      </div>

      {showHealthModal && health && (
        <div className="overlay" onClick={() => setShowHealthModal(false)}>
          <div className="overlay-box" onClick={(e) => e.stopPropagation()}>
            <button className="overlay-close" onClick={() => setShowHealthModal(false)}>✕</button>
            <div className="overlay-title">Agent Health</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="health-row"><span className="health-label">Status</span><span className="health-value" style={{ color: health.status === 'ok' ? '#8c8' : '#c88' }}>{health.status}</span></div>
              <div className="health-row"><span className="health-label">PID</span><span className="health-value">{health.pid}</span></div>
              <div className="health-row"><span className="health-label">Node</span><span className="health-value">{health.node}</span></div>
              <div className="health-row"><span className="health-label">Platform</span><span className="health-value">{health.platform}</span></div>
              <div className="health-row"><span className="health-label">Uptime</span><span className="health-value">{Math.floor(health.uptime / 60)}m</span></div>
              <div className="health-row"><span className="health-label">Agent Active</span><span className="health-value">{health.agentActive ? 'Yes' : 'No'}</span></div>
              <div className="health-row"><span className="health-label">Sessions</span><span className="health-value">{health.sessions}</span></div>
              <div className="health-row"><span className="health-label">Crews</span><span className="health-value">{health.crews}</span></div>
              {health.memory && (
                <div className="health-row"><span className="health-label">Memory</span><span className="health-value">{(health.memory.heapUsed / 1024 / 1024).toFixed(0)} MB</span></div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
