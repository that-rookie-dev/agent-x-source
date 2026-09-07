import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors, MONO } from '../../theme';

export function SidebarSummaryWidget({
  observed,
  proposed,
  trial,
  registered,
}: {
  observed: number;
  proposed: number;
  trial: number;
  registered: number;
}) {
  return (
    <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }} aria-label="Capability pipeline summary">
      <Dot color={colors.text.dim} label={`${observed} observed`} />
      <Dot color={colors.accent.orange} label={`${proposed} proposed`} />
      <Dot color={colors.accent.purple} label={`${trial} trial`} />
      <Dot color={colors.accent.green} label={`${registered} registered`} />
    </Box>
  );
}

function Dot({ color, label }: { color: string; label: string }) {
  return (
    <Typography
      sx={{
        fontSize: '0.62rem',
        fontFamily: MONO,
        color: colors.text.secondary,
        display: 'flex',
        alignItems: 'center',
        gap: 0.6,
        '&:hover': { color: colors.text.primary },
      }}
    >
      <Box
        component="span"
        sx={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          bgcolor: color,
          display: 'inline-block',
        }}
      />
      {label}
    </Typography>
  );
}
