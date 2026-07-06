import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { wizardTheme, WIZARD_MONO } from './wizard-theme';

export interface WizardStepShellProps {
  codename: string;
  title: string;
  subtitle: string;
  icon: ReactNode;
  children: ReactNode;
}

export function WizardStepShell({
  codename,
  title,
  subtitle,
  icon,
  children,
}: WizardStepShellProps) {
  return (
    <Box sx={{ maxWidth: 560, mx: 'auto' }}>
      <Box sx={{ textAlign: 'center', mb: 3 }}>
        <Box sx={{
          width: 52,
          height: 52,
          borderRadius: 1.5,
          mx: 'auto',
          mb: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'rgba(255,255,255,0.03)',
          border: `1px solid ${wizardTheme.panelBorder}`,
          color: wizardTheme.textSecondary,
        }}>
          {icon}
        </Box>
        <Typography sx={{
          fontFamily: WIZARD_MONO,
          fontSize: '0.52rem',
          letterSpacing: '2.5px',
          color: wizardTheme.textDim,
          mb: 0.75,
        }}>
          {codename}
        </Typography>
        <Typography variant="h6" sx={{ fontWeight: 800, fontSize: '1.05rem', mb: 0.5, color: wizardTheme.text }}>
          {title}
        </Typography>
        <Typography variant="body2" sx={{ color: wizardTheme.textDim, fontSize: '0.68rem', maxWidth: 420, mx: 'auto', lineHeight: 1.55 }}>
          {subtitle}
        </Typography>
      </Box>

      <Box sx={{
        position: 'relative',
        p: 2.5,
        borderRadius: 1.5,
        border: `1px solid ${wizardTheme.panelBorder}`,
        bgcolor: wizardTheme.panel,
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.015) 2px, rgba(255,255,255,0.015) 4px)',
          pointerEvents: 'none',
        },
      }}>
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
