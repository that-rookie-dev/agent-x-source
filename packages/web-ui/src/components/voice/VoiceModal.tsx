import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { type VoiceSidecarHealth } from '../../api';
import { useMicrophonePermission } from '../../hooks/useMicrophonePermission';
import { useVoiceKeyboard } from '../../hooks/useVoiceKeyboard';
import { useVoiceSession } from '../../hooks/useVoiceSession';
import { voiceDisabledReason, markVoiceOutputUnlocked } from '../../voice/support';
import { loadVoiceInputMode, saveVoiceInputMode } from '../../voice/input-mode-preference';
import { useVoice } from './VoiceProvider';
import { COMMS_MONO, commsTheme, friendlyVoiceError } from './voice-comms-theme';
import { VoiceWaveform } from './VoiceWaveform';
import { DuplexSilenceProgress } from './DuplexSilenceProgress';
import { VoiceTurnTimingsBar } from './VoiceTurnTimingsBar';
import { VoiceActivityLog } from './VoiceActivityLog';
import { VoicePermissionCard } from './VoicePermissionCard';
import { useVoiceActivityLog } from '../../hooks/useVoiceActivityLog';
import { useVoiceTurnEpoch } from '../../hooks/useVoiceTurnEpoch';

export interface VoiceModalProps {
  open: boolean;
  chatSessionId: string | null;
  onClose: () => void;
  autoStart?: boolean;
}

type Channel = 'operator' | 'relay' | 'agent';
type InputMode = 'push-to-talk' | 'duplex';

function resolveActiveChannel(
  state: string,
  holding: boolean,
  commsReady: boolean,
  bootPhase: string,
  inputMode: InputMode,
): Channel | null {
  if (bootPhase === 'booting') return 'relay';
  if (!commsReady) return 'relay';
  if (state === 'connecting') return 'relay';
  if (state === 'processing') return 'relay';
  if (state === 'speaking') return 'agent';
  if (inputMode === 'duplex' && state === 'listening') return 'operator';
  if (state === 'listening' && holding) return 'operator';
  if (state === 'listening') return 'operator';
  if (state === 'ready' || state === 'idle') return 'relay';
  return null;
}

function statusLabel(
  state: string,
  holding: boolean,
  agentStatus: string,
  commsReady: boolean,
  bootPhase: string,
  inputMode: InputMode,
): string {
  if (bootPhase === 'booting') return 'INITIALIZING';
  if (bootPhase === 'failed') return 'SIGNAL LOST';
  if (!commsReady) return 'LINKING COMMS';
  if (state === 'connecting') return 'LINKING SESSION';
  if (inputMode === 'duplex' && state === 'listening' && !holding) return 'AWAITING VOICE';
  if (state === 'listening' && holding) return 'RECORDING';
  if (state === 'listening') return 'MIC LIVE';
  if (state === 'processing') return agentStatus ? agentStatus.toUpperCase() : 'PROCESSING';
  if (state === 'speaking') return 'TRANSMITTING';
  if (state === 'error') return 'SIGNAL LOST';
  if (commsReady && (state === 'ready' || state === 'idle')) return 'COMMS READY';
  return 'STANDBY';
}

function CommsPanel({
  codename,
  title,
  active,
  ready,
  children,
}: {
  codename: string;
  title: string;
  active: boolean;
  ready?: boolean;
  children: ReactNode;
}) {
  const border = ready ? commsTheme.relayReadyBorder : active ? commsTheme.borderActive : commsTheme.border;
  const bg = ready ? commsTheme.relayReadyBg : active ? commsTheme.panelActive : commsTheme.panel;

  return (
    <Box sx={{
      p: 1.5,
      borderRadius: 1,
      border: `1px solid ${border}`,
      bgcolor: bg,
      minHeight: 168,
      display: 'flex',
      flexDirection: 'column',
      transition: 'border-color 0.25s, background-color 0.25s, box-shadow 0.25s',
      position: 'relative',
      overflow: 'hidden',
      boxShadow: ready ? `0 0 24px ${commsTheme.relayReadyBg}` : 'none',
      '&::before': active || ready ? {
        content: '""',
        position: 'absolute',
        inset: 0,
        background: ready
          ? 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(34,197,94,0.04) 2px, rgba(34,197,94,0.04) 4px)'
          : 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.02) 2px, rgba(255,255,255,0.02) 4px)',
        pointerEvents: 'none',
      } : undefined,
    }}>
      <Typography sx={{
        fontFamily: COMMS_MONO,
        fontSize: '0.48rem',
        letterSpacing: '2px',
        color: ready ? commsTheme.relayReady : commsTheme.textDim,
        mb: 0.25,
      }}>
        {codename}
      </Typography>
      <Typography sx={{
        fontFamily: COMMS_MONO,
        fontSize: '0.62rem',
        fontWeight: 700,
        color: ready ? commsTheme.relayReady : active ? commsTheme.text : commsTheme.textDim,
        mb: 1,
      }}>
        {title}
      </Typography>
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative', zIndex: 1 }}>
        {children}
      </Box>
    </Box>
  );
}

function RelayPulse({ active, color = commsTheme.text }: { active: boolean; color?: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1, py: 1.5 }}>
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            border: `1px solid ${active ? color : commsTheme.border}`,
            bgcolor: active ? color : 'transparent',
            animation: active ? `commsPulse 1.2s ease-in-out ${i * 0.2}s infinite` : 'none',
            '@keyframes commsPulse': {
              '0%, 100%': { opacity: 0.25, transform: 'scale(0.85)' },
              '50%': { opacity: 1, transform: 'scale(1.15)' },
            },
          }}
        />
      ))}
    </Box>
  );
}

function MetricRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, py: 0.2 }}>
      <Typography sx={{ fontFamily: COMMS_MONO, fontSize: '0.5rem', color: commsTheme.textDim, letterSpacing: '0.5px' }}>
        {label}
      </Typography>
      <Typography sx={{
        fontFamily: COMMS_MONO,
        fontSize: '0.5rem',
        color: ok === false ? commsTheme.warn : ok ? commsTheme.relayReady : commsTheme.textSecondary,
        textAlign: 'right',
      }}>
        {value}
      </Typography>
    </Box>
  );
}

function RelayReadyPanel({ health, wsLinked }: { health?: VoiceSidecarHealth; wsLinked: boolean }) {
  const stt = health?.models?.sttLoaded ? 'LOADED' : '—';
  const ttsEngine = health?.models?.ttsEngine?.toUpperCase() ?? '—';
  const tts = health?.models?.ttsLoaded ? 'LOADED' : '—';
  const device = health?.device?.toUpperCase() ?? 'CPU';

  return (
    <Box sx={{ textAlign: 'center' }}>
      <RelayPulse active color={commsTheme.relayReady} />
      <Typography sx={{
        fontFamily: COMMS_MONO,
        fontSize: '0.62rem',
        fontWeight: 700,
        color: commsTheme.relayReady,
        letterSpacing: '1.5px',
        mb: 0.75,
      }}>
        CONNECTION ESTABLISHED
      </Typography>
      <Typography sx={{ fontFamily: COMMS_MONO, fontSize: '0.5rem', color: commsTheme.textDim, mb: 1 }}>
        Secure voice link active
      </Typography>
      <Box sx={{
        border: `1px solid ${commsTheme.relayReadyBorder}`,
        borderRadius: 0.5,
        px: 1,
        py: 0.75,
        bgcolor: 'rgba(0,0,0,0.35)',
      }}>
        <MetricRow label="STT" value={stt} ok={health?.models?.sttLoaded} />
        <MetricRow label="TTS" value={`${ttsEngine} · ${tts}`} ok={health?.models?.ttsLoaded} />
        <MetricRow label="COMPUTE" value={device} />
        <MetricRow label="SESSION" value={wsLinked ? 'LINKED' : 'STANDBY'} ok={wsLinked} />
        <MetricRow label="ENCRYPT" value="LOCAL · TLS" ok />
      </Box>
    </Box>
  );
}

export function VoiceModal({ open, chatSessionId, onClose, autoStart = false }: VoiceModalProps) {
  const mic = useMicrophonePermission();
  const envBlocked = voiceDisabledReason();
  const voiceCtx = useVoice();
  const [inputMode, setInputModeState] = useState<InputMode>(() => loadVoiceInputMode());
  const setInputMode = useCallback((mode: InputMode) => {
    setInputModeState(mode);
    saveVoiceInputMode(mode);
  }, []);

  const bootPhase = voiceCtx.warmupPhase;
  const sidecarHealth = voiceCtx.warmupHealth;
  const bootError = voiceCtx.warmupError;
  const commsReady = bootPhase === 'ready';
  const prerequisitesOk = open && voiceCtx.voiceReady && !envBlocked;
  const micReady = mic.state === 'granted';
  const pttEnabled = prerequisitesOk && commsReady && micReady;
  const isDuplex = inputMode === 'duplex';

  const session = useVoiceSession(pttEnabled, inputMode, chatSessionId ?? undefined, {
    onTranscriptFinal: (text, empty) => {
      voiceCtx.getVoiceChatBridge()?.onTranscriptFinal?.(text, empty);
    },
    onAgentRunning: () => {
      voiceCtx.getVoiceChatBridge()?.onAgentRunning?.();
    },
  });

  useEffect(() => {
    if (!open) return;
    void mic.refresh();
  }, [open, mic.refresh]);

  useEffect(() => {
    if (!open || envBlocked || mic.state === 'granted' || mic.state === 'denied') return;
    void mic.requestAccess();
  }, [open, envBlocked, mic.state, mic.requestAccess]);

  useEffect(() => {
    if (!pttEnabled) return;
    if (!isDuplex) return;
    void session.startSession();
  }, [pttEnabled, isDuplex, session.startSession]);

  const beginVoice = useCallback(async () => {
    if (!pttEnabled) return;
    markVoiceOutputUnlocked();
    await session.beginPushToTalk();
  }, [pttEnabled, session]);

  const endVoice = useCallback(async () => {
    if (!pttEnabled) return;
    await session.endPushToTalk();
  }, [pttEnabled, session]);

  const toggleInputMode = useCallback(() => {
    session.cancel();
    setInputMode(isDuplex ? 'push-to-talk' : 'duplex');
  }, [isDuplex, session, setInputMode]);

  useVoiceKeyboard({
    enabled: pttEnabled && open,
    globalSpace: true,
    composerFocused: false,
    composerEmpty: true,
    pushToTalk: !isDuplex,
    onBeginPushToTalk: () => { void beginVoice(); },
    onEndPushToTalk: () => { void endVoice(); },
    onToggleSession: () => {},
    onInterruptPlayback: () => session.interruptPlayback(),
    onDoubleTapSpace: toggleInputMode,
  });

  useEffect(() => {
    if (!open || !autoStart || !pttEnabled || isDuplex) return;
    void beginVoice();
  }, [open, autoStart, pttEnabled, isDuplex, beginVoice]);

  useEffect(() => {
    if (!open) session.cancel();
  }, [open, session]);

  const wsLinked = session.state === 'ready' || session.state === 'listening' || session.state === 'processing' || session.state === 'speaking';
  const turnEpoch = useVoiceTurnEpoch(session.state, session.holding, open);
  const activityLog = useVoiceActivityLog(chatSessionId, turnEpoch, open);
  const showMissionLog = commsReady;
  const showSilenceBar = isDuplex && commsReady && session.state === 'listening' && session.silenceProgress > 0;
  const relayReady = commsReady && !session.holding && session.state !== 'connecting' && session.state !== 'processing';
  const activeChannel = resolveActiveChannel(session.state, session.holding, commsReady, bootPhase, inputMode);
  const status = statusLabel(session.state, session.holding, session.agentStatus, commsReady, bootPhase, inputMode);
  const capturedText = (session.finalTranscript || session.partialTranscript || session.transcript).trim();
  const operatorText = capturedText;
  const showOperatorText = Boolean(operatorText);

  const footerHint = useMemo(() => {
    if (envBlocked) return envBlocked;
    if (!voiceCtx.voiceReady) return 'Complete voice setup in Settings → Voice';
    if (bootPhase === 'booting') return 'Voice engine warming in background — first launch may take a minute…';
    if (bootPhase === 'failed') return bootError ?? 'Voice engine unavailable';
    if (!commsReady) return 'Establishing secure comms link…';
    if (mic.state !== 'granted') {
      if (mic.blocked) return mic.helpText || 'Microphone blocked — open system settings to allow access';
      return 'Grant microphone access to enable voice';
    }
    if (session.state === 'connecting') return 'Opening secure session…';
    if (isDuplex && session.state === 'listening') return 'Hands-free — speak naturally, 5 s pause auto-sends';
    if (session.holding && session.state === 'listening') return 'Recording — release Space to transmit';
    if (commsReady && micReady && isDuplex) return 'Hands-free active — mic reopens after agent replies';
    if (commsReady && micReady) return 'Hold Space to talk · release to send';
    return 'Awaiting operator clearance…';
  }, [envBlocked, voiceCtx.voiceReady, bootPhase, bootError, commsReady, mic.state, mic.blocked, mic.helpText, micReady, session.state, session.holding, isDuplex]);

  const headerStatusColor = bootPhase === 'failed' || session.state === 'error'
    ? commsTheme.error
    : relayReady
      ? commsTheme.relayReady
      : activeChannel
        ? commsTheme.text
        : commsTheme.textDim;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: commsTheme.bg,
          border: `1px solid ${relayReady ? commsTheme.relayReadyBorder : commsTheme.border}`,
          borderRadius: 1.5,
          backgroundImage: 'none',
          maxWidth: 960,
          width: '100%',
          transition: 'border-color 0.3s',
        },
      }}
    >
      <Box sx={{ px: 2, pt: 1.5, pb: 2, position: 'relative' }}>
        <IconButton
          size="small"
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: 8, color: commsTheme.textDim }}
          aria-label="Close voice comms"
        >
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>

        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 2, pr: 4 }}>
          <Box>
            <Typography sx={{ fontFamily: COMMS_MONO, fontSize: '0.48rem', letterSpacing: '2.5px', color: commsTheme.textDim }}>
              COMMS ARRAY · VOICE LINK
            </Typography>
            <Typography sx={{ fontFamily: COMMS_MONO, fontSize: '0.72rem', fontWeight: 700, color: commsTheme.text }}>
              Secure Voice Channel
            </Typography>
          </Box>
          <Typography sx={{
            fontFamily: COMMS_MONO,
            fontSize: '0.58rem',
            letterSpacing: '1px',
            color: headerStatusColor,
          }}>
            {status}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1.5 }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={inputMode}
            onChange={(_, value: InputMode | null) => {
              if (!value || value === inputMode) return;
              session.cancel();
              setInputMode(value);
            }}
            disabled={!commsReady}
            sx={{
              '& .MuiToggleButton-root': {
                fontFamily: COMMS_MONO,
                fontSize: '0.52rem',
                letterSpacing: '1px',
                color: commsTheme.textDim,
                borderColor: commsTheme.border,
                px: 2.5,
                py: 0.5,
                '&.Mui-selected': {
                  bgcolor: commsTheme.panelActive,
                  color: commsTheme.text,
                  borderColor: commsTheme.borderActive,
                },
              },
            }}
          >
            <ToggleButton value="push-to-talk">PUSH-TO-TALK</ToggleButton>
            <ToggleButton value="duplex">HANDS-FREE</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 0.55fr 1fr', gap: 1.5, mb: 1.5 }}>
          <CommsPanel codename="CHANNEL A" title="Operator" active={activeChannel === 'operator'}>
            <VoiceWaveform
              level={session.audioLevel}
              active={activeChannel === 'operator'}
              accent={commsTheme.operator}
            />
            {showOperatorText && (
              <Typography sx={{
                mt: 1,
                fontFamily: COMMS_MONO,
                fontSize: '0.58rem',
                color: commsTheme.textSecondary,
                lineHeight: 1.45,
                wordBreak: 'break-word',
                maxHeight: 64,
                overflow: 'auto',
              }}>
                {operatorText}
              </Typography>
            )}
            {activeChannel === 'operator' && !operatorText && isDuplex && (
              <Typography sx={{ mt: 1, fontFamily: COMMS_MONO, fontSize: '0.55rem', color: commsTheme.textDim }}>
                Listening — pause 5 s when done to send
              </Typography>
            )}
            {activeChannel === 'operator' && !operatorText && !isDuplex && (
              <Typography sx={{ mt: 1, fontFamily: COMMS_MONO, fontSize: '0.55rem', color: commsTheme.textDim }}>
                Speak now — audio is being captured
              </Typography>
            )}
            {commsReady && !session.holding && session.state !== 'listening' && (
              <Typography sx={{ mt: 1, fontFamily: COMMS_MONO, fontSize: '0.5rem', color: commsTheme.textDim }}>
                Awaiting transmission
              </Typography>
            )}
          </CommsPanel>

          <CommsPanel
            codename="RELAY"
            title={relayReady ? 'Link Status' : 'Processing'}
            active={activeChannel === 'relay' && !relayReady}
            ready={relayReady}
          >
            {bootPhase === 'booting' && (
              <>
                <RelayPulse active />
                <Typography sx={{ textAlign: 'center', fontFamily: COMMS_MONO, fontSize: '0.55rem', color: commsTheme.textDim }}>
                  Warming STT / TTS engines…
                </Typography>
              </>
            )}
            {bootPhase === 'failed' && (
              <Typography sx={{ textAlign: 'center', fontFamily: COMMS_MONO, fontSize: '0.55rem', color: commsTheme.error, lineHeight: 1.45 }}>
                {friendlyVoiceError(bootError ?? 'Voice engine offline')}
              </Typography>
            )}
            {relayReady && (
              <RelayReadyPanel health={sidecarHealth} wsLinked={wsLinked} />
            )}
            {!relayReady && bootPhase === 'ready' && session.state === 'connecting' && (
              <>
                <RelayPulse active />
                <Typography sx={{ textAlign: 'center', fontFamily: COMMS_MONO, fontSize: '0.55rem', color: commsTheme.textDim }}>
                  Opening secure session…
                </Typography>
              </>
            )}
            {!relayReady && bootPhase === 'ready' && session.state === 'processing' && (
              <>
                <RelayPulse active />
                <Typography sx={{ textAlign: 'center', fontFamily: COMMS_MONO, fontSize: '0.55rem', color: commsTheme.textSecondary }}>
                  {session.agentStatus || 'Transcribing & routing'}
                </Typography>
              </>
            )}
          </CommsPanel>

          <CommsPanel codename="CHANNEL B" title="Agent" active={activeChannel === 'agent'}>
            <VoiceWaveform
              level={session.playbackLevel}
              active={activeChannel === 'agent'}
              accent={commsTheme.agent}
            />
            {session.agentText && (
              <Typography sx={{
                mt: 1,
                fontFamily: COMMS_MONO,
                fontSize: '0.58rem',
                color: commsTheme.agent,
                lineHeight: 1.45,
                wordBreak: 'break-word',
                maxHeight: 64,
                overflow: 'auto',
              }}>
                {session.agentText}
              </Typography>
            )}
            {activeChannel === 'agent' && !session.agentText && (
              <Typography sx={{ mt: 1, fontFamily: COMMS_MONO, fontSize: '0.55rem', color: commsTheme.textDim }}>
                Playing response audio…
              </Typography>
            )}
            {commsReady && session.state !== 'speaking' && !session.agentText && (
              <Typography sx={{ mt: 1, fontFamily: COMMS_MONO, fontSize: '0.5rem', color: commsTheme.textDim }}>
                Standing by
              </Typography>
            )}
          </CommsPanel>
        </Box>

        <Box sx={{ px: 2, mb: 1 }}>
          <VoiceActivityLog key={turnEpoch} entries={activityLog} visible={showMissionLog} />
          {session.permissionPrompt && (
            <VoicePermissionCard
              prompt={session.permissionPrompt}
              onRespond={session.respondToPermission}
            />
          )}
          <DuplexSilenceProgress progress={session.silenceProgress} visible={showSilenceBar} />
          <VoiceTurnTimingsBar timings={session.voiceTimings} mono={COMMS_MONO} />
        </Box>

        <Typography sx={{
          textAlign: 'center',
          fontSize: '0.58rem',
          color: bootPhase === 'failed' ? commsTheme.error : commsTheme.textDim,
          fontFamily: COMMS_MONO,
        }}>
          {footerHint}
        </Typography>

        {session.error && bootPhase === 'ready' && (
          <Typography sx={{
            textAlign: 'center',
            fontSize: '0.58rem',
            color: commsTheme.error,
            mt: 1,
            fontFamily: COMMS_MONO,
            lineHeight: 1.45,
          }}>
            {friendlyVoiceError(session.error)}
          </Typography>
        )}
      </Box>
    </Dialog>
  );
}
