import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Stepper from '@mui/material/Stepper';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import { CheckCircle } from '../components/CheckCircle';
import BadgeIcon from '@mui/icons-material/Badge';
import StorageIcon from '@mui/icons-material/Storage';
import CloudIcon from '@mui/icons-material/Cloud';
import LockIcon from '@mui/icons-material/Lock';
import BoltIcon from '@mui/icons-material/Bolt';
import SyncAltIcon from '@mui/icons-material/SyncAlt';
import ShieldIcon from '@mui/icons-material/Shield';
import HubIcon from '@mui/icons-material/Hub';
import PublicIcon from '@mui/icons-material/Public';
import HomeIcon from '@mui/icons-material/Home';
import BuildIcon from '@mui/icons-material/Build';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import { providers as provApi, models as modelsApi, config, settings, personaApi } from '../api';
import { useApp } from '../store/AppContext';
import { useGlobalError } from '../components/ErrorBand';
import { colors } from '../theme';
import { PersonaConfigPanel } from '../components/settings/PersonaConfigPanel';
import type { ProviderInfo, ModelInfo, AgentPersonaConfig } from '../api';

const STEPS = ['Storage', 'Provider', 'Profile', 'Model', 'Callsign', 'Persona', 'Complete'];
const STORAGE_KEY = 'agentx_wizard_progress';

interface WizardProgress {
  step: number;
  selectedProvider: string;
  selectedModel: string;
  callsign: string;
  selectedBackend: string;
  persona?: AgentPersonaConfig;
}

function saveProgress(data: WizardProgress) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

function loadProgress(): WizardProgress | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as WizardProgress : null;
  } catch { return null; }
}

function clearProgress() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

export function SetupWizard() {
  const { setConfig, setAuthState, setView } = useApp();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const { showError, clearError } = useGlobalError();
  const [loading, setLoading] = useState(false);
  const [showBackWarning, setShowBackWarning] = useState(false);

  const [availableProviders, setAvailableProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [callsign, setCallsign] = useState('');
  const [persona, setPersona] = useState<AgentPersonaConfig>({ name: 'JARVIS', description: 'A sophisticated AI assistant that combines British precision with unwavering loyalty. Expert in data analysis, system management, and predictive modeling. Communicates with refined eloquence while maintaining strict operational efficiency.', communicationStyle: 'formal', decisionMaking: 'balanced', domainContext: 'Intelligent system management, data analysis, predictive modeling, and personal assistance with a focus on precision, security, and real-time situational awareness.', traits: ['Loyal', 'Precise', 'Analytical', 'Proactive', 'Witty', 'Calm under pressure'] });
  const [profileName, setProfileName] = useState('');
  const [showCustomConfig, setShowCustomConfig] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);

  // DB
  const [selectedBackend, setSelectedBackend] = useState<'sqlite' | 'postgres'>('sqlite');
  const [showRelayConfig, setShowRelayConfig] = useState(false);
  const [pgMode, setPgMode] = useState<'string' | 'fields'>('string');
  const [pgSsl, setPgSsl] = useState(true);
  const [pgConnStr, setPgConnStr] = useState('');
  const [pgHost, setPgHost] = useState('');
  const [pgPort, setPgPort] = useState('5432');
  const [pgUser, setPgUser] = useState('');
  const [pgPassword, setPgPassword] = useState('');
  const [pgDatabase, setPgDatabase] = useState('agentx');
  const [pgTesting, setPgTesting] = useState(false);
  const [pgTestResult, setPgTestResult] = useState<{ ok: boolean; version?: string; tablesCreated?: number; error?: string } | null>(null);
  const [sshEnabled, setSshEnabled] = useState(false);
  const [sshHost, setSshHost] = useState('');
  const [sshPort, setSshPort] = useState('22');
  const [sshUser, setSshUser] = useState('');
  const [sshAuthMode, setSshAuthMode] = useState<'password' | 'key'>('password');
  const [sshPassword, setSshPassword] = useState('');
  const [sshKey, setSshKey] = useState('');

  const buildPgConnStr = () => {
    if (pgMode === 'string') return pgConnStr;
    if (!pgHost || !pgUser) return '';
    const ep = encodeURIComponent(pgPassword);
    const params = pgSsl ? '?sslmode=no-verify' : '';
    return `postgresql://${pgUser}${ep ? ':' + ep : ''}@${pgHost}:${pgPort}/${pgDatabase}${params}`;
  };
  const buildSshConfig = () => {
    if (!sshEnabled || !sshHost || !sshUser) return null;
    return { host: sshHost, port: parseInt(sshPort) || 22, username: sshUser, password: sshAuthMode === 'password' ? sshPassword : undefined, privateKey: sshAuthMode === 'key' ? sshKey : undefined };
  };

  // Progress restore — shift threshold since no relay step
  useEffect(() => {
    const saved = loadProgress();
    if (saved && saved.step >= 1) {
      setStep(saved.step);
      setSelectedProvider(saved.selectedProvider);
      setSelectedModel(saved.selectedModel);
      setCallsign(saved.callsign || '');
      if (saved.selectedBackend) setSelectedBackend(saved.selectedBackend as 'sqlite' | 'postgres');
      if (saved.persona) setPersona(saved.persona);
      if (saved.selectedProvider) {
        setModelsLoading(true);
        provApi.models(saved.selectedProvider).then(m => { setAvailableModels(m); setModelsLoading(false); }).catch(() => setModelsLoading(false));
      }
    }
    provApi.available().then(p => setAvailableProviders(p.filter(Boolean))).catch(() => showError('Failed to load providers.'));
  }, []);

  useEffect(() => {
    if (availableProviders.length === 0 && !loading) {
      setLoading(true);
      provApi.available().then(p => { setAvailableProviders(p.filter(Boolean)); setLoading(false); }).catch(() => { showError('Cannot reach the server.'); setLoading(false); });
    }
  }, []);

  const persistProgress = useCallback(() => {
    if (step >= 1) saveProgress({ step, selectedProvider, selectedModel, callsign, selectedBackend, persona });
  }, [step, selectedProvider, selectedModel, callsign, selectedBackend, persona]);
  useEffect(() => { persistProgress(); }, [persistProgress]);

  const next = () => { clearError(); setStep(s => s + 1); };
  const back = () => { clearError(); setStep(s => s - 1); };

  const handleStorageNext = () => {
    if (selectedBackend === 'postgres') {
      setShowRelayConfig(true);
    } else {
      next();
    }
  };

  const handleRelayNext = async () => {
    const connStr = buildPgConnStr();
    if (!connStr) { showError('Enter connection details'); return; }
    setPgTesting(true); setPgTestResult(null);
    try {
      const r = await settings.db.testAdvanced(connStr, buildSshConfig());
      setPgTestResult(r);
      if (!r.ok) { showError(r.error || 'Connection test failed'); setPgTesting(false); return; }
    } catch (e) { showError(e instanceof Error ? e.message : 'Connection test failed'); setPgTesting(false); return; }
    setPgTesting(false);
    next();
  };

  const handleBackToCredentials = () => { setShowBackWarning(true); };
  const confirmBackToCredentials = () => {
    setShowBackWarning(false); setApiKey(''); setBaseUrl(''); setAvailableModels([]); setSelectedModel(''); clearProgress(); setStep(2);
  };

  const selectedProviderInfo = availableProviders.find(p => p.id === selectedProvider);
  const isLocal = selectedProviderInfo?.type === 'local';
  const isAzure = selectedProvider === 'azure';

  const handleProviderNext = () => {
    if (!selectedProvider) { showError('Select a provider'); return; }
    if (selectedProviderInfo?.type === 'local' && !baseUrl) setBaseUrl(selectedProviderInfo.defaultBaseUrl ?? '');
    next();
  };
  const handleProfileNext = async () => {
    if (!profileName.trim()) { showError('Enter a profile name'); return; }
    if (!isLocal && !apiKey.trim()) { showError('Enter your API key'); return; }
    if (isAzure && !baseUrl.trim()) { showError('Azure requires a resource endpoint URL'); return; }
    setLoading(true);
    try {
      const r = await provApi.validate(selectedProvider, isLocal ? 'no-key-needed' : apiKey || undefined, baseUrl || undefined);
      if (!r.valid) { showError(r.error ?? 'Invalid credentials'); setLoading(false); return; }
      await provApi.configure(selectedProvider, isLocal ? 'no-key-needed' : apiKey || undefined, baseUrl || undefined, profileName.trim());
      const ml = await provApi.models(selectedProvider);
      setAvailableModels(ml); next();
    } catch (err) { showError(err instanceof Error ? err.message : 'Validation failed'); }
    finally { setLoading(false); }
  };
  const handleModelNext = async () => {
    if (!selectedModel) { showError('Select a model'); return; }
    // Global model switch — works with or without an active session
    try { await modelsApi.switch(selectedModel); } catch {}
    next();
  };
  const handleCallsignNext = () => { next(); };

  const handleComplete = async () => {
    setLoading(true);
    try {
      if (selectedBackend === 'postgres') {
        const connStr = buildPgConnStr();
        if (connStr) {
          try { await settings.db.update({ backend: 'postgres', postgres: { connectionString: connStr } }); } catch {}
        }
      }
      try { await personaApi.save(persona); } catch {}
      const r = await config.update({ setupComplete: true, user: { callsign } });
      if (!r.ok) { showError('Failed to save setup.'); setLoading(false); return; }
      clearProgress();
      setAuthState('authenticated');
      setView('docking');
      navigate('/', { replace: true });
      void config.get().then((cfg) => setConfig(cfg)).catch(() => {});
    } catch (err) { showError(err instanceof Error ? err.message : 'Setup could not be saved.'); }
    finally { setLoading(false); }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: '#000' }}>
      <Box sx={{ flexShrink: 0, textAlign: 'center', pt: 4, px: 2, pb: 2 }}>
        <Typography variant="h2" sx={{ mb: 1 }}>SETUP WIZARD</Typography>
        <Typography variant="body2" sx={{ color: colors.text.tertiary, mb: 3 }}>Configure your Agent-X instance</Typography>
        <Stepper activeStep={step} alternativeLabel sx={{ width: '100%', maxWidth: 880, mx: 'auto' }}>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel sx={{ '& .MuiStepLabel-label': { color: colors.text.dim, fontSize: '0.6rem', fontFamily: "'JetBrains Mono', monospace" } }}>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', px: 2 }}>
        <Box sx={{ width: '100%', maxWidth: 820 }}>
          <Box sx={{ pt: 0, pb: 2 }}>

          {/* ─── Step 0: Storage (or Relay Config) ─── */}
          {step === 0 && !showRelayConfig && (
            <Box>
              <Box sx={{ textAlign: 'center', mb: 3 }}>
                <Typography variant="h6" sx={{ fontWeight: 800, fontSize: '1.1rem' }}>Power Your Agent</Typography>
                <Typography variant="body2" sx={{ color: colors.text.dim, fontSize: '0.62rem', maxWidth: 480, mx: 'auto', mt: 0.5 }}>
                  Every memory, message, and crew identity lives here. Credentials stay encrypted on this machine — always.
                </Typography>
              </Box>

              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                <Box onClick={() => { setSelectedBackend('sqlite'); setPgTestResult(null); }}
                  sx={{ p: 2.5, border: `2px solid ${selectedBackend === 'sqlite' ? colors.accent.green : colors.border.default}`, borderRadius: 2, cursor: 'pointer',
                    bgcolor: selectedBackend === 'sqlite' ? `${colors.accent.green}05` : colors.bg.secondary,
                    boxShadow: selectedBackend === 'sqlite' ? `0 0 20px ${colors.accent.green}10` : 'none', display: 'flex', flexDirection: 'column',
                    transition: 'all 0.2s', '&:hover': { borderColor: selectedBackend === 'sqlite' ? colors.accent.green : colors.border.strong } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                    <Box sx={{ width: 36, height: 36, borderRadius: 1, bgcolor: `${colors.accent.green}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${colors.accent.green}20`, flexShrink: 0 }}>
                      <StorageIcon sx={{ fontSize: 18, color: colors.accent.green }} />
                    </Box>
                    <Box>
                      <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: colors.text.primary }}>Onboard Vault</Typography>
                      <Typography sx={{ fontSize: '0.52rem', fontFamily: "'JetBrains Mono', monospace", color: colors.accent.green, letterSpacing: '1.5px' }}>NATIVE SQLITE</Typography>
                    </Box>
                    {selectedBackend === 'sqlite' && <Box sx={{ ml: 'auto', width: 18, height: 18, borderRadius: '50%', bgcolor: colors.accent.green, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Typography sx={{ fontSize: '0.6rem', color: '#000', fontWeight: 900 }}>✓</Typography></Box>}
                  </Box>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mb: 2 }}>
                    <Punch text="Zero latency. Reads hit memory, not the network." icon={<BoltIcon sx={{ fontSize: 13 }} />} />
                    <Punch text="One file. Your entire world backs up with a single copy." icon={<HomeIcon sx={{ fontSize: 13 }} />} />
                    <Punch text="Air-gapped by default. No ports. No servers. No attack surface." icon={<ShieldIcon sx={{ fontSize: 13 }} />} />
                    <Punch text="AES-256-GCM. Every byte encrypted before touching disk." icon={<LockIcon sx={{ fontSize: 13 }} />} />
                    <Punch text="Zero config. Agent-X builds and manages everything." icon={<BuildIcon sx={{ fontSize: 13 }} />} />
                    <Punch text="WAL mode. Crash-proof. Close your laptop mid-flight." icon={<BoltIcon sx={{ fontSize: 13 }} />} />
                    <Punch text="Instant portability. Move machines by copying a single file." icon={<HomeIcon sx={{ fontSize: 13 }} />} />
                  </Box>
                  <Box sx={{ p: 1.2, borderRadius: 1, bgcolor: `${colors.accent.green}06`, border: `1px solid ${colors.accent.green}10`, mt: 'auto' }}>
                    <Typography sx={{ fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace", color: colors.accent.green, textAlign: 'center', fontWeight: 600 }}>
                      For hackers, solo devs, and anyone who wants raw speed.
                    </Typography>
                  </Box>
                </Box>

                <Box onClick={() => { setSelectedBackend('postgres'); setPgTestResult(null); }}
                  sx={{ p: 2.5, border: `2px solid ${selectedBackend === 'postgres' ? colors.accent.blue : colors.border.default}`, borderRadius: 2, cursor: 'pointer',
                    bgcolor: selectedBackend === 'postgres' ? `${colors.accent.blue}05` : colors.bg.secondary,
                    boxShadow: selectedBackend === 'postgres' ? `0 0 20px ${colors.accent.blue}10` : 'none', display: 'flex', flexDirection: 'column',
                    transition: 'all 0.2s', '&:hover': { borderColor: selectedBackend === 'postgres' ? colors.accent.blue : colors.border.strong } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                    <Box sx={{ width: 36, height: 36, borderRadius: 1, bgcolor: `${colors.accent.blue}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${colors.accent.blue}20`, flexShrink: 0 }}>
                      <CloudIcon sx={{ fontSize: 18, color: colors.accent.blue }} />
                    </Box>
                    <Box>
                      <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: colors.text.primary }}>Starfleet Relay</Typography>
                      <Typography sx={{ fontSize: '0.52rem', fontFamily: "'JetBrains Mono', monospace", color: colors.accent.blue, letterSpacing: '1.5px' }}>YOUR POSTGRESQL</Typography>
                    </Box>
                    {selectedBackend === 'postgres' && <Box sx={{ ml: 'auto', width: 18, height: 18, borderRadius: '50%', bgcolor: colors.accent.blue, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Typography sx={{ fontSize: '0.6rem', color: '#000', fontWeight: 900 }}>✓</Typography></Box>}
                  </Box>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mb: 2 }}>
                    <Punch text="Desktop. Laptop. Server. One brain, everywhere you go." icon={<SyncAltIcon sx={{ fontSize: 13 }} />} />
                    <Punch text="Multiple agents. Zero conflicts. PostgreSQL handles the orchestra." icon={<HubIcon sx={{ fontSize: 13 }} />} />
                    <Punch text="AWS · Supabase · Neon · Railway · Raspberry Pi. Your call." icon={<PublicIcon sx={{ fontSize: 13 }} />} />
                    <Punch text="Same DEK encryption. PG sees only ciphertext. Always." icon={<ShieldIcon sx={{ fontSize: 13 }} />} />
                    <Punch text="One click. 12 tables. 9 indexes. Schema auto-built on connect." icon={<AutoAwesomeIcon sx={{ fontSize: 13 }} />} />
                    <Punch text="Managed backups. pg_dump, WAL archiving, point-in-time recovery." icon={<CloudIcon sx={{ fontSize: 13 }} />} />
                    <Punch text="Concurrent access. MVCC means zero file locks, zero corruption." icon={<HubIcon sx={{ fontSize: 13 }} />} />
                  </Box>
                  <Box sx={{ p: 1.2, borderRadius: 1, bgcolor: `${colors.accent.blue}06`, border: `1px solid ${colors.accent.blue}10`, mt: 'auto' }}>
                    <Typography sx={{ fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace", color: colors.accent.blue, textAlign: 'center', fontWeight: 600 }}>
                      For multi-machine setups, teams, and cloud-native workflows.
                    </Typography>
                  </Box>
                </Box>
              </Box>
            </Box>
          )}

          {/* ─── Step 0b: Relay Config ─── */}
          {step === 0 && showRelayConfig && (
            <Box sx={{ maxWidth: 600, mx: 'auto' }}>
              <Box sx={{ textAlign: 'center', mb: 3 }}>
                <Box sx={{ width: 48, height: 48, borderRadius: 1.5, bgcolor: `${colors.accent.blue}15`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${colors.accent.blue}25`, mb: 1.5 }}>
                  <RocketLaunchIcon sx={{ fontSize: 24, color: colors.accent.blue }} />
                </Box>
                <Typography variant="h6" sx={{ fontWeight: 800, fontSize: '1.1rem' }}>Configure Your Relay</Typography>
                <Typography variant="body2" sx={{ color: colors.text.dim, fontSize: '0.62rem', mt: 0.5 }}>
                  Connect your PostgreSQL instance. Agent-X auto-provisions the schema on first contact.
                </Typography>
              </Box>

              <Box sx={{ p: 3, border: `1px solid ${colors.accent.blue}25`, borderRadius: 2, bgcolor: colors.bg.secondary }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: colors.text.primary }}>Connection</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <Button size="small" onClick={() => setPgMode('string')}
                      sx={{ fontSize: '0.58rem', fontFamily: "'JetBrains Mono', monospace", textTransform: 'none', py: 0, px: 1, color: pgMode === 'string' ? colors.accent.blue : colors.text.dim, minWidth: 0, borderBottom: pgMode === 'string' ? `1px solid ${colors.accent.blue}` : '1px solid transparent', borderRadius: 0 }}>
                      Connection String
                    </Button>
                    <Button size="small" onClick={() => setPgMode('fields')}
                      sx={{ fontSize: '0.58rem', fontFamily: "'JetBrains Mono', monospace", textTransform: 'none', py: 0, px: 1, color: pgMode === 'fields' ? colors.accent.blue : colors.text.dim, minWidth: 0, borderBottom: pgMode === 'fields' ? `1px solid ${colors.accent.blue}` : '1px solid transparent', borderRadius: 0 }}>
                      Individual Fields
                    </Button>
                  </Box>
                </Box>

                {pgMode === 'string' ? (
                  <TextField size="small" fullWidth placeholder="postgresql://user:pass@host:5432/agentx?sslmode=no-verify"
                    value={pgConnStr} onChange={e => { setPgConnStr(e.target.value); setPgTestResult(null); }} sx={{ mb: 2 }}
                    slotProps={{ input: { sx: { fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace" } } }} />
                ) : (
                  <>
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 1 }}>
                      <TextField size="small" label="Host" value={pgHost} onChange={e => setPgHost(e.target.value)} placeholder="db.example.com" slotProps={{ input: { sx: { fontSize: '0.7rem' } }, inputLabel: { sx: { fontSize: '0.6rem' } } }} />
                      <TextField size="small" label="Port" value={pgPort} onChange={e => setPgPort(e.target.value)} placeholder="5432" slotProps={{ input: { sx: { fontSize: '0.7rem' } }, inputLabel: { sx: { fontSize: '0.6rem' } } }} />
                      <TextField size="small" label="User" value={pgUser} onChange={e => setPgUser(e.target.value)} placeholder="agentx" slotProps={{ input: { sx: { fontSize: '0.7rem' } }, inputLabel: { sx: { fontSize: '0.6rem' } } }} />
                      <TextField size="small" label="Password" type="password" value={pgPassword} onChange={e => setPgPassword(e.target.value)} placeholder="••••" slotProps={{ input: { sx: { fontSize: '0.7rem' } }, inputLabel: { sx: { fontSize: '0.6rem' } } }} />
                      <TextField size="small" label="Database" value={pgDatabase} onChange={e => setPgDatabase(e.target.value)} sx={{ gridColumn: '1 / -1' }} placeholder="agentx" slotProps={{ input: { sx: { fontSize: '0.7rem' } }, inputLabel: { sx: { fontSize: '0.6rem' } } }} />
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                      <Box onClick={() => setPgSsl(!pgSsl)} sx={{ width: 14, height: 14, borderRadius: '3px', border: `1.5px solid ${pgSsl ? colors.accent.green : colors.border.strong}`, bgcolor: pgSsl ? colors.accent.green : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {pgSsl && <Typography sx={{ fontSize: '0.5rem', color: '#000', fontWeight: 900 }}>✓</Typography>}
                      </Box>
                      <Typography sx={{ fontSize: '0.62rem', color: colors.text.secondary, fontFamily: "'JetBrains Mono', monospace" }}>SSL ({pgSsl ? 'no-verify' : 'off'})</Typography>
                    </Box>
                  </>
                )}

                {/* SSH Tunnel */}
                <Box sx={{ pt: 1.5, borderTop: `1px solid ${colors.border.default}` }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: sshEnabled ? 1.5 : 0, cursor: 'pointer' }} onClick={() => setSshEnabled(!sshEnabled)}>
                    <Box onClick={e => { e.stopPropagation(); setSshEnabled(!sshEnabled); }} sx={{ width: 14, height: 14, borderRadius: '3px', border: `1.5px solid ${sshEnabled ? colors.accent.blue : colors.border.strong}`, bgcolor: sshEnabled ? colors.accent.blue : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {sshEnabled && <Typography sx={{ fontSize: '0.5rem', color: '#000', fontWeight: 900 }}>✓</Typography>}
                    </Box>
                    <Typography sx={{ fontSize: '0.62rem', color: colors.text.secondary, fontFamily: "'JetBrains Mono', monospace" }}>SSH Tunnel {sshEnabled ? '· bastion / jump host' : '(optional)'}</Typography>
                  </Box>
                  {sshEnabled && (
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 1 }}>
                      <TextField size="small" label="SSH Host" value={sshHost} onChange={e => setSshHost(e.target.value)} placeholder="bastion.example.com" slotProps={{ input: { sx: { fontSize: '0.7rem' } }, inputLabel: { sx: { fontSize: '0.6rem' } } }} />
                      <TextField size="small" label="SSH Port" value={sshPort} onChange={e => setSshPort(e.target.value)} placeholder="22" slotProps={{ input: { sx: { fontSize: '0.7rem' } }, inputLabel: { sx: { fontSize: '0.6rem' } } }} />
                      <TextField size="small" label="SSH User" value={sshUser} onChange={e => setSshUser(e.target.value)} sx={{ gridColumn: '1 / -1' }} placeholder="ubuntu" slotProps={{ input: { sx: { fontSize: '0.7rem' } }, inputLabel: { sx: { fontSize: '0.6rem' } } }} />
                      <Box sx={{ gridColumn: '1 / -1', display: 'flex', gap: 0.5 }}>
                        <Button size="small" onClick={() => setSshAuthMode('password')} sx={{ fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace", textTransform: 'none', py: 0, px: 1, color: sshAuthMode === 'password' ? colors.accent.blue : colors.text.dim, minWidth: 0, borderBottom: sshAuthMode === 'password' ? `1px solid ${colors.accent.blue}` : '1px solid transparent', borderRadius: 0 }}>Password</Button>
                        <Button size="small" onClick={() => setSshAuthMode('key')} sx={{ fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace", textTransform: 'none', py: 0, px: 1, color: sshAuthMode === 'key' ? colors.accent.blue : colors.text.dim, minWidth: 0, borderBottom: sshAuthMode === 'key' ? `1px solid ${colors.accent.blue}` : '1px solid transparent', borderRadius: 0 }}>Private Key</Button>
                      </Box>
                      {sshAuthMode === 'password'
                        ? <TextField size="small" label="SSH Password" type="password" value={sshPassword} onChange={e => setSshPassword(e.target.value)} sx={{ gridColumn: '1 / -1' }} placeholder="••••" slotProps={{ input: { sx: { fontSize: '0.7rem' } }, inputLabel: { sx: { fontSize: '0.6rem' } } }} />
                        : (
                          <Box sx={{ gridColumn: '1 / -1' }}>
                            <TextField size="small" label="Private Key" multiline rows={3} value={sshKey} onChange={e => setSshKey(e.target.value)}
                              fullWidth placeholder="Paste your key or upload a file..."
                              slotProps={{ input: { sx: { fontSize: '0.58rem', fontFamily: "'JetBrains Mono', monospace" } }, inputLabel: { sx: { fontSize: '0.6rem' } } }} />
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75 }}>
                              <Button component="label" size="small"
                                sx={{ fontSize: '0.58rem', fontFamily: "'JetBrains Mono', monospace", textTransform: 'none', color: colors.text.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 0.5, px: 1.5, py: 0.25, '&:hover': { borderColor: colors.border.strong } }}>
                                Upload Key File
                                <input type="file" hidden onChange={e => {
                                  const file = e.target.files?.[0];
                                  if (file) { const r = new FileReader(); r.onload = () => setSshKey(r.result as string); r.readAsText(file); }
                                }} />
                              </Button>
                              <Typography sx={{ fontSize: '0.52rem', color: colors.text.dim }}>~/.ssh/id_rsa, .pem, or any OpenSSH key</Typography>
                            </Box>
                          </Box>
                        )
                      }
                    </Box>
                  )}
                </Box>

                {pgTestResult && (
                  <Box sx={{ mt: 2, p: 1.5, borderRadius: 1, bgcolor: pgTestResult.ok ? `${colors.accent.green}08` : `${colors.accent.red}08`, border: `1px solid ${pgTestResult.ok ? `${colors.accent.green}25` : `${colors.accent.red}25`}` }}>
                    <Typography sx={{ fontSize: '0.62rem', fontFamily: "'JetBrains Mono', monospace", color: pgTestResult.ok ? colors.accent.green : colors.accent.red, fontWeight: 600 }}>
                      {pgTestResult.ok ? 'RELAY ONLINE' : 'CONNECTION FAILED'}
                    </Typography>
                    <Typography sx={{ fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace", color: pgTestResult.ok ? `${colors.accent.green}aa` : `${colors.accent.red}aa`, mt: 0.25 }}>
                      {pgTestResult.ok ? `${pgTestResult.version || 'PostgreSQL'} · ${pgTestResult.tablesCreated ? `${pgTestResult.tablesCreated} tables created` : 'Schema verified'}` : pgTestResult.error}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>
          )}

          {/* ─── Step 1-6: Provider, API Key, Model, Callsign, Persona, Complete ── */}
          {step >= 1 && (
            <Box>
              {step === 1 && (
                <Box>
                  <Typography variant="h6" sx={{ mb: 0.5, textAlign: 'center' }}>Choose AI Provider</Typography>
                  <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', color: colors.text.dim, mb: 2, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '1px' }}>CLOUD</Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1.5, mb: 2 }}>
                    {availableProviders.filter(Boolean).filter(p => p.type === 'cloud').map(p => (
                      <Box key={p.id} onClick={() => setSelectedProvider(p.id)}
                        sx={{ p: 1.5, border: `1px solid ${selectedProvider === p.id ? colors.accent.blue : colors.border.default}`, borderRadius: 1, cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s', bgcolor: selectedProvider === p.id ? colors.accent.blue : 'transparent', boxShadow: selectedProvider === p.id ? `0 0 12px ${colors.accent.blue}40` : 'none', '&:hover': selectedProvider === p.id ? {} : { borderColor: colors.border.strong, bgcolor: colors.bg.tertiary } }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem', color: selectedProvider === p.id ? '#000' : colors.text.primary }}>{p.name}</Typography>
                      </Box>
                    ))}
                  </Box>
                  <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', color: colors.text.dim, mb: 1.5, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '1px' }}>LOCAL</Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1.5 }}>
                    {availableProviders.filter(Boolean).filter(p => p.type === 'local').map(p => (
                      <Box key={p.id} onClick={() => setSelectedProvider(p.id)}
                        sx={{ p: 1.5, border: `1px solid ${selectedProvider === p.id ? colors.accent.green : colors.border.default}`, borderRadius: 1, cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s', bgcolor: selectedProvider === p.id ? colors.accent.green : 'transparent', boxShadow: selectedProvider === p.id ? `0 0 12px ${colors.accent.green}40` : 'none', '&:hover': selectedProvider === p.id ? {} : { borderColor: colors.border.strong, bgcolor: colors.bg.tertiary } }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem', color: selectedProvider === p.id ? '#000' : colors.text.primary }}>{p.name}</Typography>
                      </Box>
                    ))}
                  </Box>
                  {availableProviders.length === 0 && <Typography variant="body2" sx={{ color: colors.text.dim, textAlign: 'center', mt: 2 }}>Loading providers...</Typography>}
                </Box>
              )}

              {step === 2 && (
                <Box>
                  <Typography variant="h6" sx={{ mb: 1, fontSize: '1.1rem' }}>
                    {isLocal ? 'Name Your Local Profile' : isAzure ? 'Azure Profile' : 'Configure Profile'}
                  </Typography>
                  <Typography variant="body2" sx={{ color: colors.text.tertiary, mb: 2, fontSize: '0.78rem' }}>
                    {isLocal ? `Connecting to ${selectedProviderInfo?.name ?? 'local provider'}. No API key needed.` : isAzure ? 'Enter your Azure endpoint and API key' : `Set up your ${selectedProviderInfo?.name ?? ''} connection`}
                  </Typography>

                  <TextField label="Profile Name" value={profileName} onChange={e => setProfileName(e.target.value)} fullWidth
                    placeholder='e.g. "My OpenAI Key" or "Work Account"'
                    sx={{ mb: !isLocal ? 2 : 1.5 }}
                    slotProps={{ input: { sx: { fontSize: '0.8rem' } }, inputLabel: { sx: { fontSize: '0.75rem' } } }} />

                  {!isLocal && (
                    <TextField label="API Key" value={apiKey} onChange={e => setApiKey(e.target.value)} fullWidth type="password"
                      sx={{ mb: 2 }}
                      slotProps={{ input: { sx: { fontSize: '0.8rem' } }, inputLabel: { sx: { fontSize: '0.75rem' } } }} />
                  )}

                  {isLocal && (
                    <>
                      <Button size="small" onClick={() => setShowCustomConfig(!showCustomConfig)}
                        sx={{ fontSize: '0.65rem', fontFamily: "'JetBrains Mono', monospace", textTransform: 'none', color: colors.text.dim, px: 0, minWidth: 0, mb: 1.5,
                          '&:hover': { color: colors.text.secondary, bgcolor: 'transparent' } }}>
                        {showCustomConfig ? '− Hide Custom Configuration' : '+ Custom Configuration'}
                      </Button>

                      <Box sx={{
                        overflow: 'hidden',
                        maxHeight: showCustomConfig ? 200 : 0,
                        opacity: showCustomConfig ? 1 : 0,
                        transition: 'max-height 0.25s ease, opacity 0.2s ease, margin 0.25s ease',
                        mb: showCustomConfig ? 2 : 0,
                      }}>
                        <Box sx={{ p: 2, borderRadius: 1, border: `1px solid ${colors.border.default}`, bgcolor: colors.bg.secondary }}>
                          <Typography sx={{ fontSize: '0.62rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, mb: 1.5, letterSpacing: '0.5px' }}>
                            ADVANCED CONNECTION SETTINGS
                          </Typography>
                          <TextField label="Base URL" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} fullWidth
                            placeholder={selectedProviderInfo?.defaultBaseUrl ?? 'https://api.example.com/v1'}
                            sx={{ mb: 1.5 }}
                            slotProps={{ input: { sx: { fontSize: '0.8rem' } }, inputLabel: { sx: { fontSize: '0.75rem' } } }} />
                          <TextField label="Port (optional)" value={pgPort} onChange={e => setPgPort(e.target.value)} fullWidth placeholder="11434"
                            slotProps={{ input: { sx: { fontSize: '0.8rem' } }, inputLabel: { sx: { fontSize: '0.75rem' } } }} />
                        </Box>
                      </Box>
                    </>
                  )}
                </Box>
              )}

              {step === 3 && (
                <Box>
                  <Typography variant="h6" sx={{ mb: 0.5 }}>Select Model</Typography>
                  <Typography variant="body2" sx={{ color: colors.text.tertiary, mb: 2 }}>{availableModels.length} model{availableModels.length !== 1 ? 's' : ''} available from {selectedProviderInfo?.name ?? selectedProvider}</Typography>
                  {modelsLoading ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, py: 4 }}><CircularProgress size={16} /><Typography variant="body2" sx={{ color: colors.text.dim }}>Loading models...</Typography></Box>
                  ) : (
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 1.5 }}>
                      {availableModels.filter(Boolean).map(m => (
                        <Box key={m.id} onClick={() => setSelectedModel(m.id)}
                          sx={{ p: 1.5, border: `1px solid ${selectedModel === m.id ? colors.accent.blue : colors.border.default}`, borderRadius: 1, cursor: 'pointer', transition: 'all 0.2s', bgcolor: selectedModel === m.id ? colors.accent.blue : 'transparent', boxShadow: selectedModel === m.id ? `0 0 12px ${colors.accent.blue}40` : 'none', '&:hover': selectedModel === m.id ? {} : { borderColor: colors.border.strong, bgcolor: colors.bg.tertiary } }}>
                          <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem', color: selectedModel === m.id ? '#000' : colors.text.primary, mb: 0.5, wordBreak: 'break-word' }}>{m.name}</Typography>
                          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            {m.contextWindow && <Typography variant="caption" sx={{ fontSize: '0.6rem', fontFamily: "'JetBrains Mono', monospace", color: selectedModel === m.id ? '#000000aa' : colors.text.dim }}>{m.contextWindow >= 1000000 ? `${(m.contextWindow / 1000000).toFixed(1)}M` : `${Math.round(m.contextWindow / 1000)}K`} ctx</Typography>}
                            {m.capabilities?.filter(c => c !== 'text' && c !== 'streaming').map(cap => <Typography key={cap} variant="caption" sx={{ fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace", color: selectedModel === m.id ? '#000000aa' : colors.accent.cyan, textTransform: 'uppercase' }}>{cap}</Typography>)}
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>
              )}

              {step === 4 && (
                <Box>
                  <Typography variant="h6" sx={{ mb: 1 }}>Your Callsign</Typography>
                  <Typography variant="body2" sx={{ color: colors.text.tertiary, mb: 2 }}>How should Agent-X address you?</Typography>
                  <TextField label="Callsign" value={callsign} onChange={e => setCallsign(e.target.value)} fullWidth placeholder="e.g. Commander"
                    slotProps={{ input: { sx: { fontSize: '0.8rem' } }, inputLabel: { sx: { fontSize: '0.75rem' } } }} />
                  <Box sx={{ mt: 4, p: 2.5, border: `1px solid ${colors.border.default}`, borderRadius: 1, bgcolor: colors.bg.secondary }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                      <BadgeIcon sx={{ fontSize: 20, color: colors.accent.blue }} />
                      <Typography variant="body2" sx={{ fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '1px', fontSize: '0.75rem' }}>WHAT IS A CALLSIGN?</Typography>
                    </Box>
                    <Typography variant="body2" sx={{ color: colors.text.secondary, fontSize: '0.8rem', lineHeight: 1.6 }}>Your unique identity within Agent-X. Used in conversations, logs, and notifications.</Typography>
                    <Typography variant="caption" sx={{ display: 'block', mt: 1.5, color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem' }}>Examples: Commander, Captain, Architect, Operator</Typography>
                  </Box>
                </Box>
              )}

              {step === 5 && (
                <Box>
                  <Typography variant="h6" sx={{ mb: 0.5, textAlign: 'center' }}>Agent Persona</Typography>
                  <Typography variant="body2" sx={{ color: colors.text.tertiary, mb: 2, textAlign: 'center' }}>Define how Agent-X presents itself — identity, communication style, and traits.</Typography>
                  <PersonaConfigPanel value={persona} onChange={p => { if (p) setPersona(p); }} />
                </Box>
              )}

              {step === 6 && (
                <Box sx={{ textAlign: 'center' }}>
                  <CheckCircle size={64} color={colors.accent.green} sx={{ mb: 2 }} />
                  <Typography variant="h5" sx={{ mb: 1 }}>Setup Complete!</Typography>
                  <Typography variant="body2" sx={{ color: colors.text.tertiary, mb: 3 }}>Your Agent-X instance is ready.</Typography>
                  <Box sx={{ textAlign: 'left', p: 2, border: `1px solid ${colors.border.default}`, borderRadius: 1, mb: 3, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem' }}>
                    <Typography variant="caption" sx={{ display: 'block', color: colors.text.dim }}>Storage: {selectedBackend === 'sqlite' ? 'Onboard Vault (SQLite)' : 'Starfleet Relay (PostgreSQL)'}</Typography>
                    <Typography variant="caption" sx={{ display: 'block', color: colors.text.dim }}>Provider: {selectedProvider}</Typography>
                    <Typography variant="caption" sx={{ display: 'block', color: colors.text.dim }}>Model: {selectedModel}</Typography>
                    <Typography variant="caption" sx={{ display: 'block', color: colors.text.dim }}>Callsign: {callsign || '(not set)'}</Typography>
                    <Typography variant="caption" sx={{ display: 'block', color: colors.text.dim }}>Persona: {persona.name || '(none)'}</Typography>
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </Box>
        </Box>
      </Box>

      {/* Bottom Nav */}
      <Box sx={{ flexShrink: 0, borderTop: `1px solid ${colors.border.default}`, px: 2, py: 2, display: 'flex', justifyContent: 'center' }}>
        <Box sx={{ width: '100%', maxWidth: 820, display: 'flex', justifyContent: step === 0 && !showRelayConfig ? 'flex-end' : step === 6 ? 'center' : 'space-between' }}>
          {step === 1 && <Button onClick={back} sx={{ color: colors.text.secondary }}>Back</Button>}
          {step === 2 && <Button onClick={back} sx={{ color: colors.text.secondary }}>Back</Button>}
          {step === 3 && <Button onClick={handleBackToCredentials} sx={{ color: colors.text.secondary }}>Back</Button>}
          {step === 4 && <Button onClick={back} sx={{ color: colors.text.secondary }}>Back</Button>}
          {step === 5 && <Button onClick={back} sx={{ color: colors.text.secondary }}>Back</Button>}
          {step === 0 && !showRelayConfig && (
            <Button variant="contained" onClick={handleStorageNext} sx={{ bgcolor: colors.text.primary, color: colors.bg.primary, px: 4 }}>
              {selectedBackend === 'postgres' ? 'Configure Relay →' : 'Next →'}
            </Button>
          )}
          {step === 0 && showRelayConfig && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
              <Button onClick={() => { setShowRelayConfig(false); setSelectedBackend('sqlite'); }} sx={{ color: colors.text.secondary }}>← Choose SQLite Instead</Button>
              <Button variant="contained" onClick={handleRelayNext} disabled={pgTesting} sx={{ bgcolor: colors.text.primary, color: colors.bg.primary, px: 4 }}>{pgTesting ? 'Testing...' : 'Connect & Next →'}</Button>
            </Box>
          )}
          {step === 1 && <Button variant="contained" onClick={handleProviderNext} sx={{ bgcolor: colors.text.primary, color: colors.bg.primary }}>Next</Button>}
          {step === 2 && <Button variant="contained" onClick={handleProfileNext} disabled={loading} sx={{ bgcolor: colors.text.primary, color: colors.bg.primary }}>{loading ? 'Validating...' : 'Validate & Next'}</Button>}
          {step === 3 && <Button variant="contained" onClick={handleModelNext} disabled={!selectedModel} sx={{ bgcolor: colors.text.primary, color: colors.bg.primary }}>Next</Button>}
          {step === 4 && <Button variant="contained" onClick={handleCallsignNext} sx={{ bgcolor: colors.text.primary, color: colors.bg.primary }}>{callsign.trim() ? 'Next' : 'Skip & Next'}</Button>}
          {step === 5 && <Button variant="contained" onClick={() => {
            if (!persona.description.trim()) { showError('Persona description is required'); return; }
            next();
          }} sx={{ bgcolor: colors.text.primary, color: colors.bg.primary }}>Next</Button>}
          {step === 6 && <Button variant="contained" onClick={handleComplete} disabled={loading} sx={{ px: 5, py: 1.2, bgcolor: colors.text.primary, color: colors.bg.primary, fontWeight: 700 }}>{loading ? 'Finalizing...' : 'Launch Console'}</Button>}
        </Box>
      </Box>

      <Dialog open={showBackWarning} onClose={() => setShowBackWarning(false)}
        PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 1, maxWidth: 400 } }}>
        <DialogTitle sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', fontWeight: 700, pb: 1 }}>RE-ENTER CREDENTIALS?</DialogTitle>
        <DialogContent><Typography variant="body2" sx={{ color: colors.text.secondary, fontSize: '0.8rem', lineHeight: 1.6 }}>Going back will clear your API key for security. You will need to re-enter and validate them.</Typography></DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setShowBackWarning(false)} sx={{ color: colors.text.dim }}>Cancel</Button>
          <Button onClick={confirmBackToCredentials} variant="contained" sx={{ bgcolor: colors.accent.red, color: '#fff' }}>Clear & Go Back</Button>
        </DialogActions>
      </Dialog>

      {loading && (
        <Box sx={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}>
          <CircularProgress size={40} sx={{ color: '#fff' }} />
        </Box>
      )}
    </Box>
  );
}

function Punch({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1.25,
      px: 1.5, py: 1,
      borderRadius: 1,
      bgcolor: 'rgba(255,255,255,0.015)',
      border: '1px solid rgba(255,255,255,0.03)',
      transition: 'all 0.15s',
    }}>
      <Box sx={{ color: colors.text.dim, flexShrink: 0, display: 'flex', opacity: 0.6 }}>{icon}</Box>
      <Typography sx={{ fontSize: '0.64rem', color: colors.text.secondary, lineHeight: 1.45, fontWeight: 500 }}>{text}</Typography>
    </Box>
  );
}
