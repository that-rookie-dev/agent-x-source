import { memo, type MouseEvent } from 'react';
import Box from '@mui/material/Box';
import { CrewAwareMarkdown } from '../chat/ChatMarkdown';
import { colors, alphaColor } from '../theme';

function openMarkdownHref(href: string): void {
  try {
    const url = new URL(href, window.location.href);
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) return;
    if (window.agentx?.openExternal) {
      void window.agentx.openExternal(url.href);
    } else {
      window.open(url.href, '_blank', 'noopener,noreferrer');
    }
  } catch { /* ignore malformed links */ }
}

export const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(target instanceof HTMLAnchorElement)) return;
    event.preventDefault();
    event.stopPropagation();
    openMarkdownHref(target.href);
  };

  return (
    <Box
      onClickCapture={handleClick}
      sx={{
        fontSize: '0.78rem',
        lineHeight: 1.55,
        color: colors.text.secondary,
        '& h1': {
          fontSize: '1.05rem',
          fontWeight: 700,
          color: colors.text.primary,
          letterSpacing: '-0.02em',
          mb: 1,
          mt: 0,
        },
        '& h2': {
          fontSize: '0.82rem',
          fontWeight: 700,
          color: colors.text.primary,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          mt: 1.5,
          mb: 0.75,
          pb: 0.5,
          borderBottom: `1px solid ${colors.border.subtle}`,
        },
        '& h3, & h4': {
          fontSize: '0.76rem',
          fontWeight: 600,
          color: colors.text.primary,
          mt: 1.25,
          mb: 0.5,
        },
        '& p': {
          mb: 0.65,
          fontSize: '0.78rem',
          lineHeight: 1.6,
        },
        '& ul, & ol': {
          pl: 2,
          my: 0.5,
          '& li': {
            mb: 0.35,
            fontSize: '0.76rem',
            lineHeight: 1.5,
          },
          '& li::marker': {
            color: colors.accent.cyan,
          },
        },
        '& blockquote': {
          my: 0.85,
          mx: 0,
          pl: 1.25,
          py: 0.65,
          borderLeft: `3px solid ${colors.accent.blue}`,
          bgcolor: alphaColor(colors.accent.blue, '0a'),
          borderRadius: '0 6px 6px 0',
        },
        '& a': {
          color: colors.accent.cyan,
          textDecoration: 'underline',
          textDecorationColor: alphaColor(colors.accent.cyan, '40'),
          textUnderlineOffset: '2px',
          '&:hover': { color: colors.accent.blue },
        },
        '& table': {
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '0.7rem',
          my: 1,
        },
        '& th': {
          textAlign: 'left',
          fontWeight: 600,
          color: colors.text.primary,
          bgcolor: colors.bg.tertiary,
          borderBottom: `1px solid ${colors.border.default}`,
          px: 0.75,
          py: 0.5,
        },
        '& td': {
          borderBottom: `1px solid ${colors.border.subtle}`,
          px: 0.75,
          py: 0.45,
          color: colors.text.secondary,
          verticalAlign: 'top',
        },
        '& tr:hover td': {
          bgcolor: alphaColor(colors.bg.hover, '80'),
        },
        '& code': {
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.68rem',
        },
        '& hr': {
          border: 'none',
          borderTop: `1px solid ${colors.border.subtle}`,
          my: 1.25,
        },
        '& > *:first-of-type': { mt: 0 },
        '& > *:last-child': { mb: 0 },
      }}
    >
      <CrewAwareMarkdown content={content} />
    </Box>
  );
});
