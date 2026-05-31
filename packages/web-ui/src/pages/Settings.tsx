import { useEffect, useState } from 'react';
import { apiGet, apiPut, apiPost, apiDelete } from '../api';
import ProviderModal from '../components/ProviderModal';
import { useToast } from '../components/ToastProvider';

export default function Settings() {
  const [callsign, setCallsign] = useState('');
  const [timezone, setTimezone] = useState('');
  const [showTokenBar, setShowTokenBar] = useState(true);
  const [showTimers, setShowTimers] = useState(true);
  const [animationSpeed, setAnimationSpeed] = useState('normal');
  const [tools, setTools] = useState<Array<{ id: string; name: string; category: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Telegram
  const [tgConfigured, setTgConfigured] = useState(false);
  const [tgToken, setTgToken] = useState('');
  const [tgSaving, setTgSaving] = useState(false);

  // Discord
  const [dcConfigured, setDcConfigured] = useState(false);
  const [dcConnected, setDcConnected] = useState(false);
  const [dcGuilds, setDcGuilds] = useState(0);
  const [dcToken, setDcToken] = useState('');
  const [dcChannel, setDcChannel] = useState('');
  const [dcSaving, setDcSaving] = useState(false);

  // Slack
  const [slConfigured, setSlConfigured] = useState(false);
  const [slBotToken, setSlBotToken] = useState('');
  const [slAppToken, setSlAppToken] = useState('');
  const [slSaving, setSlSaving] = useState(false);

  // Email
  const [emConfigured, setEmConfigured] = useState(false);
  const [emConnected, setEmConnected] = useState(false);
  const [emUnreadCount, setEmUnreadCount] = useState(0);
  const [emSmtpHost, setEmSmtpHost] = useState('');
  const [emSmtpPort, setEmSmtpPort] = useState('587');
  const [emSmtpUser, setEmSmtpUser] = useState('');
  const [emSmtpPass, setEmSmtpPass] = useState('');
  const [emImapHost, setEmImapHost] = useState('');
  const [emImapPort, setEmImapPort] = useState('993');
  const [emFrom, setEmFrom] = useState('');
  const [emSaving, setEmSaving] = useState(false);

  // Danger zone
  const [clearConfirm, setClearConfirm] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [sessionsCleared, setSessionsCleared] = useState(false);

  // Providers
  const [activeProvider, setActiveProvider] = useState('');
  const [activeModel, setActiveModel] = useState('');
  const [showProviderModal, setShowProviderModal] = useState(false);
  const toast = useToast();

  async function load() {
    await Promise.all([loadConfig(), loadTelegram(), loadDiscord(), loadSlack(), loadEmail(), loadTools()]);
  }

  async function loadConfig() {
    try {
      const cfg = await apiGet<{
        provider: { activeProvider: string; activeModel: string };
        ui: { showTokenBar: boolean; showTimers: boolean; animationSpeed: string };
        timezone?: string;
        user?: { callsign: string };
      }>('/api/config');
      setCallsign(cfg.user?.callsign || '');
      setTimezone(cfg.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
      setShowTokenBar(cfg.ui.showTokenBar);
      setShowTimers(cfg.ui.showTimers);
      setAnimationSpeed(cfg.ui.animationSpeed);
      setActiveProvider(cfg.provider.activeProvider);
      setActiveModel(cfg.provider.activeModel);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load configuration';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  async function loadTelegram() {
    try {
      const tg = await apiGet<{ configured: boolean }>('/api/telegram/status');
      setTgConfigured(tg.configured);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load Telegram status';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  async function loadDiscord() {
    try {
      const dc = await apiGet<{ configured: boolean; connected: boolean; guilds: number }>('/api/discord/status');
      setDcConfigured(dc.configured);
      setDcConnected(dc.connected);
      setDcGuilds(dc.guilds);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load Discord status';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  async function loadSlack() {
    try {
      const sl = await apiGet<{ configured: boolean }>('/api/slack/status');
      setSlConfigured(sl.configured);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load Slack status';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  async function loadEmail() {
    try {
      const em = await apiGet<{ configured: boolean; connected: boolean; unreadCount: number }>('/api/email/status');
      setEmConfigured(em.configured);
      setEmConnected(em.connected);
      setEmUnreadCount(em.unreadCount);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load Email status';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  async function loadTools() {
    try {
      const t = await apiGet<Array<{ id: string; name: string; category: string }>>('/api/tools');
      setTools(t);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load tools';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  useEffect(() => { load(); }, []);

  async function save() {
    setSaving(true);
    try {
      const existing = await apiGet('/api/config');
      const update: Record<string, unknown> = {
        ...(existing as Record<string, unknown>),
        timezone,
        ui: { showTokenBar, showTimers, animationSpeed },
      };
      if (callsign.trim()) update.user = { callsign: callsign.trim() };
      else update.user = undefined;
      await apiPut('/api/config', update);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      try { toast.clear(); } catch { /* ignore */ }
      try { toast.push('Settings saved', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to save settings';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    } finally {
      setSaving(false);
    }
  }

  async function saveTelegram() {
    if (!tgToken.trim()) return;
    setTgSaving(true);
    try {
      await apiPost('/api/telegram/start', { token: tgToken.trim() });
      setTgConfigured(true);
      setTgToken('');
      try { toast.push('Telegram connected', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Failed to connect Telegram';
      try { toast.push(raw, 'error'); } catch { /* ignore */ }
    }
    setTgSaving(false);
  }

  async function stopTelegram() {
    try {
      await apiPost('/api/telegram/stop');
      setTgConfigured(false);
      try { toast.push('Telegram disconnected', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Failed to disconnect Telegram';
      try { toast.push(raw, 'error'); } catch { /* ignore */ }
    }
  }

  async function saveDiscord() {
    if (!dcToken.trim()) return;
    setDcSaving(true);
    try {
      await apiPost('/api/discord/start', { token: dcToken.trim(), channelId: dcChannel.trim() || undefined });
      setDcConfigured(true);
      setDcToken('');
      setDcChannel('');
      try { toast.push('Discord connected', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Failed to connect Discord';
      try { toast.push(raw, 'error'); } catch { /* ignore */ }
    }
    setDcSaving(false);
  }

  async function stopDiscord() {
    try {
      await apiPost('/api/discord/stop');
      setDcConfigured(false);
      try { toast.push('Discord disconnected', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Failed to disconnect Discord';
      try { toast.push(raw, 'error'); } catch { /* ignore */ }
    }
  }

  async function saveSlack() {
    if (!slBotToken.trim() || !slAppToken.trim()) return;
    setSlSaving(true);
    try {
      await apiPost('/api/slack/start', { botToken: slBotToken.trim(), appToken: slAppToken.trim() });
      setSlConfigured(true);
      setSlBotToken('');
      setSlAppToken('');
      try { toast.push('Slack connected', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Failed to connect Slack';
      try { toast.push(raw, 'error'); } catch { /* ignore */ }
    }
    setSlSaving(false);
  }

  async function stopSlack() {
    try {
      await apiPost('/api/slack/stop');
      setSlConfigured(false);
      try { toast.push('Slack disconnected', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Failed to disconnect Slack';
      try { toast.push(raw, 'error'); } catch { /* ignore */ }
    }
  }

  async function saveEmail() {
    if (!emSmtpHost.trim() || !emSmtpUser.trim() || !emSmtpPass.trim()) return;
    setEmSaving(true);
    try {
      await apiPost('/api/email/start', {
        smtpHost: emSmtpHost.trim(),
        smtpPort: emSmtpPort.trim(),
        smtpUser: emSmtpUser.trim(),
        smtpPass: emSmtpPass.trim(),
        fromAddress: emFrom.trim() || emSmtpUser.trim(),
        imapHost: emImapHost.trim() || undefined,
        imapPort: emImapPort.trim() || undefined,
      });
      setEmConfigured(true);
      setEmConnected(true);
      setEmSmtpHost('');
      setEmSmtpPort('587');
      setEmSmtpUser('');
      setEmSmtpPass('');
      setEmImapHost('');
      setEmImapPort('993');
      setEmFrom('');
      try { toast.push('Email bridge connected', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Failed to connect Email';
      try { toast.push(raw, 'error'); } catch { /* ignore */ }
    }
    setEmSaving(false);
  }

  async function stopEmail() {
    try {
      await apiPost('/api/email/stop');
      setEmConfigured(false);
      setEmConnected(false);
      setEmUnreadCount(0);
      try { toast.push('Email bridge disconnected', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Failed to disconnect Email';
      try { toast.push(raw, 'error'); } catch { /* ignore */ }
    }
  }

  async function clearSessions() {
    try {
      try { toast.clear(); } catch { /* ignore */ }
      await apiDelete('/api/sessions');
      setSessionsCleared(true);
      try { toast.push('Sessions cleared', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Failed to clear sessions';
      try { toast.push(raw, 'error'); } catch { /* ignore */ }
    }
  }

  function confirmReset() {
    setResetConfirm(true);
  }

  async function doReset() {
    setResetting(true);
    try {
      await apiPost('/api/reset');
      window.location.href = '/wizard';
    } catch {
      setResetting(false);
      setResetConfirm(false);
      try { toast.push('Reset failed', 'error'); } catch { /* ignore */ }
    }
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-label">Settings</div>
          <div className="topbar-value">Configuration</div>
        </div>
      </div>

      <div className="page-scroll">
      <div style={{ padding: 24, maxWidth: 600, margin: '0 auto', width: '100%' }}>
        {/* General */}
        <div className="card mb-16">
            <div className="card-title mb-16">General</div>
            <div className="field">
              <label className="label">Your Callsign</label>
              <input className="input" value={callsign} onChange={(e) => setCallsign(e.target.value)} placeholder="Captain" />
            </div>
            <div className="field">
              <label className="label">Timezone</label>
              <select className="select" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {Intl.supportedValuesOf('timeZone').map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
            <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
            </button>
          </div>

          {/* Providers */}
          <div className="card mb-16">
            <div className="card-title mb-16">Provider</div>
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: '0.85rem', color: '#ccc' }}>{activeProvider}</span>
              <span className="prov-badge">{activeModel.split('/').pop() || '...'}</span>
            </div>
            <button className="btn btn-sm btn-secondary" onClick={() => setShowProviderModal(true)}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ width: 12, height: 12, marginRight: 4, verticalAlign: 'middle' }}>
                <path d="M2 4.5L8 2l6 2.5v9L8 16l-6-2.5z"/><path d="M8 2v14"/><path d="M2 4.5l6 2.5M14 4.5l-6 2.5"/>
              </svg>
              Change Provider
            </button>
          </div>

          {/* UI */}
          <div className="card mb-16">
            <div className="card-title mb-16">Display</div>
            <div className="field">
              <label className="flex items-center gap-8" style={{ cursor: 'pointer', fontSize: '0.85rem' }}>
                <input type="checkbox" checked={showTokenBar} onChange={(e) => setShowTokenBar(e.target.checked)} style={{ accentColor: '#fff' }} />
                Show Token Usage Bar
              </label>
            </div>
            <div className="field">
              <label className="flex items-center gap-8" style={{ cursor: 'pointer', fontSize: '0.85rem' }}>
                <input type="checkbox" checked={showTimers} onChange={(e) => setShowTimers(e.target.checked)} style={{ accentColor: '#fff' }} />
                Show Processing Timers
              </label>
            </div>
            <div className="field">
              <label className="label">Animation Speed</label>
              <select className="select" value={animationSpeed} onChange={(e) => setAnimationSpeed(e.target.value)}>
                <option value="normal">Normal</option>
                <option value="fast">Fast</option>
                <option value="reduced">Reduced</option>
              </select>
            </div>
            <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
            </button>
          </div>

          {/* Telegram */}
          <div className="card mb-16">
            <div className="card-title mb-16">Telegram</div>
            {tgConfigured ? (
              <div>
                <div style={{ color: '#888', fontSize: '0.85rem', marginBottom: 12 }}>
                  Telegram bot is configured and active.
                </div>
                <button className="btn btn-sm btn-secondary" onClick={stopTelegram}>Disconnect</button>
              </div>
            ) : (
              <div>
                <div className="field">
                  <label className="label">Bot Token</label>
                  <input className="input" value={tgToken} onChange={(e) => setTgToken(e.target.value)} placeholder="123456789:ABCdef..." />
                  <div className="mt-8 text-muted" style={{ fontSize: '0.78rem', lineHeight: 1.8 }}>
                    <strong style={{ color: '#aaa' }}>How to get a token:</strong><br />
                    1. Open Telegram &rarr; search for <a href="https://t.me/BotFather" target="_blank" rel="noopener" style={{ color: '#888', textDecoration: 'underline' }}>@BotFather</a><br />
                    2. Send <code style={{ color: '#ccc' }}>/newbot</code> and follow the prompts<br />
                    3. Choose a name and username for your bot<br />
                    4. Copy the token it gives you and paste it above
                  </div>
                </div>
                <button className="btn btn-sm btn-primary" onClick={saveTelegram} disabled={tgSaving || !tgToken.trim()}>
                  {tgSaving ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            )}
          </div>

          {/* Discord */}
          <div className="card mb-16">
            <div className="card-title mb-16">Discord</div>
            {dcConfigured ? (
              <div>
                <div style={{ color: '#888', fontSize: '0.85rem', marginBottom: 12 }}>
                  Discord bot is configured{dcConnected ? ` and connected (${dcGuilds} guild${dcGuilds === 1 ? '' : 's'})` : ''}.
                </div>
                <button className="btn btn-sm btn-secondary" onClick={stopDiscord}>Disconnect</button>
              </div>
            ) : (
              <div>
                <div className="field">
                  <label className="label">Bot Token</label>
                  <input className="input" value={dcToken} onChange={(e) => setDcToken(e.target.value)} placeholder="Bot token from Discord Developer Portal" />
                </div>
                <div className="field">
                  <label className="label">Channel ID (optional)</label>
                  <input className="input" value={dcChannel} onChange={(e) => setDcChannel(e.target.value)} placeholder="123456789012345678" />
                </div>
                <button className="btn btn-sm btn-primary" onClick={saveDiscord} disabled={dcSaving || !dcToken.trim()}>
                  {dcSaving ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            )}
          </div>

          {/* Slack */}
          <div className="card mb-16">
            <div className="card-title mb-16">Slack</div>
            {slConfigured ? (
              <div>
                <div style={{ color: '#888', fontSize: '0.85rem', marginBottom: 12 }}>
                  Slack bridge is configured and active.
                </div>
                <button className="btn btn-sm btn-secondary" onClick={stopSlack}>Disconnect</button>
              </div>
            ) : (
              <div>
                <div className="field">
                  <label className="label">Bot Token</label>
                  <input className="input" value={slBotToken} onChange={(e) => setSlBotToken(e.target.value)} placeholder="xoxb-..." />
                </div>
                <div className="field">
                  <label className="label">App Token</label>
                  <input className="input" value={slAppToken} onChange={(e) => setSlAppToken(e.target.value)} placeholder="xapp-..." />
                  <div className="mt-8 text-muted" style={{ fontSize: '0.78rem', lineHeight: 1.8 }}>
                    <strong style={{ color: '#aaa' }}>How to get tokens:</strong><br />
                    1. Go to <a href="https://api.slack.com/apps" target="_blank" rel="noopener" style={{ color: '#888', textDecoration: 'underline' }}>api.slack.com/apps</a> and create an app<br />
                    2. Under <em>OAuth & Permissions</em>, install the app and copy the <strong>Bot User OAuth Token</strong> (starts with xoxb-)<br />
                    3. Under <em>Basic Information</em>, generate an <strong>App-Level Token</strong> (starts with xapp-) with the <code>connections:write</code> scope
                  </div>
                </div>
                <button className="btn btn-sm btn-primary" onClick={saveSlack} disabled={slSaving || !slBotToken.trim() || !slAppToken.trim()}>
                  {slSaving ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            )}
          </div>

          {/* Email */}
          <div className="card mb-16">
            <div className="card-title mb-16">Email Bridge</div>
            {emConfigured ? (
              <div>
                <div style={{ color: '#888', fontSize: '0.85rem', marginBottom: 12 }}>
                  Email bridge is configured {emConnected ? 'and connected' : 'but not connected'}.
                  {emUnreadCount > 0 && (
                    <span style={{ marginLeft: 8, color: '#4caf50' }}>{emUnreadCount} unread</span>
                  )}
                </div>
                <button className="btn btn-sm btn-secondary" onClick={stopEmail}>Disconnect</button>
              </div>
            ) : (
              <div>
                <div className="field">
                  <label className="label">SMTP Host</label>
                  <input className="input" value={emSmtpHost} onChange={(e) => setEmSmtpHost(e.target.value)} placeholder="smtp.gmail.com" />
                </div>
                <div className="field">
                  <label className="label">SMTP Port</label>
                  <input className="input" value={emSmtpPort} onChange={(e) => setEmSmtpPort(e.target.value)} placeholder="587" />
                </div>
                <div className="field">
                  <label className="label">SMTP Username</label>
                  <input className="input" value={emSmtpUser} onChange={(e) => setEmSmtpUser(e.target.value)} placeholder="user@example.com" />
                </div>
                <div className="field">
                  <label className="label">SMTP Password</label>
                  <input className="input" type="password" value={emSmtpPass} onChange={(e) => setEmSmtpPass(e.target.value)} placeholder="App-specific password" />
                </div>
                <div className="field">
                  <label className="label">IMAP Host (optional)</label>
                  <input className="input" value={emImapHost} onChange={(e) => setEmImapHost(e.target.value)} placeholder="imap.gmail.com" />
                </div>
                <div className="field">
                  <label className="label">IMAP Port (optional)</label>
                  <input className="input" value={emImapPort} onChange={(e) => setEmImapPort(e.target.value)} placeholder="993" />
                </div>
                <div className="field">
                  <label className="label">From Address</label>
                  <input className="input" value={emFrom} onChange={(e) => setEmFrom(e.target.value)} placeholder="Agent-X <agent@example.com>" />
                </div>
                <button className="btn btn-sm btn-primary" onClick={saveEmail} disabled={emSaving || !emSmtpHost.trim() || !emSmtpUser.trim() || !emSmtpPass.trim()}>
                  {emSaving ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            )}
          </div>

          {/* Tools */}
          <div className="card mb-16">
            <div className="card-title mb-16">Available Tools ({tools.length})</div>
            <div style={{ fontSize: '0.75rem', color: '#666', lineHeight: 1.7, maxHeight: 300, overflowY: 'auto' }}>
              {tools.map((t) => (
                <div key={t.id} style={{ padding: '4px 0', borderBottom: '1px solid #111' }}>
                  <span style={{ color: '#aaa' }}>{t.name}</span>
                  <span style={{ color: '#555', marginLeft: 8, fontSize: '0.65rem' }}>{t.category}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Dangerous Actions */}
          <div className="card mb-16" style={{ borderColor: '#2a1a1a' }}>
            <div className="card-title mb-16" style={{ color: '#ff6b6b' }}>Danger Zone</div>

            <div className="mb-16" style={{ fontSize: '0.82rem', color: '#888', lineHeight: 1.6 }}>
              <strong style={{ color: '#aaa' }}>Clear All Sessions</strong>
              <br />Removes all chat history and session data. Your provider setup and crews are preserved.
            </div>
            <button className="btn btn-sm btn-secondary" style={{ borderColor: '#442222', color: '#ff6b6b' }} onClick={() => setClearConfirm(true)}>
              Clear All Sessions
            </button>

            <hr style={{ border: 'none', borderTop: '1px solid #1a1a1a', margin: '20px 0' }} />

            <div className="mb-16" style={{ fontSize: '0.82rem', color: '#888', lineHeight: 1.6 }}>
              <strong style={{ color: '#aaa' }}>Reset Everything</strong>
              <br />Deletes all config, API keys, crews, sessions, memories, and identity data. Agent-X will return to first-launch state.
            </div>
            <button className="btn btn-sm btn-secondary" style={{ borderColor: '#442222', color: '#ff6b6b' }} onClick={confirmReset}>
              Reset Everything
            </button>

          </div>
        </div>
      </div>

      {/* Provider modal */}
      {showProviderModal && (
        <ProviderModal onClose={() => setShowProviderModal(false)} onSwitch={() => load()} />
      )}

      {/* Clear sessions confirmation */}
      {clearConfirm && (
        <div className="overlay" onClick={() => setClearConfirm(false)}>
          <div className="overlay-box" onClick={(e) => e.stopPropagation()}>
            <div className="overlay-title">Clear All Sessions?</div>
            <div className="overlay-desc">This will remove all chat history and session data. Your provider setup, models, and crews will be preserved. This cannot be undone.</div>
            <div className="wizard-actions" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setClearConfirm(false)}>Cancel</button>
              <button className="btn btn-secondary" style={{ borderColor: '#442222', color: '#ff6b6b' }} onClick={() => { setClearConfirm(false); clearSessions(); }}>Yes, Clear All</button>
            </div>
          </div>
        </div>
      )}

      {/* Sessions cleared modal */}
      {sessionsCleared && (
        <div className="overlay" onClick={() => setSessionsCleared(false)}>
          <div className="overlay-box" onClick={(e) => e.stopPropagation()}>
            <div className="overlay-title">Sessions Cleared</div>
            <div className="overlay-desc">All chat history and session data have been removed. Your provider, models, and crews are unchanged.</div>
            <div className="wizard-actions">
              <button className="btn btn-primary" onClick={() => setSessionsCleared(false)}>OK</button>
            </div>
          </div>
        </div>
      )}

      {/* Reset confirmation modal */}
      {resetConfirm && (
        <div className="overlay" onClick={() => setResetConfirm(false)}>
          <div className="overlay-box" onClick={(e) => e.stopPropagation()}>
            <div className="overlay-title" style={{ color: '#ff6b6b' }}>Reset Everything?</div>
            <div className="overlay-desc">
              This will permanently delete <strong>all data</strong> &mdash; API keys, crews, sessions, memories, identity, and configuration. Agent-X will return to its first-launch state. <strong style={{ color: '#ff6b6b' }}>This cannot be undone.</strong>
            </div>
            <div className="wizard-actions" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setResetConfirm(false)}>Cancel</button>
              <button className="btn btn-secondary" style={{ borderColor: '#442222', color: '#ff6b6b' }} onClick={doReset} disabled={resetting}>
                {resetting ? 'Resetting...' : 'Yes, Reset Everything'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
