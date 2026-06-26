import { describe, expect, it } from 'vitest';
import {
  attachDeepSearchPartsFromTools,
  orderPartsForChatRender,
  partitionPartsForRender,
  upsertDeepSearchPart,
} from '../src/utils/deep-search-parts.js';
import type { MessagePart } from '../src/utils/message-parts.js';

const sampleBundle = {
  query: 'test',
  depth: 'standard' as const,
  plan: { subQueries: [], intent: ['article'] },
  stats: { searched: 1, fetched: 1, kept: 1, ms: 100 },
  results: [],
  summary: 'done',
};

describe('deep-search-parts', () => {
  it('upsertDeepSearchPart keeps deep_search parts at the end', () => {
    const parts: MessagePart[] = [
      { type: 'text', id: 't1', content: 'answer' },
      { type: 'tool', id: 'c1', tool: { id: 'c1', name: 'deep_web_search', status: 'done' } },
    ];
    const next = upsertDeepSearchPart(parts, { toolCallId: 'c1', bundle: sampleBundle, running: false });
    expect(next[next.length - 1]?.type).toBe('deep_search');
    expect(next[0]?.type).toBe('text');
  });

  it('orderPartsForChatRender places deep search after tools and before text', () => {
    const parts = [
      { type: 'tool', id: 't1' },
      { type: 'tool', id: 't2' },
      { type: 'text', id: 'a1' },
      { type: 'deep_search', id: 'c1', deepSearch: { bundle: sampleBundle } },
    ] as MessagePart[];
    const ordered = orderPartsForChatRender(parts);
    expect(ordered.map((p) => p.type)).toEqual(['tool', 'tool', 'deep_search', 'text']);
  });

  it('orderPartsForChatRender places deep search before text when no tools exist', () => {
    const parts = [
      { type: 'text', id: 'a1' },
      { type: 'deep_search', id: 'c1', deepSearch: { bundle: sampleBundle } },
    ] as MessagePart[];
    const ordered = orderPartsForChatRender(parts);
    expect(ordered.map((p) => p.type)).toEqual(['deep_search', 'text']);
  });

  it('partitionPartsForRender separates deep search blocks', () => {
    const parts = [
      { type: 'text', id: 't1' },
      { type: 'deep_search', id: 'c1', deepSearch: { bundle: sampleBundle } },
      { type: 'tool', id: 'x' },
    ] as MessagePart[];
    const { main, deepSearch } = partitionPartsForRender(parts);
    expect(main).toHaveLength(2);
    expect(deepSearch).toHaveLength(1);
  });

  it('attachDeepSearchPartsFromTools lifts bundle metadata from tools', () => {
    const parts: MessagePart[] = [
      { type: 'text', id: 't1', content: 'hi' },
      {
        type: 'tool',
        id: 'c1',
        tool: {
          id: 'c1',
          name: 'deep_web_search',
          status: 'done',
          metadata: { deepSearch: sampleBundle },
        },
      },
    ];
    const next = attachDeepSearchPartsFromTools(parts);
    expect(next.some((p) => p.type === 'deep_search' && p.deepSearch?.bundle?.query === 'test')).toBe(true);
  });

  it('attachDeepSearchPartsFromTools keeps distinct bundles for parallel deep searches', () => {
    const bundleA = { ...sampleBundle, query: 'query-a' };
    const bundleB = { ...sampleBundle, query: 'query-b' };
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 'c1',
        tool: { id: 'c1', name: 'deep_web_search', status: 'done', metadata: { deepSearch: bundleA } },
      },
      {
        type: 'tool',
        id: 'c2',
        tool: { id: 'c2', name: 'deep_web_search', status: 'done', metadata: { deepSearch: bundleB } },
      },
    ];
    const next = attachDeepSearchPartsFromTools(parts);
    const deep = next.filter((p) => p.type === 'deep_search');
    expect(deep).toHaveLength(2);
    expect(deep.map((p) => p.deepSearch?.bundle?.query).sort()).toEqual(['query-a', 'query-b']);
  });
});
