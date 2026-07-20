/**
 * Embedding model download API.
 *
 * Provides endpoints for checking model status and downloading the BGE-M3 and
 * MiniLM ONNX embedding models at runtime (during the setup wizard) instead of
 * bundling them in the app. Progress is streamed via Server-Sent Events (SSE).
 */
import { Router, type Request, type Response } from 'express';
import { pipeline, env } from '@huggingface/transformers';
import { existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDir, getLogger, isNeuralBrainSupported } from '@agentx/shared';
import { setDefaultEmbeddingCacheDir } from '@agentx/engine';
import os from 'node:os';

const router: import('express').Router = Router();

// ── HuggingFace transformers.js environment configuration ──────────────────
// The server runs inside Electron's main process where `process.release.name`
// is 'electron' (not 'node'), so transformers.js incorrectly detects a browser
// environment. We disable local model probing — we always use cache_dir.
env.allowLocalModels = false;

const MAX_REDIRECTS = 5;
let fetchPatched = false;

/**
 * Patch globalThis.fetch to manually follow 3xx redirects.
 *
 * HuggingFace returns 307/302 redirects to route file requests to their CDN
 * cache. The app's HTTP keep-alive layer (configureHttpKeepAlive) replaces
 * globalThis.fetch with a custom https.request-based implementation that does
 * NOT follow redirects. We wrap that implementation with redirect-following
 * logic so transformers.js can download model files successfully.
 *
 * This must be called AFTER configureHttpKeepAlive() has run, so we call it
 * lazily right before the first pipeline() invocation rather than at module
 * load time.
 */
function ensureRedirectFetchPatch(): void {
  if (fetchPatched) return;
  fetchPatched = true;
  const currentFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | globalThis.Request, init?: RequestInit): Promise<globalThis.Response> => {
    let currentInput: string | URL | globalThis.Request = input;
    let currentInit: RequestInit | undefined = init;
    for (let i = 0; i < MAX_REDIRECTS; i++) {
      const response = await currentFetch(currentInput as Parameters<typeof currentFetch>[0], currentInit);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return response as globalThis.Response;
        // Resolve relative redirects against the current URL.
        const baseUrl = typeof currentInput === 'string'
          ? currentInput
          : currentInput instanceof URL
            ? currentInput.href
            : currentInput.url;
        const nextUrl = new URL(location, baseUrl).href;
        getLogger().info('EMBEDDING_DOWNLOAD', `Following redirect ${response.status} → ${nextUrl}`);
        // 307/308 preserve method and body; 301/302/303 convert to GET.
        if (response.status === 307 || response.status === 308) {
          currentInput = nextUrl;
        } else {
          currentInput = nextUrl;
          currentInit = { method: 'GET' };
        }
        continue;
      }
      return response as globalThis.Response;
    }
    throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
  }) as typeof globalThis.fetch;

  getLogger().info('EMBEDDING_DOWNLOAD', 'Patched globalThis.fetch with redirect-following wrapper');
}

function neuralBrainHardwareSupported(): boolean {
  return isNeuralBrainSupported(os.totalmem() / (1024 ** 3));
}

const EMBEDDING_MODELS_DIR = join(getDataDir(), 'models');

// Ensure the directory exists.
if (!existsSync(EMBEDDING_MODELS_DIR)) {
  try { mkdirSync(EMBEDDING_MODELS_DIR, { recursive: true }); } catch { /* ignore */ }
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
        try { total += statSync(fullPath).size; } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
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
const MAX_RETRIES = 5;
/** Delay between retry attempts (ms), with exponential backoff. */
const RETRY_BASE_DELAY_MS = 5000;

/**
 * Clean up a partially downloaded model's cache directory.
 */
function cleanPartialDownload(model: ModelSpec): void {
  const modelDir = join(EMBEDDING_MODELS_DIR, model.subdir);
  try { rmSync(modelDir, { recursive: true, force: true }); } catch { /* ignore */ }
  // Also clean the huggingface-style cache dir name.
  const sanitized = model.huggingfaceId.replace(/[^a-zA-Z0-9_.-]/g, '-');
  try { rmSync(join(EMBEDDING_MODELS_DIR, `models--${sanitized}`), { recursive: true, force: true }); } catch { /* ignore */ }
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
      // Ensure the redirect-following fetch patch is active before calling
      // pipeline(). This must run after configureHttpKeepAlive() has replaced
      // globalThis.fetch, so we do it lazily here rather than at module load.
      ensureRedirectFetchPatch();
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
          s.error = `Retry ${attempt + 1}/${MAX_RETRIES} in ${Math.round(delay / 1000)}s — ${errMsg.slice(0, 80)}`;
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
  res.json({ models, allDownloaded: models.every((m) => m.downloaded), neuralBrainSupported: neuralBrainHardwareSupported() });
});

/**
 * POST /api/embedding-models/download
 * Starts downloading both embedding models in the background.
 * Returns immediately with the initial state.
 */
router.post('/embedding-models/download', async (req: Request, res: Response) => {
  // Allow low-RAM systems to bypass the hardware check when the user has
  // explicitly opted in via the setup wizard (force: true).
  const force = req.body?.force === true;
  if (!neuralBrainHardwareSupported() && !force) {
    return res.status(403).json({
      ok: false,
      error: 'neural-brain-unsupported',
      message: 'Neural brain requires 16 GB+ system RAM. Embedding models are not available on this machine.',
    });
  }
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
 * DELETE /api/embedding-models
 * Purges all downloaded embedding model files from disk and resets download
 * state. Used when the user opts out of the neural brain from Settings.
 * The caller should also set neuralBrain: false via the config API.
 */
router.delete('/embedding-models', (_req: Request, res: Response) => {
  let purgedMB = 0;
  for (const model of MODELS) {
    const sizeBefore = getModelSizeMB(model);
    cleanPartialDownload(model);
    // Clear any in-progress download state.
    const state = downloadStates.get(model.id);
    if (state && (state.status === 'downloading' || state.status === 'pending')) {
      state.status = 'error';
      state.error = 'Download cancelled — neural brain disabled by user.';
    }
    purgedMB += sizeBefore;
  }
  downloadInProgress = false;
  getLogger().info('EMBEDDING_DOWNLOAD', `Purged all embedding models from disk (${purgedMB.toFixed(1)} MB freed).`);
  res.json({ ok: true, message: 'All embedding models purged', freedMB: Math.round(purgedMB * 100) / 100 });
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
