import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';

export async function dbQuery(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const query = args['query'] as string;
  const dbFile = args['database'] as string | undefined;
  const cwd = resolve(context.scopePath);

  // SQLite by default
  if (dbFile) {
    const dbPath = resolve(cwd, dbFile);
    if (!existsSync(dbPath)) {
      return { success: false, output: 'Database file not found', error: 'NOT_FOUND' };
    }

    try {
      const output = execSync(`sqlite3 "${dbPath}" "${query.replace(/"/g, '\\"')}" -header -separator '|'`, {
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
    const query = table
      ? `.schema ${table}`
      : `.tables`;
    const output = execSync(`sqlite3 "${dbPath}" "${query}"`, {
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

  try {
    let cmd: string;
    if (format === 'csv') {
      cmd = `sqlite3 "${dbPath}" -header -csv "SELECT * FROM ${table} LIMIT 100"`;
    } else {
      cmd = `sqlite3 "${dbPath}" -header -separator '\t' "SELECT * FROM ${table} LIMIT 100"`;
    }

    const output = execSync(cmd, { encoding: 'utf-8', timeout: 10000 });
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
  // Mask values for security
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
