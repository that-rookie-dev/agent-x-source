import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ChartSpec } from '@agentx/shared/browser';
import { colors } from '../theme';
import { CODE_BLOCK_TOKENS } from './code-block-chrome';

export const SERIES_COLORS = [
  colors.accent.blue,
  colors.accent.green,
  colors.accent.orange,
  colors.accent.cyan,
  colors.accent.purple,
  colors.accent.red,
  colors.text.secondary,
  colors.text.tertiary,
] as const;

export function num(row: Record<string, string | number | null>, key: string): number {
  const v = row[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function str(row: Record<string, string | number | null>, key: string): string {
  const v = row[key];
  if (v == null) return '';
  return String(v);
}

export function GaugeChart({ spec, height }: { spec: ChartSpec; height: number }) {
  const valueKey = spec.valueKey ?? 'value';
  const row = spec.data?.[0] ?? {};
  const value = num(row, valueKey);
  const max = typeof row['max'] === 'number' && row['max'] > 0 ? row['max'] : 100;
  const pct = Math.max(0, Math.min(1, value / max));
  const r = 54;
  const c = 2 * Math.PI * r * 0.75;
  const dash = c * pct;
  return (
    <Box sx={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }} role="img" aria-label={spec.title ?? 'Gauge'}>
      <svg width="140" height={Math.min(height, 120)} viewBox="0 0 140 100">
        <path d="M20 80 A54 54 0 1 1 120 80" fill="none" stroke={colors.border.subtle} strokeWidth="10" strokeLinecap="round" />
        <path
          d="M20 80 A54 54 0 1 1 120 80"
          fill="none"
          stroke={colors.accent.blue}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
        />
        <text x="70" y="72" textAnchor="middle" fill={colors.text.primary} fontSize="16" fontFamily="JetBrains Mono, monospace">
          {Math.round(pct * 100)}%
        </text>
      </svg>
    </Box>
  );
}

export function BulletChart({ spec, height }: { spec: ChartSpec; height: number }) {
  const row = spec.data?.[0] ?? {};
  const value = num(row, spec.valueKey ?? 'value');
  const target = num(row, 'target') || 100;
  const max = Math.max(num(row, 'max') || target * 1.2, value, target);
  const poor = num(row, 'poor') || max * 0.4;
  const ok = num(row, 'ok') || max * 0.7;
  return (
    <Box sx={{ height, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 0.5 }} role="img" aria-label={spec.title ?? 'Bullet'}>
      <Box sx={{ position: 'relative', height: 18, borderRadius: 0.5, overflow: 'hidden', bgcolor: colors.bg.tertiary }}>
        <Box sx={{ position: 'absolute', inset: 0, width: `${(poor / max) * 100}%`, bgcolor: colors.accent.red, opacity: 0.25 }} />
        <Box sx={{ position: 'absolute', inset: 0, width: `${(ok / max) * 100}%`, bgcolor: colors.accent.orange, opacity: 0.2 }} />
        <Box sx={{ position: 'absolute', left: 0, top: 5, height: 8, width: `${(value / max) * 100}%`, bgcolor: colors.accent.blue, borderRadius: 0.5 }} />
        <Box sx={{ position: 'absolute', left: `${(target / max) * 100}%`, top: 2, width: 2, height: 14, bgcolor: colors.text.primary }} />
      </Box>
      <Typography sx={{ fontSize: '0.62rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
        {value} / target {target}
      </Typography>
    </Box>
  );
}

export function KpiRow({ spec }: { spec: ChartSpec }) {
  const nameKey = spec.nameKey ?? 'name';
  const valueKey = spec.valueKey ?? 'value';
  const items = (spec.data ?? []).slice(0, 6);
  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', py: 0.25 }} role="img" aria-label={spec.title ?? 'KPI'}>
      {items.map((row, i) => (
        <Box key={i} sx={{
          flex: '1 1 72px',
          minWidth: 72,
          px: 1,
          py: 0.6,
          borderRadius: 0.75,
          border: `1px solid ${colors.border.subtle}`,
          bgcolor: colors.bg.secondary,
        }}>
          <Typography sx={{ fontSize: '0.58rem', color: colors.text.dim, fontFamily: "'Inter', sans-serif" }}>
            {str(row, nameKey) || str(row, 'x') || `KPI ${i + 1}`}
          </Typography>
          <Typography sx={{ fontSize: '0.85rem', color: SERIES_COLORS[i % SERIES_COLORS.length], fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
            {row[valueKey] ?? row['y'] ?? '—'}
            {spec.unit ? <Box component="span" sx={{ fontSize: '0.58rem', ml: 0.35, color: colors.text.dim }}>{spec.unit}</Box> : null}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

export function WaterfallBars({ spec, height }: { spec: ChartSpec; height: number }) {
  const xKey = spec.xKey ?? 'x';
  const yKey = spec.yKey ?? 'y';
  const data = spec.data ?? [];
  let running = 0;
  const bars = data.map((row) => {
    const delta = num(row, yKey);
    const start = running;
    running += delta;
    return { label: str(row, xKey), delta, start, end: running, positive: delta >= 0 };
  });
  const min = Math.min(0, ...bars.map((b) => Math.min(b.start, b.end)));
  const max = Math.max(0, ...bars.map((b) => Math.max(b.start, b.end)), 1);
  const span = max - min || 1;
  return (
    <Box sx={{ height, display: 'flex', alignItems: 'flex-end', gap: 0.5, px: 0.5 }} role="img" aria-label={spec.title ?? 'Waterfall'}>
      {bars.map((b, i) => {
        const top = ((max - Math.max(b.start, b.end)) / span) * 100;
        const h = (Math.abs(b.delta) / span) * 100;
        return (
          <Box key={i} sx={{ flex: 1, height: '100%', position: 'relative', minWidth: 12 }}>
            <Box sx={{
              position: 'absolute',
              left: '15%',
              width: '70%',
              top: `${top}%`,
              height: `${Math.max(h, 1.5)}%`,
              bgcolor: b.positive ? colors.accent.green : colors.accent.red,
              borderRadius: 0.5,
              opacity: 0.85,
            }} title={`${b.label}: ${b.delta}`} />
            <Typography sx={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              fontSize: '0.5rem', color: colors.text.dim, textAlign: 'center',
              fontFamily: "'JetBrains Mono', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{b.label}</Typography>
          </Box>
        );
      })}
    </Box>
  );
}

export function GanttChart({ spec, height }: { spec: ChartSpec; height: number }) {
  const tasks = spec.tasks ?? [];
  if (tasks.length === 0) return <FallbackNote label="Gantt needs tasks" />;
  const toNum = (v: string | number) => (typeof v === 'number' ? v : Date.parse(v) || Number(v) || 0);
  const starts = tasks.map((t) => toNum(t.start));
  const ends = tasks.map((t) => toNum(t.end));
  const min = Math.min(...starts);
  const max = Math.max(...ends, min + 1);
  const span = max - min || 1;
  return (
    <Box sx={{ height, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.45 }} role="img" aria-label={spec.title ?? 'Gantt'}>
      {tasks.map((t, i) => {
        const s = toNum(t.start);
        const e = toNum(t.end);
        const left = ((s - min) / span) * 100;
        const width = Math.max(((e - s) / span) * 100, 1.5);
        return (
          <Box key={i} sx={{ display: 'grid', gridTemplateColumns: '88px 1fr', gap: 0.75, alignItems: 'center' }}>
            <Typography sx={{ fontSize: '0.62rem', color: colors.text.secondary, fontFamily: "'JetBrains Mono', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.name}
            </Typography>
            <Box sx={{ position: 'relative', height: 12, bgcolor: colors.bg.tertiary, borderRadius: 0.5 }}>
              <Box sx={{
                position: 'absolute', left: `${left}%`, width: `${width}%`, top: 0, bottom: 0,
                bgcolor: SERIES_COLORS[i % SERIES_COLORS.length], borderRadius: 0.5, opacity: 0.85,
              }} />
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export function TimelineChart({ spec, height }: { spec: ChartSpec; height: number }) {
  const xKey = spec.xKey ?? 'x';
  const nameKey = spec.nameKey ?? 'name';
  const items = (spec.data ?? []).slice(0, 24);
  if (items.length === 0) return <FallbackNote label="Timeline needs data" />;
  return (
    <Box sx={{ height, overflowY: 'auto', position: 'relative', pl: 1.5 }} role="img" aria-label={spec.title ?? 'Timeline'}>
      <Box sx={{ position: 'absolute', left: 6, top: 4, bottom: 4, width: 2, bgcolor: colors.border.subtle }} />
      {items.map((row, i) => (
        <Box key={i} sx={{ position: 'relative', mb: 1, pl: 1.25 }}>
          <Box sx={{
            position: 'absolute', left: -1.5, top: 4, width: 8, height: 8, borderRadius: '50%',
            bgcolor: SERIES_COLORS[i % SERIES_COLORS.length], border: `1px solid ${colors.bg.primary}`,
          }} />
          <Typography sx={{ fontSize: '0.58rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
            {str(row, xKey)}
          </Typography>
          <Typography sx={{ fontSize: '0.68rem', color: colors.text.secondary, fontFamily: "'Inter', sans-serif" }}>
            {str(row, nameKey) || str(row, 'label') || str(row, 'y')}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

export function NetworkGraph({ spec, height }: { spec: ChartSpec; height: number }) {
  const nodes = spec.nodes ?? [];
  const links = spec.links ?? [];
  if (nodes.length === 0) return <FallbackNote label="Network needs nodes" />;
  const w = 320;
  const h = Math.max(height, 160);
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * 0.36;
  const pos = new Map(nodes.map((n, i) => {
    const a = (i / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
    return [n.id, { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, name: n.name ?? n.id }];
  }));
  return (
    <Box sx={{ height, overflow: 'hidden' }} role="img" aria-label={spec.title ?? 'Network'}>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`}>
        {links.map((l, i) => {
          const a = pos.get(l.source);
          const b = pos.get(l.target);
          if (!a || !b) return null;
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={colors.border.default} strokeWidth={1} opacity={0.7} />;
        })}
        {nodes.map((n, i) => {
          const p = pos.get(n.id);
          if (!p) return null;
          return (
            <g key={n.id}>
              <circle cx={p.x} cy={p.y} r={8} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
              <text x={p.x} y={p.y + 16} textAnchor="middle" fill={colors.text.dim} fontSize="8" fontFamily="JetBrains Mono, monospace">
                {(n.name ?? n.id).slice(0, 10)}
              </text>
            </g>
          );
        })}
      </svg>
    </Box>
  );
}

export function BoxPlot({ spec, height }: { spec: ChartSpec; height: number }) {
  const nameKey = spec.nameKey ?? 'name';
  const groups = (spec.data ?? []).slice(0, 8);
  return (
    <Box sx={{ height, display: 'flex', alignItems: 'stretch', gap: 1, px: 0.5 }} role="img" aria-label={spec.title ?? 'Box plot'}>
      {groups.map((row, i) => {
        const minV = num(row, 'min');
        const q1 = num(row, 'q1');
        const med = num(row, 'median');
        const q3 = num(row, 'q3');
        const maxV = num(row, 'max');
        const lo = Math.min(minV, q1, med, q3, maxV);
        const hi = Math.max(minV, q1, med, q3, maxV, lo + 1);
        const span = hi - lo;
        const y = (v: number) => ((hi - v) / span) * 100;
        return (
          <Box key={i} sx={{ flex: 1, position: 'relative', bgcolor: colors.bg.secondary, borderRadius: 0.5, border: `1px solid ${colors.border.subtle}` }}>
            <Box sx={{ position: 'absolute', left: '50%', width: 1, top: `${y(maxV)}%`, bottom: `${100 - y(minV)}%`, bgcolor: colors.text.dim }} />
            <Box sx={{
              position: 'absolute', left: '25%', width: '50%',
              top: `${y(q3)}%`, height: `${Math.max(((q3 - q1) / span) * 100, 2)}%`,
              bgcolor: SERIES_COLORS[i % SERIES_COLORS.length], opacity: 0.35, border: `1px solid ${SERIES_COLORS[i % SERIES_COLORS.length]}`,
            }} />
            <Box sx={{ position: 'absolute', left: '20%', width: '60%', top: `${y(med)}%`, height: 2, bgcolor: colors.text.primary }} />
            <Typography sx={{ position: 'absolute', bottom: 2, left: 0, right: 0, textAlign: 'center', fontSize: '0.5rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
              {str(row, nameKey) || str(row, 'x')}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

export function SlopeDumbbell({ spec, height, mode }: { spec: ChartSpec; height: number; mode: 'slope' | 'dumbbell' }) {
  const nameKey = spec.nameKey ?? 'name';
  const aKey = spec.series?.[0] ?? 'a';
  const bKey = spec.series?.[1] ?? 'b';
  const rows = (spec.data ?? []).slice(0, 12);
  const vals = rows.flatMap((r) => [num(r, aKey), num(r, bKey)]);
  const min = Math.min(...vals, 0);
  const max = Math.max(...vals, 1);
  const span = max - min || 1;
  const x = (v: number) => ((v - min) / span) * 100;
  return (
    <Box sx={{ height, display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly', gap: 0.35 }} role="img" aria-label={spec.title ?? mode}>
      {rows.map((row, i) => {
        const a = num(row, aKey);
        const b = num(row, bKey);
        return (
          <Box key={i} sx={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 0.75, alignItems: 'center' }}>
            <Typography sx={{ fontSize: '0.58rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {str(row, nameKey) || str(row, 'x')}
            </Typography>
            <Box sx={{ position: 'relative', height: mode === 'slope' ? 14 : 10 }}>
              <Box sx={{ position: 'absolute', left: `${x(a)}%`, right: `${100 - x(b)}%`, top: '45%', height: 2, bgcolor: colors.border.default }} />
              <Box sx={{ position: 'absolute', left: `${x(a)}%`, top: 2, width: 8, height: 8, ml: '-4px', borderRadius: '50%', bgcolor: colors.accent.blue }} />
              <Box sx={{ position: 'absolute', left: `${x(b)}%`, top: 2, width: 8, height: 8, ml: '-4px', borderRadius: '50%', bgcolor: colors.accent.orange }} />
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export function WaffleChart({ spec, height }: { spec: ChartSpec; height: number }) {
  const valueKey = spec.valueKey ?? 'value';
  const nameKey = spec.nameKey ?? 'name';
  const data = (spec.data ?? []).slice(0, 8);
  const total = data.reduce((a, r) => a + num(r, valueKey), 0) || 1;
  const cells: { color: string; name: string }[] = [];
  data.forEach((row, i) => {
    const count = Math.round((num(row, valueKey) / total) * 100);
    for (let n = 0; n < count; n++) cells.push({ color: SERIES_COLORS[i % SERIES_COLORS.length], name: str(row, nameKey) });
  });
  while (cells.length < 100) cells.push({ color: colors.bg.tertiary, name: '' });
  return (
    <Box sx={{ height, overflow: 'hidden' }} role="img" aria-label={spec.title ?? 'Waffle'}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: '2px', maxWidth: 220 }}>
        {cells.slice(0, 100).map((c, i) => (
          <Box key={i} title={c.name} sx={{ aspectRatio: '1', borderRadius: 0.25, bgcolor: c.color, opacity: c.name ? 0.9 : 0.35 }} />
        ))}
      </Box>
    </Box>
  );
}

export function WordCloud({ spec, height }: { spec: ChartSpec; height: number }) {
  const nameKey = spec.nameKey ?? 'name';
  const valueKey = spec.valueKey ?? 'value';
  const words = [...(spec.data ?? [])].sort((a, b) => num(b, valueKey) - num(a, valueKey)).slice(0, 40);
  const max = Math.max(...words.map((w) => num(w, valueKey)), 1);
  return (
    <Box sx={{
      height, display: 'flex', flexWrap: 'wrap', alignContent: 'center', justifyContent: 'center',
      gap: 0.75, overflow: 'hidden',
    }} role="img" aria-label={spec.title ?? 'Word cloud'}>
      {words.map((w, i) => {
        const weight = num(w, valueKey) / max;
        return (
          <Typography key={i} sx={{
            fontSize: `${0.55 + weight * 0.85}rem`,
            color: SERIES_COLORS[i % SERIES_COLORS.length],
            fontFamily: "'Inter', sans-serif",
            lineHeight: 1.1,
            fontWeight: weight > 0.6 ? 600 : 400,
          }}>
            {str(w, nameKey)}
          </Typography>
        );
      })}
    </Box>
  );
}

export function CandlestickChart({ spec, height }: { spec: ChartSpec; height: number }) {
  const xKey = spec.xKey ?? 'x';
  const rows = (spec.data ?? []).slice(0, 40);
  const highs = rows.map((r) => num(r, 'high'));
  const lows = rows.map((r) => num(r, 'low'));
  const min = Math.min(...lows);
  const max = Math.max(...highs, min + 1);
  const span = max - min;
  return (
    <Box sx={{ height, display: 'flex', alignItems: 'stretch', gap: '2px', px: 0.5 }} role="img" aria-label={spec.title ?? 'Candlestick'}>
      {rows.map((row, i) => {
        const o = num(row, 'open');
        const c = num(row, 'close');
        const h = num(row, 'high');
        const l = num(row, 'low');
        const up = c >= o;
        const top = ((max - h) / span) * 100;
        const bodyTop = ((max - Math.max(o, c)) / span) * 100;
        const bodyH = (Math.abs(c - o) / span) * 100;
        const wickH = ((h - l) / span) * 100;
        return (
          <Box key={i} sx={{ flex: 1, position: 'relative', minWidth: 4 }} title={`${str(row, xKey)} O${o} H${h} L${l} C${c}`}>
            <Box sx={{ position: 'absolute', left: '50%', width: 1, top: `${top}%`, height: `${Math.max(wickH, 1)}%`, bgcolor: colors.text.dim }} />
            <Box sx={{
              position: 'absolute', left: '20%', width: '60%', top: `${bodyTop}%`, height: `${Math.max(bodyH, 1.5)}%`,
              bgcolor: up ? colors.accent.green : colors.accent.red, borderRadius: 0.25,
            }} />
          </Box>
        );
      })}
    </Box>
  );
}

export function GeoPoints({ spec, height }: { spec: ChartSpec; height: number }) {
  const latKey = spec.latKey ?? 'lat';
  const lngKey = spec.lngKey ?? 'lng';
  const valueKey = spec.valueKey ?? 'value';
  const pts = (spec.data ?? []).slice(0, 80);
  return (
    <Box sx={{ height, position: 'relative', borderRadius: 0.75, border: `1px solid ${colors.border.subtle}`, bgcolor: colors.bg.secondary, overflow: 'hidden' }} role="img" aria-label={spec.title ?? 'Map'}>
      <Box sx={{
        position: 'absolute', inset: 8,
        backgroundImage: `linear-gradient(${colors.border.subtle} 1px, transparent 1px), linear-gradient(90deg, ${colors.border.subtle} 1px, transparent 1px)`,
        backgroundSize: '24px 24px', opacity: 0.5,
      }} />
      {pts.map((p, i) => {
        const lat = num(p, latKey);
        const lng = num(p, lngKey);
        const left = ((lng + 180) / 360) * 100;
        const top = ((90 - lat) / 180) * 100;
        const size = 6 + Math.min(num(p, valueKey), 20) * 0.3;
        return (
          <Box key={i} title={`${lat},${lng}`} sx={{
            position: 'absolute', left: `${left}%`, top: `${top}%`,
            width: size, height: size, ml: `-${size / 2}px`, mt: `-${size / 2}px`,
            borderRadius: '50%', bgcolor: colors.accent.blue, opacity: 0.8,
          }} />
        );
      })}
      <Typography sx={{ position: 'absolute', bottom: 4, right: 6, fontSize: '0.5rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
        geo sketch
      </Typography>
    </Box>
  );
}

export function ChordArc({ spec, height, mode }: { spec: ChartSpec; height: number; mode: 'chord' | 'arc' }) {
  const nodes = spec.nodes ?? [];
  const links = spec.links ?? [];
  if (nodes.length < 2 || links.length === 0) return <FallbackNote label={`${mode} needs nodes and links`} />;
  const w = 300;
  const h = Math.max(height, 180);
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * 0.38;
  const pos = new Map(nodes.map((n, i) => {
    const a = (i / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
    return [n.id, { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, a, name: n.name ?? n.id }];
  }));
  return (
    <Box sx={{ height, overflow: 'hidden' }} role="img" aria-label={spec.title ?? mode}>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`}>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke={colors.border.subtle} />
        {links.map((l, i) => {
          const a = pos.get(l.source);
          const b = pos.get(l.target);
          if (!a || !b) return null;
          if (mode === 'arc') {
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2 - 20;
            return <path key={i} d={`M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`} fill="none" stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={1.2} opacity={0.75} />;
          }
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={Math.max(0.8, (l.value ?? 1) * 0.4)} opacity={0.7} />;
        })}
        {nodes.map((n, i) => {
          const p = pos.get(n.id);
          if (!p) return null;
          return <circle key={n.id} cx={p.x} cy={p.y} r={5} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />;
        })}
      </svg>
    </Box>
  );
}

export function IconArray({ spec, height }: { spec: ChartSpec; height: number }) {
  const valueKey = spec.valueKey ?? 'value';
  const total = Math.min(100, Math.round(num(spec.data?.[0] ?? {}, valueKey)));
  return (
    <Box sx={{ height, display: 'flex', flexWrap: 'wrap', gap: '3px', alignContent: 'center' }} role="img" aria-label={spec.title ?? 'Icon array'}>
      {Array.from({ length: 100 }, (_, i) => (
        <Box key={i} sx={{
          width: 8, height: 8, borderRadius: 0.25,
          bgcolor: i < total ? colors.accent.blue : colors.bg.tertiary,
          border: `1px solid ${colors.border.subtle}`,
        }} />
      ))}
      <Typography sx={{ width: '100%', mt: 0.5, fontSize: CODE_BLOCK_TOKENS.sansFontSize, color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
        {total}/100
      </Typography>
    </Box>
  );
}

export function ViolinDensity({ spec, height }: { spec: ChartSpec; height: number }) {
  // Approximate violin/density from pre-binned {x,y} or {bin,value}
  const xKey = spec.xKey ?? 'x';
  const yKey = spec.yKey ?? 'y';
  const rows = spec.data ?? [];
  const max = Math.max(...rows.map((r) => num(r, yKey)), 1);
  return (
    <Box sx={{ height, display: 'flex', alignItems: 'flex-end', gap: '1px' }} role="img" aria-label={spec.title ?? 'Density'}>
      {rows.map((row, i) => {
        const v = num(row, yKey);
        const hPct = (v / max) * 100;
        return (
          <Box key={i} sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }} title={`${str(row, xKey)}: ${v}`}>
            <Box sx={{ height: `${hPct}%`, bgcolor: colors.accent.purple, opacity: 0.55, borderRadius: '2px 2px 0 0' }} />
          </Box>
        );
      })}
    </Box>
  );
}

/** Parallel coordinates — one polyline per row across numeric series axes. */
export function ParallelCoords({ spec, height }: { spec: ChartSpec; height: number }) {
  const series = spec.series?.length
    ? spec.series
    : Object.keys(spec.data?.[0] ?? {}).filter((k) => typeof (spec.data?.[0] as Record<string, unknown>)?.[k] === 'number').slice(0, 8);
  const data = spec.data ?? [];
  if (series.length < 2 || data.length === 0) {
    return <FallbackNote label="Parallel chart needs ≥2 numeric series" />;
  }
  const mins = series.map((k) => Math.min(...data.map((r) => num(r, k))));
  const maxs = series.map((k, i) => Math.max(...data.map((r) => num(r, k)), mins[i]! + 1e-9));
  const w = 320;
  const h = Math.max(height - 8, 80);
  const pad = 16;
  const xAt = (i: number) => pad + (i * (w - pad * 2)) / (series.length - 1);
  const yAt = (i: number, v: number) => {
    const t = (v - mins[i]!) / (maxs[i]! - mins[i]! || 1);
    return pad + (1 - t) * (h - pad * 2);
  };
  return (
    <Box sx={{ height, overflow: 'hidden' }} role="img" aria-label={spec.title ?? 'Parallel coordinates'}>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
        {series.map((k, i) => (
          <g key={k}>
            <line x1={xAt(i)} y1={pad} x2={xAt(i)} y2={h - pad} stroke={colors.border.subtle} strokeWidth={1} />
            <text x={xAt(i)} y={h - 2} textAnchor="middle" fill={colors.text.dim} fontSize="8" fontFamily="JetBrains Mono, monospace">{k}</text>
          </g>
        ))}
        {data.slice(0, 40).map((row, ri) => {
          const pts = series.map((k, i) => `${xAt(i)},${yAt(i, num(row, k))}`).join(' ');
          return (
            <polyline
              key={ri}
              points={pts}
              fill="none"
              stroke={SERIES_COLORS[ri % SERIES_COLORS.length]}
              strokeWidth={1.2}
              opacity={0.75}
            />
          );
        })}
      </svg>
    </Box>
  );
}

/** Nested circle pack approximation from name/value rows. */
export function CirclePack({ spec, height }: { spec: ChartSpec; height: number }) {
  const nameKey = spec.nameKey ?? 'name';
  const valueKey = spec.valueKey ?? 'value';
  const items = (spec.data ?? [])
    .map((r) => ({ name: str(r, nameKey) || str(r, 'x'), value: Math.max(num(r, valueKey) || num(r, 'y'), 0.1) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 16);
  if (!items.length) return <FallbackNote label="Circle pack needs data" />;
  const total = items.reduce((s, i) => s + i.value, 0);
  const size = Math.max(height - 4, 100);
  const cx = size / 2;
  const cy = size / 2;
  let angle = 0;
  const rings = items.map((item, i) => {
    const share = item.value / total;
    const r = Math.sqrt(share) * (size * 0.38);
    const orbit = size * 0.28;
    const a = angle + share * Math.PI;
    angle += share * Math.PI * 2;
    const x = i === 0 ? cx : cx + Math.cos(a) * orbit * (0.4 + share);
    const y = i === 0 ? cy : cy + Math.sin(a) * orbit * (0.4 + share);
    return { ...item, x, y, r: Math.max(r, 8), color: SERIES_COLORS[i % SERIES_COLORS.length] };
  });
  return (
    <Box sx={{ height, display: 'flex', justifyContent: 'center' }} role="img" aria-label={spec.title ?? 'Circle pack'}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {rings.map((c) => (
          <g key={c.name}>
            <circle cx={c.x} cy={c.y} r={c.r} fill={c.color} opacity={0.55} stroke={colors.bg.primary} strokeWidth={1} />
            {c.r > 14 && (
              <text x={c.x} y={c.y + 3} textAnchor="middle" fill={colors.text.primary} fontSize="8" fontFamily="JetBrains Mono, monospace">
                {c.name.slice(0, 8)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </Box>
  );
}

export function FallbackNote({ label }: { label: string }) {
  return (
    <Typography sx={{ color: colors.text.tertiary, fontSize: CODE_BLOCK_TOKENS.sansFontSize, fontFamily: "'JetBrains Mono', monospace" }}>
      {label}
    </Typography>
  );
}
