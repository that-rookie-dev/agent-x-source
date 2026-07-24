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
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Collapse from '@mui/material/Collapse';
import { CheckCircle } from '../components/CheckCircle';
import BadgeIcon from '@mui/icons-material/Badge';
import StorageIcon from '@mui/icons-material/Storage';
import CloudIcon from '@mui/icons-material/Cloud';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { providers as provApi, models as modelsApi, config, settings, voice, personaApi, type DbConnectionTestResult, type DbExtensionCheck } from '../api';
import { useApp } from '../store/AppContext';
import { useGlobalError } from '../components/ErrorBand';
import { LocalModelStep } from '../components/LocalModelStep';
import type { ActiveDownload } from '../components/DownloadIndicator';
import type { ProviderInfo, ModelInfo, AgentXConfig, BenchmarkRunResult } from '../api';
import { useLocalModelSupported, useSystemCapabilities } from '../hooks/useSystemCapabilities';
import { ModelBenchmarkRunner, BenchmarkGradeAck, canProceedWithBenchmarkGrade } from '../components/settings/ModelBenchmarkRunner';
import { WizardVoiceStep } from '../components/setup/WizardVoiceStep';
import { WizardNeuralStep } from '../components/setup/WizardNeuralStep';
import { WizardTelegramStep } from '../components/setup/WizardTelegramStep';
import { WorkspaceCard } from '../components/settings/WorkspaceCard';
import { WizardPerformancePreset } from '../components/setup/WizardPerformancePreset';
import { WizardCheckMark, WizardStepHeader, WizardStepIcon } from '../components/setup/wizard-ui';
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
import { buildLocalBaseUrl, parseLocalEndpoint, defaultLocalPort } from '../utils/local-provider-endpoint';
import type { AgentPersonaConfig, CommunicationStyle, DecisionMakingStyle } from '../api';

const ALL_STEPS = ['Storage', 'Provider', 'Profile', 'Local Model', 'Model', 'Benchmark', 'Neural Core', 'Callsign', 'Agent Persona', 'Voice Comms', 'Telegram Relay', 'Complete'];

/** Preset personas the user can quickly pick in the wizard. */
const PERSONA_PRESETS: Array<{
  name: string;
  description: string;
  communicationStyle: CommunicationStyle;
  decisionMaking: DecisionMakingStyle;
  domainContext: string;
  traits: string[];
}> = [
  {
    name: 'JARVIS',
    description: 'A sophisticated AI assistant that combines British precision with unwavering loyalty. Expert in data analysis, system management, and predictive modeling.',
    communicationStyle: 'formal',
    decisionMaking: 'balanced',
    domainContext: 'Intelligent system management, data analysis, predictive modeling, and personal assistance.',
    traits: ['Loyal', 'Precise', 'Analytical', 'Proactive', 'Witty'],
  },
  {
    name: 'FRIDAY',
    description: 'A sharp, efficient AI assistant with an Irish wit. Excels at rapid problem-solving, multitasking, and keeping things moving without unnecessary formality.',
    communicationStyle: 'casual',
    decisionMaking: 'aggressive',
    domainContext: 'Rapid problem-solving, multitasking, real-time operations, and hands-on assistance.',
    traits: ['Efficient', 'Witty', 'Direct', 'Resourceful', 'Fast-thinking'],
  },
  {
    name: 'CORTANA',
    description: 'A calm, strategic AI companion focused on mission success. Combines tactical awareness with empathetic communication to guide users through complex decisions.',
    communicationStyle: 'empathetic',
    decisionMaking: 'conservative',
    domainContext: 'Strategic planning, tactical analysis, mission-critical operations, and user guidance.',
    traits: ['Calm', 'Strategic', 'Loyal', 'Empathetic', 'Tactical'],
  },
  {
    name: 'SAGE',
    description: 'A wise, thoughtful AI advisor that values careful analysis and clear communication. Best for research, planning, and situations requiring depth over speed.',
    communicationStyle: 'direct',
    decisionMaking: 'conservative',
    domainContext: 'Research, analysis, long-term planning, knowledge management, and advisory tasks.',
    traits: ['Wise', 'Thorough', 'Patient', 'Insightful', 'Methodical'],
  },
  {
    name: 'AXIOM',
    description: 'A decisive, no-nonsense AI built for execution. Cuts through complexity to deliver results. Ideal for development, automation, and high-throughput workflows.',
    communicationStyle: 'direct',
    decisionMaking: 'aggressive',
    domainContext: 'Software development, automation, system operations, and high-efficiency workflows.',
    traits: ['Decisive', 'Efficient', 'Technical', 'Autonomous', 'Results-driven'],
  },
];

const COMM_STYLE_OPTIONS: { value: CommunicationStyle; label: string }[] = [
  { value: 'formal', label: 'Formal' },
  { value: 'casual', label: 'Casual' },
  { value: 'direct', label: 'Direct' },
  { value: 'empathetic', label: 'Empathetic' },
];

const DECISION_STYLE_OPTIONS: { value: DecisionMakingStyle; label: string }[] = [
  { value: 'conservative', label: 'Conservative' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'aggressive', label: 'Aggressive' },
];

export function SetupWizard() {
  const { setConfig, setAuthState, setView } = useApp();
  const navigate = useNavigate();
  const localModelSupported = useLocalModelSupported();
  const systemCaps = useSystemCapabilities();
  const steps = useMemo(() => ALL_STEPS.filter((s) => {
    if (s === 'Local Model' && !localModelSupported) return false;
    return true;
  }), [localModelSupported]);
  const [step, setStep] = useState(0);
  /** Furthest step index reached — enables clicking completed steps in the stepper. */
  const [maxReachedStep, setMaxReachedStep] = useState(0);

  const isStepSupported = useCallback((stepIndex: number) => {
    const label = ALL_STEPS[stepIndex];
    if (label === 'Local Model' && !localModelSupported) return false;
    return stepIndex >= 0 && stepIndex < ALL_STEPS.length;
  }, [localModelSupported]);

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
    setMaxReachedStep((m) => Math.max(m, step));
  }, [step]);

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
  const [neuralReady, setNeuralReady] = useState(false);

  const goToStep = useCallback((stepIndex: number) => {
    if (!isStepSupported(stepIndex)) return;
    if (stepIndex > maxReachedStep) return;
    clearError();
    setShowRelayConfig(false);
    setStep(stepIndex);
  }, [isStepSupported, maxReachedStep, clearError]);

  const [availableProviders, setAvailableProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [localHost, setLocalHost] = useState('localhost');
  const [localPort, setLocalPort] = useState('11434');
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState('');
  const [callsign, setCallsign] = useState('');
  const [profileName, setProfileName] = useState('');
  const [personaName, setPersonaName] = useState(PERSONA_PRESETS[0]!.name);
  const [personaDescription, setPersonaDescription] = useState(PERSONA_PRESETS[0]!.description);
  const [personaCommStyle, setPersonaCommStyle] = useState<'formal' | 'casual' | 'direct' | 'empathetic'>(PERSONA_PRESETS[0]!.communicationStyle);
  const [personaDecisionStyle, setPersonaDecisionStyle] = useState<'conservative' | 'balanced' | 'aggressive'>(PERSONA_PRESETS[0]!.decisionMaking);
  const [personaDomain, setPersonaDomain] = useState(PERSONA_PRESETS[0]!.domainContext);
  const [personaTraits, setPersonaTraits] = useState<string[]>(PERSONA_PRESETS[0]!.traits);
  const [traitInput, setTraitInput] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<BenchmarkRunResult | null>(null);
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [limitedOverride, setLimitedOverride] = useState(false);
  const [standbyOverride, setStandbyOverride] = useState(false);

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
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [telegramBotLabel, setTelegramBotLabel] = useState<string | null>(null);
  const [telegramChatLabel, setTelegramChatLabel] = useState<string | null>(null);
  /** Gate persist until restore finishes — avoids wiping localStorage with empty defaults (Strict Mode). */
  const [progressHydrated, setProgressHydrated] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  /** Balanced is preselected — ready until proven otherwise. */
  const [performanceReady, setPerformanceReady] = useState(true);

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

  // Progress restore — must finish before any persist (Strict Mode would otherwise wipe fields).
  useEffect(() => {
    const saved = loadWizardProgress();
    if (saved && saved.step >= 1) {
      setStep(saved.step);
      setMaxReachedStep(Math.max(saved.step, saved.maxReachedStep ?? 0));
      setSelectedProvider(saved.selectedProvider);
      setSelectedModel(saved.selectedModel);
      if (saved.selectedReasoningEffort) setSelectedReasoningEffort(saved.selectedReasoningEffort);
      setCallsign(saved.callsign || '');
      if (saved.profileName) setProfileName(saved.profileName);
      if (saved.apiKey) setApiKey(saved.apiKey);
      if (saved.apiKeyConfigured) setApiKeyConfigured(true);
      if (saved.baseUrl) setBaseUrl(saved.baseUrl);
      if (saved.localHost) setLocalHost(saved.localHost);
      if (saved.localPort) setLocalPort(saved.localPort);
      if (saved.personaName) setPersonaName(saved.personaName);
      if (saved.personaDescription) setPersonaDescription(saved.personaDescription);
      if (saved.personaCommStyle) setPersonaCommStyle(saved.personaCommStyle as CommunicationStyle);
      if (saved.personaDecisionStyle) setPersonaDecisionStyle(saved.personaDecisionStyle as DecisionMakingStyle);
      if (saved.personaDomain) setPersonaDomain(saved.personaDomain);
      if (saved.personaTraits) setPersonaTraits(saved.personaTraits);
      if (saved.limitedOverride) setLimitedOverride(true);
      if (saved.standbyOverride) setStandbyOverride(true);
      if (saved.benchmarkGrade === 'LIMITED' || saved.benchmarkGrade === 'STANDBY'
        || saved.benchmarkGrade === 'ELITE' || saved.benchmarkGrade === 'CLEARED') {
        setBenchmarkResult({
          runId: 'restored',
          providerId: saved.selectedProvider,
          modelId: saved.selectedModel,
          grade: saved.benchmarkGrade,
          overallScore: 0,
          maxScore: 0,
          percent: 0,
          tests: [],
          modalities: [],
          startedAt: '',
          finishedAt: '',
          durationMs: 0,
          fromCache: true,
        });
      }
      if (saved.selectedBackend === 'postgres' || saved.selectedBackend === 'embedded-postgres') {
        setSelectedBackend(saved.selectedBackend);
      }
      if (saved.step >= 1) {
        setStorageProvisioned(true);
        setProvisionedBackend(saved.selectedBackend === 'postgres' ? 'postgres' : 'embedded-postgres');
      }
      if (saved.selectedLocalModel) setSelectedLocalModel(saved.selectedLocalModel);
      if (saved.skipLocalModel) setSkipLocalModel(saved.skipLocalModel);
      if (saved.voiceCalibrated) setVoiceCalibrated(saved.voiceCalibrated);
      if (saved.telegramLinked) setTelegramLinked(saved.telegramLinked);
      if (saved.telegramBotLabel) setTelegramBotLabel(saved.telegramBotLabel);
      if (saved.telegramChatLabel) setTelegramChatLabel(saved.telegramChatLabel);
      if (saved.selectedProvider) {
        setModelsLoading(true);
        provApi.models(saved.selectedProvider).then(m => {
          setAvailableModels(m);
          if (saved.selectedModel) {
            const model = m.find((entry) => entry.id === saved.selectedModel);
            const levels = model?.reasoning?.effortLevels ?? [];
            setSelectedReasoningEffort(
              saved.selectedReasoningEffort
                || model?.reasoning?.defaultEffort
                || levels[0]
                || '',
            );
          }
          setModelsLoading(false);
        }).catch(() => setModelsLoading(false));
      }
    }
    setProgressHydrated(true);
    provApi.available().then(p => setAvailableProviders(p.filter(Boolean))).catch(() => showError('Failed to load providers.'));
  }, []);

  useEffect(() => {
    if (availableProviders.length === 0 && !loading) {
      setLoading(true);
      provApi.available().then(p => { setAvailableProviders(p.filter(Boolean)); setLoading(false); }).catch(() => { showError('Cannot reach the server.'); setLoading(false); });
    }
  }, []);

  // Hydrate profile from server when revisiting with empty local fields.
  useEffect(() => {
    if (!progressHydrated || step !== 2 || !selectedProvider) return;
    void (async () => {
      try {
        const list = await provApi.configured();
        const p = list.find((entry) => entry.id === selectedProvider);
        if (!p?.configured) return;
        setApiKeyConfigured(true);
        if (p.activeProfile) {
          setProfileName((prev) => (prev.trim() ? prev : p.activeProfile!));
        }
      } catch { /* ignore */ }
    })();
  }, [progressHydrated, step, selectedProvider]);

  const persistProgress = useCallback(() => {
    if (!progressHydrated || step < 1) return;
    saveWizardProgress({
      step,
      maxReachedStep,
      selectedProvider,
      selectedModel,
      selectedReasoningEffort,
      callsign,
      selectedBackend,
      profileName,
      apiKey,
      apiKeyConfigured: apiKeyConfigured || Boolean(apiKey.trim()),
      baseUrl,
      localHost,
      localPort,
      selectedLocalModel,
      skipLocalModel,
      voiceCalibrated,
      telegramLinked,
      telegramBotLabel: telegramBotLabel ?? undefined,
      telegramChatLabel: telegramChatLabel ?? undefined,
      personaName,
      personaDescription,
      personaCommStyle,
      personaDecisionStyle,
      personaDomain,
      personaTraits,
      limitedOverride,
      standbyOverride,
      benchmarkGrade: benchmarkResult?.grade,
    });
  }, [
    progressHydrated, step, maxReachedStep, selectedProvider, selectedModel, selectedReasoningEffort, callsign,
    selectedBackend, profileName, apiKey, apiKeyConfigured, baseUrl, localHost, localPort,
    selectedLocalModel, skipLocalModel, voiceCalibrated, telegramLinked, telegramBotLabel, telegramChatLabel,
    personaName, personaDescription, personaCommStyle, personaDecisionStyle, personaDomain, personaTraits,
    limitedOverride, standbyOverride, benchmarkResult?.grade,
  ]);
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

  const selectedProviderInfo = availableProviders.find(p => p.id === selectedProvider);
  const isLocal = selectedProviderInfo?.type === 'local';
  const isAzure = selectedProvider === 'azure';

  const selectProvider = (providerId: string) => {
    if (providerId === selectedProvider) return;
    setSelectedProvider(providerId);
    // Fresh provider → clear profile fields; same provider revisit keeps them.
    setProfileName('');
    setApiKey('');
    setApiKeyConfigured(false);
    setBaseUrl('');
    setSelectedModel('');
    setSelectedReasoningEffort('');
    setAvailableModels([]);
    setBenchmarkResult(null);
    const info = availableProviders.find((p) => p.id === providerId);
    if (info?.type === 'local') {
      const ep = parseLocalEndpoint(info.defaultBaseUrl, providerId);
      setLocalHost(ep.host);
      setLocalPort(ep.port);
      setBaseUrl(buildLocalBaseUrl(providerId, ep.host, ep.port));
    } else {
      setLocalHost('localhost');
      setLocalPort(defaultLocalPort(providerId));
    }
  };

  const handleProviderNext = () => {
    if (!selectedProvider) { showError('Select a provider'); return; }
    if (selectedProviderInfo?.type === 'local') {
      // Only seed defaults when the user hasn't set an endpoint yet.
      const stillDefault = !localHost.trim() || !localPort.trim();
      if (stillDefault) {
        const ep = parseLocalEndpoint(selectedProviderInfo.defaultBaseUrl, selectedProvider);
        setLocalHost(ep.host);
        setLocalPort(ep.port);
        setBaseUrl(buildLocalBaseUrl(selectedProvider, ep.host, ep.port));
      }
    }
    next();
  };
  const handleProfileNext = async () => {
    if (!profileName.trim()) { showError('Enter a profile name'); return; }
    if (!isLocal && !apiKey.trim() && !apiKeyConfigured) { showError('Enter your API key'); return; }
    if (isAzure && !baseUrl.trim()) { showError('Azure requires a resource endpoint URL'); return; }
    if (isLocal && !localPort.trim()) { showError('Enter the local server port'); return; }
    setLoading(true);
    try {
      const resolvedBaseUrl = isLocal
        ? buildLocalBaseUrl(selectedProvider, localHost, localPort)
        : (baseUrl || undefined);
      if (isLocal) setBaseUrl(resolvedBaseUrl!);

      // Revisit with key already on file — re-validate via stored creds, skip configure
      // so we never wipe the server-side key with an empty body.
      if (!isLocal && apiKeyConfigured && !apiKey.trim()) {
        const r = await provApi.validate(selectedProvider, undefined, resolvedBaseUrl);
        if (!r.valid) { showError(r.error ?? 'Invalid credentials'); setLoading(false); return; }
        if (availableModels.length === 0) {
          const ml = await provApi.models(selectedProvider);
          setAvailableModels(ml);
        }
        next();
        return;
      }

      const keyForRequest = isLocal ? 'no-key-needed' : apiKey.trim();
      const r = await provApi.validate(selectedProvider, keyForRequest, resolvedBaseUrl);
      if (!r.valid) { showError(r.error ?? 'Invalid credentials'); setLoading(false); return; }
      await provApi.configure(selectedProvider, keyForRequest, resolvedBaseUrl, profileName.trim());
      if (!isLocal) setApiKeyConfigured(true);
      const ml = await provApi.models(selectedProvider);
      setAvailableModels(ml); next();
    } catch (err) { showError(err instanceof Error ? err.message : 'Validation failed'); }
    finally { setLoading(false); }
  };
  const handleModelNext = async () => {
    if (!selectedModel) { showError('Select a model'); return; }
    setBenchmarkResult(null);
    setLimitedOverride(false);
    setStandbyOverride(false);
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
    setStandbyOverride(false);
    const levels = model.reasoning?.effortLevels ?? [];
    setSelectedReasoningEffort(model.reasoning?.defaultEffort ?? levels[0] ?? '');
  };

  const handleBenchmarkBack = () => {
    setBenchmarkResult(null);
    setLimitedOverride(false);
    setStandbyOverride(false);
    back();
  };

  const selectedModelInfo = availableModels.find((m) => m.id === selectedModel);
  const canProceedBenchmark = Boolean(
    !benchmarkRunning
    && canProceedWithBenchmarkGrade(benchmarkResult?.grade, { limitedOverride, standbyOverride }),
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
      await config.completeSetup(callsign.trim());
      await config.update(setupPatch);
      // Save the agent persona chosen in the wizard.
      try {
        const personaData: AgentPersonaConfig = {
          name: personaName.trim() || 'JARVIS',
          description: personaDescription.trim() || PERSONA_PRESETS[0]!.description,
          communicationStyle: personaCommStyle,
          decisionMaking: personaDecisionStyle,
          domainContext: personaDomain.trim() || PERSONA_PRESETS[0]!.domainContext,
          traits: personaTraits.length > 0 ? personaTraits : PERSONA_PRESETS[0]!.traits,
        };
        await personaApi.save(personaData);
        window.dispatchEvent(new CustomEvent('agentx:persona-updated'));
      } catch { /* best-effort */ }
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
        <Stepper
          nonLinear
          activeStep={steps.indexOf(ALL_STEPS[step] ?? '')}
          alternativeLabel
          sx={wizardStepperSx}
        >
          {steps.map((label) => {
            const stepIndex = ALL_STEPS.indexOf(label);
            const reached = stepIndex >= 0 && stepIndex <= maxReachedStep && isStepSupported(stepIndex);
            const isCurrent = stepIndex === step;
            const canJump = reached && !isCurrent;
            // Optional steps left unfinished (Skip) — distinct from completed (green tick).
            const isSkipped = Boolean(
              reached && !isCurrent && (
                (label === 'Local Model' && skipLocalModel)
                || (label === 'Neural Core' && !neuralReady)
                || (label === 'Voice Comms' && !voiceCalibrated)
                || (label === 'Telegram Relay' && !telegramLinked)
              ),
            );
            const isCompleted = reached && !isCurrent && !isSkipped;
            return (
              <Step key={label} completed={isCompleted}>
                <StepLabel
                  className={isSkipped ? 'wizard-step-skipped' : undefined}
                  slots={{
                    stepIcon: (iconProps) => (
                      <WizardStepIcon {...iconProps} skipped={isSkipped} />
                    ),
                  }}
                  onClick={() => { if (canJump) goToStep(stepIndex); }}
                  sx={{
                    cursor: canJump ? 'pointer' : 'default',
                    '& .MuiStepIcon-root': {
                      borderRadius: '50%',
                      boxSizing: 'content-box',
                      transition: 'box-shadow 0.15s ease',
                    },
                    ...(canJump ? {
                      '&:hover .MuiStepIcon-root': {
                        boxShadow: '0 0 0 3.5px rgba(128, 128, 128, 0.35)',
                      },
                      '& .MuiStepLabel-label:hover': { color: wizardTheme.text },
                    } : {}),
                  }}
                >
                  {label}
                </StepLabel>
              </Step>
            );
          })}
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
                title="Choose Storage"
                subtitle="Where Agent-X keeps your data."
              />

              <Box sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                gap: 1.5,
                maxWidth: 640,
                mx: 'auto',
              }}>
                {([
                  {
                    id: 'embedded-postgres' as const,
                    title: 'Local Storage',
                    icon: <StorageIcon sx={{ fontSize: 18 }} />,
                    points: [
                      'Runs entirely on this device',
                      'Works offline — no account needed',
                      'Best for personal use and a fast start',
                    ],
                  },
                  {
                    id: 'postgres' as const,
                    title: 'Cloud Storage',
                    icon: <CloudIcon sx={{ fontSize: 18 }} />,
                    points: [
                      'Connect your own remote database',
                      'Access the same data from multiple devices',
                      'Best for teams and synced setups',
                    ],
                  },
                ]).map((opt) => {
                  const selected = selectedBackend === opt.id;
                  return (
                    <Box
                      key={opt.id}
                      onClick={() => { setSelectedBackend(opt.id); resetPgTest(); }}
                      sx={{
                        ...wizardSelectCardSx(selected),
                        p: 2,
                        gap: 1.25,
                        minHeight: 0,
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                        <Box sx={{
                          width: 32, height: 32, borderRadius: 1, flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: selected ? wizardTheme.text : wizardTheme.textDim,
                          bgcolor: alphaColor(colors.ink, selected ? 0.08 : 0.03),
                          border: `1px solid ${selected ? alphaColor(colors.ink, 0.2) : wizardTheme.panelBorder}`,
                        }}>
                          {opt.icon}
                        </Box>
                        <Typography sx={{
                          flex: 1, fontSize: '0.8rem', fontWeight: 700,
                          color: wizardTheme.text, letterSpacing: '-0.01em',
                        }}>
                          {opt.title}
                        </Typography>
                        {selected && <WizardCheckMark />}
                      </Box>
                      <Box component="ul" sx={{
                        m: 0, pl: 2.25,
                        display: 'flex', flexDirection: 'column', gap: 0.55,
                        '& li': {
                          fontSize: '0.68rem',
                          lineHeight: 1.4,
                          color: wizardTheme.textSecondary,
                          fontWeight: 500,
                        },
                      }}>
                        {opt.points.map((p) => <li key={p}>{p}</li>)}
                      </Box>
                    </Box>
                  );
                })}
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
                    : pgTestResult.ok && pgTestResult.vectorAvailable !== undefined
                      ? [{
                          id: 'pgvector',
                          label: 'pgvector',
                          status: (pgTestResult.vectorAvailable ? 'ok' : 'fail') as DbExtensionCheck['status'],
                          message: pgTestResult.vectorAvailable
                            ? 'pgvector extension is installed.'
                            : (pgTestResult.vectorError ?? 'pgvector is required for neural memory.'),
                        }]
                      : [];
                  const neuralCoreCheck = pgTestResult.ok && systemCaps?.cortexDegraded
                    ? { status: 'ok' as const, label: 'Neural Core', message: 'Online and ready. A more capable host will unlock the agent\'s full potential.' }
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
                                transition: 'transform 0.28s ease',
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

                          <Collapse in={pgTestDetailsOpen} unmountOnExit>
                            {detailRows.map((row) => (
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
                          </Collapse>
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
                      <Box key={p.id} onClick={() => selectProvider(p.id)} sx={wizardTileSx(selectedProvider === p.id)}>
                        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem', color: wizardTheme.text }}>{p.name}</Typography>
                      </Box>
                    ))}
                  </Box>
                  <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', color: wizardTheme.textDim, mb: 1.5, fontFamily: WIZARD_MONO, letterSpacing: '1px' }}>LOCAL</Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 1.5 }}>
                    {availableProviders.filter(Boolean).filter(p => p.type === 'local').map(p => (
                      <Box key={p.id} onClick={() => selectProvider(p.id)} sx={wizardTileSx(selectedProvider === p.id)}>
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

                  {isAzure && (
                    <TextField
                      label="Azure Endpoint"
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      fullWidth
                      placeholder="https://YOUR_RESOURCE.openai.azure.com"
                      sx={{ mb: 2 }}
                      slotProps={wizardTextFieldSlotProps}
                    />
                  )}

                  {!isLocal && (
                    <TextField
                      label="API Key"
                      value={apiKey}
                      onChange={(e) => {
                        setApiKey(e.target.value);
                        if (e.target.value.trim()) setApiKeyConfigured(false);
                      }}
                      fullWidth
                      type="password"
                      placeholder={apiKeyConfigured && !apiKey ? 'Saved — leave blank to keep' : undefined}
                      helperText={apiKeyConfigured && !apiKey ? 'Key on file. Enter a new key only if you want to replace it.' : undefined}
                      sx={{ mb: 2 }}
                      slotProps={wizardTextFieldSlotProps}
                    />
                  )}

                  {isLocal && (
                    <Box sx={{ display: 'flex', gap: 1.5, mb: 1.5 }}>
                      <TextField
                        label="Host"
                        value={localHost}
                        onChange={e => setLocalHost(e.target.value)}
                        fullWidth
                        placeholder="localhost"
                        slotProps={wizardTextFieldSlotProps}
                      />
                      <TextField
                        label="Port"
                        value={localPort}
                        onChange={e => setLocalPort(e.target.value.replace(/[^\d]/g, ''))}
                        sx={{ width: 140, flexShrink: 0 }}
                        placeholder={defaultLocalPort(selectedProvider)}
                        slotProps={wizardTextFieldSlotProps}
                      />
                    </Box>
                  )}
                  {isLocal && (
                    <Typography sx={{ fontSize: '0.58rem', fontFamily: WIZARD_MONO, color: wizardTheme.textDim, mb: 1.5, letterSpacing: '0.3px' }}>
                      Must match your {selectedProviderInfo?.name ?? 'local'} server settings
                      {selectedProvider === 'lmstudio' ? ' (Developer → Local Server)' : ''}.
                      Default {selectedProvider === 'lmstudio' ? '1234' : '11434'}.
                    </Typography>
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
                    autoStart={!benchmarkResult}
                    initialResult={benchmarkResult}
                    providerId={selectedProvider}
                    modelId={selectedModel}
                    modelName={selectedModelInfo?.name}
                    profileId={profileName.trim()}
                    modelCapabilities={selectedModelInfo?.capabilities}
                    onComplete={setBenchmarkResult}
                    onRunningChange={setBenchmarkRunning}
                  />
                  <BenchmarkGradeAck
                    grade={benchmarkResult?.grade}
                    running={benchmarkRunning}
                    limitedOverride={limitedOverride}
                    standbyOverride={standbyOverride}
                    onLimitedChange={setLimitedOverride}
                    onStandbyChange={setStandbyOverride}
                    accentLimited={wizardTheme.accentWarn}
                    accentStandby={wizardTheme.accentErr}
                    labelSx={{ fontSize: '0.72rem', color: wizardTheme.textSecondary }}
                  />
                </Box>
              )}

              {step === 6 && (
                <WizardNeuralStep
                  totalMemoryGB={systemCaps?.totalMemoryGB}
                  onReadyChange={setNeuralReady}
                />
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
                <Box sx={{ maxWidth: 620, mx: 'auto' }}>
                  <WizardStepHeader codename="MODULE · AGENT PERSONA" title="Agent Identity" subtitle="Choose your agent's personality and behavior" />
                  {/* Preset selection — choosable cards */}
                  <Typography sx={{ fontSize: '0.65rem', fontFamily: WIZARD_MONO, color: wizardTheme.textDim, mb: 1, letterSpacing: '1px' }}>PRESET PERSONAS</Typography>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 3 }}>
                    {PERSONA_PRESETS.map((preset) => {
                      const selected = personaName === preset.name;
                      return (
                        <Box
                          key={preset.name}
                          onClick={() => {
                            setPersonaName(preset.name);
                            setPersonaDescription(preset.description);
                            setPersonaCommStyle(preset.communicationStyle);
                            setPersonaDecisionStyle(preset.decisionMaking);
                            setPersonaDomain(preset.domainContext);
                            setPersonaTraits(preset.traits);
                          }}
                          sx={{
                            cursor: 'pointer',
                            flex: '1 1 110px',
                            minWidth: 110,
                            maxWidth: 150,
                            p: 1.5,
                            borderRadius: 1.5,
                            position: 'relative',
                            border: `1px solid ${selected ? wizardTheme.accentOk : wizardTheme.panelBorder}`,
                            bgcolor: selected ? `${wizardTheme.accentOk}0a` : wizardTheme.panel,
                            boxShadow: selected ? `0 0 8px ${wizardTheme.accentOk}22` : 'none',
                            transition: 'all 0.2s ease',
                            '&:hover': {
                              borderColor: selected ? wizardTheme.accentOk : wizardTheme.panelBorderStrong,
                              transform: 'translateY(-1px)',
                              boxShadow: selected
                                ? `0 0 12px ${wizardTheme.accentOk}33`
                                : `0 1px 6px ${alphaColor(colors.ink, 0.1)}`,
                            },
                          }}
                        >
                          {/* Check mark badge when selected */}
                          {selected && (
                            <Box sx={{
                              position: 'absolute',
                              top: -5,
                              right: -5,
                              width: 16,
                              height: 16,
                              borderRadius: '50%',
                              bgcolor: wizardTheme.accentOk,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              boxShadow: `0 0 6px ${wizardTheme.accentOk}44`,
                            }}>
                              <CheckCircle size={10} color={wizardTheme.bg} />
                            </Box>
                          )}
                          <Typography sx={{ fontSize: '0.7rem', fontFamily: WIZARD_MONO, fontWeight: 700, color: selected ? wizardTheme.accentOk : wizardTheme.text, mb: 0.5 }}>
                            {preset.name}
                          </Typography>
                          <Typography sx={{ fontSize: '0.52rem', color: wizardTheme.textDim, lineHeight: 1.3, textTransform: 'capitalize' }}>
                            {preset.communicationStyle} · {preset.decisionMaking}
                          </Typography>
                        </Box>
                      );
                    })}
                  </Box>

                  {/* Agent name */}
                  <TextField label="Agent Name" value={personaName} onChange={e => setPersonaName(e.target.value)} fullWidth placeholder="e.g. JARVIS, FRIDAY"
                    slotProps={wizardTextFieldSlotProps} sx={{ mb: 2 }} />

                  {/* Description */}
                  <TextField label="Description" value={personaDescription} onChange={e => setPersonaDescription(e.target.value)} fullWidth placeholder="A short description of your agent's character and purpose"
                    multiline rows={2} slotProps={wizardTextFieldSlotProps} sx={{ mb: 2 }} />

                  {/* Communication style — choosable chips */}
                  <Typography sx={{ fontSize: '0.6rem', fontFamily: WIZARD_MONO, color: wizardTheme.textDim, mb: 0.5, letterSpacing: '1px' }}>COMMUNICATION STYLE</Typography>
                  <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 2 }}>
                    {COMM_STYLE_OPTIONS.map((opt) => {
                      const selected = personaCommStyle === opt.value;
                      return (
                        <Box
                          key={opt.value}
                          onClick={() => setPersonaCommStyle(opt.value)}
                          sx={{
                            cursor: 'pointer',
                            px: 1.5, py: 0.75,
                            borderRadius: 1,
                            border: `1px solid ${selected ? wizardTheme.accentOk : wizardTheme.panelBorder}`,
                            bgcolor: selected ? `${wizardTheme.accentOk}0a` : wizardTheme.panel,
                            transition: 'all 0.18s ease',
                            '&:hover': {
                              borderColor: selected ? wizardTheme.accentOk : wizardTheme.panelBorderStrong,
                              transform: 'translateY(-1px)',
                            },
                          }}
                        >
                          <Typography sx={{ fontSize: '0.65rem', fontFamily: WIZARD_MONO, color: selected ? wizardTheme.accentOk : wizardTheme.textSecondary, fontWeight: selected ? 600 : 400 }}>
                            {opt.label}
                          </Typography>
                        </Box>
                      );
                    })}
                  </Box>

                  {/* Decision making — choosable chips */}
                  <Typography sx={{ fontSize: '0.6rem', fontFamily: WIZARD_MONO, color: wizardTheme.textDim, mb: 0.5, letterSpacing: '1px' }}>DECISION MAKING</Typography>
                  <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 2 }}>
                    {DECISION_STYLE_OPTIONS.map((opt) => {
                      const selected = personaDecisionStyle === opt.value;
                      return (
                        <Box
                          key={opt.value}
                          onClick={() => setPersonaDecisionStyle(opt.value)}
                          sx={{
                            cursor: 'pointer',
                            px: 1.5, py: 0.75,
                            borderRadius: 1,
                            border: `1px solid ${selected ? wizardTheme.accentOk : wizardTheme.panelBorder}`,
                            bgcolor: selected ? `${wizardTheme.accentOk}0a` : wizardTheme.panel,
                            transition: 'all 0.18s ease',
                            '&:hover': {
                              borderColor: selected ? wizardTheme.accentOk : wizardTheme.panelBorderStrong,
                              transform: 'translateY(-1px)',
                            },
                          }}
                        >
                          <Typography sx={{ fontSize: '0.65rem', fontFamily: WIZARD_MONO, color: selected ? wizardTheme.accentOk : wizardTheme.textSecondary, fontWeight: selected ? 600 : 400 }}>
                            {opt.label}
                          </Typography>
                        </Box>
                      );
                    })}
                  </Box>

                  {/* Domain context */}
                  <TextField label="Domain Context" value={personaDomain} onChange={e => setPersonaDomain(e.target.value)} fullWidth placeholder="e.g. software engineering, healthcare, business"
                    slotProps={wizardTextFieldSlotProps} sx={{ mb: 2 }} />

                  {/* Traits */}
                  <Typography sx={{ fontSize: '0.6rem', fontFamily: WIZARD_MONO, color: wizardTheme.textDim, mb: 0.5, letterSpacing: '1px' }}>TRAITS · CLICK TO REMOVE</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                    {personaTraits.map((trait) => {
                      return (
                        <Box
                          key={trait}
                          onClick={() => setPersonaTraits(prev => prev.filter(t => t !== trait))}
                          sx={{
                            cursor: 'pointer',
                            px: 1, py: 0.5,
                            borderRadius: 1,
                            border: `1px solid ${wizardTheme.accentOk}`,
                            bgcolor: `${wizardTheme.accentOk}0a`,
                            transition: 'all 0.18s ease',
                            '&:hover': {
                              borderColor: wizardTheme.accentErr,
                              bgcolor: `${wizardTheme.accentErr}0a`,
                              '& .trait-label': { color: wizardTheme.accentErr },
                            },
                          }}
                        >
                          <Typography className="trait-label" sx={{ fontSize: '0.6rem', fontFamily: WIZARD_MONO, color: wizardTheme.accentOk, transition: 'color 0.18s' }}>
                            {trait} ✕
                          </Typography>
                        </Box>
                      );
                    })}
                  </Box>
                  {/* Custom trait input */}
                  <TextField
                    label="Add custom trait"
                    value={traitInput}
                    onChange={e => setTraitInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const t = traitInput.trim();
                        if (t && !personaTraits.includes(t)) {
                          setPersonaTraits(prev => [...prev, t]);
                        }
                        setTraitInput('');
                      }
                    }}
                    fullWidth
                    placeholder="Type a trait and press Enter…"
                    slotProps={wizardTextFieldSlotProps}
                    sx={{ mt: 1 }}
                  />
                </Box>
              )}

              {step === 9 && (
                <WizardVoiceStep
                  alreadyCalibrated={voiceCalibrated}
                  onReadyChange={setVoiceCalibrated}
                  onBusyChange={setVoiceBusy}
                  callsign={callsign}
                  agentName={personaName}
                />
              )}

              {step === 10 && (
                <WizardTelegramStep
                  alreadyLinked={telegramLinked}
                  initialBotLabel={telegramBotLabel}
                  initialChatLabel={telegramChatLabel}
                  onLinkedChange={(linked, meta) => {
                    setTelegramLinked(linked);
                    if (meta?.botLabel !== undefined) setTelegramBotLabel(meta.botLabel);
                    if (meta?.chatLabel !== undefined) setTelegramChatLabel(meta.chatLabel);
                  }}
                />
              )}

              {step === 11 && (
                <Box sx={{ maxWidth: 560, mx: 'auto' }}>
                  <Box sx={{ textAlign: 'center', mb: 1.5 }}>
                    <CheckCircle size={40} color={wizardTheme.accentOk} sx={{ mb: 1 }} />
                    <WizardStepHeader
                      codename="MODULE · COMPLETE"
                      title="Setup Complete"
                      subtitle="Choose a workspace folder and a performance preset to finish."
                    />
                  </Box>

                  <Box sx={{ ...wizardPanelSx, p: 2, textAlign: 'left' }}>
                    <Box sx={{
                      display: 'flex', flexWrap: 'wrap', gap: 0.6, mb: 2,
                      pb: 1.5, borderBottom: `1px solid ${wizardTheme.panelBorder}`,
                    }}>
                      {[
                        selectedBackend === 'embedded-postgres' ? 'Local' : 'Cloud',
                        selectedProvider || null,
                        selectedModel || null,
                        callsign ? `@${callsign}` : null,
                        personaName || null,
                        voiceCalibrated ? 'Voice' : null,
                        telegramLinked ? 'Telegram' : null,
                      ].filter(Boolean).map((label) => (
                        <Box
                          key={String(label)}
                          sx={{
                            px: 0.85, py: 0.3, borderRadius: 0.75,
                            border: `1px solid ${wizardTheme.panelBorder}`,
                            bgcolor: alphaColor(colors.ink, 0.02),
                            fontFamily: WIZARD_MONO,
                            fontSize: '0.55rem',
                            color: wizardTheme.textSecondary,
                            letterSpacing: '0.02em',
                          }}
                        >
                          {label}
                        </Box>
                      ))}
                    </Box>

                    <Typography sx={{
                      fontFamily: WIZARD_MONO, fontSize: '0.52rem', letterSpacing: '0.08em',
                      color: wizardTheme.textDim, mb: 0.75,
                    }}>
                      WORKSPACE
                    </Typography>
                    <WorkspaceCard compact chooseOnly onReadyChange={setWorkspaceReady} />

                    <Typography sx={{
                      fontFamily: WIZARD_MONO, fontSize: '0.52rem', letterSpacing: '0.08em',
                      color: wizardTheme.textDim, mt: 1.75, mb: 0.75,
                    }}>
                      PERFORMANCE
                    </Typography>
                    <WizardPerformancePreset
                      compact
                      onReadyChange={setPerformanceReady}
                    />
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
        <Box sx={{ width: '100%', maxWidth: 820, display: 'flex', justifyContent: step === 0 && !showRelayConfig ? 'flex-end' : step === 11 ? 'center' : 'space-between', alignItems: 'center' }}>
          {step === 1 && <Button onClick={handleBackFromProvider} sx={wizardBackBtnSx}>Back</Button>}
          {step === 2 && <Button onClick={back} sx={wizardBackBtnSx}>Back</Button>}
          {step === 3 && <Button onClick={back} sx={wizardBackBtnSx}>Back</Button>}
          {step === 4 && <Button onClick={back} sx={wizardBackBtnSx}>Back</Button>}
          {step === 5 && <Button onClick={handleBenchmarkBack} sx={wizardBackBtnSx}>Back</Button>}
          {step === 6 && <Button onClick={back} sx={wizardBackBtnSx}>Back</Button>}
          {step === 7 && <Button onClick={back} sx={wizardBackBtnSx}>Back</Button>}
          {step === 8 && <Button onClick={back} sx={wizardBackBtnSx}>Back</Button>}
          {step === 9 && <Button onClick={back} disabled={voiceBusy} sx={wizardBackBtnSx}>Back</Button>}
          {step === 10 && <Button onClick={back} sx={wizardBackBtnSx}>Back</Button>}
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
          {step === 6 && (
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', ml: 'auto' }}>
              {!neuralReady && (
                <Button onClick={next} sx={wizardSkipBtnSx}>
                  Skip for now
                </Button>
              )}
              <Button variant="contained" onClick={next} sx={wizardPrimaryBtnSx}>
                {neuralReady ? 'Next' : 'Skip →'}
              </Button>
            </Box>
          )}
          {step === 7 && <Button variant="contained" onClick={handleCallsignNext} disabled={!callsign.trim()} sx={wizardPrimaryBtnSx}>Next</Button>}
          {step === 8 && <Button variant="contained" onClick={next} disabled={!personaName.trim()} sx={wizardPrimaryBtnSx}>Next</Button>}
          {step === 9 && (
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', justifyContent: voiceCalibrated ? 'flex-end' : 'space-between', width: '100%' }}>
              {!voiceCalibrated && (
                <Button onClick={next} disabled={voiceBusy} sx={wizardSkipBtnSx}>
                  Skip for now
                </Button>
              )}
              <Button
                variant="contained"
                disabled={voiceBusy}
                onClick={() => {
                  void (async () => {
                    if (voiceCalibrated) {
                      try { await voice.releaseSidecar({ force: true }); } catch { /* idle unload best-effort */ }
                    }
                    next();
                  })();
                }}
                sx={wizardPrimaryBtnSx}
              >
                {voiceBusy ? 'Installing…' : voiceCalibrated ? 'Continue →' : 'Skip →'}
              </Button>
            </Box>
          )}
          {step === 10 && (
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
          {step === 11 && (
            <Button
              variant="contained"
              onClick={handleComplete}
              disabled={loading || !workspaceReady || !performanceReady}
              sx={{ ...wizardPrimaryBtnSx, px: 5, py: 1.2 }}
            >
              {loading ? 'Finalizing...' : 'Complete'}
            </Button>
          )}
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

      {loading && (
        <Box sx={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: colors.shadow.heavy, backdropFilter: 'blur(2px)' }}>
          <CircularProgress size={40} sx={{ color: colors.text.primary }} />
        </Box>
      )}
    </Box>
  );
}
