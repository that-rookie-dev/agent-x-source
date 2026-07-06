import { describe, it, expect } from 'vitest';
import { decodeBinaryAudioChunk } from '../src/voice/playback.js';

describe('playback helpers', () => {
  it('decodes binary audio chunks as int16 PCM', () => {
    const buf = new ArrayBuffer(4);
    const view = new Int16Array(buf);
    view[0] = 42;
    view[1] = -42;
    const pcm = decodeBinaryAudioChunk(buf);
    expect(pcm[0]).toBe(42);
    expect(pcm[1]).toBe(-42);
  });
});
