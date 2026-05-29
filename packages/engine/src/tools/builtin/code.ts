import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { execSync } from 'node:child_process';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { IS_WINDOWS } from '../platform.js';

export async function codeSearch(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const pattern = args['pattern'] as string;
  const glob = args['glob'] as string | undefined;
  const searchPath = (args['path'] as string) ?? '.';
  const cwd = resolve(context.scopePath, searchPath);

  const defaultExts = ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'rb', 'php'];
  const exts = glob ? [glob.replace(/^\*?\.?/, '')] : defaultExts;

  try {
    let cmd: string;
    if (IS_WINDOWS) {
      const extPatterns = exts.map(e => `*.${e}`).join(' ');
      cmd = `findstr /s /n /r "${pattern}" ${extPatterns} 2>nul | findstr /v node_modules | findstr /v .git | head -50`;
    } else {
      const p = pattern.replace(/"/g, '\\"');
      const nameExpr = exts.map(e => `-name '*.${e}'`).join(' -o ');
      cmd = `find . \\( ${nameExpr} \\) ! -path '*/node_modules/*' ! -path '*/.git/*' -exec grep -rn "${p}" {} + 2>/dev/null | head -50`;
    }

    const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 10000 });
    return { success: true, output: output.trim() || 'No matches found' };
  } catch {
    return { success: true, output: 'No matches found' };
  }
}

export async function codeDefinitions(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = resolve(context.scopePath, args['file'] as string);

  if (!existsSync(file)) {
    return { success: false, output: 'File not found', error: 'NOT_FOUND' };
  }

  const content = readFileSync(file, 'utf-8');
  const ext = extname(file);
  const lines = content.split('\n');
  const definitions: string[] = [];

  const patterns: Record<string, RegExp[]> = {
    '.ts': [/^export\s+(function|class|interface|type|enum|const|let)\s+(\w+)/],
    '.tsx': [/^export\s+(function|class|interface|type|enum|const|let)\s+(\w+)/],
    '.js': [/^(export\s+)?(function|class|const|let|var)\s+(\w+)/, /^module\.exports/],
    '.jsx': [/^(export\s+)?(function|class|const|let|var)\s+(\w+)/],
    '.py': [/^(class|def)\s+(\w+)/, /^(\w+)\s*=/],
    '.rs': [/^pub\s+(fn|struct|enum|trait|mod|type)\s+(\w+)/, /^(fn|struct|enum)\s+(\w+)/],
    '.go': [/^func\s+(\w+)/, /^type\s+(\w+)/],
  };

  const filePatterns = patterns[ext] ?? [/^(export\s+)?(function|class|const|interface|type)\s+(\w+)/];

  for (let i = 0; i < lines.length; i++) {
    for (const pat of filePatterns) {
      if (pat.test(lines[i]!)) {
        definitions.push(`L${i + 1}: ${lines[i]!.trimEnd()}`);
        break;
      }
    }
  }

  return {
    success: true,
    output: definitions.length > 0 ? definitions.join('\n') : 'No definitions found',
    metadata: { count: definitions.length },
  };
}

export async function codeReplace(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = resolve(context.scopePath, (args['path'] ?? args['file']) as string);
  const oldStr = (args['search'] ?? args['old']) as string;
  const newStr = (args['replace'] ?? args['new']) as string;

  if (!existsSync(file)) {
    return { success: false, output: 'File not found', error: 'NOT_FOUND' };
  }

  const content = readFileSync(file, 'utf-8');
  const occurrences = content.split(oldStr).length - 1;

  if (occurrences === 0) {
    return { success: false, output: 'Pattern not found in file', error: 'NO_MATCH' };
  }

  if (occurrences > 1) {
    return { success: false, output: `Pattern matches ${occurrences} locations — must be unique`, error: 'AMBIGUOUS' };
  }

  const { writeFileSync } = await import('node:fs');
  const updated = content.replace(oldStr, newStr);
  writeFileSync(file, updated, 'utf-8');

  return { success: true, output: `Replaced 1 occurrence in ${file}` };
}

export async function codeInsert(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = resolve(context.scopePath, args['file'] as string);
  const line = args['line'] as number;
  const content = args['content'] as string;

  if (!existsSync(file)) {
    return { success: false, output: 'File not found', error: 'NOT_FOUND' };
  }

  const existing = readFileSync(file, 'utf-8');
  const lines = existing.split('\n');

  if (line < 0 || line > lines.length) {
    return { success: false, output: `Line ${line} out of range (0-${lines.length})`, error: 'OUT_OF_RANGE' };
  }

  lines.splice(line, 0, content);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(file, lines.join('\n'), 'utf-8');

  return { success: true, output: `Inserted at line ${line} in ${file}` };
}

export async function codeSymbols(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = resolve(context.scopePath, args['file'] as string);

  if (!existsSync(file)) {
    return { success: false, output: 'File not found', error: 'NOT_FOUND' };
  }

  const content = readFileSync(file, 'utf-8');
  const lines = content.split('\n');
  const symbols: Array<{ name: string; kind: string; line: number }> = [];

  const patterns: Array<{ regex: RegExp; kind: string }> = [
    { regex: /(?:export\s+)?class\s+(\w+)/, kind: 'class' },
    { regex: /(?:export\s+)?function\s+(\w+)/, kind: 'function' },
    { regex: /(?:export\s+)?interface\s+(\w+)/, kind: 'interface' },
    { regex: /(?:export\s+)?type\s+(\w+)/, kind: 'type' },
    { regex: /(?:export\s+)?enum\s+(\w+)/, kind: 'enum' },
    { regex: /(?:export\s+)?const\s+(\w+)/, kind: 'variable' },
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const { regex, kind } of patterns) {
      const match = lines[i]!.match(regex);
      if (match?.[1]) {
        symbols.push({ name: match[1], kind, line: i + 1 });
        break;
      }
    }
  }

  const output = symbols.map((s) => `${s.kind} ${s.name} (L${s.line})`).join('\n');
  return { success: true, output: output || 'No symbols found', metadata: { count: symbols.length } };
}

export async function filePatch(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const filePath = resolve(context.scopePath, args['file'] as string);
  const edits = args['edits'] as Array<{ search: string; replace: string }>;

  if (!existsSync(filePath)) {
    return { success: false, output: 'File not found', error: 'NOT_FOUND' };
  }
  if (!Array.isArray(edits) || edits.length === 0) {
    return { success: false, output: 'edits must be a non-empty array of {search, replace}', error: 'INVALID_INPUT' };
  }

  let content = readFileSync(filePath, 'utf-8');
  const results: string[] = [];

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]!;
    const { search, replace } = edit;
    if (!content.includes(search)) {
      results.push(`Edit ${i + 1}: FAILED - search string not found`);
      continue;
    }
    const occurrences = content.split(search).length - 1;
    if (occurrences > 1) {
      results.push(`Edit ${i + 1}: FAILED - search string matches ${occurrences} times (must be unique)`);
      continue;
    }
    content = content.replace(search, replace);
    results.push(`Edit ${i + 1}: OK`);
  }

  const { writeFileSync: writeFs } = await import('node:fs');
  writeFs(filePath, content, 'utf-8');
  return { success: true, output: results.join('\n'), metadata: { applied: results.filter(r => r.includes('OK')).length, total: edits.length } };
}
