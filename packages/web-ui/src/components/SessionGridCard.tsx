import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import DeleteIcon from '@mui/icons-material/Delete';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import GroupsIcon from '@mui/icons-material/Groups';
import type { SessionInfo } from '../api';
import { colors } from '../theme';

interface SessionGridCardProps {
  session: SessionInfo;
  onOpen: (session: SessionInfo) => void;
  onDelete: (id: string) => void;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function KpiCell({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{
        fontSize: '0.45rem',
        fontFamily: "'JetBrains Mono', monospace",
        color: colors.text.dim,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        mb: 0.2,
      }}>
        {label}
      </Typography>
      <Typography sx={{
        fontSize: '0.62rem',
        fontFamily: "'JetBrains Mono', monospace",
        color: accent ?? colors.text.secondary,
        fontWeight: 600,
        lineHeight: 1.2,
      }}>
        {value}
      </Typography>
    </Box>
  );
}

export function SessionGridCard({ session, onOpen, onDelete }: SessionGridCardProps) {
  const isActive = session.status === 'active';
  const mode = session.mode ?? 'plan';
  const tokenPct = session.tokenUsagePct ?? 0;
  const crewCount = session.crewCount ?? session.crewCallsigns?.length ?? 0;

  return (
    <Box
      onClick={() => onOpen(session)}
      sx={{
        borderRadius: '10px',
        border: `1px solid ${isActive ? colors.accent.green + '35' : colors.border.subtle}`,
        bgcolor: colors.bg.secondary,
        p: 1.25,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.85,
        minHeight: 148,
        transition: 'border-color 0.15s, transform 0.15s, box-shadow 0.15s',
        '&:hover': {
          borderColor: colors.accent.blue + '50',
          transform: 'translateY(-1px)',
          boxShadow: `0 6px 20px ${colors.accent.blue}12`,
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
        <Box sx={{
          width: 28,
          height: 28,
          borderRadius: '6px',
          flexShrink: 0,
          bgcolor: colors.bg.tertiary,
          border: `1px solid ${colors.border.default}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <SmartToyIcon sx={{ fontSize: 14, color: isActive ? colors.accent.green : colors.text.dim }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{
            fontSize: '0.72rem',
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 600,
            color: colors.text.primary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {session.title || `Session ${session.id.slice(0, 8)}`}
          </Typography>
          <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", mt: 0.2 }}>
            {formatDate(session.createdAt)} · {formatTime(session.createdAt)}
          </Typography>
        </Box>
        <IconButton
          size="small"
          onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}
          sx={{ p: 0.25, color: colors.text.dim, '&:hover': { color: colors.accent.red } }}
        >
          <DeleteIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Box>

      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        {isActive && (
          <Box sx={{
            px: 0.5, py: 0.1, borderRadius: '4px', fontSize: '0.45rem',
            fontFamily: "'JetBrains Mono', monospace", fontWeight: 700,
            bgcolor: colors.accent.green + '15', color: colors.accent.green,
            border: `1px solid ${colors.accent.green}30`,
          }}>
            LIVE
          </Box>
        )}
        <Box sx={{
          px: 0.5, py: 0.1, borderRadius: '4px', fontSize: '0.45rem',
          fontFamily: "'JetBrains Mono', monospace",
          bgcolor: mode === 'agent' ? colors.accent.orange + '12' : colors.accent.blue + '10',
          color: mode === 'agent' ? colors.accent.orange : colors.accent.blue,
          border: `1px solid ${mode === 'agent' ? colors.accent.orange + '25' : colors.accent.blue + '25'}`,
        }}>
          {mode.toUpperCase()}
        </Box>
        {session.hyperdrive && (
          <Box sx={{
            px: 0.5, py: 0.1, borderRadius: '4px', fontSize: '0.45rem',
            fontFamily: "'JetBrains Mono', monospace",
            bgcolor: '#ff00ff12', color: '#ff00ff',
          }}>
            HYPER
          </Box>
        )}
      </Box>

      <Box sx={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: 0.75,
      }}>
        <KpiCell label="Msgs" value={session.messageCount ?? 0} />
        <KpiCell label="Compact" value={session.compactionCount ?? 0} accent={session.compactionCount ? colors.accent.orange : undefined} />
        <KpiCell label="Workers" value={session.childSessionCount ?? 0} />
      </Box>

      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.35 }}>
          <Typography sx={{ fontSize: '0.45rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
            TOKENS
          </Typography>
          <Typography sx={{ fontSize: '0.45rem', color: colors.text.secondary, fontFamily: "'JetBrains Mono', monospace" }}>
            {formatTokens(session.tokensUsed ?? 0)}
            {session.tokenAvailable ? ` / ${formatTokens(session.tokenAvailable)}` : ''}
            {tokenPct > 0 ? ` · ${tokenPct}%` : ''}
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={Math.min(100, tokenPct)}
          sx={{
            height: 4,
            borderRadius: 2,
            bgcolor: colors.bg.tertiary,
            '& .MuiLinearProgress-bar': {
              bgcolor: tokenPct > 85 ? colors.accent.red : tokenPct > 65 ? colors.accent.orange : colors.accent.blue,
              borderRadius: 2,
            },
          }}
        />
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5, mt: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, minWidth: 0, flex: 1 }}>
          <GroupsIcon sx={{ fontSize: 11, color: colors.text.dim, flexShrink: 0 }} />
          <Typography sx={{
            fontSize: '0.5rem',
            color: crewCount ? colors.text.secondary : colors.text.dim,
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {crewCount ? `${crewCount} crew${crewCount === 1 ? '' : 's'}` : 'No crews'}
          </Typography>
        </Box>
        {(session.totalCostUsd ?? 0) > 0 && (
          <Typography sx={{
            fontSize: '0.48rem',
            color: colors.accent.green,
            fontFamily: "'JetBrains Mono', monospace",
            flexShrink: 0,
          }}>
            ${session.totalCostUsd!.toFixed(3)}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
