import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import type { IntegrationConnection, IntegrationProvider } from '../../api';
import { integrations } from '../../api';
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
  const [status, setStatus] = useState<PanelStatus>('checking');
  const [message, setMessage] = useState('');

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

  const runAuth = useCallback(async () => {
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

  useEffect(() => {
    if (!autoStart || status !== 'signed_out') return;
    onAutoStartConsumed?.();
    void runAuth();
  }, [autoStart, onAutoStartConsumed, runAuth, status]);

  return (
    <Box>
      <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.text.secondary, mb: 1.5, lineHeight: 1.5 }}>
        {provider.name} uses Google&apos;s Desktop OAuth flow. Agent-X launches the official MCP auth helper —
        complete sign-in in the browser window that opens. No redirect URI registration is required.
      </Typography>
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
