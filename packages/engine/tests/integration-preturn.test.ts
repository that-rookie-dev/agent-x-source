import { describe, expect, it, vi } from 'vitest';
import type { ToolExecutor } from '../src/tools/ToolExecutor.js';
import type { ToolRegistry } from '../src/tools/ToolRegistry.js';
import { IntegrationHub } from '../src/integrations/integration-hub.js';

describe('IntegrationHub.prepareForAgentTurn', () => {
  it('returns unavailable hint when user mentions a disconnected provider', async () => {
    const hub = new IntegrationHub({ baseDir: '/tmp/agentx-test-hub-' + process.pid });
    hub.setToolkitBridge(
      { register: vi.fn(), unregisterByPrefix: vi.fn(), list: vi.fn(() => []) } as unknown as ToolRegistry,
      { registerHandler: vi.fn() } as unknown as ToolExecutor,
    );

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
      { register: vi.fn(), unregisterByPrefix: vi.fn(), list: vi.fn(() => []) } as unknown as ToolRegistry,
      { registerHandler: vi.fn() } as unknown as ToolExecutor,
      'List all files in Notion',
    );

    expect(promptHint).toContain('INTEGRATION UNAVAILABLE');
    expect(promptHint).toContain('Notion');
    expect(promptHint).toContain('filesystem');
  });

  it('returns read hint when user asks to analyze a file and Drive is connected', async () => {
    const hub = new IntegrationHub({ baseDir: '/tmp/agentx-test-hub-read-' + process.pid });
    hub.setToolkitBridge(
      { register: vi.fn(), unregisterByPrefix: vi.fn(), list: vi.fn(() => []) } as unknown as ToolRegistry,
      { registerHandler: vi.fn() } as unknown as ToolExecutor,
    );

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

    (hub as unknown as { sessions: Map<string, { providerId: string; tools: unknown[] }> }).sessions = new Map([
      ['conn-gdrive', { providerId: 'google-drive', tools: [{}, {}, {}] }],
    ]);

    const { promptHint } = await hub.prepareForAgentTurn(
      { register: vi.fn(), unregisterByPrefix: vi.fn(), list: vi.fn(() => []) } as unknown as ToolRegistry,
      { registerHandler: vi.fn() } as unknown as ToolExecutor,
      'analyse the experience letter file and tell me what you found in it',
    );

    expect(promptHint).toContain('INTEGRATION READ');
    expect(promptHint).toContain('integration__google-drive__read_file');
    expect(promptHint).toContain('filesystem');
  });

  it('returns places hint for restaurant queries when Google Maps is connected', async () => {
    const hub = new IntegrationHub({ baseDir: '/tmp/agentx-test-maps-' + process.pid });
    hub.setToolkitBridge(
      { register: vi.fn(), unregisterByPrefix: vi.fn(), list: vi.fn(() => []) } as unknown as ToolRegistry,
      { registerHandler: vi.fn() } as unknown as ToolExecutor,
    );

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

    (hub as unknown as { sessions: Map<string, { providerId: string; tools: unknown[] }> }).sessions = new Map([
      ['conn-maps', { providerId: 'google-maps', tools: [{}, {}, {}, {}, {}, {}, {}] }],
    ]);

    const { promptHint } = await hub.prepareForAgentTurn(
      { register: vi.fn(), unregisterByPrefix: vi.fn(), list: vi.fn(() => []) } as unknown as ToolRegistry,
      { registerHandler: vi.fn() } as unknown as ToolExecutor,
      'best stake restaurants in bengaluru',
    );

    expect(promptHint).toContain('INTEGRATION PLACES');
    expect(promptHint).toContain('integration__google-maps__maps_search_places');
    expect(promptHint).toContain('deep_web_search');
  });
});
