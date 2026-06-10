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
    text: { primary: '#ffffff', secondary: '#aaaaaa', disabled: '#656565' },
    divider: '#2a2a2a',
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
    body2: { fontSize: '0.8125rem', lineHeight: 1.5, color: '#8b8b8b' },
    caption: { fontSize: '0.72rem', color: '#656565' },
    overline: { fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', letterSpacing: '3px', textTransform: 'uppercase' as const, color: '#656565' },
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
        '::-webkit-scrollbar-thumb': { background: '#3a3a3a', borderRadius: '3px' },
        '::-webkit-scrollbar-thumb:hover': { background: '#656565' },
        '.MuiDialogContent-root::-webkit-scrollbar': { display: 'none' },
        '.MuiModal-root *::-webkit-scrollbar': { display: 'none' },
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
        tooltip: { backgroundColor: '#242424', border: '1px solid #3a3a3a', fontSize: '0.72rem', fontFamily: "'JetBrains Mono', monospace" },
      },
    },
    MuiTextField: {
      defaultProps: { size: 'small', variant: 'outlined' },
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            '& fieldset': { borderColor: '#3a3a3a' },
            '&:hover fieldset': { borderColor: '#4a4a4a' },
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
  bg: { primary: '#000000', secondary: '#0a0a0a', tertiary: '#1a1a1a', elevated: '#1a1a1a', surface: '#0a0a0a', hover: '#242424' },
  border: { subtle: '#202020', default: '#2a2a2a', strong: '#3a3a3a', accent: '#484848' },
  text: { primary: '#ffffff', secondary: '#aaaaaa', tertiary: '#8b8b8b', dim: '#656565', muted: '#757575' },
  accent: { blue: '#58a6ff', green: '#3fb950', orange: '#d29922', red: '#f85149', purple: '#bc8cff', cyan: '#39d353' },
} as const;
