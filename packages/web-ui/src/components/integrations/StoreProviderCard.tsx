import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import type { IntegrationConnection, IntegrationProvider } from '../../api';
import { settingsTheme, settingsMonoSx } from '../../styles/settings-theme';
import { CATEGORY_LABELS, isInstalledConnection, providerPackageSignIn } from './integration-ui';
import { usePackageSignInStatus } from './usePackageSignInStatus';
import { useMcpStdioAuthStatus } from './useMcpStdioAuthStatus';

import { alphaColor } from '../../theme';
export interface StoreProviderCardProps {
  provider: IntegrationProvider;
  connection?: IntegrationConnection;
  onOpen: (provider: IntegrationProvider) => void;
  onConnect: (provider: IntegrationProvider) => void;
  onSignIn?: (provider: IntegrationProvider) => void;
  onSync?: (connection: IntegrationConnection) => void;
}

export function StoreProviderCard({ provider, connection, onOpen, onConnect, onSignIn, onSync }: StoreProviderCardProps) {
  const installed = isInstalledConnection(connection);
  const packageSignIn = providerPackageSignIn(provider);
  const { isChecking, isSignedIn, needsSignIn } = usePackageSignInStatus(provider, connection);
  const {
    isChecking: isMcpAuthChecking,
    isSignedIn: isMcpAuthSignedIn,
    needsSignIn: needsMcpAuthSignIn,
  } = useMcpStdioAuthStatus(provider, connection);

  return (
    <Box
      onClick={() => onOpen(provider)}
      sx={{
        borderRadius: '8px',
        border: `1px solid ${settingsTheme.border.subtle}`,
        bgcolor: 'transparent',
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
        minHeight: 120,
        cursor: 'pointer',
        transition: 'border-color 0.15s ease',
        '&:hover': { borderColor: settingsTheme.border.strong },
      }}
    >
      <Typography sx={{
        fontSize: '0.95rem',
        fontWeight: 600,
        color: settingsTheme.text.primary,
        lineHeight: 1.25,
      }}>
        {provider.name}
      </Typography>

      <Typography sx={{ fontSize: '0.58rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
        {CATEGORY_LABELS[provider.category] ?? provider.category}
        {provider.catalogStatus === 'candidate' ? ' · trial' : ''}
        {installed ? ' · installed' : ''}
      </Typography>

      <Typography sx={{
        fontSize: '0.68rem',
        color: settingsTheme.text.secondary,
        lineHeight: 1.45,
        flex: 1,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {provider.description}
      </Typography>

      {!installed && (
        <Button
          size="small"
          variant="text"
          onClick={(e) => { e.stopPropagation(); onConnect(provider); }}
          sx={{
            alignSelf: 'flex-start',
            fontSize: '0.65rem',
            textTransform: 'none',
            color: settingsTheme.text.primary,
            px: 0,
            minWidth: 0,
            ...settingsMonoSx,
            '&:hover': { bgcolor: 'transparent', textDecoration: 'underline' },
          }}
        >
          Get
        </Button>
      )}

      {installed && packageSignIn && isChecking && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, alignSelf: 'flex-start' }}>
          <CircularProgress size={12} />
          <Typography sx={{ fontSize: '0.62rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
            Checking account…
          </Typography>
        </Box>
      )}

      {installed && packageSignIn && isSignedIn && (
        <Chip
          label="Signed in"
          size="small"
          onClick={(e) => e.stopPropagation()}
          sx={{
            alignSelf: 'flex-start',
            height: 22,
            fontSize: '0.62rem',
            fontWeight: 600,
            bgcolor: `${alphaColor(settingsTheme.accent.signal, '22')}`,
            color: settingsTheme.accent.signal,
            border: `1px solid ${alphaColor(settingsTheme.accent.signal, '55')}`,
            ...settingsMonoSx,
          }}
        />
      )}

      {installed && provider.auth.mcpStdioAuth && isMcpAuthChecking && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, alignSelf: 'flex-start' }}>
          <CircularProgress size={12} />
          <Typography sx={{ fontSize: '0.62rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
            Checking Google sign-in…
          </Typography>
        </Box>
      )}

      {installed && provider.auth.mcpStdioAuth && isMcpAuthSignedIn && (
        <Chip
          label="Signed in"
          size="small"
          onClick={(e) => e.stopPropagation()}
          sx={{
            alignSelf: 'flex-start',
            height: 22,
            fontSize: '0.62rem',
            fontWeight: 600,
            bgcolor: `${alphaColor(settingsTheme.accent.signal, '22')}`,
            color: settingsTheme.accent.signal,
            border: `1px solid ${alphaColor(settingsTheme.accent.signal, '55')}`,
            ...settingsMonoSx,
          }}
        />
      )}

      {installed && connection && connection.status === 'error' && onSync && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignSelf: 'flex-start' }}>
          <Chip
            label="Error"
            size="small"
            onClick={(e) => e.stopPropagation()}
            sx={{
              alignSelf: 'flex-start',
              height: 22,
              fontSize: '0.62rem',
              fontWeight: 600,
              bgcolor: `${alphaColor(settingsTheme.accent.alert, '22')}`,
              color: settingsTheme.accent.alert,
              border: `1px solid ${alphaColor(settingsTheme.accent.alert, '55')}`,
              ...settingsMonoSx,
            }}
          />
          <Button
            size="small"
            variant="outlined"
            onClick={(e) => { e.stopPropagation(); onSync(connection); }}
            sx={{
              alignSelf: 'flex-start',
              fontSize: '0.65rem',
              textTransform: 'none',
              borderColor: settingsTheme.accent.alert,
              color: settingsTheme.accent.alert,
              ...settingsMonoSx,
            }}
          >
            Reconnect
          </Button>
        </Box>
      )}

      {(needsSignIn || needsMcpAuthSignIn) && (
        <Button
          size="small"
          variant="outlined"
          onClick={(e) => {
            e.stopPropagation();
            if (onSignIn) onSignIn(provider);
            else onOpen(provider);
          }}
          sx={{
            alignSelf: 'flex-start',
            fontSize: '0.65rem',
            textTransform: 'none',
            borderColor: settingsTheme.accent.hud,
            color: settingsTheme.accent.hud,
            ...settingsMonoSx,
          }}
        >
          {needsMcpAuthSignIn
            ? `Sign in with Google (${provider.name})`
            : `Sign in to ${packageSignIn?.label ?? provider.name}`}
        </Button>
      )}
    </Box>
  );
}
