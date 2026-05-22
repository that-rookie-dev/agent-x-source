import { describe, it, expect } from 'vitest';
import { estimateTokens, formatTokenCount, tokenPercentage } from '../src/utils/tokens.js';

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
