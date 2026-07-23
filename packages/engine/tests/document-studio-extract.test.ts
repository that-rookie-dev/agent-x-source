import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentStudioService } from '../src/document-studio/DocumentStudioService.js';
import { defaultJobPolicies } from '../src/document-studio/jobspec.js';
import type { JobStep, PrimitiveContext } from '../src/document-studio/types.js';

const mocks = vi.hoisted(() => ({
  tryCreateModel: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock('../src/document-studio/masters/analyzers.js', () => ({
  tryCreateModel: mocks.tryCreateModel,
}));

vi.mock('ai', () => ({
  generateText: mocks.generateText,
}));

function makeCtx(overrides: Partial<PrimitiveContext> & Record<string, unknown> = {}): PrimitiveContext {
  return { jobId: 'j1', policies: defaultJobPolicies(), ...overrides } as PrimitiveContext;
}

function makeStep(overrides: Partial<JobStep> = {}): JobStep {
  return { op: 'extract_facts', from: 'evidence', as: 'facts', ...overrides } as JobStep;
}

async function extractFacts(service: DocumentStudioService, ctx: PrimitiveContext, step?: JobStep) {
  return (service as any).primitiveExtractFacts(step ?? makeStep(), ctx);
}

describe('primitiveExtractFacts', () => {
  const service = new DocumentStudioService({ pool: {} as never });

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.tryCreateModel.mockReturnValue({});
    mocks.generateText.mockResolvedValue({ text: JSON.stringify({ facts: [] }) });
  });

  it('returns shaped facts when a model extracts structured facts', async () => {
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify({
        facts: [
          { id: 'f1', text: 'Acme Corp signed the merger agreement.', source: 'doc1', type: 'event', confidence: 0.95 },
          { id: 'f2', text: 'Alice Smith is the CEO.', source: 'doc2', type: 'entity', confidence: 0.88 },
        ],
      }),
    });
    const ctx = makeCtx({ evidence: [{ id: 'c1', content: 'Evidence one.', sourceName: 'doc1' }] });
    const result = await extractFacts(service, ctx);
    expect(result.ok).toBe(true);
    const facts = result.outputs?.facts as any[];
    expect(facts).toHaveLength(2);
    const [f1] = facts;
    expect(f1).toHaveProperty('id');
    expect(f1).toHaveProperty('text');
    expect(f1).toHaveProperty('source');
    expect(f1).toHaveProperty('type');
    expect(f1).toHaveProperty('confidence');
    expect(f1.confidence).toBeGreaterThanOrEqual(0);
    expect(f1.confidence).toBeLessThanOrEqual(1);
    expect(f1.type).toMatch(/^(entity|event|claim|obligation)$/);
  });

  it('deduplicates near-duplicate facts ignoring case and punctuation', async () => {
    mocks.generateText.mockResolvedValue({
      text: JSON.stringify({
        facts: [
          { id: 'a', text: 'Acme signed the deal.', source: 'doc1', type: 'claim', confidence: 0.9 },
          { id: 'b', text: 'acme signed the deal', source: 'doc2', type: 'claim', confidence: 0.8 },
          { id: 'c', text: 'Bob joined the board.', source: 'doc3', type: 'event', confidence: 0.7 },
        ],
      }),
    });
    const ctx = makeCtx({ evidence: [{ id: 'c1', content: 'Evidence one.', sourceName: 'doc1' }] });
    const result = await extractFacts(service, ctx);
    expect(result.ok).toBe(true);
    const facts = result.outputs?.facts as any[];
    expect(facts).toHaveLength(2);
    const texts = facts.map((f: any) => f.text.toLowerCase());
    expect(texts).toContain('acme signed the deal.');
    expect(texts).toContain('bob joined the board.');
  });

  it('falls back to pass-through facts with low confidence when no model is available', async () => {
    mocks.tryCreateModel.mockReturnValue(null);
    const ctx = makeCtx({
      evidence: [
        { id: 'c1', content: 'First snippet.', sourceName: 'doc1' },
        { id: 'c2', content: 'Second snippet.', sourceName: 'doc2' },
      ],
    });
    const result = await extractFacts(service, ctx);
    expect(result.ok).toBe(true);
    const facts = result.outputs?.facts as any[];
    expect(facts).toHaveLength(2);
    expect(facts[0].text).toBe('First snippet.');
    expect(facts[0].source).toBe('doc1');
    expect(facts[0].type).toBe('claim');
    expect(facts[0].confidence).toBe(0.3);
    expect(facts[1].text).toBe('Second snippet.');
    expect(facts[1].source).toBe('doc2');
  });

  it('returns an empty fact list for empty evidence', async () => {
    const result = await extractFacts(service, makeCtx({ evidence: [] }));
    expect(result.ok).toBe(true);
    expect(result.outputs?.facts).toEqual([]);
  });
});
