/** Tokenize user text for FTS / tsvector queries (Postgres semantics). */
export function tokenizeFtsQuery(query: string, minLength = 3): string[] {
  return query
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= minLength)
    .slice(0, 12)
    .map((w) => w.replace(/"/g, ''));
}

/** Hub search — shorter tokens + prefix matching for in-progress typing. */
export function tokenizeHubSearchQuery(query: string): string[] {
  return tokenizeFtsQuery(query, 2);
}

/** Postgres to_tsquery string — OR across tokens. */
export function buildPostgresTsQuery(query: string): string {
  const words = tokenizeFtsQuery(query);
  if (words.length === 0) return '';
  return words
    .map((w) => w.replace(/[&|!():*'\\]/g, ' ').trim())
    .filter(Boolean)
    .join(' | ');
}

/** Postgres prefix tsquery for hub catalog search. */
export function buildPostgresHubTsQuery(query: string): string {
  const words = tokenizeHubSearchQuery(query);
  if (words.length === 0) return '';
  return words
    .map((w) => w.replace(/[&|!():*'\\]/g, ' ').trim())
    .filter(Boolean)
    .map((w) => `${w}:*`)
    .join(' | ');
}
