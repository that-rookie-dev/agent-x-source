import Box from '@mui/material/Box';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { colors } from '../theme';

function domainFromUrl(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return href.slice(0, 24);
  }
}

export function CitationChip({ href, label }: { href: string; label: string }) {
  const domain = domainFromUrl(href);
  const display = label.trim() || domain;

  return (
    <Box
      component="a"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.35,
        mx: 0.25,
        px: 0.65,
        py: 0.1,
        borderRadius: '999px',
        fontSize: '0.62rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontWeight: 600,
        color: colors.accent.cyan,
        bgcolor: `${colors.accent.cyan}12`,
        border: `1px solid ${colors.accent.cyan}33`,
        textDecoration: 'none',
        verticalAlign: 'middle',
        lineHeight: 1.6,
        '&:hover': {
          bgcolor: `${colors.accent.cyan}22`,
          borderColor: `${colors.accent.cyan}55`,
        },
      }}
    >
      <OpenInNewIcon sx={{ fontSize: 10 }} />
      {display.length > 36 ? `${display.slice(0, 34)}…` : display}
    </Box>
  );
}

export function isCitationStyleLink(href: string | undefined, children: React.ReactNode): boolean {
  if (!href?.startsWith('http')) return false;
  const text = String(children ?? '').trim();
  if (!text) return true;
  if (/^\[?\d+\]?$/.test(text)) return true;
  if (/^source\s*\d+$/i.test(text)) return true;
  if (text === href) return true;
  try {
    const host = new URL(href).hostname.replace(/^www\./, '');
    if (text === host || text.startsWith(host)) return true;
  } catch { /* ignore */ }
  return text.length <= 40;
}
