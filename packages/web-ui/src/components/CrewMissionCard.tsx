import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useState } from 'react';
import { crewTheme } from '../styles/crew-theme';
import { CrewWorkerPanel, type CrewWorkerState } from './CrewWorkerPanel';

export interface CrewInterMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: string;
}

interface CrewMissionCardProps {
  workers: CrewWorkerState[];
  missionActive?: boolean;
  missionId?: string | null;
  interMessages?: CrewInterMessage[];
  /** Standalone = above chat input; embedded = inside another panel */
  placement?: 'standalone' | 'embedded';
  /** When true, hide the outer header + collapse wrapper (parent controls visibility). */
  showHeader?: boolean;
  /** Per-worker remove callback (renders a × button on each worker row). */
  onRemoveWorker?: (crewId: string, crewName: string) => void;
  onViewWorker?: (workerId: string, crewName: string) => void;
}

export function CrewMissionCard({
  workers,
  missionActive,
  missionId,
  interMessages = [],
  placement = 'standalone',
  showHeader = true,
  onRemoveWorker,
  onViewWorker,
}: CrewMissionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [threadOpen, setThreadOpen] = useState(false);

  if (workers.length === 0 && !missionActive && interMessages.length === 0 && showHeader) return null;

  const standalone = placement === 'standalone';

  const content = (
    <>
      <CrewWorkerPanel workers={workers} missionActive={missionActive} embedded onViewWorker={onViewWorker} onRemoveWorker={onRemoveWorker} />

      {interMessages.length > 0 && (
        <Box sx={{ px: 1, pb: 0.75, borderTop: `1px solid ${crewTheme.border.subtle}` }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.4 }}>
            <Typography sx={{ fontSize: '0.48rem', color: crewTheme.text.dim, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '1px' }}>
              COMMS ({interMessages.length})
            </Typography>
            <IconButton size="small" onClick={() => setThreadOpen((v) => !v)} sx={{ p: 0.25 }}>
              {threadOpen ? <ExpandLessIcon sx={{ fontSize: 12, color: crewTheme.text.dim }} /> : <ExpandMoreIcon sx={{ fontSize: 12, color: crewTheme.text.dim }} />}
            </IconButton>
          </Box>
          <Collapse in={threadOpen}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.35, maxHeight: 120, overflowY: 'auto' }}>
              {interMessages.slice(-12).map((m) => (
                <Typography key={m.id} sx={{
                  fontSize: '0.52rem', fontFamily: "'JetBrains Mono', monospace",
                  color: crewTheme.text.secondary, lineHeight: 1.4,
                }}>
                  <Box component="span" sx={{ color: crewTheme.accent.tactical }}>{m.from}</Box>
                  {' → '}
                  <Box component="span" sx={{ color: crewTheme.accent.hud }}>{m.to}</Box>
                  {': '}
                  {m.content}
                </Typography>
              ))}
            </Box>
          </Collapse>
        </Box>
      )}
    </>
  );

  if (!showHeader) {
    return <Box sx={{ mx: 0.5, mb: 0.5 }}>{content}</Box>;
  }

  return (
    <Box sx={{
      mx: standalone ? 0 : 1.25,
      mb: standalone ? 0.75 : 0.5,
      border: `1px solid ${crewTheme.border.default}`,
      borderRadius: standalone ? '14px' : '6px',
      bgcolor: crewTheme.bg.card,
      overflow: 'hidden',
      boxShadow: missionActive ? `0 0 20px ${crewTheme.accent.tactical}10` : 'none',
    }}>
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 0.5,
        px: 1, py: 0.5,
        borderBottom: expanded ? `1px solid ${crewTheme.border.subtle}` : 'none',
        bgcolor: crewTheme.bg.panel,
      }}>
        <Box sx={{
          width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
          bgcolor: missionActive ? crewTheme.accent.signal : crewTheme.text.dim,
          boxShadow: missionActive ? `0 0 6px ${crewTheme.accent.signal}` : 'none',
        }} />
        <Typography sx={{
          fontSize: '0.48rem', fontFamily: "'JetBrains Mono', monospace",
          color: crewTheme.text.dim, letterSpacing: '1.5px', flex: 1,
        }}>
          CREW MISSION {missionActive ? '· LIVE' : ''}
          {missionId ? ` · ${missionId.slice(0, 8).toUpperCase()}` : ''}
        </Typography>
        <IconButton size="small" onClick={() => setExpanded((v) => !v)} sx={{ p: 0.25 }}>
          {expanded ? <ExpandLessIcon sx={{ fontSize: 14, color: crewTheme.text.dim }} /> : <ExpandMoreIcon sx={{ fontSize: 14, color: crewTheme.text.dim }} />}
        </IconButton>
      </Box>

      <Collapse in={expanded}>
        {content}
      </Collapse>
    </Box>
  );
}
