import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { colors } from '../theme';
import { getAuthToken } from '../api';

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
  error: 'rgba(248,81,73,0.12)',
  warn: 'rgba(210,153,34,0.12)',
  info: 'rgba(88,166,255,0.12)',
};

export interface LogsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function LogsPanel({ open, onClose }: LogsPanelProps) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LevelFilter>('all');
  const [search, setSearch] = useState('');
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

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
    if (open) {
      fetch('/api/logs?limit=200', {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      })
        .then((r) => r.json())
        .then((d) => {
          if (Array.isArray(d.entries)) setEntries(d.entries);
        })
        .catch(() => {});
      connectSSE();
    } else {
      esRef.current?.close();
      esRef.current = null;
      setConnected(false);
    }
    return () => {
      esRef.current?.close();
    };
  }, [open, connectSSE]);

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
    navigator.clipboard.writeText(text).catch(() => {});
  }, [filteredEntries]);

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

  if (!open) return null;

  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '42vh',
        borderTop: `1px solid ${colors.border.default}`,
        bgcolor: colors.bg.secondary,
        zIndex: 1200,
        display: 'flex',
        flexDirection: 'column',
        animation: 'slideUp 0.2s ease-out',
        '@keyframes slideUp': {
          from: { transform: 'translateY(100%)', opacity: 0 },
          to: { transform: 'translateY(0)', opacity: 1 },
        },
        boxShadow: '0 -4px 24px rgba(0,0,0,0.4)',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2,
          py: 0.75,
          borderBottom: `1px solid ${colors.border.subtle}`,
          flexShrink: 0,
          minHeight: 42,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: colors.text.primary, fontFamily: "'JetBrains Mono', monospace" }}>
            Logs
          </span>
          <span
            style={{
              fontSize: '0.6rem',
              color: connected ? colors.accent.green : colors.accent.red,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {connected ? '● LIVE' : '○ disconnected'}
          </span>
          <span style={{ fontSize: '0.6rem', color: colors.text.muted, fontFamily: "'JetBrains Mono', monospace" }}>
            {counts.total} total
          </span>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
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

          <Box sx={{ width: 8 }} />

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
          <Tooltip title="Close">
            <IconButton size="small" onClick={onClose} sx={{ color: colors.text.tertiary }}>
              <KeyboardArrowDownIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>
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
                {entry.stack && expandedIndex === idx && (
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
                {entry.context && expandedIndex === idx && (
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
              </span>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}
