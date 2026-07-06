import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import IconButton from '@mui/material/IconButton';
import StopIcon from '@mui/icons-material/Stop';
import { useEffect } from 'react';
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

  const capturedText = comms.session.partialTranscript || comms.session.finalTranscript;

  return (
    <Box sx={{ px: 1.25, py: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={comms.inputMode}
          onChange={(_, value: 'push-to-talk' | 'duplex' | null) => {
            if (!value || value === comms.inputMode) return;
            comms.session.cancel();
            comms.setInputMode(value);
          }}
          disabled={!comms.commsReady}
          sx={{
            '& .MuiToggleButton-root': {
              fontSize: '0.52rem',
              py: 0.25,
              px: 1,
              textTransform: 'none',
              borderColor: colors.border.default,
              color: colors.text.dim,
              '&.Mui-selected': {
                bgcolor: colors.bg.tertiary,
                color: colors.text.primary,
              },
            },
          }}
        >
          <ToggleButton value="push-to-talk">Push-to-talk</ToggleButton>
          <ToggleButton value="duplex">Hands-free</ToggleButton>
        </ToggleButtonGroup>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <Box sx={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            flexShrink: 0,
            bgcolor: comms.commsReady && comms.micReady
              ? colors.accent.green
              : comms.bootPhase === 'booting'
                ? colors.accent.orange
                : colors.text.dim,
          }} />
          <Typography sx={{
            fontSize: '0.55rem',
            color: colors.text.secondary,
            fontFamily: "'JetBrains Mono', monospace",
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {comms.statusLabel}
          </Typography>
          {(comms.session.state === 'speaking' || comms.session.state === 'processing') && (
            <IconButton
              size="small"
              onClick={() => comms.session.interruptPlayback()}
              sx={{ p: 0.25, color: colors.text.dim }}
              aria-label="Stop playback"
            >
              <StopIcon sx={{ fontSize: 14 }} />
            </IconButton>
          )}
        </Box>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75, mb: 0.35 }}>
        <Box sx={{
          px: 0.75,
          py: 0.5,
          borderRadius: 1,
          bgcolor: colors.bg.secondary,
          border: `1px solid ${comms.operatorActive ? colors.accent.green + '55' : colors.border.default}`,
        }}>
          <Typography sx={{ fontSize: '0.44rem', color: colors.text.tertiary, mb: 0.35, pl: 0.15, letterSpacing: '0.8px', lineHeight: 1 }}>
            YOU
          </Typography>
          <VoiceWaveform
            level={comms.session.audioLevel}
            active={comms.operatorActive}
            accent={colors.accent.green}
            height={22}
            bars={14}
          />
          {capturedText ? (
            <Typography sx={{
              fontSize: '0.48rem',
              color: colors.text.secondary,
              mt: 0.3,
              lineHeight: 1.35,
              wordBreak: 'break-word',
              maxHeight: 48,
              overflow: 'auto',
            }}>
              {capturedText}
            </Typography>
          ) : null}
          {!comms.isDuplex && comms.commsReady && comms.micReady && !capturedText && (
            <Typography sx={{
              fontSize: '0.42rem',
              color: colors.text.dim,
              mt: 0.25,
              lineHeight: 1.25,
              textAlign: 'center',
            }}>
              Hold Space to talk · release to send
            </Typography>
          )}
        </Box>
        <Box sx={{
          px: 0.75,
          py: 0.5,
          borderRadius: 1,
          bgcolor: colors.bg.secondary,
          border: `1px solid ${comms.agentActive ? colors.accent.green + '55' : colors.border.default}`,
        }}>
          <Typography sx={{ fontSize: '0.44rem', color: colors.text.tertiary, mb: 0.35, pl: 0.15, letterSpacing: '0.8px', lineHeight: 1 }}>
            AGENT
          </Typography>
          <VoiceWaveform
            level={comms.session.playbackLevel}
            active={comms.agentActive}
            accent={colors.accent.green}
            height={22}
            bars={14}
          />
        </Box>
      </Box>

      <DuplexSilenceProgress progress={comms.session.silenceProgress} visible={showSilenceBar} compact />

      {comms.session.error && (
        <Typography sx={{ fontSize: '0.52rem', color: colors.accent.red, mt: 0.5 }}>
          {friendlyVoiceError(comms.session.error)}
        </Typography>
      )}
    </Box>
  );
}
