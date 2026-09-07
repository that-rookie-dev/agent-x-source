import { describe, it, expect } from 'vitest';
import { AutoDeprecator } from '../../src/synthetic/AutoDeprecator.js';
import { UsageTracker } from '../../src/synthetic/UsageTracker.js';
import { InMemoryCapabilityStore } from '../../src/synthetic/InMemoryCapabilityStore.js';
import type { ToolCapability } from '@agentx/shared';

function tool(id: string, useCount: number, createdAt = Date.now()): ToolCapability {
  return {
    id, kind: 'tool', name: id, description: 'd', createdAt, updatedAt: Date.now(),
    createdBy: 't', sourceSessionId: '', version: 1, origin: 'user-prompt', status: 'registered',
    useCount, trialCount: 0, language: 'javascript', sourceCode: 'function run(){return 1}', entryPoint: 'run',
    inputSchema: {}, outputSchema: {}, dependencies: [], sideEffects: [], approvedSideEffects: [], sandboxResult: null,
  };
}

describe('AutoDeprecator', () => {
  it('flags tools with a low success rate after 10 uses', async () => {
    const store = new InMemoryCapabilityStore();
    await store.insertCapability(tool('cap_bad', 0));
    const usage = new UsageTracker(store);
    for (let i = 0; i < 10; i++) await usage.recordInvocation('cap_bad', false, 1);
    const dep = new AutoDeprecator(store, usage);
    const { toDeprecate } = await dep.evaluateAll();
    expect(toDeprecate).toContain('cap_bad');
  });

  it('deprecates to disabled for registered tools', async () => {
    const store = new InMemoryCapabilityStore();
    await store.insertCapability(tool('cap_x', 12));
    const dep = new AutoDeprecator(store, new UsageTracker(store));
    await dep.deprecate('cap_x', 'test');
    expect((await store.getCapability('cap_x'))?.status).toBe('disabled');
  });

  it('skips unused archive for tools younger than 7 days', async () => {
    const store = new InMemoryCapabilityStore();
    await store.insertCapability(tool('cap_new', 0, Date.now()));
    const dep = new AutoDeprecator(store, new UsageTracker(store));
    const { toArchive } = await dep.evaluateAll();
    expect(toArchive).not.toContain('cap_new');
  });

  it('archives unused tools older than 30 days and honors exclusions', async () => {
    const store = new InMemoryCapabilityStore();
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await store.insertCapability(tool('cap_old', 0, old));
    await store.insertCapability(tool('cap_keep', 0, old));
    const dep = new AutoDeprecator(store, new UsageTracker(store), new Set(['cap_keep']));
    const { toArchive } = await dep.evaluateAll();
    expect(toArchive).toContain('cap_old');
    expect(toArchive).not.toContain('cap_keep');
    const swept = await dep.sweep();
    expect(swept.archived).toContain('cap_old');
    expect((await store.getCapability('cap_old'))?.status).toBe('archived');
  });
});
