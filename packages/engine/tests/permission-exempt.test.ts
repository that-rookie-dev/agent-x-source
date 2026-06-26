import { describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '../src/tools/ToolRegistry.js';
import { ToolExecutor } from '../src/tools/ToolExecutor.js';
import { isPermissionExemptTool } from '../src/tools/permissions/exempt-tools.js';

describe('permission-exempt web tools', () => {
  it('includes search and related read-only web tools', () => {
    expect(isPermissionExemptTool('web_search')).toBe(true);
    expect(isPermissionExemptTool('deep_web_search')).toBe(true);
    expect(isPermissionExemptTool('web_fetch')).toBe(true);
    expect(isPermissionExemptTool('web_scrape')).toBe(true);
    expect(isPermissionExemptTool('shell_exec')).toBe(false);
  });

  it('does not prompt permission for exempt tools', async () => {
    const registry = new ToolRegistry();
    registry.register({
      id: 'deep_web_search',
      name: 'Deep Web Search',
      description: 'test',
      modelDescription: 'test',
      category: 'web_network',
      riskLevel: 'medium',
      schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      composable: true,
      source: 'builtin',
    });
    const executor = new ToolExecutor(registry, '/tmp');
    executor.registerHandler('deep_web_search', async () => ({ success: true, output: 'ok' }));
    const handler = vi.fn().mockResolvedValue('deny');
    executor.setPermissionRequestHandler(handler);

    const result = await executor.execute('deep_web_search', { query: 'test' }, 'sess-1');

    expect(result.success).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });
});
