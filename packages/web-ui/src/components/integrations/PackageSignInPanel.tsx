import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import type { IntegrationConnection, IntegrationProvider } from '../../api';
import { integrations } from '../../api';
import { settingsTheme, settingsMonoSx } from '../../styles/settings-theme';
import { providerPackageSignIn } from './integration-ui';
import { alphaColor } from '../../theme';
import {
  checkPackageSignInStatus,
  isNotConnectedResult,
  outputLooksFailed,
  outputLooksSignedIn,
} from './package-sign-in-status';

export interface PackageSignInPanelProps {
  provider: IntegrationProvider;
  connection: IntegrationConnection;
  busy?: boolean;
  autoStartSignIn?: boolean;
  onAutoStartConsumed?: () => void;
  onSignedIn?: () => void;
}

type PanelStatus = 'checking' | 'signed_out' | 'starting' | 'polling' | 'signed_in' | 'failed';

export function PackageSignInPanel({
  provider,
  connection,
  busy,
  autoStartSignIn,
  onAutoStartConsumed,
  onSignedIn,
}: PackageSignInPanelProps) {
  const signIn = providerPackageSignIn(provider);
  const [status, setStatus] = useState<PanelStatus>(signIn?.statusTool ? 'checking' : 'signed_out');
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

  const markSignedIn = useCallback(() => {
    setStatus('signed_in');
    setMessage('');
    onSignedIn?.();
  }, [onSignedIn]);

  useEffect(() => {
    if (!signIn?.statusTool) return;
    let cancelled = false;
    setStatus('checking');
    void checkPackageSignInStatus(connection.id, signIn.statusTool)
      .then((signedIn) => {
        if (cancelled) return;
        if (signedIn) markSignedIn();
        else setStatus('signed_out');
      })
      .catch(() => {
        if (!cancelled) setStatus('signed_out');
      });
    return () => { cancelled = true; };
  }, [connection.id, markSignedIn, signIn?.statusTool]);

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
      if (outputLooksSignedIn(output)) {
        markSignedIn();
        stopPolling();
        return;
      }
      if (outputLooksFailed(output) && output.toLowerCase().includes('failed')) {
        setStatus('failed');
        setMessage('Sign-in failed. Try again.');
        stopPolling();
        return;
      }
      setMessage('Complete sign-in in the browser window that opened…');
    }

    if (signIn?.statusTool) {
      const signedIn = await checkPackageSignInStatus(connection.id, signIn.statusTool);
      if (signedIn) {
        markSignedIn();
        stopPolling();
      }
    }
  }, [connection.id, markSignedIn, signIn?.progressTool, signIn?.statusTool, stopPolling]);

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

      if (result.success && outputLooksSignedIn(result.output ?? '')) {
        markSignedIn();
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
  }, [connection.id, ensureMcpSession, markSignedIn, pollProgress, signIn?.loginTool, stopPolling]);

  useEffect(() => {
    if (!autoStartSignIn || status === 'signed_in' || status === 'starting' || status === 'polling' || status === 'checking') return;
    onAutoStartConsumed?.();
    void handleSignIn();
  }, [autoStartSignIn, handleSignIn, onAutoStartConsumed, status]);

  if (!signIn) return null;

  const label = signIn.label ?? provider.name;
  const signingIn = status === 'starting' || status === 'polling';
  const checking = status === 'checking';

  return (
    <Box sx={{
      mb: 2.5,
      p: 2,
      borderRadius: '8px',
      border: `1px solid ${settingsTheme.border.default}`,
      bgcolor: settingsTheme.bg.panel,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
        <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: settingsTheme.text.primary }}>
          {label} account
        </Typography>
        {checking && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <CircularProgress size={12} />
            <Typography sx={{ fontSize: '0.62rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
              Checking…
            </Typography>
          </Box>
        )}
        {status === 'signed_in' && (
          <Chip
            label="Signed in"
            size="small"
            sx={{
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
      </Box>

      <Typography sx={{ fontSize: '0.72rem', color: settingsTheme.text.secondary, lineHeight: 1.55, mb: 1.5 }}>
        {status === 'signed_in'
          ? 'Hotel search and reservations are available to the agent.'
          : 'Sign in once in your browser. Sessions are saved locally by the MCP server.'}
      </Typography>

      {message && status !== 'signed_in' && status !== 'checking' && (
        <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.text.dim, mb: 1.5, ...settingsMonoSx, whiteSpace: 'pre-wrap' }}>
          {message}
        </Typography>
      )}

      {!checking && status !== 'signed_in' && (
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

      {status === 'signed_in' && !checking && (
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
