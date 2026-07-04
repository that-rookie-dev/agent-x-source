import { describe, expect, it } from 'vitest';
import {
  isReadOnlyIntegrationTool,
  integrationToolRiskLevel,
  integrationToolId,
  parseIntegrationToolId,
} from '../src/integrations/action-classifier.js';
import { adaptMcpTool } from '../src/integrations/mcp/tool-adapter.js';
import { buildIntegrationActionPreview } from '../src/integrations/action-preview.js';
import { getIntegrationProvider, listIntegrationProviders, getCatalogStats, listCatalogProviders } from '../src/integrations/catalog/index.js';
import { parseMcpImportConfig } from '../src/integrations/mcp-config-import.js';
import { expandStdioArgs } from '../src/integrations/stdio-args.js';
import { createGoogleDriveBridgeTools } from '../src/integrations/mcp/google-drive-bridge.js';
import { formatStdioSpawnError, resolveStdioCommand } from '@agentx/shared';
import { isToolAllowedInPlanMode } from '../src/agent/plan-mode-utils.js';
import {
  canUseHubBrowserOAuth,
  requiresRemoteUrlForHubOAuth,
  resolveProviderOAuthConfig,
} from '@agentx/shared';

describe('action-classifier', () => {
  const slack = getIntegrationProvider('slack');

  it('classifies read tools as readonly', () => {
    expect(isReadOnlyIntegrationTool('list_channels', slack)).toBe(true);
    expect(integrationToolRiskLevel('list_channels', slack)).toBe('low');
  });

  it('classifies write tools as confirm-first', () => {
    expect(isReadOnlyIntegrationTool('send_message', slack)).toBe(false);
    expect(integrationToolRiskLevel('send_message', slack)).toBe('high');
  });

  it('classifies booking.com status and search tools as readonly', () => {
    const booking = getIntegrationProvider('booking-com')!;
    expect(isReadOnlyIntegrationTool('booking_status', booking)).toBe(true);
    expect(isReadOnlyIntegrationTool('booking_login_status', booking)).toBe(true);
    expect(isReadOnlyIntegrationTool('booking_search', booking)).toBe(true);
    expect(isReadOnlyIntegrationTool('booking_login', booking)).toBe(false);
    expect(isToolAllowedInPlanMode('integration__booking-com__booking_search')).toBe(true);
    expect(isToolAllowedInPlanMode('integration__booking-com__booking_status')).toBe(true);
    expect(isToolAllowedInPlanMode('integration__booking-com__booking_login')).toBe(true);
  });

  it('round-trips integration tool ids', () => {
    const id = integrationToolId('github', 'create_issue');
    expect(id).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
    expect(parseIntegrationToolId(id)).toEqual({ providerId: 'github', toolName: 'create_issue' });
  });

  it('parses legacy colon integration tool ids', () => {
    expect(parseIntegrationToolId('integration:github:create_issue')).toEqual({
      providerId: 'github',
      toolName: 'create_issue',
    });
  });
});

describe('tool-adapter', () => {
  it('maps MCP tools to integration ToolDefinition', () => {
    const provider = getIntegrationProvider('fetch')!;
    const tool = adaptMcpTool(provider, {
      name: 'fetch',
      description: 'Fetch a URL',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'URL' } },
        required: ['url'],
      },
    });
    expect(tool.id).toBe('integration__fetch__fetch');
    expect(tool.source).toBe('integration');
    expect(tool.category).toBe('integrations');
    expect(tool.riskLevel).toBe('low');
  });
});

describe('action-preview', () => {
  it('builds structured preview for integration write tools', () => {
    const provider = getIntegrationProvider('slack')!;
    const tool = adaptMcpTool(provider, { name: 'send_message', description: 'Send a message' });
    const preview = buildIntegrationActionPreview(tool.id, { channel: 'general', text: 'hello' }, tool);
    expect(preview?.providerName).toBe('Slack');
    expect(preview?.resultType).toBe('message');
    expect(preview?.parameters.length).toBeGreaterThan(0);
  });
});

describe('mcp import', () => {
  it('parses Claude Desktop mcp.json shape', () => {
    const config = parseMcpImportConfig({
      mcpServers: {
        fetch: { command: 'npx', args: ['-y', '@pulsemcp/pulse-fetch'] },
      },
    });
    expect(config.mcpServers.fetch?.command).toBe('npx');
  });
});

describe('plan-mode integration tools', () => {
  it('allows create/send integration tools in plan mode; blocks edit/delete', () => {
    expect(isToolAllowedInPlanMode('integration__fetch__fetch')).toBe(true);
    expect(isToolAllowedInPlanMode('integration__slack__send_message')).toBe(true);
    expect(isToolAllowedInPlanMode('integration__github__create_issue')).toBe(true);
    expect(isToolAllowedInPlanMode('integration__github__delete_issue')).toBe(false);
  });
});

describe('catalog', () => {
  it('has at least 20 active providers including lifestyle categories', () => {
    const providers = listIntegrationProviders();
    expect(providers.length).toBeGreaterThanOrEqual(20);
    const categories = new Set(providers.map((p) => p.category));
    expect(categories.has('finance')).toBe(true);
    expect(categories.has('shopping')).toBe(true);
    expect(categories.has('travel')).toBe(true);
  });

  it('has a verified catalog with real candidates', () => {
    const stats = getCatalogStats();
    expect(stats.active).toBeGreaterThanOrEqual(20);
    expect(stats.candidate).toBeGreaterThanOrEqual(20);
    const all = listCatalogProviders({ includeCandidates: true });
    expect(all.length).toBeGreaterThanOrEqual(40);
    const activeOnly = listCatalogProviders({ includeCandidates: false });
    expect(activeOnly.every((p) => p.catalogStatus !== 'candidate')).toBe(true);
  });

  it('expands HOME in stdio args', () => {
    const expanded = expandStdioArgs(['${HOME}']);
    expect(expanded[0]).not.toBe('${HOME}');
  });

  it('formats npx ENOENT as an actionable install message', () => {
    const message = formatStdioSpawnError(new Error('spawn npx ENOENT'), 'npx');
    expect(message).toContain('Node.js/npx was not found');
    expect(message).toContain('Booking.com');
  });

  it('resolves absolute stdio commands unchanged', () => {
    expect(resolveStdioCommand('/usr/local/bin/npx')).toBe('/usr/local/bin/npx');
  });
});

describe('hub browser oauth', () => {
  it('enables browser sign-in for remote MCP OAuth servers', () => {
    const atlassian = getIntegrationProvider('atlassian')!;
    const stay = getIntegrationProvider('1stay')!;
    expect(canUseHubBrowserOAuth(atlassian)).toBe(true);
    expect(canUseHubBrowserOAuth(stay)).toBe(true);
    expect(requiresRemoteUrlForHubOAuth(atlassian)).toBe(false);
    expect(resolveProviderOAuthConfig(atlassian).resource).toBe('https://mcp.atlassian.com/v1/mcp/authv2');
  });

  it('does not offer hub OAuth for stdio booking.com community server', () => {
    const booking = getIntegrationProvider('booking-com')!;
    expect(canUseHubBrowserOAuth(booking)).toBe(false);
    expect(booking.server.type).toBe('stdio');
  });

  it('uses MCP stdio auth for google-drive instead of hub OAuth', () => {
    const gdrive = getIntegrationProvider('google-drive')!;
    expect(gdrive.auth.mcpStdioAuth?.authArg).toBe('auth');
    expect(canUseHubBrowserOAuth(gdrive)).toBe(false);
  });

  it('registers Google Drive bridge tools for read/list', () => {
    const gdrive = getIntegrationProvider('google-drive')!;
    const bridges = createGoogleDriveBridgeTools(gdrive);
    expect(bridges.map((b) => b.definition.id)).toEqual([
      'integration__google-drive__read_file',
      'integration__google-drive__list_files',
    ]);
  });

  it('requires MCP URL for remote_url OAuth providers', () => {
    const ha = getIntegrationProvider('home-assistant')!;
    expect(canUseHubBrowserOAuth(ha)).toBe(true);
    expect(requiresRemoteUrlForHubOAuth(ha)).toBe(true);
  });

  it('does not offer hub OAuth for stdio packages without discovery config', () => {
    const gmail = getIntegrationProvider('gmail')!;
    expect(canUseHubBrowserOAuth(gmail)).toBe(false);
  });
});
