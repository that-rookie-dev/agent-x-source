/**
 * Template Library — design masters that Agent-X clones.
 *
 * Model: the uploaded file IS the design. Analysis maps variable slots
 * (incl. sample text). Generate produces a same-format copy; missing slots stay blank.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import RefreshIcon from '@mui/icons-material/Refresh';
import CloseIcon from '@mui/icons-material/Close';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { DocumentTemplate, TemplateField } from '@agentx/shared';
import { colors, MONO, alphaColor, PANEL_SIDE_LIST_WIDTH } from '../theme';
import { PanelHeader } from './PanelHeader';
import { FileViewerModal } from './FileViewerModal';
import { useTemplates } from '../hooks/useTemplates';
import { formatTemplateMentionToken } from '../chat/mention-tokens';
import { attachments as attachmentsApi, getAuthToken } from '../api';

const ACCEPTED = '.pdf,.docx,.doc,.xlsx,.pptx';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatBadge(format: string): string {
  return format.toUpperCase();
}

function isGenericFieldLabel(label: string): boolean {
  return /^field[_\s-]?\d+$/i.test(label.trim());
}

function slotTitle(f: TemplateField): string {
  if (f.label?.trim() && !isGenericFieldLabel(f.label)) return f.label.trim();
  if (f.context?.trim()) return f.context.trim();
  return f.key;
}

function slotSample(f: TemplateField): string | null {
  const s = f.sampleValue?.trim();
  return s || null;
}

function analysisLabel(t: DocumentTemplate): string {
  if (t.analysisStatus === 'analyzing' || t.analysisStatus === 'pending') return 'Mapping…';
  if (t.analysisStatus === 'failed') return 'Map failed';
  if (t.fillable) return `${t.fields.length} slot${t.fields.length === 1 ? '' : 's'}`;
  return 'Reference';
}

/** First-page / image preview of the master file — visual source of truth. */
function TemplateMasterPreview({
  storageId,
  name,
  mimeType,
  onOpen,
}: {
  storageId: string;
  name: string;
  mimeType?: string;
  onOpen: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'unsupported'>('loading');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setStatus('loading');
    setError(null);
    setImageUrl(null);

    const run = async () => {
      try {
        const headers: Record<string, string> = {};
        const token = getAuthToken();
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(attachmentsApi.get(storageId), { credentials: 'include', headers });
        if (!res.ok) throw new Error(`Failed to load master (${res.status})`);
        const buffer = await res.arrayBuffer();
        if (cancelled) return;

        const mime = (mimeType && mimeType !== 'application/octet-stream')
          ? mimeType
          : (res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream');

        if (mime.startsWith('image/')) {
          objectUrl = URL.createObjectURL(new Blob([buffer], { type: mime }));
          if (!cancelled) {
            setImageUrl(objectUrl);
            setStatus('ready');
          }
          return;
        }

        if (mime === 'application/pdf' || /\.pdf$/i.test(name)) {
          const pdfjs = await import('pdfjs-dist');
          const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
          pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
          const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
          if (cancelled) return;
          const page = await doc.getPage(1);
          const base = page.getViewport({ scale: 1 });
          const maxWidth = 640;
          const scale = Math.min(1.4, maxWidth / Math.max(base.width, 1));
          const viewport = page.getViewport({ scale });
          const canvas = canvasRef.current;
          if (!canvas) return;
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas unavailable');
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          if (!cancelled) setStatus('ready');
          return;
        }

        if (!cancelled) setStatus('unsupported');
      } catch (e) {
        if (!cancelled) {
          setStatus('error');
          setError(e instanceof Error ? e.message : 'Preview failed');
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [storageId, name, mimeType]);

  return (
    <Box
      onClick={onOpen}
      sx={{
        borderRadius: 1.25,
        border: `1px solid ${colors.border.default}`,
        bgcolor: colors.bg.secondary,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color 0.2s ease',
        '&:hover': { borderColor: colors.border.accent },
      }}
    >
      <Box sx={{
        px: 1.5, py: 0.85,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
        borderBottom: `1px solid ${colors.border.subtle}`,
      }}>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.52rem', color: colors.text.dim, letterSpacing: '0.08em' }}>
          MASTER · SOURCE OF TRUTH
        </Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: '0.52rem', color: colors.accent.cyan, letterSpacing: '0.04em' }}>
          OPEN FULL FILE →
        </Typography>
      </Box>
      <Box sx={{
        p: { xs: 1.25, md: 2 },
        minHeight: 220,
        maxHeight: 420,
        overflow: 'auto',
        display: 'flex',
        justifyContent: 'center',
        alignItems: status === 'ready' ? 'flex-start' : 'center',
        bgcolor: alphaColor(colors.ink, 0.03),
      }}>
        {status === 'loading' && (
          <Box sx={{ textAlign: 'center' }}>
            <CircularProgress size={22} sx={{ color: colors.accent.cyan }} />
            <Typography sx={{ mt: 1, fontFamily: MONO, fontSize: '0.58rem', color: colors.text.dim }}>
              Loading master…
            </Typography>
          </Box>
        )}
        {status === 'error' && (
          <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: colors.accent.red, px: 2, textAlign: 'center' }}>
            {error || 'Could not preview master'}
          </Typography>
        )}
        {status === 'unsupported' && (
          <Box sx={{ textAlign: 'center', px: 3, maxWidth: 360 }}>
            <DescriptionOutlinedIcon sx={{ fontSize: 28, color: colors.text.dim, mb: 1 }} />
            <Typography sx={{ fontFamily: MONO, fontSize: '0.68rem', color: colors.text.secondary, lineHeight: 1.5 }}>
              Inline preview isn’t available for this format. Open the master — Generate still clones its exact design.
            </Typography>
          </Box>
        )}
        <canvas
          ref={canvasRef}
          style={{
            display: status === 'ready' && !imageUrl ? 'block' : 'none',
            maxWidth: '100%',
            height: 'auto',
            background: '#fff',
            borderRadius: 4,
            boxShadow: `0 8px 28px ${alphaColor(colors.ink, 0.18)}`,
          }}
        />
        {imageUrl && status === 'ready' && (
          <img
            src={imageUrl}
            alt={name}
            style={{
              maxWidth: '100%',
              maxHeight: 380,
              objectFit: 'contain',
              borderRadius: 4,
              boxShadow: `0 8px 28px ${alphaColor(colors.ink, 0.18)}`,
            }}
          />
        )}
      </Box>
    </Box>
  );
}

function SlotRow({ field }: { field: TemplateField }) {
  const sample = slotSample(field);
  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: { xs: '1fr', sm: '140px 1fr' },
      gap: { xs: 0.35, sm: 1.5 },
      alignItems: 'baseline',
      py: 1,
      borderBottom: `1px solid ${colors.border.subtle}`,
      '&:last-child': { borderBottom: 'none' },
    }}>
      <Typography sx={{
        fontFamily: MONO, fontSize: '0.62rem', fontWeight: 600,
        color: colors.text.primary, letterSpacing: '0.02em',
      }}>
        {slotTitle(field)}
      </Typography>
      <Box>
        {sample ? (
          <Typography sx={{
            fontFamily: MONO, fontSize: '0.65rem', color: colors.text.secondary,
            lineHeight: 1.45,
          }}>
            In master: <Box component="span" sx={{ color: colors.accent.cyan }}>"{sample}"</Box>
          </Typography>
        ) : (
          <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: colors.text.dim }}>
            {field.blankToken ? `Blank marker ${field.blankToken}` : 'Blank in master — fill or leave empty'}
          </Typography>
        )}
        {field.context && field.context !== slotTitle(field) && (
          <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: colors.text.dim, mt: 0.25 }}>
            Near “{field.context}”
          </Typography>
        )}
      </Box>
    </Box>
  );
}

export function TemplatesPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const {
    items, loading, error, busy, refresh, upload, update, rescan, fill, remove, setError,
  } = useTemplates();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [fillOpen, setFillOpen] = useState(false);
  const [fillValues, setFillValues] = useState<Record<string, string>>({});
  const [outputName, setOutputName] = useState('');
  const [copiedMention, setCopiedMention] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [viewer, setViewer] = useState<{ id: string; name: string; mimeType?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const selected = useMemo(
    () => items.find((t) => t.id === selectedId) ?? null,
    [items, selectedId],
  );

  useEffect(() => {
    if (selectedId && !items.some((t) => t.id === selectedId)) setSelectedId(null);
  }, [items, selectedId]);

  useEffect(() => {
    setNameDraft(selected?.name ?? '');
    setDescriptionDraft(selected?.description ?? '');
    setCopiedMention(false);
    setBriefOpen(false);
  }, [selected?.id, selected?.name, selected?.description]);

  const blankSlots = useMemo(() => {
    if (!selected) return [];
    return selected.fields
      .filter((f) => !(fillValues[f.key] ?? '').trim())
      .map((f) => slotTitle(f));
  }, [selected, fillValues]);

  const analyzing = selected?.analysisStatus === 'analyzing' || selected?.analysisStatus === 'pending';
  const canGenerate = Boolean(selected?.fillable && !analyzing);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const accepted = Array.from(files).filter((f) => /\.(pdf|docx|doc|xlsx|pptx)$/i.test(f.name));
    for (const file of accepted) {
      try {
        const t = await upload(file);
        setSelectedId(t.id);
      } catch {
        /* surfaced via error */
      }
    }
  }, [upload]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragOver(false);
    void handleFiles(e.dataTransfer.files);
  };

  const openFill = (t: DocumentTemplate) => {
    const values: Record<string, string> = {};
    for (const f of t.fields) values[f.key] = '';
    setFillValues(values);
    const ext = t.format === 'xlsx' ? 'xlsx' : t.format === 'pdf' ? 'pdf' : 'docx';
    setOutputName(`${t.name.replace(/\.[^.]+$/, '')}-filled.${ext}`);
    setFillOpen(true);
  };

  const submitFill = async () => {
    if (!selected) return;
    try {
      const result = await fill(selected.id, fillValues, outputName || undefined);
      setFillOpen(false);
      if (result.missingFields.length > 0) {
        setError(`Generated — blank slots: ${result.missingFields.join(', ')}`);
      }
      setViewer({ id: result.storageId, name: result.outputName, mimeType: result.mimeType });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveName = async () => {
    if (!selected) return;
    const next = nameDraft.trim();
    if (!next || next === selected.name) {
      setNameDraft(selected.name);
      return;
    }
    await update(selected.id, { name: next });
  };

  const saveDescription = async () => {
    if (!selected) return;
    const next = descriptionDraft.trim();
    if (next === (selected.description ?? '')) return;
    await update(selected.id, { description: next || null });
  };

  const copyMention = async () => {
    if (!selected) return;
    const token = formatTemplateMentionToken(selected.id, selected.name);
    try {
      await navigator.clipboard.writeText(token);
      setCopiedMention(true);
      window.setTimeout(() => setCopiedMention(false), 1600);
    } catch {
      setError('Could not copy mention to clipboard');
    }
  };

  const openMaster = () => {
    if (!selected) return;
    setViewer({ id: selected.storageId, name: selected.name, mimeType: selected.mimeType });
  };

  const uploadAction = (
    <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
      <Tooltip title="Refresh">
        <IconButton size="small" onClick={() => void refresh()} sx={{ color: colors.text.dim }}>
          <RefreshIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <Button
        size="small"
        variant="contained"
        startIcon={<UploadFileIcon sx={{ fontSize: 14 }} />}
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
        sx={{ fontFamily: MONO, fontSize: '0.65rem' }}
      >
        Upload master
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        hidden
        multiple
        accept={ACCEPTED}
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.currentTarget.value = '';
        }}
      />
    </Box>
  );

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: colors.bg.primary }}>
      {!embedded && (
        <PanelHeader
          title="TEMPLATES"
          subtitle="Design masters — clone the look, fill what you have"
          action={uploadAction}
        />
      )}
      {embedded && (
        <Box sx={{
          px: 2, py: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
          borderBottom: `1px solid ${colors.border.default}`,
          flexShrink: 0,
        }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.62rem', color: colors.text.dim, letterSpacing: '0.03em' }}>
            Upload a design master. Generated files keep the same look and format.
          </Typography>
          {uploadAction}
        </Box>
      )}

      {error && (
        <Box sx={{
          mx: 2, mt: 1, px: 1.25, py: 0.75,
          border: `1px solid ${alphaColor(colors.accent.red, 0.35)}`,
          bgcolor: alphaColor(colors.accent.red, 0.08),
          borderRadius: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
        }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: colors.accent.red }}>{error}</Typography>
          <IconButton size="small" onClick={() => setError(null)} sx={{ color: colors.text.dim }}>
            <CloseIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Box>
      )}

      <Box
        sx={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}
        onDragEnter={(e) => {
          e.preventDefault();
          dragCounter.current++;
          if (e.dataTransfer.types.includes('Files')) setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          dragCounter.current--;
          if (dragCounter.current <= 0) {
            dragCounter.current = 0;
            setDragOver(false);
          }
        }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={onDrop}
      >
        {dragOver && (
          <Box sx={{
            position: 'absolute', inset: 8, zIndex: 4,
            border: `2px dashed ${colors.accent.cyan}`,
            bgcolor: alphaColor(colors.accent.cyan, 0.08),
            borderRadius: 1.5,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.75rem', color: colors.accent.cyan }}>
              Drop design masters (.pdf / .docx / .xlsx)
            </Typography>
          </Box>
        )}

        {/* Library */}
        <Box sx={{
          width: PANEL_SIDE_LIST_WIDTH,
          flexShrink: 0,
          borderRight: `1px solid ${colors.border.default}`,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}>
          <Box sx={{ px: 1.5, py: 1 }}>
            <Typography sx={{ fontFamily: MONO, fontSize: '0.55rem', color: colors.text.dim, letterSpacing: '0.06em' }}>
              MASTERS · {items.length}
            </Typography>
          </Box>
          <Box sx={{ flex: 1, overflow: 'auto', px: 1, pb: 1.5 }}>
            {loading && (
              <Box sx={{ py: 4, textAlign: 'center' }}>
                <CircularProgress size={20} sx={{ color: colors.accent.cyan }} />
              </Box>
            )}
            {!loading && items.length === 0 && (
              <Box sx={{ px: 1, py: 3 }}>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: colors.text.secondary, mb: 1 }}>
                  No masters yet
                </Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: colors.text.dim, lineHeight: 1.55 }}>
                  Drop a finished PDF, Word, or Excel design. We map its variable slots — no markup required.
                </Typography>
              </Box>
            )}
            {items.map((t) => {
              const active = t.id === selectedId;
              const mapping = t.analysisStatus === 'analyzing' || t.analysisStatus === 'pending';
              return (
                <Box
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  sx={{
                    px: 1.25, py: 1, mb: 0.5, borderRadius: 1, cursor: 'pointer',
                    border: `1px solid ${active ? colors.border.accent : 'transparent'}`,
                    bgcolor: active ? alphaColor(colors.accent.cyan, 0.1) : 'transparent',
                    '&:hover': { bgcolor: active ? alphaColor(colors.accent.cyan, 0.12) : colors.bg.hover },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.35 }}>
                    <DescriptionOutlinedIcon sx={{ fontSize: 14, color: colors.text.dim }} />
                    <Typography sx={{
                      fontFamily: MONO, fontSize: '0.7rem', fontWeight: 600,
                      color: colors.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {t.name}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    <Chip size="small" label={formatBadge(t.format)} sx={{ height: 16, fontSize: '0.5rem', fontFamily: MONO }} />
                    <Chip
                      size="small"
                      label={analysisLabel(t)}
                      sx={{
                        height: 16, fontSize: '0.5rem', fontFamily: MONO,
                        bgcolor: mapping
                          ? alphaColor(colors.accent.orange, 0.12)
                          : t.fillable
                            ? alphaColor(colors.accent.green, 0.1)
                            : undefined,
                        color: mapping
                          ? colors.accent.orange
                          : t.fillable
                            ? colors.accent.green
                            : colors.text.dim,
                      }}
                    />
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>

        {/* Detail */}
        <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto', p: { xs: 2, md: 2.5 } }}>
          {!selected && (
            <Box sx={{
              height: '100%', minHeight: 300, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', textAlign: 'center', px: 3,
              border: `1px dashed ${colors.border.default}`, borderRadius: 1.5,
            }}>
              <UploadFileIcon sx={{ fontSize: 28, color: colors.text.dim, mb: 1.25 }} />
              <Typography sx={{ fontFamily: MONO, fontSize: '0.85rem', fontWeight: 700, mb: 0.75, letterSpacing: '0.02em' }}>
                Clone from a design master
              </Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: colors.text.dim, maxWidth: 400, lineHeight: 1.6 }}>
                Upload the PDF or Word/Excel file whose look you want to keep.
                We map variable slots; Generate fills what you have and leaves the rest blank — same design, same format.
              </Typography>
              <Button
                size="small"
                variant="contained"
                sx={{ mt: 2.5, fontFamily: MONO, fontSize: '0.65rem' }}
                onClick={() => fileInputRef.current?.click()}
              >
                Upload master
              </Button>
            </Box>
          )}

          {selected && (
            <Box sx={{ maxWidth: 720, mx: 'auto' }}>
              {/* Title + status */}
              <Box sx={{ mb: 2 }}>
                <TextField
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => { void saveName(); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  fullWidth
                  variant="standard"
                  InputProps={{
                    disableUnderline: true,
                    sx: {
                      fontFamily: MONO,
                      fontSize: '1.05rem',
                      fontWeight: 700,
                      color: colors.text.primary,
                    },
                  }}
                />
                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, mt: 0.5 }}>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: colors.text.dim }}>
                    {formatBadge(selected.format)} · {formatBytes(selected.size)}
                  </Typography>
                  <Chip
                    size="small"
                    label={analyzing ? 'Mapping design…' : selected.fillable ? 'Ready to clone' : 'Reference only'}
                    sx={{
                      height: 18, fontSize: '0.5rem', fontFamily: MONO,
                      bgcolor: analyzing
                        ? alphaColor(colors.accent.orange, 0.12)
                        : selected.fillable
                          ? alphaColor(colors.accent.green, 0.12)
                          : alphaColor(colors.ink, 0.06),
                      color: analyzing
                        ? colors.accent.orange
                        : selected.fillable
                          ? colors.accent.green
                          : colors.text.dim,
                    }}
                  />
                </Box>
                {selected.analysisError && (
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: colors.accent.red, mt: 1 }}>
                    {selected.analysisError}
                  </Typography>
                )}
              </Box>

              {/* Primary actions */}
              <Box sx={{
                display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center',
                mb: 2, pb: 2, borderBottom: `1px solid ${colors.border.subtle}`,
              }}>
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<AutoFixHighIcon sx={{ fontSize: 15 }} />}
                  onClick={() => openFill(selected)}
                  disabled={busy || !canGenerate}
                  sx={{ fontFamily: MONO, fontSize: '0.68rem', px: 1.75 }}
                >
                  Generate from master
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<VisibilityOutlinedIcon sx={{ fontSize: 14 }} />}
                  onClick={openMaster}
                  sx={{ fontFamily: MONO, fontSize: '0.65rem' }}
                >
                  Open master
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => { void rescan(selected.id); }}
                  disabled={busy || analyzing}
                  sx={{ fontFamily: MONO, fontSize: '0.65rem' }}
                >
                  Remap slots
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<ContentCopyOutlinedIcon sx={{ fontSize: 14 }} />}
                  onClick={() => { void copyMention(); }}
                  sx={{ fontFamily: MONO, fontSize: '0.65rem' }}
                >
                  {copiedMention ? 'Copied' : '@mention'}
                </Button>
                <Box sx={{ flex: 1 }} />
                <IconButton
                  size="small"
                  onClick={() => {
                    if (!window.confirm(`Delete master “${selected.name}”?`)) return;
                    void remove(selected.id);
                  }}
                  sx={{ color: colors.accent.red }}
                  title="Delete master"
                >
                  <DeleteOutlineIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Box>

              <Typography sx={{
                fontFamily: MONO, fontSize: '0.58rem', color: colors.text.dim,
                mb: 1.25, lineHeight: 1.5, maxWidth: 560,
              }}>
                Output clones this file’s design and format. Provide any slot values you have — everything else stays blank.
              </Typography>

              <TemplateMasterPreview
                storageId={selected.storageId}
                name={selected.name}
                mimeType={selected.mimeType}
                onOpen={openMaster}
              />

              {/* Variable slots */}
              <Box sx={{ mt: 2.5 }}>
                <Typography sx={{
                  fontFamily: MONO, fontSize: '0.55rem', color: colors.text.dim,
                  letterSpacing: '0.08em', mb: 0.35,
                }}>
                  VARIABLE SLOTS
                </Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.58rem', color: colors.text.dim, mb: 1, lineHeight: 1.45 }}>
                  Regions that change per generated file. Sample text from the master is what we replace.
                </Typography>

                {analyzing && (
                  <Box sx={{
                    display: 'flex', alignItems: 'center', gap: 1, py: 2,
                    color: colors.text.dim,
                  }}>
                    <CircularProgress size={14} sx={{ color: colors.accent.orange }} />
                    <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem' }}>
                      Mapping design and slots…
                    </Typography>
                  </Box>
                )}

                {!analyzing && selected.fields.length === 0 && (
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: colors.text.secondary, py: 1.5, lineHeight: 1.5 }}>
                    {selected.fillable
                      ? 'No slots mapped yet. Remap slots, or ask the agent to inspect this master.'
                      : 'Kept as a reference master. Prefer PDF, Word (.docx), or Excel (.xlsx) for cloning.'}
                  </Typography>
                )}

                {!analyzing && selected.fields.length > 0 && (
                  <Box sx={{
                    px: 1.5, borderRadius: 1,
                    border: `1px solid ${colors.border.default}`,
                    bgcolor: colors.bg.secondary,
                  }}>
                    {selected.fields.map((f) => (
                      <SlotRow key={f.key} field={f} />
                    ))}
                  </Box>
                )}
              </Box>

              {/* Secondary: notes + agent brief */}
              <Box sx={{ mt: 2.5 }}>
                <TextField
                  label="Notes (optional)"
                  value={descriptionDraft}
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                  onBlur={() => { void saveDescription(); }}
                  multiline
                  minRows={2}
                  fullWidth
                  placeholder="What is this master for? Visible to you and the agent."
                  sx={{ mb: 1.5, '& .MuiInputBase-input': { fontFamily: MONO, fontSize: '0.7rem' } }}
                />

                <Box
                  onClick={() => setBriefOpen((o) => !o)}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 0.5,
                    cursor: 'pointer', userSelect: 'none', py: 0.5,
                    '&:hover': { opacity: 0.85 },
                  }}
                >
                  <ExpandMoreIcon sx={{
                    fontSize: 16, color: colors.text.dim,
                    transform: briefOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                    transition: 'transform 0.28s ease',
                  }} />
                  <Typography sx={{
                    fontFamily: MONO, fontSize: '0.55rem', color: colors.text.dim, letterSpacing: '0.08em',
                  }}>
                    AGENT BRIEF
                  </Typography>
                </Box>
                <Collapse in={briefOpen}>
                  <Typography sx={{
                    fontFamily: MONO, fontSize: '0.62rem', color: colors.text.dim,
                    lineHeight: 1.55, whiteSpace: 'pre-wrap', pl: 0.5, pb: 1,
                  }}>
                    {selected.designSummary
                      || 'No brief yet — remap slots after analysis, or describe the master in Notes.'}
                  </Typography>
                  <Typography sx={{
                    fontFamily: MONO, fontSize: '0.55rem', color: colors.text.dim,
                    lineHeight: 1.5, pl: 0.5, pb: 0.5, opacity: 0.85,
                  }}>
                    In chat: @ → Templates, or “Generate from this master with my data.”
                    The agent clones the design; unavailable slots stay blank.
                  </Typography>
                </Collapse>
              </Box>
            </Box>
          )}
        </Box>
      </Box>

      <Dialog
        open={fillOpen}
        onClose={() => setFillOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: colors.bg.secondary,
            border: `1px solid ${colors.border.strong}`,
            borderRadius: 1.5,
          },
        }}
      >
        <DialogTitle sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: `1px solid ${colors.border.default}`, fontFamily: MONO, fontSize: '0.85rem',
        }}>
          Generate from master
          <IconButton size="small" onClick={() => setFillOpen(false)} sx={{ color: colors.text.dim }}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: colors.text.dim, mb: 1.5, lineHeight: 1.5 }}>
            Creates a new {selected ? formatBadge(selected.format) : 'file'} that looks exactly like the master.
            Leave any slot empty to keep it blank in the output.
          </Typography>
          <TextField
            label="Output filename"
            value={outputName}
            onChange={(e) => setOutputName(e.target.value)}
            fullWidth
            size="small"
            sx={{ mb: 1.5, '& .MuiInputBase-input': { fontFamily: MONO, fontSize: '0.7rem' } }}
          />
          {(selected?.fields ?? []).map((f) => (
            <TextField
              key={f.key}
              label={slotTitle(f)}
              helperText={
                slotSample(f)
                  ? `Replaces sample in master: “${slotSample(f)}”`
                  : f.context
                    ? `Near: ${f.context}`
                    : 'Optional — leave blank to keep empty'
              }
              value={fillValues[f.key] ?? ''}
              placeholder={f.example || slotSample(f) || 'Leave blank if unknown'}
              onChange={(e) => setFillValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              fullWidth
              size="small"
              sx={{ mb: 1.25, '& .MuiInputBase-input': { fontFamily: MONO, fontSize: '0.7rem' } }}
            />
          ))}
          {(selected?.fields.length ?? 0) === 0 && (
            <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: colors.accent.orange }}>
              No slots mapped yet. Remap slots, or ask the agent to inspect and generate with your data.
            </Typography>
          )}
          {blankSlots.length > 0 && (selected?.fields.length ?? 0) > 0 && (
            <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: colors.text.dim, mt: 0.5 }}>
              Will stay blank: {blankSlots.join(', ')}
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 2, py: 1.5, borderTop: `1px solid ${colors.border.default}` }}>
          <Button onClick={() => setFillOpen(false)} sx={{ fontFamily: MONO, fontSize: '0.65rem' }}>Cancel</Button>
          <Button
            variant="contained"
            disabled={busy || !selected?.fillable}
            onClick={() => { void submitFill(); }}
            sx={{ fontFamily: MONO, fontSize: '0.65rem' }}
          >
            {busy ? 'Cloning…' : 'Clone & generate'}
          </Button>
        </DialogActions>
      </Dialog>

      <FileViewerModal
        open={!!viewer}
        onClose={() => setViewer(null)}
        id={viewer?.id ?? ''}
        name={viewer?.name ?? 'File'}
        mimeType={viewer?.mimeType}
      />
    </Box>
  );
}
