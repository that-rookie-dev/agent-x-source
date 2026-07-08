import { useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { COMMS_MONO, commsTheme } from './voice-comms-theme';
import type { OpsLogEntry } from '../../telemetry/ops-log';
import { colors, alphaColor } from '../../theme';

const LOG_HEIGHT = 140;

const levelColor: Record<OpsLogEntry['level'], string> = {
  info: commsTheme.textDim,
  think: commsTheme.textSecondary,
  tool: commsTheme.relayReady,
  ok: commsTheme.operator,
  err: commsTheme.error,
  sys: commsTheme.textDim,
};

export function VoiceActivityLog({ entries, visible }: { entries: OpsLogEntry[]; visible: boolean }) {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible || !logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [entries, visible]);

  if (!visible) return null;

  return (
    <Box sx={{
      border: `1px solid ${commsTheme.border}`,
      borderRadius: 1,
      bgcolor: alphaColor(colors.bg.primary, 0.35),
      overflow: 'hidden',
      minHeight: LOG_HEIGHT + 28,
    }}>
      <Typography sx={{
        px: 1.5,
        py: 0.5,
        fontFamily: COMMS_MONO,
        fontSize: '0.48rem',
        letterSpacing: '1.5px',
        color: commsTheme.textDim,
        borderBottom: `1px solid ${commsTheme.border}`,
      }}>
        MISSION LOG
      </Typography>
      <Box
        ref={logRef}
        sx={{
          height: LOG_HEIGHT,
          maxHeight: LOG_HEIGHT,
          overflow: 'auto',
          px: 1.5,
          py: 0.75,
          fontFamily: COMMS_MONO,
          fontSize: '0.5rem',
          lineHeight: 1.45,
        }}
      >
        {entries.length === 0 && (
          <Typography sx={{ color: commsTheme.textDim, fontSize: '0.5rem' }}>
            Waiting for agent activity…
          </Typography>
        )}
        {entries.map((entry) => (
          <Box key={entry.id} sx={{ mb: 0.45 }}>
            <Box component="span" sx={{ color: commsTheme.textDim, mr: 0.75 }}>
              {new Date(entry.ts).toLocaleTimeString()}
            </Box>
            <Box component="span" sx={{ color: levelColor[entry.level], mr: 0.75, fontWeight: 600 }}>
              {entry.label}
            </Box>
            {entry.detail && (
              <Box component="span" sx={{ color: commsTheme.textSecondary, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {entry.detail}
              </Box>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
