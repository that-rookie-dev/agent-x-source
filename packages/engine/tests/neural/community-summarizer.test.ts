import { describe, it, expect, vi } from 'vitest';
import { CommunitySummarizer } from '../../src/neural/CommunitySummarizer.js';
import type { MemoryFabric, MemoryNode } from '../../src/neural/MemoryFabric.js';
import type { GenerateFn } from '../../src/neural/MemoryExtractor.js';
import type { EmbeddingProvider } from '@agentx/shared';

function makeNode(id: string, label: string, communityId?: string): MemoryNode {
  return {
    id,
    label,
    category: 'semantic',
    content: `Content for ${label}`,
    status: 'active',
    x: 0,
    y: 0,
    layoutEpoch: 0,
    tag: null,
    isBenchmark: false,
    sourceId: null,
    sessionId: null,
    agentId: null,
    confidence: 0.8,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    communityId,
  } as MemoryNode;
}

function makeMockFabric(communities: Map<string, MemoryNode[]>): Pick<MemoryFabric, 'getCommunities' | 'getCommunityMembers' | 'createNode'> {
  return {
    getCommunities: vi.fn(async () =>
      Array.from(communities.entries()).map(([communityId, members]) => ({
        communityId,
        memberCount: members.length,
      })),
    ),
    getCommunityMembers: vi.fn(async (communityId: string, _limit?: number) =>
      communities.get(communityId) ?? [],
    ),
    createNode: vi.fn(async (_input: any) => ({ id: 'summary-' + Math.random().toString(36).slice(2) })),
  };
}

function makeMockGenerate(): GenerateFn {
  return vi.fn(async (prompt: string) => {
    if (prompt.includes('Community')) return `Summary for community: ${prompt.slice(0, 50)}...`;
    return 'Generic summary';
  }) as any;
}

function makeMockEmbedder(): EmbeddingProvider {
  return {
    embed: vi.fn(async (_text: string) => new Array(1024).fill(0)),
    embedBatch: vi.fn(async (texts: string[]) => texts.map(() => new Array(1024).fill(0))),
    dimension: 1024,
  } as any;
}

describe('CommunitySummarizer', () => {
  it('skips communities smaller than minCommunitySize', async () => {
    const communities = new Map([
      ['c1', [makeNode('a', 'A'), makeNode('b', 'B')]], // size 2 — below default min of 3
    ]);
    const fabric = makeMockFabric(communities) as any;
    const summarizer = new CommunitySummarizer(fabric, makeMockGenerate(), makeMockEmbedder());

    const result = await summarizer.summarizeAll({ minCommunitySize: 3 });
    expect(result.summarized).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('summarizes communities with enough members', async () => {
    const communities = new Map([
      ['c1', [makeNode('a', 'Alpha'), makeNode('b', 'Beta'), makeNode('c', 'Gamma')]],
    ]);
    const fabric = makeMockFabric(communities) as any;
    const generate = makeMockGenerate();
    const embedder = makeMockEmbedder();
    const summarizer = new CommunitySummarizer(fabric, generate, embedder);

    const result = await summarizer.summarizeAll({ minCommunitySize: 3 });
    expect(result.summarized).toBe(1);
    expect(result.skipped).toBe(0);
    expect(fabric.createNode).toHaveBeenCalledTimes(1);
    const createdNode = (fabric.createNode as any).mock.calls[0][0];
    expect(createdNode.tag).toBe('community_summary');
    expect(createdNode.content).toContain('Summary for community');
    expect(embedder.embed).toHaveBeenCalledTimes(1);
  });

  it('handles multiple communities', async () => {
    const communities = new Map([
      ['c1', [makeNode('a', 'Alpha'), makeNode('b', 'Beta'), makeNode('c', 'Gamma')]],
      ['c2', [makeNode('d', 'Delta'), makeNode('e', 'Epsilon'), makeNode('f', 'Zeta')]],
    ]);
    const fabric = makeMockFabric(communities) as any;
    const summarizer = new CommunitySummarizer(fabric, makeMockGenerate(), makeMockEmbedder());

    const result = await summarizer.summarizeAll({ minCommunitySize: 3 });
    expect(result.summarized).toBe(2);
    expect(fabric.createNode).toHaveBeenCalledTimes(2);
  });

  it('handles LLM failures gracefully', async () => {
    const communities = new Map([
      ['c1', [makeNode('a', 'Alpha'), makeNode('b', 'Beta'), makeNode('c', 'Gamma')]],
    ]);
    const fabric = makeMockFabric(communities) as any;
    const failingGenerate = vi.fn(async () => { throw new Error('LLM unavailable'); }) as any;
    const summarizer = new CommunitySummarizer(fabric, failingGenerate, makeMockEmbedder());

    const result = await summarizer.summarizeAll({ minCommunitySize: 3 });
    expect(result.summarized).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('handles empty community list', async () => {
    const fabric = makeMockFabric(new Map()) as any;
    const summarizer = new CommunitySummarizer(fabric, makeMockGenerate(), makeMockEmbedder());

    const result = await summarizer.summarizeAll();
    expect(result.summarized).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
  });
});
