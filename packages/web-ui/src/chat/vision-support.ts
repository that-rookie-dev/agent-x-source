export const VISION_KEYWORDS = new Set([
  'gpt-4o', 'gpt-4-turbo', 'claude-3', 'claude-4', 'gemini', 'llava', 'vision', 'pixtral',
  'gpt-5', 'o4-mini',
]);

/**
 * Whether the active model can accept image parts.
 * Prefer explicit `vision` capability when the catalog provides it; fall back to
 * well-known model-name keywords for providers that omit capabilities.
 */
export function supportsVision(
  providerId: string,
  modelId: string,
  capabilities?: readonly string[] | null,
): boolean {
  if (capabilities?.includes('vision')) return true;
  const combined = `${providerId} ${modelId}`.toLowerCase();
  for (const keyword of VISION_KEYWORDS) {
    if (combined.includes(keyword)) return true;
  }
  return false;
}

export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}
