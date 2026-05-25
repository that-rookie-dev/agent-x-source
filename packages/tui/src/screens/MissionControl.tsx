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
import { useTypewriter } from '../animations/index.js';
import {
  PROVIDERS,
  PROVIDER_IDS,
  type ProviderId,
  type ModelInfo,
  type AgentXConfig,
  type Profile,
  type ProfileEmotion,
  getLogger,
} from '@agentx/shared';
import { ConfigManager, ProviderFactory, ProfileManager, TelegramStore } from '@agentx/engine';

// ─── Types ───────────────────────────────────────────────────────────

type MissionStep =
  | 'splash'
  | 'stage1_provider'
  | 'stage1_credentials'
  | 'stage1_validating'
  | 'stage1_models'
  | 'transition_1'
  | 'stage2_callsign'
  | 'stage2_briefing'
  | 'stage2_name'
  | 'stage2_prompt'
  | 'stage2_tone'
  | 'transition_2'
  | 'stage3_telegram'
  | 'transition_3'
  | 'launch_sequence';

interface MissionControlProps {
  onComplete: (config: AgentXConfig, profile: Profile) => void;
  onCancel: () => void;
}

// ─── Tone Options ────────────────────────────────────────────────────

const TONE_OPTIONS: Array<{ id: ProfileEmotion; label: string; desc: string }> = [
  { id: 'professional', label: '💼 Professional', desc: 'Precise, formal, business-like' },
  { id: 'friendly', label: '😊 Friendly', desc: 'Warm, approachable, casual' },
  { id: 'witty', label: '🧠 Witty', desc: 'Clever, sharp, dry humor' },
  { id: 'funny', label: '😂 Funny', desc: 'Humorous, entertaining, jokes' },
  { id: 'kind', label: '💛 Kind', desc: 'Gentle, empathetic, supportive' },
  { id: 'sarcastic', label: '😏 Sarcastic', desc: 'Dry, ironic, deadpan' },
  { id: 'flirty', label: '😘 Flirty', desc: 'Playful, charming, teasing' },
  { id: 'arrogant', label: '👑 Arrogant', desc: 'Supremely confident, show-off' },
  { id: 'happy', label: '🌟 Happy', desc: 'Enthusiastic, upbeat, energetic' },
  { id: 'sad', label: '🌧 Melancholic', desc: 'Thoughtful, reflective, poetic' },
];

// ─── Provider Descriptions ───────────────────────────────────────────

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  openai: 'GPT-4o, o1, o3',
  anthropic: 'Claude 4, Sonnet',
  google: 'Gemini 2.5 Pro/Flash',
  ollama: 'Local models • Private',
  lmstudio: 'Local models • Private',
};

// ─── Main Component ──────────────────────────────────────────────────

export const MissionControl: FC<MissionControlProps> = ({ onComplete, onCancel }) => {
  const { exit } = useApp();
  const [step, setStep] = useState<MissionStep>('splash');

  // Stage 1 state
  const [selectedProvider, setSelectedProvider] = useState<ProviderId | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Stage 2 state
  const [callsign, setCallsign] = useState('');
  const [profileName, setProfileName] = useState('');
  const [profilePrompt, setProfilePrompt] = useState('');

  // Stage 3 state
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramConfigured, setTelegramConfigured] = useState(false);

  // ─── Stage 1: Validation Effect ─────────────────────────────────────

  useEffect(() => {
    if (step !== 'stage1_validating' || !selectedProvider) return;

    const validate = async () => {
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
        setModels(fetchedModels);
        setStep('stage1_models');
      } catch (e) {
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
    cm.ensureDirectories();
    cm.save(config);
    setStep('transition_1');
  }, [selectedProvider, apiKey, baseUrl]);

  const handleCallsignSubmit = useCallback(() => {
    if (!callsign.trim()) return;
    setStep('stage2_briefing');
  }, [callsign]);

  const handleProfileNameSubmit = useCallback(() => {
    if (!profileName.trim()) return;
    setStep('stage2_prompt');
  }, [profileName]);

  const handleProfilePromptSubmit = useCallback(() => {
    if (!profilePrompt.trim()) return;
    setStep('stage2_tone');
  }, [profilePrompt]);

  const handleToneSelect = useCallback((tone: { id: ProfileEmotion }) => {
    // Create profile and save callsign to config
    const pm = new ProfileManager();
    const id = profileName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    pm.create({ id, name: profileName.trim(), systemPrompt: profilePrompt.trim(), emotion: tone.id, isDefault: false });
    pm.switch(id);

    // Update config with callsign
    const cm = new ConfigManager();
    try {
      const existingConfig = cm.load();
      existingConfig.user = { callsign: callsign.trim() };
      cm.save(existingConfig);
    } catch { /* config will be re-saved at completion anyway */ }

    setStep('transition_2');
  }, [profileName, profilePrompt, callsign]);

  const handleTelegramSubmit = useCallback(() => {
    const token = telegramToken.trim();
    if (!token) {
      // Skip
      setTelegramConfigured(false);
      setStep('transition_3');
      return;
    }
    // Basic format validation
    if (!token.includes(':')) {
      setError('Token format: 123456789:ABC-xyz...');
      return;
    }
    setError(null);
    const store = new TelegramStore();
    store.save({ botToken: token });
    setTelegramConfigured(true);
    setStep('transition_3');
  }, [telegramToken]);

  const handleTelegramSkip = useCallback(() => {
    setTelegramConfigured(false);
    setStep('transition_3');
  }, []);

  const handleLaunchComplete = useCallback(() => {
    // Load final state and emit
    const cm = new ConfigManager();
    const pm = new ProfileManager();
    const config = cm.load();
    const profile = pm.getActive();
    onComplete(config, profile);
  }, [onComplete]);

  // ─── Global key handler for Escape (back navigation) ─────────────────

  useInput((_input, key) => {
    if (!key.escape) return;

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
        // Can't go back past stage boundary once config saved
        break;
      case 'stage2_briefing':
        setStep('stage2_callsign');
        break;
      case 'stage2_name':
        setStep('stage2_briefing');
        break;
      case 'stage2_prompt':
        setStep('stage2_name');
        break;
      case 'stage3_telegram':
        // Can't go back past stage boundary
        break;
      default:
        break;
    }
  }, {
    isActive: step !== 'stage1_provider' && step !== 'stage1_models' && step !== 'stage2_tone'
      && !step.startsWith('transition') && step !== 'launch_sequence' && step !== 'stage1_validating',
  });

  // ─── Tab handler for skipping telegram ────────────────────────────────

  useInput((input) => {
    if (input === '\t' && step === 'stage3_telegram') {
      handleTelegramSkip();
    }
  }, { isActive: step === 'stage3_telegram' });

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
  if (step === 'transition_2') {
    return (
      <StageCard stageNumber={2} stageLabel="MISSION PROFILE" currentStage={2}>
        <BootTransition label={`CREW MEMBER "${profileName.toUpperCase()}" — REGISTERED`} onComplete={() => setStep('stage3_telegram')} />
      </StageCard>
    );
  }
  if (step === 'transition_3') {
    return (
      <StageCard stageNumber={3} stageLabel="COMMS ARRAY" currentStage={3}>
        <BootTransition
          label={telegramConfigured ? 'COMMS ARRAY — LINKED' : 'COMMS ARRAY — SKIPPED'}
          onComplete={() => setStep('launch_sequence')}
        />
      </StageCard>
    );
  }

  // Launch sequence
  if (step === 'launch_sequence') {
    return (
      <StageCard showProgress={false} currentStage={4}>
        <LaunchSequence profileName={profileName} telegramConfigured={telegramConfigured} onComplete={handleLaunchComplete} />
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

  // ─── Stage 2: Mission Profile ──────────────────────────────────────────

  if (step === 'stage2_callsign') {
    return (
      <StageCard stageNumber={2} stageLabel="MISSION PROFILE" currentStage={2}>
        <Box marginBottom={1}>
          <Text color={COLORS.text}>What should I call you, Commander?</Text>
        </Box>
        <Box>
          <Text color={COLORS.primary}>❯ </Text>
          <TextInput
            value={callsign}
            onChange={setCallsign}
            placeholder="e.g. Alex, Captain, Boss"
            onSubmit={handleCallsignSubmit}
          />
        </Box>
        <Box marginTop={1}>
          <Text color={COLORS.textDim} italic>This is how Agent-X will address you.</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={COLORS.textDim} dimColor>⏎ Submit</Text>
        </Box>
      </StageCard>
    );
  }

  if (step === 'stage2_briefing') {
    return (
      <Stage2Briefing onContinue={() => setStep('stage2_name')} />
    );
  }

  if (step === 'stage2_name') {
    return (
      <StageCard stageNumber={2} stageLabel="MISSION PROFILE" currentStage={2}>
        <Box marginBottom={1}>
          <Text color={COLORS.text}>Name your first crew member:</Text>
        </Box>
        <Box>
          <Text color={COLORS.primary}>❯ </Text>
          <TextInput
            value={profileName}
            onChange={setProfileName}
            placeholder="e.g. Nova, Atlas, Jarvis"
            onSubmit={handleProfileNameSubmit}
          />
        </Box>
        <Box marginTop={1}>
          <Text color={COLORS.textDim} italic>
            This is the agent's callsign. You'll switch between agents by name.
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color={COLORS.textDim} dimColor>⏎ Submit  •  Esc Back</Text>
        </Box>
      </StageCard>
    );
  }

  if (step === 'stage2_prompt') {
    return (
      <StageCard stageNumber={2} stageLabel="MISSION PROFILE" currentStage={2}>
        <Box marginBottom={1}>
          <Text color={COLORS.text}>What is </Text>
          <Text color={COLORS.primary} bold>{profileName}</Text>
          <Text color={COLORS.text}>'s specialization?</Text>
        </Box>
        <Box>
          <Text color={COLORS.primary}>❯ </Text>
          <TextInput
            value={profilePrompt}
            onChange={setProfilePrompt}
            placeholder="e.g. A senior full-stack engineer who..."
            onSubmit={handleProfilePromptSubmit}
          />
        </Box>
        <Box marginTop={1}>
          <Text color={COLORS.textDim} italic>
            Describe their role, expertise, and any instructions.
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color={COLORS.textDim} dimColor>⏎ Submit  •  Esc Back</Text>
        </Box>
      </StageCard>
    );
  }

  if (step === 'stage2_tone') {
    return (
      <StageCard stageNumber={2} stageLabel="MISSION PROFILE" currentStage={2}>
        <Box marginBottom={1}>
          <Text color={COLORS.text}>Choose </Text>
          <Text color={COLORS.primary} bold>{profileName}</Text>
          <Text color={COLORS.text}>'s communication style:</Text>
        </Box>
        <ScrollableList
          items={TONE_OPTIONS}
          onSelect={handleToneSelect}
          onCancel={() => setStep('stage2_prompt')}
          renderItem={(tone, isSelected) => (
            <Box>
              <Text color={isSelected ? COLORS.primary : COLORS.text} bold={isSelected}>
                {tone.label}
              </Text>
              <Text color={COLORS.textDim} dimColor> — {tone.desc}</Text>
            </Box>
          )}
        />
      </StageCard>
    );
  }

  // ─── Stage 3: Comms Array ──────────────────────────────────────────────

  if (step === 'stage3_telegram') {
    return (
      <StageCard stageNumber={3} stageLabel="COMMS ARRAY" currentStage={3}>
        <Box marginBottom={1}>
          <Text color={COLORS.text}>📡 Connect a communication channel</Text>
        </Box>
        <Box marginBottom={1}>
          <Text color={COLORS.textDim}>
            Telegram lets you talk to Agent-X from your phone — anywhere, anytime.
          </Text>
        </Box>
        <Box flexDirection="column" marginBottom={1} paddingX={1} borderStyle="single" borderColor={COLORS.border}>
          <Text color={COLORS.text}>1. Open <Text color={COLORS.accent}>@BotFather</Text> on Telegram</Text>
          <Text color={COLORS.text}>2. Send /newbot and follow prompts</Text>
          <Text color={COLORS.text}>3. Paste the bot token below</Text>
        </Box>
        {error && (
          <Box marginBottom={1}>
            <Text color={COLORS.error}>⚠ {error}</Text>
          </Box>
        )}
        <Box>
          <Text color={COLORS.primary}>❯ </Text>
          <TextInput
            value={telegramToken}
            onChange={(v) => { setTelegramToken(v); setError(null); }}
            placeholder="123456789:ABC-DEFghIjkl..."
            mask="*"
            onSubmit={handleTelegramSubmit}
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

// ─── Sub-component: Stage 2 Briefing ─────────────────────────────────────

interface Stage2BriefingProps {
  onContinue: () => void;
}

const BRIEFING_TEXT = `Profiles are your AI crew members.

Each profile is a sub-agent with its own
personality, expertise, and communication style.

You can create multiple profiles later:`;

const Stage2Briefing: FC<Stage2BriefingProps> = ({ onContinue }) => {
  const revealed = useTypewriter(BRIEFING_TEXT, 25);
  const [ready, setReady] = useState(false);
  const [blink, setBlink] = useState(true);

  useEffect(() => {
    if (revealed.length >= BRIEFING_TEXT.length) {
      setReady(true);
    }
  }, [revealed]);

  useEffect(() => {
    if (!ready) return;
    const interval = setInterval(() => setBlink((b) => !b), 800);
    return () => clearInterval(interval);
  }, [ready]);

  useInput((_input, key) => {
    if (key.return && ready) {
      onContinue();
    }
  });

  return (
    <StageCard stageNumber={2} stageLabel="MISSION PROFILE" currentStage={2}>
      <Box flexDirection="column">
        <Text color={COLORS.text}>{revealed}</Text>
        {ready && (
          <>
            <Box marginTop={1} paddingX={1}>
              <Text color={COLORS.accent}>"Nova"  </Text>
              <Text color={COLORS.textDim}>— Your coding specialist</Text>
            </Box>
            <Box paddingX={1}>
              <Text color={COLORS.accent}>"Atlas" </Text>
              <Text color={COLORS.textDim}>— Research & analysis</Text>
            </Box>
            <Box paddingX={1}>
              <Text color={COLORS.accent}>"Pulse" </Text>
              <Text color={COLORS.textDim}>— Creative writing</Text>
            </Box>
            <Box marginTop={1}>
              <Text color={COLORS.text}>Let's create your first crew member.</Text>
            </Box>
            <Box marginTop={1}>
              <Text color={blink ? COLORS.textDim : COLORS.border}>Press ENTER to continue</Text>
            </Box>
          </>
        )}
      </Box>
    </StageCard>
  );
};
