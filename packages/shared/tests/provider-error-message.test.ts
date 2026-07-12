import { describe, expect, it } from 'vitest';
import { formatProviderErrorMessage } from '../src/utils/provider-error-message.js';

describe('formatProviderErrorMessage', () => {
  it('extracts nested max_output_tokens message instead of a {\\ fragment', () => {
    const raw = `OpenAI API error: 400 - {"error":{"message":"{\\"error\\":{\\"message\\":\\"Invalid 'max_output_tokens': integer below minimum value. Expected a value >= 16, but got 1 instead.\\",\\"type\\":\\"AI_APICallError\\"}}","type":"invalid_request_error"}}`;
    expect(formatProviderErrorMessage(raw)).toBe(
      "API error (400): Invalid 'max_output_tokens': integer below minimum value. Expected a value >= 16, but got 1 instead.",
    );
  });

  it('handles simple provider prefix with JSON body', () => {
    const raw = 'OpenAI API error (429): {"error":{"message":"Rate limit exceeded"}}';
    expect(formatProviderErrorMessage(raw)).toBe('API error (429): Rate limit exceeded');
  });

  it('returns plain errors unchanged', () => {
    expect(formatProviderErrorMessage('Turn timed out')).toBe('Turn timed out');
  });

  it('never returns a bare brace fragment', () => {
    expect(formatProviderErrorMessage('{')).not.toBe('{');
    expect(formatProviderErrorMessage('{\\')).not.toBe('{\\');
  });
});
