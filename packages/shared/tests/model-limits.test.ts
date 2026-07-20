import { describe, it, expect } from 'vitest';
import {
  parseModelLimitsFromApiRecord,
  resolveTrialOutputTokens,
  getReasoningOutputReserve,
  apiRecordToModelInfo,
} from '../src/utils/model-limits.js';
import { resolveEffectiveMaxOutputTokens, MIN_OUTPUT_TOKENS } from '../src/utils/tokens.js';

describe('parseModelLimitsFromApiRecord', () => {
  it('reads snake_case and camelCase limit fields', () => {
    expect(parseModelLimitsFromApiRecord({
      context_window: 1_050_000,
      max_output_tokens: 128_000,
      min_output_tokens: 16,
    })).toEqual({
      contextWindow: 1_050_000,
      outputTokenLimit: 128_000,
      minOutputTokens: 16,
    });
  });
});

describe('resolveTrialOutputTokens', () => {
  it('never returns below provider minimum', () => {
    expect(resolveTrialOutputTokens()).toBe(MIN_OUTPUT_TOKENS);
    expect(resolveTrialOutputTokens({ outputTokenLimit: 8 })).toBe(MIN_OUTPUT_TOKENS);
  });

  it('caps trial budget when provider reports a larger output limit', () => {
    expect(resolveTrialOutputTokens({ outputTokenLimit: 128_000 })).toBe(64);
  });
});

describe('getReasoningOutputReserve', () => {
  it('returns zero when reasoning is not reported', () => {
    expect(getReasoningOutputReserve({ hasReasoning: false, contextWindow: 200_000 })).toBe(0);
  });

  it('reserves a dynamic slice when reasoning capability is reported', () => {
    expect(getReasoningOutputReserve({
      hasReasoning: true,
      contextWindow: 1_000_000,
      outputTokenLimit: 128_000,
    })).toBe(25_000);
  });
});

describe('apiRecordToModelInfo', () => {
  it('maps provider metadata without model-id heuristics', () => {
    const info = apiRecordToModelInfo({
      id: 'vendor/model-x',
      display_name: 'Model X',
      context_length: 64_000,
      max_output_tokens: 4096,
      reasoning: true,
    }, 'commandcode');
    expect(info?.id).toBe('vendor/model-x');
    expect(info?.contextWindow).toBe(64_000);
    expect(info?.outputTokenLimit).toBe(4096);
    expect(info?.capabilities).toContain('reasoning');
  });
});

describe('resolveEffectiveMaxOutputTokens with modelCaps', () => {
  it('applies reasoning reserve from capabilities metadata', () => {
    expect(() => resolveEffectiveMaxOutputTokens({
      configured: 8192,
      contextWindow: 200_000,
      estimatedInputTokens: 196_000,
      modelCaps: { hasReasoning: true, contextWindow: 200_000, outputTokenLimit: 32_000 },
    })).toThrow();
  });
});
