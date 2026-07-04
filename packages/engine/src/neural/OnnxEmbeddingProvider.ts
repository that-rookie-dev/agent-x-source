/**
 * Unified neural embedding provider — the single entry point for all
 * GraphRAG / Neural Brain embedding in Agent-X.
 *
 * Auto-selects the best available local ONNX model based on system
 * capabilities, with a deterministic n-gram fallback if no model files
 * can be loaded:
 *
 *   1. BGE-M3 (1024-dim, INT8 ONNX)  — primary, requires >= 16 GB RAM
 *   2. all-MiniLM-L6-v2 (384-dim, q4) — fallback for low-RAM machines
 *   3. Local n-gram hash (384-dim)    — last resort, no model files
 *
 * All vectors are zero-padded / stored at the BGE-M3 dimension (1024) so
 * the DB schema stays uniform regardless of which tier loaded. Zero-padding
 * preserves cosine similarity exactly (zero dimensions contribute nothing
 * to the dot product or the L2 norm).
 */
import { totalmem } from 'os';
import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import type { EmbeddingProvider } from '@agentx/shared';
import { NEURAL_BRAIN_MIN_RAM_GB } from '@agentx/shared';
import { LocalEmbeddingProvider } from './LocalEmbeddingProvider.js';

/** Target dimension — always 1024 to match BGE-M3 and the DB schema. */
export const EMBEDDING_DIMENSION = 1024;

/** BGE-M3 native dimension (no padding needed). */
const BGE_M3_DIMENSION = 1024;

/** MiniLM native dimension (padded to 1024). */
const MINILM_DIMENSION = 384;

/** RAM threshold (GB) above which BGE-M3 is preferred over MiniLM. */
const BGE_M3_RAM_THRESHOLD_GB = 16;

const BGE_M3_MODEL_ID = 'Xenova/bge-m3';
const MINILM_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

let defaultEmbeddingCacheDir: string | undefined;

export function setDefaultEmbeddingCacheDir(cacheDir: string): void {
  defaultEmbeddingCacheDir = cacheDir;
}

export function getDefaultEmbeddingCacheDir(): string | undefined {
  return defaultEmbeddingCacheDir;
}

type ModelTier = 'bge-m3' | 'minilm' | 'ngram';

interface LoadedModel {
  tier: ModelTier;
  pipeline: FeatureExtractionPipeline | null;
  nativeDim: number;
}

// ── Module-level singleton for tool access ──
let _embedderInstance: OnnxEmbeddingProvider | null = null;

export function setEmbedderInstance(embedder: OnnxEmbeddingProvider | null): void {
  _embedderInstance = embedder;
}

export function getEmbedderInstance(): OnnxEmbeddingProvider | null {
  return _embedderInstance;
}

export class OnnxEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions = EMBEDDING_DIMENSION;
  private cacheDir: string | undefined;
  private loaded: LoadedModel | null = null;
  private pending: Promise<LoadedModel> | null = null;
  private ngramFallback: LocalEmbeddingProvider | null = null;

  constructor(modelName?: string, cacheDir?: string) {
    // modelName is accepted for backward compatibility but ignored —
    // the provider auto-selects the best model.
    this.model = modelName ?? BGE_M3_MODEL_ID;
    this.cacheDir = cacheDir || defaultEmbeddingCacheDir;
  }

  async embed(text: string): Promise<number[]> {
    const model = await this.load();
    if (model.pipeline) {
      try {
        const result = await model.pipeline(text, { pooling: 'mean', normalize: true });
        const data = result.data as Float32Array;
        const native = Array.from(data);
        return this.padToTarget(native, model.nativeDim);
      } catch (e) {
        this.invalidate(model);
        return this.embedWithNgram(text);
      }
    }
    return this.embedWithNgram(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const model = await this.load();
    if (model.pipeline) {
      try {
        const result = await model.pipeline(texts, { pooling: 'mean', normalize: true });
        const data = result.data as Float32Array;
        return texts.map((_, i) => {
          const native = Array.from(data.slice(i * model.nativeDim, (i + 1) * model.nativeDim));
          return this.padToTarget(native, model.nativeDim);
        });
      } catch (e) {
        this.invalidate(model);
        return this.embedBatchWithNgram(texts);
      }
    }
    return this.embedBatchWithNgram(texts);
  }

  /** Which model tier is currently active (useful for telemetry / UI). */
  get activeTier(): ModelTier | null {
    return this.loaded?.tier ?? null;
  }

  // --- internal ---

  private padToTarget(native: number[], nativeDim: number): number[] {
    if (nativeDim >= EMBEDDING_DIMENSION) return native;
    const padded = new Array(EMBEDDING_DIMENSION).fill(0);
    for (let i = 0; i < native.length; i++) padded[i] = native[i];
    return padded;
  }

  private invalidate(model: LoadedModel): void {
    if (this.loaded === model) this.loaded = null;
    this.pending = null;
  }

  private async embedWithNgram(text: string): Promise<number[]> {
    if (!this.ngramFallback) this.ngramFallback = new LocalEmbeddingProvider();
    const native = await this.ngramFallback.embed(text);
    return this.padToTarget(native, MINILM_DIMENSION);
  }

  private async embedBatchWithNgram(texts: string[]): Promise<number[][]> {
    if (!this.ngramFallback) this.ngramFallback = new LocalEmbeddingProvider();
    const natives = await this.ngramFallback.embedBatch(texts);
    return natives.map((v) => this.padToTarget(v, MINILM_DIMENSION));
  }

  private async load(): Promise<LoadedModel> {
    if (this.loaded) return this.loaded;
    if (this.pending) return this.pending;
    this.pending = this.loadModel();
    try {
      this.loaded = await this.pending;
    } finally {
      this.pending = null;
    }
    return this.loaded;
  }

  private async loadModel(): Promise<LoadedModel> {
    const ramGb = this.getRamGb();
    if (ramGb < NEURAL_BRAIN_MIN_RAM_GB) {
      return { tier: 'ngram', pipeline: null, nativeDim: MINILM_DIMENSION };
    }

    const preferBgeM3 = ramGb >= BGE_M3_RAM_THRESHOLD_GB;

    // Try BGE-M3 first on capable machines.
    if (preferBgeM3) {
      const bge = await this.tryLoadModel(BGE_M3_MODEL_ID, 'int8', BGE_M3_DIMENSION, 'bge-m3');
      if (bge) return bge;
    }

    // Try MiniLM as the lightweight fallback.
    const minilm = await this.tryLoadModel(MINILM_MODEL_ID, 'q4', MINILM_DIMENSION, 'minilm');
    if (minilm) return minilm;

    // If BGE-M3 wasn't tried yet (low RAM), try it as a last resort before n-gram.
    if (!preferBgeM3) {
      const bge = await this.tryLoadModel(BGE_M3_MODEL_ID, 'int8', BGE_M3_DIMENSION, 'bge-m3');
      if (bge) return bge;
    }

    // Last resort: n-gram hash (no model files needed).
    return { tier: 'ngram', pipeline: null, nativeDim: MINILM_DIMENSION };
  }

  private async tryLoadModel(
    modelId: string,
    dtype: 'int8' | 'q4' | 'fp32' | 'fp16' | 'q8' | 'uint8' | 'q4f16',
    nativeDim: number,
    tier: ModelTier,
  ): Promise<LoadedModel | null> {
    try {
      const mem = process.memoryUsage?.();
      // Skip model load if process is already very heavy (avoids OOM).
      if (mem && mem.rss > 2 * 1024 * 1024 * 1024 && tier === 'bge-m3') {
        return null;
      }
      const pipe = await pipeline('feature-extraction', modelId, {
        dtype,
        revision: 'main',
        cache_dir: this.cacheDir,
        local_files_only: true,
        session_options: {
          intraOpNumThreads: 1,
          interOpNumThreads: 1,
          enableCpuMemArena: false,
          enableMemPattern: false,
        },
      });
      return { tier, pipeline: pipe as FeatureExtractionPipeline, nativeDim };
    } catch {
      return null;
    }
  }

  private getRamGb(): number {
    try {
      return totalmem() / (1024 ** 3);
    } catch {
      return BGE_M3_RAM_THRESHOLD_GB; // assume capable if detection fails
    }
  }
}
