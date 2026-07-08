import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import type { IntegrationConnection, IntegrationProvider } from '../../api';
import { settingsTheme, settingsMonoSx } from '../../styles/settings-theme';

import { alphaColor } from '../../theme';
const CATEGORY_LABELS: Record<string, string> = {
  travel: 'Travel',
  productivity: 'Productivity',
  communication: 'Communication',
  finance: 'Finance',
  shopping: 'Shopping',
  smart_home: 'Smart Home',
  dev_ops: 'Dev & Ops',
  custom: 'Custom',
};

const TRUST_COLORS: Record<string, string> = {
  official: settingsTheme.accent.signal,
  verified: settingsTheme.accent.hud,
  community: settingsTheme.accent.amber,
};

export interface ProviderCardProps {
  provider: IntegrationProvider;
  connection?: IntegrationConnection;
  onConnect: (provider: IntegrationProvider) => void;
  onDisconnect?: (connection: IntegrationConnection) => void;
  onSync?: (connection: IntegrationConnection) => void;
  busy?: boolean;
}

export function ProviderCard({ provider, connection, onConnect, onDisconnect, onSync, busy }: ProviderCardProps) {
  const connected = connection?.status === 'connected';
  const errored = connection?.status === 'error';
  const syncing = connection?.status === 'syncing';

  return (
    <Box sx={{
      borderRadius: '6px',
      bgcolor: settingsTheme.bg.inset,
      border: `1px solid ${connected ? `${alphaColor(settingsTheme.accent.signal, '44')}` : settingsTheme.border.default}`,
      p: 2,
      display: 'flex',
      flexDirection: 'column',
      gap: 1.25,
      minHeight: 180,
    }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
        <Box>
          <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: settingsTheme.text.primary }}>
            {provider.name}
          </Typography>
          <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.text.dim, ...settingsMonoSx, mt: 0.25 }}>
            {CATEGORY_LABELS[provider.category] ?? provider.category}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
          <Chip
            size="small"
            label={provider.trust}
            sx={{
              height: 20,
              fontSize: '0.55rem',
              textTransform: 'uppercase',
              bgcolor: `${alphaColor(TRUST_COLORS[provider.trust] ?? settingsTheme.text.dim, '18')}`,
              color: TRUST_COLORS[provider.trust] ?? settingsTheme.text.dim,
              border: `1px solid ${alphaColor(TRUST_COLORS[provider.trust] ?? settingsTheme.text.dim, '33')}`,
              ...settingsMonoSx,
            }}
          />
          {provider.catalogStatus === 'candidate' && (
            <Chip
              size="small"
              label="candidate"
              sx={{
                height: 20,
                fontSize: '0.55rem',
                bgcolor: `${alphaColor(settingsTheme.accent.amber, '18')}`,
                color: settingsTheme.accent.amber,
                ...settingsMonoSx,
              }}
            />
          )}
        </Box>
      </Box>

      <Typography sx={{ fontSize: '0.72rem', color: settingsTheme.text.secondary, flex: 1, lineHeight: 1.5 }}>
        {provider.description}
      </Typography>

      {connection && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          <Chip
            size="small"
            label={syncing ? 'Syncing…' : errored ? 'Error' : connected ? 'Connected' : connection.status}
            sx={{
              height: 20,
              fontSize: '0.55rem',
              bgcolor: errored ? `${alphaColor(settingsTheme.accent.alert, '18')}` : `${alphaColor(settingsTheme.accent.signal, '18')}`,
              color: errored ? settingsTheme.accent.alert : settingsTheme.accent.signal,
              ...settingsMonoSx,
            }}
          />
          {typeof connection.toolCount === 'number' && connection.toolCount > 0 && (
            <Chip size="small" label={`${connection.toolCount} tools`} sx={{ height: 20, fontSize: '0.55rem', ...settingsMonoSx }} />
          )}
          {connection.accountLabel && (
            <Typography sx={{ fontSize: '0.62rem', color: settingsTheme.text.dim, alignSelf: 'center' }}>
              {connection.accountLabel}
            </Typography>
          )}
        </Box>
      )}

      {connection?.error && (
        <Typography sx={{ fontSize: '0.62rem', color: settingsTheme.accent.alert, ...settingsMonoSx }}>
          {connection.error}
        </Typography>
      )}

      <Box sx={{ display: 'flex', gap: 1, mt: 'auto' }}>
        {connection ? (
          <>
            <Button
              size="small"
              disabled={busy || syncing}
              onClick={() => onSync?.(connection)}
              sx={{ fontSize: '0.62rem', textTransform: 'uppercase', ...settingsMonoSx }}
            >
              Sync
            </Button>
            <Button
              size="small"
              color="error"
              disabled={busy}
              onClick={() => onDisconnect?.(connection)}
              sx={{ fontSize: '0.62rem', textTransform: 'uppercase', ...settingsMonoSx }}
            >
              Disconnect
            </Button>
          </>
        ) : (
          <Button
            size="small"
            variant="contained"
            disabled={busy}
            onClick={() => onConnect(provider)}
            sx={{
              fontSize: '0.62rem',
              textTransform: 'uppercase',
              bgcolor: settingsTheme.accent.hud,
              ...settingsMonoSx,
            }}
          >
            Connect
          </Button>
        )}
      </Box>
    </Box>
  );
}
