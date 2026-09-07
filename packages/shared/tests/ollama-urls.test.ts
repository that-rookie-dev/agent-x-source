import { describe, it, expect } from 'vitest';
import { ollamaNativeBaseUrl, ollamaOpenAiBaseUrl } from '../src/utils/ollama-urls.js';

describe('ollamaNativeBaseUrl', () => {
  it('defaults to the local Ollama origin', () => {
    expect(ollamaNativeBaseUrl()).toBe('http://localhost:11434');
  });

  it('strips a trailing /v1 so native /api routes stay valid', () => {
    expect(ollamaNativeBaseUrl('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434');
    expect(ollamaNativeBaseUrl('http://127.0.0.1:11434/v1/')).toBe('http://127.0.0.1:11434');
  });
});

describe('ollamaOpenAiBaseUrl', () => {
  it('adds /v1 when the saved URL is the native origin', () => {
    expect(ollamaOpenAiBaseUrl('http://localhost:11434')).toBe('http://localhost:11434/v1');
  });

  it('does not double /v1', () => {
    expect(ollamaOpenAiBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1');
  });
});
