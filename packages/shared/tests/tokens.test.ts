import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  formatTokenCount,
  tokenPercentage,
  resolveMaxOutputTokens,
  resolveEffectiveMaxOutputTokens,
  estimatePromptTokens,
  ContextBudgetExceededError,
  MIN_OUTPUT_TOKENS,
} from '../src/utils/tokens.js';
import { resolveTrialOutputTokens } from '../src/utils/model-limits.js';

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates ~4 chars per token', () => {
    expect(estimateTokens('hello')).toBe(2); // ceil(5/4)
    expect(estimateTokens('hello world')).toBe(3); // ceil(11/4)
  });

  it('handles long text', () => {
    const text = 'a'.repeat(1000);
    expect(estimateTokens(text)).toBe(250);
  });
});

describe('formatTokenCount', () => {
  it('formats small numbers as-is', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(500)).toBe('500');
    expect(formatTokenCount(999)).toBe('999');
  });

  it('formats thousands with K suffix', () => {
    expect(formatTokenCount(1000)).toBe('1.0K');
    expect(formatTokenCount(1500)).toBe('1.5K');
    expect(formatTokenCount(128000)).toBe('128.0K');
  });

  it('formats millions with M suffix', () => {
    expect(formatTokenCount(1000000)).toBe('1.0M');
    expect(formatTokenCount(2500000)).toBe('2.5M');
  });
});

describe('tokenPercentage', () => {
  it('returns 0 when available is 0', () => {
    expect(tokenPercentage(100, 0)).toBe(0);
  });

  it('calculates correct percentage', () => {
    expect(tokenPercentage(50, 100)).toBe(50);
    expect(tokenPercentage(75, 100)).toBe(75);
    expect(tokenPercentage(0, 100)).toBe(0);
  });

  it('returns 100 when fully used', () => {
    expect(tokenPercentage(100, 100)).toBe(100);
  });
});

describe('resolveMaxOutputTokens', () => {
  it('defaults to 8192 and clamps below 16', () => {
    expect(resolveMaxOutputTokens()).toBe(8192);
    expect(resolveMaxOutputTokens(1)).toBe(MIN_OUTPUT_TOKENS);
    expect(resolveMaxOutputTokens(4096)).toBe(4096);
  });
});

describe('resolveEffectiveMaxOutputTokens', () => {
  it('caps output to remaining context', () => {
    expect(resolveEffectiveMaxOutputTokens({
      configured: 8192,
      contextWindow: 10_000,
      estimatedInputTokens: 9_500,
    })).toBe(500);
  });

  it('reserves extra budget when reasoning capability is reported', () => {
    expect(() => resolveEffectiveMaxOutputTokens({
      configured: 8192,
      contextWindow: 200_000,
      estimatedInputTokens: 196_000,
      modelCaps: { hasReasoning: true, contextWindow: 200_000, outputTokenLimit: 32_000 },
    })).toThrow(ContextBudgetExceededError);
  });

  it('throws when fewer than MIN_OUTPUT_TOKENS remain', () => {
    expect(() => resolveEffectiveMaxOutputTokens({
      configured: 8192,
      contextWindow: 10_000,
      estimatedInputTokens: 9_999,
    })).toThrow(ContextBudgetExceededError);
  });
});

describe('resolveTrialOutputTokens', () => {
  it('uses provider minimum for model trials', () => {
    expect(resolveTrialOutputTokens()).toBe(MIN_OUTPUT_TOKENS);
  });
});

describe('estimatePromptTokens', () => {
  it('includes tool-schema overhead', () => {
    const base = estimatePromptTokens([{ content: 'hello' }], 0);
    const withTools = estimatePromptTokens([{ content: 'hello' }], 5);
    expect(withTools).toBeGreaterThan(base);
  });
});
