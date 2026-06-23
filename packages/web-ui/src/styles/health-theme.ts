import type { SxProps, Theme } from '@mui/material/styles';
import { colors } from '../theme';

/** Health monitor — black/white/grey, subtle accent only for alerts & live state */
export const healthTheme = {
  bg: {
    void: colors.bg.primary,
    panel: colors.bg.secondary,
    card: colors.bg.secondary,
    inset: colors.bg.primary,
  },
  border: {
    subtle: colors.border.subtle,
    default: colors.border.default,
    strong: colors.border.strong,
  },
  accent: {
    live: colors.accent.green,
    alert: colors.accent.red,
    warn: colors.accent.orange,
  },
  text: {
    primary: colors.text.primary,
    secondary: colors.text.secondary,
    dim: colors.text.dim,
  },
} as const;

export const healthOverlineSx: SxProps<Theme> = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '0.5rem',
  fontWeight: 600,
  letterSpacing: '2.5px',
  textTransform: 'uppercase',
  color: healthTheme.text.dim,
};

export const healthMonoSx: SxProps<Theme> = {
  fontFamily: "'JetBrains Mono', monospace",
};

export const healthScanlineSx: SxProps<Theme> = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  opacity: 0.02,
  backgroundImage:
    'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.06) 2px, rgba(255,255,255,0.06) 3px)',
};

export function healthPanelSx(borderColor: string = healthTheme.border.default): SxProps<Theme> {
  return {
    position: 'relative',
    borderRadius: '6px',
    bgcolor: healthTheme.bg.card,
    border: `1px solid ${borderColor}`,
    overflow: 'hidden',
  };
}

/** Grey progress fill; accent only when threshold crossed */
export function barColor(pct: number): string {
  if (pct >= 85) return healthTheme.accent.alert;
  if (pct >= 65) return healthTheme.accent.warn;
  return colors.text.secondary;
}
