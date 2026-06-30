import { describe, it, expect } from 'vitest';
import { makeTextUnit, approxTokenCount, textUnitId, type TextUnitType } from '../../src/neural/TextUnit.js';

describe('approxTokenCount', () => {
  it('estimates tokens as word count × 1.3', () => {
    expect(approxTokenCount('hello world')).toBe(3); // 2 words → 2.6 → ceil 3
  });
  it('handles empty text', () => {
    expect(approxTokenCount('')).toBe(0);
  });
  it('handles whitespace-only text', () => {
    expect(approxTokenCount('   \n\n  ')).toBe(0);
  });
});

describe('textUnitId', () => {
  it('is deterministic — same inputs produce the same id', () => {
    const source = { charStart: 0, charEnd: 100, sessionId: 's1' };
    expect(textUnitId('parent1', source)).toBe(textUnitId('parent1', source));
  });
  it('differs when char span differs', () => {
    const s1 = { charStart: 0, charEnd: 100, sessionId: 's1' };
    const s2 = { charStart: 0, charEnd: 200, sessionId: 's1' };
    expect(textUnitId('parent1', s1)).not.toBe(textUnitId('parent1', s2));
  });
  it('differs when parent differs', () => {
    const source = { charStart: 0, charEnd: 100, sessionId: 's1' };
    expect(textUnitId('parent1', source)).not.toBe(textUnitId('parent2', source));
  });
  it('falls back to documentId when no parent', () => {
    const source = { charStart: 0, charEnd: 100, documentId: 'doc1' };
    const id = textUnitId(undefined, source);
    expect(id).toMatch(/^tu_[0-9a-f]{8}$/);
  });
  it('falls back to sessionId when no parent or documentId', () => {
    const source = { charStart: 0, charEnd: 100, sessionId: 'sess1' };
    const id = textUnitId(undefined, source);
    expect(id).toMatch(/^tu_[0-9a-f]{8}$/);
  });
  it('falls back to orphan when nothing is provided', () => {
    const source = { charStart: 0, charEnd: 100 };
    const id = textUnitId(undefined, source);
    expect(id).toMatch(/^tu_[0-9a-f]{8}$/);
  });
});

describe('makeTextUnit', () => {
  it('constructs a TextUnit with computed id and token count', () => {
    const source = { charStart: 10, charEnd: 50, sessionId: 's1' };
    const unit = makeTextUnit('The API returns 404.', 'proposition', source);
    expect(unit.id).toMatch(/^tu_[0-9a-f]{8}$/);
    expect(unit.text).toBe('The API returns 404.');
    expect(unit.type).toBe('proposition');
    expect(unit.tokenCount).toBe(6); // 4 words → 5.2 → ceil 6
    expect(unit.source).toEqual(source);
  });

  it('sets parentUnitId when provided', () => {
    const source = { charStart: 0, charEnd: 100, documentId: 'doc1' };
    const unit = makeTextUnit('Some text', 'section', source, 'parent-tu-id');
    expect(unit.parentUnitId).toBe('parent-tu-id');
  });

  it('preserves headingPath in source', () => {
    const source = { charStart: 0, charEnd: 100, headingPath: ['## Auth', '### JWT'] };
    const unit = makeTextUnit('JWT tokens expire.', 'proposition', source);
    expect(unit.source.headingPath).toEqual(['## Auth', '### JWT']);
  });
});
