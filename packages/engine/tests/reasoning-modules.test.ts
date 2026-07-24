import { describe, it, expect } from 'vitest';
import type { Agent } from '../src/agent/Agent.js';

describe('TreeOfThoughts', () => {
  it('module exports correctly', async () => {
    const { TreeOfThoughts } = await import('../src/reasoning/TreeOfThoughts.js');
    expect(TreeOfThoughts).toBeDefined();
    expect(typeof TreeOfThoughts).toBe('function');
  });
});

describe('ResearchEngine', () => {
  it('module exports correctly', async () => {
    const { ResearchEngine } = await import('../src/reasoning/ResearchEngine.js');
    expect(ResearchEngine).toBeDefined();
    expect(typeof ResearchEngine).toBe('function');
  }, 20_000);
});
