/**
 * Rough token count estimation.
 * Uses ~4 characters per token approximation for English text.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(
  messages: Array<{ content: string; toolCalls?: unknown; metadata?: Record<string, unknown> }>,
): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateTokens(msg.content || '');
    if (msg.toolCalls) total += estimateTokens(JSON.stringify(msg.toolCalls));
    if (msg.metadata) total += estimateTokens(JSON.stringify(msg.metadata));
  }
  return total;
}

export interface TokenThresholds {
  contextWindow: number;
  outputReserve: number;
  compactionTrigger: number;
}

export function getTokenThresholds(contextWindow: number): TokenThresholds {
  const outputReserve = Math.min(20000, Math.round(contextWindow * 0.15));
  return {
    contextWindow,
    outputReserve,
    compactionTrigger: contextWindow - outputReserve,
  };
}

export function isTokenOverflow(usedTokens: number, thresholds: TokenThresholds): boolean {
  return usedTokens >= thresholds.compactionTrigger;
}

export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

export function tokenPercentage(used: number, available: number): number {
  if (available === 0) return 0;
  return Math.round((used / available) * 100);
}

/** Tokens reserved for the next model response (compaction trigger uses this). */
export function getOutputReserve(contextWindow: number): number {
  return getTokenThresholds(contextWindow).outputReserve;
}

/** Display total: committed in/out + in-flight output estimate + output reserve. */
export function buildDisplayTokenUsage(opts: {
  inputTokens: number;
  outputTokens: number;
  streamingTokens?: number;
  contextWindow: number;
  includeReserve?: boolean;
}): {
  inputTokens: number;
  outputTokens: number;
  streamingTokens: number;
  reservedTokens: number;
  displayTotal: number;
  contextWindow: number;
} {
  const streamingTokens = opts.streamingTokens ?? 0;
  const reservedTokens = opts.includeReserve === false ? 0 : getOutputReserve(opts.contextWindow);
  const displayTotal = opts.inputTokens + opts.outputTokens + streamingTokens + reservedTokens;
  return {
    inputTokens: opts.inputTokens,
    outputTokens: opts.outputTokens,
    streamingTokens,
    reservedTokens,
    displayTotal,
    contextWindow: opts.contextWindow,
  };
}
