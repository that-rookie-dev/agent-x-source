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
 * - Leading token doubled without space (TheThe, NowNow)
 * - Trailing clause duplicated when prefixLen/stream state desyncs
 */
export function repairStreamTextGlitches(text: string): string {
  if (!text || text.length < 4) return text;

  let out = text;

  // TheThe / NowNow — same token repeated at the start with no space
  out = out.replace(/^([A-Za-z]{1,30})\1(?=\s|[a-z])/g, '$1');

  // Trailing duplicate clause (same substring appears earlier, non-overlapping)
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
