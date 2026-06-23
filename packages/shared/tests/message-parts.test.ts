import { describe, it, expect } from 'vitest';
import { sanitizeForJson, stripToolNoise } from '../src/utils/text-sanitize.js';
import { buildPartsFromDbRows } from '../src/utils/message-parts.js';

describe('text-sanitize', () => {
  it('replaces lone surrogates', () => {
    const bad = 'hello \uD800 world';
    expect(sanitizeForJson(bad)).toBe('hello \uFFFD world');
  });

  it('strips tool noise from content', () => {
    const noisy = 'Here is the plan.\n🔧 Calling: file_write({})\n✅ Result: (no output)\nDone.';
    expect(stripToolNoise(noisy)).toBe('Here is the plan.\nDone.');
  });
});

describe('message-parts', () => {
  it('preserves spaces across text-delta chunks', () => {
    const parts = buildPartsFromDbRows([
      { type: 'text-delta', content: "You're " },
      { type: 'text-delta', content: 'good to go!' },
    ]);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.content).toBe("You're good to go!");
  });

  it('preserves word boundaries split across deltas', () => {
    const parts = buildPartsFromDbRows([
      { type: 'text-delta', content: 'Found' },
      { type: 'text-delta', content: ' it! Let me' },
    ]);
    expect(parts[0]?.content).toBe('Found it! Let me');
  });

  it('builds chronological parts from db rows', () => {
    const parts = buildPartsFromDbRows([
      { type: 'text-delta', content: 'Hello world' },
      { type: 'tool-call', tool_call_id: 't1', tool_name: 'glob' },
      { type: 'tool-result', tool_call_id: 't1', tool_name: 'glob', tool_result: 'ok', tool_success: 1 },
    ]);
    expect(parts.some((p) => p.type === 'text' && p.content === 'Hello world')).toBe(true);
    expect(parts.some((p) => p.type === 'tool' && p.tool?.name === 'glob')).toBe(true);
  });

  it('dedupes duplicate tool-call rows and finalizes status', () => {
    const parts = buildPartsFromDbRows([
      { type: 'tool-call', tool_call_id: 't1', tool_name: 'glob' },
      { type: 'tool-call', tool_call_id: 't1', tool_name: 'glob' },
      { type: 'tool-result', tool_call_id: 't1', tool_name: 'glob', tool_result: 'ok', tool_success: 1 },
    ]);
    expect(parts.filter((p) => p.type === 'tool')).toHaveLength(1);
    expect(parts.find((p) => p.type === 'tool')?.tool?.status).toBe('done');
  });
});
