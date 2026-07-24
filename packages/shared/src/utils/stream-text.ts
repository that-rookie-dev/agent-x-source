/**
 * Safely append an LLM streaming text chunk to accumulated content.
 * Handles incremental deltas, cumulative snapshots, duplicates, and partial overlaps.
 */
export function appendStreamText(accumulated: string, incoming: string): string {
  if (!incoming) return accumulated;
  if (!accumulated) return incoming;

  // Cumulative snapshot: incoming already contains everything we have
  if (incoming.startsWith(accumulated)) return incoming;

  // Exact duplicate re-send
  if (incoming === accumulated) return accumulated;
  if (accumulated.endsWith(incoming)) return accumulated;

  // Overlap: incoming continues where accumulated left off (normal token delta)
  const maxOverlap = Math.min(accumulated.length, incoming.length);
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    if (accumulated.endsWith(incoming.slice(0, overlap))) {
      return accumulated + incoming.slice(overlap);
    }
  }

  return accumulated + incoming;
}

/** Extract text delta from AI SDK / provider stream events (field names vary). */
export function extractStreamTextDelta(event: Record<string, unknown>): string {
  const candidates = [
    event['textDelta'],
    event['delta'],
    event['text'],
    event['content'],
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return '';
}

/**
 * Repair common stream concatenation glitches for display/restore.
 * - Whole-token glued doubles (TheThe, HTTPHTTP) — never mid-word pairs like nn in running
 * - Spaced token doubles from duplex persist (means means, is is)
 * - Extension doubles (.js.js)
 * - Trailing clause duplicated when stream state desyncs
 */
export function repairStreamTextGlitches(text: string): string {
  if (!text || text.length < 4) return text;

  let out = text;

  // Exact whole-word glued doubles: HTTPHTTP, TheThe, NowNow (min length 2)
  for (let i = 0; i < 6; i++) {
    const next = out.replace(/\b([A-Za-z]{2,24})\1\b/g, '$1');
    if (next === out) break;
    out = next;
  }

  // Numeric glued doubles: 500500
  out = out.replace(/\b(\d{1,12})\1\b/g, '$1');

  // Extension doubles: .js.js / .tsx.tsx
  out = out.replace(/(\.[A-Za-z][A-Za-z0-9]{0,7})\1\b/g, '$1');

  // Spaced token doubles from duplex deltas: "means means", "is is", "Next Next"
  for (let i = 0; i < 8; i++) {
    const next = out.replace(/\b([A-Za-z0-9][A-Za-z0-9._-]{0,40})\s+\1\b/g, '$1');
    if (next === out) break;
    out = next;
  }

  // Collapse runs of spaces left by removed duplicate tokens
  out = out.replace(/[^\S\n]{2,}/g, ' ');

  // Trailing duplicate clause (same substring appears earlier, non-overlapping).
  // Only trim when the duplicate is a substantial clause — avoid cutting normal endings.
  const minClause = 40;
  const maxScan = Math.floor(out.length / 2);
  for (let len = maxScan; len >= minClause; len--) {
    const tail = out.slice(-len);
    if (!/^[\sA-Za-z"'`]/.test(tail)) continue;
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
