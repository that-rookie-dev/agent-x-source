import Box from '@mui/material/Box';
import { commsTheme } from './voice-comms-theme';

/** Minimal tactical spinner — dashed ring. */
export function CommsSpinner({ color = commsTheme.text, size = 28 }: { color?: string; size?: number }) {
  return (
    <Box
      sx={{
        width: size,
        height: size,
        margin: '0 auto',
        borderRadius: '50%',
        border: `1px dashed ${color}`,
        borderTopColor: 'transparent',
        animation: 'commsSpin 0.9s linear infinite',
        opacity: 0.85,
        '@keyframes commsSpin': {
          to: { transform: 'rotate(360deg)' },
        },
      }}
    />
  );
}

/** Three-dot ellipsis pulse for decode / uplink states. */
export function CommsEllipsis({ color = commsTheme.textDim }: { color?: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0.5, py: 0.5 }}>
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          sx={{
            width: 4,
            height: 4,
            borderRadius: '50%',
            bgcolor: color,
            animation: `commsDot 1.1s ease-in-out ${i * 0.18}s infinite`,
            '@keyframes commsDot': {
              '0%, 80%, 100%': { opacity: 0.2, transform: 'scale(0.8)' },
              '40%': { opacity: 1, transform: 'scale(1)' },
            },
          }}
        />
      ))}
    </Box>
  );
}
