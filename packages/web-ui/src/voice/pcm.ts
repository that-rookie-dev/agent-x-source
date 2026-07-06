export const VOICE_SAMPLE_RATE = 16_000;

export function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

export function int16ToFloat32(input: Int16Array): Float32Array {
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    output[i] = input[i]! / (input[i]! < 0 ? 0x8000 : 0x7fff);
  }
  return output;
}

export function mergeInt16Chunks(chunks: Int16Array[]): Int16Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Int16Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

export function int16ToBase64(input: Int16Array): string {
  return Buffer.from(input.buffer, input.byteOffset, input.byteLength).toString('base64');
}

export function base64ToInt16(base64: string): Int16Array {
  const buf = Buffer.from(base64, 'base64');
  return new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
}
