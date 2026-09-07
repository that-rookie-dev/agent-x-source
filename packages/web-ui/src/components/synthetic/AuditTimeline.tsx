import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import { colors, MONO, alphaColor } from '../../theme';
import { auditColor } from './status';
import type { CapabilityAuditRecord } from '../../api';

export function AuditTimeline({ events, capabilityId }: { events: CapabilityAuditRecord[]; capabilityId: string }) {
  const [openId, setOpenId] = useState<string | null>(null);

  const copyLink = async (eventId: string) => {
    const url = `${window.location.origin}${window.location.pathname}?capability=${capabilityId}&event=${eventId}`;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      /* ignore copy failures in non-secure or test environments */
    }
  };

  if (!events.length) {
    return <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim, fontFamily: MONO }}>No audit events.</Typography>;
  }
  return (
    <Box>
      {events.map((ev) => (
        <Box
          key={ev.id}
          sx={{ display: 'flex', gap: 1, justifyContent: 'space-between', alignItems: 'flex-start', py: 0.6, borderLeft: `2px solid ${colors.border.default}`, pl: 1.25, mb: 0.25, cursor: 'pointer' }}
        >
          <Box onClick={() => setOpenId(openId === ev.id ? null : ev.id)}>
            <Chip
              size="small"
              label={ev.event}
              sx={{
                fontFamily: MONO,
                fontSize: '0.6rem',
                color: auditColor(ev.event),
                bgcolor: alphaColor(auditColor(ev.event), '12'),
                mb: 0.3,
              }}
            />
            <Typography sx={{ fontSize: '0.58rem', fontFamily: MONO, color: colors.text.dim }}>
              {new Date(ev.timestamp).toLocaleString()} · {ev.actor}
            </Typography>
            {openId === ev.id && (
              <Typography component="pre" sx={{ fontSize: '0.58rem', fontFamily: MONO, color: colors.text.secondary, whiteSpace: 'pre-wrap', mt: 0.5 }}>
                {JSON.stringify(ev.details ?? {}, null, 2)}
              </Typography>
            )}
          </Box>
          <Button
            size="small"
            onClick={(e) => { e.stopPropagation(); void copyLink(ev.id); }}
            sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.58rem', color: colors.text.dim, minWidth: 0, p: 0 }}
          >
            Copy link
          </Button>
        </Box>
      ))}
    </Box>
  );
}
