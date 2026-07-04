import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import type { IntegrationConnection, IntegrationProvider } from '../../api';
import { settingsTheme, settingsMonoSx } from '../../styles/settings-theme';
import { CATEGORY_LABELS, isInstalledConnection, providerPackageSignIn } from './integration-ui';

export interface StoreProviderCardProps {
  provider: IntegrationProvider;
  connection?: IntegrationConnection;
  onOpen: (provider: IntegrationProvider) => void;
  onConnect: (provider: IntegrationProvider) => void;
  onSignIn?: (provider: IntegrationProvider) => void;
}

export function StoreProviderCard({ provider, connection, onOpen, onConnect, onSignIn }: StoreProviderCardProps) {
  const installed = isInstalledConnection(connection);
  const packageSignIn = providerPackageSignIn(provider);
  const needsSignIn = installed && Boolean(packageSignIn);

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

      {needsSignIn && (
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
          Sign in to {packageSignIn?.label ?? provider.name}
        </Button>
      )}
    </Box>
  );
}
