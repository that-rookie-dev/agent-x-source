/**
 * ONNX Runtime embedding provider using Transformers.js.
 *
 * Loads a small local sentence-transformer model (all-MiniLM-L6-v2) and
 * generates 384-dimensional embeddings offline. This satisfies the Group 4
 * requirement for verified fully-offline operation.
 */
import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';

export class OnnxEmbeddingProvider {
  private model: FeatureExtractionPipeline | null = null;
  private pending: Promise<FeatureExtractionPipeline> | null = null;

  constructor(private modelName = 'Xenova/all-MiniLM-L6-v2') {}

  async embed(text: string): Promise<number[]> {
    const pipe = await this.load();
    const result = await pipe(text, { pooling: 'mean', normalize: true });
    const data = result.data as Float32Array;
    return Array.from(data);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const pipe = await this.load();
    const result = await pipe(texts, { pooling: 'mean', normalize: true });
    const data = result.data as Float32Array;
    const dim = 384;
    return texts.map((_, i) => Array.from(data.slice(i * dim, (i + 1) * dim)));
  }

  private async load(): Promise<FeatureExtractionPipeline> {
    if (this.model) return this.model;
    if (this.pending) return this.pending;
    this.pending = pipeline('feature-extraction', this.modelName, {
      quantized: true,
      revision: 'main',
    }) as Promise<FeatureExtractionPipeline>;
    this.model = await this.pending;
    this.pending = null;
    return this.model;
  }
}
