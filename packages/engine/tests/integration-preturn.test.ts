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
    hub.setToolkitBridge(mockRegistry(), mockExecutor());

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
      mockRegistry(),
      executor,
      'analyse the experience letter file and tell me what you found in it',
    );

    expect(promptHint).toContain('INTEGRATION READ');
    expect(promptHint).toContain('integration__google-drive__read_file');
    expect(promptHint).toContain('filesystem');
  });

  it('returns places hint for restaurant queries when Google Maps is connected', async () => {
    const hub = new IntegrationHub({ baseDir: '/tmp/agentx-test-maps-' + process.pid });
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

    const executor = mockExecutor(['integration__google-maps__maps_search_places']);
    const { promptHint } = await hub.prepareForAgentTurn(
      mockRegistry(),
      executor,
      'best stake restaurants in bengaluru',
    );

    expect(promptHint).toContain('INTEGRATION PLACES');
    expect(promptHint).toContain('integration__google-maps__maps_search_places');
    expect(promptHint).toContain('deep_web_search');
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
    expect(promptHint).toContain('do NOT claim you mapped locations');
  });
});
