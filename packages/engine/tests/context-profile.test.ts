import { describe, expect, it } from 'vitest';
import {
  buildCompletionMessages,
  isCompactContextProfile,
  isCompactToolAllowed,
  normalizeAiSdkMessages,
  normalizeAiSdkMessagesForProvider,
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

  it('passes through all messages for non-Google providers', () => {
    expect(buildCompletionMessages(sample, false)).toHaveLength(sample.length);
    expect(buildCompletionMessages(sample, false, 3, 'openai')).toHaveLength(sample.length);
  });

  it('merges leading system messages for Google', () => {
    const out = buildCompletionMessages(sample, false, 3, 'google');
    expect(out[0]).toEqual({ role: 'system', content: 'BASE\n\nDIFF UPDATE' });
    expect(out).toHaveLength(sample.length - 1);
  });

  it('keeps baseline system + recent turns when compact', () => {
    const out = buildCompletionMessages(sample, true, 2);
    expect(out[0]).toEqual({ role: 'system', content: 'BASE' });
    expect(out.map((m) => m.content)).toEqual(['BASE', 'two', 'three', 'four', 'five']);
  });
});

describe('normalizeAiSdkMessagesForProvider', () => {
  it('passes through unchanged for non-Google providers', () => {
    const input = [
      { role: 'system', content: 'BASE' },
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'LEDGER' },
    ];
    expect(normalizeAiSdkMessagesForProvider(input, 'anthropic')).toEqual(input);
  });

  it('normalizes for Google', () => {
    const out = normalizeAiSdkMessagesForProvider([
      { role: 'system', content: 'BASE' },
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'LEDGER' },
    ], 'google');
    expect(out[0]).toEqual({ role: 'system', content: 'BASE' });
    expect(out[2]).toEqual({
      role: 'user',
      content: '[SYSTEM NOTE]\nLEDGER\n[/SYSTEM NOTE]',
    });
  });
});

describe('normalizeAiSdkMessages', () => {
  it('merges consecutive leading system messages', () => {
    const out = normalizeAiSdkMessages([
      { role: 'system', content: 'A' },
      { role: 'system', content: 'B' },
      { role: 'user', content: 'hi' },
    ]);
    expect(out).toEqual([
      { role: 'system', content: 'A\n\nB' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('converts mid-conversation system messages to user notes', () => {
    const out = normalizeAiSdkMessages([
      { role: 'system', content: 'BASE' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'system', content: 'LEDGER' },
      { role: 'user', content: 'next' },
    ]);
    expect(out[0]).toEqual({ role: 'system', content: 'BASE' });
    expect(out[3]).toEqual({
      role: 'user',
      content: '[SYSTEM NOTE]\nLEDGER\n[/SYSTEM NOTE]',
    });
    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user', 'user']);
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
    // Plan mode blocks edit/delete tools; shell and reads remain available.
    expect(isCompactToolAllowed('file_patch', true)).toBe(false);
    expect(isCompactToolAllowed('shell_exec', true)).toBe(true);
  });

  it('allows integration tools in compact context', () => {
    expect(isCompactToolAllowed('integration__gmail__search_emails', false)).toBe(true);
    expect(isCompactToolAllowed('integration__gmail__send_email', true)).toBe(false);
    expect(isCompactToolAllowed('integration__gmail__read_email', true)).toBe(true);
    expect(isCompactToolAllowed('chart_generate', false)).toBe(false);
  });
});
