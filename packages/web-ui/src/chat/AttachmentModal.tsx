import { useEffect, useState, memo, useRef, type MouseEvent } from 'react';
import Dialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { attachments as attachmentsApi, getAuthToken } from '../api';
import type { AttachmentPreview } from '@agentx/shared';
import { colors, MONO } from '../theme';

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

function usesBinaryViewer(mime?: string): boolean {
  return !!mime && (mime.startsWith('image/') || mime === 'application/pdf');
}

/** Authenticated binary fetch — bare <img>/<iframe> URLs omit Bearer and fail in Electron. */
async function fetchAttachmentBlob(attachmentId: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(attachmentsApi.get(attachmentId), {
    credentials: 'include',
    headers,
  });
  if (res.status === 401) throw new Error('Unauthorized');
  if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
  return res.blob();
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
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const revokeBlobUrl = () => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  };

  useEffect(() => {
    if (!open) {
      revokeBlobUrl();
      setBlobUrl(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPreview(null);
    setAvailable(null);
    revokeBlobUrl();
    setBlobUrl(null);
    setResolvedId(id);
    setMimeType(guessMime(name, mimeTypeProp));

    const load = async () => {
      let attachmentId = id;
      let mime = guessMime(name, mimeTypeProp);

      try {
        let meta = await attachmentsApi.meta(attachmentId).catch(() => null);
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
          meta = await attachmentsApi.meta(attachmentId);
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

        if (usesBinaryViewer(mime)) {
          const blob = await fetchAttachmentBlob(attachmentId);
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          blobUrlRef.current = url;
          setBlobUrl(url);
        } else {
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
    return () => {
      cancelled = true;
      revokeBlobUrl();
    };
  }, [open, id, name, mimeTypeProp, originalPath]);

  const downloadUrl = attachmentsApi.get(resolvedId);

  const renderUnavailable = () => (
    <Box sx={{ p: 4, textAlign: 'center' }}>
      <Typography color="text.secondary" sx={{ fontFamily: MONO, fontSize: '0.75rem' }}>
        {error || 'File removed or not found'}
      </Typography>
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

    if (mimeType?.startsWith('image/') && blobUrl) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
          <img
            src={blobUrl}
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

    if (mimeType === 'application/pdf' && blobUrl) {
      // Chromium’s built-in PDF viewer — no pdf.js worker / react-pdf version skew.
      return (
        <Box
          component="iframe"
          title={name}
          src={blobUrl}
          sx={{
            width: '100%',
            height: 'min(80vh, 820px)',
            border: `1px solid ${colors.border.default}`,
            borderRadius: '4px',
            bgcolor: colors.bg.primary,
          }}
        />
      );
    }

    if (preview?.kind === 'error') {
      return <Typography color="error" sx={{ fontFamily: MONO, fontSize: '0.75rem' }}>{preview.content}</Typography>;
    }
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
      <Box sx={{
        p: 2, overflow: 'auto', maxHeight: '80vh', whiteSpace: 'pre-wrap',
        fontFamily: MONO, fontSize: '0.8rem', color: colors.text.primary,
      }}>
        {preview?.content ?? (error || 'No preview available')}
      </Box>
    );
  };

  const onDownloadClick = async (e: MouseEvent<HTMLAnchorElement>) => {
    // Prefer authenticated blob download so Electron Bearer auth works.
    if (!blobUrl) {
      e.preventDefault();
      try {
        const blob = await fetchAttachmentBlob(resolvedId);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Download failed');
      }
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 1, fontFamily: MONO, fontSize: '0.95rem' }}>{name}</Typography>
        {available === true && (
          <a
            href={blobUrl ?? downloadUrl}
            download={name}
            onClick={onDownloadClick}
            style={{ display: 'block', marginBottom: 8, fontFamily: MONO, fontSize: '0.7rem' }}
          >
            Download
          </a>
        )}
        {renderContent()}
      </Box>
    </Dialog>
  );
});
