export const VISION_KEYWORDS = new Set([
  'gpt-4o', 'gpt-4-turbo', 'claude-3', 'gemini', 'llava', 'vision', 'pixtral',
]);

export function supportsVision(providerId: string, modelId: string): boolean {
  const combined = `${providerId} ${modelId}`.toLowerCase();
  for (const keyword of VISION_KEYWORDS) {
    if (combined.includes(keyword)) return true;
  }
  return false;
}

export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}
