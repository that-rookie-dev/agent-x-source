import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { IntegrationConnectionSecrets, IntegrationMcpStdioAuth, IntegrationProvider } from '@agentx/shared';
import { getDataDir, getLogger } from '@agentx/shared';
import { expandStdioArgs } from './stdio-args.js';
import { resolveStdioCommand } from '@agentx/shared';

export interface McpStdioAuthPaths {
  oauthKeysPath: string;
  credentialsPath: string;
}

export function getMcpStdioAuthPaths(
  connectionId: string,
  baseDir?: string,
  credentialsFileName = '.gdrive-server-credentials.json',
): McpStdioAuthPaths {
  const dir = join(baseDir ?? getDataDir(), 'integrations', 'stdio-auth', connectionId);
  return {
    oauthKeysPath: join(dir, 'gcp-oauth.keys.json'),
    credentialsPath: join(dir, credentialsFileName),
  };
}

export function writeGoogleOAuthKeysFile(
  connectionId: string,
  clientId: string,
  clientSecret: string,
  baseDir?: string,
  config?: Pick<IntegrationMcpStdioAuth, 'oauthKeysFormat' | 'webRedirectUris'>,
  redirectUri?: string,
): string {
  const paths = getMcpStdioAuthPaths(connectionId, baseDir);
  mkdirSync(join(paths.oauthKeysPath, '..'), { recursive: true });
  const oauthCommon = {
    client_id: clientId.trim(),
    project_id: 'agent-x',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    client_secret: clientSecret.trim(),
  };
  const redirectUris = redirectUri
    ? [redirectUri]
    : config?.webRedirectUris ?? ['http://localhost:3000/oauth2callback'];
  const payload = config?.oauthKeysFormat === 'web'
    ? {
        web: {
          ...oauthCommon,
          redirect_uris: redirectUris,
        },
      }
    : {
        installed: {
          ...oauthCommon,
          redirect_uris: ['http://localhost'],
        },
      };
  writeFileSync(paths.oauthKeysPath, JSON.stringify(payload, null, 2), 'utf-8');
  return paths.oauthKeysPath;
}

export function resolveMcpStdioAuthCredentials(
  config: IntegrationMcpStdioAuth,
  secrets: IntegrationConnectionSecrets | null,
  connectionId: string,
  baseDir?: string,
): { clientId: string; clientSecret: string } | null {
  const clientId = secrets?.env?.[config.clientIdField]?.trim()
    ?? (config.clientIdEnv ? process.env[config.clientIdEnv]?.trim() : undefined)
    ?? process.env['G-DRIVE_CLIENT_ID']?.trim()
    ?? process.env['GOOGLE_OAUTH_CLIENT_ID']?.trim();
  const clientSecret = secrets?.env?.[config.clientSecretField]?.trim()
    ?? (config.clientSecretEnv ? process.env[config.clientSecretEnv]?.trim() : undefined)
    ?? process.env['G-DRIVE_CLIENT_SECRET']?.trim()
    ?? process.env['GOOGLE_OAUTH_CLIENT_SECRET']?.trim();
  if (!clientId || !clientSecret) return null;
  writeGoogleOAuthKeysFile(connectionId, clientId, clientSecret, baseDir, config);
  return { clientId, clientSecret };
}

export function buildMcpStdioAuthEnv(
  config: IntegrationMcpStdioAuth,
  connectionId: string,
  baseDir?: string,
): Record<string, string> {
  const paths = getMcpStdioAuthPaths(connectionId, baseDir, config.credentialsFileName);
  return {
    [config.oauthPathEnv]: paths.oauthKeysPath,
    [config.credentialsPathEnv]: paths.credentialsPath,
  };
}

export function hasMcpStdioAuthCredentials(
  config: IntegrationMcpStdioAuth,
  connectionId: string,
  baseDir?: string,
): boolean {
  const paths = getMcpStdioAuthPaths(connectionId, baseDir, config.credentialsFileName);
  return existsSync(paths.credentialsPath);
}

export const MCP_STDIO_AUTH_PENDING_MESSAGE =
  'Complete Google sign-in to authorize access.';

export function isMcpStdioAuthPending(
  config: IntegrationMcpStdioAuth | undefined,
  connectionId: string,
  baseDir?: string,
): boolean {
  return Boolean(config && !hasMcpStdioAuthCredentials(config, connectionId, baseDir));
}

export function formatMcpStdioAuthError(output: string, providerId?: string): string {
  const trimmed = output.trim();
  const lower = trimmed.toLowerCase();
  if (lower.includes('access_denied') || lower.includes('error 403') || lower.includes('403: access_denied')) {
    const gmailHints = providerId === 'gmail' || lower.includes('oauth2callback')
      ? [
          '2. Credentials → create OAuth client type Web application (not Desktop).',
          '3. Authorized redirect URIs → add your Agent-X callback (default http://localhost:3333/oauth2callback).',
          '4. OAuth consent screen → Data access → add gmail.modify and gmail.settings.basic scopes.',
          '5. Enable the Gmail API for this project.',
        ]
      : [
          '2. Credentials → OAuth client must be type Desktop app (not Web).',
          '3. Enable the Gmail or Google Drive API for this project.',
        ];
    return [
      'Google returned Error 403: access_denied.',
      '',
      'Fix in Google Cloud Console:',
      '1. OAuth consent screen → add your Google account under Test users (required when the app is in Testing).',
      ...gmailHints,
      '',
      'Then click Sign in again.',
    ].join('\n');
  }
  if (lower.includes('eaddrinuse') || lower.includes('address already in use')) {
    return [
      'Google sign-in could not start a local callback server (port already in use).',
      '',
      'Agent-X now handles Gmail sign-in through its own server — restart Agent-X, click Sign in again,',
      'and register this redirect URI in Google Cloud Console (Web OAuth client):',
      '  http://localhost:3333/oauth2callback',
      '(Use your AGENTX_PUBLIC_URL if you run on a different host/port.)',
    ].join('\n');
  }
  if (lower.includes('credentials not found')) {
    return [
      trimmed,
      '',
      'Complete Google sign-in first — the MCP server cannot start until authorization finishes.',
    ].join('\n');
  }
  return trimmed || 'Google sign-in did not complete.';
}

export async function runMcpStdioAuthCommand(
  provider: IntegrationProvider,
  config: IntegrationMcpStdioAuth,
  env: Record<string, string>,
): Promise<{ success: boolean; output: string }> {
  const command = resolveStdioCommand(provider.server.command ?? 'npx');
  const args = expandStdioArgs([...(provider.server.args ?? []), config.authArg]);
  const logger = getLogger();

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('error', (error) => {
      resolve({ success: false, output: error.message });
    });

    child.on('close', (code) => {
      const output = [stdout, stderr].filter(Boolean).join('\n').trim();
      if (code === 0) {
        resolve({ success: true, output: output || 'Google authorization completed.' });
        return;
      }
      logger.warn('MCP_STDIO_AUTH', `${provider.id} auth exited ${code}: ${output.slice(0, 500)}`);
      resolve({
        success: false,
        output: formatMcpStdioAuthError(
          output || `Authorization failed (exit ${code ?? 'unknown'})`,
          provider.id,
        ),
      });
    });
  });
}
