import { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { IntegrationConnection, IntegrationProvider } from '../../api';
import { settingsTheme, settingsMonoSx, settingsDialogPaperSx } from '../../styles/settings-theme';
import {
  AUTH_MODE_LABELS,
  CATEGORY_LABELS,
  TRUST_LABELS,
  getProviderPackageLabel,
  isInstalledConnection,
  providerPackageSignIn,
} from './integration-ui';
import { ConnectWizard } from './ConnectWizard';
import { PackageSignInPanel } from './PackageSignInPanel';
import type { ConnectIntegrationRequest } from '../../api';

export interface ProviderDetailModalProps {
  provider: IntegrationProvider | null;
  connection?: IntegrationConnection;
  connecting: boolean;
  busy?: boolean;
  onClose: () => void;
  onConnect: (provider: IntegrationProvider) => void;
  onDisconnect?: (connection: IntegrationConnection) => void;
  onSync?: (connection: IntegrationConnection) => void;
  onConnectSubmit: (request: ConnectIntegrationRequest) => Promise<void>;
  onOAuthStart?: (remoteUrl?: string) => Promise<void>;
  onCancelConnect: () => void;
  showConnectWizard: boolean;
  autoStartSignIn?: boolean;
  onAutoStartSignInConsumed?: () => void;
}

export function ProviderDetailModal({
  provider,
  connection,
  connecting,
  busy,
  onClose,
  onConnect,
  onDisconnect,
  onSync,
  onConnectSubmit,
  onOAuthStart,
  onCancelConnect,
  showConnectWizard,
  autoStartSignIn,
  onAutoStartSignInConsumed,
}: ProviderDetailModalProps) {
  const [view, setView] = useState<'detail' | 'connect'>('detail');

  useEffect(() => {
    setView(showConnectWizard ? 'connect' : 'detail');
  }, [showConnectWizard, provider?.id]);

  if (!provider) return null;

  const installed = isInstalledConnection(connection);
  const connected = connection?.status === 'connected';
  const errored = connection?.status === 'error';
  const packageSignIn = providerPackageSignIn(provider);
  const packageLabel = getProviderPackageLabel(provider);
  const highlights = provider.highlights ?? [];

  const handleClose = () => {
    setView('detail');
    onCancelConnect();
    onClose();
  };

  const openConnect = () => {
    setView('connect');
    onConnect(provider);
  };

  return (
    <Dialog
      open
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { ...settingsDialogPaperSx, borderRadius: '8px', maxHeight: '90vh' } }}
    >
      <Box sx={{ px: 3, pt: 2.5, pb: 2, borderBottom: `1px solid ${settingsTheme.border.subtle}`, position: 'relative' }}>
        <IconButton
          size="small"
          onClick={handleClose}
          sx={{ position: 'absolute', top: 8, right: 8, color: settingsTheme.text.dim }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>

        <Typography sx={{
          fontSize: { xs: '1.75rem', sm: '2rem' },
          fontWeight: 700,
          color: settingsTheme.text.primary,
          letterSpacing: '-0.03em',
          lineHeight: 1.1,
          pr: 4,
        }}>
          {provider.name}
        </Typography>

        <Typography sx={{ fontSize: '0.72rem', color: settingsTheme.text.dim, mt: 1, ...settingsMonoSx }}>
          {CATEGORY_LABELS[provider.category] ?? provider.category}
          {' · '}{TRUST_LABELS[provider.trust] ?? provider.trust}
          {provider.catalogStatus === 'candidate' ? ' · trial' : ''}
          {installed ? ' · installed' : ''}
        </Typography>
      </Box>

      <DialogContent sx={{ px: 3, py: 2.5 }}>
        {view === 'connect' && showConnectWizard ? (
          <Box>
            <Button size="small" onClick={() => { setView('detail'); onCancelConnect(); }} sx={{ mb: 2, fontSize: '0.65rem', textTransform: 'none', color: settingsTheme.text.dim }}>
              ← Back
            </Button>
            <ConnectWizard
              provider={provider}
              onConnect={onConnectSubmit}
              onOAuthStart={onOAuthStart}
              onCancel={() => { setView('detail'); onCancelConnect(); }}
            />
          </Box>
        ) : (
          <>
            <Typography sx={{ fontSize: '0.8rem', color: settingsTheme.text.secondary, lineHeight: 1.6, mb: 2 }}>
              {provider.description}
            </Typography>

            {provider.website && (
              <Button
                size="small"
                endIcon={<OpenInNewIcon sx={{ fontSize: 12 }} />}
                href={provider.website}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ mb: 2, fontSize: '0.65rem', textTransform: 'none', color: settingsTheme.text.dim, px: 0 }}
              >
                Website
              </Button>
            )}

            {highlights.length > 0 && (
              <Section title="What you can do">
                {highlights.map((item) => (
                  <Typography key={item} sx={{ fontSize: '0.75rem', color: settingsTheme.text.secondary, lineHeight: 1.6, mb: 0.35 }}>
                    · {item}
                  </Typography>
                ))}
              </Section>
            )}

            <Section title="Authentication">
              <Typography sx={{ fontSize: '0.75rem', color: settingsTheme.text.secondary, mb: 1 }}>
                {AUTH_MODE_LABELS[provider.auth.primary] ?? provider.auth.primary}
              </Typography>
              {provider.auth.fields?.map((field) => (
                <Typography key={field.key} sx={{ fontSize: '0.72rem', color: settingsTheme.text.dim, mb: 0.35 }}>
                  {field.label}{field.required === false ? ' (optional)' : ''}
                </Typography>
              ))}
            </Section>

            {installed && packageSignIn && connection && (
              <PackageSignInPanel
                provider={provider}
                connection={connection}
                busy={busy}
                autoStartSignIn={autoStartSignIn}
                onAutoStartConsumed={onAutoStartSignInConsumed}
              />
            )}

            {provider.auth.connectGuide && provider.auth.connectGuide.length > 0 && (
              <Section title="How to connect">
                {provider.auth.connectGuide.map((step, index) => (
                  <Box key={step.title} sx={{ mb: 1.25 }}>
                    <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: settingsTheme.text.primary }}>
                      {index + 1}. {step.title}
                    </Typography>
                    <Typography sx={{ fontSize: '0.72rem', color: settingsTheme.text.secondary, lineHeight: 1.55, mt: 0.25 }}>
                      {step.body}
                    </Typography>
                  </Box>
                ))}
              </Section>
            )}

            {provider.evaluationNotes && (
              <Section title="Notes">
                <Typography sx={{ fontSize: '0.72rem', color: settingsTheme.text.dim, lineHeight: 1.55, ...settingsMonoSx }}>
                  {provider.evaluationNotes}
                </Typography>
              </Section>
            )}

            {packageLabel && (
              <Section title="Technical">
                <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.text.dim, ...settingsMonoSx, wordBreak: 'break-all' }}>
                  {provider.server.type === 'remote' ? 'Endpoint' : 'Package'}: {packageLabel}
                </Typography>
              </Section>
            )}

            {connection && (
              <Section title="Status">
                <Typography sx={{ fontSize: '0.75rem', color: errored ? settingsTheme.accent.alert : settingsTheme.text.secondary, ...settingsMonoSx }}>
                  {errored ? `Error — ${connection.error ?? connection.status}` : installed ? `${connected ? 'Connected' : connection.status} · ${connection.toolCount ?? 0} tools` : connection.status}
                </Typography>
              </Section>
            )}
          </>
        )}
      </DialogContent>

      {view === 'detail' && (
        <Box sx={{
          px: 3,
          py: 2,
          borderTop: `1px solid ${settingsTheme.border.subtle}`,
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 1,
        }}>
          {connection ? (
            <>
              <Button size="small" disabled={busy} onClick={() => onSync?.(connection)} sx={{ fontSize: '0.65rem', textTransform: 'none', color: settingsTheme.text.secondary }}>
                Sync
              </Button>
              <Button size="small" disabled={busy} onClick={() => onDisconnect?.(connection)} sx={{ fontSize: '0.65rem', textTransform: 'none', color: settingsTheme.text.secondary }}>
                Disconnect
              </Button>
            </>
          ) : (
            <Button
              size="small"
              variant="outlined"
              disabled={busy || connecting}
              onClick={openConnect}
              sx={{ fontSize: '0.65rem', textTransform: 'none', borderColor: settingsTheme.border.strong, color: settingsTheme.text.primary }}
            >
              {connecting ? 'Connecting…' : 'Connect'}
            </Button>
          )}
        </Box>
      )}
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: import('react').ReactNode }) {
  return (
    <Box sx={{ mb: 2.5 }}>
      <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: settingsTheme.text.primary, mb: 0.75 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}
