import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import { crewTheme } from '../../styles/crew-theme';

interface SkillChipsProps {
  items: string[];
  maxVisible?: number;
  variant?: 'grid' | 'hub';
}

export function SkillChips({ items, maxVisible = 2, variant = 'grid' }: SkillChipsProps) {
  if (items.length === 0) {
    return <Box sx={{ height: variant === 'hub' ? 24 : 22, minHeight: variant === 'hub' ? 24 : 22 }} />;
  }

  const limit = variant === 'hub' ? Math.min(maxVisible, 1) : maxVisible;
  const visible = items.slice(0, limit);
  const extra = items.length - limit;
  const fontSize = variant === 'hub' ? '0.58rem' : '0.55rem';

  return (
    <Box sx={{
      display: 'flex',
      gap: 0.5,
      alignItems: 'center',
      flexWrap: 'nowrap',
      overflow: 'hidden',
      width: '100%',
      height: variant === 'hub' ? 24 : 22,
      minHeight: variant === 'hub' ? 24 : 22,
    }}>
      {visible.map((label) => (
        <Chip
          key={label}
          size="small"
          label={label}
          title={label}
          sx={{
            height: 20,
            flexShrink: 1,
            minWidth: 0,
            maxWidth: variant === 'hub' ? '100%' : undefined,
            borderRadius: '999px',
            fontSize,
            fontFamily: "'JetBrains Mono', monospace",
            bgcolor: crewTheme.bg.inset,
            color: crewTheme.text.secondary,
            border: `1px solid ${crewTheme.border.default}`,
            '& .MuiChip-label': {
              px: 1,
              py: 0,
              lineHeight: 1.2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'block',
            },
          }}
        />
      ))}
      {extra > 0 && (
        <Chip
          size="small"
          label={`+${extra}`}
          title={items.slice(limit).join(', ')}
          sx={{
            height: 20,
            flexShrink: 0,
            borderRadius: '999px',
            fontSize,
            fontFamily: "'JetBrains Mono', monospace",
            bgcolor: crewTheme.bg.inset,
            color: crewTheme.text.dim,
            border: `1px solid ${crewTheme.border.default}`,
            '& .MuiChip-label': { px: 0.75, py: 0, lineHeight: 1.2 },
          }}
        />
      )}
    </Box>
  );
}
