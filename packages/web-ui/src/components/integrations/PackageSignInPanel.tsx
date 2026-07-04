import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import type { IntegrationConnection, IntegrationProvider } from '../../api';
import { integrations } from '../../api';
import { settingsTheme, settingsMonoSx } from '../../styles/settings-theme';
import { providerPackageSignIn } from './integration-ui';

export interface PackageSignInPanelProps {
  provider: IntegrationProvider;
  connection: IntegrationConnection;
  busy?: boolean;
  autoStartSignIn?: boolean;
  onAutoStartConsumed?: () => void;
  onSignedIn?: () => void;
}

function outputLooksSignedIn(output: string): boolean {
  const lower = output.toLowerCase();
  return (
    lower.includes('logged in')
    || lower.includes('authenticated')
    || lower.includes('signed in')
    || lower.includes('"success"')
    || lower.includes('success')
  ) && !lower.includes('not connected') && !lower.includes('not logged');
}

function outputLooksFailed(output: string): boolean {
  const lower = output.toLowerCase();
  return lower.includes('failed') || (lower.includes('error') && !lower.includes('no error'));
}

function isNotConnectedResult(result: { success: boolean; error?: string; output?: string }): boolean {
  return result.error === 'NOT_CONNECTED' || (result.output ?? '').toLowerCase().includes('not connected');
}

export function PackageSignInPanel({
  provider,
  connection,
  busy,
  autoStartSignIn,
  onAutoStartConsumed,
  onSignedIn,
}: PackageSignInPanelProps) {
  const signIn = providerPackageSignIn(provider);
  const [status, setStatus] = useState<'idle' | 'starting' | 'polling' | 'signed_in' | 'failed'>('idle');
  const [message, setMessage] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const signInRunRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const ensureMcpSession = useCallback(async (): Promise<boolean> => {
    if (connection.status === 'connected') return true;
    setMessage('Starting MCP server…');
    try {
      const { connection: synced } = await integrations.sync(connection.id);
      if (synced.status !== 'connected') {
        setStatus('failed');
        setMessage(synced.error ?? `MCP server is not running (status: ${synced.status}). Click Sync below, then try sign-in again.`);
        return false;
      }
      return true;
    } catch (e) {
      setStatus('failed');
      setMessage(e instanceof Error ? e.message : 'Failed to start MCP server. Try Sync, then sign in again.');
      return false;
    }
  }, [connection.id, connection.status]);

  const checkStatus = useCallback(async (): Promise<boolean> => {
    const statusTool = signIn?.statusTool;
    if (!statusTool) return false;
    const { result } = await integrations.runTool(connection.id, statusTool);
    const output = result.output ?? '';
    if (isNotConnectedResult(result)) {
      return false;
    }
    setMessage(output.slice(0, 500));
    if (outputLooksSignedIn(output)) {
      setStatus('signed_in');
      onSignedIn?.();
      return true;
    }
    return false;
  }, [connection.id, signIn?.statusTool]);

  const pollProgress = useCallback(async () => {
    const progressTool = signIn?.progressTool;
    if (progressTool) {
      const { result } = await integrations.runTool(connection.id, progressTool);
      const output = result.output ?? '';
      if (isNotConnectedResult(result)) {
        setStatus('failed');
        setMessage('MCP server disconnected during sign-in. Click Sign in again to restart.');
        stopPolling();
        return;
      }
      setMessage(output.slice(0, 500));
      if (outputLooksSignedIn(output)) {
        setStatus('signed_in');
        onSignedIn?.();
        stopPolling();
        return;
      }
      if (outputLooksFailed(output) && output.toLowerCase().includes('failed')) {
        setStatus('failed');
        stopPolling();
        return;
      }
    }
    const signedIn = await checkStatus();
    if (signedIn) stopPolling();
  }, [checkStatus, connection.id, signIn?.progressTool, stopPolling]);

  const handleSignIn = useCallback(async () => {
    if (!signIn?.loginTool) return;
    const runId = ++signInRunRef.current;
    stopPolling();
    setStatus('starting');
    setMessage('');

    const sessionReady = await ensureMcpSession();
    if (!sessionReady || runId !== signInRunRef.current) return;

    try {
      const { result } = await integrations.runTool(connection.id, signIn.loginTool, { timeoutSeconds: 600 });
      if (runId !== signInRunRef.current) return;

      if (isNotConnectedResult(result)) {
        setStatus('failed');
        setMessage(result.output ?? 'MCP server is not connected. Use Sync on this provider, then try sign-in again.');
        return;
      }

      setMessage(result.output?.slice(0, 500) ?? '');
      if (result.success && outputLooksSignedIn(result.output ?? '')) {
        setStatus('signed_in');
        onSignedIn?.();
        return;
      }

      if (!result.success) {
        setStatus('failed');
        setMessage(result.output ?? 'Sign-in could not start. Check macOS Automation permissions for your browser, then try again.');
        return;
      }

      setStatus('polling');
      setMessage('Complete sign-in in the browser window that opened…');
      await pollProgress();
      if (runId !== signInRunRef.current) return;
      pollRef.current = setInterval(() => { void pollProgress(); }, 3000);
    } catch (e) {
      if (runId !== signInRunRef.current) return;
      setStatus('failed');
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }, [connection.id, ensureMcpSession, pollProgress, signIn?.loginTool, stopPolling]);

  useEffect(() => {
    void checkStatus().then((signedIn) => {
      if (signedIn) {
        setStatus('signed_in');
        onSignedIn?.();
      }
    }).catch(() => {});
  }, [checkStatus, onSignedIn]);

  useEffect(() => {
    if (!autoStartSignIn || status === 'signed_in' || status === 'starting' || status === 'polling') return;
    onAutoStartConsumed?.();
    void handleSignIn();
  }, [autoStartSignIn, handleSignIn, onAutoStartConsumed, status]);

  if (!signIn) return null;

  const label = signIn.label ?? provider.name;
  const signingIn = status === 'starting' || status === 'polling';

  return (
    <Box sx={{
      mb: 2.5,
      p: 2,
      borderRadius: '8px',
      border: `1px solid ${settingsTheme.border.default}`,
      bgcolor: settingsTheme.bg.panel,
    }}>
      <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: settingsTheme.text.primary, mb: 0.5 }}>
        {label} account
      </Typography>
      <Typography sx={{ fontSize: '0.72rem', color: settingsTheme.text.secondary, lineHeight: 1.55, mb: 1.5 }}>
        {status === 'signed_in'
          ? 'Signed in. Hotel search and reservations are available to the agent.'
          : 'Sign in once in your browser. Sessions are saved locally by the MCP server.'}
      </Typography>

      {message && (
        <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.text.dim, mb: 1.5, ...settingsMonoSx, whiteSpace: 'pre-wrap' }}>
          {message}
        </Typography>
      )}

      {status !== 'signed_in' && (
        <Button
          size="small"
          variant="contained"
          disabled={busy || signingIn}
          onClick={() => { void handleSignIn(); }}
          sx={{ fontSize: '0.65rem', textTransform: 'none', bgcolor: settingsTheme.accent.hud, ...settingsMonoSx }}
        >
          {signingIn ? <CircularProgress size={14} color="inherit" /> : `Sign in to ${label}`}
        </Button>
      )}

      {status === 'signed_in' && (
        <Button
          size="small"
          variant="outlined"
          disabled={busy || signingIn}
          onClick={() => { void handleSignIn(); }}
          sx={{ fontSize: '0.65rem', textTransform: 'none', borderColor: settingsTheme.border.strong, color: settingsTheme.text.secondary }}
        >
          Re-sign in
        </Button>
      )}
    </Box>
  );
}
