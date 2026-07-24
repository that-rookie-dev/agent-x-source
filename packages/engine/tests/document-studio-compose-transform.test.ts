/**
 * Document Studio — compose transform adapter tests (spec §6.2).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { composeTransform } from '../src/document-studio/compose/transform.js';
import type { ComposeInput } from '../src/document-studio/runner/PrimitiveRegistry.js';

const mocks = vi.hoisted(() => ({
  getBuffer: vi.fn(async () => Buffer.from('Hello world')),
}));

vi.mock('../src/attachments/index.js', () => ({
  getAttachmentService: () => ({
    getBuffer: mocks.getBuffer,
  }),
}));

vi.mock('../src/document-studio/masters/analyzers.js', () => ({
  tryCreateModel: () => null,
}));

const baseMaster = {
  id: 'm1',
  name: 'hello.txt',
  kind: 'layout' as const,
  format: 'other' as const,
  mimeType: 'text/plain',
  storageId: 's1',
  checksum: '',
  version: 1,
  analysis: null,
  analysisState: 'ready' as const,
  tags: [],
  createdAt: '',
  updatedAt: '',
};

const basePolicies = {
  missingRequired: 'ask' as const,
  missingOptional: 'blank' as const,
  inventFacts: false as const,
  citations: 'off' as const,
  pii: 'allow' as const,
  overwrite: 'fail' as const,
};

function makeInput(overrides: Partial<ComposeInput> = {}): ComposeInput {
  return {
    master: baseMaster,
    policies: basePolicies,
    transformOp: 'translate',
    ...overrides,
  } as ComposeInput;
}

beforeEach(() => {
  mocks.getBuffer.mockResolvedValue(Buffer.from('Hello world'));
});

describe('composeTransform translate', () => {
  it('warns and returns original text when targetLang is missing', async () => {
    const out = await composeTransform(makeInput({ adapterHints: {} }));
    expect(new TextDecoder().decode(out.bytes)).toBe('Hello world');
    expect(out.warnings.some((w) => w.toLowerCase().includes('targetlang'))).toBe(true);
  });

  it('warns and returns original text when no AI model is available', async () => {
    const out = await composeTransform(makeInput({ adapterHints: { targetLang: 'es' } }));
    expect(new TextDecoder().decode(out.bytes)).toBe('Hello world');
    expect(out.warnings.some((w) => w.includes('no AI model'))).toBe(true);
  });

  it('accepts targetLang from bindingSet values', async () => {
    const out = await composeTransform(
      makeInput({
        adapterHints: {},
        bindingSet: {
          id: 'b1',
          schemaRef: '',
          values: { targetLang: 'fr' },
          provenance: {},
          unresolved: [],
          errors: [],
        },
      }),
    );
    expect(new TextDecoder().decode(out.bytes)).toBe('Hello world');
    expect(out.warnings.some((w) => w.includes('no AI model'))).toBe(true);
  });
});

describe('composeTransform redact', () => {
  it('keeps value-list redaction behavior', async () => {
    mocks.getBuffer.mockResolvedValue(Buffer.from('Hello Alice and Bob'));
    const out = await composeTransform(
      makeInput({
        transformOp: 'redact',
        adapterHints: { keys: ['name'] },
        bindingSet: {
          id: 'b1',
          schemaRef: '',
          values: { name: 'Alice' },
          provenance: {},
          unresolved: [],
          errors: [],
        },
      }),
    );
    expect(new TextDecoder().decode(out.bytes)).toBe('Hello [REDACTED] and Bob');
  });

  it('auto-detects and redacts common PII patterns', async () => {
    const source =
      'Email alice@example.com, SSN 123-45-6789, PAN ABCDE1234F, phone +1 555-123-4567, IBAN GB82WEST12345698765432, card 4111 1111 1111 1111';
    mocks.getBuffer.mockResolvedValue(Buffer.from(source));
    const out = await composeTransform(
      makeInput({
        transformOp: 'redact',
        adapterHints: { autoPii: true },
      }),
    );
    const decoded = new TextDecoder().decode(out.bytes);
    expect(decoded).not.toContain('alice@example.com');
    expect(decoded).not.toContain('123-45-6789');
    expect(decoded).not.toContain('ABCDE1234F');
    expect(decoded).not.toContain('+1 555-123-4567');
    expect(decoded).not.toContain('GB82WEST12345698765432');
    expect(decoded).not.toContain('4111 1111 1111 1111');
    expect(decoded.split('[REDACTED]').length).toBeGreaterThan(1);
  });

  it('combines value-list and auto PII redaction', async () => {
    mocks.getBuffer.mockResolvedValue(Buffer.from('Alice email is alice@example.com'));
    const out = await composeTransform(
      makeInput({
        transformOp: 'redact',
        adapterHints: { keys: ['name'], autoPii: true },
        bindingSet: {
          id: 'b1',
          schemaRef: '',
          values: { name: 'Alice' },
          provenance: {},
          unresolved: [],
          errors: [],
        },
      }),
    );
    const decoded = new TextDecoder().decode(out.bytes);
    expect(decoded).not.toContain('Alice');
    expect(decoded).not.toContain('alice@example.com');
    expect(decoded).toContain('[REDACTED]');
  });
});

describe('composeTransform binary transform fallback', () => {
  it('falls back to text-only watermark when given an invalid PDF', async () => {
    mocks.getBuffer.mockResolvedValue(Buffer.from('not a real pdf'));
    const out = await composeTransform(
      makeInput({
        transformOp: 'watermark',
        adapterHints: { watermark: 'Confidential' },
        master: { ...baseMaster, format: 'pdf' },
      }),
    );
    const decoded = new TextDecoder().decode(out.bytes);
    expect(decoded).toContain('--- Confidential ---');
    expect(out.warnings.some((w) => w.toLowerCase().includes('fallback'))).toBe(true);
  });
});
