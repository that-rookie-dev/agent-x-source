import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { useEffect, useState } from 'react';
import { colors, alphaColor } from '../theme';
import { settings } from '../api';

const NEURON_URL = (import.meta.env.VITE_NEURON_URL as string) || '/neuron';

export function BrainPanel() {
  const [status, setStatus] = useState<{ schemaVersion?: number; ageAvailable?: boolean; loading: boolean; error?: string }>({
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    settings.db.provisionStatus().then((s) => {
      if (cancelled) return;
      setStatus({
        schemaVersion: s.schemaVersion,
        ageAvailable: s.age?.available,
        loading: false,
      });
    }).catch(() => {
      if (cancelled) return;
      setStatus({ loading: false, error: 'Unable to reach neural storage' });
    });
    return () => { cancelled = true; };
  }, []);

  const handleOpen = () => {
    window.open(NEURON_URL, 'agentx-neuron', 'noopener,noreferrer');
  };

  return (
    <Box sx={{ height: '100%', p: 3, display: 'flex', flexDirection: 'column', gap: 2, overflow: 'auto' }}>
      <Typography variant="h6" sx={{ fontFamily: "'JetBrains Mono', monospace", color: colors.text.primary }}>
        Neural Brain
      </Typography>
      <Typography variant="body2" sx={{ color: colors.text.secondary }}>
        Open the standalone real-time brain visualization to observe neurogenesis, synaptic binding, and cluster layouts.
      </Typography>

      <Box sx={{ p: 2, border: `1px solid ${colors.border.default}`, borderRadius: 1, bgcolor: colors.bg.secondary }}>
        <Typography variant="body2" sx={{ fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, mb: 1 }}>
          STORAGE STATUS
        </Typography>
        {status.loading ? (
          <Typography variant="body2" sx={{ color: colors.text.dim }}>Loading...</Typography>
        ) : status.error ? (
          <Typography variant="body2" sx={{ color: colors.accent.red }}>{status.error}</Typography>
        ) : (
          <Box component="pre" sx={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem', color: colors.text.secondary, m: 0 }}>
            {JSON.stringify({ schemaVersion: status.schemaVersion, ageAvailable: status.ageAvailable }, null, 2)}
          </Box>
        )}
      </Box>

      <Button
        variant="outlined"
        onClick={handleOpen}
        sx={{
          fontFamily: "'JetBrains Mono', monospace",
          textTransform: 'none',
          color: colors.accent.blue,
          borderColor: colors.accent.blue,
          '&:hover': { borderColor: colors.accent.blue, bgcolor: alphaColor(colors.accent.blue, '10') },
        }}
      >
        Open Brain Visualization
      </Button>
    </Box>
  );
}
