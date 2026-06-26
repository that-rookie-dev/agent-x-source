import type { RawMatchRow } from './CrewMatchService.js';

/** Tokens too vague to count as a real domain/subject match on their own. */
export const GENERIC_SEARCH_TOKENS = new Set([
  'know', 'about', 'help', 'information', 'learn', 'understanding', 'understand',
  'explain', 'tell', 'show', 'give', 'find', 'get', 'ask', 'question', 'answer',
  'topic', 'subject', 'thing', 'things', 'stuff', 'something', 'anything',
  'more', 'much', 'many', 'some', 'good', 'best', 'better', 'right', 'correct',
]);

export function rowSearchBlob(row: RawMatchRow): string {
  return [
    row.title,
    row.categoryLabel,
    row.description,
    row.name,
    row.callsign,
    ...row.expertise,
    ...row.traits,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function tokenMatchesBlob(token: string, blob: string): boolean {
  const t = token.toLowerCase().trim();
  if (t.length < 3) return false;
  if (blob.includes(t)) return true;
  // Compound variants: blackholes ↔ black hole
  if (t.length >= 6) {
    const spaced = t.replace(/([a-z])(holes?|ology|ical|ics|ist|ism|tion|ment)$/i, '$1 $2');
    if (spaced !== t && blob.includes(spaced)) return true;
  }
  return false;
}

/** True when at least one substantive token appears in the crew profile text. */
export function hasSubstantiveKeywordMatch(row: RawMatchRow, tokens: string[]): boolean {
  const substantive = tokens.filter(
    (t) => t.length >= 3 && !GENERIC_SEARCH_TOKENS.has(t.toLowerCase()),
  );
  if (substantive.length === 0) return false;
  const blob = rowSearchBlob(row);
  return substantive.some((token) => tokenMatchesBlob(token, blob));
}

/** Drop FTS noise — only rows with a real keyword overlap proceed to scoring. */
export function filterSubstantiveMatches(
  rows: RawMatchRow[],
  tokens: string[],
): RawMatchRow[] {
  if (tokens.length === 0) return [];
  return rows.filter((row) => hasSubstantiveKeywordMatch(row, tokens));
}
