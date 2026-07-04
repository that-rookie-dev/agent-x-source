/**
 * MCP integration connect wizard — opened from MCP Store → ProviderDetailModal.
 *
 * NOT the first-run app wizard: that is `pages/SetupWizard.tsx` at `/setup/wizard`
 * (storage, provider, model, neural core, callsign). Do not merge or reuse steps here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import { canUseHubBrowserOAuth } from '../integration-ui';
import { PackageSignInPanel } from '../PackageSignInPanel';
import { McpStdioAuthPanel } from '../McpStdioAuthPanel';
import { PreflightPanel } from './PreflightPanel';
import { useOAuthFlowPoll } from '../useOAuthFlowPoll';
import type { ConnectIntegrationRequest, IntegrationConnection, IntegrationProvider } from '../../../api';
import { integrations } from '../../../api';
import { settingsTheme, settingsMonoSx, settingsTextFieldSx } from '../../../styles/settings-theme';

export interface ProviderSetupWizardProps {
  provider: IntegrationProvider;
  onConnect: (request: ConnectIntegrationRequest) => Promise<IntegrationConnection>;
  onOAuthStart?: (remoteUrl?: string) => Promise<{ state: string } | void>;
  onOAuthComplete?: () => void;
  onCancel: () => void;
}

type WizardStep = 'welcome' | 'preflight' | 'credentials' | 'test' | 'signin' | 'done';

function credentialPreflightChecks(providerId: string): string[] {
  if (providerId === 'postgres') return ['postgres_reachable'];
  if (providerId === 'redis') return ['redis_reachable'];
  if (providerId === 'sqlite') return ['folder_readable'];
  return [];
}

function buildConnectRequest(
  provider: IntegrationProvider,
  displayName: string,
  envValues: Record<string, string>,
  remoteUrl: string,
  folderPath: string,
): ConnectIntegrationRequest {
  const template = provider.setupWizard?.template;

  if ((template === 'remote_url' || provider.auth.primary === 'remote_url') && remoteUrl.trim()) {
    return { authMode: 'remote_url', displayName, remote: { url: remoteUrl.trim() } };
  }

  const env: Record<string, string> = {};
  for (const field of provider.auth.fields ?? []) {
    const value = envValues[field.key]?.trim();
    if (value) env[field.key] = value;
  }

  if (template === 'folder_sandbox' && folderPath.trim()) {
    const baseArgs = (provider.server.args ?? []).filter((a) => a !== '${HOME}');
    return {
      authMode: 'none',
      displayName,
      stdio: {
        command: provider.server.command ?? 'npx',
        args: [...baseArgs, folderPath.trim()],
      },
      env: Object.keys(env).length > 0 ? env : undefined,
    };
  }

  return {
    authMode: provider.auth.primary,
    displayName,
    env: Object.keys(env).length > 0 ? env : undefined,
  };
}

export function ProviderSetupWizard({ provider, onConnect, onOAuthStart, onOAuthComplete, onCancel }: ProviderSetupWizardProps) {
  const template = provider.setupWizard?.template ?? 'api_key';
  const skipCredentials = template === 'stdio_none';
  const useOAuth = template === 'oauth_remote' && canUseHubBrowserOAuth(provider) && Boolean(onOAuthStart);
  const isFolderSandbox = template === 'folder_sandbox';
  const isRemoteUrl = template === 'remote_url' || provider.auth.primary === 'remote_url';
  const isPackageSignIn = template === 'package_sign_in';
  const isMcpStdioAuth = template === 'mcp_stdio_auth';
  const isSqlite = provider.id === 'sqlite';
  const hasFields = (provider.auth.fields?.length ?? 0) > 0;
  const desktop = typeof window !== 'undefined' ? window.agentx : undefined;

  const stepOrder = useMemo<WizardStep[]>(() => {
    if (isMcpStdioAuth) return ['welcome', 'preflight', 'credentials', 'signin', 'test', 'done'];
    const steps: WizardStep[] = ['welcome', 'preflight', 'credentials', 'test'];
    if (isPackageSignIn) steps.push('signin');
    steps.push('done');
    return steps;
  }, [isMcpStdioAuth, isPackageSignIn]);

  const [step, setStep] = useState<WizardStep>('welcome');
  const [preflightReady, setPreflightReady] = useState(false);
  const [displayName, setDisplayName] = useState(provider.name);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [remoteUrl, setRemoteUrl] = useState(provider.server.url ?? '');
  const [folderPath, setFolderPath] = useState('');
  const [localNetworkAck, setLocalNetworkAck] = useState(false);
  const [savedConnection, setSavedConnection] = useState<IntegrationConnection | null>(null);
  const [signInComplete, setSignInComplete] = useState(false);
  const [oauthWaiting, setOauthWaiting] = useState(false);
  const [oauthState, setOauthState] = useState<string | null>(null);
  const oauthFinishedRef = useRef(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; toolCount: number; toolNames: string[]; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [oauthRedirectUri, setOauthRedirectUri] = useState('');
  const [redirectUriCopied, setRedirectUriCopied] = useState(false);

  useEffect(() => {
    if (!useOAuth) return;
    integrations.oauthRedirectUri()
      .then((r) => setOauthRedirectUri(r.redirectUri))
      .catch(() => { /* hint is optional */ });
  }, [useOAuth]);

  const stepIndex = (s: WizardStep) => stepOrder.indexOf(s);
  const progress = ((stepIndex(step) + 1) / stepOrder.length) * 100;

  const goNext = () => {
    const idx = stepIndex(step);
    let next = stepOrder[idx + 1];
    if (next === 'credentials' && skipCredentials) next = 'test';
    if (next) setStep(next);
  };

  const goBack = () => {
    const idx = stepIndex(step);
    let prev = stepOrder[idx - 1];
    if (prev === 'credentials' && skipCredentials) prev = 'preflight';
    if (prev) setStep(prev);
  };

  const pickDbFile = async () => {
    if (!desktop?.openFile) return;
    const chosen = await desktop.openFile([{ name: 'SQLite database', extensions: ['db', 'sqlite', 'sqlite3'] }]);
    if (chosen) setEnvValues((prev) => ({ ...prev, SQLITE_DB_PATH: chosen }));
  };

  const validateCredentialsAndContinue = async () => {
    setError('');
    for (const field of provider.auth.fields ?? []) {
      if (field.required !== false && !envValues[field.key]?.trim()) {
        setError(`${field.label} is required`);
        return;
      }
    }
    if (isRemoteUrl && !remoteUrl.trim()) {
      setError('MCP server URL is required');
      return;
    }

    if (isMcpStdioAuth) {
      setBusy(true);
      try {
        const request = buildConnectRequest(provider, displayName, envValues, remoteUrl, folderPath);
        const connection = await onConnect(request);
        setSavedConnection(connection);
        setStep('signin');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
      return;
    }

    const checks = credentialPreflightChecks(provider.id);
    if (checks.length === 0) {
      goNext();
      return;
    }

    setBusy(true);
    try {
      const sqlitePath = envValues.SQLITE_DB_PATH?.trim();
      const { results } = await integrations.preflight(provider.id, checks, {
        env: envValues,
        folderPath: sqlitePath,
      });
      const failed = results.find((r) => !r.ok);
      if (failed) {
        setError(failed.fixHint ?? failed.message);
        return;
      }
      goNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setBusy(true);
    setError('');
    setTestResult(null);
    try {
      if (isMcpStdioAuth && savedConnection) {
        const { connection } = await integrations.sync(savedConnection.id);
        const ok = connection.status === 'connected';
        setTestResult({
          ok,
          toolCount: connection.toolCount ?? 0,
          toolNames: [],
          error: connection.error,
        });
        if (!ok) setError(connection.error ?? 'Connection test failed');
        return;
      }
      const request = buildConnectRequest(provider, displayName, envValues, remoteUrl, folderPath);
      const result = await integrations.connectTest(provider.id, request);
      setTestResult(result);
      if (!result.ok) setError(result.error ?? 'Connection test failed');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const finishConnect = async () => {
    if (isMcpStdioAuth && savedConnection) {
      setStep('done');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const request = buildConnectRequest(provider, displayName, envValues, remoteUrl, folderPath);
      const connection = await onConnect(request);
      setSavedConnection(connection);
      if (isPackageSignIn && provider.auth.packageSignIn && connection.status !== 'error') {
        setStep('signin');
      } else {
        setStep('done');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleOAuth = async () => {
    if (!onOAuthStart) return;
    setBusy(true);
    setError('');
    try {
      const started = await onOAuthStart(remoteUrl.trim() || undefined);
      oauthFinishedRef.current = false;
      if (started?.state) setOauthState(started.state);
      setOauthWaiting(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const finishOAuthSuccess = useCallback(() => {
    if (oauthFinishedRef.current) return;
    oauthFinishedRef.current = true;
    setOauthWaiting(false);
    setStep('done');
    setError('');
    onOAuthComplete?.();
  }, [onOAuthComplete]);

  const finishOAuthFailure = useCallback((message: string) => {
    setOauthWaiting(false);
    setError(message);
  }, []);

  useOAuthFlowPoll({
    enabled: oauthWaiting && Boolean(oauthState),
    state: oauthState,
    onComplete: finishOAuthSuccess,
    onFailed: finishOAuthFailure,
  });

  // Fast path when the OAuth popup shares the same browser context (web UI).
  useEffect(() => {
    if (!useOAuth) return;
    const onResult = (data: { type?: string; success?: boolean; message?: string }) => {
      if (data?.type !== 'agentx-integration-oauth') return;
      if (data.success) {
        finishOAuthSuccess();
      } else if (oauthWaiting) {
        finishOAuthFailure(data.message ?? 'Sign-in did not complete. Click "Sign in again" to retry.');
      }
    };
    const onMessage = (event: MessageEvent) => onResult(event.data);
    window.addEventListener('message', onMessage);
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel('agentx-integrations');
      channel.onmessage = (event) => onResult(event.data);
    } catch { /* BroadcastChannel unavailable */ }
    return () => {
      window.removeEventListener('message', onMessage);
      channel?.close();
    };
  }, [useOAuth, oauthWaiting, finishOAuthSuccess, finishOAuthFailure]);

  return (
    <Box sx={{
      borderRadius: '8px',
      bgcolor: settingsTheme.bg.panel,
      border: `1px solid ${settingsTheme.border.default}`,
      p: 2.5,
    }}>
      <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: settingsTheme.text.primary, mb: 0.5 }}>
        Set up {provider.name}
      </Typography>
      <LinearProgress variant="determinate" value={progress} sx={{ mb: 2, height: 4, borderRadius: 2 }} />

      {step === 'welcome' && (
        <Box>
          <Typography sx={{ fontSize: '0.72rem', color: settingsTheme.text.secondary, lineHeight: 1.55, mb: 2 }}>
            {provider.description}
          </Typography>
          {(provider.highlights ?? []).slice(0, 4).map((item) => (
            <Typography key={item} sx={{ fontSize: '0.68rem', color: settingsTheme.text.dim, mb: 0.75 }}>
              • {item}
            </Typography>
          ))}
        </Box>
      )}

      {step === 'preflight' && (
        <PreflightPanel
          provider={provider}
          folderPath={folderPath}
          onFolderPathChange={setFolderPath}
          localNetworkAck={localNetworkAck}
          onLocalNetworkAck={setLocalNetworkAck}
          remoteUrl={remoteUrl}
          onReadyChange={setPreflightReady}
        />
      )}

      {step === 'credentials' && (
        <Box>
          <TextField
            size="small"
            fullWidth
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            sx={{ ...settingsTextFieldSx, mb: 2 }}
          />
          {useOAuth ? (
            <>
              {provider.auth.connectGuide?.map((guide) => (
                <Box key={guide.title} sx={{ mb: 1.5 }}>
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: settingsTheme.text.primary }}>
                    {guide.title}
                  </Typography>
                  <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.text.secondary, lineHeight: 1.5 }}>
                    {guide.body}
                  </Typography>
                </Box>
              ))}
              {oauthRedirectUri && (
                <Box sx={{ mb: 1.5, p: 1, borderRadius: 1, border: `1px solid ${settingsTheme.accent.hud}33`, bgcolor: `${settingsTheme.accent.hud}0a` }}>
                  <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: settingsTheme.text.primary, mb: 0.5 }}>
                    Authorized redirect URI
                  </Typography>
                  <Typography sx={{ fontSize: '0.64rem', color: settingsTheme.text.secondary, lineHeight: 1.5, mb: 0.75 }}>
                    Register this exact URL in your OAuth provider (e.g. Google Cloud Console →
                    Credentials → your OAuth client → Authorized redirect URIs). A mismatch causes
                    “Error 400: redirect_uri_mismatch”.
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography sx={{ ...settingsMonoSx, fontSize: '0.62rem', color: settingsTheme.accent.hud, wordBreak: 'break-all', flex: 1 }}>
                      {oauthRedirectUri}
                    </Typography>
                    <Button
                      size="small"
                      onClick={() => {
                        void navigator.clipboard.writeText(oauthRedirectUri);
                        setRedirectUriCopied(true);
                        setTimeout(() => setRedirectUriCopied(false), 2000);
                      }}
                      sx={{ fontSize: '0.6rem', textTransform: 'none', minWidth: 0, px: 1, color: settingsTheme.accent.hud }}
                    >
                      {redirectUriCopied ? 'Copied' : 'Copy'}
                    </Button>
                  </Box>
                </Box>
              )}
              <Button
                fullWidth
                variant="outlined"
                disabled={busy}
                onClick={() => { void handleOAuth(); }}
                sx={{ fontSize: '0.65rem', textTransform: 'none', borderColor: settingsTheme.accent.hud, color: settingsTheme.accent.hud }}
              >
                {busy
                  ? <CircularProgress size={14} />
                  : (oauthWaiting || error) ? 'Sign in again' : `Sign in with ${provider.name}`}
              </Button>
              {oauthWaiting && (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1.5 }}>
                  <CircularProgress size={12} />
                  <Typography sx={{ fontSize: '0.65rem', color: settingsTheme.text.secondary, lineHeight: 1.5 }}>
                    Waiting for you to finish sign-in in the browser… This page will
                    update automatically when access is granted.
                  </Typography>
                </Box>
              )}
            </>
          ) : (
            <>
              {provider.auth.connectGuide?.map((guide) => (
                <Box key={guide.title} sx={{ mb: 1.5 }}>
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: settingsTheme.text.primary }}>
                    {guide.title}
                  </Typography>
                  <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.text.secondary, lineHeight: 1.5 }}>
                    {guide.body}
                  </Typography>
                  {guide.link && (
                    <Button
                      size="small"
                      onClick={() => { desktop?.openExternal ? void desktop.openExternal(guide.link!) : window.open(guide.link, '_blank'); }}
                      sx={{ fontSize: '0.62rem', textTransform: 'none', color: settingsTheme.accent.hud, px: 0, mt: 0.25 }}
                    >
                      Open link ↗
                    </Button>
                  )}
                </Box>
              ))}

              {isRemoteUrl && (
                <TextField
                  size="small"
                  fullWidth
                  label="MCP server URL"
                  value={remoteUrl}
                  onChange={(e) => setRemoteUrl(e.target.value)}
                  placeholder="https://your-server.example.com/mcp"
                  sx={{ ...settingsTextFieldSx, mb: 1.5 }}
                />
              )}

              {(provider.auth.fields ?? []).map((field) => (
                <Box key={field.key} sx={{ mb: 1.5 }}>
                  <TextField
                    size="small"
                    fullWidth
                    type={field.secret ? 'password' : 'text'}
                    label={field.label}
                    placeholder={field.placeholder}
                    value={envValues[field.key] ?? ''}
                    onChange={(e) => setEnvValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    sx={{ ...settingsTextFieldSx }}
                  />
                  {isSqlite && field.key === 'SQLITE_DB_PATH' && desktop?.openFile && (
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => { void pickDbFile(); }}
                      sx={{ fontSize: '0.62rem', mt: 1, borderColor: settingsTheme.accent.hud, color: settingsTheme.accent.hud }}
                    >
                      Browse for database file…
                    </Button>
                  )}
                </Box>
              ))}
              {!hasFields && template === 'stdio_none' && (
                <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.text.secondary }}>
                  No credentials required. Agent-X will start the local MCP server on your machine.
                </Typography>
              )}
              {isPackageSignIn && (
                <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.text.secondary, mt: 1, lineHeight: 1.5 }}>
                  After saving the connection, you&apos;ll sign in to {provider.name} in the next step.
                </Typography>
              )}
              {isMcpStdioAuth && (
                <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.text.secondary, mt: 1, lineHeight: 1.5 }}>
                  Use a Google Cloud Desktop OAuth client (not Web). After saving credentials, Google sign-in runs in the next step.
                </Typography>
              )}
            </>
          )}
        </Box>
      )}

      {step === 'test' && (
        <Box>
          <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.text.secondary, mb: 1.5, lineHeight: 1.5 }}>
            Verify the MCP server responds before saving this connection.
          </Typography>
          <Button
            size="small"
            variant="outlined"
            disabled={busy}
            onClick={() => { void runTest(); }}
            sx={{ fontSize: '0.62rem', mb: 1.5, ...settingsMonoSx }}
          >
            {busy ? <CircularProgress size={14} /> : 'Test connection'}
          </Button>
          {testResult && (
            <Box sx={{ p: 1.5, borderRadius: '6px', border: `1px solid ${settingsTheme.border.default}`, bgcolor: settingsTheme.bg.elevated }}>
              <Typography sx={{ fontSize: '0.68rem', color: testResult.ok ? settingsTheme.accent.hud : settingsTheme.accent.alert, ...settingsMonoSx }}>
                {testResult.ok
                  ? `Connected — ${testResult.toolCount} tool(s) available`
                  : (testResult.error ?? 'Connection test failed')}
              </Typography>
              {testResult.toolNames.length > 0 && (
                <Typography sx={{ fontSize: '0.62rem', color: settingsTheme.text.dim, mt: 0.75, ...settingsMonoSx }}>
                  {testResult.toolNames.join(', ')}
                </Typography>
              )}
            </Box>
          )}
        </Box>
      )}

      {step === 'signin' && savedConnection && (
        <Box>
          <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.text.secondary, mb: 1.5, lineHeight: 1.5 }}>
            Complete browser sign-in to finish setup.
          </Typography>
          {isMcpStdioAuth ? (
            <McpStdioAuthPanel
              provider={provider}
              connection={savedConnection}
              busy={busy}
              autoStart
              onSignedIn={() => setSignInComplete(true)}
            />
          ) : (
            <PackageSignInPanel
              provider={provider}
              connection={savedConnection}
              busy={busy}
              autoStartSignIn
              onSignedIn={() => setSignInComplete(true)}
            />
          )}
        </Box>
      )}

      {step === 'done' && (
        <Typography sx={{ fontSize: '0.72rem', color: settingsTheme.accent.hud }}>
          {provider.name} is connected{signInComplete ? ' and signed in' : ''}. You can close this dialog and start using it in chat.
        </Typography>
      )}

      {error && (
        <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.accent.alert, mt: 1.5, ...settingsMonoSx }}>
          {error}
        </Typography>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mt: 2 }}>
        <Button size="small" onClick={onCancel} disabled={busy} sx={{ fontSize: '0.62rem', ...settingsMonoSx }}>
          Cancel
        </Button>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {step !== 'welcome' && step !== 'done' && (
            <Button size="small" onClick={goBack} disabled={busy} sx={{ fontSize: '0.62rem', ...settingsMonoSx }}>
              Back
            </Button>
          )}
          {step === 'welcome' && (
            <Button size="small" variant="contained" onClick={goNext} sx={{ fontSize: '0.62rem', bgcolor: settingsTheme.accent.hud, ...settingsMonoSx }}>
              Continue
            </Button>
          )}
          {step === 'preflight' && (
            <Button
              size="small"
              variant="contained"
              disabled={!preflightReady}
              onClick={goNext}
              sx={{ fontSize: '0.62rem', bgcolor: settingsTheme.accent.hud, ...settingsMonoSx }}
            >
              Continue
            </Button>
          )}
          {step === 'credentials' && !useOAuth && (
            <Button
              size="small"
              variant="contained"
              disabled={busy || (isFolderSandbox && !folderPath.trim())}
              onClick={() => { void validateCredentialsAndContinue(); }}
              sx={{ fontSize: '0.62rem', bgcolor: settingsTheme.accent.hud, ...settingsMonoSx }}
            >
              {busy ? <CircularProgress size={14} color="inherit" /> : 'Continue'}
            </Button>
          )}
          {step === 'test' && (
            <Button
              size="small"
              variant="contained"
              disabled={busy || !testResult?.ok}
              onClick={() => { void finishConnect(); }}
              sx={{ fontSize: '0.62rem', bgcolor: settingsTheme.accent.hud, ...settingsMonoSx }}
            >
              {busy ? <CircularProgress size={14} color="inherit" /> : (isMcpStdioAuth ? 'Finish' : 'Save connection')}
            </Button>
          )}
          {step === 'signin' && (
            <Button
              size="small"
              variant="contained"
              disabled={!signInComplete}
              onClick={() => setStep(isMcpStdioAuth ? 'test' : 'done')}
              sx={{ fontSize: '0.62rem', bgcolor: settingsTheme.accent.hud, ...settingsMonoSx }}
            >
              Continue
            </Button>
          )}
          {step === 'done' && (
            <Button size="small" variant="contained" onClick={onCancel} sx={{ fontSize: '0.62rem', bgcolor: settingsTheme.accent.hud, ...settingsMonoSx }}>
              Done
            </Button>
          )}
        </Box>
      </Box>
    </Box>
  );
}
