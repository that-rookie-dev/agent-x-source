import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { colors } from '../theme';
import { formatPipelineForCopy, parsePipelineDiagram } from './pipeline-diagram';

const MONO = "'JetBrains Mono', monospace";

const cellSx = { px: 1.15, py: 0.65 };

export function PipelineDiagramBlock({ code }: { code: string }) {
  const diagram = useMemo(() => parsePipelineDiagram(code), [code]);
  const copyText = useMemo(() => formatPipelineForCopy(diagram), [diagram]);
  const [copied, setCopied] = useState(false);

  const { timingWidth, hasTimingCol } = useMemo(() => {
    const timings = diagram.steps.map((s) => s.timing).filter(Boolean) as string[];
    const footer = diagram.footer?.trim();
    const widest = Math.max(0, ...timings.map((t) => t.length), footer?.length ?? 0);
    const timingWidth = widest > 0 ? `${Math.max(widest * 0.42 + 0.5, 3.5)}rem` : '0px';
    return { timingWidth, hasTimingCol: widest > 0 };
  }, [diagram]);

  if (diagram.steps.length === 0) return null;

  const gridColumns = hasTimingCol ? `minmax(0, 1fr) ${timingWidth}` : 'minmax(0, 1fr)';

  return (
    <Box sx={{
      my: 1.25,
      border: `1px solid ${colors.border.default}`,
      borderRadius: 1.25,
      overflow: 'hidden',
      bgcolor: colors.bg.primary,
    }}>
      <Box sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        px: 1.25, py: 0.5, bgcolor: colors.bg.secondary, borderBottom: `1px solid ${colors.border.default}`,
      }}>
        <Typography sx={{
          fontSize: '0.55rem', fontWeight: 700, color: colors.text.secondary,
          fontFamily: MONO, letterSpacing: '0.04em', textTransform: 'uppercase',
        }}>
          Pipeline
        </Typography>
        <Box
          component="button"
          onClick={() => {
            navigator.clipboard.writeText(copyText).catch(() => {});
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          sx={{
            bgcolor: 'transparent', border: `1px solid ${colors.border.subtle}`, borderRadius: '6px',
            cursor: 'pointer', px: 0.85, py: 0.2, color: copied ? colors.accent.green : colors.text.dim,
            fontSize: '0.52rem', fontFamily: MONO, transition: 'color 0.15s',
            '&:hover': { borderColor: colors.border.strong, color: colors.text.secondary },
          }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </Box>
      </Box>

      <Box sx={{
        mx: 1.25, my: 1.1,
        border: `1px solid ${colors.border.subtle}`,
        borderRadius: 1,
        bgcolor: colors.bg.secondary,
        overflow: 'hidden',
        display: 'grid',
        gridTemplateColumns: gridColumns,
        columnGap: 1.25,
        alignItems: 'center',
      }}>
        {diagram.steps.map((step, i) => (
          <Box key={i} sx={{ display: 'contents' }}>
            {i > 0 && (
              <Box sx={{
                gridColumn: '1 / -1',
                display: 'flex',
                justifyContent: 'center',
                py: 0.25,
                bgcolor: colors.bg.primary,
                borderTop: `1px solid ${colors.border.subtle}`,
              }}>
                <Typography sx={{
                  fontSize: '0.7rem', lineHeight: 1, color: colors.accent.purple,
                  fontFamily: MONO, userSelect: 'none',
                }}>
                  ↓
                </Typography>
              </Box>
            )}
            <Typography sx={{
              ...cellSx,
              fontSize: '0.68rem', fontFamily: MONO,
              color: colors.text.primary, fontWeight: 500, minWidth: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {step.label}
            </Typography>
            {hasTimingCol && (
              <Typography sx={{
                ...cellSx,
                fontSize: '0.58rem', fontFamily: MONO,
                color: colors.accent.green, fontWeight: 600,
                textAlign: 'right', whiteSpace: 'nowrap',
              }}>
                {step.timing ?? ''}
              </Typography>
            )}
          </Box>
        ))}

        {diagram.footer && (
          <Box sx={{ display: 'contents' }}>
            <Typography sx={{
              ...cellSx,
              fontSize: '0.58rem', fontFamily: MONO,
              color: colors.text.dim, textTransform: 'uppercase', letterSpacing: '0.06em',
              borderTop: `1px solid ${colors.border.default}`,
              bgcolor: colors.bg.primary,
            }}>
              Total
            </Typography>
            {hasTimingCol && (
              <Typography sx={{
                ...cellSx,
                fontSize: '0.68rem', fontFamily: MONO,
                color: colors.accent.cyan, fontWeight: 700,
                textAlign: 'right', whiteSpace: 'nowrap',
                borderTop: `1px solid ${colors.border.default}`,
                bgcolor: colors.bg.primary,
              }}>
                {diagram.footer}
              </Typography>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
