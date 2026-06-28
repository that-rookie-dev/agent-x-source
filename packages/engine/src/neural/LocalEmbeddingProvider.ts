/**
 * Fully-offline embedding provider.
 *
 * Produces deterministic 384-dimensional character n-gram fingerprints.
 * This is not as semantically rich as a transformer model, but it requires
 * no network access, no large model download, and no external API keys,
 * making it suitable for verified offline mode.
 */
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  private readonly dim = 384;
  private readonly n = 3;

  async embed(text: string): Promise<number[]> {
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    const vector = new Array(this.dim).fill(0);
    if (normalized.length === 0) return vector;

    const chars = Array.from(normalized);
    const ngrams = new Map<number, number>();
    for (let i = 0; i <= chars.length - this.n; i++) {
      const gram = chars.slice(i, i + this.n).join('');
      const idx = this.hash(gram) % this.dim;
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
