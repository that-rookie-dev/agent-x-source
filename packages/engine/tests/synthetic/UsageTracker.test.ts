import { describe, it, expect } from 'vitest';
import { UsageTracker } from '../../src/synthetic/UsageTracker.js';
import { InMemoryCapabilityStore } from '../../src/synthetic/InMemoryCapabilityStore.js';
import type { ToolCapability } from '@agentx/shared';

const tool = (): ToolCapability => {
  const now = Date.now();
  return {
    id: 'cap_t', kind: 'tool', name: 'csv', description: 'csv', createdAt: now, updatedAt: now,
    createdBy: 't', sourceSessionId: '', version: 1, origin: 'user-prompt', status: 'registered',
    useCount: 0, trialCount: 0, language: 'javascript', sourceCode: 'function run(){return 1}', entryPoint: 'run',
    inputSchema: {}, outputSchema: {}, dependencies: [], sideEffects: [], approvedSideEffects: [], sandboxResult: null,
  };
};

describe('UsageTracker', () => {
  it('records invocations and computes success rate', async () => {
    const store = new InMemoryCapabilityStore();
    await store.insertCapability(tool());
    const tracker = new UsageTracker(store);
    await tracker.recordInvocation('cap_t', true, 12, 's1');
    await tracker.recordInvocation('cap_t', false, 20, 's1');
    const report = await tracker.getUsageReport('cap_t');
    expect(report.useCount).toBe(2);
    expect(report.successRate).toBe(0.5);
    expect(report.sessionCount).toBe(1);
  });
});
