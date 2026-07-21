import { describe, it, expect } from 'vitest';
import { RagDocument } from '../../src/neural/RagDocument.js';
import {
  buildEmbedText,
  applyScoreGate,
  dedupeByContent,
  diversifyBySource,
  heuristicRerank,
  packEvidenceBlocks,
  formatEvidenceCitation,
  toEvidenceUnit,
  RETRIEVAL_DEFAULTS,
  EMPTY_EVIDENCE_MARKER,
} from '../../src/neural/retrieval/index.js';
import { createMemoryContextSection } from '../../src/prompt/assembly/sections.js';

describe('buildEmbedText', () => {
  it('prefixes title and heading path', () => {
    const text = buildEmbedText({
      title: 'API Guide',
      headingPath: ['## Auth', '### JWT'],
      body: 'Tokens expire in 1 hour.',
    });
    expect(text).toBe('API Guide › Auth › JWT\n\nTokens expire in 1 hour.');
  });
});

describe('RagDocument contextual chunks', () => {
  it('keeps sections under headings and sets embedText', () => {
    const doc = new RagDocument(
      `# Title\n\n## Auth\n\nJWT tokens are required.\n\n## Storage\n\nUse Postgres for persistence.`,
      { title: 'API Guide', kind: 'markdown' },
    );
    const chunks = doc.chunks();
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.some((c) => c.embedText.includes('API Guide') && c.embedText.includes('Auth'))).toBe(true);
    expect(chunks.every((c) => c.embedText.includes('\n\n') || c.content.length < 40)).toBe(true);
  });

  it('merges tiny trailing fragments when same path', () => {
    const doc = new RagDocument(
      `## Auth\n\nThis is a reasonably long authentication section that explains JWT usage in detail for clients.\n\nOk.`,
      { title: 'Guide', kind: 'markdown' },
      { chunkMinChars: 80 },
    );
    const chunks = doc.chunks();
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.content).toContain('Ok.');
  });
});

describe('score gate', () => {
  it('drops below-threshold scores', () => {
    const kept = applyScoreGate(
      [
        { id: 'a', content: 'alpha', distance: 0.1, sourceId: 's1' },
        { id: 'b', content: 'beta', distance: 0.8, sourceId: 's1' },
      ],
      { minScore: 0.4 },
    );
    expect(kept.map((k) => k.id)).toEqual(['a']);
  });

  it('dedupes near-identical bodies', () => {
    const out = dedupeByContent([
      { id: '1', content: 'Hello World' },
      { id: '2', content: 'hello   world' },
    ]);
    expect(out).toHaveLength(1);
  });

  it('caps per source', () => {
    const out = diversifyBySource(
      [
        { id: '1', content: 'a', sourceId: 's' },
        { id: '2', content: 'b', sourceId: 's' },
        { id: '3', content: 'c', sourceId: 's' },
        { id: '4', content: 'd', sourceId: 't' },
      ],
      2,
    );
    expect(out.map((x) => x.id)).toEqual(['1', '2', '4']);
  });
});

describe('evidence prompt contract', () => {
  it('injects RETRIEVED_EVIDENCE_CONTRACT when memory state present', async () => {
    const section = createMemoryContextSection({
      memoryContext: {
        getContext: async () => ({
          episodic: '',
          semantic: EMPTY_EVIDENCE_MARKER,
          graph: '',
        }),
      },
    } as Parameters<typeof createMemoryContextSection>[0]);
    const state = await section.load();
    const rendered = section.render(state);
    expect(rendered).toContain('[RETRIEVED_EVIDENCE_CONTRACT]');
    expect(rendered).toContain('none above confidence');
  });
});

describe('rerank + packer', () => {
  it('boosts lexical overlap', () => {
    const ranked = heuristicRerank('ERR_AUTH_401 exact', [
      { id: '1', content: 'unrelated weather notes', distance: 0.2 },
      { id: '2', content: 'Thrown when ERR_AUTH_401 occurs', distance: 0.35 },
    ]);
    expect(ranked[0]!.id).toBe('2');
  });

  it('packs citeable evidence under budget', () => {
    const unit = toEvidenceUnit({
      id: 'uuid-1',
      label: 'chunk',
      category: 'source_doc',
      content: 'JWT tokens are required for all /api routes.',
      distance: 0.2,
      provenance: { sourceName: 'API Guide', pageNumber: 4, headingPath: ['## Auth'] },
    }, 0)!;
    const cite = formatEvidenceCitation(unit, 1);
    expect(cite).toContain('E1');
    expect(cite).toContain('API Guide');
    expect(cite).toContain('p.4');

    const packed = packEvidenceBlocks([unit], { maxChars: 2000, maxLineChars: RETRIEVAL_DEFAULTS.maxEvidenceLineChars });
    expect(packed.text).toContain('[E1');
    expect(packed.evidenceIds).toEqual(['uuid-1']);
  });
});
