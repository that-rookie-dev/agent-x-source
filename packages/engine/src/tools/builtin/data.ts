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

export async function regexMatch(args: Record<string, unknown>): Promise<ToolResult> {
  const text = args['text'] as string;
  const pattern = args['pattern'] as string;
  const flags = (args['flags'] as string) ?? 'g';

  if (!text || !pattern) {
    return { success: false, output: 'text and pattern are required', error: 'MISSING_INPUT' };
  }

  try {
    const regex = new RegExp(pattern, flags);
    const matches: Array<{ match: string; index: number; groups: Record<string, string> }> = [];
    let match: RegExpExecArray | null;
    let count = 0;

    while ((match = regex.exec(text)) !== null && count < 100) {
      const groups: Record<string, string> = {};
      if (match.groups) {
        for (const key of Object.keys(match.groups)) {
          groups[key] = match.groups[key]!;
        }
      }
      matches.push({ match: match[0], index: match.index, groups });
      count++;
      if (!flags.includes('g')) break;
    }

    if (matches.length === 0) {
      return { success: true, output: 'No matches found' };
    }

    const output = matches.map((m, i) =>
      `Match ${i + 1}: "${m.match}" at index ${m.index}${Object.keys(m.groups).length ? '\n  Groups: ' + JSON.stringify(m.groups) : ''}`
    ).join('\n');
    return { success: true, output, metadata: { count: matches.length } };
  } catch (error) {
    return { success: false, output: `Regex error: ${(error as Error).message}`, error: 'REGEX_ERROR' };
  }
}

export async function textDiff(args: Record<string, unknown>): Promise<ToolResult> {
  const text1 = args['text1'] as string;
  const text2 = args['text2'] as string;

  if (text1 === undefined || text2 === undefined) {
    return { success: false, output: 'text1 and text2 are required', error: 'MISSING_INPUT' };
  }

  const lines1 = text1.split('\n');
  const lines2 = text2.split('\n');
  const maxLen = Math.max(lines1.length, lines2.length);
  const diffs: string[] = [];

  for (let i = 0; i < maxLen; i++) {
    const l1 = lines1[i] ?? '';
    const l2 = lines2[i] ?? '';
    if (l1 !== l2) {
      if (l1 && l2) {
        diffs.push(`~ L${i + 1}: "${l1}" → "${l2}"`);
      } else if (l1) {
        diffs.push(`- L${i + 1}: "${l1}"`);
      } else {
        diffs.push(`+ L${i + 1}: "${l2}"`);
      }
    }
  }

  return {
    success: true,
    output: diffs.length > 0 ? diffs.join('\n') : '(texts are identical)',
    metadata: { changedLines: diffs.length, totalLines: maxLen },
  };
}

export async function validateSchema(args: Record<string, unknown>): Promise<ToolResult> {
  const data = args['data'];
  const schema = args['schema'] as Record<string, unknown>;

  if (!data || !schema) {
    return { success: false, output: 'data and schema are required', error: 'MISSING_INPUT' };
  }

  const errors: string[] = [];
  const schemaType = schema['type'] as string | undefined;
  const schemaProps = schema['properties'] as Record<string, unknown> | undefined;
  const schemaRequired = schema['required'] as string[] | undefined;

  // Basic JSON Schema validation
  if (schemaType) {
    const actualType = Array.isArray(data) ? 'array' : typeof data;
    if (actualType !== schemaType && !(schemaType === 'array' && Array.isArray(data))) {
      errors.push(`Type mismatch: expected "${schemaType}", got "${actualType}"`);
    }
  }

  if (schemaRequired && typeof data === 'object' && data !== null && !Array.isArray(data)) {
    for (const field of schemaRequired) {
      if (!(field in (data as Record<string, unknown>))) {
        errors.push(`Missing required field: "${field}"`);
      }
    }
  }

  if (schemaProps && typeof data === 'object' && data !== null && !Array.isArray(data)) {
    for (const [key, propSchema] of Object.entries(schemaProps)) {
      const prop = propSchema as Record<string, unknown>;
      if (key in (data as Record<string, unknown>)) {
        const val = (data as Record<string, unknown>)[key];
        if (prop['type']) {
          const valType = Array.isArray(val) ? 'array' : typeof val;
          if (valType !== prop['type']) {
            errors.push(`Field "${key}": type mismatch, expected "${prop['type']}", got "${valType}"`);
          }
        }
      }
    }
  }

  return {
    success: errors.length === 0,
    output: errors.length > 0 ? `Validation errors:\n${errors.join('\n')}` : 'Validation passed',
    metadata: { valid: errors.length === 0, errorCount: errors.length },
  };
}

export async function renderChart(args: Record<string, unknown>, _context: ToolExecutionContext): Promise<ToolResult> {
  const { parseChartSpec } = await import('@agentx/shared');
  let payload: string;
  if (typeof args['spec'] === 'string') {
    payload = args['spec'];
  } else if (args['spec'] && typeof args['spec'] === 'object') {
    payload = JSON.stringify(args['spec']);
  } else if (typeof args['chart'] === 'string') {
    payload = args['chart'];
  } else if (args['chart'] && typeof args['chart'] === 'object') {
    payload = JSON.stringify(args['chart']);
  } else if (typeof args['type'] === 'string') {
    // Flat ChartSpec passed as tool args
    payload = JSON.stringify(args);
  } else {
    return { success: false, output: 'Provide a ChartSpec object via "spec"', error: 'MISSING_INPUT' };
  }

  const parsed = parseChartSpec(payload);
  if (!parsed.ok) {
    return { success: false, output: `Invalid chart spec: ${parsed.error}`, error: 'INVALID_CHART' };
  }

  const canonical = JSON.stringify(parsed.spec, null, 2);
  return {
    success: true,
    output: [
      'Chart spec validated. Include this fence in your reply (or the UI will render from tool metadata):',
      '```chart',
      canonical,
      '```',
    ].join('\n'),
    metadata: { chartSpec: parsed.spec, chartType: parsed.spec.type },
  };
}
