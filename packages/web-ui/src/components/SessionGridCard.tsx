import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import DeleteIcon from '@mui/icons-material/Delete';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import GroupsIcon from '@mui/icons-material/Groups';
import ForumIcon from '@mui/icons-material/Forum';
import type { SessionInfo } from '../api';
import { colors } from '../theme';
import { getCrewAccent } from '../styles/crew-theme';
import { MedicalCrewCardStripe, isMedicalCrewDisplay } from './crew/MedicalDisclaimerBanner';
import { sessionHostCrewDisplay } from '../utils/crew-display';

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
  const isCrewPrivate = (session.contextKind ?? 'agent_x') === 'crew_private';
  const isActive = session.status === 'active';
  const mode = session.mode ?? 'plan';
  const tokenPct = session.tokenUsagePct ?? 0;
  const crewCount = session.crewCount ?? session.crewCallsigns?.length ?? 0;
  const hostCallsignRaw = session.hostCrewCallsign ?? '';
  const hostTitle = session.hostCrewTitle ?? '';
  const { displayName: hostName, displayCallsign: hostCallsign } = sessionHostCrewDisplay(session);
  const crewAccent = getCrewAccent(session.hostCrewColor, hostCallsign || hostName);
  const isMedical = isCrewPrivate && isMedicalCrewDisplay({
    categoryId: session.hostCrewCategoryId,
    catalogId: session.hostCrewCatalogId,
    callsign: hostCallsignRaw,
    crewId: session.hostCrewId,
  });
  const displayTitle = isCrewPrivate ? hostName : (session.title || `Session ${session.id.slice(0, 8)}`);

  return (
    <Box
      onClick={() => onOpen(session)}
      sx={{
        position: 'relative',
        borderRadius: '10px',
        border: `1px solid ${isCrewPrivate ? crewAccent + '35' : isActive ? colors.accent.green + '35' : colors.border.subtle}`,
        bgcolor: colors.bg.secondary,
        overflow: 'hidden',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 148,
        transition: 'border-color 0.15s, transform 0.15s, box-shadow 0.15s',
        '&:hover': {
          borderColor: (isCrewPrivate ? crewAccent : colors.accent.blue) + '50',
          transform: 'translateY(-1px)',
          boxShadow: `0 6px 20px ${(isCrewPrivate ? crewAccent : colors.accent.blue)}12`,
        },
      }}
    >
      {isMedical && (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1,
            pointerEvents: 'none',
          }}
        >
          <MedicalCrewCardStripe />
        </Box>
      )}
      <Box sx={{ p: 1.25, flex: 1, display: 'flex', flexDirection: 'column', gap: 0.85 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
        <Box sx={{
          width: 28,
          height: 28,
          borderRadius: '6px',
          flexShrink: 0,
          bgcolor: isCrewPrivate ? crewAccent + '12' : colors.bg.tertiary,
          border: `1px solid ${isCrewPrivate ? crewAccent + '30' : colors.border.default}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {isCrewPrivate ? (
            <ForumIcon sx={{ fontSize: 14, color: crewAccent }} />
          ) : (
            <SmartToyIcon sx={{ fontSize: 14, color: isActive ? colors.accent.green : colors.text.dim }} />
          )}
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
            {displayTitle}
          </Typography>
          <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", mt: 0.2 }}>
            {isCrewPrivate ? (
              hostTitle || 'Crew specialist'
            ) : (
              <>{formatDate(session.createdAt)} · {formatTime(session.createdAt)}</>
            )}
          </Typography>
          {isCrewPrivate && hostCallsign && (
            <Typography sx={{
              fontSize: '0.48rem',
              color: crewAccent,
              fontFamily: "'JetBrains Mono', monospace",
              mt: 0.15,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              @{hostCallsign}
            </Typography>
          )}
        </Box>
        <IconButton
          size="small"
          onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}
          sx={{ p: 0.25, color: colors.text.dim, '&:hover': { color: colors.accent.red } }}
        >
          <DeleteIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Box>

      {!isCrewPrivate && (
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
      )}

      <Box sx={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: 0.75,
      }}>
        <KpiCell label="Msgs" value={session.messageCount ?? 0} />
        {isCrewPrivate ? (
          <>
            <KpiCell label="Current Mode" value={(session.mode ?? 'agent').toUpperCase()} accent={crewAccent} />
            <KpiCell label="Type" value="1:1" />
          </>
        ) : (
          <>
            <KpiCell label="Compact" value={session.compactionCount ?? 0} accent={session.compactionCount ? colors.accent.orange : undefined} />
            <KpiCell label="Workers" value={session.childSessionCount ?? 0} />
          </>
        )}
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
              bgcolor: tokenPct > 85 ? colors.accent.red : tokenPct > 65 ? colors.accent.orange : (isCrewPrivate ? crewAccent : colors.accent.blue),
              borderRadius: 2,
            },
          }}
        />
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5, mt: 'auto' }}>
        {isCrewPrivate ? (
          <Typography sx={{
            fontSize: '0.5rem',
            color: colors.text.dim,
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {formatDate(session.updatedAt ?? session.createdAt)} · {formatTime(session.updatedAt ?? session.createdAt)}
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, minWidth: 0, flex: 1 }}>
            <GroupsIcon sx={{ fontSize: 11, color: colors.text.dim, flexShrink: 0 }} />
            <Typography sx={{
              fontSize: '0.5rem',
              color: crewCount ? colors.text.secondary : colors.text.dim,
              fontFamily: "'JetBrains Mono', monospace",
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {crewCount ? `${crewCount} crew${crewCount === 1 ? '' : 's'}` : 'No crews'}
            </Typography>
          </Box>
        )}
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
    </Box>
  );
}
