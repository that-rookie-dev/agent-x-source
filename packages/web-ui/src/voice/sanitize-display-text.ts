/**
 * Strip LLM token bleed / markup from voice/call text before showing it to users.
 * Mirrors web-api sanitizeSpeakableText (e.g. ]<]minimax[>[).
 */

const LLM_TOKEN_BLEED_RE = /\]?<\]?[a-zA-Z0-9_-]+\[?>?\[?/g;
const XML_LIKE_TAG_RE = /<\/?[a-zA-Z_][^>]*>/g;
/** Mathematical angle brackets ⟨ ⟩ and common lookalikes 〈 › ‹. */
const VOICE_OPEN = '[⟨〈‹]\\s*voice\\s*[⟩〉›]';
const VOICE_CLOSE = '[⟨〈‹]\\s*/\\s*voice\\s*[⟩〉›]';
const VOICE_BLOCK_RE = new RegExp(`${VOICE_OPEN}([\\s\\S]*?)${VOICE_CLOSE}`, 'gi');
const VOICE_TAG_RE = new RegExp(`${VOICE_OPEN}|${VOICE_CLOSE}|</?voice>`, 'gi');

export function sanitizeVoiceDisplayText(text: string): string {
  if (!text) return '';
  let out = text;
  // Prefer inner voice-block content when present
  const blocks = [...out.matchAll(VOICE_BLOCK_RE)].map((m) => (m[1] ?? '').trim()).filter(Boolean);
  if (blocks.length > 0) {
    out = blocks.join(' ');
  }
  // Always strip any leftover voice wrappers (complete or orphaned).
  out = out.replace(VOICE_TAG_RE, ' ');
  out = out.replace(XML_LIKE_TAG_RE, ' ');
  out = out.replace(LLM_TOKEN_BLEED_RE, ' ');
  // Stray brackets left by partial token bleed / markup
  out = out.replace(/[<>[\]⟨〉‹›]/g, ' ');
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}
