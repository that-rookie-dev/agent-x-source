import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { execSync } from 'node:child_process';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';

export async function codeSearch(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const pattern = args['pattern'] as string;
  const glob = args['glob'] as string | undefined;
  const cwd = resolve(context.scopePath);

  try {
    let cmd = `grep -rn --include='*.{ts,tsx,js,jsx,py,rs,go,java,c,cpp,h,hpp,rb,php}' "${pattern.replace(/"/g, '\\"')}"`;
    if (glob) cmd = `grep -rn --include='${glob}' "${pattern.replace(/"/g, '\\"')}"`;
    cmd += ' . | head -50';

    const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 10000 });
    return { success: true, output: output.trim() || 'No matches found' };
  } catch {
    // grep returns exit code 1 when no matches
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
  const file = resolve(context.scopePath, args['file'] as string);
  const oldStr = args['old'] as string;
  const newStr = args['new'] as string;

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
