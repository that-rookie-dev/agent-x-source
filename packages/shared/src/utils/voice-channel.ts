export const VOICE_BLOCK_OPEN = '⟨voice⟩';
export const VOICE_BLOCK_CLOSE = '⟨/voice⟩';

/** Drop LLM token bleed before the voice opener (e.g. stray CJK characters). */
export function normalizeVoiceAssistantContent(content: string): string {
  const idx = content.indexOf(VOICE_BLOCK_OPEN);
  if (idx > 0) return content.slice(idx);
  return content;
}
