import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TerminalIcon from '@mui/icons-material/Terminal';
import { palette } from '../theme';

export function WelcomeView() {
  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        px: 4,
      }}
    >
      <TerminalIcon sx={{ fontSize: 48, color: palette.text.dim }} />
      <Typography
        sx={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '1.5rem',
          fontWeight: 700,
          letterSpacing: '4px',
          color: palette.text.primary,
        }}
      >
        AGENT-X
      </Typography>
      <Typography
        variant="body2"
        sx={{ color: palette.text.tertiary, textAlign: 'center', maxWidth: 400 }}
      >
        Your AI wingman. Ask anything — write code, debug issues, research topics, execute commands.
      </Typography>
      <Box sx={{ mt: 3, display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
        {['Write a function', 'Debug this error', 'Explain this code', 'Search the codebase'].map((hint) => (
          <Box
            key={hint}
            sx={{
              px: 1.5,
              py: 0.75,
              border: `1px solid ${palette.border.default}`,
              borderRadius: 1.5,
              fontSize: '0.75rem',
              color: palette.text.tertiary,
              fontFamily: "'JetBrains Mono', monospace",
              cursor: 'default',
              transition: 'border-color 0.2s, color 0.2s',
              '&:hover': { borderColor: palette.border.strong, color: palette.text.secondary },
            }}
          >
            {hint}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
