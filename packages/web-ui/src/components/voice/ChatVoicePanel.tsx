import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import StopIcon from '@mui/icons-material/Stop';
import MicIcon from '@mui/icons-material/Mic';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import { useEffect, useMemo } from 'react';
import { colors } from '../../theme';
import { useVoiceCommsSession } from '../../hooks/useVoiceCommsSession';
import { VoiceWaveform } from './VoiceWaveform';
import { DuplexSilenceProgress } from './DuplexSilenceProgress';
import { friendlyVoiceError } from './voice-comms-theme';

export interface ChatVoicePanelProps {
  chatSessionId: string | null;
  onAgentRunning?: () => void;
  onTranscriptFinal?: (text: string, empty: boolean) => void;
  onVoiceTiming?: (timings: import('../../voice/VoiceSessionClient').VoiceTurnTimings) => void;
  autoStart?: boolean;
  onAutoStartConsumed?: () => void;
}

type WaveMode = 'idle' | 'user' | 'agent';

function resolveWaveMode(operatorActive: boolean, agentActive: boolean): WaveMode {
  if (agentActive) return 'agent';
  if (operatorActive) return 'user';
  return 'idle';
}

const WAVE_ACCENT: Record<WaveMode, string> = {
  idle: colors.text.dim,
  user: colors.accent.green,
  agent: colors.accent.purple,
};

export function ChatVoicePanel({
  chatSessionId,
  onAgentRunning,
  onTranscriptFinal,
  onVoiceTiming,
  autoStart = false,
  onAutoStartConsumed,
}: ChatVoicePanelProps) {
  const comms = useVoiceCommsSession({
    active: Boolean(chatSessionId),
    chatSessionId,
    onAgentRunning,
    onTranscriptFinal,
    onVoiceTiming,
    requestMicOnActivate: true,
  });

  useEffect(() => {
    if (!autoStart || !comms.pttEnabled || comms.isDuplex) return;
    void comms.beginVoice();
    onAutoStartConsumed?.();
  }, [autoStart, comms.pttEnabled, comms.isDuplex, comms.beginVoice, onAutoStartConsumed]);

  const showSilenceBar = comms.isDuplex
    && comms.commsReady
    && comms.session.state === 'listening'
    && comms.session.silenceProgress > 0
    && !comms.session.error;

  const waveMode = resolveWaveMode(comms.operatorActive, comms.agentActive);
  const waveAccent = WAVE_ACCENT[waveMode];
  const waveLevel = useMemo(() => {
    if (waveMode === 'user') return comms.session.audioLevel;
    if (waveMode === 'agent') return comms.session.playbackLevel;
    return 0;
  }, [waveMode, comms.session.audioLevel, comms.session.playbackLevel]);

  const selectInputMode = (mode: 'push-to-talk' | 'duplex') => {
    if (mode === comms.inputMode) return;
    comms.session.cancel();
    comms.setInputMode(mode);
  };

  const modeBtnSx = (selected: boolean) => ({
    width: 28,
    height: 28,
    borderRadius: 1,
    border: `1px solid ${selected ? colors.border.strong : colors.border.default}`,
    bgcolor: selected ? colors.bg.tertiary : 'transparent',
    color: selected ? colors.text.primary : colors.text.dim,
    transition: 'border-color 0.2s, background-color 0.2s, color 0.2s',
    '&:hover': {
      bgcolor: colors.bg.tertiary,
      color: colors.text.secondary,
      borderColor: colors.border.strong,
    },
    '&.Mui-disabled': {
      opacity: 0.35,
      color: colors.text.dim,
    },
  });

  return (
    <Box sx={{ display: 'flex', gap: 0.75, px: 1.25, py: 0.5, alignItems: 'stretch' }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5, minWidth: 0 }}>
          <Box sx={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            flexShrink: 0,
            bgcolor: comms.commsReady && comms.micReady
              ? waveAccent
              : comms.bootPhase === 'booting'
                ? colors.accent.orange
                : colors.text.dim,
            transition: 'background-color 0.25s',
          }} />
          <Typography sx={{
            fontSize: '0.55rem',
            color: colors.text.secondary,
            fontFamily: "'JetBrains Mono', monospace",
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            flex: 1,
          }}>
            {comms.statusLabel}
          </Typography>
          {(comms.session.state === 'speaking' || comms.session.state === 'processing') && (
            <IconButton
              size="small"
              onClick={() => comms.session.interruptPlayback()}
              sx={{ p: 0.25, color: colors.text.dim, flexShrink: 0 }}
              aria-label="Stop playback"
            >
              <StopIcon sx={{ fontSize: 14 }} />
            </IconButton>
          )}
        </Box>

        <Box sx={{
          px: 0.75,
          py: 0.5,
          borderRadius: 1,
          bgcolor: colors.bg.secondary,
          border: `1px solid ${waveMode === 'idle' ? colors.border.default : `${waveAccent}44`}`,
          transition: 'border-color 0.25s',
        }}>
          <VoiceWaveform
            level={waveLevel}
            active={waveMode !== 'idle'}
            accent={waveAccent}
            height={26}
            bars={22}
          />
        </Box>

        <DuplexSilenceProgress progress={comms.session.silenceProgress} visible={showSilenceBar} compact />

        {comms.session.error && (
          <Typography sx={{ fontSize: '0.52rem', color: colors.accent.red, mt: 0.5 }}>
            {friendlyVoiceError(comms.session.error)}
          </Typography>
        )}
      </Box>

      <Box sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        gap: 0.5,
        flexShrink: 0,
        pb: 0.25,
      }}>
        <Tooltip title="Push-to-talk" placement="left" arrow>
          <span>
            <IconButton
              size="small"
              disabled={!comms.commsReady}
              onClick={() => selectInputMode('push-to-talk')}
              aria-label="Push-to-talk"
              aria-pressed={comms.inputMode === 'push-to-talk'}
              sx={modeBtnSx(comms.inputMode === 'push-to-talk')}
            >
              <MicIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Hands-free" placement="left" arrow>
          <span>
            <IconButton
              size="small"
              disabled={!comms.commsReady}
              onClick={() => selectInputMode('duplex')}
              aria-label="Hands-free"
              aria-pressed={comms.inputMode === 'duplex'}
              sx={modeBtnSx(comms.inputMode === 'duplex')}
            >
              <GraphicEqIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}
