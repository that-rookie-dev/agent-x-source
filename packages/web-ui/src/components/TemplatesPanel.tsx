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
import type { DocumentTemplate } from '@agentx/shared';
import { colors, MONO, alphaColor, PANEL_SIDE_LIST_WIDTH } from '../theme';
import { PanelHeader } from './PanelHeader';
import { FileViewerModal } from './FileViewerModal';
import { useTemplates } from '../hooks/useTemplates';
import { formatTemplateMentionToken } from '../chat/mention-tokens';

const ACCEPTED = '.pdf,.docx,.doc,.xlsx,.pptx';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatBadge(format: string): string {
  return format.toUpperCase();
}

export function TemplatesPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const {
    items, loading, error, busy, refresh, upload, update, rescan, fill, remove, setError,
  } = useTemplates();  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [fillOpen, setFillOpen] = useState(false);
  const [fillValues, setFillValues] = useState<Record<string, string>>({});
  const [outputName, setOutputName] = useState('');
  const [copiedMention, setCopiedMention] = useState(false);
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
  }, [selected?.id, selected?.name, selected?.description]);

  const missingFillFields = useMemo(() => {
    if (!selected) return [];
    return selected.fields
      .filter((f) => f.required !== false)
      .map((f) => f.key)
      .filter((key) => !(fillValues[key] ?? '').trim());
  }, [selected, fillValues]);

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
    setOutputName(`${t.name.replace(/\.[^.]+$/, '')}-filled.${t.format === 'xlsx' ? 'xlsx' : 'docx'}`);
    setFillOpen(true);
  };

  const submitFill = async () => {
    if (!selected) return;
    try {
      const result = await fill(selected.id, fillValues, outputName || undefined);
      setFillOpen(false);
      if (result.missingFields.length > 0) {
        setError(`Generated with blank slots: ${result.missingFields.join(', ')}`);
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
        Upload
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
          subtitle="Upload a design master — we clone its look with your data"
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
          <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: colors.text.dim, letterSpacing: '0.04em' }}>
            Upload a PDF / Word / Excel design master. Outputs keep the same look and format.
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
              Drop template files (.pdf / .docx / .xlsx)
            </Typography>
          </Box>
        )}

        {/* List */}
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
              LIBRARY · {items.length}
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
                  No templates yet
                </Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: colors.text.dim, lineHeight: 1.5 }}>
                  Upload any PDF, Word, or Excel design master as-is. We learn its layout and content slots — no special markup needed.
                </Typography>
              </Box>
            )}
            {items.map((t) => {
              const active = t.id === selectedId;
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
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
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
                      label={
                        t.analysisStatus === 'analyzing' || t.analysisStatus === 'pending'
                          ? 'analyzing…'
                          : t.analysisStatus === 'failed'
                            ? 'analysis failed'
                            : t.fillable
                              ? `${t.fields.length} slots`
                              : 'reference'
                      }
                      sx={{
                        height: 16, fontSize: '0.5rem', fontFamily: MONO,
                        bgcolor: t.analysisStatus === 'analyzing' || t.analysisStatus === 'pending'
                          ? alphaColor(colors.accent.orange, 0.12)
                          : t.fillable
                            ? alphaColor(colors.accent.cyan, 0.12)
                            : undefined,
                      }}
                    />
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>

        {/* Detail */}
        <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto', p: 2.5 }}>
          {!selected && (
            <Box sx={{
              height: '100%', minHeight: 280, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', textAlign: 'center', px: 3,
              border: `1px dashed ${colors.border.default}`, borderRadius: 1.5,
            }}>
              <UploadFileIcon sx={{ fontSize: 28, color: colors.text.dim, mb: 1 }} />
              <Typography sx={{ fontFamily: MONO, fontSize: '0.8rem', fontWeight: 600, mb: 0.5 }}>
                Template Library
              </Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: colors.text.dim, maxWidth: 360, lineHeight: 1.55 }}>
                Drop the PDF or Word/Excel design you already have. We map its content slots automatically.
                In chat, mention with @ → Templates, or ask the agent to generate a copy from your data.
              </Typography>
              <Button
                size="small"
                sx={{ mt: 2, fontFamily: MONO, fontSize: '0.65rem' }}
                onClick={() => fileInputRef.current?.click()}
              >
                Upload template
              </Button>
            </Box>
          )}

          {selected && (
            <Box sx={{ maxWidth: 640 }}>
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
                    fontSize: '1rem',
                    fontWeight: 700,
                    color: colors.text.primary,
                  },
                }}
                sx={{ mb: 0.25 }}
              />
              <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: colors.text.dim, mb: 2 }}>
                {formatBadge(selected.format)} · {formatBytes(selected.size)}
                {selected.analysisStatus === 'analyzing' || selected.analysisStatus === 'pending'
                  ? ' · analyzing design…'
                  : selected.fillable
                    ? ` · ${selected.fields.length} content slot${selected.fields.length === 1 ? '' : 's'}`
                    : ' · reference file'}
              </Typography>
              {selected.analysisError && (
                <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: colors.accent.red, mb: 1.5 }}>
                  {selected.analysisError}
                </Typography>
              )}

              <TextField
                label="Description"
                value={descriptionDraft}
                onChange={(e) => setDescriptionDraft(e.target.value)}
                onBlur={() => { void saveDescription(); }}
                multiline
                minRows={2}
                fullWidth
                placeholder="What is this template for? (shown to you and the agent)"
                sx={{ mb: 2, '& .MuiInputBase-input': { fontFamily: MONO, fontSize: '0.7rem' } }}
              />

              {selected.designSummary && (
                <>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: colors.text.dim, letterSpacing: '0.06em', mb: 0.75 }}>
                    DESIGN
                  </Typography>
                  <Typography sx={{
                    fontFamily: MONO, fontSize: '0.65rem', color: colors.text.secondary,
                    mb: 2, lineHeight: 1.55, whiteSpace: 'pre-wrap',
                  }}>
                    {selected.designSummary}
                  </Typography>
                </>
              )}

              <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: colors.text.dim, letterSpacing: '0.06em', mb: 0.75 }}>
                CONTENT SLOTS
              </Typography>
              {selected.fields.length === 0 ? (
                <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: colors.text.secondary, mb: 2, lineHeight: 1.5 }}>
                  {selected.analysisStatus === 'analyzing' || selected.analysisStatus === 'pending'
                    ? 'Learning the document design and content slots…'
                    : selected.fillable
                      ? 'No content slots mapped yet. Try Re-analyze design, or ask the agent to inspect this template.'
                      : 'This format is kept as a reference master. Prefer PDF, Word (.docx), or Excel (.xlsx) for generation.'}
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 2 }}>
                  {selected.fields.map((f) => (
                    <Chip
                      key={f.key}
                      size="small"
                      title={f.sampleValue ? `${f.key} · sample: ${f.sampleValue}` : f.key}
                      label={f.label || f.key}
                      sx={{ fontFamily: MONO, fontSize: '0.55rem', height: 22 }}
                    />
                  ))}
                </Box>
              )}

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<VisibilityOutlinedIcon sx={{ fontSize: 14 }} />}
                  onClick={() => setViewer({ id: selected.storageId, name: selected.name, mimeType: selected.mimeType })}
                  sx={{ fontFamily: MONO, fontSize: '0.65rem' }}
                >
                  Open
                </Button>
                {selected.fillable && (
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<AutoFixHighIcon sx={{ fontSize: 14 }} />}
                    onClick={() => openFill(selected)}
                    disabled={busy || selected.analysisStatus === 'analyzing' || selected.analysisStatus === 'pending'}
                    sx={{ fontFamily: MONO, fontSize: '0.65rem' }}
                  >
                    Generate…
                  </Button>
                )}
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => { void rescan(selected.id); }}
                  disabled={busy || selected.analysisStatus === 'analyzing' || selected.analysisStatus === 'pending'}
                  sx={{ fontFamily: MONO, fontSize: '0.65rem' }}
                >
                  Re-analyze design
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<ContentCopyOutlinedIcon sx={{ fontSize: 14 }} />}
                  onClick={() => { void copyMention(); }}
                  sx={{ fontFamily: MONO, fontSize: '0.65rem' }}
                >
                  {copiedMention ? 'Copied' : 'Copy @mention'}
                </Button>
                <Button
                  size="small"
                  color="error"
                  startIcon={<DeleteOutlineIcon sx={{ fontSize: 14 }} />}
                  onClick={() => {
                    if (!window.confirm(`Delete template “${selected.name}”?`)) return;
                    void remove(selected.id);
                  }}
                  sx={{ fontFamily: MONO, fontSize: '0.65rem', ml: 'auto' }}
                >
                  Delete
                </Button>
              </Box>

              <Box sx={{
                mt: 3, p: 1.5, borderRadius: 1,
                border: `1px solid ${colors.border.default}`,
                bgcolor: colors.bg.secondary,
              }}>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: colors.text.dim, mb: 0.5 }}>
                  IN CHAT
                </Typography>
                <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: colors.text.secondary, lineHeight: 1.5 }}>
                  Type @ → Templates to pin this file, or ask: “Generate an Invoice from this template with my data.”
                  The agent clones the design with whatever data is available — missing slots stay blank.
                </Typography>
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
          Generate from template
          <IconButton size="small" onClick={() => setFillOpen(false)} sx={{ color: colors.text.dim }}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: colors.text.dim, mb: 1.5 }}>
            Builds a new file that looks exactly like the master. Leave any slot empty to keep it blank.
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
              label={f.label || f.key}
              helperText={
                f.sampleValue
                  ? `Sample in master: ${f.sampleValue}`
                  : f.context
                    ? `Near: ${f.context}`
                    : f.key
              }
              value={fillValues[f.key] ?? ''}
              placeholder={f.example || 'Leave blank if unknown'}
              onChange={(e) => setFillValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              fullWidth
              size="small"
              sx={{ mb: 1.25, '& .MuiInputBase-input': { fontFamily: MONO, fontSize: '0.7rem' } }}
            />
          ))}
          {(selected?.fields.length ?? 0) === 0 && (
            <Typography sx={{ fontFamily: MONO, fontSize: '0.65rem', color: colors.accent.orange }}>
              No content slots mapped yet. Re-analyze design, or ask the agent to inspect and generate with your data.
            </Typography>
          )}
          {missingFillFields.length > 0 && (selected?.fields.length ?? 0) > 0 && (
            <Typography sx={{ fontFamily: MONO, fontSize: '0.6rem', color: colors.accent.orange, mt: 0.5 }}>
              Will stay blank: {missingFillFields.join(', ')}
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
            {busy ? 'Generating…' : 'Generate file'}
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
