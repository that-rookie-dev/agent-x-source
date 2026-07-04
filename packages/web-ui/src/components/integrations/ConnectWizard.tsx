import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import CircularProgress from '@mui/material/CircularProgress';
import { canUseHubBrowserOAuth, requiresRemoteUrlForHubOAuth } from './integration-ui';
import type { ConnectIntegrationRequest, IntegrationConnection, IntegrationProvider } from '../../api';
import { settingsTheme, settingsMonoSx, settingsTextFieldSx } from '../../styles/settings-theme';

export interface ConnectWizardProps {
  provider: IntegrationProvider;
  onConnect: (request: ConnectIntegrationRequest) => Promise<IntegrationConnection | void>;
  onOAuthStart?: (remoteUrl?: string) => Promise<{ state: string } | void>;
  onCancel: () => void;
}

export function ConnectWizard({ provider, onConnect, onOAuthStart, onCancel }: ConnectWizardProps) {
  const hubOAuth = canUseHubBrowserOAuth(provider) && Boolean(onOAuthStart);
  const needsRemoteUrl = requiresRemoteUrlForHubOAuth(provider);
  const fields = provider.auth.fields ?? [];
  const simpleStdioConnect = !hubOAuth && provider.auth.primary === 'none' && fields.length === 0;
  const [tab, setTab] = useState(hubOAuth ? 0 : simpleStdioConnect ? 0 : 1);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [displayName, setDisplayName] = useState(provider.name);
  const [stdioCommand, setStdioCommand] = useState(provider.server.command ?? 'npx');
  const [stdioArgs, setStdioArgs] = useState((provider.server.args ?? []).join(' '));
  const [remoteUrl, setRemoteUrl] = useState(provider.server.url ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handlePrimaryConnect = async () => {
    setBusy(true);
    setError('');
    try {
      if (provider.auth.primary === 'remote_url') {
        if (!remoteUrl.trim()) throw new Error('Remote MCP URL is required');
        await onConnect({
          authMode: 'remote_url',
          displayName,
          remote: { url: remoteUrl.trim() },
        });
        return;
      }

      const env: Record<string, string> = {};
      for (const field of fields) {
        const value = envValues[field.key]?.trim();
        if (field.required !== false && !value) {
          throw new Error(`${field.label} is required`);
        }
        if (value) env[field.key] = value;
      }
      await onConnect({
        authMode: provider.auth.primary,
        displayName,
        env: Object.keys(env).length > 0 ? env : undefined,
      });
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
      await onOAuthStart(remoteUrl.trim() || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDeveloperConnect = async () => {
    setBusy(true);
    setError('');
    try {
      if (remoteUrl.trim()) {
        await onConnect({
          authMode: 'remote_url',
          displayName,
          remote: { url: remoteUrl.trim() },
          env: Object.fromEntries(Object.entries(envValues).filter(([, v]) => v.trim())),
        });
        return;
      }
      await onConnect({
        authMode: 'stdio',
        displayName,
        stdio: {
          command: stdioCommand.trim(),
          args: stdioArgs.trim() ? stdioArgs.trim().split(/\s+/) : [],
        },
        env: Object.fromEntries(Object.entries(envValues).filter(([, v]) => v.trim())),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{
      borderRadius: '8px',
      bgcolor: settingsTheme.bg.panel,
      border: `1px solid ${settingsTheme.border.default}`,
      p: 2.5,
      maxWidth: '100%',
    }}>
      <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: settingsTheme.text.primary, mb: 0.5 }}>
        Connect {provider.name}
      </Typography>
      <Typography sx={{ fontSize: '0.7rem', color: settingsTheme.text.dim, mb: 2 }}>
        Read and search tools run automatically. Writes and transactions require your confirmation in chat.
      </Typography>

      {hubOAuth && (
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, minHeight: 32 }}>
          <Tab label="Sign in" sx={{ fontSize: '0.65rem', minHeight: 32, ...settingsMonoSx }} />
          <Tab label="Developer" sx={{ fontSize: '0.65rem', minHeight: 32, ...settingsMonoSx }} />
        </Tabs>
      )}

      {simpleStdioConnect && (
        <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.text.secondary, mb: 2, lineHeight: 1.55 }}>
          No API keys required. Agent-X will start the local MCP server on your machine.
          {provider.auth.packageSignIn
            ? ' After connecting, use Sign in on the provider page to open browser login.'
            : ''}
        </Typography>
      )}

      {!hubOAuth && !simpleStdioConnect && (
        <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.text.dim, mb: 2 }}>
          Developer connection — adjust stdio settings if needed.
        </Typography>
      )}

      <TextField
        size="small"
        fullWidth
        label="Display name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        sx={{ ...settingsTextFieldSx, mb: 2 }}
      />

      {hubOAuth && tab === 0 && (
        <Box>
          {provider.auth.connectGuide?.map((step) => (
            <Box key={step.title} sx={{ mb: 1.5 }}>
              <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: settingsTheme.text.primary }}>
                {step.title}
              </Typography>
              <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.text.secondary, lineHeight: 1.5 }}>
                {step.body}
              </Typography>
            </Box>
          ))}

          {(needsRemoteUrl || provider.auth.primary === 'remote_url') && (
            <TextField
              size="small"
              fullWidth
              label="Remote MCP URL"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              sx={{ ...settingsTextFieldSx, mb: 1.5 }}
            />
          )}

          {fields.map((field) => (
            <TextField
              key={field.key}
              size="small"
              fullWidth
              type={field.secret ? 'password' : 'text'}
              label={field.label}
              placeholder={field.placeholder}
              value={envValues[field.key] ?? ''}
              onChange={(e) => setEnvValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
              sx={{ ...settingsTextFieldSx, mb: 1.5 }}
            />
          ))}

          {fields.length === 0 && provider.auth.primary === 'none' && (
            <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.text.secondary, mb: 2 }}>
              No credentials required. Agent-X will start the bundled MCP server locally.
            </Typography>
          )}

          {hubOAuth && (
            <Button
              fullWidth
              variant="outlined"
              disabled={busy}
              onClick={handleOAuth}
              sx={{ mb: 1.5, fontSize: '0.65rem', textTransform: 'none', borderColor: settingsTheme.accent.hud, color: settingsTheme.accent.hud }}
            >
              {busy ? <CircularProgress size={14} /> : `Sign in with ${provider.name}`}
            </Button>
          )}

          {!hubOAuth && provider.auth.primary === 'oauth' && (
            <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.text.secondary, mb: 2, lineHeight: 1.55 }}>
              Browser sign-in is not available for this package. Use the Developer tab or run the package&apos;s auth command locally.
            </Typography>
          )}
        </Box>
      )}

      {(!hubOAuth || tab === 1) && !simpleStdioConnect && (
        <Box>
          <TextField
            size="small"
            fullWidth
            label="stdio command"
            value={stdioCommand}
            onChange={(e) => setStdioCommand(e.target.value)}
            sx={{ ...settingsTextFieldSx, mb: 1.5 }}
          />
          <TextField
            size="small"
            fullWidth
            label="Arguments (space-separated)"
            value={stdioArgs}
            onChange={(e) => setStdioArgs(e.target.value)}
            sx={{ ...settingsTextFieldSx, mb: 1.5 }}
          />
          <TextField
            size="small"
            fullWidth
            label="Remote MCP URL (optional — overrides stdio)"
            value={remoteUrl}
            onChange={(e) => setRemoteUrl(e.target.value)}
            sx={{ ...settingsTextFieldSx, mb: 1.5 }}
          />
          <TextField
            size="small"
            fullWidth
            label="Extra env (KEY=value, one per line)"
            multiline
            minRows={2}
            value={Object.entries(envValues).map(([k, v]) => `${k}=${v}`).join('\n')}
            onChange={(e) => {
              const next: Record<string, string> = {};
              for (const line of e.target.value.split('\n')) {
                const idx = line.indexOf('=');
                if (idx > 0) next[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
              }
              setEnvValues(next);
            }}
            sx={{ ...settingsTextFieldSx, mb: 1.5 }}
          />
        </Box>
      )}

      {error && (
        <Typography sx={{ fontSize: '0.68rem', color: settingsTheme.accent.alert, mb: 1.5, ...settingsMonoSx }}>
          {error}
        </Typography>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
        <Button size="small" onClick={onCancel} disabled={busy} sx={{ fontSize: '0.62rem', ...settingsMonoSx }}>
          Cancel
        </Button>
        {hubOAuth && tab === 0 && fields.length > 0 && provider.auth.primary !== 'oauth' && provider.auth.primary !== 'sign_in_browser' && (
          <Button
            size="small"
            variant="contained"
            disabled={busy}
            onClick={handlePrimaryConnect}
            sx={{ fontSize: '0.62rem', bgcolor: settingsTheme.accent.hud, ...settingsMonoSx }}
          >
            {busy ? <CircularProgress size={14} color="inherit" /> : 'Connect with API key'}
          </Button>
        )}
        {(!hubOAuth || tab === 1) && !simpleStdioConnect && (
          <Button
            size="small"
            variant="contained"
            disabled={busy}
            onClick={handleDeveloperConnect}
            sx={{ fontSize: '0.62rem', bgcolor: settingsTheme.accent.hud, ...settingsMonoSx }}
          >
            {busy ? <CircularProgress size={14} color="inherit" /> : 'Connect'}
          </Button>
        )}
        {simpleStdioConnect && (
          <Button
            size="small"
            variant="contained"
            disabled={busy}
            onClick={handlePrimaryConnect}
            sx={{ fontSize: '0.62rem', bgcolor: settingsTheme.accent.hud, ...settingsMonoSx }}
          >
            {busy ? <CircularProgress size={14} color="inherit" /> : 'Connect'}
          </Button>
        )}
      </Box>
    </Box>
  );
}
