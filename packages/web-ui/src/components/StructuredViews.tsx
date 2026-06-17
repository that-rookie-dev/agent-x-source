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
  pl: 2,
  fontSize: '0.7rem',
  lineHeight: 1.7,
  color: colors.text.primary,
} as const;

const ulSx = {
  ...listBaseSx,
  '& li::marker': {
    color: colors.accent.blue,
    content: '"▸ "' as any,
  },
} as const;

const olSx = {
  ...listBaseSx,
  '& li::marker': {
    color: colors.text.dim,
    fontWeight: 600,
  },
} as const;

const liSx = {
  mb: 0.3,
  color: colors.text.primary,
  fontSize: '0.7rem',
  lineHeight: 1.6,
  '&:last-child': { mb: 0 },
} as const;
