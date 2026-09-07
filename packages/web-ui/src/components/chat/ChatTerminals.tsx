/**
 * ChatTerminals — shows active terminal sessions in the right sidebar.
 *
 * Each terminal shows:
 *   - Command label and PID
 *   - Live status (RUNNING / EXIT)
 *   - A collapsible xterm.js view with live output
 *   - Kill button
 *
 * The agent uses terminal_start/terminal_read/terminal_send tools to interact
 * with these terminals. This UI gives the user visibility into what the agent
 * is running and debugging.
 */
import React, { useEffect, useState, useRef, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import TerminalIcon from '@mui/icons-material/Terminal';
import StopCircleIcon from '@mui/icons-material/StopCircle';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { colors } from '../../theme';
import type { SxProps } from '@mui/material/styles';

export interface TerminalInfo {
  id: string;
  sessionId: string;
  command: string;
  cwd: string;
  label: string;
  pid: number;
  alive: boolean;
  exitCode: number | null;
  createdAt: number;
  outputLength: number;
  tail: string;
}

export interface ChatTerminalsProps {
  sessionId: string;
  sidebarSectionHeaderWithDividerSx: (expanded: boolean) => SxProps;
  sidebarSectionContentSx: SxProps;
}

function getWsBase(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}`;
}

export const ChatTerminals = React.memo(function ChatTerminals(props: ChatTerminalsProps) {
  const { sessionId, sidebarSectionHeaderWithDividerSx, sidebarSectionContentSx } = props;
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [openTerminals, setOpenTerminals] = useState<Set<string>>(new Set());

  // Poll for terminal list
  useEffect(() => {
    if (!sessionId) { setTerminals([]); return; }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/terminals`);
        if (!res.ok) return;
        const data = await res.json() as { terminals: TerminalInfo[] };
        if (!cancelled) setTerminals(data.terminals ?? []);
      } catch {
        if (!cancelled) setTerminals([]);
      }
    };
    load();
    const id = setInterval(load, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [sessionId]);

  const killTerminal = useCallback(async (tid: string) => {
    try {
      await fetch(`/api/sessions/${sessionId}/terminals/${tid}`, { method: 'DELETE' });
    } catch { /* best-effort */ }
  }, [sessionId]);

  const toggleTerminal = useCallback((tid: string) => {
    setOpenTerminals((prev) => {
      const next = new Set(prev);
      if (next.has(tid)) next.delete(tid);
      else next.add(tid);
      return next;
    });
  }, []);

  if (terminals.length === 0) return null;

  return (
    <Box>
      <Box
        onClick={() => setExpanded(!expanded)}
        sx={sidebarSectionHeaderWithDividerSx(expanded)}
      >
        <TerminalIcon sx={{ fontSize: 12, color: colors.accent.cyan }} />
        <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, letterSpacing: '1px', flex: 1 }}>
          {expanded ? '▾' : '▸'} TERMINALS
        </Typography>
        <Typography sx={{ fontSize: '0.45rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim }}>
          {terminals.length}
        </Typography>
      </Box>
      {expanded && (
        <Box sx={sidebarSectionContentSx}>
          {terminals.map((t) => (
            <TerminalEntry
              key={t.id}
              terminal={t}
              open={openTerminals.has(t.id)}
              onToggle={() => toggleTerminal(t.id)}
              onKill={() => killTerminal(t.id)}
            />
          ))}
        </Box>
      )}
    </Box>
  );
});

interface TerminalEntryProps {
  terminal: TerminalInfo;
  open: boolean;
  onToggle: () => void;
  onKill: () => void;
}

const TerminalEntry = React.memo(function TerminalEntry(props: TerminalEntryProps) {
  const { terminal, open, onToggle, onKill } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Set up xterm when opened
  useEffect(() => {
    if (!open || !containerRef.current) return;

    const term = new Terminal({
      fontSize: 10,
      fontFamily: "'JetBrains Mono', monospace",
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
      },
      convertEol: true,
      scrollback: 5000,
      disableStdin: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    // Connect WebSocket for live output
    const wsUrl = `${getWsBase()}/ws/terminal?tid=${terminal.id}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'data') {
          term.write(msg.data);
        } else if (msg.type === 'exit') {
          term.write(`\r\n\x1b[33m[Process exited with code ${msg.exitCode}]\x1b[0m\r\n`);
        }
      } catch { /* ignore */ }
    };

    ws.onopen = () => {
      // Write initial tail
      if (terminal.tail) {
        term.write(terminal.tail + '\r\n');
      }
    };

    const handleResize = () => fit.fit();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      ws.close();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [open, terminal.id]);

  // Update fit when container size changes
  useEffect(() => {
    if (open && fitRef.current && containerRef.current) {
      try { fitRef.current.fit(); } catch { /* ignore */ }
    }
  }, [open]);

  const status = terminal.alive
    ? <span style={{ color: colors.accent.green }}>RUNNING</span>
    : <span style={{ color: colors.accent.red }}>EXIT({terminal.exitCode})</span>;

  return (
    <Box sx={{ mb: 0.5, border: `1px solid ${colors.border.default}`, borderRadius: '4px', overflow: 'hidden' }}>
      <Box
        onClick={onToggle}
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer',
          py: 0.25, px: 0.5, bgcolor: colors.bg.tertiary,
          '&:hover': { bgcolor: colors.bg.secondary },
        }}
      >
        {open
          ? <ExpandMoreIcon sx={{ fontSize: 10, color: colors.text.dim }} />
          : <ChevronRightIcon sx={{ fontSize: 10, color: colors.text.dim }} />
        }
        <Typography sx={{
          fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace",
          color: colors.text.primary, flex: 1, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {terminal.label}
        </Typography>
        <Typography sx={{ fontSize: '0.4rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim }}>
          {status}
        </Typography>
        {terminal.alive && (
          <Tooltip title="Kill terminal">
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); onKill(); }}
              sx={{ p: 0.25 }}
            >
              <StopCircleIcon sx={{ fontSize: 10, color: colors.accent.red }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {open && (
        <Box
          ref={containerRef}
          sx={{
            height: 200, bgcolor: '#0d1117',
            '& .xterm': { padding: '4px' },
          }}
        />
      )}
    </Box>
  );
});
