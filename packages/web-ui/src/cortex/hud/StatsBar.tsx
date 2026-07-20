import Box from '@mui/material/Box';
import type { CortexMeta } from '../api';
import { glassPanel, hudLabel, MONO } from './hudStyles';

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.2, minWidth: 64 }}>
      <Box component="span" sx={hudLabel}>{label}</Box>
      <Box component="span" sx={{ fontFamily: MONO, fontSize: '0.95rem', fontWeight: 600, color: accent ?? '#e6ecff', lineHeight: 1 }}>
        {value}
      </Box>
    </Box>
  );
}

export interface StatsBarProps {
  meta: CortexMeta | null;
  liveNodeDelta: number;
  live: boolean;
}

export function StatsBar({ meta, liveNodeDelta, live }: StatsBarProps) {
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayGrowth = (meta?.growth.find((g) => g.day === todayKey)?.count ?? 0) + liveNodeDelta;

  return (
    <Box sx={{ ...glassPanel, position: 'absolute', top: 16, left: 16, px: 2, py: 1.25, display: 'flex', alignItems: 'center', gap: 2.5, pointerEvents: 'auto' }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.2 }}>
        <Box component="span" sx={{ fontFamily: MONO, fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.22em', color: '#e6ecff' }}>
          NEURAL CORTEX
        </Box>
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6 }}>
          <Box component="span" sx={{
            width: 6, height: 6, borderRadius: '50%',
            bgcolor: live ? '#34d399' : '#64748b',
            boxShadow: live ? '0 0 8px #34d399' : 'none',
            animation: live ? 'cortex-live-pulse 2.2s ease-in-out infinite' : 'none',
            '@keyframes cortex-live-pulse': {
              '0%, 100%': { opacity: 0.45 },
              '50%': { opacity: 1 },
            },
          }} />
          <Box component="span" sx={{ ...hudLabel, color: live ? '#6ee7b7' : undefined }}>
            {live ? 'live' : 'connecting'}
          </Box>
        </Box>
      </Box>
      <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: 'rgba(125,145,255,0.14)' }} />
      <Stat label="neurons" value={(meta ? meta.nodeCount + liveNodeDelta : 0).toLocaleString()} />
      <Stat label="synapses" value={(meta?.edgeCount ?? 0).toLocaleString()} />
      <Stat label="regions" value={meta?.communityCount ?? 0} />
      {todayGrowth > 0 && (
        <Stat label="grown today" value={`+${todayGrowth}`} accent="#6ee7b7" />
      )}
    </Box>
  );
}
