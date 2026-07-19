/**
 * Strip LLM token bleed / markup from voice/call text before showing it to users.
 * Mirrors web-api sanitizeSpeakableText (e.g. ]<]minimax[>[).
 */

const LLM_TOKEN_BLEED_RE = /\]?<\]?[a-zA-Z0-9_-]+\[?>?\[?/g;
const XML_LIKE_TAG_RE = /<\/?[a-zA-Z_][^>]*>/g;
const VOICE_BLOCK_RE = /⟨voice⟩([\s\S]*?)⟨\/voice⟩/gi;

export function sanitizeVoiceDisplayText(text: string): string {
  if (!text) return '';
  let out = text;
  // Prefer inner voice-block content when present
  const blocks = [...out.matchAll(VOICE_BLOCK_RE)].map((m) => (m[1] ?? '').trim()).filter(Boolean);
  if (blocks.length > 0) {
    out = blocks.join(' ');
  } else {
    out = out
      .replace(/⟨\/?voice⟩/gi, ' ')
      .replace(/<\/?voice>/gi, ' ');
  }
  out = out.replace(XML_LIKE_TAG_RE, ' ');
  out = out.replace(LLM_TOKEN_BLEED_RE, ' ');
  // Stray brackets left by partial token bleed
  out = out.replace(/[<>[\]]/g, ' ');
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}
