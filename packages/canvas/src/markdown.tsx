import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CHART_FENCE_LANGS, isChartSpecContent } from '@agentx/shared/browser';
import { useAgentXTheme } from './theme.js';
import { Chart } from './chart.js';

function ChartFence({ code }: { code: string }) {
  try {
    const spec = JSON.parse(code.trim());
    return <Chart spec={spec} />;
  } catch {
    return <pre style={{ fontSize: 11, opacity: 0.7 }}>{code}</pre>;
  }
}

export function Markdown({ children }: { children: string }) {
  const t = useAgentXTheme();
  return (
    <div style={{
      color: t.text.secondary,
      fontSize: 13,
      lineHeight: 1.65,
    }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children: c }) => <h1 style={{ fontSize: 20, color: t.text.primary, margin: '0 0 12px', fontFamily: t.font.mono }}>{c}</h1>,
          h2: ({ children: c }) => <h2 style={{ fontSize: 16, color: t.text.primary, margin: '16px 0 8px', fontFamily: t.font.mono }}>{c}</h2>,
          h3: ({ children: c }) => <h3 style={{ fontSize: 14, color: t.text.primary, margin: '12px 0 6px', fontFamily: t.font.mono }}>{c}</h3>,
          p: ({ children: c }) => <p style={{ margin: '0 0 10px' }}>{c}</p>,
          strong: ({ children: c }) => <strong style={{ color: t.text.primary, fontWeight: 600 }}>{c}</strong>,
          code: ({ className, children }) => {
            const lang = (className || '').replace(/language-/, '').toLowerCase();
            const text = String(children).replace(/\n$/, '');
            const inline = !className;
            if (!inline && (CHART_FENCE_LANGS.has(lang) || lang === 'chart' || isChartSpecContent(text))) {
              return <ChartFence code={text} />;
            }
            if (inline) {
              return <code style={{ fontFamily: t.font.mono, fontSize: 12, background: t.bg.tertiary, padding: '1px 4px', borderRadius: 3 }}>{children}</code>;
            }
            return (
              <pre style={{
                margin: '0 0 12px',
                padding: 10,
                overflow: 'auto',
                fontSize: 11,
                fontFamily: t.font.mono,
                background: t.bg.tertiary,
                border: `1px solid ${t.border.default}`,
                borderRadius: 4,
              }}>
                <code>{text}</code>
              </pre>
            );
          },
          table: ({ children: c }) => (
            <div style={{ overflowX: 'auto', marginBottom: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>{c}</table>
            </div>
          ),
          th: ({ children: c }) => <th style={{ textAlign: 'left', padding: 8, borderBottom: `1px solid ${t.border.strong}`, color: t.text.dim, fontFamily: t.font.mono, fontSize: 10 }}>{c}</th>,
          td: ({ children: c }) => <td style={{ padding: 8, borderBottom: `1px solid ${t.border.default}` }}>{c}</td>,
          a: ({ href, children: c }) => <a href={href} style={{ color: t.accent.blue, textDecoration: 'none' }}>{c}</a>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
