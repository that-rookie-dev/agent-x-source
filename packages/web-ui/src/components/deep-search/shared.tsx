import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { colors } from '../../theme';

export function SourceLink({ url, label, onOpen }: { url: string; label?: string; onOpen?: (url: string) => void }) {
  if (onOpen) {
    return (
      <Box
        component="span"
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          onOpen(url);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onOpen(url);
          }
        }}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.35,
          color: colors.accent.blue,
          fontSize: '0.54rem',
          fontFamily: "'JetBrains Mono', monospace",
          cursor: 'pointer',
          '&:hover': { textDecoration: 'underline' },
        }}
      >
        <OpenInNewIcon sx={{ fontSize: 11 }} />
        {label ?? 'Open source'}
      </Box>
    );
  }

  return (
    <Box
      component="a"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.35,
        color: colors.accent.blue,
        textDecoration: 'none',
        fontSize: '0.54rem',
        fontFamily: "'JetBrains Mono', monospace",
        '&:hover': { textDecoration: 'underline' },
      }}
    >
      <OpenInNewIcon sx={{ fontSize: 11 }} />
      {label ?? 'Open source'}
    </Box>
  );
}

export function TypeBadge({ type }: { type: string }) {
  return (
    <Typography sx={{
      fontSize: '0.48rem',
      fontFamily: "'JetBrains Mono', monospace",
      letterSpacing: '0.4px',
      textTransform: 'uppercase',
      color: colors.text.dim,
      bgcolor: colors.bg.tertiary,
      border: `1px solid ${colors.border.subtle}`,
      borderRadius: '4px',
      px: 0.45,
      py: 0.1,
      lineHeight: 1.35,
    }}>
      {type.replace(/_/g, ' ')}
    </Typography>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  return (
    <Typography sx={{
      fontSize: '0.48rem',
      fontFamily: "'JetBrains Mono', monospace",
      color: colors.accent.cyan,
    }}>
      {pct}% match
    </Typography>
  );
}
