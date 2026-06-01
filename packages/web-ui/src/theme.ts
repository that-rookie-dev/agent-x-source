import { createTheme, type ThemeOptions } from '@mui/material/styles';

// Agent-X Space Theme — derived from landing page palette
const themeOptions: ThemeOptions = {
  palette: {
    mode: 'dark',
    primary: { main: '#ffffff', dark: '#cccccc', contrastText: '#000000' },
    secondary: { main: '#58a6ff' },
    error: { main: '#f85149' },
    warning: { main: '#d29922' },
    success: { main: '#3fb950' },
    info: { main: '#58a6ff' },
    background: { default: '#000000', paper: '#0a0a0a' },
    text: { primary: '#ffffff', secondary: '#aaaaaa', disabled: '#555555' },
    divider: '#1a1a1a',
  },
  typography: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    fontSize: 13,
    h1: { fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, letterSpacing: '8px', fontSize: 'clamp(2.5rem, 8vw, 4rem)' },
    h2: { fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, letterSpacing: '3px', fontSize: '1.5rem' },
    h3: { fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: '1.1rem', letterSpacing: '2px' },
    h4: { fontSize: '1rem', fontWeight: 600 },
    h5: { fontSize: '0.9rem', fontWeight: 600 },
    h6: { fontSize: '0.82rem', fontWeight: 500 },
    body1: { fontSize: '0.875rem', lineHeight: 1.6 },
    body2: { fontSize: '0.8125rem', lineHeight: 1.5, color: '#888888' },
    caption: { fontSize: '0.72rem', color: '#555555' },
    overline: { fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', letterSpacing: '3px', textTransform: 'uppercase' as const, color: '#555555' },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        'html, body, #root': { height: '100%', width: '100%', overflow: 'hidden' },
        body: { backgroundColor: '#000000', WebkitFontSmoothing: 'antialiased' },
        '::selection': { background: '#fff', color: '#000' },
        '::-webkit-scrollbar': { width: '6px', height: '6px' },
        '::-webkit-scrollbar-track': { background: 'transparent' },
        '::-webkit-scrollbar-thumb': { background: '#333', borderRadius: '3px' },
        '::-webkit-scrollbar-thumb:hover': { background: '#555' },
      },
    },
    MuiButton: {
      styleOverrides: { root: { textTransform: 'none', fontFamily: "'JetBrains Mono', monospace", fontWeight: 500, borderRadius: 6, fontSize: '0.85rem', letterSpacing: '0.5px' } },
    },
    MuiPaper: {
      styleOverrides: { root: { backgroundImage: 'none' } },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a', fontSize: '0.72rem', fontFamily: "'JetBrains Mono', monospace" },
      },
    },
    MuiTextField: {
      defaultProps: { size: 'small', variant: 'outlined' },
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            '& fieldset': { borderColor: '#2a2a2a' },
            '&:hover fieldset': { borderColor: '#444' },
            '&.Mui-focused fieldset': { borderColor: '#58a6ff' },
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: { root: { height: 24, fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace" } },
    },
  },
};

export const theme = createTheme(themeOptions);

// Exported color tokens for direct use
export const colors = {
  bg: { primary: '#000000', secondary: '#0a0a0a', tertiary: '#111111', elevated: '#111111', surface: '#0a0a0a', hover: '#1a1a1a' },
  border: { subtle: '#111111', default: '#1a1a1a', strong: '#333333', accent: '#444444' },
  text: { primary: '#ffffff', secondary: '#aaaaaa', tertiary: '#888888', dim: '#555555', muted: '#666666' },
  accent: { blue: '#58a6ff', green: '#3fb950', orange: '#d29922', red: '#f85149', purple: '#bc8cff', cyan: '#39d353' },
} as const;
