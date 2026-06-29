/**
 * Strip markdown noise before memory extraction / DB insert.
 * Horizontal rules (---, ***, ___) must never become standalone nodes.
 */

const HR_LINE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const HR_CHARS_ONLY = /^[-*_=\s]{3,}$/;

/** Remove markdown horizontal rules and collapse blank runs. */
export function sanitizeIngestText(text: string): string {
  const lines = text.split('\n');
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (kept.length > 0 && kept[kept.length - 1] !== '') kept.push('');
      continue;
    }
    if (HR_LINE.test(trimmed) || HR_CHARS_ONLY.test(trimmed)) continue;
    kept.push(line);
  }

  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** True when label/content is only a markdown divider or punctuation. */
export function isDividerOnlyNode(label: string, content: string): boolean {
  const probe = (s: string) => {
    const t = s.trim();
    if (!t) return true;
    if (HR_LINE.test(t) || HR_CHARS_ONLY.test(t)) return true;
    if (/^[-–—]{2,}$/.test(t)) return true;
    return false;
  };
  return probe(label) && probe(content);
}

/** Drop divider-only nodes and edges that reference removed ids. */
export function filterDividerNodes<
  T extends { id?: string; label: string; content: string },
  E extends { sourceNodeId: string; targetNodeId: string },
>(nodes: T[], edges: E[]): { nodes: T[]; edges: E[] } {
  const kept = nodes.filter((n) => !isDividerOnlyNode(n.label, n.content));
  const keptIds = new Set(kept.map((n) => n.id).filter(Boolean) as string[]);
  const filteredEdges = edges.filter(
    (e) => keptIds.has(e.sourceNodeId) && keptIds.has(e.targetNodeId),
  );
  return { nodes: kept, edges: filteredEdges };
}
