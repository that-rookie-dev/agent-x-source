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
        mt: 1.25,
        border: `1px solid ${alphaColor(accent, '30')}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: '8px',
        bgcolor: colors.bg.secondary,
        px: 1.25,
        py: 1,
        cursor: 'pointer',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        '&:hover': {
          borderColor: alphaColor(accent, '65'),
          boxShadow: `0 4px 16px ${alphaColor(accent, '12')}`,
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <AccountTreeOutlinedIcon sx={{ fontSize: 15, color: accent, flexShrink: 0 }} />
        <Typography sx={{
          fontSize: '0.65rem',
          fontWeight: 600,
          color: colors.text.primary,
          flex: 1,
        }}>
          View workflow
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, color: colors.text.dim, flexShrink: 0 }}>
          <Typography sx={{ fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace" }}>
            {summary}
          </Typography>
          <ChevronRightIcon sx={{ fontSize: 14, opacity: 0.7 }} />
        </Box>
      </Box>
      <Typography sx={{ fontSize: '0.48rem', color: colors.text.dim, mt: 0.5, opacity: 0.8, pl: 2.75 }}>
        Tools, deep search, and reasoning for this turn
      </Typography>
    </Box>
  );
}
