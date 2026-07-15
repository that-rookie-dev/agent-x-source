import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { colors, alphaColor } from '../theme';

interface Props {
  stepCount: number;
  hasReasoning: boolean;
  onOpen: () => void;
}

export function WorkflowEntryCard({ stepCount, hasReasoning, onOpen }: Props) {
  const accent = colors.accent.blue;
  const parts: string[] = [];
  if (stepCount > 0) parts.push(`${stepCount} step${stepCount === 1 ? '' : 's'}`);
  if (hasReasoning) parts.push('reasoning');
  const summary = parts.length > 0 ? parts.join(' · ') : 'tools & searches';

  return (
    <Box
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        mt: 0.75,
        px: 0.75,
        py: 0.25,
        border: `1px solid ${alphaColor(accent, '30')}`,
        borderRadius: '6px',
        bgcolor: colors.bg.secondary,
        cursor: 'pointer',
        transition: 'border-color 0.2s, background 0.2s',
        '&:hover': {
          borderColor: alphaColor(accent, '65'),
          bgcolor: alphaColor(accent, '8'),
        },
      }}
    >
      <AccountTreeOutlinedIcon sx={{ fontSize: 13, color: accent, flexShrink: 0 }} />
      <Typography sx={{
        fontSize: '0.6rem',
        fontWeight: 600,
        color: colors.text.primary,
        whiteSpace: 'nowrap',
      }}>
        Workflow
      </Typography>
      <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'nowrap' }}>
        {summary}
      </Typography>
      <ChevronRightIcon sx={{ fontSize: 12, opacity: 0.6, color: colors.text.dim }} />
    </Box>
  );
}
