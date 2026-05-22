import { nanoid } from 'nanoid';

export function generateId(prefix?: string): string {
  const id = nanoid(21);
  return prefix ? `${prefix}_${id}` : id;
}

export function generateSessionId(): string {
  return generateId('sess');
}

export function generateMessageId(): string {
  return generateId('msg');
}
