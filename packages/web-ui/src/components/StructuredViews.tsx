import { useRef, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import { chartSpecFromTable } from '@agentx/shared/browser';
import { colors, alphaColor } from '../theme';
import { ChartBlock } from '../chat/ChartBlock';

// ─── Table ───

export function StyledTableWrapper({ children, sx }: { children: React.ReactNode; sx?: object }) {
  return (
    <Box sx={{ ...tableContainerSx, ...sx }}>
      <Box component="table" sx={tableInnerSx}>
        {children}
      </Box>
    </Box>
  );
}

function readTableMatrix(table: HTMLTableElement): { headers: string[]; rows: string[][] } {
  const headerCells = table.querySelectorAll('thead th');
  let headers: string[];
  let bodyRows: Element[];
  if (headerCells.length > 0) {
    headers = [...headerCells].map((el) => el.textContent?.trim() ?? '');
    bodyRows = [...table.querySelectorAll('tbody tr')];
  } else {
    const allRows = [...table.querySelectorAll('tr')];
    if (allRows.length < 2) return { headers: [], rows: [] };
    headers = [...(allRows[0]?.querySelectorAll('th,td') ?? [])].map((el) => el.textContent?.trim() ?? '');
    bodyRows = allRows.slice(1);
  }
  const rows = bodyRows.map((tr) =>
    [...tr.querySelectorAll('td,th')].map((td) => td.textContent?.trim() ?? ''),
  );
  return { headers, rows };
}

/** GFM table with optional “View as chart” when numeric columns are present. */
export function ChartableTableWrapper({ children }: { children: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [chartJson, setChartJson] = useState<string | null>(null);

  const tryChart = () => {
    const table = wrapRef.current?.querySelector('table');
    if (!table) return;
    const { headers, rows } = readTableMatrix(table);
    const spec = chartSpecFromTable(headers, rows);
    if (!spec) {
      setChartJson(null);
      return;
    }
    setChartJson((prev) => (prev ? null : JSON.stringify(spec)));
  };

  return (
    <Box sx={{ my: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.35 }}>
        <ButtonBase
          onClick={tryChart}
          sx={{
            px: 0.75,
            py: 0.25,
            borderRadius: 0.5,
            fontSize: '0.58rem',
            fontFamily: "'JetBrains Mono', monospace",
            color: chartJson ? colors.accent.blue : colors.text.dim,
            border: `1px solid ${colors.border.subtle}`,
            '&:hover': { color: colors.accent.blue, borderColor: colors.border.default },
          }}
        >
          {chartJson ? 'Hide chart' : 'View as chart'}
        </ButtonBase>
      </Box>
      <Box ref={wrapRef}>
        <StyledTableWrapper sx={{ my: 0 }}>{children}</StyledTableWrapper>
      </Box>
      {chartJson && <ChartBlock code={chartJson} language="chart" />}
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
    bgcolor: `${alphaColor(colors.accent.blue, '04')}`,
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
      bgcolor: `${alphaColor(colors.accent.blue, '18')}`,
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
