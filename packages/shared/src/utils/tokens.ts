/**
 * Rough token count estimation.
 * Uses ~4 characters per token approximation for English text.
 * For precise counting, use tiktoken in the engine layer.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return String(count);
}

export function tokenPercentage(used: number, available: number): number {
  if (available === 0) return 0;
  return Math.round((used / available) * 100);
}
