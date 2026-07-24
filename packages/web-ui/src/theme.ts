import { createTheme, type CssVarsThemeOptions } from '@mui/material/styles';

/**
 * Agent-X design tokens — dual-scheme (dark/light) via CSS variables.
 *
 * Components consume `colors.*` (stable var() references) so switching the
 * `data-ax-scheme` attribute restyles the whole app without a React re-render.
 * Use `alphaColor(token, alpha)` instead of hex-suffix concatenation.
 */

export const MONO = "'JetBrains Mono', monospace" as const;

/** Shared width for Calls / Automations / Markdown side list columns. */
export const PANEL_SIDE_LIST_WIDTH = 280;

/** Raw channel values per scheme. Single source of truth. */
const SCHEMES = {
  dark: {
    'bg-primary': '#030308',
    'bg-secondary': '#0a0a12',
    'bg-tertiary': '#12121c',
    'bg-hover': '#1c1c28',
    'border-subtle': '#181822',
    'border-default': '#242432',
    'border-strong': '#343448',
    'border-accent': '#484860',
    'text-primary': '#f2f3f7',
    'text-secondary': '#b4b8c4',
    'text-tertiary': '#8b90a0',
    'text-dim': '#656878',
    'text-muted': '#757a8a',
    'accent-blue': '#7dd3fc',
    'accent-green': '#4ade80',
    'accent-orange': '#fbbf24',
    'accent-red': '#f87171',
    'accent-purple': '#c4b5fd',
    'accent-cyan': '#67e8f9',
    ink: '#ffffff',
    'shadow-heavy': 'rgba(0, 0, 0, 0.78)',
    'scrollbar-thumb': '#343448',
    'scrollbar-thumb-hover': '#656878',
  },
  light: {
    'bg-primary': '#f0f2f5',
    'bg-secondary': '#ffffff',
    'bg-tertiary': '#e8eaef',
    'bg-hover': '#dfe2e8',
    'border-subtle': '#e4e7ec',
    'border-default': '#d4d8e0',
    'border-strong': '#bcc2cc',
    'border-accent': '#a2aab6',
    'text-primary': '#0f1117',
    'text-secondary': '#3d4450',
    'text-tertiary': '#565e6c',
    'text-dim': '#7a828e',
    'text-muted': '#6c737f',
    'accent-blue': '#0969da',
    'accent-green': '#1a7f37',
    'accent-orange': '#9a6700',
    'accent-red': '#cf222e',
    'accent-purple': '#8250df',
    'accent-cyan': '#1b7c83',
    ink: '#0f1117',
    'shadow-heavy': 'rgba(15, 20, 30, 0.16)',
    'scrollbar-thumb': '#c4cad1',
    'scrollbar-thumb-hover': '#9aa1ab',
  },
} as const;

type TokenName = keyof typeof SCHEMES.dark;

const v = (name: TokenName) => `var(--ax-${name})`;

function schemeVars(scheme: keyof typeof SCHEMES): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(SCHEMES[scheme])) out[`--ax-${key}`] = value;
  return out;
}

/**
 * Color tokens for direct use in sx/styles. Values are CSS var() references —
 * they resolve per active scheme with zero JS cost on switch.
 */
export const colors = {
  bg: {
    primary: v('bg-primary'),
    secondary: v('bg-secondary'),
    tertiary: v('bg-tertiary'),
    elevated: v('bg-tertiary'),
    surface: v('bg-secondary'),
    hover: v('bg-hover'),
  },
  border: {
    subtle: v('border-subtle'),
    default: v('border-default'),
    strong: v('border-strong'),
    accent: v('border-accent'),
  },
  text: {
    primary: v('text-primary'),
    secondary: v('text-secondary'),
    tertiary: v('text-tertiary'),
    dim: v('text-dim'),
    muted: v('text-muted'),
  },
  accent: {
    blue: v('accent-blue'),
    green: v('accent-green'),
    orange: v('accent-orange'),
    red: v('accent-red'),
    purple: v('accent-purple'),
    cyan: v('accent-cyan'),
  },
  /** Neutral foreground channel — use for tints that must flip with the scheme. */
  ink: v('ink'),
  shadow: { heavy: v('shadow-heavy') },
} as const;

/**
 * Scheme-aware replacement for hex-alpha concatenation.
 * alphaColor(colors.accent.blue, 0.13) ≈ old `${blue}22`.
 * Accepts 0–1 numbers or legacy 2-char hex suffixes ('22', '66', ...).
 */
export function alphaColor(color: string, alpha: number | string): string {
  const ratio = typeof alpha === 'number' ? alpha : parseInt(alpha, 16) / 255;
  const pct = Math.round(Math.min(Math.max(ratio, 0), 1) * 100);
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

/**
 * Resolve a `var(--ax-*)` token to its current raw value (hex/rgba string).
 * Needed for canvas 2D contexts, which cannot parse CSS var() references.
 */
export function resolveColor(color: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(color.trim());
  if (!m) return color;
  return getComputedStyle(document.documentElement).getPropertyValue(m[1]!).trim() || color;
}

/** Active visual scheme from `data-ax-scheme` (falls back to dark). */
export function getActiveScheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-ax-scheme') === 'light' ? 'light' : 'dark';
}

export function isLightScheme(): boolean {
  return getActiveScheme() === 'light';
}

/** Parse a resolved color into RGB channels for canvas drawing. */
export function resolveRgb(color: string): { r: number; g: number; b: number } {
  const raw = resolveColor(color).trim();
  const hex6 = /^#([0-9a-f]{6})$/i.exec(raw);
  if (hex6) {
    const n = parseInt(hex6[1]!, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const hex3 = /^#([0-9a-f]{3})$/i.exec(raw);
  if (hex3) {
    const [a, b, c] = hex3[1]!.split('');
    return {
      r: parseInt(a! + a!, 16),
      g: parseInt(b! + b!, 16),
      b: parseInt(c! + c!, 16),
    };
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(raw);
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  }
  return { r: 120, g: 120, b: 130 };
}

export function resolveRgba(color: string, alpha: number): string {
  const { r, g, b } = resolveRgb(color);
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

const themeOptions: CssVarsThemeOptions & Parameters<typeof createTheme>[0] = {
  cssVariables: { colorSchemeSelector: 'data-ax-scheme' },
  colorSchemes: {
    dark: {
      palette: {
        primary: { main: '#f2f3f7', dark: '#cccccc', contrastText: '#030308' },
        secondary: { main: '#7dd3fc' },
        background: { default: '#030308', paper: '#0a0a12' },
        text: { primary: '#f2f3f7', secondary: '#b4b8c4', disabled: '#656878' },
        divider: '#242432',
        error: { main: '#f87171' },
        warning: { main: '#fbbf24' },
        success: { main: '#4ade80' },
        info: { main: '#7dd3fc' },
      },
    },
    light: {
      palette: {
        primary: { main: '#0f1117', dark: '#000000', contrastText: '#ffffff' },
        secondary: { main: '#0969da' },
        background: { default: '#f0f2f5', paper: '#ffffff' },
        text: { primary: '#0f1117', secondary: '#3d4450', disabled: '#9aa1ab' },
        divider: '#d4d8e0',
        error: { main: '#cf222e' },
        warning: { main: '#9a6700' },
        success: { main: '#1a7f37' },
        info: { main: '#0969da' },
      },
    },
  },
  typography: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    fontSize: 12,
    h1: { fontFamily: MONO, fontWeight: 700, letterSpacing: '6px', fontSize: 'clamp(2rem, 6vw, 3.2rem)' },
    h2: { fontFamily: MONO, fontWeight: 700, letterSpacing: '2px', fontSize: '1.25rem' },
    h3: { fontFamily: MONO, fontWeight: 700, fontSize: '1rem', letterSpacing: '1.5px' },
    h4: { fontSize: '0.92rem', fontWeight: 600 },
    h5: { fontSize: '0.85rem', fontWeight: 600 },
    h6: { fontSize: '0.78rem', fontWeight: 500 },
    body1: { fontSize: '0.8125rem', lineHeight: 1.55 },
    body2: { fontSize: '0.75rem', lineHeight: 1.45, color: v('text-tertiary') },
    caption: { fontSize: '0.68rem', color: v('text-dim') },
    overline: { fontFamily: MONO, fontSize: '0.68rem', letterSpacing: '2.5px', textTransform: 'uppercase' as const, color: v('text-dim') },
  },
  shape: { borderRadius: 6 },
  spacing: 7,
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        ':root': schemeVars('dark'),
        '[data-ax-scheme="light"]': schemeVars('light'),
        'html, body, #root': { height: '100%', width: '100%', overflow: 'hidden' },
        body: {
          backgroundColor: v('bg-primary'),
          color: v('text-primary'),
          WebkitFontSmoothing: 'antialiased',
        },
        '::selection': { background: v('ink'), color: v('bg-primary') },
        // Hide scrollbars everywhere while keeping overflow scrollable.
        '*': {
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        },
        '*::-webkit-scrollbar': {
          display: 'none',
          width: 0,
          height: 0,
          background: 'transparent',
        },
      },
    },
    MuiCollapse: {
      defaultProps: {
        timeout: { enter: 280, exit: 220 },
      },
    },
    MuiAccordion: {
      defaultProps: {
        TransitionProps: { timeout: { enter: 280, exit: 220 } },
      },
    },
    MuiButton: {      defaultProps: { size: 'small' },
      styleOverrides: {
        root: {
          textTransform: 'none', fontFamily: MONO, fontWeight: 500, borderRadius: 5,
          fontSize: '0.78rem', letterSpacing: '0.4px', minHeight: 28, padding: '4px 12px',
        },
        sizeMedium: { minHeight: 32, padding: '6px 14px', fontSize: '0.8125rem' },
      },
    },
    MuiIconButton: {
      defaultProps: { size: 'small' },
      styleOverrides: { root: { padding: 6 } },
    },
    MuiPaper: {
      styleOverrides: { root: { backgroundImage: 'none' } },
    },
    MuiMenuItem: {
      styleOverrides: { root: { fontSize: '0.78rem', minHeight: 32, paddingTop: 4, paddingBottom: 4 } },
    },
    MuiListItemButton: {
      styleOverrides: { root: { paddingTop: 6, paddingBottom: 6 } },
    },
    MuiDialogTitle: {
      styleOverrides: { root: { fontSize: '0.85rem', fontWeight: 600, padding: '12px 16px' } },
    },
    MuiDialogContent: {
      styleOverrides: { root: { padding: '8px 16px 16px' } },
    },
    MuiTabs: {
      styleOverrides: { root: { minHeight: 36 }, indicator: { height: 2 } },
    },
    MuiTab: {
      styleOverrides: { root: { minHeight: 36, padding: '6px 12px', fontSize: '0.75rem', textTransform: 'none' } },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: v('bg-hover'),
          color: v('text-primary'),
          border: `1px solid ${v('border-strong')}`,
          fontSize: '0.72rem',
          fontFamily: MONO,
        },
      },
    },
    MuiTextField: {
      defaultProps: { size: 'small', variant: 'outlined' },
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            '& fieldset': { borderColor: v('border-strong') },
            '&:hover fieldset': { borderColor: v('border-accent') },
            '&.Mui-focused fieldset': { borderColor: v('accent-blue') },
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: { root: { height: 24, fontSize: '0.7rem', fontFamily: MONO } },
    },
  },
};

export const theme = createTheme(themeOptions);

/** localStorage key for the user's mode preference ('light' | 'dark' | 'system'). */
export const THEME_MODE_STORAGE_KEY = 'agentx-theme-mode';
