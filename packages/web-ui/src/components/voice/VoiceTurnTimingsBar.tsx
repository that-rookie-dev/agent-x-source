import Typography from '@mui/material/Typography';
import { colors } from '../../theme';
import { formatVoiceTimingMs, type VoiceTurnTimings } from '../../voice/timing';

export interface VoiceTurnTimingsBarProps {
  timings: VoiceTurnTimings | null;
  compact?: boolean;
  mono?: string;
}

export function VoiceTurnTimingsBar({ timings, compact = false, mono }: VoiceTurnTimingsBarProps) {
  if (!timings) return null;
  const fontFamily = mono ?? "'JetBrains Mono', monospace";
  return (
    <Typography sx={{
      fontSize: compact ? '0.48rem' : '0.55rem',
      color: colors.text.dim,
      fontFamily,
      textAlign: 'center',
      letterSpacing: '0.3px',
      mt: compact ? 0.25 : 0.5,
    }}>
      STT {formatVoiceTimingMs(timings.sttMs)}
      {' · '}
      Think {formatVoiceTimingMs(timings.thinkingMs)}
      {' · '}
      TTS {formatVoiceTimingMs(timings.ttsMs)}
      {' · '}
      Total {formatVoiceTimingMs(timings.totalMs)}
      {!compact && timings.firstAudioMs > 0 && (
        <> · First audio {formatVoiceTimingMs(timings.firstAudioMs)}</>
      )}
    </Typography>
  );
}
