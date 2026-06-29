/**
 * ONNX Runtime embedding provider using Transformers.js.
 *
 * Loads a small local sentence-transformer model (all-MiniLM-L6-v2) and
 * generates 384-dimensional embeddings offline. This satisfies the Group 4
 * requirement for verified fully-offline operation.
 */
import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

let defaultEmbeddingCacheDir: string | undefined;

export function setDefaultEmbeddingCacheDir(cacheDir: string): void {
  defaultEmbeddingCacheDir = cacheDir;
}

export function getDefaultEmbeddingCacheDir(): string | undefined {
  return defaultEmbeddingCacheDir;
}

export class OnnxEmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  private cacheDir: string | undefined;
  private pipeline: FeatureExtractionPipeline | null = null;
  private pending: Promise<FeatureExtractionPipeline> | null = null;

  constructor(modelName = 'Xenova/all-MiniLM-L6-v2', cacheDir?: string) {
    this.model = modelName;
    this.cacheDir = cacheDir || defaultEmbeddingCacheDir;
    this.dimensions = 384;
  }

  async embed(text: string): Promise<number[]> {
    try {
      const pipe = await this.load();
      const result = await pipe(text, { pooling: 'mean', normalize: true });
      const data = result.data as Float32Array;
      return Array.from(data);
    } catch (e) {
      // Fallback to local character n-gram embedding if WASM fails
      console.warn('ONNX embedding failed, using fallback:', e instanceof Error ? e.message : e);
      const { LocalEmbeddingProvider } = await import('./LocalEmbeddingProvider.js');
      const fallback = new LocalEmbeddingProvider();
      return fallback.embed(text);
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    try {
      const pipe = await this.load();
      const result = await pipe(texts, { pooling: 'mean', normalize: true });
      const data = result.data as Float32Array;
      const dim = 384;
      return texts.map((_, i) => Array.from(data.slice(i * dim, (i + 1) * dim)));
    } catch (e) {
      // Fallback to local character n-gram embedding if WASM fails
      console.warn('ONNX batch embedding failed, using fallback:', e instanceof Error ? e.message : e);
      const { LocalEmbeddingProvider } = await import('./LocalEmbeddingProvider.js');
      const fallback = new LocalEmbeddingProvider();
      return Promise.all(texts.map(text => fallback.embed(text)));
    }
  }

  private async load(): Promise<FeatureExtractionPipeline> {
    if (this.pipeline) return this.pipeline;
    if (this.pending) return this.pending;
    const mem = process.memoryUsage?.();
    if (mem && mem.rss > 1.5 * 1024 * 1024 * 1024) {
      throw new Error('ONNX embedding load skipped: process RSS exceeds 1.5 GB');
    }
    this.pending = pipeline('feature-extraction', this.model, {
      dtype: 'q4',
      revision: 'main',
      cache_dir: this.cacheDir,
      // Disable WASM threading to avoid Electron path issues
      local_files_only: true,
      session_options: {
        intraOpNumThreads: 1,
        interOpNumThreads: 1,
        enableCpuMemArena: false,
        enableMemPattern: false,
      },
    }) as Promise<FeatureExtractionPipeline>;
    this.pipeline = await this.pending;
    this.pending = null;
    return this.pipeline;
  }
}
