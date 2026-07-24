import { describe, it, expect } from 'vitest';
import { appendStreamText, repairStreamTextGlitches } from '../src/utils/stream-text.js';

describe('appendStreamText', () => {
  it('appends normal incremental deltas', () => {
    expect(appendStreamText('The', ' problem')).toBe('The problem');
  });

  it('handles cumulative snapshot chunks', () => {
    expect(appendStreamText('Now', 'Now try running the backend')).toBe('Now try running the backend');
  });

  it('handles TheThe-style cumulative duplication', () => {
    expect(appendStreamText('The', 'The problem is')).toBe('The problem is');
  });

  it('ignores duplicate delta re-send', () => {
    expect(appendStreamText('Hello', 'Hello')).toBe('Hello');
    expect(appendStreamText('Hello world', 'world')).toBe('Hello world');
  });

  it('handles overlap at boundary', () => {
    expect(appendStreamText('abc', 'bcd')).toBe('abcd');
  });
});

describe('repairStreamTextGlitches', () => {
  it('fixes leading doubled token', () => {
    expect(repairStreamTextGlitches('TheThe problem is here')).toBe('The problem is here');
    expect(repairStreamTextGlitches('NowNow try running')).toBe('Now try running');
  });

  it('fixes glued and spaced duplex tokens from reasoning persist bug', () => {
    expect(repairStreamTextGlitches('HTTPHTTP  500500 means means Next Next.js.js')).toBe(
      'HTTP 500 means Next.js',
    );
    expect(repairStreamTextGlitches('pnpm is is available available')).toBe('pnpm is available');
  });

  it('removes trailing duplicate clause', () => {
    const bad =
      'The problem is that the imports are relative: problem is that the imports are relative';
    const fixed = repairStreamTextGlitches(bad);
    expect(fixed).toBe('The problem is that the imports are relative');
  });
});
