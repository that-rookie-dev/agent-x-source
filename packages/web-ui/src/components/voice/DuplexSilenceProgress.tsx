import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import { colors } from '../../theme';
import { COMMS_MONO } from './voice-comms-theme';

export interface DuplexSilenceProgressProps {
  /** 0–1 progress toward end-of-turn silence threshold. */
  progress: number;
  visible: boolean;
  compact?: boolean;
}

export function DuplexSilenceProgress({ progress, visible, compact = false }: DuplexSilenceProgressProps) {
  if (!visible || progress <= 0) return null;
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);

  return (
    <Box sx={{ mt: compact ? 0.5 : 1, mb: compact ? 0 : 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.35 }}>
        <Typography sx={{
          fontFamily: COMMS_MONO,
          fontSize: compact ? '0.48rem' : '0.52rem',
          color: colors.text.dim,
          letterSpacing: '0.5px',
        }}>
          End-of-turn pause
        </Typography>
        <Typography sx={{
          fontFamily: COMMS_MONO,
          fontSize: compact ? '0.48rem' : '0.52rem',
          color: pct >= 100 ? colors.accent.green : colors.text.secondary,
        }}>
          {pct}%
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{
          height: compact ? 3 : 4,
          borderRadius: 1,
          bgcolor: colors.bg.tertiary,
          '& .MuiLinearProgress-bar': {
            bgcolor: pct >= 100 ? colors.accent.green : colors.accent.cyan,
            transition: 'transform 0.12s linear',
          },
        }}
      />
    </Box>
  );
}
