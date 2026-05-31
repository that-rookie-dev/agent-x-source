import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api';
import { useToast } from './ToastProvider';

interface LinkedProvider {
  id: string;
  configured: boolean;
  profiles?: string[];
  activeProfile?: string;
}

interface AvailableProvider {
  id: string;
  name: string;
  type: 'cloud' | 'local';
  requiresApiKey: boolean;
  defaultBaseUrl: string;
}

interface ProviderModalProps {
  onClose: () => void;
  onSwitch?: () => void;
}

export default function ProviderModal({ onClose, onSwitch }: ProviderModalProps) {
  const [view, setView] = useState<'switcher' | 'linker'>('switcher');
  const [linked, setLinked] = useState<LinkedProvider[]>([]);
  const [available, setAvailable] = useState<AvailableProvider[]>([]);
  const [activeProvider, setActiveProvider] = useState('');
  const [activeModel, setActiveModel] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [activeProfile, setActiveProfile] = useState('');
  const [models, setModels] = useState<Array<{ id: string }>>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState('');

  // Add-profile state (switcher view)
  const [addingProfile, setAddingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileKey, setNewProfileKey] = useState('');
  const [newProfileUrl, setNewProfileUrl] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Linker state
  const [linkStep, setLinkStep] = useState<'pick' | 'input'>('pick');
  const [linkProvider, setLinkProvider] = useState<AvailableProvider | null>(null);
  const [linkKey, setLinkKey] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkProfile, setLinkProfile] = useState('');
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState('');
  // Use global toast for consistent messages
  // `useToast` imported lazily to avoid adding a dependency in this file if it's server-side rendered
  // We'll import it normally below.

  const toast = useToast();

  useEffect(() => {
    setError('');
  }, [view]);

  useEffect(() => {
    loadLinked();
    apiGet<{ providers: AvailableProvider[] }>('/api/providers/available')
      .then((d) => setAvailable(d.providers))
      .catch(() => {});
  }, []);

  async function loadLinked() {
    try {
      const [provs, cfg] = await Promise.all([
        apiGet<{ active: string; providers: LinkedProvider[] }>('/api/providers'),
        apiGet<{ provider: { activeProvider: string; activeModel: string } }>('/api/config'),
      ]);
      setLinked(provs.providers);
      setActiveProvider(provs.active);
      setActiveModel(cfg.provider.activeModel);
      const current = provs.providers.find((p) => p.id === provs.active);
      if (current) {
        setSelected(current.id);
        setProfiles(current.profiles || []);
        setActiveProfile(current.activeProfile || '');
        loadModels(current.id);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load providers';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  async function loadModels(providerId: string) {
    setLoadingModels(true);
    setModelError('');
    try {
      const ms = await apiGet<Array<{ id: string }>>(`/api/provider/models?provider=${encodeURIComponent(providerId)}`);
      setModels(ms);
    } catch (e) {
      setModels([]);
      const msg = e instanceof Error ? e.message : 'Failed to load models';
      setModelError(msg);
      // show sanitized error in global toast
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
    setLoadingModels(false);
  }

  function selectProvider(id: string) {
    setSelected(id);
    const prov = linked.find((p) => p.id === id);
    setProfiles(prov?.profiles || []);
    setActiveProfile(prov?.activeProfile || '');
    loadModels(id);
  }

  async function switchProvider(id: string) {
    if (id === activeProvider) return;
    // clear any existing toasts before switching
    try { toast.clear(); } catch { /* ignore */ }
    try {
      await apiPost('/api/provider/configure', { provider: id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to switch provider';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
      return;
    }
    setActiveProvider(id);
    const prov = linked.find((p) => p.id === id);
    setProfiles(prov?.profiles || []);
    setActiveProfile(prov?.activeProfile || '');
    loadModels(id);
    loadLinked();
    onSwitch?.();
  }

  async function switchProfile(profileId: string) {
    if (!selected) return;
    try { toast.clear(); } catch { /* ignore */ }
    try {
      await apiPost('/api/provider/profile/switch', { provider: selected, profileId });
      setActiveProfile(profileId);
      loadLinked();
      onSwitch?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to switch profile';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  async function switchModel(modelId: string) {
    try { toast.clear(); } catch { /* ignore */ }
    try {
      await apiPost('/api/model/switch', { modelId });
      setActiveModel(modelId);
      loadLinked();
      onSwitch?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to switch model';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  function pickProvider(p: AvailableProvider) {
    setLinkProvider(p);
    setLinkKey('');
    setLinkUrl(p.defaultBaseUrl);
    setLinkProfile('');
    setLinkStep('input');
  }

  async function doLink() {
    if (!linkProvider) return;
    setLinking(true);
    try { toast.clear(); } catch { /* ignore */ }
    try {
      await apiPost('/api/provider/configure', {
        provider: linkProvider.id,
        apiKey: linkProvider.requiresApiKey ? linkKey : undefined,
        baseUrl: linkUrl || undefined,
        profileName: linkProfile.trim() || 'default',
      });
      setView('switcher');
      setLinkStep('pick');
      setLinkProvider(null);
      setLinkKey('');
      setLinkUrl('');
      setLinkProfile('');
      await loadLinked();
      try { toast.push('Provider linked', 'success'); } catch { /* ignore */ }
      onSwitch?.();
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Linking failed';
      const msg = raw.includes('provider-unreachable') ? 'Provider unreachable' : raw;
      setError(msg);
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
    setLinking(false);
  }

  function backToSwitcher() {
    setView('switcher');
    setLinkStep('pick');
    setLinkProvider(null);
    setLinkKey('');
    setLinkUrl('');
    setLinkProfile('');
  }

  if (view === 'linker') {
    return (
      <div className="overlay" onClick={onClose}>
        <div className="overlay-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
          <button className="overlay-close" onClick={onClose}>✕</button>

          {linkStep === 'pick' && (
            <>
              <div className="overlay-title">Link New Provider</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                {available.map((p) => (
                  <button key={p.id} className="prov-card" onClick={() => pickProvider(p)}>
                    <div className="prov-card-name">{p.name}</div>
                    <div className="prov-card-type">{p.type === 'cloud' ? 'Cloud API' : 'Local'}</div>
                  </button>
                ))}
              </div>
              <div className="overlay-actions">
                <button className="btn btn-sm btn-ghost" onClick={backToSwitcher}>Back</button>
              </div>
            </>
          )}

          {linkStep === 'input' && linkProvider && (
            <>
              <div className="overlay-title">Configure {linkProvider.name}</div>
              {linkProvider.requiresApiKey && (
                <div className="field">
                  <label className="label">API Key</label>
                  <input className="input" type="password" placeholder="sk-..." value={linkKey} onChange={(e) => setLinkKey(e.target.value)} />
                </div>
              )}
              <div className="field">
                <label className="label">Base URL</label>
                <input className="input" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">Profile Name</label>
                <input className="input" placeholder="default" value={linkProfile} onChange={(e) => setLinkProfile(e.target.value)} />
              </div>
                  {error && <div style={{ color: '#c66', fontSize: '0.75rem', padding: '8px 0' }}>{error}</div>}
              <div className="overlay-actions">
                <button className="btn btn-sm btn-ghost" onClick={() => setLinkStep('pick')}>Back</button>
                <button className="btn btn-sm btn-primary" onClick={doLink} disabled={linking || (linkProvider.requiresApiKey && !linkKey.trim())}>
                  {linking ? 'Saving...' : 'Save'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <button className="overlay-close" onClick={onClose}>✕</button>
        <div className="overlay-title">Provider Selection</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
          {linked.map((p) => (
            <button key={p.id} className={`prov-card-row ${p.id === selected ? 'active' : ''}`}
              onClick={() => selectProvider(p.id)}>
              <div style={{ flex: 1, textAlign: 'left' }}>
                <div style={{ fontWeight: 500, fontSize: '0.85rem', color: '#ccc' }}>{p.id}</div>
              </div>
              {p.id === activeProvider && (
                <span className="prov-badge">Active</span>
              )}
              <input type="radio" name="prov-select" checked={p.id === selected} readOnly
                style={{ accentColor: '#e0e0e0', marginLeft: 8 }} />
            </button>
          ))}
          {linked.length === 0 && (
            <div style={{ color: '#555', fontSize: '0.8rem', textAlign: 'center', padding: 16 }}>
              No providers linked yet.
            </div>
          )}
        </div>

        {selected && (
          <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: 12, marginBottom: 12 }}>
            {profiles.length > 0 && (
              <div className="field" style={{ marginBottom: 12 }}>
                <label className="label">Profile</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  <select className="select" value={activeProfile} onChange={(e) => switchProfile(e.target.value)} style={{ flex: 1 }}>
                    {profiles.map((pr) => (
                      <option key={pr} value={pr}>{pr}</option>
                    ))}
                  </select>
                  <button className="btn btn-sm btn-ghost" onClick={() => {
                    const prov = linked.find((p) => p.id === selected);
                    const avail = available.find((a) => a.id === selected);
                    setNewProfileName('');
                    setNewProfileKey('');
                    setNewProfileUrl(avail?.defaultBaseUrl || '');
                    setAddingProfile(true);
                  }} title="Add profile">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ width: 12, height: 12 }}><path d="M8 3v10M3 8h10"/></svg>
                  </button>
                </div>
              </div>
            )}

            {addingProfile && selected && (() => {
              const p = available.find((a) => a.id === selected);
              const isCloud = p?.type === 'cloud';
              return (
                <div style={{ border: '1px solid #1a1a1a', borderRadius: 4, padding: 10, marginBottom: 12 }}>
                  <div className="label" style={{ marginBottom: 8 }}>New Profile</div>
                  <div className="field" style={{ marginBottom: 8 }}>
                    <label className="label">Profile Name</label>
                    <input className="input" value={newProfileName} onChange={(e) => setNewProfileName(e.target.value)} placeholder="e.g. work" />
                  </div>
                  {isCloud && (
                    <div className="field" style={{ marginBottom: 8 }}>
                      <label className="label">API Key</label>
                      <input className="input" type="password" value={newProfileKey} onChange={(e) => setNewProfileKey(e.target.value)} placeholder="sk-..." />
                    </div>
                  )}
                  {!isCloud && (
                    <div className="field" style={{ marginBottom: 8 }}>
                      <label className="label">Base URL</label>
                      <input className="input" value={newProfileUrl} onChange={(e) => setNewProfileUrl(e.target.value)} />
                    </div>
                  )}
                  {error && <div style={{ color: '#c66', fontSize: '0.75rem', paddingBottom: 8 }}>{error}</div>}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => { setAddingProfile(false); setError(''); }}>Cancel</button>
                          <button className="btn btn-sm btn-primary" disabled={savingProfile || !newProfileName.trim() || (isCloud && !newProfileKey.trim())}
                              onClick={async () => {
                                setSavingProfile(true);
                                // clear existing toasts before creating profile
                                try { toast.clear(); } catch { /* ignore */ }
                                try {
                                  await apiPost('/api/provider/profile', {
                                    provider: selected,
                                    profileId: newProfileName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                                    label: newProfileName.trim(),
                                    apiKey: newProfileKey.trim() || undefined,
                                    baseUrl: newProfileUrl.trim() || undefined,
                                  });
                                  await loadLinked();
                                  setAddingProfile(false);
                                  setNewProfileName('');
                                  setNewProfileKey('');
                                  setNewProfileUrl('');
                                  try { toast.push('Profile created', 'success'); } catch { /* ignore */ }
                                } catch (e) {
                                  const raw = e instanceof Error ? e.message : 'Failed to create profile';
                                  const msg = raw.includes('profile-add-failed') ? 'Failed to create profile' : raw;
                                  setError(msg);
                                  try { toast.push(msg, 'error'); } catch { /* ignore */ }
                                }
                                setSavingProfile(false);
                              }}>
                      {savingProfile ? 'Saving...' : 'Save Profile'}
                    </button>
                  </div>
                </div>
              );
            })()}

            <div className="label" style={{ marginBottom: 6 }}>Model</div>
            {loadingModels ? (
              <div style={{ color: '#666', fontSize: '0.75rem' }}>Loading models...</div>
            ) : models.length === 0 ? (
              <div style={{ color: modelError ? '#c66' : '#666', fontSize: '0.75rem' }}>
                {modelError || 'No models found.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {models.map((m) => {
                  const short = m.id.split('/').pop() || m.id;
                  const isActive = m.id === activeModel;
                  return (
                    <button key={m.id} className={`prov-model-chip ${isActive ? 'active' : ''}`}
                      onClick={() => switchModel(m.id)}>
                      {short}
                    </button>
                  );
                })}
              </div>
            )}

            {selected !== activeProvider && (
              <div style={{ marginTop: 12 }}>
                <button className="btn btn-sm btn-primary" onClick={() => switchProvider(selected)}>
                  Switch to {selected}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="overlay-actions" style={{ borderTop: '1px solid #1a1a1a', paddingTop: 12, marginTop: 0 }}>
          <button className="btn btn-sm btn-ghost" onClick={() => setView('linker')}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ width: 12, height: 12, marginRight: 4, verticalAlign: 'middle' }}><path d="M8 3v10M3 8h10"/></svg>
            Link New Provider
          </button>
        </div>
      </div>
    </div>
  );
}
