import { describe, it, expect } from 'vitest';
import { MemoryExtractor } from '../../src/neural/MemoryExtractor.js';
import { validateAndFilter } from '../../src/neural/NodeValidator.js';
import { CORPUS, runCorpusAgainstExtractor, assertCorpusPassed, type CorpusResult } from './regression-corpus.js';

/**
 * Baseline test: run the current MemoryExtractor against the regression corpus
 * with the NodeValidator gate applied. This establishes which corpus items
 * pass/fail today and guards against future regressions.
 *
 * The extractor uses a deterministic mock LLM that returns a small valid graph
 * for any input. This tests the validation + extraction plumbing, not LLM
 * quality (which is Phase 2's concern).
 */
function makeMockExtractor(): MemoryExtractor {
  // Mock LLM: returns 1-3 nodes depending on input length, always valid.
  return new MemoryExtractor(async (prompt: string) => {
    // Extract a rough sense of input size from the prompt.
    const inputMatch = prompt.match(/"""([\s\S]+?)"""$/);
    const inputText = inputMatch?.[1] ?? '';
    const words = inputText.split(/\s+/).filter(Boolean).length;
    const nodeCount = words < 5 ? 1 : words < 50 ? 2 : 3;

    const nodes = Array.from({ length: nodeCount }, (_, i) => ({
      id: `e${i + 1}`,
      label: `Concept ${i + 1}`,
      category: 'semantic' as const,
      content: `Extracted concept ${i + 1} from the input text with sufficient detail to pass validation.`,
      confidence: 0.8,
    }));
    const edges = nodeCount > 1
      ? [{ sourceNodeId: 'e1', targetNodeId: 'e2', relationshipType: 'RELATED_TO' as const, weight: 0.5 }]
      : [];
    return JSON.stringify({ nodes, edges });
  });
}

describe('Regression corpus — MemoryExtractor + NodeValidator baseline', () => {
  it('every corpus item produces nodes within golden range and zero forbidden labels', async () => {
    const extractor = makeMockExtractor();
    const results = await runCorpusAgainstExtractor(async (text, _kind) => {
      const extracted = await extractor.extract(text, { category: 'semantic' });
      const { nodes } = validateAndFilter(extracted.nodes, extracted.edges);
      return nodes;
    });

    // With the mock LLM + validator, every item should pass.
    // If any fail, this prints a full report of which items and why.
    assertCorpusPassed(results);
  }, 30000);

  it('corpus has at least 20 chat turns and 5 markdown docs', () => {
    const chatTurns = CORPUS.filter((c) => c.kind === 'chat_turn');
    const docs = CORPUS.filter((c) => c.kind === 'markdown_doc');
    expect(chatTurns.length).toBeGreaterThanOrEqual(20);
    expect(docs.length).toBeGreaterThanOrEqual(5);
  });

  it('every corpus item has a finite golden node range', () => {
    for (const item of CORPUS) {
      expect(item.expectedNodes.min).toBeGreaterThanOrEqual(0);
      expect(item.expectedNodes.max).toBeGreaterThan(item.expectedNodes.min);
      expect(item.expectedNodes.max).toBeLessThanOrEqual(30);
    }
  });

  it('divider-laden chat turn produces zero nodes with forbidden labels', async () => {
    const extractor = makeMockExtractor();
    const item = CORPUS.find((c) => c.id === 'chat.divider-laden')!;
    const extracted = await extractor.extract(item.text, { category: 'semantic' });
    const { nodes } = validateAndFilter(extracted.nodes, extracted.edges);
    for (const node of nodes) {
      expect(node.label).not.toBe('---');
      expect(node.label).not.toBe('***');
      expect(node.label).not.toBe('___');
    }
  });

  it('heading-only chat turn does not produce a heading-only node', async () => {
    const extractor = makeMockExtractor();
    const item = CORPUS.find((c) => c.id === 'chat.heading-only')!;
    const extracted = await extractor.extract(item.text, { category: 'semantic' });
    const { nodes } = validateAndFilter(extracted.nodes, extracted.edges);
    for (const node of nodes) {
      // No node should be just "## Notes" or "Notes" with heading-only content.
      expect(node.label).not.toBe('## Notes');
    }
  });
});
