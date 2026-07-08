import type { SxProps, Theme } from '@mui/material/styles';
import { colors, alphaColor } from '../theme';

/** Command-center palette — black/white/grey primary, subtle accents only */
export const crewTheme = {
  bg: {
    void: colors.bg.primary,
    panel: colors.bg.secondary,
    card: colors.bg.secondary,
    cardHover: colors.bg.hover,
    elevated: colors.bg.tertiary,
    hub: colors.bg.secondary,
    inset: colors.bg.primary,
  },
  border: {
    subtle: colors.border.subtle,
    default: colors.border.default,
    strong: colors.border.strong,
    amber: alphaColor(colors.accent.orange, 0.45),
    danger: alphaColor(colors.accent.red, 0.45),
  },
  accent: {
    tactical: colors.text.secondary,
    hud: colors.accent.blue,
    signal: colors.accent.green,
    amber: colors.accent.orange,
    alert: colors.accent.red,
    purple: colors.accent.purple,
  },
  text: {
    primary: colors.text.primary,
    secondary: colors.text.secondary,
    dim: colors.text.dim,
    mono: colors.text.tertiary,
  },
  grid: {
    gap: 12,
    minCard: 240,
    hubMinCard: 220,
    hubCardHeight: 148,
  },
} as const;

const FALLBACK_PALETTE = [
  colors.accent.blue,
  colors.accent.purple,
  colors.accent.green,
  colors.accent.orange,
  colors.text.tertiary,
  colors.text.secondary,
];

export function getCrewAccent(color?: string, callsign?: string): string {
  if (color) return color;
  let hash = 0;
  for (let i = 0; i < (callsign ?? '').length; i++) {
    hash = ((hash << 5) - hash) + (callsign ?? '').charCodeAt(i);
    hash |= 0;
  }
  return FALLBACK_PALETTE[Math.abs(hash) % FALLBACK_PALETTE.length]!;
}

export function crewCardSx(_accent: string, enabled: boolean): SxProps<Theme> {
  return {
    position: 'relative',
    borderRadius: '8px',
    bgcolor: crewTheme.bg.card,
    border: `1px solid ${enabled ? colors.border.strong : crewTheme.border.default}`,
    cursor: 'pointer',
    overflow: 'hidden',
    transition: 'border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease, background-color 0.18s ease',
    '&:hover': {
      bgcolor: crewTheme.bg.cardHover,
      borderColor: enabled ? colors.text.secondary : crewTheme.border.strong,
      transform: 'translateY(-1px)',
      boxShadow: `0 4px 20px ${colors.shadow.heavy}`,
    },
  };
}

export const crewDialogPaperSx: SxProps<Theme> = {
  bgcolor: crewTheme.bg.panel,
  backgroundImage: `linear-gradient(180deg, ${crewTheme.bg.elevated} 0%, ${crewTheme.bg.panel} 100%)`,
  border: `1px solid ${crewTheme.border.default}`,
  borderRadius: '8px',
  boxShadow: `0 24px 80px ${colors.shadow.heavy}`,
  overflow: 'hidden',
};

export const crewOverlineSx: SxProps<Theme> = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '0.55rem',
  fontWeight: 600,
  letterSpacing: '2.5px',
  textTransform: 'uppercase',
  color: crewTheme.text.dim,
};

export const crewHubScanlineSx: SxProps<Theme> = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  opacity: 0.025,
  backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 2px, ${alphaColor(colors.ink, 0.08)} 2px, ${alphaColor(colors.ink, 0.08)} 3px)`,
};
