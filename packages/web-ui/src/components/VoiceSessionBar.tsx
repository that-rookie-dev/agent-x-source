import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import StopIcon from '@mui/icons-material/Stop';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import { colors, alphaColor } from '../theme';
import type { VoiceClientState } from '../voice/VoiceSessionClient';
import { VOICE_MAX_TURN_SECONDS } from '../voice/constants';

export interface VoiceSessionBarProps {
  state: VoiceClientState;
  mode: 'push-to-talk' | 'duplex';
  transcript?: string;
  agentStatus?: string;
  recordingSeconds?: number;
  countdownActive?: boolean;
  audioLevel?: number;
  muted?: boolean;
  onMuteToggle?: () => void;
  onStop?: () => void;
  onEndSession?: () => void;
}

function labelForState(state: VoiceClientState): string {
  switch (state) {
    case 'listening': return 'Listening…';
    case 'processing': return 'Transcribing…';
    case 'speaking': return 'Agent speaking…';
    case 'connecting': return 'Connecting voice…';
    case 'error': return 'Voice error';
    case 'ready': return 'Voice ready';
    default: return 'Voice';
  }
}

export function VoiceSessionBar({
  state,
  mode,
  transcript,
  agentStatus,
  recordingSeconds = 0,
  countdownActive = false,
  audioLevel = 0,
  muted = false,
  onMuteToggle,
  onStop,
  onEndSession,
}: VoiceSessionBarProps) {
  if (state === 'idle') return null;

  const modeLabel = mode === 'duplex' ? 'Duplex' : 'Push-to-talk';
  const timerLabel = recordingSeconds > 0
    ? `${recordingSeconds}s${countdownActive ? ` / ${VOICE_MAX_TURN_SECONDS}s` : ''}`
    : null;

  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.25,
        py: 0.75,
        borderTop: `1px solid ${alphaColor(colors.border.default, '20')}`,
        flexWrap: 'wrap',
      }}
    >
      <Chip size="small" label={modeLabel} sx={{ fontSize: '0.55rem', height: 20 }} />
      <Chip
        size="small"
        icon={<MicIcon sx={{ fontSize: 14 }} />}
        label={labelForState(state)}
        sx={{ fontSize: '0.6rem', height: 22 }}
      />
      {timerLabel && (
        <Typography sx={{ fontSize: '0.6rem', color: countdownActive ? colors.accent.orange : colors.text.dim }}>
          {timerLabel}
        </Typography>
      )}
      <Box
        aria-hidden
        sx={{
          width: 72,
          height: 8,
          borderRadius: 1,
          bgcolor: `${alphaColor(colors.border.default, '30')}`,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'flex-end',
          gap: '2px',
          px: '2px',
        }}
      >
        {Array.from({ length: 12 }).map((_, i) => {
          const barLevel = Math.max(0, audioLevel - i * 0.06);
          const h = Math.round(Math.min(1, barLevel * 3) * 100);
          return (
            <Box
              key={i}
              sx={{
                flex: 1,
                height: `${Math.max(12, h)}%`,
                bgcolor: state === 'listening' ? colors.accent.red : colors.accent.blue,
                opacity: muted ? 0.25 : 1,
                transition: 'height 80ms linear',
              }}
            />
          );
        })}
      </Box>
      {(transcript || agentStatus) && (
        <Box sx={{ flex: 1, minWidth: 120, fontSize: '0.65rem', color: colors.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {agentStatus || transcript}
        </Box>
      )}
      {onMuteToggle && (
        <Tooltip title={muted ? 'Unmute mic' : 'Mute mic'} arrow>
          <IconButton size="small" onClick={onMuteToggle} sx={{ p: 0.25, color: muted ? colors.accent.orange : colors.text.dim }}>
            {muted ? <MicOffIcon sx={{ fontSize: 16 }} /> : <MicIcon sx={{ fontSize: 16 }} />}
          </IconButton>
        </Tooltip>
      )}
      {state === 'speaking' && onStop && (
        <Tooltip title="Stop playback" arrow>
          <IconButton size="small" onClick={onStop} sx={{ color: colors.accent.orange, p: 0.25 }}>
            <VolumeOffIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      )}
      {onEndSession && (
        <Tooltip title="End voice session" arrow>
          <IconButton size="small" onClick={onEndSession} sx={{ color: colors.accent.red, p: 0.25 }}>
            <StopIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}
