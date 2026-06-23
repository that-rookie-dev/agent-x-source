import Box from '@mui/material/Box';
import { colors } from '../theme';

// ─── Table ───

export function StyledTableWrapper({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={tableContainerSx}>
      <Box component="table" sx={tableInnerSx}>
        {children}
      </Box>
    </Box>
  );
}

// ─── Lists ───

export function StyledUl({ children }: { children: React.ReactNode }) {
  return (
    <Box component="ul" sx={ulSx}>
      {children}
    </Box>
  );
}

export function StyledOl({ children }: { children: React.ReactNode }) {
  return (
    <Box component="ol" sx={olSx}>
      {children}
    </Box>
  );
}

export function StyledLi({ children }: { children: React.ReactNode }) {
  return (
    <Box component="li" sx={liSx}>
      {children}
    </Box>
  );
}

// ─── Styles ───

const tableContainerSx = {
  overflowX: 'auto',
  my: 1.5,
  border: `1px solid ${colors.border.default}`,
  borderRadius: 1,
  bgcolor: colors.bg.elevated,
} as const;

const tableInnerSx = {
  width: '100%',
  borderCollapse: 'collapse',
  fontFamily: "'JetBrains Mono', monospace",
  '& th': {
    textAlign: 'left',
    px: 1.25,
    py: 0.75,
    bgcolor: colors.bg.secondary,
    borderBottom: `1px solid ${colors.border.default}`,
    fontWeight: 600,
    color: colors.text.primary,
    whiteSpace: 'nowrap',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '0.6rem',
    letterSpacing: '0.3px',
    textTransform: 'uppercase',
  },
  '& td': {
    px: 1.25,
    py: 0.55,
    borderBottom: `1px solid ${colors.border.subtle}`,
    color: colors.text.secondary,
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '0.6rem',
    lineHeight: 1.5,
  },
  '& tr:last-child td': {
    borderBottom: 'none',
  },
  '& tr:hover td': {
    bgcolor: `${colors.accent.blue}04`,
  },
  '& td:first-of-type': {
    fontWeight: 500,
    color: colors.text.primary,
  },
  '& th:not(:first-of-type), & td:not(:first-of-type)': {
    textAlign: 'right',
  },
} as const;

const listBaseSx = {
  m: 0,
  pl: 0,
  fontSize: '0.78rem',
  lineHeight: 1.65,
  color: colors.text.primary,
} as const;

/** Vertical center of the first text line (matches li line-height). */
const firstLineCenter = 'calc(0.78rem * 1.65 / 2)';

const liContentSx = {
  mb: 0.45,
  color: colors.text.secondary,
  fontSize: '0.78rem',
  lineHeight: 1.65,
  fontFamily: "'Inter', sans-serif",
  '& strong': { color: colors.text.primary, fontWeight: 600, lineHeight: 'inherit' },
  '& em': { lineHeight: 'inherit', fontStyle: 'italic' },
  // react-markdown wraps li text in <p> — keep inline so markers align to first line
  '& p': {
    m: 0,
    display: 'inline',
    lineHeight: 'inherit',
    fontSize: 'inherit',
    color: 'inherit',
  },
  '& p + p': {
    display: 'block',
    mt: 0.5,
  },
  '&:last-child': { mb: 0 },
} as const;

const ulSx = {
  ...listBaseSx,
  listStyle: 'none',
  '& > li': {
    position: 'relative',
    pl: 1.5,
    ...liContentSx,
    '&::before': {
      content: '""',
      position: 'absolute',
      left: 0,
      top: firstLineCenter,
      transform: 'translateY(-50%)',
      width: 5,
      height: 5,
      borderRadius: '50%',
      bgcolor: colors.accent.blue,
    },
  },
} as const;

const olSx = {
  ...listBaseSx,
  counterReset: 'agentx-ol',
  listStyle: 'none',
  '& > li': {
    position: 'relative',
    pl: 2.5,
    counterIncrement: 'agentx-ol',
    ...liContentSx,
    '&::before': {
      content: 'counter(agentx-ol)',
      position: 'absolute',
      left: 0,
      top: firstLineCenter,
      transform: 'translateY(-50%)',
      width: 14,
      height: 14,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '50%',
      bgcolor: `${colors.accent.blue}18`,
      color: colors.accent.blue,
      fontSize: '0.4375rem',
      fontWeight: 700,
      lineHeight: 1,
      fontFamily: "'JetBrains Mono', monospace",
    },
  },
} as const;

const liSx = {
  ...liContentSx,
} as const;
