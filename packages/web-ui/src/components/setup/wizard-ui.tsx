import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import {
  wizardSectionCodenameSx,
  wizardSectionSubtitleSx,
  wizardSectionTitleSx,
} from './wizard-theme';

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
      border: '1px solid rgba(255,255,255,0.85)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    }}>
      <Typography sx={{ fontSize: '0.55rem', color: '#fff', fontWeight: 900, lineHeight: 1 }}>✓</Typography>
    </Box>
  );
}

export function WizardHintTag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'ok' | 'signal' | 'neutral' }) {
  const color = tone === 'ok' ? 'rgba(76,175,80,0.85)' : tone === 'signal' ? 'rgba(0,200,255,0.75)' : 'rgba(255,255,255,0.45)';
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
