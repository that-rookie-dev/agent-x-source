import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { colors, alphaColor } from '../../theme';

export function openSearchResultUrl(url: string) {
  if (!url) return;
  const bridge = typeof window !== 'undefined' ? window.agentx : undefined;
  if (bridge?.openExternal) {
    void bridge.openExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function HasImageChip() {
  return (
    <Box sx={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 0.25,
      px: 0.45,
      py: 0.1,
      borderRadius: '4px',
      bgcolor: `${alphaColor(colors.accent.purple, '14')}`,
      border: `1px solid ${alphaColor(colors.accent.purple, '30')}`,
    }}>
      <ImageOutlinedIcon sx={{ fontSize: 10, color: colors.accent.purple }} />
      <Typography sx={{
        fontSize: '0.45rem',
        fontFamily: "'JetBrains Mono', monospace",
        color: colors.accent.purple,
        letterSpacing: '0.3px',
        lineHeight: 1.2,
      }}>
        IMG
      </Typography>
    </Box>
  );
}

export const deepSearchCardRadius = 1;

export const deepSearchShellSx = {
  borderRadius: deepSearchCardRadius,
  overflow: 'hidden',
  border: `1px solid ${colors.border.default}`,
  bgcolor: colors.bg.tertiary,
  boxShadow: 'none',
} as const;

export const searchCardSx = {
  borderRadius: deepSearchCardRadius,
  bgcolor: `${alphaColor(colors.accent.cyan, '06')}`,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  cursor: 'pointer',
  border: `1px solid ${colors.border.subtle}`,
  transition: 'border-color 0.15s, background-color 0.15s',
  boxShadow: 'none',
  '&:hover': {
    bgcolor: `${alphaColor(colors.accent.cyan, '08')}`,
    borderColor: `${alphaColor(colors.accent.cyan, '30')}`,
  },
} as const;

export const searchCardItemSx = {
  flex: '0 0 220px',
  width: 220,
  minWidth: 220,
  maxWidth: 220,
} as const;

export const searchResultsRowSx = {
  display: 'flex',
  flexWrap: 'nowrap',
  gap: 0.65,
  overflowX: 'auto',
  overflowY: 'hidden',
  WebkitOverflowScrolling: 'touch',
  p: 0.75,
  scrollbarWidth: 'thin',
  '&::-webkit-scrollbar': { height: 6 },
  '&::-webkit-scrollbar-thumb': {
    bgcolor: colors.border.default,
    borderRadius: 3,
  },
} as const;

export function OpenLinkHint() {
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
      <OpenInNewIcon sx={{ fontSize: 11, color: colors.text.dim }} />
      <Typography sx={{
        fontSize: '0.5rem',
        fontFamily: "'JetBrains Mono', monospace",
        color: colors.text.dim,
      }}>
        Open
      </Typography>
    </Box>
  );
}
