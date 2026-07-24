/**
 * Build contextualized text for embedding so vectors carry topic, not only local wording.
 */

export interface EmbedTextInput {
  title: string;
  headingPath?: string[];
  body: string;
}

/** Normalize whitespace for stable embed strings. */
export function normalizeEmbedBody(body: string): string {
  return body.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Strip markdown heading markers for path display. */
export function cleanHeadingLabel(heading: string): string {
  return heading.replace(/^#{1,6}\s+/, '').trim();
}

/**
 * Format: `Title › H1 › H2\n\n{body}`
 * Body-only when title empty and no headings.
 */
export function buildEmbedText(input: EmbedTextInput): string {
  const body = normalizeEmbedBody(input.body);
  const title = (input.title || '').trim();
  const path = (input.headingPath ?? [])
    .map(cleanHeadingLabel)
    .filter(Boolean);
  const prefixParts = [title, ...path].filter(Boolean);
  if (prefixParts.length === 0) return body;
  if (!body) return prefixParts.join(' › ');
  return `${prefixParts.join(' › ')}\n\n${body}`;
}

/**
 * Prefer stored provenance.embedText (ingest-time contextualized string),
 * else rebuild from headingPath + content, else raw content.
 */
export function resolveEmbedTextForNode(node: {
  content?: string | null;
  label?: string | null;
  headingPath?: string[] | null;
  provenance?: Record<string, unknown> | null;
}): string {
  const stored = node.provenance?.['embedText'];
  if (typeof stored === 'string' && stored.trim()) return normalizeEmbedBody(stored);

  const headingPath = Array.isArray(node.headingPath) && node.headingPath.length
    ? node.headingPath
    : Array.isArray(node.provenance?.['headingPath'])
      ? (node.provenance!['headingPath'] as string[])
      : [];
  const title = String(node.provenance?.['sourceName'] ?? node.label ?? '').trim();
  const body = node.content ?? '';
  if (title || headingPath.length) {
    return buildEmbedText({ title, headingPath, body });
  }
  return normalizeEmbedBody(body);
}

/** Extract markdown heading path from chunk content (leading # lines / first heading). */
export function extractHeadingPathFromContent(content: string): string[] {
  const path: string[] = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const m = line.trim().match(/^(#{1,6})\s+(.+)$/);
    if (!m) {
      if (line.trim()) break;
      continue;
    }
    const level = m[1]!.length;
    const label = m[2]!.trim();
    while (path.length >= level) path.pop();
    path.push(`${'#'.repeat(level)} ${label}`);
  }
  return path;
}

/** Markdown heading level 1–6, or 1 for ALL-CAPS title-like lines. */
export function headingLevel(line: string): number | null {
  const trimmed = line.trim();
  const md = trimmed.match(/^(#{1,6})\s+/);
  if (md) return md[1]!.length;
  if (/^[A-Z][A-Za-z0-9\s]{2,80}$/.test(trimmed) && trimmed.length < 80) return 1;
  return null;
}

/** Update a heading stack when encountering a heading unit. */
export function pushHeadingPath(path: string[], headingLine: string): string[] {
  const level = headingLevel(headingLine);
  if (level == null) return path;
  const next = path.slice(0, level - 1);
  next.push(headingLine.trim());
  return next;
}
