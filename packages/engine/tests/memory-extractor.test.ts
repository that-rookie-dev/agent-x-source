import { describe, it, expect } from 'vitest';
import { MemoryExtractor } from '../src/neural/MemoryExtractor.js';

describe('MemoryExtractor', () => {
  it('parses valid JSON extraction output', async () => {
    const extractor = new MemoryExtractor(async () => JSON.stringify({
      nodes: [
        { label: 'Fact A', category: 'semantic', content: 'A is important', confidence: 0.9 },
        { label: 'Fact B', category: 'semantic', content: 'B depends on A', confidence: 0.8 },
      ],
      edges: [
        { sourceNodeId: '1', targetNodeId: '2', relationshipType: 'REQUIRES', weight: 0.75 },
      ],
    }));
    const result = await extractor.extract('A is important. B depends on A.', { sessionId: 's1' });
    expect(result.nodes.length).toBe(2);
    expect(result.nodes[0].sessionId).toBe('s1');
  });

  it('falls back to a single node on invalid JSON', async () => {
    const extractor = new MemoryExtractor(async () => 'not valid json');
    const result = await extractor.extract('Some text to remember.', { sessionId: 's2', agentId: 'a1' });
    expect(result.nodes.length).toBe(1);
    expect(result.nodes[0].content).toBe('Some text to remember.');
    expect(result.nodes[0].sessionId).toBe('s2');
    expect(result.nodes[0].agentId).toBe('a1');
  });

  it('strips markdown fences from LLM output', async () => {
    const extractor = new MemoryExtractor(async () => "```json\n{\"nodes\":[{\"label\":\"X\",\"category\":\"semantic\",\"content\":\"Y\",\"confidence\":0.9}],\"edges\":[]}\n```");
    const result = await extractor.extract('X means Y.');
    expect(result.nodes.length).toBe(1);
    expect(result.nodes[0].label).toBe('X');
  });
});
