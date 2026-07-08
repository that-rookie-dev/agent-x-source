import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import { integrations } from '../../api';
import { settingsTheme, settingsMonoSx } from '../../styles/settings-theme';

import { colors, alphaColor } from '../../theme';
interface AuditEntry {
  id: string;
  timestamp: string;
  providerId: string;
  toolName: string;
  readonly: boolean;
  success: boolean;
  error?: string;
  argsSummary?: string;
}

export function IntegrationAuditPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await integrations.audit(100);
      setEntries(res.entries);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <Box sx={{ mb: 3, p: 2, borderRadius: 1.5, border: `1px solid ${settingsTheme.border.default}`, bgcolor: settingsTheme.bg.panel }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, ...settingsMonoSx }}>
          Audit log
        </Typography>
        <Button size="small" onClick={() => { void refresh(); }} sx={{ fontSize: '0.55rem', ...settingsMonoSx }}>
          Refresh
        </Button>
      </Box>

      {loading ? (
        <Typography sx={{ fontSize: '0.6rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>Loading…</Typography>
      ) : entries.length === 0 ? (
        <Typography sx={{ fontSize: '0.6rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>No integration tool calls yet.</Typography>
      ) : (
        <Box sx={{ maxHeight: 240, overflow: 'auto' }}>
          {entries.slice().reverse().map((entry) => (
            <Box
              key={entry.id}
              sx={{
                py: 0.75,
                borderBottom: `1px solid ${alphaColor(settingsTheme.border.default, '40')}`,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 0.5,
                alignItems: 'center',
              }}
            >
              <Chip
                size="small"
                label={entry.success ? 'OK' : 'FAIL'}
                sx={{
                  height: 16,
                  fontSize: '0.45rem',
                  bgcolor: entry.success ? alphaColor(colors.accent.green, '22') : alphaColor(colors.accent.red, '22'),
                  color: entry.success ? colors.accent.green : colors.accent.red,
                }}
              />
              <Typography sx={{ fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace", color: settingsTheme.text.primary }}>
                {entry.providerId}:{entry.toolName}
              </Typography>
              <Typography sx={{ fontSize: '0.5rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
                {new Date(entry.timestamp).toLocaleString()}
              </Typography>
              {entry.argsSummary && (
                <Typography sx={{ fontSize: '0.5rem', color: settingsTheme.text.secondary, width: '100%', ...settingsMonoSx }}>
                  {entry.argsSummary}
                </Typography>
              )}
              {entry.error && (
                <Typography sx={{ fontSize: '0.5rem', color: colors.accent.red, width: '100%', ...settingsMonoSx }}>
                  {entry.error}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
