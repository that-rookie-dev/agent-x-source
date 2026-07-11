import { useMemo, useState, type ReactNode } from 'react';
import { useAgentXTheme } from './theme.js';

export interface DataTableColumn<T extends Record<string, unknown>> {
  key: keyof T & string;
  label: string;
  align?: 'left' | 'right' | 'center';
  render?: (row: T) => ReactNode;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  searchable,
  pageSize = 20,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  searchable?: boolean;
  pageSize?: number;
}) {
  const t = useAgentXTheme();
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    let out = rows;
    if (query.trim()) {
      const q = query.toLowerCase();
      out = out.filter((row) =>
        columns.some((c) => String(row[c.key] ?? '').toLowerCase().includes(q)),
      );
    }
    if (sortKey) {
      out = [...out].sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        const cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return out;
  }, [rows, columns, query, sortKey, sortDir]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const slice = filtered.slice(page * pageSize, (page + 1) * pageSize);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
    setPage(0);
  };

  const th: React.CSSProperties = {
    textAlign: 'left',
    padding: '8px 10px',
    fontSize: 10,
    fontWeight: 600,
    color: t.text.dim,
    fontFamily: t.font.mono,
    borderBottom: `1px solid ${t.border.strong}`,
    cursor: 'pointer',
    userSelect: 'none',
  };

  const td: React.CSSProperties = {
    padding: '8px 10px',
    fontSize: 12,
    color: t.text.secondary,
    borderBottom: `1px solid ${t.border.default}`,
    verticalAlign: 'top',
  };

  return (
    <div>
      {searchable && (
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(0); }}
          placeholder="Filter rows…"
          style={{
            width: '100%',
            maxWidth: 280,
            marginBottom: 10,
            padding: '6px 10px',
            fontSize: 12,
            borderRadius: 4,
            border: `1px solid ${t.border.default}`,
            background: t.bg.secondary,
            color: t.text.primary,
            fontFamily: t.font.mono,
          }}
        />
      )}
      <div style={{ overflowX: 'auto', border: `1px solid ${t.border.default}`, borderRadius: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', background: t.bg.secondary }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={{ ...th, textAlign: c.align ?? 'left' }} onClick={() => toggleSort(c.key)}>
                  {c.label}{sortKey === c.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} style={{ ...td, textAlign: c.align ?? 'left' }}>
                    {c.render ? c.render(row) : String(row[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', fontSize: 11, color: t.text.dim, fontFamily: t.font.mono }}>
          <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} style={pagerBtn(t)}>Prev</button>
          <span>{page + 1} / {pages}</span>
          <button type="button" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} style={pagerBtn(t)}>Next</button>
        </div>
      )}
    </div>
  );
}

function pagerBtn(t: ReturnType<typeof useAgentXTheme>): React.CSSProperties {
  return {
    padding: '4px 8px',
    fontSize: 11,
    borderRadius: 4,
    border: `1px solid ${t.border.default}`,
    background: t.bg.tertiary,
    color: t.text.secondary,
    cursor: 'pointer',
    fontFamily: t.font.mono,
  };
}
