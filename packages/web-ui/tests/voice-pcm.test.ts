import { describe, it, expect } from 'vitest';
import { floatTo16BitPCM, mergeInt16Chunks, int16ToBase64, base64ToInt16 } from '../src/voice/pcm.js';

describe('pcm helpers', () => {
  it('converts float samples to 16-bit PCM', () => {
    const pcm = floatTo16BitPCM(new Float32Array([0, 1, -1]));
    expect(pcm[1]).toBe(0x7fff);
    expect(pcm[2]).toBe(-0x8000);
  });

  it('merges PCM chunks', () => {
    const merged = mergeInt16Chunks([new Int16Array([1, 2]), new Int16Array([3])]);
    expect(Array.from(merged)).toEqual([1, 2, 3]);
  });

  it('roundtrips base64 PCM', () => {
    const original = new Int16Array([10, 20, 30]);
    const restored = base64ToInt16(int16ToBase64(original));
    expect(Array.from(restored)).toEqual(Array.from(original));
  });
});
