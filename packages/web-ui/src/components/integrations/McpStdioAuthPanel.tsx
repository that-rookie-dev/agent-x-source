import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import type { IntegrationConnection, IntegrationProvider } from '../../api';
import { integrations } from '../../api';
import { useOAuthFlowPoll } from './useOAuthFlowPoll';
import { usesNativeMcpStdioBrowserOAuth } from './integration-ui';
import { settingsTheme, settingsMonoSx } from '../../styles/settings-theme';

export interface McpStdioAuthPanelProps {
  provider: IntegrationProvider;
  connection: IntegrationConnection;
  busy?: boolean;
  autoStart?: boolean;
  onAutoStartConsumed?: () => void;
  onSignedIn?: () => void;
}

type PanelStatus = 'checking' | 'signed_out' | 'running' | 'signed_in' | 'failed';

export function McpStdioAuthPanel({
  provider,
  connection,
  busy,
  autoStart,
  onAutoStartConsumed,
  onSignedIn,
}: McpStdioAuthPanelProps) {
  const nativeBrowser = usesNativeMcpStdioBrowserOAuth(provider);
  const [status, setStatus] = useState<PanelStatus>('checking');
  const [message, setMessage] = useState('');
  const [oauthState, setOauthState] = useState<string | null>(null);
  const [redirectUri, setRedirectUri] = useState('');
  const oauthFinishedRef = useRef(false);

  useEffect(() => {
    if (!nativeBrowser) return;
    void integrations.mcpAuthRedirectUri(provider.id)
      .then((r) => setRedirectUri(r.redirectUri))
      .catch(() => { /* optional hint */ });
  }, [nativeBrowser, provider.id]);

  const refreshStatus = useCallback(async () => {
    try {
      const result = await integrations.mcpAuthStatus(connection.id);
      if (result.signedIn) {
        setStatus('signed_in');
        setMessage('');
        onSignedIn?.();
        return true;
      }
      setStatus('signed_out');
      setMessage(result.message ?? '');
      return false;
    } catch (e) {
      setStatus('failed');
      setMessage(e instanceof Error ? e.message : 'Failed to check sign-in status');
      return false;
    }
  }, [connection.id, onSignedIn]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const finishSuccess = useCallback(() => {
    if (oauthFinishedRef.current) return;
    oauthFinishedRef.current = true;
    setStatus('signed_in');
    setMessage('');
    setOauthState(null);
    onSignedIn?.();
  }, [onSignedIn]);

  const finishFailure = useCallback((errorMessage: string) => {
    setStatus('failed');
    setMessage(errorMessage);
    setOauthState(null);
  }, []);

  useOAuthFlowPoll({
    enabled: nativeBrowser && status === 'running' && Boolean(oauthState),
    state: oauthState,
    poll: integrations.mcpAuthResult,
    onComplete: finishSuccess,
    onFailed: finishFailure,
  });

  const runNativeBrowserAuth = useCallback(async () => {
    setStatus('running');
    setMessage('Opening Google sign-in in your browser…');
    oauthFinishedRef.current = false;
    try {
      const { authUrl, state } = await integrations.startMcpAuth(connection.id);
      setOauthState(state);
      const desktop = typeof window !== 'undefined' ? window.agentx : undefined;
      if (desktop?.openExternal) {
        await desktop.openExternal(authUrl);
      } else {
        window.open(authUrl, '_blank');
      }
    } catch (e) {
      setStatus('failed');
      setMessage(e instanceof Error ? e.message : 'Google sign-in failed');
    }
  }, [connection.id]);

  const runCliAuth = useCallback(async () => {
    setStatus('running');
    setMessage('Opening Google sign-in in your browser…');
    try {
      const result = await integrations.runMcpAuth(connection.id);
      if (result.success) {
        setStatus('signed_in');
        setMessage(result.output);
        onSignedIn?.();
        return;
      }
      setStatus('failed');
      setMessage(result.output || 'Google sign-in did not complete.');
    } catch (e) {
      setStatus('failed');
      setMessage(e instanceof Error ? e.message : 'Google sign-in failed');
    }
  }, [connection.id, onSignedIn]);

  const runAuth = nativeBrowser ? runNativeBrowserAuth : runCliAuth;

  useEffect(() => {
    if (!autoStart || status !== 'signed_out') return;
    onAutoStartConsumed?.();
    void runAuth();
  }, [autoStart, onAutoStartConsumed, runAuth, status]);

  return (
    <Box>
      <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.text.secondary, mb: 1.5, lineHeight: 1.5 }}>
        {nativeBrowser
          ? `${provider.name} uses Google Web OAuth through Agent-X. Complete sign-in in the browser window that opens. Register the callback URL below in Google Cloud Console if you have not already.`
          : `${provider.name} uses Google's Desktop OAuth flow. Agent-X launches the official MCP auth helper — complete sign-in in the browser window that opens.`}
      </Typography>
      {nativeBrowser && redirectUri && (
        <Typography sx={{ fontSize: '0.62rem', color: settingsTheme.text.dim, mb: 1.5, ...settingsMonoSx, wordBreak: 'break-all' }}>
          Callback URL: {redirectUri}
        </Typography>
      )}
      <Button
        fullWidth
        variant="outlined"
        disabled={busy || status === 'running'}
        onClick={() => { void runAuth(); }}
        sx={{ fontSize: '0.65rem', textTransform: 'none', borderColor: settingsTheme.accent.hud, color: settingsTheme.accent.hud }}
      >
        {status === 'running'
          ? <CircularProgress size={14} />
          : status === 'failed' ? 'Sign in again' : `Sign in with Google (${provider.name})`}
      </Button>
      {status === 'running' && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1.5 }}>
          <CircularProgress size={12} />
          <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.text.secondary, lineHeight: 1.5 }}>
            {message || 'Waiting for browser sign-in…'}
          </Typography>
        </Box>
      )}
      {status === 'signed_in' && (
        <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.accent.hud, mt: 1.5, ...settingsMonoSx }}>
          Signed in successfully.
        </Typography>
      )}
      {status === 'failed' && message && (
        <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.accent.alert, mt: 1.5, ...settingsMonoSx, whiteSpace: 'pre-wrap' }}>
          {message}
        </Typography>
      )}
    </Box>
  );
}
