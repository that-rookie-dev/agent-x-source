import { useEffect } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { COMMS_MONO, commsTheme } from './voice-comms-theme';
import type { VoicePermissionPrompt, VoicePermissionChoice } from '../../voice/VoiceSessionClient';

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
 * In-modal card for approving/denying a tool call by voice or tap.
 * The server also speaks the prompt and listens for a spoken decision.
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

  return (
    <Box sx={{
      mt: 1,
      p: 1.5,
      borderRadius: 1,
      border: `1px solid ${commsTheme.borderActive}`,
      bgcolor: commsTheme.panelActive,
      boxShadow: `0 0 18px ${riskColor(prompt.riskLevel)}22`,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.75 }}>
        <Typography sx={{ fontFamily: COMMS_MONO, fontSize: '0.5rem', letterSpacing: '2px', color: commsTheme.textDim }}>
          PERMISSION REQUEST
        </Typography>
        <Typography sx={{
          fontFamily: COMMS_MONO,
          fontSize: '0.5rem',
          letterSpacing: '1px',
          color: riskColor(prompt.riskLevel),
        }}>
          {prompt.riskLevel.toUpperCase()} RISK
        </Typography>
      </Box>

      <Typography sx={{ fontFamily: COMMS_MONO, fontSize: '0.66rem', fontWeight: 700, color: commsTheme.text, mb: 0.5 }}>
        {toolLabel}
      </Typography>

      {prompt.argsSummary && (
        <Typography sx={{ fontFamily: COMMS_MONO, fontSize: '0.56rem', color: commsTheme.textSecondary, mb: 0.5, lineHeight: 1.4 }}>
          Wants to {prompt.argsSummary}
        </Typography>
      )}

      {prompt.commandPreview && (
        <Box sx={{
          fontFamily: COMMS_MONO,
          fontSize: '0.54rem',
          color: commsTheme.textSecondary,
          bgcolor: 'rgba(0,0,0,0.4)',
          border: `1px solid ${commsTheme.border}`,
          borderRadius: 0.5,
          px: 1,
          py: 0.75,
          mb: 1,
          maxHeight: 72,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>
          {prompt.commandPreview}
        </Box>
      )}

      <Typography sx={{ fontFamily: COMMS_MONO, fontSize: '0.5rem', color: commsTheme.textDim, mb: 1 }}>
        Say “allow”, “always”, or “deny” — or use the buttons below.
      </Typography>

      <Box sx={{ display: 'flex', gap: 1 }}>
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
        fontSize: '0.52rem',
        letterSpacing: '1px',
        color,
        borderColor: color,
        border: `1px solid ${color}`,
        borderRadius: 0.75,
        py: 0.5,
        '&:hover': { bgcolor: `${color}18`, borderColor: color },
      }}
    >
      {label}
    </Button>
  );
}
