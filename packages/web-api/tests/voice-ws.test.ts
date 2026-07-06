import { describe, it, expect } from 'vitest';
import { extractAssistantText } from '../src/voice-ws.js';

describe('voice-ws helpers', () => {
  it('extracts string content from assistant messages', () => {
    expect(extractAssistantText({ content: 'Hello there' })).toBe('Hello there');
  });

  it('extracts text parts from structured messages', () => {
    expect(extractAssistantText({ parts: [{ text: 'Line 1' }, { text: 'Line 2' }] })).toBe('Line 1\nLine 2');
  });

  it('returns empty string for invalid payloads', () => {
    expect(extractAssistantText(null)).toBe('');
    expect(extractAssistantText({})).toBe('');
  });
});
