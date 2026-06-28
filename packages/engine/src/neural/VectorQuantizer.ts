/**
 * Vector quantization helpers for pgvector halfvec/binary storage.
 *
 * Converts float32 embeddings into a compact halfvec representation so that
 * HNSW indexes over millions of rows fit in consumer RAM. The original float32
 * vector is kept for high-precision operations and as a source of truth during
 * re-embedding.
 */

export function toHalfvecLiteral(values: number[]): string {
  return `[${values.map((v) => Number(v.toFixed(6)).toString()).join(',')}]`;
}

export function toBinaryLiteral(values: number[]): string {
  // Simple scalar binarization: positive dimensions become 1, others 0.
  // This produces a bit-string that pgvector can store in a `bit` vector.
  const bits = values.map((v) => (v > 0 ? '1' : '0')).join('');
  return bits;
}

export function quantizeHalfvec(values: number[]): number[] {
  // Half-precision is handled by PostgreSQL; here we just clamp the input
  // to the range that half-precision can represent without overflow.
  return values.map((v) => {
    if (Number.isNaN(v)) return 0;
    if (v > 65504) return 65504;
    if (v < -65504) return -65504;
    return v;
  });
}
