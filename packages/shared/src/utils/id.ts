import { randomUUID } from 'node:crypto';

export function generateId(prefix?: string): string {
  const id = randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

export function generateSessionId(): string {
  return randomUUID();
}

export function generateMessageId(): string {
  return generateId('msg');
}
