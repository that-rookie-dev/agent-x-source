import { describe, it, expect } from 'vitest';
import { supportsVision, isImageMimeType } from './vision-support';

describe('supportsVision', () => {
  it('accepts explicit vision capability', () => {
    expect(supportsVision('minimax', 'MiniMax-M3', ['text', 'vision'])).toBe(true);
  });

  it('rejects MiniMax-M3 without vision capability or keywords', () => {
    expect(supportsVision('minimax', 'MiniMax-M3', ['text', 'streaming'])).toBe(false);
    expect(supportsVision('minimax', 'MiniMax-M3')).toBe(false);
  });

  it('accepts known vision model names via keywords', () => {
    expect(supportsVision('openai', 'gpt-4o')).toBe(true);
    expect(supportsVision('anthropic', 'claude-3-5-sonnet')).toBe(true);
    expect(supportsVision('google', 'gemini-2.0-flash')).toBe(true);
  });
});

describe('isImageMimeType', () => {
  it('detects image mimes', () => {
    expect(isImageMimeType('image/png')).toBe(true);
    expect(isImageMimeType('application/pdf')).toBe(false);
  });
});
