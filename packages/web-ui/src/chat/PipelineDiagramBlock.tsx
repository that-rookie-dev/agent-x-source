import { Fragment, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors } from '../theme';
import { CodeBlockChrome, CodeBlockBody, CODE_BLOCK_TOKENS } from './code-block-chrome';
import { formatHorizontalPipelineForCopy, formatPipelineStepLabel, parsePipelineDiagram } from './pipeline-diagram';

const MONO = "'JetBrains Mono', monospace";
const SANS = "'Inter', sans-serif";

export function PipelineDiagramBlock({ code }: { code: string }) {
  const diagram = useMemo(() => parsePipelineDiagram(code), [code]);
  const copyText = useMemo(() => formatHorizontalPipelineForCopy(diagram), [diagram]);

  if (diagram.steps.length === 0) return null;

  return (
    <CodeBlockChrome title="Pipeline" copyText={copyText}>
      <CodeBlockBody sx={{ py: CODE_BLOCK_TOKENS.bodyPy - 0.15 }}>
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          overflowX: 'auto',
          gap: 0,
          mx: -0.25,
          scrollbarWidth: 'thin',
          '&::-webkit-scrollbar': { height: 4 },
          '&::-webkit-scrollbar-thumb': { bgcolor: colors.border.default, borderRadius: 2 },
        }}>
        {diagram.steps.map((step, i) => {
          const label = formatPipelineStepLabel(
            typeof step.label === 'string' ? step.label : String((step.label as { label?: unknown })?.label ?? ''),
          );
          return (
            <Fragment key={i}>
              {i > 0 && (
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  flexShrink: 0,
                  px: 0.25,
                  color: colors.text.dim,
                }}>
                  <Box sx={{ width: 10, height: 1, bgcolor: colors.border.default }} />
                  <Typography sx={{
                    fontSize: '0.5rem',
                    lineHeight: 1,
                    px: 0.2,
                    fontFamily: MONO,
                    userSelect: 'none',
                  }}>
                    ›
                  </Typography>
                  <Box sx={{ width: 10, height: 1, bgcolor: colors.border.default }} />
                </Box>
              )}
              <Box sx={{
                flexShrink: 0,
                minWidth: 72,
                maxWidth: 148,
                px: 0.65,
                py: 0.4,
                borderRadius: 0.75,
                border: `1px solid ${colors.border.subtle}`,
                bgcolor: colors.bg.primary,
              }}>
                <Typography sx={{
                  fontSize: CODE_BLOCK_TOKENS.sansFontSize,
                  lineHeight: CODE_BLOCK_TOKENS.sansLineHeight,
                  fontFamily: SANS,
                  color: colors.text.secondary,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {label}
                </Typography>
                {step.timing && (
                  <Typography sx={{
                    fontSize: CODE_BLOCK_TOKENS.timingFontSize,
                    fontFamily: MONO,
                    color: colors.accent.green,
                    fontWeight: 500,
                    mt: 0.15,
                    whiteSpace: 'nowrap',
                  }}>
                    {step.timing}
                  </Typography>
                )}
              </Box>
            </Fragment>
          );
        })}
        </Box>

        {diagram.footer && (
          <Box sx={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 0.75,
            pt: 0.5,
            mt: 0.35,
            borderTop: `1px solid ${colors.border.subtle}`,
          }}>
            <Typography sx={{
              fontSize: CODE_BLOCK_TOKENS.timingFontSize,
              fontFamily: MONO,
              color: colors.text.dim,
            }}>
              Total
            </Typography>
            <Typography sx={{
              fontSize: CODE_BLOCK_TOKENS.monoFontSize,
              fontFamily: MONO,
              color: colors.accent.cyan,
              fontWeight: 600,
            }}>
              {diagram.footer}
            </Typography>
          </Box>
        )}
      </CodeBlockBody>
    </CodeBlockChrome>
  );
}
