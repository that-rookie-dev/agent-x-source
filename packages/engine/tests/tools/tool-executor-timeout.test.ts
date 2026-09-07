import { describe, it, expect } from 'vitest';
import { ToolExecutor } from '../../src/tools/ToolExecutor.js';
import { ToolRegistry } from '../../src/tools/ToolRegistry.js';
import type { ToolDefinition, ToolExecutionContext, ToolResult } from '@agentx/shared';

describe('ToolExecutor respects timeoutMs', () => {
  it('passes the tool timeout to the execution context', async () => {
    const registry = new ToolRegistry();
    const tool: ToolDefinition = {
      id: 'slow_tool',
      name: 'Slow tool',
      description: 'A slow tool',
      modelDescription: 'Slow tool',
      category: 'code_intelligence',
      riskLevel: 'low',
      schema: { type: 'object', properties: {}, required: [] },
      composable: true,
      source: 'builtin',
      timeoutMs: 250,
    };
    registry.register(tool);

    let receivedTimeout = 0;
    const executor = new ToolExecutor(registry, '/tmp/agentx-test-scope');
    executor.registerHandler('slow_tool', async (_args, ctx: ToolExecutionContext) => {
      receivedTimeout = ctx.timeout;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { success: true, output: 'ok' } as ToolResult;
    });

    const result = await executor.execute('slow_tool', {}, 's1');
    expect(result.success).toBe(true);
    expect(receivedTimeout).toBe(250);
  });

  it('times out a slow tool using timeoutMs', async () => {
    const registry = new ToolRegistry();
    const tool: ToolDefinition = {
      id: 'very_slow_tool',
      name: 'Very slow tool',
      description: 'A very slow tool',
      modelDescription: 'Very slow tool',
      category: 'code_intelligence',
      riskLevel: 'low',
      schema: { type: 'object', properties: {}, required: [] },
      composable: true,
      source: 'builtin',
      timeoutMs: 50,
    };
    registry.register(tool);

    const executor = new ToolExecutor(registry, '/tmp/agentx-test-scope');
    executor.registerHandler('very_slow_tool', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return { success: true, output: 'ok' } as ToolResult;
    });

    const result = await executor.execute('very_slow_tool', {}, 's1');
    expect(result.success).toBe(false);
    expect(result.error).toBe('TIMEOUT');
    expect(result.output).toContain('50ms');
  });
});
