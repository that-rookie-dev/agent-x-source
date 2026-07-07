import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildGoogleOAuthAuthUrl,
  getMcpStdioOAuthRedirectUri,
  McpStdioOAuthStore,
  startMcpStdioBrowserOAuth,
  usesNativeMcpStdioBrowserOAuth,
  writeMcpStdioOAuthCredentials,
} from '../src/integrations/mcp-stdio-oauth-flow.js';
import { getIntegrationProvider } from '../src/integrations/catalog/index.js';
import { getMcpStdioAuthPaths } from '../src/integrations/mcp-stdio-auth.js';

describe('mcp-stdio-oauth-flow', () => {
  it('detects native browser flow for Gmail web OAuth', () => {
    const gmail = getIntegrationProvider('gmail')!;
    expect(usesNativeMcpStdioBrowserOAuth(gmail.auth.mcpStdioAuth!)).toBe(true);
    const gdrive = getIntegrationProvider('google-drive')!;
    expect(usesNativeMcpStdioBrowserOAuth(gdrive.auth.mcpStdioAuth!)).toBe(false);
  });

  it('builds redirect URI from Agent-X public URL', () => {
    const gmail = getIntegrationProvider('gmail')!;
    const uri = getMcpStdioOAuthRedirectUri('http://localhost:3333', gmail.auth.mcpStdioAuth!);
    expect(uri).toBe('http://localhost:3333/oauth2callback');
  });

  it('starts browser OAuth and writes keys with matching redirect URI', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'agentx-gmail-oauth-'));
    const gmail = getIntegrationProvider('gmail')!;
    const config = gmail.auth.mcpStdioAuth!;
    const store = new McpStdioOAuthStore();
    const connectionId = 'conn-gmail-test';

    const { authUrl, state, redirectUri } = startMcpStdioBrowserOAuth(store, {
      connectionId,
      provider: gmail,
      config,
      redirectBaseUrl: 'http://localhost:3333',
      secrets: {
        env: {
          GOOGLE_OAUTH_CLIENT_ID: 'client-id.apps.googleusercontent.com',
          GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
        },
      },
      baseDir,
    });

    expect(redirectUri).toBe('http://localhost:3333/oauth2callback');
    expect(authUrl).toContain('client_id=client-id.apps.googleusercontent.com');
    expect(authUrl).toContain(encodeURIComponent(redirectUri));
    expect(authUrl).toContain(`state=${state}`);

    const keysPath = getMcpStdioAuthPaths(connectionId, baseDir).oauthKeysPath;
    const keys = JSON.parse(readFileSync(keysPath, 'utf8')) as { web: { redirect_uris: string[] } };
    expect(keys.web.redirect_uris).toEqual(['http://localhost:3333/oauth2callback']);
  });

  it('builds Google auth URL with offline access and scopes', () => {
    const url = buildGoogleOAuthAuthUrl(
      'abc.apps.googleusercontent.com',
      'http://localhost:3333/oauth2callback',
      ['https://www.googleapis.com/auth/gmail.modify'],
      'state123',
    );
    expect(url).toContain('access_type=offline');
    expect(url).toContain('response_type=code');
    expect(url).toContain('state=state123');
  });

  it('writes MCP credentials file in Gmail format', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'agentx-gmail-creds-'));
    const gmail = getIntegrationProvider('gmail')!;
    writeMcpStdioOAuthCredentials('conn-1', gmail.auth.mcpStdioAuth!, {
      access_token: 'at',
      refresh_token: 'rt',
      scope: 'gmail',
      token_type: 'Bearer',
    }, baseDir);
    const credPath = getMcpStdioAuthPaths('conn-1', baseDir, 'credentials.json').credentialsPath;
    const creds = JSON.parse(readFileSync(credPath, 'utf8')) as { refresh_token: string };
    expect(creds.refresh_token).toBe('rt');
  });
});
