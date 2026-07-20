import type { ModelCapability, ModelInfo, ProviderId } from '../types/provider.js';
import { getOutputReserve, MIN_OUTPUT_TOKENS } from './tokens.js';

/** Used when a provider/model list omits context window metadata. */
export const DEFAULT_FALLBACK_CONTEXT_WINDOW = 128_000;

const LIMIT_FIELD_ALIASES = {
  contextWindow: [
    'context_window',
    'context_length',
    'contextWindow',
    'input_token_limit',
    'inputTokenLimit',
    'max_context_tokens',
    'max_context_length',
    'max_input_tokens',
  ],
  outputTokenLimit: [
    'max_output_tokens',
    'maxOutputTokens',
    'output_token_limit',
    'outputTokenLimit',
    'max_tokens',
    'max_completion_tokens',
  ],
  minOutputTokens: [
    'min_output_tokens',
    'minOutputTokens',
  ],
} as const;

function pickPositiveInt(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.floor(raw);
    if (typeof raw === 'string' && raw.trim() !== '') {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
    }
  }
  return undefined;
}

export interface ParsedModelLimits {
  contextWindow?: number;
  outputTokenLimit?: number;
  minOutputTokens?: number;
}

/** Extract token limits from a provider /models record (any OpenAI-compat shape). */
export function parseModelLimitsFromApiRecord(record: Record<string, unknown>): ParsedModelLimits {
  return {
    contextWindow: pickPositiveInt(record, LIMIT_FIELD_ALIASES.contextWindow),
    outputTokenLimit: pickPositiveInt(record, LIMIT_FIELD_ALIASES.outputTokenLimit),
    minOutputTokens: pickPositiveInt(record, LIMIT_FIELD_ALIASES.minOutputTokens),
  };
}

export function modelInfoHasReasoning(info?: Pick<ModelInfo, 'capabilities' | 'reasoning'>): boolean {
  if (!info) return false;
  if (info.reasoning?.supported) return true;
  return Boolean(info.capabilities?.includes('reasoning'));
}

/** Reserve output budget for models that report reasoning capability (from provider metadata). */
export function getReasoningOutputReserve(modelCaps?: {
  hasReasoning?: boolean;
  contextWindow?: number;
  outputTokenLimit?: number;
}): number {
  if (!modelCaps?.hasReasoning) return 0;
  const window = modelCaps.contextWindow ?? DEFAULT_FALLBACK_CONTEXT_WINDOW;
  const outputCap = modelCaps.outputTokenLimit ?? getOutputReserve(window);
  return Math.min(outputCap, Math.round(window * 0.025));
}

/** Minimal output budget for connectivity trials — never below provider minimum. */
export function resolveTrialOutputTokens(opts?: {
  outputTokenLimit?: number;
  minOutputTokens?: number;
}): number {
  const floor = Math.max(MIN_OUTPUT_TOKENS, opts?.minOutputTokens ?? MIN_OUTPUT_TOKENS);
  const trialBudget = 64;
  if (opts?.outputTokenLimit != null && opts.outputTokenLimit > 0) {
    return Math.max(floor, Math.min(trialBudget, opts.outputTokenLimit));
  }
  return floor;
}

export function inferCapabilitiesFromApiRecord(record: Record<string, unknown>): ModelCapability[] {
  const caps = new Set<ModelCapability>(['text', 'streaming']);
  const modalities = record['modalities'] ?? record['input_modalities'];
  if (Array.isArray(modalities) && modalities.some((m) => String(m).includes('image'))) {
    caps.add('vision');
  }
  if (record['supports_function_calling'] === true || record['function_calling'] === true) {
    caps.add('function_calling');
  }
  if (record['supports_json_mode'] === true || record['json_mode'] === true) {
    caps.add('json_mode');
  }
  if (
    record['reasoning'] === true
    || record['thinking'] === true
    || record['supports_reasoning'] === true
  ) {
    caps.add('reasoning');
  }
  return [...caps];
}

/** Map a provider /models API record to ModelInfo using reported metadata only. */
export function apiRecordToModelInfo(
  record: Record<string, unknown>,
  providerId: ProviderId,
  fallbackCapabilities: ModelCapability[] = ['text', 'streaming', 'function_calling'],
): ModelInfo | null {
  const id = String(record['id'] ?? record['name'] ?? '').trim();
  if (!id) return null;
  const limits = parseModelLimitsFromApiRecord(record);
  const inferred = inferCapabilitiesFromApiRecord(record);
  return {
    id,
    name: String(record['display_name'] ?? record['name'] ?? record['id'] ?? id),
    providerId,
    contextWindow: limits.contextWindow ?? DEFAULT_FALLBACK_CONTEXT_WINDOW,
    outputTokenLimit: limits.outputTokenLimit,
    capabilities: inferred.length > 0 ? inferred : fallbackCapabilities,
  };
}
