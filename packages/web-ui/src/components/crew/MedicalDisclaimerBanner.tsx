import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { crewTheme } from '../../styles/crew-theme';
import { MEDICAL_INFORMATIONAL_DISCLAIMER } from '@agentx/shared/browser';

export const HAZARD_STRIPE_BG = `repeating-linear-gradient(
  -45deg,
  #111 0px,
  #111 6px,
  #f4c430 6px,
  #f4c430 12px
)`;

export const MEDICAL_YELLOW = '#f4c430';

/** Thin yellow/black hazard stripe band (2–5px). */
export function MedicalDisclaimerStripe({ height = 3 }: { height?: number }) {
  return (
    <Box
      aria-hidden
      sx={{
        height,
        width: '100%',
        flexShrink: 0,
        background: HAZARD_STRIPE_BG,
      }}
    />
  );
}

/** Sector-level card: stripe header + yellow body with readable disclaimer text. */
export function MedicalDisclaimerSectorCard({ sx }: { sx?: SxProps<Theme> }) {
  return (
    <Box sx={{
      borderRadius: '6px',
      overflow: 'hidden',
      border: '1px solid rgba(17, 17, 17, 0.85)',
      ...sx,
    }}>
      <MedicalDisclaimerStripe height={5} />
      <Box sx={{ px: 1.25, py: 0.9, bgcolor: MEDICAL_YELLOW }}>
        <Typography sx={{
          fontSize: '0.62rem',
          fontFamily: "'JetBrains Mono', monospace",
          color: '#1a1200',
          lineHeight: 1.5,
        }}>
          {MEDICAL_INFORMATIONAL_DISCLAIMER}
        </Typography>
      </Box>
    </Box>
  );
}

/** Hazard-framed identity block: stripe bands with dark profile layer between them. */
export function MedicalProfileIdentityFrame({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{
      mb: 2,
      borderRadius: '8px',
      overflow: 'hidden',
      border: `1px solid ${crewTheme.border.strong}`,
    }}>
      <MedicalDisclaimerStripe height={4} />
      <Box sx={{
        position: 'relative',
        p: 1.5,
        bgcolor: crewTheme.bg.card,
        overflow: 'hidden',
      }}>
        {children}
      </Box>
      <MedicalDisclaimerStripe height={3} />
    </Box>
  );
}

export interface MedicalDisclaimerBannerProps {
  compact?: boolean;
  variant?: 'banner' | 'inline' | 'frame' | 'sector' | 'stripe';
  children?: React.ReactNode;
}

/** Medical-domain disclaimer surfaces (sector card, chat frame, legacy banner). */
export function MedicalDisclaimerBanner({
  compact = false,
  variant = 'banner',
  children,
}: MedicalDisclaimerBannerProps) {
  const text = MEDICAL_INFORMATIONAL_DISCLAIMER;

  if (variant === 'sector') {
    return <MedicalDisclaimerSectorCard sx={{ mb: compact ? 0.75 : 1.25 }} />;
  }

  if (variant === 'stripe') {
    return <MedicalDisclaimerStripe height={3} />;
  }

  if (variant === 'frame' && children) {
    return (
      <Box sx={{ borderRadius: '6px', overflow: 'hidden', border: '1px solid rgba(17, 17, 17, 0.85)' }}>
        <MedicalDisclaimerStripe height={4} />
        <Box sx={{ px: 1.25, py: 1 }}>{children}</Box>
        <Box sx={{ px: 1.25, py: 0.75, bgcolor: MEDICAL_YELLOW }}>
          <Typography sx={{
            fontSize: compact ? '0.55rem' : '0.58rem',
            fontFamily: "'JetBrains Mono', monospace",
            color: '#1a1200',
            lineHeight: 1.45,
          }}>
            {text}
          </Typography>
        </Box>
      </Box>
    );
  }

  if (variant === 'inline') {
    return (
      <Box sx={{ borderRadius: '4px', overflow: 'hidden', mb: 0.75, border: '1px solid rgba(17, 17, 17, 0.7)' }}>
        <MedicalDisclaimerStripe height={3} />
        <Box sx={{ px: 0.75, py: 0.5, bgcolor: MEDICAL_YELLOW }}>
          <Typography sx={{
            fontSize: '0.5rem',
            fontFamily: "'JetBrains Mono', monospace",
            color: '#1a1200',
            lineHeight: 1.35,
          }}>
            {text}
          </Typography>
        </Box>
      </Box>
    );
  }

  return <MedicalDisclaimerSectorCard sx={{ mb: compact ? 0.75 : 1.25 }} />;
}
