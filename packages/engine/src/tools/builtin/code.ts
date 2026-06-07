import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { execSync } from 'node:child_process';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { IS_WINDOWS } from '../platform.js';
import { getAICommentMarker } from './markers.js';

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
  const ext = extname(file);
  const marker = getAICommentMarker(ext, 'code replace');
  const finalContent = updated.endsWith('\n') ? `${updated}${marker}\n` : `${updated}\n${marker}\n`;
  writeFileSync(file, finalContent, 'utf-8');

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
  let finalContent = lines.join('\n');
  const ext = extname(file);
  const marker = getAICommentMarker(ext, 'code insert');
  finalContent = finalContent.endsWith('\n') ? `${finalContent}${marker}\n` : `${finalContent}\n${marker}\n`;
  const { writeFileSync } = await import('node:fs');
  writeFileSync(file, finalContent, 'utf-8');

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

  const ext = extname(filePath);
  const marker = getAICommentMarker(ext, 'multi-edit patch');
  content = content.endsWith('\n') ? `${content}${marker}\n` : `${content}\n${marker}\n`;
  writeFileSync(filePath, content, 'utf-8');
  return { success: true, output: results.join('\n'), metadata: { applied: results.filter(r => r.includes('OK')).length, total: edits.length } };
}

export async function codeRange(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const filePath = resolve(context.scopePath, args['path'] as string);
  const startLine = args['startLine'] as number;
  const endLine = (args['endLine'] as number) ?? startLine;
  const replacement = (args['replacement'] as string) ?? '';

  if (!existsSync(filePath)) {
    return { success: false, output: 'File not found', error: 'NOT_FOUND' };
  }

  const lines = readFileSync(filePath, 'utf-8').split('\n');
  if (startLine < 0 || startLine >= lines.length) {
    return { success: false, output: `startLine ${startLine} out of range (0-${lines.length - 1})`, error: 'RANGE_ERROR' };
  }
  if (endLine < startLine || endLine >= lines.length) {
    return { success: false, output: `endLine ${endLine} out of range (${startLine}-${lines.length - 1})`, error: 'RANGE_ERROR' };
  }

  const newLines = replacement === '' ? [] : replacement.split('\n');
  lines.splice(startLine, endLine - startLine + 1, ...newLines);

  const ext = extname(filePath);
  const marker = getAICommentMarker(ext, 'range edit');
  const content = lines.join('\n');
  const finalContent = content.endsWith('\n') ? `${content}${marker}\n` : `${content}\n${marker}\n`;
  writeFileSync(filePath, finalContent, 'utf-8');
  return { success: true, output: `Replaced lines ${startLine}-${endLine} in ${filePath}` };
}

export async function codeGrep(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const pattern = args['pattern'] as string;
  const searchPath = (args['path'] as string) ?? '.';
  const contextLines = (args['context'] as number) ?? 2;
  const glob = args['glob'] as string | undefined;
  const cwd = resolve(context.scopePath, searchPath);

  try {
    let cmd: string;
    if (IS_WINDOWS) {
      const extFilter = glob ? `*.${glob.replace(/^\*?\.?/, '')}` : '*';
      cmd = `findstr /n /r "${pattern}" ${extFilter} 2>nul | head -50`;
    } else {
      const p = pattern.replace(/"/g, '\\"');
      const globFilter = glob ? `--include='${glob}'` : '--include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" --include="*.rs" --include="*.go" --include="*.c" --include="*.cpp" --include="*.java"';
      cmd = `grep -rn -C${contextLines} "${p}" ${globFilter} . 2>/dev/null | head -100`;
    }
    const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 15000 });
    return { success: true, output: output.trim() || 'No matches found' };
  } catch {
    return { success: true, output: 'No matches found' };
  }
}

export async function codeReferences(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const symbol = args['symbol'] as string;
  const searchPath = (args['path'] as string) ?? '.';
  const glob = args['glob'] as string | undefined;
  const cwd = resolve(context.scopePath, searchPath);

  try {
    let cmd: string;
    if (IS_WINDOWS) {
      cmd = `findstr /s /n /r "${symbol}" *.ts *.tsx *.js 2>nul | findstr /v node_modules | findstr /v ".git" | head -50`;
    } else {
      const s = symbol.replace(/"/g, '\\"');
      const globFilter = glob ? `--include='${glob}'` : '--include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx"';
      cmd = `grep -rn "${s}" ${globFilter} . --color=never 2>/dev/null | grep -v node_modules | grep -v '.git/' | grep -v '.spec.' | head -50`;
    }
    const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 15000 });
    return { success: true, output: output.trim() || 'No references found', metadata: { symbol, count: output.trim().split('\n').length } };
  } catch {
    return { success: true, output: 'No references found' };
  }
}

export async function codeFormat(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const path = (args['path'] as string) ?? '.';
  const cwd = resolve(context.scopePath, path);
  try {
    const output = execSync('npx prettier --write . 2>&1 || true', { cwd, encoding: 'utf-8', timeout: 60000 });
    return { success: true, output: output.trim() || 'Formatting complete' };
  } catch (error) {
    return { success: false, output: `Format failed: ${(error as Error).message}`, error: 'FORMAT_ERROR' };
  }
}

export async function codeLint(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const path = (args['path'] as string) ?? '.';
  const fix = args['fix'] as boolean;
  const cwd = resolve(context.scopePath, path);
  try {
    const cmd = fix ? 'npx eslint --fix . 2>&1 || true' : 'npx eslint . 2>&1 || true';
    const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 60000 });
    return { success: true, output: output.trim() || 'No lint issues found' };
  } catch (error) {
    return { success: false, output: `Lint failed: ${(error as Error).message}`, error: 'LINT_ERROR' };
  }
}

export async function codeFix(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const path = (args['path'] as string) ?? '.';
  const cwd = resolve(context.scopePath, path);
  try {
    const output = execSync('npx eslint --fix . 2>&1 || true', { cwd, encoding: 'utf-8', timeout: 60000 });
    return { success: true, output: output.trim() || 'No issues to fix' };
  } catch (error) {
    return { success: false, output: `Fix failed: ${(error as Error).message}`, error: 'FIX_ERROR' };
  }
}

export async function codeTypecheck(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const path = (args['path'] as string) ?? '.';
  const cwd = resolve(context.scopePath, path);
  try {
    const output = execSync('npx tsc --noEmit 2>&1 || true', { cwd, encoding: 'utf-8', timeout: 120000 });
    return { success: true, output: output.trim() || 'Type check passed' };
  } catch (error) {
    return { success: false, output: `Type check failed: ${(error as Error).message}`, error: 'TYPECHECK_ERROR' };
  }
}

export async function codeAnalyze(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = resolve(context.scopePath, args['file'] as string);
  if (!existsSync(file)) {
    return { success: false, output: 'File not found', error: 'NOT_FOUND' };
  }
  try {
    const content = readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    const imports = content.match(/^import\s+/gm)?.length ?? 0;
    const functions = content.match(/function\s+\w+/g)?.length ?? 0;
    const classes = content.match(/class\s+\w+/g)?.length ?? 0;
    const exports = content.match(/^export\s+/gm)?.length ?? 0;
    const emptyLines = lines.filter(l => l.trim() === '').length;
    const avgLineLength = Math.round(content.replace(/\s+/g, '').length / lines.length);

    const analysis = [
      `File: ${file}`,
      `Lines: ${lines.length}`,
      `Characters: ${content.length}`,
      `Imports: ${imports}`,
      `Functions: ${functions}`,
      `Classes: ${classes}`,
      `Exports: ${exports}`,
      `Empty lines: ${emptyLines}`,
      `Avg line length (non-whitespace): ${avgLineLength}`,
    ];
    return { success: true, output: analysis.join('\n') };
  } catch (error) {
    return { success: false, output: `Analysis failed: ${(error as Error).message}`, error: 'ANALYZE_ERROR' };
  }
}
