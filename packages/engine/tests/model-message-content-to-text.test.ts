import { describe, it, expect } from 'vitest';
import { modelMessageContentToText } from '../src/agent/agent-helpers.js';
import { estimateTokensConservative } from '@agentx/shared';

describe('modelMessageContentToText', () => {
  it('keeps plain text and tool stubs', () => {
    expect(modelMessageContentToText('hello')).toBe('hello');
    expect(modelMessageContentToText([
      { type: 'text', text: 'what is this?' },
      { type: 'tool-call', toolName: 'shell_exec' },
    ])).toBe('what is this?\ntool:shell_exec');
  });

  it('does not explode Uint8Array image parts into per-byte JSON', () => {
    // ~2MB of image bytes would become tens of millions of chars if JSON.stringified.
    const bytes = new Uint8Array(2_000_000);
    bytes[0] = 0xff;
    bytes[1] = 0xd8;
    const text = modelMessageContentToText([
      { type: 'text', text: 'what is this?' },
      { type: 'image', image: bytes, mimeType: 'image/jpeg' },
    ]);
    expect(text).toContain('what is this?');
    expect(text).toContain('[image:image/jpeg:2000000b]');
    expect(text.length).toBeLessThan(200);
    // Conservative token estimate must stay tiny vs the old JSON.stringify path.
    expect(estimateTokensConservative(text)).toBeLessThan(100);
  });

  it('summarizes nested typed arrays via replacer', () => {
    const text = modelMessageContentToText([
      { type: 'unknown', payload: new Uint8Array(10_000) },
    ]);
    expect(text).toContain('[binary:10000b]');
    expect(text.length).toBeLessThan(200);
  });
});
