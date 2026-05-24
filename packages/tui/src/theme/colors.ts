import { SPACE_THEME } from '@agentx/shared';

/**
 * TUI Color palette — mapped from the shared space theme.
 * Single source of truth for all terminal UI colors.
 */
export const COLORS = {
  primary: SPACE_THEME.primary,
  primaryDim: SPACE_THEME.primaryDim,
  accent: SPACE_THEME.accent,
  background: SPACE_THEME.background,
  surface: SPACE_THEME.surface,
  text: SPACE_THEME.text,
  textDim: SPACE_THEME.textDim,
  border: SPACE_THEME.border,
  success: SPACE_THEME.success,
  warning: SPACE_THEME.warning,
  error: SPACE_THEME.error,
  info: SPACE_THEME.info,

  // Token bar colors
  tokenLow: SPACE_THEME.tokenLow,
  tokenMedium: SPACE_THEME.tokenMedium,
  tokenHigh: SPACE_THEME.tokenHigh,
  tokenGreen: SPACE_THEME.tokenGreen,
  tokenAmber: SPACE_THEME.tokenAmber,
  tokenRed: SPACE_THEME.tokenRed,
} as const;
