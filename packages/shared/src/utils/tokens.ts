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

export const MIN_OUTPUT_TOKENS = 16;
const DEFAULT_OUTPUT_TOKENS = 8192;
/** Fallback per tool when schema JSON size is unavailable. */
const ESTIMATED_TOKENS_PER_TOOL = 2500;
/** Extra headroom because provider tokenizers count more than char heuristics. */
const PROMPT_SAFETY_MARGIN = 8192;

/** Conservative text token estimate (tighter than estimateTokens). */
export function estimateTokensConservative(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3);
}

/** Clamp configured output budget — providers reject values below 16 (e.g. OpenAI max_output_tokens). */
export function resolveMaxOutputTokens(configured?: number): number {
  return Math.max(MIN_OUTPUT_TOKENS, configured ?? DEFAULT_OUTPUT_TOKENS);
}

export class ContextBudgetExceededError extends Error {
  readonly code = 'context_budget_exceeded' as const;
  readonly estimatedInputTokens: number;
  readonly contextWindow: number;
  readonly remainingTokens: number;

  constructor(estimatedInputTokens: number, contextWindow: number) {
    const remainingTokens = contextWindow - estimatedInputTokens;
    super(
      `Prompt is too large for this model (${formatTokenCount(estimatedInputTokens)} / ${formatTokenCount(contextWindow)} tokens). `
      + `Need at least ${MIN_OUTPUT_TOKENS} tokens free for a reply. Start a new session or switch to a model with a larger context window.`,
    );
    this.name = 'ContextBudgetExceededError';
    this.estimatedInputTokens = estimatedInputTokens;
    this.contextWindow = contextWindow;
    this.remainingTokens = remainingTokens;
  }
}

/** Rough prompt size: message bodies plus tool-schema overhead sent with the request. */
export function estimatePromptTokens(
  messages: Array<{ content: string; toolCalls?: unknown; metadata?: Record<string, unknown> }>,
  toolCount = 0,
  toolSchemaChars = 0,
): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateTokensConservative(msg.content || '');
    if (msg.toolCalls) total += estimateTokensConservative(JSON.stringify(msg.toolCalls));
    if (msg.metadata) total += estimateTokensConservative(JSON.stringify(msg.metadata));
  }
  const toolTokens = toolSchemaChars > 0
    ? Math.ceil(toolSchemaChars / 3)
    : toolCount * ESTIMATED_TOKENS_PER_TOOL;
  return total + toolTokens + PROMPT_SAFETY_MARGIN;
}

import { getReasoningOutputReserve } from './model-limits.js';

/** Output budget that fits remaining context; throws if fewer than MIN_OUTPUT_TOKENS remain. */
export function resolveEffectiveMaxOutputTokens(opts: {
  configured?: number;
  contextWindow: number;
  estimatedInputTokens: number;
  modelCaps?: {
    hasReasoning?: boolean;
    contextWindow?: number;
    outputTokenLimit?: number;
  };
}): number {
  const requested = resolveMaxOutputTokens(opts.configured);
  const reasoningReserve = getReasoningOutputReserve(opts.modelCaps);
  const remaining = opts.contextWindow - opts.estimatedInputTokens - reasoningReserve;
  if (remaining < MIN_OUTPUT_TOKENS) {
    throw new ContextBudgetExceededError(opts.estimatedInputTokens + reasoningReserve, opts.contextWindow);
  }
  return Math.min(requested, remaining);
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
