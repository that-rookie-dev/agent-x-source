import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import FormControlLabel from '@mui/material/FormControlLabel';
import LinearProgress from '@mui/material/LinearProgress';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MicIcon from '@mui/icons-material/Mic';
import { voice, type VoiceCapabilityStatus, type VoiceConfig, type VoiceSetupStatus } from '../../api';
import {
  applyVoicePreset,
  isVoiceKitReady,
  KOKORO_VOICE_PROFILES,
  mergeVoiceConfig,
  VOICE_DEPLOY_STEPS,
} from '../../voice/voice-config';
import { randomTestLine } from '../../voice/test-lines';
import { VOICE_WARMUP_MIN_RAM_GB } from '@agentx/shared/browser';
import { markVoiceOutputUnlocked } from '../../voice/support';
import { useVoiceWarmupSupported, useSystemCapabilities, useCapabilitiesReady } from '../../hooks/useSystemCapabilities';
import {
  useAllVoiceAssetDownloads,
} from '../../hooks/useVoiceAssetDownloads';
import {
  settingsBtnGhostSx,
  settingsBtnPrimarySx,
  settingsHelperSx,
  settingsMonoSx,
  settingsOverlineSx,
  settingsStatusBadgeSx,
  settingsTheme,
} from '../../styles/settings-theme';
import { SettingsCard } from './SettingsCard';
import { SettingsSectionHeader } from './SettingsSectionHeader';
import { TtsModelRow } from './TtsModelRow';
import { VoiceMicTestPanel } from '../VoiceMicTestPanel';
import { useVoiceOptional } from '../voice/VoiceProvider';

import { colors, alphaColor } from '../../theme';
export { mergeVoiceConfig } from '../../voice/voice-config';

interface VoiceTabProps {
  value?: VoiceConfig;
  onChange: (voiceConfig: VoiceConfig) => void;
}

function voiceSysStatus(
  loading: boolean,
  kitReady: boolean,
  deploying: boolean,
  capabilities: VoiceCapabilityStatus | null,
  engine: string,
): { label: string; state: 'active' | 'idle' | 'warn' } {
  if (loading) return { label: 'CHECKING', state: 'idle' };
  if (deploying) return { label: 'CALIBRATING', state: 'warn' };
  if (engine === 'realtime_xai') {
    return capabilities?.realtimeXai?.configured ? { label: 'ONLINE', state: 'active' } : { label: 'SETUP', state: 'warn' };
  }
  if (!capabilities?.pythonAvailable || !capabilities?.ffmpegAvailable) return { label: 'OFFLINE', state: 'idle' };
  if (!kitReady) return { label: 'SETUP', state: 'warn' };
  return { label: 'ONLINE', state: 'active' };
}

function deployPhaseLabel(phase: VoiceSetupStatus['phase']): string {
  switch (phase) {
    case 'runtime': return 'ENGINE';
    case 'download': return 'DOWNLOAD';
    case 'complete': return 'READY';
    case 'error': return 'FAILED';
    default: return 'STANDBY';
  }
}

export function VoiceTab({ value, onChange }: VoiceTabProps) {
  const voiceConfig = useMemo(() => mergeVoiceConfig(value), [value]);
  const engine = voiceConfig.engine ?? 'stt_llm_tts';
  const [capabilities, setCapabilities] = useState<VoiceCapabilityStatus | null>(null);
  const [installedAssetIds, setInstalledAssetIds] = useState<Set<string>>(new Set());
  const [deploying, setDeploying] = useState(false);
  const [deployStatus, setDeployStatus] = useState<VoiceSetupStatus | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [lastTestLine, setLastTestLine] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [xaiApiKeyInput, setXaiApiKeyInput] = useState('');
  const [xaiVoices, setXaiVoices] = useState<Array<{ id: string; name: string; language?: string }>>([]);
  const [xaiValidating, setXaiValidating] = useState(false);
  const [xaiStatus, setXaiStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');
  const [xaiModel, setXaiModel] = useState(voiceConfig.xai?.model ?? 'grok-voice-latest');

  useEffect(() => {
    setXaiModel(voiceConfig.xai?.model ?? 'grok-voice-latest');
  }, [voiceConfig.xai?.model]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceWarmupSupported = useVoiceWarmupSupported();
  const systemCaps = useSystemCapabilities();
  const capabilitiesReady = useCapabilitiesReady();
  const voiceCtx = useVoiceOptional();
  const wakePhraseLabel = voiceCtx?.wakePhrase ?? 'your agent';

  const kitReady = isVoiceKitReady(installedAssetIds, capabilities);
  const sysStatus = voiceSysStatus(loading, kitReady, deploying, capabilities, engine);
  const ttsEngine = voiceConfig.tts?.engine ?? 'kokoro';
  const kokoroInstalled = installedAssetIds.has('kokoro-onnx');

  const load = useCallback(async (overrideEngine?: string) => {
    const effEngine = overrideEngine ?? engine;
    setLoading(true);
    setError(null);
    try {
      const [capRes, catalogRes] = await Promise.all([
        voice.capabilities(),
        voice.catalog(),
      ]);
      setCapabilities(capRes.capabilities);
      setInstalledAssetIds(new Set(catalogRes.installed.map((asset) => asset.assetId)));
      if (effEngine === 'realtime_xai') {
        try {
          const voiceRes = await voice.xaiVoices();
          setXaiVoices(voiceRes.voices);
        } catch {
          setXaiVoices([]);
        }
      } else {
        setXaiVoices([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load voice status');
    } finally {
      setLoading(false);
    }
  }, [engine]);

  // Fetch xAI voices when the engine switches to xAI. No full reload needed —
  // capabilities and catalog don't change between engines.
  const refreshXaiVoices = useCallback(async (effEngine: string) => {
    if (effEngine === 'realtime_xai') {
      try {
        const voiceRes = await voice.xaiVoices();
        setXaiVoices(voiceRes.voices);
      } catch {
        setXaiVoices([]);
      }
    } else {
      setXaiVoices([]);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // No reload on agentx:voice-updated — local state updates via patch() are
  // sufficient for all config changes (voice selection, mode toggle, engine
  // switch). Capabilities/catalog don't change between config updates.

  // Reload installed assets when any TTS download completes or errors
  const allDownloads = useAllVoiceAssetDownloads();
  const completedAssetIds = allDownloads.filter((d) => d.status === 'complete').map((d) => d.assetId);
  const completedKey = completedAssetIds.join(',');
  const seenCompletedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (completedKey === '') return;
    const currentCompleted = new Set(completedAssetIds);
    const newCompletions = [...currentCompleted].filter((id) => !seenCompletedRef.current.has(id));
    if (newCompletions.length > 0) {
      seenCompletedRef.current = currentCompleted;
      void load();
    }
  }, [completedKey]);

  const patch = (patchValue: VoiceConfig) => {
    onChange(mergeVoiceConfig({
      ...voiceConfig,
      ...patchValue,
      mode: { ...voiceConfig.mode, ...patchValue.mode },
      engine: patchValue.engine ?? voiceConfig.engine,
      xai: { ...voiceConfig.xai, ...patchValue.xai },
      stt: { ...voiceConfig.stt, ...patchValue.stt },
      tts: { ...voiceConfig.tts, ...patchValue.tts },
      sidecar: { ...voiceConfig.sidecar, ...patchValue.sidecar },
      fillers: { ...voiceConfig.fillers, ...patchValue.fillers },
    }));
  };

  const persistVoice = async (next: VoiceConfig) => {
    const merged = mergeVoiceConfig(next);
    patch(merged);
    try {
      await voice.updateConfig(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save voice settings');
    }
  };

  useEffect(() => {
    if (!capabilitiesReady || voiceWarmupSupported || voiceConfig.sidecar?.autoStart !== true) return;
    void persistVoice({
      sidecar: { ...voiceConfig.sidecar, autoStart: false },
    });
  }, [capabilitiesReady, voiceWarmupSupported, voiceConfig.sidecar?.autoStart]);

  const pollSetup = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { status } = await voice.setupStatus();
        setDeployStatus(status);
        if (status.phase === 'complete') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setDeploying(false);
          await persistVoice(applyVoicePreset(voiceConfig));
          await load();
        } else if (status.phase === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setDeploying(false);
          setError(status.error ?? status.message);
        }
      } catch (err) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setDeploying(false);
        setError(err instanceof Error ? err.message : 'Voice setup failed');
      }
    }, 500);
  };

  const deployKit = async () => {
    setDeploying(true);
    setError(null);
    setDeployStatus({
      phase: 'runtime',
      message: 'Starting deployment…',
      detail: 'Initializing voice setup',
      progress: 0,
      step: 'Init',
      stepIndex: 0,
    });
    try {
      const { status } = await voice.setup();
      setDeployStatus(status);
      if (status.phase === 'complete') {
        setDeploying(false);
        await persistVoice(applyVoicePreset(voiceConfig));
        await load();
        return;
      }
      pollSetup();
    } catch (err) {
      setDeploying(false);
      setError(err instanceof Error ? err.message : 'Failed to start voice deployment');
    }
  };

  const previewVoice = async () => {
    setPreviewing(true);
    setError(null);
    markVoiceOutputUnlocked();
    try {
      const line = randomTestLine(lastTestLine);
      setLastTestLine(line);
      if (engine === 'realtime_xai') {
        const result = await voice.preview(
          line,
          'realtime_xai',
          voiceConfig.xai?.voice ?? 'eve',
        );
        const audio = new Audio(`data:${result.mimeType};base64,${result.audioBase64}`);
        await audio.play();
      } else {
        const defaultVoiceId = 'kokoro-af';
        const result = await voice.preview(
          line,
          ttsEngine,
          voiceConfig.tts?.voiceId ?? defaultVoiceId,
          voiceConfig.tts?.style,
        );
        const audio = new Audio(`data:${result.mimeType};base64,${result.audioBase64}`);
        await audio.play();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : engine === 'realtime_xai' ? 'Voice test failed — check xAI API key.' : 'Voice test failed — deploy the voice kit first.');
    } finally {
      setPreviewing(false);
    }
  };

  const selectTtsEngine = async (engine: 'kokoro') => {
    if (engine === ttsEngine) return;
    setError(null);
    await persistVoice({
      ...voiceConfig,
      tts: {
        ...voiceConfig.tts,
        engine,
        voiceId: 'kokoro-af',
      },
    });
  };

  const selectVoiceProfile = async (voiceId: string) => {
    if (voiceId === voiceConfig.tts?.voiceId) return;
    setError(null);
    await persistVoice({
      ...voiceConfig,
      tts: {
        ...voiceConfig.tts,
        voiceId,
      },
    });
  };

  const selectEngine = async (nextEngine: 'stt_llm_tts' | 'realtime_xai') => {
    if (nextEngine === engine) return;
    setError(null);
    setXaiStatus('idle');
    setCapabilities(null);
    const isXai = nextEngine === 'realtime_xai';
    const currentWeb = voiceConfig.mode?.web;
    // xAI is always duplex. Local engine preserves the user's previous mode
    // choice (defaults to push-to-talk for first-time users).
    const nextWeb = voiceConfig.enabled
      ? (isXai ? 'duplex' : (currentWeb && currentWeb !== 'off' ? currentWeb : 'push-to-talk'))
      : currentWeb;
    await persistVoice({
      ...voiceConfig,
      engine: nextEngine,
      mode: { ...voiceConfig.mode, web: nextWeb ?? 'off' },
    });
    // Just refresh xAI voices for the new engine — no full reload needed.
    void refreshXaiVoices(nextEngine);
    // Re-fetch capabilities since the engine change may affect them.
    voice.capabilities().then((res) => setCapabilities(res.capabilities)).catch(() => {});
  };

  const selectWebMode = async (nextMode: 'push-to-talk' | 'duplex') => {
    if (nextMode === voiceConfig.mode?.web) return;
    await persistVoice({
      ...voiceConfig,
      mode: { ...voiceConfig.mode, web: nextMode },
    });
  };

  const hasXaiKey = Boolean(voiceConfig.xai?.apiKey);

  const revokeXaiKey = async () => {
    setError(null);
    setXaiStatus('idle');
    setXaiApiKeyInput('');
    await persistVoice({
      ...voiceConfig,
      engine: 'stt_llm_tts',
      mode: { ...voiceConfig.mode, web: 'push-to-talk' },
      xai: { ...voiceConfig.xai, apiKey: '' },
    });
  };

  const validateXaiKey = async () => {
    setXaiValidating(true);
    setError(null);
    try {
      const res = await voice.validateXai(xaiApiKeyInput.trim() || undefined);
      if (res.valid) {
        setXaiStatus('valid');
        await persistVoice({
          ...voiceConfig,
          xai: {
            ...voiceConfig.xai,
            apiKey: xaiApiKeyInput,
          },
        });
        try {
          const voiceRes = await voice.xaiVoices();
          setXaiVoices(voiceRes.voices);
        } catch {
          setXaiVoices([]);
        }
      } else {
        setXaiStatus('invalid');
        setError(res.error ?? 'Invalid xAI API key');
      }
    } catch (err) {
      setXaiStatus('invalid');
      setError(err instanceof Error ? err.message : 'xAI validation failed');
    } finally {
      setXaiValidating(false);
    }
  };

  const selectXaiVoice = async (voiceId: string) => {
    if (voiceId === voiceConfig.xai?.voice) return;
    setError(null);
    await persistVoice({
      ...voiceConfig,
      xai: {
        ...voiceConfig.xai,
        voice: voiceId,
      },
    });
  };

  const selectXaiModel = async (model: string) => {
    if (model === voiceConfig.xai?.model) return;
    setXaiModel(model);
    setError(null);
    await persistVoice({
      ...voiceConfig,
      xai: {
        ...voiceConfig.xai,
        model,
      },
    });
  };

  const missingRuntime = !loading && engine === 'stt_llm_tts' && capabilities && (!capabilities.pythonAvailable || !capabilities.ffmpegAvailable);
  const xaiConfigured = engine === 'realtime_xai' && Boolean(capabilities?.realtimeXai?.configured);

  return (
    <Box>
      <SettingsSectionHeader
        icon={<MicIcon sx={{ fontSize: 16 }} />}
        title="Voice Comms"
        subtitle={engine === 'realtime_xai' ? 'xAI Grok Voice Agent — audio streams to xAI' : 'Local speech only — nothing leaves your machine'}
        action={loading ? (
          <CircularProgress size={12} sx={{ color: settingsTheme.text.dim }} />
        ) : (
          <Box sx={settingsStatusBadgeSx(sysStatus.state)}>
            {sysStatus.label}
          </Box>
        )}
      />

      {error && !loading && <Alert severity="error" sx={{ mb: 2, fontSize: '0.72rem' }}>{error}</Alert>}

      {missingRuntime && (
        <Alert severity="warning" sx={{ mb: 2, fontSize: '0.72rem' }}>
          {!capabilities?.pythonAvailable
            ? 'Python 3.10+ is required before deploying voice. Reinstall Agent-X or install Python and retry.'
            : 'Bundled ffmpeg is missing. Reinstall Agent-X (or install a system ffmpeg on PATH) and retry.'}
        </Alert>
      )}

      <SettingsCard
        title={
          engine === 'realtime_xai'
            ? (loading ? 'xAI Voice' : xaiConfigured ? 'xAI Voice' : 'xAI setup')
            : (loading ? 'Voice systems' : kitReady ? 'Voice systems' : 'Deployment protocol')
        }
        accent={settingsTheme.accent.hud}
        active={engine === 'realtime_xai' ? (!loading && !xaiConfigured) : (!loading && !kitReady)}
      >
        {loading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
            <CircularProgress size={12} sx={{ color: settingsTheme.text.dim }} />
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.62rem', color: settingsTheme.text.dim }}>
              Checking status…
            </Typography>
          </Box>
        ) : engine === 'realtime_xai' ? (
          xaiConfigured ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
              <Typography sx={{ ...settingsMonoSx, fontSize: '0.68rem', color: settingsTheme.text.primary }}>
                Provider · xAI
              </Typography>
              <Typography sx={{ ...settingsMonoSx, fontSize: '0.58rem', color: settingsTheme.text.dim }}>·</Typography>
              <Typography sx={{ ...settingsMonoSx, fontSize: '0.68rem', color: settingsTheme.text.primary }}>
                Voice · {voiceConfig.xai?.voice ?? 'eve'}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ mb: 2 }}>
              <Typography sx={{ ...settingsHelperSx, fontSize: '0.62rem', mb: 0.5 }}>
                Add your xAI API key in the Voice engine section below, then validate it.
              </Typography>
            </Box>
          )
        ) : kitReady ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.68rem', color: settingsTheme.text.primary }}>
              STT · {voiceConfig.stt?.modelId ?? 'faster-distil-whisper-small.en'}
            </Typography>
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.58rem', color: settingsTheme.text.dim }}>·</Typography>
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.68rem', color: settingsTheme.text.primary }}>
              TTS · Kokoro
            </Typography>
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.58rem', color: settingsTheme.text.dim }}>·</Typography>
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.68rem', color: settingsTheme.text.primary }}>
              VAD · silero
            </Typography>
          </Box>
        ) : (
          <Box sx={{ mb: 2 }}>
            {VOICE_DEPLOY_STEPS.map((line, index) => (
              <Typography key={line} sx={{ ...settingsHelperSx, fontSize: '0.62rem', mb: 0.5 }}>
                {index + 1}. {line}
              </Typography>
            ))}
          </Box>
        )}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          {!loading && engine === 'stt_llm_tts' && !kitReady && (
            <Button
              onClick={() => { void deployKit(); }}
              disabled={deploying || Boolean(missingRuntime)}
              sx={settingsBtnPrimarySx}
            >
              {deploying ? <CircularProgress size={12} sx={{ mr: 0.75, color: colors.bg.primary }} /> : null}
              {deploying ? 'Deploying…' : 'Initiate deployment'}
            </Button>
          )}
          <Button onClick={() => { void load(); }} disabled={loading} sx={settingsBtnGhostSx}>
            {loading ? (
              <>
                <CircularProgress size={12} sx={{ mr: 0.75, color: settingsTheme.text.dim }} />
                Checking…
              </>
            ) : 'Refresh'}
          </Button>
        </Box>

        {(deploying || deployStatus) && deployStatus && deployStatus.phase !== 'complete' && (
          <Box sx={{
            mt: 2,
            p: 1.5,
            borderRadius: 1,
            border: `1px solid ${settingsTheme.border.default}`,
            bgcolor: `${alphaColor(settingsTheme.accent.hud, '08')}`,
          }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Box sx={settingsStatusBadgeSx('warn')}>{deployPhaseLabel(deployStatus.phase)}</Box>
                {deployStatus.step && (
                  <Typography sx={{ ...settingsOverlineSx, mb: 0, fontSize: '0.58rem' }}>
                    {deployStatus.step}
                    {deployStatus.stepIndex != null && deployStatus.totalSteps != null
                      ? ` · ${deployStatus.stepIndex}/${deployStatus.totalSteps}`
                      : ''}
                  </Typography>
                )}
              </Box>
              <Typography sx={{ ...settingsMonoSx, fontSize: '0.85rem', fontWeight: 700, color: settingsTheme.accent.hud }}>
                {Math.round(deployStatus.progress)}%
              </Typography>
            </Box>

            <Typography sx={{ ...settingsHelperSx, fontSize: '0.68rem', color: settingsTheme.text.primary, mb: 0.35 }}>
              {deployStatus.message}
            </Typography>

            {deployStatus.currentAssetName && deployStatus.phase === 'download' && (
              <Typography sx={{ ...settingsHelperSx, fontSize: '0.62rem', mb: 0.35 }}>
                Asset {deployStatus.assetIndex ?? '?'}/{deployStatus.totalAssets ?? '?'} · {deployStatus.currentAssetName}
                {deployStatus.assetProgress != null ? ` · ${Math.round(deployStatus.assetProgress)}%` : ''}
              </Typography>
            )}

            {deployStatus.detail && (
              <Typography sx={{ ...settingsHelperSx, fontSize: '0.58rem', color: settingsTheme.text.dim, mb: 1, wordBreak: 'break-word' }}>
                {deployStatus.detail}
              </Typography>
            )}

            <LinearProgress
              variant="determinate"
              value={deployStatus.progress}
              sx={{
                height: 4,
                borderRadius: 1,
                bgcolor: `${settingsTheme.border.default}`,
                '& .MuiLinearProgress-bar': { bgcolor: settingsTheme.accent.hud },
              }}
            />
          </Box>
        )}

        {kitReady && !loading && (
          <Typography sx={{ ...settingsHelperSx, mt: 1.5, color: settingsTheme.accent.signal }}>
            All systems deployed — enable wake word or use the footer mic to talk.
          </Typography>
        )}
      </SettingsCard>

      {!loading && (
      <>
      <SettingsCard title="Voice module" subtitle="Master switch for all voice features in the app">
        <FormControlLabel
          control={(
            <Switch
              size="small"
              checked={Boolean(voiceConfig.enabled)}
              onChange={(e) => {
                const isXai = engine === 'realtime_xai';
                const currentWeb = voiceConfig.mode?.web;
                void persistVoice({
                  ...voiceConfig,
                  enabled: e.target.checked,
                  mode: { ...voiceConfig.mode, web: e.target.checked ? (currentWeb && currentWeb !== 'off' ? currentWeb : (isXai ? 'duplex' : 'push-to-talk')) : 'off' },
                });
              }}
              disabled={engine === 'stt_llm_tts' ? !kitReady : !xaiConfigured}
            />
          )}
          label={<Typography sx={{ fontSize: '0.72rem', ...settingsMonoSx }}>Enable voice module</Typography>}
        />
        <Typography sx={{ ...settingsHelperSx, mt: 1.5 }}>
          {voiceConfig.enabled
            ? 'Footer mic (status), chat voice mode, and wake word are available.'
            : 'Turned off — all voice icons and controls are hidden across Agent-X.'}
          {engine === 'stt_llm_tts' ? (!kitReady && ' Deploy the voice kit first.') : (!xaiConfigured && ' Connect your xAI API key first.')}
        </Typography>
      </SettingsCard>

      {voiceConfig.enabled && (
      <SettingsCard title="Voice activation" subtitle="How you use voice in chat sessions">
        <FormControlLabel
          control={(
            <Switch
              size="small"
              checked={Boolean(voiceConfig.wakeWord?.enabled)}
              onChange={(e) => {
                void persistVoice({
                  ...voiceConfig,
                  enabled: true,
                  wakeWord: { ...voiceConfig.wakeWord, enabled: e.target.checked },
                });
              }}
              disabled={engine === 'realtime_xai' ? true : !kitReady}
            />
          )}
          label={<Typography sx={{ fontSize: '0.72rem', ...settingsMonoSx }}>Wake word ("{wakePhraseLabel}")</Typography>}
        />
        <Typography sx={{ ...settingsHelperSx, mt: 1.5 }}>
          Wake word matches your agent persona name. With wake word off, switch to voice mode from the chat composer toolbar.
          Hold Space in chat voice mode while speaking.
        </Typography>
      </SettingsCard>
      )}

      {voiceConfig.enabled && engine === 'stt_llm_tts' && (
      <SettingsCard
        title="Voice engine warm-up"
        subtitle={voiceWarmupSupported
          ? 'Keep speech models loaded while Agent-X is running'
          : `Requires ${VOICE_WARMUP_MIN_RAM_GB} GB+ system RAM — on-demand only on this machine`}
      >
        {voiceWarmupSupported ? (
          <>
            <FormControlLabel
              control={(
                <Switch
                  size="small"
                  checked={voiceConfig.sidecar?.autoStart === true}
                  onChange={(e) => void persistVoice({
                    sidecar: { ...voiceConfig.sidecar, autoStart: e.target.checked },
                  })}
                  disabled={!kitReady}
                />
              )}
              label={(
                <Typography sx={{ fontSize: '0.72rem', color: settingsTheme.text.primary, ...settingsMonoSx }}>
                  Keep voice engine running at launch
                </Typography>
              )}
            />
            <Typography sx={{ ...settingsHelperSx, mt: 1.5 }}>
              {voiceConfig.sidecar?.autoStart
                ? `Engine warms on the docking page and stays running until you quit Agent-X (${systemCaps?.totalMemoryGB ?? '—'} GB RAM).`
                : `Off (recommended) — engine stays idle until you open chat voice mode, then shuts down after ${voiceConfig.sidecar?.idleUnloadMinutes ?? 5} idle minutes.`}
            </Typography>
          </>
        ) : (
          <Alert severity="info" sx={{ fontSize: '0.68rem', ...settingsMonoSx }}>
            This machine has {systemCaps?.totalMemoryGB ?? '—'} GB RAM. The voice engine stays on-demand only
            (starts when you open chat voice mode) to protect memory.
          </Alert>
        )}
      </SettingsCard>
      )}

      {voiceConfig.enabled && (
      <SettingsCard title="Voice engine" subtitle="Choose the engine that powers voice sessions">
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 1.5, mb: 2 }}>
          <Box
            onClick={() => { void selectEngine('stt_llm_tts'); }}
            sx={{
              p: 1.5,
              borderRadius: 1,
              border: `1.5px solid ${engine === 'stt_llm_tts' ? settingsTheme.accent.hud : settingsTheme.border.default}`,
              bgcolor: engine === 'stt_llm_tts' ? `${alphaColor(settingsTheme.accent.hud, '0a')}` : 'transparent',
              cursor: 'pointer',
              transition: 'border-color 0.15s, background-color 0.15s',
              '&:hover': engine !== 'stt_llm_tts' ? { borderColor: `${settingsTheme.accent.hud}88` } : {},
            }}
          >
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.72rem', color: settingsTheme.text.primary, mb: 0.5 }}>
              Local STT + LLM + TTS
            </Typography>
            <Typography sx={{ ...settingsHelperSx, fontSize: '0.58rem' }}>
              Runs entirely on your machine with the Agent-X voice kit.
            </Typography>
          </Box>
          <Box
            onClick={() => { void selectEngine('realtime_xai'); }}
            sx={{
              p: 1.5,
              borderRadius: 1,
              border: `1.5px solid ${engine === 'realtime_xai' ? settingsTheme.accent.hud : settingsTheme.border.default}`,
              bgcolor: engine === 'realtime_xai' ? `${alphaColor(settingsTheme.accent.hud, '0a')}` : 'transparent',
              cursor: 'pointer',
              transition: 'border-color 0.15s, background-color 0.15s',
              '&:hover': engine !== 'realtime_xai' ? { borderColor: `${settingsTheme.accent.hud}88` } : {},
            }}
          >
            <Typography sx={{ ...settingsMonoSx, fontSize: '0.72rem', color: settingsTheme.text.primary, mb: 0.5 }}>
              xAI Grok Voice Agent
            </Typography>
            <Typography sx={{ ...settingsHelperSx, fontSize: '0.58rem' }}>
              Low-latency speech-to-speech via xAI realtime API.
            </Typography>
          </Box>
        </Box>

        {engine === 'realtime_xai' ? (
        <>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2 }}>
            {hasXaiKey ? (
              <>
                <Typography sx={{ ...settingsMonoSx, fontSize: '0.72rem', color: settingsTheme.accent.signal }}>
                  xAI API key is configured.
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Button
                    onClick={() => { void revokeXaiKey(); }}
                    sx={settingsBtnGhostSx}
                  >
                    Revoke API key
                  </Button>
                  {xaiStatus === 'valid' && (
                    <Typography sx={{ ...settingsHelperSx, color: settingsTheme.accent.signal, alignSelf: 'center' }}>
                      API key is valid.
                    </Typography>
                  )}
                </Box>
              </>
            ) : (
              <>
                <TextField
                  label="xAI API key"
                  type="password"
                  size="small"
                  fullWidth
                  value={xaiApiKeyInput}
                  onChange={(e) => setXaiApiKeyInput(e.target.value)}
                  placeholder="sk-..."
                  sx={{ input: { fontFamily: 'monospace', fontSize: '0.65rem' } }}
                />
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Button
                    onClick={() => { void validateXaiKey(); }}
                    disabled={xaiValidating || !xaiApiKeyInput.trim()}
                    sx={settingsBtnPrimarySx}
                  >
                    {xaiValidating ? <CircularProgress size={12} sx={{ mr: 0.75, color: colors.bg.primary }} /> : null}
                    {xaiValidating ? 'Validating…' : 'Validate & save key'}
                  </Button>
                  {xaiStatus === 'invalid' && (
                    <Typography sx={{ ...settingsHelperSx, color: settingsTheme.accent.alert, alignSelf: 'center' }}>
                      Key validation failed.
                    </Typography>
                  )}
                </Box>
              </>
            )}
            <Typography sx={{ ...settingsHelperSx }}>
              Your key is stored in the encrypted Agent-X config and used server-side.
            </Typography>
          </Box>

          <Box sx={{ mb: 2 }}>
            <Typography sx={{ ...settingsOverlineSx, mb: 1 }}>Model</Typography>
            <TextField
              select
              size="small"
              fullWidth
              value={xaiModel}
              onChange={(e) => { void selectXaiModel(e.target.value); }}
              sx={{ '& .MuiInputBase-input': { fontSize: '0.7rem', ...(settingsMonoSx as object) } }}
            >
              <MenuItem value="grok-voice-latest" sx={{ fontSize: '0.7rem', ...(settingsMonoSx as object) }}>
                grok-voice-latest
              </MenuItem>
              <MenuItem value="grok-voice-think-fast-1.0" sx={{ fontSize: '0.7rem', ...(settingsMonoSx as object) }}>
                grok-voice-think-fast-1.0
              </MenuItem>
            </TextField>
          </Box>

          <Box sx={{ mb: 1 }}>
            <Typography sx={{ ...settingsOverlineSx, mb: 1 }}>Voice</Typography>
            {xaiVoices.length === 0 ? (
              <Typography sx={{ ...settingsHelperSx }}>
                {hasXaiKey ? 'Loading available voices…' : 'Validate your API key to load available voices.'}
              </Typography>
            ) : (
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
              gap: 0.75,
            }}>
              {xaiVoices.map((v) => {
                const isSelected = (voiceConfig.xai?.voice ?? 'eve') === v.id;
                return (
                  <Box
                    key={v.id}
                    onClick={() => { void selectXaiVoice(v.id); }}
                    sx={{
                      cursor: 'pointer',
                      p: 1,
                      borderRadius: 1,
                      border: `1px solid ${isSelected ? settingsTheme.accent.hud : settingsTheme.border.default}`,
                      bgcolor: isSelected ? `${alphaColor(settingsTheme.accent.hud, '0a')}` : 'transparent',
                      transition: 'border-color 0.15s, background-color 0.15s',
                      '&:hover': !isSelected ? { borderColor: `${settingsTheme.accent.hud}88` } : {},
                    }}
                  >
                    <Typography sx={{ ...settingsMonoSx, fontSize: '0.68rem', color: settingsTheme.text.primary }}>
                      {v.name}
                    </Typography>
                    {v.language && (
                      <Typography sx={{ ...settingsHelperSx, fontSize: '0.55rem', color: settingsTheme.text.dim, mt: 0.25 }}>
                        {v.language}
                      </Typography>
                    )}
                  </Box>
                );
              })}
            </Box>
            )}
          </Box>
        </>
        ) : (
        <>
          <TtsModelRow
            name="Kokoro"
            description="Fast, natural local TTS. Installed with the voice kit and used for fillers."
            sizeMB={330}
            installed={kokoroInstalled}
            isDefault={ttsEngine === 'kokoro'}
            canSelect={kitReady}
            downloadAssetId={null}
            onSelect={() => { void selectTtsEngine('kokoro'); }}
            onDownload={() => {}}
          />

        <Box sx={{ mt: 2, mb: 1 }}>
          <Typography sx={{ ...settingsOverlineSx, mb: 1 }}>Voice Profile</Typography>
          {Array.from(new Set(KOKORO_VOICE_PROFILES.map((p) => p.language))).map((language) => (
            <Box key={language} sx={{ mb: 1.5 }}>
              <Typography sx={{ ...settingsHelperSx, fontSize: '0.58rem', color: settingsTheme.text.dim, mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {language}
              </Typography>
              <Box sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
                gap: 0.75,
              }}>
                {KOKORO_VOICE_PROFILES.filter((p) => p.language === language).map((profile) => {
                  const isSelected = (voiceConfig.tts?.voiceId ?? 'kokoro-af') === profile.id;
                  return (
                    <Box
                      key={profile.id}
                      onClick={() => { if (kitReady) void selectVoiceProfile(profile.id); }}
                      sx={{
                        cursor: kitReady ? 'pointer' : 'default',
                        opacity: kitReady ? 1 : 0.5,
                        p: 1,
                        borderRadius: 1,
                        border: `1px solid ${isSelected ? settingsTheme.accent.hud : settingsTheme.border.default}`,
                        bgcolor: isSelected ? `${alphaColor(settingsTheme.accent.hud, '0a')}` : 'transparent',
                        transition: 'border-color 0.15s, background-color 0.15s',
                        '&:hover': kitReady && !isSelected ? {
                          borderColor: settingsTheme.accent.hud + '88',
                        } : {},
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                        <Typography sx={{ ...settingsMonoSx, fontSize: '0.68rem', color: settingsTheme.text.primary }}>
                          {profile.name}
                        </Typography>
                        <Box sx={{
                          ...settingsMonoSx,
                          fontSize: '0.5rem',
                          px: 0.4,
                          py: 0.05,
                          borderRadius: 0.5,
                          bgcolor: profile.gender === 'F' ? `${settingsTheme.accent.hud}22` : `${settingsTheme.accent.signal}22`,
                          color: profile.gender === 'F' ? settingsTheme.accent.hud : settingsTheme.accent.signal,
                        }}>
                          {profile.gender}
                        </Box>
                        <Box sx={{
                          ...settingsMonoSx,
                          fontSize: '0.5rem',
                          px: 0.4,
                          py: 0.05,
                          borderRadius: 0.5,
                          bgcolor: settingsTheme.border.default,
                          color: settingsTheme.text.dim,
                        }}>
                          {profile.grade}
                        </Box>
                      </Box>
                      <Typography sx={{ ...settingsHelperSx, fontSize: '0.58rem', mt: 0.25 }}>
                        {profile.description}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          ))}
        </Box>
        </>
        )}

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 2, mb: 2 }}>
          <Button
            onClick={() => { void previewVoice(); }}
            disabled={previewing || (engine === 'stt_llm_tts' ? !kitReady : !hasXaiKey)}
            sx={settingsBtnGhostSx}
          >
            {previewing ? 'Generating…' : 'Test Voice'}
          </Button>
        </Box>
        {engine === 'stt_llm_tts' && (
          <>
            <VoiceMicTestPanel compact />
            <Typography sx={{ ...settingsHelperSx, mt: 1.5 }}>
              Use the footer mic or wake word for live voice. Run these checks before your first session.
            </Typography>
          </>
        )}

        {/* Voice input mode — local engine only (xAI is always duplex) */}
        {engine === 'stt_llm_tts' && (
          <Box sx={{ mt: 2, pt: 2, borderTop: `1px solid ${settingsTheme.border.default}` }}>
            <Typography sx={{ ...settingsOverlineSx, mb: 1 }}>Voice input mode</Typography>
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              <Box
                onClick={() => void selectWebMode('push-to-talk')}
                sx={{
                  flex: 1,
                  cursor: 'pointer',
                  p: 1.5,
                  borderRadius: 1,
                  border: `1.5px solid ${voiceConfig.mode?.web === 'push-to-talk' ? settingsTheme.accent.hud : settingsTheme.border.default}`,
                  bgcolor: voiceConfig.mode?.web === 'push-to-talk' ? `${settingsTheme.accent.hud}14` : 'transparent',
                  transition: 'border-color 0.15s, background-color 0.15s',
                  '&:hover': { borderColor: settingsTheme.accent.hud },
                }}
              >
                <Typography sx={{ fontSize: '0.72rem', color: settingsTheme.text.primary, ...settingsMonoSx, mb: 0.5 }}>
                  Push-to-Talk
                </Typography>
                <Typography sx={{ ...settingsHelperSx, fontSize: '0.6rem' }}>
                  Hold Space to speak. Works on dashboard only. Best for precise control.
                </Typography>
              </Box>
              <Box
                onClick={() => void selectWebMode('duplex')}
                sx={{
                  flex: 1,
                  cursor: 'pointer',
                  p: 1.5,
                  borderRadius: 1,
                  border: `1.5px solid ${voiceConfig.mode?.web === 'duplex' ? settingsTheme.accent.signal : settingsTheme.border.default}`,
                  bgcolor: voiceConfig.mode?.web === 'duplex' ? `${settingsTheme.accent.signal}14` : 'transparent',
                  transition: 'border-color 0.15s, background-color 0.15s',
                  '&:hover': { borderColor: settingsTheme.accent.signal },
                }}
              >
                <Typography sx={{ fontSize: '0.72rem', color: settingsTheme.text.primary, ...settingsMonoSx, mb: 0.5 }}>
                  Duplex (Hands-free)
                </Typography>
                <Typography sx={{ ...settingsHelperSx, fontSize: '0.6rem' }}>
                  Always listening. Works on any page. Auto-detects speech start and end.
                </Typography>
              </Box>
            </Box>
            <Typography sx={{ ...settingsHelperSx, mt: 1 }}>
              {voiceConfig.mode?.web === 'duplex'
                ? 'Local engine uses Silero VAD for speech detection. The agent listens continuously and auto-detects when you finish speaking.'
                : 'Hold Space on the dashboard to speak. Release when done.'}
            </Typography>
          </Box>
        )}
      </SettingsCard>
      )}

      <Box
        onClick={() => setAdvancedOpen((open) => !open)}
        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', py: 0.5, userSelect: 'none', mb: 1 }}
      >
        <ExpandMoreIcon sx={{
          fontSize: 16,
          color: settingsTheme.text.dim,
          transform: advancedOpen ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.2s',
        }} />
        <Typography sx={{ ...settingsOverlineSx, mb: 0 }}>Advanced</Typography>
      </Box>

      <Collapse in={advancedOpen}>
        <SettingsCard title="Channel voice notes" subtitle="Telegram voice message replies">
          <FormControlLabel
            control={(
              <Switch
                size="small"
                checked={voiceConfig.mode?.channels === 'voice-notes'}
                onChange={(e) => patch({
                  enabled: e.target.checked ? true : voiceConfig.enabled,
                  mode: { channels: e.target.checked ? 'voice-notes' : 'off' },
                })}
                disabled={!kitReady}
              />
            )}
            label={(
              <Typography sx={{ fontSize: '0.72rem', color: settingsTheme.text.primary, ...settingsMonoSx }}>
                Reply with voice notes on Telegram
              </Typography>
            )}
          />
        </SettingsCard>

        <SettingsCard title="Memory" subtitle="On-demand engine unload">
          <Typography sx={{ ...settingsHelperSx }}>
            {voiceConfig.sidecar?.autoStart
              ? 'Not used while “keep engine running at launch” is enabled — the engine stays loaded until you quit Agent-X.'
              : `When chat voice mode is closed, the engine unloads after ${voiceConfig.sidecar?.idleUnloadMinutes ?? 5} idle minutes to free RAM.`}
          </Typography>
        </SettingsCard>

        <SettingsCard title="Spoken progress">
          <FormControlLabel
            control={(
              <Switch
                size="small"
                checked={Boolean(voiceConfig.fillers?.enabled)}
                onChange={(e) => patch({ fillers: { enabled: e.target.checked } })}
              />
            )}
            label={<Typography sx={{ fontSize: '0.72rem', ...settingsMonoSx }}>Speak status fillers</Typography>}
          />
          <FormControlLabel
            control={(
              <Switch
                size="small"
                checked={Boolean(voiceConfig.fillers?.speakToolProgress)}
                onChange={(e) => patch({ fillers: { speakToolProgress: e.target.checked } })}
              />
            )}
            label={<Typography sx={{ fontSize: '0.72rem', ...settingsMonoSx }}>Speak tool progress</Typography>}
          />
        </SettingsCard>
      </Collapse>
      </>
      )}
    </Box>
  );
}
