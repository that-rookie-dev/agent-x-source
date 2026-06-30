/**
 * Deterministic n-gram hash embedding — the zero-dependency last-resort
 * fallback used when no ONNX model files are available.
 *
 * This is NOT a semantic embedding model. It produces deterministic
 * 384-dimensional character n-gram fingerprints that are useful for
 * exact-match / lexical similarity but lack the semantic retrieval
 * quality of a transformer model. The unified `OnnxEmbeddingProvider`
 * falls back to this automatically when model files are missing.
 *
 * Vectors are 384-dim and zero-padded to 1024-dim by the caller so the
 * DB schema stays uniform.
 */
import type { EmbeddingProvider } from '@agentx/shared';

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'local-ngram';
  readonly dimensions = 384;
  private readonly n = 3;

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }

  async embed(text: string): Promise<number[]> {
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    const vector = new Array(this.dimensions).fill(0);
    if (normalized.length === 0) return vector;

    const chars = Array.from(normalized);
    const ngrams = new Map<number, number>();
    for (let i = 0; i <= chars.length - this.n; i++) {
      const gram = chars.slice(i, i + this.n).join('');
      const idx = this.hash(gram) % this.dimensions;
      ngrams.set(idx, (ngrams.get(idx) ?? 0) + 1);
    }

    for (const [idx, count] of ngrams) {
      vector[idx] = count;
    }

    return this.normalize(vector);
  }

  private hash(str: string): number {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }

  private normalize(v: number[]): number[] {
    const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
    if (norm === 0) return v;
    return v.map((x) => x / norm);
  }
}
