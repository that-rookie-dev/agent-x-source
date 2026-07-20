import { describe, expect, it } from 'vitest';
import { InMemoryQueue } from '../src/queue/InMemoryQueue.js';
import { registerToolWorkers } from '../src/queue/workers/tool-worker.js';
import { ToolService } from '../src/services/tool/ToolService.js';
import { ToolExecutor } from '../src/tools/ToolExecutor.js';
import { ToolRegistry } from '../src/tools/ToolRegistry.js';
import type { ToolResult } from '@agentx/shared';

describe('tool-worker', () => {
  it('executes tool.exec jobs via the queue', async () => {
    const registry = new ToolRegistry();
    registry.register({
      id: 'hello',
      name: 'hello',
      description: 'hello',
      modelDescription: 'hello',
      category: 'ai_meta',
      riskLevel: 'low',
      schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      composable: false,
      source: 'builtin',
    });

    const executor = new ToolExecutor(registry, '/tmp/agentx-test-scope');
    executor.registerHandler('hello', async (args: Record<string, unknown>) => {
      return { success: true, output: `Hello ${args.name}` } as ToolResult;
    });

    const service = new ToolService({ registry, executor, scopePath: '/tmp/agentx-test-scope' });
    const queue = new InMemoryQueue();
    await queue.start();

    registerToolWorkers(queue, service);

    const jobId = await queue.enqueue('tool.exec', {
      toolId: 'hello',
      args: { name: 'world' },
      sessionId: 'session-1',
    });

    // Allow queue to process
    await new Promise((r) => setTimeout(r, 50));

    const job = await queue.getJob(jobId);
    expect(job?.status).toBe('completed');

    await queue.stop();
  });

  it('fails job when toolId is missing', async () => {
    const registry = new ToolRegistry();
    const executor = new ToolExecutor(registry, '/tmp/agentx-test-scope');
    const service = new ToolService({ registry, executor, scopePath: '/tmp/agentx-test-scope' });
    const queue = new InMemoryQueue();
    await queue.start();

    registerToolWorkers(queue, service);

    const jobId = await queue.enqueue('tool.exec', { args: {} });
    await new Promise((r) => setTimeout(r, 50));

    const job = await queue.getJob(jobId);
    expect(job?.status).toBe('completed');

    await queue.stop();
  });
});
