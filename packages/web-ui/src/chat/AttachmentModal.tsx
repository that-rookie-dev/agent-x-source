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

pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

interface AttachmentModalProps {
  open: boolean;
  onClose: () => void;
  id: string;
  name: string;
  mimeType?: string;
}

export const AttachmentModal = memo(function AttachmentModal({ open, onClose, id, name, mimeType }: AttachmentModalProps) {
  const [preview, setPreview] = useState<AttachmentPreview | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    setAvailable(null);
    attachmentsApi.meta(id)
      .then((res) => {
        setAvailable(res.ok && res.available);
        if (res.ok && res.available && !mimeType?.startsWith('image/')) {
          return attachmentsApi.preview(id).then((p) => setPreview(p.preview));
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load attachment metadata'))
      .finally(() => setLoading(false));
  }, [open, id, mimeType]);

  const downloadUrl = attachmentsApi.get(id);

  const renderUnavailable = () => (
    <Box sx={{ p: 4, textAlign: 'center' }}>
      <Typography color="text.secondary">File removed or not found</Typography>
    </Box>
  );

  const renderContent = () => {
    if (available === false) return renderUnavailable();
    if (available === null || loading) return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={24} /></Box>;
    if (error) return <Typography color="error">{error}</Typography>;
    if (mimeType?.startsWith('image/')) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
          <img
            src={downloadUrl}
            alt={name}
            style={{ maxWidth: '100%', maxHeight: '80vh' }}
            onError={() => setAvailable(false)}
          />
        </Box>
      );
    }
    if (mimeType === 'application/pdf') {
      return (
        <Box sx={{ overflow: 'auto', maxHeight: '80vh' }}>
          <Document file={downloadUrl}>
            <Page pageNumber={1} />
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
        {preview?.content ?? ''}
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
