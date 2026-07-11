import { describe, it, expect } from 'vitest';
import { deriveMarkdownTitle, isGenericMarkdownTitle } from '../src/utils/markdown-title.js';

describe('deriveMarkdownTitle', () => {
  it('prefers explicit non-generic title', () => {
    expect(deriveMarkdownTitle({ title: 'Q3 Revenue Dashboard' })).toBe('Q3 Revenue Dashboard');
  });

  it('ignores generic explicit titles and derives from TSX Section', () => {
    const tsx = `import { CanvasRoot, Section } from '@agentx/canvas';
export default function SavedCanvas() {
  return <CanvasRoot><Section title="API Error Audit">...</Section></CanvasRoot>;
}`;
    expect(deriveMarkdownTitle({ title: 'Canvas', contentTsx: tsx })).toBe('API Error Audit');
  });

  it('derives from component name when section title missing', () => {
    const tsx = `export default function OpsDashboard() { return null; }`;
    expect(deriveMarkdownTitle({ contentTsx: tsx })).toBe('Ops Dashboard');
  });

  it('derives from markdown heading', () => {
    expect(deriveMarkdownTitle({
      contentMarkdown: '# Incident postmortem\n\nDetails here.',
    })).toBe('Incident postmortem');
  });

  it('derives from chart fence title', () => {
    const md = '```chart\n{"v":1,"type":"bar","title":"Errors by service","data":[]}\n```';
    expect(deriveMarkdownTitle({ contentMarkdown: md })).toBe('Errors by service');
  });

  it('uses first sentence when no heading', () => {
    expect(deriveMarkdownTitle({
      contentMarkdown: 'Latency increased across all regions during the outage window.',
    })).toBe('Latency increased across all regions during the outage window.');
  });
});

describe('isGenericMarkdownTitle', () => {
  it('flags generic titles', () => {
    expect(isGenericMarkdownTitle('Saved message')).toBe(true);
    expect(isGenericMarkdownTitle('Q1 Ops Review')).toBe(false);
  });
});
