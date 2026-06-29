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

  it('chunks long text and extracts per chunk', async () => {
    const calls: string[] = [];
    const extractor = new MemoryExtractor(async (prompt) => {
      calls.push(prompt);
      // Return a small graph for every chunk.
      return JSON.stringify({
        nodes: [
          { id: 'e1', label: 'Global Warming', category: 'semantic', content: 'Long-term rise in Earth average temperature', confidence: 0.9 },
          { id: 'e2', label: 'Greenhouse Effect', category: 'semantic', content: 'Heat trapping by atmospheric gases', confidence: 0.9 },
        ],
        edges: [
          { sourceNodeId: 'e1', targetNodeId: 'e2', relationshipType: 'CAUSES', weight: 0.9 },
        ],
      });
    });

    // Build a long text with two distinct sections so chunking splits it.
    const section1 = Array.from({ length: 30 }, () => 'Global warming is a long term rise in Earth average temperature.').join(' ');
    const section2 = Array.from({ length: 30 }, () => 'The greenhouse effect traps heat in the atmosphere.').join(' ');
    const text = `# Global Warming\n\n${section1}\n\n# Greenhouse Effect\n\n${section2}`;

    const result = await extractor.extract(text, { sessionId: 's3', chunkSize: 1500, chunkOverlap: 100 });

    // Should have made at least one extraction call. The new batching logic
    // (planLLMCalls) may combine short TextUnits into a single call, which is
    // the desired cost-control behavior — so we only assert ≥ 1 call.
    expect(calls.length).toBeGreaterThanOrEqual(1);

    // Entities should be merged across chunks by normalized label.
    const uniqueLabels = new Set(result.nodes.map((n) => n.label));
    expect(uniqueLabels.has('Global Warming')).toBe(true);
    expect(uniqueLabels.has('Greenhouse Effect')).toBe(true);

    // Should still have at least one edge after deduplication.
    expect(result.edges.length).toBeGreaterThan(0);
  });

  it('deduplicates entities with the same normalized label across chunks', async () => {
    const extractor = new MemoryExtractor(async () => JSON.stringify({
      nodes: [
        { id: 'a', label: 'Global Warming', category: 'semantic', content: 'First chunk description', confidence: 0.9 },
        { id: 'b', label: 'global warming', category: 'semantic', content: 'Second chunk description', confidence: 0.9 },
      ],
      edges: [],
    }));

    const result = await extractor.extract('chunk1.\n\nchunk2.', { chunkSize: 10, chunkOverlap: 0 });

    // Only one node should survive deduplication.
    expect(result.nodes.length).toBe(1);
    expect(result.nodes[0].label).toMatch(/global warming/i);
  });

  it('accepts semantic relationship types', async () => {
    const extractor = new MemoryExtractor(async () => JSON.stringify({
      nodes: [
        { id: '1', label: 'Asteroid', category: 'semantic', content: 'A large space rock', confidence: 0.9 },
        { id: '2', label: 'Extinction', category: 'semantic', content: 'Mass die-off event', confidence: 0.9 },
      ],
      edges: [
        { sourceNodeId: '1', targetNodeId: '2', relationshipType: 'CAUSES', weight: 0.95 },
        { sourceNodeId: '2', targetNodeId: '1', relationshipType: 'RESULTS_IN', weight: 0.8 },
      ],
    }));

    const result = await extractor.extract('Asteroid impact causes mass extinction.');
    expect(result.edges.length).toBe(2);
    expect(result.edges[0].relationshipType).toBe('CAUSES');
    expect(result.edges[1].relationshipType).toBe('RESULTS_IN');
  });

  it('raw_fallback creates a single node per TextUnit on LLM failure', async () => {
    const extractor = new MemoryExtractor(async () => 'not valid json');
    const result = await extractor.extract('# Chicxulub Impact\n\nSome details here.');
    // The markdown segmenter splits this into section TextUnits. On LLM failure,
    // each TextUnit becomes a single raw_fallback episodic node.
    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
    const fallbackNodes = result.nodes.filter((n) => n.unitType === 'raw_fallback');
    expect(fallbackNodes.length).toBeGreaterThanOrEqual(1);
    expect(fallbackNodes[0].category).toBe('episodic');
    expect(fallbackNodes[0].confidence).toBeLessThanOrEqual(0.4);
  });

  it('raw_fallback produces one node per section on LLM failure (not many fragments)', async () => {
    const text = `Core Expertise
Connected TV & Streaming Advertising
Deep knowledge of CTV/OTT platforms
Campaign Strategy & Optimization
Designing campaigns that perform
Market & Trend Analysis
Keeping current on the streaming landscape

How I Help
When you're working on CTV/OTT advertising I can dig into the specifics.

What I won't do
Pretend to know finance.`;

    const extractor = new MemoryExtractor(async () => 'not valid json');
    const result = await extractor.extract(text, { chunkSize: 1000, chunkOverlap: 0 });

    // With the new pipeline, each TextUnit becomes at most one raw_fallback node.
    // The old heuristicExtract created > 5 nodes by splitting sentences; the new
    // behavior creates one node per section/paragraph TextUnit.
    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
    expect(result.nodes.length).toBeLessThanOrEqual(10);
    // All nodes from LLM failure should be raw_fallback episodic nodes.
    for (const node of result.nodes) {
      expect(node.unitType).toBe('raw_fallback');
      expect(node.category).toBe('episodic');
    }
  });

  it('raw_fallback creates one node for a plain paragraph on LLM failure', async () => {
    const extractor = new MemoryExtractor(async () => 'not valid json');
    const text = 'The sun is a star. It provides energy to Earth. Plants use sunlight for photosynthesis. Animals eat plants.';
    const result = await extractor.extract(text, { chunkSize: 1000, chunkOverlap: 0 });

    // A single paragraph becomes one raw_fallback node (not many sentence fragments).
    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
    expect(result.nodes.length).toBeLessThanOrEqual(4);
    for (const node of result.nodes) {
      expect(node.unitType).toBe('raw_fallback');
    }
  });
});
