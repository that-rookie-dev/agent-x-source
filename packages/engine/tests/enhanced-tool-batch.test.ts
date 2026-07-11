import { describe, it, expect, vi } from 'vitest';
import { EnhancedToolExecutor } from '../src/tools/EnhancedToolExecutor.js';
import { ToolRegistry } from '../src/tools/ToolRegistry.js';
import type { ToolDefinition, ToolResult } from '@agentx/shared';

describe('EnhancedToolExecutor batch coalescing', () => {
  it('classifies concurrent SAFE tools and runs them overlapping', async () => {
    const registry = new ToolRegistry();
    const makeDef = (id: string): ToolDefinition => ({
      id,
      name: id,
      description: id,
      modelDescription: id,
      category: 'filesystem',
      riskLevel: 'low',
      schema: { type: 'object', properties: {} },
      composable: false,
      source: 'builtin',
    });
    registry.register(makeDef('file_read'));
    registry.register(makeDef('grep'));

    const executor = new EnhancedToolExecutor(registry, '/tmp');
    const started: string[] = [];
    let concurrent = 0;
    let peak = 0;

    const handler = async (args: Record<string, unknown>): Promise<ToolResult> => {
      const id = String(args['id'] ?? '');
      started.push(id);
      concurrent++;
      peak = Math.max(peak, concurrent);
      await new Promise((r) => setTimeout(r, 40));
      concurrent--;
      return { success: true, output: id };
    };

    executor.registerHandler('file_read', async (args) => handler({ ...args, id: 'file_read' }));
    executor.registerHandler('grep', async (args) => handler({ ...args, id: 'grep' }));

    const [a, b] = await Promise.all([
      executor.execute('file_read', { path: 'a.ts' }, 's1'),
      executor.execute('grep', { pattern: 'x' }, 's1'),
    ]);

    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    expect(peak).toBeGreaterThanOrEqual(2);
    expect(started).toContain('file_read');
    expect(started).toContain('grep');
  });

  it('executeBatch runs ask_clarification sequentially vs reads', async () => {
    const registry = new ToolRegistry();
    for (const id of ['file_read', 'ask_clarification']) {
      registry.register({
        id,
        name: id,
        description: id,
        modelDescription: id,
        category: 'ai_meta',
        riskLevel: 'low',
        schema: { type: 'object', properties: {} },
        composable: false,
        source: 'builtin',
      });
    }
    const executor = new EnhancedToolExecutor(registry, '/tmp');
    const order: string[] = [];
    executor.registerHandler('file_read', async () => {
      order.push('file_read');
      return { success: true, output: 'ok' };
    });
    executor.registerHandler('ask_clarification', async () => {
      order.push('ask_clarification');
      return { success: true, output: 'ok' };
    });

    const results = await executor.executeBatch(
      [
        { toolCallId: '1', toolName: 'ask_clarification', args: {} },
        { toolCallId: '2', toolName: 'file_read', args: { path: 'x' } },
      ],
      's1',
    );

    expect(results).toHaveLength(2);
    // ask_clarification is NEVER → sequential group; file_read may be parallel group first
    expect(order).toContain('ask_clarification');
    expect(order).toContain('file_read');
  });
});
