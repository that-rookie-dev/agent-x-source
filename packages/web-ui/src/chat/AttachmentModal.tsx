import { useEffect, useState, memo } from 'react';
import Dialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import { attachments as attachmentsApi } from '../api';
import type { AttachmentPreview } from '@agentx/shared';

// Prefer the bundled worker — CDN workers often fail offline / version-skew and leave the PDF spinner stuck.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface AttachmentModalProps {
  open: boolean;
  onClose: () => void;
  id: string;
  name: string;
  mimeType?: string;
  /** Absolute workspace path — used to register a previewable attachment when `id` is a local chip id. */
  originalPath?: string;
}

function guessMime(name: string, mimeType?: string): string | undefined {
  if (mimeType && mimeType !== 'application/octet-stream') return mimeType;
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv',
    html: 'text/html',
  };
  return map[ext] ?? mimeType;
}

function usesNativeViewer(mime?: string): boolean {
  return !!mime && (mime.startsWith('image/') || mime === 'application/pdf');
}

export const AttachmentModal = memo(function AttachmentModal({
  open,
  onClose,
  id,
  name,
  mimeType: mimeTypeProp,
  originalPath,
}: AttachmentModalProps) {
  const [resolvedId, setResolvedId] = useState(id);
  const [mimeType, setMimeType] = useState(() => guessMime(name, mimeTypeProp));
  const [preview, setPreview] = useState<AttachmentPreview | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfPages, setPdfPages] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPreview(null);
    setAvailable(null);
    setPdfPages(0);
    setResolvedId(id);
    setMimeType(guessMime(name, mimeTypeProp));

    const load = async () => {
      let attachmentId = id;
      let mime = guessMime(name, mimeTypeProp);

      const tryMeta = async (aid: string) => {
        const res = await attachmentsApi.meta(aid);
        return res;
      };

      try {
        let meta = await tryMeta(attachmentId).catch(() => null);
        if ((!meta || !meta.ok || !meta.available) && originalPath) {
          const registered = await attachmentsApi.registerWorkspace({
            originalPath,
            filename: name,
            mimeType: mime,
          });
          if (cancelled) return;
          attachmentId = registered.attachment.id;
          mime = registered.attachment.mimeType || mime;
          setResolvedId(attachmentId);
          setMimeType(mime);
          meta = await tryMeta(attachmentId);
        }

        if (cancelled) return;
        if (!meta || !meta.ok || !meta.available) {
          setAvailable(false);
          setError(meta ? 'File removed or not found' : 'Attachment not found');
          return;
        }

        mime = meta.attachment?.mimeType || mime;
        setMimeType(mime);
        setAvailable(true);

        // Images/PDFs render natively — do not wait on extractPreview (that was hanging the spinner).
        if (!usesNativeViewer(mime)) {
          const p = await attachmentsApi.preview(attachmentId);
          if (!cancelled) setPreview(p.preview);
        }
      } catch (e) {
        if (!cancelled) {
          setAvailable(false);
          setError(e instanceof Error ? e.message : 'Failed to load attachment');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [open, id, name, mimeTypeProp, originalPath]);

  const downloadUrl = attachmentsApi.get(resolvedId);

  const renderUnavailable = () => (
    <Box sx={{ p: 4, textAlign: 'center' }}>
      <Typography color="text.secondary">{error || 'File removed or not found'}</Typography>
    </Box>
  );

  const renderContent = () => {
    if (loading || available === null) {
      return (
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <CircularProgress size={24} />
        </Box>
      );
    }
    if (available === false) return renderUnavailable();
    if (error && !usesNativeViewer(mimeType)) {
      return <Typography color="error">{error}</Typography>;
    }
    if (mimeType?.startsWith('image/')) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
          <img
            src={downloadUrl}
            alt={name}
            style={{ maxWidth: '100%', maxHeight: '80vh' }}
            onError={() => {
              setAvailable(false);
              setError('Image failed to load');
            }}
          />
        </Box>
      );
    }
    if (mimeType === 'application/pdf') {
      return (
        <Box sx={{ overflow: 'auto', maxHeight: '80vh' }}>
          <Document
            file={downloadUrl}
            loading={
              <Box sx={{ p: 4, textAlign: 'center' }}>
                <CircularProgress size={24} />
              </Box>
            }
            error={
              <Typography color="error" sx={{ p: 2 }}>
                Failed to render PDF. Try downloading the file.
              </Typography>
            }
            onLoadSuccess={({ numPages }) => setPdfPages(numPages)}
            onLoadError={(e) => setError(e.message)}
          >
            {Array.from({ length: Math.max(pdfPages, 1) }, (_, i) => (
              <Page
                key={i + 1}
                pageNumber={i + 1}
                width={Math.min(820, typeof window !== 'undefined' ? window.innerWidth - 96 : 820)}
              />
            ))}
          </Document>
        </Box>
      );
    }
    if (preview?.kind === 'error') return <Typography color="error">{preview.content}</Typography>;
    if (preview?.kind === 'table' && preview.rows) {
      return (
        <Table size="small">
          <TableHead>
            <TableRow>
              {(preview.headers ?? []).map((h, i) => <TableCell key={i}>{h}</TableCell>)}
            </TableRow>
          </TableHead>
          <TableBody>
            {preview.rows.map((row, r) => (
              <TableRow key={r}>
                {row.map((cell, c) => <TableCell key={c}>{cell}</TableCell>)}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      );
    }
    if (preview?.kind === 'html' && preview.content) {
      return <Box sx={{ p: 2, overflow: 'auto', maxHeight: '80vh' }} dangerouslySetInnerHTML={{ __html: preview.content }} />;
    }
    return (
      <Box sx={{ p: 2, overflow: 'auto', maxHeight: '80vh', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.85rem' }}>
        {preview?.content ?? (error || 'No preview available')}
      </Box>
    );
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>{name}</Typography>
        {available === true && (
          <a href={downloadUrl} download={name} style={{ display: 'block', marginBottom: 8 }}>Download</a>
        )}
        {renderContent()}
      </Box>
    </Dialog>
  );
});
