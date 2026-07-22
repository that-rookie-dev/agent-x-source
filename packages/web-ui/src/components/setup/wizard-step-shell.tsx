import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { WizardStepHeader } from './wizard-ui';
import { wizardPanelSx, wizardTheme, WIZARD_MONO } from './wizard-theme';

export interface WizardStepShellProps {
  codename: string;
  title: string;
  subtitle: string;
  /** Kept for call-site compatibility; no longer rendered (header matches other steps). */
  icon?: ReactNode;
  children: ReactNode;
  /** Max width of the content panel. */
  maxWidth?: number | string;
}

/**
 * Shared step chrome: same centered header as other wizard pages + a single panel.
 */
export function WizardStepShell({
  codename,
  title,
  subtitle,
  children,
  maxWidth = 560,
}: WizardStepShellProps) {
  return (
    <Box>
      <WizardStepHeader codename={codename} title={title} subtitle={subtitle} />
      <Box sx={{ ...wizardPanelSx, maxWidth, mx: 'auto', position: 'relative' }}>
        {children}
      </Box>
    </Box>
  );
}

export function WizardStatusLine({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.5 }}>
      <Typography sx={{ fontSize: '0.58rem', fontFamily: WIZARD_MONO, color: wizardTheme.textDim, letterSpacing: '0.5px' }}>
        {label}
      </Typography>
      <Typography sx={{
        fontSize: '0.58rem',
        fontFamily: WIZARD_MONO,
        color: ok === false ? wizardTheme.accentErr : ok === true ? wizardTheme.accentOk : wizardTheme.textSecondary,
        textAlign: 'right',
      }}>
        {value}
      </Typography>
    </Box>
  );
}
