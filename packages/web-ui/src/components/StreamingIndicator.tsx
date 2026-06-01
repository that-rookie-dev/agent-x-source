import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { palette } from '../theme';

export function StreamingIndicator() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, ml: 5 }}>
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        {[0, 1, 2].map((i) => (
          <Box
            key={i}
            sx={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              bgcolor: palette.text.dim,
              animation: 'dotBounce 1.4s ease-in-out infinite',
              animationDelay: `${i * 0.16}s`,
              '@keyframes dotBounce': {
                '0%, 80%, 100%': { transform: 'scale(0.6)', opacity: 0.4 },
                '40%': { transform: 'scale(1)', opacity: 1 },
              },
            }}
          />
        ))}
      </Box>
      <Typography
        sx={{
          fontSize: '0.72rem',
          fontFamily: "'JetBrains Mono', monospace",
          color: palette.text.dim,
          fontStyle: 'italic',
        }}
      >
        Thinking...
      </Typography>
    </Box>
  );
}
