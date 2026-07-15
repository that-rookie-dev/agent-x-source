import { describe, expect, it } from 'vitest';
import { ToolService } from '../src/services/tool/ToolService.js';
import { ToolExecutor } from '../src/tools/ToolExecutor.js';
import { ToolRegistry } from '../src/tools/ToolRegistry.js';
import type { ToolDefinition, ToolResult } from '@agentx/shared';

function buildToolService(overrides?: { cacheTtlMs?: number }) {
  const registry = new ToolRegistry();
  const toolDef: ToolDefinition = {
    id: 'echo',
    name: 'echo',
    description: 'echo',
    modelDescription: 'echo',
    category: 'ai_meta',
    riskLevel: 'low',
    schema: {
      type: 'object',
      properties: {
        msg: { type: 'string', description: 'message' },
      },
      required: ['msg'],
    },
    composable: false,
    source: 'builtin',
  };
  registry.register(toolDef);

  const executor = new ToolExecutor(registry, '/tmp/agentx-test-scope');
  executor.registerHandler('echo', async (args: Record<string, unknown>) => {
    return { success: true, output: String(args.msg) } as ToolResult;
  });

  const service = new ToolService({
    registry,
    executor,
    scopePath: '/tmp/agentx-test-scope',
    cacheOptions: overrides?.cacheTtlMs ? { ttlMs: overrides.cacheTtlMs } : undefined,
  });

  return { service, registry, executor };
}

describe('ToolService', () => {
  it('lists tools from registry', () => {
    const { service, registry } = buildToolService();
    expect(service.listTools()).toEqual(registry.list());
  });

  it('delegates execute to the executor', async () => {
    const { service } = buildToolService();
    const result = await service.execute('echo', { msg: 'hello' }, 'session');
    expect(result.success).toBe(true);
    expect(result.output).toBe('hello');
  });

  it('caches successful results when enabled', async () => {
    const { service } = buildToolService({ cacheTtlMs: 1000 });
    let calls = 0;
    const executor = service.getToolExecutor();
    executor.registerHandler('counter', async () => {
      calls += 1;
      return { success: true, output: String(calls) };
    });
    const registry = service.getRegistry();
    registry.register({
      id: 'counter',
      name: 'counter',
      description: 'counter',
      modelDescription: 'counter',
      category: 'ai_meta',
      riskLevel: 'low',
      schema: { type: 'object', properties: {} },
      composable: false,
      source: 'builtin',
    });

    const r1 = await service.execute('counter', {}, 'session');
    const r2 = await service.execute('counter', {}, 'session');
    expect(r1.output).toBe('1');
    expect(r2.output).toBe('1');
    expect(calls).toBe(1);
  });

  it('does not cache failed results', async () => {
    const { service } = buildToolService({ cacheTtlMs: 1000 });
    const executor = service.getToolExecutor();
    executor.registerHandler('fail', async () => {
      return { success: false, output: 'error', error: 'ERR' };
    });
    const registry = service.getRegistry();
    registry.register({
      id: 'fail',
      name: 'fail',
      description: 'fail',
      modelDescription: 'fail',
      category: 'ai_meta',
      riskLevel: 'low',
      schema: { type: 'object', properties: {} },
      composable: false,
      source: 'builtin',
    });

    const r1 = await service.execute('fail', {}, 'session');
    const r2 = await service.execute('fail', {}, 'session');
    expect(r1.output).toBe('error');
    expect(r2.output).toBe('error');
    expect(service.getCacheService().size).toBe(0);
  });

  it('classifies calls as safe or sequential', () => {
    const { service, registry } = buildToolService();
    registry.register({
      id: 'question',
      name: 'question',
      description: 'question',
      modelDescription: 'question',
      category: 'communication',
      riskLevel: 'low',
      schema: { type: 'object', properties: {} },
      composable: false,
      source: 'builtin',
    });

    const classification = service.classify([
      { toolId: 'echo', args: { msg: 'a' } },
      { toolId: 'question', args: { text: 'hi' } },
    ]);

    expect(classification.parallel.length).toBe(1);
    expect(classification.parallel[0].tool.id).toBe('echo');
    expect(classification.sequential.length).toBe(1);
    expect(classification.sequential[0].tool.id).toBe('question');
  });

  it('denies permission for unknown tools', async () => {
    const { service } = buildToolService();
    const result = await service.requestPermission('unknown', {}, 'session');
    expect(result.decision).toBe('deny');
    expect(result.error).toBe('MODE_RESTRICTED');
  });

  it('returns executor and registry', () => {
    const { service, registry, executor } = buildToolService();
    expect(service.getToolExecutor()).toBe(executor);
    expect(service.getRegistry()).toBe(registry);
  });
});
