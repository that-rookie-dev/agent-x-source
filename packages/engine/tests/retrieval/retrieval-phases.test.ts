import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mergeRrf,
  getRetrievalSettings,
  setRetrievalOverrides,
  resetRetrievalOverrides,
  expandEvidenceNeighborhood,
  resolveEmbedTextForNode,
  buildEmbedText,
  applyScoreGate,
  heuristicRerank,
  packEvidenceBlocks,
  toEvidenceUnit,
  EMPTY_EVIDENCE_MARKER,
  RETRIEVAL_DEFAULTS,
} from '../../src/neural/retrieval/index.js';
import type { MemoryFabric, MemoryNode } from '../../src/neural/MemoryFabric.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Phase 5 — mergeRrf hybrid fusion', () => {
  it('promotes items present in both lists', () => {
    const vector = [
      { id: 'a', content: 'alpha', distance: 0.1 },
      { id: 'b', content: 'beta', distance: 0.2 },
      { id: 'c', content: 'gamma', distance: 0.3 },
    ];
    const lexical = [
      { id: 'c', content: 'gamma', score: 0.9 },
      { id: 'a', content: 'alpha', score: 0.8 },
      { id: 'd', content: 'delta', score: 0.7 },
    ];
    const merged = mergeRrf(vector, lexical, { limit: 3 });
    // a = vec#1 + lex#2; c = vec#3 + lex#1 → a wins RRF
    expect(merged[0]!.id).toBe('a');
    expect(merged.map((m) => m.id)).toContain('c');
    expect(merged).toHaveLength(3);
  });

  it('returns vector-only order when lexical empty', () => {
    const vector = [
      { id: 'a', content: 'a', distance: 0.1 },
      { id: 'b', content: 'b', distance: 0.2 },
    ];
    const merged = mergeRrf(vector, [], { limit: 2 });
    expect(merged.map((m) => m.id)).toEqual(['a', 'b']);
  });
});

describe('Phase 9 — expandEvidenceNeighborhood', () => {
  afterEach(() => resetRetrievalOverrides());

  it('adds depth-1 FOLLOWS neighbors and respects order mode types', async () => {
    const hits: MemoryNode[] = [
      {
        id: 'h1',
        label: 'c1',
        category: 'source_doc',
        content: 'JWT tokens are required for all API routes in production.',
        status: 'active',
        distance: 0.15,
      } as MemoryNode,
    ];
    const neighbor: MemoryNode = {
      id: 'n1',
      label: 'c2',
      category: 'source_doc',
      content: 'Refresh tokens rotate every 24 hours under the Auth section.',
      status: 'active',
      distance: 0.2,
    } as MemoryNode;

    const fabric = {
      graphWalk: vi.fn(async () => ({
        nodeIds: ['h1', 'n1'],
        edges: [{ sourceNodeId: 'h1', targetNodeId: 'n1', relationshipType: 'FOLLOWS', weight: 0.4 }],
      })),
      getNodesByIds: vi.fn(async () => [neighbor]),
    } as unknown as MemoryFabric;

    setRetrievalOverrides({ graphExpandOnlyOnTopHits: 2, graphExpandDepth: 1 });
    const out = await expandEvidenceNeighborhood(fabric, hits, { mode: 'order', minScore: 0.3 });
    expect(fabric.graphWalk).toHaveBeenCalledWith(
      expect.objectContaining({
        startNodeIds: ['h1'],
        maxDepth: 1,
        relationshipTypes: expect.arrayContaining(['FOLLOWS', 'NEXT_STEP']),
      }),
    );
    expect(out.map((n) => n.id)).toEqual(['h1', 'n1']);
  });
});

describe('Phase 10/settings — overrides', () => {
  beforeEach(() => resetRetrievalOverrides());
  afterEach(() => resetRetrievalOverrides());

  it('merges config overrides without leaving defaults unwired', () => {
    expect(getRetrievalSettings().hybridEnabled).toBe(true);
    setRetrievalOverrides({ hybridEnabled: false, minScoreKb: 0.55 });
    const s = getRetrievalSettings();
    expect(s.hybridEnabled).toBe(false);
    expect(s.minScoreKb).toBe(0.55);
    expect(s.minScoreMemory).toBe(RETRIEVAL_DEFAULTS.minScoreMemory);
  });
});

describe('Phase 13 — resolveEmbedTextForNode', () => {
  it('prefers provenance.embedText over raw content', () => {
    const text = resolveEmbedTextForNode({
      content: 'body only',
      provenance: { embedText: 'Guide › Auth\n\nbody only', sourceName: 'Guide' },
    });
    expect(text).toContain('Guide › Auth');
  });

  it('rebuilds from heading path when embedText missing', () => {
    const text = resolveEmbedTextForNode({
      content: 'Tokens expire in 1h.',
      label: 'chunk',
      headingPath: ['## Auth'],
      provenance: { sourceName: 'API' },
    });
    expect(text).toBe(buildEmbedText({ title: 'API', headingPath: ['## Auth'], body: 'Tokens expire in 1h.' }));
  });
});

describe('Phase 12 — golden fixture + gate smoke', () => {
  it('loads golden queries (30) and validates schema', () => {
    const raw = JSON.parse(
      readFileSync(join(__dirname, 'fixtures/golden-queries.json'), 'utf8'),
    ) as { version: number; queries: Array<{ id: string; expect: string; query: string }> };
    expect(raw.version).toBe(1);
    expect(raw.queries).toHaveLength(30);
    expect(raw.queries.every((q) => q.id && q.query && q.expect)).toBe(true);
    const abstain = raw.queries.filter((q) => q.expect === 'abstain');
    expect(abstain.length).toBeGreaterThanOrEqual(4);
  });

  it('T5: weak-only candidates produce empty pack + empty marker path', () => {
    const weak = applyScoreGate(
      [{ id: 'w', content: 'noise', distance: 0.85 }],
      { minScore: RETRIEVAL_DEFAULTS.minScoreKb },
    );
    expect(weak).toHaveLength(0);
    expect(EMPTY_EVIDENCE_MARKER).toContain('none above confidence');
  });

  it('T4-ish: heuristic rerank surfaces exact code over closer vector miss', () => {
    const ranked = heuristicRerank('ERR_AUTH_401', [
      { id: 'near', content: 'unrelated auth philosophy', distance: 0.18 },
      { id: 'hit', content: 'Throws ERR_AUTH_401 when token missing', distance: 0.4 },
    ]);
    expect(ranked[0]!.id).toBe('hit');
  });

  it('T10: packer respects compact budget', () => {
    const units = Array.from({ length: 8 }, (_, i) =>
      toEvidenceUnit({
        id: `id-${i}`,
        label: `c${i}`,
        category: 'source_doc',
        content: 'x'.repeat(400),
        distance: 0.1,
        provenance: { sourceName: 'Doc' },
      }, i)!,
    );
    const packed = packEvidenceBlocks(units, { maxChars: 900, maxLineChars: 500 });
    expect(packed.charsUsed).toBeLessThanOrEqual(900);
    expect(packed.count).toBeGreaterThan(0);
    expect(packed.count).toBeLessThan(8);
  });
});
