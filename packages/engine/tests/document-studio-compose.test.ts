/**
 * Document Studio — compose adapter tests.
 */

import { describe, it, expect } from 'vitest';
import { composeAuthor } from '../src/document-studio/compose/author.js';
import { variablesToFields } from '../src/document-studio/compose/fillClone.js';
import { defaultJobPolicies } from '../src/document-studio/jobspec.js';
import type { Master, ComposeInput } from '../src/document-studio/types.js';

function master(overrides: Partial<Master> = {}): Master {
  return {
    id: 'm1',
    name: 'Test Doc',
    kind: 'standard',
    format: 'md',
    mimeType: 'text/markdown',
    storageId: 's1',
    checksum: 'c',
    version: 1,
    analysis: null,
    analysisState: 'ready',
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Master;
}

const baseInput: Pick<ComposeInput, 'policies'> = { policies: defaultJobPolicies() };

describe('composeAuthor', () => {
  it('falls back to a template and warns when no LLM is configured', async () => {
    const input: ComposeInput = {
      ...baseInput,
      master: master({
        analysis: {
          kind: 'standard',
          documentType: 'report',
          summary: 'test',
          confidence: 1,
          warnings: [],
          requiredSections: [
            { id: 'intro', title: 'Introduction', level: 1 },
            { id: 'scope', title: 'Scope', level: 2 },
          ],
        },
      }),
      facts: [{ text: 'Scope covers Q1.', source: 'kb1' }],
    };
    const result = await composeAuthor(input);
    const text = new TextDecoder().decode(result.bytes);
    expect(result.format).toBe('md');
    expect(text).toContain('# Test Doc');
    expect(text).toContain('## Scope');
    expect(text).toContain('Scope covers Q1.');
    expect(result.warnings.some((w) => w.includes('LLM model unavailable'))).toBe(true);
  });

  it('produces a fallback document even with no facts or evidence', async () => {
    const input: ComposeInput = {
      ...baseInput,
      master: master({
        analysis: {
          kind: 'standard',
          documentType: 'report',
          summary: 'test',
          confidence: 1,
          warnings: [],
          requiredSections: [{ id: 's1', title: 'Summary', level: 1 }],
        },
      }),
    };
    const result = await composeAuthor(input);
    const text = new TextDecoder().decode(result.bytes);
    expect(text).toContain('# Test Doc');
    expect(text).toContain('# Summary');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('embeds citation markers and a references section from evidence links', async () => {
    const input: ComposeInput = {
      ...baseInput,
      master: master({
        analysis: {
          kind: 'standard',
          documentType: 'report',
          summary: 'test',
          confidence: 1,
          warnings: [],
          requiredSections: [{ id: 'intro', title: 'Introduction', level: 1 }],
        },
      }),
      evidenceSet: {
        id: 'es1',
        selector: { mode: 'ids', sourceIds: ['src1'] },
        chunks: [
          { id: 'chunk-1', sourceId: 'src1', sourceName: 'KB Article', content: 'The project started in Q1.' },
        ],
        links: [{ sectionId: 'intro', chunkIds: ['chunk-1'] }],
      },
    };
    const result = await composeAuthor(input);
    const text = new TextDecoder().decode(result.bytes);
    expect(text).toContain('# Introduction');
    expect(text).toContain('> Evidence: [chunk-1]');
    expect(text).toContain('## References');
    expect(text).toContain('[chunk-1] KB Article (src1):');
    expect(text).toContain('The project started in Q1.');
  });

  it('warns about missing required sections and unmet constraints', async () => {
    const input: ComposeInput = {
      ...baseInput,
      master: master({
        analysis: {
          kind: 'standard',
          documentType: 'report',
          summary: 'test',
          confidence: 1,
          warnings: [],
          requiredSections: [{ id: 's1', title: 'Summary', level: 1 }],
          constraints: [
            { id: 'c1', kind: 'section_required', description: 'Compliance statement', ref: 'compliance' },
            { id: 'c2', kind: 'rule', description: 'Use formal tone' },
          ],
        },
      }),
    };
    const result = await composeAuthor(input);
    expect(result.warnings.some((w) => w.includes('Missing required section from constraint:'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('Constraint not verified: [rule]'))).toBe(true);
  });
});

describe('variablesToFields', () => {
  it('routes locator-specific hints into TemplateField adapterHints or pdf_region coordinates', () => {
    const m = master({
      kind: 'layout',
      format: 'docx',
      analysis: {
        kind: 'layout',
        documentType: 'form',
        summary: 'test',
        confidence: 1,
        warnings: [],
        layout: { sections: [], tables: [], chrome: [] },
        variables: [
          {
            key: 'client',
            label: 'Client',
            datatype: 'string',
            required: true,
            askPolicy: 'ask',
            sensitivity: 'none',
            locator: { type: 'bookmark', name: 'client' },
          },
          {
            key: 'amount',
            label: 'Amount',
            datatype: 'string',
            required: true,
            askPolicy: 'ask',
            sensitivity: 'none',
            locator: { type: 'table_cell', tableId: '1', row: 1, col: 2 },
          },
          {
            key: 'fee',
            label: 'Fee',
            datatype: 'string',
            required: true,
            askPolicy: 'ask',
            sensitivity: 'none',
            locator: { type: 'sheet_cell', sheet: 'Sheet1', cell: 'B2' },
          },
          {
            key: 'date',
            label: 'Date',
            datatype: 'string',
            required: true,
            askPolicy: 'ask',
            sensitivity: 'none',
            locator: { type: 'pdf_region', page: 1, x: 10, y: 20, width: 80, fontSize: 12 },
          },
        ],
      },
    });
    const fields = variablesToFields(m);
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(byKey['client'].source).toBe('placeholder');
    expect((byKey['client'] as unknown as { adapterHints: { name: string } }).adapterHints.name).toBe('client');
    expect((byKey['amount'] as unknown as { adapterHints: { type: string } }).adapterHints.type).toBe('table_cell');
    expect((byKey['fee'] as unknown as { adapterHints: { sheet: string } }).adapterHints.sheet).toBe('Sheet1');
    expect(byKey['date'].page).toBe(1);
    expect(byKey['date'].x).toBe(10);
    expect(byKey['date'].y).toBe(20);
  });
});
