import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors } from '../theme';

/** Subtle agent-side activity indicator while a turn is still running. */
export function AgentTurnLoader({ label }: { label?: string }) {
  const safeLabel = label?.trim();
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        mb: 2,
        ml: 0.25,
        animation: 'agentx-fadeIn 0.25s ease-out',
      }}
    >
      <Box
        sx={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          bgcolor: colors.accent.blue,
          flexShrink: 0,
          boxShadow: `0 0 6px ${colors.accent.blue}55`,
        }}
      />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {[0, 1, 2].map((i) => (
          <Box
            key={i}
            sx={{
              width: 4,
              height: 4,
              borderRadius: '50%',
              bgcolor: colors.accent.blue,
              animation: 'agentx-pulse 1.4s ease-in-out infinite',
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
        <Typography
          sx={{
            fontSize: '0.58rem',
            color: colors.text.dim,
            fontFamily: "'JetBrains Mono', monospace",
            fontStyle: safeLabel ? 'normal' : 'italic',
            ml: 0.25,
          }}
        >
          {safeLabel || 'Working...'}
        </Typography>
      </Box>
    </Box>
  );
}
