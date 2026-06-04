import { type FC, useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { COLORS } from '../theme/colors.js';
import { ScrollableList } from '../components/ScrollableList.js';
import { LoadingIndicator } from '../components/LoadingIndicator.js';
import {
  StageCard,
  BootTransition,
  SplashScreen,
  LaunchSequence,
} from '../components/wizard/index.js';
import {
  PROVIDERS,
  PROVIDER_IDS,
  type ProviderId,
  type ModelInfo,
  type AgentXConfig,
  getLogger,
} from '@agentx/shared';
import { ConfigManager, ProviderFactory } from '@agentx/engine';

// ─── Types ───────────────────────────────────────────────────────────

type MissionStep =
  | 'splash'
  | 'stage1_provider'
  | 'stage1_credentials'
  | 'stage1_validating'
  | 'stage1_models'
  | 'transition_1'
  | 'stage2_callsign'
  | 'launch_sequence';

interface MissionControlProps {
  onComplete: (config: AgentXConfig) => void;
  onCancel: () => void;
  dek?: Buffer | null;
}

// ─── Provider Descriptions ───────────────────────────────────────────

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  openai: 'OpenAI • Cloud',
  anthropic: 'Anthropic • Cloud',
  google: 'Google AI • Cloud',
  ollama: 'Local • Private',
  lmstudio: 'Local • Private',
};

// ─── Main Component ──────────────────────────────────────────────────

export const MissionControl: FC<MissionControlProps> = ({ onComplete, onCancel, dek }) => {
  const { exit } = useApp();
  const [step, setStep] = useState<MissionStep>('splash');
  const TRACE = process.env.AGENTX_TRACE === '1' || process.env.AGENTX_TRACE === 'true';

  // Stage 1 state
  const [selectedProvider, setSelectedProvider] = useState<ProviderId | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Stage 2 state
  const [callsign, setCallsign] = useState('');

  // ─── Stage 1: Validation Effect ─────────────────────────────────────

  useEffect(() => {
    if (step !== 'stage1_validating' || !selectedProvider) return;

    const validate = async () => {
      if (TRACE) console.log(`[TRACE] MissionControl validate start step=${step} provider=${selectedProvider} apiKeySet=${!!apiKey} baseUrl=${baseUrl} ts=${Date.now()}`);
      try {
        const provider = ProviderFactory.create(
          selectedProvider,
          apiKey || undefined,
          baseUrl || undefined,
        );
        const valid = await provider.validate();
        if (!valid) {
          setError('🔐 Clearance Denied — Could not authenticate. Check your credentials.');
          setStep('stage1_credentials');
          return;
        }
        // Fetch models
        const fetchedModels = await provider.listModels();
        if (fetchedModels.length === 0) {
          setError('🏚 Hangar Empty — No models found. Check your key permissions.');
          setStep('stage1_credentials');
          return;
        }
        if (TRACE) console.log(`[TRACE] MissionControl validate success models=${fetchedModels.length} ts=${Date.now()}`);
        setModels(fetchedModels);
        setStep('stage1_models');
      } catch (e) {
        if (TRACE) console.log(`[TRACE] MissionControl validate error ${String(e)} ts=${Date.now()}`);
        getLogger().error('MISSION_VALIDATION', e);
        setError('⚠ Connection failed — Check your network or credentials.');
        setStep('stage1_credentials');
      }
    };

    void validate();
  }, [step, selectedProvider, apiKey, baseUrl]);

  // ─── Handlers ────────────────────────────────────────────────────────

  const handleProviderSelect = useCallback((providerId: string) => {
    const id = providerId as ProviderId;
    setSelectedProvider(id);
    setError(null);
    const provider = PROVIDERS[id];
    if (provider?.apiKeyRequired) {
      setStep('stage1_credentials');
    } else if (provider?.baseUrlConfigurable) {
      setBaseUrl(provider.defaultBaseUrl ?? '');
      setStep('stage1_credentials');
    } else {
      setStep('stage1_validating');
    }
  }, []);

  const handleCredentialsSubmit = useCallback(() => {
    const provider = selectedProvider ? PROVIDERS[selectedProvider] : undefined;
    if (provider?.apiKeyRequired && !apiKey.trim()) {
      setError('API key is required');
      return;
    }
    setError(null);
    setStep('stage1_validating');
  }, [selectedProvider, apiKey]);

  const handleModelSelect = useCallback((model: ModelInfo) => {
    // Save config immediately (so partial completion doesn't brick the app)
    if (TRACE) console.log(`[TRACE] MissionControl handleModelSelect provider=${selectedProvider} model=${model.id} apiKeySet=${!!apiKey} baseUrl=${baseUrl} ts=${Date.now()}`);
    if (!selectedProvider) return;
    const config: AgentXConfig = {
      provider: {
        activeProvider: selectedProvider,
        activeModel: model.id,
        providers: {
          [selectedProvider]: {
            apiKey: apiKey || undefined,
            baseUrl: baseUrl || undefined,
            configured: true,
          },
        },
      },
      ui: { theme: 'dark', showTokenBar: true, showTimers: true, animationSpeed: 'normal' },
      organization: null,
      telemetry: false,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    const cm = new ConfigManager();
    if (dek) {
      cm.setDEK(dek);
    }
    cm.ensureDirectories();
    cm.save(config);
    setStep('transition_1');
  }, [selectedProvider, apiKey, baseUrl, dek]);

  // No crew creation in setup — crews are optional, created via /crew command or Web-UI

  const handleCallsignSubmit = useCallback(() => {
    setStep('launch_sequence');
  }, []);

  const handleCallsignSkip = useCallback(() => {
    setStep('launch_sequence');
  }, []);

  const handleLaunchComplete = useCallback(() => {
    // Mark setup as complete
    const cm = new ConfigManager();
    if (dek) cm.setDEK(dek);
    const config = cm.load();
    config.setupComplete = true;
    cm.save(config);
    onComplete(config);
  }, [onComplete, dek]);

  // ─── Global key handler for Escape (back navigation) ─────────────────

  useInput((_input, key) => {
    if (!key.escape) return;
    if (TRACE) console.log(`[TRACE] MissionControl global ESC pressed step=${step} ts=${Date.now()}`);

    switch (step) {
      case 'splash':
        onCancel();
        exit();
        break;
      case 'stage1_credentials':
        setError(null);
        setStep('stage1_provider');
        break;
      case 'stage1_models':
        setStep('stage1_credentials');
        break;
      case 'stage2_callsign':
        break;
      default:
        break;
    }
  }, {
    isActive: step !== 'stage1_provider' && step !== 'stage1_models'
      && !step.startsWith('transition') && step !== 'launch_sequence' && step !== 'stage1_validating',
  });

  // ─── Tab handler for skipping callsign ────────────────────────────────

  useInput((input) => {
    if (input === '\t' && step === 'stage2_callsign') {
      if (TRACE) console.log(`[TRACE] MissionControl TAB pressed at step=${step} ts=${Date.now()}`);
      handleCallsignSkip();
    }
  }, { isActive: step === 'stage2_callsign' });

  // ─── Render Logic ─────────────────────────────────────────────────────

  // Splash
  if (step === 'splash') {
    return (
      <StageCard showProgress={false} currentStage={0}>
        <SplashScreen onStart={() => setStep('stage1_provider')} onExit={() => { onCancel(); exit(); }} />
      </StageCard>
    );
  }

  // Transitions
  if (step === 'transition_1') {
    return (
      <StageCard stageNumber={1} stageLabel="NEURAL CORE" currentStage={1}>
        <BootTransition label="NEURAL CORE — ONLINE" onComplete={() => setStep('stage2_callsign')} />
      </StageCard>
    );
  }

  // Launch sequence
  if (step === 'launch_sequence') {
    return (
      <StageCard showProgress={false} currentStage={3}>
        <LaunchSequence callsign={callsign} onComplete={handleLaunchComplete} />
      </StageCard>
    );
  }

  // ─── Stage 1: Neural Core ──────────────────────────────────────────────

  if (step === 'stage1_provider') {
    return (
      <StageCard stageNumber={1} stageLabel="NEURAL CORE" currentStage={1}>
        <Box marginBottom={1}>
          <Text color={COLORS.text}>Select your AI engine:</Text>
        </Box>
        <ScrollableList
          items={PROVIDER_IDS}
          onSelect={handleProviderSelect}
          onCancel={() => setStep('splash')}
          renderItem={(id, isSelected) => {
            const p = PROVIDERS[id];
            return (
              <Box>
                <Text color={isSelected ? COLORS.text : COLORS.textDim} bold={isSelected}>
                  {p?.name ?? id}
                </Text>
                <Text color={COLORS.textDim} dimColor>
                  {' — '}{PROVIDER_DESCRIPTIONS[id] ?? p?.type ?? ''}
                </Text>
              </Box>
            );
          }}
        />
      </StageCard>
    );
  }

  if (step === 'stage1_credentials') {
    const provider = selectedProvider ? PROVIDERS[selectedProvider] : undefined;
    const isApiKey = provider?.apiKeyRequired ?? false;

    return (
      <StageCard stageNumber={1} stageLabel="NEURAL CORE" currentStage={1}>
        {error && (
          <Box marginBottom={1}>
            <Text color={COLORS.error}>⚠ {error}</Text>
          </Box>
        )}
        <Box marginBottom={1}>
          <Text color={COLORS.text}>
            {isApiKey
              ? `🔐 Enter your ${provider?.name ?? ''} clearance key:`
              : `🔗 Base URL ${provider?.defaultBaseUrl ? `(default: ${provider.defaultBaseUrl})` : ''}:`}
          </Text>
        </Box>
        <Box>
          <Text color={COLORS.primary}>❯ </Text>
          {isApiKey ? (
            <TextInput
              value={apiKey}
              onChange={(v) => { setApiKey(v); setError(null); }}
              placeholder="sk-..."
              mask="*"
              onSubmit={handleCredentialsSubmit}
            />
          ) : (
            <TextInput
              value={baseUrl}
              onChange={(v) => { setBaseUrl(v); setError(null); }}
              placeholder={provider?.defaultBaseUrl ?? 'http://localhost:...'}
              onSubmit={handleCredentialsSubmit}
            />
          )}
        </Box>
        <Box marginTop={1}>
          <Text color={COLORS.textDim} italic>
            {isApiKey
              ? 'Stored locally at ~/.config/agentx/ • Never transmitted elsewhere.'
              : 'Press Enter to use the default value.'}
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color={COLORS.textDim} dimColor>⏎ Submit  •  Esc Back</Text>
        </Box>
      </StageCard>
    );
  }

  if (step === 'stage1_validating') {
    return (
      <StageCard stageNumber={1} stageLabel="NEURAL CORE" currentStage={1}>
        <Box flexDirection="column" alignItems="center">
          <LoadingIndicator label="Establishing neural link..." />
          <Box marginTop={1}>
            <Text color={COLORS.textDim} italic>Scanning available models...</Text>
          </Box>
        </Box>
      </StageCard>
    );
  }

  if (step === 'stage1_models') {
    return (
      <StageCard stageNumber={1} stageLabel="NEURAL CORE" currentStage={1}>
        <Box marginBottom={1}>
          <Text color={COLORS.text}>Choose your primary model:</Text>
        </Box>
        <ScrollableList
          items={models}
          onSelect={handleModelSelect}
          onCancel={() => setStep('stage1_credentials')}
          renderItem={(model, isSelected) => (
            <Box>
              <Text color={isSelected ? COLORS.text : COLORS.textDim} bold={isSelected}>
                {model.id}
              </Text>
              {model.contextWindow > 0 && (
                <Text color={COLORS.textDim} dimColor>
                  {' '}{Math.round(model.contextWindow / 1024)}K ctx
                </Text>
              )}
            </Box>
          )}
        />
      </StageCard>
    );
  }

  // ─── Stage 2: Callsign ────────────────────────────────────────────────

  if (step === 'stage2_callsign') {
    return (
      <StageCard stageNumber={2} stageLabel="IDENTITY" currentStage={2}>
        <Box marginBottom={1}>
          <Text color={COLORS.text}>🪪 Your Callsign</Text>
        </Box>
        <Box marginBottom={1}>
          <Text color={COLORS.textDim}>
            How should Agent-X address you? Optional — can be set later.
          </Text>
        </Box>
        <Box>
          <Text color={COLORS.primary}>❯ </Text>
          <TextInput
            value={callsign}
            onChange={(v) => { setCallsign(v); setError(null); }}
            placeholder="e.g. Commander"
            onSubmit={handleCallsignSubmit}
          />
        </Box>
        <Box marginTop={1}>
          <Text color={COLORS.textDim} dimColor>⏎ Submit  •  Tab Skip for now</Text>
        </Box>
      </StageCard>
    );
  }

  // Fallback (should never reach)
  return null;
};

// Crew creation moved to /crew command and Web-UI — setup no longer creates crews
