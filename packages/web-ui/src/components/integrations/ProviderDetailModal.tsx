import { useEffect, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { IntegrationConnection, IntegrationProvider } from '../../api';
import { integrations } from '../../api';
import { settingsTheme, settingsMonoSx, settingsDialogPaperSx } from '../../styles/settings-theme';
import {
  AUTH_MODE_LABELS,
  CATEGORY_LABELS,
  TRUST_LABELS,
  canUseHubBrowserOAuth,
  getProviderPackageLabel,
  isInstalledConnection,
  providerPackageSignIn,
} from './integration-ui';
import { ConnectWizard } from './ConnectWizard';
import { ProviderSetupWizard } from './setup-wizards/ProviderSetupWizard';
import { PackageSignInPanel } from './PackageSignInPanel';
import { McpStdioAuthPanel } from './McpStdioAuthPanel';
import { HubOAuthPanel } from './HubOAuthPanel';
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
  onConnectSubmit: (request: ConnectIntegrationRequest) => Promise<IntegrationConnection>;
  onOAuthStart?: (remoteUrl?: string) => Promise<{ state: string } | void>;
  onOAuthComplete?: () => void | Promise<void>;
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
  onOAuthComplete,
  onCancelConnect,
  showConnectWizard,
  autoStartSignIn,
  onAutoStartSignInConsumed,
}: ProviderDetailModalProps) {
  const [view, setView] = useState<'detail' | 'connect'>('detail');
  const [mcpToolsOpen, setMcpToolsOpen] = useState(false);
  const [mcpTools, setMcpTools] = useState<Array<{
    mcpName: string;
    name: string;
    description: string;
    riskLevel: string;
    defaultDecision: 'allow' | 'deny' | 'ask';
    benchmarkStatus?: 'ok' | 'error' | 'skipped' | 'pending';
    benchmarkError?: string;
    benchmarkSkipReason?: string;
    lastTestedAt?: string;
    readonly?: boolean;
  }>>([]);
  const [mcpToolsLoading, setMcpToolsLoading] = useState(false);
  const [benchmarkSummary, setBenchmarkSummary] = useState<{ ok: number; error: number; skipped: number } | null>(null);

  useEffect(() => {
    setView(showConnectWizard ? 'connect' : 'detail');
    setMcpToolsOpen(false);
    setMcpTools([]);
    setBenchmarkSummary(null);
  }, [showConnectWizard, provider?.id]);

  if (!provider) return null;

  const installed = isInstalledConnection(connection);
  const connected = connection?.status === 'connected';
  const errored = connection?.status === 'error';
  const packageSignIn = providerPackageSignIn(provider);
  const hubOAuth = canUseHubBrowserOAuth(provider);
  const packageLabel = getProviderPackageLabel(provider);
  const highlights = provider.highlights ?? [];

  const handleClose = () => {
    setView('detail');
    setMcpToolsOpen(false);
    onCancelConnect();
    onClose();
  };

  const handleViewTools = async () => {
    if (!connection) return;
    setMcpToolsOpen(true);
    setMcpToolsLoading(true);
    try {
      const result = await integrations.tools(connection.id);
      setMcpTools(result.tools);
      setBenchmarkSummary(result.benchmarkSummary ?? null);
    } finally {
      setMcpToolsLoading(false);
    }
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
            {provider.setupWizard && provider.setupWizard.template !== 'custom' ? (
              <ProviderSetupWizard
                provider={provider}
                onConnect={onConnectSubmit}
                onOAuthStart={onOAuthStart}
                onOAuthComplete={onOAuthComplete}
                onCancel={() => { setView('detail'); onCancelConnect(); }}
              />
            ) : (
              <ConnectWizard
                provider={provider}
                onConnect={onConnectSubmit}
                onOAuthStart={onOAuthStart}
                onCancel={() => { setView('detail'); onCancelConnect(); }}
              />
            )}
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
                onSignedIn={() => onOAuthComplete?.()}
              />
            )}

            {connection && provider.auth.mcpStdioAuth && (
              <Section title="Google sign-in">
                <McpStdioAuthPanel
                  provider={provider}
                  connection={connection}
                  busy={busy}
                  autoStart={autoStartSignIn}
                  onAutoStartConsumed={onAutoStartSignInConsumed}
                  onSignedIn={() => onOAuthComplete?.()}
                />
              </Section>
            )}

            {connection && hubOAuth && !provider.auth.mcpStdioAuth && (
              <Section title="Account sign-in">
                <HubOAuthPanel
                  provider={provider}
                  connection={connection}
                  busy={busy}
                  autoStart={autoStartSignIn}
                  onAutoStartConsumed={onAutoStartSignInConsumed}
                  onSignedIn={onOAuthComplete}
                />
              </Section>
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
                {busy || connection.status === 'syncing' ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CircularProgress size={12} sx={{ color: settingsTheme.accent.hud }} />
                    <Typography sx={{ fontSize: '0.75rem', color: settingsTheme.text.secondary, ...settingsMonoSx }}>
                      Syncing tools…
                    </Typography>
                  </Box>
                ) : (
                  <Typography sx={{ fontSize: '0.75rem', color: errored ? settingsTheme.accent.alert : settingsTheme.text.secondary, ...settingsMonoSx }}>
                    {errored ? `Error — ${connection.error ?? connection.status}` : installed ? `${connected ? 'Connected' : connection.status} · ${connection.toolCount ?? 0} tools` : connection.status}
                  </Typography>
                )}
              </Section>
            )}

            {mcpToolsOpen && connection && (
              <Section title="Connected tools">
                {mcpToolsLoading ? (
                  <CircularProgress size={14} sx={{ color: settingsTheme.accent.hud }} />
                ) : mcpTools.length === 0 ? (
                  <Typography sx={{ fontSize: '0.72rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
                    No tools found.
                  </Typography>
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                    {benchmarkSummary && (
                      <Typography sx={{ fontSize: '0.62rem', color: settingsTheme.text.dim, mb: 0.5, ...settingsMonoSx }}>
                        Probe: {benchmarkSummary.ok} ok · {benchmarkSummary.error} failed · {benchmarkSummary.skipped} skipped
                      </Typography>
                    )}
                    {mcpTools.map((tool) => {
                      const failed = tool.benchmarkStatus === 'error';
                      const ok = tool.benchmarkStatus === 'ok';
                      const skipped = tool.benchmarkStatus === 'skipped';
                      return (
                        <Box
                          key={tool.mcpName}
                          sx={{
                            bgcolor: settingsTheme.bg.inset,
                            border: `1px solid ${failed ? settingsTheme.accent.alert : settingsTheme.border.subtle}`,
                            borderRadius: '4px',
                            p: 1,
                          }}
                        >
                          <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: settingsTheme.text.primary, ...settingsMonoSx }}>
                            {tool.name}{' '}
                            <Box component="span" sx={{ color: settingsTheme.text.dim, fontWeight: 400 }}>({tool.mcpName})</Box>
                          </Typography>
                          <Typography sx={{ fontSize: '0.62rem', color: settingsTheme.text.secondary, ...settingsMonoSx, mt: 0.25 }}>
                            {tool.description || 'No description'}
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                            <Typography sx={{ fontSize: '0.55rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
                              Risk: {tool.riskLevel}
                            </Typography>
                            <Typography sx={{ fontSize: '0.55rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
                              Default: {tool.defaultDecision}
                            </Typography>
                            {ok && (
                              <Typography sx={{ fontSize: '0.55rem', color: settingsTheme.accent.signal, ...settingsMonoSx }}>
                                Probe OK
                              </Typography>
                            )}
                            {skipped && (
                              <Typography sx={{ fontSize: '0.55rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
                                {tool.benchmarkSkipReason ?? 'Not probed'}
                              </Typography>
                            )}
                          </Box>
                          {failed && tool.benchmarkError && (
                            <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.accent.alert, mt: 0.75, lineHeight: 1.4, ...settingsMonoSx }}>
                              {tool.benchmarkError}
                            </Typography>
                          )}
                        </Box>
                      );
                    })}
                  </Box>
                )}
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
              <Button size="small" disabled={busy || !connected} onClick={handleViewTools} sx={{ fontSize: '0.65rem', textTransform: 'none', color: settingsTheme.text.secondary }}>
                View tools
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
