import { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { colors, alphaColor } from '../theme';
import { sessions, type ChatMessage } from '../api';
import { stripToolNoise } from './utils';
import type { ToolCall } from './types';

export interface ChildSessionDrawerState {
  childSessionId: string;
  label: string;
  kind: 'sub_agent' | 'crew_worker';
}

export interface ChildSessionLiveActivity {
  currentStep?: string;
  thinking?: string;
  streamContent?: string;
  toolCalls?: ToolCall[];
  status?: 'running' | 'done' | 'error';
}

interface ChildSessionDrawerProps {
  open: boolean;
  state: ChildSessionDrawerState | null;
  parentSessionTitle?: string;
  /** Live SSE-backed activity from the parent chat's subAgents[] entry. */
  liveActivity?: ChildSessionLiveActivity | null;
  onClose: () => void;
}

interface PreviewPart {
  type?: string;
  toolName?: string;
  tool_name?: string;
  toolCallId?: string;
  tool_call_id?: string;
  toolSuccess?: boolean;
  tool_success?: boolean;
  content?: string;
  toolResult?: string;
  tool_result?: string;
  createdAt?: string | number;
  timestamp?: number;
  created_at?: string | number;
}

type LogKind = 'tool' | 'thought';

interface LogEntry {
  id: string;
  kind: LogKind;
  text: string;
  ts: number;
}

const MONO = "'JetBrains Mono', monospace";

function partTimestamp(p: PreviewPart, fallback: number): number {
  const raw = p.createdAt ?? p.created_at ?? p.timestamp;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw) {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

function toolNameOf(p: PreviewPart): string {
  return String(p.toolName || p.tool_name || 'tool');
}

function toolIdOf(p: PreviewPart): string {
  return String(p.toolCallId || p.tool_call_id || '');
}

function clip(text: string, max = 220): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function buildChronologicalLog(
  parts: PreviewPart[],
  assistantMessages: ChatMessage[],
  liveActivity: ChildSessionLiveActivity | null | undefined,
): LogEntry[] {
  const entries: LogEntry[] = [];
  const seenToolIds = new Set<string>();
  let seq = 0;
  const push = (kind: LogKind, text: string, ts: number) => {
    const cleaned = text.trim();
    if (!cleaned) return;
    entries.push({ id: `log-${seq++}`, kind, text: cleaned, ts });
  };

  // Persistable parts — already roughly chronological from the store.
  parts.forEach((p, i) => {
    const type = String(p.type || '');
    const ts = partTimestamp(p, i);
    if (type === 'tool-call' || (type === 'tool' && toolNameOf(p))) {
      const id = toolIdOf(p);
      if (id) seenToolIds.add(id);
      push('tool', `→ ${toolNameOf(p)}`, ts);
      return;
    }
    if (type === 'tool-result') {
      const id = toolIdOf(p);
      if (id) seenToolIds.add(id);
      const ok = p.toolSuccess !== false && p.tool_success !== false;
      const detail = String(p.toolResult || p.tool_result || p.content || '');
      push('tool', `${ok ? '✓' : '✕'} ${toolNameOf(p)}${detail ? ` — ${clip(detail, 160)}` : ''}`, ts);
      return;
    }
    if (type === 'text-delta' || type === 'text' || type === 'thinking' || type === 'reasoning') {
      const content = String(p.content || '').trim();
      if (content) push('thought', clip(stripToolNoise(content), 280), ts);
    }
  });

  // Live tool calls not yet represented in polled parts.
  const liveTools = liveActivity?.toolCalls ?? [];
  for (const t of liveTools) {
    if (t.id && seenToolIds.has(t.id)) continue;
    if (t.id) seenToolIds.add(t.id);
    const mark = t.status === 'running' ? '…' : t.status === 'done' ? '✓' : t.status === 'error' ? '✕' : '→';
    const detail = t.streamOutput?.slice(-120) || (t.result ? String(t.result).slice(0, 120) : '');
    push('tool', `${mark} ${t.name}${detail ? ` — ${clip(detail, 160)}` : ''}`, Date.now());
  }

  // Live thinking / stream (SSE) — append after persisted timeline.
  if (liveActivity?.thinking?.trim()) {
    push('thought', clip(stripToolNoise(liveActivity.thinking.slice(-900)), 320), Date.now());
  }
  if (liveActivity?.streamContent?.trim()) {
    push('thought', clip(stripToolNoise(liveActivity.streamContent), 320), Date.now());
  }

  // Persisted assistant turns (final write-ups) when not already covered by live stream.
  const liveStream = (liveActivity?.streamContent || '').trim();
  for (const m of assistantMessages) {
    const content = stripToolNoise(m.content || '').trim();
    if (!content) continue;
    if (liveStream && (liveStream.includes(content.slice(0, 80)) || content.includes(liveStream.slice(0, 80)))) {
      continue;
    }
    const ts = m.createdAt ? Date.parse(String(m.createdAt)) : Date.now();
    push('thought', clip(content, 320), Number.isNaN(ts) ? Date.now() : ts);
  }

  return entries;
}

export function ChildSessionDrawer({ open, state, parentSessionTitle, liveActivity, onClose }: ChildSessionDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [parts, setParts] = useState<PreviewPart[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [taskExpanded, setTaskExpanded] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !state?.childSessionId) return;
    let cancelled = false;
    let first = true;

    const load = async () => {
      if (first) {
        setLoading(true);
        setError(null);
        setTaskExpanded(false);
      }
      try {
        const data = await sessions.preview(state.childSessionId);
        if (cancelled) return;
        setMessages(data.messages ?? []);
        setParts((data.parts ?? []) as PreviewPart[]);
        setError(null);
      } catch (e) {
        if (!cancelled && first) setError(e instanceof Error ? e.message : 'Failed to load session');
      } finally {
        if (!cancelled && first) setLoading(false);
        first = false;
      }
    };

    void load();
    const id = setInterval(() => { void load(); }, 1200);
    return () => { cancelled = true; clearInterval(id); };
  }, [open, state?.childSessionId]);

  const assistantMessages = useMemo(
    () => messages.filter((m) => m.role === 'assistant'),
    [messages],
  );
  const taskText = useMemo(() => {
    const fromUser = messages
      .filter((m) => m.role === 'user')
      .map((m) => stripToolNoise(m.content || ''))
      .join('\n\n')
      .trim();
    return fromUser || (state?.label ?? '').trim();
  }, [messages, state?.label]);

  const logEntries = useMemo(
    () => buildChronologicalLog(parts, assistantMessages, liveActivity),
    [parts, assistantMessages, liveActivity],
  );

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logEntries.length, liveActivity?.thinking, liveActivity?.streamContent]);

  if (!open || !state) return null;

  const accent = state.kind === 'crew_worker' ? colors.accent.purple : colors.accent.cyan;
  const toolColor = colors.accent.cyan;
  const thoughtColor = colors.text.dim;
  const running = liveActivity?.status === 'running'
    || (liveActivity != null && liveActivity.status !== 'done' && liveActivity.status !== 'error');

  return (
    <>
      <Box
        onClick={onClose}
        sx={{
          position: 'absolute',
          inset: 0,
          bgcolor: alphaColor(colors.bg.primary, 0.55),
          zIndex: 20,
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 88,
          maxHeight: 'min(58vh, 520px)',
          zIndex: 21,
          borderRadius: '10px',
          border: `1px solid ${colors.border.default}`,
          bgcolor: colors.bg.primary,
          boxShadow: `0 12px 40px ${colors.shadow.heavy}`,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'agentx-fadeIn 0.2s ease-out',
        }}
      >
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.25,
          py: 0.75,
          borderBottom: `1px solid ${colors.border.subtle}`,
          bgcolor: colors.bg.secondary,
        }}>
          <IconButton size="small" onClick={onClose} sx={{ color: colors.text.dim, p: 0.4 }}>
            <ArrowBackIcon sx={{ fontSize: 15 }} />
          </IconButton>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: accent, fontFamily: MONO }}>
              {state.kind === 'crew_worker' ? 'Crew worker' : 'Sub-agent'}
              {liveActivity?.status ? ` · ${liveActivity.status}` : running ? ' · running' : ''}
            </Typography>
            <Typography sx={{
              fontSize: '0.48rem',
              color: colors.text.dim,
              fontFamily: MONO,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {state.label}
              {parentSessionTitle ? ` · from ${parentSessionTitle}` : ''}
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose} sx={{ color: colors.text.dim, p: 0.4 }}>
            <CloseIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Box>

        {/* Task brief — top, collapsed by default */}
        {taskText && (
          <Box sx={{ borderBottom: `1px solid ${colors.border.subtle}`, bgcolor: colors.bg.secondary }}>
            <Box
              onClick={() => setTaskExpanded((v) => !v)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 1.25,
                py: 0.55,
                cursor: 'pointer',
                '&:hover': { bgcolor: colors.bg.tertiary },
              }}
            >
              <Typography sx={{
                fontSize: '0.48rem',
                fontWeight: 600,
                color: colors.text.dim,
                fontFamily: MONO,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                flexShrink: 0,
              }}>
                Task
              </Typography>
              {!taskExpanded && (
                <Typography sx={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: '0.55rem',
                  color: colors.text.secondary,
                  fontFamily: MONO,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  opacity: 0.85,
                }}>
                  {taskText}
                </Typography>
              )}
              <Box sx={{ flex: taskExpanded ? 1 : undefined }} />
              {taskExpanded
                ? <ExpandLessIcon sx={{ fontSize: 14, color: colors.text.dim }} />
                : <ExpandMoreIcon sx={{ fontSize: 14, color: colors.text.dim }} />}
            </Box>
            <Collapse in={taskExpanded}>
              <Typography sx={{
                px: 1.25,
                pb: 0.85,
                fontSize: '0.58rem',
                color: colors.text.secondary,
                fontFamily: MONO,
                lineHeight: 1.45,
                whiteSpace: 'pre-wrap',
              }}>
                {taskText}
              </Typography>
            </Collapse>
          </Box>
        )}

        {/* Chronological tool / thought log */}
        <Box
          ref={logRef}
          sx={{
            flex: 1,
            overflow: 'auto',
            px: 1.25,
            py: 1,
            bgcolor: colors.bg.primary,
            fontFamily: MONO,
            fontSize: '0.6rem',
            scrollbarWidth: 'thin',
          }}
        >
          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={18} sx={{ color: accent }} />
            </Box>
          )}
          {error && (
            <Typography sx={{ fontSize: '0.6rem', color: colors.accent.red, fontFamily: MONO }}>{error}</Typography>
          )}
          {!loading && !error && logEntries.length === 0 && (
            <Typography sx={{ color: colors.text.dim, fontSize: '0.6rem', fontFamily: MONO }}>
              {running || liveActivity?.status === 'running' ? 'Waiting for output…' : 'No activity yet.'}
            </Typography>
          )}
          {!loading && logEntries.map((entry) => (
            <Box
              key={entry.id}
              sx={{
                mb: 0.45,
                lineHeight: 1.45,
                color: entry.kind === 'tool' ? toolColor : thoughtColor,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              <Box component="span" sx={{ color: colors.text.dim, mr: 0.75, opacity: 0.7 }}>
                {new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </Box>
              <Box component="span" sx={{ mr: 0.5, opacity: 0.55 }}>
                {entry.kind === 'tool' ? 'tool' : 'think'}
              </Box>
              {entry.text}
            </Box>
          ))}
        </Box>
      </Box>
    </>
  );
}
