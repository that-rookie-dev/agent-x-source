/** Must match web-api `config-redaction.ts` placeholder sent to the browser. */
export const REDACTED_SECRET = '••••••••';

export function isRedactedSecret(value?: string | null): boolean {
  return value === REDACTED_SECRET;
}

export function hasConfiguredSecret(value?: string | null): boolean {
  return Boolean(value?.trim()) && !isRedactedSecret(value);
}
