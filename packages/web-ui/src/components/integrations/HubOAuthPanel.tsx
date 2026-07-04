import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import type { IntegrationConnection, IntegrationProvider } from '../../api';
import { integrations } from '../../api';
import { useOAuthFlowPoll } from './useOAuthFlowPoll';
import { settingsTheme, settingsMonoSx } from '../../styles/settings-theme';

export interface HubOAuthPanelProps {
  provider: IntegrationProvider;
  connection?: IntegrationConnection;
  busy?: boolean;
  autoStart?: boolean;
  onAutoStartConsumed?: () => void;
  onSignedIn?: () => void;
}

type PanelStatus = 'idle' | 'running' | 'failed';

export function HubOAuthPanel({
  provider,
  connection,
  busy,
  autoStart,
  onAutoStartConsumed,
  onSignedIn,
}: HubOAuthPanelProps) {
  const [status, setStatus] = useState<PanelStatus>('idle');
  const [message, setMessage] = useState('');
  const [oauthState, setOauthState] = useState<string | null>(null);
  const [redirectUri, setRedirectUri] = useState('');
  const oauthFinishedRef = useRef(false);

  useEffect(() => {
    void integrations.oauthRedirectUri()
      .then((r) => setRedirectUri(r.redirectUri))
      .catch(() => { /* optional hint */ });
  }, []);

  const finishSuccess = useCallback(() => {
    if (oauthFinishedRef.current) return;
    oauthFinishedRef.current = true;
    setStatus('idle');
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
    enabled: status === 'running' && Boolean(oauthState),
    state: oauthState,
    onComplete: finishSuccess,
    onFailed: finishFailure,
  });

  const runOAuth = useCallback(async () => {
    setStatus('running');
    setMessage('Opening sign-in in your browser…');
    oauthFinishedRef.current = false;
    try {
      const remoteUrl = connection?.remote?.url ?? provider.server.url;
      const { authUrl, state } = await integrations.startOAuth(provider.id, remoteUrl);
      setOauthState(state);
      const desktop = typeof window !== 'undefined' ? window.agentx : undefined;
      if (desktop?.openExternal) {
        await desktop.openExternal(authUrl);
      } else {
        window.open(authUrl, '_blank');
      }
    } catch (e) {
      setStatus('failed');
      setMessage(e instanceof Error ? e.message : 'Sign-in failed');
    }
  }, [connection?.remote?.url, provider.id, provider.server.url]);

  useEffect(() => {
    if (!autoStart || status !== 'idle') return;
    onAutoStartConsumed?.();
    void runOAuth();
  }, [autoStart, onAutoStartConsumed, runOAuth, status]);

  return (
    <Box>
      <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.text.secondary, mb: 1.5, lineHeight: 1.5 }}>
        Authorize Agent-X with {provider.name} in your browser. Access tokens are stored encrypted on this device.
      </Typography>
      <Button
        fullWidth
        variant="outlined"
        disabled={busy || status === 'running'}
        onClick={() => { void runOAuth(); }}
        sx={{ fontSize: '0.65rem', textTransform: 'none', borderColor: settingsTheme.accent.hud, color: settingsTheme.accent.hud }}
      >
        {status === 'running'
          ? <CircularProgress size={14} />
          : status === 'failed' ? 'Sign in again' : `Sign in with ${provider.name}`}
      </Button>
      {status === 'running' && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1.5 }}>
          <CircularProgress size={12} />
          <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.text.secondary, lineHeight: 1.5 }}>
            {message || 'Waiting for browser sign-in…'}
          </Typography>
        </Box>
      )}
      {status === 'failed' && message && (
        <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.accent.alert, mt: 1.5, ...settingsMonoSx, whiteSpace: 'pre-wrap' }}>
          {message}
        </Typography>
      )}
      {redirectUri && status === 'failed' && /redirect_uri/i.test(message) && (
        <Typography sx={{ fontSize: '0.62rem', color: settingsTheme.text.dim, mt: 1, ...settingsMonoSx, wordBreak: 'break-all' }}>
          Callback URL: {redirectUri}
        </Typography>
      )}
    </Box>
  );
}
