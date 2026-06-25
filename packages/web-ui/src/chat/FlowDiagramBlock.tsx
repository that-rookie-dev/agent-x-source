import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors } from '../theme';
import { CodeBlockChrome, CodeBlockBody, CODE_BLOCK_TOKENS } from './code-block-chrome';
import { formatPipelineForCopy, formatPipelineStepLabel, parsePipelineDiagram } from './pipeline-diagram';

const MONO = "'JetBrains Mono', monospace";

const rowCellSx = {
  px: 0.85,
  py: 0.4,
  minHeight: 22,
  display: 'flex',
  alignItems: 'center',
  fontSize: CODE_BLOCK_TOKENS.monoFontSize,
  lineHeight: CODE_BLOCK_TOKENS.monoLineHeight,
  fontFamily: MONO,
} as const;

export function FlowDiagramBlock({ code }: { code: string }) {
  const diagram = useMemo(() => parsePipelineDiagram(code), [code]);
  const copyText = useMemo(() => formatPipelineForCopy(diagram), [diagram]);

  const timingWidth = useMemo(() => {
    const timings = diagram.steps.map((s) => s.timing).filter(Boolean) as string[];
    const footer = diagram.footer?.trim();
    const widest = Math.max(0, ...timings.map((t) => t.length), footer?.length ?? 0);
    return widest > 0 ? `${Math.max(widest * 0.48 + 0.5, 3.75)}rem` : 'auto';
  }, [diagram]);

  if (diagram.steps.length === 0) return null;

  const hasTiming = diagram.steps.some((s) => s.timing);
  const gridColumns = hasTiming ? `minmax(0, 1fr) ${timingWidth}` : 'minmax(0, 1fr)';

  return (
    <CodeBlockChrome title="Flow" copyText={copyText}>
      <CodeBlockBody>
        <Box sx={{
          border: `1px solid ${colors.border.subtle}`,
          borderLeft: `2px solid ${colors.accent.purple}`,
          borderRadius: 0.75,
          overflow: 'hidden',
          bgcolor: colors.bg.secondary,
          display: 'grid',
          gridTemplateColumns: gridColumns,
          columnGap: 1,
          alignItems: 'stretch',
        }}>
          {diagram.steps.map((step, i) => {
            const label = formatPipelineStepLabel(step.label);
            const divider = i > 0 ? `1px solid ${colors.border.subtle}` : undefined;
            return (
              <Box key={i} sx={{ display: 'contents' }}>
                <Typography sx={{
                  ...rowCellSx,
                  borderTop: divider,
                  color: colors.text.secondary,
                  fontWeight: 500,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {label}
                </Typography>
                {hasTiming && (
                  <Typography sx={{
                    ...rowCellSx,
                    borderTop: divider,
                    justifyContent: 'flex-end',
                    color: colors.accent.green,
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                  }}>
                    {step.timing ?? ''}
                  </Typography>
                )}
              </Box>
            );
          })}

          {diagram.footer && (
            <Box sx={{ display: 'contents' }}>
              <Typography sx={{
                ...rowCellSx,
                gridColumn: hasTiming ? undefined : '1 / -1',
                borderTop: `1px solid ${colors.border.default}`,
                bgcolor: colors.bg.primary,
                color: colors.text.dim,
                letterSpacing: '0.03em',
                ...(hasTiming ? {} : { justifyContent: 'space-between', gap: 1 }),
              }}>
                {hasTiming ? 'Total' : (
                  <>
                    <Box component="span">Total</Box>
                    <Box component="span" sx={{
                      color: colors.accent.cyan,
                      fontWeight: 600,
                    }}>
                      {diagram.footer}
                    </Box>
                  </>
                )}
              </Typography>
              {hasTiming && (
                <Typography sx={{
                  ...rowCellSx,
                  borderTop: `1px solid ${colors.border.default}`,
                  bgcolor: colors.bg.primary,
                  justifyContent: 'flex-end',
                  color: colors.accent.cyan,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}>
                  {diagram.footer}
                </Typography>
              )}
            </Box>
          )}
        </Box>
      </CodeBlockBody>
    </CodeBlockChrome>
  );
}
