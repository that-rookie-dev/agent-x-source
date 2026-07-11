import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Treemap,
  FunnelChart,
  Funnel,
  LabelList,
  Sankey,
  ComposedChart,
  ErrorBar,
  type TooltipProps,
} from 'recharts';
import type { ChartSpec } from '@agentx/shared/browser';
import { colors } from '../theme';
import { CODE_BLOCK_TOKENS } from './code-block-chrome';
import {
  SERIES_COLORS,
  num,
  str,
  GaugeChart,
  BulletChart,
  KpiRow,
  WaterfallBars,
  GanttChart,
  TimelineChart,
  NetworkGraph,
  BoxPlot,
  SlopeDumbbell,
  WaffleChart,
  WordCloud,
  CandlestickChart,
  GeoPoints,
  ChordArc,
  IconArray,
  ViolinDensity,
  ParallelCoords,
  CirclePack,
  FallbackNote,
} from './ChartCustom';

const AXIS_TICK = {
  fill: colors.text.dim,
  fontSize: 10,
  fontFamily: "'JetBrains Mono', monospace",
} as const;

const GRID_STROKE = colors.border.subtle;
const TOOLTIP_STYLE = {
  backgroundColor: colors.bg.elevated,
  border: `1px solid ${colors.border.default}`,
  borderRadius: 4,
  fontSize: CODE_BLOCK_TOKENS.sansFontSize,
  fontFamily: "'JetBrains Mono', monospace",
  color: colors.text.secondary,
  padding: '4px 8px',
} as const;

function ChartTooltip(props: TooltipProps<number, string>) {
  const { active, payload, label } = props;
  if (!active || !payload?.length) return null;
  return (
    <Box sx={TOOLTIP_STYLE}>
      {label != null && label !== '' && (
        <Typography sx={{ fontSize: 'inherit', fontFamily: 'inherit', color: colors.text.primary, mb: 0.25 }}>
          {String(label)}
        </Typography>
      )}
      {payload.map((p: { dataKey?: string | number; name?: string; value?: number | string; color?: string }) => (
        <Typography key={String(p.dataKey)} sx={{ fontSize: 'inherit', fontFamily: 'inherit', color: p.color ?? colors.text.secondary }}>
          {p.name}: {typeof p.value === 'number' ? p.value : String(p.value ?? '')}
        </Typography>
      ))}
    </Box>
  );
}

function ProgressBar({ spec }: { spec: ChartSpec }) {
  const valueKey = spec.valueKey ?? 'value';
  const row = spec.data?.[0] ?? {};
  const value = num(row, valueKey);
  const maxRaw = row['max'];
  const max = typeof maxRaw === 'number' && maxRaw > 0 ? maxRaw : 100;
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <Box sx={{ py: 0.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography sx={{ fontSize: '0.68rem', color: colors.text.secondary, fontFamily: "'Inter', sans-serif" }}>
          {str(row, spec.nameKey ?? 'name') || spec.title || 'Progress'}
        </Typography>
        <Typography sx={{ fontSize: '0.68rem', color: colors.text.primary, fontFamily: "'JetBrains Mono', monospace" }}>
          {value}{spec.unit ? ` ${spec.unit}` : ''} / {max}
        </Typography>
      </Box>
      <Box sx={{ height: 8, borderRadius: 1, bgcolor: colors.bg.tertiary, border: `1px solid ${colors.border.subtle}`, overflow: 'hidden' }}>
        <Box sx={{
          width: `${pct}%`, height: '100%', bgcolor: colors.accent.blue,
          transition: 'width 0.35s ease',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        }} />
      </Box>
    </Box>
  );
}

function HeatmapGrid({ spec, height }: { spec: ChartSpec; height: number }) {
  const xKey = spec.xKey ?? 'x';
  const yKey = spec.yKey ?? 'y';
  const valueKey = spec.valueKey ?? 'value';
  const data = spec.data ?? [];
  if (data.length === 0) return <FallbackNote label="Heatmap needs data" />;
  const xs = [...new Set(data.map((r) => str(r, xKey)))];
  const ys = [...new Set(data.map((r) => str(r, yKey)))];
  const values = data.map((r) => num(r, valueKey));
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const lookup = new Map(data.map((r) => [`${str(r, xKey)}|${str(r, yKey)}`, num(r, valueKey)]));

  return (
    <Box sx={{ height, overflow: 'auto' }}>
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: `auto repeat(${Math.max(xs.length, 1)}, minmax(28px, 1fr))`,
        gap: '2px',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '0.58rem',
      }}>
        <Box />
        {xs.map((x) => (
          <Box key={x} sx={{ color: colors.text.dim, textAlign: 'center', pb: 0.25, overflow: 'hidden', textOverflow: 'ellipsis' }}>{x}</Box>
        ))}
        {ys.map((y) => (
          <Box key={y} sx={{ display: 'contents' }}>
            <Box sx={{ color: colors.text.dim, pr: 0.5, display: 'flex', alignItems: 'center' }}>{y}</Box>
            {xs.map((x) => {
              const v = lookup.get(`${x}|${y}`) ?? 0;
              const t = max === min ? 0.5 : (v - min) / (max - min);
              return (
                <Box key={`${x}-${y}`} title={`${x}, ${y}: ${v}`} sx={{
                  height: 22, borderRadius: 0.5, bgcolor: colors.accent.blue,
                  opacity: 0.15 + t * 0.85, border: `1px solid ${colors.border.subtle}`,
                }} />
              );
            })}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function linearFit(points: { x: number; y: number }[]): { m: number; b: number } | null {
  if (points.length < 2) return null;
  const n = points.length;
  const sx = points.reduce((a, p) => a + p.x, 0);
  const sy = points.reduce((a, p) => a + p.y, 0);
  const sxy = points.reduce((a, p) => a + p.x * p.y, 0);
  const sx2 = points.reduce((a, p) => a + p.x * p.x, 0);
  const den = n * sx2 - sx * sx;
  if (Math.abs(den) < 1e-9) return null;
  const m = (n * sxy - sx * sy) / den;
  const b = (sy - m * sx) / n;
  return { m, b };
}

export function ChartRenderer({ spec, height }: { spec: ChartSpec; height: number }) {
  const xKey = spec.xKey ?? 'x';
  const yKey = spec.yKey ?? 'y';
  const nameKey = spec.nameKey ?? 'name';
  const valueKey = spec.valueKey ?? 'value';
  const series = spec.series?.length ? spec.series : [yKey];
  const showLegend = spec.legend ?? series.length > 1;
  const data = spec.data ?? [];
  const commonMargin = { top: 8, right: 8, left: 0, bottom: 4 };

  // ── Custom / structural ──────────────────────────────────────
  if (spec.type === 'progress') return <ProgressBar spec={spec} />;
  if (spec.type === 'heatmap' || spec.type === 'calendar_heatmap') return <HeatmapGrid spec={spec} height={height} />;
  if (spec.type === 'gauge') return <GaugeChart spec={spec} height={height} />;
  if (spec.type === 'bullet') return <BulletChart spec={spec} height={height} />;
  if (spec.type === 'kpi_row') return <KpiRow spec={spec} />;
  if (spec.type === 'waterfall') return <WaterfallBars spec={spec} height={height} />;
  if (spec.type === 'gantt') return <GanttChart spec={spec} height={height} />;
  if (spec.type === 'timeline') return <TimelineChart spec={spec} height={height} />;
  if (spec.type === 'network') return <NetworkGraph spec={spec} height={height} />;
  if (spec.type === 'box') return <BoxPlot spec={spec} height={height} />;
  if (spec.type === 'slope') return <SlopeDumbbell spec={spec} height={height} mode="slope" />;
  if (spec.type === 'dumbbell') return <SlopeDumbbell spec={spec} height={height} mode="dumbbell" />;
  if (spec.type === 'waffle') return <WaffleChart spec={spec} height={height} />;
  if (spec.type === 'wordcloud') return <WordCloud spec={spec} height={height} />;
  if (spec.type === 'candlestick') return <CandlestickChart spec={spec} height={height} />;
  if (spec.type === 'geo_points' || spec.type === 'geo_choropleth') return <GeoPoints spec={spec} height={height} />;
  if (spec.type === 'chord') return <ChordArc spec={spec} height={height} mode="chord" />;
  if (spec.type === 'arc') return <ChordArc spec={spec} height={height} mode="arc" />;
  if (spec.type === 'icon_array') return <IconArray spec={spec} height={height} />;
  if (spec.type === 'parallel') return <ParallelCoords spec={spec} height={height} />;
  if (spec.type === 'circle_pack') return <CirclePack spec={spec} height={height} />;
  if (spec.type === 'violin' || spec.type === 'density' || spec.type === 'beeswarm' || spec.type === 'hexbin' || spec.type === 'contour' || spec.type === 'qq' || spec.type === 'ecdf') {
    return <ViolinDensity spec={spec} height={height} />;
  }
  if (spec.type === 'pyramid' || spec.type === 'tornado') {
    return (
      <Box sx={{ width: '100%', height }} role="img" aria-label={spec.title ?? spec.type}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={commonMargin} stackOffset={spec.type === 'tornado' ? 'sign' : undefined}>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} />
            <YAxis type="category" dataKey={nameKey !== 'name' ? nameKey : xKey} tick={AXIS_TICK} tickLine={false} width={64} />
            <Tooltip content={<ChartTooltip />} />
            {series.map((key, i) => (
              <Bar key={key} dataKey={key} fill={SERIES_COLORS[i % SERIES_COLORS.length]} maxBarSize={16} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </Box>
    );
  }
  if (spec.type === 'lollipop' || spec.type === 'dot' || spec.type === 'forest' || spec.type === 'control') {
    return (
      <Box sx={{ width: '100%', height }} role="img" aria-label={spec.title ?? spec.type}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={commonMargin}>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
            <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} />
            <YAxis tick={AXIS_TICK} tickLine={false} width={36} />
            <Tooltip content={<ChartTooltip />} />
            <Line type="monotone" dataKey={yKey} stroke={SERIES_COLORS[0]} strokeWidth={1} dot={{ r: 4 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
    );
  }

  // Inline transforms (no hooks) so early returns above stay Rules-of-Hooks safe.
  const pieData = data.map((row) => ({
    name: str(row, nameKey) || str(row, xKey),
    value: num(row, valueKey) || num(row, yKey),
  }));

  const scatterData = data.map((row) => ({
    x: num(row, xKey),
    y: num(row, yKey),
    z: typeof row['z'] === 'number' ? row['z'] : (spec.type === 'bubble' ? Math.max(num(row, valueKey), 8) : 40),
    name: str(row, nameKey),
  }));

  let fitLine: { x: number; y: number }[] | null = null;
  if (spec.type === 'scatter_fit') {
    const fit = linearFit(scatterData);
    if (fit && scatterData.length >= 2) {
      const xs = scatterData.map((p) => p.x);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      if (Number.isFinite(minX) && Number.isFinite(maxX)) {
        fitLine = [
          { x: minX, y: fit.m * minX + fit.b },
          { x: maxX, y: fit.m * maxX + fit.b },
        ];
      }
    }
  }

  if (spec.type === 'pie' || spec.type === 'donut' || spec.type === 'rose' || spec.type === 'sunburst') {
    const inner = spec.type === 'donut' ? '55%' : 0;
    return (
      <Box sx={{ width: '100%', height }} role="img" aria-label={spec.title ?? 'Pie chart'}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={inner}
              outerRadius={spec.type === 'rose' ? '70%' : '75%'}
              paddingAngle={1}
              stroke={colors.bg.primary}
              strokeWidth={1}
              isAnimationActive={false}
            >
              {pieData.map((_, i) => (
                <Cell key={i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
            {(showLegend || pieData.length <= 6) && (
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }} iconSize={8} />
            )}
          </PieChart>
        </ResponsiveContainer>
      </Box>
    );
  }

  if (spec.type === 'scatter' || spec.type === 'bubble' || spec.type === 'scatter_fit') {
    return (
      <Box sx={{ width: '100%', height }} role="img" aria-label={spec.title ?? 'Scatter chart'}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={commonMargin}>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
            <XAxis type="number" dataKey="x" name={spec.xLabel ?? xKey} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} />
            <YAxis type="number" dataKey="y" name={spec.yLabel ?? yKey} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} width={36} />
            <ZAxis type="number" dataKey="z" range={spec.type === 'bubble' ? [40, 200] : [40, 40]} />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<ChartTooltip />} />
            <Scatter data={scatterData} fill={SERIES_COLORS[0]} isAnimationActive={false} />
            {fitLine && (
              <Scatter
                data={fitLine}
                line={{ stroke: colors.accent.orange, strokeWidth: 1.5 }}
                shape={() => <g />}
                legendType="none"
                isAnimationActive={false}
              />
            )}
          </ScatterChart>
        </ResponsiveContainer>
      </Box>
    );
  }

  if (spec.type === 'radar') {
    return (
      <Box sx={{ width: '100%', height }} role="img" aria-label={spec.title ?? 'Radar'}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
            <PolarGrid stroke={GRID_STROKE} />
            <PolarAngleAxis dataKey={nameKey !== 'name' ? nameKey : xKey} tick={AXIS_TICK} />
            <PolarRadiusAxis tick={AXIS_TICK} />
            <Tooltip content={<ChartTooltip />} />
            {series.map((key, i) => (
              <Radar key={key} name={key} dataKey={key} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} fill={SERIES_COLORS[i % SERIES_COLORS.length]} fillOpacity={0.2} isAnimationActive={false} />
            ))}
            {showLegend && <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />}
          </RadarChart>
        </ResponsiveContainer>
      </Box>
    );
  }

  if (spec.type === 'treemap') {
    const treeData = data.map((row) => ({
      name: str(row, nameKey) || str(row, xKey),
      size: num(row, valueKey) || num(row, yKey),
    }));
    return (
      <Box sx={{ width: '100%', height }} role="img" aria-label={spec.title ?? 'Treemap'}>
        <ResponsiveContainer width="100%" height="100%">
          <Treemap data={treeData} dataKey="size" nameKey="name" stroke={colors.bg.primary} fill={SERIES_COLORS[0]} isAnimationActive={false}>
            <Tooltip content={<ChartTooltip />} />
          </Treemap>
        </ResponsiveContainer>
      </Box>
    );
  }

  if (spec.type === 'funnel') {
    const funnelData = data.map((row) => ({
      name: str(row, nameKey) || str(row, xKey),
      value: num(row, valueKey) || num(row, yKey),
    }));
    return (
      <Box sx={{ width: '100%', height }} role="img" aria-label={spec.title ?? 'Funnel'}>
        <ResponsiveContainer width="100%" height="100%">
          <FunnelChart>
            <Tooltip content={<ChartTooltip />} />
            <Funnel dataKey="value" data={funnelData} isAnimationActive={false}>
              <LabelList position="right" fill={colors.text.secondary} stroke="none" dataKey="name" style={{ fontSize: 10 }} />
              {funnelData.map((_, i) => (
                <Cell key={i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
              ))}
            </Funnel>
          </FunnelChart>
        </ResponsiveContainer>
      </Box>
    );
  }

  if (spec.type === 'sankey') {
    const nodes = (spec.nodes ?? []).map((n) => ({ name: n.name ?? n.id }));
    const idToIndex = new Map((spec.nodes ?? []).map((n, i) => [n.id, i]));
    const links = (spec.links ?? [])
      .map((l) => ({
        source: idToIndex.get(l.source),
        target: idToIndex.get(l.target),
        value: Math.max(l.value ?? 1, 0.01),
      }))
      .filter((l): l is { source: number; target: number; value: number } =>
        l.source != null && l.target != null && l.source !== l.target);
    if (nodes.length < 2 || links.length === 0) {
      return <FallbackNote label="Sankey needs valid nodes and links" />;
    }
    return (
      <Box sx={{ width: '100%', height }} role="img" aria-label={spec.title ?? 'Sankey'}>
        <ResponsiveContainer width="100%" height="100%">
          <Sankey
            data={{ nodes, links }}
            nodePadding={12}
            nodeWidth={8}
            linkCurvature={0.5}
            iterations={32}
          >
            <Tooltip content={<ChartTooltip />} />
          </Sankey>
        </ResponsiveContainer>
      </Box>
    );
  }

  if (spec.type === 'pareto') {
    const sorted = [...data].sort((a, b) => num(b, yKey) - num(a, yKey));
    const total = sorted.reduce((a, r) => a + num(r, yKey), 0) || 1;
    let cum = 0;
    const paretoData = sorted.map((row) => {
      cum += num(row, yKey);
      return { ...row, cumulative: Math.round((cum / total) * 1000) / 10 };
    });
    return (
      <Box sx={{ width: '100%', height }} role="img" aria-label={spec.title ?? 'Pareto'}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={paretoData} margin={commonMargin}>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
            <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} />
            <YAxis yAxisId="l" tick={AXIS_TICK} width={36} />
            <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={AXIS_TICK} width={28} />
            <Tooltip content={<ChartTooltip />} />
            <Bar yAxisId="l" dataKey={yKey} fill={SERIES_COLORS[0]} maxBarSize={28} isAnimationActive={false} />
            <Line yAxisId="r" type="monotone" dataKey="cumulative" stroke={SERIES_COLORS[1]} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
    );
  }

  if (spec.type === 'error_bar' || spec.type === 'area_range') {
    const errKey = spec.errorKey ?? 'error';
    return (
      <Box sx={{ width: '100%', height }} role="img" aria-label={spec.title ?? 'Error bar'}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={commonMargin}>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
            <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} />
            <YAxis tick={AXIS_TICK} width={36} />
            <Tooltip content={<ChartTooltip />} />
            {spec.type === 'area_range' && (
              <Area type="monotone" dataKey="high" stroke="none" fill={SERIES_COLORS[0]} fillOpacity={0.15} isAnimationActive={false} />
            )}
            <Line type="monotone" dataKey={yKey} stroke={SERIES_COLORS[0]} strokeWidth={1.5} dot={{ r: 2.5 }} isAnimationActive={false}>
              {spec.type === 'error_bar' && <ErrorBar dataKey={errKey} width={4} stroke={colors.text.dim} />}
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
    );
  }

  const isHorizontal = spec.type === 'bar_horizontal';
  const isStacked = spec.type === 'bar_stacked' || spec.type === 'bar_stacked_100' || spec.type === 'area_stacked' || spec.type === 'stream';
  const isBar = spec.type === 'bar' || spec.type === 'bar_horizontal' || spec.type === 'bar_grouped' || spec.type === 'bar_stacked' || spec.type === 'bar_stacked_100' || spec.type === 'histogram';
  const isArea = spec.type === 'area' || spec.type === 'area_stacked' || spec.type === 'stream';
  const isLine = spec.type === 'line' || spec.type === 'line_multi' || spec.type === 'line_step' || spec.type === 'sparkline';
  const stackOffset = spec.type === 'bar_stacked_100' ? 'expand' : undefined;
  const lineType = spec.type === 'line_step' ? 'stepAfter' : 'monotone';

  if (isBar) {
    return (
      <Box sx={{ width: '100%', height }} role="img" aria-label={spec.title ?? 'Bar chart'}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout={isHorizontal ? 'vertical' : 'horizontal'} margin={commonMargin} barCategoryGap="18%" stackOffset={stackOffset}>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" horizontal={!isHorizontal} vertical={isHorizontal} />
            {isHorizontal ? (
              <>
                <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} />
                <YAxis type="category" dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} width={56} />
              </>
            ) : (
              <>
                <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} interval="preserveStartEnd" />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} width={36} />
              </>
            )}
            <Tooltip content={<ChartTooltip />} />
            {showLegend && <Legend wrapperStyle={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }} iconSize={8} />}
            {series.map((key, i) => (
              <Bar
                key={key}
                dataKey={key}
                stackId={isStacked ? 's' : undefined}
                fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                radius={isStacked ? 0 : [2, 2, 0, 0]}
                maxBarSize={28}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </Box>
    );
  }

  if (isArea) {
    return (
      <Box sx={{ width: '100%', height }} role="img" aria-label={spec.title ?? 'Area chart'}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={commonMargin} stackOffset={spec.type === 'stream' ? 'silhouette' : stackOffset}>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
            <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} interval="preserveStartEnd" />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} width={36} />
            <Tooltip content={<ChartTooltip />} />
            {showLegend && <Legend wrapperStyle={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }} iconSize={8} />}
            {series.map((key, i) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stackId={isStacked ? 's' : undefined}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                fillOpacity={0.18}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </Box>
    );
  }

  if (isLine) {
    const spark = spec.type === 'sparkline';
    return (
      <Box sx={{ width: '100%', height }} role="img" aria-label={spec.title ?? 'Line chart'}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={spark ? { top: 4, right: 4, left: 4, bottom: 4 } : commonMargin}>
            {!spark && <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />}
            {!spark && <XAxis dataKey={xKey} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} interval="preserveStartEnd" />}
            {!spark && <YAxis tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} width={36} />}
            <Tooltip content={<ChartTooltip />} />
            {!spark && showLegend && <Legend wrapperStyle={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }} iconSize={8} />}
            {series.map((key, i) => (
              <Line
                key={key}
                type={lineType}
                dataKey={key}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth={spark ? 1.25 : 1.5}
                dot={spark ? false : { r: 2.5, strokeWidth: 0 }}
                activeDot={spark ? false : { r: 3.5 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </Box>
    );
  }

  return <FallbackNote label={`Unsupported chart type: ${spec.type}`} />;
}
