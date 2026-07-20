import Box from '@mui/material/Box';
import type { CortexMeta } from '../api';
import { CATEGORY_STYLES } from '../palette';
import { glassPanel, hudLabel, MONO } from './hudStyles';

export function Legend({ meta }: { meta: CortexMeta | null }) {
  const countByCategory = new Map((meta?.categories ?? []).map((c) => [c.category, c.count]));
  const entries = Object.entries(CATEGORY_STYLES).filter(([key]) => (countByCategory.get(key) ?? 0) > 0);
  if (entries.length === 0) return null;

  return (
    <Box sx={{ ...glassPanel, position: 'absolute', bottom: 16, left: 16, px: 1.75, py: 1.25, pointerEvents: 'auto' }}>
      <Box sx={{ ...hudLabel, mb: 0.75 }}>memory types</Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {entries.map(([key, style]) => (
          <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 0.9 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: style.css, boxShadow: `0 0 7px ${style.css}` }} />
            <Box component="span" sx={{ fontFamily: MONO, fontSize: '0.62rem', color: '#c7d2f0', minWidth: 76 }}>{style.name}</Box>
            <Box component="span" sx={{ fontFamily: MONO, fontSize: '0.6rem', color: 'rgba(148,163,216,0.6)' }}>
              {(countByCategory.get(key) ?? 0).toLocaleString()}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
