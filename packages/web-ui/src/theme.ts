import { createTheme } from '@mui/material/styles';

// Color palette derived from Agent-X landing page
const palette = {
  bg: {
    primary: '#0a0a0a',
    secondary: '#111111',
    elevated: '#161616',
    surface: '#1a1a1a',
    hover: '#222222',
  },
  border: {
    subtle: '#1a1a1a',
    default: '#2a2a2a',
    strong: '#333333',
    accent: '#444444',
  },
  text: {
    primary: '#ffffff',
    secondary: '#b0b0b0',
    tertiary: '#888888',
    dim: '#555555',
  },
  accent: {
    blue: '#58a6ff',
    green: '#3fb950',
    orange: '#d29922',
    red: '#f85149',
    purple: '#bc8cff',
    cyan: '#39d353',
  },
};

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#ffffff' },
    secondary: { main: palette.accent.blue },
    error: { main: palette.accent.red },
    warning: { main: palette.accent.orange },
    success: { main: palette.accent.green },
    background: {
      default: palette.bg.primary,
      paper: palette.bg.secondary,
    },
    text: {
      primary: palette.text.primary,
      secondary: palette.text.secondary,
      disabled: palette.text.dim,
    },
    divider: palette.border.subtle,
  },
  typography: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    fontSize: 13,
    h1: { fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, letterSpacing: '2px' },
    h2: { fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, letterSpacing: '1px' },
    h6: { fontSize: '0.85rem', fontWeight: 600, letterSpacing: '0.5px' },
    body1: { fontSize: '0.875rem', lineHeight: 1.6 },
    body2: { fontSize: '0.8125rem', lineHeight: 1.5 },
    caption: { fontSize: '0.75rem', color: palette.text.tertiary },
    overline: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '0.65rem',
      letterSpacing: '2px',
      textTransform: 'uppercase' as const,
      color: palette.text.dim,
    },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: palette.bg.primary },
        '::-webkit-scrollbar': { width: '6px', height: '6px' },
        '::-webkit-scrollbar-track': { background: 'transparent' },
        '::-webkit-scrollbar-thumb': { background: '#333', borderRadius: '3px' },
        '::-webkit-scrollbar-thumb:hover': { background: '#555' },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          borderColor: palette.border.subtle,
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 500,
          borderRadius: 6,
          fontSize: '0.8125rem',
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: { borderRadius: 6 },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: palette.bg.elevated,
          border: `1px solid ${palette.border.default}`,
          fontSize: '0.75rem',
          fontFamily: "'JetBrains Mono', monospace",
        },
      },
    },
  },
});

export { palette };
