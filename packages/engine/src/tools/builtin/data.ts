import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';

export async function jsonParse(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['file'] as string | undefined;
  const input = args['input'] as string | undefined;

  let raw: string;
  if (file) {
    const filePath = resolve(context.scopePath, file);
    if (!existsSync(filePath)) return { success: false, output: 'File not found', error: 'NOT_FOUND' };
    raw = readFileSync(filePath, 'utf-8');
  } else if (input) {
    raw = input;
  } else {
    return { success: false, output: 'Provide file or input', error: 'MISSING_INPUT' };
  }

  try {
    const data = JSON.parse(raw);
    return { success: true, output: JSON.stringify(data, null, 2) };
  } catch (error) {
    return { success: false, output: `Invalid JSON: ${(error as Error).message}`, error: 'PARSE_ERROR' };
  }
}

export async function jsonQuery(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = resolve(context.scopePath, args['file'] as string);
  const path = args['path'] as string; // dot-notation path like "a.b.c"

  if (!existsSync(file)) return { success: false, output: 'File not found', error: 'NOT_FOUND' };

  try {
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    const parts = path.split('.');
    let current: unknown = data;

    for (const part of parts) {
      if (current == null || typeof current !== 'object') {
        return { success: false, output: `Path "${path}" not found`, error: 'PATH_ERROR' };
      }
      current = (current as Record<string, unknown>)[part];
    }

    return { success: true, output: JSON.stringify(current, null, 2) };
  } catch (error) {
    return { success: false, output: (error as Error).message, error: 'QUERY_ERROR' };
  }
}

export async function jsonSet(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = resolve(context.scopePath, args['file'] as string);
  const path = args['path'] as string;
  const value = args['value'];

  if (!existsSync(file)) return { success: false, output: 'File not found', error: 'NOT_FOUND' };

  try {
    const data = JSON.parse(readFileSync(file, 'utf-8'));
    const parts = path.split('.');
    let current: Record<string, unknown> = data as Record<string, unknown>;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (current[part] == null || typeof current[part] !== 'object') {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]!] = value;
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
    return { success: true, output: `Set ${path} = ${JSON.stringify(value)}` };
  } catch (error) {
    return { success: false, output: (error as Error).message, error: 'SET_ERROR' };
  }
}

export async function csvParse(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = resolve(context.scopePath, args['file'] as string);
  const delimiter = (args['delimiter'] as string) ?? ',';
  const limit = (args['limit'] as number) ?? 20;

  if (!existsSync(file)) return { success: false, output: 'File not found', error: 'NOT_FOUND' };

  const content = readFileSync(file, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim());
  const headers = lines[0]!.split(delimiter).map((h) => h.trim());
  const rows = lines.slice(1, limit + 1).map((line) => {
    const values = line.split(delimiter).map((v) => v.trim());
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = values[i] ?? ''; });
    return obj;
  });

  return {
    success: true,
    output: JSON.stringify(rows, null, 2),
    metadata: { headers, totalRows: lines.length - 1, shownRows: rows.length },
  };
}

export async function textTransform(args: Record<string, unknown>): Promise<ToolResult> {
  const input = args['input'] as string;
  const operation = args['operation'] as string;

  let output: string;
  switch (operation) {
    case 'uppercase': output = input.toUpperCase(); break;
    case 'lowercase': output = input.toLowerCase(); break;
    case 'trim': output = input.trim(); break;
    case 'lines': output = `${input.split('\n').length} lines`; break;
    case 'words': output = `${input.split(/\s+/).filter(Boolean).length} words`; break;
    case 'chars': output = `${input.length} characters`; break;
    case 'reverse': output = input.split('').reverse().join(''); break;
    case 'base64_encode': output = Buffer.from(input).toString('base64'); break;
    case 'base64_decode': output = Buffer.from(input, 'base64').toString('utf-8'); break;
    default: return { success: false, output: `Unknown operation: ${operation}`, error: 'INVALID_OP' };
  }

  return { success: true, output };
}
