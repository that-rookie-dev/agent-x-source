import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import { capabilities, type CapabilityAuditRecord } from '../../api';
import { colors, MONO } from '../../theme';

interface DashboardData {
  stats: { total: number; byStatus: Record<string, number>; byKind: Record<string, number> };
  topTools: Array<{ name: string; uses: number; lastUsedAt: number }>;
  failedGens: number;
  approvalRate: number;
  pipeline: Record<string, number>;
  recent: CapabilityAuditRecord[];
}

export function CapabilityDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setData(await capabilities.dashboard());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed');
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <Box sx={{ p: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.75rem' }}>Pipeline dashboard</Typography>
        <Button size="small" onClick={() => void load()} sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.65rem' }}>Refresh</Button>
      </Box>
      {error && <Typography sx={{ color: colors.accent.red, fontFamily: MONO, fontSize: '0.7rem' }}>{error}</Typography>}
      {data && (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 1, mb: 1.5 }}>
            {Object.entries(data.pipeline).map(([k, v]) => (
              <Box key={k} sx={{ p: 1, border: `1px solid ${colors.border.default}`, borderRadius: 0.5, textAlign: 'center' }}>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: colors.text.dim, textTransform: 'uppercase' }}>{k}</Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '1rem', color: colors.text.primary }}>{v}</Typography>
              </Box>
            ))}
            <Box sx={{ p: 1, border: `1px solid ${colors.border.default}`, borderRadius: 0.5, textAlign: 'center' }}>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: colors.text.dim }}>APPROVAL</Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: '1rem', color: colors.text.primary }}>{data.approvalRate}%</Typography>
            </Box>
            <Box sx={{ p: 1, border: `1px solid ${colors.border.default}`, borderRadius: 0.5, textAlign: 'center' }}>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: colors.text.dim }}>FAILED GENS</Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: '1rem', color: colors.text.primary }}>{data.failedGens}</Typography>
            </Box>
          </Box>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', mb: 0.5 }}>Top tools</Typography>
          {data.topTools.length === 0 ? (
            <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: colors.text.dim }}>No usage yet.</Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1.5 }}>
              {data.topTools.map((t) => (
                <Box key={t.name} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 0.5, borderBottom: `1px solid ${colors.border.subtle}` }}>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem' }}>{t.name}</Typography>
                  <Chip size="small" label={`uses ${t.uses}`} sx={{ fontFamily: MONO, fontSize: '0.55rem' }} />
                </Box>
              ))}
            </Box>
          )}
          <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', mb: 0.5 }}>Recent events</Typography>
          <Box sx={{ maxHeight: 200, overflow: 'auto' }}>
            {(data.recent ?? []).slice(0, 20).map((e) => (
              <Box key={e.id} sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: colors.text.secondary }}>{e.event}</Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: colors.text.dim }}>{new Date(e.timestamp).toLocaleTimeString()}</Typography>
              </Box>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
}
