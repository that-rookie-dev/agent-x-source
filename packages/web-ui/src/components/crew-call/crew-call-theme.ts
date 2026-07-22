import { colors, alphaColor } from '../../theme';

/**
 * Secure-uplink palette for crew calls — scheme-aware via CSS tokens so light
 * theme stays readable (no hard-coded void blacks).
 */
export const callTheme = {
  bg: {
    void: colors.bg.primary,
    panel: colors.bg.secondary,
    glass: alphaColor(colors.bg.secondary, 0.94),
    inset: colors.bg.tertiary,
  },
  border: {
    faint: alphaColor(colors.accent.cyan, 0.16),
    line: alphaColor(colors.accent.cyan, 0.32),
    hot: alphaColor(colors.accent.green, 0.5),
  },
  text: {
    primary: colors.text.primary,
    secondary: colors.text.secondary,
    dim: colors.text.dim,
    mono: colors.text.tertiary,
  },
  signal: colors.accent.green,
  uplink: colors.accent.blue,
  warn: colors.accent.orange,
  alert: colors.accent.red,
  operator: colors.accent.cyan,
  crew: colors.accent.green,
  mono: "'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace",
  display: "'Orbitron', 'JetBrains Mono', monospace",
} as const;

export function formatCallDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
