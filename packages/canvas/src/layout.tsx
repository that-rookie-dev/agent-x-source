import type { CSSProperties, ReactNode } from 'react';
import { useAgentXTheme } from './theme.js';

const base: CSSProperties = {
  boxSizing: 'border-box',
  fontFamily: "'Inter', system-ui, sans-serif",
};

export function CanvasRoot({ children }: { children: ReactNode }) {
  const t = useAgentXTheme();
  return (
    <div style={{
      ...base,
      color: t.text.secondary,
      fontSize: 13,
      lineHeight: 1.6,
      width: '100%',
    }}>
      {children}
    </div>
  );
}

export function Section({ title, subtitle, children }: { title?: string; subtitle?: string; children: ReactNode }) {
  const t = useAgentXTheme();
  return (
    <section style={{ marginBottom: 24 }}>
      {title && (
        <header style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: t.text.primary, fontFamily: t.font.mono }}>{title}</h2>
          {subtitle && <p style={{ margin: '4px 0 0', fontSize: 12, color: t.text.dim }}>{subtitle}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Grid({ columns = 2, gap = 12, children }: { columns?: number; gap?: number; children: ReactNode }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${Math.max(1, columns)}, minmax(0, 1fr))`,
      gap,
    }}>
      {children}
    </div>
  );
}

export function Card({ title, children, compact }: { title?: string; children: ReactNode; compact?: boolean }) {
  const t = useAgentXTheme();
  return (
    <div style={{
      background: t.bg.tertiary,
      border: `1px solid ${t.border.default}`,
      borderRadius: 6,
      padding: compact ? 10 : 14,
    }}>
      {title && <div style={{ fontSize: 11, fontWeight: 600, color: t.text.primary, marginBottom: 8, fontFamily: t.font.mono }}>{title}</div>}
      {children}
    </div>
  );
}

export function Kpi({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: 'default' | 'good' | 'warn' | 'bad' }) {
  const t = useAgentXTheme();
  const color = tone === 'good' ? t.accent.green : tone === 'warn' ? t.accent.orange : tone === 'bad' ? t.accent.red : t.text.primary;
  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ fontSize: 10, color: t.text.dim, fontFamily: t.font.mono, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color, fontFamily: t.font.mono, lineHeight: 1.2 }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: t.text.tertiary, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

export function KpiRow({ children }: { children: ReactNode }) {
  const t = useAgentXTheme();
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
      gap: 12,
      padding: 12,
      background: t.bg.secondary,
      border: `1px solid ${t.border.default}`,
      borderRadius: 6,
      marginBottom: 16,
    }}>
      {children}
    </div>
  );
}

export function Caption({ children }: { children: ReactNode }) {
  const t = useAgentXTheme();
  return <p style={{ margin: '8px 0 0', fontSize: 11, color: t.text.dim, fontFamily: t.font.mono }}>{children}</p>;
}
