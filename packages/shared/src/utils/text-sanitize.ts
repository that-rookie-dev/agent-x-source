/**
 * Remove lone UTF-16 surrogates that break JSON serialization for LLM APIs.
 */
export function sanitizeForJson(text: string): string {
  if (!text) return text;
  // Replace unpaired surrogates with U+FFFD
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

/** Patterns injected into assistant content by the stream handler (legacy + current). */
const TOOL_NOISE_PATTERNS = [
  /\n?🔧 Calling: [^\n]+/g,
  /\n?✅ Result: [^\n]+/g,
  /\n?━{10,}[^\n]*\n?/g,
  /\n?\[STEP \d+\][^\n]*/g,
  /\n?\[STEP \d+ COMPLETE\][^\n]*/g,
];

/** Strip tool-call/result noise from persisted or streamed assistant text. */
export function stripToolNoise(content: string, options?: { trim?: boolean }): string {
  if (!content) return '';
  let out = content;
  for (const re of TOOL_NOISE_PATTERNS) {
    out = out.replace(re, '');
  }
  out = out.replace(/\n{3,}/g, '\n\n');
  return options?.trim === false ? out : out.trim();
}
