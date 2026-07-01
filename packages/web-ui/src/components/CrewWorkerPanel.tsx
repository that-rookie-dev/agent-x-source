import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import CloseIcon from '@mui/icons-material/Close';
import { crewTheme } from '../styles/crew-theme';

export interface CrewWorkerState {
  workerId: string;
  crewId: string;
  crewName: string;
  callsign: string;
  color?: string;
  status: 'running' | 'verifying' | 'retrying' | 'blocked' | 'done' | 'error';
  message?: string;
  elapsed?: number;
}

interface CrewWorkerPanelProps {
  workers: CrewWorkerState[];
  missionActive?: boolean;
  embedded?: boolean;
  onViewWorker?: (workerId: string, crewName: string) => void;
  onRemoveWorker?: (crewId: string, crewName: string) => void;
}

function statusColor(status: CrewWorkerState['status']): string {
  switch (status) {
    case 'done': return crewTheme.accent.signal;
    case 'error': return crewTheme.accent.alert;
    case 'blocked': return crewTheme.accent.amber;
    case 'retrying': return crewTheme.accent.purple;
    default: return crewTheme.accent.tactical;
  }
}

export function CrewWorkerPanel({ workers, missionActive, embedded, onViewWorker, onRemoveWorker }: CrewWorkerPanelProps) {
  if (workers.length === 0 && !missionActive) return null;

  return (
    <Box sx={{
      ...(embedded ? { py: 0.75, px: 1 } : {
        mx: 1.25, mb: 0.5, py: 0.75, px: 1,
        border: `1px solid ${crewTheme.border.default}`,
        borderRadius: '6px',
        bgcolor: crewTheme.bg.card,
      }),
    }}>
      {!embedded && (
        <Typography sx={{
          fontSize: '0.48rem', fontFamily: "'JetBrains Mono', monospace",
          color: crewTheme.text.dim, letterSpacing: '1.5px', mb: 0.5,
        }}>
          CREW WORKERS {missionActive ? '· LIVE' : ''}
        </Typography>
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
        {workers.map((w) => {
          const c = w.color || statusColor(w.status);
          const isRunning = w.status === 'running' || w.status === 'verifying' || w.status === 'retrying';
          return (
            <Box
              key={w.workerId}
              onClick={() => onViewWorker?.(w.workerId, w.crewName)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.75,
                cursor: onViewWorker ? 'pointer' : 'default',
                borderRadius: '4px',
                px: 0.25,
                '&:hover': onViewWorker ? { bgcolor: crewTheme.bg.panel } : undefined,
              }}
            >
              {isRunning ? (
                <CircularProgress size={10} sx={{ color: c }} />
              ) : w.status === 'done' ? (
                <CheckCircleIcon sx={{ fontSize: 12, color: c }} />
              ) : w.status === 'blocked' ? (
                <HelpOutlineIcon sx={{ fontSize: 12, color: c }} />
              ) : (
                <ErrorIcon sx={{ fontSize: 12, color: c }} />
              )}
              <Box sx={{
                width: 5, height: 5, borderRadius: '50%', bgcolor: c, flexShrink: 0,
                boxShadow: isRunning ? `0 0 6px ${c}80` : 'none',
              }} />
              <Typography sx={{
                fontSize: '0.58rem', fontFamily: "'JetBrains Mono', monospace",
                color: crewTheme.text.secondary, flex: 1,
              }}>
                @{w.callsign}
                <Box component="span" sx={{ color: crewTheme.text.dim, ml: 0.5 }}>
                  {w.message || w.status}
                </Box>
              </Typography>
              {w.elapsed != null && w.status === 'done' && (
                <Typography sx={{ fontSize: '0.48rem', color: crewTheme.text.dim }}>
                  {(w.elapsed / 1000).toFixed(1)}s
                </Typography>
              )}
              {onRemoveWorker && (
                <IconButton
                  size="small"
                  onClick={(e) => { e.stopPropagation(); onRemoveWorker(w.crewId, w.crewName); }}
                  sx={{ p: 0.15, color: crewTheme.text.dim, '&:hover': { color: crewTheme.accent.alert } }}
                  title={`Remove ${w.crewName} from session`}
                >
                  <CloseIcon sx={{ fontSize: 11 }} />
                </IconButton>
              )}
            </Box>
          );
        })}
        {missionActive && workers.length === 0 && (
          <Typography sx={{ fontSize: '0.52rem', color: crewTheme.text.dim, fontStyle: 'italic', fontFamily: "'JetBrains Mono', monospace" }}>
            Deploying operatives…
          </Typography>
        )}
      </Box>
    </Box>
  );
}
