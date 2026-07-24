import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { VOICE_PERMISSION_TIMEOUT_MS } from '@agentx/shared/browser';
import { COMMS_MONO, commsTheme } from './voice-comms-theme';
import type { VoicePermissionPrompt, VoicePermissionChoice } from '../../voice/VoiceSessionClient';

import { colors, alphaColor } from '../../theme';

export interface VoicePermissionRespondOptions {
  reason?: 'timeout' | 'user';
}

export interface VoicePermissionCardProps {
  prompt: VoicePermissionPrompt;
  onRespond: (choice: VoicePermissionChoice, opts?: VoicePermissionRespondOptions) => void;
  /** Enable bypass for the rest of the session/turn and approve pending tools. */
  onSwitchToBypass?: () => void;
  /** Defaults to shared VOICE_PERMISSION_TIMEOUT_MS (10s). */
  timeoutMs?: number;
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
export function VoicePermissionCard({
  prompt,
  onRespond,
  onSwitchToBypass,
  timeoutMs = VOICE_PERMISSION_TIMEOUT_MS,
}: VoicePermissionCardProps) {
  const respondedRef = useRef(false);
  const [remainingMs, setRemainingMs] = useState(timeoutMs);

  const respond = (choice: VoicePermissionChoice, opts?: VoicePermissionRespondOptions) => {
    if (respondedRef.current) return;
    respondedRef.current = true;
    onRespond(choice, opts ?? { reason: 'user' });
  };

  const switchToBypass = () => {
    if (respondedRef.current) return;
    respondedRef.current = true;
    if (onSwitchToBypass) onSwitchToBypass();
    else onRespond('approve_all', { reason: 'user' });
  };

  useEffect(() => {
    respondedRef.current = false;
    setRemainingMs(timeoutMs);
    const started = Date.now();
    const tick = window.setInterval(() => {
      const left = Math.max(0, timeoutMs - (Date.now() - started));
      setRemainingMs(left);
      if (left <= 0) {
        window.clearInterval(tick);
        respond('deny', { reason: 'timeout' });
      }
    }, 50);
    return () => window.clearInterval(tick);
    // Re-arm only when a new permission request arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- respond closes over latest onRespond via respond()
  }, [prompt.requestId, timeoutMs]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); respond('allow_once'); }
      else if (e.key === 'a' || e.key === 'A') { e.preventDefault(); respond('allow_always'); }
      else if (e.key === 'n' || e.key === 'N' || e.key === 'Escape') { e.preventDefault(); respond('deny'); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
    // respond is stable enough via respondedRef; rebind when request changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt.requestId]);

  const toolLabel = prompt.tool.replace(/_/g, ' ').toUpperCase();
  const accent = riskColor(prompt.riskLevel);
  const progress = Math.max(0, Math.min(100, (remainingMs / timeoutMs) * 100));
  const secondsLeft = Math.ceil(remainingMs / 1000);

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
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontFamily: COMMS_MONO, fontSize: '0.65rem', letterSpacing: '2px', color: commsTheme.textDim }}>
            PERMISSION REQUEST
          </Typography>
          <Typography sx={{ fontFamily: COMMS_MONO, fontSize: '0.55rem', letterSpacing: '1px', color: accent }}>
            {prompt.riskLevel.toUpperCase()} RISK
          </Typography>
        </Box>
        <Typography sx={{
          fontFamily: COMMS_MONO,
          fontSize: '0.7rem',
          fontWeight: 700,
          color: secondsLeft <= 3 ? commsTheme.error : commsTheme.textSecondary,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {secondsLeft}s
        </Typography>
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

      <Box sx={{ mb: 2 }}>
        <LinearProgress
          variant="determinate"
          value={progress}
          sx={{
            height: 4,
            borderRadius: 1,
            bgcolor: alphaColor(accent, 0.15),
            '& .MuiLinearProgress-bar': {
              bgcolor: secondsLeft <= 3 ? commsTheme.error : accent,
              transition: 'transform 0.05s linear',
            },
          }}
        />
        <Typography sx={{
          mt: 0.75,
          fontFamily: COMMS_MONO,
          fontSize: '0.5rem',
          letterSpacing: '0.08em',
          color: commsTheme.textDim,
        }}>
          No response cancels this request — the action will not run.
        </Typography>
      </Box>

      <Typography sx={{
        fontFamily: COMMS_MONO,
        fontSize: '0.55rem',
        color: commsTheme.textDim,
        mb: 2,
      }}>
        Say “allow”, “always”, or “deny” — or use the buttons below.
      </Typography>

      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <PermButton label="ALLOW (Y)" color={commsTheme.relayReady} onClick={() => respond('allow_once')} />
        <PermButton label="ALWAYS (A)" color={commsTheme.text} onClick={() => respond('allow_always')} />
        <PermButton label="DENY (N)" color={commsTheme.error} onClick={() => respond('deny')} />
        <PermButton label="BYPASS MODE" color={colors.accent.orange} onClick={switchToBypass} />
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
