import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { alphaColor } from '../../theme';
import { callTheme } from './crew-call-theme';

export interface CallTranscriptDividerProps {
  label: string;
  /** 'daytime' | 'time' for segment markers; 'duration' for total call length. */
  variant?: 'daytime' | 'time' | 'duration';
  /** Override accent (e.g. history panel uses app theme). */
  mutedColor?: string;
  lineColor?: string;
  monoFont?: string;
}

/** Centered rule + label used between transcript messages. */
export function CallTranscriptDivider({
  label,
  variant = 'daytime',
  mutedColor = callTheme.text.dim,
  lineColor = callTheme.border.faint,
  monoFont = callTheme.mono,
}: CallTranscriptDividerProps) {
  const isDuration = variant === 'duration';
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        py: isDuration ? 0.85 : 0.55,
        my: isDuration ? 0.35 : 0.15,
        userSelect: 'none',
      }}
    >
      <Box sx={{ flex: 1, height: '1px', bgcolor: lineColor }} />
      <Typography
        sx={{
          fontFamily: monoFont,
          fontSize: isDuration ? '0.52rem' : '0.48rem',
          letterSpacing: isDuration ? '0.1em' : '0.08em',
          fontWeight: isDuration ? 600 : 500,
          color: isDuration ? alphaColor(mutedColor, 0.95) : mutedColor,
          textTransform: isDuration ? 'uppercase' : 'none',
          whiteSpace: 'nowrap',
          px: 0.25,
        }}
      >
        {label}
      </Typography>
      <Box sx={{ flex: 1, height: '1px', bgcolor: lineColor }} />
    </Box>
  );
}
