import { useRef, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import type { MarkdownDocumentRecord } from '@agentx/shared';
import { MarkdownContent } from '../markdown/MarkdownContent';
import { exportElementToPdfBlob, savePdfBlob } from '../markdown/markdown-export';
import { colors } from '../theme';

interface Props {
  document: MarkdownDocumentRecord;
  contentMarkdown?: string;
}

async function notifyMarkdown(type: 'checkpoint' | 'error', message: string): Promise<void> {
  const { notify } = await import('../components/NotificationToast');
  notify(type, message);
}

export function MarkdownViewer({ document, contentMarkdown }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const handleExportPdf = useCallback(async () => {
    const root = rootRef.current;
    if (!root || exporting) return;
    setExporting(true);
    try {
      const blob = await exportElementToPdfBlob(root);
      const safeTitle = document.title.replace(/[^\w\s-]/g, '').trim().slice(0, 80) || 'markdown';
      const saved = await savePdfBlob(blob, { defaultFilename: `${safeTitle}-${document.id.slice(-8)}.pdf` });
      if (saved) {
        void notifyMarkdown('checkpoint', `PDF saved${typeof saved === 'string' && saved.includes('/') ? `: ${saved}` : ''}`);
      }
    } catch (e) {
      void notifyMarkdown('error', e instanceof Error ? e.message : 'PDF export failed');
    } finally {
      setExporting(false);
    }
  }, [document.id, document.title, exporting]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{
        flexShrink: 0,
        px: 1.5,
        py: 0.75,
        borderBottom: `1px solid ${colors.border.default}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1,
        bgcolor: colors.bg.secondary,
      }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.76rem', fontWeight: 700, color: colors.text.primary, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.25 }}>
            {document.title}
          </Typography>
          <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace", mt: 0.25 }}>
            {new Date(document.createdAt).toLocaleString()} · session {document.sessionId.slice(-8)}
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

      <Box sx={{ flex: 1, overflow: 'auto', bgcolor: colors.bg.primary, p: { xs: 1.25, md: 1.5 } }}>
        <Box
          ref={rootRef}
          data-markdown-export-root
          sx={{
            width: '100%',
            bgcolor: colors.bg.secondary,
            border: `1px solid ${colors.border.default}`,
            borderRadius: 1.5,
            boxShadow: `0 10px 28px ${colors.bg.primary === 'var(--ax-bg-primary)' ? 'rgba(0,0,0,0.14)' : 'rgba(0,0,0,0.08)'}`,
            p: { xs: 1.25, md: 1.5 },
          }}
        >
          <MarkdownContent content={contentMarkdown ?? ''} />
        </Box>
      </Box>
    </Box>
  );
}
