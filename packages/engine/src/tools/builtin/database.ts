import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { assertReadOnlySqlQuery, isSafeSqlIdentifier, quoteSqlIdentifier } from '../sql-safety.js';

export async function dbQuery(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const query = args['query'] as string;
  const dbFile = args['database'] as string | undefined;
  const cwd = resolve(context.scopePath);

  if (dbFile) {
    const dbPath = resolve(cwd, dbFile);
    if (!existsSync(dbPath)) {
      return { success: false, output: 'Database file not found', error: 'NOT_FOUND' };
    }

    try {
      assertReadOnlySqlQuery(query);
      const output = execFileSync('sqlite3', [dbPath, query, '-header', '-separator', '|'], {
        cwd,
        encoding: 'utf-8',
        timeout: 15000,
      });
      return { success: true, output: output.trim() || '(no results)' };
    } catch (error) {
      const err = error as { stderr?: string; message: string };
      return { success: false, output: err.stderr ?? err.message, error: 'QUERY_ERROR' };
    }
  }

  return { success: false, output: 'Provide a database file path', error: 'MISSING_DB' };
}

export async function dbSchema(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const dbFile = args['database'] as string;
  const table = args['table'] as string | undefined;
  const dbPath = resolve(context.scopePath, dbFile);

  if (!existsSync(dbPath)) {
    return { success: false, output: 'Database file not found', error: 'NOT_FOUND' };
  }

  try {
    if (table && !isSafeSqlIdentifier(table)) {
      return { success: false, output: `Invalid table name: ${table}`, error: 'SCHEMA_ERROR' };
    }
    const safeQuery = table ? `.schema ${table.replace(/[^A-Za-z0-9_]/g, '')}` : '.tables';
    const output = execFileSync('sqlite3', [dbPath, safeQuery], {
      encoding: 'utf-8',
      timeout: 10000,
    });
    return { success: true, output: output.trim() || '(empty database)' };
  } catch (error) {
    return { success: false, output: (error as Error).message, error: 'SCHEMA_ERROR' };
  }
}

export async function dbExport(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const dbFile = args['database'] as string;
  const table = args['table'] as string;
  const format = (args['format'] as string) ?? 'csv';
  const dbPath = resolve(context.scopePath, dbFile);

  if (!existsSync(dbPath)) {
    return { success: false, output: 'Database file not found', error: 'NOT_FOUND' };
  }

  if (!isSafeSqlIdentifier(table)) {
    return { success: false, output: `Invalid table name: ${table}`, error: 'EXPORT_ERROR' };
  }

  try {
    const sql = `SELECT * FROM ${quoteSqlIdentifier(table)} LIMIT 100`;
    let output: string;
    if (format === 'csv') {
      output = execFileSync('sqlite3', [dbPath, '-header', '-csv', sql], { encoding: 'utf-8', timeout: 10000 });
    } else {
      output = execFileSync('sqlite3', [dbPath, '-header', '-separator', '\t', sql], { encoding: 'utf-8', timeout: 10000 });
    }
    return { success: true, output: output.trim() };
  } catch (error) {
    return { success: false, output: (error as Error).message, error: 'EXPORT_ERROR' };
  }
}

export async function envRead(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = (args['file'] as string) ?? '.env';
  const envPath = resolve(context.scopePath, file);

  if (!existsSync(envPath)) {
    return { success: false, output: `${file} not found`, error: 'NOT_FOUND' };
  }

  const content = readFileSync(envPath, 'utf-8');
  const masked = content
    .split('\n')
    .map((line) => {
      if (line.startsWith('#') || !line.includes('=')) return line;
      const [key] = line.split('=');
      return `${key}=***`;
    })
    .join('\n');

  return { success: true, output: masked, metadata: { note: 'Values masked for security' } };
}

export async function dbMigrate(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const dbFile = args['database'] as string;
  const migrationsDir = args['migrationsDir'] as string;
  const dbPath = resolve(context.scopePath, dbFile);
  const migDir = resolve(context.scopePath, migrationsDir);

  if (!existsSync(migrationsDir) && !existsSync(migDir)) {
    return { success: false, output: `Migrations directory not found: ${migrationsDir}`, error: 'NOT_FOUND' };
  }
  const actualMigDir = existsSync(migDir) ? migDir : resolve(context.scopePath, migrationsDir);

  try {
    execFileSync('sqlite3', [dbPath, 'CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE, applied_at TEXT DEFAULT CURRENT_TIMESTAMP);'], { encoding: 'utf-8', timeout: 5000 });

    const files = readdirSync(actualMigDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      return { success: true, output: 'No migration files found' };
    }

    const applied = execFileSync('sqlite3', [dbPath, 'SELECT name FROM _migrations;'], { encoding: 'utf-8', timeout: 5000 });
    const appliedSet = new Set(applied.trim().split('\n').filter(Boolean));

    const results: string[] = [];
    for (const file of files) {
      if (appliedSet.has(file)) {
        results.push(`SKIP ${file} (already applied)`);
        continue;
      }
      const sql = readFileSync(`${actualMigDir}/${file}`, 'utf-8');
      try {
        execFileSync('sqlite3', [dbPath, sql], { encoding: 'utf-8', timeout: 30000 });
        execFileSync('sqlite3', [dbPath, `INSERT INTO _migrations (name) VALUES ('${file.replace(/'/g, "''")}');`], { encoding: 'utf-8', timeout: 5000 });
        results.push(`OK   ${file}`);
      } catch (err) {
        results.push(`FAIL ${file}: ${(err as Error).message}`);
        return { success: false, output: results.join('\n'), error: 'MIGRATE_ERROR' };
      }
    }

    return { success: true, output: results.join('\n'), metadata: { total: files.length, applied: results.filter(r => r.startsWith('OK')).length } };
  } catch (error) {
    return { success: false, output: `Migration failed: ${(error as Error).message}`, error: 'MIGRATE_ERROR' };
  }
}
