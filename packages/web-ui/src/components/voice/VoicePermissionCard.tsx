import { useEffect } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { COMMS_MONO, commsTheme } from './voice-comms-theme';
import type { VoicePermissionPrompt, VoicePermissionChoice } from '../../voice/VoiceSessionClient';

import { colors, alphaColor } from '../../theme';

export interface VoicePermissionCardProps {
  prompt: VoicePermissionPrompt;
  onRespond: (choice: VoicePermissionChoice) => void;
}

function riskColor(risk: string): string {
  if (risk === 'critical' || risk === 'high') return commsTheme.error;
  if (risk === 'medium') return commsTheme.warn ?? commsTheme.textSecondary;
  return commsTheme.textSecondary;
}

/**
 * Voice-native permission prompt card. Shown as a centered modal whenever the
 * active voice engine needs the user to approve a tool call.
 */
export function VoicePermissionCard({ prompt, onRespond }: VoicePermissionCardProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); onRespond('allow_once'); }
      else if (e.key === 'a' || e.key === 'A') { e.preventDefault(); onRespond('allow_always'); }
      else if (e.key === 'n' || e.key === 'N' || e.key === 'Escape') { e.preventDefault(); onRespond('deny'); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onRespond]);

  const toolLabel = prompt.tool.replace(/_/g, ' ').toUpperCase();
  const accent = riskColor(prompt.riskLevel);

  return (
    <Box sx={{
      position: 'relative',
      p: 3,
      borderRadius: 2,
      bgcolor: commsTheme.panelActive,
      border: `1.5px solid ${accent}`,
      boxShadow: `0 0 0 1px ${alphaColor(accent, '18')}, 0 0 32px ${alphaColor(accent, '24')}`,
      overflow: 'hidden',
    }}>
      <Box sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        bgcolor: accent,
        boxShadow: `0 0 12px ${accent}`,
      }} />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
        <WarningAmberIcon sx={{ color: accent, fontSize: 28 }} />
        <Box>
          <Typography sx={{ fontFamily: COMMS_MONO, fontSize: '0.65rem', letterSpacing: '2px', color: commsTheme.textDim }}>
            PERMISSION REQUEST
          </Typography>
          <Typography sx={{ fontFamily: COMMS_MONO, fontSize: '0.55rem', letterSpacing: '1px', color: accent }}>
            {prompt.riskLevel.toUpperCase()} RISK
          </Typography>
        </Box>
      </Box>

      <Typography sx={{
        fontFamily: COMMS_MONO,
        fontSize: '0.85rem',
        fontWeight: 700,
        color: commsTheme.text,
        mb: 1.5,
        lineHeight: 1.3,
      }}>
        {toolLabel}
      </Typography>

      {prompt.argsSummary && (
        <Typography sx={{
          fontFamily: COMMS_MONO,
          fontSize: '0.62rem',
          color: commsTheme.textSecondary,
          mb: 1.5,
          lineHeight: 1.5,
        }}>
          Wants to {prompt.argsSummary}
        </Typography>
      )}

      {prompt.commandPreview && (
        <Box sx={{
          fontFamily: COMMS_MONO,
          fontSize: '0.58rem',
          color: commsTheme.text,
          bgcolor: alphaColor(colors.bg.primary, 0.5),
          border: `1px solid ${commsTheme.border}`,
          borderRadius: 1,
          px: 1.5,
          py: 1,
          mb: 2,
          maxHeight: 120,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>
          {prompt.commandPreview}
        </Box>
      )}

      <Typography sx={{
        fontFamily: COMMS_MONO,
        fontSize: '0.55rem',
        color: commsTheme.textDim,
        mb: 2,
      }}>
        Say “allow”, “always”, or “deny” — or use the buttons below.
      </Typography>

      <Box sx={{ display: 'flex', gap: 1.5 }}>
        <PermButton label="ALLOW (Y)" color={commsTheme.relayReady} onClick={() => onRespond('allow_once')} />
        <PermButton label="ALWAYS (A)" color={commsTheme.text} onClick={() => onRespond('allow_always')} />
        <PermButton label="DENY (N)" color={commsTheme.error} onClick={() => onRespond('deny')} />
      </Box>
    </Box>
  );
}

function PermButton({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <Button
      onClick={onClick}
      sx={{
        flex: 1,
        fontFamily: COMMS_MONO,
        fontSize: '0.58rem',
        letterSpacing: '1.5px',
        fontWeight: 600,
        color,
        borderColor: color,
        border: `1.5px solid ${color}`,
        borderRadius: 1,
        py: 1,
        '&:hover': { bgcolor: `${alphaColor(color, '16')}`, borderColor: color },
      }}
    >
      {label}
    </Button>
  );
}
