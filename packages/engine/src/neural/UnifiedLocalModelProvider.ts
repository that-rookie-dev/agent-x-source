/**
 * Unified local model provider using Transformers.js.
 *
 * Provides both text generation and embedding capabilities from a single
 * ONNX model, eliminating the need for separate embedding and generation models.
 */
import { pipeline, type FeatureExtractionPipeline, type TextGenerationPipeline } from '@huggingface/transformers';
import type { EmbeddingProvider } from '@agentx/shared';
import path from 'path';
import { getOnnxThreadConfig } from '../runtime/onnx-thread-config.js';

export interface UnifiedModelConfig {
  modelName: string;
  cacheDir: string;
  dtype: 'q4' | 'q4f16' | 'fp32' | 'fp16' | 'int8';
}

export class UnifiedLocalModelProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  readonly config: UnifiedModelConfig;
  private generator: TextGenerationPipeline | null = null;
  private embedder: FeatureExtractionPipeline | null = null;
  private generatorPending: Promise<TextGenerationPipeline> | null = null;
  private embedderPending: Promise<FeatureExtractionPipeline> | null = null;

  constructor(config: UnifiedModelConfig) {
    this.config = config;
    this.model = config.modelName;
    this.dimensions = 1536;
  }

  async generate(prompt: string, options?: { maxTokens?: number; temperature?: number }): Promise<string> {
    const pipe = await this.loadGenerator();
    const result = await pipe(prompt, {
      max_new_tokens: options?.maxTokens ?? 512,
      temperature: options?.temperature ?? 0.1,
      do_sample: false,
      return_full_text: false,
    });
    const text = Array.isArray(result)
      ? (result[0] as { generated_text?: string }).generated_text
      : (result as { generated_text?: string }).generated_text;
    return (text ?? '').trim();
  }

  async embed(text: string): Promise<number[]> {
    const pipe = await this.loadEmbedder();
    const result = await pipe(text, { pooling: 'mean', normalize: true });
    const data = result.data as Float32Array;
    return Array.from(data);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const pipe = await this.loadEmbedder();
    const result = await pipe(texts, { pooling: 'mean', normalize: true });
    const data = result.data as Float32Array;
    const dim = this.getEmbeddingDimension();
    return texts.map((_, i) => Array.from(data.slice(i * dim, (i + 1) * dim)));
  }

  private async loadGenerator(): Promise<TextGenerationPipeline> {
    if (this.generator) return this.generator;
    if (this.generatorPending) return this.generatorPending;
    
    const sessionOptions = {
      intraOpNumThreads: getOnnxThreadConfig().intraOpNumThreads,
      interOpNumThreads: getOnnxThreadConfig().interOpNumThreads,
      enableCpuMemArena: false,
      enableMemPattern: false,
    };
    this.generatorPending = pipeline('text-generation', this.config.modelName, {
      dtype: this.config.dtype,
      revision: 'main',
      cache_dir: this.config.cacheDir,
      session_options: sessionOptions,
    }) as Promise<TextGenerationPipeline>;

    this.generator = await this.generatorPending;
    this.generatorPending = null;
    return this.generator;
  }

  private async loadEmbedder(): Promise<FeatureExtractionPipeline> {
    if (this.embedder) return this.embedder;
    if (this.embedderPending) return this.embedderPending;

    const sessionOptions = {
      intraOpNumThreads: getOnnxThreadConfig().intraOpNumThreads,
      interOpNumThreads: getOnnxThreadConfig().interOpNumThreads,
      enableCpuMemArena: false,
      enableMemPattern: false,
    };
    this.embedderPending = pipeline('feature-extraction', this.config.modelName, {
      dtype: this.config.dtype,
      revision: 'main',
      cache_dir: this.config.cacheDir,
      session_options: sessionOptions,
    }) as Promise<FeatureExtractionPipeline>;
    
    this.embedder = await this.embedderPending;
    this.embedderPending = null;
    return this.embedder;
  }

  private getEmbeddingDimension(): number {
    // Qwen2.5 models use 1536-dim embeddings
    return 1536;
  }

  async clearCache(): Promise<void> {
    this.generator = null;
    this.embedder = null;
    this.generatorPending = null;
    this.embedderPending = null;
  }

  async isReady(): Promise<boolean> {
    try {
      await this.loadGenerator();
      await this.loadEmbedder();
      return true;
    } catch {
      return false;
    }
  }
}

export async function createUnifiedModelProvider(
  modelName: string,
  cacheDir?: string,
  dtype: UnifiedModelConfig['dtype'] = 'q4',
): Promise<UnifiedLocalModelProvider> {
  const config: UnifiedModelConfig = {
    modelName,
    cacheDir: cacheDir || path.join(process.env.HOME || process.env.USERPROFILE || '.', '.agentx', 'models'),
    dtype,
  };
  return new UnifiedLocalModelProvider(config);
}
