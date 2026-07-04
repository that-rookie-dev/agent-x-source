import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPreflightChecks } from '../src/integrations/preflight.js';
import { saveIntegrationHubSettings } from '../src/integrations/catalog/loader.js';
import type { IntegrationProvider } from '@agentx/shared';

const baseProvider: IntegrationProvider = {
  id: 'test',
  name: 'Test',
  category: 'dev_ops',
  description: 'Test',
  icon: 'hub',
  trust: 'verified',
  server: { type: 'stdio', command: 'npx', args: ['-y', 'pkg'] },
  auth: { primary: 'api_key_form', fields: [{ key: 'API_KEY', label: 'API Key', required: true }] },
  capabilities: { search: true, read: true, write: false, transact: false },
};

describe('runPreflightChecks', () => {
  it('returns mcp_handshake placeholder', async () => {
    const results = await runPreflightChecks(baseProvider, ['mcp_handshake']);
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.id).toBe('mcp_handshake');
  });

  it('requires postgres URL for postgres_reachable', async () => {
    const postgres: IntegrationProvider = { ...baseProvider, id: 'postgres' };
    const results = await runPreflightChecks(postgres, ['postgres_reachable'], {});
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.id).toBe('postgres_reachable');
  });

  it('validates postgres URL format', async () => {
    const postgres: IntegrationProvider = { ...baseProvider, id: 'postgres' };
    const results = await runPreflightChecks(postgres, ['postgres_reachable'], {
      env: { DATABASE_URL: 'not-a-url' },
    });
    expect(results[0]?.ok).toBe(false);
  });

  it('requires redis URL for redis_reachable', async () => {
    const redis: IntegrationProvider = { ...baseProvider, id: 'redis' };
    const results = await runPreflightChecks(redis, ['redis_reachable'], {});
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.id).toBe('redis_reachable');
  });

  it('requires folder path for folder_readable', async () => {
    const results = await runPreflightChecks(baseProvider, ['folder_readable'], {});
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.id).toBe('folder_readable');
  });

  it('skips oauth env when not configured on provider', async () => {
    const results = await runPreflightChecks(baseProvider, ['oauth_env_configured']);
    expect(results[0]?.ok).toBe(true);
  });

  it('fails oauth env check when client id is missing everywhere', async () => {
    const oauthProvider: IntegrationProvider = {
      ...baseProvider,
      id: 'oauth-missing',
      auth: { primary: 'oauth', oauth: { discoveryUrl: 'https://example.com/.well-known', clientIdEnv: 'AGENTX_TEST_MISSING_CLIENT_ID' } },
    };
    const results = await runPreflightChecks(oauthProvider, ['oauth_env_configured']);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.fixHint).toContain('Paste your OAuth Client ID');
  });

  it('passes oauth env check when client id is saved in hub settings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentx-preflight-'));
    saveIntegrationHubSettings({ oauthClientIds: { 'oauth-saved': 'client-123' } }, dir);
    const oauthProvider: IntegrationProvider = {
      ...baseProvider,
      id: 'oauth-saved',
      auth: { primary: 'oauth', oauth: { discoveryUrl: 'https://example.com/.well-known', clientIdEnv: 'AGENTX_TEST_SAVED_CLIENT_ID' } },
    };
    const results = await runPreflightChecks(oauthProvider, ['oauth_env_configured']);
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.message).toContain('Agent-X settings');
  });
});
