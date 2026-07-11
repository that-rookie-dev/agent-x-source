import { z } from 'zod';

/** Phase 1 (P0) — see CHART_GRAPH_VIEW_PLAN.md */
export const CHART_P0_TYPES = [
  'bar',
  'bar_horizontal',
  'bar_grouped',
  'bar_stacked',
  'line',
  'line_multi',
  'area',
  'pie',
  'donut',
  'scatter',
  'heatmap',
  'histogram',
  'progress',
] as const;

/** Phase 2 (P1) */
export const CHART_P1_TYPES = [
  'bar_stacked_100',
  'radar',
  'bubble',
  'scatter_fit',
  'box',
  'treemap',
  'funnel',
  'gauge',
  'bullet',
  'waterfall',
  'pareto',
  'sankey',
  'gantt',
  'timeline',
  'network',
  'slope',
  'dumbbell',
  'kpi_row',
  'sparkline',
  'error_bar',
  'area_stacked',
  'line_step',
  'area_range',
] as const;

/** Phase 3 (P2) */
export const CHART_P2_TYPES = [
  'violin',
  'density',
  'beeswarm',
  'stream',
  'candlestick',
  'calendar_heatmap',
  'sunburst',
  'rose',
  'waffle',
  'chord',
  'arc',
  'geo_choropleth',
  'geo_points',
  'wordcloud',
  'icon_array',
  'lollipop',
  'dot',
  'pyramid',
  'forest',
  'control',
  'tornado',
  'hexbin',
  'contour',
  'qq',
  'ecdf',
  'parallel',
  'circle_pack',
  'mermaid',
  'sequence',
  'state',
  'er',
  'mindmap',
  'org',
] as const;

export const CHART_ALL_TYPES = [
  ...CHART_P0_TYPES,
  ...CHART_P1_TYPES,
  ...CHART_P2_TYPES,
] as const;

export type ChartP0Type = (typeof CHART_P0_TYPES)[number];
export type ChartP1Type = (typeof CHART_P1_TYPES)[number];
export type ChartP2Type = (typeof CHART_P2_TYPES)[number];
export type ChartType = (typeof CHART_ALL_TYPES)[number];

export const CHART_FENCE_LANGS = new Set(['chart', 'graph', 'viz', 'mermaid']);

export const MAX_CHART_ROWS = 500;
export const MAX_CHART_SERIES = 8;
export const MAX_PIE_SLICES = 8;
export const MAX_NETWORK_NODES = 80;
export const MAX_NETWORK_EDGES = 150;
export const DEFAULT_CHART_HEIGHT = 180;
export const MIN_CHART_HEIGHT = 40;
export const MAX_CHART_HEIGHT = 480;

const ScalarSchema = z.union([z.string(), z.number(), z.null()]);
const RowSchema = z.record(ScalarSchema);

const ChartTypeSchema = z.enum(CHART_ALL_TYPES);

const NodeSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(80).optional(),
  value: z.number().optional(),
  group: z.string().max(40).optional(),
});

const LinkSchema = z.object({
  source: z.string().min(1).max(64),
  target: z.string().min(1).max(64),
  value: z.number().optional(),
});

const TaskSchema = z.object({
  name: z.string().min(1).max(80),
  start: z.union([z.string(), z.number()]),
  end: z.union([z.string(), z.number()]),
  group: z.string().max(40).optional(),
  progress: z.number().min(0).max(100).optional(),
});

export const ChartSpecSchema = z.object({
  v: z.literal(1).optional().default(1),
  type: ChartTypeSchema,
  title: z.string().max(120).optional(),
  subtitle: z.string().max(200).optional(),
  unit: z.string().max(40).optional(),
  height: z.number().min(MIN_CHART_HEIGHT).max(MAX_CHART_HEIGHT).optional(),
  legend: z.boolean().optional(),
  xLabel: z.string().max(80).optional(),
  yLabel: z.string().max(80).optional(),
  xKey: z.string().min(1).max(64).optional(),
  yKey: z.string().min(1).max(64).optional(),
  nameKey: z.string().min(1).max(64).optional(),
  valueKey: z.string().min(1).max(64).optional(),
  errorKey: z.string().min(1).max(64).optional(),
  errorLowKey: z.string().min(1).max(64).optional(),
  errorHighKey: z.string().min(1).max(64).optional(),
  /** Extra numeric series keys for multi-series charts. */
  series: z.array(z.string().min(1).max(64)).max(MAX_CHART_SERIES).optional(),
  data: z.array(RowSchema).max(MAX_CHART_ROWS).optional().default([]),
  nodes: z.array(NodeSchema).max(MAX_NETWORK_NODES).optional(),
  links: z.array(LinkSchema).max(MAX_NETWORK_EDGES).optional(),
  tasks: z.array(TaskSchema).max(100).optional(),
  /** Mermaid / structural diagram source (types: mermaid, sequence, state, er, mindmap, org). */
  mermaid: z.string().max(12_000).optional(),
  /** Optional region id field for geo charts. */
  regionKey: z.string().min(1).max(64).optional(),
  latKey: z.string().min(1).max(64).optional(),
  lngKey: z.string().min(1).max(64).optional(),
}).superRefine((val, ctx) => {
  const mermaidTypes = new Set(['mermaid', 'sequence', 'state', 'er', 'mindmap', 'org']);
  const graphTypes = new Set(['sankey', 'network', 'chord', 'arc']);
  const taskTypes = new Set(['gantt']);
  if (mermaidTypes.has(val.type)) {
    if (!val.mermaid?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'mermaid-required', path: ['mermaid'] });
    }
    return;
  }
  if (graphTypes.has(val.type)) {
    if (!val.nodes?.length || !val.links?.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'nodes-links-required', path: ['nodes'] });
    }
    return;
  }
  if (taskTypes.has(val.type)) {
    if (!val.tasks?.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'tasks-required', path: ['tasks'] });
    }
    return;
  }
  if (!val.data?.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'data-required', path: ['data'] });
  }
});

export type ChartSpec = z.infer<typeof ChartSpecSchema>;

export type ChartParseResult =
  | { ok: true; spec: ChartSpec }
  | { ok: false; error: string };

function stripFenceNoise(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:chart|graph|viz|json|mermaid)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  return s;
}

/** True when fenced body looks like mid-stream / incomplete chart JSON (do not error yet). */
export function isIncompleteChartJson(code: string): boolean {
  const s = stripFenceNoise(code);
  if (!s || !s.startsWith('{')) return false;
  try {
    JSON.parse(s);
    return false;
  } catch {
    // Unclosed string/object while streaming — treat as incomplete, not fatal.
    return /[{[,]|"\s*$|:\s*$/.test(s) || (s.match(/{/g)?.length ?? 0) > (s.match(/}/g)?.length ?? 0);
  }
}

function looksLikeChartObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const t = (value as Record<string, unknown>)['type'];
  return typeof t === 'string' && (CHART_ALL_TYPES as readonly string[]).includes(t);
}

/** True when fenced body is (or likely is) a chart JSON spec. */
export function isChartSpecContent(code: string): boolean {
  const s = stripFenceNoise(code);
  if (!s.startsWith('{')) return false;
  try {
    const parsed: unknown = JSON.parse(s);
    return looksLikeChartObject(parsed);
  } catch {
    return false;
  }
}

/** Detect raw Mermaid source (non-JSON) for ```mermaid fences. */
export function isMermaidSource(code: string): boolean {
  const s = stripFenceNoise(code);
  if (s.startsWith('{')) return false;
  return /^(graph\s|flowchart\s|sequenceDiagram|stateDiagram|erDiagram|mindmap|gantt|classDiagram|journey|pie\s|gitGraph)/im.test(s);
}

export function mermaidSpecFromSource(code: string, type: ChartType = 'mermaid'): ChartSpec {
  return {
    v: 1,
    type,
    data: [],
    mermaid: stripFenceNoise(code),
  };
}

function inferSeriesKeys(spec: ChartSpec): string[] {
  if (spec.series && spec.series.length > 0) return spec.series.slice(0, MAX_CHART_SERIES);
  const xKey = spec.xKey ?? 'x';
  const yKey = spec.yKey ?? 'y';
  const nameKey = spec.nameKey ?? 'name';
  const valueKey = spec.valueKey ?? 'value';
  const reserved = new Set([
    xKey, nameKey, 'label', 'bin', 'min', 'q1', 'median', 'q3', 'max', 'low', 'high',
    'open', 'close', 'error', 'errorLow', 'errorHigh', 'z', 'lat', 'lng', 'region', 'weight',
  ]);

  const singleValue = new Set([
    'pie', 'donut', 'progress', 'heatmap', 'treemap', 'funnel', 'gauge', 'bullet',
    'waterfall', 'kpi_row', 'sparkline', 'sunburst', 'rose', 'waffle', 'wordcloud',
    'icon_array', 'geo_choropleth', 'geo_points', 'calendar_heatmap',
  ]);
  if (singleValue.has(spec.type)) return [valueKey];

  const multi = new Set([
    'bar_grouped', 'bar_stacked', 'bar_stacked_100', 'line_multi', 'area_stacked',
    'radar', 'stream', 'tornado',
  ]);
  if (multi.has(spec.type)) {
    const keys = new Set<string>();
    for (const row of spec.data ?? []) {
      for (const [k, v] of Object.entries(row)) {
        if (reserved.has(k)) continue;
        if (typeof v === 'number') keys.add(k);
      }
    }
    if (keys.size === 0 && typeof spec.data?.[0]?.[yKey] === 'number') keys.add(yKey);
    return [...keys].slice(0, MAX_CHART_SERIES);
  }
  return [yKey];
}

function groupPieOther(spec: ChartSpec): ChartSpec {
  if (spec.type !== 'pie' && spec.type !== 'donut' && spec.type !== 'rose') return spec;
  const nameKey = spec.nameKey ?? 'name';
  const valueKey = spec.valueKey ?? 'value';
  const data = spec.data ?? [];
  if (data.length <= MAX_PIE_SLICES) return spec;

  const sorted = [...data].sort((a, b) => {
    const av = typeof a[valueKey] === 'number' ? (a[valueKey] as number) : 0;
    const bv = typeof b[valueKey] === 'number' ? (b[valueKey] as number) : 0;
    return bv - av;
  });
  const head = sorted.slice(0, MAX_PIE_SLICES - 1);
  const rest = sorted.slice(MAX_PIE_SLICES - 1);
  const otherSum = rest.reduce((acc, row) => {
    const v = row[valueKey];
    return acc + (typeof v === 'number' ? v : 0);
  }, 0);
  return {
    ...spec,
    data: [...head, { [nameKey]: 'Other', [valueKey]: otherSum }],
  };
}

function sanitizeStrings(spec: ChartSpec): ChartSpec {
  const scrub = (s: string | undefined) => (s == null ? undefined : s.replace(/[<>]/g, '').trim() || undefined);
  return {
    ...spec,
    title: scrub(spec.title),
    subtitle: scrub(spec.subtitle),
    unit: scrub(spec.unit),
    xLabel: scrub(spec.xLabel),
    yLabel: scrub(spec.yLabel),
    mermaid: spec.mermaid?.slice(0, 12_000),
  };
}

function clampGraph(spec: ChartSpec): ChartSpec {
  return {
    ...spec,
    nodes: spec.nodes?.slice(0, MAX_NETWORK_NODES),
    links: spec.links?.slice(0, MAX_NETWORK_EDGES),
    tasks: spec.tasks?.slice(0, 100),
  };
}

/** Parse + sanitize a chart JSON body. */
export function parseChartSpec(code: string): ChartParseResult {
  const s = stripFenceNoise(code);
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return { ok: false, error: 'invalid-json' };
  }

  const result = ChartSpecSchema.safeParse(parsed);
  if (!result.success) {
    const msg = result.error.issues[0]?.message ?? 'invalid-spec';
    return { ok: false, error: msg };
  }

  let spec = sanitizeStrings(result.data);
  spec = clampGraph(spec);
  if (spec.data?.length) {
    const series = inferSeriesKeys(spec);
    spec = { ...spec, series };
    spec = groupPieOther(spec);
  }
  return { ok: true, spec };
}

const TYPE_LABELS: Record<string, string> = {
  bar: 'Bar',
  bar_horizontal: 'Bar',
  bar_grouped: 'Grouped bar',
  bar_stacked: 'Stacked bar',
  bar_stacked_100: '100% stacked',
  line: 'Line',
  line_multi: 'Line',
  line_step: 'Step',
  area: 'Area',
  area_stacked: 'Stacked area',
  area_range: 'Range',
  pie: 'Pie',
  donut: 'Donut',
  scatter: 'Scatter',
  scatter_fit: 'Scatter',
  bubble: 'Bubble',
  heatmap: 'Heatmap',
  histogram: 'Histogram',
  progress: 'Progress',
  radar: 'Radar',
  box: 'Box',
  treemap: 'Treemap',
  funnel: 'Funnel',
  gauge: 'Gauge',
  bullet: 'Bullet',
  waterfall: 'Waterfall',
  pareto: 'Pareto',
  sankey: 'Sankey',
  gantt: 'Gantt',
  timeline: 'Timeline',
  network: 'Network',
  slope: 'Slope',
  dumbbell: 'Dumbbell',
  kpi_row: 'KPI',
  sparkline: 'Sparkline',
  error_bar: 'Error bar',
  violin: 'Violin',
  density: 'Density',
  beeswarm: 'Beeswarm',
  stream: 'Stream',
  candlestick: 'Candlestick',
  calendar_heatmap: 'Calendar',
  sunburst: 'Sunburst',
  rose: 'Rose',
  waffle: 'Waffle',
  chord: 'Chord',
  arc: 'Arc',
  geo_choropleth: 'Map',
  geo_points: 'Map',
  wordcloud: 'Words',
  icon_array: 'Icons',
  lollipop: 'Lollipop',
  dot: 'Dot',
  pyramid: 'Pyramid',
  forest: 'Forest',
  control: 'Control',
  tornado: 'Tornado',
  hexbin: 'Hexbin',
  contour: 'Contour',
  qq: 'QQ',
  ecdf: 'ECDF',
  parallel: 'Parallel',
  circle_pack: 'Circle pack',
  mermaid: 'Diagram',
  sequence: 'Sequence',
  state: 'State',
  er: 'ER',
  mindmap: 'Mind map',
  org: 'Org',
};

export function chartBlockTitle(spec: ChartSpec): string {
  if (spec.title?.trim()) return spec.title.trim().slice(0, 48);
  return TYPE_LABELS[spec.type] ?? 'Chart';
}

export function resolveChartHeight(spec: ChartSpec): number {
  if (spec.height != null) return spec.height;
  if (spec.type === 'sparkline' || spec.type === 'kpi_row') return 56;
  if (spec.type === 'gantt' || spec.type === 'sankey' || spec.type === 'network') return 240;
  if (spec.type === 'mermaid' || spec.type === 'sequence' || spec.type === 'state' || spec.type === 'er' || spec.type === 'mindmap' || spec.type === 'org') return 280;
  if (spec.type === 'parallel' || spec.type === 'circle_pack') return 220;
  return DEFAULT_CHART_HEIGHT;
}

function sanitizeTableKey(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[<>]/g, '').trim().replace(/\s+/g, '_').slice(0, 64);
  return cleaned || fallback;
}

/** Infer a simple bar chart from a GFM-like table (header + numeric columns). */
export function chartSpecFromTable(
  headers: string[],
  rows: string[][],
): ChartSpec | null {
  if (headers.length < 2 || rows.length < 1) return null;
  const numericCols: number[] = [];
  for (let c = 1; c < headers.length; c++) {
    const ok = rows.every((r) => {
      const cell = (r[c] ?? '').replace(/[,$%]/g, '').trim();
      return cell === '' || Number.isFinite(Number(cell));
    });
    if (ok) numericCols.push(c);
  }
  if (numericCols.length === 0) return null;

  const labelHeader = sanitizeTableKey(headers[0] ?? '', 'x');
  const series = numericCols
    .map((c, i) => sanitizeTableKey(headers[c] ?? '', `c${i + 1}`))
    .slice(0, MAX_CHART_SERIES);
  const data = rows.slice(0, MAX_CHART_ROWS).map((r) => {
    const row: Record<string, string | number | null> = { x: (r[0] ?? '').trim() };
    numericCols.slice(0, MAX_CHART_SERIES).forEach((c, i) => {
      const key = series[i]!;
      const raw = (r[c] ?? '').replace(/[,$%]/g, '').trim();
      row[key] = raw === '' ? null : Number(raw);
    });
    return row;
  });

  const type = series.length > 1 ? 'bar_grouped' : 'bar';
  return {
    v: 1,
    type,
    title: (headers[0] ?? '').trim().slice(0, 48) || labelHeader,
    xKey: 'x',
    yKey: series[0],
    series,
    data,
    legend: series.length > 1,
  };
}
