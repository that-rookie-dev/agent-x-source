/** Alphanumeric charset for ax_* suffixes (case-sensitive, no special characters). */
const AX_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const AX_ID_PATTERN = /^ax_([a-z][a-z0-9_]*)_([a-zA-Z0-9]+)$/;

export type AxEntity = 'auto' | 'run';

/** Fill a byte buffer using Web Crypto (browser/node) with a Math.random fallback. */
function randomBytesCompat(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  const g = globalThis as { crypto?: { getRandomValues?: (arr: Uint8Array) => Uint8Array } };
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(buf);
    return buf;
  }
  for (let i = 0; i < length; i++) buf[i] = Math.floor(Math.random() * 256);
  return buf;
}

/**
 * Generate a professional pseudo ID: `ax_<entity>_<randomAlphanumeric>`.
 * Example: `ax_auto_k9XmP2aBc4Qn`
 */
export function generateAxId(entity: AxEntity, length = 12): string {
  const bytes = randomBytesCompat(length);
  let suffix = '';
  for (let i = 0; i < length; i++) {
    suffix += AX_ID_ALPHABET[bytes[i]! % AX_ID_ALPHABET.length];
  }
  return `ax_${entity}_${suffix}`;
}

/** True when value matches the ax_<entity>_<id> pattern. */
export function isAxId(value: string, entity?: AxEntity): boolean {
  const match = AX_ID_PATTERN.exec(value);
  if (!match) return false;
  return entity ? match[1] === entity : true;
}

export function parseAxId(value: string): { entity: string; suffix: string } | null {
  const match = AX_ID_PATTERN.exec(value);
  if (!match) return null;
  return { entity: match[1]!, suffix: match[2]! };
}
