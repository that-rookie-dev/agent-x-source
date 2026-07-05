const BLOCKED_SQL_PATTERNS = [
  /\bATTACH\b/i,
  /\bDETACH\b/i,
  /\bPRAGMA\b/i,
  /\bDROP\b/i,
  /\bALTER\b/i,
  /\bCREATE\b/i,
  /\bINSERT\b/i,
  /\bUPDATE\b/i,
  /\bDELETE\b/i,
  /\bREPLACE\b/i,
  /\bVACUUM\b/i,
  /\bREINDEX\b/i,
];

export function isSafeSqlIdentifier(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

export function assertReadOnlySqlQuery(query: string): void {
  const trimmed = query.trim();
  if (!trimmed) throw new Error('Empty SQL query');
  if (trimmed.startsWith('.')) {
    throw new Error('Meta-commands are not allowed in db_query — use db_schema instead');
  }
  for (const pattern of BLOCKED_SQL_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new Error(`Write/destructive SQL is not allowed via db_query: ${pattern.source}`);
    }
  }
  if (!/^(SELECT|WITH|EXPLAIN)\b/i.test(trimmed)) {
    throw new Error('Only SELECT, WITH, or EXPLAIN queries are allowed via db_query');
  }
}

export function quoteSqlIdentifier(name: string): string {
  if (!isSafeSqlIdentifier(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return `"${name.replace(/"/g, '""')}"`;
}
