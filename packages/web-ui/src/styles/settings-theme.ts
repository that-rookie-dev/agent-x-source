import type { SxProps, Theme } from '@mui/material/styles';
import { colors } from '../theme';

/** Military / spy / space command palette for Settings */
export const settingsTheme = {
  bg: {
    void: colors.bg.primary,
    panel: colors.bg.secondary,
    inset: colors.bg.primary,
    elevated: colors.bg.tertiary,
    hud: 'rgba(88, 166, 255, 0.04)',
  },
  border: {
    subtle: colors.border.subtle,
    default: colors.border.default,
    strong: colors.border.strong,
    hud: 'rgba(88, 166, 255, 0.35)',
    signal: 'rgba(63, 185, 80, 0.45)',
    alert: 'rgba(248, 81, 73, 0.45)',
  },
  accent: {
    hud: colors.accent.blue,
    signal: colors.accent.green,
    amber: colors.accent.orange,
    alert: colors.accent.red,
    purple: colors.accent.purple,
    cyan: colors.accent.cyan,
  },
  text: {
    primary: colors.text.primary,
    secondary: colors.text.secondary,
    dim: colors.text.dim,
    hud: colors.accent.blue,
  },
} as const;

export const settingsMonoSx: SxProps<Theme> = {
  fontFamily: "'JetBrains Mono', monospace",
};

export const settingsOverlineSx: SxProps<Theme> = {
  ...settingsMonoSx,
  fontSize: '0.5rem',
  fontWeight: 700,
  letterSpacing: '2.5px',
  textTransform: 'uppercase',
  color: settingsTheme.text.dim,
};

export const settingsScanlineSx: SxProps<Theme> = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  opacity: 0.03,
  backgroundImage:
    'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(88,166,255,0.12) 2px, rgba(88,166,255,0.12) 3px)',
};

export const settingsGridBgSx: SxProps<Theme> = {
  backgroundImage: `
    linear-gradient(rgba(88,166,255,0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(88,166,255,0.03) 1px, transparent 1px)
  `,
  backgroundSize: '24px 24px',
};

export function settingsCardSx(accent?: string, active?: boolean): SxProps<Theme> {
  const borderColor = active && accent ? `${accent}66` : settingsTheme.border.default;
  return {
    position: 'relative',
    bgcolor: settingsTheme.bg.inset,
    border: `1px solid ${borderColor}`,
    borderRadius: '6px',
    p: 2.5,
    mb: 1.5,
    overflow: 'hidden',
    boxShadow: active && accent ? `0 0 20px ${accent}12, inset 0 1px 0 ${accent}18` : 'none',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
  };
}

export function settingsDangerCardSx(): SxProps<Theme> {
  return {
    ...settingsCardSx(settingsTheme.accent.alert),
    border: `1px solid ${settingsTheme.border.alert}`,
    bgcolor: `${settingsTheme.accent.alert}08`,
  };
}

export function settingsTabSx(active: boolean): SxProps<Theme> {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 0.75,
    px: 2,
    py: 1.1,
    fontSize: '0.62rem',
    fontWeight: 700,
    fontFamily: "'JetBrains Mono', monospace",
    letterSpacing: '1.2px',
    textTransform: 'uppercase',
    color: active ? settingsTheme.accent.hud : settingsTheme.text.dim,
    borderBottom: active ? `2px solid ${settingsTheme.accent.hud}` : '2px solid transparent',
    borderRadius: 0,
    minWidth: 0,
    bgcolor: active ? settingsTheme.bg.hud : 'transparent',
    '&:hover': { color: settingsTheme.text.primary, bgcolor: settingsTheme.bg.hud },
  };
}

export const settingsDialogPaperSx: SxProps<Theme> = {
  bgcolor: settingsTheme.bg.void,
  border: `1px solid ${settingsTheme.border.default}`,
  borderRadius: '6px',
  boxShadow: '0 24px 80px rgba(0,0,0,0.85)',
  overflow: 'hidden',
};

export const settingsStripSx: SxProps<Theme> = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  mb: 2,
  px: 2,
  py: 1.25,
  borderRadius: '6px',
  bgcolor: settingsTheme.bg.panel,
  border: `1px solid ${settingsTheme.border.default}`,
  overflow: 'hidden',
};

export const settingsToggleGroupSx: SxProps<Theme> = {
  '& .MuiToggleButton-root': {
    ...settingsMonoSx,
    fontSize: '0.62rem',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: settingsTheme.text.dim,
    borderColor: settingsTheme.border.default,
    '&.Mui-selected': {
      color: settingsTheme.accent.hud,
      bgcolor: settingsTheme.bg.hud,
    },
  },
};

export const settingsDialogTitleSx: SxProps<Theme> = {
  ...settingsMonoSx,
  fontSize: '0.72rem',
  fontWeight: 700,
  letterSpacing: '2px',
  textTransform: 'uppercase',
  color: settingsTheme.accent.hud,
  pb: 1,
  borderBottom: `1px solid ${settingsTheme.border.subtle}`,
};

export const settingsHelperSx: SxProps<Theme> = {
  fontSize: '0.6rem',
  color: settingsTheme.text.dim,
  mt: 0.5,
  lineHeight: 1.5,
  ...settingsMonoSx,
};

export const settingsLabelSx: SxProps<Theme> = {
  ...settingsOverlineSx,
  fontSize: '0.55rem',
  mb: 1,
  display: 'block',
};

export const settingsBtnPrimarySx: SxProps<Theme> = {
  ...settingsMonoSx,
  fontSize: '0.62rem',
  fontWeight: 700,
  letterSpacing: '1px',
  textTransform: 'uppercase',
  bgcolor: settingsTheme.accent.hud,
  color: '#000',
  px: 2,
  py: 0.6,
  minHeight: 28,
  boxShadow: `0 0 12px ${settingsTheme.accent.hud}40`,
  '&:hover': { bgcolor: '#4a9eff', boxShadow: `0 0 16px ${settingsTheme.accent.hud}55` },
  '&:disabled': { bgcolor: settingsTheme.border.default, color: settingsTheme.text.dim, boxShadow: 'none' },
};

export const settingsBtnGhostSx: SxProps<Theme> = {
  ...settingsMonoSx,
  fontSize: '0.62rem',
  fontWeight: 600,
  letterSpacing: '0.5px',
  textTransform: 'uppercase',
  borderColor: `${settingsTheme.accent.hud}55`,
  color: settingsTheme.accent.hud,
  px: 1.5,
  py: 0.5,
  minHeight: 28,
  '&:hover': { borderColor: settingsTheme.accent.hud, bgcolor: `${settingsTheme.accent.hud}12` },
};

export const settingsBtnDangerSx: SxProps<Theme> = {
  ...settingsBtnGhostSx,
  borderColor: `${settingsTheme.accent.alert}55`,
  color: settingsTheme.accent.alert,
  '&:hover': { borderColor: settingsTheme.accent.alert, bgcolor: `${settingsTheme.accent.alert}12` },
};

export const settingsBtnSignalSx: SxProps<Theme> = {
  ...settingsBtnPrimarySx,
  bgcolor: settingsTheme.accent.signal,
  boxShadow: `0 0 12px ${settingsTheme.accent.signal}40`,
  '&:hover': { bgcolor: '#4fd068', boxShadow: `0 0 16px ${settingsTheme.accent.signal}55` },
};

export function settingsStatusBadgeSx(state: 'active' | 'idle' | 'warn'): SxProps<Theme> {
  const color = state === 'active' ? settingsTheme.accent.signal
    : state === 'warn' ? settingsTheme.accent.amber
      : settingsTheme.text.dim;
  return {
    ...settingsMonoSx,
    fontSize: '0.5rem',
    fontWeight: 700,
    letterSpacing: '1px',
    color,
    px: 0.75,
    py: 0.2,
    border: `1px solid ${color}44`,
    borderRadius: '3px',
    bgcolor: `${color}10`,
  };
}

export const settingsTextFieldSx: SxProps<Theme> = {
  '& .MuiOutlinedInput-root': {
    bgcolor: settingsTheme.bg.void,
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '0.75rem',
  },
  '& .MuiInputLabel-root': {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '0.7rem',
  },
};
