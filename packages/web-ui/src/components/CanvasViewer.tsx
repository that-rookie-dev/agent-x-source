import { lazy, Suspense, useRef, useState, useCallback, type MouseEvent } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import type { AgentXCanvasRecord } from '@agentx/shared';
import { CanvasRuntime } from '../canvas/CanvasRuntime';
import { exportElementToPdfBlob, savePdfBlob } from '../canvas/canvas-export';
import { colors } from '../theme';

const LazyCrewAwareMarkdown = lazy(() => import('../chat/ChatMarkdown').then((m) => ({ default: m.CrewAwareMarkdown })));

interface Props {
  canvas: AgentXCanvasRecord;
  contentMarkdown?: string;
  contentTsx?: string;
  compiledJs?: string;
  compileError?: string | null;
}

function openCanvasHref(href: string): void {
  try {
    const url = new URL(href, window.location.href);
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) return;
    if (window.agentx?.openExternal) {
      void window.agentx.openExternal(url.href);
    } else {
      window.open(url.href, '_blank', 'noopener,noreferrer');
    }
  } catch {
    // Ignore malformed links and let the browser handle them normally.
  }
}

async function notifyCanvas(type: 'checkpoint' | 'error', message: string): Promise<void> {
  const { notify } = await import('../components/NotificationToast');
  notify(type, message);
}

export function CanvasViewer({ canvas, contentMarkdown, compiledJs, compileError }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const isInteractive = canvas.contentFormat === 'canvas_tsx';

  const handleExportPdf = useCallback(async () => {
    const root = rootRef.current;
    if (!root || exporting) return;
    setExporting(true);
    try {
      const blob = await exportElementToPdfBlob(root);
      const safeTitle = canvas.title.replace(/[^\w\s-]/g, '').trim().slice(0, 80) || 'canvas';
      const saved = await savePdfBlob(blob, { defaultFilename: `${safeTitle}-${canvas.id.slice(-8)}.pdf` });
      if (saved) {
        void notifyCanvas('checkpoint', `PDF saved${typeof saved === 'string' && saved.includes('/') ? `: ${saved}` : ''}`);
      }
    } catch (e) {
      void notifyCanvas('error', e instanceof Error ? e.message : 'PDF export failed');
    } finally {
      setExporting(false);
    }
  }, [canvas.id, canvas.title, exporting]);

  const handleCanvasClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(target instanceof HTMLAnchorElement)) return;
    event.preventDefault();
    event.stopPropagation();
    openCanvasHref(target.href);
  }, []);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{
        flexShrink: 0,
        px: 1.5,
        py: 0.85,
        borderBottom: `1px solid ${colors.border.default}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1,
        bgcolor: colors.bg.secondary,
      }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.76rem', fontWeight: 700, color: colors.text.primary, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.25 }}>
            {canvas.title}
          </Typography>
          <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", mt: 0.25 }}>
            {new Date(canvas.createdAt).toLocaleString()} · {isInteractive ? 'interactive' : 'markdown'} · session {canvas.sessionId.slice(-8)}
          </Typography>
        </Box>
        <Button
          size="small"
          variant="outlined"
          disabled={exporting}
          onClick={() => void handleExportPdf()}
          startIcon={exporting ? <CircularProgress size={14} /> : <PictureAsPdfIcon sx={{ fontSize: 16 }} />}
          sx={{
            flexShrink: 0,
            fontSize: '0.62rem',
            fontFamily: "'JetBrains Mono', monospace",
            borderColor: colors.border.default,
            color: colors.text.secondary,
            '&:hover': { borderColor: colors.text.dim, color: colors.text.primary },
          }}
        >
          {exporting ? 'Exporting…' : 'Save as PDF'}
        </Button>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto', bgcolor: colors.bg.primary, p: { xs: 1.25, md: 2 } }}>
        <Box
          ref={rootRef}
          data-canvas-export-root
          onClickCapture={handleCanvasClick}
          sx={{
            maxWidth: isInteractive ? 1040 : 880,
            mx: 'auto',
            bgcolor: colors.bg.secondary,
            border: `1px solid ${colors.border.default}`,
            borderRadius: 2,
            boxShadow: '0 14px 36px rgba(0,0,0,0.18)',
            px: { xs: 1.5, md: 2 },
            py: { xs: 1.5, md: 2 },
            '& table': { width: '100%' },
            '& a': { color: colors.accent.cyan, textDecorationColor: 'rgba(34,211,238,0.35)' },
            '& > * + *': { mt: 1.5 },
            '& [data-agentx-card], & section, & article': {
              borderRadius: 1.5,
            },
          }}
        >
          {isInteractive ? (
            <CanvasRuntime compiledJs={compiledJs} compileError={compileError ?? canvas.compileError} />
          ) : (
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={18} /></Box>}>
              <LazyCrewAwareMarkdown content={contentMarkdown ?? ''} />
            </Suspense>
          )}
        </Box>
      </Box>
    </Box>
  );
}
