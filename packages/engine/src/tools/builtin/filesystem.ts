import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, readdirSync, statSync, renameSync, rmSync, cpSync, copyFileSync } from 'node:fs';
import { resolve, dirname, basename, extname } from 'node:path';
import { execSync } from 'node:child_process';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { IS_WINDOWS } from '../platform.js';
import { getAICommentMarker } from './markers.js';

export async function fileRead(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const filePath = resolve(context.scopePath, args['path'] as string);
  try {
    const content = readFileSync(filePath, 'utf-8');
    const MAX_CHARS = 50000;
    if (content.length > MAX_CHARS) {
      return { success: true, output: content.slice(0, MAX_CHARS) + `\n\n[File truncated — ${content.length - MAX_CHARS} chars omitted. Use offset/limit to read specific sections.]` };
    }
    const offset = (args['offset'] as number) ?? 0;
    const limit = args['limit'] as number | undefined;

    if (offset > 0 || limit !== undefined) {
      const lines = content.split('\n');
      const start = Math.max(0, offset);
      const end = limit !== undefined ? start + limit : undefined;
      const sliced = lines.slice(start, end);
      const total = lines.length;
      const output = sliced.join('\n');
      const meta = { totalLines: total, returnedLines: sliced.length, offset: start };
      return { success: true, output, metadata: meta };
    }

    return { success: true, output: content };
  } catch (error) {
    return { success: false, output: `Failed to read file: ${(error as Error).message}`, error: 'READ_ERROR' };
  }
}

export async function fileWrite(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const rawPath = args['path'];
  const filePath = resolve(context.scopePath, typeof rawPath === 'string' && rawPath.trim() ? rawPath : '.');
  const rawContent = args['content'];
  if (typeof rawContent !== 'string') {
    return { success: false, output: 'Missing or invalid required argument: content', error: 'INVALID_ARGS' };
  }
  const content = rawContent;
  const mode = (args['mode'] as string) || 'overwrite';
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const ext = extname(filePath);
    const marker = getAICommentMarker(ext);
    if (mode === 'append') {
      const contentWithMarker = `\n${content}\n${marker}\n`;
      writeFileSync(filePath, contentWithMarker, { flag: 'a', encoding: 'utf-8' });
      return { success: true, output: `Appended to ${filePath}` };
    }
    const contentWithMarker = content.endsWith('\n') ? `${content}${marker}\n` : `${content}\n${marker}\n`;
    writeFileSync(filePath, contentWithMarker, 'utf-8');
    return { success: true, output: `Written to ${filePath}` };
  } catch (error) {
    return { success: false, output: `Failed to write file: ${(error as Error).message}`, error: 'WRITE_ERROR' };
  }
}

export async function fileDelete(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const filePath = resolve(context.scopePath, args['path'] as string);
  try {
    if (!existsSync(filePath)) {
      return { success: false, output: 'File does not exist', error: 'NOT_FOUND' };
    }
    unlinkSync(filePath);
    return { success: true, output: `Deleted ${filePath}` };
  } catch (error) {
    return { success: false, output: `Failed to delete file: ${(error as Error).message}`, error: 'DELETE_ERROR' };
  }
}

export async function folderCreate(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const rawPath = args['path'];
  const dirPath = resolve(context.scopePath, typeof rawPath === 'string' && rawPath.trim() ? rawPath : '.');
  try {
    mkdirSync(dirPath, { recursive: true });
    return { success: true, output: `Created directory ${dirPath}` };
  } catch (error) {
    return { success: false, output: `Failed to create directory: ${(error as Error).message}`, error: 'MKDIR_ERROR' };
  }
}

export async function folderDelete(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const dirPath = resolve(context.scopePath, args['path'] as string);
  try {
    if (!existsSync(dirPath)) {
      return { success: false, output: 'Directory does not exist', error: 'NOT_FOUND' };
    }
    rmSync(dirPath, { recursive: true });
    return { success: true, output: `Deleted directory ${dirPath}` };
  } catch (error) {
    return { success: false, output: `Failed to delete directory: ${(error as Error).message}`, error: 'RMDIR_ERROR' };
  }
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return val < 10 ? val.toFixed(1) + ' ' + units[i] : Math.round(val) + ' ' + units[i];
}

function formatDate(mtime: Date): string {
  const now = new Date();
  const isToday = mtime.toDateString() === now.toDateString();
  const isThisYear = mtime.getFullYear() === now.getFullYear();
  if (isToday) return mtime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isThisYear) return mtime.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return mtime.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

export async function folderList(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const dirPath = resolve(context.scopePath, (args['path'] as string) ?? '.');
  try {
    if (!existsSync(dirPath)) {
      return { success: false, output: 'Directory does not exist', error: 'NOT_FOUND' };
    }
    const entries = readdirSync(dirPath);
    const items: Array<{ name: string; isDir: boolean; size: string; modified: string; stat: import('fs').Stats | null }> = [];

    for (const entry of entries) {
      try {
        const stat = statSync(resolve(dirPath, entry));
        items.push({
          name: entry,
          isDir: stat.isDirectory(),
          size: stat.isDirectory() ? '--' : formatSize(stat.size),
          modified: formatDate(stat.mtime),
          stat,
        });
      } catch {
        items.push({ name: entry, isDir: false, size: '?', modified: '?', stat: null });
      }
    }

    items.sort((a, b) => {
      if (a.stat && b.stat) {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    const dirCount = items.filter(i => i.isDir).length;
    const fileCount = items.length - dirCount;

    const MAX_LINES = 500;
    if (items.length > MAX_LINES) {
      const lines = items.slice(0, MAX_LINES).map(i => ` ${i.isDir ? 'd' : 'f'}  ${i.name.padEnd(40)} ${i.size.padStart(10)}  ${i.modified}`);
      lines.push('', `[Truncated — ${items.length - MAX_LINES} entries omitted. Use a more specific path.]`);
      return { success: true, output: lines.join('\n') };
    }

    const header = ` ${'Type'.padEnd(5)} ${'Name'.padEnd(40)} ${'Size'.padStart(10)}  Modified`;
    const sep = '─'.repeat(header.length);
    const rows = items.map(i => ` ${i.isDir ? 'd' : 'f'}  ${i.name.padEnd(40)} ${i.size.padStart(10)}  ${i.modified}`);
    const footer = `\n ${dirCount} director${dirCount === 1 ? 'y' : 'ies'}, ${fileCount} file${fileCount === 1 ? '' : 's'}`;

    return { success: true, output: `${header}\n${sep}\n${rows.join('\n')}\n${sep}${footer}` };
  } catch (error) {
    return { success: false, output: `Failed to list directory: ${(error as Error).message}`, error: 'LIST_ERROR' };
  }
}

export async function folderMove(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const source = resolve(context.scopePath, args['from'] as string);
  const destination = resolve(context.scopePath, args['to'] as string);
  try {
    if (!existsSync(source)) {
      return { success: false, output: 'Source does not exist', error: 'NOT_FOUND' };
    }
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(source, destination);
    return { success: true, output: `Moved ${source} → ${destination}` };
  } catch (error) {
    return { success: false, output: `Failed to move: ${(error as Error).message}`, error: 'MOVE_ERROR' };
  }
}

export async function fileFind(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const pattern = args['pattern'] as string;
  const searchPath = (args['path'] as string) ?? '.';
  const cwd = resolve(context.scopePath, searchPath);

  try {
    const cmd = IS_WINDOWS
      ? `dir /s /b "${pattern}" 2>nul | findstr /v node_modules | findstr /v .git | findstr /v dist`
      : `find . -name "${pattern.replace(/"/g, '\\"')}" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | head -100`;
    const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 10000 });
    const files = output.trim().split('\n').filter(Boolean);
    if (files.length === 0) {
      return { success: true, output: 'No files matched' };
    }
    return { success: true, output: files.join('\n'), metadata: { count: files.length } };
  } catch {
    return { success: true, output: 'No files matched' };
  }
}

export async function fileCopy(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const from = resolve(context.scopePath, args['from'] as string);
  const to = resolve(context.scopePath, args['to'] as string);
  try {
    if (!existsSync(from)) {
      return { success: false, output: 'Source does not exist', error: 'NOT_FOUND' };
    }
    mkdirSync(dirname(to), { recursive: true });
    const fromStat = statSync(from);
    if (fromStat.isDirectory()) {
      cpSync(from, to, { recursive: true });
    } else {
      copyFileSync(from, to);
    }
    return { success: true, output: `Copied ${from} → ${to}` };
  } catch (error) {
    return { success: false, output: `Copy failed: ${(error as Error).message}`, error: 'COPY_ERROR' };
  }
}

export async function fileDiff(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file1 = resolve(context.scopePath, args['file1'] as string);
  const file2 = resolve(context.scopePath, args['file2'] as string);
  if (!existsSync(file1)) return { success: false, output: `File not found: ${file1}`, error: 'NOT_FOUND' };
  if (!existsSync(file2)) return { success: false, output: `File not found: ${file2}`, error: 'NOT_FOUND' };
  try {
    const cmd = IS_WINDOWS ? `fc "${file1}" "${file2}"` : `diff -u "${file1}" "${file2}"`;
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 10000 });
    return { success: true, output: output.trim() || '(files are identical)' };
  } catch (error) {
    const err = error as { stdout?: string; status?: number };
    if (err.stdout) {
      return { success: true, output: err.stdout.trim() };
    }
    return { success: true, output: '(files differ — diff output unavailable)' };
  }
}

export async function fileMetadata(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const filePath = resolve(context.scopePath, args['path'] as string);
  if (!existsSync(filePath)) {
    return { success: false, output: 'Path does not exist', error: 'NOT_FOUND' };
  }
  try {
    const stat = statSync(filePath);
    const isDir = stat.isDirectory();
    const info = [
      `Path: ${filePath}`,
      `Type: ${isDir ? 'directory' : 'file'}`,
      `Size: ${isDir ? '-' : `${stat.size} bytes`}`,
      `Created: ${stat.birthtime.toISOString()}`,
      `Modified: ${stat.mtime.toISOString()}`,
      `Permissions: ${(stat.mode & 0o777).toString(8)}`,
      `Owner: ${stat.uid}:${stat.gid}`,
    ];
    return { success: true, output: info.join('\n') };
  } catch (error) {
    return { success: false, output: `Failed to read metadata: ${(error as Error).message}`, error: 'STAT_ERROR' };
  }
}

export async function fileOpen(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const filePath = resolve(context.scopePath, args['path'] as string);
  if (!existsSync(filePath)) {
    return { success: false, output: 'File does not exist', error: 'NOT_FOUND' };
  }
  try {
    const cmd = IS_WINDOWS ? `start "" "${filePath}"` : `open "${filePath}"`;
    execSync(cmd, { timeout: 5000 });
    return { success: true, output: `Opened ${filePath}` };
  } catch (error) {
    return { success: false, output: `Failed to open: ${(error as Error).message}`, error: 'OPEN_ERROR' };
  }
}

function buildTree(
  dirPath: string,
  prefix: string,
  maxDepth: number,
  currentDepth: number,
  maxEntries: number,
): { lines: string[]; count: number } {
  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return { lines: [`${prefix}└── [error reading]`], count: 0 };
  }
  entries.sort((a, b) => {
    const aIsDir = existsSync(resolve(dirPath, a)) && statSync(resolve(dirPath, a)).isDirectory();
    const bIsDir = existsSync(resolve(dirPath, b)) && statSync(resolve(dirPath, b)).isDirectory();
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return a.localeCompare(b);
  });

  const lines: string[] = [];
  let count = 0;
  for (let i = 0; i < entries.length; i++) {
    if (count >= maxEntries) {
      lines.push(`${prefix}└── ... (${entries.length - count} more)`);
      break;
    }
    const entry = entries[i]!;
    const fullPath = resolve(dirPath, entry);
    const isDir = existsSync(fullPath) && statSync(fullPath).isDirectory();
    const isLast = i === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    lines.push(`${prefix}${connector}${entry}${isDir ? '/' : ''}`);
    count++;
    if (isDir && currentDepth < maxDepth) {
      const childPrefix = prefix + (isLast ? '    ' : '│   ');
      const child = buildTree(fullPath, childPrefix, maxDepth, currentDepth + 1, maxEntries - count);
      if (child.lines.length > 0) {
        lines.push(...child.lines);
        count += child.count;
      }
    }
  }
  return { lines, count };
}

export async function folderTree(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const dirPath = resolve(context.scopePath, (args['path'] as string) ?? '.');
  const depth = Math.min((args['depth'] as number) ?? 3, 6);
  if (!existsSync(dirPath)) {
    return { success: false, output: 'Directory does not exist', error: 'NOT_FOUND' };
  }
  try {
    const result = buildTree(dirPath, '', depth, 0, 200);
    const title = basename(dirPath) + '/';
    const output = [title, ...result.lines].join('\n');
    return { success: true, output };
  } catch (error) {
    return { success: false, output: `Tree failed: ${(error as Error).message}`, error: 'TREE_ERROR' };
  }
}

export async function folderOpen(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const dirPath = resolve(context.scopePath, args['path'] as string);
  if (!existsSync(dirPath)) {
    return { success: false, output: 'Directory does not exist', error: 'NOT_FOUND' };
  }
  try {
    const cmd = IS_WINDOWS ? `explorer "${dirPath}"` : `open "${dirPath}"`;
    execSync(cmd, { timeout: 5000 });
    return { success: true, output: `Opened directory ${dirPath}` };
  } catch (error) {
    return { success: false, output: `Failed to open directory: ${(error as Error).message}`, error: 'OPEN_ERROR' };
  }
}

export async function archiveCreate(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const output = resolve(context.scopePath, args['output'] as string);
  const source = (args['source'] as string).split(' ').map(s => resolve(context.scopePath, s));
  const format = (args['format'] as string) ?? 'tar.gz';
  try {
    for (const src of source) {
      if (!existsSync(src)) {
        return { success: false, output: `Source not found: ${src}`, error: 'NOT_FOUND' };
      }
    }
    mkdirSync(dirname(output), { recursive: true });
    if (format === 'zip') {
      const srcStr = source.map(s => `"${s}"`).join(' ');
      execSync(`zip -r "${output}" ${srcStr}`, { encoding: 'utf-8', timeout: 60000 });
    } else {
      const srcStr = source.map(s => `"${s}"`).join(' ');
      execSync(`tar -czf "${output}" ${srcStr}`, { encoding: 'utf-8', timeout: 60000 });
    }
    return { success: true, output: `Archive created: ${output}`, metadata: { format } };
  } catch (error) {
    return { success: false, output: `Archive failed: ${(error as Error).message}`, error: 'ARCHIVE_ERROR' };
  }
}

export async function archiveExtract(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const archive = resolve(context.scopePath, args['archive'] as string);
  const outputDir = args['output'] ? resolve(context.scopePath, args['output'] as string) : dirname(archive) + '/' + basename(archive).replace(/\.(tar\.gz|tgz|zip)$/, '');
  if (!existsSync(archive)) {
    return { success: false, output: 'Archive not found', error: 'NOT_FOUND' };
  }
  try {
    mkdirSync(outputDir, { recursive: true });
    if (archive.endsWith('.zip')) {
      execSync(`unzip -o "${archive}" -d "${outputDir}"`, { encoding: 'utf-8', timeout: 60000 });
    } else {
      execSync(`tar -xzf "${archive}" -C "${outputDir}"`, { encoding: 'utf-8', timeout: 60000 });
    }
    return { success: true, output: `Extracted to ${outputDir}` };
  } catch (error) {
    return { success: false, output: `Extraction failed: ${(error as Error).message}`, error: 'EXTRACT_ERROR' };
  }
}

/**
 * Batch-read multiple files with per-file truncation and template detection.
 * Returns a structured summary table so the LLM can decide which files need full reads.
 */
export async function fileReadBatch(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const paths = args['paths'] as string[] | undefined;
  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    return { success: false, output: 'paths (string array) is required', error: 'INVALID_ARGS' };
  }

  const maxFiles = Math.min((args['maxFiles'] as number) ?? 50, 200);
  const maxCharsPerFile = Math.min((args['maxCharsPerFile'] as number) ?? 400, 2000);

  const files: Array<{
    path: string;
    size: number;
    lines: number;
    fullContent: string;
    isTruncated: boolean;
  }> = [];

  const errors: Array<{ path: string; error: string }> = [];

  for (let i = 0; i < Math.min(paths.length, maxFiles); i++) {
    const rel = String(paths[i]);
    try {
      const filePath = resolve(context.scopePath, rel);
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      files.push({
        path: rel,
        size: content.length,
        lines: lines.length,
        fullContent: content,
        isTruncated: content.length > maxCharsPerFile,
      });
    } catch (err) {
      errors.push({ path: rel, error: (err as Error).message });
    }
  }

  const results = files.map((f) => ({
    path: f.path,
    size: f.size,
    lines: f.lines,
    isTruncated: f.isTruncated,
    content: f.isTruncated
      ? f.fullContent.slice(0, maxCharsPerFile) + `\n...[truncated ${f.size - maxCharsPerFile} chars]`
      : f.fullContent,
  }));

  const truncated = results.filter((r) => r.isTruncated);

  const summary = [
    `=== FILE READ BATCH SUMMARY ===`,
    `Total requested: ${paths.length} | Read: ${files.length} | Errors: ${errors.length}`,
    `Truncated: ${truncated.length}`,
    `Total chars read: ${files.reduce((s, f) => s + f.size, 0).toLocaleString()} | Total lines: ${files.reduce((s, f) => s + f.lines, 0).toLocaleString()}`,
    ``,
    truncated.length > 0 ? `⚠ Truncated files (${truncated.length}): use file_read to get full content of: ${truncated.map((t) => t.path).join(', ')}` : '',
    ``,
    `=== PER-FILE CONTENTS ===`,
    ``,
  ].filter(Boolean).join('\n');

  const perFile = results.map((r) => {
    return `--- ${r.path} (${r.lines} lines, ${r.size.toLocaleString()} chars${r.isTruncated ? ' [TRUNCATED]' : ''}) ---\n${r.content}`;
  }).join('\n\n');

  const errorsSection = errors.length > 0
    ? `\n\n=== ERRORS ===\n${errors.map((e) => `  ${e.path}: ${e.error}`).join('\n')}`
    : '';

  return {
    success: true,
    output: summary + perFile + errorsSection,
    metadata: {
      totalRequested: paths.length,
      totalRead: files.length,
      totalErrors: errors.length,
      truncatedCount: truncated.length,
      totalChars: files.reduce((s, f) => s + f.size, 0),
      totalLines: files.reduce((s, f) => s + f.lines, 0),
      truncated: truncated.map((t) => t.path),
      errors: errors,
    },
  };
}
