/** Client-side text helpers (mirrors @agentx/shared). */

export function sanitizeForJson(text: string): string {
  if (!text) return text;
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

const TOOL_NOISE = [
  /\n?🔧 Calling: [^\n]+/g,
  /\n?✅ Result: [^\n]+/g,
  /\n?━{10,}[^\n]*/g,
  /\n?\[STEP \d+\][^\n]*/g,
  /\n?\[STEP \d+ COMPLETE\][^\n]*/g,
];

export function stripToolNoise(content: string, options?: { trim?: boolean }): string {
  if (!content) return '';
  let out = content;
  for (const re of TOOL_NOISE) out = out.replace(re, '');
  out = out.replace(/\n{3,}/g, '\n\n');
  return options?.trim === false ? out : out.trim();
}

/**
 * Repair common stream concatenation glitches for display/restore.
 * Keep in sync with @agentx/shared/utils/stream-text.ts
 */
export function repairStreamTextGlitches(text: string): string {
  if (!text || text.length < 4) return text;

  let out = text;
  out = out.replace(/^([A-Za-z]{1,30})\1(?=\s|[a-z])/g, '$1');

  const minClause = 24;
  const maxScan = Math.floor(out.length / 2);
  for (let len = maxScan; len >= minClause; len--) {
    const tail = out.slice(-len);
    const firstIdx = out.indexOf(tail);
    if (firstIdx > 0 && firstIdx + len <= out.length - len) {
      let trimAt = out.length - len;
      while (trimAt > 0 && /[\s:;,]/.test(out[trimAt - 1]!)) trimAt--;
      out = out.slice(0, trimAt);
      break;
    }
  }

  return out;
}

/** When parts[] exist, only show text from parts — not the combined content field. */
export function displayContent(message: { content?: string; parts?: Array<{ type: string; content?: string }> }): string {
  if (message.parts?.length) {
    const raw = message.parts
      .filter((p) => p.type === 'text' && p.content)
      .map((p) => p.content!)
      .join('');
    return repairStreamTextGlitches(stripToolNoise(raw));
  }
  return repairStreamTextGlitches(stripToolNoise(message.content || ''));
}
