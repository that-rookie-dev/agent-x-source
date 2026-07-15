/**
 * Embedding model download step for the setup wizard.
 *
 * Shows a sci-fi themed progress UI with:
 *   - Two progress bars (BGE-M3 + MiniLM) with downloaded/total MB + percentage
 *   - Rotating sci-fi status messages that change every 3% (non-repeating)
 *   - Animated starfield background + scanning line effect
 *   - Proceed button only enables when both models are complete
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { embeddingModels, config as configApi } from '../api';
import { colors, alphaColor, resolveColor } from '../theme';
import { useNeuralBrainSupported } from '../hooks/useSystemCapabilities';

/** Convert a resolved hex color to "r, g, b" channels for canvas rgba() templates. */
function hexToRgbChannels(hex: string): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

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

interface ModelProgressState {
  id: string;
  displayName: string;
  status: 'not_started' | 'pending' | 'downloading' | 'complete' | 'error';
  downloadedMB: number;
  totalMB: number;
  percentage: number;
  error?: string;
}

interface EmbeddingModelDownloadProps {
  onComplete: () => void;
  /** When true, bypass the neuralBrainSupported check (user opted in on low-RAM). */
  forceEnabled?: boolean;
}

export function EmbeddingModelDownload({ onComplete, forceEnabled }: EmbeddingModelDownloadProps) {
  const neuralBrainSupported = useNeuralBrainSupported();
  const enabled = neuralBrainSupported || forceEnabled === true;
  const [models, setModels] = useState<ModelProgressState[]>([
    { id: 'bge-m3', displayName: 'BGE-M3 Neural Embedding Engine', status: 'not_started', downloadedMB: 0, totalMB: 600, percentage: 0 },
    { id: 'minilm', displayName: 'MiniLM Lightweight Embedder', status: 'not_started', downloadedMB: 0, totalMB: 55, percentage: 0 },
  ]);
  const [allComplete, setAllComplete] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [statusMessage, setStatusMessage] = useState(STATUS_MESSAGES[0]!);
  const usedMessageIndices = useRef<Set<number>>(new Set([0]));
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Low-RAM machines skip embedding downloads entirely.
  useEffect(() => {
    if (enabled) return;
    void (async () => {
      try { await configApi.update({ neuralBrain: false }); } catch { /* best effort */ }
      onComplete();
    })();
  }, [enabled, onComplete]);

  // ── Starfield animation ──────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const starRgb = hexToRgbChannels(resolveColor(colors.accent.blue));
    const fadeRgb = hexToRgbChannels(resolveColor(colors.bg.primary));
    const stars: Array<{ x: number; y: number; z: number; size: number; speed: number; opacity: number }> = [];
    const STAR_COUNT = 120;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < STAR_COUNT; i++) {
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        z: Math.random(),
        size: Math.random() * 1.5 + 0.3,
        speed: Math.random() * 0.15 + 0.02,
        opacity: Math.random() * 0.6 + 0.2,
      });
    }

    const animate = () => {
      ctx.fillStyle = `rgba(${fadeRgb}, 0.15)`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (const star of stars) {
        star.y += star.speed;
        if (star.y > canvas.height) {
          star.y = 0;
          star.x = Math.random() * canvas.width;
        }
        const twinkle = 0.7 + 0.3 * Math.sin(Date.now() * 0.001 + star.x);
        ctx.fillStyle = `rgba(${starRgb}, ${star.opacity * twinkle})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [enabled]);

  // ── Start download + SSE progress stream ─────────────────────────────────
  const startDownload = useCallback(async () => {
    if (!enabled) return;
    // Check if already downloaded.
    try {
      const status = await embeddingModels.status();
      if (status.allDownloaded) {
        setModels((prev) => prev.map((m) => {
          const s = status.models.find((sm) => sm.id === m.id);
          return s ? { ...m, status: 'complete' as const, percentage: 100, downloadedMB: s.sizeOnDiskMB, totalMB: s.approxSizeMB } : m;
        }));
        setAllComplete(true);
        return;
      }
    } catch {}

    // Start the download. Pass force=true when the user opted in on a low-RAM
    // system so the server bypasses its 16 GB hardware check.
    try {
      await embeddingModels.download({ force: forceEnabled === true });
    } catch {
      // Download may already be in progress — that's fine.
    }

    // Open SSE stream.
    const cleanup = embeddingModels.progressStream((data) => {
      if (data.type === 'progress' && data.models) {
        setModels(data.models.map((m) => ({
          id: m.id,
          displayName: m.displayName,
          status: m.status,
          downloadedMB: m.downloadedMB,
          totalMB: m.totalMB,
          percentage: m.percentage,
          error: m.error,
        })));
        setAllComplete(!!data.allComplete);
        setHasError(!!data.hasError);
      }
      if (data.type === 'done' && data.hasError) {
        // All retries exhausted — keep the page as-is so the user can read
        // the error message. They can skip manually via the button below.
      }
    });

    return cleanup;
  }, [enabled, forceEnabled]);

  /** Disable the neural brain module via config API, then proceed. */
  const skipNeuralBrain = useCallback(async () => {
    try {
      await configApi.update({ neuralBrain: false });
    } catch { /* best effort — proceed anyway */ }
    onComplete();
  }, [onComplete]);

  // Auto-start on mount.
  useEffect(() => {
    if (!enabled) return;
    let cleanup: (() => void) | undefined;
    void (async () => { cleanup = await startDownload(); })();
    return () => { cleanup?.(); };
  }, [startDownload, enabled]);

  // ── Overall percentage = total downloaded MB / total downloadable MB ──────
  const totalDownloadedMB = models.reduce((sum, m) => sum + m.downloadedMB, 0);
  const totalDownloadableMB = models.reduce((sum, m) => sum + m.totalMB, 0);
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

  if (!enabled) {
    return (
      <Box sx={{ p: 3, border: `1px solid ${colors.border.default}`, borderRadius: 1, bgcolor: colors.bg.secondary }}>
        <Typography variant="body2" sx={{ color: colors.text.secondary, mb: 1 }}>
          Neural Core requires at least 16GB of system RAM. Skipping embedding model download on this machine.
        </Typography>
        <Typography variant="caption" sx={{ color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
          RAG Studio and the neural brain stay disabled. Cloud models and chat remain available.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ position: 'relative', width: '100%', minHeight: 420, overflow: 'hidden', borderRadius: 1, bgcolor: colors.bg.primary, border: `1px solid ${colors.border.default}` }}>
      {/* Starfield canvas background */}
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.6 }} />

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
            Downloading Embedding Models
          </Typography>
        </Box>

        {/* Overall progress indicator */}
        <Box sx={{ textAlign: 'center', mb: 1 }}>
          <Typography sx={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: '2.5rem',
            fontWeight: 700,
            color: allComplete ? colors.accent.green : hasError ? colors.accent.red : colors.accent.blue,
            transition: 'all 0.3s',
            lineHeight: 1,
          }}>
            {allComplete ? '100' : hasError ? 'ERR' : overallPercentage}%
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
            color: allComplete ? colors.accent.green : hasError ? colors.accent.red : colors.accent.blue,
            opacity: 0.85,
            letterSpacing: 0.5,
            transition: 'opacity 0.3s',
          }}>
            {hasError ? '◆ NEURAL CORE BYPASS — DISABLING NEURAL BRAIN, PROCEEDING WITHOUT IT' : allComplete ? '◆ NEURAL CORE ONLINE — ALL SYSTEMS NOMINAL' : `◆ ${statusMessage}`}
          </Typography>
        </Box>

        {/* Per-model progress bars */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, maxWidth: 560, mx: 'auto', width: '100%' }}>
          {models.map((model) => (
            <ModelProgressBar key={model.id} model={model} />
          ))}
        </Box>

        {/* Error details */}
        {hasError && (
          <Box sx={{ maxWidth: 560, mx: 'auto', width: '100%' }}>
            {models.filter((m) => m.status === 'error').map((m) => (
              <Typography key={m.id} sx={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: '0.65rem',
                color: colors.accent.red,
                opacity: 0.8,
              }}>
                ✗ {m.displayName}: {m.error || 'Unknown error'}
              </Typography>
            ))}
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
            {allComplete
              ? '◆ MODELS CACHED LOCALLY · OFFLINE CAPABILITY ENABLED'
              : '◆ DOWNLOADING TO ~/.local/share/agentx/models · NO DATA LEAVES YOUR MACHINE AFTER DOWNLOAD'}
          </Typography>
        </Box>

        {/* Proceed / Skip button */}
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2, gap: 1.5 }}>
          {hasError && (
            <Button
              onClick={() => { void skipNeuralBrain(); }}
              sx={{
                color: colors.text.dim,
                fontFamily: '"JetBrains Mono", monospace"',
                fontSize: '0.72rem',
                letterSpacing: 0.5,
                textTransform: 'none',
              }}
            >
              Skip Neural Core →
            </Button>
          )}
          <Button
            variant="contained"
            onClick={onComplete}
            disabled={!allComplete || hasError}
            sx={{
              bgcolor: allComplete ? colors.accent.green : colors.bg.tertiary,
              color: allComplete ? colors.bg.primary : colors.text.dim,
              fontWeight: 700,
              px: 4,
              py: 1,
              fontFamily: '"JetBrains Mono", monospace"',
              fontSize: '0.8rem',
              letterSpacing: 1,
              textTransform: 'uppercase',
              borderRadius: 1,
              boxShadow: 'none',
              transition: 'all 0.3s',
              '&:hover': allComplete ? {
                bgcolor: colors.accent.green,
                boxShadow: 'none',
              } : {},
            }}
          >
            {allComplete ? '◆ Proceed to Callsign →' : hasError ? '◆ Download Failed' : '◆ Downloading...'}
          </Button>
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
          {model.downloadedMB.toFixed(1)} / {model.totalMB.toFixed(0)} MB
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
