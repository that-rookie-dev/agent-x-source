import { describe, expect, it } from 'vitest';
import { enrichProviderSetupWizard, inferCredentialPreflight } from '../src/integrations/catalog/setup-wizard.js';
import type { IntegrationProvider } from '@agentx/shared';

const baseProvider: IntegrationProvider = {
  id: 'test',
  name: 'Test',
  category: 'productivity',
  description: 'Test provider',
  icon: 'hub',
  trust: 'verified',
  server: { type: 'stdio', command: 'npx', args: ['-y', 'pkg'] },
  auth: { primary: 'api_key_form', fields: [{ key: 'API_KEY', label: 'API Key', required: true }] },
  capabilities: { search: true, read: true, write: false, transact: false },
};

describe('enrichProviderSetupWizard', () => {
  it('infers api_key template for token-based stdio providers', () => {
    const enriched = enrichProviderSetupWizard(baseProvider);
    expect(enriched.setupWizard?.template).toBe('api_key');
    expect(enriched.setupWizard?.preflight).toContain('node_available');
    expect(enriched.setupWizard?.preflight).toContain('npx_available');
    expect(enriched.setupWizard?.hideDeveloperTab).toBe(true);
  });

  it('infers stdio_none for fetch-like providers', () => {
    const fetchLike: IntegrationProvider = {
      ...baseProvider,
      id: 'fetch',
      category: 'dev_ops',
      auth: { primary: 'none', developer: ['stdio'] },
    };
    const enriched = enrichProviderSetupWizard(fetchLike);
    expect(enriched.setupWizard?.template).toBe('stdio_none');
  });

  it('infers oauth_remote for remote OAuth providers', () => {
    const notionLike: IntegrationProvider = {
      ...baseProvider,
      id: 'notion',
      server: { type: 'remote', url: 'https://mcp.notion.com/mcp' },
      auth: {
        primary: 'oauth',
        oauth: { resource: 'https://mcp.notion.com/mcp', scopes: ['mcp'] },
      },
    };
    const enriched = enrichProviderSetupWizard(notionLike);
    expect(enriched.setupWizard?.template).toBe('oauth_remote');
    expect(enriched.setupWizard?.preflight).toContain('oauth_client_configured');
  });

  it('infers folder_sandbox and folder_access permission for filesystem', () => {
    const fs: IntegrationProvider = {
      ...baseProvider,
      id: 'filesystem',
      category: 'dev_ops',
      auth: { primary: 'none', developer: ['stdio'] },
    };
    const enriched = enrichProviderSetupWizard(fs);
    expect(enriched.setupWizard?.template).toBe('folder_sandbox');
    expect(enriched.setupWizard?.osPermissions).toContain('folder_access');
  });

  it('merges non-developer copy for known providers without overriding catalog copy', () => {
    const slackLike: IntegrationProvider = {
      ...baseProvider,
      id: 'slack',
      category: 'communication',
    };
    const enriched = enrichProviderSetupWizard(slackLike);
    expect(enriched.highlights?.length).toBeGreaterThan(0);
    expect(enriched.auth.connectGuide?.some((g) => g.link?.includes('api.slack.com'))).toBe(true);

    const withOwnCopy: IntegrationProvider = {
      ...slackLike,
      highlights: ['Catalog-authored highlight'],
    };
    const enriched2 = enrichProviderSetupWizard(withOwnCopy);
    expect(enriched2.highlights).toEqual(['Catalog-authored highlight']);
  });

  it('infers credential preflight for postgres and redis', () => {
    expect(inferCredentialPreflight({ ...baseProvider, id: 'postgres' })).toEqual(['postgres_reachable']);
    expect(inferCredentialPreflight({ ...baseProvider, id: 'redis' })).toEqual(['redis_reachable']);
    expect(inferCredentialPreflight({ ...baseProvider, id: 'sqlite' })).toEqual(['folder_readable']);
  });

  it('includes folder and mcp checks for filesystem', () => {
    const fs: IntegrationProvider = {
      ...baseProvider,
      id: 'filesystem',
      auth: { primary: 'none', developer: ['stdio'] },
    };
    const enriched = enrichProviderSetupWizard(fs);
    expect(enriched.setupWizard?.preflight).toContain('folder_readable');
    expect(enriched.setupWizard?.preflight).toContain('mcp_handshake');
  });
});
