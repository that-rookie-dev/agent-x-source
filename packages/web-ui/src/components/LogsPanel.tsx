import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import ViewStreamIcon from '@mui/icons-material/ViewStream';
import { PanelHeader } from './PanelHeader';
import { colors, alphaColor } from '../theme';
import { getAuthToken } from '../api';
import { copyToClipboard } from '../utils/clipboard';

interface LogEntry {
  timestamp: string;
  level: 'error' | 'warn' | 'info';
  code: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
}

type LevelFilter = 'all' | 'error' | 'warn' | 'info';

const LEVEL_COLORS: Record<string, string> = {
  error: colors.accent.red,
  warn: colors.accent.orange,
  info: colors.accent.blue,
};

const LEVEL_BG: Record<string, string> = {
  error: alphaColor(colors.accent.red, 0.12),
  warn: alphaColor(colors.accent.orange, 0.12),
  info: alphaColor(colors.accent.blue, 0.12),
};

export interface LogsPanelProps {
  onClose?: () => void;
  onTogglePosition?: () => void;
  position?: 'bottom' | 'right';
}

export function LogsPanel({ onClose, onTogglePosition, position }: LogsPanelProps) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LevelFilter>('all');
  const [search, setSearch] = useState('');
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const filteredEntries = useMemo(() => {
    let results = entries;
    if (filter !== 'all') {
      results = results.filter((e) => e.level === filter);
    }
    if (search) {
      const s = search.toLowerCase();
      results = results.filter(
        (e) => e.message.toLowerCase().includes(s) || e.code.toLowerCase().includes(s),
      );
    }
    return results;
  }, [entries, filter, search]);

  const connectSSE = useCallback(() => {
    try {
      const token = getAuthToken();
      const url = `/api/logs/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.addEventListener('log', (event) => {
        try {
          const data = JSON.parse(event.data) as { entry: LogEntry; index: number };
          setEntries((prev) => {
            const next = [...prev, data.entry];
            return next.length > 5000 ? next.slice(-5000) : next;
          });
        } catch { /* skip malformed */ }
      });

      es.addEventListener('open', () => setConnected(true));
      es.addEventListener('error', () => {
        setConnected(false);
        es.close();
        setTimeout(connectSSE, 5000);
      });

      const msgHandler = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'connected') {
            setConnected(true);
            if (data.count > 0) {
              fetch('/api/logs?limit=200', {
                headers: { Authorization: `Bearer ${getAuthToken()}` },
              })
                .then((r) => r.json())
                .then((d) => {
                  if (Array.isArray(d.entries)) setEntries(d.entries);
                })
                .catch(() => {});
            }
          }
        } catch { /* skip */ }
      };
      es.addEventListener('message', msgHandler);
    } catch {
      setTimeout(connectSSE, 5000);
    }
  }, []);

  useEffect(() => {
    fetch('/api/logs?limit=200', {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    })
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.entries)) setEntries(d.entries);
      })
      .catch(() => {});
    connectSSE();
    return () => {
      esRef.current?.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [connectSSE]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredEntries, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 30);
  }, []);

  const handleCopy = useCallback(() => {
    const text = filteredEntries
      .map((e) => `[${e.timestamp}] [${e.level.toUpperCase()}] [${e.code}] ${e.message}${e.stack ? '\n' + e.stack : ''}`)
      .join('\n');
    void copyToClipboard(text);
  }, [filteredEntries]);

  const handleCopyEntry = useCallback((entry: LogEntry, index: number) => {
    const text = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.code}] ${entry.message}${entry.stack ? '\n' + entry.stack : ''}`;
    void copyToClipboard(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  }, []);

  const handleClear = useCallback(async () => {
    try {
      await fetch('/api/logs', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      setEntries([]);
    } catch { /* ignore */ }
  }, []);

  const counts = useMemo(() => {
    const error = entries.filter((e) => e.level === 'error').length;
    const warn = entries.filter((e) => e.level === 'warn').length;
    const info = entries.filter((e) => e.level === 'info').length;
    return { error, warn, info, total: entries.length };
  }, [entries]);

  return (
    <Box
      sx={{
        height: '100%',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: colors.bg.secondary,
        overflow: 'hidden',
      }}
    >
      <PanelHeader
        title="System Logs"
        subtitle={`Live system event stream · ${connected ? '● LIVE' : '○ disconnected'} · ${counts.total} total`}
        inline
        compact
        action={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Tooltip title="Copy logs">
              <IconButton size="small" onClick={handleCopy} sx={{ color: colors.text.tertiary }}>
                <ContentCopyIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Clear logs">
              <IconButton size="small" onClick={handleClear} sx={{ color: colors.text.tertiary }}>
                <DeleteSweepIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
            {onTogglePosition && (
            <Tooltip title={position === 'right' ? 'Move to bottom' : 'Move to right'}>
              <IconButton size="small" onClick={onTogglePosition} sx={{ color: colors.text.tertiary }}>
                {position === 'right' ? <ViewStreamIcon sx={{ fontSize: 14 }} /> : <ViewColumnIcon sx={{ fontSize: 14 }} />}
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Close">
            <IconButton size="small" onClick={onClose} sx={{ color: colors.text.tertiary }}>
              <KeyboardArrowDownIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>
      }
    />

    {/* Toolbar — same row height as compact panel header */}
    <Box sx={{ px: 2, py: 0.75, minHeight: 36, boxSizing: 'border-box', borderBottom: `1px solid ${colors.border.subtle}`, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
      {/* Level filter chips */}
      {(['all', 'error', 'warn', 'info'] as LevelFilter[]).map((level) => (
        <Chip
          key={level}
          label={
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem' }}>
              {level === 'all' ? `all (${counts.total})` : `${level} (${counts[level]})`}
            </span>
          }
          size="small"
          variant={filter === level ? 'filled' : 'outlined'}
          onClick={() => setFilter(level)}
          sx={{
            height: 22,
            borderRadius: '4px',
            ...(filter === level
              ? {
                  bgcolor: level === 'all' ? colors.bg.hover : LEVEL_BG[level],
                  color: level === 'all' ? colors.text.primary : LEVEL_COLORS[level],
                  borderColor: level === 'all' ? colors.border.default : LEVEL_COLORS[level],
                  '&:hover': { bgcolor: level === 'all' ? colors.bg.tertiary : LEVEL_BG[level] },
                }
              : {
                  color: colors.text.tertiary,
                  borderColor: colors.border.subtle,
                  '&:hover': { borderColor: colors.border.default, color: colors.text.secondary },
                }),
          }}
        />
      ))}

      {/* Search */}
      <Box
        component="input"
        placeholder="Search..."
        value={search}
        onChange={(e) => setSearch((e.target as HTMLInputElement).value)}
        sx={{
          width: 140,
          height: 24,
          px: 1,
          fontSize: '0.65rem',
          fontFamily: "'JetBrains Mono', monospace",
          bgcolor: colors.bg.primary,
          color: colors.text.primary,
          border: `1px solid ${colors.border.subtle}`,
          borderRadius: '4px',
          outline: 'none',
          '&:focus': { borderColor: colors.border.default },
          '&::placeholder': { color: colors.text.muted },
        }}
      />
    </Box>

      {/* Log entries */}
      <Box
        ref={scrollRef}
        onScroll={handleScroll}
        sx={{
          flex: 1,
          overflow: 'auto',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.65rem',
        }}
      >
        {filteredEntries.length === 0 ? (
          <Box sx={{ p: 3, textAlign: 'center', color: colors.text.muted }}>
            {entries.length === 0 ? 'Waiting for logs...' : 'No entries match the current filter.'}
          </Box>
        ) : (
          filteredEntries.map((entry, idx) => (
            <Box
              key={`${entry.timestamp}-${idx}`}
              onClick={() => setExpandedIndex(expandedIndex === idx ? null : idx)}
              sx={{
                display: 'flex',
                gap: 1.5,
                px: 2,
                py: 0.4,
                cursor: 'pointer',
                borderBottom: `1px solid ${colors.border.subtle}`,
                '&:hover': { bgcolor: colors.bg.hover },
                bgcolor: expandedIndex === idx ? colors.bg.tertiary : 'transparent',
              }}
            >
              <span style={{ color: colors.text.muted, whiteSpace: 'nowrap', minWidth: 100, flexShrink: 0 }}>
                {new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false })}
              </span>
              <span
                style={{
                  color: LEVEL_COLORS[entry.level],
                  fontWeight: 600,
                  minWidth: 38,
                  textTransform: 'uppercase',
                  flexShrink: 0,
                }}
              >
                {entry.level}
              </span>
              <span style={{ color: colors.accent.purple, minWidth: 120, flexShrink: 0 }}>{entry.code}</span>
              <span
                style={{
                  color: colors.text.secondary,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: expandedIndex === idx ? 'normal' : 'nowrap',
                  wordBreak: 'break-all',
                  flex: 1,
                }}
              >
                {entry.message}
                {!expandedIndex && (
                  <Box
                    component="span"
                    onClick={(e) => { e.stopPropagation(); handleCopyEntry(entry, idx); }}
                    sx={{ ml: 1, flexShrink: 0, display: 'inline-flex', alignItems: 'center', cursor: 'pointer', color: copiedIndex === idx ? colors.accent.green : colors.text.muted, '&:hover': { color: copiedIndex === idx ? colors.accent.green : colors.text.primary } }}
                  >
                    {copiedIndex === idx ? (
                      <span style={{ fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>copied</span>
                    ) : (
                      <ContentCopyIcon sx={{ fontSize: 10 }} />
                    )}
                  </Box>
                )}
                <Collapse in={expandedIndex === idx} unmountOnExit>
                  {entry.stack && (
                    <Box
                      component="pre"
                      sx={{
                        mt: 0.5,
                        p: 1,
                        fontSize: '0.6rem',
                        bgcolor: colors.bg.primary,
                        borderRadius: '4px',
                        color: colors.text.muted,
                        overflow: 'auto',
                        maxHeight: 200,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {entry.stack}
                    </Box>
                  )}
                  {entry.context && (
                    <Box
                      component="pre"
                      sx={{
                        mt: 0.5,
                        p: 1,
                        fontSize: '0.6rem',
                        bgcolor: colors.bg.primary,
                        borderRadius: '4px',
                        color: colors.text.muted,
                        overflow: 'auto',
                        maxHeight: 150,
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {JSON.stringify(entry.context, null, 2)}
                    </Box>
                  )}
                </Collapse>
              </span>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}
