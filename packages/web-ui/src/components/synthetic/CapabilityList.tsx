import { useMemo, useState, type CSSProperties } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { colors, MONO, alphaColor } from '../../theme';
import { StatusChip } from './status';
import type { CapabilityRecord } from '../../api';

type SortKey = 'name' | 'kind' | 'status' | 'createdAt' | 'useCount';

export function CapabilityList({
  items,
  selectedId,
  onOpen,
  onExport,
  onBulk,
  onApproveBulk,
}: {
  items: CapabilityRecord[];
  selectedId?: string;
  onOpen: (item: CapabilityRecord) => void;
  onExport?: () => void;
  onBulk?: (ids: string[], action: 'approve' | 'disable' | 'enable' | 'archive') => void;
  onApproveBulk?: (selected: CapabilityRecord[]) => void;
}) {
  const [sort, setSort] = useState<SortKey>('createdAt');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const isNarrow = useMediaQuery('(max-width: 520px)', { defaultMatches: false });

  const rows = useMemo(() => {
    let list = items;
    if (kind) list = list.filter((i) => i.kind === kind);
    if (status) list = list.filter((i) => i.status === status);
    return [...list].sort((a, b) => {
      const av = a[sort];
      const bv = b[sort];
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [items, sort, dir, kind, status]);

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const slice = rows.slice(page * pageSize, page * pageSize + pageSize);

  const toggle = (key: SortKey) => {
    if (sort === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSort(key); setDir('asc'); }
  };

  const togglePick = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (items.length === 0) {
    return (
      <Typography sx={{ fontSize: '0.75rem', color: colors.text.dim, fontFamily: MONO }}>
        No generated tools yet. Approve a proposal or create from a prompt.
      </Typography>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
        <select
          aria-label="Filter kind"
          title="Filter by kind"
          value={kind}
          onChange={(e) => { setKind(e.target.value); setPage(0); }}
          style={selectStyle}
        >
          <option value="">all kinds</option>
          <option value="tool">tool</option>
          <option value="skill">skill</option>
          <option value="knowledge">knowledge</option>
        </select>
        <select
          aria-label="Filter status"
          title="Filter by status"
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(0); }}
          style={selectStyle}
        >
          <option value="">all statuses</option>
          {['proposed', 'sandbox-passed', 'in-trial', 'registered', 'disabled', 'archived'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="Page size"
          title="Items per page"
          value={pageSize}
          onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
          style={selectStyle}
        >
          {[25, 50, 100].map((n) => <option key={n} value={n}>{n} per page</option>)}
        </select>
        {onExport && (
          <Button size="small" title="Download CSV" onClick={onExport} sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.62rem' }}>Download CSV</Button>
        )}
      </Box>
      {picked.size > 0 && (onBulk || onApproveBulk) && (
        <Box sx={{ display: 'flex', gap: 0.75, mb: 1, flexWrap: 'wrap' }}>
          {onApproveBulk && (
            <Button size="small" onClick={() => onApproveBulk(items.filter((i) => picked.has(i.id)))} sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.62rem' }}>Approve</Button>
          )}
          {onBulk && (
            <>
              <Button size="small" onClick={() => onBulk([...picked], 'disable')} sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.62rem' }}>Disable</Button>
              <Button size="small" onClick={() => onBulk([...picked], 'enable')} sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.62rem' }}>Enable</Button>
              <Button size="small" onClick={() => onBulk([...picked], 'archive')} sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.62rem' }}>Archive</Button>
            </>
          )}
        </Box>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : '24px 1.4fr 0.6fr 0.9fr 0.5fr', gap: 0.5, mb: 0.5 }}>
        {!isNarrow && <span />}
        {(['name', 'kind', 'status', 'useCount'] as const).map((key) => (
          <Button
            key={key}
            size="small"
            title={`Sort by ${key}`}
            onClick={() => toggle(key)}
            sx={{ fontFamily: MONO, textTransform: 'none', justifyContent: 'flex-start', fontSize: '0.62rem', color: colors.text.dim }}
          >
            {key}{sort === key ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
          </Button>
        ))}
      </Box>
      {slice.map((item) => (
        <Box
          key={item.id}
          sx={{
            display: 'grid',
            gridTemplateColumns: isNarrow ? '1fr' : '24px 1.4fr 0.6fr 0.9fr 0.5fr',
            gap: 0.5,
            px: 0.5, py: 0.75,
            bgcolor: selectedId === item.id ? alphaColor(colors.accent.blue, '12') : 'transparent',
            '&:hover': { bgcolor: colors.bg.hover },
          }}
        >
          <Checkbox size="small" checked={picked.has(item.id)} onChange={() => togglePick(item.id)} inputProps={{ 'aria-label': `Select ${item.name}` }} sx={{ p: 0 }} />
          <Typography onClick={() => onOpen(item)} title={item.name} sx={{ fontSize: '0.72rem', fontFamily: MONO, color: colors.text.primary, cursor: 'pointer' }}>{item.name}</Typography>
          <Typography sx={{ fontSize: '0.62rem', fontFamily: MONO, color: colors.text.dim }}>{item.kind}</Typography>
          <Box>
            <StatusChip status={item.status} count={item.status === 'in-trial' ? item.trialCount : undefined} />
          </Box>
          <Typography sx={{ fontSize: '0.62rem', fontFamily: MONO, color: colors.text.dim }}>{item.useCount}</Typography>
        </Box>
      ))}
      {pages > 1 && (
        <Box sx={{ display: 'flex', gap: 1, mt: 1, alignItems: 'center' }}>
          <Button size="small" title="Previous page" disabled={page === 0} onClick={() => setPage((p) => p - 1)} sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.62rem' }}>Prev</Button>
          <Typography sx={{ fontSize: '0.62rem', fontFamily: MONO, color: colors.text.dim }}>{page + 1} / {pages}</Typography>
          <Button size="small" title="Next page" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} sx={{ fontFamily: MONO, textTransform: 'none', fontSize: '0.62rem' }}>Next</Button>
        </Box>
      )}
    </Box>
  );
}

const selectStyle: CSSProperties = {
  fontFamily: MONO,
  fontSize: 11,
  background: 'transparent',
  color: 'inherit',
  border: '1px solid #242432',
  borderRadius: 4,
  padding: '4px 6px',
};
