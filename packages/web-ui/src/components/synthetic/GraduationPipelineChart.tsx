import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors, MONO, alphaColor } from '../../theme';
import { statusColor } from './status';

const NODES = [
  { id: 'observed', label: 'Observed' },
  { id: 'proposed', label: 'Proposed' },
  { id: 'sandbox-passed', label: 'Sandbox' },
  { id: 'in-trial', label: 'Trial' },
  { id: 'registered', label: 'Registered' },
] as const;

function PipelineCard({
  label,
  value,
  status,
  onClick,
}: {
  label: string;
  value: number;
  status: string;
  onClick?: () => void;
}) {
  const color = statusColor(status);
  return (
    <Box
      component="button"
      onClick={onClick}
      aria-label={`${label} ${value}`}
      sx={{
        position: 'relative',
        border: `1px solid ${color}`,
        borderRadius: 2,
        px: 1.5,
        py: 1,
        minWidth: 92,
        textAlign: 'left',
        cursor: 'pointer',
        overflow: 'hidden',
        bgcolor: alphaColor(color, '0a'),
        backgroundImage: `linear-gradient(145deg, ${alphaColor(color, '14')} 0%, transparent 60%)`,
        transition: 'all 0.18s ease',
        '&:hover': {
          transform: 'translateY(-2px)',
          bgcolor: alphaColor(color, '12'),
        },
      }}
    >
      <Typography
        sx={{
          fontSize: '1.35rem',
          fontFamily: MONO,
          fontWeight: 700,
          color: colors.text.primary,
          lineHeight: 1,
          position: 'relative',
          zIndex: 1,
        }}
      >
        {value}
      </Typography>
      <Typography
        sx={{
          fontSize: '0.6rem',
          fontFamily: MONO,
          letterSpacing: '0.06em',
          color,
          mt: 0.6,
          position: 'relative',
          zIndex: 1,
        }}
      >
        {label.toUpperCase()}
      </Typography>
    </Box>
  );
}

export function GraduationPipelineChart({
  byStatus,
  onSelect,
}: {
  byStatus: Record<string, number>;
  onSelect?: (status: string) => void;
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1,
        alignItems: 'stretch',
        flexWrap: 'wrap',
        mb: 2,
        p: 1.5,
        borderRadius: 2,
        border: `1px solid ${alphaColor(colors.accent.cyan, '10')}`,
        bgcolor: alphaColor(colors.accent.cyan, '04'),
        backgroundImage: `linear-gradient(160deg, ${alphaColor(colors.accent.blue, '06')}, transparent 50%)`,
      }}
      aria-label="Graduation pipeline"
    >
      {NODES.map((node, i) => (
        <Box key={node.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PipelineCard
            label={node.label}
            status={node.id}
            value={byStatus[node.id] ?? 0}
            onClick={() => onSelect?.(node.id)}
          />
          {i < NODES.length - 1 && (
            <Typography
              sx={{
                color: alphaColor(colors.text.dim, 0.7),
                fontFamily: MONO,
                fontSize: '0.85rem',
              }}
              aria-hidden
            >
              →
            </Typography>
          )}
        </Box>
      ))}
      {(byStatus['sandbox-failed'] ?? 0) > 0 && (
        <PipelineCard
          label="Failed"
          status="sandbox-failed"
          value={byStatus['sandbox-failed']}
        />
      )}
    </Box>
  );
}
