import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import { colors } from '../theme';

export interface ChildSessionCardProps {
  childSessionId: string;
  label: string;
  kind: 'sub_agent' | 'crew_worker';
  status: 'running' | 'done' | 'error';
  task?: string;
  onExpand: () => void;
}

const KIND_LABEL = {
  sub_agent: 'Sub-agent',
  crew_worker: 'Crew worker',
} as const;

export function ChildSessionInlineCard({
  label,
  kind,
  status,
  task,
  onExpand,
}: ChildSessionCardProps) {
  const accent = kind === 'crew_worker' ? colors.accent.purple : colors.accent.cyan;
  const statusColor = status === 'done' ? colors.accent.green : status === 'error' ? colors.accent.red : accent;

  return (
    <Box
      onClick={onExpand}
      sx={{
        border: `1px solid ${accent}35`,
        borderLeft: `3px solid ${statusColor}`,
        borderRadius: '8px',
        bgcolor: colors.bg.secondary,
        px: 1.25,
        py: 1,
        cursor: 'pointer',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        '&:hover': {
          borderColor: `${accent}70`,
          boxShadow: `0 4px 16px ${accent}15`,
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: task ? 0.5 : 0 }}>
        <Typography sx={{ fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace", color: accent, letterSpacing: '1px', fontWeight: 700 }}>
          {KIND_LABEL[kind].toUpperCase()}
        </Typography>
        <Typography sx={{ fontSize: '0.65rem', fontWeight: 600, color: colors.text.primary, flex: 1 }}>
          {label}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.35, color: colors.text.dim }}>
          <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace", textTransform: 'uppercase' }}>
            {status}
          </Typography>
          <OpenInFullIcon sx={{ fontSize: 12, opacity: 0.7 }} />
        </Box>
      </Box>
      {task && (
        <Typography sx={{ fontSize: '0.58rem', color: colors.text.dim, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {task}
        </Typography>
      )}
      <Typography sx={{ fontSize: '0.48rem', color: colors.text.dim, mt: 0.5, opacity: 0.75 }}>
        Tap to view background session transcript
      </Typography>
    </Box>
  );
}
