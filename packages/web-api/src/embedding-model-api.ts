/**
 * Embedding model download API.
 *
 * Provides endpoints for checking model status and downloading the BGE-M3 and
 * MiniLM ONNX embedding models at runtime (during the setup wizard) instead of
 * bundling them in the app. Progress is streamed via Server-Sent Events (SSE).
 */
import { Router, type Request, type Response } from 'express';
import { pipeline } from '@huggingface/transformers';
import { existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDir, getLogger } from '@agentx/shared';
import { setDefaultEmbeddingCacheDir } from '@agentx/engine';

const router: import('express').Router = Router();

const EMBEDDING_MODELS_DIR = join(getDataDir(), 'models');

// Ensure the directory exists.
if (!existsSync(EMBEDDING_MODELS_DIR)) {
  try { mkdirSync(EMBEDDING_MODELS_DIR, { recursive: true }); } catch {}
}

// Set the embedding cache dir so OnnxEmbeddingProvider finds models here.
setDefaultEmbeddingCacheDir(EMBEDDING_MODELS_DIR);

interface ModelSpec {
  id: string;
  huggingfaceId: string;
  dtype: 'int8' | 'q4';
  displayName: string;
  /** Approximate size in MB — used for progress estimation before download. */
  approxSizeMB: number;
  /** Subdirectory name under the cache dir. */
  subdir: string;
}

const MODELS: ModelSpec[] = [
  {
    id: 'bge-m3',
    huggingfaceId: 'Xenova/bge-m3',
    dtype: 'int8',
    displayName: 'BGE-M3 Neural Embedding Engine',
    approxSizeMB: 600,
    subdir: 'Xenova/bge-m3',
  },
  {
    id: 'minilm',
    huggingfaceId: 'Xenova/all-MiniLM-L6-v2',
    dtype: 'q4',
    displayName: 'MiniLM Lightweight Embedder',
    approxSizeMB: 55,
    subdir: 'Xenova/all-MiniLM-L6-v2',
  },
];

interface DownloadState {
  modelId: string;
  status: 'pending' | 'downloading' | 'complete' | 'error';
  downloadedMB: number;
  totalMB: number;
  percentage: number;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

const downloadStates = new Map<string, DownloadState>();
let downloadInProgress = false;

/**
 * Recursively calculate the total size (in bytes) of a directory.
 */
function getDirSize(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;
  let total = 0;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getDirSize(fullPath);
      } else if (entry.isFile()) {
        try { total += statSync(fullPath).size; } catch {}
      }
    }
  } catch {}
  return total;
}

/**
 * Check if a model's ONNX file exists on disk.
 */
function isModelDownloaded(model: ModelSpec): boolean {
  const onnxPath = join(EMBEDDING_MODELS_DIR, model.subdir, 'onnx', `model_${model.dtype}.onnx`);
  return existsSync(onnxPath);
}

/**
 * Get the current size of a model on disk (in MB).
 */
function getModelSizeMB(model: ModelSpec): number {
  const modelDir = join(EMBEDDING_MODELS_DIR, model.subdir);
  return getDirSize(modelDir) / (1024 * 1024);
}

/** Max download attempts per model before giving up. */
const MAX_RETRIES = 3;
/** Delay between retry attempts (ms), with exponential backoff. */
const RETRY_BASE_DELAY_MS = 3000;

/**
 * Clean up a partially downloaded model's cache directory.
 */
function cleanPartialDownload(model: ModelSpec): void {
  const modelDir = join(EMBEDDING_MODELS_DIR, model.subdir);
  try { rmSync(modelDir, { recursive: true, force: true }); } catch {}
  // Also clean the huggingface-style cache dir name.
  const sanitized = model.huggingfaceId.replace(/[^a-zA-Z0-9_.-]/g, '-');
  try { rmSync(join(EMBEDDING_MODELS_DIR, `models--${sanitized}`), { recursive: true, force: true }); } catch {}
}

/**
 * Start downloading a single model with retry logic.
 * Updates downloadStates as it progresses.
 */
async function downloadModel(model: ModelSpec): Promise<void> {
  const state: DownloadState = {
    modelId: model.id,
    status: 'downloading',
    downloadedMB: 0,
    totalMB: model.approxSizeMB,
    percentage: 0,
    startedAt: Date.now(),
  };
  downloadStates.set(model.id, state);

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Reset state for this attempt.
    state.status = 'downloading';
    state.downloadedMB = 0;
    state.percentage = 0;
    state.error = undefined;

    // Start a progress poller that measures the directory size on disk.
    const progressInterval = setInterval(() => {
      const currentMB = getModelSizeMB(model);
      const s = downloadStates.get(model.id);
      if (!s || s.status !== 'downloading') return;
      s.downloadedMB = Math.min(currentMB, s.totalMB);
      s.percentage = Math.min(100, Math.round((currentMB / s.totalMB) * 100));
    }, 500);

    try {
      getLogger().info('EMBEDDING_DOWNLOAD', `Downloading ${model.huggingfaceId} (${model.dtype}) — attempt ${attempt}/${MAX_RETRIES}...`);
      await pipeline('feature-extraction', model.huggingfaceId, {
        dtype: model.dtype,
        revision: 'main',
        cache_dir: EMBEDDING_MODELS_DIR,
        session_options: {
          intraOpNumThreads: 1,
          interOpNumThreads: 1,
          enableCpuMemArena: false,
          enableMemPattern: false,
        },
      });
      clearInterval(progressInterval);

      // Final size measurement.
      const finalMB = getModelSizeMB(model);
      const s = downloadStates.get(model.id);
      if (s) {
        s.status = 'complete';
        s.downloadedMB = Math.round(finalMB * 100) / 100;
        s.totalMB = Math.max(s.downloadedMB, s.totalMB);
        s.percentage = 100;
        s.completedAt = Date.now();
      }
      getLogger().info('EMBEDDING_DOWNLOAD', `Downloaded ${model.huggingfaceId} (${finalMB.toFixed(1)} MB) on attempt ${attempt}`);
      return; // success
    } catch (e) {
      clearInterval(progressInterval);
      lastError = e;
      const errMsg = e instanceof Error ? e.message : String(e);
      getLogger().warn('EMBEDDING_DOWNLOAD', `Attempt ${attempt}/${MAX_RETRIES} failed for ${model.huggingfaceId}: ${errMsg}`);

      if (attempt < MAX_RETRIES) {
        // Clean partial download and wait before retrying.
        cleanPartialDownload(model);
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        const s = downloadStates.get(model.id);
        if (s) {
          s.status = 'pending';
          s.error = `Retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(delay / 1000)}s...`;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // All retries exhausted.
  const s = downloadStates.get(model.id);
  if (s) {
    s.status = 'error';
    s.error = lastError instanceof Error ? lastError.message : String(lastError);
  }
  getLogger().warn('EMBEDDING_DOWNLOAD', `All ${MAX_RETRIES} attempts failed for ${model.huggingfaceId}`);
  throw lastError ?? new Error('Download failed after all retries');
}

// ── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/embedding-models/status
 * Returns the current status of both embedding models.
 */
router.get('/embedding-models/status', (_req: Request, res: Response) => {
  const models = MODELS.map((m) => {
    const downloaded = isModelDownloaded(m);
    const state = downloadStates.get(m.id);
    return {
      id: m.id,
      displayName: m.displayName,
      huggingfaceId: m.huggingfaceId,
      approxSizeMB: m.approxSizeMB,
      downloaded,
      sizeOnDiskMB: downloaded ? Math.round(getModelSizeMB(m) * 100) / 100 : 0,
      downloadStatus: state?.status ?? (downloaded ? 'complete' : 'not_started'),
      percentage: state?.percentage ?? (downloaded ? 100 : 0),
    };
  });
  res.json({ models, allDownloaded: models.every((m) => m.downloaded) });
});

/**
 * POST /api/embedding-models/download
 * Starts downloading both embedding models in the background.
 * Returns immediately with the initial state.
 */
router.post('/embedding-models/download', async (_req: Request, res: Response) => {
  // Check which models still need downloading.
  const needed = MODELS.filter((m) => !isModelDownloaded(m));
  if (needed.length === 0) {
    return res.json({ ok: true, message: 'All models already downloaded', models: [] });
  }

  if (downloadInProgress) {
    return res.json({ ok: true, message: 'Download already in progress', models: MODELS.map((m) => ({ id: m.id, status: downloadStates.get(m.id)?.status ?? 'pending' })) });
  }

  downloadInProgress = true;

  // Start downloads sequentially (BGE-M3 first, then MiniLM).
  (async () => {
    for (const model of needed) {
      try {
        await downloadModel(model);
      } catch {
        // Error state is already set in downloadStates.
      }
    }
    downloadInProgress = false;
  })();

  res.json({
    ok: true,
    message: 'Download started',
    models: needed.map((m) => ({ id: m.id, displayName: m.displayName, approxSizeMB: m.approxSizeMB })),
  });
});

/**
 * POST /api/embedding-models/disable-neural-brain
 * Disables the neural brain module when embedding models fail to download.
 * The caller (frontend) uses the config API to set neuralBrain: false.
 */
router.post('/embedding-models/disable-neural-brain', (_req: Request, res: Response) => {
  getLogger().warn('EMBEDDING_DOWNLOAD', 'Neural brain disabled — embedding models failed to download after all retries.');
  res.json({ ok: true, message: 'Neural brain disabled' });
});

/**
 * GET /api/embedding-models/progress
 * Server-Sent Events stream that pushes download progress updates every 500ms.
 */
router.get('/embedding-models/progress', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write('data: ' + JSON.stringify({ type: 'connected' }) + '\n\n');

  const interval = setInterval(() => {
    const models = MODELS.map((m) => {
      const state = downloadStates.get(m.id);
      const downloaded = isModelDownloaded(m);
      return {
        id: m.id,
        displayName: m.displayName,
        status: state?.status ?? (downloaded ? 'complete' : 'not_started'),
        downloadedMB: state?.downloadedMB ?? (downloaded ? Math.round(getModelSizeMB(m) * 100) / 100 : 0),
        totalMB: state?.totalMB ?? m.approxSizeMB,
        percentage: state?.percentage ?? (downloaded ? 100 : 0),
        error: state?.error,
      };
    });
    const allComplete = models.every((m) => m.status === 'complete');
    const hasError = models.some((m) => m.status === 'error');

    res.write('data: ' + JSON.stringify({ type: 'progress', models, allComplete, hasError }) + '\n\n');

    if (allComplete || hasError) {
      res.write('data: ' + JSON.stringify({ type: 'done', allComplete, hasError }) + '\n\n');
      clearInterval(interval);
      res.end();
    }
  }, 500);

  // Clean up on client disconnect.
  req.on('close', () => {
    clearInterval(interval);
    res.end();
  });
});

export default router;
