/**
 * Agent-X Space Theme — Centralized color palette.
 * Deep space aesthetic with cyan/purple/green accents.
 */
import { execSync } from 'node:child_process';

export interface SpaceTheme {
  primary: string;
  primaryDim: string;
  accent: string;
  accentDim: string;
  background: string;
  surface: string;
  surfaceHover: string;
  text: string;
  textDim: string;
  textMuted: string;
  border: string;
  borderActive: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  tokenLow: string;
  tokenMedium: string;
  tokenHigh: string;
  tokenGreen: string;
  tokenAmber: string;
  tokenRed: string;
}

const SPACE_THEME_DARK: SpaceTheme = {
  // Primary palette
  primary: '#00D4FF',       // Deep cyan — borders, headings, active elements
  primaryDim: '#0097B2',    // Muted cyan — secondary elements
  accent: '#B388FF',        // Nebula purple — highlights, special elements
  accentDim: '#7C4DFF',     // Deep purple

  // Backgrounds
  background: '#0D1117',    // Deep space black
  surface: '#161B22',       // Slightly lighter panel
  surfaceHover: '#1C2128',  // Hover/active state

  // Text
  text: '#E6EDF3',          // Star white — primary text
  textDim: '#7D8590',       // Moonlight gray — secondary text
  textMuted: '#484F58',     // Faint text

  // Borders
  border: '#30363D',        // Subtle borders
  borderActive: '#00D4FF',  // Active/focused borders

  // Status colors
  success: '#69F0AE',       // Stellar green
  warning: '#FFD740',       // Solar amber
  error: '#FF5252',         // Mars red
  info: '#B388FF',          // Nebula purple (info = accent)

  // Token bar
  tokenLow: '#69F0AE',     // Green (< 50%)
  tokenMedium: '#FFD740',  // Amber (50-80%)
  tokenHigh: '#FF5252',    // Red (> 80%)
  tokenGreen: '#69F0AE',
  tokenAmber: '#FFD740',
  tokenRed: '#FF5252',
} as const;

const SPACE_THEME_LIGHT: SpaceTheme = {
  // Primary palette — darker cyan for readability on light background
  primary: '#007A9A',
  primaryDim: '#005C72',
  accent: '#6B4D9F',
  accentDim: '#5A3FA0',

  // Backgrounds
  background: '#F7F9FB',
  surface: '#FFFFFF',
  surfaceHover: '#F0F4F8',

  // Text
  text: '#0B1220',
  textDim: '#5B6770',
  textMuted: '#8A939A',

  // Borders
  border: '#D6DCE1',
  borderActive: '#007A9A',

  // Status colors
  success: '#006A44',
  warning: '#B36B00',
  error: '#A12E2E',
  info: '#6B4D9F',

  // Token bar
  tokenLow: '#006A44',
  tokenMedium: '#B36B00',
  tokenHigh: '#A12E2E',
  tokenGreen: '#006A44',
  tokenAmber: '#B36B00',
  tokenRed: '#A12E2E',
} as const;

function detectSystemTheme(): 'dark' | 'light' | 'unknown' {
  try {
    // COLORFGBG: most terminals set this (e.g., "15;0" = light text on dark bg)
    const colorFgBg = process.env['COLORFGBG'] || '';
    if (colorFgBg) {
      const parts = colorFgBg.split(';');
      const bgColor = parseInt(parts[1] || '0', 10);
      // ANSI colors 0-6 are dark, 7-15 are light
      // Background 0 = black, 7 = light gray, 15 = white
      if (bgColor >= 7) return 'light';
      if (bgColor < 7 && parts.length >= 2) return 'dark';
    }

    // Check ITERM_PROFILE or terminal type for known light setups
    const termBg = (process.env['TERM_BG'] || '').toLowerCase();
    if (termBg === 'light' || termBg === 'white') return 'light';
    if (termBg === 'dark' || termBg === 'black') return 'dark';

    // VS Code terminal theme
    const vscodeTheme = process.env['VSCODE_THEME'] || '';
    if (/light/i.test(vscodeTheme)) return 'light';
    if (/dark/i.test(vscodeTheme)) return 'dark';

    // macOS
    if (process.platform === 'darwin') {
      try {
        const out = execSync('defaults read -g AppleInterfaceStyle', { encoding: 'utf-8' }).trim();
        if (/Dark/i.test(out)) return 'dark';
        return 'light';
      } catch {
        return 'light';
      }
    }

    // Windows: query registry AppsUseLightTheme (1 = light, 0 = dark)
    if (process.platform === 'win32') {
      try {
        const out = execSync('reg query HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize /v AppsUseLightTheme', { encoding: 'utf-8' });
        if (/0x0/i.test(out)) return 'dark';
        if (/0x1/i.test(out)) return 'light';
      } catch {
        // fallthrough
      }
    }

    // Linux/other: try gsettings (GNOME) or fall back
    try {
      const out = execSync('gsettings get org.gnome.desktop.interface color-scheme', { encoding: 'utf-8' }).trim();
      if (/dark/i.test(out)) return 'dark';
      if (/light/i.test(out)) return 'light';
    } catch {
      try {
        const out2 = execSync('gsettings get org.gnome.desktop.interface gtk-theme', { encoding: 'utf-8' }).trim();
        if (/dark/i.test(out2)) return 'dark';
        return 'light';
      } catch { /* fallthrough */ }
    }

    // For terminals that don't set COLORFGBG (tmux without config, etc.),
    // probe the terminal directly via OSC escape sequence.
    // Background 0-6 = dark, 7+ = light (ANSI 8-color range).
    // We don't do OSC probing here because it requires async I/O;
    // instead, we check the TERM variable as a heuristic.
    const term = (process.env['TERM'] || '').toLowerCase();
    if (term.includes('256color') || term.includes('truecolor') || term.includes('24bit')) {
      // Modern true-color terminals are usually dark by default
      // Light themes in modern terminals typically set COLORFGBG
      return 'dark';
    }

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export function resolveSpaceTheme(preferred?: 'dark' | 'light' | string): SpaceTheme {
  const envPref = (process.env.AGENTX_UI_THEME || '').toLowerCase();
  if (envPref === 'dark') return SPACE_THEME_DARK;
  if (envPref === 'light') return SPACE_THEME_LIGHT;

  if (preferred === 'dark') return SPACE_THEME_DARK;
  if (preferred === 'light') return SPACE_THEME_LIGHT;

  const sys = detectSystemTheme();
  if (sys === 'dark') return SPACE_THEME_DARK;
  if (sys === 'light') return SPACE_THEME_LIGHT;

  // Default to dark for high-contrast terminals
  return SPACE_THEME_DARK;
}

// Export default SPACE_THEME resolved at import time. Consumers that need
// to react to runtime config changes should call `resolveSpaceTheme()` directly.
export const SPACE_THEME: SpaceTheme = resolveSpaceTheme();
