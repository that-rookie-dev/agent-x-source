import { describe, it, expect } from 'vitest';
import { deriveCanvasTitle, isGenericCanvasTitle } from '../src/utils/canvas-title.js';

describe('deriveCanvasTitle', () => {
  it('prefers explicit non-generic title', () => {
    expect(deriveCanvasTitle({ title: 'Q3 Revenue Dashboard' })).toBe('Q3 Revenue Dashboard');
  });

  it('ignores generic explicit titles and derives from TSX Section', () => {
    const tsx = `import { CanvasRoot, Section } from '@agentx/canvas';
export default function SavedCanvas() {
  return <CanvasRoot><Section title="API Error Audit">...</Section></CanvasRoot>;
}`;
    expect(deriveCanvasTitle({ title: 'Canvas', contentTsx: tsx })).toBe('API Error Audit');
  });

  it('derives from component name when section title missing', () => {
    const tsx = `export default function OpsDashboard() { return null; }`;
    expect(deriveCanvasTitle({ contentTsx: tsx })).toBe('Ops Dashboard');
  });

  it('derives from markdown heading', () => {
    expect(deriveCanvasTitle({
      contentMarkdown: '# Incident postmortem\n\nDetails here.',
    })).toBe('Incident postmortem');
  });

  it('derives from chart fence title', () => {
    const md = '```chart\n{"v":1,"type":"bar","title":"Errors by service","data":[]}\n```';
    expect(deriveCanvasTitle({ contentMarkdown: md })).toBe('Errors by service');
  });

  it('uses first sentence when no heading', () => {
    expect(deriveCanvasTitle({
      contentMarkdown: 'Latency increased across all regions during the outage window.',
    })).toBe('Latency increased across all regions during the outage window.');
  });
});

describe('isGenericCanvasTitle', () => {
  it('flags generic titles', () => {
    expect(isGenericCanvasTitle('Saved message')).toBe(true);
    expect(isGenericCanvasTitle('Q1 Ops Review')).toBe(false);
  });
});
