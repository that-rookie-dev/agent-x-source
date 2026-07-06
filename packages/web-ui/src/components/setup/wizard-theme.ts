import type { SxProps, Theme } from '@mui/material/styles';
import { colors } from '../../theme';

export const WIZARD_MONO = "'JetBrains Mono', monospace";

/** Black/white base with green/cyan reserved for status accents only. */
export const wizardTheme = {
  bg: '#000000',
  panel: '#0a0a0a',
  panelBorder: 'rgba(255,255,255,0.12)',
  panelBorderStrong: 'rgba(255,255,255,0.22)',
  text: colors.text.primary,
  textSecondary: colors.text.secondary,
  textDim: colors.text.dim,
  accentOk: colors.accent.green,
  accentSignal: colors.accent.cyan,
  accentWarn: colors.accent.orange,
  accentErr: colors.accent.red,
};

export const wizardStepperSx: SxProps<Theme> = {
  width: '100%',
  maxWidth: 880,
  mx: 'auto',
  '& .MuiStepIcon-root': {
    color: 'rgba(255,255,255,0.18)',
    '&.Mui-active': { color: wizardTheme.text },
    '&.Mui-completed': { color: wizardTheme.accentOk },
  },
  '& .MuiStepConnector-line': { borderColor: 'rgba(255,255,255,0.08)' },
  '& .MuiStepLabel-label': {
    color: wizardTheme.textDim,
    fontSize: '0.58rem',
    fontFamily: WIZARD_MONO,
    letterSpacing: '0.04em',
    '&.Mui-active': { color: wizardTheme.text },
    '&.Mui-completed': { color: wizardTheme.textSecondary },
  },
};

export const wizardPrimaryBtnSx: SxProps<Theme> = {
  bgcolor: wizardTheme.text,
  color: wizardTheme.bg,
  fontFamily: WIZARD_MONO,
  fontSize: '0.68rem',
  letterSpacing: '0.04em',
  fontWeight: 700,
  textTransform: 'none',
  boxShadow: 'none',
  '&:hover': { bgcolor: 'rgba(255,255,255,0.88)', boxShadow: 'none' },
  '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.35)' },
};

export const wizardBackBtnSx: SxProps<Theme> = {
  color: wizardTheme.textSecondary,
  fontFamily: WIZARD_MONO,
  fontSize: '0.65rem',
  textTransform: 'none',
};

export const wizardSkipBtnSx: SxProps<Theme> = {
  color: wizardTheme.textDim,
  fontFamily: WIZARD_MONO,
  fontSize: '0.62rem',
  textTransform: 'none',
};

export const wizardPanelSx: SxProps<Theme> = {
  p: 2.5,
  borderRadius: 1.5,
  border: `1px solid ${wizardTheme.panelBorder}`,
  bgcolor: wizardTheme.panel,
};

export const wizardTextFieldSlotProps = {
  input: { sx: { fontSize: '0.75rem', fontFamily: WIZARD_MONO, color: wizardTheme.text } },
  inputLabel: { sx: { fontSize: '0.65rem', fontFamily: WIZARD_MONO } },
};

export function wizardTileSx(selected: boolean): SxProps<Theme> {
  return {
    p: 1.5,
    border: `1px solid ${selected ? 'rgba(255,255,255,0.82)' : wizardTheme.panelBorder}`,
    borderRadius: 1,
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'all 0.18s',
    bgcolor: selected ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)',
    '&:hover': {
      borderColor: selected ? 'rgba(255,255,255,0.82)' : wizardTheme.panelBorderStrong,
    },
  };
}

export function wizardSelectCardSx(selected: boolean, hint?: 'ok' | 'signal'): SxProps<Theme> {
  const hintColor = hint === 'ok' ? wizardTheme.accentOk : hint === 'signal' ? wizardTheme.accentSignal : wizardTheme.text;
  return {
    p: 2.5,
    border: `1px solid ${selected ? hintColor : wizardTheme.panelBorder}`,
    borderRadius: 1.5,
    cursor: 'pointer',
    bgcolor: selected ? 'rgba(255,255,255,0.04)' : wizardTheme.panel,
    display: 'flex',
    flexDirection: 'column',
    transition: 'all 0.18s',
    '&:hover': { borderColor: selected ? hintColor : wizardTheme.panelBorderStrong },
  };
}

export const wizardSectionCodenameSx: SxProps<Theme> = {
  fontFamily: WIZARD_MONO,
  fontSize: '0.52rem',
  letterSpacing: '2px',
  color: wizardTheme.textDim,
  textTransform: 'uppercase',
  mb: 0.75,
};

export const wizardSectionTitleSx: SxProps<Theme> = {
  fontWeight: 800,
  fontSize: '1.05rem',
  color: wizardTheme.text,
  mb: 0.5,
};

export const wizardSectionSubtitleSx: SxProps<Theme> = {
  fontSize: '0.68rem',
  color: wizardTheme.textDim,
  lineHeight: 1.55,
  maxWidth: 480,
  mx: 'auto',
};
