import { describe, it, expect } from 'vitest';
import {
  detectTemplateFormat,
  extractPlaceholderKeys,
  fieldsFromKeys,
  humanizeFieldKey,
  isFillableFormat,
} from '../src/templates/placeholder-scan.js';

describe('template placeholders', () => {
  it('extracts unique {{keys}}', () => {
    const keys = extractPlaceholderKeys('Hello {{client_name}} — invoice {{invoice_date}} for {{client_name}}');
    expect(keys).toEqual(['client_name', 'invoice_date', 'client_name']);
    const fields = fieldsFromKeys(keys);
    expect(fields.map((f) => f.key)).toEqual(['client_name', 'invoice_date']);
    expect(fields[0]?.label).toBe('Client Name');
  });

  it('humanizes keys', () => {
    expect(humanizeFieldKey('total_amount')).toBe('Total Amount');
    expect(humanizeFieldKey('Q1.revenue')).toBe('Q1 Revenue');
  });

  it('detects formats', () => {
    expect(detectTemplateFormat('a.docx')).toBe('docx');
    expect(detectTemplateFormat('b.xlsx')).toBe('xlsx');
    expect(detectTemplateFormat('c.pdf')).toBe('pdf');
    expect(isFillableFormat('docx')).toBe(true);
    expect(isFillableFormat('pdf')).toBe(true);
    expect(isFillableFormat('pptx')).toBe(false);
  });
});
