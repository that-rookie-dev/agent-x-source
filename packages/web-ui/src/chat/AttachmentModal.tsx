import { useEffect, useState, memo, useRef, type MouseEvent } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import { attachments as attachmentsApi, getAuthToken } from '../api';
import type { AttachmentPreview } from '@agentx/shared';
import { colors, MONO, alphaColor } from '../theme';

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
    svg: 'image/svg+xml',
    txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv',
    html: 'text/html',
  };
  return map[ext] ?? mimeType;
}

function usesBinaryViewer(mime?: string): boolean {
  return !!mime && (mime.startsWith('image/') || mime === 'application/pdf');
}

/** Authenticated binary fetch — bare <img>/<iframe> URLs omit Bearer and fail in Electron. */
async function fetchAttachmentBlob(attachmentId: string, mimeHint?: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(attachmentsApi.get(attachmentId), {
    credentials: 'include',
    headers,
  });
  if (res.status === 401) throw new Error('Unauthorized');
  if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
  const buffer = await res.arrayBuffer();
  const headerType = res.headers.get('content-type')?.split(';')[0]?.trim();
  const type = (
    (mimeHint && mimeHint !== 'application/octet-stream' && mimeHint)
    || (headerType && headerType !== 'application/octet-stream' && headerType)
    || mimeHint
    || headerType
    || 'application/octet-stream'
  );
  return new Blob([buffer], { type });
}

/** Render PDF pages as canvases — no Chromium PDF chrome (sidebar / download / toolbar). */
function PdfPagesView({ bytes, name }: { bytes: ArrayBuffer; name: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (host) host.replaceChildren();

    const run = async () => {
      setStatus('loading');
      setError(null);
      try {
        const pdfjs = await import('pdfjs-dist');
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

        const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
        if (cancelled) return;
        setPageCount(doc.numPages);

        const root = hostRef.current;
        if (!root) return;
        root.replaceChildren();

        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return;
          const page = await doc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const maxWidth = Math.min(root.clientWidth || 720, 900);
          const scale = Math.min(1.5, maxWidth / Math.max(base.width, 1));
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.setAttribute('aria-label', `${name} — page ${i}`);
          Object.assign(canvas.style, {
            width: '100%',
            height: 'auto',
            display: 'block',
            marginBottom: i < doc.numPages ? '12px' : '0',
            background: '#fff',
            borderRadius: '4px',
            boxShadow: `0 1px 0 ${alphaColor(colors.border.default, 0.8)}`,
          });
          root.appendChild(canvas);
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas unavailable');
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        }
        if (!cancelled) setStatus('ready');
      } catch (e) {
        if (!cancelled) {
          setStatus('error');
          setError(e instanceof Error ? e.message : 'Failed to render PDF');
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [bytes, name]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minHeight: 200 }}>
      {status === 'loading' && (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <CircularProgress size={22} sx={{ color: colors.accent.cyan }} />
          <Typography sx={{ mt: 1, fontFamily: MONO, fontSize: '0.65rem', color: colors.text.dim }}>
            Rendering pages…
          </Typography>
        </Box>
      )}
      {status === 'error' && (
        <Typography color="error" sx={{ fontFamily: MONO, fontSize: '0.75rem', p: 2 }}>
          {error || 'Failed to render PDF'}
        </Typography>
      )}
      {status === 'ready' && pageCount > 0 && (
        <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: colors.text.dim, px: 0.5 }}>
          {pageCount} page{pageCount === 1 ? '' : 's'}
        </Typography>
      )}
      <Box
        ref={hostRef}
        sx={{
          overflow: 'auto',
          maxHeight: 'min(72vh, 780px)',
          px: 0.5,
          py: 0.5,
          bgcolor: colors.bg.primary,
          borderRadius: 1,
          border: `1px solid ${colors.border.default}`,
        }}
      />
    </Box>
  );
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
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
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
      setPdfBytes(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPreview(null);
    setAvailable(null);
    revokeBlobUrl();
    setBlobUrl(null);
    setPdfBytes(null);
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
          mime = guessMime(name, registered.attachment.mimeType || mime);
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

        // Prefer filename when the store only has a generic octet-stream type.
        mime = guessMime(name, meta.attachment?.mimeType || mime);
        setMimeType(mime);
        setAvailable(true);

        if (usesBinaryViewer(mime)) {
          const blob = await fetchAttachmentBlob(attachmentId, mime);
          if (cancelled) return;
          if (mime === 'application/pdf') {
            setPdfBytes(await blob.arrayBuffer());
          } else {
            const typed = blob.type.startsWith('image/')
              ? blob
              : new Blob([await blob.arrayBuffer()], { type: mime || 'image/png' });
            const url = URL.createObjectURL(typed);
            blobUrlRef.current = url;
            setBlobUrl(url);
          }
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
      <Typography sx={{ fontFamily: MONO, fontSize: '0.75rem', color: colors.text.secondary }}>
        {error || 'File removed or not found'}
      </Typography>
    </Box>
  );

  const renderContent = () => {
    if (loading || available === null) {
      return (
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <CircularProgress size={24} sx={{ color: colors.accent.cyan }} />
        </Box>
      );
    }
    if (available === false) return renderUnavailable();

    if (mimeType?.startsWith('image/') && blobUrl) {
      return (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: 200,
            maxHeight: 'min(72vh, 780px)',
            overflow: 'auto',
            bgcolor: colors.bg.primary,
            borderRadius: 1,
            border: `1px solid ${colors.border.default}`,
            p: 1.5,
          }}
        >
          <img
            src={blobUrl}
            alt={name}
            style={{ maxWidth: '100%', maxHeight: 'min(70vh, 760px)', objectFit: 'contain' }}
            onError={() => {
              setAvailable(false);
              setError('Image failed to load');
            }}
          />
        </Box>
      );
    }

    if (mimeType === 'application/pdf' && pdfBytes) {
      return <PdfPagesView bytes={pdfBytes} name={name} />;
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
      return <Box sx={{ p: 2, overflow: 'auto', maxHeight: '72vh' }} dangerouslySetInnerHTML={{ __html: preview.content }} />;
    }
    return (
      <Box sx={{
        p: 2, overflow: 'auto', maxHeight: '72vh', whiteSpace: 'pre-wrap',
        fontFamily: MONO, fontSize: '0.8rem', color: colors.text.primary,
        bgcolor: colors.bg.primary,
        borderRadius: 1,
        border: `1px solid ${colors.border.default}`,
      }}>
        {preview?.content ?? (error || 'No preview available')}
      </Box>
    );
  };

  const onDownloadClick = async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    try {
      const blob = blobUrl
        ? await (await fetch(blobUrl)).blob()
        : pdfBytes
          ? new Blob([pdfBytes], { type: 'application/pdf' })
          : await fetchAttachmentBlob(resolvedId, mimeType);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      scroll="paper"
      slotProps={{
        backdrop: {
          sx: {
            backgroundColor: alphaColor(colors.bg.primary, 0.72),
            backdropFilter: 'blur(2px)',
          },
        },
      }}
      PaperProps={{
        elevation: 8,
        sx: {
          bgcolor: colors.bg.secondary,
          color: colors.text.primary,
          border: `1px solid ${colors.border.strong}`,
          borderRadius: 1.5,
          boxShadow: `0 16px 48px ${colors.shadow.heavy}`,
          maxHeight: '88vh',
          overflow: 'hidden',
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          borderBottom: `1px solid ${colors.border.default}`,
          bgcolor: colors.bg.elevated,
          py: 1.25,
          px: 2,
        }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            sx={{
              fontSize: '0.82rem',
              fontWeight: 700,
              color: colors.text.primary,
              fontFamily: MONO,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={name}
          >
            {name}
          </Typography>
          {mimeType && (
            <Typography sx={{ fontSize: '0.55rem', color: colors.text.dim, fontFamily: MONO, mt: 0.25 }}>
              {mimeType}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
          {available === true && (
            <IconButton
              size="small"
              onClick={onDownloadClick}
              aria-label="Download"
              sx={{ color: colors.text.dim, '&:hover': { color: colors.text.primary } }}
            >
              <DownloadIcon sx={{ fontSize: 18 }} />
            </IconButton>
          )}
          <IconButton
            size="small"
            onClick={onClose}
            aria-label="Close"
            sx={{ color: colors.text.dim, '&:hover': { color: colors.text.primary } }}
          >
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ px: 2, py: 2, bgcolor: colors.bg.secondary }}>
        {renderContent()}
        {/* Keep download URL referenced for a11y tooling / future use */}
        <Box component="span" sx={{ display: 'none' }} data-download-url={downloadUrl} />
      </DialogContent>
    </Dialog>
  );
});
