import { describe, it, expect } from 'vitest';
import { parseTemplateMentionIds } from '../src/agent/TurnJourney.js';

describe('parseTemplateMentionIds', () => {
  it('extracts unique @template mentions', () => {
    const text = 'Please fill @template[tpl-1:Invoice%20Master.docx] using the CSV. Also @template[tpl-1:Invoice%20Master.docx] again.';
    expect(parseTemplateMentionIds(text)).toEqual([
      { templateId: 'tpl-1', name: 'Invoice Master.docx' },
    ]);
  });

  it('returns empty when none present', () => {
    expect(parseTemplateMentionIds('plain text @kb[src:Doc]')).toEqual([]);
  });
});
