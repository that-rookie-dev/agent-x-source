import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { StepIconProps } from '@mui/material/StepIcon';
import type { ReactNode } from 'react';
import {
  wizardSectionCodenameSx,
  wizardSectionSubtitleSx,
  wizardSectionTitleSx,
  wizardTheme,
  WIZARD_MONO,
} from './wizard-theme';
import { colors, alphaColor } from '../../theme';

export function WizardStepHeader({
  codename,
  title,
  subtitle,
  center = true,
}: {
  codename: string;
  title: string;
  subtitle?: string;
  center?: boolean;
}) {
  return (
    <Box sx={{ textAlign: center ? 'center' : 'left', mb: 3 }}>
      <Typography sx={wizardSectionCodenameSx}>{codename}</Typography>
      <Typography sx={{ ...wizardSectionTitleSx, textAlign: center ? 'center' : 'left' }}>{title}</Typography>
      {subtitle && (
        <Typography sx={{ ...wizardSectionSubtitleSx, textAlign: center ? 'center' : 'left' }}>{subtitle}</Typography>
      )}
    </Box>
  );
}

export function WizardCheckMark() {
  return (
    <Box sx={{
      width: 18,
      height: 18,
      borderRadius: '50%',
      border: `1px solid ${alphaColor(colors.ink, 0.85)}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    }}>
      <Typography sx={{ fontSize: '0.55rem', color: colors.text.primary, fontWeight: 900, lineHeight: 1 }}>✓</Typography>
    </Box>
  );
}

/** Stepper icon: green check (done), muted dash (skipped), or step number. */
export function WizardStepIcon({
  active,
  completed,
  skipped,
  icon,
  className,
}: StepIconProps & { skipped?: boolean }) {
  if (skipped) {
    return (
      <Box
        className={className}
        sx={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          bgcolor: alphaColor(colors.ink, 0.06),
          border: `1.5px solid ${alphaColor(colors.ink, 0.28)}`,
          color: wizardTheme.textDim,
        }}
        aria-label="Skipped"
      >
        {/* Horizontal dash — distinct from the completed tick */}
        <Box sx={{
          width: 10,
          height: 2,
          borderRadius: 1,
          bgcolor: 'currentColor',
        }} />
      </Box>
    );
  }

  if (completed) {
    return (
      <Box
        className={className}
        sx={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          bgcolor: wizardTheme.accentOk,
          color: wizardTheme.bg,
        }}
        aria-label="Completed"
      >
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 900, lineHeight: 1, color: 'inherit' }}>✓</Typography>
      </Box>
    );
  }

  return (
    <Box
      className={className}
      sx={{
        width: 24,
        height: 24,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        bgcolor: active ? wizardTheme.text : alphaColor(colors.ink, 0.18),
        color: active ? wizardTheme.bg : wizardTheme.textDim,
        fontFamily: WIZARD_MONO,
        fontSize: '0.7rem',
        fontWeight: 700,
      }}
    >
      {icon}
    </Box>
  );
}

export function WizardHintTag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'ok' | 'signal' | 'neutral' }) {
  const color = tone === 'ok' ? alphaColor(colors.accent.green, 0.85) : tone === 'signal' ? alphaColor(colors.accent.blue, 0.75) : alphaColor(colors.ink, 0.45);
  return (
    <Typography sx={{
      fontSize: '0.52rem',
      fontFamily: "'JetBrains Mono', monospace",
      color,
      letterSpacing: '1.2px',
      textTransform: 'uppercase',
    }}>
      {children}
    </Typography>
  );
}
