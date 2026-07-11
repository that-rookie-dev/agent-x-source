import { describe, it, expect } from 'vitest';
import { validateCanvasSource } from '../src/canvas/CanvasValidator.js';
import { compileCanvasTsx, wrapMarkdownInCanvasTsx } from '../src/canvas/CanvasCompiler.js';

const MOCK_REACT = {
  createElement: (...args: unknown[]) => ({ args }),
  Fragment: 'Fragment',
  useState: (init: unknown) => [init, () => {}],
  useEffect: () => {},
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
  useRef: (init: unknown) => ({ current: init }),
};

const SAMPLE = `import { useState } from 'react';
import { CanvasRoot, Section, KpiRow, Kpi, Chart, DataTable, Select } from '@agentx/canvas';

const rows = [
  { service: 'api', errors: 12, latency: 84 },
  { service: 'worker', errors: 3, latency: 120 },
];

export default function OpsDashboard() {
  const [range, setRange] = useState('7d');
  return (
    <CanvasRoot>
      <Section title="Ops overview" subtitle="Source: inline demo">
        <Select label="Range" value={range} options={[{ value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }]} onChange={setRange} />
        <KpiRow>
          <Kpi label="Error rate" value="1.2%" tone="warn" />
          <Kpi label="p95 latency" value="84ms" />
        </KpiRow>
        <Chart spec={{ v: 1, type: 'bar', title: 'Errors by service', data: rows.map((r) => ({ x: r.service, y: r.errors })) }} />
        <DataTable columns={[{ key: 'service', label: 'Service' }, { key: 'errors', label: 'Errors' }, { key: 'latency', label: 'Latency (ms)' }]} rows={rows} searchable />
      </Section>
    </CanvasRoot>
  );
}
`;

function resolveBundle(bundle: unknown): unknown {
  if (!bundle) return null;
  if (typeof bundle === 'function') return bundle;
  if (typeof bundle === 'object' && bundle !== null && 'default' in bundle) {
    return (bundle as { default?: unknown }).default;
  }
  return null;
}

describe('CanvasValidator', () => {
  it('rejects fetch and missing default export', () => {
    expect(validateCanvasSource('import x from "node:fs"').ok).toBe(false);
    expect(validateCanvasSource('export const x = 1').ok).toBe(false);
    expect(validateCanvasSource(SAMPLE).ok).toBe(true);
  });

  it('rejects disallowed imports', () => {
    expect(validateCanvasSource(`import x from 'lodash';\nexport default function X(){return null;}`).ok).toBe(false);
  });
});

describe('wrapMarkdownInCanvasTsx', () => {
  it('escapes special characters in title', () => {
    const tsx = wrapMarkdownInCanvasTsx('Report <beta> "Q1"', '# Hello');
    expect(tsx).toContain('{"Report <beta> \\"Q1\\""}');
    expect(validateCanvasSource(tsx).ok).toBe(true);
  });
});

describe('compileCanvasTsx', () => {
  it('compiles valid interactive canvas', async () => {
    const result = await compileCanvasTsx(SAMPLE);
    expect(result.ok).toBe(true);
    expect(result.code).toContain('__agentx_canvas_bundle__');
  });

  it('produces a loadable default export', async () => {
    const AgentXCanvas = await import('@agentx/canvas');
    const result = await compileCanvasTsx(SAMPLE);
    expect(result.ok).toBe(true);
    (globalThis as Record<string, unknown>)['__AGENTX_CANVAS_HOST__'] = { React: MOCK_REACT, AgentXCanvas };
    const runner = new Function(`${result.code}\n;return globalThis.__agentx_canvas_bundle__;`);
    const bundle = runner();
    const Comp = resolveBundle(bundle);
    expect(typeof Comp).toBe('function');
    delete (globalThis as Record<string, unknown>)['__agentx_canvas_bundle__'];
    delete (globalThis as Record<string, unknown>)['__AGENTX_CANVAS_HOST__'];
  });
});
