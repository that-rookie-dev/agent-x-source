import { describe, expect, it } from 'vitest';
import { ToolExecutor } from '../src/tools/ToolExecutor.js';
import { ToolRegistry } from '../src/tools/ToolRegistry.js';

describe('ToolExecutor.unregisterHandlersByPrefix', () => {
  it('removes handlers whose ids start with the prefix', async () => {
    const registry = new ToolRegistry();
    const executor = new ToolExecutor(registry, '/tmp/agentx-test-scope');
    executor.registerHandler('integration__google-maps__maps_search_places', async () => ({
      success: true,
      output: 'ok',
    }));
    executor.registerHandler('file_read', async () => ({ success: true, output: 'ok' }));

    expect(executor.hasHandler('integration__google-maps__maps_search_places')).toBe(true);
    const removed = executor.unregisterHandlersByPrefix('integration__');
    expect(removed).toBe(1);
    expect(executor.hasHandler('integration__google-maps__maps_search_places')).toBe(false);
    expect(executor.hasHandler('file_read')).toBe(true);
  });
});
