import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { DocumentStudioService } from '../src/document-studio/DocumentStudioService.js';
import { setKnowledgeBaseService } from '../src/knowledge-base/index.js';
import { defaultJobPolicies } from '../src/document-studio/jobspec.js';
import type { JobStep } from '../src/document-studio/types.js';
import type { PrimitiveContext } from '../src/document-studio/runner/PrimitiveRegistry.js';

const mockSearch = vi.fn();
const mockListSources = vi.fn();
const mockKb = { search: mockSearch, listSources: mockListSources } as any;

function makeCtx(overrides: Partial<PrimitiveContext> & Record<string, unknown> = {}): PrimitiveContext {
  return { jobId: 'j1', policies: defaultJobPolicies(), ...overrides } as PrimitiveContext;
}

function mockSource(id: string, name: string, metadata?: Record<string, unknown>) {
  return { id, name, ...(metadata ? { metadata } : {}) } as any;
}

function mockChunk(id: string, sourceId: string, sourceName: string, content: string) {
  return { id, sourceId, sourceName, content, score: 0.9, kind: 'chunk' };
}

describe('previewKbSelector', () => {
  const service = new DocumentStudioService({ pool: {} as any });

  beforeAll(() => {
    setKnowledgeBaseService(mockKb);
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mockSearch.mockResolvedValue([]);
    mockListSources.mockResolvedValue([]);
  });

  afterAll(() => {
    setKnowledgeBaseService(null);
  });

  it('collection mode returns samples and count for sources in the collection', async () => {
    mockListSources.mockResolvedValue([
      mockSource('s1', 'contract-A.pdf', { collection: 'contracts' }),
      mockSource('s2', 'other.pdf', { collection: 'other' }),
    ]);
    mockSearch.mockImplementation(async (_q: string, _topK: number, sourceId?: string) => {
      if (sourceId === 's1') return [mockChunk('c1', 's1', 'contract-A.pdf', 'Clause one text.')];
      return [];
    });

    const result = await service.previewKbSelector({ mode: 'collection', collectionId: 'contracts' });

    expect(result.count).toBe(1);
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0]).toMatchObject({ id: 'c1', sourceName: 'contract-A.pdf', content: 'Clause one text.' });
    expect(result.warning).toBeUndefined();
    expect(mockSearch).toHaveBeenCalledWith('*', 5, 's1');
  });

  it('collection mode warns and returns empty when no collection catalog/metadata is available', async () => {
    mockListSources.mockResolvedValue([mockSource('s1', 'doc.pdf')]);

    const result = await service.previewKbSelector({ mode: 'collection', collectionId: 'contracts' });

    expect(result.count).toBe(0);
    expect(result.samples).toHaveLength(0);
    expect(result.warning).toMatch(/COLLECTION_NOT_SUPPORTED/);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('tags mode (any) returns sources matching at least one requested tag', async () => {
    mockListSources.mockResolvedValue([
      mockSource('s1', 'A.pdf', { tags: ['finance', 'q3'] }),
      mockSource('s2', 'B.pdf', { tags: ['hr'] }),
      mockSource('s3', 'C.pdf'),
    ]);
    mockSearch.mockImplementation(async (_q: string, _topK: number, sourceId?: string) => {
      if (sourceId === 's1') return [mockChunk('c1', 's1', 'A.pdf', 'Finance Q3 text.')];
      if (sourceId === 's2') return [mockChunk('c2', 's2', 'B.pdf', 'HR text.')];
      return [];
    });

    const result = await service.previewKbSelector({ mode: 'tags', tags: ['finance'], match: 'any' });

    expect(result.count).toBe(1);
    expect(result.samples[0]).toMatchObject({ sourceName: 'A.pdf' });
    expect(mockSearch).toHaveBeenCalledWith('*', 5, 's1');
    expect(mockSearch).not.toHaveBeenCalledWith('*', 5, 's2');
  });

  it('tags mode (all) requires every requested tag', async () => {
    mockListSources.mockResolvedValue([
      mockSource('s1', 'A.pdf', { tags: ['finance', 'q3'] }),
      mockSource('s2', 'B.pdf', { tags: ['finance'] }),
    ]);
    mockSearch.mockImplementation(async (_q: string, _topK: number, sourceId?: string) => {
      if (sourceId === 's1') return [mockChunk('c1', 's1', 'A.pdf', 'Finance Q3 text.')];
      return [];
    });

    const result = await service.previewKbSelector({ mode: 'tags', tags: ['finance', 'q3'], match: 'all' });

    expect(result.count).toBe(1);
    expect(result.samples[0]).toMatchObject({ sourceName: 'A.pdf' });
  });

  it('tags mode warns and returns empty when source tags are not exposed', async () => {
    mockListSources.mockResolvedValue([mockSource('s1', 'doc.pdf')]);

    const result = await service.previewKbSelector({ mode: 'tags', tags: ['finance'], match: 'any' });

    expect(result.count).toBe(0);
    expect(result.samples).toHaveLength(0);
    expect(result.warning).toMatch(/TAGS_NOT_SUPPORTED/);
    expect(mockSearch).not.toHaveBeenCalled();
  });
});

describe('executePrimitive select_evidence', () => {
  const service = new DocumentStudioService({ pool: {} as any });

  beforeAll(() => {
    setKnowledgeBaseService(mockKb);
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mockSearch.mockResolvedValue([]);
    mockListSources.mockResolvedValue([]);
  });

  afterAll(() => {
    setKnowledgeBaseService(null);
  });

  it('passes selector to previewKbSelector and exposes evidence results', async () => {
    mockListSources.mockResolvedValue([mockSource('s1', 'A.pdf', { collection: 'contracts' })]);
    mockSearch.mockResolvedValue([mockChunk('c1', 's1', 'A.pdf', 'Evidence content.')]);

    const step: JobStep = { op: 'select_evidence', selector: { mode: 'collection', collectionId: 'contracts' }, as: 'evidence' };
    const result = await service.executePrimitive(step, makeCtx());

    expect(result.ok).toBe(true);
    expect(result.outputs).toBeDefined();
    expect((result.outputs!.evidence as any[])).toHaveLength(1);
    expect(result.outputs!.evidenceCount).toBe(1);
  });

  it('exposes unsupported warnings through executePrimitive outputs', async () => {
    mockListSources.mockResolvedValue([mockSource('s1', 'doc.pdf')]);

    const step: JobStep = { op: 'select_evidence', selector: { mode: 'collection', collectionId: 'contracts' }, as: 'evidence' };
    const result = await service.executePrimitive(step, makeCtx());

    expect(result.ok).toBe(true);
    expect(result.outputs!.evidence).toHaveLength(0);
    expect(result.outputs!.evidenceCount).toBe(0);
    expect(result.outputs!.warning).toMatch(/COLLECTION_NOT_SUPPORTED/);
  });
});
