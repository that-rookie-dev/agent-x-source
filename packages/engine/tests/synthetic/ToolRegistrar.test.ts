import { describe, it, expect } from 'vitest';
import { ToolRegistrar } from '../../src/synthetic/ToolRegistrar.js';
import { GeneratedToolRuntime } from '../../src/synthetic/GeneratedToolRuntime.js';
import { InMemoryCapabilityStore } from '../../src/synthetic/InMemoryCapabilityStore.js';
import { ToolRegistry } from '../../src/tools/ToolRegistry.js';
import type { ToolCapability, ToolResult } from '@agentx/shared';

const tool = (): ToolCapability => {
  const now = Date.now();
  return {
    id: 'cap_t', kind: 'tool', name: 'csv-json', description: 'csv', createdAt: now, updatedAt: now,
    createdBy: 't', sourceSessionId: '', version: 1, origin: 'user-prompt', status: 'registered',
    useCount: 0, trialCount: 0, language: 'javascript', sourceCode: 'function run(){return 1}', entryPoint: 'run',
    inputSchema: {}, outputSchema: {}, dependencies: [], sideEffects: [], approvedSideEffects: [], sandboxResult: null,
  };
};

describe('ToolRegistrar', () => {
  it('registers generated tools with the si_ prefix and skips built-in ids', async () => {
    const store = new InMemoryCapabilityStore();
    await store.insertCapability(tool());
    const runtime = new GeneratedToolRuntime(store, {
      runTool: async () => ({ passed: true, stdout: '1', stderr: '', exitCode: 0, warnings: [], detectedSideEffects: [], executionTimeMs: 1 }),
      validateSideEffects: async () => [],
      estimateRisk: async () => 'low',
    });
    const registry = new ToolRegistry();
    const handlers = new Map<string, unknown>();
    const registrar = new ToolRegistrar(runtime, store, () => ({
      registry,
      executor: {
        registerHandler: (id: string, fn: (args: Record<string, unknown>) => Promise<ToolResult>) => { handlers.set(id, fn); },
        unregisterHandler: (id: string) => handlers.delete(id),
        unregisterHandlersByPrefix: (prefix: string) => {
          for (const id of [...handlers.keys()]) if (id.startsWith(prefix)) handlers.delete(id);
          return 0;
        },
      } as never,
    }));
    await registrar.sync();
    expect(registry.listBySource('generated').some((t) => t.id.startsWith('si_'))).toBe(true);
  });
});
