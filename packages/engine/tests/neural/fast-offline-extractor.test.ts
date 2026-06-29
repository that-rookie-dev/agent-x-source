import { describe, it, expect } from 'vitest';
import { fastOfflineExtract } from '../../src/neural/FastOfflineExtractor.js';

describe('FastOfflineExtractor', () => {
  it('uses fast path for short simple text with entities', () => {
    const result = fastOfflineExtract('Hello John, how are you?', { sessionId: 's1' });
    expect(result.usedFastPath).toBe(true);
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('falls back to LLM for short text with no entities', () => {
    const result = fastOfflineExtract('Hello world, how are you?', { sessionId: 's1' });
    expect(result.usedFastPath).toBe(false);
  });

  it('falls back to LLM for markdown with headings', () => {
    const result = fastOfflineExtract('# Title\n\nSome content here.');
    expect(result.usedFastPath).toBe(false);
  });

  it('falls back to LLM for code blocks', () => {
    const result = fastOfflineExtract('Here is code:\n```js\nconst x = 1;\n```\nDone.');
    expect(result.usedFastPath).toBe(false);
  });

  it('falls back to LLM for very long text', () => {
    const longText = 'word '.repeat(200);
    const result = fastOfflineExtract(longText);
    expect(result.usedFastPath).toBe(false);
  });

  it('falls back to LLM for too many sentences', () => {
    const text = Array.from({ length: 10 }, (_, i) => `Sentence ${i + 1}.`).join(' ');
    const result = fastOfflineExtract(text, { maxSentences: 5 });
    expect(result.usedFastPath).toBe(false);
  });

  it('extracts proper nouns from simple text', () => {
    const result = fastOfflineExtract('John Smith went to the store yesterday.', { sessionId: 's1' });
    expect(result.usedFastPath).toBe(true);
    const labels = result.nodes.map((n) => n.label);
    expect(labels.some((l) => /John Smith/i.test(l))).toBe(true);
  });

  it('extracts numbers from simple text', () => {
    const result = fastOfflineExtract('The price is 42 dollars and 50 cents.', { sessionId: 's1' });
    expect(result.usedFastPath).toBe(true);
    const labels = result.nodes.map((n) => n.label);
    expect(labels.some((l) => /42/.test(l))).toBe(true);
  });

  it('extracts dates from simple text', () => {
    const result = fastOfflineExtract('The event happened in 2023 and was great.', { sessionId: 's1' });
    expect(result.usedFastPath).toBe(true);
    const labels = result.nodes.map((n) => n.label);
    expect(labels.some((l) => /2023/.test(l))).toBe(true);
  });

  it('extracts URLs from simple text', () => {
    const result = fastOfflineExtract('Check out https://example.com for more info.', { sessionId: 's1' });
    expect(result.usedFastPath).toBe(true);
    const labels = result.nodes.map((n) => n.label);
    expect(labels.some((l) => /example\.com/.test(l))).toBe(true);
  });

  it('falls back to LLM when no entities are found', () => {
    const result = fastOfflineExtract('hello there', { sessionId: 's1' });
    expect(result.usedFastPath).toBe(false);
    expect(result.nodes.length).toBe(0);
  });

  it('attaches provenance to extracted nodes', () => {
    const result = fastOfflineExtract('John Smith was born in 1990.', { sessionId: 's1', agentId: 'a1', sourceId: 'doc1' });
    expect(result.usedFastPath).toBe(true);
    for (const node of result.nodes) {
      expect(node.sessionId).toBe('s1');
      expect(node.agentId).toBe('a1');
      expect(node.sourceId).toBe('doc1');
    }
  });

  it('links nodes from the same unit with RELATED_TO edges', () => {
    const result = fastOfflineExtract('John Smith met Jane Doe in 2020.', { sessionId: 's1' });
    expect(result.usedFastPath).toBe(true);
    if (result.nodes.length > 1) {
      expect(result.edges.length).toBeGreaterThan(0);
      expect(result.edges.every((e) => e.relationshipType === 'RELATED_TO')).toBe(true);
      expect(result.edges.every((e) => e.extractionMethod === 'INFERRED')).toBe(true);
    }
  });

  it('handles empty text', () => {
    const result = fastOfflineExtract('');
    expect(result.usedFastPath).toBe(false);
    expect(result.nodes.length).toBe(0);
  });

  it('skips sentence-initial single capitalized words (common nouns)', () => {
    // "The cat sat on the mat." has no extractable entities → falls back to LLM.
    const result = fastOfflineExtract('The cat sat on the mat.', { sessionId: 's1' });
    expect(result.usedFastPath).toBe(false);
  });
});
