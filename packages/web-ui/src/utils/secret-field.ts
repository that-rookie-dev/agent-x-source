/**
 * Secret fields are never returned to the client.
 * Use `apiKeyConfigured` (or equivalent) from the API instead of key material.
 */

export function hasConfiguredSecret(value?: string | null, configuredFlag?: boolean | null): boolean {
  if (configuredFlag === true) return true;
  if (configuredFlag === false) return false;
  // Legacy: older responses may still include a non-empty placeholder/key string.
  const v = value?.trim() ?? '';
  if (!v) return false;
  if (v.includes('•') || v === '***' || v === '********') return false;
  return true;
}
