/**
 * Embedding model download step for the setup wizard.
 *
 * Shows a sci-fi themed progress UI with progress for the RAM-tier model only
 * (via /neural-cortex/embeddings/*) and rotating status messages.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { embeddingModels, type EmbeddingDownloadErrorKind, type EmbeddingModelProgress, type EmbeddingModelStatus } from '../api';
import { colors, alphaColor } from '../theme';

// ── Sci-fi status messages (rotate every 3% progress, non-repeating) ────────
const STATUS_MESSAGES = [
  'Initializing neural core matrices...',
  'Calibrating synaptic weight tensors...',
  'Allocating embedding vector space...',
  'Establishing HuggingFace uplink...',
  'Streaming ONNX runtime binaries...',
  'Decrypting model weight checksums...',
  'Loading multilingual token vocabularies...',
  'Optimizing inference graph topology...',
  'Synchronizing attention head parameters...',
  'Compiling INT8 quantization tables...',
  'Mapping semantic latent dimensions...',
  'Aligning cosine similarity projections...',
  'Buffering transformer layer caches...',
  'Validating neural pathway integrity...',
  'Activating cross-attention mechanisms...',
  'Finalizing embedding space topology...',
  'Warming up inference session pools...',
  'Verifying model signature authenticity...',
  'Mounting quantized weight matrices...',
  'Engaging neural co-processor link...',
  'Stabilizing gradient flow channels...',
  'Resolving token embedding conflicts...',
  'Harmonizing multilingual feature maps...',
  'Consolidating knowledge graph anchors...',
  'Pressurizing semantic memory banks...',
  'Charging neural capacitor arrays...',
  'Locking embedding coordinate frames...',
  'Deploying inference runtime shells...',
  'Calibrating vector distance metrics...',
  'Sealing neural core housing...',
  'Systems nominal. Awaiting final verification...',
  'Neural core online. Standing by...',
];

export interface ModelProgressState {
  id: string;
  displayName: string;
  status: 'not_started' | 'pending' | 'downloading' | 'complete' | 'error';
  downloadedMB: number;
  totalMB: number;
  percentage: number;
  error?: string;
  errorKind?: EmbeddingDownloadErrorKind;
  /** Live status line (e.g. preparing the bundled Python environment). */
  detail?: string;
}

function mapStatusModels(models: EmbeddingModelStatus[]): ModelProgressState[] {
  return models.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    status: m.downloaded
      ? 'complete'
      : m.downloadStatus === 'not_started'
        ? 'pending'
        : m.downloadStatus,
    downloadedMB: m.sizeOnDiskMB,
    totalMB: m.approxSizeMB,
    percentage: m.percentage ?? (m.downloaded ? 100 : 0),
    errorKind: m.errorKind,
  }));
}

function mapProgressModels(models: EmbeddingModelProgress[]): ModelProgressState[] {
  return models.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    status: m.status,
    downloadedMB: m.downloadedMB,
    totalMB: m.totalMB,
    percentage: m.percentage,
    error: m.error,
    errorKind: m.errorKind,
  }));
}

interface EmbeddingModelDownloadProps {
  /** @deprecated Prefer onReadyChange — footer actions moved to wizard bottom nav. */
  onComplete?: () => void;
  /** @deprecated Prefer wizard bottom-nav Skip. */
  onSkip?: () => void;
  /** Fired when download reaches a terminal ready/error state. */
  onReadyChange?: (ready: boolean) => void;
  /**
   * Fired when the download fails because the model is no longer available
   * from the HuggingFace endpoint (404 / gated / network-unreachable). The
   * wizard uses this to offer a "Continue without Neural Core" path and
   * silently leave the cortex in degraded mode.
   */
  onAvailabilityErrorChange?: (hasAvailabilityError: boolean) => void;
  /** Optional tier notice shown inside the Initializing Neural Core card. */
  banner?: { headline: string; body: string };
  /** Optional extra models to include in the same progress (e.g. voice assets). */
  extraModels?: ModelProgressState[];
}

export function EmbeddingModelDownload({ onReadyChange, onAvailabilityErrorChange, banner, extraModels = [] }: EmbeddingModelDownloadProps) {
  const [models, setModels] = useState<ModelProgressState[]>([]);
  const [allComplete, setAllComplete] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [hasUnavailableError, setHasUnavailableError] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [statusMessage, setStatusMessage] = useState(STATUS_MESSAGES[0]!);
  const usedMessageIndices = useRef<Set<number>>(new Set([0]));

  // ── Start download + SSE progress stream ─────────────────────────────────
  const startDownload = useCallback(async () => {
    setRetrying(true);
    try {
      try {
        const status = await embeddingModels.status();
        setModels(mapStatusModels(status.models));
        if (status.allDownloaded) {
          setAllComplete(true);
          setHasError(false);
          setHasUnavailableError(false);
          return;
        }
      } catch {}

      // Start the download for the RAM-recommended tier model(s).
      try {
        await embeddingModels.download({ force: true });
      } catch {
        // Download may already be in progress — that's fine.
      }

      // Open SSE stream.
      const cleanup = embeddingModels.progressStream((data) => {
        if (data.type === 'progress' && data.models) {
          setModels(mapProgressModels(data.models));
          setAllComplete(!!data.allComplete);
          setHasError(!!data.hasError);
          setHasUnavailableError(!!data.hasUnavailableError);
        }
        if (data.type === 'done' && data.hasError) {
          // All retries exhausted — keep the page as-is so the user can read
          // the error message. The wizard bottom-nav offers the appropriate
          // continue/retry path based on errorKind.
        }
      });

      return cleanup;
    } finally {
      setRetrying(false);
    }
  }, []);

  // Auto-start on mount.
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void (async () => { cleanup = await startDownload(); })();
    return () => { cleanup?.(); };
  }, [startDownload]);

  const allExtrasComplete = extraModels.length === 0 || extraModels.every((m) => m.status === 'complete');
  const combinedAllComplete = allComplete && allExtrasComplete;
  const combinedHasError = hasError || extraModels.some((m) => m.status === 'error');

  useEffect(() => {
    onReadyChange?.(combinedAllComplete && !combinedHasError);
  }, [combinedAllComplete, combinedHasError, onReadyChange]);

  useEffect(() => {
    onAvailabilityErrorChange?.(hasUnavailableError && !allComplete);
  }, [hasUnavailableError, allComplete, onAvailabilityErrorChange]);

  const handleRetry = useCallback(() => {
    // Reset terminal state before re-starting so the UI reflects the retry.
    setHasError(false);
    setHasUnavailableError(false);
    setAllComplete(false);
    void startDownload();
  }, [startDownload]);

  // ── Overall percentage = total downloaded MB / total downloadable MB ──────
  const effectiveModels = useMemo(() => [...models, ...extraModels], [models, extraModels]);
  const totalDownloadedMB = effectiveModels.reduce((sum, m) => sum + m.downloadedMB, 0);
  const totalDownloadableMB = effectiveModels.reduce((sum, m) => sum + m.totalMB, 0);
  const overallPercentage = totalDownloadableMB > 0 ? Math.round((totalDownloadedMB / totalDownloadableMB) * 100) : 0;
  const lastMessageBucket = useRef(0);

  useEffect(() => {
    const bucket = Math.floor(overallPercentage / 3);
    if (bucket !== lastMessageBucket.current && bucket > 0) {
      lastMessageBucket.current = bucket;
      // Pick a message we haven't used yet.
      const available = STATUS_MESSAGES.map((_, i) => i).filter((i) => !usedMessageIndices.current.has(i));
      if (available.length === 0) {
        // All used — reset, but keep the current one excluded.
        usedMessageIndices.current = new Set([usedMessageIndices.current.size > 0 ? Array.from(usedMessageIndices.current).pop()! : 0]);
      }
      const remaining = STATUS_MESSAGES.map((_, i) => i).filter((i) => !usedMessageIndices.current.has(i));
      if (remaining.length > 0) {
        const idx = remaining[Math.floor(Math.random() * remaining.length)]!;
        usedMessageIndices.current.add(idx);
        setStatusMessage(STATUS_MESSAGES[idx]!);
      }
    }
  }, [overallPercentage]);

  return (
    <Box sx={{ position: 'relative', width: '100%', minHeight: 420, overflow: 'hidden', borderRadius: 1, bgcolor: colors.bg.primary, border: `1px solid ${colors.border.default}` }}>
      {/* Content */}
      <Box sx={{ position: 'relative', zIndex: 3, p: 4, display: 'flex', flexDirection: 'column', gap: 3, minHeight: 420, justifyContent: 'center' }}>
        {/* Header */}
        <Box sx={{ textAlign: 'center', mb: 1 }}>
          <Typography sx={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '0.7rem',
            letterSpacing: 4,
            color: colors.accent.blue,
            textTransform: 'uppercase',
            mb: 1,
            opacity: 0.7,
          }}>
            ━━━ NEURAL CORE INITIALIZATION ━━━
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 300, letterSpacing: 1, color: colors.text.primary }}>
            Initializing Neural Core
          </Typography>
        </Box>

        {banner && (
          <Box sx={{
            maxWidth: 560,
            mx: 'auto',
            width: '100%',
            p: 2,
            borderRadius: 1,
            border: `1px solid ${alphaColor(colors.accent.cyan, 0.35)}`,
            borderLeft: `3px solid ${colors.accent.cyan}`,
            bgcolor: alphaColor(colors.accent.cyan, 0.06),
          }}>
            <Typography sx={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: '0.52rem',
              letterSpacing: '2px',
              color: colors.accent.cyan,
              textTransform: 'uppercase',
              fontWeight: 700,
              mb: 1,
            }}>
              {banner.headline}
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: colors.text.secondary, lineHeight: 1.6 }}>
              {banner.body}
            </Typography>
          </Box>
        )}

        {/* Overall progress indicator */}
        <Box sx={{ textAlign: 'center', mb: 1 }}>
          <Typography sx={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '2.5rem',
            fontWeight: 700,
            color: combinedAllComplete ? colors.accent.green : combinedHasError ? (hasUnavailableError ? colors.accent.orange : colors.accent.red) : colors.accent.blue,
            transition: 'all 0.3s',
            lineHeight: 1,
          }}>
            {combinedAllComplete ? '100' : combinedHasError ? (hasUnavailableError ? 'PAUSED' : 'ERR') : overallPercentage}%
          </Typography>
        </Box>

        {/* Status message */}
        <Box sx={{
          textAlign: 'center',
          minHeight: 24,
          px: 2,
        }}>
          <Typography sx={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '0.72rem',
            color: combinedAllComplete ? colors.accent.green : combinedHasError ? (hasUnavailableError ? colors.accent.orange : colors.accent.red) : colors.accent.blue,
            opacity: 0.85,
            letterSpacing: 0.5,
            transition: 'opacity 0.3s',
          }}>
            {combinedHasError
              ? (hasUnavailableError
                ? '◆ MODEL UNAVAILABLE FROM ENDPOINT — NEURAL CORE PAUSED · CONTINUE WHEN READY'
                : '◆ DOWNLOAD FAILED — RESOLVE AND RETRY')
              : combinedAllComplete ? '◆ NEURAL CORE ONLINE — ALL SYSTEMS NOMINAL' : `◆ ${statusMessage}`}
          </Typography>
        </Box>

        {/* Per-model progress bars */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, maxWidth: 560, mx: 'auto', width: '100%' }}>
          {effectiveModels.map((model) => (
            <ModelProgressBar key={model.id} model={model} />
          ))}
        </Box>

        {/* Error details */}
        {combinedHasError && (
          <Box sx={{ maxWidth: 560, mx: 'auto', width: '100%' }}>
            {effectiveModels.filter((m) => m.status === 'error').map((m) => (
              <Typography key={m.id} sx={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: '0.65rem',
                color: m.errorKind === 'unavailable' ? colors.accent.orange : colors.accent.red,
                opacity: 0.8,
              }}>
                ✗ {m.displayName}: {m.error || 'Unknown error'}
              </Typography>
            ))}
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
              <Button
                onClick={handleRetry}
                disabled={retrying}
                sx={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: '0.7rem',
                  letterSpacing: 1,
                  color: colors.accent.blue,
                  border: `1px solid ${alphaColor(colors.accent.blue, 0.5)}`,
                  borderRadius: 1,
                  px: 3,
                  py: 0.8,
                  textTransform: 'uppercase',
                  '&:hover': { bgcolor: alphaColor(colors.accent.blue, 0.08), borderColor: colors.accent.blue },
                  '&:disabled': { opacity: 0.5 },
                }}
              >
                {retrying ? 'Retrying…' : '↻ Retry download'}
              </Button>
            </Box>
          </Box>
        )}

        {/* Footer info */}
        <Box sx={{ textAlign: 'center', mt: 1 }}>
          <Typography sx={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '0.6rem',
            color: colors.text.dim,
            opacity: 0.5,
            letterSpacing: 1,
          }}>
            {combinedAllComplete
              ? '◆ MODELS CACHED LOCALLY · OFFLINE CAPABILITY ENABLED'
              : '◆ DOWNLOADING TO ~/.local/share/agentx/models · NO DATA LEAVES YOUR MACHINE AFTER DOWNLOAD'}
          </Typography>
        </Box>

      </Box>
    </Box>
  );
}

// ── Per-model progress bar ───────────────────────────────────────────────────

function ModelProgressBar({ model }: { model: ModelProgressState }) {
  const isComplete = model.status === 'complete';
  const isError = model.status === 'error';
  const isDownloading = model.status === 'downloading';

  const barColor = isComplete ? colors.accent.green : isError ? colors.accent.red : colors.accent.blue;
  const statusIcon = isComplete ? '✓' : isError ? '✗' : isDownloading ? '▸' : '○';
  const statusLabel = isComplete ? 'COMPLETE' : isError ? 'FAILED' : isDownloading ? 'DOWNLOADING' : 'PENDING';

  return (
    <Box>
      {/* Model header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.8 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '0.75rem',
            fontWeight: 600,
            color: isComplete ? colors.accent.green : isError ? colors.accent.red : colors.text.primary,
          }}>
            {statusIcon} {model.displayName}
          </Typography>
        </Box>
        <Typography sx={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: '0.6rem',
          color: barColor,
          opacity: 0.7,
          letterSpacing: 1,
        }}>
          {statusLabel}
        </Typography>
      </Box>

      {/* Progress bar */}
      <Box sx={{
        position: 'relative',
        height: 8,
        bgcolor: alphaColor(colors.ink, 0.05),
        borderRadius: 1,
        overflow: 'hidden',
        border: `1px solid ${colors.border.subtle}`,
      }}>
        <Box sx={{
          height: '100%',
          width: `${model.percentage}%`,
          background: `linear-gradient(90deg, ${alphaColor(barColor, '40')}, ${barColor})`,
          borderRadius: 1,
          transition: 'width 0.5s ease-out',
        }} />
        {/* Animated shimmer overlay while downloading */}
        {isDownloading && (
          <Box sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            height: '100%',
            width: '30%',
            background: `linear-gradient(90deg, transparent, ${alphaColor(barColor, '30')}, transparent)`,
            animation: 'shimmer 1.5s infinite linear',
            '@keyframes shimmer': {
              '0%': { transform: 'translateX(-100%)' },
              '100%': { transform: 'translateX(400%)' },
            },
          }} />
        )}
      </Box>

      {/* Size + percentage */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
        <Typography sx={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: '0.62rem',
          color: colors.text.dim,
        }}>
          {model.detail && isDownloading
            ? model.detail
            : `${model.downloadedMB.toFixed(1)} / ${model.totalMB.toFixed(0)} MB`}
        </Typography>
        <Typography sx={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: '0.62rem',
          color: barColor,
          fontWeight: 600,
        }}>
          {model.percentage}%
        </Typography>
      </Box>
    </Box>
  );
}
