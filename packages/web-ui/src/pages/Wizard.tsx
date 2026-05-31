import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut } from '../api';
import { useToast } from '../components/ToastProvider';

interface Props {
  onComplete: () => void;
}

const PROVIDER_ICONS: Record<string, string> = {
  openai: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style="width:28px;height:28px"><path d="M16 4L6 12v8l10 8 10-8v-8L16 4z"/><path d="M16 4v28"/><path d="M6 12h20"/></svg>`,
  anthropic: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style="width:28px;height:28px"><circle cx="16" cy="16" r="12"/><circle cx="16" cy="16" r="4"/><path d="M4 16h24"/><path d="M16 4v24"/></svg>`,
  google: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style="width:28px;height:28px"><path d="M6 6h8v8H6z"/><path d="M18 6h8v8h-8z"/><path d="M6 18h8v8H6z"/><path d="M18 18h8v8h-8z"/></svg>`,
  ollama: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style="width:28px;height:28px"><path d="M16 4c-4 0-7 3-7 7v3c0 3-1 5-3 7l2 2c2-1 4-2 8-2s6 1 8 2l2-2c-2-2-3-4-3-7v-3c0-4-3-7-7-7z"/><circle cx="12" cy="13" r="1.5" fill="currentColor"/><circle cx="20" cy="13" r="1.5" fill="currentColor"/></svg>`,
  lmstudio: `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style="width:28px;height:28px"><rect x="4" y="4" width="10" height="10" rx="1"/><rect x="18" y="4" width="10" height="10" rx="1"/><rect x="4" y="18" width="10" height="10" rx="1"/><rect x="18" y="18" width="10" height="10" rx="1"/><path d="M9 14v4M23 14v4M14 9h4M14 23h4"/></svg>`,
};

const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', needsKey: true, defaultBaseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', name: 'Anthropic', needsKey: true, defaultBaseUrl: 'https://api.anthropic.com' },
  { id: 'google', name: 'Google AI', needsKey: true, defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'moonshot', name: 'Moonshot AI', needsKey: true, defaultBaseUrl: 'https://api.moonshot.ai/v1' },
  { id: 'deepseek', name: 'DeepSeek', needsKey: true, defaultBaseUrl: 'https://api.deepseek.com' },
  { id: 'groq', name: 'Groq', needsKey: true, defaultBaseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'mistral', name: 'Mistral AI', needsKey: true, defaultBaseUrl: 'https://api.mistral.ai/v1' },
  { id: 'together', name: 'Together AI', needsKey: true, defaultBaseUrl: 'https://api.together.xyz/v1' },
  { id: 'xai', name: 'xAI (Grok)', needsKey: true, defaultBaseUrl: 'https://api.x.ai/v1' },
  { id: 'fireworks', name: 'Fireworks AI', needsKey: true, defaultBaseUrl: 'https://api.fireworks.ai/inference/v1' },
  { id: 'perplexity', name: 'Perplexity', needsKey: true, defaultBaseUrl: 'https://api.perplexity.ai' },
  { id: 'azure', name: 'Azure OpenAI', needsKey: true, defaultBaseUrl: '' },
  { id: 'cohere', name: 'Cohere', needsKey: true, defaultBaseUrl: 'https://api.cohere.com/compatibility/v1' },
  { id: 'ollama', name: 'Ollama', needsKey: false, defaultBaseUrl: 'http://localhost:11434' },
  { id: 'lmstudio', name: 'LM Studio', needsKey: false, defaultBaseUrl: 'http://localhost:1234/v1' },
];

const EMOTIONS = [
  { id: 'professional', label: 'Professional', desc: 'Precise, formal, business-like' },
  { id: 'friendly', label: 'Friendly', desc: 'Warm, approachable, casual' },
  { id: 'witty', label: 'Witty', desc: 'Clever, sharp, dry humor' },
  { id: 'kind', label: 'Kind', desc: 'Gentle, empathetic, supportive' },
  { id: 'funny', label: 'Funny', desc: 'Humorous, entertaining' },
  { id: 'sarcastic', label: 'Sarcastic', desc: 'Dry, ironic, deadpan' },
  { id: 'flirty', label: 'Flirty', desc: 'Playful, charming, teasing' },
  { id: 'arrogant', label: 'Arrogant', desc: 'Supremely confident, show-off' },
  { id: 'happy', label: 'Happy', desc: 'Enthusiastic, upbeat, energetic' },
  { id: 'sad', label: 'Melancholic', desc: 'Thoughtful, reflective, poetic' },
];

const STEP_LABELS = ['Provider', 'Model', 'Callsign', 'Crew', 'Prompt', 'Tone', 'Telegram', 'Launch'];

export default function Wizard({ onComplete }: Props) {
  const [initializing, setInitializing] = useState(true);
  const [step, setStep] = useState(0);
  const toastCtx = useToast();

  // Step 0: Provider
  const [selectedProvider, setSelectedProvider] = useState('openai');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyTouched, setApiKeyTouched] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileNameTouched, setProfileNameTouched] = useState(false);
  const [baseUrl, setBaseUrl] = useState(PROVIDERS[0].defaultBaseUrl);
  const [baseUrlTouched, setBaseUrlTouched] = useState(false);
  const [validating, setValidating] = useState(false);


  // Step 1: Model
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState('');

  // Step 2: Callsign
  const [callsign, setCallsign] = useState('');

  // Step 3: Crew Name
  const [crewName, setCrewName] = useState('');

  // Step 4: Crew Prompt
  const [crewPrompt, setCrewPrompt] = useState('');

  // Step 5: Tone
  const [crewEmotion, setCrewEmotion] = useState('professional');

  // Step 6: Telegram
  const [telegramToken, setTelegramToken] = useState('');
  const [skipTelegram, setSkipTelegram] = useState(false);

  // Step 7: Launch
  const [saving, setSaving] = useState(false);

  const provider = PROVIDERS.find((p) => p.id === selectedProvider)!;

  // Resume from last completed step on refresh
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const cfg = await apiGet<{
          provider: { activeProvider: string; activeModel: string; providers: Record<string, { apiKey?: string; baseUrl?: string; configured?: boolean }> };
          user?: { callsign: string };
        }>('/api/config');
        if (!mounted) return;
        const p = cfg.provider;
        const provCfg = p.providers[p.activeProvider];

        if (p.activeProvider && provCfg?.configured) {
          setSelectedProvider(p.activeProvider);
          if (provCfg.baseUrl) setBaseUrl(provCfg.baseUrl);
          if (provCfg.apiKey) setApiKey(provCfg.apiKey);
          if (p.activeModel) {
            setSelectedModel(p.activeModel);
            if (cfg.user?.callsign) {
              setCallsign(cfg.user.callsign);
              try {
                const crews = await apiGet<{ crews: Array<{ id: string; name: string; isDefault?: boolean }> }>('/api/crews');
                const userCrews = crews.crews.filter((c) => !c.isDefault);
                if (userCrews.length > 0) {
                  const last = userCrews[userCrews.length - 1];
                  setCrewName(last.name);
                  try {
                    const tg = await apiGet<{ configured: boolean }>('/api/telegram/status');
                    if (tg.configured) {
                      setTelegramToken('configured');
                      setStep(7);
                    } else {
                      setStep(6);
                    }
                  } catch {
                    setStep(6);
                  }
                } else {
                  setStep(3);
                }
              } catch {
                setStep(3);
              }
            } else {
              setStep(2);
            }
          } else {
            setStep(1);
          }
        }
      } catch {
        // not configured — stay at step 0
      }
    })().finally(() => { if (mounted) setInitializing(false); });
    return () => { mounted = false; };
  }, []);

  async function validateProvider() {
    // clear global toasts before validation
    try { toastCtx.clear(); } catch { /* ignore */ }

    if (provider.needsKey && !apiKey.trim()) {
      setApiKeyTouched(true);
      try { toastCtx.push('API key is required', 'warn'); } catch { /* ignore */ }
      return;
    }
    if ((!provider.needsKey || provider.id === 'azure') && !baseUrl.trim()) {
      setBaseUrlTouched(true);
      try { toastCtx.push('Base URL is required', 'warn'); } catch { /* ignore */ }
      return;
    }
    if (!profileName.trim()) {
      setProfileNameTouched(true);
      try { toastCtx.push('Profile name is required', 'warn'); } catch { /* ignore */ }
      return;
    }
    setValidating(true);
      try {
        const res = await apiPost<{ valid: boolean; error?: string }>('/api/provider/validate', {
          provider: selectedProvider,
          apiKey: apiKey.trim() || undefined,
          baseUrl: baseUrl.trim() || undefined,
        });
      if (res.valid) {
        await apiPost('/api/provider/configure', {
          provider: selectedProvider,
          apiKey: apiKey.trim() || undefined,
          baseUrl: baseUrl.trim() || undefined,
          profileName: (profileName || 'default').trim() || 'default',
        });
        try { toastCtx.push('Provider linked and profile created', 'success'); } catch { /* ignore */ }
        setStep(1);
      } else {
          try { toastCtx.push('Provider unreachable — check your credentials or network', 'error'); } catch { /* ignore */ }
      }
    } catch {
      try { toastCtx.push('Connection failed — ensure the service is running', 'error'); } catch { /* ignore */ }
    }
    setValidating(false);
  }

  useEffect(() => {
    if (step !== 1) return;
    let mounted = true;
    setLoadingModels(true);
    const params = new URLSearchParams({ provider: selectedProvider });
    if (apiKey.trim()) params.set('apiKey', apiKey.trim());
    if (baseUrl.trim()) params.set('baseUrl', baseUrl.trim());
    apiGet<Array<{ id: string; name: string }>>(`/api/provider/models?${params}`)
      .then((ms) => { if (mounted) { setModels(ms); if (ms.length > 0) setSelectedModel(ms[0].id); } })
      .catch(() => { if (mounted) setModels([]); })
      .finally(() => { if (mounted) setLoadingModels(false); });
    return () => { mounted = false; };
  }, [step]);

  async function saveModel() {
    if (!selectedModel || loadingModels) return;
    setModelError('');
    try {
      await apiPost('/api/model/switch', { modelId: selectedModel });
      setStep(2);
    } catch (e: unknown) {
      setModelError(e instanceof Error ? e.message : 'Failed to set model');
    }
  }

  async function saveCallsign() {
    if (!callsign.trim()) return;
    try {
      const existing = await apiGet('/api/config');
      const update = { ...(existing as Record<string, unknown>), user: { callsign: callsign.trim() } };
      await apiPut('/api/config', update);
      setStep(3);
    } catch { /* ignore */ }
  }

  async function saveCrewName() {
    if (!crewName.trim()) return;
    setStep(4);
  }

  async function saveCrewPrompt() {
    setStep(5);
  }

  async function saveCrew() {
    const id = `crew-${Date.now()}`;
    await apiPost('/api/crews', {
      id,
      name: crewName || 'My Crew',
      systemPrompt: crewPrompt || 'You are a highly capable AI assistant. Be direct, concise, and helpful.',
      emotion: crewEmotion,
    });
    await apiPost('/api/crew/switch', { id });
    setStep(6);
  }

  async function saveTelegram() {
    if (!skipTelegram && telegramToken) {
      await apiPost('/api/telegram/start', { token: telegramToken });
    }
    setStep(7);
  }

  async function finish() {
    setSaving(true);
    try {
      const existing = await apiGet('/api/config');
      await apiPut('/api/config', { ...(existing as Record<string, unknown>), setupComplete: true });
      onComplete();
    } catch {
      setSaving(false);
    }
  }

  if (initializing) {
    return (
      <div className="wizard">
        <div className="flex items-center gap-8" style={{ color: '#888', paddingTop: 80, justifyContent: 'center' }}>
          <span className="spinner" /> Checking current setup&hellip;
        </div>
      </div>
    );
  }

  return (
    <div className="wizard">
      <div className="wizard-steps">
        {STEP_LABELS.map((s, i) => (
          <div key={s} className={`wizard-step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`} />
        ))}
      </div>

      {/* Step 0: Provider */}
      {step === 0 && (
        <>
          <h2 className="wizard-title">Neural Core — Select Engine</h2>
          <p className="wizard-desc">Choose your AI provider.</p>

          <div className="prov-grid">
            {PROVIDERS.map((p) => (
              <div
                key={p.id}
                className={`prov-grid-card ${selectedProvider === p.id ? 'selected' : ''}`}
                onClick={() => { setSelectedProvider(p.id); setBaseUrl(p.defaultBaseUrl); setApiKeyTouched(false); setBaseUrlTouched(false); }}
              >
                <div className="prov-grid-icon" dangerouslySetInnerHTML={{ __html: PROVIDER_ICONS[p.id] || '' }} />
                <div className="prov-grid-name">{p.name}</div>
                <div className="prov-grid-badge">{p.needsKey ? 'CLOUD' : 'LOCAL'}</div>
              </div>
            ))}
          </div>

          {provider.needsKey && (
            <div className="field" style={{ maxWidth: 480, margin: '20px auto 0' }}>
              <label className="label">API Key</label>
              <input className={`input ${apiKeyTouched && !apiKey.trim() ? 'input-error' : ''}`}
                type="password" value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setApiKeyTouched(false); }}
                placeholder="sk-..." />
            </div>
          )}

          {(!provider.needsKey || provider.id === 'azure') && (
            <div className="field" style={{ maxWidth: 480, margin: '20px auto 0' }}>
              <label className="label">Base URL</label>
              <input className={`input ${baseUrlTouched && !baseUrl.trim() ? 'input-error' : ''}`}
                value={baseUrl}
                onChange={(e) => { setBaseUrl(e.target.value); setBaseUrlTouched(false); }}
                placeholder={provider.id === 'azure' ? 'https://your-resource.openai.azure.com/openai/deployments/...' : 'http://localhost:...'} />
            </div>
          )}

          <div className="field" style={{ maxWidth: 480, margin: '12px auto 0' }}>
            <label className="label">Profile Name (optional)</label>
            <input
              className={`input ${profileNameTouched && !profileName.trim() ? 'input-error' : ''}`}
              value={profileName}
              onChange={(e) => { setProfileName(e.target.value); setProfileNameTouched(false); }}
              placeholder="default"
            />
            <div className="text-muted mt-8">Use profiles to store multiple credentials or endpoints for the same provider.</div>
          </div>

          <div className="wizard-actions" style={{ justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={validateProvider} disabled={validating}>
              {validating ? <><span className="spinner" /> Validating&hellip;</> : 'Validate & Continue'}
            </button>
          </div>
        </>
      )}

      {/* Step 1: Model */}
      {step === 1 && (
        <>
          <h2 className="wizard-title">Neural Core — Select Model</h2>
          <p className="wizard-desc">Choose a model for {PROVIDERS.find((p) => p.id === selectedProvider)?.name}.</p>

          {loadingModels ? (
            <div className="flex items-center gap-8" style={{ color: '#888', justifyContent: 'center', padding: 32 }}>
              <span className="spinner" /> Loading models&hellip;
            </div>
          ) : models.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', color: '#666', maxWidth: 360, margin: '0 auto' }}>
              No models found.
            </div>
          ) : (
            <div className="model-list">
              {models.map((m) => (
                <div
                  key={m.id}
                  className={`model-list-item ${selectedModel === m.id ? 'selected' : ''}`}
                  onClick={() => setSelectedModel(m.id)}
                >
                  <div className="model-list-name">{m.name || m.id.split('/').pop() || m.id}</div>
                  <div className="model-list-id">{m.id}</div>
                </div>
              ))}
            </div>
          )}

          {modelError && <div style={{ color: '#ff6b6b', fontSize: '0.8rem', marginTop: 12, textAlign: 'center' }}>{modelError}</div>}

          <div className="wizard-actions" style={{ justifyContent: 'center' }}>
            <button className="btn btn-ghost" onClick={() => setStep(0)}>Back</button>
            <button className="btn btn-primary" onClick={saveModel} disabled={!selectedModel || loadingModels}>Continue</button>
          </div>
        </>
      )}

      {/* Step 2: Callsign */}
      {step === 2 && (
        <>
          <h2 className="wizard-title">What Should I Call You?</h2>
          <p className="wizard-desc">This is how Agent-X will address you throughout our mission.</p>

          <div className="field" style={{ maxWidth: 360, margin: '0 auto' }}>
            <label className="label">Your Callsign</label>
            <input
              className="input"
              value={callsign}
              onChange={(e) => setCallsign(e.target.value)}
              placeholder="e.g. Alex, Captain, Boss"
              onKeyDown={(e) => { if (e.key === 'Enter') saveCallsign(); }}
              autoFocus
            />
            <div className="text-muted mt-8">This will be stored in your local config.</div>
          </div>

          <div className="wizard-actions" style={{ justifyContent: 'center' }}>
            <button className="btn btn-ghost" onClick={() => setStep(1)}>Back</button>
            <button className="btn btn-primary" onClick={saveCallsign} disabled={!callsign.trim()}>Continue</button>
          </div>
        </>
      )}

      {/* Step 3: Crew Name */}
      {step === 3 && (
        <>
          <h2 className="wizard-title">Name Your Crew Member</h2>
          <p className="wizard-desc">Crew members are your AI personas. Give your first one a name.</p>

          <div className="field" style={{ maxWidth: 360, margin: '0 auto' }}>
            <label className="label">Crew Name</label>
            <input
              className="input"
              value={crewName}
              onChange={(e) => setCrewName(e.target.value)}
              placeholder="e.g. Nova, Atlas, Jarvis"
              onKeyDown={(e) => { if (e.key === 'Enter') saveCrewName(); }}
              autoFocus
            />
            <div className="text-muted mt-8">You can create more crews later from the sidebar.</div>
          </div>

          <div className="wizard-actions" style={{ justifyContent: 'center' }}>
            <button className="btn btn-ghost" onClick={() => setStep(2)}>Back</button>
            <button className="btn btn-primary" onClick={saveCrewName} disabled={!crewName.trim()}>Continue</button>
          </div>
        </>
      )}

      {/* Step 4: Crew Prompt */}
      {step === 4 && (
        <>
          <h2 className="wizard-title">Define {crewName}&rsquo;s Role</h2>
          <p className="wizard-desc">Describe their expertise, personality, and any special instructions.</p>

          <div className="field">
            <label className="label">System Prompt / Specialization</label>
            <textarea
              className="input"
              value={crewPrompt}
              onChange={(e) => setCrewPrompt(e.target.value)}
              placeholder="e.g. You are a senior full-stack engineer who..."
              rows={5}
              style={{ resize: 'vertical' }}
              autoFocus
            />
            <div className="text-muted mt-8">Leave empty for a general-purpose assistant.</div>
          </div>

          <div className="wizard-actions" style={{ justifyContent: 'center' }}>
            <button className="btn btn-ghost" onClick={() => setStep(3)}>Back</button>
            <button className="btn btn-primary" onClick={saveCrewPrompt}>Continue</button>
          </div>
        </>
      )}

      {/* Step 5: Tone */}
      {step === 5 && (
        <>
          <h2 className="wizard-title">Choose {crewName}&rsquo;s Communication Style</h2>
          <p className="wizard-desc">How should {crewName} speak and respond?</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24, maxWidth: 400, margin: '0 auto' }}>
            {EMOTIONS.map((e) => (
              <div
                key={e.id}
                className="card"
                style={{
                  cursor: 'pointer',
                  borderColor: crewEmotion === e.id ? '#444' : undefined,
                  background: crewEmotion === e.id ? '#111' : undefined,
                }}
                onClick={() => setCrewEmotion(e.id)}
              >
                <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{e.label}</div>
                <div className="text-muted" style={{ fontSize: '0.75rem' }}>{e.desc}</div>
              </div>
            ))}
          </div>

          <div className="wizard-actions" style={{ justifyContent: 'center' }}>
            <button className="btn btn-ghost" onClick={() => setStep(4)}>Back</button>
            <button className="btn btn-primary" onClick={saveCrew}>Continue</button>
          </div>
        </>
      )}

      {/* Step 6: Telegram */}
      {step === 6 && (
        <>
          <h2 className="wizard-title">Connect Telegram (Optional)</h2>
          <p className="wizard-desc">Talk to Agent-X from your phone. You can skip this and set it up later.</p>

          {!skipTelegram ? (
            <div className="field" style={{ maxWidth: 360, margin: '0 auto' }}>
              <label className="label">Bot Token</label>
              <input className="input" value={telegramToken} onChange={(e) => setTelegramToken(e.target.value)} placeholder="123456789:ABCdef..." />
              <div className="mt-8 text-muted" style={{ fontSize: '0.78rem', lineHeight: 1.8, textAlign: 'left' }}>
                <strong style={{ color: '#aaa' }}>How to get a token:</strong><br />
                1. Open Telegram and search for <a href="https://t.me/BotFather" target="_blank" rel="noopener" style={{ color: '#888', textDecoration: 'underline' }}>@BotFather</a><br />
                2. Send <code style={{ color: '#ccc' }}>/newbot</code> and follow the prompts<br />
                3. Copy the token above
              </div>
            </div>
          ) : (
            <div className="card" style={{ textAlign: 'center', color: '#666', maxWidth: 360, margin: '0 auto' }}>
              Telegram skipped. Set up later from Settings.
            </div>
          )}

          <div className="wizard-actions" style={{ justifyContent: 'center' }}>
            <button className="btn btn-ghost" onClick={() => setStep(5)}>Back</button>
            {!skipTelegram && <button className="btn btn-ghost" onClick={() => setSkipTelegram(true)}>Skip</button>}
            <button className="btn btn-primary" onClick={saveTelegram}>Continue</button>
          </div>
        </>
      )}

      {/* Step 7: Launch */}
      {step === 7 && (
        <>
          <h2 className="wizard-title">Ready to Launch</h2>
          <p className="wizard-desc">All systems operational. Click launch to start using Agent-X.</p>

          <div className="card mb-16" style={{ maxWidth: 400, margin: '0 auto' }}>
            <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '1px' }}>Systems</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.85rem' }}>
              <div><span style={{ color: '#4ade80' }}>&#10003;</span> Neural Core &mdash; {PROVIDERS.find((p) => p.id === selectedProvider)?.name} / {selectedModel?.split('/').pop()}</div>
              <div><span style={{ color: '#4ade80' }}>&#10003;</span> Crew Member &mdash; {crewName || 'My Crew'}</div>
              <div><span style={{ color: telegramToken ? '#4ade80' : '#888' }}>{telegramToken ? '\u2713' : '\u2014'}</span> Comms Array &mdash; {telegramToken ? 'Linked' : 'Skipped'}</div>
            </div>
          </div>

          <div className="wizard-actions" style={{ justifyContent: 'center' }}>
            <button className="btn btn-ghost" onClick={() => setStep(6)}>Back</button>
            <button className="btn btn-primary" onClick={finish} disabled={saving}>
              {saving ? <><span className="spinner" /> Launching&hellip;</> : 'Launch Agent-X'}
            </button>
          </div>
        </>
      )}

      {/* global toasts handled by ToastProvider */}
    </div>
  );
}
