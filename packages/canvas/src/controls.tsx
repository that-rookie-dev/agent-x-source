import { useState, type ReactNode } from 'react';
import { useAgentXTheme } from './theme.js';

export function Tabs({ tabs, defaultId }: { tabs: Array<{ id: string; label: string; content: ReactNode }>; defaultId?: string }) {
  const t = useAgentXTheme();
  const [active, setActive] = useState(defaultId ?? tabs[0]?.id ?? '');
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${t.border.default}`, marginBottom: 12 }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActive(tab.id)}
            style={{
              padding: '8px 12px',
              fontSize: 12,
              fontFamily: t.font.mono,
              border: 'none',
              borderBottom: active === tab.id ? `2px solid ${t.accent.blue}` : '2px solid transparent',
              background: 'transparent',
              color: active === tab.id ? t.text.primary : t.text.dim,
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div>{current?.content}</div>
    </div>
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  const t = useAgentXTheme();
  return (
    <label style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, fontSize: 11, color: t.text.dim, fontFamily: t.font.mono }}>
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        style={{
          padding: '6px 10px',
          fontSize: 12,
          borderRadius: 4,
          border: `1px solid ${t.border.default}`,
          background: t.bg.secondary,
          color: t.text.primary,
          fontFamily: t.font.mono,
        }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function Button({ children, onClick, variant = 'default' }: { children: ReactNode; onClick?: () => void; variant?: 'default' | 'primary' }) {
  const t = useAgentXTheme();
  const primary = variant === 'primary';
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 12px',
        fontSize: 12,
        borderRadius: 4,
        border: `1px solid ${primary ? t.accent.blue : t.border.default}`,
        background: primary ? t.accent.blue : t.bg.tertiary,
        color: primary ? t.bg.primary : t.text.primary,
        cursor: 'pointer',
        fontFamily: t.font.mono,
      }}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad' }) {
  const t = useAgentXTheme();
  const bg = tone === 'good' ? t.accent.green : tone === 'warn' ? t.accent.orange : tone === 'bad' ? t.accent.red : t.border.strong;
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 999,
      fontSize: 10,
      fontFamily: t.font.mono,
      background: `${bg}22`,
      color: bg,
      border: `1px solid ${bg}55`,
    }}>
      {children}
    </span>
  );
}
