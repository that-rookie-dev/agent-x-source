import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import StopCircleIcon from '@mui/icons-material/StopCircle';
import TerminalIcon from '@mui/icons-material/Terminal';
import type { SxProps } from '@mui/material/styles';
import { colors, alphaColor } from '../../theme';
import { processes, type AgentProcessInfo } from '../../api';

export interface ChatRunningAppsProps {
  sessionId: string;
  sidebarSectionHeaderWithDividerSx: (expanded: boolean) => SxProps;
  sidebarSectionContentSx: SxProps;
}

function formatDuration(startTime: number): string {
  const seconds = Math.floor((Date.now() - startTime) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return `${hours}h ${rem}m`;
}

function formatCommand(command: string): string {
  // Strip leading shell invocation so the actual app is visible.
  const trimmed = command.trim();
  if (trimmed.startsWith('/bin/sh -c ')) return trimmed.slice('/bin/sh -c '.length);
  if (trimmed.startsWith('/bin/bash -c ')) return trimmed.slice('/bin/bash -c '.length);
  if (trimmed.startsWith('sh -c ')) return trimmed.slice('sh -c '.length);
  if (trimmed.startsWith('bash -c ')) return trimmed.slice('bash -c '.length);
  return trimmed;
}

export const ChatRunningApps = React.memo(function ChatRunningApps(props: ChatRunningAppsProps) {
  const { sessionId, sidebarSectionHeaderWithDividerSx, sidebarSectionContentSx } = props;
  const [apps, setApps] = useState<AgentProcessInfo[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [killing, setKilling] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const list = await processes.bySession(sessionId);
        if (!cancelled) setApps(list.filter((a) => a.status !== 'exited'));
      } catch {
        if (!cancelled) setApps([]);
      }
    };
    load();
    const id = setInterval(load, 2500);
    return () => { cancelled = true; clearInterval(id); };
  }, [sessionId]);

  // Hide the entire section when there are no agent-started apps.
  if (apps.length === 0) return null;

  const handleKill = async (pid: number) => {
    setKilling((prev) => new Set(prev).add(pid));
    try {
      await processes.kill(pid, sessionId);
      setApps((prev) => prev.filter((a) => a.pid !== pid));
    } finally {
      setKilling((prev) => {
        const next = new Set(prev);
        next.delete(pid);
        return next;
      });
    }
  };

  return (
    <Box>
      <Box
        onClick={() => setExpanded(!expanded)}
        sx={sidebarSectionHeaderWithDividerSx(expanded)}
      >
        <TerminalIcon sx={{ fontSize: 12, color: colors.accent.orange }} />
        <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", color: colors.text.dim, letterSpacing: '1px', flex: 1 }}>
          {expanded ? '▾' : '▸'} RUNNING APPS
        </Typography>
        <Chip size="small" label={String(apps.length)} sx={{ fontSize: '0.45rem', height: 15 }} />
      </Box>

      {expanded && (
        <Box sx={sidebarSectionContentSx}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {apps.map((a) => {
              const label = formatCommand(a.command);
              const stopping = a.status === 'stopping' || killing.has(a.pid);
              return (
                <Tooltip
                  key={a.pid}
                  title={a.command}
                  placement="left"
                  arrow
                  enterDelay={400}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      py: 0.35,
                      px: 0.5,
                      borderRadius: '4px',
                      opacity: stopping ? 0.5 : 1,
                      '&:hover': { bgcolor: alphaColor(colors.bg.primary, 0.5) },
                    }}
                  >
                    <Box
                      sx={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        bgcolor: stopping ? colors.accent.orange : colors.accent.green,
                        flexShrink: 0,
                      }}
                    />
                    <Typography
                      sx={{
                        fontSize: '0.55rem',
                        fontFamily: "'JetBrains Mono', monospace",
                        color: colors.text.secondary,
                        flex: 1,
                        minWidth: 0,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {label.slice(0, 28)}{label.length > 28 ? '…' : ''}
                    </Typography>
                    {a.port !== undefined && (
                      <Chip
                        size="small"
                        label={`:${a.port}`}
                        sx={{ fontSize: '0.4rem', height: 15, minWidth: 28, '& .MuiChip-label': { px: 0.6 } }}
                      />
                    )}
                    <Typography sx={{ fontSize: '0.45rem', color: colors.text.tertiary, fontFamily: "'JetBrains Mono', monospace" }}>
                      {formatDuration(a.startTime)}
                    </Typography>
                    <Tooltip title="Stop process" placement="left" arrow>
                      <IconButton
                        size="small"
                        disabled={stopping}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleKill(a.pid);
                        }}
                        sx={{ p: 0.2, color: colors.text.dim, '&:hover': { color: colors.accent.red } }}
                      >
                        <StopCircleIcon sx={{ fontSize: 13 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Tooltip>
              );
            })}
          </Box>
        </Box>
      )}
    </Box>
  );
});
