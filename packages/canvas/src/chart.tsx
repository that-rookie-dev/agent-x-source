import { useMemo, type ReactNode } from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { parseChartSpec, type ChartSpec } from '@agentx/shared/browser';
import { useAgentXTheme } from './theme.js';

const PALETTE = ['#7dd3fc', '#4ade80', '#c4b5fd', '#fbbf24', '#f87171', '#67e8f9'];

export function Chart({ spec, title, height = 280 }: { spec: ChartSpec | Record<string, unknown>; title?: string; height?: number }) {
  const t = useAgentXTheme();
  const parsed = useMemo(() => {
    try {
      const input = typeof spec === 'string' ? spec : JSON.stringify(spec);
      const result = parseChartSpec(input);
      if (!result.ok) return null;
      return result.spec;
    } catch {
      return null;
    }
  }, [spec]);

  if (!parsed) {
    return <div style={{ color: t.text.dim, fontSize: 12 }}>Invalid chart spec</div>;
  }

  const chartTitle = title ?? parsed.title ?? '';
  const data = (parsed.data ?? []) as Array<Record<string, unknown>>;
  const type = parsed.type ?? 'bar';

  const axisStyle = { fill: t.text.dim, fontSize: 11, fontFamily: t.font.mono };
  const gridStroke = t.border.default;

  let plot: ReactNode = null;
  if (type === 'line' || type === 'line_multi') {
    const keys = data.length > 0 ? Object.keys(data[0]!).filter((k) => k !== 'x' && k !== 'name') : ['y'];
    plot = (
      <LineChart data={data}>
        <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
        <XAxis dataKey="x" tick={axisStyle} stroke={gridStroke} />
        <YAxis tick={axisStyle} stroke={gridStroke} />
        <Tooltip contentStyle={{ background: t.bg.tertiary, border: `1px solid ${t.border.default}`, fontSize: 11 }} />
        <Legend />
        {keys.map((k, i) => (
          <Line key={k} type="monotone" dataKey={k} stroke={PALETTE[i % PALETTE.length]} dot={false} strokeWidth={2} />
        ))}
      </LineChart>
    );
  } else if (type === 'pie' || type === 'donut') {
    plot = (
      <PieChart>
        <Pie data={data} dataKey="y" nameKey="x" innerRadius={type === 'donut' ? 50 : 0} outerRadius={90} paddingAngle={2}>
          {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip contentStyle={{ background: t.bg.tertiary, border: `1px solid ${t.border.default}`, fontSize: 11 }} />
        <Legend />
      </PieChart>
    );
  } else {
    plot = (
      <BarChart data={data}>
        <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" />
        <XAxis dataKey="x" tick={axisStyle} stroke={gridStroke} />
        <YAxis tick={axisStyle} stroke={gridStroke} />
        <Tooltip contentStyle={{ background: t.bg.tertiary, border: `1px solid ${t.border.default}`, fontSize: 11 }} />
        <Bar dataKey="y" fill={t.accent.blue} radius={[3, 3, 0, 0]} />
      </BarChart>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {chartTitle && <div style={{ fontSize: 13, fontWeight: 600, color: t.text.primary, marginBottom: 8, fontFamily: t.font.mono }}>{chartTitle}</div>}
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height="100%">
          {plot}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
