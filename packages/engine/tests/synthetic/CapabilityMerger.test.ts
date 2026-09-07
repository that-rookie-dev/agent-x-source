import { describe, it, expect } from 'vitest';
import { CapabilityMerger } from '../../src/synthetic/CapabilityMerger.js';
import { InMemoryCapabilityStore } from '../../src/synthetic/InMemoryCapabilityStore.js';
import type { SkillCapability } from '@agentx/shared';

const now = Date.now();
function skill(id: string, name: string, description: string): SkillCapability {
  return {
    id, kind: 'skill', name, description, createdAt: now, updatedAt: now,
    createdBy: 't', sourceSessionId: '', version: 1, origin: 'user-prompt', status: 'registered',
    useCount: 0, trialCount: 0, promptTemplate: description, triggerPattern: name, exampleCalls: [],
  };
}

describe('CapabilityMerger', () => {
  it('finds overlapping skills by token similarity', async () => {
    const store = new InMemoryCapabilityStore();
    await store.insertCapability(skill('a', 'meeting-summary', 'summarize meeting notes into action items'));
    await store.insertCapability(skill('b', 'meeting-notes-summary', 'summarize meeting notes into action items'));
    const merger = new CapabilityMerger(store);
    const pairs = await merger.findOverlapping(0.4);
    expect(pairs.length).toBeGreaterThan(0);
  });

  it('proposes a merged skill with combined properties', async () => {
    const store = new InMemoryCapabilityStore();
    await store.insertCapability(skill('a', 'alpha-notes', 'format meeting notes'));
    await store.insertCapability(skill('b', 'beta-notes', 'summarize meeting notes'));
    const merger = new CapabilityMerger(store);
    const merged = await merger.proposeMerge('a', 'b');
    expect(merged.kind).toBe('skill');
    expect(merged.status).toBe('proposed');
    expect(merged.mergedFrom).toEqual(['a', 'b']);
    expect(merged.promptTemplate).toContain('format meeting notes');
    expect(merged.promptTemplate).toContain('summarize meeting notes');
    expect((await store.getCapability(merged.id))?.status).toBe('proposed');
  });

  it('proposes a merged tool with combined input/output schemas', async () => {
    const now = Date.now();
    const a = {
      ...skill('a', 'csv-tool', 'parse csv'),
      kind: 'tool' as const,
      language: 'javascript' as const,
      sourceCode: 'function run(args){ return args.csv; }',
      entryPoint: 'run',
      inputSchema: { csv: { type: 'string' } },
      outputSchema: { type: 'string' },
      dependencies: ['csv'],
      sideEffects: [],
      approvedSideEffects: [],
      sandboxResult: null,
    };
    const b = {
      ...skill('b', 'json-tool', 'parse json'),
      kind: 'tool' as const,
      language: 'javascript' as const,
      sourceCode: 'function run(args){ return args.json; }',
      entryPoint: 'run',
      inputSchema: { json: { type: 'string' } },
      outputSchema: { type: 'object' },
      dependencies: ['json'],
      sideEffects: [],
      approvedSideEffects: [],
      sandboxResult: null,
    };
    const store = new InMemoryCapabilityStore();
    await store.insertCapability(a as never);
    await store.insertCapability(b as never);
    const merger = new CapabilityMerger(store);
    const merged = await merger.proposeMerge('a', 'b');
    expect(merged.kind).toBe('tool');
    expect(merged.mergedFrom).toEqual(['a', 'b']);
    expect((merged as any).inputSchema).toHaveProperty('json');
    expect((merged as any).inputSchema).toHaveProperty('csv');
    expect((merged as any).inputSchema.json).toEqual({ type: 'string' });
    await merger.executeMerge('a', 'b', merged.id);
    expect((await store.getCapability('a'))?.status).toBe('archived');
    expect((await store.getCapability(merged.id))?.status).toBe('registered');
  });

  it('archives originals when executing a merge', async () => {
    const store = new InMemoryCapabilityStore();
    await store.insertCapability(skill('a', 'alpha-notes', 'format meeting notes'));
    await store.insertCapability(skill('b', 'beta-notes', 'format meeting notes'));
    const merger = new CapabilityMerger(store);
    const merged = await merger.proposeMerge('a', 'b');
    await merger.executeMerge('a', 'b', merged.id);
    expect((await store.getCapability('a'))?.status).toBe('archived');
    expect((await store.getCapability(merged.id))?.status).toBe('registered');
  });
});
