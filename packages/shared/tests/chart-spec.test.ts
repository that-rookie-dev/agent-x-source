import { describe, it, expect } from 'vitest';
import {
  parseChartSpec,
  isChartSpecContent,
  isIncompleteChartJson,
  isMermaidSource,
  chartBlockTitle,
  chartSpecFromTable,
  CHART_ALL_TYPES,
  MAX_PIE_SLICES,
} from '../src/utils/chart-spec.js';
import { attachChartPartsFromTools } from '../src/utils/chart-parts.js';
import type { MessagePart } from '../src/utils/message-parts.js';

describe('parseChartSpec', () => {
  it('parses a simple bar chart', () => {
    const result = parseChartSpec(JSON.stringify({
      type: 'bar',
      title: 'Scores',
      data: [{ x: 'A', y: 1 }, { x: 'B', y: 2 }],
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.type).toBe('bar');
    expect(result.spec.series).toEqual(['y']);
    expect(chartBlockTitle(result.spec)).toBe('Scores');
  });

  it('infers multi series keys', () => {
    const result = parseChartSpec(JSON.stringify({
      type: 'line_multi',
      data: [
        { x: 'Q1', revenue: 10, cost: 4 },
        { x: 'Q2', revenue: 12, cost: 5 },
      ],
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.series?.sort()).toEqual(['cost', 'revenue']);
  });

  it('groups pie slices beyond max into Other', () => {
    const data = Array.from({ length: MAX_PIE_SLICES + 3 }, (_, i) => ({
      name: `S${i}`,
      value: MAX_PIE_SLICES + 3 - i,
    }));
    const result = parseChartSpec(JSON.stringify({ type: 'pie', data }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.data).toHaveLength(MAX_PIE_SLICES);
    expect(result.spec.data.at(-1)?.['name']).toBe('Other');
  });

  it('parses sankey with nodes/links', () => {
    const result = parseChartSpec(JSON.stringify({
      type: 'sankey',
      nodes: [{ id: 'a' }, { id: 'b' }],
      links: [{ source: 'a', target: 'b', value: 3 }],
    }));
    expect(result.ok).toBe(true);
  });

  it('parses mermaid chart', () => {
    const result = parseChartSpec(JSON.stringify({
      type: 'sequence',
      mermaid: 'sequenceDiagram\nA->>B: hi',
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.mermaid).toContain('sequenceDiagram');
  });

  it('parses gantt tasks', () => {
    const result = parseChartSpec(JSON.stringify({
      type: 'gantt',
      tasks: [{ name: 'Design', start: 0, end: 3 }, { name: 'Build', start: 3, end: 8 }],
    }));
    expect(result.ok).toBe(true);
  });

  it('accepts every catalog type with minimal valid payload', () => {
    for (const type of CHART_ALL_TYPES) {
      let payload: Record<string, unknown>;
      if (['mermaid', 'sequence', 'state', 'er', 'mindmap', 'org'].includes(type)) {
        payload = { type, mermaid: 'flowchart TD\nA-->B' };
      } else if (['sankey', 'network', 'chord', 'arc'].includes(type)) {
        payload = { type, nodes: [{ id: 'a' }, { id: 'b' }], links: [{ source: 'a', target: 'b', value: 1 }] };
      } else if (type === 'gantt') {
        payload = { type, tasks: [{ name: 'T', start: 0, end: 1 }] };
      } else {
        payload = { type, data: [{ x: 'A', y: 1, name: 'A', value: 1, open: 1, high: 2, low: 0.5, close: 1.5 }] };
      }
      const result = parseChartSpec(JSON.stringify(payload));
      expect(result.ok, type).toBe(true);
    }
  });

  it('rejects invalid json', () => {
    expect(parseChartSpec('{nope').ok).toBe(false);
  });

  it('rejects unknown chart type', () => {
    const result = parseChartSpec(JSON.stringify({ type: 'not_a_real_type', data: [{ x: 1 }] }));
    expect(result.ok).toBe(false);
  });

  it('detects chart content', () => {
    expect(isChartSpecContent('{"type":"line","data":[{"x":"a","y":1}]}')).toBe(true);
    expect(isChartSpecContent('{"type":"nope","data":[{"x":1}]}')).toBe(false);
    expect(isChartSpecContent('not json')).toBe(false);
  });

  it('detects incomplete streaming json', () => {
    expect(isIncompleteChartJson('{"type":"bar","data":[{"x":"A"')).toBe(true);
    expect(isIncompleteChartJson('{"type":"bar","data":[{"x":"A","y":1}]}')).toBe(false);
    expect(isIncompleteChartJson('not json')).toBe(false);
  });

  it('detects mermaid source', () => {
    expect(isMermaidSource('sequenceDiagram\nA->>B: hi')).toBe(true);
    expect(isMermaidSource('{"type":"bar","data":[{"x":1}]}')).toBe(false);
  });

  it('scrubs unsafe title characters', () => {
    const result = parseChartSpec(JSON.stringify({
      type: 'bar',
      title: '<script>x</script>',
      data: [{ x: 'A', y: 1 }],
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.title).not.toContain('<');
    expect(result.spec.title).not.toContain('>');
  });
});

describe('chartSpecFromTable', () => {
  it('infers grouped bar from numeric columns', () => {
    const spec = chartSpecFromTable(
      ['Region', '2024', '2025'],
      [['North', '10', '12'], ['South', '8', '9']],
    );
    expect(spec).not.toBeNull();
    expect(spec?.type).toBe('bar_grouped');
    expect(spec?.series).toEqual(['2024', '2025']);
  });

  it('sanitizes spaced header keys', () => {
    const spec = chartSpecFromTable(
      ['Name', 'Q1 Sales'],
      [['A', '10']],
    );
    expect(spec?.series).toEqual(['Q1_Sales']);
  });

  it('returns null without numeric columns', () => {
    expect(chartSpecFromTable(['A', 'B'], [['x', 'y']])).toBeNull();
  });
});

describe('attachChartPartsFromTools', () => {
  it('lifts render_chart metadata into chart parts', () => {
    const parts: MessagePart[] = [{
      type: 'tool',
      id: 't1',
      tool: {
        id: 't1',
        name: 'render_chart',
        status: 'done',
        metadata: { chartSpec: { v: 1, type: 'bar', data: [{ x: 'A', y: 1 }] } },
      },
    }];
    const next = attachChartPartsFromTools(parts);
    expect(next.some((p) => p.type === 'chart' && p.id === 't1' && p.chartJson?.includes('"bar"'))).toBe(true);
  });
});
