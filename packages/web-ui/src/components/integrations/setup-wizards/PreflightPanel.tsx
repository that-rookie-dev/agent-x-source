/** Preflight checks for MCP integration connect only — not first-run `SetupWizard`. */
import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import type { IntegrationProvider, SetupPreflightResult } from '../../../api';
import { integrations } from '../../../api';
import { settingsTheme, settingsMonoSx, settingsTextFieldSx } from '../../../styles/settings-theme';
import { copyToClipboard } from '../../../utils/clipboard';

import { alphaColor } from '../../../theme';
const CREDENTIAL_ONLY_CHECKS = new Set(['postgres_reachable', 'redis_reachable']);

export interface PreflightPanelProps {
  provider: IntegrationProvider;
  folderPath: string;
  onFolderPathChange: (path: string) => void;
  localNetworkAck: boolean;
  onLocalNetworkAck: (ack: boolean) => void;
  remoteUrl?: string;
  onReadyChange: (ready: boolean) => void;
}

export function PreflightPanel({
  provider,
  folderPath,
  onFolderPathChange,
  localNetworkAck,
  onLocalNetworkAck,
  remoteUrl,
  onReadyChange,
}: PreflightPanelProps) {
  const [results, setResults] = useState<SetupPreflightResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [clientIdInput, setClientIdInput] = useState('');
  const [savingClientId, setSavingClientId] = useState(false);
  const [clientIdError, setClientIdError] = useState('');
  const osPermissions = provider.setupWizard?.osPermissions ?? [];
  const needsFolderAccess = osPermissions.includes('folder_access');
  const needsLocalNetwork = osPermissions.includes('local_network');
  const desktop = typeof window !== 'undefined' ? window.agentx : undefined;

  const run = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const checks = (provider.setupWizard?.preflight ?? []).filter((c) => !CREDENTIAL_ONLY_CHECKS.has(c));
      const { results: next } = await integrations.preflight(provider.id, checks, {
        folderPath: folderPath.trim() || undefined,
        remoteUrl: remoteUrl?.trim() || undefined,
      });

      const merged = [...next];
      if (desktop?.checkNodeRuntime) {
        try {
          const runtime = await desktop.checkNodeRuntime();
          for (const check of merged) {
            if (check.id === 'node_available' && !check.ok && runtime.node) {
              check.ok = true;
              check.message = `Node.js ${runtime.node} detected`;
              check.fixHint = undefined;
            }
            if (check.id === 'npx_available' && !check.ok && runtime.npx) {
              check.ok = true;
              check.message = `npx ${runtime.npx} detected`;
              check.fixHint = undefined;
            }
          }
        } catch { /* desktop bridge optional */ }
      }

      setResults(merged);

      const checksOk = merged.every((r) => r.ok);
      const folderOk = !needsFolderAccess || Boolean(folderPath.trim());
      const networkOk = !needsLocalNetwork || localNetworkAck;
      onReadyChange(checksOk && folderOk && networkOk);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      onReadyChange(false);
    } finally {
      setLoading(false);
    }
  }, [
    provider.id,
    provider.setupWizard?.preflight,
    folderPath,
    remoteUrl,
    needsFolderAccess,
    needsLocalNetwork,
    localNetworkAck,
    onReadyChange,
    desktop,
  ]);

  useEffect(() => {
    void run();
  }, [run]);

  const pickFolder = async () => {
    if (!desktop?.openFolder) return;
    const chosen = await desktop.openFolder();
    if (chosen) onFolderPathChange(chosen);
  };

  const oauthClientMissing = results.some((r) => r.id === 'oauth_env_configured' && !r.ok);
  const clientIdEnvKey = provider.auth.oauth?.clientIdEnv;
  const oauthCallbackUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/integrations/oauth/callback`
    : '/api/integrations/oauth/callback';
  const isGoogleOAuth = Boolean(provider.auth.oauth?.discoveryUrl?.includes('google'));

  const saveClientId = async () => {
    const value = clientIdInput.trim();
    if (!value) return;
    setSavingClientId(true);
    setClientIdError('');
    try {
      await integrations.updateSettings({ oauthClientIds: { [provider.id]: value } });
      setClientIdInput('');
      await run();
    } catch (e) {
      setClientIdError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingClientId(false);
    }
  };

  return (
    <Box>
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: settingsTheme.text.primary, mb: 1 }}>
        System checks
      </Typography>
      <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.text.dim, mb: 1.5, lineHeight: 1.5 }}>
        These run before connecting so setup issues appear here — not after you think you&apos;re done.
      </Typography>

      {needsFolderAccess && (
        <Box sx={{ mb: 2, p: 1.5, borderRadius: '6px', border: `1px solid ${settingsTheme.border.default}`, bgcolor: settingsTheme.bg.elevated }}>
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: settingsTheme.text.primary, mb: 1 }}>
            Folder access
          </Typography>
          <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.text.secondary, mb: 1, lineHeight: 1.5 }}>
            Choose the folder now so macOS can grant access during setup.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField
              size="small"
              fullWidth
              label="Allowed folder"
              value={folderPath}
              onChange={(e) => onFolderPathChange(e.target.value)}
              sx={{ ...settingsTextFieldSx }}
            />
            {desktop?.openFolder && (
              <Button
                size="small"
                variant="outlined"
                onClick={() => { void pickFolder(); }}
                sx={{ fontSize: '0.62rem', whiteSpace: 'nowrap', borderColor: settingsTheme.accent.hud, color: settingsTheme.accent.hud }}
              >
                Browse…
              </Button>
            )}
          </Box>
        </Box>
      )}

      {needsLocalNetwork && (
        <Box sx={{ mb: 2, p: 1.5, borderRadius: '6px', border: `1px solid ${settingsTheme.border.default}`, bgcolor: settingsTheme.bg.elevated }}>
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: settingsTheme.text.primary, mb: 0.5 }}>
            Local network
          </Typography>
          <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.text.secondary, mb: 1, lineHeight: 1.5 }}>
            This integration talks to a device or service on your home network. Ensure the URL is reachable from this machine.
          </Typography>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={localNetworkAck}
                onChange={(e) => onLocalNetworkAck(e.target.checked)}
              />
            }
            label={
              <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.text.secondary }}>
                My instance is running and reachable on my local network
              </Typography>
            }
          />
        </Box>
      )}

      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <CircularProgress size={14} />
          <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.text.secondary, ...settingsMonoSx }}>
            Running checks…
          </Typography>
        </Box>
      )}

      {error && (
        <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.accent.alert, mb: 1.5, ...settingsMonoSx }}>
          {error}
        </Typography>
      )}

      {results.map((result) => (
        <Box
          key={result.id}
          sx={{
            display: 'flex',
            gap: 1,
            alignItems: 'flex-start',
            mb: 1,
            p: 1,
            borderRadius: '6px',
            border: `1px solid ${result.ok ? settingsTheme.border.default : alphaColor(settingsTheme.accent.alert, '44')}`,
            bgcolor: settingsTheme.bg.elevated,
          }}
        >
          {result.ok
            ? <CheckCircleOutlineIcon sx={{ fontSize: 16, color: settingsTheme.accent.hud, mt: 0.2 }} />
            : <ErrorOutlineIcon sx={{ fontSize: 16, color: settingsTheme.accent.alert, mt: 0.2 }} />}
          <Box>
            <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.text.primary, ...settingsMonoSx }}>
              {result.message}
            </Typography>
            {result.fixHint && !result.ok && (
              <Typography sx={{ fontSize: '0.62rem', color: settingsTheme.text.secondary, mt: 0.5, lineHeight: 1.45 }}>
                {result.fixHint}
              </Typography>
            )}
          </Box>
        </Box>
      ))}

      {oauthClientMissing && (
        <Box sx={{ mb: 1.5, p: 1.5, borderRadius: '6px', border: `1px solid ${settingsTheme.border.default}`, bgcolor: settingsTheme.bg.elevated }}>
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: settingsTheme.text.primary, mb: 0.5 }}>
            Set up your OAuth Client ID
          </Typography>
          <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.text.secondary, mb: 1, lineHeight: 1.5 }}>
            {isGoogleOAuth ? (
              <>
                Create an OAuth client in the{' '}
                <Link href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" sx={{ fontSize: 'inherit' }}>
                  Google Cloud Console
                </Link>
                {' '}(type: Web application), add the redirect URI below to it, then paste the Client ID here.
              </>
            ) : (
              'Create an OAuth client with the provider, register the redirect URI below, then paste the Client ID here.'
            )}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mb: 1 }}>
            <Typography sx={{ fontSize: '0.62rem', color: settingsTheme.text.dim, ...settingsMonoSx, wordBreak: 'break-all' }}>
              Redirect URI: {oauthCallbackUrl}
            </Typography>
            <IconButton
              size="small"
              onClick={() => { void copyToClipboard(oauthCallbackUrl); }}
              sx={{ p: 0.25 }}
              aria-label="Copy redirect URI"
            >
              <ContentCopyIcon sx={{ fontSize: 12, color: settingsTheme.text.dim }} />
            </IconButton>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField
              size="small"
              fullWidth
              label="OAuth Client ID"
              placeholder={isGoogleOAuth ? 'e.g. 1234567890-abc.apps.googleusercontent.com' : 'Paste your client ID'}
              value={clientIdInput}
              onChange={(e) => setClientIdInput(e.target.value)}
              sx={{ ...settingsTextFieldSx }}
            />
            <Button
              size="small"
              variant="outlined"
              disabled={!clientIdInput.trim() || savingClientId}
              onClick={() => { void saveClientId(); }}
              sx={{ fontSize: '0.62rem', whiteSpace: 'nowrap', borderColor: settingsTheme.accent.hud, color: settingsTheme.accent.hud }}
            >
              {savingClientId ? 'Saving…' : 'Save'}
            </Button>
          </Box>
          {clientIdError && (
            <Typography sx={{ fontSize: '0.62rem', color: settingsTheme.accent.alert, mt: 0.75, ...settingsMonoSx }}>
              {clientIdError}
            </Typography>
          )}
          {clientIdEnvKey && (
            <Typography sx={{ fontSize: '0.6rem', color: settingsTheme.text.dim, mt: 0.75, lineHeight: 1.4 }}>
              Saved in Agent-X settings — no environment variable needed. (Advanced: setting {clientIdEnvKey} in the environment also works.)
            </Typography>
          )}
        </Box>
      )}

      <Button size="small" onClick={() => { void run(); }} disabled={loading} sx={{ fontSize: '0.62rem', mt: 0.5, ...settingsMonoSx }}>
        Re-run checks
      </Button>
    </Box>
  );
}
