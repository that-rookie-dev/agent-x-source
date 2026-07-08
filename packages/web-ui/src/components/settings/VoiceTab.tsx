import { useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import FormControlLabel from '@mui/material/FormControlLabel';
import LinearProgress from '@mui/material/LinearProgress';
import Switch from '@mui/material/Switch';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MicIcon from '@mui/icons-material/Mic';
import { voice, type VoiceCapabilityStatus, type VoiceConfig, type VoiceSetupStatus } from '../../api';
import {
  applyVoicePreset,
  isStyleTts2Installed,
  isVoiceKitReady,
  mergeVoiceConfig,
  VOICE_DEPLOY_STEPS,
} from '../../voice/voice-config';
import { VOICE_WARMUP_MIN_RAM_GB } from '@agentx/shared/browser';
import { markVoiceOutputUnlocked } from '../../voice/support';
import { useStyleTtsSupported, useVoiceWarmupSupported, useSystemCapabilities, useCapabilitiesReady } from '../../hooks/useSystemCapabilities';
import {
  settingsBtnGhostSx,
  settingsBtnPrimarySx,
  settingsHelperSx,
  settingsMonoSx,
  settingsOverlineSx,
  settingsStatusBadgeSx,
  settingsTheme,
  settingsToggleGroupSx,
} from '../../styles/settings-theme';
import { SettingsCard } from './SettingsCard';
import { SettingsSectionHeader } from './SettingsSectionHeader';
import { VoiceMicTestPanel } from '../VoiceMicTestPanel';
import { useVoiceOptional } from '../voice/VoiceProvider';

import { colors, alphaColor } from '../../theme';
export { mergeVoiceConfig } from '../../voice/voice-config';

interface VoiceTabProps {
  value?: VoiceConfig;
  onChange: (voiceConfig: VoiceConfig) => void;
}

function voiceSysStatus(
  kitReady: boolean,
  deploying: boolean,
  capabilities: VoiceCapabilityStatus | null,
): { label: string; state: 'active' | 'idle' | 'warn' } {
  if (deploying) return { label: 'CALIBRATING', state: 'warn' };
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
  const [capabilities, setCapabilities] = useState<VoiceCapabilityStatus | null>(null);
  const [installedAssetIds, setInstalledAssetIds] = useState<Set<string>>(new Set());
  const [deploying, setDeploying] = useState(false);
  const [deployStatus, setDeployStatus] = useState<VoiceSetupStatus | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [ttsDownloading, setTtsDownloading] = useState(false);
  const [ttsDownloadProgress, setTtsDownloadProgress] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const styleTtsSupported = useStyleTtsSupported();
  const voiceWarmupSupported = useVoiceWarmupSupported();
  const systemCaps = useSystemCapabilities();
  const capabilitiesReady = useCapabilitiesReady();
  const voiceCtx = useVoiceOptional();
  const wakePhraseLabel = voiceCtx?.wakePhrase ?? 'your agent';

  const kitReady = isVoiceKitReady(installedAssetIds, capabilities);
  const sysStatus = voiceSysStatus(kitReady, deploying, capabilities);
  const ttsEngine = voiceConfig.tts?.engine ?? 'kokoro';
  const styleTtsReady = isStyleTts2Installed(installedAssetIds);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [capRes, catalogRes] = await Promise.all([
        voice.capabilities(),
        voice.catalog(),
      ]);
      setCapabilities(capRes.capabilities);
      setInstalledAssetIds(new Set(catalogRes.installed.map((asset) => asset.assetId)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load voice status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const patch = (patchValue: VoiceConfig) => {
    onChange(mergeVoiceConfig({
      ...voiceConfig,
      ...patchValue,
      mode: { ...voiceConfig.mode, ...patchValue.mode },
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
    if (styleTtsSupported || ttsEngine !== 'styletts2') return;
    void persistVoice({
      ...voiceConfig,
      tts: { ...voiceConfig.tts, engine: 'kokoro', voiceId: 'kokoro-af' },
    });
  }, [styleTtsSupported, ttsEngine]);

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
      if (ttsEngine === 'styletts2') {
        await voice.installStyleTts();
      }
      const result = await voice.preview(
        'Voice comms online. Agent-X standing by.',
        ttsEngine,
        voiceConfig.tts?.voiceId ?? (ttsEngine === 'styletts2' ? 'styletts2-default' : 'kokoro-af'),
      );
      const audio = new Audio(`data:${result.mimeType};base64,${result.audioBase64}`);
      await audio.play();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speaker test failed — deploy the voice kit first.');
    } finally {
      setPreviewing(false);
    }
  };

  const waitForAssetDownload = async (assetId: string): Promise<void> => {
    for (;;) {
      const status = await voice.downloadStatus(assetId);
      if (status.status === 'complete') return;
      if (status.status === 'error' || status.status === 'cancelled') {
        throw new Error(status.error ?? `Download failed for ${assetId}`);
      }
      setTtsDownloadProgress(status.progress ?? 0);
      await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
    }
  };

  const switchTtsEngine = async (engine: 'kokoro' | 'styletts2') => {
    if (engine === ttsEngine) return;
    if (engine === 'styletts2' && !styleTtsSupported) return;
    setError(null);
    if (engine === 'styletts2' && !styleTtsReady) {
      setTtsDownloading(true);
      setTtsDownloadProgress(0);
      try {
        if (!installedAssetIds.has('styletts2')) {
          await voice.downloadAsset('styletts2');
          await waitForAssetDownload('styletts2');
        } else {
          setTtsDownloadProgress(50);
          await voice.installStyleTts();
        }
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'StyleTTS 2 setup failed');
        setTtsDownloading(false);
        return;
      }
      setTtsDownloading(false);
    } else if (engine === 'styletts2') {
      try {
        await voice.installStyleTts();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'StyleTTS 2 runtime install failed');
        return;
      }
    }
    await persistVoice({
      ...voiceConfig,
      tts: {
        ...voiceConfig.tts,
        engine,
        voiceId: engine === 'styletts2' ? 'styletts2-default' : 'kokoro-af',
      },
    });
  };

  const missingRuntime = capabilities && (!capabilities.pythonAvailable || !capabilities.ffmpegAvailable);

  return (
    <Box>
      <SettingsSectionHeader
        icon={<MicIcon sx={{ fontSize: 16 }} />}
        title="Voice Comms"
        subtitle="Local speech only — nothing leaves your machine"
        action={(
          <Box sx={settingsStatusBadgeSx(sysStatus.state)}>
            {sysStatus.label}
          </Box>
        )}
      />

      {error && <Alert severity="error" sx={{ mb: 2, fontSize: '0.72rem' }}>{error}</Alert>}

      {missingRuntime && (
        <Alert severity="warning" sx={{ mb: 2, fontSize: '0.72rem' }}>
          Install Python 3.10+ and ffmpeg before deploying voice ({!capabilities?.pythonAvailable ? 'Python missing' : 'ffmpeg missing'}).
        </Alert>
      )}

      <SettingsCard
        title={kitReady ? 'Voice systems' : 'Deployment protocol'}
        accent={settingsTheme.accent.hud}
        active={!kitReady}
      >
        {kitReady ? (
          <Box sx={{ mb: 1.5 }}>
            {[
              { label: 'STT', value: voiceConfig.stt?.modelId ?? 'faster-whisper-base.en' },
              { label: 'TTS', value: `${ttsEngine === 'styletts2' ? 'StyleTTS 2' : 'Kokoro'} · ${voiceConfig.tts?.voiceId ?? 'kokoro-af'}` },
              { label: 'VAD', value: 'silero-vad' },
            ].map((row) => (
              <Box key={row.label} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                <Box sx={settingsStatusBadgeSx('active')}>{row.label}</Box>
                <Typography sx={{ ...settingsMonoSx, fontSize: '0.68rem', color: settingsTheme.text.primary }}>
                  {row.value}
                </Typography>
              </Box>
            ))}
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
          {!kitReady && (
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
            {loading ? 'Refreshing…' : 'Refresh'}
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

        {kitReady && (
          <Typography sx={{ ...settingsHelperSx, mt: 1.5, color: settingsTheme.accent.signal }}>
            All systems deployed — enable wake word or use the footer mic to talk.
          </Typography>
        )}
      </SettingsCard>

      <SettingsCard title="Voice module" subtitle="Master switch for all voice features in the app">
        <FormControlLabel
          control={(
            <Switch
              size="small"
              checked={Boolean(voiceConfig.enabled)}
              onChange={(e) => { void persistVoice({ ...voiceConfig, enabled: e.target.checked }); }}
              disabled={!kitReady}
            />
          )}
          label={<Typography sx={{ fontSize: '0.72rem', ...settingsMonoSx }}>Enable voice module</Typography>}
        />
        <Typography sx={{ ...settingsHelperSx, mt: 1.5 }}>
          {voiceConfig.enabled
            ? 'Footer mic (status), chat voice mode, and wake word are available.'
            : 'Turned off — all voice icons and controls are hidden across Agent-X.'}
          {!kitReady && ' Deploy the voice kit first.'}
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
              disabled={!kitReady}
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

      {voiceConfig.enabled && (
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
      <SettingsCard title="Voice engine" subtitle="Speech synthesis model for spoken replies">
        <ToggleButtonGroup
          exclusive
          size="small"
          value={ttsEngine}
          onChange={(_, next) => { if (next) void switchTtsEngine(next as 'kokoro' | 'styletts2'); }}
          disabled={!kitReady || ttsDownloading}
          sx={{ ...settingsToggleGroupSx, mb: 2 }}
        >
          <ToggleButton value="kokoro">Kokoro</ToggleButton>
          {styleTtsSupported && <ToggleButton value="styletts2">StyleTTS 2</ToggleButton>}
        </ToggleButtonGroup>
        {ttsDownloading && (
          <Box sx={{ mb: 1.5 }}>
            <Typography sx={{ ...settingsHelperSx, mb: 0.5 }}>
              Downloading StyleTTS 2 (~900 MB) · {Math.round(ttsDownloadProgress)}%
            </Typography>
            <LinearProgress
              variant="determinate"
              value={ttsDownloadProgress}
              sx={{
                height: 4,
                borderRadius: 1,
                bgcolor: `${settingsTheme.border.default}`,
                '& .MuiLinearProgress-bar': { bgcolor: settingsTheme.accent.hud },
              }}
            />
          </Box>
        )}
        <Typography sx={{ ...settingsHelperSx, mb: 2 }}>
          Kokoro is fast and lightweight (installed with the kit).
          {styleTtsSupported
            ? (styleTtsReady ? ' StyleTTS 2 is ready for more expressive speech.' : ' StyleTTS 2 downloads on first selection (~900 MB).')
            : ' StyleTTS 2 requires 16 GB+ system RAM and is hidden on this machine.'}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
          <Button
            onClick={() => { void previewVoice(); }}
            disabled={previewing || !kitReady}
            sx={settingsBtnGhostSx}
          >
            {previewing ? 'Transmitting…' : 'Test speaker'}
          </Button>
        </Box>
        <VoiceMicTestPanel compact />
        <Typography sx={{ ...settingsHelperSx, mt: 1.5 }}>
          Use the footer mic or wake word for live voice. Run these checks before your first session.
        </Typography>
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
    </Box>
  );
}
