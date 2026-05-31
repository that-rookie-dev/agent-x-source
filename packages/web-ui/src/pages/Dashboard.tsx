import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api';
import { useToast } from '../components/ToastProvider';

interface ProviderConfig {
  id: string;
  configured: boolean;
  profiles?: string[];
  activeProfile?: string;
}

interface HealthData {
  uptime: number;
  memory: number;
  config: { provider: string; model: string; user: string };
  sessions: number;
  crews: number;
  agentActive: boolean;
}

export default function Dashboard() {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [activeProvider, setActiveProvider] = useState('');
  const [activeModel, setActiveModel] = useState('');
  const [models, setModels] = useState<Array<{ id: string }>>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addId, setAddId] = useState('');
  const [addKey, setAddKey] = useState('');
  const [addProfileName, setAddProfileName] = useState('default');
  const [addUrl, setAddUrl] = useState('');

  const toast = useToast();

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    await Promise.all([loadProviders(), loadHealth()]);
  }

  async function loadProviders() {
    try {
      const cfg = await apiGet<{ provider: { activeProvider: string; activeModel: string } }>('/api/config');
      setActiveProvider(cfg.provider.activeProvider);
      setActiveModel(cfg.provider.activeModel);
      const provs = await apiGet<{ active: string; providers: Array<{ id: string; configured: boolean; profiles?: string[]; activeProfile?: string }> }>('/api/providers');
      setProviders(provs.providers);
      try {
        const ms = await apiGet<Array<{ id: string }>>(`/api/provider/models?provider=${encodeURIComponent(cfg.provider.activeProvider)}`);
        setModels(ms);
      } catch { /* ignore */ }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load providers';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  async function loadHealth() {
    try {
      const h = await apiGet<HealthData>('/api/health');
      setHealth(h);
    } catch { /* ignore */ }
  }

  async function addProvider() {
    // clear global toasts first
    try { toast.clear(); } catch { /* ignore */ }
    if (!addId.trim() || !addKey.trim()) return;
    try {
      await apiPost('/api/provider/configure', { provider: addId.trim(), apiKey: addKey.trim(), baseUrl: addUrl.trim() || undefined, profileName: (addProfileName || 'default').trim() || 'default' });
      try { toast.push('Provider added and profile created', 'success'); } catch { /* ignore */ }
      setShowAdd(false);
      setAddId('');
      setAddKey('');
      setAddUrl('');
      await loadProviders();
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Failed to add provider';
      const msg = raw.includes('save-failed') ? 'Failed to save provider' : raw;
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  async function switchModel(id: string) {
    try { toast.clear(); } catch { /* ignore */ }
    try {
      await apiPost('/api/model/switch', { modelId: id });
      setActiveModel(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to switch model';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
      return;
    }
  }

  async function handleProfileSwitch(providerId: string, profileId: string) {
    try { toast.clear(); } catch { /* ignore */ }
    try {
      await apiPost('/api/provider/profile/switch', { provider: providerId, profileId });
      await loadProviders();
      try { toast.push('Profile switched', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Failed to switch profile';
      const msg = raw.includes('switch-failed') ? 'Failed to switch profile' : raw;
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  function formatUptime(s: number) {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts: string[] = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${sec}s`);
    return parts.join(' ');
  }

  function fmtBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', padding: 32 }}>
      <h1 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#ccc', margin: '0 0 24px 0' }}>Dashboard</h1>

      {/* Stats cards */}
      {health && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 32 }}>
          <div className="dash-card">
            <div className="dash-card-label">Uptime</div>
            <div className="dash-card-value">{formatUptime(health.uptime)}</div>
          </div>
          <div className="dash-card">
            <div className="dash-card-label">Memory</div>
            <div className="dash-card-value">{fmtBytes(health.memory)}</div>
          </div>
          <div className="dash-card">
            <div className="dash-card-label">Sessions</div>
            <div className="dash-card-value">{health.sessions}</div>
          </div>
          <div className="dash-card">
            <div className="dash-card-label">Crews</div>
            <div className="dash-card-value">{health.crews}</div>
          </div>
          <div className="dash-card">
            <div className="dash-card-label">Agent</div>
            <div className="dash-card-value" style={{ color: health.agentActive ? '#5a5' : '#a55' }}>
              {health.agentActive ? 'Active' : 'Inactive'}
            </div>
          </div>
          <div className="dash-card">
            <div className="dash-card-label">Model</div>
            <div className="dash-card-value" style={{ fontSize: '0.7rem' }}>{health.config.model.split('/').pop()}</div>
          </div>
        </div>
      )}

      {/* Provider section */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <h2 style={{ fontSize: '0.9rem', fontWeight: 500, color: '#aaa', margin: 0 }}>Providers</h2>
          <button className="btn btn-sm btn-ghost" onClick={() => setShowAdd(!showAdd)}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ width: 12, height: 12, marginRight: 4 }}><path d="M8 3v10M3 8h10"/></svg>
            Add
          </button>
        </div>

        {showAdd && (
          <div className="dash-inline-form">
            <input className="input" placeholder="Provider ID (e.g. openai)" value={addId} onChange={(e) => setAddId(e.target.value)} style={{ marginBottom: 6 }} />
            <input className="input" placeholder="API Key" type="password" value={addKey} onChange={(e) => setAddKey(e.target.value)} style={{ marginBottom: 6 }} />
            <input className="input" placeholder="Profile Name (optional)" value={addProfileName} onChange={(e) => setAddProfileName(e.target.value)} style={{ marginBottom: 6 }} />
            <input className="input" placeholder="Base URL (optional)" value={addUrl} onChange={(e) => setAddUrl(e.target.value)} style={{ marginBottom: 6 }} />
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-sm btn-primary" onClick={addProvider}>Save</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        )}

        <div className="dash-provider-list">
          {providers.length === 0 && <div style={{ color: '#555', fontSize: '0.8rem' }}>No providers configured.</div>}
          {providers.map((p) => (
            <div key={p.id} className={`dash-provider-item ${p.id === activeProvider ? 'active' : ''}`}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, color: '#ccc', fontSize: '0.85rem' }}>{p.id}</div>
                <div style={{ fontSize: '0.7rem', color: p.configured ? '#5a5' : '#666' }}>
                  {p.configured ? 'Configured' : 'Not configured'}
                  {p.configured && p.profiles && p.profiles.length > 0 && ` · ${p.profiles.length} profile(s)`}
                </div>
              </div>
              {p.configured && p.profiles && p.profiles.length > 0 && (
                <select className="topbar-select" style={{ fontSize: '0.7rem', padding: '2px 6px' }}
                  value={p.activeProfile || ''}
                  onChange={(e) => {
                    if (e.target.value) {
                      handleProfileSwitch(p.id, e.target.value);
                    }
                  }}>
                  {p.profiles.map((pr) => (
                    <option key={pr} value={pr}>{pr}</option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Model selector */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: '0.9rem', fontWeight: 500, color: '#aaa', margin: '0 0 8px 0' }}>Models</h2>
        <div className="dash-model-grid">
          {models.map((m) => (
            <button key={m.id} className={`dash-model-chip ${m.id === activeModel ? 'active' : ''}`}
              onClick={() => switchModel(m.id)}>
              {m.id.split('/').pop()}
            </button>
          ))}
        </div>
        {models.length === 0 && <div style={{ color: '#555', fontSize: '0.8rem' }}>Configure a provider to see models.</div>}
      </div>
    </div>
  );
}
