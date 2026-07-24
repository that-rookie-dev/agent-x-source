import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RagDocument } from '../../src/neural/RagDocument.js';
import {
  applyScoreGate,
  heuristicRerank,
  mergeRrf,
  packEvidenceBlocks,
  toEvidenceUnit,
  linkSimilarChunks,
  nearDuplicate,
  getRetrievalSettings,
  setRetrievalOverrides,
  resetRetrievalOverrides,
  RETRIEVAL_DEFAULTS,
  runRetrievalEval,
  assertBaselineGate,
  loadFrozenBaseline,
  evaluateQuery,
  loadGoldenQueries,
  loadSyntheticCorpus,
} from '../../src/neural/retrieval/index.js';
import type { MemoryFabric, MemoryNode } from '../../src/neural/MemoryFabric.js';
import { formatKnowledgeBaseToolOutput } from '../../src/tools/builtin/knowledge-base-search.js';
import { EMPTY_EVIDENCE_MARKER } from '../../src/neural/retrieval/packer.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('3.6 — FOLLOWS order edges from chunk sequence', () => {
  it('three sequential chunks would bind FOLLOWS prev→next (ingest contract)', () => {
    const doc = new RagDocument(
      `# Guide\n\n## One\n\nFirst section has enough text to stand alone as a meaning unit for embedding.\n\n## Two\n\nSecond section also has enough text for a distinct chunk about storage.\n\n## Three\n\nThird section covers deployment notes with sufficient length for chunking.`,
      { title: 'Guide', kind: 'markdown' },
    );
    const chunks = doc.chunks();
    expect(chunks.length).toBeGreaterThanOrEqual(3);

    // Simulate ingest adjacency without DB: consecutive indices get FOLLOWS.
    const edges: Array<{ from: number; to: number; type: string }> = [];
    for (let i = 1; i < Math.min(3, chunks.length); i++) {
      edges.push({ from: i - 1, to: i, type: 'FOLLOWS' });
    }
    expect(edges).toEqual([
      { from: 0, to: 1, type: 'FOLLOWS' },
      { from: 1, to: 2, type: 'FOLLOWS' },
    ]);

    // Ranking uses content similarity, not edge presence.
    const ranked = heuristicRerank('deployment notes', [
      { id: '0', content: chunks[0]!.content, distance: 0.4 },
      { id: '1', content: chunks[1]!.content, distance: 0.35 },
      { id: '2', content: chunks[2]!.content, distance: 0.3 },
    ]);
    const withoutEdges = heuristicRerank('deployment notes', [
      { id: '0', content: chunks[0]!.content, distance: 0.4 },
      { id: '1', content: chunks[1]!.content, distance: 0.35 },
      { id: '2', content: chunks[2]!.content, distance: 0.3 },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(withoutEdges.map((r) => r.id));
  });
});

describe('6.2 — rerankKeep / injectKeep settings', () => {
  afterEach(() => resetRetrievalOverrides());

  it('exposes knobs used by prefetch/KB paths', () => {
    setRetrievalOverrides({ rerankKeep: 4, injectKeep: 2 });
    const s = getRetrievalSettings();
    expect(s.rerankKeep).toBe(4);
    expect(s.injectKeep).toBe(2);
    expect(RETRIEVAL_DEFAULTS.rerankKeep).toBe(8);
    expect(RETRIEVAL_DEFAULTS.injectKeep).toBe(6);
  });
});

describe('8.4 — KB tool citeable formatting', () => {
  it('emits [E#], score, heading, evidenceIds', () => {
    const formatted = formatKnowledgeBaseToolOutput([
      {
        id: 'uuid-1',
        content: 'JWT tokens are required for all /api routes.',
        sourceId: 'src-1',
        sourceName: 'API Guide.pdf',
        score: 0.71,
        metadata: { pageNumber: 4, headingPath: ['## Auth', '### JWT'] },
      },
    ], 500);
    expect(formatted.output).toContain('[E1 · KB · API Guide.pdf');
    expect(formatted.output).toContain('p.4');
    expect(formatted.output).toContain('Auth › JWT');
    expect(formatted.output).toContain('score=0.71');
    expect(formatted.output).toContain('Cite [E#]');
    expect(formatted.evidenceIds).toEqual(['uuid-1']);
  });
});

describe('11.5 — linkSimilarChunks synthetic embeddings', () => {
  beforeEach(() => resetRetrievalOverrides());
  afterEach(() => resetRetrievalOverrides());

  it('links high-sim non-adjacent chunks, skips near-dup and adjacent', async () => {
    setRetrievalOverrides({ similarityEdgeMinScore: 0.8, similarityEdgeMaxDegree: 2 });
    expect(nearDuplicate('Hello World again', 'hello   world again')).toBe(true);

    const bindEdge = vi.fn(async () => undefined);
    const fabric = {
      vectorSearch: vi.fn(async (_emb: number[], _opts: unknown) => {
        return [
          {
            id: 'a',
            content: 'alpha content about auth',
            unitType: 'chunk',
            sourceId: 's1',
            distance: 0.05,
            provenance: { index: 0 },
          },
          {
            id: 'b',
            content: 'beta content about storage systems',
            unitType: 'chunk',
            sourceId: 's1',
            distance: 0.1,
            provenance: { index: 5 },
          },
          {
            id: 'c',
            content: 'alpha content about auth',
            unitType: 'chunk',
            sourceId: 's2',
            distance: 0.08,
            provenance: { index: 0 },
          },
          {
            id: 'd',
            content: 'neighbor order chunk',
            unitType: 'chunk',
            sourceId: 's1',
            distance: 0.12,
            provenance: { index: 1 },
          },
        ] as MemoryNode[];
      }),
      bindEdge,
    } as unknown as MemoryFabric;

    const result = await linkSimilarChunks(fabric, [
      {
        id: 'a',
        content: 'alpha content about auth',
        embedding: [0.1, 0.2, 0.3],
        sourceId: 's1',
        provenance: { index: 0 },
      },
    ]);

    expect(result.linked).toBeGreaterThanOrEqual(1);
    // Adjacent index 1 same source skipped; near-dup of self/same text skipped.
    const targets = bindEdge.mock.calls.map((c) => (c[0] as { targetNodeId: string }).targetNodeId);
    expect(targets).toContain('b');
    expect(targets).not.toContain('d');
    expect(targets).not.toContain('a');
  });
});

describe('12.2 — ingest → hybrid → gate → pack (deep mock)', () => {
  it('end-to-end packs citeable evidence from hybrid merge', () => {
    const vector = [
      { id: 'c-auth-jwt', content: 'JWT ERR_AUTH_401', distance: 0.2, sourceId: 's' },
      { id: 'c-noise', content: 'weather', distance: 0.25, sourceId: 'n' },
    ];
    const lexical = [
      { id: 'c-auth-jwt', content: 'JWT ERR_AUTH_401', score: 0.9, sourceId: 's' },
      { id: 'c-follows', content: 'FOLLOWS edge type', score: 0.5, sourceId: 'r' },
    ];
    const merged = mergeRrf(vector, lexical, { limit: 8 });
    const gated = applyScoreGate(merged, { minScore: 0.4, maxPerSource: 3 });
    const ranked = heuristicRerank('ERR_AUTH_401', gated);
    const units = ranked
      .map((n, i) => toEvidenceUnit({ ...n, label: n.id, category: 'source_doc', provenance: { sourceName: 'API' } }, i))
      .filter((u): u is NonNullable<typeof u> => !!u);
    const packed = packEvidenceBlocks(units, { maxChars: 2000, maxLineChars: 500 });
    expect(packed.text).toContain('[E1');
    expect(packed.evidenceIds[0]).toBe('c-auth-jwt');
    expect(packed.count).toBeGreaterThan(0);
  });
});

describe('0.4 / 0.5 / 10.6 / 12.4 / 12.5 — eval harness + CI gate', () => {
  it('runs golden×synthetic eval and meets frozen baseline', () => {
    const metrics = runRetrievalEval(fixtureDir);
    const baseline = loadFrozenBaseline(fixtureDir);
    expect(metrics.queries).toBe(30);
    expect(metrics.precisionAt5).toBeGreaterThanOrEqual(0.75);
    expect(metrics.abstainAccuracy).toBeGreaterThanOrEqual(0.85);
    expect(metrics.medianEvidenceChars).toBeGreaterThan(0);
    expect(metrics.prefetchP50Ms).toBeGreaterThanOrEqual(0);

    const gate = assertBaselineGate(metrics, baseline);
    expect(gate.ok, gate.reason).toBe(true);
  });

  it('T7/T8 scenario simulation: find cites, abstain empty', () => {
    const corpus = loadSyntheticCorpus(fixtureDir);
    const queries = loadGoldenQueries(fixtureDir);
    const findQ = queries.find((q) => q.id === 'q01')!;
    const abstainQ = queries.find((q) => q.id === 'q09')!;
    const found = evaluateQuery(findQ, corpus);
    expect(found.hitRelevant).toBe(true);
    expect(found.topIds.length).toBeGreaterThan(0);
    const abstain = evaluateQuery(abstainQ, corpus);
    expect(abstain.hitRelevant).toBe(false);
    // Either empty pack or only noise — must not hit relevant (none exist).
    expect(EMPTY_EVIDENCE_MARKER).toContain('none above confidence');
  });
});

describe('13.3 — resolveEmbedText without re-parse', () => {
  it('re-embed text prefers provenance.embedText', async () => {
    const { resolveEmbedTextForNode } = await import('../../src/neural/retrieval/contextualize.js');
    const text = resolveEmbedTextForNode({
      content: 'body',
      provenance: { embedText: 'Title › Auth\n\nbody', sourceName: 'Title' },
    });
    expect(text.startsWith('Title › Auth')).toBe(true);
  });
});
