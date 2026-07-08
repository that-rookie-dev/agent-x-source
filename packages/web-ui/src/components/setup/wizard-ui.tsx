import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import {
  wizardSectionCodenameSx,
  wizardSectionSubtitleSx,
  wizardSectionTitleSx,
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
