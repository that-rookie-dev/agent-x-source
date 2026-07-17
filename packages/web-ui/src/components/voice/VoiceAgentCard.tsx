import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Popover from '@mui/material/Popover';
import MenuItem from '@mui/material/MenuItem';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import PublicIcon from '@mui/icons-material/Public';
import ShieldIcon from '@mui/icons-material/Shield';
import { colors, alphaColor, MONO } from '../../theme';
import { useVoiceCommsSession } from '../../hooks/useVoiceCommsSession';
import { useVoiceOptional } from './VoiceProvider';
import { voiceDisabledReason } from '../../voice/support';
import { VoiceWaveform } from './VoiceWaveform';
import { CommsSpinner } from './CommsSpinner';
import type { ParticlePhase } from './VoiceParticleField';
import { voice as voiceApi, providers as providersApi, models as modelsApi } from '../../api';
import type { ConfiguredProvider, ModelInfo } from '../../api';
import { KOKORO_VOICE_PROFILES } from '../../voice/voice-config';

/**
 * Voice Agent card for the Bento dashboard — futuristic centerpiece.
 *
 * Uses a segregated voice-only session (__channel__:voice) with a lean prompt
 * profile. Features:
 *  - Particle physics canvas background (80+ particles, phase-reactive)
 *  - Circular mic button with phase-reactive glow
 *  - Toggle chips (web search, bypass) in card header — icon-only, circular
 *  - Provider/model profile dropdowns inside card (separate voice config)
 *  - No message listing, questionnaire, or deep web search UI
 */

type ButtonPhase = 'disabled' | 'idle' | 'recording' | 'thinking' | 'speaking';

export function VoiceAgentCard({
  onActiveChange,
  onPhaseChange,
  searchWeb,
  bypassChip,
}: {
  onActiveChange?: (active: boolean) => void;
  onPhaseChange?: (phase: ParticlePhase) => void;
  searchWeb: boolean;
  bypassChip: boolean;
}) {
  const voiceCtx = useVoiceOptional();
  const envBlocked = voiceDisabledReason();
  const [voiceActive, setVoiceActive] = useState(false);

  const sessionReady = Boolean(voiceCtx?.voiceReady) && !envBlocked;

  // Wire voice comms to a segregated voice-only session
  const comms = useVoiceCommsSession({
    active: voiceActive && sessionReady,
    voiceOnly: true,
    requestMicOnActivate: true,
  });

  // Retain/release the voice engine
  useEffect(() => {
    if (voiceActive && sessionReady) {
      voiceCtx?.retainVoiceEngine();
      return () => { voiceCtx?.releaseVoiceEngine(); };
    }
  }, [voiceActive, sessionReady, voiceCtx?.retainVoiceEngine, voiceCtx?.releaseVoiceEngine]);

  // Push toggle state to backend
  useEffect(() => {
    if (voiceActive && sessionReady) {
      comms.session.setToggles({ searchWeb, bypassChip });
    }
  }, [voiceActive, sessionReady, searchWeb, bypassChip, comms.session]);

  // Derive button phase
  const phase: ButtonPhase = useMemo(() => {
    if (!voiceActive || !sessionReady) return 'disabled';
    if (comms.commsPhase === 'operator_record') return 'recording';
    if (comms.commsPhase === 'agent_tx') return 'speaking';
    if (comms.commsPhase === 'operator_stt' || comms.commsPhase === 'relay_process' || comms.commsPhase === 'agent_prep') return 'thinking';
    if (comms.commsPhase === 'boot' || comms.commsPhase === 'link') return 'thinking';
    return 'idle';
  }, [voiceActive, sessionReady, comms.commsPhase]);

  const particlePhase: ParticlePhase = phase;

  const handleClick = () => {
    if (!sessionReady) return;
    setVoiceActive((prev) => !prev);
  };

  // Notify parent of active state changes (for connection pulses)
  useEffect(() => {
    onActiveChange?.(voiceActive && sessionReady);
  }, [voiceActive, sessionReady, onActiveChange]);

  // Notify parent of phase changes (for dashboard-wide particle field)
  useEffect(() => {
    onPhaseChange?.(particlePhase);
  }, [particlePhase, onPhaseChange]);

  const waveLevel = phase === 'recording'
    ? comms.session.audioLevel
    : phase === 'speaking'
      ? comms.session.playbackLevel
      : 0;

  const statusText = (() => {
    if (!voiceActive) return 'Click to activate';
    if (!sessionReady) return 'Voice kit required';
    if (phase === 'disabled') return 'Click to activate';
    if (phase === 'recording') return 'Listening… release Space';
    if (phase === 'thinking') return comms.statusLabel || 'Thinking…';
    if (phase === 'speaking') return 'Agent speaking';
    return 'Hold Space to speak';
  })();

  return (
    <Box sx={{
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 0.75,
      height: '100%',
      minHeight: 200,
      py: 1,
      overflow: 'hidden',
    }}>
      {/* Mic button + waveform overlay */}
      <Box sx={{ position: 'relative', zIndex: 2 }}>
        <Tooltip title={sessionReady ? (voiceActive ? 'Click to disable voice' : 'Click to enable voice') : 'Deploy voice kit first'}>
          <Box
            onClick={handleClick}
            sx={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: sessionReady ? 'pointer' : 'default',
              transition: 'all 0.25s ease',
              position: 'relative',
              border: `2px solid ${phaseColor(phase, true)}`,
              bgcolor: phase === 'disabled'
                ? alphaColor(colors.text.dim, '0a')
                : phase === 'idle'
                  ? alphaColor(colors.accent.blue, '14')
                  : phase === 'recording'
                    ? alphaColor(colors.accent.green, '1a')
                    : phase === 'speaking'
                      ? alphaColor(colors.accent.purple, '1a')
                      : alphaColor(colors.accent.orange, '14'),
              '&:hover': sessionReady && phase === 'idle' ? {
                borderColor: colors.accent.blue,
                transform: 'scale(1.05)',
                boxShadow: `0 0 20px ${alphaColor(colors.accent.blue, '44')}`,
              } : {},
              ...(phase === 'recording' && {
                animation: 'voicePulseRec 1.5s ease-in-out infinite',
                '@keyframes voicePulseRec': {
                  '0%, 100%': { boxShadow: `0 0 12px ${alphaColor(colors.accent.green, '44')}` },
                  '50%': { boxShadow: `0 0 28px ${alphaColor(colors.accent.green, '77')}` },
                },
              }),
              ...(phase === 'speaking' && {
                animation: 'voicePulseSpeak 1.2s ease-in-out infinite',
                '@keyframes voicePulseSpeak': {
                  '0%, 100%': { boxShadow: `0 0 12px ${alphaColor(colors.accent.purple, '44')}` },
                  '50%': { boxShadow: `0 0 28px ${alphaColor(colors.accent.purple, '77')}` },
                },
              }),
            }}
          >
            {phase === 'recording' || phase === 'speaking' ? (
              <Box sx={{ width: '100%', height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <VoiceWaveform
                  level={waveLevel}
                  active
                  accent={phase === 'recording' ? colors.accent.green : colors.accent.purple}
                  bars={12}
                  height={36}
                />
              </Box>
            ) : phase === 'thinking' ? (
              <CommsSpinner color={colors.accent.orange} size={28} />
            ) : phase === 'disabled' ? (
              <MicOffIcon sx={{ fontSize: 26, color: colors.text.dim, opacity: 0.5 }} />
            ) : (
              <MicIcon sx={{ fontSize: 26, color: colors.accent.blue }} />
            )}
          </Box>
        </Tooltip>
      </Box>

      <Typography sx={{
        fontSize: '0.6rem',
        fontFamily: MONO,
        color: phase === 'disabled'
          ? colors.text.dim
          : phase === 'recording'
            ? colors.accent.green
            : phase === 'speaking'
              ? colors.accent.purple
              : phase === 'thinking'
                ? colors.accent.orange
                : colors.text.secondary,
        textAlign: 'center',
        letterSpacing: '0.03em',
        transition: 'color 0.2s',
        zIndex: 2,
      }}>
        {statusText}
      </Typography>
    </Box>
  );
}

/** Circular icon-only toggle chip for the card header. */
export function VoiceToggleChip({
  icon,
  active,
  activeColor,
  onClick,
  title,
}: {
  icon: React.ReactNode;
  active: boolean;
  activeColor: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <Tooltip title={title}>
      <Box
        onClick={onClick}
        sx={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          border: `1px solid ${active ? alphaColor(activeColor, '66') : colors.border.default}`,
          bgcolor: active ? alphaColor(activeColor, '1a') : 'transparent',
          color: active ? activeColor : colors.text.dim,
          transition: 'all 0.2s',
          '&:hover': {
            borderColor: activeColor,
            color: activeColor,
            transform: 'scale(1.1)',
          },
        }}
      >
        {icon}
      </Box>
    </Tooltip>
  );
}

/** Exported so BentoDashboard can render toggles in the card header (right-aligned). */
export function VoiceAgentHeaderToggles({
  searchWeb,
  bypassChip,
  onSearchWebChange,
  onBypassChipChange,
}: {
  searchWeb: boolean;
  bypassChip: boolean;
  onSearchWebChange: (v: boolean) => void;
  onBypassChipChange: (v: boolean) => void;
}) {
  return (
    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
      <VoiceToggleChip
        icon={<PublicIcon sx={{ fontSize: 13 }} />}
        active={searchWeb}
        activeColor={colors.accent.blue}
        onClick={() => onSearchWebChange(!searchWeb)}
        title={searchWeb ? 'Web search enabled' : 'Enable web search'}
      />
      <VoiceToggleChip
        icon={<ShieldIcon sx={{ fontSize: 13 }} />}
        active={bypassChip}
        activeColor={colors.accent.orange}
        onClick={() => onBypassChipChange(!bypassChip)}
        title={bypassChip ? 'Bypass enabled — auto-approve tools' : 'Enable bypass — auto-approve tools'}
      />
    </Box>
  );
}

/**
 * Full header controls for the Voice Agent card: toggle chips + provider/model
 * selectors. Manages voice-specific provider/model config, falling back to the
 * current default provider/model when no voice-specific config is set.
 */
export function VoiceAgentHeaderControls({
  searchWeb,
  bypassChip,
  onSearchWebChange,
  onBypassChipChange,
}: {
  searchWeb: boolean;
  bypassChip: boolean;
  onSearchWebChange: (v: boolean) => void;
  onBypassChipChange: (v: boolean) => void;
}) {
  const [configuredProviders, setConfiguredProviders] = useState<ConfiguredProvider[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [voiceProvider, setVoiceProvider] = useState<string | null>(null);
  const [voiceModel, setVoiceModel] = useState<string | null>(null);
  const [voiceId, setVoiceId] = useState<string>('kokoro-af');
  const [defaultProvider, setDefaultProvider] = useState<string>('');
  const [defaultModel, setDefaultModel] = useState<string>('');
  const [providerAnchor, setProviderAnchor] = useState<HTMLElement | null>(null);
  const [modelAnchor, setModelAnchor] = useState<HTMLElement | null>(null);
  const [voiceAnchor, setVoiceAnchor] = useState<HTMLElement | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);

  // Load configured providers, current default, and voice config
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [configured, current] = await Promise.all([
          providersApi.configured(),
          modelsApi.current(),
        ]);
        if (cancelled) return;
        setConfiguredProviders(configured);
        setDefaultProvider(current.provider || '');
        setDefaultModel(current.model || '');
        // Load voice-specific config
        const voiceCfg = await voiceApi.getConfig();
        if (cancelled) return;
        if (voiceCfg.provider?.activeProvider) setVoiceProvider(voiceCfg.provider.activeProvider);
        if (voiceCfg.provider?.activeModel) setVoiceModel(voiceCfg.provider.activeModel);
        if (voiceCfg.tts?.voiceId) setVoiceId(voiceCfg.tts.voiceId);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load models when provider changes
  useEffect(() => {
    const providerId = voiceProvider || defaultProvider;
    if (!providerId) return;
    let cancelled = false;
    setLoadingModels(true);
    void (async () => {
      try {
        const m = await providersApi.models(providerId);
        if (!cancelled) setModels(m);
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoadingModels(false); }
    })();
    return () => { cancelled = true; };
  }, [voiceProvider, defaultProvider]);

  const handleProviderSelect = async (providerId: string) => {
    setVoiceProvider(providerId || null);
    setProviderAnchor(null);
    try {
      await voiceApi.updateConfig({ provider: { activeProvider: providerId || undefined } });
    } catch { /* ignore */ }
  };

  const handleModelSelect = async (modelId: string) => {
    setVoiceModel(modelId || null);
    setModelAnchor(null);
    try {
      await voiceApi.updateConfig({ provider: { activeModel: modelId || undefined } });
    } catch { /* ignore */ }
  };

  const handleVoiceSelect = async (vid: string) => {
    setVoiceId(vid);
    setVoiceAnchor(null);
    try {
      await voiceApi.updateConfig({ tts: { voiceId: vid } });
    } catch { /* ignore */ }
  };

  // Display the voice-specific provider, or fall back to the current default.
  // Show the profile name (activeProfile) rather than the provider name.
  const effectiveProvider = voiceProvider || defaultProvider;
  const effectiveModel = voiceModel || defaultModel;
  const matchedProvider = configuredProviders.find((p) => p.id === effectiveProvider);
  const profileLabel = matchedProvider?.activeProfile
    || matchedProvider?.name
    || effectiveProvider
    || '—';
  const modelLabel = effectiveModel ? effectiveModel.split('/').pop() || effectiveModel : '—';
  const voiceProfile = KOKORO_VOICE_PROFILES.find((p) => p.id === voiceId);
  const voiceLabel = voiceProfile?.name || voiceId;

  return (
    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
      <VoiceToggleChip
        icon={<PublicIcon sx={{ fontSize: 13 }} />}
        active={searchWeb}
        activeColor={colors.accent.blue}
        onClick={() => onSearchWebChange(!searchWeb)}
        title={searchWeb ? 'Web search enabled' : 'Enable web search'}
      />
      <VoiceToggleChip
        icon={<ShieldIcon sx={{ fontSize: 13 }} />}
        active={bypassChip}
        activeColor={colors.accent.orange}
        onClick={() => onBypassChipChange(!bypassChip)}
        title={bypassChip ? 'Bypass enabled — auto-approve tools' : 'Enable bypass — auto-approve tools'}
      />
      <ConfigChip
        label={profileLabel}
        onClick={(e) => setProviderAnchor(e.currentTarget)}
      />
      <ConfigChip
        label={modelLabel}
        onClick={(e) => setModelAnchor(e.currentTarget)}
      />
      <ConfigChip
        label={voiceLabel}
        onClick={(e) => setVoiceAnchor(e.currentTarget)}
      />

      {/* Provider dropdown — shows configured providers (saved profiles) */}
      <Popover
        open={Boolean(providerAnchor)}
        anchorEl={providerAnchor}
        onClose={() => setProviderAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 1 } }}
      >
        <Box sx={{ py: 0.5, minWidth: 160 }}>
          <MenuItem
            onClick={() => handleProviderSelect('')}
            selected={!voiceProvider}
            sx={{ fontSize: '0.65rem', fontFamily: MONO, color: colors.text.dim }}
          >
            <em>Use default ({defaultProvider || '—'})</em>
          </MenuItem>
          {configuredProviders.map((p) => (
            <MenuItem
              key={p.id}
              onClick={() => handleProviderSelect(p.id)}
              selected={p.id === voiceProvider}
              sx={{ fontSize: '0.65rem', fontFamily: MONO, color: colors.text.secondary }}
            >
              {p.name}{p.activeProfile ? ` · ${p.activeProfile}` : ''}
            </MenuItem>
          ))}
        </Box>
      </Popover>

      {/* Model dropdown */}
      <Popover
        open={Boolean(modelAnchor)}
        anchorEl={modelAnchor}
        onClose={() => setModelAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 1, maxHeight: 200, overflow: 'auto' } }}
      >
        <Box sx={{ py: 0.5, minWidth: 200 }}>
          {loadingModels ? (
            <MenuItem disabled sx={{ fontSize: '0.65rem', fontFamily: MONO, color: colors.text.dim }}>
              Loading models…
            </MenuItem>
          ) : (
            <>
              <MenuItem
                onClick={() => handleModelSelect('')}
                selected={!voiceModel}
                sx={{ fontSize: '0.65rem', fontFamily: MONO, color: colors.text.dim }}
              >
                <em>Use default ({defaultModel ? defaultModel.split('/').pop() : '—'})</em>
              </MenuItem>
              {models.map((m) => (
                <MenuItem
                  key={m.id}
                  onClick={() => handleModelSelect(m.id)}
                  selected={m.id === voiceModel}
                  sx={{ fontSize: '0.65rem', fontFamily: MONO, color: colors.text.secondary }}
                >
                  {m.name || m.id}
                </MenuItem>
              ))}
            </>
          )}
        </Box>
      </Popover>

      {/* Voice profile dropdown — Kokoro TTS voices grouped by language */}
      <Popover
        open={Boolean(voiceAnchor)}
        anchorEl={voiceAnchor}
        onClose={() => setVoiceAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { bgcolor: colors.bg.secondary, border: `1px solid ${colors.border.default}`, borderRadius: 1, maxHeight: 280, overflow: 'auto' } }}
      >
        <Box sx={{ py: 0.5, minWidth: 180 }}>
          {Array.from(new Set(KOKORO_VOICE_PROFILES.map((p) => p.language))).map((language) => (
            <Box key={language}>
              <Typography sx={{ fontSize: '0.5rem', fontFamily: MONO, color: colors.text.dim, px: 1, pt: 0.5, pb: 0.25, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {language}
              </Typography>
              {KOKORO_VOICE_PROFILES.filter((p) => p.language === language).map((p) => (
                <MenuItem
                  key={p.id}
                  onClick={() => handleVoiceSelect(p.id)}
                  selected={p.id === voiceId}
                  sx={{ fontSize: '0.6rem', fontFamily: MONO, color: colors.text.secondary, minHeight: 'auto', py: 0.25 }}
                >
                  {p.name} <span style={{ color: colors.text.dim, marginLeft: 4 }}>({p.gender})</span>
                </MenuItem>
              ))}
            </Box>
          ))}
        </Box>
      </Popover>
    </Box>
  );
}

/** Capsule-shaped chip (same height as VoiceToggleChip) with label only, opens dropdown on click. */
function ConfigChip({ label, onClick }: { label: string; onClick: (e: React.MouseEvent<HTMLElement>) => void }) {
  return (
    <Box
      onClick={onClick}
      sx={{
        height: 22,
        display: 'flex',
        alignItems: 'center',
        px: 0.75,
        borderRadius: '11px',
        cursor: 'pointer',
        border: `1px solid ${colors.border.subtle}`,
        bgcolor: alphaColor(colors.bg.primary, '80'),
        color: colors.text.dim,
        transition: 'all 0.15s',
        maxWidth: 120,
        '&:hover': {
          borderColor: colors.border.accent,
          color: colors.text.secondary,
        },
      }}
    >
      <Typography sx={{ fontSize: '0.5rem', fontFamily: MONO, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </Typography>
    </Box>
  );
}

function phaseColor(phase: ButtonPhase, border: boolean): string {
  switch (phase) {
    case 'disabled': return colors.border.default;
    case 'idle': return border ? alphaColor(colors.accent.blue, '66') : colors.accent.blue;
    case 'recording': return border ? alphaColor(colors.accent.green, '66') : colors.accent.green;
    case 'thinking': return border ? alphaColor(colors.accent.orange, '66') : colors.accent.orange;
    case 'speaking': return border ? alphaColor(colors.accent.purple, '66') : colors.accent.purple;
  }
}
