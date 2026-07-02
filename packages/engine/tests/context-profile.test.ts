import { describe, expect, it } from 'vitest';
import {
  buildCompletionMessages,
  isCompactContextProfile,
  isCompactToolAllowed,
} from '../src/agent/context-profile.js';

describe('isCompactContextProfile', () => {
  it('returns false for cloud providers', () => {
    expect(isCompactContextProfile('openai', 'gpt-4o')).toBe(false);
    expect(isCompactContextProfile('anthropic', 'claude-sonnet-4')).toBe(false);
    expect(isCompactContextProfile('opencode-zen', 'claude-haiku-4-5')).toBe(false);
  });

  it('returns true for small local models', () => {
    expect(isCompactContextProfile('ollama', 'llama3.2:1b')).toBe(true);
    expect(isCompactContextProfile('lmstudio', 'qwen2.5-0.5b')).toBe(true);
  });

  it('returns false for large local models', () => {
    expect(isCompactContextProfile('ollama', 'llama3.1:8b')).toBe(false);
    expect(isCompactContextProfile('lmstudio', 'mistral:7b')).toBe(false);
  });
});

describe('buildCompletionMessages', () => {
  const sample = [
    { role: 'system', content: 'BASE' },
    { role: 'system', content: 'DIFF UPDATE' },
    { role: 'user', content: 'one' },
    { role: 'assistant', content: 'two' },
    { role: 'user', content: 'three' },
    { role: 'assistant', content: 'four' },
    { role: 'user', content: 'five' },
  ];

  it('passes through all messages when not compact', () => {
    expect(buildCompletionMessages(sample, false)).toHaveLength(sample.length);
  });

  it('keeps baseline system + recent turns when compact', () => {
    const out = buildCompletionMessages(sample, true, 2);
    expect(out[0]).toEqual({ role: 'system', content: 'BASE' });
    expect(out.map((m) => m.content)).toEqual(['BASE', 'two', 'three', 'four', 'five']);
  });
});

describe('isCompactToolAllowed', () => {
  it('allows core tools outside plan mode', () => {
    expect(isCompactToolAllowed('file_read', false)).toBe(true);
    expect(isCompactToolAllowed('shell_exec', false)).toBe(true);
  });

  it('blocks non-core tools', () => {
    expect(isCompactToolAllowed('chart_generate', false)).toBe(false);
  });

  it('respects plan mode allowlist', () => {
    expect(isCompactToolAllowed('file_read', true)).toBe(true);
    expect(isCompactToolAllowed('shell_exec', true)).toBe(false);
  });
});
