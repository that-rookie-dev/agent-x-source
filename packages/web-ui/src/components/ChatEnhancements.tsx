// ChatEnhancements — "jaw-drop" chat UX upgrades layered onto ChatPanel.
// Components: ConnectionHealthDot, ScrollToBottomPill, SlashCommandMenu,
// SessionSearchModal, DoomLoopWarning, ReasoningBlock,
// CheckpointDrawer, TurnTokenBadge, StreamingCursor.

import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import SearchIcon from '@mui/icons-material/Search';
import HistoryIcon from '@mui/icons-material/History';
import RestoreIcon from '@mui/icons-material/Restore';
import CloseIcon from '@mui/icons-material/Close';
import PsychologyIcon from '@mui/icons-material/Psychology';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import BoltIcon from '@mui/icons-material/Bolt';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import ReplayIcon from '@mui/icons-material/Replay';
import UndoIcon from '@mui/icons-material/Undo';
import CompressIcon from '@mui/icons-material/Compress';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import DownloadIcon from '@mui/icons-material/Download';
import FlagIcon from '@mui/icons-material/Flag';
import GroupIcon from '@mui/icons-material/Group';
import { sessions, type ConnectionState, type Checkpoint } from '../api';
import type { Crew } from '../api';
import { colors, alphaColor } from '../theme';
import { crewRequiresMedicalDisclaimer } from '@agentx/shared/browser';

// ─────────────────────────────────────────────────────────────────────────────
// 1. ConnectionHealthDot — green/yellow/red dot with last-event timestamp
// ─────────────────────────────────────────────────────────────────────────────

export function ConnectionHealthDot({
  state,
  lastEventAt,
}: {
  state: ConnectionState;
  lastEventAt: number | null;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const color =
    state === 'open' ? colors.accent.green :
    state === 'reconnecting' ? colors.accent.orange :
    state === 'connecting' ? colors.accent.blue :
    colors.accent.red;

  const label =
    state === 'open' ? 'Live' :
    state === 'reconnecting' ? 'Reconnecting' :
    state === 'connecting' ? 'Connecting' :
    'Offline';

  const ago = lastEventAt ? formatAgo(Date.now() - lastEventAt) : 'no events yet';
  const tip = `${label} · ${ago}`;

  return (
    <Tooltip title={tip} arrow>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, px: 0.5 }}>
        <Box
          sx={{
            width: 7, height: 7, borderRadius: '50%',
            bgcolor: color,
            boxShadow: state === 'open' ? `0 0 6px ${alphaColor(color, '80')}` : 'none',
            animation: state === 'reconnecting' ? 'agentx-pulse 1s ease-in-out infinite' : 'none',
          }}
        />
        <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
          {label}
        </Typography>
      </Box>
    </Tooltip>
  );
}

function formatAgo(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. ScrollToBottomPill — grey circle, bottom-right; shows when scrolled up
// ─────────────────────────────────────────────────────────────────────────────

export const ScrollToBottomPill = memo(function ScrollToBottomPill({
  visible,
  onClick,
}: {
  visible: boolean;
  unread?: number;
  onClick: () => void;
}) {
  if (!visible) return null;
  return (
    <Box
      onClick={onClick}
      sx={{
        position: 'absolute',
        bottom: 16,
        right: 16,
        zIndex: 10,
        width: 32,
        height: 32,
        borderRadius: '50%',
        bgcolor: colors.bg.tertiary,
        border: `1px solid ${colors.border.default}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        animation: 'agentx-fadeIn 0.15s ease-out',
        '&:hover': { bgcolor: colors.bg.secondary, borderColor: colors.border.strong },
      }}
    >
      <KeyboardArrowDownIcon sx={{ fontSize: 18, color: colors.text.secondary }} />
    </Box>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. SlashCommandMenu — autocomplete dropdown for `/` commands
// ─────────────────────────────────────────────────────────────────────────────

export interface SlashCommand {
  name: string;
  description: string;
  icon: React.ReactNode;
  example?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/help',     description: 'Show all slash commands',                       icon: <HelpOutlineIcon sx={{ fontSize: 13 }} /> },
  { name: '/clear',    description: 'Clear the current chat',                        icon: <DeleteSweepIcon sx={{ fontSize: 13 }} /> },
  { name: '/compact',  description: 'Summarize older messages to free context',      icon: <CompressIcon sx={{ fontSize: 13 }} /> },
  { name: '/retry',    description: 'Re-run the last user message',                  icon: <ReplayIcon sx={{ fontSize: 13 }} /> },
  { name: '/undo',     description: 'Restore last checkpoint (rollback this turn)',  icon: <UndoIcon sx={{ fontSize: 13 }} />, example: '/undo or /undo 3' },
  { name: '/checkpoint', description: 'Save a named checkpoint',                     icon: <HistoryIcon sx={{ fontSize: 13 }} />, example: '/checkpoint label here' },
  { name: '/checkpoints', description: 'Open checkpoint history drawer',             icon: <RestoreIcon sx={{ fontSize: 13 }} /> },
  { name: '/search',   description: 'Search across all sessions',                    icon: <SearchIcon sx={{ fontSize: 13 }} />, example: '/search auth bug' },
  { name: '/think',    description: 'Force the agent to plan before acting',         icon: <PsychologyIcon sx={{ fontSize: 13 }} />, example: '/think build a CRUD app' },
  { name: '/yolo',     description: 'Toggle full-auto approval for the next turn',   icon: <BoltIcon sx={{ fontSize: 13 }} /> },
  { name: '/export',   description: 'Download full session trajectory as JSON',      icon: <DownloadIcon sx={{ fontSize: 13 }} /> },
  { name: '/goal',     description: 'Set a multi-step goal (Goal Mode)',             icon: <FlagIcon sx={{ fontSize: 13 }} />, example: '/goal Build a chat app with auth' },
];

export function SlashCommandMenu({
  query,
  onSelect,
  onClose,
}: {
  query: string;
  onSelect: (cmd: SlashCommand) => void;
  onClose: () => void;
}) {
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return SLASH_COMMANDS.filter(c => c.name.toLowerCase().startsWith(q));
  }, [query]);

  const [active, setActive] = useState(0);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (filtered.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(i => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(i => Math.max(0, i - 1));
      } else if (e.key === 'Tab' || e.key === 'Enter') {
        const cmd = filtered[active];
        if (cmd) {
          e.preventDefault();
          onSelect(cmd);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [filtered, active, onSelect, onClose]);

  if (filtered.length === 0) return null;

  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: 'calc(100% + 6px)',
        left: 0,
        right: 0,
        bgcolor: colors.bg.secondary,
        border: `1px solid ${alphaColor(colors.accent.purple, '40')}`,
        borderRadius: '10px',
        boxShadow: `0 8px 24px ${colors.shadow.heavy}`,
        maxHeight: 280,
        overflowY: 'auto',
        zIndex: 100,
        py: 0.5,
        animation: 'agentx-fadeIn 0.15s ease-out',
      }}
    >
      <Box sx={{ px: 1.25, py: 0.5, borderBottom: `1px solid ${colors.border.subtle}`, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, letterSpacing: '1px' }}>
          SLASH COMMANDS
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim }}>↑↓ navigate · ⏎ select · esc close</Typography>
      </Box>
      {filtered.map((cmd, i) => (
        <Box
          key={cmd.name}
          onClick={() => onSelect(cmd)}
          onMouseEnter={() => setActive(i)}
          sx={{
            px: 1.25, py: 0.6,
            display: 'flex', alignItems: 'center', gap: 0.75,
            cursor: 'pointer',
            bgcolor: i === active ? alphaColor(colors.accent.purple, '15') : 'transparent',
            borderLeft: i === active ? `2px solid ${colors.accent.purple}` : '2px solid transparent',
          }}
        >
          <Box sx={{ color: colors.accent.purple, display: 'flex' }}>{cmd.icon}</Box>
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: colors.text.primary, fontFamily: "'JetBrains Mono', monospace" }}>
            {cmd.name}
          </Typography>
          <Typography sx={{ fontSize: '0.6rem', color: colors.text.dim, flex: 1 }}>{cmd.description}</Typography>
          {cmd.example && (
            <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", fontStyle: 'italic' }}>
              {cmd.example}
            </Typography>
          )}
        </Box>
      ))}
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3b. CrewMentionMenu — @-mention autocomplete for crew members
// ─────────────────────────────────────────────────────────────────────────────

export function CrewMentionMenu({
  query,
  crewList,
  onSelect,
  onClose,
}: {
  query: string;
  crewList: Crew[];
  onSelect: (crew: Crew) => void;
  onClose: () => void;
}) {
  const q = query.toLowerCase();
  const filtered = query === ''
    ? crewList
    : crewList.filter(c => c.name.toLowerCase().includes(q) || c.callsign.toLowerCase().includes(q));

  const [active, setActive] = useState(0);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const handleKeyboard = useCallback((e: KeyboardEvent) => {
    if (filtered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(i => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(i => Math.max(0, i - 1));
      } else if (e.key === 'Tab' || e.key === 'Enter') {
        const crew = filtered[active];
        if (crew) {
          e.preventDefault();
          onSelect(crew);
        }
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [filtered, active, onSelect, onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyboard, true);
    return () => window.removeEventListener('keydown', handleKeyboard, true);
  }, [handleKeyboard]);

  const isEmpty = crewList.length === 0;

  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: 'calc(100% + 6px)',
        left: 0,
        right: 0,
        bgcolor: colors.bg.secondary,
        border: `1px solid ${alphaColor(colors.accent.blue, '40')}`,
        borderRadius: '10px',
        boxShadow: `0 8px 24px ${colors.shadow.heavy}`,
        maxHeight: 280,
        overflowY: 'auto',
        zIndex: 100,
        py: 0.5,
        animation: 'agentx-fadeIn 0.15s ease-out',
      }}
    >
      <Box sx={{ px: 1.25, py: 0.5, borderBottom: `1px solid ${colors.border.subtle}`, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <GroupIcon sx={{ fontSize: 13, color: colors.accent.blue }} />
        <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, letterSpacing: '1px' }}>
          MENTIONS
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim }}>↑↓ · ⏎ select · esc</Typography>
      </Box>
      {filtered.length > 0 ? (
        filtered.map((crew, i) => (
          <Box
            key={crew.id}
            onClick={() => onSelect(crew)}
            onMouseEnter={() => setActive(i)}
            sx={{
              px: 1.25, py: 0.6,
              display: 'flex', alignItems: 'center', gap: 0.75,
              cursor: 'pointer',
              bgcolor: i === active ? alphaColor(colors.accent.blue, '15') : 'transparent',
              borderLeft: i === active ? `2px solid ${colors.accent.blue}` : '2px solid transparent',
            }}
          >
            <Box sx={{ flex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: colors.text.primary, fontFamily: "'JetBrains Mono', monospace" }}>
                  @{crew.callsign}
                </Typography>
                {crewRequiresMedicalDisclaimer({
                  catalogId: crew.catalogId ?? crew.id,
                  categoryId: crew.categoryId,
                  requiresMedicalDisclaimer: crew.requiresMedicalDisclaimer,
                }) && (
                  <Typography sx={{ fontSize: '0.45rem', color: colors.accent.orange, fontWeight: 800 }}>⚠ MED</Typography>
                )}
                {crew.title && (
                  <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim }}>
                    — {crew.title}
                  </Typography>
                )}
              </Box>
              <Typography sx={{ fontSize: '0.6rem', color: colors.text.secondary }}>
                {crew.name}
              </Typography>
            </Box>
          </Box>
        ))
      ) : (
        <Box sx={{ px: 1.25, py: 1.5, textAlign: 'center' }}>
          <Typography sx={{ fontSize: '0.65rem', color: colors.text.dim }}>
            {isEmpty ? 'No crews available' : 'No matching crews'}
          </Typography>
          {isEmpty && (
            <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, mt: 0.25 }}>
              Add crews from the Crews panel to @mention them
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. SessionSearchModal — cross-session full-text search
// ─────────────────────────────────────────────────────────────────────────────

export function SessionSearchModal({
  open,
  onClose,
  onPickSession,
}: {
  open: boolean;
  onClose: () => void;
  onPickSession: (sessionId: string) => void;
}) {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Awaited<ReturnType<typeof sessions.search>>>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim() || !open) { setResults([]); return; }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try { setResults(await sessions.search(q)); }
      catch { setResults([]); }
      finally { setLoading(false); }
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q, open]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth
      PaperProps={{
        sx: {
          bgcolor: colors.bg.secondary,
          border: `1px solid ${alphaColor(colors.accent.blue, '40')}`,
          borderRadius: '14px',
        },
      }}
    >
      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.5, borderBottom: `1px solid ${colors.border.default}` }}>
          <SearchIcon sx={{ fontSize: 16, color: colors.accent.blue }} />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search across all sessions..."
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              color: colors.text.primary, fontSize: '0.85rem',
            }}
          />
          {loading && <CircularProgress size={12} sx={{ color: colors.accent.blue }} />}
          <IconButton size="small" onClick={onClose}><CloseIcon sx={{ fontSize: 16 }} /></IconButton>
        </Box>
        <Box sx={{ maxHeight: 500, overflowY: 'auto', p: 1 }}>
          {!q && (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <SearchIcon sx={{ fontSize: 36, color: colors.border.strong, mb: 1 }} />
              <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim }}>
                Search across every session you've ever had with Agent-X
              </Typography>
            </Box>
          )}
          {q && !loading && results.length === 0 && (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim }}>No matches</Typography>
            </Box>
          )}
          {results.map((r) => (
            <Box
              key={r.sessionId}
              onClick={() => { onPickSession(r.sessionId); onClose(); }}
              sx={{
                p: 1.25, mb: 0.5, borderRadius: 1,
                border: `1px solid ${colors.border.default}`,
                cursor: 'pointer',
                '&:hover': { borderColor: alphaColor(colors.accent.blue, '60'), bgcolor: alphaColor(colors.accent.blue, '05') },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                <SmartToyIcon sx={{ fontSize: 12, color: colors.accent.purple }} />
                <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: colors.text.primary }}>
                  {r.sessionTitle}
                </Typography>
                <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", ml: 'auto' }}>
                  {r.sessionId.slice(0, 8)}
                </Typography>
              </Box>
              {r.matches.map((m, i) => (
                <Typography
                  key={i}
                  sx={{
                    fontSize: '0.6rem', color: colors.text.dim, lineHeight: 1.5,
                    fontFamily: "'JetBrains Mono', monospace",
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                  }}
                  dangerouslySetInnerHTML={{
                    __html: highlight(m.snippet, q),
                  }}
                />
              ))}
            </Box>
          ))}
        </Box>
      </DialogContent>
    </Dialog>
  );
}

function highlight(text: string, q: string): string {
  if (!q) return escapeHtml(text);
  const safe = escapeHtml(text);
  const re = new RegExp(escapeRegex(q), 'gi');
  return safe.replace(re, (m) => `<span style="background:${alphaColor(colors.accent.blue, '40')};color:${colors.accent.blue};">${m}</span>`);
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. DoomLoopWarning — banner when agent is calling same tool 3+ times
// ─────────────────────────────────────────────────────────────────────────────

export function DoomLoopWarning({
  toolName,
  count,
  onContinue,
  onStop,
}: {
  toolName: string;
  count: number;
  onContinue: () => void;
  onStop: () => void;
}) {
  return (
    <Box
      sx={{
        p: 1.25, mb: 1.5,
        borderRadius: 1.5,
        bgcolor: alphaColor(colors.accent.orange, '12'),
        border: `1px solid ${alphaColor(colors.accent.orange, '40')}`,
        animation: 'agentx-fadeIn 0.3s ease-out',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
        <WarningAmberIcon sx={{ fontSize: 16, color: colors.accent.orange }} />
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: colors.accent.orange }}>
          Possible loop detected
        </Typography>
      </Box>
      <Typography sx={{ fontSize: '0.62rem', color: colors.text.secondary, mb: 0.75, lineHeight: 1.5 }}>
        The agent has called <code style={{ color: colors.accent.orange, fontFamily: "'JetBrains Mono', monospace" }}>{toolName}</code> {count} times with similar input.
        It may be stuck. Stop now or let it continue.
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        <Chip size="small" label="Stop" onClick={onStop}
          sx={{ height: 22, fontSize: '0.55rem', bgcolor: alphaColor(colors.accent.red, '15'), color: colors.accent.red, cursor: 'pointer', '&:hover': { bgcolor: alphaColor(colors.accent.red, '28') } }} />
        <Chip size="small" label="Continue" onClick={onContinue}
          sx={{ height: 22, fontSize: '0.55rem', bgcolor: alphaColor(colors.accent.green, '15'), color: colors.accent.green, cursor: 'pointer', '&:hover': { bgcolor: alphaColor(colors.accent.green, '28') } }} />
      </Box>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. ReasoningBlock — distinct expandable "thinking" UI like Claude
// ─────────────────────────────────────────────────────────────────────────────

export function ReasoningBlock({ text, streaming, durationMs }: { text: string; streaming?: boolean; durationMs?: number }) {
  const [open, setOpen] = useState(false);
  const lines = text.split('\n').filter(Boolean).length;

  return (
    <Box sx={{ mb: 0.75 }}>
      <Box
        onClick={() => setOpen(o => !o)}
        sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.5,
          px: 0.85, py: 0.35,
          borderRadius: '8px',
          bgcolor: alphaColor(colors.accent.purple, '08'),
          border: `1px dashed ${alphaColor(colors.accent.purple, '30')}`,
          cursor: 'pointer',
          '&:hover': { bgcolor: alphaColor(colors.accent.purple, '15'), borderStyle: 'solid' },
        }}
      >
        <PsychologyIcon sx={{ fontSize: 12, color: colors.accent.purple, ...(streaming ? { animation: 'agentx-pulse 1.4s ease-in-out infinite' } : {}) }} />
        <Typography sx={{ fontSize: '0.55rem', color: colors.accent.purple, fontWeight: 500, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.3px' }}>
          {streaming ? 'Thinking…' : `Thought ${durationMs ? `for ${(durationMs / 1000).toFixed(1)}s` : ''} · ${lines} ${lines === 1 ? 'line' : 'lines'}`}
        </Typography>
        <KeyboardArrowDownIcon sx={{ fontSize: 12, color: colors.accent.purple, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </Box>
      <Collapse in={open}>
        <Box
          sx={{
            mt: 0.5, p: 1,
            borderRadius: 1,
            bgcolor: alphaColor(colors.accent.purple, '06'),
            borderLeft: `2px solid ${alphaColor(colors.accent.purple, '60')}`,
            fontSize: '0.65rem',
            color: colors.text.secondary,
            fontStyle: 'italic',
            fontFamily: "'Inter', sans-serif",
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            maxHeight: 280,
            overflowY: 'auto',
          }}
        >
          {text}
        </Box>
      </Collapse>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. CheckpointDrawer — list + restore session checkpoints
// ─────────────────────────────────────────────────────────────────────────────

export function CheckpointDrawer({
  open,
  onClose,
  sessionId,
  onRestored,
}: {
  open: boolean;
  onClose: () => void;
  sessionId: string | null;
  onRestored: () => void;
}) {
  const [list, setList] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try { setList(await sessions.checkpoints(sessionId)); } catch { setList([]); }
    finally { setLoading(false); }
  }, [sessionId]);

  useEffect(() => { if (open) refresh(); }, [open, refresh]);

  const handleRestore = async (ckptId: string) => {
    if (!sessionId) return;
    setRestoring(ckptId);
    try {
      await sessions.restoreCheckpoint(sessionId, ckptId);
      onRestored();
      onClose();
    } catch { /* ignore */ }
    finally { setRestoring(null); }
  };

  const handleDelete = async (ckptId: string) => {
    if (!sessionId) return;
    try { await sessions.deleteCheckpoint(sessionId, ckptId); refresh(); } catch { /* ignore */ }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
      PaperProps={{
        sx: { bgcolor: colors.bg.secondary, border: `1px solid ${alphaColor(colors.accent.blue, '40')}`, borderRadius: '14px' },
      }}
    >
      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.5, borderBottom: `1px solid ${colors.border.default}` }}>
          <HistoryIcon sx={{ fontSize: 16, color: colors.accent.blue }} />
          <Typography sx={{ fontSize: '0.85rem', fontWeight: 600 }}>Checkpoints</Typography>
          <Box sx={{ flex: 1 }} />
          <IconButton size="small" onClick={onClose}><CloseIcon sx={{ fontSize: 16 }} /></IconButton>
        </Box>
        <Box sx={{ maxHeight: 450, overflowY: 'auto', p: 1 }}>
          {loading && <Box sx={{ p: 3, textAlign: 'center' }}><CircularProgress size={20} sx={{ color: colors.accent.blue }} /></Box>}
          {!loading && list.length === 0 && (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <HistoryIcon sx={{ fontSize: 36, color: colors.border.strong, mb: 1 }} />
              <Typography sx={{ fontSize: '0.7rem', color: colors.text.dim }}>
                No checkpoints yet. Type <code>/checkpoint</code> to save one.
              </Typography>
            </Box>
          )}
          {list.map((c) => (
            <Box
              key={c.id}
              sx={{
                p: 1.25, mb: 0.5, borderRadius: 1,
                border: `1px solid ${colors.border.default}`,
                display: 'flex', alignItems: 'center', gap: 1,
                '&:hover': { borderColor: alphaColor(colors.accent.blue, '60'), bgcolor: alphaColor(colors.accent.blue, '05') },
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: colors.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.label}
                </Typography>
                <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
                  {new Date(c.createdAt).toLocaleString()} · {c.messageCount} messages
                </Typography>
              </Box>
              <Chip size="small" label={restoring === c.id ? 'Restoring…' : 'Restore'} onClick={() => handleRestore(c.id)}
                sx={{ height: 22, fontSize: '0.55rem', bgcolor: alphaColor(colors.accent.green, '15'), color: colors.accent.green, cursor: 'pointer', '&:hover': { bgcolor: alphaColor(colors.accent.green, '28') } }} />
              <IconButton size="small" onClick={() => handleDelete(c.id)} sx={{ color: colors.text.dim, '&:hover': { color: colors.accent.red } }}>
                <CloseIcon sx={{ fontSize: 12 }} />
              </IconButton>
            </Box>
          ))}
        </Box>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. TurnTokenBadge — small inline token badge for assistant message
// ─────────────────────────────────────────────────────────────────────────────

export function TurnTokenBadge({ tokens }: { tokens?: number; costUsd?: number }) {
  if (!tokens) return null;
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, mt: 0.5, opacity: 0.55, fontFamily: "'JetBrains Mono', monospace" }}>
      <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim }}>{tokens.toLocaleString()} tok</Typography>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. StreamingCursor — animated caret appended to streaming text
// ─────────────────────────────────────────────────────────────────────────────

export function StreamingCursor() {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        width: 6, height: 12,
        ml: 0.3,
        verticalAlign: 'text-bottom',
        bgcolor: colors.accent.purple,
        animation: 'agentx-cursor-blink 1s steps(2) infinite',
      }}
    />
  );
}

// Inject cursor keyframe if not already
const cursorStyleId = 'agentx-cursor-keyframe';
if (typeof document !== 'undefined' && !document.getElementById(cursorStyleId)) {
  const s = document.createElement('style');
  s.id = cursorStyleId;
  s.textContent = `@keyframes agentx-cursor-blink { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }`;
  document.head.appendChild(s);
}
