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
import { phaseActiveChannel, resolveCommsPhase } from './voice-comms-phase';
import { CommsEllipsis, CommsSpinner } from './CommsSpinner';
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

type InputMode = 'push-to-talk' | 'duplex';

function phaseStatusLabel(phase: ReturnType<typeof resolveCommsPhase>, agentStatus: string): string {
  switch (phase) {
    case 'boot': return 'INITIALIZING';
    case 'link': return 'LINKING COMMS';
    case 'standby': return 'COMMS READY';
    case 'operator_record': return 'UPLINK · LIVE';
    case 'operator_stt': return 'DECODING SIGNAL';
    case 'relay_process': return agentStatus ? agentStatus.toUpperCase() : 'RELAY · PROCESSING';
    case 'agent_prep': return 'SYNTHESIZING VOICE';
    case 'agent_tx': return 'DOWNLINK · LIVE';
    default: return 'STANDBY';
  }
}

function CommsPanel({
  codename,
  title,
  active,
  ready,
  accent,
  children,
}: {
  codename: string;
  title: string;
  active: boolean;
  ready?: boolean;
  accent?: string;
  children: ReactNode;
}) {
  const border = ready ? commsTheme.relayReadyBorder : active ? commsTheme.borderActive : commsTheme.border;
  const bg = ready ? commsTheme.relayReadyBg : active ? commsTheme.panelActive : commsTheme.panel;
  const tick = accent ?? (ready ? commsTheme.relayReady : active ? commsTheme.text : commsTheme.border);

  return (
    <Box sx={{
      p: 1.5,
      borderRadius: 1,
      border: `1px solid ${border}`,
      bgcolor: bg,
      minHeight: 168,
      display: 'flex',
      flexDirection: 'column',
      transition: 'border-color 0.3s, background-color 0.3s, box-shadow 0.3s',
      position: 'relative',
      overflow: 'hidden',
      boxShadow: active
        ? `0 0 20px ${accent ? `${accent}18` : 'rgba(255,255,255,0.04)'}`
        : ready ? `0 0 24px ${commsTheme.relayReadyBg}` : 'none',
      '&::before': active || ready ? {
        content: '""',
        position: 'absolute',
        inset: 0,
        background: ready
          ? 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(34,197,94,0.04) 2px, rgba(34,197,94,0.04) 4px)'
          : 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,0.015) 3px, rgba(255,255,255,0.015) 6px)',
        pointerEvents: 'none',
        animation: active && !ready ? 'commsScan 4s linear infinite' : 'none',
        '@keyframes commsScan': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
      } : undefined,
      '& .comms-corner': {
        position: 'absolute',
        width: 7,
        height: 7,
        borderColor: tick,
        borderStyle: 'solid',
        opacity: active || ready ? 0.7 : 0.25,
        transition: 'opacity 0.3s',
        pointerEvents: 'none',
        zIndex: 2,
      },
    }}>
      <Box className="comms-corner" sx={{ top: 5, left: 5, borderWidth: '1px 0 0 1px' }} />
      <Box className="comms-corner" sx={{ top: 5, right: 5, borderWidth: '1px 1px 0 0' }} />
      <Box className="comms-corner" sx={{ bottom: 5, left: 5, borderWidth: '0 0 1px 1px' }} />
      <Box className="comms-corner" sx={{ bottom: 5, right: 5, borderWidth: '0 1px 1px 0' }} />
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

  const operatorText = (session.finalTranscript || session.partialTranscript || session.transcript).trim();
  const commsPhase = resolveCommsPhase({
    bootPhase,
    commsReady,
    state: session.state,
    holding: session.holding,
    isDuplex,
    operatorText,
    agentText: session.agentText,
    playbackLevel: session.playbackLevel,
  });
  const activeChannel = phaseActiveChannel(commsPhase);
  const relayReady = commsPhase === 'standby';
  const status = bootPhase === 'failed' || session.state === 'error'
    ? 'SIGNAL LOST'
    : phaseStatusLabel(commsPhase, session.agentStatus);

  const operatorWaves = commsPhase === 'operator_record';
  const operatorStt = commsPhase === 'operator_stt';
  const agentWaves = commsPhase === 'agent_tx';
  const agentPrep = commsPhase === 'agent_prep';
  const showOperatorText = Boolean(operatorText) && commsPhase !== 'operator_record';

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
      : activeChannel === 'operator'
        ? commsTheme.operator
        : activeChannel === 'agent'
          ? commsTheme.agent
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
          <CommsPanel
            codename="CHANNEL A"
            title="Operator"
            active={activeChannel === 'operator'}
            accent={commsTheme.operator}
          >
            {operatorWaves && (
              <VoiceWaveform
                level={session.audioLevel}
                active
                accent={commsTheme.operator}
              />
            )}
            {operatorStt && (
              <Box sx={{ py: 1 }}>
                <CommsSpinner color={commsTheme.operator} />
                <Typography sx={{ mt: 1, textAlign: 'center', fontFamily: COMMS_MONO, fontSize: '0.52rem', color: commsTheme.operator, letterSpacing: '1px' }}>
                  DECODING UPLINK
                </Typography>
                <CommsEllipsis color={commsTheme.operator} />
              </Box>
            )}
            {!operatorWaves && !operatorStt && (
              <VoiceWaveform
                level={0}
                active={false}
                accent={commsTheme.operator}
                height={40}
              />
            )}
            {showOperatorText && (
              <Typography sx={{
                mt: operatorWaves || operatorStt ? 1 : 0.5,
                fontFamily: COMMS_MONO,
                fontSize: '0.58rem',
                color: commsTheme.operator,
                lineHeight: 1.45,
                wordBreak: 'break-word',
                maxHeight: 72,
                overflow: 'auto',
                borderLeft: `2px solid ${commsTheme.operator}55`,
                pl: 1,
              }}>
                {operatorText}
              </Typography>
            )}
            {commsPhase === 'operator_record' && !showOperatorText && (
              <Typography sx={{ mt: 1, fontFamily: COMMS_MONO, fontSize: '0.52rem', color: commsTheme.textDim, textAlign: 'center' }}>
                {isDuplex ? 'Transmit · pause 5 s to send' : 'Channel open — speak now'}
              </Typography>
            )}
            {commsPhase === 'standby' && (
              <Typography sx={{ mt: 1, fontFamily: COMMS_MONO, fontSize: '0.5rem', color: commsTheme.textDim, textAlign: 'center' }}>
                Awaiting transmission
              </Typography>
            )}
          </CommsPanel>

          <CommsPanel
            codename="RELAY"
            title={relayReady ? 'Link Status' : 'Mission Relay'}
            active={activeChannel === 'relay' && !relayReady}
            ready={relayReady}
            accent={commsTheme.relayReady}
          >
            {commsPhase === 'boot' && (
              <>
                <CommsSpinner color={commsTheme.textDim} />
                <Typography sx={{ textAlign: 'center', fontFamily: COMMS_MONO, fontSize: '0.52rem', color: commsTheme.textDim, mt: 1 }}>
                  Warming STT / TTS engines…
                </Typography>
              </>
            )}
            {commsPhase === 'link' && (
              <>
                <RelayPulse active />
                <Typography sx={{ textAlign: 'center', fontFamily: COMMS_MONO, fontSize: '0.52rem', color: commsTheme.textDim, mt: 0.5 }}>
                  {session.state === 'connecting' ? 'Opening secure session…' : 'Establishing link…'}
                </Typography>
              </>
            )}
            {bootPhase === 'failed' && (
              <Typography sx={{ textAlign: 'center', fontFamily: COMMS_MONO, fontSize: '0.52rem', color: commsTheme.error, lineHeight: 1.45 }}>
                {friendlyVoiceError(bootError ?? 'Voice engine offline')}
              </Typography>
            )}
            {relayReady && (
              <RelayReadyPanel health={sidecarHealth} wsLinked={wsLinked} />
            )}
            {commsPhase === 'relay_process' && (
              <Box sx={{ textAlign: 'center', py: 0.5 }}>
                <CommsSpinner color={commsTheme.text} />
                <Typography sx={{ fontFamily: COMMS_MONO, fontSize: '0.55rem', fontWeight: 700, color: commsTheme.text, letterSpacing: '1px', mt: 1 }}>
                  AGENT RELAY
                </Typography>
                <Typography sx={{ fontFamily: COMMS_MONO, fontSize: '0.5rem', color: commsTheme.textDim, mt: 0.5 }}>
                  {session.agentStatus || 'Processing request'}
                </Typography>
                <CommsEllipsis />
              </Box>
            )}
          </CommsPanel>

          <CommsPanel
            codename="CHANNEL B"
            title="Agent"
            active={activeChannel === 'agent'}
            accent={commsTheme.agent}
          >
            {agentWaves && (
              <VoiceWaveform
                level={session.playbackLevel}
                active
                accent={commsTheme.agent}
              />
            )}
            {agentPrep && (
              <Box sx={{ py: 1 }}>
                <CommsSpinner color={commsTheme.agent} />
                <Typography sx={{ mt: 1, textAlign: 'center', fontFamily: COMMS_MONO, fontSize: '0.52rem', color: commsTheme.agent, letterSpacing: '1px' }}>
                  VOICE SYNTHESIS
                </Typography>
                <CommsEllipsis color={commsTheme.agent} />
              </Box>
            )}
            {!agentWaves && !agentPrep && (
              <VoiceWaveform
                level={0}
                active={false}
                accent={commsTheme.agent}
                height={40}
              />
            )}
            {session.agentText && (
              <Typography sx={{
                mt: agentWaves || agentPrep ? 1 : 0.5,
                fontFamily: COMMS_MONO,
                fontSize: '0.58rem',
                color: commsTheme.agent,
                lineHeight: 1.45,
                wordBreak: 'break-word',
                maxHeight: 72,
                overflow: 'auto',
                borderLeft: `2px solid ${commsTheme.agent}55`,
                pl: 1,
              }}>
                {session.agentText}
              </Typography>
            )}
            {commsPhase === 'standby' && !session.agentText && (
              <Typography sx={{ mt: 1, fontFamily: COMMS_MONO, fontSize: '0.5rem', color: commsTheme.textDim, textAlign: 'center' }}>
                Standing by
              </Typography>
            )}
          </CommsPanel>
        </Box>

        <Box sx={{ mb: 1 }}>
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
