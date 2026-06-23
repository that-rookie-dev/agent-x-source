import { describe, it, expect } from 'vitest';
import { shouldSuggestMode } from '../src/components/ModeSuggestionModal';

describe('shouldSuggestMode', () => {
  it('does not suggest agent mode for research questions about TTS/STT', () => {
    const msg =
      'which is the best local model to convert text-to-speech and speech-to-text with low latency and less RAM usage?';
    expect(shouldSuggestMode(msg)).toBe(false);
  });

  it('suggests agent mode for clear implementation requests', () => {
    expect(shouldSuggestMode('please create a new React component for the login form')).toBe(true);
  });

  it('does not suggest for short messages', () => {
    expect(shouldSuggestMode('build it')).toBe(false);
  });

  it('does not suggest for comparison questions', () => {
    expect(shouldSuggestMode('what is the best database to use for a small side project?')).toBe(false);
  });
});
