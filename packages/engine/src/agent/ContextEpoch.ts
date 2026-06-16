import { createHash } from 'node:crypto';

export function computeContextEpoch(components: string[]): string {
  const hash = createHash('sha256');
  for (const comp of components) {
    hash.update(comp);
  }
  return hash.digest('hex');
}
