import { describe, expect, it } from 'vitest';
import { ToolExecutor } from '../src/tools/ToolExecutor.js';
import { ToolRegistry } from '../src/tools/ToolRegistry.js';

describe('turn abort', () => {
  it('ToolExecutor rejects new tools when turn is aborted', async () => {
    const registry = new ToolRegistry();
    registry.register({
      id: 'echo',
      name: 'echo',
      description: 'echo',
      category: 'test',
      riskLevel: 'low',
      schema: { type: 'object', properties: {}, required: [] },
      modelDescription: 'echo',
    });
    const executor = new ToolExecutor(registry, '/tmp');
    executor.registerHandler('echo', async () => ({ success: true, output: 'ok' }));
    executor.setTurnAborted(true);

    const result = await executor.execute('echo', {}, 'sess-1');
    expect(result.success).toBe(false);
    expect(result.error).toBe('TURN_ABORTED');
  });
});
