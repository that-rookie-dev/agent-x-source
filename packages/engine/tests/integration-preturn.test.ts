import { describe, expect, it, vi } from 'vitest';
import type { ToolExecutor } from '../src/tools/ToolExecutor.js';
import type { ToolRegistry } from '../src/tools/ToolRegistry.js';
import { IntegrationHub } from '../src/integrations/integration-hub.js';

function mockExecutor(handlerIds: string[] = []): ToolExecutor {
  const ready = new Set(handlerIds);
  return {
    registerHandler: vi.fn((toolId: string) => { ready.add(toolId); }),
    unregisterHandlersByPrefix: vi.fn((prefix: string) => {
      for (const id of [...ready]) {
        if (id.startsWith(prefix)) ready.delete(id);
      }
    }),
    hasHandler: (toolId: string) => ready.has(toolId),
  } as unknown as ToolExecutor;
}

function mockRegistry(): ToolRegistry {
  return {
    register: vi.fn(),
    unregisterByPrefix: vi.fn(),
    list: vi.fn(() => []),
  } as unknown as ToolRegistry;
}

describe('IntegrationHub.prepareForAgentTurn', () => {
  it('returns unavailable hint when user mentions a disconnected provider', async () => {
    const hub = new IntegrationHub({ baseDir: '/tmp/agentx-test-hub-' + process.pid });
    hub.setToolkitBridge(mockRegistry(), mockExecutor());

    const store = (hub as unknown as { store: { listConnections: () => unknown[] } }).store;
    vi.spyOn(store, 'listConnections').mockReturnValue([
      {
        id: 'conn-notion',
        providerId: 'notion',
        displayName: 'Notion',
        enabled: true,
        status: 'error',
        error: 'OAuth token request failed: Invalid refresh token',
      },
    ]);

    vi.spyOn(hub as unknown as { resolveProvider: (id: string) => { name: string } | undefined }, 'resolveProvider')
      .mockReturnValue({ name: 'Notion' });
    vi.spyOn(hub, 'syncToToolkit').mockReturnValue(0);

    const { promptHint } = await hub.prepareForAgentTurn(
      mockRegistry(),
      mockExecutor(),
      'List all files in Notion',
    );

    expect(promptHint).toContain('INTEGRATION UNAVAILABLE');
    expect(promptHint).toContain('Notion');
    expect(promptHint).toContain('filesystem');
  });

  it('returns read hint when user asks to analyze a file and Drive is connected', async () => {
    const hub = new IntegrationHub({ baseDir: '/tmp/agentx-test-hub-read-' + process.pid });
    const driveTools = [
      { id: 'integration__google-drive__read_file', name: 'read_file', description: '', schema: {} },
      { id: 'integration__google-drive__search', name: 'search', description: '', schema: {} },
    ];
    const registry = {
      register: vi.fn(),
      unregisterByPrefix: vi.fn(),
      list: vi.fn(() => driveTools),
    } as unknown as ToolRegistry;
    hub.setToolkitBridge(registry, mockExecutor());

    const store = (hub as unknown as { store: { listConnections: () => unknown[] } }).store;
    vi.spyOn(store, 'listConnections').mockReturnValue([
      {
        id: 'conn-gdrive',
        providerId: 'google-drive',
        displayName: 'Google Drive',
        enabled: true,
        status: 'connected',
      },
    ]);

    vi.spyOn(hub as unknown as { resolveProvider: (id: string) => { name: string } | undefined }, 'resolveProvider')
      .mockReturnValue({ name: 'Google Drive' });
    vi.spyOn(hub, 'syncToToolkit').mockReturnValue(3);

    (hub as unknown as { sessions: Map<string, { providerId: string; tools: Array<{ definition: { id: string } }> }> }).sessions = new Map([
      ['conn-gdrive', { providerId: 'google-drive', tools: [
        { definition: { id: 'integration__google-drive__read_file' } },
        { definition: { id: 'integration__google-drive__search' } },
        { definition: { id: 'integration__google-drive__list' } },
      ] }],
    ]);

    const executor = mockExecutor(['integration__google-drive__read_file']);
    const { promptHint } = await hub.prepareForAgentTurn(
      registry,
      executor,
      'analyse the experience letter file and tell me what you found in it',
    );

    expect(promptHint).toContain('INTEGRATION READ');
    expect(promptHint).toContain('integration__google-drive__read_file');
    expect(promptHint).toContain('filesystem');
  });

  it('returns places hint for restaurant queries when Google Maps is connected', async () => {
    const hub = new IntegrationHub({ baseDir: '/tmp/agentx-test-maps-' + process.pid });
    const mapsTools = [
      { id: 'integration__google-maps__maps_search_places', name: 'maps_search_places', description: '', schema: {} },
    ];
    const registry = {
      register: vi.fn(),
      unregisterByPrefix: vi.fn(),
      list: vi.fn(() => mapsTools),
    } as unknown as ToolRegistry;
    hub.setToolkitBridge(registry, mockExecutor());

    const store = (hub as unknown as { store: { listConnections: () => unknown[] } }).store;
    vi.spyOn(store, 'listConnections').mockReturnValue([
      {
        id: 'conn-maps',
        providerId: 'google-maps',
        displayName: 'Google Maps',
        enabled: true,
        status: 'connected',
      },
    ]);

    vi.spyOn(hub as unknown as { resolveProvider: (id: string) => { name: string } | undefined }, 'resolveProvider')
      .mockReturnValue({ name: 'Google Maps' });
    vi.spyOn(hub, 'syncToToolkit').mockReturnValue(7);

    (hub as unknown as { sessions: Map<string, { providerId: string; tools: Array<{ definition: { id: string } }> }> }).sessions = new Map([
      ['conn-maps', { providerId: 'google-maps', tools: [
        { definition: { id: 'integration__google-maps__maps_search_places' } },
      ] }],
    ]);

    const executor = mockExecutor(['integration__google-maps__maps_search_places']);
    const { promptHint } = await hub.prepareForAgentTurn(
      registry,
      executor,
      'best stake restaurants in bengaluru',
    );

    expect(promptHint).toContain('INTEGRATION PLACES');
    expect(promptHint).toContain('integration__google-maps__maps_search_places');
    expect(promptHint).toContain('credential');
  });

  it('returns degraded hint when Maps is connected but handlers are missing', async () => {
    const hub = new IntegrationHub({ baseDir: '/tmp/agentx-test-maps-degraded-' + process.pid });
    hub.setToolkitBridge(mockRegistry(), mockExecutor());

    const store = (hub as unknown as { store: { listConnections: () => unknown[] } }).store;
    vi.spyOn(store, 'listConnections').mockReturnValue([
      {
        id: 'conn-maps',
        providerId: 'google-maps',
        displayName: 'Google Maps',
        enabled: true,
        status: 'connected',
      },
    ]);

    vi.spyOn(hub as unknown as { resolveProvider: (id: string) => { name: string } | undefined }, 'resolveProvider')
      .mockReturnValue({ name: 'Google Maps' });
    vi.spyOn(hub, 'syncToToolkit').mockReturnValue(7);

    (hub as unknown as { sessions: Map<string, { providerId: string; tools: Array<{ definition: { id: string } }> }> }).sessions = new Map([
      ['conn-maps', { providerId: 'google-maps', tools: [
        { definition: { id: 'integration__google-maps__maps_search_places' } },
      ] }],
    ]);

    const { promptHint } = await hub.prepareForAgentTurn(
      mockRegistry(),
      mockExecutor(),
      'find coffee shops near me',
    );

    expect(promptHint).toContain('INTEGRATION DEGRADED');
    expect(promptHint).toContain('local system');
  });

  it('returns required hint for gmail email queries when no integration is connected', async () => {
    const hub = new IntegrationHub({ baseDir: '/tmp/agentx-test-gmail-none-' + process.pid });
    hub.setToolkitBridge(mockRegistry(), mockExecutor());

    const store = (hub as unknown as { store: { listConnections: () => unknown[] } }).store;
    vi.spyOn(store, 'listConnections').mockReturnValue([]);
    vi.spyOn(hub, 'syncToToolkit').mockReturnValue(0);

    const { promptHint, accessPolicy } = await hub.prepareForAgentTurn(
      mockRegistry(),
      mockExecutor(),
      'are there any unread emails in my gmail?',
    );

    expect(promptHint).toContain('INTEGRATION REQUIRED');
    expect(promptHint).toContain('Gmail');
    expect(promptHint).toContain('installed apps');
    expect(accessPolicy?.blockLocalExploration).toBe(true);
  });

  it('returns service hint when Gmail is connected for inbox queries', async () => {
    const hub = new IntegrationHub({ baseDir: '/tmp/agentx-test-gmail-ok-' + process.pid });
    const gmailTools = [
      { id: 'integration__gmail__search_emails', name: 'search_emails', description: '', schema: {} },
      { id: 'integration__gmail__read_email', name: 'read_email', description: '', schema: {} },
    ];
    const registry = {
      register: vi.fn(),
      unregisterByPrefix: vi.fn(),
      list: vi.fn(() => gmailTools),
    } as unknown as ToolRegistry;
    hub.setToolkitBridge(registry, mockExecutor());

    const store = (hub as unknown as { store: { listConnections: () => unknown[] } }).store;
    vi.spyOn(store, 'listConnections').mockReturnValue([
      {
        id: 'conn-gmail',
        providerId: 'gmail',
        displayName: 'Gmail',
        enabled: true,
        status: 'connected',
      },
    ]);

    vi.spyOn(hub as unknown as { resolveProvider: (id: string) => { name: string } | undefined }, 'resolveProvider')
      .mockReturnValue({ name: 'Gmail' });
    vi.spyOn(hub, 'syncToToolkit').mockReturnValue(5);

    (hub as unknown as { sessions: Map<string, { providerId: string; tools: Array<{ toolId: string; definition: { id: string } }> }> }).sessions = new Map([
      ['conn-gmail', { providerId: 'gmail', tools: [
        { toolId: 'integration__gmail__search_emails', definition: { id: 'integration__gmail__search_emails' } },
        { toolId: 'integration__gmail__read_email', definition: { id: 'integration__gmail__read_email' } },
      ] }],
    ]);

    const executor = mockExecutor(['integration__gmail__search_emails']);
    const { promptHint } = await hub.prepareForAgentTurn(
      registry,
      executor,
      'check my emails and let me know about it',
    );

    expect(promptHint).toContain('INTEGRATION SERVICE');
    expect(promptHint).toContain('integration__gmail__search_emails');
    expect(promptHint).toContain('Active tools this turn');
    expect(promptHint).toContain('credential hunting');
  });

  it('returns degraded hint when Gmail session exists but tools are not in registry', async () => {
    const hub = new IntegrationHub({ baseDir: '/tmp/agentx-test-gmail-stale-' + process.pid });
    hub.setToolkitBridge(mockRegistry(), mockExecutor());

    const store = (hub as unknown as { store: { listConnections: () => unknown[] } }).store;
    vi.spyOn(store, 'listConnections').mockReturnValue([
      {
        id: 'conn-gmail',
        providerId: 'gmail',
        displayName: 'Gmail',
        enabled: true,
        status: 'connected',
      },
    ]);

    vi.spyOn(hub as unknown as { resolveProvider: (id: string) => { name: string } | undefined }, 'resolveProvider')
      .mockReturnValue({ name: 'Gmail' });
    vi.spyOn(hub, 'syncToToolkit').mockReturnValue(0);

    (hub as unknown as { sessions: Map<string, { providerId: string; tools: Array<{ toolId: string; definition: { id: string } }> }> }).sessions = new Map([
      ['conn-gmail', { providerId: 'gmail', tools: [
        { toolId: 'integration__gmail__search_emails', definition: { id: 'integration__gmail__search_emails' } },
      ] }],
    ]);

    const executor = mockExecutor(['integration__gmail__search_emails']);
    const { promptHint } = await hub.prepareForAgentTurn(
      mockRegistry(),
      executor,
      'check my emails and let me know about it',
    );

    expect(promptHint).toContain('INTEGRATION DEGRADED');
    expect(promptHint).toContain('MCP Store');
    expect(promptHint).not.toContain('INTEGRATION SERVICE');
  });
});
