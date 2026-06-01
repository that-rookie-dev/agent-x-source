import { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { COLORS } from '../theme/colors.js';

interface SessionEntry {
  id: string;
  title: string;
  provider: string;
  model: string;
  tokensUsed: number;
  messageCount: number;
  updatedAt: string;
}

interface SessionRestoreProps {
  sessions: SessionEntry[];
  onRestore: (sessionId: string) => void;
  onNew: () => void;
  onBack: () => void;
}

type SortKey = 'date' | 'name' | 'messages';
type SortDir = 'asc' | 'desc';

function getDateGroup(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const startOfWeek = new Date(today.getTime() - today.getDay() * 86400000);
  if (d >= today) return 'Today';
  if (d >= yesterday) return 'Yesterday';
  if (d >= startOfWeek) return 'This Week';
  const month = d.toLocaleString('default', { month: 'long', year: 'numeric' });
  return month;
}

const PAGE_SIZE = 10;

const SORT_LABELS: Record<SortKey, string> = {
  date: 'Date',
  name: 'Name',
  messages: 'Msgs',
};

export function SessionRestore({ sessions, onRestore, onNew, onBack }: SessionRestoreProps) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);
  const [showSearch, setShowSearch] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [_showProviderFilter, _setShowProviderFilter] = useState(false);
  const [groupByDate, setGroupByDate] = useState(false);

  const availableProviders = useMemo(() => {
    const set = new Set(sessions.map((s) => s.provider));
    return [...set].sort();
  }, [sessions]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
    setShowSort(false);
  }, [sortKey]);
  void _toggleSort;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let result = sessions;

    // Date filter
    if (dateFilter !== 'all') {
      const now = Date.now();
      const cutoff = dateFilter === 'today' ? now - 86400000
        : dateFilter === 'week' ? now - 604800000
        : now - 2592000000; // month
      result = result.filter((s) => new Date(s.updatedAt).getTime() >= cutoff);
    }

    // Provider filter
    if (providerFilter) {
      result = result.filter((s) => s.provider === providerFilter);
    }

    // Search filter
    if (q) {
      result = result.filter((s) =>
        s.title.toLowerCase().includes(q) ||
        s.provider.toLowerCase().includes(q) ||
        s.model.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q)
      );
    }

    const sorted = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'date') cmp = a.updatedAt.localeCompare(b.updatedAt);
      else if (sortKey === 'name') cmp = a.title.localeCompare(b.title);
      else cmp = a.messageCount - b.messageCount;
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return sorted;
  }, [sessions, search, sortKey, sortDir, dateFilter, providerFilter]);

  const groups = useMemo(() => {
    if (!groupByDate) return null;
    const map = new Map<string, typeof filtered>();
    for (const s of filtered) {
      const g = getDateGroup(s.updatedAt);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(s);
    }
    return [...map.entries()].sort((a, b) => {
      const order = ['Today', 'Yesterday', 'This Week'];
      const ai = order.indexOf(a[0]);
      const bi = order.indexOf(b[0]);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a[0].localeCompare(b[0]);
    });
  }, [filtered, groupByDate]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  // Build display items for current page — with optional group headers
  const displayItems: { type: 'header' | 'session'; label: string; session?: SessionEntry }[] = useMemo(() => {
    if (!groupByDate || !groups) {
      return pageItems.map((s) => ({ type: 'session' as const, label: s.title, session: s }));
    }
    const result: { type: 'header' | 'session'; label: string; session?: SessionEntry }[] = [];
    const pageIds = new Set(pageItems.map((s) => s.id));
    for (const [group, items] of groups) {
      const onPage = items.filter((s) => pageIds.has(s.id));
      if (onPage.length > 0) {
        result.push({ type: 'header', label: `── ${group} ──` });
        for (const s of onPage) {
          result.push({ type: 'session', label: s.title, session: s });
        }
      }
    }
    return result;
  }, [groups, groupByDate, pageItems]);

  const totalItems = displayItems.length + 4; // New Session, Back, Sort/Page status lines
  const _scrollOffset = 0;
  void _scrollOffset;

  useInput(useCallback((input: string, key: { upArrow?: boolean; downArrow?: boolean; return?: boolean; escape?: boolean; leftArrow?: boolean; rightArrow?: boolean }) => {
    if (showSearch) {
      if (key.escape) { setShowSearch(false); return; }
      if (input === '1') { setDateFilter('all'); return; }
      if (input === '2') { setDateFilter('today'); return; }
      if (input === '3') { setDateFilter('week'); return; }
      if (input === '4') { setDateFilter('month'); return; }
      if (input === 'p' || input === 'P') {
        const currentIndex = providerFilter ? availableProviders.indexOf(providerFilter) : -1;
        if (currentIndex < availableProviders.length - 1) {
          setProviderFilter(currentIndex === -1 ? availableProviders[0]! : availableProviders[currentIndex + 1]!);
        } else {
          setProviderFilter(null);
        }
        return;
      }
      return;
    }
    if (showSort) {
      if (key.escape) { setShowSort(false); }
      return;
    }

    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    if (key.downArrow) setSelected((s) => Math.min(totalItems - 1, s + 1));
    if (key.leftArrow && safePage > 0) setPage((p) => p - 1);
    if (key.rightArrow && safePage < totalPages - 1) setPage((p) => p + 1);
    if (key.escape) onBack();
    if (input === '/') { setShowSearch(true); return; }
    if (input === 's' || input === 'S') { setShowSort(!showSort); return; }
    if (input === 'g' || input === 'G') { setGroupByDate((g) => !g); setSelected(0); return; }

    if (key.return) {
      if (selected === 0) onNew();
      else if (selected === 1) onBack();
      else if (groupByDate) {
        const item = displayItems[selected - 2];
        if (item && item.type === 'session' && item.session) onRestore(item.session.id);
      } else {
        const idx = selected - 2;
        if (idx < pageItems.length) onRestore(pageItems[idx]!.id);
      }
    }
  }, [selected, totalItems, onRestore, onNew, onBack, safePage, totalPages, pageItems, showSearch, showSort, availableProviders, providerFilter, groupByDate, displayItems]));

  const dateFilterLabels: Record<string, string> = { all: 'All', today: 'Today', week: 'Week', month: 'Month' };

  if (showSearch) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={COLORS.primary} bold>Search & Filter Sessions</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={COLORS.textDim}>Date filter (1-4):</Text>
          <Box flexDirection="row" gap={1} marginTop={1}>
            {(['all', 'today', 'week', 'month'] as const).map((f) => (
              <Box key={f}>
                <Text color={dateFilter === f ? COLORS.primary : COLORS.text}>
                  [{dateFilter === f ? '✓' : ' '}] {dateFilterLabels[f]}
                </Text>
              </Box>
            ))}
          </Box>
          {availableProviders.length > 0 && (
            <>
              <Box marginTop={1}>
                <Text color={COLORS.textDim}>Provider filter (p to cycle):</Text>
              </Box>
              <Box flexDirection="row" gap={1} marginTop={1} flexWrap="wrap">
                <Box key="all-providers">
                  <Text color={!providerFilter ? COLORS.primary : COLORS.text}>
                    [{!providerFilter ? '✓' : ' '}] All
                  </Text>
                </Box>
                {availableProviders.map((p) => (
                  <Box key={p}>
                    <Text color={providerFilter === p ? COLORS.primary : COLORS.text}>
                      [{providerFilter === p ? '✓' : ' '}] {p}
                    </Text>
                  </Box>
                ))}
              </Box>
            </>
          )}
          <Box marginTop={1}>
            <Text color={COLORS.textDim}>Text filter: </Text>
            <TextInput value={search} onChange={setSearch} onSubmit={() => setShowSearch(false)} placeholder="title, provider, model..." />
          </Box>
        </Box>
        <Box marginTop={1}>
          <Text color={COLORS.textDim}>Enter to apply • Esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  if (showSort) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={COLORS.primary} bold>Sort By</Text>
        <Box marginTop={1} flexDirection="column">
          {(['date', 'name', 'messages'] as SortKey[]).map((key) => (
            <Box key={key}>
              <Text color={sortKey === key ? COLORS.primary : COLORS.text}>
                {sortKey === key ? '▸ ' : '  '}{SORT_LABELS[key]} {sortKey === key ? (sortDir === 'desc' ? '↓' : '↑') : ''}
              </Text>
            </Box>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text color={COLORS.textDim}>Select sort • Esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="row" gap={1}>
        <Text color={COLORS.primary} bold>Sessions</Text>
        <Text color={COLORS.textDim}>({filtered.length}{sessions.length !== filtered.length ? ` / ${sessions.length}` : ''})</Text>
        {search && <Text color={COLORS.info}>  "{search}"</Text>}
      </Box>
      <Box flexDirection="row" gap={1}>
        {dateFilter !== 'all' && (
          <Text color={COLORS.warning}>● {dateFilterLabels[dateFilter]}</Text>
        )}
        {providerFilter && (
          <Text color={COLORS.info}>● {providerFilter}</Text>
        )}
        {search && <Text color={COLORS.info}>● "{search}"</Text>}
        {groupByDate && <Text color={COLORS.info}>● grouped</Text>}
        {(dateFilter !== 'all' || providerFilter || search || groupByDate) && (
          <Text color={COLORS.textDim}> | </Text>
        )}
        <Text color={COLORS.textDim}>/ search • s sort • g group • ← → page • Enter restore • Esc back</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text color={selected === 0 ? COLORS.primary : COLORS.text} bold={selected === 0}>
            {selected === 0 ? '▸ ' : '  '}✦ New Session
          </Text>
        </Box>
        <Box>
          <Text color={selected === 1 ? COLORS.primary : COLORS.textDim} bold={selected === 1}>
            {selected === 1 ? '▸ ' : '  '}← Back
          </Text>
        </Box>
        {filtered.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text color={COLORS.textDim}>
              Page {safePage + 1}/{totalPages} — Sorted by {SORT_LABELS[sortKey]} {sortDir === 'desc' ? '↓' : '↑'}
            </Text>
            {displayItems.map((item, i) => {
              const idx = i + 2;
              const isSelected = selected === idx;

              if (item.type === 'header') {
                return (
                  <Box key={item.label} marginTop={1}>
                    <Text color={COLORS.textDim}>{item.label}</Text>
                  </Box>
                );
              }

              const s = item.session!;
              const dateStr = new Date(s.updatedAt).toLocaleDateString();
              const timeStr = new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              return (
                <Box key={s.id} flexDirection="column">
                  <Box>
                    <Text color={isSelected ? COLORS.primary : COLORS.text} bold={isSelected}>
                      {isSelected ? '▸ ' : '  '}{s.title}
                    </Text>
                  </Box>
                  {isSelected && (
                    <Box marginLeft={3} flexDirection="column">
                      <Text color={COLORS.textDim}>ID: {s.id.slice(0, 12)}…</Text>
                      <Text color={COLORS.textDim}>Provider: {s.provider} / Model: {s.model}</Text>
                      <Text color={COLORS.textDim}>Messages: {s.messageCount} • Tokens: {s.tokensUsed}</Text>
                      <Text color={COLORS.textDim}>Updated: {dateStr} {timeStr}</Text>
                    </Box>
                  )}
                  {!isSelected && (
                    <Text color={COLORS.textDim}>    {s.provider}/{s.model} • {s.messageCount} msgs • {dateStr}</Text>
                  )}
                </Box>
              );
            })}
          </Box>
        )}
        {filtered.length === 0 && (
          <Box marginTop={1}>
            <Text color={COLORS.textDim}>No sessions match your search.</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
