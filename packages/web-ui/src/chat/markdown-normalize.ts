import { repairTreeDiagrams, repairPlainTreeFences, isTreeDiagramContent } from './tree-diagram.js';
import { repairPipelineDiagrams, repairPlainPipelineFences, isPipelineDiagramContent, isHorizontalPipelineContent } from './pipeline-diagram.js';

/** Max width for assistant plain-text-only bubbles (share of chat column). */
export const PLAIN_TEXT_BUBBLE_MAX_WIDTH = '70%';

const EMOJI_PREFIX = /^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u;

/** Detect standalone ALL-CAPS section titles (common in LLM output). */
function isAllCapsHeader(line: string): boolean {
  const trimmed = line.replace(EMOJI_PREFIX, '').trim();
  if (trimmed.length < 6 || trimmed.length > 120) return false;
  const letters = trimmed.replace(/[^A-Za-z]/g, '');
  if (letters.length < 4) return false;
  return letters === letters.toUpperCase();
}

function parseTableCells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return [];
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((c) => c.trim());
}

function isSeparatorRow(line: string): boolean {
  const cells = parseTableCells(line);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith('|') && t.endsWith('|') && t.includes('|');
}

function buildSeparator(columnCount: number): string {
  const cells = Array.from({ length: columnCount }, () => '---');
  return `| ${cells.join(' | ')} |`;
}

/** Split table rows accidentally concatenated on one line: `| a | b | | c | d |` */
function expandCollapsedTableLine(line: string): string[] {
  const trimmed = line.trim();
  if (!isTableRow(trimmed) || !/\|\s+\|/.test(trimmed)) return [line];

  const segments = trimmed.split(/\|\s+\|/).map((seg, idx, arr) => {
    if (idx === 0) return seg.startsWith('|') ? `${seg} |` : `| ${seg} |`;
    if (idx === arr.length - 1) return seg.endsWith('|') ? `| ${seg}` : `| ${seg} |`;
    return `| ${seg} |`;
  });

  if (segments.length < 2) return [line];
  return segments;
}

/** Fix GFM tables: column mismatches, missing separators, collapsed rows. */
export function repairMarkdownTables(content: string): string {
  if (!content || !content.includes('|')) return content;

  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inTable = false;
  let tableHasSeparator = false;

  for (let i = 0; i < lines.length; i++) {
    const expanded = expandCollapsedTableLine(lines[i]!);
    if (expanded.length > 1) {
      inTable = false;
      tableHasSeparator = false;
      for (const row of expanded) out.push(row);
      continue;
    }

    const line = lines[i]!;

    // LLMs often insert a blank line before a summary/total row, which breaks the table.
    // If the gap is followed by a continuation data row (not a new header+separator),
    // drop the gap so the row stays inside the table instead of becoming its own block.
    if (inTable && tableHasSeparator && line.trim() === '') {
      let j = i + 1;
      while (j < lines.length && lines[j]!.trim() === '') j++;
      const cont = j < lines.length ? lines[j]! : '';
      const after = j + 1 < lines.length ? lines[j + 1]! : '';
      if (cont && isTableRow(cont) && !isSeparatorRow(cont) && !isSeparatorRow(after)) {
        i = j - 1;
        continue;
      }
      inTable = false;
      tableHasSeparator = false;
      out.push(line);
      continue;
    }

    if (!isTableRow(line)) {
      inTable = false;
      tableHasSeparator = false;
      out.push(line);
      continue;
    }

    if (isSeparatorRow(line)) {
      if (!inTable) {
        out.push(line);
        continue;
      }
      if (tableHasSeparator) {
        // Skip duplicate separator rows after the header (common LLM artifact).
        continue;
      }
      out.push(line);
      tableHasSeparator = true;
      continue;
    }

    if (!inTable) {
      const headerCols = parseTableCells(line).length;
      if (headerCols < 2) {
        out.push(line);
        continue;
      }

      inTable = true;
      tableHasSeparator = false;
      out.push(line);

      const next = lines[i + 1]?.trim() ?? '';
      if (isSeparatorRow(next)) {
        const sepCols = parseTableCells(next).length;
        out.push(sepCols === headerCols ? lines[i + 1]! : buildSeparator(headerCols));
        tableHasSeparator = true;
        i++;
      } else if (next && isTableRow(next)) {
        out.push(buildSeparator(headerCols));
        tableHasSeparator = true;
      } else if (!next) {
        out.push(buildSeparator(headerCols));
        tableHasSeparator = true;
      }
      continue;
    }

    // Body row — never inject separators between data rows.
    out.push(line);
  }

  return out.join('\n');
}

/** Normalize LLM plain-text conventions into proper markdown for rich rendering. */
export function normalizeAssistantMarkdown(content: string): string {
  if (!content) return content;

  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      out.push(line);
      continue;
    }

    if (inFence) {
      out.push(line);
      continue;
    }

    // Never reinterpret table rows (e.g. an all-caps `| TOTAL | ... |` summary row)
    // as headings/rules — that would drop the row out of the table.
    if (isTableRow(trimmed)) {
      out.push(line);
      continue;
    }

    // Underscore / dash separators → horizontal rule (only outside fences)
    if (/^_{4,}$/.test(trimmed) || /^-{4,}$/.test(trimmed) || /^={4,}$/.test(trimmed)) {
      out.push('---');
      continue;
    }

    // Broken heading: ALL CAPS line with orphan ** suffix but no #
    const brokenBoldHeading = trimmed.match(/^([A-Z][A-Z0-9\s\-()/]+)\*\*$/);
    if (brokenBoldHeading && !trimmed.startsWith('#')) {
      out.push(`## ${brokenBoldHeading[1]!.trim()}`);
      continue;
    }

    // ALL CAPS standalone line → section heading (preserve leading emoji)
    if (isAllCapsHeader(trimmed) && !trimmed.startsWith('#')) {
      out.push(`## ${trimmed.replace(/\*\*$/, '').trim()}`);
      continue;
    }

    // Bold-only line → sub-heading
    const boldOnly = trimmed.match(/^\*\*([^*]+)\*\*\s*$/);
    if (boldOnly) {
      out.push(`#### ${boldOnly[1]!.trim()}`);
      continue;
    }

    out.push(line);
  }

  const joined = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return repairPlainPipelineFences(
    repairPipelineDiagrams(
      repairPlainTreeFences(
        repairTreeDiagrams(repairMarkdownTables(joined)),
      ),
    ),
  );
}

/** Split normalized markdown into card sections (only on explicit --- rules). */
export function splitMarkdownSections(content: string): string[] {
  const normalized = normalizeAssistantMarkdown(content);
  const byRule = normalized.split(/\n---\n/).map((s) => s.trim()).filter(Boolean);
  if (byRule.length > 1) return byRule;
  return normalized ? [normalized] : [];
}

/**
 * Cheap streaming-safe prose check — no full normalize pass.
 * Prefer this on hot stream paths; use isPlainTextMarkdown for settled content.
 */
export function isLikelyPlainProse(content: string): boolean {
  if (!content?.trim()) return false;
  if (content.includes('```')) return false;
  if (/^#{1,6}\s/m.test(content)) return false;
  if (/^>\s?/m.test(content)) return false;
  if (/^[-*+]\s+/m.test(content)) return false;
  if (/^\d+\.\s+/m.test(content)) return false;
  if (/\n---\n/.test(content)) return false;
  if (/\|.+\|/.test(content) && /\n\|?\s*:?-{2,}/.test(content)) return false;
  return true;
}

/** True when assistant content is prose only — no tables, code blocks, lists, headings, or diagram fences. */
export function isPlainTextMarkdown(content: string): boolean {
  if (!content?.trim()) return false;

  const normalized = normalizeAssistantMarkdown(content);
  const sections = normalized.split(/\n---\n/).map((s) => s.trim()).filter(Boolean);
  if (sections.length > 1) return false;

  const text = sections[0] ?? normalized;
  if (isPipelineDiagramContent(text) || isHorizontalPipelineContent(text) || isTreeDiagramContent(text)) {
    return false;
  }

  const lines = text.split('\n');
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      return false;
    }
    if (inFence) return false;

    if (isTableRow(trimmed) || isSeparatorRow(trimmed)) return false;
    if (/^#{1,6}\s/.test(trimmed)) return false;
    if (/^>\s?/.test(trimmed)) return false;
    if (/^[-*+]\s+/.test(trimmed)) return false;
    if (/^\d+\.\s+/.test(trimmed)) return false;
    if (/^_{4,}$/.test(trimmed) || /^-{4,}$/.test(trimmed) || /^={4,}$/.test(trimmed)) return false;
  }

  return true;
}
