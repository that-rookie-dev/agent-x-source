import { colors, alphaColor } from '../../theme';

/** Sci-fi secure-uplink palette — cool signal green / cyan on deep void (not purple). */
export const callTheme = {
  bg: {
    void: '#05080c',
    panel: '#0a1018',
    glass: alphaColor('#0e1824', 0.92),
    inset: '#060b12',
  },
  border: {
    faint: alphaColor('#7ec8e3', 0.12),
    line: alphaColor('#7ec8e3', 0.28),
    hot: alphaColor('#5eead4', 0.55),
  },
  text: {
    primary: '#e8f4f8',
    secondary: alphaColor('#e8f4f8', 0.65),
    dim: alphaColor('#e8f4f8', 0.4),
    mono: '#9fb8c4',
  },
  signal: '#5eead4',
  uplink: '#38bdf8',
  warn: colors.accent.orange,
  alert: '#f87171',
  operator: '#7dd3fc',
  crew: '#6ee7b7',
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
