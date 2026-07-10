/**
 * First-run Agent-X setup wizard (`/setup/wizard`) — storage, provider, model, neural core, callsign.
 *
 * NOT the MCP integration connect flow: that is `components/integrations/setup-wizards/ProviderSetupWizard`.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Stepper from '@mui/material/Stepper';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import { CheckCircle } from '../components/CheckCircle';
import BadgeIcon from '@mui/icons-material/Badge';
import StorageIcon from '@mui/icons-material/Storage';
import CloudIcon from '@mui/icons-material/Cloud';
import SyncAltIcon from '@mui/icons-material/SyncAlt';
import ShieldIcon from '@mui/icons-material/Shield';
import HubIcon from '@mui/icons-material/Hub';
import PublicIcon from '@mui/icons-material/Public';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import BoltIcon from '@mui/icons-material/Bolt';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HomeIcon from '@mui/icons-material/Home';
import { providers as provApi, models as modelsApi, config, settings, type DbConnectionTestResult, type DbExtensionCheck } from '../api';
import { useApp } from '../store/AppContext';
import { useGlobalError } from '../components/ErrorBand';
import { LocalModelStep } from '../components/LocalModelStep';
import { EmbeddingModelDownload } from '../components/EmbeddingModelDownload';
import type { ActiveDownload } from '../components/DownloadIndicator';
import type { ProviderInfo, ModelInfo, AgentXConfig, BenchmarkRunResult } from '../api';
import { useLocalModelSupported, useNeuralBrainSupported } from '../hooks/useSystemCapabilities';
import { ModelBenchmarkRunner, gradeAllowsAgentX } from '../components/settings/ModelBenchmarkRunner';
import { WizardVoiceStep } from '../components/setup/WizardVoiceStep';
import { WizardTelegramStep } from '../components/setup/WizardTelegramStep';
import { WizardCheckMark, WizardHintTag, WizardStepHeader } from '../components/setup/wizard-ui';
import {
  wizardBackBtnSx,
  wizardPanelSx,
  wizardPrimaryBtnSx,
  wizardSelectCardSx,
  wizardSkipBtnSx,
  wizardStepperSx,
  wizardTextFieldSlotProps,
  wizardTheme,
  wizardTileSx,
  WIZARD_MONO,
} from '../components/setup/wizard-theme';
import { colors, alphaColor } from '../theme';
import {
  clearWizardProgress,
  loadWizardProgress,
  saveWizardProgress,
} from '../utils/wizard-progress';

const ALL_STEPS = ['Storage', 'Provider', 'Profile', 'Local Model', 'Model', 'Benchmark', 'Neural Core', 'Callsign', 'Voice Comms', 'Telegram Relay', 'Complete'];

export function SetupWizard() {
  const { setConfig, setAuthState, setView } = useApp();
  const navigate = useNavigate();
  const localModelSupported = useLocalModelSupported();
  const neuralBrainSupported = useNeuralBrainSupported();
  const steps = useMemo(() => ALL_STEPS.filter((s) => {
    if (s === 'Local Model' && !localModelSupported) return false;
    if (s === 'Neural Core' && !neuralBrainSupported) return false;
    return true;
  }), [localModelSupported, neuralBrainSupported]);
  const [step, setStep] = useState(0);

  const isStepSupported = useCallback((stepIndex: number) => {
    const label = ALL_STEPS[stepIndex];
    if (label === 'Local Model' && !localModelSupported) return false;
    if (label === 'Neural Core' && !neuralBrainSupported) return false;
    return stepIndex >= 0 && stepIndex < ALL_STEPS.length;
  }, [localModelSupported, neuralBrainSupported]);

  const moveStep = useCallback((from: number, delta: 1 | -1) => {
    let next = from + delta;
    while (next >= 0 && next < ALL_STEPS.length && !isStepSupported(next)) {
      next += delta;
    }
    return next;
  }, [isStepSupported]);

  // Skip unsupported steps if capability detection changes mid-wizard.
  useEffect(() => {
    if (!isStepSupported(step)) {
      setStep((s) => moveStep(s, 1));
    }
  }, [step, isStepSupported, moveStep]);

  useEffect(() => {
    void config.getSetupStatus().then((status) => {
      if (status.setupComplete) {
        clearWizardProgress();
        setAuthState('authenticated');
        void navigate('/', { replace: true });
      }
    }).catch(() => {});
  }, [navigate, setAuthState]);
  const { showError, clearError } = useGlobalError();
  const [loading, setLoading] = useState(false);
  const [showBackWarning, setShowBackWarning] = useState(false);

  const [availableProviders, setAvailableProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState('');
  const [callsign, setCallsign] = useState('');
  const [profileName, setProfileName] = useState('');
  const [showCustomConfig, setShowCustomConfig] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<BenchmarkRunResult | null>(null);
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [limitedOverride, setLimitedOverride] = useState(false);

  // DB
  const [selectedBackend, setSelectedBackend] = useState<'embedded-postgres' | 'postgres'>('embedded-postgres');
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
  const [pgTestResult, setPgTestResult] = useState<DbConnectionTestResult | null>(null);
  const [pgTestDetailsOpen, setPgTestDetailsOpen] = useState(false);
  const [storageProvisioned, setStorageProvisioned] = useState(false);
  const [provisionedBackend, setProvisionedBackend] = useState<'embedded-postgres' | 'postgres' | null>(null);
  const [showStorageBackWarning, setShowStorageBackWarning] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionModalOpen, setProvisionModalOpen] = useState(false);
  const [provisionModalMode, setProvisionModalMode] = useState<'embedded-postgres' | 'postgres' | null>(null);
  const [embeddedProvisionLogs, setEmbeddedProvisionLogs] = useState<string[]>([]);
  const [cloudProvisionLogs, setCloudProvisionLogs] = useState<string[]>([]);
  const embeddedLogRef = useRef<HTMLDivElement | null>(null);
  const cloudLogRef = useRef<HTMLDivElement | null>(null);
  const provisionAbortRef = useRef<AbortController | null>(null);
  const [provisionFailed, setProvisionFailed] = useState(false);
  const [sshEnabled, setSshEnabled] = useState(false);
  const [sshHost, setSshHost] = useState('');
  const [sshPort, setSshPort] = useState('22');
  const [sshUser, setSshUser] = useState('');
  const [sshAuthMode, setSshAuthMode] = useState<'password' | 'key'>('password');
  const [sshPassword, setSshPassword] = useState('');
  const [sshKey, setSshKey] = useState('');
  const [selectedLocalModel, setSelectedLocalModel] = useState<string | null>(null);
  const [skipLocalModel, setSkipLocalModel] = useState(false);
  const [installedLocalModels, setInstalledLocalModels] = useState<Array<{ modelId: string; isActive: boolean }>>([]);
  const [activeDownloads, setActiveDownloads] = useState<ActiveDownload[]>([]);
  const [voiceCalibrated, setVoiceCalibrated] = useState(false);
  const [telegramLinked, setTelegramLinked] = useState(false);

  const resetPgTest = () => {
    setPgTestResult(null);
    setPgTestDetailsOpen(false);
  };

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
    const saved = loadWizardProgress();
    if (saved && saved.step >= 1) {
      setStep(saved.step);
      setSelectedProvider(saved.selectedProvider);
      setSelectedModel(saved.selectedModel);
      setCallsign(saved.callsign || '');
      setSelectedBackend('embedded-postgres');
      if (saved.step >= 1) {
        setStorageProvisioned(true);
        setProvisionedBackend(saved.selectedBackend === 'postgres' ? 'postgres' : 'embedded-postgres');
      }
      if (saved.selectedLocalModel) setSelectedLocalModel(saved.selectedLocalModel);
      if (saved.skipLocalModel) setSkipLocalModel(saved.skipLocalModel);
      if (saved.voiceCalibrated) setVoiceCalibrated(saved.voiceCalibrated);
      if (saved.telegramLinked) setTelegramLinked(saved.telegramLinked);
      if (saved.selectedProvider) {
        setModelsLoading(true);
        provApi.models(saved.selectedProvider).then(m => {
          setAvailableModels(m);
          if (saved.selectedModel) {
            const model = m.find((entry) => entry.id === saved.selectedModel);
            const levels = model?.reasoning?.effortLevels ?? [];
            setSelectedReasoningEffort(model?.reasoning?.defaultEffort ?? levels[0] ?? '');
          }
          setModelsLoading(false);
        }).catch(() => setModelsLoading(false));
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
    if (step >= 1) {
      saveWizardProgress({
        step,
        selectedProvider,
        selectedModel,
        callsign,
        selectedBackend,
        selectedLocalModel,
        skipLocalModel,
        voiceCalibrated,
        telegramLinked,
      });
    }
  }, [step, selectedProvider, selectedModel, callsign, selectedBackend, selectedLocalModel, skipLocalModel, voiceCalibrated, telegramLinked]);
  useEffect(() => { persistProgress(); }, [persistProgress]);

  const next = () => {
    clearError();
    setStep((s) => moveStep(s, 1));
  };
  const back = () => {
    clearError();
    setStep((s) => moveStep(s, -1));
  };

  useEffect(() => {
    const el = provisionModalMode === 'embedded-postgres' ? embeddedLogRef.current : cloudLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [embeddedProvisionLogs, cloudProvisionLogs, provisionModalMode]);

  const runProvision = async (
    backend: 'embedded-postgres' | 'postgres',
    connectionString?: string,
  ): Promise<boolean> => {
    setProvisionModalMode(backend);
    setProvisionModalOpen(true);
    setProvisioning(true);
    setProvisionFailed(false);
    if (backend === 'embedded-postgres') {
      setEmbeddedProvisionLogs([]);
    } else {
      setCloudProvisionLogs([]);
    }
    const appendLog = (line: string) => {
      if (backend === 'embedded-postgres') {
        setEmbeddedProvisionLogs((prev) => [...prev, line]);
      } else {
        setCloudProvisionLogs((prev) => [...prev, line]);
      }
    };
    const ac = new AbortController();
    provisionAbortRef.current = ac;
    try {
      const r = await settings.db.provision(
        {
          backend,
          ...(connectionString ? { postgres: { connectionString } } : {}),
        },
        (ev) => {
          if (ev.type === 'log' && ev.line) appendLog(ev.line);
          if (ev.type === 'error' && ev.error) appendLog(`[ERROR] ${ev.error}`);
        },
        { signal: ac.signal },
      );
      if (!r.ok) {
        if (r.error === 'Cancelled') {
          appendLog('Cancelled — you can change settings and try again.');
          return false;
        }
        appendLog(`[ERROR] ${r.error || 'Storage provisioning failed'}`);
        setProvisionFailed(true);
        showError(r.error || 'Storage provisioning failed');
        return false;
      }
      setStorageProvisioned(true);
      setProvisionedBackend(backend);
      setProvisionModalOpen(false);
      setProvisionModalMode(null);
      return true;
    } catch (e) {
      if (ac.signal.aborted) {
        appendLog('Cancelled — you can change settings and try again.');
        return false;
      }
      const msg = e instanceof Error ? e.message : 'Storage provisioning failed';
      appendLog(`[ERROR] ${msg}`);
      setProvisionFailed(true);
      showError(msg);
      return false;
    } finally {
      setProvisioning(false);
      provisionAbortRef.current = null;
    }
  };

  const discardProvision = () => {
    if (provisioning) {
      provisionAbortRef.current?.abort();
    }
    setProvisioning(false);
    setProvisionFailed(false);
    setProvisionModalOpen(false);
    setProvisionModalMode(null);
  };

  const handleStorageNext = async () => {
    if (selectedBackend === 'embedded-postgres') {
      try {
        const ok = await runProvision('embedded-postgres');
        if (!ok) {
          // Cancelled or failed — stay on storage step (do not advance).
          return;
        }
        next();
      } catch { /* runProvision surfaces errors */ }
    } else {
      setShowRelayConfig(true);
    }
  };

  const handleRelayTest = async () => {
    const connStr = buildPgConnStr();
    if (!connStr) { showError('Enter connection details'); return; }
    setPgTesting(true);
    resetPgTest();
    clearError();
    try {
      const r = await settings.db.testAdvanced(connStr, buildSshConfig());
      setPgTestResult(r);
      setPgTestDetailsOpen(false);
      if (!r.ok) showError(r.error || 'Connection test failed');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Connection test failed';
      setPgTestResult({ ok: false, error: msg });
      setPgTestDetailsOpen(false);
      showError(msg);
    } finally {
      setPgTesting(false);
    }
  };

  const handleRelaySave = async () => {
    const connStr = buildPgConnStr();
    if (!connStr) { showError('Enter connection details'); return; }
    if (!pgTestResult?.ok) {
      showError('Test the connection before continuing');
      return;
    }
    try {
      const ok = await runProvision('postgres', connStr);
      if (!ok) {
        // Cancelled or failed — stay on storage/relay step (do not advance to provider).
        return;
      }
      next();
    } catch { /* runProvision surfaces errors */ }
  };

  const handleBackFromProvider = () => {
    if (storageProvisioned) {
      setShowStorageBackWarning(true);
      return;
    }
    back();
  };

  const confirmBackToStorage = () => {
    setShowStorageBackWarning(false);
    back();
  };

  const handleBackToCredentials = () => { setShowBackWarning(true); };
  const confirmBackToCredentials = () => {
    setShowBackWarning(false); setApiKey(''); setBaseUrl(''); setAvailableModels([]); setSelectedModel(''); clearWizardProgress(); setStep(2);
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
    setBenchmarkResult(null);
    setLimitedOverride(false);
    try {
      await modelsApi.switch(selectedModel, {
        reasoningEffort: selectedReasoningEffort || undefined,
      });
    } catch {}
    next();
  };

  const handleWizardModelSelect = (model: ModelInfo) => {
    setSelectedModel(model.id);
    setBenchmarkResult(null);
    setLimitedOverride(false);
    const levels = model.reasoning?.effortLevels ?? [];
    setSelectedReasoningEffort(model.reasoning?.defaultEffort ?? levels[0] ?? '');
  };

  const handleBenchmarkBack = () => {
    setBenchmarkResult(null);
    setLimitedOverride(false);
    back();
  };

  const selectedModelInfo = availableModels.find((m) => m.id === selectedModel);
  const canProceedBenchmark = Boolean(
    benchmarkResult &&
    !benchmarkRunning &&
    (gradeAllowsAgentX(benchmarkResult.grade) ||
      (benchmarkResult.grade === 'LIMITED' && limitedOverride)),
  );
  const handleCallsignNext = () => { next(); };

  const startDownload = (download: ActiveDownload) => {
    setActiveDownloads(prev => {
      const existing = prev.find(d => d.modelId === download.modelId);
      if (existing) return prev;
      return [...prev, download];
    });
  };

  const updateDownload = (modelId: string, updates: Partial<ActiveDownload>) => {
    setActiveDownloads(prev => prev.map(d => d.modelId === modelId ? { ...d, ...updates } : d));
  };

  const clearDownload = (modelId: string) => {
    setActiveDownloads(prev => prev.filter(d => d.modelId !== modelId));
  };

  const handleInstalledModelsChange = (models: Array<{ modelId: string; isActive: boolean }>) => {
    setInstalledLocalModels(models);
  };

  const handleComplete = async () => {
    setLoading(true);
    try {
      // Cloud connection is already persisted on the storage step via provision.
      // Keep a best-effort re-save for interrupted wizard resumes.
      const connStr = selectedBackend === 'postgres' ? buildPgConnStr() : '';
      if (connStr) {
        try { await settings.db.update({ backend: 'postgres', postgres: { connectionString: connStr } }); } catch {}
      }
      try { await settings.db.systemInit(); } catch {}
      const setupPatch: Partial<AgentXConfig> = { setupComplete: true, user: { callsign } };
      if (!localModelSupported) {
        setupPatch.localModel = { enabled: false };
      }
      if (!neuralBrainSupported) {
        setupPatch.neuralBrain = false;
      }
      await config.completeSetup(callsign.trim());
      await config.update(setupPatch);
        clearWizardProgress();
      setAuthState('authenticated');
      setView('docking');
      void navigate('/', { replace: true });
      void config.get().then((cfg) => setConfig(cfg)).catch(() => {});
    } catch (err) { showError(err instanceof Error ? err.message : 'Setup could not be saved.'); }
    finally { setLoading(false); }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: wizardTheme.bg }}>
      <Box sx={{ flexShrink: 0, textAlign: 'center', pt: 4, px: 2, pb: 2 }}>
        <Typography variant="h2" sx={{ mb: 0.5, fontFamily: WIZARD_MONO, letterSpacing: '0.12em', fontSize: '1.1rem' }}>SETUP WIZARD</Typography>
        <Typography variant="body2" sx={{ color: wizardTheme.textDim, mb: 3, fontFamily: WIZARD_MONO, fontSize: '0.62rem' }}>Configure your Agent-X instance</Typography>
        <Stepper activeStep={steps.indexOf(ALL_STEPS[step] ?? '')} alternativeLabel sx={wizardStepperSx}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
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
              <WizardStepHeader
                codename="MODULE · STORAGE"
                title="Power Your Agent"
                subtitle="Every memory, message, and crew identity lives here. Credentials stay encrypted on this machine — always."
              />

              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                <Box onClick={() => { setSelectedBackend('embedded-postgres'); resetPgTest(); }}
                  sx={{ ...wizardSelectCardSx(selectedBackend === 'embedded-postgres'), gap: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                    <Box sx={{ width: 36, height: 36, borderRadius: 1, bgcolor: alphaColor(colors.ink, 0.04), display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${wizardTheme.panelBorder}`, flexShrink: 0 }}>
                      <StorageIcon sx={{ fontSize: 18, color: wizardTheme.textSecondary }} />
                    </Box>
                    <Box>
                      <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: wizardTheme.text }}>Onboard Core</Typography>
                      <WizardHintTag tone="ok">Embedded PostgreSQL</WizardHintTag>
                    </Box>
                    {selectedBackend === 'embedded-postgres' && <Box sx={{ ml: 'auto' }}><WizardCheckMark /></Box>}
                  </Box>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mb: 2 }}>
                    <Punch text="Everything runs on your Mac — no cloud account or database setup needed." icon={<HomeIcon sx={{ fontSize: 13 }} />} />
                    <Punch text="Your messages, memories, and crew data stay on this machine." icon={<ShieldIcon sx={{ fontSize: 13 }} />} />
                    <Punch text="Works offline. Agent-X is ready even without internet." icon={<BoltIcon sx={{ fontSize: 13 }} />} />
                    <Punch text="Automatic brain setup. The database is created and maintained for you." icon={<AutoAwesomeIcon sx={{ fontSize: 13 }} />} />
                    <Punch text="Simple to back up or move to another Mac." icon={<SyncAltIcon sx={{ fontSize: 13 }} />} />
                    <Punch text="Best for personal use, solo work, and getting started fast." icon={<BoltIcon sx={{ fontSize: 13 }} />} />
                    <Punch text="Your encryption key keeps your data unreadable by the database." icon={<ShieldIcon sx={{ fontSize: 13 }} />} />
                  </Box>
                  <Box sx={{ p: 1.2, borderRadius: 1, bgcolor: alphaColor(colors.ink, 0.02), border: `1px solid ${wizardTheme.panelBorder}`, mt: 'auto' }}>
                    <Typography sx={{ fontSize: '0.55rem', fontFamily: WIZARD_MONO, color: wizardTheme.accentOk, textAlign: 'center', fontWeight: 600 }}>
                      Recommended. No external database needed.
                    </Typography>
                  </Box>
                </Box>

                <Box onClick={() => { setSelectedBackend('postgres'); resetPgTest(); }}
                  sx={{ ...wizardSelectCardSx(selectedBackend === 'postgres'), gap: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                    <Box sx={{ width: 36, height: 36, borderRadius: 1, bgcolor: alphaColor(colors.ink, 0.04), display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${wizardTheme.panelBorder}`, flexShrink: 0 }}>
                      <CloudIcon sx={{ fontSize: 18, color: wizardTheme.textSecondary }} />
                    </Box>
                    <Box>
                      <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: wizardTheme.text }}>Starfleet Relay</Typography>
                      <WizardHintTag>Your PostgreSQL</WizardHintTag>
                    </Box>
                    {selectedBackend === 'postgres' && <Box sx={{ ml: 'auto' }}><WizardCheckMark /></Box>}
                  </Box>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mb: 2 }}>
                    <Punch text="Connect your own PostgreSQL database — cloud or self-hosted." icon={<CloudIcon sx={{ fontSize: 13 }} />} />
                    <Punch text="Access the same brain from multiple Macs or devices." icon={<SyncAltIcon sx={{ fontSize: 13 }} />} />
                    <Punch text="Share a team brain with shared crews and sessions." icon={<HubIcon sx={{ fontSize: 13 }} />} />
                    <Punch text="Your data lives in infrastructure you already control." icon={<ShieldIcon sx={{ fontSize: 13 }} />} />
                    <Punch text="Use your existing backups and disaster recovery." icon={<PublicIcon sx={{ fontSize: 13 }} />} />
                    <Punch text="Schema and tables are created automatically on first connect." icon={<AutoAwesomeIcon sx={{ fontSize: 13 }} />} />
                    <Punch text="Your encryption key keeps your data unreadable by the database." icon={<ShieldIcon sx={{ fontSize: 13 }} />} />
                  </Box>
                  <Box sx={{ p: 1.2, borderRadius: 1, bgcolor: alphaColor(colors.ink, 0.02), border: `1px solid ${wizardTheme.panelBorder}`, mt: 'auto' }}>
                    <Typography sx={{ fontSize: '0.55rem', fontFamily: WIZARD_MONO, color: wizardTheme.textDim, textAlign: 'center', fontWeight: 600 }}>
                      For multi-machine setups, teams, and cloud DBs.
                    </Typography>
                  </Box>
                </Box>
              </Box>
            </Box>
          )}

          {/* ─── Step 0b: Relay Config ─── */}
          {step === 0 && showRelayConfig && (
            <Box sx={{ maxWidth: 600, mx: 'auto' }}>
              <WizardStepHeader
                codename="MODULE · RELAY CONFIG"
                title="Configure Your Relay"
                subtitle="Connect your PostgreSQL instance. Agent-X auto-provisions the schema on first contact."
              />

              <Box sx={{ ...wizardPanelSx, p: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: wizardTheme.text }}>Connection</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <Button size="small" onClick={() => { setPgMode('string'); resetPgTest(); }}
                      sx={{ fontSize: '0.58rem', fontFamily: WIZARD_MONO, textTransform: 'none', py: 0, px: 1, color: pgMode === 'string' ? wizardTheme.text : wizardTheme.textDim, minWidth: 0, borderBottom: pgMode === 'string' ? `1px solid ${wizardTheme.text}` : '1px solid transparent', borderRadius: 0 }}>
                      Connection String
                    </Button>
                    <Button size="small" onClick={() => { setPgMode('fields'); resetPgTest(); }}
                      sx={{ fontSize: '0.58rem', fontFamily: WIZARD_MONO, textTransform: 'none', py: 0, px: 1, color: pgMode === 'fields' ? wizardTheme.text : wizardTheme.textDim, minWidth: 0, borderBottom: pgMode === 'fields' ? `1px solid ${wizardTheme.text}` : '1px solid transparent', borderRadius: 0 }}>
                      Individual Fields
                    </Button>
                  </Box>
                </Box>

                {pgMode === 'string' ? (
                  <TextField size="small" fullWidth placeholder="postgresql://user:pass@host:5432/agentx?sslmode=no-verify"
                    value={pgConnStr} onChange={e => { setPgConnStr(e.target.value); resetPgTest(); }} sx={{ mb: 2 }}
                    slotProps={wizardTextFieldSlotProps} />
                ) : (
                  <>
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 1 }}>
                      <TextField size="small" label="Host" value={pgHost} onChange={e => { setPgHost(e.target.value); resetPgTest(); }} placeholder="db.example.com" slotProps={wizardTextFieldSlotProps} />
                      <TextField size="small" label="Port" value={pgPort} onChange={e => { setPgPort(e.target.value); resetPgTest(); }} placeholder="5432" slotProps={wizardTextFieldSlotProps} />
                      <TextField size="small" label="User" value={pgUser} onChange={e => { setPgUser(e.target.value); resetPgTest(); }} placeholder="agentx" slotProps={wizardTextFieldSlotProps} />
                      <TextField size="small" label="Password" type="password" value={pgPassword} onChange={e => { setPgPassword(e.target.value); resetPgTest(); }} placeholder="••••" slotProps={wizardTextFieldSlotProps} />
                      <TextField size="small" label="Database" value={pgDatabase} onChange={e => { setPgDatabase(e.target.value); resetPgTest(); }} sx={{ gridColumn: '1 / -1' }} placeholder="agentx" slotProps={wizardTextFieldSlotProps} />
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                      <Box onClick={() => { setPgSsl(!pgSsl); resetPgTest(); }} sx={{ width: 14, height: 14, borderRadius: '3px', border: `1.5px solid ${pgSsl ? wizardTheme.text : wizardTheme.panelBorderStrong}`, bgcolor: pgSsl ? wizardTheme.text : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {pgSsl && <Typography sx={{ fontSize: '0.5rem', color: wizardTheme.bg, fontWeight: 900 }}>✓</Typography>}
                      </Box>
                      <Typography sx={{ fontSize: '0.62rem', color: wizardTheme.textSecondary, fontFamily: WIZARD_MONO }}>SSL ({pgSsl ? 'no-verify' : 'off'})</Typography>
                    </Box>
                  </>
                )}

                {/* SSH Tunnel */}
                <Box sx={{ pt: 1.5, borderTop: `1px solid ${wizardTheme.panelBorder}` }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: sshEnabled ? 1.5 : 0, cursor: 'pointer' }} onClick={() => { setSshEnabled(!sshEnabled); resetPgTest(); }}>
                    <Box onClick={e => { e.stopPropagation(); setSshEnabled(!sshEnabled); resetPgTest(); }} sx={{ width: 14, height: 14, borderRadius: '3px', border: `1.5px solid ${sshEnabled ? wizardTheme.text : wizardTheme.panelBorderStrong}`, bgcolor: sshEnabled ? wizardTheme.text : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {sshEnabled && <Typography sx={{ fontSize: '0.5rem', color: wizardTheme.bg, fontWeight: 900 }}>✓</Typography>}
                    </Box>
                    <Typography sx={{ fontSize: '0.62rem', color: wizardTheme.textSecondary, fontFamily: WIZARD_MONO }}>SSH Tunnel {sshEnabled ? '· bastion / jump host' : '(optional)'}</Typography>
                  </Box>
                  {sshEnabled && (
                    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 1 }}>
                      <TextField size="small" label="SSH Host" value={sshHost} onChange={e => setSshHost(e.target.value)} placeholder="bastion.example.com" slotProps={wizardTextFieldSlotProps} />
                      <TextField size="small" label="SSH Port" value={sshPort} onChange={e => setSshPort(e.target.value)} placeholder="22" slotProps={wizardTextFieldSlotProps} />
                      <TextField size="small" label="SSH User" value={sshUser} onChange={e => setSshUser(e.target.value)} sx={{ gridColumn: '1 / -1' }} placeholder="ubuntu" slotProps={wizardTextFieldSlotProps} />
                      <Box sx={{ gridColumn: '1 / -1', display: 'flex', gap: 0.5 }}>
                        <Button size="small" onClick={() => setSshAuthMode('password')} sx={{ fontSize: '0.55rem', fontFamily: WIZARD_MONO, textTransform: 'none', py: 0, px: 1, color: sshAuthMode === 'password' ? wizardTheme.text : wizardTheme.textDim, minWidth: 0, borderBottom: sshAuthMode === 'password' ? `1px solid ${wizardTheme.text}` : '1px solid transparent', borderRadius: 0 }}>Password</Button>
                        <Button size="small" onClick={() => setSshAuthMode('key')} sx={{ fontSize: '0.55rem', fontFamily: WIZARD_MONO, textTransform: 'none', py: 0, px: 1, color: sshAuthMode === 'key' ? wizardTheme.text : wizardTheme.textDim, minWidth: 0, borderBottom: sshAuthMode === 'key' ? `1px solid ${wizardTheme.text}` : '1px solid transparent', borderRadius: 0 }}>Private Key</Button>
                      </Box>
                      {sshAuthMode === 'password'
                        ? <TextField size="small" label="SSH Password" type="password" value={sshPassword} onChange={e => setSshPassword(e.target.value)} sx={{ gridColumn: '1 / -1' }} placeholder="••••" slotProps={wizardTextFieldSlotProps} />
                        : (
                          <Box sx={{ gridColumn: '1 / -1' }}>
                            <TextField size="small" label="Private Key" multiline rows={3} value={sshKey} onChange={e => setSshKey(e.target.value)}
                              fullWidth placeholder="Paste your key or upload a file..."
                              slotProps={wizardTextFieldSlotProps} />
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75 }}>
                              <Button component="label" size="small"
                                sx={{ fontSize: '0.58rem', fontFamily: WIZARD_MONO, textTransform: 'none', color: wizardTheme.textSecondary, border: `1px solid ${wizardTheme.panelBorder}`, borderRadius: 0.5, px: 1.5, py: 0.25, '&:hover': { borderColor: wizardTheme.panelBorderStrong } }}>
                                Upload Key File
                                <input type="file" hidden onChange={e => {
                                  const file = e.target.files?.[0];
                                  if (file) { const r = new FileReader(); r.onload = () => setSshKey(r.result as string); r.readAsText(file); }
                                }} />
                              </Button>
                              <Typography sx={{ fontSize: '0.52rem', color: wizardTheme.textDim }}>~/.ssh/id_rsa, .pem, or any OpenSSH key</Typography>
                            </Box>
                          </Box>
                        )
                      }
                    </Box>
                  )}
                </Box>

                {pgTestResult && (() => {
                  const extensionChecks: DbExtensionCheck[] = pgTestResult.checks?.length
                    ? pgTestResult.checks
                    : pgTestResult.ok
                      ? [{
                          id: 'age',
                          label: 'Apache AGE',
                          status: (pgTestResult.ageAvailable ? 'ok' : 'warn') as DbExtensionCheck['status'],
                          message: pgTestResult.ageAvailable
                            ? 'Apache AGE graph extension is available.'
                            : (pgTestResult.ageError ?? 'Apache AGE is not available on this server.'),
                        }]
                      : [];
                  const neuralCoreCheck = pgTestResult.ok && !neuralBrainSupported
                    ? { status: 'warn' as const, label: 'Neural Core (this Mac)', message: 'Requires 16 GB+ RAM. Agent-X will disable the neural brain on this machine; chat and crews still work.' }
                    : null;
                  const detailRows = [
                    ...extensionChecks.map((check) => ({
                      key: check.id,
                      status: check.status,
                      label: `${check.label}${check.status === 'warn' ? ' (optional)' : check.status === 'fail' ? ' (required)' : ''}`,
                      message: check.message,
                      remediation: check.remediation,
                    })),
                    ...(neuralCoreCheck
                      ? [{
                          key: 'neural-core',
                          status: neuralCoreCheck.status,
                          label: neuralCoreCheck.label,
                          message: neuralCoreCheck.message,
                          remediation: undefined as string | undefined,
                        }]
                      : []),
                  ];
                  const summary = detailRows
                    .map((row) => `${row.status === 'ok' ? '✓' : row.status === 'warn' ? '⚠' : '✕'} ${row.label}`)
                    .join(' · ');

                  return (
                    <Box sx={{ mt: 2, p: 1.5, borderRadius: 1, bgcolor: alphaColor(colors.ink, 0.02), border: `1px solid ${pgTestResult.ok ? wizardTheme.accentOk : wizardTheme.accentErr}` }}>
                      <Typography sx={{ fontSize: '0.62rem', fontFamily: WIZARD_MONO, color: pgTestResult.ok ? wizardTheme.accentOk : wizardTheme.accentErr, fontWeight: 600 }}>
                        {pgTestResult.ok ? 'CONNECTION OK' : 'CONNECTION FAILED'}
                      </Typography>
                      <Typography sx={{ fontSize: '0.55rem', fontFamily: WIZARD_MONO, color: wizardTheme.textSecondary, mt: 0.25 }}>
                        {pgTestResult.ok
                          ? `${pgTestResult.version || 'PostgreSQL'} · ready to provision schema`
                          : pgTestResult.error}
                      </Typography>

                      {detailRows.length > 0 && (
                        <Box sx={{ mt: 1, pt: 1, borderTop: `1px solid ${wizardTheme.panelBorder}` }}>
                          <Box
                            onClick={() => setPgTestDetailsOpen((open) => !open)}
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 0.75,
                              cursor: 'pointer',
                              userSelect: 'none',
                              '&:hover': { opacity: 0.85 },
                            }}
                          >
                            <ExpandMoreIcon
                              sx={{
                                fontSize: 16,
                                color: wizardTheme.textDim,
                                transform: pgTestDetailsOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                                transition: 'transform 0.15s ease',
                                flexShrink: 0,
                              }}
                            />
                            <Typography sx={{
                              fontSize: '0.52rem',
                              fontFamily: WIZARD_MONO,
                              color: wizardTheme.textSecondary,
                              lineHeight: 1.4,
                              flex: 1,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: pgTestDetailsOpen ? 'normal' : 'nowrap',
                            }}>
                              {pgTestDetailsOpen ? 'Capability details' : summary}
                            </Typography>
                          </Box>

                          {pgTestDetailsOpen && detailRows.map((row) => (
                            <Box key={row.key} sx={{ mt: 1.1, pl: 0.25 }}>
                              <Typography sx={{
                                fontSize: '0.55rem',
                                fontFamily: WIZARD_MONO,
                                fontWeight: 700,
                                color: row.status === 'ok' ? wizardTheme.accentOk : row.status === 'warn' ? wizardTheme.accentWarn : wizardTheme.accentErr,
                              }}>
                                {row.status === 'ok' ? '✓' : row.status === 'warn' ? '⚠' : '✕'} {row.label}
                              </Typography>
                              <Typography sx={{ fontSize: '0.52rem', fontFamily: WIZARD_MONO, color: wizardTheme.textSecondary, mt: 0.35, lineHeight: 1.5 }}>
                                {row.message}
                              </Typography>
                              {row.remediation && (
                                <Typography sx={{ fontSize: '0.5rem', fontFamily: WIZARD_MONO, color: wizardTheme.textDim, mt: 0.5, lineHeight: 1.55 }}>
                                  {row.remediation}
                                </Typography>
                              )}
                            </Box>
                          ))}
                        </Box>
                      )}
                    </Box>
                  );
                })()}

                <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    variant="outlined"
                    onClick={handleRelayTest}
                    disabled={pgTesting || provisioning}
                    sx={{
                      ...wizardPrimaryBtnSx,
                      bgcolor: 'transparent',
                      border: `1px solid ${wizardTheme.panelBorderStrong}`,
                      color: wizardTheme.textSecondary,
                      px: 2.5,
                      '&:hover': { bgcolor: alphaColor(colors.ink, 0.04), borderColor: wizardTheme.textDim },
                    }}
                  >
                    {pgTesting ? 'Testing…' : 'Test Connection'}
                  </Button>
                </Box>
              </Box>
            </Box>
          )}

          {/* ─── Step 1-6: Provider, API Key, Model, Callsign, Persona, Complete ── */}
          {step >= 1 && (
            <Box>
              {step === 1 && (
                <Box>
                  <WizardStepHeader codename="MODULE · PROVIDER" title="Choose AI Provider" />
                  <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', color: wizardTheme.textDim, mb: 2, fontFamily: WIZARD_MONO, letterSpacing: '1px' }}>CLOUD</Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1.5, mb: 2 }}>
                    {availableProviders.filter(Boolean).filter(p => p.type === 'cloud').map(p => (
                      <Box key={p.id} onClick={() => setSelectedProvider(p.id)} sx={wizardTileSx(selectedProvider === p.id)}>
                        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem', color: wizardTheme.text }}>{p.name}</Typography>
                      </Box>
                    ))}
                  </Box>
                  <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', color: wizardTheme.textDim, mb: 1.5, fontFamily: WIZARD_MONO, letterSpacing: '1px' }}>LOCAL</Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1.5 }}>
                    {availableProviders.filter(Boolean).filter(p => p.type === 'local').map(p => (
                      <Box key={p.id} onClick={() => setSelectedProvider(p.id)} sx={wizardTileSx(selectedProvider === p.id)}>
                        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem', color: wizardTheme.text }}>{p.name}</Typography>
                      </Box>
                    ))}
                  </Box>
                  {availableProviders.length === 0 && <Typography variant="body2" sx={{ color: wizardTheme.textDim, textAlign: 'center', mt: 2 }}>Loading providers...</Typography>}
                </Box>
              )}

              {step === 2 && (
                <Box sx={{ maxWidth: 520, mx: 'auto' }}>
                  <WizardStepHeader
                    codename="MODULE · PROFILE"
                    title={isLocal ? 'Name Your Local Profile' : isAzure ? 'Azure Profile' : 'Configure Profile'}
                    subtitle={isLocal ? `Connecting to ${selectedProviderInfo?.name ?? 'local provider'}. No API key needed.` : isAzure ? 'Enter your Azure endpoint and API key' : `Set up your ${selectedProviderInfo?.name ?? ''} connection`}
                  />

                  <TextField label="Profile Name" value={profileName} onChange={e => setProfileName(e.target.value)} fullWidth
                    placeholder='e.g. "My OpenAI Key" or "Work Account"'
                    sx={{ mb: !isLocal ? 2 : 1.5 }}
                    slotProps={wizardTextFieldSlotProps} />

                  {!isLocal && (
                    <TextField label="API Key" value={apiKey} onChange={e => setApiKey(e.target.value)} fullWidth type="password"
                      sx={{ mb: 2 }}
                      slotProps={wizardTextFieldSlotProps} />
                  )}

                  {isLocal && (
                    <>
                      <Button size="small" onClick={() => setShowCustomConfig(!showCustomConfig)}
                        sx={{ fontSize: '0.65rem', fontFamily: WIZARD_MONO, textTransform: 'none', color: wizardTheme.textDim, px: 0, minWidth: 0, mb: 1.5,
                          '&:hover': { color: wizardTheme.textSecondary, bgcolor: 'transparent' } }}>
                        {showCustomConfig ? '− Hide Custom Configuration' : '+ Custom Configuration'}
                      </Button>

                      <Box sx={{
                        overflow: 'hidden',
                        maxHeight: showCustomConfig ? 200 : 0,
                        opacity: showCustomConfig ? 1 : 0,
                        transition: 'max-height 0.25s ease, opacity 0.2s ease, margin 0.25s ease',
                        mb: showCustomConfig ? 2 : 0,
                      }}>
                        <Box sx={{ ...wizardPanelSx, p: 2 }}>
                          <Typography sx={{ fontSize: '0.62rem', fontFamily: WIZARD_MONO, color: wizardTheme.textDim, mb: 1.5, letterSpacing: '0.5px' }}>
                            ADVANCED CONNECTION SETTINGS
                          </Typography>
                          <TextField label="Base URL" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} fullWidth
                            placeholder={selectedProviderInfo?.defaultBaseUrl ?? 'https://api.example.com/v1'}
                            sx={{ mb: 1.5 }}
                            slotProps={wizardTextFieldSlotProps} />
                          <TextField label="Port (optional)" value={pgPort} onChange={e => setPgPort(e.target.value)} fullWidth placeholder="11434"
                            slotProps={wizardTextFieldSlotProps} />
                        </Box>
                      </Box>
                    </>
                  )}
                </Box>
              )}

              {step === 3 && (
                <LocalModelStep
                  selectedModel={selectedLocalModel}
                  onSelectModel={setSelectedLocalModel}
                  skipLocalModel={skipLocalModel}
                  onSkipChange={setSkipLocalModel}
                  onStartDownload={startDownload}
                  onUpdateDownload={updateDownload}
                  onClearDownload={clearDownload}
                  onInstalledModelsChange={handleInstalledModelsChange}
                  activeDownloads={activeDownloads}
                />
              )}

              {step === 4 && (
                <Box>
                  <WizardStepHeader
                    codename="MODULE · MODEL"
                    title="Select Model"
                    subtitle={`${availableModels.length} model${availableModels.length !== 1 ? 's' : ''} available from ${selectedProviderInfo?.name ?? selectedProvider}`}
                  />
                  {modelsLoading ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, py: 4 }}><CircularProgress size={16} sx={{ color: wizardTheme.text }} /><Typography variant="body2" sx={{ color: wizardTheme.textDim }}>Loading models...</Typography></Box>
                  ) : (
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 1.5 }}>
                      {availableModels.filter(Boolean).map(m => (
                        <Box key={m.id} onClick={() => handleWizardModelSelect(m)} sx={wizardTileSx(selectedModel === m.id)}>
                          <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem', color: wizardTheme.text, mb: 0.5, wordBreak: 'break-word' }}>{m.name}</Typography>
                          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                            {m.contextWindow && <Typography variant="caption" sx={{ fontSize: '0.6rem', fontFamily: WIZARD_MONO, color: wizardTheme.textDim }}>{m.contextWindow >= 1000000 ? `${(m.contextWindow / 1000000).toFixed(1)}M` : `${Math.round(m.contextWindow / 1000)}K`} ctx</Typography>}
                            {m.capabilities?.filter(c => c !== 'text' && c !== 'streaming' && c !== 'reasoning').map(cap => <Typography key={cap} variant="caption" sx={{ fontSize: '0.55rem', fontFamily: WIZARD_MONO, color: wizardTheme.accentSignal, textTransform: 'uppercase' }}>{cap}</Typography>)}
                            {m.reasoning?.supported && m.reasoning.defaultEffort && (
                              <Typography variant="caption" sx={{ fontSize: '0.55rem', fontFamily: WIZARD_MONO, color: wizardTheme.textDim, textTransform: 'uppercase' }}>
                                think:{m.reasoning.defaultEffort}
                              </Typography>
                            )}
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  )}
                  {selectedModel && !modelsLoading && (
                    <Box sx={{
                      mt: 2, p: 1.5, borderRadius: 1,
                      border: `1px solid ${wizardTheme.panelBorderStrong}`,
                      bgcolor: alphaColor(colors.ink, 0.02),
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap',
                    }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="caption" sx={{ display: 'block', fontSize: '0.55rem', color: wizardTheme.textDim, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.25, fontFamily: WIZARD_MONO }}>
                            Selected model
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.8rem', color: wizardTheme.text }}>
                            {selectedModelInfo?.name || selectedModel}
                          </Typography>
                        </Box>
                        {(selectedModelInfo?.reasoning?.effortLevels?.length ?? 0) > 0 && (
                          <FormControl size="small" sx={{ minWidth: 140, maxWidth: 200, flexShrink: 0 }}>
                            <InputLabel sx={{ fontSize: '0.7rem', fontFamily: WIZARD_MONO }}>Reasoning effort</InputLabel>
                            <Select
                              value={selectedReasoningEffort}
                              label="Reasoning effort"
                              onChange={(e) => setSelectedReasoningEffort(e.target.value)}
                              sx={{ fontSize: '0.75rem', height: 36, fontFamily: WIZARD_MONO }}
                            >
                              {(selectedModelInfo?.reasoning?.effortLevels ?? []).map((level) => (
                                <MenuItem key={level} value={level} sx={{ fontSize: '0.75rem' }}>
                                  {level}{level === selectedModelInfo?.reasoning?.defaultEffort ? ' (default)' : ''}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        )}
                      </Box>
                    </Box>
                  )}
                </Box>
              )}

              {step === 5 && (
                <Box>
                  <WizardStepHeader
                    codename="MODULE · CLEARANCE"
                    title="Agentic Clearance Scan"
                    subtitle={`Mandatory clearance scan for ${selectedModelInfo?.name || selectedModel} — verifies this model can handle Agent-X workloads.`}
                  />
                  <ModelBenchmarkRunner
                    key={`${selectedProvider}-${selectedModel}`}
                    embedded
                    autoStart
                    providerId={selectedProvider}
                    modelId={selectedModel}
                    modelName={selectedModelInfo?.name}
                    profileId={profileName.trim()}
                    modelCapabilities={selectedModelInfo?.capabilities}
                    onComplete={setBenchmarkResult}
                    onRunningChange={setBenchmarkRunning}
                  />
                  {benchmarkResult?.grade === 'LIMITED' && !benchmarkRunning && (
                    <FormControlLabel
                      sx={{ mt: 1.5, ml: 0 }}
                      control={
                        <Checkbox
                          size="small"
                          checked={limitedOverride}
                          onChange={(e) => setLimitedOverride(e.target.checked)}
                          sx={{ color: wizardTheme.accentWarn, '&.Mui-checked': { color: wizardTheme.accentWarn } }}
                        />
                      }
                      label={
                        <Typography sx={{ fontSize: '0.72rem', color: wizardTheme.textSecondary }}>
                          Acknowledge LIMITED clearance — proceed with constraints
                        </Typography>
                      }
                    />
                  )}
                  {benchmarkResult?.grade === 'STANDBY' && !benchmarkRunning && (
                    <Alert severity="error" sx={{ mt: 1.5, fontSize: '0.75rem' }}>
                      Model not cleared for agentic workloads. Go back and select a different model.
                    </Alert>
                  )}
                </Box>
              )}

              {step === 6 && (
                <Box>
                  <WizardStepHeader
                    codename="MODULE · NEURAL CORE"
                    title="Neural Core Initialization"
                    subtitle="Downloading local embedding models for the neural brain. This enables offline semantic search and GraphRAG."
                  />
                  <EmbeddingModelDownload onComplete={next} />
                </Box>
              )}

              {step === 7 && (
                <Box sx={{ maxWidth: 520, mx: 'auto' }}>
                  <WizardStepHeader codename="MODULE · CALLSIGN" title="Your Callsign" subtitle="How should Agent-X address you?" />
                  <TextField label="Callsign" value={callsign} onChange={e => setCallsign(e.target.value)} fullWidth placeholder="e.g. Commander"
                    slotProps={wizardTextFieldSlotProps} />
                  <Box sx={{ ...wizardPanelSx, mt: 4 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                      <BadgeIcon sx={{ fontSize: 20, color: wizardTheme.textSecondary }} />
                      <Typography variant="body2" sx={{ fontWeight: 700, fontFamily: WIZARD_MONO, letterSpacing: '1px', fontSize: '0.75rem' }}>WHAT IS A CALLSIGN?</Typography>
                    </Box>
                    <Typography variant="body2" sx={{ color: wizardTheme.textSecondary, fontSize: '0.8rem', lineHeight: 1.6 }}>Your unique identity within Agent-X. Used in conversations, logs, and notifications.</Typography>
                    <Typography variant="caption" sx={{ display: 'block', mt: 1.5, color: wizardTheme.textDim, fontFamily: WIZARD_MONO, fontSize: '0.65rem' }}>Examples: Commander, Captain, Architect, Operator</Typography>
                  </Box>
                </Box>
              )}

              {step === 8 && (
                <WizardVoiceStep onReadyChange={setVoiceCalibrated} />
              )}

              {step === 9 && (
                <WizardTelegramStep onLinkedChange={setTelegramLinked} />
              )}

              {step === 10 && (
                <Box sx={{ textAlign: 'center', maxWidth: 520, mx: 'auto' }}>
                  <CheckCircle size={64} color={wizardTheme.accentOk} sx={{ mb: 2 }} />
                  <WizardStepHeader codename="MODULE · COMPLETE" title="Setup Complete" subtitle="Your Agent-X instance is ready." />
                  <Box sx={{ textAlign: 'left', ...wizardPanelSx, mb: 3, fontFamily: WIZARD_MONO, fontSize: '0.75rem' }}>
                    <Typography variant="caption" sx={{ display: 'block', color: wizardTheme.textDim }}>Storage: {selectedBackend === 'embedded-postgres' ? 'Embedded PostgreSQL (port 3335)' : 'Starfleet Relay (PostgreSQL)'}</Typography>
                    <Typography variant="caption" sx={{ display: 'block', color: wizardTheme.textDim }}>Provider: {selectedProvider}</Typography>
                    <Typography variant="caption" sx={{ display: 'block', color: wizardTheme.textDim }}>Model: {selectedModel}</Typography>
                    {localModelSupported && (
                      <Typography variant="caption" sx={{ display: 'block', color: wizardTheme.textDim }}>Local Model: {selectedLocalModel || '(not installed)'}</Typography>
                    )}
                    {neuralBrainSupported ? (
                      <Typography variant="caption" sx={{ display: 'block', color: wizardTheme.textDim }}>Neural Core: Embedding models downloaded</Typography>
                    ) : (
                      <Typography variant="caption" sx={{ display: 'block', color: wizardTheme.textDim }}>Neural Core: Disabled (requires 16GB+ RAM)</Typography>
                    )}
                    <Typography variant="caption" sx={{ display: 'block', color: voiceCalibrated ? wizardTheme.accentOk : wizardTheme.textDim }}>Voice Comms: {voiceCalibrated ? 'Calibrated' : 'Skipped'}</Typography>
                    <Typography variant="caption" sx={{ display: 'block', color: telegramLinked ? wizardTheme.accentOk : wizardTheme.textDim }}>Telegram Relay: {telegramLinked ? 'Linked' : 'Skipped'}</Typography>
                    <Typography variant="caption" sx={{ display: 'block', color: wizardTheme.textDim }}>Callsign: {callsign || '(not set)'}</Typography>
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </Box>
        </Box>
      </Box>

      {/* Bottom Nav */}
      <Box sx={{ flexShrink: 0, borderTop: `1px solid ${wizardTheme.panelBorder}`, px: 2, py: 2, display: 'flex', justifyContent: 'center' }}>
        <Box sx={{ width: '100%', maxWidth: 820, display: 'flex', justifyContent: step === 0 && !showRelayConfig ? 'flex-end' : step === 10 ? 'center' : 'space-between', alignItems: 'center' }}>
          {step === 1 && <Button onClick={handleBackFromProvider} sx={wizardBackBtnSx}>Back</Button>}
          {step === 2 && <Button onClick={back} sx={wizardBackBtnSx}>Back</Button>}
          {step === 3 && <Button onClick={back} sx={wizardBackBtnSx}>Back</Button>}
          {step === 4 && <Button onClick={localModelSupported ? handleBackToCredentials : back} sx={wizardBackBtnSx}>Back</Button>}
          {step === 5 && <Button onClick={handleBenchmarkBack} sx={wizardBackBtnSx}>Back</Button>}
          {step === 6 && <Button onClick={back} sx={wizardBackBtnSx}>Back</Button>}
          {step === 7 && <Button onClick={back} sx={wizardBackBtnSx}>Back</Button>}
          {step === 8 && <Button onClick={back} sx={wizardBackBtnSx}>Back</Button>}
          {step === 9 && <Button onClick={back} sx={wizardBackBtnSx}>Back</Button>}
          {step === 0 && !showRelayConfig && (
            <Button variant="contained" onClick={handleStorageNext} disabled={loading || provisioning} sx={{ ...wizardPrimaryBtnSx, px: 4 }}>
              {loading || provisioning
                ? 'Starting...'
                : selectedBackend === 'embedded-postgres' ? 'Start Embedded PostgreSQL →' : 'Configure Relay →'}
            </Button>
          )}
          {step === 0 && showRelayConfig && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
              <Button onClick={() => { setShowRelayConfig(false); resetPgTest(); }} disabled={provisioning || pgTesting} sx={wizardBackBtnSx}>← Back</Button>
              <Button
                variant="contained"
                onClick={handleRelaySave}
                disabled={!pgTestResult?.ok || provisioning || pgTesting}
                sx={{ ...wizardPrimaryBtnSx, px: 4 }}
              >
                {provisioning ? 'Saving…' : 'Save & Continue →'}
              </Button>
            </Box>
          )}
          {step === 1 && <Button variant="contained" onClick={handleProviderNext} sx={wizardPrimaryBtnSx}>Next</Button>}
          {step === 2 && <Button variant="contained" onClick={handleProfileNext} disabled={loading} sx={wizardPrimaryBtnSx}>{loading ? 'Validating...' : 'Validate & Next'}</Button>}
          {step === 3 && (
            <Button
              variant="contained"
              onClick={next}
              disabled={
                !skipLocalModel &&
                !installedLocalModels.some(m => m.modelId === selectedLocalModel) &&
                !activeDownloads.some(d => d.modelId === selectedLocalModel && (d.status === 'downloading' || d.status === 'complete'))
              }
              sx={wizardPrimaryBtnSx}
            >
              Next
            </Button>
          )}
          {step === 4 && <Button variant="contained" onClick={handleModelNext} disabled={!selectedModel} sx={wizardPrimaryBtnSx}>Next</Button>}
          {step === 5 && (
            <Button
              variant="contained"
              onClick={next}
              disabled={!canProceedBenchmark}
              sx={wizardPrimaryBtnSx}
            >
              {benchmarkRunning ? 'Scanning…' : 'Next'}
            </Button>
          )}
          {step === 7 && <Button variant="contained" onClick={handleCallsignNext} disabled={!callsign.trim()} sx={wizardPrimaryBtnSx}>Next</Button>}
          {step === 8 && (
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', justifyContent: voiceCalibrated ? 'flex-end' : 'space-between', width: '100%' }}>
              {!voiceCalibrated && (
                <Button onClick={next} sx={wizardSkipBtnSx}>
                  Skip for now
                </Button>
              )}
              <Button variant="contained" onClick={next} sx={wizardPrimaryBtnSx}>
                {voiceCalibrated ? 'Continue →' : 'Skip →'}
              </Button>
            </Box>
          )}
          {step === 9 && (
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', justifyContent: telegramLinked ? 'flex-end' : 'space-between', width: '100%' }}>
              {!telegramLinked && (
                <Button onClick={next} sx={wizardSkipBtnSx}>
                  Skip for now
                </Button>
              )}
              <Button variant="contained" onClick={next} sx={wizardPrimaryBtnSx}>
                {telegramLinked ? 'Continue →' : 'Skip →'}
              </Button>
            </Box>
          )}
          {step === 10 && <Button variant="contained" onClick={handleComplete} disabled={loading} sx={{ ...wizardPrimaryBtnSx, px: 5, py: 1.2 }}>{loading ? 'Finalizing...' : 'Launch Console'}</Button>}
        </Box>
      </Box>

      <Dialog open={showStorageBackWarning} onClose={() => setShowStorageBackWarning(false)}
        PaperProps={{ sx: { bgcolor: wizardTheme.panel, border: `1px solid ${wizardTheme.panelBorder}`, borderRadius: 1, maxWidth: 440 } }}>
        <DialogTitle sx={{ fontFamily: WIZARD_MONO, fontSize: '0.85rem', fontWeight: 700, pb: 1 }}>RETURN TO STORAGE?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: wizardTheme.textSecondary, fontSize: '0.8rem', lineHeight: 1.6 }}>
            Storage is already configured
            {provisionedBackend === 'embedded-postgres' ? ' (embedded PostgreSQL)' : provisionedBackend === 'postgres' ? ' (cloud relay)' : ''}.
            You can review or change your choice on the storage step.
          </Typography>
          {provisionedBackend === 'embedded-postgres' && (
            <Typography variant="body2" sx={{ color: wizardTheme.textDim, fontSize: '0.75rem', lineHeight: 1.6, mt: 1.5 }}>
              The local database keeps running in the background. It is not shut down when you go back.
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setShowStorageBackWarning(false)} sx={wizardSkipBtnSx}>Stay on Provider</Button>
          <Button onClick={confirmBackToStorage} variant="contained" sx={wizardPrimaryBtnSx}>Go to Storage</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={provisionModalOpen}
        onClose={(_event, reason) => {
          // Don't abort an in-flight provision via backdrop/Escape — require explicit Cancel.
          if (provisioning && (reason === 'backdropClick' || reason === 'escapeKeyDown')) return;
          discardProvision();
        }}
        PaperProps={{ sx: { bgcolor: wizardTheme.panel, border: `1px solid ${wizardTheme.panelBorder}`, borderRadius: 1, maxWidth: 'min(92vw, 900px)', width: 'min(92vw, 900px)' } }}
      >
        <DialogTitle sx={{ fontFamily: WIZARD_MONO, fontSize: '0.85rem', fontWeight: 700, pb: 1, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {provisioning && <CircularProgress size={14} sx={{ color: wizardTheme.textDim }} />}
          {provisionModalMode === 'embedded-postgres'
            ? 'STARTING EMBEDDED POSTGRESQL'
            : 'CONNECTING CLOUD RELAY'}
        </DialogTitle>
        <DialogContent sx={{ pt: 0, px: 2.5 }}>
          <Typography variant="body2" sx={{ color: wizardTheme.textDim, fontSize: '0.72rem', mb: 1.5, lineHeight: 1.5 }}>
            {provisioning
              ? (provisionModalMode === 'embedded-postgres'
                ? 'Initializing the local database. First run can take up to a minute.'
                : 'Saving configuration and applying schema migrations to your PostgreSQL instance. Crew Hub seeding can take several minutes over cloud networks.')
              : provisionFailed
                ? 'Setup did not complete. Review the logs below, then discard to try a different configuration.'
                : 'Setup complete.'}
          </Typography>
          <Box
            ref={provisionModalMode === 'embedded-postgres' ? embeddedLogRef : cloudLogRef}
            sx={{
              minHeight: 200,
              maxHeight: 280,
              overflowY: 'auto',
              overflowX: 'auto',
              px: 1.5,
              py: 1.25,
              bgcolor: alphaColor(colors.ink, 0.06),
              border: `1px solid ${wizardTheme.panelBorder}`,
              borderRadius: 0.5,
              fontFamily: WIZARD_MONO,
              fontSize: '0.68rem',
              lineHeight: 1.55,
              color: wizardTheme.textSecondary,
              whiteSpace: 'pre',
            }}
          >
            {(provisionModalMode === 'embedded-postgres' ? embeddedProvisionLogs : cloudProvisionLogs).length === 0
              ? 'Waiting for setup logs…'
              : (provisionModalMode === 'embedded-postgres' ? embeddedProvisionLogs : cloudProvisionLogs).join('\n')}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2, pt: 0 }}>
          <Button onClick={discardProvision} sx={wizardSkipBtnSx}>
            {provisioning ? 'Cancel setup' : 'Discard'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={showBackWarning} onClose={() => setShowBackWarning(false)}
        PaperProps={{ sx: { bgcolor: wizardTheme.panel, border: `1px solid ${wizardTheme.panelBorder}`, borderRadius: 1, maxWidth: 400 } }}>
        <DialogTitle sx={{ fontFamily: WIZARD_MONO, fontSize: '0.85rem', fontWeight: 700, pb: 1 }}>RE-ENTER CREDENTIALS?</DialogTitle>
        <DialogContent><Typography variant="body2" sx={{ color: wizardTheme.textSecondary, fontSize: '0.8rem', lineHeight: 1.6 }}>Going back will clear your API key for security. You will need to re-enter and validate them.</Typography></DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setShowBackWarning(false)} sx={wizardSkipBtnSx}>Cancel</Button>
          <Button onClick={confirmBackToCredentials} variant="contained" sx={{ bgcolor: wizardTheme.accentErr, color: colors.bg.primary, fontFamily: WIZARD_MONO, fontSize: '0.65rem', textTransform: 'none' }}>Clear & Go Back</Button>
        </DialogActions>
      </Dialog>

      {loading && (
        <Box sx={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: colors.shadow.heavy, backdropFilter: 'blur(2px)' }}>
          <CircularProgress size={40} sx={{ color: colors.text.primary }} />
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
      bgcolor: alphaColor(colors.ink, 0.015),
      border: `1px solid ${wizardTheme.panelBorder}`,
      transition: 'all 0.15s',
    }}>
      <Box sx={{ color: wizardTheme.textDim, flexShrink: 0, display: 'flex', opacity: 0.6 }}>{icon}</Box>
      <Typography sx={{ fontSize: '0.64rem', color: wizardTheme.textSecondary, lineHeight: 1.45, fontWeight: 500 }}>{text}</Typography>
    </Box>
  );
}
