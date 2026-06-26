import { describe, expect, it } from 'vitest';
import { applyToolCompleteMetadata, reconcileStreamingMessageParts } from '../src/chat/utils';

describe('deep search metadata scoping', () => {
  it('applyToolCompleteMetadata only updates the matching call id', () => {
    const meta = { deepSearch: { query: 'latest', results: [] } };
    const tools = [
      { id: 'c1', name: 'deep_web_search', status: 'done', metadata: { deepSearch: { query: 'first', results: [] } } },
      { id: 'c2', name: 'deep_web_search', status: 'done', metadata: { deepSearch: { query: 'second', results: [] } } },
    ];

    const next = tools.map((t) => applyToolCompleteMetadata(t, meta, 'c2', 'deep_web_search'));

    expect(next[0]?.metadata?.deepSearch).toEqual({ query: 'first', results: [] });
    expect(next[1]?.metadata?.deepSearch).toEqual({ query: 'latest', results: [] });
  });

  it('reconcileStreamingMessageParts rebuilds one deep_search block per tool', () => {
    const parts = [
      {
        type: 'tool',
        id: 'c1',
        tool: {
          id: 'c1',
          name: 'deep_web_search',
          status: 'done',
          metadata: { deepSearch: { query: 'alpha', depth: 'standard', plan: { subQueries: [], intent: [] }, stats: { searched: 1, fetched: 1, kept: 1, ms: 1 }, results: [], summary: '' } },
        },
      },
      {
        type: 'tool',
        id: 'c2',
        tool: {
          id: 'c2',
          name: 'deep_web_search',
          status: 'done',
          metadata: { deepSearch: { query: 'beta', depth: 'standard', plan: { subQueries: [], intent: [] }, stats: { searched: 1, fetched: 1, kept: 1, ms: 1 }, results: [], summary: '' } },
        },
      },
    ] as const;

    const reconciled = reconcileStreamingMessageParts([...parts], undefined, undefined);
    const deep = reconciled?.filter((p) => p.type === 'deep_search') ?? [];

    expect(deep).toHaveLength(2);
    expect(deep.map((p) => p.deepSearch?.bundle?.query).sort()).toEqual(['alpha', 'beta']);
  });
});
