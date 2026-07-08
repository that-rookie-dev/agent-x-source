import Box from '@mui/material/Box';
import { colors, alphaColor } from '../theme';
import { openSearchResultUrl } from '../components/deep-search/card-utils';
import { chipLabelForSource } from './source-chip-utils';

export function CitationChip({ href, label }: { href: string; label: string }) {
  const display = chipLabelForSource(href, label);

  return (
    <Box
      component="a"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={href}
      onClick={(e: React.MouseEvent) => {
        e.preventDefault();
        openSearchResultUrl(href);
      }}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
        maxWidth: 156,
        px: 0.75,
        py: 0.22,
        ml: 0.5,
        borderRadius: '6px',
        fontSize: '0.58rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontWeight: 600,
        letterSpacing: '0.04em',
        lineHeight: 1.3,
        color: colors.accent.cyan,
        background: `linear-gradient(145deg, ${alphaColor(colors.accent.cyan, '16')} 0%, ${colors.bg.tertiary} 55%, ${alphaColor(colors.accent.blue, '0c')} 100%)`,
        border: `1px solid ${alphaColor(colors.accent.cyan, '35')}`,
        textDecoration: 'none',
        verticalAlign: 'middle',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        transition: 'color 0.14s ease, border-color 0.14s ease, background 0.14s ease, transform 0.14s ease, box-shadow 0.14s ease',
        boxShadow: `inset 0 1px 0 ${alphaColor(colors.accent.cyan, '18')}`,
        '&:hover': {
          color: colors.text.primary,
          borderColor: `${alphaColor(colors.accent.cyan, '65')}`,
          background: `linear-gradient(145deg, ${alphaColor(colors.accent.cyan, '28')} 0%, ${colors.bg.secondary} 50%, ${alphaColor(colors.accent.blue, '16')} 100%)`,
          transform: 'translateY(-1px)',
          boxShadow: `0 4px 14px ${alphaColor(colors.accent.cyan, '22')}, inset 0 1px 0 ${alphaColor(colors.accent.cyan, '28')}`,
        },
        '&:active': {
          transform: 'translateY(0)',
          boxShadow: `inset 0 1px 0 ${alphaColor(colors.accent.cyan, '18')}`,
        },
      }}
    >
      {display}
    </Box>
  );
}

export { shouldRenderAsSourceChip as isCitationStyleLink } from './source-chip-utils';